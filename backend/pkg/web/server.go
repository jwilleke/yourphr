package web

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/demo"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/event_bus"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/metrics"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/tls"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/version"
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

	// Before anything reads c.ClientIP() — the rate limiter and the request log both do (#529).
	// Gin's default is to trust every proxy, which makes the client's own X-Forwarded-For header
	// authoritative; an error here leaves the engine trusting nothing, which is the safe direction.
	if err := ApplyTrustedProxies(r, ae.Config.GetStringSlice(TrustedProxiesConfigKey), ae.Logger); err != nil {
		ae.Logger.Error(err)
	}

	// Security response headers on every response (#105 / H4) + staged CSP (#124). First, so it
	// covers the SPA + API. The report-only strict script-src is computed once here from the
	// served index.html, so the inline-script hashes can never drift from the served bytes.
	reportOnlyScriptSrc := middleware.ComputeReportOnlyScriptSrc(ae.readFrontendIndexHTML())

	// search.enabled (fasten-onprem#594) has the browser talk to Typesense directly, so its port
	// needs a connect-src allowance or every chat/search request is silently blocked by CSP
	// rather than a network error — which is exactly what happened before this was added: the
	// port was reachable, Typesense could reach the configured LLM fine, and the browser still
	// reported "Could not get a response" because it never even attempted the connection.
	var typesensePort string
	if ae.Config.GetBool("search.enabled") {
		if searchURL, err := url.Parse(ae.Config.GetString("search.uri")); err == nil {
			typesensePort = searchURL.Port()
		}
	}
	r.Use(middleware.SecurityHeadersMiddleware(ae.Config.GetBool("web.listen.https.enabled"), reportOnlyScriptSrc, typesensePort))

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
			// Public: running app version + optional deployment label for the UI footer
			// ("demo-1.18.2"). Label is runtime config so one release image can serve prod/demo/dev
			// (YOURPHR_WEB_ENVIRONMENT_NAME / web.environment_name).
			api.GET("/version", func(c *gin.Context) {
				envName := strings.TrimSpace(ae.Config.GetString("web.environment_name"))
				c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
					"version":          version.VERSION,
					"environment_name": envName,
				}})
			})
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

				// Rate-limit the unauthenticated CREDENTIAL endpoints to blunt online password
				// guessing / account spraying (#104 / H3). The cap is configuration because 10 is a
				// brute-force backstop, not a throughput setting, and it is far too low for an
				// automated suite driving real logins — the E2E harness makes ~16 auth calls from
				// one IP and was silently collecting 429s (#481).
				// The WINDOW is configuration too (#509). It was a hardcoded time.Minute here while
				// the limit beside it was a setting, so the key's name was only accidentally true —
				// and the per-account limiter has to measure over the same window or the two drift.
				// A non-positive window falls back to the shipped 60s: an unusable window is a typo,
				// and reading it as "disable the brute-force backstop" is the wrong direction to
				// guess in. Disabling is what the LIMIT keys are for.
				authWindow := time.Duration(ae.Config.GetInt("web.rate_limit.auth_window_seconds")) * time.Second
				if authWindow <= 0 {
					authWindow = time.Minute
				}

				authGroup := api.Group("/auth")
				// A limit of 0 or less disables the per-IP throttle, deliberately and documented: an
				// automated suite driving real logins from one address is the case that needs it
				// (#481). The per-ACCOUNT limit in AuthSignin is independent and still applies.
				if authPerMinute := ae.Config.GetInt("web.rate_limit.auth_per_minute"); authPerMinute > 0 {
					authGroup.Use(middleware.RateLimitMiddleware(authPerMinute, authWindow))
				} else {
					ae.Logger.Warnf("web.rate_limit.auth_per_minute is %d — the per-IP sign-in throttle is OFF on this instance", authPerMinute)
				}
				authGroup.POST("/signup", handler.AuthSignup)
				authGroup.POST("/signin", handler.AuthSignin)

				// Logout is deliberately OUTSIDE the limiter. It presents no credential and reveals
				// nothing, so it is not a guessing surface — but it shares the /auth prefix, so
				// counting it burned the same per-IP budget as real sign-in attempts. Worse, the
				// failure mode is backwards: a rate-limited logout leaves the session cookie in
				// place, i.e. the limiter would keep someone signed in.
				api.POST("/auth/logout", handler.AuthLogout) // clears the session cookie (#103)

				// One-click sign-in to the shared demo account on a public demo instance (#495).
				// Refuses with 403 unless demo.enabled, so this is inert on a real install.
				//
				// Rate-limited separately and far more loosely than the credential endpoints
				// above: this is not a guessable surface (there is nothing to guess — the caller
				// supplies no input), while every visitor to a public demo behind one Cloudflare
				// tunnel can share an apparent source IP, so the 10/minute spray limit would lock
				// out real visitors rather than attackers.
				demoGroup := api.Group("/auth")
				demoGroup.Use(middleware.RateLimitMiddleware(60, time.Minute))
				demoGroup.POST("/demo-signin", handler.AuthDemoSignin)
				// The read-only demo admin entrance (#516). Same shape, same limiter, and gated on
				// demo.admin.enabled as well — so it is inert on a demo that only offers the patient
				// tour, and doubly inert on a real install.
				demoGroup.POST("/demo-signin/admin", handler.AuthDemoAdminSignin)

				api.GET("/settings", handler.GetSettings)

				//whitelisted CORS PROXY
				api.GET("/cors/:endpointId/*proxyPath", handler.CORSProxy)
				api.POST("/cors/:endpointId/*proxyPath", handler.CORSProxy)
				api.OPTIONS("/cors/:endpointId/*proxyPath", handler.CORSProxy)

				// This instance's Privacy Policy and Terms of Service (#463). Unauthenticated:
				// someone deciding whether to sign up reads the terms first, and the sign-in
				// page links to them. Served by the instance so an offline deployment still
				// shows its own policy, and so an operator can publish their own.
				api.GET("/legal/:kind", handler.GetLegalDocument)

				// Public instance identity — operator contact + theme (#453). Unauthenticated
				// because the theme must apply on first paint and operator contact is useless
				// if only admins can see it. Serves an explicit allowlist, never config state.
				api.GET("/instance/public", handler.GetPublicInstanceInfo)

				api.GET("/glossary/code", handler.GlossarySearchByCode)
				api.POST("/support/request", handler.SupportRequest)
				api.POST("/support/healthsystem", handler.HealthSystemRequest)

				// RestrictDemoAdmin applies to the WHOLE authenticated API, deliberately (#516). The
			// read-only demo admin is a public entrance to an admin session, and guarding it by
			// naming dangerous routes is exactly what produced #514 — so everything is refused for
			// that one account unless it is a read, and a route added below inherits the block
			// instead of inheriting nothing. Inert for every other user and on every non-demo
			// instance.
			// AccessLog is the patient-visible "who accessed my record" trail (#563). It sits after
			// auth so the actor is known, and only record-reading routes are recorded — see the
			// category map in the middleware.
			secure := api.Group("/secure").Use(middleware.RequireAuth(), middleware.RestrictDemoAdmin(), middleware.AccessLog())
				{
					secure.GET("/account/me", handler.GetCurrentUser)
					secure.GET("/account/access-log", handler.GetAccessLog)
					// Guarded for the shared demo account (#514). These two are the only routes a
					// visitor can use to lock EVERYONE out: changing the password leaves
					// demo.password no longer matching the stored hash, so /auth/demo-signin —
					// the only advertised way in — starts refusing every visitor; deleting the
					// account leaves nothing for it to sign in to. Neither is self-healing, both
					// need an operator, and until then the demo is a sign-in page with nothing
					// behind it.
					//
					// Contrast with wrecking the demo's RECORDS, which is deliberately allowed
					// (#496): that heals at the next reset and shows the product working.
					secure.DELETE("/account/me", middleware.BlockForDemoAccount(), handler.DeleteAccount)
					secure.POST("/account/password", middleware.BlockForDemoAccount(), handler.ChangePassword)
					// "Sign out everywhere" (#508). Guarded for the same reason as the two above: the
					// demo account is shared, so one visitor pressing it would sign out every other
					// visitor — recoverable, unlike #514, but still a stranger ending your session.
					secure.POST("/account/sign-out-everywhere", middleware.BlockForDemoAccount(), handler.SignOutEverywhere)

					secure.GET("/summary", handler.GetSummary)
					secure.GET("/summary/ips", handler.GetIPSSummary)
					// Emailing a record leaves the instance and cannot be recalled, so it is blocked
					// for the shared demo account like every other write (#496/#514) and rate limited
					// per account inside the handler (#524).
					secure.POST("/summary/ips/email", middleware.BlockForDemoAccount(), handler.SendIPSSummaryEmail)
					secure.GET("/medications/reconciled", handler.GetMedicationsReconciled)
					secure.GET("/conditions/classified", handler.GetConditionsClassified)
					secure.GET("/conditions/reconciled", handler.GetConditionsReconciled)
					secure.GET("/allergies/classified", handler.GetAllergiesClassified)
					secure.GET("/immunizations/classified", handler.GetImmunizationsClassified)
					secure.GET("/procedures/classified", handler.GetProceduresClassified)
					secure.GET("/diagnostic-reports/classified", handler.GetDiagnosticReportsClassified)
					secure.GET("/encounters/classified", handler.GetEncountersClassified)
					secure.GET("/care-plans/classified", handler.GetCarePlansClassified)
					secure.GET("/coverages/classified", handler.GetCoveragesClassified)
					secure.GET("/claims/classified", handler.GetClaimsClassified)
					secure.GET("/patient/insurance-claims", handler.GetPatientInsuranceClaims)
					secure.GET("/vitals/recognized", handler.GetVitalsRecognized)
					secure.GET("/documents/classified", handler.GetDocumentsClassified)
					secure.GET("/resources/recent", handler.GetRecentResources)
					secure.GET("/resources/search", handler.SearchResources)

					// The routes below that bring OUTSIDE data into an account carry the demo guard
					// (#496): on a public demo every visitor is the same shared account, so a
					// visitor connecting their own real provider would put a stranger's records in
					// front of the next visitor. Inert unless demo.enabled — see BlockForDemoAccount.
					//
					// Reading, browsing, and even deleting are deliberately NOT guarded: a visitor
					// wrecking the demo's own synthetic data is self-healing at the next reset, and
					// blocking it would hide how the product actually behaves.
					secure.POST("/source", middleware.BlockForDemoAccount(), handler.CreateReconnectSource)
					// Effective OAuth relay callback URL for this deployment — the value operators
					// must register with their FHIR vendor (#399). Non-secret; no secret returned.
					secure.GET("/source/relay-config", handler.GetRelayConfig)
					secure.POST("/source/authorize", middleware.BlockForDemoAccount(), handler.AuthorizeSource)
					secure.POST("/source/connect", middleware.BlockForDemoAccount(), handler.ConnectSource)
					// Manual upload is guarded too: it is the other way a visitor's own real export
					// reaches the shared account. Seeding the demo is done from the operator's admin
					// account, which this guard does not touch.
					secure.POST("/source/manual", middleware.BlockForDemoAccount(), handler.CreateManualSource)
					// Whether C-CDA/XML upload can actually be converted here, so the UI doesn't
					// offer a Convert button that is guaranteed to fail (#397).
					secure.GET("/source/cda-converter/status", handler.GetCDAConverterStatus)

					// Provider catalog (#304): admin curates entries; patients connect by picking one.
					secure.POST("/provider-catalog", handler.CreateProviderCatalogEntry)
					secure.GET("/provider-catalog", handler.ListProviderCatalogEntries)
					secure.GET("/provider-catalog/connectable", handler.ListConnectableProviders)
					secure.GET("/provider-catalog/sandbox", handler.ListSandboxProviders)
					secure.GET("/provider-catalog/:id", handler.GetProviderCatalogEntry)
					secure.PUT("/provider-catalog/:id", handler.UpdateProviderCatalogEntry)
					secure.DELETE("/provider-catalog/:id", handler.DeleteProviderCatalogEntry)
					secure.POST("/provider-catalog/:id/authorize", middleware.BlockForDemoAccount(), handler.AuthorizeSourceFromCatalog)
					secure.POST("/provider-catalog/:id/connect", middleware.BlockForDemoAccount(), handler.ConnectSourceFromCatalog)

					secure.GET("/source", handler.ListSource)
					secure.GET("/source/:sourceId", handler.GetSource)
					// #437: granular disconnect vs remove-data; DELETE remains full teardown.
					secure.POST("/source/:sourceId/disconnect", handler.DisconnectSource)
					secure.POST("/source/:sourceId/remove-data", handler.RemoveSourceData)
					secure.DELETE("/source/:sourceId", handler.DeleteSource)
					secure.POST("/source/:sourceId/sync", handler.SourceSync)
					secure.GET("/source/:sourceId/summary", handler.GetSourceSummary)
					secure.GET("/source/:sourceId/export", handler.ExportSourceFHIRBundle)
					secure.GET("/resource/fhir", handler.ListResourceFhir)
					secure.POST("/resource/graph/:graphType", handler.GetResourceFhirGraph)
					secure.GET("/resource/fhir/:sourceId/:resourceId", handler.GetResourceFhir)
					secure.PATCH("/resource/fhir/:resourceType/:resourceId", handler.UpdateResourceFhir)
					secure.DELETE("/resource/fhir/:resourceType/:resourceId", handler.DeleteResourceFhir)

					secure.POST("/resource/composition", handler.CreateResourceComposition)
					secure.POST("/resource/related", handler.CreateRelatedResources)
					// Patient-generated data (#313) — first slice: home vitals on the fasten source.
					secure.POST("/resource/patient-entry", handler.CreatePatientEntry)
					secure.DELETE("/encounter/:encounterId/related/:resourceType/:resourceId", handler.EncounterUnlinkResource)
					secure.GET("/resource/search", handler.SearchResourcesHandler)
					secure.GET("/resource/search/:id", handler.GetResourceByIDHandler)
					secure.GET("/resource/summary", handler.GetResourceSummaryHandler)

					secure.GET("/dashboards", handler.GetDashboard)
					secure.POST("/dashboards", handler.AddDashboardLocation)
					//secure.GET("/dashboard/:dashboardId", handler.GetDashboard)

					secure.GET("/jobs", handler.ListBackgroundJobs)
					secure.POST("/jobs/error", handler.CreateBackgroundJobError)

					secure.POST("/query", handler.QueryResourceFhir)

					secure.GET("/users", handler.GetUsers)
					secure.POST("/users", handler.CreateUser)
					// An admin sets another user's password (#511) — the family case: somebody forgot
					// theirs. Admin-gated inside the handler, like every other /users route. Guarded
					// for the demo account as well: the demo admin is read-only (#516), and on a
					// shared instance one visitor resetting another account's password is the #514
					// lockout in a different costume.
					secure.POST("/users/:id/password", middleware.BlockForDemoAccount(), handler.AdminResetUserPassword)

					//admin dashboard (#170) — handlers self-gate on the admin role
					secure.GET("/admin/logs", handler.GetServerLogs)
					secure.PUT("/admin/log-level", handler.SetLogLevel)
					//admin Database card (#361) — DB facts + safe online backup (full PHI; admin-only)
					secure.GET("/admin/database", handler.GetDatabaseInfo)
					secure.POST("/admin/database/backup", handler.BackupDatabase)                  // server-side, fire-and-forget
					secure.POST("/admin/database/backup/download", handler.BackupDatabaseDownload) // stream to browser (on-demand)
					secure.POST("/admin/database/schedule", handler.SetBackupSchedule)             // settable auto-backup schedule
					secure.POST("/admin/database/backup/test", handler.TestBackupDestination)      // prove a destination before a schedule uses it (#468)
					secure.GET("/admin/database/browse", handler.BrowseDirectories)                // server-folder browser (pick destination)
					secure.POST("/admin/database/restore", handler.RestoreDatabase)                // stage a restore (applied on restart) — #362
					//admin Instance card — operator contact for this deployment (no hardcoding)
					// Instance identity for a signed-in user: everything public, plus the
					// operator contact block. contact_email is withheld from anonymous callers
					// (#459) but a patient with an account is entitled to reach whoever holds
					// their records.
					secure.GET("/instance", handler.GetInstanceInfoForUser)
					// Admin Configuration screen (#458) — the whole merged config, what this
					// instance overrode, and per-key reveal. Values outside the `public` array
					// are masked in the list and never sent until explicitly revealed.
					secure.GET("/admin/config", handler.GetAdminConfig)
					secure.GET("/admin/config/reveal/:key", handler.RevealAdminConfigValue)
					secure.PUT("/admin/config", handler.SetAdminConfigValue)
					secure.DELETE("/admin/config/:key", handler.ResetAdminConfigValue)
					secure.GET("/admin/instance", handler.GetInstanceSettings)
					secure.PUT("/admin/instance", handler.SetInstanceSettings)
					//admin Metrics card (#441) — scrape config + process counters + recent sync summaries
					secure.GET("/admin/metrics", handler.GetAdminMetrics)

					secure.POST("/practitioners", handler.CreatePractitioner)
					secure.PUT("/practitioners/:practitionerId", handler.UpdatePractitioner)
					secure.GET("/practitioners/:practitionerId/history", handler.GetPractitionerEncounterHistory)

					// Address book favorite actions
					secure.POST("/user/favorites", handler.AddPractitionerToFavorites)
					secure.DELETE("/user/favorites", handler.RemovePractitionerFromFavorites)
					secure.GET("/user/favorites", handler.GetUserFavoritePractitioners)

					// Per-user Privacy Policy + Terms opt-in (#427) — Account Profile grant/revoke
					secure.GET("/account/legal-consent", handler.GetLegalConsent)
					secure.POST("/account/legal-consent/grant", handler.GrantLegalConsent)
					secure.POST("/account/legal-consent/revoke", handler.RevokeLegalConsent)

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

	// Redaction of config.Secret values in logs and JSON. On by default; the zero value of the
	// underlying flag redacts, so a missed call here fails safe.
	redactSecrets := ae.Config.GetBool("log.redact_secrets")
	config.SetSecretRedaction(redactSecrets)
	if !redactSecrets {
		// Loud, every start, and named so it is obvious what to set back. A debugging aid left on
		// writes signing keys and provider tokens into the log file indefinitely.
		ae.Logger.Warnf("SECRET REDACTION IS OFF (log.redact_secrets=false) — signing keys, relay secrets and provider tokens will appear in logs and API responses. Set it back to true when finished debugging.")
	}

	// Relocate db/ and cache/ under storage.data_dir when one is configured and those paths
	// are still at their built-in defaults (#451). Must run before initializeDatabase opens
	// the DB and before anything else resolves a path — every config layer has been merged
	// by this point (defaults, env, config file, CLI flags).
	config.ResolveStoragePaths(ae.Config)

	// Overlay the instance-custom config store (#452), then fold in any pre-#452
	// .operator_settings.json. Both run before the DB opens so every later read — including
	// database.* keys an operator customized — sees the merged view.
	if err := config.LoadCustomConfig(ae.Config); err != nil {
		return err
	}
	if err := database.MigrateLegacyOperatorSettings(ae.Config); err != nil {
		// A failed migration must not take the instance down: the values are contact details,
		// and the legacy file is left in place for a retry on the next start.
		ae.Logger.Warnf("could not migrate legacy operator settings: %v", err)
	}

	// Name configuration that will silently do nothing. WARN, never refuse: refusing on an
	// unknown key would turn a removed setting into a boot loop on upgrade.
	if report, err := config.FindUnknownKeys(ae.Config); err != nil {
		ae.Logger.Warnf("could not check for unknown configuration keys: %v", err)
	} else {
		for _, message := range report.Messages(config.CustomConfigPath(ae.Config)) {
			ae.Logger.Warn(message)
		}
	}

	// Name anything this instance publishes beyond the shipped set (#457). Widening the `public`
	// array is allowed by design, so this is a warning rather than a refusal — which makes it the
	// only signal an operator gets that a key is now readable without a login.
	if promoted, err := config.PublicKeysPromotedBeyondDefault(ae.Config); err != nil {
		ae.Logger.Warnf("could not check the public config keys: %v", err)
	} else {
		for _, key := range promoted {
			ae.Logger.Warnf(
				"config: %q is served to callers with NO login via the %q override in %s — "+
					"remove it there if that was not intended",
				key, config.PublicKeysConfigKey, config.CustomConfigPath(ae.Config))
		}
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
		config.DataDir(ae.Config),
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

		// Provision the admin account BEFORE the listener accepts anything (#504). The whole point
		// is to close the window in which an anonymous visitor could claim the first-run wizard, so
		// doing this after startServer would leave that window open — narrower, but open.
		//
		// A failure here is fatal on purpose: the alternative is an instance that starts up
		// reachable and unowned, which is the exact state this exists to prevent. No-op unless
		// bootstrap.admin.enabled, so a stock install cannot fail here.
		if err := ae.ProvisionBootstrapAdmin(); err != nil {
			ae.Logger.Panicf("could not provision the bootstrap admin: %v", err)
		}

		// Give the demo account a password this process generated and nobody knows (#515). No-op
		// unless demo.enabled, and a no-op on every restart after the first because the stored
		// password already verifies. It runs here rather than earlier because a freshly restored
		// seed (#505) carries the throwaway hash the seed builder used, and this is what replaces
		// it — so the demo works with no operator step and a reset stays "delete the file, restart".
		//
		// Warn rather than panic: a demo with no way in deserves a loud line, not a refusal to
		// start. Turning demo mode on later from Admin -> Configuration provisions there instead.
		if err := demo.ProvisionCredential(context.Background(), ae.Config, ae.deviceRepo, ae.Logger); err != nil {
			ae.Logger.Warnf("could not provision the demo credential: %v", err)
		}

		// The read-only demo admin (#516), after the operator's own admin so the check above sees a
		// real one rather than this. No-op unless demo.enabled AND demo.admin.enabled.
		if err := demo.ProvisionAdmin(context.Background(), ae.Config, ae.deviceRepo, ae.Logger); err != nil {
			ae.Logger.Warnf("could not provision the demo admin: %v", err)
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
	ae.startMetricsServer()

	// Scheduled SMART OAuth token-refresh worker (#51). Skipped in StandbyMode (no DB-backed
	// sources to refresh there).
	if !ae.StandbyMode {
		go ae.startTokenRefreshWorker()
		go ae.startBackupWorker() // scheduled DB backups (#361); opt-in via backup.interval_hours
	}

	// Block indefinitely to keep the server running until process termination
	select {}
}

// startMetricsServer optionally binds an internal Prometheus scrape listener (#441).
// Off unless metrics.enabled is true. Never put this port on a public Ingress.
func (ae *AppEngine) startMetricsServer() {
	if !ae.Config.GetBool("metrics.enabled") {
		return
	}
	addr := ae.Config.GetString("metrics.addr")
	if addr == "" {
		port := ae.Config.GetInt("metrics.port")
		if port <= 0 {
			port = 9091
		}
		addr = fmt.Sprintf(":%d", port)
	}
	srv, err := metrics.StartServer(addr, metrics.Global)
	if err != nil {
		ae.Logger.Errorf("metrics server failed to start on %s: %v (continuing without metrics)", addr, err)
		return
	}
	ae.Logger.Infof("metrics scrape listener on %s (GET /metrics) — cluster-internal only (#441)", srv.Addr)
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

	// Install the bundled demo seed if this instance has no database yet (#505). Before the staged
	// restore, so an operator's explicit restore still wins over the seed, and before the DB is
	// opened for the same reason as below. No-op unless bootstrap.seed.restore is set.
	if err := ae.RestoreSeedDatabaseIfMissing(); err != nil {
		return err
	}

	// Apply a staged restore (#362) BEFORE opening the DB — never swap a live, open file. Backs the
	// current DB aside first; if it fails we abort startup rather than open a half-restored DB.
	if applied, rErr := database.ApplyPendingRestore(ae.Config); rErr != nil {
		return fmt.Errorf("failed to apply staged database restore: %w", rErr)
	} else if applied {
		ae.Logger.Warn("Applied a staged database restore (previous DB saved as <db>.pre-restore).")
	}

	dbRepo, err := database.NewRepository(ae.Config, ae.Logger, ae.EventBus)
	if err != nil {
		return fmt.Errorf("failed to initialize database repository: %w", err)
	}
	ae.deviceRepo = dbRepo

	// Seed/refresh the admin-only sandbox providers from env (a k8s Secret), so the /sandbox buttons
	// connect with zero typing and the client_secret never reaches the browser (#291). Sandboxes with
	// no client_id configured in this deployment are skipped.
	database.SeedSandboxProviders(context.Background(), dbRepo, ae.Logger, os.Getenv)
	database.SeedProductionMedicareProvider(context.Background(), dbRepo, ae.Logger, os.Getenv)

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
