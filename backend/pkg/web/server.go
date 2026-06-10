package web

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/event_bus"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/tls"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/web/handler"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/web/middleware"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
	"os"
	"path/filepath"
)

type AppEngine struct {
	Config      config.Interface
	Logger      *logrus.Entry
	EventBus    event_bus.Interface
	deviceRepo  database.DatabaseRepository
	StandbyMode bool

	RelatedVersions map[string]string //related versions metadata provided & embedded by the build process
	Srv             *http.Server      // Added to manage the HTTP server lifecycle
}

// Reinitialize re-initializes the AppEngine's components, specifically the database and routes.
func (ae *AppEngine) Reinitialize() error {
	ae.Logger.Info("Reinitializing AppEngine...")

	// Shutdown existing server if it's running
	if ae.Srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := ae.Srv.Shutdown(ctx); err != nil {
			ae.Logger.Errorf("Error shutting down existing server: %v", err)
			return err
		}
		ae.Logger.Info("Existing server shut down.")
	}

	if err := ae.initializeDatabase(); err != nil {
		return err
	}

	// Re-setup routes
	baseRouterGroup, ginRouter := ae.Setup()
	ae.SetupFrontendRouting(baseRouterGroup, ginRouter)

	ae.startServer(ginRouter)

	ae.Logger.Info("AppEngine reinitialized and server restarted.")
	return nil
}

