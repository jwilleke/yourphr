package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	mock_config "github.com/fastenhealth/fasten-onprem/backend/pkg/config/mock"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/event_bus"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-sources/clients/smart"
	"github.com/gin-gonic/gin"
	"github.com/golang/mock/gomock"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"
	"io"
	"io/ioutil"
	"log"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Go through this page to understand how this file is structured.
// https://pkg.go.dev/github.com/stretchr/testify/suite#section-documentation

// Define the suite, and absorb the built-in basic suite
// functionality from testify - including a T() method which
// returns the current testing context
type SourceHandlerTestSuite struct {
	suite.Suite
	MockCtrl     *gomock.Controller
	TestDatabase *os.File

	AppConfig     *mock_config.MockInterface
	AppRepository database.DatabaseRepository
	AppEventBus   event_bus.Interface
}

// BeforeTest has a function to be executed right before the test starts and receives the suite and test names as input
func (suite *SourceHandlerTestSuite) BeforeTest(suiteName, testName string) {
	suite.MockCtrl = gomock.NewController(suite.T())

	dbFile, err := ioutil.TempFile("", fmt.Sprintf("%s.*.db", testName))
	if err != nil {
		log.Fatal(err)
	}
	suite.TestDatabase = dbFile

	appConfig := mock_config.NewMockInterface(suite.MockCtrl)
	appConfig.EXPECT().GetString("database.location").Return(suite.TestDatabase.Name()).AnyTimes()
	appConfig.EXPECT().GetString("database.type").Return("sqlite").AnyTimes()
	appConfig.EXPECT().IsSet("database.encryption.key").Return(false).AnyTimes()
	appConfig.EXPECT().GetString("log.level").Return("INFO").AnyTimes()
	appConfig.EXPECT().GetBool("database.validation_mode").Return(false).AnyTimes()
	appConfig.EXPECT().GetBool("database.encryption.enabled").Return(false).AnyTimes()
	suite.AppConfig = appConfig

	appRepo, err := database.NewRepository(suite.AppConfig, logrus.WithField("test", suite.T().Name()), event_bus.NewNoopEventBusServer())
	suite.AppRepository = appRepo

	suite.AppEventBus = event_bus.NewNoopEventBusServer()

	appRepo.CreateUser(context.Background(), &models.User{
		Username: "test_username",
		Password: "test",
	})

}

// AfterTest has a function to be executed right after the test finishes and receives the suite and test names as input
func (suite *SourceHandlerTestSuite) AfterTest(suiteName, testName string) {
	suite.MockCtrl.Finish()
	os.Remove(suite.TestDatabase.Name())
}

func CreateManualSourceHttpRequestFromFile(fileName string) (*http.Request, error) {

	file, err := os.Open(fileName)
	if err != nil {
		log.Fatal("Could not open file ", err.Error())
		return nil, err
	}
	defer file.Close()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreateFormFile("file", filepath.Base(file.Name()))
	io.Copy(part, file)
	writer.Close()

	req, err := http.NewRequest("POST", "/source/manual", body)
	if err != nil {
		log.Fatal("Could not make http request ", err.Error())
		return nil, err
	}
	req.Header.Add("Content-Type", writer.FormDataContentType())

	return req, nil
}

// In order for 'go test' to run this suite, we need to create
// a normal test function and pass our suite to suite.Run
func TestSourceHandlerTestSuite(t *testing.T) {
	suite.Run(t, new(SourceHandlerTestSuite))
}

