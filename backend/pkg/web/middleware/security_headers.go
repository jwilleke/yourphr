package middleware

import (
	"github.com/gin-gonic/gin"
)

// SecurityHeadersMiddleware sets baseline security response headers (issue #105 / H4).
//
// The Content-Security-Policy is sent in REPORT-ONLY mode to start: browsers report
// violations (to the console) without blocking, so we can observe and tighten without
// risking the Angular SPA. Flip Content-Security-Policy-Report-Only to
// Content-Security-Policy once the policy is verified clean. A strict CSP also shrinks
// the XSS surface for the localStorage-stored token (issue #103 / H2).
//
// HSTS is only emitted when HTTPS is enabled (it's meaningless/inappropriate over plain HTTP).
func SecurityHeadersMiddleware(httpsEnabled bool) gin.HandlerFunc {
	const cspReportOnly = "default-src 'self'; " +
		"script-src 'self'; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data:; " +
		"font-src 'self' data:; " +
		"connect-src 'self'; " +
		"object-src 'none'; " +
		"frame-ancestors 'none'; " +
		"base-uri 'self'; " +
		"form-action 'self'"

	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy-Report-Only", cspReportOnly)
		if httpsEnabled {
			// HTTPS is on by default (web.listen.https.enabled). 1 year, include subdomains.
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		c.Next()
	}
}
