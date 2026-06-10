package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
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
	LogFile       *os.File
	AppConfig     *mock_config.MockInterface
	AppRepository database.DatabaseRepository
}

func (suite *AdminHandlerTestSuite) SetupSuite() {
	suite.MockCtrl = gomock.NewController(suite.T())
	dbFile, err := os.CreateTemp("", "admin.*.db")
	require.NoError(suite.T(), err)
	suite.TestDatabase = dbFile
	logFile, err := os.CreateTemp("", "admin.*.log")
	require.NoError(suite.T(), err)
	suite.LogFile = logFile

	cfg := mock_config.NewMockInterface(suite.MockCtrl)
	cfg.EXPECT().GetString("database.location").Return(suite.TestDatabase.Name()).AnyTimes()
	cfg.EXPECT().GetString("database.type").Return("sqlite").AnyTimes()
	cfg.EXPECT().IsSet("database.encryption.key").Return(false).AnyTimes()
	cfg.EXPECT().GetString("log.level").Return("INFO").AnyTimes()
	cfg.EXPECT().GetBool("database.validation_mode").Return(false).AnyTimes()
	cfg.EXPECT().GetBool("database.encryption.enabled").Return(false).AnyTimes()
	cfg.EXPECT().GetString("log.file").Return(suite.LogFile.Name()).AnyTimes()
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
	os.Remove(suite.LogFile.Name())
}

func (suite *AdminHandlerTestSuite) ctxFor(username string, w *httptest.ResponseRecorder) *gin.Context {
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set(pkg.ContextKeyTypeLogger, logrus.WithField("test", suite.T().Name()))
	ctx.Set(pkg.ContextKeyTypeDatabase, suite.AppRepository)
	ctx.Set(pkg.ContextKeyTypeConfig, suite.AppConfig)
	ctx.Set(pkg.ContextKeyTypeAuthUsername, username)
	ctx.Request = httptest.NewRequest("GET", "/admin/logs", nil)
	return ctx
}

func (suite *AdminHandlerTestSuite) TestGetServerLogs_NonAdminForbidden() {
	w := httptest.NewRecorder()
	GetServerLogs(suite.ctxFor("reg_user", w))
	require.Equal(suite.T(), http.StatusForbidden, w.Code)
}

func (suite *AdminHandlerTestSuite) TestGetServerLogs_AdminReadsTail() {
	require.NoError(suite.T(), os.WriteFile(suite.LogFile.Name(), []byte("line one\nline two\nline three\n"), 0644))
	w := httptest.NewRecorder()
	GetServerLogs(suite.ctxFor("admin_user", w))
	require.Equal(suite.T(), http.StatusOK, w.Code)

	var resp struct {
		Success bool               `json:"success"`
		Data    ServerLogsResponse `json:"data"`
	}
	require.NoError(suite.T(), json.Unmarshal(w.Body.Bytes(), &resp))
	require.True(suite.T(), resp.Success)
	require.True(suite.T(), resp.Data.Configured)
	require.Equal(suite.T(), []string{"line one", "line two", "line three"}, resp.Data.Lines)
}

// when log.file is unset, it's not an error — the card just reports "not configured".
func (suite *AdminHandlerTestSuite) TestGetServerLogs_AdminNotConfigured() {
	noLogCfg := mock_config.NewMockInterface(suite.MockCtrl)
	noLogCfg.EXPECT().GetString("log.file").Return("").AnyTimes()

	w := httptest.NewRecorder()
	ctx := suite.ctxFor("admin_user", w)
	ctx.Set(pkg.ContextKeyTypeConfig, noLogCfg)
	GetServerLogs(ctx)
	require.Equal(suite.T(), http.StatusOK, w.Code)

	var resp struct {
		Success bool               `json:"success"`
		Data    ServerLogsResponse `json:"data"`
	}
	require.NoError(suite.T(), json.Unmarshal(w.Body.Bytes(), &resp))
	require.False(suite.T(), resp.Data.Configured)
	require.Empty(suite.T(), resp.Data.Lines)
}

func TestAdminHandlerTestSuite(t *testing.T) {
	suite.Run(t, new(AdminHandlerTestSuite))
}
