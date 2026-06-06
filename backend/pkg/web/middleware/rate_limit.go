package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type rateLimitEntry struct {
	count       int
	windowStart time.Time
}

// RateLimitMiddleware throttles requests per client IP using a fixed window, to blunt
// online password guessing against the auth endpoints (#104 / H3). It's a brute-force
// backstop, not a precise limiter — bcrypt already slows each attempt; this caps how
// many an IP can make per window, and effectively locks that IP out for the remainder
// of the window once exceeded (HTTP 429 + Retry-After).
//
// No background goroutine (safe to construct on every Setup()/Reinitialize()); memory
// is bounded by opportunistic sweeping of expired entries.
//
// NOTE: the client IP comes from gin's c.ClientIP(), which honors X-Forwarded-For.
// Behind a reverse proxy, configure trusted proxies, or all clients may share the
// proxy's IP (and thus one bucket).
func RateLimitMiddleware(maxRequests int, window time.Duration) gin.HandlerFunc {
	var mu sync.Mutex
	entries := make(map[string]*rateLimitEntry)

	return func(c *gin.Context) {
		ip := c.ClientIP()
		now := time.Now()

		mu.Lock()
		e := entries[ip]
		if e == nil || now.Sub(e.windowStart) >= window {
			e = &rateLimitEntry{windowStart: now}
			entries[ip] = e
		}
		e.count++
		over := e.count > maxRequests
		// Opportunistic cleanup so the map can't grow without bound.
		if len(entries) > 1024 {
			for k, v := range entries {
				if now.Sub(v.windowStart) >= window {
					delete(entries, k)
				}
			}
		}
		mu.Unlock()

		if over {
			c.Header("Retry-After", strconv.Itoa(int(window.Seconds())))
			c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "error": "too many requests, please try again later"})
			c.Abort()
			return
		}
		c.Next()
	}
}
