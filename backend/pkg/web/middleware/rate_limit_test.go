package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func Test_RateLimitMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RateLimitMiddleware(2, time.Minute))
	r.GET("/", func(c *gin.Context) { c.String(http.StatusOK, "ok") })

	do := func(ip string) (int, string) {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = ip + ":1111"
		r.ServeHTTP(w, req)
		return w.Code, w.Header().Get("Retry-After")
	}

	// first two requests from an IP are allowed, the third is throttled
	code, _ := do("203.0.113.5")
	require.Equal(t, http.StatusOK, code)
	code, _ = do("203.0.113.5")
	require.Equal(t, http.StatusOK, code)
	code, retryAfter := do("203.0.113.5")
	require.Equal(t, http.StatusTooManyRequests, code)
	require.NotEmpty(t, retryAfter, "429 should advertise Retry-After")

	// a different IP has its own independent bucket
	code, _ = do("198.51.100.9")
	require.Equal(t, http.StatusOK, code)
}
