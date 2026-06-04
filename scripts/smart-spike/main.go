// Command smart-spike is a throwaway proof-of-flow for SMART on FHIR (EPIC #20, issue #48).
//
// It runs the full standalone patient-launch authorization-code + PKCE flow against a SMART
// sandbox using the SAME libraries the production backend will use (golang.org/x/oauth2 +
// net/http), then fetches Patient/$everything and saves the Bundle. It de-risks the whole
// SMART architecture before we build the real client/relay (#49–#53).
//
// No PHI: point it only at a sandbox with synthetic test patients. The default is the
// SMART Health IT R4 sandbox, which accepts public clients and a loopback redirect, so no
// app registration and no relay are needed for the spike.
//
// Usage:
//
//	go run .
//	go run . -fhir https://launch.smarthealthit.org/v/r4/fhir -client my_web_app -port 8088
//
// A browser opens for the sandbox login / patient picker; everything else is automatic.
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"golang.org/x/oauth2"
)

// smartConfig is the subset of .well-known/smart-configuration we need.
type smartConfig struct {
	AuthorizationEndpoint string   `json:"authorization_endpoint"`
	TokenEndpoint         string   `json:"token_endpoint"`
	ScopesSupported       []string `json:"scopes_supported"`
}

func main() {
	fhirBase := flag.String("fhir", "https://launch.smarthealthit.org/v/r4/fhir", "SMART FHIR base URL (sandbox only)")
	clientID := flag.String("client", "my_web_app", "SMART client_id (the sandbox accepts public clients)")
	scope := flag.String("scope", "launch/patient patient/*.read openid fhirUser offline_access", "space-separated scopes")
	port := flag.Int("port", 8088, "local loopback callback port")
	out := flag.String("out", "bundle.json", "output file for the fetched Bundle")
	flag.Parse()

	ctx := context.Background()
	redirectURI := fmt.Sprintf("http://localhost:%d/callback", *port)

	// 1. Discovery.
	cfg, err := discover(ctx, *fhirBase)
	if err != nil {
		log.Fatalf("discovery failed: %v", err)
	}
	log.Printf("discovered: authorize=%s token=%s", cfg.AuthorizationEndpoint, cfg.TokenEndpoint)

	conf := &oauth2.Config{
		ClientID:    *clientID,
		RedirectURL: redirectURI,
		Scopes:      strings.Fields(*scope),
		Endpoint:    oauth2.Endpoint{AuthURL: cfg.AuthorizationEndpoint, TokenURL: cfg.TokenEndpoint},
	}

	// 2. PKCE verifier + CSRF state.
	verifier := oauth2.GenerateVerifier()
	state, err := randState()
	if err != nil {
		log.Fatalf("generating state: %v", err)
	}
	authURL := conf.AuthCodeURL(state,
		oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("aud", *fhirBase), // SMART requires aud = FHIR base URL
	)

	// 3. Local loopback callback server.
	type result struct {
		code string
		err  error
	}
	resCh := make(chan result, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if e := q.Get("error"); e != "" {
			http.Error(w, "auth error: "+e+" "+q.Get("error_description"), http.StatusBadRequest)
			resCh <- result{err: fmt.Errorf("provider returned error: %s %s", e, q.Get("error_description"))}
			return
		}
		if q.Get("state") != state {
			http.Error(w, "state mismatch", http.StatusBadRequest)
			resCh <- result{err: fmt.Errorf("state mismatch (possible CSRF)")}
			return
		}
		fmt.Fprintln(w, "SMART spike: authorization received. You may close this window.")
		resCh <- result{code: q.Get("code")}
	})
	srv := &http.Server{Handler: mux}
	ln, err := net.Listen("tcp", fmt.Sprintf("localhost:%d", *port))
	if err != nil {
		log.Fatalf("listen on :%d: %v", *port, err)
	}
	go func() { _ = srv.Serve(ln) }()
	defer func() { _ = srv.Close() }()

	// 4. Open the browser for the sandbox login / patient picker.
	log.Printf("opening browser for sandbox login; if it does not open, visit:\n  %s", authURL)
	openBrowser(authURL)

	// 5. Wait for the redirect to deliver the code.
	var code string
	select {
	case res := <-resCh:
		if res.err != nil {
			log.Fatalf("callback: %v", res.err)
		}
		code = res.code
	case <-time.After(5 * time.Minute):
		log.Fatal("timed out waiting for the OAuth callback")
	}

	// 6. Token exchange (PKCE: send the verifier).
	tok, err := conf.Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		log.Fatalf("token exchange failed: %v", err)
	}
	log.Printf("token: type=%s expiry=%s has_refresh=%t", tok.TokenType, tok.Expiry.Format(time.RFC3339), tok.RefreshToken != "")

	// SMART returns the patient id as an extra field on the token response.
	patientID, _ := tok.Extra("patient").(string)
	if patientID == "" {
		log.Fatal("token response has no 'patient' field; cannot call $everything (check the launch/patient scope)")
	}
	log.Printf("patient id: %s", patientID)

	// 7. Fetch Patient/$everything with the bearer token (auto-injected by the oauth2 client).
	client := conf.Client(ctx, tok)
	everythingURL := fmt.Sprintf("%s/Patient/%s/$everything", *fhirBase, patientID)
	log.Printf("GET %s", everythingURL)
	resp, err := client.Get(everythingURL)
	if err != nil {
		log.Fatalf("$everything request failed: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		log.Fatalf("$everything returned HTTP %d: %s", resp.StatusCode, truncate(body, 500))
	}
	if err := os.WriteFile(*out, body, 0o600); err != nil {
		log.Fatalf("writing %s: %v", *out, err)
	}

	var bundle struct {
		ResourceType string            `json:"resourceType"`
		Entry        []json.RawMessage `json:"entry"`
	}
	_ = json.Unmarshal(body, &bundle)
	log.Printf("SUCCESS: wrote %s (%d bytes) — %s with %d entries", *out, len(body), bundle.ResourceType, len(bundle.Entry))
}

// discover fetches and parses {fhirBase}/.well-known/smart-configuration.
func discover(ctx context.Context, fhirBase string) (*smartConfig, error) {
	url := strings.TrimRight(fhirBase, "/") + "/.well-known/smart-configuration"
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("HTTP %d from %s: %s", resp.StatusCode, url, truncate(b, 300))
	}
	var cfg smartConfig
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		return nil, err
	}
	if cfg.AuthorizationEndpoint == "" || cfg.TokenEndpoint == "" {
		return nil, fmt.Errorf("smart-configuration is missing authorization/token endpoints")
	}
	return &cfg, nil
}

func randState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func openBrowser(url string) {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
	case "windows":
		cmd, args = "rundll32", []string{"url.dll,FileProtocolHandler"}
	default:
		cmd = "xdg-open"
	}
	args = append(args, url)
	if err := exec.Command(cmd, args...).Start(); err != nil {
		log.Printf("could not auto-open the browser (%v); open the URL above manually", err)
	}
}

func truncate(b []byte, n int) string {
	if len(b) > n {
		return string(b[:n]) + "..."
	}
	return string(b)
}
