package middleware

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newSecurityHeadersEngine(httpsEnabled bool, reportOnlyScriptSrc string, typesensePort string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(SecurityHeadersMiddleware(httpsEnabled, reportOnlyScriptSrc, typesensePort))
	r.GET("/", func(c *gin.Context) { c.String(http.StatusOK, "ok") })
	return r
}

func Test_SecurityHeadersMiddleware(t *testing.T) {
	w := httptest.NewRecorder()
	reportOnly := "script-src 'self' 'sha256-abc'"
	newSecurityHeadersEngine(true, reportOnly, "").ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))

	require.Equal(t, "nosniff", w.Header().Get("X-Content-Type-Options"))
	require.Equal(t, "DENY", w.Header().Get("X-Frame-Options"))
	require.Equal(t, "no-referrer", w.Header().Get("Referrer-Policy"))

	// Enforcing CSP is now set, with the safe directives.
	csp := w.Header().Get("Content-Security-Policy")
	require.Contains(t, csp, "default-src 'self'")
	require.Contains(t, csp, "frame-ancestors 'none'")
	require.Contains(t, csp, "base-uri 'self'")
	require.Contains(t, csp, "object-src 'none'")
	// script-src stays permissive on inline so third-party inline handlers don't break.
	require.Contains(t, csp, "script-src 'self' 'unsafe-inline'")

	// The strict script-src target rides along as report-only (observe-only).
	require.Equal(t, reportOnly, w.Header().Get("Content-Security-Policy-Report-Only"))

	// HSTS present when HTTPS enabled.
	require.Equal(t, "max-age=31536000; includeSubDomains", w.Header().Get("Strict-Transport-Security"))
}

func Test_SecurityHeadersMiddleware_NoHSTSWithoutHTTPS(t *testing.T) {
	w := httptest.NewRecorder()
	newSecurityHeadersEngine(false, "script-src 'self'", "").ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))

	// HSTS must be omitted over plain HTTP.
	require.Empty(t, w.Header().Get("Strict-Transport-Security"))
	// Other headers still present.
	require.Equal(t, "nosniff", w.Header().Get("X-Content-Type-Options"))
	require.NotEmpty(t, w.Header().Get("Content-Security-Policy"))
}

func Test_SecurityHeadersMiddleware_EmptyReportOnlyOmitsHeader(t *testing.T) {
	w := httptest.NewRecorder()
	newSecurityHeadersEngine(true, "", "").ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))

	require.Empty(t, w.Header().Get("Content-Security-Policy-Report-Only"))
	// Enforcing CSP is still set.
	require.NotEmpty(t, w.Header().Get("Content-Security-Policy"))
}

func Test_SecurityHeadersMiddleware_NoTypesensePortLeavesConnectSrcUnchanged(t *testing.T) {
	w := httptest.NewRecorder()
	newSecurityHeadersEngine(true, "", "").ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))

	csp := w.Header().Get("Content-Security-Policy")
	require.Contains(t, csp, "connect-src 'self' https://wallet.hello.coop https://issuer.hello.coop;")
}

func Test_SecurityHeadersMiddleware_TypesensePortAddsRequestHostOrigin(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Host = "example.com:9090"
	newSecurityHeadersEngine(false, "", "8108").ServeHTTP(w, req)

	// Same host the browser used, http (httpsEnabled=false), Typesense's port — matching how
	// typesense.service.ts derives its own target (location.hostname + search.uri's port).
	csp := w.Header().Get("Content-Security-Policy")
	require.Contains(t, csp, "connect-src 'self' https://wallet.hello.coop https://issuer.hello.coop http://example.com:8108;")
}

func Test_SecurityHeadersMiddleware_TypesensePortHonorsHTTPS(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Host = "phr.example.com"
	newSecurityHeadersEngine(true, "", "8108").ServeHTTP(w, req)

	csp := w.Header().Get("Content-Security-Policy")
	require.Contains(t, csp, "https://phr.example.com:8108")
}

func Test_ComputeReportOnlyScriptSrc(t *testing.T) {
	// Two inline scripts (no src) + one external script that must NOT be hashed.
	inlineA := `var baseHref = "/web/";`
	inlineB := `if(!window.customElements){document.write('<!--');}`
	html := []byte(`<!doctype html><html><head>` +
		`<script src="./assets/js/lib.js"></script>` +
		`<script>` + inlineA + `</script>` +
		`<script>` + inlineB + `</script>` +
		`</head><body></body></html>`)

	got := ComputeReportOnlyScriptSrc(html)

	hashOf := func(s string) string {
		sum := sha256.Sum256([]byte(s))
		return "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
	}
	require.Contains(t, got, "script-src 'self'")
	require.Contains(t, got, hashOf(inlineA))
	require.Contains(t, got, hashOf(inlineB))
	// The external <script src> body is empty/not present — only inline blocks are hashed.
	require.Equal(t, 2, countHashes(got))
}

func Test_ComputeReportOnlyScriptSrc_NoInlineScripts(t *testing.T) {
	// No inline scripts → bare self, no hashes (the dev-fallback shape).
	got := ComputeReportOnlyScriptSrc([]byte(`<html><head><script src="x.js"></script></head></html>`))
	require.Equal(t, "script-src 'self'", got)

	// Nil input (index.html absent) → same fallback.
	require.Equal(t, "script-src 'self'", ComputeReportOnlyScriptSrc(nil))
}

func countHashes(policy string) int {
	n := 0
	for i := 0; i+7 <= len(policy); i++ {
		if policy[i:i+7] == "sha256-" {
			n++
		}
	}
	return n
}
