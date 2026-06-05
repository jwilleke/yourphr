package ssrf

import "testing"

func TestValidatePublicHTTPSURL(t *testing.T) {
	cases := []struct {
		name    string
		url     string
		wantErr bool
	}{
		// rejected: non-https scheme
		{"http scheme", "http://example.com", true},
		{"no scheme", "example.com", true},
		{"ftp scheme", "ftp://example.com", true},
		{"empty", "", true},
		// rejected: SSRF targets by literal IP
		{"loopback v4", "https://127.0.0.1/fhir", true},
		{"loopback name", "https://localhost/fhir", true},
		{"loopback v6", "https://[::1]/fhir", true},
		{"private 10", "https://10.0.0.5/fhir", true},
		{"private 192.168", "https://192.168.1.10/fhir", true},
		{"private 172.16", "https://172.16.0.1/fhir", true},
		{"link-local metadata", "https://169.254.169.254/latest/meta-data", true},
		{"unspecified", "https://0.0.0.0/fhir", true},
		{"unique-local v6", "https://[fd00::1]/fhir", true},
		// allowed: public literal IPs
		{"public v4 literal", "https://8.8.8.8/fhir", false},
		{"public v6 literal", "https://[2001:4860:4860::8888]/fhir", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePublicHTTPSURL(tc.url)
			if tc.wantErr && err == nil {
				t.Errorf("expected error for %q, got nil", tc.url)
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error for %q: %v", tc.url, err)
			}
		})
	}
}

// A public hostname should pass (resolves to public IPs). Network-dependent; skip in -short.
func TestValidatePublicHTTPSURL_PublicHostname(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping DNS-dependent test in -short mode")
	}
	if err := ValidatePublicHTTPSURL("https://launch.smarthealthit.org/v/r4/fhir"); err != nil {
		t.Errorf("expected the public SMART sandbox host to pass, got: %v", err)
	}
}