// TestAuthorizeSource exercises the SMART authorize-initiation endpoint against a stub provider:
// it should discover the endpoints and return a PKCE authorization URL plus the state/verifier.
func TestAuthorizeSource(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// The stub provider runs on loopback, which the real SSRF guard rejects; bypass it here so
	// the happy path exercises discovery + authorize-URL construction. (The guard itself is
	// covered by backend/pkg/ssrf tests.)
	orig := validatePublicHTTPSURL
	validatePublicHTTPSURL = func(string) error { return nil }
	smart.AllowInternalHostsForTest = true
	defer func() { smart.AllowInternalHostsForTest = false }()
	defer func() { validatePublicHTTPSURL = orig }()

	// Stub provider: serve .well-known/smart-configuration with authorize/token endpoints.
	var provider *httptest.Server
	provider = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/.well-known/smart-configuration" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(fmt.Sprintf(
				`{"authorization_endpoint":%q,"token_endpoint":%q}`,
				provider.URL+"/authorize", provider.URL+"/token")))
			return
		}
		http.NotFound(w, r)
	}))
	defer provider.Close()

	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set(pkg.ContextKeyTypeLogger, logrus.WithField("test", t.Name()))
	ctrl := gomock.NewController(t)
	appConfig := mock_config.NewMockInterface(ctrl)
	appConfig.EXPECT().GetInt("web.smart_connect.login_wait_seconds").Return(240).AnyTimes()
	ctx.Set(pkg.ContextKeyTypeConfig, appConfig)

	body, _ := json.Marshal(SmartAuthorizeRequest{
		ApiEndpointBaseUrl: provider.URL,
		ClientId:           "my-client-id",
		Scopes:             "launch/patient patient/*.read openid fhirUser offline_access",
		RedirectUri:        "https://relay.nerdsbythehour.com/callback",
	})
	req, _ := http.NewRequest("POST", "/source/authorize", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ctx.Request = req

	AuthorizeSource(ctx)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var resp struct {
		Success          bool   `json:"success"`
		AuthorizeURL     string `json:"authorize_url"`
		State            string `json:"state"`
		CodeVerifier     string `json:"code_verifier"`
		LoginWaitSeconds int    `json:"login_wait_seconds"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.True(t, resp.Success)
	require.NotEmpty(t, resp.State)
	require.NotEmpty(t, resp.CodeVerifier)
	require.Equal(t, 240, resp.LoginWaitSeconds)

	authURL, err := url.Parse(resp.AuthorizeURL)
	require.NoError(t, err)
	require.Equal(t, provider.URL+"/authorize", authURL.Scheme+"://"+authURL.Host+authURL.Path)
	q := authURL.Query()
	require.Equal(t, "my-client-id", q.Get("client_id"))
	require.Equal(t, "code", q.Get("response_type"))
	require.Equal(t, "https://relay.nerdsbythehour.com/callback", q.Get("redirect_uri"))
	require.Equal(t, resp.State, q.Get("state"))
	require.Equal(t, "S256", q.Get("code_challenge_method"))
	require.NotEmpty(t, q.Get("code_challenge"))
	require.Equal(t, provider.URL, q.Get("aud"))
}

// TestAuthorizeSourceRejectsSSRF confirms the handler wires the SSRF guard: a non-public
// (loopback) api_endpoint_base_url is rejected with 400 before any server-side request.
func TestAuthorizeSourceRejectsSSRF(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set(pkg.ContextKeyTypeLogger, logrus.WithField("test", t.Name()))
	ctx.Set(pkg.ContextKeyTypeConfig, mock_config.NewMockInterface(gomock.NewController(t)))

	body, _ := json.Marshal(SmartAuthorizeRequest{
		ApiEndpointBaseUrl: "https://127.0.0.1/fhir",
		ClientId:           "c",
		Scopes:             "patient/*.read",
		RedirectUri:        "https://relay.nerdsbythehour.com/callback",
	})
	req, _ := http.NewRequest("POST", "/source/authorize", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ctx.Request = req

	AuthorizeSource(ctx)

	require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), "invalid api_endpoint_base_url")
}

func (suite *SourceHandlerTestSuite) TestCreateManualSourceHandler() {
	//setup
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set(pkg.ContextKeyTypeLogger, logrus.WithField("test", suite.T().Name()))
	ctx.Set(pkg.ContextKeyTypeDatabase, suite.AppRepository)
	ctx.Set(pkg.ContextKeyTypeConfig, suite.AppConfig)
	ctx.Set(pkg.ContextKeyTypeEventBusServer, suite.AppEventBus)
	ctx.Set(pkg.ContextKeyTypeAuthUsername, "test_username")

	//test
	req, err := CreateManualSourceHttpRequestFromFile("testdata/Tania553_Harris789_545c2380-b77f-4919-ab5d-0f615f877250.json")
	require.NoError(suite.T(), err)
	ctx.Request = req

	CreateManualSource(ctx)

	//assert
	require.Equal(suite.T(), http.StatusOK, w.Code)

	type ResponseWrapper struct {
		Data struct {
			UpdatedResources []string `json:"UpdatedResources"`
			TotalResources   int      `json:"TotalResources"`
		} `json:"data"`
		Success bool                    `json:"success"`
		Source  models.SourceCredential `json:"source"`
	}
	var respWrapper ResponseWrapper
	err = json.Unmarshal(w.Body.Bytes(), &respWrapper)
	require.NoError(suite.T(), err)

	require.Equal(suite.T(), true, respWrapper.Success)
	require.Equal(suite.T(), "manual", string(respWrapper.Source.PlatformType))
	require.Equal(suite.T(), 196, respWrapper.Data.TotalResources)
	summary, err := suite.AppRepository.GetSourceSummary(ctx, respWrapper.Source.ID.String())
	require.NoError(suite.T(), err)
	require.Equal(suite.T(), map[string]interface{}{
		"count":         int64(5),
		"resource_type": "Condition",
		"source_id":     respWrapper.Source.ID.String(),
	}, summary.ResourceTypeCounts[3])

}

// A client disconnecting mid-upload (closing the tab, navigating away, a proxy read-timeout)
// cancels the request context. The import must NOT be abortable by that — it runs under a context
// detached from the request — otherwise a half-finished import leaves partial data. Here the request
// context is already cancelled before the handler runs; the import must still complete in full.
func (suite *SourceHandlerTestSuite) TestCreateManualSourceHandler_SurvivesClientDisconnect() {
	//setup
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set(pkg.ContextKeyTypeLogger, logrus.WithField("test", suite.T().Name()))
	ctx.Set(pkg.ContextKeyTypeDatabase, suite.AppRepository)
	ctx.Set(pkg.ContextKeyTypeConfig, suite.AppConfig)
	ctx.Set(pkg.ContextKeyTypeEventBusServer, suite.AppEventBus)
	ctx.Set(pkg.ContextKeyTypeAuthUsername, "test_username")

	req, err := CreateManualSourceHttpRequestFromFile("testdata/Tania553_Harris789_545c2380-b77f-4919-ab5d-0f615f877250.json")
	require.NoError(suite.T(), err)

	// simulate the client already gone: a cancelled request context
	cancelledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	ctx.Request = req.WithContext(cancelledCtx)

	//test
	CreateManualSource(ctx)

	//assert: the import completed in full despite the cancelled request context
	require.Equal(suite.T(), http.StatusOK, w.Code)

	type ResponseWrapper struct {
		Data struct {
			TotalResources int `json:"TotalResources"`
		} `json:"data"`
		Success bool                    `json:"success"`
		Source  models.SourceCredential `json:"source"`
	}
	var respWrapper ResponseWrapper
	err = json.Unmarshal(w.Body.Bytes(), &respWrapper)
	require.NoError(suite.T(), err)
	require.True(suite.T(), respWrapper.Success)
	require.Equal(suite.T(), 196, respWrapper.Data.TotalResources, "the full bundle must import even though the request context was cancelled")
}

// bug: https://github.com/fastenhealth/fasten-onprem/pull/486
func (suite *SourceHandlerTestSuite) TestCreateManualSourceHandler_ShouldExtractPatientIdFromConvertedCCDA() {
	//setup
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set(pkg.ContextKeyTypeLogger, logrus.WithField("test", suite.T().Name()))
	ctx.Set(pkg.ContextKeyTypeDatabase, suite.AppRepository)
	ctx.Set(pkg.ContextKeyTypeConfig, suite.AppConfig)
	ctx.Set(pkg.ContextKeyTypeEventBusServer, suite.AppEventBus)
	ctx.Set(pkg.ContextKeyTypeAuthUsername, "test_username")

	//test
	req, err := CreateManualSourceHttpRequestFromFile("testdata/ccda_to_fhir_converted_C-CDA_R2-1_CCD.xml.json")
	require.NoError(suite.T(), err)
	ctx.Request = req

	CreateManualSource(ctx)

	//assert
	require.Equal(suite.T(), http.StatusOK, w.Code)

	type ResponseWrapper struct {
		Data struct {
			UpdatedResources []string `json:"UpdatedResources"`
			TotalResources   int      `json:"TotalResources"`
		} `json:"data"`
		Success bool                    `json:"success"`
		Source  models.SourceCredential `json:"source"`
	}
	var respWrapper ResponseWrapper
	err = json.Unmarshal(w.Body.Bytes(), &respWrapper)
	require.NoError(suite.T(), err)

	require.Equal(suite.T(), true, respWrapper.Success)
	require.Equal(suite.T(), "manual", string(respWrapper.Source.PlatformType))
	require.Equal(suite.T(), 65, respWrapper.Data.TotalResources)
	summary, err := suite.AppRepository.GetSourceSummary(ctx, respWrapper.Source.ID.String())
	require.NoError(suite.T(), err)
	require.Equal(suite.T(), map[string]interface{}{
		"count":         int64(1),
		"resource_type": "Consent",
		"source_id":     respWrapper.Source.ID.String(),
	}, summary.ResourceTypeCounts[3])

}

// TestConnectSourceHandler is a full backend integration test of the SMART connect → sync
// pipeline against a fake SMART on FHIR provider — no network, no relay, no browser, no human.
// It drives handler.ConnectSource with a direct authorization code and asserts: token exchange,
// SourceCredential stored (platform=ehr, patient set), and Patient/$everything resources synced
// into the DB. (yourphr#82, layer 1)
func (suite *SourceHandlerTestSuite) TestConnectSourceHandler() {
	// The fake provider runs on loopback, which the real SSRF guard rejects; bypass it here.
	origValidate := validatePublicHTTPSURL
	validatePublicHTTPSURL = func(string) error { return nil }
	smart.AllowInternalHostsForTest = true
	defer func() { smart.AllowInternalHostsForTest = false }()
	defer func() { validatePublicHTTPSURL = origValidate }()

	const patientID = "test-patient-1"

	// Fake SMART provider: .well-known discovery, token exchange, and Patient/$everything.
	var provider *httptest.Server
	provider = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/.well-known/smart-configuration":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"authorization_endpoint":%q,"token_endpoint":%q,"code_challenge_methods_supported":["S256"]}`,
				provider.URL+"/authorize", provider.URL+"/token")
		case r.URL.Path == "/token":
			// Access token valid for an hour so the sync's ensureValidToken skips refresh.
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"access_token":"fake-access","token_type":"Bearer","expires_in":3600,"refresh_token":"fake-refresh","patient":%q}`, patientID)
		case strings.HasSuffix(r.URL.Path, "everything"):
			if got := r.Header.Get("Authorization"); got != "Bearer fake-access" {
				suite.T().Errorf("$everything Authorization = %q, want \"Bearer fake-access\"", got)
			}
			w.Header().Set("Content-Type", "application/fhir+json")
			fmt.Fprintf(w, `{"resourceType":"Bundle","type":"searchset","entry":[
				{"resource":{"resourceType":"Patient","id":%q,"name":[{"family":"Tester","given":["Pat"]}]}},
				{"resource":{"resourceType":"Condition","id":"cond-1","subject":{"reference":"Patient/%s"},"code":{"text":"Test condition"}}},
				{"resource":{"resourceType":"Observation","id":"obs-1","status":"final","subject":{"reference":"Patient/%s"},"code":{"text":"Test obs"}}}
			]}`, patientID, patientID, patientID)
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()

	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set(pkg.ContextKeyTypeLogger, logrus.WithField("test", suite.T().Name()))
	ctx.Set(pkg.ContextKeyTypeDatabase, suite.AppRepository)
	ctx.Set(pkg.ContextKeyTypeConfig, suite.AppConfig)
	ctx.Set(pkg.ContextKeyTypeEventBusServer, suite.AppEventBus)
	ctx.Set(pkg.ContextKeyTypeAuthUsername, "test_username")

	body, _ := json.Marshal(SmartConnectRequest{
		ApiEndpointBaseUrl: provider.URL,
		ClientId:           "test-client",
		Scopes:             "launch/patient patient/*.read openid fhirUser offline_access",
		RedirectUri:        "https://relay.nerdsbythehour.com/callback",
		Code:               "test-auth-code",
		CodeVerifier:       "test-verifier-0123456789012345678901234567890123",
	})
	req, _ := http.NewRequest("POST", "/source/connect", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ctx.Request = req

	ConnectSource(ctx)

	require.Equal(suite.T(), http.StatusOK, w.Code, w.Body.String())

	var resp struct {
		Success bool                    `json:"success"`
		Source  models.SourceCredential `json:"source"`
	}
	require.NoError(suite.T(), json.Unmarshal(w.Body.Bytes(), &resp))
	require.True(suite.T(), resp.Success)
	require.Equal(suite.T(), "ehr", string(resp.Source.PlatformType))
	require.Equal(suite.T(), patientID, resp.Source.Patient)

	// The initial sync now runs in the background (connect returns immediately), so wait for the
	// resources to be extracted + persisted (not just upserted raw).
	require.Eventually(suite.T(), func() bool {
		summary, err := suite.AppRepository.GetSourceSummary(ctx, resp.Source.ID.String())
		if err != nil {
			return false
		}
		stored := 0
		for _, rc := range summary.ResourceTypeCounts {
			if cnt, ok := rc["count"].(int64); ok {
				stored += int(cnt)
			}
		}
		return stored == 3
	}, 10*time.Second, 25*time.Millisecond, "expected 3 stored resources across types")
}
