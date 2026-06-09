package web

import (
	"context"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-sources/clients/factory"
)

// Scheduled OAuth token-refresh worker (#51, EPIC #20 component E). SMART sources obtain
// offline_access refresh tokens at connect time; tokens then refresh reactively during a sync. This
// worker additionally refreshes them on a timer so a source that is not being actively synced does
// not let its access token lapse. It reuses the same discovery + refresh path as sync
// (factory.RefreshAccessToken) — no OAuth logic is reimplemented here.

const tokenRefreshSkew = 60 * time.Second

// tokenNeedsRefresh reports whether a source has an OAuth access token worth refreshing now: present,
// with a known expiry, and within the skew window of expiring. Manual-upload sources (no access
// token), sources with an unknown (zero) expiry, and still-valid tokens are skipped — no guessing.
func tokenNeedsRefresh(cred *models.SourceCredential, now time.Time, skew time.Duration) bool {
	if cred == nil || cred.AccessToken == "" || cred.ExpiresAt == 0 {
		return false
	}
	return cred.ExpiresAt <= now.Add(skew).Unix()
}

// tokenRefresher refreshes (and mutates) a credential in place, returning whether it changed.
// Injected so refreshExpiringTokens is testable without network/OAuth.
type tokenRefresher func(ctx context.Context, cred *models.SourceCredential) (bool, error)

// refreshExpiringTokens scans every user's sources and refreshes the access tokens that are near
// expiry, persisting any that change. One source's failure is logged and skipped so it never blocks
// the rest. Returns (attempted, refreshed) counts.
func (ae *AppEngine) refreshExpiringTokens(now time.Time, skew time.Duration, refresh tokenRefresher) (int, int) {
	attempted, refreshed := 0, 0

	users, err := ae.deviceRepo.GetUsers(context.Background())
	if err != nil {
		ae.Logger.Errorf("token-refresh: could not list users: %v", err)
		return attempted, refreshed
	}

	for _, user := range users {
		userCtx := context.WithValue(context.Background(), pkg.ContextKeyTypeAuthUsername, user.Username)
		sources, err := ae.deviceRepo.GetSources(userCtx)
		if err != nil {
			ae.Logger.Warnf("token-refresh: could not list sources for user %s: %v", user.Username, err)
			continue
		}
		for i := range sources {
			source := sources[i]
			if !tokenNeedsRefresh(&source, now, skew) {
				continue
			}
			attempted++
			didRefresh, err := refresh(userCtx, &source)
			if err != nil {
				ae.Logger.Warnf("token-refresh: source %s (user %s): %v", source.ID, user.Username, err)
				continue
			}
			if !didRefresh {
				continue
			}
			if err := ae.deviceRepo.UpdateSource(userCtx, &source); err != nil {
				ae.Logger.Warnf("token-refresh: persisting source %s failed: %v", source.ID, err)
				continue
			}
			refreshed++
		}
	}

	if attempted > 0 {
		ae.Logger.Infof("token-refresh: attempted %d, refreshed %d", attempted, refreshed)
	}
	return attempted, refreshed
}

// startTokenRefreshWorker runs refreshExpiringTokens on a ticker for the server's lifetime. Set
// sync.token_refresh.interval_minutes <= 0 to disable. Blocks; launch in a goroutine.
func (ae *AppEngine) startTokenRefreshWorker() {
	ae.Config.SetDefault("sync.token_refresh.interval_minutes", 30)
	intervalMin := ae.Config.GetInt("sync.token_refresh.interval_minutes")
	if intervalMin <= 0 {
		ae.Logger.Info("token-refresh worker disabled (sync.token_refresh.interval_minutes <= 0)")
		return
	}

	prod := func(ctx context.Context, cred *models.SourceCredential) (bool, error) {
		return factory.RefreshAccessToken(ctx, ae.Logger, cred)
	}

	ticker := time.NewTicker(time.Duration(intervalMin) * time.Minute)
	defer ticker.Stop()
	ae.Logger.Infof("token-refresh worker started (every %d min)", intervalMin)
	for range ticker.C {
		ae.refreshExpiringTokens(time.Now(), tokenRefreshSkew, prod)
	}
}
