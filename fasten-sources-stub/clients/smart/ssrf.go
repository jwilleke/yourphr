package smart

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// validateBaseURL guards the user-supplied FHIR base URL before the backend makes any server-side
// request to it. Because the backend fetches from whatever base a source registers, an unvalidated
// base is a Server-Side Request Forgery (SSRF) vector: it could be aimed at the cloud metadata
// endpoint (169.254.169.254) or an internal RFC1918 service. This is defense-in-depth — in the
// single-user self-hosted model the user controls their own base, but the backend runs with network
// reach the user may not have (k8s, the relay), so we refuse obviously-internal targets.
//
// It accepts only http/https URLs that have a host, and rejects IP-literal hosts in the loopback,
// private, link-local, unique-local, or unspecified ranges (plus the well-known cloud metadata
// addresses) and localhost-ish names. On success it returns the base trimmed of any trailing slash.
//
// It deliberately does NOT resolve DNS: a public name that resolves to a private IP is not caught
// here. Full egress filtering belongs at the network layer; this is the cheap, in-process first line.
//
// allowInternal bypasses the internal-host checks (still validating scheme + host). It is wired only
// to Config.AllowInternalHosts for tests that hit httptest loopback servers — never set in production.
func validateBaseURL(raw string, allowInternal bool) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("FHIR base URL is empty")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("FHIR base URL is not a valid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("FHIR base URL must be http(s), got %q", u.Scheme)
	}
	host := u.Hostname()
	if host == "" {
		return "", fmt.Errorf("FHIR base URL has no host")
	}
	if !allowInternal {
		if isBlockedHostname(host) {
			return "", fmt.Errorf("FHIR base URL host %q is not allowed (internal/loopback)", host)
		}
		if ip := net.ParseIP(host); ip != nil && isBlockedIP(ip) {
			return "", fmt.Errorf("FHIR base URL host %q is a disallowed internal address", host)
		}
	}
	return strings.TrimRight(raw, "/"), nil
}

// isBlockedHostname rejects localhost and the conventional internal-only TLD suffixes.
func isBlockedHostname(host string) bool {
	h := strings.ToLower(strings.TrimSuffix(host, "."))
	if h == "localhost" {
		return true
	}
	for _, suffix := range []string{".localhost", ".local", ".internal"} {
		if strings.HasSuffix(h, suffix) {
			return true
		}
	}
	return false
}

// isBlockedIP rejects IP literals that point inward: loopback, RFC1918/ULA private, link-local
// (which already covers 169.254.0.0/16), and the unspecified address, plus the explicit cloud
// metadata addresses for clarity.
func isBlockedIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return true
	}
	if ip.Equal(net.ParseIP("169.254.169.254")) || ip.Equal(net.ParseIP("fd00:ec2::254")) {
		return true
	}
	return false
}

// safeBaseURL validates c.FHIRBaseURL and returns the trimmed base used to build every outbound
// request. All request builders go through this so the SSRF guard cannot be bypassed.
func (c Config) safeBaseURL() (string, error) {
	return validateBaseURL(c.FHIRBaseURL, c.AllowInternalHosts)
}
