package smart

import "testing"

func TestValidateBaseURL_Allows(t *testing.T) {
	cases := []struct{ in, want string }{
		{"https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4", "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4"},
		{"https://sandbox.bluebutton.cms.gov/v2/fhir/", "https://sandbox.bluebutton.cms.gov/v2/fhir"}, // trailing slash trimmed
		{"  https://fhir.example.com/r4  ", "https://fhir.example.com/r4"},                            // whitespace trimmed
		{"https://203.0.113.10/fhir", "https://203.0.113.10/fhir"},                                    // public IP literal ok
	}
	for _, tc := range cases {
		got, err := validateBaseURL(tc.in, false)
		if err != nil {
			t.Errorf("validateBaseURL(%q) unexpected error: %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("validateBaseURL(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestValidateBaseURL_Blocks(t *testing.T) {
	cases := []string{
		"",                                         // empty
		"ftp://fhir.example.com/r4",                // non-http scheme
		"file:///etc/passwd",                       // file scheme
		"gopher://internal/",                       // gopher SSRF classic
		"https:///r4",                              // no host
		"http://localhost:8080/fhir",               // localhost
		"http://LocalHost/fhir",                    // case-insensitive
		"http://fhir.internal/r4",                  // .internal suffix
		"http://service.local/r4",                  // .local suffix
		"http://127.0.0.1/fhir",                    // loopback
		"http://10.0.0.5/fhir",                     // RFC1918
		"http://192.168.1.10/fhir",                 // RFC1918
		"http://172.16.0.1/fhir",                   // RFC1918
		"http://169.254.169.254/latest/meta-data/", // cloud metadata (link-local)
		"http://[::1]/fhir",                        // IPv6 loopback
		"http://[fd00::1]/fhir",                    // IPv6 ULA (private)
		"http://0.0.0.0/fhir",                      // unspecified
	}
	for _, in := range cases {
		if got, err := validateBaseURL(in, false); err == nil {
			t.Errorf("validateBaseURL(%q) = %q, want error", in, got)
		}
	}
}