func (ae *AppEngine) Setup() (*gin.RouterGroup, *gin.Engine) {
	r := gin.New()

	// Security response headers on every response (#105 / H4) + staged CSP (#124). First, so it
	// covers the SPA + API. The report-only strict script-src is computed once here from the
	// served index.html, so the inline-script hashes can never drift from the served bytes.
	reportOnlyScriptSrc := middleware.ComputeReportOnlyScriptSrc(ae.readFrontendIndexHTML())
	r.Use(middleware.SecurityHeadersMiddleware(ae.Config.GetBool("web.listen.https.enabled"), reportOnlyScriptSrc))

	if !ae.StandbyMode {
		r.Use(middleware.RepositoryMiddleware(ae.deviceRepo))
	}
	r.Use(middleware.LoggerMiddleware(ae.Logger))
	r.Use(middleware.ConfigMiddleware(ae.Config))
	r.Use(middleware.EventBusMiddleware(ae.EventBus))
	r.Use(gin.Recovery())

	basePath := ae.Config.GetString("web.listen.basepath")
	ae.Logger.Debugf("basepath: %s", basePath)

	base := r.Group(basePath)
	{
		api := base.Group("/api")
		{
			api.GET("/health", func(c *gin.Context) {
				// This function does a quick check to see if the server is up and running
				// it will also determine if we should show the first run wizard

				firstRunWizard := false

				if ae.StandbyMode {
					dbPath := ae.Config.GetString("database.location")
					_, err := os.Stat(dbPath)
					if os.IsNotExist(err) {
						firstRunWizard = true
					}

					c.JSON(http.StatusOK, gin.H{
						"success": true,
						"data": gin.H{
							"first_run_wizard": firstRunWizard,
							"standby_mode":     true,
						},
					})
					return
				}

				//get the count of users in the DB
				databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)
				userCount, err := databaseRepo.GetUserCount(c)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"success": false})
					return
				}

				keepAliveMsg := models.NewEventKeepAlive("heartbeat")
				err = ae.EventBus.PublishMessage(keepAliveMsg)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"success": false})
					return
				}
				firstRunWizard = userCount == 0

				c.JSON(http.StatusOK, gin.H{
					"success": true,
					"data": gin.H{
						"first_run_wizard": firstRunWizard,
						"standby_mode":     false,
					},
				})
			})

			// In standby mode, we only want to expose the encryption key setup endpoints
			if ae.StandbyMode {
				encryptionKeyHandler := handler.NewEncryptionKeyHandler(ae.Config, ae.Logger, ae)
				// initial encryption key setup
				api.GET("/encryption-key", encryptionKeyHandler.GetEncryptionKey)

				// encryption key restore
				api.POST("/encryption-key", encryptionKeyHandler.SetEncryptionKey)
				api.POST("/encryption-key/validate", encryptionKeyHandler.ValidateEncryptionKey)
			} else {
				ae.Logger.Info("Database StandbyMode is off, skipping encryption key setup endpoints.")
			}

			if !ae.StandbyMode { // Check ae.StandbyMode for non-standby mode
				api.Use(middleware.CacheMiddleware())

				// Rate-limit the unauthenticated auth endpoints to blunt online
				// password guessing / account spraying (#104 / H3).
				authGroup := api.Group("/auth")
				authGroup.Use(middleware.RateLimitMiddleware(10, time.Minute))
				authGroup.POST("/signup", handler.AuthSignup)
				authGroup.POST("/signin", handler.AuthSignin)
				authGroup.POST("/logout", handler.AuthLogout) // clears the session cookie (#103)

				//whitelisted CORS PROXY
				api.GET("/cors/:endpointId/*proxyPath", handler.CORSProxy)
				api.POST("/cors/:endpointId/*proxyPath", handler.CORSProxy)
				api.OPTIONS("/cors/:endpointId/*proxyPath", handler.CORSProxy)

				api.GET("/glossary/code", handler.GlossarySearchByCode)
				api.POST("/support/request", handler.SupportRequest)
				api.POST("/support/healthsystem", handler.HealthSystemRequest)

				secure := api.Group("/secure").Use(middleware.RequireAuth())
				{
					secure.GET("/account/me", handler.GetCurrentUser)
					secure.DELETE("/account/me", handler.DeleteAccount)

					secure.GET("/summary", handler.GetSummary)
					secure.GET("/summary/ips", handler.GetIPSSummary)
					secure.GET("/medications/reconciled", handler.GetMedicationsReconciled)

					secure.POST("/source", handler.CreateReconnectSource)
					secure.POST("/source/authorize", handler.AuthorizeSource)
					secure.POST("/source/connect", handler.ConnectSource)
					secure.POST("/source/manual", handler.CreateManualSource)
					secure.GET("/source", handler.ListSource)
					secure.GET("/source/:sourceId", handler.GetSource)
					secure.DELETE("/source/:sourceId", handler.DeleteSource)
					secure.POST("/source/:sourceId/sync", handler.SourceSync)
					secure.GET("/source/:sourceId/summary", handler.GetSourceSummary)
					secure.GET("/resource/fhir", handler.ListResourceFhir)
					secure.POST("/resource/graph/:graphType", handler.GetResourceFhirGraph)
					secure.GET("/resource/fhir/:sourceId/:resourceId", handler.GetResourceFhir)
					secure.PATCH("/resource/fhir/:resourceType/:resourceId", handler.UpdateResourceFhir)
					secure.DELETE("/resource/fhir/:resourceType/:resourceId", handler.DeleteResourceFhir)

					secure.POST("/resource/composition", handler.CreateResourceComposition)
					secure.POST("/resource/related", handler.CreateRelatedResources)
					secure.DELETE("/encounter/:encounterId/related/:resourceType/:resourceId", handler.EncounterUnlinkResource)

					secure.GET("/dashboards", handler.GetDashboard)
					secure.POST("/dashboards", handler.AddDashboardLocation)
					//secure.GET("/dashboard/:dashboardId", handler.GetDashboard)

					secure.GET("/jobs", handler.ListBackgroundJobs)
					secure.POST("/jobs/error", handler.CreateBackgroundJobError)

					secure.POST("/query", handler.QueryResourceFhir)

					secure.GET("/users", handler.GetUsers)
					secure.POST("/users", handler.CreateUser)

					//admin dashboard (#170) — handlers self-gate on the admin role
					secure.GET("/admin/logs", handler.GetServerLogs)

					secure.POST("/practitioners", handler.CreatePractitioner)
					secure.PUT("/practitioners/:practitionerId", handler.UpdatePractitioner)
					secure.GET("/practitioners/:practitionerId/history", handler.GetPractitionerEncounterHistory)

					// Address book favorite actions
					secure.POST("/user/favorites", handler.AddPractitionerToFavorites)
					secure.DELETE("/user/favorites", handler.RemovePractitionerFromFavorites)
					secure.GET("/user/favorites", handler.GetUserFavoritePractitioners)

					// Access token management
					secure.GET("/access/token", handler.GetAccessTokens)
					secure.POST("/access/token", handler.CreateAccessToken)
					secure.DELETE("/access/token", handler.DeleteAccessToken)

					secure.GET("/sync/discovery", handler.GetServerDiscovery)

					//server-side-events handler (only supported on mac/linux)
					// TODO: causes deadlock on Windows
					if runtime.GOOS != "windows" {
						secure.GET("/events/stream",
							middleware.SSEHeaderMiddleware(),
							handler.SSEEventBusServerHandler(ae.EventBus),
						)
					}
				}
			}

			if ae.Config.GetBool("web.allow_unsafe_endpoints") {
				//this endpoint lets us request data directly from the source api
				ae.Logger.Warningln("***UNSAFE***")
				ae.Logger.Warningln("***UNSAFE***")
				ae.Logger.Warningln("***UNSAFE***")
				ae.Logger.Warningln("***UNSAFE***")
				ae.Logger.Warningln("***UNSAFE***")
				ae.Logger.Warningf("\"web.allow_unsafe_endpoints\" mode enabled!! This enables developer functionality, including unauthenticated raw api requests")
				ae.Logger.Warningln("***UNSAFE***")
				ae.Logger.Warningln("***UNSAFE***")
				ae.Logger.Warningln("***UNSAFE***")
				ae.Logger.Warningln("***UNSAFE***")
				ae.Logger.Warningln("***UNSAFE***")
				unsafe := api.Group("/unsafe")
				{
					//http://localhost:9090/api/unsafe/testuser1/3508f8cf-6eb9-4e4b-8174-dd69a493a2b4/Patient/smart-1288992
					unsafe.GET("/:username/:sourceId/*path", handler.UnsafeRequestSource)
					unsafe.GET("/:username/graph/:graphType", handler.UnsafeResourceGraph)
					unsafe.GET("/:username/sync/:sourceId", handler.UnsafeSyncResourceNames)

				}
			}
		}
	}

	return base, r
}

