package web

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	mock_config "github.com/fastenhealth/fasten-onprem/backend/pkg/config/mock"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/event_bus"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/golang/mock/gomock"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/require"
)

func TestTokenNeedsRefresh(t *testing.T) {
	now := time.Date(2026, time.June, 9, 12, 0, 0, 0, time.UTC)
	skew := 60 * time.Second
	cases := []struct {
		name string
		cred *models.SourceCredential
		want bool
	}{
		{"nil", nil, false},
		{"no access token (manual source)", &models.SourceCredential{ExpiresAt: now.Add(-time.Hour).Unix()}, false},
		{"unknown expiry", &models.SourceCredential{AccessToken: "a", ExpiresAt: 0}, false},
		{"still valid", &models.SourceCredential{AccessToken: "a", ExpiresAt: now.Add(time.Hour).Unix()}, false},
		{"within skew", &models.SourceCredential{AccessToken: "a", ExpiresAt: now.Add(30 * time.Second).Unix()}, true},
		{"already expired", &models.SourceCredential{AccessToken: "a", ExpiresAt: now.Add(-time.Minute).Unix()}, true},
	}
	for _, tc := range cases {
		require.Equal(t, tc.want, tokenNeedsRefresh(tc.cred, now, skew), tc.name)
	}
}

func TestRefreshExpiringTokens(t *testing.T) {
	now := time.Date(2026, time.June, 9, 12, 0, 0, 0, time.UTC)

	ctrl := gomock.NewController(t)
	dbFile, err := os.CreateTemp("", "tokenrefresh.*.db")
	require.NoError(t, err)
	defer os.Remove(dbFile.Name())

	cfg := mock_config.NewMockInterface(ctrl)
	cfg.EXPECT().GetString("database.location").Return(dbFile.Name()).AnyTimes()
	cfg.EXPECT().GetString("database.type").Return("sqlite").AnyTimes()
	cfg.EXPECT().IsSet("database.encryption.key").Return(false).AnyTimes()
	cfg.EXPECT().GetString("log.level").Return("INFO").AnyTimes()
	cfg.EXPECT().GetBool("database.validation_mode").Return(false).AnyTimes()
	cfg.EXPECT().GetBool("database.encryption.enabled").Return(false).AnyTimes()

	logger := logrus.WithField("test", t.Name())
	repo, err := database.NewRepository(cfg, logger, event_bus.NewNoopEventBusServer())
	require.NoError(t, err)
	require.NoError(t, repo.CreateUser(context.Background(), &models.User{Username: "u1", Password: "p"}))

	uctx := context.WithValue(context.Background(), pkg.ContextKeyTypeAuthUsername, "u1")
	mkSource := func(accessToken string, expiresAt int64) *models.SourceCredential {
		s := &models.SourceCredential{
			EndpointID:         uuid.New(),
			ApiEndpointBaseUrl: "https://fhir.example.com",
			AccessToken:        accessToken,
			RefreshToken:       "refresh",
			ExpiresAt:          expiresAt,
		}
		require.NoError(t, repo.CreateSource(uctx, s))
		return s
	}
	expiring := mkSource("old", now.Add(30*time.Second).Unix()) // within skew → refresh
	mkSource("valid", now.Add(time.Hour).Unix())                // still valid → skip
	mkSource("", now.Add(-time.Hour).Unix())                    // manual/no token → skip

	ae := &AppEngine{Config: cfg, Logger: logger, deviceRepo: repo}

	// fake refresher: only the expiring source should reach it; it rotates the token
	fake := func(ctx context.Context, cred *models.SourceCredential) (bool, error) {
		cred.SetTokens("new", "refresh2", now.Add(time.Hour).Unix())
		return true, nil
	}

	attempted, refreshed := ae.refreshExpiringTokens(now, tokenRefreshSkew, fake)
	require.Equal(t, 1, attempted, "only the near-expiry source should be attempted")
	require.Equal(t, 1, refreshed)

	// the rotated token must be persisted
	sources, err := repo.GetSources(uctx)
	require.NoError(t, err)
	var got *models.SourceCredential
	for i := range sources {
		if sources[i].EndpointID == expiring.EndpointID {
			got = &sources[i]
		}
	}
	require.NotNil(t, got)
	require.Equal(t, "new", got.AccessToken, "refreshed access token should be persisted")
	require.Equal(t, "refresh2", got.RefreshToken, "rotated refresh token should be persisted")
}

// ensure a failing refresher never persists and never blocks the others
func TestRefreshExpiringTokens_ErrorIsSkipped(t *testing.T) {
	now := time.Now()
	ctrl := gomock.NewController(t)
	dbFile, err := os.CreateTemp("", "tokenrefresh2.*.db")
	require.NoError(t, err)
	defer os.Remove(dbFile.Name())

	cfg := mock_config.NewMockInterface(ctrl)
	cfg.EXPECT().GetString("database.location").Return(dbFile.Name()).AnyTimes()
	cfg.EXPECT().GetString("database.type").Return("sqlite").AnyTimes()
	cfg.EXPECT().IsSet("database.encryption.key").Return(false).AnyTimes()
	cfg.EXPECT().GetString("log.level").Return("INFO").AnyTimes()
	cfg.EXPECT().GetBool("database.validation_mode").Return(false).AnyTimes()
	cfg.EXPECT().GetBool("database.encryption.enabled").Return(false).AnyTimes()

	logger := logrus.WithField("test", t.Name())
	repo, err := database.NewRepository(cfg, logger, event_bus.NewNoopEventBusServer())
	require.NoError(t, err)
	require.NoError(t, repo.CreateUser(context.Background(), &models.User{Username: "u1", Password: "p"}))
	uctx := context.WithValue(context.Background(), pkg.ContextKeyTypeAuthUsername, "u1")
	s := &models.SourceCredential{EndpointID: uuid.New(), ApiEndpointBaseUrl: "https://x", AccessToken: "old", ExpiresAt: now.Add(10 * time.Second).Unix()}
	require.NoError(t, repo.CreateSource(uctx, s))

	ae := &AppEngine{Config: cfg, Logger: logger, deviceRepo: repo}
	boom := func(ctx context.Context, cred *models.SourceCredential) (bool, error) {
		return false, fmt.Errorf("token endpoint unreachable")
	}
	attempted, refreshed := ae.refreshExpiringTokens(now, tokenRefreshSkew, boom)
	require.Equal(t, 1, attempted)
	require.Equal(t, 0, refreshed, "a failed refresh must not count as refreshed")
}
