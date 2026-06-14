package smart

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// A confidential client (ClientSecret set) authenticates the token exchange with the secret.
func TestExchangeCode_ConfidentialClientSendsSecret(t *testing.T) {
	var user, pass string
	var ok bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok = r.BasicAuth()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"at","token_type":"Bearer","expires_in":3600}`))
	}))
	defer srv.Close()

	cfg := Config{ClientID: "cid", ClientSecret: "shh-secret", HTTPClient: srv.Client()}
	if _, err := cfg.ExchangeCode(context.Background(), Endpoints{Token: srv.URL}, "code", "verifier"); err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if !ok || user != "cid" || pass != "shh-secret" {
		t.Errorf("confidential client should send client_secret (Basic auth); got user=%q pass=%q ok=%v", user, pass, ok)
	}
}

// A public client (no ClientSecret) never sends a secret value at the token endpoint.
func TestExchangeCode_PublicClientSendsNoSecret(t *testing.T) {
	var pass string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, pass, _ = r.BasicAuth()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"at","token_type":"Bearer","expires_in":3600}`))
	}))
	defer srv.Close()

	cfg := Config{ClientID: "cid", HTTPClient: srv.Client()} // no secret
	if _, err := cfg.ExchangeCode(context.Background(), Endpoints{Token: srv.URL}, "code", "verifier"); err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if pass != "" {
		t.Errorf("public client must not send a client_secret; got pass=%q", pass)
	}
}