// readFrontendIndexHTML reads the index.html the backend serves from disk
// (web.src.frontend.path), used at startup to compute the report-only CSP script-src hashes
// (#124). Returns nil on any error — ComputeReportOnlyScriptSrc then falls back to
// "script-src 'self'" (no hashes), which is harmless for an observe-only policy.
func (ae *AppEngine) readFrontendIndexHTML() []byte {
	indexPath := filepath.Join(ae.Config.GetString("web.src.frontend.path"), "index.html")
	data, err := os.ReadFile(indexPath)
	if err != nil {
		ae.Logger.Warnf("CSP: could not read %s for report-only script-src hashes (%v); falling back to script-src 'self'", indexPath, err)
		return nil
	}
	return data
}

func (ae *AppEngine) SetupFrontendRouting(base *gin.RouterGroup, router *gin.Engine) *gin.Engine {
	//Static request routing
	base.StaticFS("/web", http.Dir(ae.Config.GetString("web.src.frontend.path")))

	//redirect base url to /web
	base.GET("/", func(c *gin.Context) {
		c.Redirect(http.StatusFound, ae.Config.GetString("web.listen.basepath")+"/web")
	})

	//catch-all, serve index page.
	router.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/api") {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "404 endpoint not found"})
		} else {
			c.File(fmt.Sprintf("%s/index.html", ae.Config.GetString("web.src.frontend.path")))
		}
	})
	return router
}

func (ae *AppEngine) SetupEmbeddedFrontendRouting(embeddedAssetsFS embed.FS, base *gin.RouterGroup, router *gin.Engine) *gin.Engine {
	//Static request routing
	base.StaticFS("/web", http.FS(embeddedAssetsFS))

	//redirect base url to /web
	base.GET("/", func(c *gin.Context) {
		c.Redirect(http.StatusFound, ae.Config.GetString("web.listen.basepath")+"/web")
	})

	//catch-all, serve index page.
	router.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/api") {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "404 endpoint not found"})
		} else {
			ae.Logger.Infof("could not find %s, fallback to index.html", path)
			c.FileFromFS("index.html", http.FS(embeddedAssetsFS))
		}
	})
	return router
}

