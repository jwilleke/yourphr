// Command relay is the YourPHR SMART on FHIR OAuth store-and-poll relay (EPIC #20, issue #50).
//
// It is a small, stateless public bouncer for the SMART authorization code: the provider
// redirects the user's browser to /callback with ?code&state; the relay stores {state -> code}
// in memory with a short TTL; the (possibly non-public) YourPHR instance polls
// /pending?state= (gated by a shared secret) to retrieve the code and completes the token
// exchange itself. The relay never sees access/refresh tokens and holds no provider app
// registration — it is provider-agnostic and client-agnostic (per-user/BYO model).
//
// See docs/planning/smart-on-fhir/oauth-gateway.md.
package main

import (
	"crypto/subtle"
	"encoding/json"
	"html"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

const defaultTTL = 60 * time.Second

type codeEntry struct {
	code   string
	expiry time.Time
}

// store is an in-memory, TTL'd map of OAuth state -> authorization code. Safe for concurrent use.
type store struct {
	mu      sync.Mutex
	entries map[string]codeEntry
	ttl     time.Duration
	now     func() time.Time // injectable for tests
}

func newStore(ttl time.Duration) *store {
	return &store{entries: map[string]codeEntry{}, ttl: ttl, now: time.Now}
}

func (s *store) put(state, code string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[state] = codeEntry{code: code, expiry: s.now().Add(s.ttl)}
}

// take returns the code for state and removes it. ok is false if missing or expired.
func (s *store) take(state string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[state]
	if !ok {
		return "", false
	}
	delete(s.entries, state)
	if s.now().After(e.expiry) {
		return "", false
	}
	return e.code, true
}

func (s *store) evictExpired() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for k, e := range s.entries {
		if now.After(e.expiry) {
			delete(s.entries, k)
		}
	}
}

// newServer builds the relay HTTP handler. secret gates /pending; ttl is the code lifetime.
// The returned *store is exposed for tests (TTL injection) and the background janitor.
func newServer(secret string, ttl time.Duration) (http.Handler, *store) {
	st := newStore(ttl)
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// /callback: the provider redirects the user's browser here with ?code&state. Open by
	// design (the provider must reach it); it only stores a short-lived code keyed by state.
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if e := q.Get("error"); e != "" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("<!doctype html><h1>Authorization failed</h1><p>" +
				html.EscapeString(e+" "+q.Get("error_description")) + "</p>"))
			return
		}
		code, state := q.Get("code"), q.Get("state")
		if code == "" || state == "" {
			http.Error(w, "missing code or state", http.StatusBadRequest)
			return
		}
		st.put(state, code)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<!doctype html><h1>Connected</h1>" +
			"<p>You may close this window and return to YourPHR.</p>"))
	})

	// /pending: the YourPHR instance polls here (shared-secret gated) to retrieve the code.
	mux.HandleFunc("/pending", func(w http.ResponseWriter, r *http.Request) {
		if !secretEqual(r.Header.Get("X-Yourphr-Token"), secret) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		state := r.URL.Query().Get("state")
		if state == "" {
			http.Error(w, "missing state", http.StatusBadRequest)
			return
		}
		code, ok := st.take(state)
		if !ok {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
	})

	return mux, st
}

// secretEqual is a constant-time comparison that also rejects an empty configured secret.
func secretEqual(got, want string) bool {
	if want == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func main() {
	secret := os.Getenv("YOURPHR_RELAY_SECRET")
	if secret == "" {
		log.Fatal("YOURPHR_RELAY_SECRET is required")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	handler, st := newServer(secret, defaultTTL)

	// Background janitor: evict expired codes so the map cannot grow unbounded.
	go func() {
		t := time.NewTicker(defaultTTL)
		defer t.Stop()
		for range t.C {
			st.evictExpired()
		}
	}()

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("yourphr relay listening on :%s (code TTL %s)", port, defaultTTL)
	log.Fatal(srv.ListenAndServe())
}
