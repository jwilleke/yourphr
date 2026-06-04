// Package smart is a generic SMART on FHIR R4 client (EPIC #20, issue #49).
//
// It implements the standard SMART standalone patient-launch building blocks —
// .well-known discovery, authorization-code + PKCE, token exchange/refresh, and an
// authenticated, paginated FHIR fetch — using golang.org/x/oauth2 + net/http. It is
// provider-agnostic by design (decision: one generic SMART-R4 client); vendor-specific
// data quirks are handled in the display/normalization layer, not here.
//
// This package is the reusable core. Wiring it into the models.SourceClient interface and
// deciding where the per-source Config comes from (self-describing SourceCredential vs a
// definitions catalog) is issue #49 part 2.
package smart

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"golang.org/x/oauth2"
)

// Config is the per-source SMART configuration. In production these values come from the
// SourceCredential (BYO client_id + FHIR base URL).
type Config struct {
	FHIRBaseURL string   // e.g. https://fhir.example.com/r4
	ClientID    string   // BYO per-user client_id
	Scopes      []string // e.g. launch/patient patient/*.read openid fhirUser offline_access
	RedirectURI string   // the relay/callback URL registered with the provider

	// HTTPClient is optional; defaults to http.DefaultClient. Override in tests.
	HTTPClient *http.Client
}

// Endpoints holds the SMART authorize/token endpoints from .well-known/smart-configuration.
type Endpoints struct {
	Authorization string `json:"authorization_endpoint"`
	Token         string `json:"token_endpoint"`
}

func (c Config) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return http.DefaultClient
}

// Discover fetches and parses {FHIRBaseURL}/.well-known/smart-configuration.
func (c Config) Discover(ctx context.Context) (Endpoints, error) {
	var ep Endpoints
	url := strings.TrimRight(c.FHIRBaseURL, "/") + "/.well-known/smart-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return ep, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return ep, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return ep, fmt.Errorf("smart-configuration HTTP %d: %s", resp.StatusCode, string(b))
	}
	if err := json.NewDecoder(resp.Body).Decode(&ep); err != nil {
		return ep, fmt.Errorf("decoding smart-configuration: %w", err)
	}
	if ep.Authorization == "" || ep.Token == "" {
		return ep, fmt.Errorf("smart-configuration missing authorization/token endpoints")
	}
	return ep, nil
}

func (c Config) oauth2Config(ep Endpoints) *oauth2.Config {
	return &oauth2.Config{
		ClientID:    c.ClientID,
		RedirectURL: c.RedirectURI,
		Scopes:      c.Scopes,
		Endpoint:    oauth2.Endpoint{AuthURL: ep.Authorization, TokenURL: ep.Token},
	}
}

// GenerateVerifier returns a high-entropy PKCE code_verifier (RFC 7636): 32 random bytes,
// base64url-encoded (43 chars). The caller persists it to validate the callback (issue #51).
func GenerateVerifier() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// s256Challenge is the RFC 7636 S256 transform: base64url(sha256(verifier)).
func s256Challenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// AuthCodeURL builds the PKCE (S256) standalone-launch authorization URL. aud is set to the
// FHIR base URL as SMART requires. The caller stores state + verifier to validate the callback.
// PKCE is applied via raw params (code_challenge / code_challenge_method) for broad
// x/oauth2 version compatibility.
func (c Config) AuthCodeURL(ep Endpoints, state, verifier string) string {
	return c.oauth2Config(ep).AuthCodeURL(state,
		oauth2.SetAuthURLParam("code_challenge", s256Challenge(verifier)),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
		oauth2.SetAuthURLParam("aud", c.FHIRBaseURL),
	)
}

// ExchangeCode exchanges an authorization code (with its PKCE verifier) for a token.
func (c Config) ExchangeCode(ctx context.Context, ep Endpoints, code, verifier string) (*oauth2.Token, error) {
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.httpClient())
	return c.oauth2Config(ep).Exchange(ctx, code, oauth2.SetAuthURLParam("code_verifier", verifier))
}

// Refresh exchanges a refresh token for a fresh token (needs the offline_access scope).
func (c Config) Refresh(ctx context.Context, ep Endpoints, refreshToken string) (*oauth2.Token, error) {
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.httpClient())
	ts := c.oauth2Config(ep).TokenSource(ctx, &oauth2.Token{RefreshToken: refreshToken})
	return ts.Token()
}

// FetchEverything calls GET {FHIRBaseURL}/Patient/{patientID}/$everything with the given token
// and follows Bundle pagination (link relation "next"), returning each page's raw bytes. The
// token is auto-refreshed if expired; if a refresh occurred, the returned token is non-nil and
// the caller should persist it. The pageCap guards against runaway pagination.
func (c Config) FetchEverything(ctx context.Context, ep Endpoints, tok *oauth2.Token, patientID string) (pages [][]byte, refreshed *oauth2.Token, err error) {
	const pageCap = 1000
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.httpClient())
	ts := c.oauth2Config(ep).TokenSource(ctx, tok)
	httpClient := oauth2.NewClient(ctx, ts)

	next := fmt.Sprintf("%s/Patient/%s/$everything", strings.TrimRight(c.FHIRBaseURL, "/"), patientID)
	for next != "" {
		body, link, gerr := getBundlePage(ctx, httpClient, next)
		if gerr != nil {
			return pages, nil, gerr
		}
		pages = append(pages, body)
		next = link
		if len(pages) >= pageCap {
			return pages, nil, fmt.Errorf("aborting $everything: exceeded %d pages", pageCap)
		}
	}

	// Surface a refreshed token (if any) so the caller can persist it.
	if t, terr := ts.Token(); terr == nil && t.AccessToken != tok.AccessToken {
		refreshed = t
	}
	return pages, refreshed, nil
}

func getBundlePage(ctx context.Context, client *http.Client, url string) (body []byte, nextLink string, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Accept", "application/fhir+json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = resp.Body.Close() }()
	body, err = io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("$everything HTTP %d: %s", resp.StatusCode, truncate(body, 500))
	}
	return body, nextBundleLink(body), nil
}

// nextBundleLink returns the Bundle.link entry with relation "next", or "" if none.
func nextBundleLink(body []byte) string {
	var b struct {
		Link []struct {
			Relation string `json:"relation"`
			URL      string `json:"url"`
		} `json:"link"`
	}
	if json.Unmarshal(body, &b) != nil {
		return ""
	}
	for _, l := range b.Link {
		if l.Relation == "next" {
			return l.URL
		}
	}
	return ""
}

func truncate(b []byte, n int) string {
	if len(b) > n {
		return string(b[:n]) + "..."
	}
	return string(b)
}