func (ae *AppEngine) SetupInstallationRegistration() error {
	//check if installation is already registered
	systemSettings, err := ae.deviceRepo.LoadSystemSettings(context.Background())
	if err != nil {
		return fmt.Errorf("an error occurred while loading system settings: %s", err)
	}

	if systemSettings.InstallationID != "" && systemSettings.InstallationSecret != "" {
		//already setup, exit
		//TODO: future, update fasten-onprem, fasten-sources version
		return nil
	}

	//setup the installation registration payload
	registrationData := &models.InstallationRegistrationRequest{
		SoftwareArchitecture: runtime.GOARCH,
		SoftwareOS:           runtime.GOOS,
	}

	if ae.RelatedVersions != nil {
		if fastenSourcesVersion, fastenSourcesVersionOk := ae.RelatedVersions["sources"]; fastenSourcesVersionOk {
			registrationData.FastenSourcesVersion = fastenSourcesVersion
		}
		if fastenOnpremVersion, fastenOnpremVersionOk := ae.RelatedVersions["onprem"]; fastenOnpremVersionOk {
			registrationData.FastenOnpremVersion = fastenOnpremVersion
		}
		if fastenDesktopVersion, fastenDesktopVersionOk := ae.RelatedVersions["desktop"]; fastenDesktopVersionOk {
			registrationData.FastenDesktopVersion = fastenDesktopVersion
		}
	}

	//setup the http request
	registrationDataJson, err := json.Marshal(registrationData)
	if err != nil {
		return fmt.Errorf("an error occurred while serializing installation registration data: %s", err)
	}

	//send the registration request
	resp, err := http.Post(
		"https://api.platform.fastenhealth.com/v1/installation/register",
		"application/json",
		bytes.NewBuffer(registrationDataJson),
	)
	if err != nil {
		return fmt.Errorf("an error occurred while sending installation registration request: %s", err)
	} else if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("an error occurred while sending installation registration request: %s", resp.Status)
	}
	defer resp.Body.Close()

	//unmarshal the registration response
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("an error occurred while reading installation registration response: %s", err)
	}
	var registrationResponse models.ResponseWrapperTyped[models.InstallationRegistrationResponse]
	err = json.Unmarshal(bodyBytes, &registrationResponse)
	if err != nil {
		return fmt.Errorf("an error occurred while unmarshalling installation registration response: %s", err)
	}

	//now that we have the registration response, store the registration data in the system settings
	systemSettings.InstallationID = registrationResponse.Data.InstallationID
	systemSettings.InstallationSecret = registrationResponse.Data.InstallationSecret

	ae.Logger.Infof("Saving installation id to settings table: %s", systemSettings.InstallationID)

	//save the system settings
	err = ae.deviceRepo.SaveSystemSettings(context.Background(), systemSettings)
	if err != nil {
		return fmt.Errorf("an error occurred while saving system settings: %s", err)
	}
	return nil
}

