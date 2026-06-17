package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/applog"
	mock_config "github.com/fastenhealth/fasten-onprem/backend/pkg/config/mock"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/event_bus"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/gin-gonic/gin"
	"github.com/golang/mock/gomock"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"
)

type AdminHandlerTestSuite struct {
	suite.Suite
	MockCtrl      *gomock.Controller
	TestDatabase  *os.File
	AppConfig     *mock_config.MockInterface
	AppRepository database.DatabaseRepository
}

func (suite *AdminHandlerTestSuite) SetupSuite() {
	suite.MockCtrl = gomock.NewController(suite.T())
	dbFile, err := os.CreateTemp("", "admin.*.db")
	require.NoError(suite.T(), err)
	suite.TestDatabase = dbFile

	cfg := mock_config.NewMockInterface(suite.MockCtrl)
	cfg.EXPECT().GetString("database.location").Return(suite.TestDatabase.Name()).AnyTimes()
	cfg.EXPECT().GetString("database.type").Return("sqlite").AnyTimes()
	cfg.EXPECT().IsSet("database.encryption.key").Return(false).AnyTimes()
	cfg.EXPECT().GetString("log.level").Return("INFO").AnyTimes()
	cfg.EXPECT().GetBool("database.validation_mode").Return(false).AnyTimes()
	cfg.EXPECT().GetBool("database.encryption.enabled").Return(false).AnyTimes()
	suite.AppConfig = cfg

	repo, err := database.NewRepository(cfg, logrus.WithField("test", suite.T().Name()), event_bus.NewNoopEventBusServer())
	require.NoError(suite.T(), err)
	suite.AppRepository = repo
	require.NoError(suite.T(), repo.CreateUser(context.Background(), &models.User{Username: "admin_user", Password: "p", Role: pkg.UserRoleAdmin}))
	require.NoError(suite.T(), repo.CreateUser(context.Background(), &models.User{Username: "reg_user", Password: "p", Role: pkg.UserRoleUser}))
}

func (suite *AdminHandlerTestSuite) TearDownSuite() {
	suite.MockCtrl.Finish()
	os.Remove(suite.TestDatabase.Name())
}

func (suite *AdminHandlerTestSuite) ctxFor(username string, w *httptest.ResponseRecorder, req *http.Request) *gin.Context {
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set(pkg.ContextKeyTypeLogger, logrus.WithField("test", suite.T().Name()))
	ctx.Set(pkg.ContextKeyTypeDatabase, suite.AppRepository)
	ctx.Set(pkg.ContextKeyTypeConfig, suite.AppConfig)
	ctx.Set(pkg.ContextKeyTypeAuthUsername, username)
	ctx.Request = req
	return ctx
}

func (suite *AdminHandlerTestSuite) TestGetServerLogs_NonAdminForbidden() {
	w := httptest.NewRecorder()
	GetServerLogs(suite.ctxFor("reg_user", w, httptest.NewRequest("GET", "/admin/logs", nil)))
	require.Equal(suite.T(), http.StatusForbidden, w.Code)
}

func (suite *AdminHandlerTestSuite) TestGetServerLogs_AdminReadsRingBuffer() {
	// Install the in-memory buffer on a fresh logger and emit some lines.
	l := logrus.New()
	l.SetLevel(logrus.InfoLevel)
	applog.Install(l, 100)
	l.Info("alpha entry")
	l.Warn("bravo entry")

	w := httptest.NewRecorder()
	GetServerLogs(suite.ctxFor("admin_user", w, httptest.NewRequest("GET", "/admin/logs", nil)))
	require.Equal(suite.T(), http.StatusOK, w.Code)

	var resp struct {
		Success bool               `json:"success"`
		Data    ServerLogsResponse `json:"data"`
	}
	require.NoError(suite.T(), json.Unmarshal(w.Body.Bytes(), &resp))
	require.True(suite.T(), resp.Success)
	require.Equal(suite.T(), "info", resp.Data.Level)
	require.NotEmpty(suite.T(), resp.Data.ValidLevels)
	require.Contains(suite.T(), resp.Data.Lines, findLine(resp.Data.Lines, "alpha entry"))
	require.Contains(suite.T(), joinLines(resp.Data.Lines), "bravo entry")
}

func (suite *AdminHandlerTestSuite) TestSetLogLevel_AdminChangesLevel() {
	l := logrus.New()
	l.SetLevel(logrus.InfoLevel)
	applog.Install(l, 100)

	w := httptest.NewRecorder()
	req := httptest.NewRequest("PUT", "/admin/log-level", bytes.NewBufferString(`{"level":"debug"}`))
	req.Header.Set("Content-Type", "application/json")
	SetLogLevel(suite.ctxFor("admin_user", w, req))

	require.Equal(suite.T(), http.StatusOK, w.Code)
	require.Equal(suite.T(), "debug", applog.Level())
}

func (suite *AdminHandlerTestSuite) TestSetLogLevel_RejectsInvalidAndNonAdmin() {
	l := logrus.New()
	applog.Install(l, 100)

	// non-admin forbidden
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PUT", "/admin/log-level", bytes.NewBufferString(`{"level":"debug"}`))
	req.Header.Set("Content-Type", "application/json")
	SetLogLevel(suite.ctxFor("reg_user", w, req))
	require.Equal(suite.T(), http.StatusForbidden, w.Code)

	// admin + bad level -> 400
	w = httptest.NewRecorder()
	req = httptest.NewRequest("PUT", "/admin/log-level", bytes.NewBufferString(`{"level":"nonsense"}`))
	req.Header.Set("Content-Type", "application/json")
	SetLogLevel(suite.ctxFor("admin_user", w, req))
	require.Equal(suite.T(), http.StatusBadRequest, w.Code)
}

func joinLines(lines []string) string {
	out := ""
	for _, l := range lines {
		out += l + "\n"
	}
	return out
}

func findLine(lines []string, substr string) string {
	for _, l := range lines {
		if bytes.Contains([]byte(l), []byte(substr)) {
			return l
		}
	}
	return ""
}

func TestAdminHandlerTestSuite(t *testing.T) {
	suite.Run(t, new(AdminHandlerTestSuite))
}
