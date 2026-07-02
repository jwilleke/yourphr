package rxterms

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestResolver_Resolve(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		switch r.URL.Path {
		case "/313782/allinfo.json":
			w.Write([]byte(`{"rxtermsProperties":{"displayName":"Acetaminophen (Oral Pill)","strength":"325 mg"}}`))
		case "/111111/allinfo.json":
			w.Write([]byte(`{"rxtermsProperties":{"displayName":"Something (Oral Pill)","strength":""}}`)) // no strength
		case "/999999/allinfo.json":
			w.Write([]byte(`{"rxtermsProperties":{"displayName":null,"strength":null}}`)) // no RxTerms entry
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	r := &Resolver{client: srv.Client(), baseURL: srv.URL, cache: map[string]apiResult{}}
	ctx := context.Background()

	if n, s := r.Resolve(ctx, "313782"); n != "Acetaminophen (Oral Pill)" || s != "325 mg" {
		t.Errorf("Resolve(313782) = (%q, %q), want (%q, %q)", n, s, "Acetaminophen (Oral Pill)", "325 mg")
	}
	if n, s := r.Resolve(ctx, "111111"); n != "Something (Oral Pill)" || s != "" {
		t.Errorf("Resolve(111111) = (%q, %q), want name only", n, s)
	}
	// empty rxcui, no-entry, and unknown all resolve to empty (caller falls back to the raw title)
	if n, s := r.Resolve(ctx, ""); n != "" || s != "" {
		t.Errorf("Resolve(empty) = (%q, %q), want empty", n, s)
	}
	if n, s := r.Resolve(ctx, "999999"); n != "" || s != "" {
		t.Errorf("Resolve(no-entry) = (%q, %q), want empty", n, s)
	}

	// Cache: repeat lookups (hit + negative) do not re-hit the server.
	before := atomic.LoadInt32(&hits)
	_, _ = r.Resolve(ctx, "313782")
	_, _ = r.Resolve(ctx, "999999")
	if after := atomic.LoadInt32(&hits); after != before {
		t.Errorf("expected cached lookups (no new server hits), got %d extra", after-before)
	}
}

func TestResolver_ServerError_FallsBackEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	r := &Resolver{client: srv.Client(), baseURL: srv.URL, cache: map[string]apiResult{}}
	if n, s := r.Resolve(context.Background(), "313782"); n != "" || s != "" {
		t.Errorf("on server error Resolve = (%q, %q), want empty", n, s)
	}
}