func (ae *AppEngine) Start() error {
	//set the gin mode
	gin.SetMode(gin.ReleaseMode)
	if strings.ToLower(ae.Config.GetString("log.level")) == "debug" {
		gin.SetMode(gin.DebugMode)
	}

	if err := ae.initializeDatabase(); err != nil {
		return err
	}

	// Resolve the JWT signing key: honor an explicit non-default override, else reuse or
	// generate-and-persist a random key in the data dir (alongside the DB). HS256 is
	// symmetric, so this is the root of trust for all auth — the committed public default
	// must never sign tokens (#102). Secure-by-default with zero config; no Flux/secret-
	// manager dependency. Set it back into config so the existing read sites use it.
	jwtKey, err := config.ResolveJWTIssuerKey(
		ae.Config.GetString("jwt.issuer.key"),
		filepath.Dir(ae.Config.GetString("database.location")),
	)
	if err != nil {
		return err
	}
	ae.Config.Set("jwt.issuer.key", jwtKey)

	baseRouterGroup, ginRouter := ae.Setup()

	// Only setup installation registration if not in StandbyMode
	if !ae.StandbyMode {
		err := ae.SetupInstallationRegistration()
		if err != nil {
			ae.Logger.Panicf("panic occurred:%v", err)
		}
	} else {
		ae.Logger.Warn("Skipping SetupInstallationRegistration because in StandbyMode")
	}

	r := ae.SetupFrontendRouting(baseRouterGroup, ginRouter)

	if ae.Config.GetBool("web.listen.https.enabled") {
		certFile, keyFile, err := ae.setupTLS()
		if err != nil {
			return err
		}
		ae.Config.Set("web.listen.https.certFile", certFile)
		ae.Config.Set("web.listen.https.keyFile", keyFile)
	}

	ae.startServer(r)

	// Scheduled SMART OAuth token-refresh worker (#51). Skipped in StandbyMode (no DB-backed
	// sources to refresh there).
	if !ae.StandbyMode {
		go ae.startTokenRefreshWorker()
	}

	// Block indefinitely to keep the server running until process termination
	select {}
}

func (ae *AppEngine) startServer(r *gin.Engine) {
	host := ae.Config.GetString("web.listen.host")
	port := ae.Config.GetString("web.listen.port")
	listenAddr := fmt.Sprintf("%s:%s", host, port)

	ae.Srv = &http.Server{
		Addr:    listenAddr,
		Handler: r,
	}

	go func() {
		if ae.Config.GetBool("web.listen.https.enabled") {
			certFile := ae.Config.GetString("web.listen.https.certFile")
			keyFile := ae.Config.GetString("web.listen.https.keyFile")

			ae.Logger.Infof("Using HTTPS cert: %s", certFile)
			ae.Logger.Infof("Using HTTPS key:  %s", keyFile)

			if err := ae.Srv.ListenAndServeTLS(certFile, keyFile); err != nil && err != http.ErrServerClosed {
				ae.Logger.Fatalf("listen TLS: %s\n", err)
			}
		} else {
			if err := ae.Srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				ae.Logger.Fatalf("listen: %s\n", err)
			}
		}
	}()
}

func (ae *AppEngine) initializeDatabase() error {
	encryptionEnabled := ae.Config.GetBool("database.encryption.enabled")
	encryptionKey := ae.Config.GetString("database.encryption.key")

	if encryptionEnabled && encryptionKey == "" {
		ae.Logger.Warningf("Encryption key is missing. Starting in STANDBY mode.")
		ae.StandbyMode = true
		// In standby mode, deviceRepo remains nil
		return nil
	}

	ae.StandbyMode = false

	// Initialize database if not in standby mode or encryption is disabled
	if encryptionEnabled {
		ae.Logger.Info("Encryption key found. Initializing database.")
	} else {
		ae.Logger.Info("Database encryption is disabled. Initializing database without encryption.")
	}

	dbRepo, err := database.NewRepository(ae.Config, ae.Logger, ae.EventBus)
	if err != nil {
		return fmt.Errorf("failed to initialize database repository: %w", err)
	}
	ae.deviceRepo = dbRepo

	return nil
}

func (ae *AppEngine) setupTLS() (string, string, error) {
	certDir := ae.Config.GetString("web.listen.https.certDir")
	if certDir == "" {
		certDir = "certs" // Default certificate directory for server certs and all keys
	}
	sharedDir := ae.Config.GetString("web.listen.https.sharedDir")
	if sharedDir == "" {
		sharedDir = "certs/shared" // Default shared directory for root CA public cert
	}

	ae.Logger.Infof("Ensuring TLS certificates in: %s", certDir)
	ae.Logger.Infof("Ensuring TLS shared certificates in: %s", sharedDir)
	certFile, keyFile, err := tls.GenerateCertificates(certDir, sharedDir, ae.Logger)
	if err != nil {
		return "", "", fmt.Errorf("failed to setup TLS certificates: %w", err)
	}
	return certFile, keyFile, nil
}
