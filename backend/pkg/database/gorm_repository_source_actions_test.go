package database

import (
	"context"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"os"
	"testing"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	mock_config "github.com/fastenhealth/fasten-onprem/backend/pkg/config/mock"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/event_bus"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	sourceModels "github.com/fastenhealth/fasten-onprem/backend/pkg/sources/clients/models"
	"github.com/golang/mock/gomock"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/require"
)

// #437: Disconnect clears tokens but keeps FHIR; Remove data clears FHIR but keeps credential;
// DeleteSource does full teardown.
func TestSourceActions_DisconnectRemoveDelete(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	tmpDB, err := os.CreateTemp("", "yourphr-source-actions-*.db")
	require.NoError(t, err)
	_ = tmpDB.Close()
	defer os.Remove(tmpDB.Name())

	fakeConfig := mock_config.NewMockInterface(ctrl)
	fakeConfig.EXPECT().GetString("database.location").Return(tmpDB.Name()).AnyTimes()
	fakeConfig.EXPECT().GetString("database.type").Return("sqlite").AnyTimes()
	fakeConfig.EXPECT().IsSet("database.encryption.key").Return(false).AnyTimes()
	fakeConfig.EXPECT().GetString("log.level").Return("INFO").AnyTimes()
	fakeConfig.EXPECT().GetBool("database.validation_mode").Return(false).AnyTimes()
	fakeConfig.EXPECT().GetBool("database.encryption.enabled").Return(false).AnyTimes()
	fakeConfig.EXPECT().GetBool("search.enabled").Return(false).AnyTimes()

	dbRepo, err := NewRepository(fakeConfig, logrus.WithField("test", t.Name()), event_bus.NewNoopEventBusServer())
	require.NoError(t, err)

	userModel := &models.User{
		Username: "source_actions_user",
		Password: "testpassword",
		Email:    "source-actions@test.com",
	}
	require.NoError(t, dbRepo.CreateUser(context.Background(), userModel))
	authCtx := context.WithValue(context.Background(), pkg.ContextKeyTypeAuthUsername, userModel.Username)

	src := &models.SourceCredential{
		UserID:       userModel.ID,
		Patient:      "pt-1",
		Display:      "Test Clinic",
		AccessToken:  config.Secret("access-secret"),
		RefreshToken: config.Secret("refresh-secret"),
		IdToken:      config.Secret("id-secret"),
		ExpiresAt:    9999999999,
		ClientId:     "client-1",
	}
	require.NoError(t, dbRepo.CreateSource(authCtx, src))
	require.NotEqual(t, uuid.Nil, src.ID)

	patientJSON, err := os.ReadFile("./testdata/Abraham100_Heller342_Patient.json")
	require.NoError(t, err)
	_, err = dbRepo.UpsertRawResource(authCtx, src, sourceModels.RawResourceFhir{
		SourceResourceType: "Patient",
		SourceResourceID:   "b426b062-8273-4b93-a907-de3176c0567d",
		ResourceRaw:        patientJSON,
	})
	require.NoError(t, err)

	// Disconnect: tokens gone, source row + FHIR remain.
	require.NoError(t, dbRepo.DisconnectSource(authCtx, src.ID.String()))
	reloaded, err := dbRepo.GetSource(authCtx, src.ID.String())
	require.NoError(t, err)
	require.Empty(t, reloaded.AccessToken)
	require.Empty(t, reloaded.RefreshToken)
	require.Empty(t, reloaded.IdToken)
	require.Equal(t, int64(0), reloaded.ExpiresAt)
	require.Equal(t, "client-1", reloaded.ClientId)
	require.Equal(t, "Test Clinic", reloaded.Display)

	patient, err := dbRepo.GetResourceByResourceTypeAndId(authCtx, "Patient", "b426b062-8273-4b93-a907-de3176c0567d")
	require.NoError(t, err)
	require.NotNil(t, patient)

	// Put tokens back, then RemoveSourceData: FHIR gone, credential remains.
	reloaded.AccessToken = "again"
	reloaded.RefreshToken = "again-r"
	require.NoError(t, dbRepo.UpdateSource(authCtx, reloaded))

	rows, err := dbRepo.RemoveSourceData(authCtx, src.ID.String())
	require.NoError(t, err)
	require.GreaterOrEqual(t, rows, int64(1))

	_, err = dbRepo.GetResourceByResourceTypeAndId(authCtx, "Patient", "b426b062-8273-4b93-a907-de3176c0567d")
	require.Error(t, err)

	stillThere, err := dbRepo.GetSource(authCtx, src.ID.String())
	require.NoError(t, err)
	require.Equal(t, "again", stillThere.AccessToken.Expose())

	// DeleteSource: credential soft-deleted.
	_, err = dbRepo.DeleteSource(authCtx, src.ID.String())
	require.NoError(t, err)
	_, err = dbRepo.GetSource(authCtx, src.ID.String())
	require.Error(t, err)
}
