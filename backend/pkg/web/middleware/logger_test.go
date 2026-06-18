package middleware

import "testing"

// The admin log endpoints must be excluded from request/response body logging: their responses
// contain the in-memory log buffer, so body-logging them feeds the buffer into itself and OOM-kills
// the backend under the live-tail poll (#170). Everything else is body-logged as normal.
func TestIsLogEndpoint(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"/api/secure/admin/logs", true},
		{"/api/secure/admin/log-level", true},
		{"/web/api/secure/admin/logs", true}, // path may carry a prefix
		{"/api/secure/admin/users", false},
		{"/api/secure/source/connect", false},
		{"/api/secure/summary", false},
		{"/healthz", false},
	}
	for _, tc := range cases {
		if got := isLogEndpoint(tc.path); got != tc.want {
			t.Errorf("isLogEndpoint(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}
