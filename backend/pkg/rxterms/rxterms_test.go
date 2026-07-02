package rxterms

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestResolver_DisplayName(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		switch r.URL.Path {
		case "/313782/name.json":
			w.Write([]byte(`{"displayGroup":{"rxcui":null,"displayName":"Acetaminophen (Oral Pill)"}}`))
		case "/999999/name.json":
			w.Write([]byte(`{"displayGroup":{"rxcui":null,"displayName":null}}`)) // no RxTerms entry
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	r := &Resolver{client: srv.Client(), baseURL: srv.URL, cache: map[string]string{}}
	ctx := context.Background()

	if got := r.DisplayName(ctx, "313782"); got != "Acetaminophen (Oral Pill)" {
		t.Errorf("DisplayName(313782) = %q, want %q", got, "Acetaminophen (Oral Pill)")
	}
	// empty rxcui, no-entry, and unknown all resolve to "" (caller falls back to the raw title)
	if got := r.DisplayName(ctx, ""); got != "" {
		t.Errorf("DisplayName(empty) = %q, want empty", got)
	}
	if got := r.DisplayName(ctx, "999999"); got != "" {
		t.Errorf("DisplayName(no-entry) = %q, want empty", got)
	}

	// Cache: repeat lookups (hit + negative) do not re-hit the server.
	before := atomic.LoadInt32(&hits)
	_ = r.DisplayName(ctx, "313782")
	_ = r.DisplayName(ctx, "999999")
	if after := atomic.LoadInt32(&hits); after != before {
		t.Errorf("expected cached lookups (no new server hits), got %d extra", after-before)
	}
}

func TestResolver_ServerError_FallsBackEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	r := &Resolver{client: srv.Client(), baseURL: srv.URL, cache: map[string]string{}}
	if got := r.DisplayName(context.Background(), "313782"); got != "" {
		t.Errorf("on server error DisplayName = %q, want empty", got)
	}
}
