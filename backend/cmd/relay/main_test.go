package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const testSecret = "test-secret"

func do(t *testing.T, h http.Handler, method, target string, secret string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	if secret != "" {
		req.Header.Set("X-Yourphr-Token", secret)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestCallbackThenPending(t *testing.T) {
	h, _ := newServer(testSecret, defaultTTL)

	if rec := do(t, h, http.MethodGet, "/callback?code=ABC&state=S1", ""); rec.Code != http.StatusOK {
		t.Fatalf("callback: got %d", rec.Code)
	}

	rec := do(t, h, http.MethodGet, "/pending?state=S1", testSecret)
	if rec.Code != http.StatusOK {
		t.Fatalf("pending: got %d", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["code"] != "ABC" {
		t.Errorf("code = %q, want ABC", body["code"])
	}

	// Code is single-use: a second poll must 404.
	if rec2 := do(t, h, http.MethodGet, "/pending?state=S1", testSecret); rec2.Code != http.StatusNotFound {
		t.Errorf("second pending: got %d, want 404", rec2.Code)
	}
}

func TestPendingRequiresSecret(t *testing.T) {
	h, _ := newServer(testSecret, defaultTTL)
	do(t, h, http.MethodGet, "/callback?code=ABC&state=S1", "")

	if rec := do(t, h, http.MethodGet, "/pending?state=S1", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("no secret: got %d, want 401", rec.Code)
	}
	if rec := do(t, h, http.MethodGet, "/pending?state=S1", "wrong"); rec.Code != http.StatusUnauthorized {
		t.Errorf("wrong secret: got %d, want 401", rec.Code)
	}
}

func TestPendingUnknownState(t *testing.T) {
	h, _ := newServer(testSecret, defaultTTL)
	if rec := do(t, h, http.MethodGet, "/pending?state=nope", testSecret); rec.Code != http.StatusNotFound {
		t.Errorf("unknown state: got %d, want 404", rec.Code)
	}
}

func TestCallbackValidation(t *testing.T) {
	h, _ := newServer(testSecret, defaultTTL)
	if rec := do(t, h, http.MethodGet, "/callback?state=S1", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("missing code: got %d, want 400", rec.Code)
	}
	if rec := do(t, h, http.MethodGet, "/callback?error=access_denied&error_description=nope", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("provider error: got %d, want 400", rec.Code)
	}
}

func TestTTLExpiry(t *testing.T) {
	h, st := newServer(testSecret, defaultTTL)
	base := time.Now()
	st.now = func() time.Time { return base }

	do(t, h, http.MethodGet, "/callback?code=ABC&state=S1", "")

	// Advance past the TTL; the code must be treated as expired.
	st.now = func() time.Time { return base.Add(defaultTTL + time.Second) }
	if rec := do(t, h, http.MethodGet, "/pending?state=S1", testSecret); rec.Code != http.StatusNotFound {
		t.Errorf("expired code: got %d, want 404", rec.Code)
	}
}

func TestHealthz(t *testing.T) {
	h, _ := newServer(testSecret, defaultTTL)
	if rec := do(t, h, http.MethodGet, "/healthz", ""); rec.Code != http.StatusOK {
		t.Errorf("healthz: got %d", rec.Code)
	}
}

func TestSecretEqual(t *testing.T) {
	if secretEqual("x", "") {
		t.Error("empty configured secret must never match")
	}
	if !secretEqual("abc", "abc") {
		t.Error("equal secrets should match")
	}
	if secretEqual("abc", "abd") {
		t.Error("different secrets should not match")
	}
}
