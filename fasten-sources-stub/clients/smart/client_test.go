package smart

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

func TestDiscover(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/smart-configuration" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"authorization_endpoint":%q,"token_endpoint":%q}`,
			"https://auth.example/authorize", "https://auth.example/token")
	}))
	defer srv.Close()

	cfg := Config{FHIRBaseURL: srv.URL, HTTPClient: srv.Client()}
	ep, err := cfg.Discover(context.Background())
	if err != nil {
		t.Fatalf("Discover: %v", err)
	}
	if ep.Authorization != "https://auth.example/authorize" || ep.Token != "https://auth.example/token" {
		t.Fatalf("unexpected endpoints: %+v", ep)
	}
}

func TestDiscoverMissingEndpoints(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"authorization_endpoint":""}`)
	}))
	defer srv.Close()
	cfg := Config{FHIRBaseURL: srv.URL, HTTPClient: srv.Client()}
	if _, err := cfg.Discover(context.Background()); err == nil {
		t.Fatal("expected error for missing endpoints")
	}
}

func TestAuthCodeURL(t *testing.T) {
	cfg := Config{
		FHIRBaseURL: "https://fhir.example/r4",
		ClientID:    "my-client",
		Scopes:      []string{"launch/patient", "patient/*.read", "offline_access"},
		RedirectURI: "https://relay.example/callback",
	}
	ep := Endpoints{Authorization: "https://auth.example/authorize", Token: "https://auth.example/token"}
	raw := cfg.AuthCodeURL(ep, "state123", "verifier-abc-1234567890")

	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	q := u.Query()
	checks := map[string]string{
		"response_type":         "code",
		"client_id":             "my-client",
		"redirect_uri":          "https://relay.example/callback",
		"state":                 "state123",
		"code_challenge_method": "S256",
		"aud":                   "https://fhir.example/r4",
	}
	for k, want := range checks {
		if got := q.Get(k); got != want {
			t.Errorf("query %s = %q, want %q", k, got, want)
		}
	}
	if q.Get("code_challenge") == "" {
		t.Error("missing code_challenge")
	}
	if !strings.HasPrefix(raw, "https://auth.example/authorize?") {
		t.Errorf("authorize URL has wrong base: %s", raw)
	}
}

func TestNextBundleLink(t *testing.T) {
	withNext := []byte(`{"resourceType":"Bundle","link":[{"relation":"self","url":"a"},{"relation":"next","url":"https://x/page2"}]}`)
	if got := nextBundleLink(withNext); got != "https://x/page2" {
		t.Errorf("next = %q, want https://x/page2", got)
	}
	noNext := []byte(`{"resourceType":"Bundle","link":[{"relation":"self","url":"a"}]}`)
	if got := nextBundleLink(noNext); got != "" {
		t.Errorf("expected empty next, got %q", got)
	}
	if got := nextBundleLink([]byte(`not json`)); got != "" {
		t.Errorf("expected empty next for bad json, got %q", got)
	}
}

func TestFetchEverythingPagination(t *testing.T) {
	var base string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			http.Error(w, "missing bearer", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/fhir+json")
		switch {
		case strings.Contains(r.URL.Path, "$everything"):
			// page 1 → points to page 2
			fmt.Fprintf(w, `{"resourceType":"Bundle","link":[{"relation":"next","url":%q}],"entry":[{"resource":{"resourceType":"Patient","id":"p1"}}]}`, base+"/page2")
		case r.URL.Path == "/page2":
			// page 2 → no next (last page)
			fmt.Fprint(w, `{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Observation","id":"o1"}}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	base = srv.URL

	cfg := Config{FHIRBaseURL: srv.URL, HTTPClient: srv.Client()}
	ep := Endpoints{Token: srv.URL + "/token"}
	tok := &oauth2.Token{AccessToken: "test-token", Expiry: time.Now().Add(time.Hour)}

	pages, refreshed, err := cfg.FetchEverything(context.Background(), ep, tok, "p1")
	if err != nil {
		t.Fatalf("FetchEverything: %v", err)
	}
	if len(pages) != 2 {
		t.Fatalf("expected 2 pages, got %d", len(pages))
	}
	if !strings.Contains(string(pages[0]), "Patient") || !strings.Contains(string(pages[1]), "Observation") {
		t.Errorf("unexpected page contents")
	}
	if refreshed != nil {
		t.Errorf("did not expect a token refresh for a non-expired token")
	}
}
