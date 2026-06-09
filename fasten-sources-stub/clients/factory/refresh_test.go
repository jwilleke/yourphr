package factory

import (
	"context"
	"testing"
	"time"

	"github.com/fastenhealth/fasten-sources/clients/models"
	"github.com/fastenhealth/fasten-sources/pkg"
	"github.com/sirupsen/logrus"
)

// fakeCred is a minimal SourceCredential for exercising RefreshAccessToken's network-free guards.
type fakeCred struct {
	accessToken string
	expiresAt   int64
	fhirBase    string
}

func (f *fakeCred) GetSourceId() string                   { return "" }
func (f *fakeCred) GetEndpointId() string                 { return "" }
func (f *fakeCred) GetPortalId() string                   { return "" }
func (f *fakeCred) GetBrandId() string                    { return "" }
func (f *fakeCred) GetPlatformType() pkg.PlatformType     { return "" }
func (f *fakeCred) GetClientId() string                   { return "" }
func (f *fakeCred) GetPatientId() string                  { return "" }
func (f *fakeCred) GetRefreshToken() string               { return "" }
func (f *fakeCred) GetAccessToken() string                { return f.accessToken }
func (f *fakeCred) GetExpiresAt() int64                   { return f.expiresAt }
func (f *fakeCred) SetTokens(a string, r string, e int64) { f.accessToken, f.expiresAt = a, e }
func (f *fakeCred) IsDynamicClient() bool                 { return false }
func (f *fakeCred) GetApiEndpointBaseUrl() string         { return f.fhirBase }
func (f *fakeCred) GetScopes() []string                   { return nil }

var _ models.SourceCredential = (*fakeCred)(nil)

// No access token (e.g. a manual-upload source) → nothing to refresh, no network.
func TestRefreshAccessToken_NoAccessToken(t *testing.T) {
	refreshed, err := RefreshAccessToken(context.Background(), logrus.WithField("t", t.Name()), &fakeCred{})
	if err != nil || refreshed {
		t.Fatalf("expected (false, nil), got (%v, %v)", refreshed, err)
	}
}

// A token that is still comfortably valid is left alone without contacting the provider.
func TestRefreshAccessToken_StillValid(t *testing.T) {
	cred := &fakeCred{accessToken: "tok", expiresAt: time.Now().Add(time.Hour).Unix(), fhirBase: "https://example.invalid"}
	refreshed, err := RefreshAccessToken(context.Background(), logrus.WithField("t", t.Name()), cred)
	if err != nil || refreshed {
		t.Fatalf("expected (false, nil) for a still-valid token (no network), got (%v, %v)", refreshed, err)
	}
}

// An expired token with no FHIR base URL can't be refreshed — error, but still no network attempt.
func TestRefreshAccessToken_ExpiredNoBaseURL(t *testing.T) {
	cred := &fakeCred{accessToken: "tok", expiresAt: time.Now().Add(-time.Hour).Unix()}
	refreshed, err := RefreshAccessToken(context.Background(), logrus.WithField("t", t.Name()), cred)
	if err == nil || refreshed {
		t.Fatalf("expected an error (no FHIR base URL) and refreshed=false, got (%v, %v)", refreshed, err)
	}
}
