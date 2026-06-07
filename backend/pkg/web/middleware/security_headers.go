package middleware

import (
	"github.com/gin-gonic/gin"
)

// SecurityHeadersMiddleware sets baseline security response headers (issue #105 / H4).
//
// The Content-Security-Policy is now ENFORCING (#124). script-src is 'self' plus the
// sha256 hashes of the TWO inline bootstrap scripts in frontend/src/index.html (the
// base-href document.write and the lforms web-components guard) — these MUST stay inline
// (they run at parse time, before any path resolution; externalizing them broke the SPA,
// see #113/#120), so they're allowlisted by hash rather than 'unsafe-inline'. Injected
// XSS scripts don't match a hash and are blocked, which is the point (mitigates #103 / H2).
//
// ⚠️ If you change those two inline scripts in index.html, recompute the hashes:
//     ng build --configuration prod && \
//       python3 -c "import re,hashlib,base64; \
//       [print(base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode()) \
//        for m in re.finditer(r'<script>(.*?)</script>', open('dist/index.html').read(), re.S)]"
// CI's frontend build + a browser load of /web will surface a mismatch (Refused to execute script).
//
// HSTS is only emitted when HTTPS is enabled (it's meaningless/inappropriate over plain HTTP).
func SecurityHeadersMiddleware(httpsEnabled bool) gin.HandlerFunc {
	const csp = "default-src 'self'; " +
		// 'self' covers the external bundle <script src> tags; the two hashes cover the inline
		// base-href + lforms-guard scripts in index.html. No 'unsafe-inline' / 'unsafe-eval'.
		"script-src 'self' " +
		"'sha256-66XQUkhTW0mJAnGLOcEJ+ZrMYP6xzzd+nBhkCIhMRfs=' " +
		"'sha256-EnWZB+H8Xi93JCSc60kULXY0GNKwlFD9qPYdrZjKq54='; " +
		"style-src 'self' 'unsafe-inline'; " + // Angular emits inline component styles
		"img-src 'self' data: https:; " + // external images referenced in imported FHIR records
		"font-src 'self' data:; " +
		"connect-src 'self' https://wallet.hello.coop https://issuer.hello.coop; " + // IdpConnect
		"object-src 'none'; " +
		"frame-ancestors 'none'; " +
		"base-uri 'self'; " +
		"form-action 'self'"

	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", csp)
		if httpsEnabled {
			// HTTPS is on by default (web.listen.https.enabled). 1 year, include subdomains.
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		c.Next()
	}
}
