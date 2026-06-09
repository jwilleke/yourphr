package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	mock_config "github.com/fastenhealth/fasten-onprem/backend/pkg/config/mock"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/event_bus"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/medication"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/gin-gonic/gin"
	"github.com/golang/mock/gomock"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"
	"net/http"
)

type MedicationsHandlerTestSuite struct {
	suite.Suite
	MockCtrl      *gomock.Controller
	TestDatabase  *os.File
	AppConfig     *mock_config.MockInterface
	AppRepository database.DatabaseRepository
	AppEventBus   event_bus.Interface
}

func (suite *MedicationsHandlerTestSuite) SetupSuite() {
	suiteName := suite.T().Name()
	suite.MockCtrl = gomock.NewController(suite.T())

	dbFile, err := os.CreateTemp("", fmt.Sprintf("%s.*.db", suiteName))
	require.NoError(suite.T(), err)
	suite.TestDatabase = dbFile

	appConfig := mock_config.NewMockInterface(suite.MockCtrl)
	appConfig.EXPECT().GetString("database.location").Return(suite.TestDatabase.Name()).AnyTimes()
	appConfig.EXPECT().GetString("database.type").Return("sqlite").AnyTimes()
	appConfig.EXPECT().IsSet("database.encryption.key").Return(false).AnyTimes()
	appConfig.EXPECT().GetString("log.level").Return("INFO").AnyTimes()
	appConfig.EXPECT().GetBool("database.validation_mode").Return(false).AnyTimes()
	appConfig.EXPECT().GetBool("database.encryption.enabled").Return(false).AnyTimes()
	suite.AppConfig = appConfig

	appRepo, err := database.NewRepository(suite.AppConfig, logrus.WithField("test", suiteName), event_bus.NewNoopEventBusServer())
	require.NoError(suite.T(), err)
	suite.AppRepository = appRepo
	suite.AppEventBus = event_bus.NewNoopEventBusServer()

	err = appRepo.CreateUser(context.Background(), &models.User{Username: "test_user", Password: "test"})
	require.NoError(suite.T(), err)

	// ingest a bundle that contains MedicationRequest resources
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	suite.setupContext(ctx)
	req, err := CreateManualSourceHttpRequestFromFile("testdata/Tania553_Harris789_545c2380-b77f-4919-ab5d-0f615f877250.json")
	require.NoError(suite.T(), err)
	ctx.Request = req
	CreateManualSource(ctx)
	require.Equal(suite.T(), http.StatusOK, w.Code)
}

func (suite *MedicationsHandlerTestSuite) TearDownSuite() {
	suite.MockCtrl.Finish()
	os.Remove(suite.TestDatabase.Name())
}

func (suite *MedicationsHandlerTestSuite) setupContext(ctx *gin.Context) {
	ctx.Set(pkg.ContextKeyTypeLogger, logrus.WithField("test", suite.T().Name()))
	ctx.Set(pkg.ContextKeyTypeDatabase, suite.AppRepository)
	ctx.Set(pkg.ContextKeyTypeConfig, suite.AppConfig)
	ctx.Set(pkg.ContextKeyTypeEventBusServer, suite.AppEventBus)
	ctx.Set(pkg.ContextKeyTypeAuthUsername, "test_user")
}

func (suite *MedicationsHandlerTestSuite) TestGetMedicationsReconciled() {
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	suite.setupContext(ctx)
	ctx.Request = httptest.NewRequest("GET", "/medications/reconciled", nil)

	GetMedicationsReconciled(ctx)
	require.Equal(suite.T(), http.StatusOK, w.Code)

	var resp struct {
		Success bool                              `json:"success"`
		Data    []medication.ReconciledMedication `json:"data"`
	}
	require.NoError(suite.T(), json.Unmarshal(w.Body.Bytes(), &resp))
	require.True(suite.T(), resp.Success)
	require.NotEmpty(suite.T(), resp.Data, "bundle has 8 MedicationRequests, so the reconciled list should be non-empty")

	validStates := map[string]bool{
		medication.StateActive: true, medication.StateSuspended: true,
		medication.StatePast: true, medication.StateUnknown: true,
	}
	for _, m := range resp.Data {
		require.NotEmpty(suite.T(), m.Title, "every row should have a resolved medication name")
		require.True(suite.T(), validStates[m.State], "state %q should be one of the classified values", m.State)
		require.NotEmpty(suite.T(), m.Contributors, "every row must carry its contributing-resource evidence")
	}
}

func TestMedicationsHandlerTestSuite(t *testing.T) {
	suite.Run(t, new(MedicationsHandlerTestSuite))
}
