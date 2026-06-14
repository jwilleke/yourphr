package smart

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

func freshToken() *oauth2.Token {
	return &oauth2.Token{AccessToken: "test-access", Expiry: time.Now().Add(time.Hour)}
}

// A CapabilityStatement WITHOUT Patient/$everything (Blue Button 2.0-shaped) routes to a per-resource
// compartment search: Patient read by id, Coverage by beneficiary, ExplanationOfBenefit by patient.
func TestFetchPatientData_BlueButtonStyle_SearchFallback(t *testing.T) {
	const meta = `{"resourceType":"CapabilityStatement","rest":[{"resource":[
		{"type":"Patient","interaction":[{"code":"read"}],"searchParam":[{"name":"_id"}]},
		{"type":"Coverage","interaction":[{"code":"search-type"}],"searchParam":[{"name":"beneficiary"}]},
		{"type":"ExplanationOfBenefit","interaction":[{"code":"search-type"}],"searchParam":[{"name":"patient"}]}
	]}]}`

	var gotPaths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fhir+json")
		switch {
		case r.URL.Path == "/metadata":
			fmt.Fprint(w, meta)
		case r.URL.Path == "/Patient/bene123":
			gotPaths = append(gotPaths, "Patient/bene123")
			fmt.Fprint(w, `{"resourceType":"Patient","id":"bene123"}`)
		case r.URL.Path == "/Coverage":
			gotPaths = append(gotPaths, "Coverage?"+r.URL.Query().Encode())
			fmt.Fprint(w, `{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Coverage","id":"cov1"}}]}`)
		case r.URL.Path == "/ExplanationOfBenefit":
			gotPaths = append(gotPaths, "EOB?"+r.URL.Query().Encode())
			fmt.Fprint(w, `{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"ExplanationOfBenefit","id":"eob1"}}]}`)
		default:
			t.Errorf("unexpected request path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	cfg := Config{FHIRBaseURL: srv.URL, ClientID: "c", HTTPClient: srv.Client()}
	pages, _, err := cfg.FetchPatientData(context.Background(), Endpoints{Token: srv.URL + "/token"}, freshToken(), "bene123")
	if err != nil {
		t.Fatalf("FetchPatientData: %v", err)
	}
	if len(pages) != 3 {
		t.Fatalf("expected 3 pages (Patient + Coverage + EOB), got %d", len(pages))
	}

	sort.Strings(gotPaths)
	want := []string{"Coverage?beneficiary=bene123", "EOB?patient=bene123", "Patient/bene123"}
	if strings.Join(gotPaths, "|") != strings.Join(want, "|") {
		t.Errorf("queried %v, want %v", gotPaths, want)
	}
}

// A CapabilityStatement that DOES advertise Patient/$everything routes to $everything (one call).
func TestFetchPatientData_EverythingSupported_UsesEverything(t *testing.T) {
	const meta = `{"resourceType":"CapabilityStatement","rest":[{"resource":[
		{"type":"Patient","operation":[{"name":"everything"}]}
	]}]}`

	var hitEverything bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fhir+json")
		switch r.URL.Path {
		case "/metadata":
			fmt.Fprint(w, meta)
		case "/Patient/p1/$everything":
			hitEverything = true
			fmt.Fprint(w, `{"resourceType":"Bundle","entry":[]}`)
		default:
			t.Errorf("unexpected path %s — should have used $everything", r.URL.Path)
		}
	}))
	defer srv.Close()

	cfg := Config{FHIRBaseURL: srv.URL, ClientID: "c", HTTPClient: srv.Client()}
	if _, _, err := cfg.FetchPatientData(context.Background(), Endpoints{Token: srv.URL + "/token"}, freshToken(), "p1"); err != nil {
		t.Fatalf("FetchPatientData: %v", err)
	}
	if !hitEverything {
		t.Error("expected $everything to be used when the server advertises it")
	}
}

// Per-resource search follows Bundle "next" pagination.
func TestFetchByCapability_FollowsPagination(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fhir+json")
		switch r.URL.Path {
		case "/metadata":
			fmt.Fprint(w, `{"resourceType":"CapabilityStatement","rest":[{"resource":[{"type":"ExplanationOfBenefit","searchParam":[{"name":"patient"}]}]}]}`)
		case "/ExplanationOfBenefit":
			if r.URL.Query().Get("page") == "2" {
				fmt.Fprint(w, `{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"ExplanationOfBenefit","id":"eob2"}}]}`)
			} else {
				fmt.Fprintf(w, `{"resourceType":"Bundle","link":[{"relation":"next","url":"%s/ExplanationOfBenefit?patient=p1&page=2"}],"entry":[{"resource":{"resourceType":"ExplanationOfBenefit","id":"eob1"}}]}`, srv.URL)
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	cfg := Config{FHIRBaseURL: srv.URL, ClientID: "c", HTTPClient: srv.Client()}
	pages, _, err := cfg.FetchPatientData(context.Background(), Endpoints{Token: srv.URL + "/token"}, freshToken(), "p1")
	if err != nil {
		t.Fatalf("FetchPatientData: %v", err)
	}
	if len(pages) != 2 {
		t.Errorf("expected 2 paginated pages, got %d", len(pages))
	}
}
