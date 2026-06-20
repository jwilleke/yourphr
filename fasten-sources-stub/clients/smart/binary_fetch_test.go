package smart

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

func TestFetchBinaries(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			http.Error(w, "missing bearer", http.StatusUnauthorized)
			return
		}
		if r.Header.Get("Accept") != "application/fhir+json" {
			http.Error(w, "wrong accept", http.StatusNotAcceptable)
			return
		}
		switch r.URL.Path {
		case "/Binary/b1":
			hits++
			w.Header().Set("Content-Type", "application/fhir+json")
			fmt.Fprint(w, `{"resourceType":"Binary","id":"b1","contentType":"application/pdf","data":"aGVsbG8="}`)
		case "/Binary/b2":
			hits++
			w.Header().Set("Content-Type", "application/fhir+json")
			fmt.Fprint(w, `{"resourceType":"Binary","id":"b2","contentType":"text/plain","data":"d29ybGQ="}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, HTTPClient: srv.Client()}
	ep := Endpoints{Token: srv.URL + "/token"}
	tok := &oauth2.Token{AccessToken: "test-token", Expiry: time.Now().Add(time.Hour)}

	// One relative reference, one absolute same-host URL — both should be followed.
	urls := []string{"Binary/b1", srv.URL + "/Binary/b2"}

	var got []string
	_, err := cfg.FetchBinaries(context.Background(), ep, tok, urls, func(p []byte) error {
		got = append(got, string(p))
		return nil
	})
	if err != nil {
		t.Fatalf("FetchBinaries: %v", err)
	}
	if hits != 2 || len(got) != 2 {
		t.Fatalf("expected 2 fetched binaries, got hits=%d results=%d", hits, len(got))
	}
	joined := strings.Join(got, "|")
	if !strings.Contains(joined, `"id":"b1"`) || !strings.Contains(joined, `"id":"b2"`) {
		t.Fatalf("missing expected binaries: %s", joined)
	}
}

func TestFetchBinariesSkipsBadAndOversized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fhir+json")
		switch r.URL.Path {
		case "/Binary/ok":
			fmt.Fprint(w, `{"resourceType":"Binary","id":"ok","data":"aGk="}`)
		case "/Binary/forbidden":
			http.Error(w, "nope", http.StatusForbidden)
		case "/Binary/huge":
			// One byte over the cap → must be skipped, not delivered.
			fmt.Fprint(w, strings.Repeat("x", maxBinaryResponseBytes+1))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, HTTPClient: srv.Client()}
	ep := Endpoints{Token: srv.URL + "/token"}
	tok := &oauth2.Token{AccessToken: "t", Expiry: time.Now().Add(time.Hour)}

	urls := []string{
		"Binary/ok",
		"Binary/forbidden",               // 403 → skipped
		"Binary/huge",                    // oversized → skipped
		srv.URL + "/Binary/missing",      // 404 → skipped
		"https://other.example/Binary/x", // different host → skipped (SSRF guard)
		"Condition/123",                  // not a Binary reference → skipped
	}

	var got []string
	if _, err := cfg.FetchBinaries(context.Background(), ep, tok, urls, func(p []byte) error {
		got = append(got, string(p))
		return nil
	}); err != nil {
		t.Fatalf("FetchBinaries: %v", err)
	}
	if len(got) != 1 || !strings.Contains(got[0], `"id":"ok"`) {
		t.Fatalf("best-effort: expected only the one good binary, got %d: %v", len(got), got)
	}
}

func TestResolveBinaryURL(t *testing.T) {
	cfg := Config{FHIRBaseURL: "https://fhir.example/r4"}
	base := "https://fhir.example/r4"
	cases := []struct {
		in      string
		wantURL string
		wantOK  bool
	}{
		{"Binary/abc", "https://fhir.example/r4/Binary/abc", true},
		{"/Binary/abc", "https://fhir.example/r4/Binary/abc", true},
		{"https://fhir.example/r4/Binary/xyz", "https://fhir.example/r4/Binary/xyz", true},
		{"https://evil.example/Binary/xyz", "", false},       // different host
		{"http://localhost/Binary/x", "", false},             // different host + internal
		{"https://fhir.example/r4/Observation/1", "", false}, // same host, not Binary
		{"Condition/123", "", false},                         // relative, not Binary
		{"", "", false},
	}
	for _, tc := range cases {
		gotURL, gotOK := cfg.resolveBinaryURL(base, tc.in)
		if gotOK != tc.wantOK || (tc.wantOK && gotURL != tc.wantURL) {
			t.Errorf("resolveBinaryURL(%q) = (%q,%v), want (%q,%v)", tc.in, gotURL, gotOK, tc.wantURL, tc.wantOK)
		}
	}
}
