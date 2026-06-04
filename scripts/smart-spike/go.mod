// Standalone module — intentionally separate from the root module so the throwaway
// spike never affects the backend build or `make test-backend` (go test ./...).
module smart-spike

go 1.24.0

require golang.org/x/oauth2 v0.34.0
