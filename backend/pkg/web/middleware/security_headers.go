package middleware

import (
	"crypto/sha256"
	"encoding/base64"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

// cspConnectSrcBase is the fixed part of connect-src (issue #124): the app's own origin, plus
// the two hello.coop endpoints used by the wallet sign-in flow.
const cspConnectSrcBase = "'self' https://wallet.hello.coop https://issuer.hello.coop"

// cspEnforcing is the policy we actually enforce (issue #124). Every directive here is
// safe against the app's runtime DOM — in particular script-src stays permissive on inline
// ('unsafe-inline') because the page contains inline event handlers injected by third-party
// widgets (lforms/dwv) that a hash/nonce script-src cannot cover. It still blocks
// cross-origin script injection, plus base-tag injection, form hijacking, plugins, and
// clickjacking. The high-value XSS vector (session-token theft) is already closed by #103
// (HttpOnly cookie); this is incremental hardening.
//
// connectSrc is built per-request (buildConnectSrc) rather than baked into a constant, because
// the AI-assisted search/chat feature (fasten-onprem#594) has the browser talk to Typesense
// DIRECTLY — typesense.service.ts constructs its client from `location.hostname` plus the port
// from search.uri — so the allowed origin depends on whatever host the browser actually used to
// reach this instance, which a static string can't express.
func cspEnforcing(connectSrc string) string {
	return "default-src 'self'; " +
		"script-src 'self' 'unsafe-inline'; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data: https:; " +
		"font-src 'self' data:; " +
		"connect-src " + connectSrc + "; " +
		"manifest-src 'self'; " +
		"object-src 'none'; " +
		"frame-ancestors 'none'; " +
		"base-uri 'self'; " +
		"form-action 'self'"
}

// buildConnectSrc appends the Typesense origin to connect-src when search is enabled, mirroring
// how the frontend derives it: same hostname the browser used for this request (req.Host, minus
// any port), same scheme as this instance (httpsEnabled), and the port Typesense actually
// listens on (typesensePort, extracted from search.uri at startup). Empty typesensePort (search
// disabled, or search.uri has no parseable port) leaves connect-src unchanged.
func buildConnectSrc(reqHost string, httpsEnabled bool, typesensePort string) string {
	if typesensePort == "" {
		return cspConnectSrcBase
	}
	host := reqHost
	if idx := strings.LastIndex(host, ":"); idx != -1 {
		host = host[:idx]
	}
	if host == "" {
		return cspConnectSrcBase
	}
	scheme := "http"
	if httpsEnabled {
		scheme = "https"
	}
	return cspConnectSrcBase + " " + scheme + "://" + host + ":" + typesensePort
}

// inlineScriptRe matches inline <script> blocks (no attributes on the opening tag, i.e. no
// src=). The browser computes a CSP hash over the exact bytes between the tags, so we capture
// the same span. (?s) lets . span newlines.
var inlineScriptRe = regexp.MustCompile(`(?s)<script>(.*?)</script>`)

// ComputeReportOnlyScriptSrc builds the *report-only* strict script-src target from the
// index.html the backend actually serves: it extracts each inline <script> body, sha256s it,
// and allowlists it by hash. Computing at runtime (vs hardcoding) means the hashes are equal
// to the served bytes by construction and can never drift — the fragility that bit Attempt 2
// (#124). This policy is observe-only, so a wrong/missing hash only yields a console report,
// never a block. With no inline scripts found (e.g. index.html absent in some dev setups) it
// falls back to "script-src 'self'".
func ComputeReportOnlyScriptSrc(indexHTML []byte) string {
	policy := "script-src 'self'"
	for _, m := range inlineScriptRe.FindAllSubmatch(indexHTML, -1) {
		sum := sha256.Sum256(m[1])
		policy += " 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
	}
	return policy
}

// SecurityHeadersMiddleware sets baseline security response headers (#105 / H4) plus a staged
// Content-Security-Policy (#124):
//
//   - Content-Security-Policy (ENFORCING): cspEnforcing — the safe, high-value directives.
//   - Content-Security-Policy-Report-Only: the strict script-src target (reportOnlyScriptSrc,
//     computed by ComputeReportOnlyScriptSrc) — observe-only, so we can see exactly what a
//     fully-strict script-src would block without breaking the app.
//
// reportOnlyScriptSrc is passed in (computed once at startup from the served index.html). If
// empty, the report-only header is omitted.
//
// typesensePort is the port Typesense listens on (extracted from search.uri at startup), or ""
// when search.enabled is false — see buildConnectSrc.
//
// HSTS is only emitted when HTTPS is enabled (meaningless over plain HTTP).
func SecurityHeadersMiddleware(httpsEnabled bool, reportOnlyScriptSrc string, typesensePort string) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		connectSrc := buildConnectSrc(c.Request.Host, httpsEnabled, typesensePort)
		h.Set("Content-Security-Policy", cspEnforcing(connectSrc))
		if reportOnlyScriptSrc != "" {
			h.Set("Content-Security-Policy-Report-Only", reportOnlyScriptSrc)
		}
		if httpsEnabled {
			// HTTPS is on by default (web.listen.https.enabled). 1 year, include subdomains.
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		c.Next()
	}
}
