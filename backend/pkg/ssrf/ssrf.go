// Package ssrf provides a guard against Server-Side Request Forgery for the SMART on FHIR
// connect flow, where the backend fetches a user-supplied FHIR base URL (SMART discovery,
// token exchange). Without validation an authenticated user could point the server at internal
// targets (cloud metadata 169.254.169.254, localhost, RFC1918/LAN services). EPIC #20, #51.
package ssrf

import (
	"errors"
	"fmt"
	"net"
	"net/url"
)

// ValidatePublicHTTPSURL returns an error unless rawURL is a safe, public https URL to fetch
// server-side: the scheme must be https and the host must resolve exclusively to public IP
// addresses (no loopback, private/RFC1918, link-local incl. the 169.254.169.254 metadata
// endpoint, unique-local IPv6, unspecified, or multicast).
//
// Note: this is a point-in-time check; it does not by itself defeat DNS rebinding (the address
// could change between this lookup and the actual request). It blocks the common SSRF targets
// and rejects literal-IP and resolved-private hosts up front.
func ValidatePublicHTTPSURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "https" {
		return fmt.Errorf("URL must use https (got %q)", u.Scheme)
	}
	host := u.Hostname()
	if host == "" {
		return errors.New("URL has no host")
	}

	// Literal IP host: validate directly.
	if ip := net.ParseIP(host); ip != nil {
		if !isPublicIP(ip) {
			return fmt.Errorf("host resolves to a non-public address (%s)", ip)
		}
		return nil
	}

	// Hostname: resolve and require every address to be public.
	ips, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("could not resolve host %q: %w", host, err)
	}
	if len(ips) == 0 {
		return fmt.Errorf("host %q resolved to no addresses", host)
	}
	for _, ip := range ips {
		if !isPublicIP(ip) {
			return fmt.Errorf("host %q resolves to a non-public address (%s)", host, ip)
		}
	}
	return nil
}

// isPublicIP reports whether ip is a globally routable, non-special address.
func isPublicIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return false
	}
	return true
}
