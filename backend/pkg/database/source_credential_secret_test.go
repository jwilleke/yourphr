package database

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	mock_config "github.com/fastenhealth/fasten-onprem/backend/pkg/config/mock"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/event_bus"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/golang/mock/gomock"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/require"
)

// The failure mode that would make yourphr#477 a disaster rather than a hardening: persisting
// "[REDACTED]".
//
// config.Secret redacts under every format verb and under json.Marshal, but implements
// driver.Valuer / sql.Scanner to store the real value. If that asymmetry were ever broken, the
// symptom would not be a visible error — it would be provider credentials quietly replaced by the
// placeholder, discovered only when a sync failed to authenticate some time later.
//
// Runs with redaction ON, because that is production.
func TestSourceCredential_SecretsRoundTripThroughTheDatabase(t *testing.T) {
	require.True(t, config.SecretsAreRedacted(), "redaction must be the default; this test is meaningless without it")

	dbRepo, authCtx, userID := newSecretRoundTripRepo(t)

	src := &models.SourceCredential{
		UserID:       userID,
		Patient:      "pt-secret",
		Display:      "Round Trip Clinic",
		ClientId:     "client-visible",
		ClientSecret: config.Secret("client-secret-value"),
		AccessToken:  config.Secret("access-token-value"),
		RefreshToken: config.Secret("refresh-token-value"),
		IdToken:      config.Secret("id-token-value"),
		ExpiresAt:    9999999999,
	}
	require.NoError(t, dbRepo.CreateSource(authCtx, src))

	reloaded, err := dbRepo.GetSource(authCtx, src.ID.String())
	require.NoError(t, err)

	require.Equal(t, "client-secret-value", reloaded.ClientSecret.Expose())
	require.Equal(t, "access-token-value", reloaded.AccessToken.Expose())
	require.Equal(t, "refresh-token-value", reloaded.RefreshToken.Expose())
	require.Equal(t, "id-token-value", reloaded.IdToken.Expose())

	require.NotContains(t, reloaded.AccessToken.Expose(), config.RedactedPlaceholder,
		"the placeholder must never reach storage")
}

// The point of the change: logging the struct cannot leak, while ordinary fields still print.
func TestSourceCredential_DoesNotLeakUnderFormatVerbs(t *testing.T) {
	src := models.SourceCredential{
		Display:      "Round Trip Clinic",
		ClientId:     "client-visible",
		ClientSecret: config.Secret("client-secret-value"),
		AccessToken:  config.Secret("access-token-value"),
		RefreshToken: config.Secret("refresh-token-value"),
		IdToken:      config.Secret("id-token-value"),
	}

	secrets := []string{"client-secret-value", "access-token-value", "refresh-token-value", "id-token-value"}
	for _, verb := range []string{"%v", "%+v", "%#v", "%s"} {
		out := fmt.Sprintf(verb, src)
		for _, secret := range secrets {
			require.NotContainsf(t, out, secret, "%s leaked %s", verb, secret)
		}
		require.Containsf(t, out, "client-visible", "%s should still show non-secret fields", verb)
	}
}

// Direction matters. The browser POSTs a credential built from the provider's token response, so
// these must still UNMARSHAL from plain strings — setting json:"-" instead would silently drop the
// token on connect. Marshalling back out must redact.
func TestSourceCredential_AcceptsTokensOnInputAndRedactsOnOutput(t *testing.T) {
	var src models.SourceCredential
	require.NoError(t, json.Unmarshal([]byte(`{
		"client_id":"client-visible",
		"access_token":"access-token-value",
		"refresh_token":"refresh-token-value",
		"id_token":"id-token-value"
	}`), &src))

	require.Equal(t, "access-token-value", src.AccessToken.Expose(), "input must survive")
	require.Equal(t, "refresh-token-value", src.RefreshToken.Expose())
	require.Equal(t, "id-token-value", src.IdToken.Expose())

	encoded, err := json.Marshal(src)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "access-token-value", "output must redact")
	require.NotContains(t, string(encoded), "refresh-token-value")
	require.Contains(t, string(encoded), "client-visible", "non-secret fields still serialize")
}

// The getters are the Expose boundary that satisfies the fasten-sources interface, which requires
// plain strings. If they ever returned the redacted form, every provider request would authenticate
// with "[REDACTED]".
func TestSourceCredential_GettersReturnRealValues(t *testing.T) {
	src := models.SourceCredential{
		ClientSecret: config.Secret("client-secret-value"),
		AccessToken:  config.Secret("access-token-value"),
		RefreshToken: config.Secret("refresh-token-value"),
	}

	require.Equal(t, "client-secret-value", src.GetClientSecret())
	require.Equal(t, "access-token-value", src.GetAccessToken())
	require.Equal(t, "refresh-token-value", src.GetRefreshToken())
}

// SetTokens compares the incoming access token against the stored one. Comparing a raw string to a
// redacted Secret would make every refresh look like a change (or none of them), so this pins both
// directions.
func TestSourceCredential_SetTokensComparesAgainstTheRealValue(t *testing.T) {
	src := models.SourceCredential{
		AccessToken:  config.Secret("access-token-value"),
		RefreshToken: config.Secret("refresh-token-value"),
		ExpiresAt:    100,
	}

	// Same token: refresh token must not be disturbed.
	src.SetTokens("access-token-value", "", 200)
	require.Equal(t, "refresh-token-value", src.RefreshToken.Expose())
	require.Equal(t, int64(200), src.ExpiresAt)

	// New token: both update.
	src.SetTokens("new-access", "new-refresh", 300)
	require.Equal(t, "new-access", src.AccessToken.Expose())
	require.Equal(t, "new-refresh", src.RefreshToken.Expose())

	// An empty refresh token must not wipe the stored one — this is a token-refresh response that
	// only returns a new access token.
	src.SetTokens("newer-access", "", 400)
	require.Equal(t, "newer-access", src.AccessToken.Expose())
	require.Equal(t, "new-refresh", src.RefreshToken.Expose(), "an empty refresh token must not erase the stored one")
}

func newSecretRoundTripRepo(t *testing.T) (DatabaseRepository, context.Context, uuid.UUID) {
	t.Helper()
	ctrl := gomock.NewController(t)
	t.Cleanup(ctrl.Finish)

	tmpDB, err := os.CreateTemp("", "yourphr-secret-roundtrip-*.db")
	require.NoError(t, err)
	_ = tmpDB.Close()
	t.Cleanup(func() { _ = os.Remove(tmpDB.Name()) })

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

	userModel := &models.User{Username: "secret_roundtrip_user", Password: "testpassword", Email: "secret@test.com"}
	require.NoError(t, dbRepo.CreateUser(context.Background(), userModel))
	authCtx := context.WithValue(context.Background(), pkg.ContextKeyTypeAuthUsername, userModel.Username)

	return dbRepo, authCtx, userModel.ID
}
