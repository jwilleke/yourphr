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

// collectPages runs FetchPatientData and gathers the pages streamed through the onPage callback, so the
// existing (pages, refreshed, err) assertions keep working after the streaming refactor (#341).
func collectPages(cfg Config, ep Endpoints, patientID string) ([][]byte, *oauth2.Token, error) {
	var pages [][]byte
	refreshed, err := cfg.FetchPatientData(context.Background(), ep, freshToken(), patientID, func(p []byte) error {
		pages = append(pages, p)
		return nil
	})
	return pages, refreshed, err
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

	cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, ClientID: "c", HTTPClient: srv.Client()}
	pages, _, err := collectPages(cfg, Endpoints{Token: srv.URL + "/token"}, "bene123")
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

// Epic advertises resource types it then refuses for our search, in several ways: 403 (scope not
// granted, e.g. AdverseEvent), 400 (CarePlan "requires a category for searching"), 404 (no data).
// None of these may fail the whole import — each inaccessible type is skipped and the rest still load.
func TestFetchPatientData_SkipsInaccessibleResourceTypes(t *testing.T) {
	const meta = `{"resourceType":"CapabilityStatement","rest":[{"resource":[
		{"type":"Patient","interaction":[{"code":"read"}],"searchParam":[{"name":"_id"}]},
		{"type":"AdverseEvent","interaction":[{"code":"search-type"}],"searchParam":[{"name":"patient"}]},
		{"type":"CarePlan","interaction":[{"code":"search-type"}],"searchParam":[{"name":"patient"}]},
		{"type":"Observation","interaction":[{"code":"search-type"}],"searchParam":[{"name":"patient"}]},
		{"type":"Immunization","interaction":[{"code":"search-type"}],"searchParam":[{"name":"patient"}]}
	]}]}`

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fhir+json")
		switch r.URL.Path {
		case "/metadata":
			fmt.Fprint(w, meta)
		case "/Patient/p1":
			fmt.Fprint(w, `{"resourceType":"Patient","id":"p1"}`)
		case "/AdverseEvent":
			w.WriteHeader(http.StatusForbidden) // scope not granted — Epic returns 403
			fmt.Fprint(w, `{"resourceType":"OperationOutcome"}`)
		case "/CarePlan":
			w.WriteHeader(http.StatusBadRequest) // Epic: "this resource requires a category for searching"
			fmt.Fprint(w, `{"resourceType":"OperationOutcome"}`)
		case "/Immunization":
			w.WriteHeader(http.StatusNotFound) // some servers 404 a type with no data
		case "/Observation":
			fmt.Fprint(w, `{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Observation","id":"o1"}}]}`)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()

	cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, ClientID: "c", HTTPClient: srv.Client()}
	pages, _, err := collectPages(cfg, Endpoints{Token: srv.URL + "/token"}, "p1")
	if err != nil {
		t.Fatalf("FetchPatientData must not fail on an inaccessible resource type: %v", err)
	}
	// Patient + Observation succeed; AdverseEvent (403), CarePlan (400), Immunization (404) are skipped.
	if len(pages) != 2 {
		t.Fatalf("expected 2 pages (Patient + Observation), got %d", len(pages))
	}
}

// A 401 means auth itself is broken (every remaining type would fail too), so it stays fatal.
func TestFetchPatientData_UnauthorizedIsFatal(t *testing.T) {
	const meta = `{"resourceType":"CapabilityStatement","rest":[{"resource":[
		{"type":"Patient","interaction":[{"code":"read"}],"searchParam":[{"name":"_id"}]},
		{"type":"Observation","interaction":[{"code":"search-type"}],"searchParam":[{"name":"patient"}]}
	]}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fhir+json")
		switch r.URL.Path {
		case "/metadata":
			fmt.Fprint(w, meta)
		case "/Patient/p1":
			fmt.Fprint(w, `{"resourceType":"Patient","id":"p1"}`)
		case "/Observation":
			w.WriteHeader(http.StatusUnauthorized)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()

	cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, ClientID: "c", HTTPClient: srv.Client()}
	if _, _, err := collectPages(cfg, Endpoints{Token: srv.URL + "/token"}, "p1"); err == nil {
		t.Fatal("expected a 401 during fetch to be fatal, got nil error")
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

	cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, ClientID: "c", HTTPClient: srv.Client()}
	if _, _, err := collectPages(cfg, Endpoints{Token: srv.URL + "/token"}, "p1"); err != nil {
		t.Fatalf("FetchPatientData: %v", err)
	}
	if !hitEverything {
		t.Error("expected $everything to be used when the server advertises it")
	}
}

// A server that advertises Patient/$everything but then ERRORS on it must NOT fail the import — it
// degrades to a per-resource search built from the same CapabilityStatement (#341). Cerner is the
// real example: $everything is advertised but unusable for a patient-standalone token.
func TestFetchPatientData_EverythingFailsFallsBackToPerResource(t *testing.T) {
	const meta = `{"resourceType":"CapabilityStatement","rest":[{"resource":[
		{"type":"Patient","operation":[{"name":"everything"}],"interaction":[{"code":"read"}],"searchParam":[{"name":"_id"}]},
		{"type":"Condition","interaction":[{"code":"search-type"}],"searchParam":[{"name":"patient"}]}
	]}]}`
	var triedEverything, triedPerResource bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fhir+json")
		switch r.URL.Path {
		case "/metadata":
			fmt.Fprint(w, meta)
		case "/Patient/p1/$everything":
			triedEverything = true
			w.WriteHeader(http.StatusBadRequest) // $everything not usable for this patient
			fmt.Fprint(w, `{"resourceType":"OperationOutcome"}`)
		case "/Patient/p1":
			triedPerResource = true
			fmt.Fprint(w, `{"resourceType":"Patient","id":"p1"}`)
		case "/Condition":
			fmt.Fprint(w, `{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Condition","id":"c1"}}]}`)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()

	cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, ClientID: "c", HTTPClient: srv.Client()}
	pages, _, err := collectPages(cfg, Endpoints{Token: srv.URL + "/token"}, "p1")
	if err != nil {
		t.Fatalf("a failed $everything must fall back, not fail the import: %v", err)
	}
	if !triedEverything || !triedPerResource {
		t.Fatalf("expected $everything tried then per-resource fallback (everything=%v perResource=%v)", triedEverything, triedPerResource)
	}
	if len(pages) != 2 { // Patient + Condition
		t.Fatalf("expected 2 pages from the fallback, got %d", len(pages))
	}
}

// When the CapabilityStatement can't be read AND $everything fails, degrade to the default
// patient-compartment search so we still import what we can rather than fail fully empty (#341).
func TestFetchPatientData_MetadataUnreadable_UsesDefaultCompartment(t *testing.T) {
	var gotCondition bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fhir+json")
		switch r.URL.Path {
		case "/metadata":
			w.WriteHeader(http.StatusInternalServerError) // capability unreadable
		case "/Patient/p1/$everything":
			w.WriteHeader(http.StatusNotFound) // not supported either
		case "/Patient/p1":
			fmt.Fprint(w, `{"resourceType":"Patient","id":"p1"}`)
		case "/Condition":
			gotCondition = true
			fmt.Fprint(w, `{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Condition","id":"c1"}}]}`)
		default:
			// every other default-compartment type returns an empty bundle (no data) — fine
			fmt.Fprint(w, `{"resourceType":"Bundle","entry":[]}`)
		}
	}))
	defer srv.Close()

	cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, ClientID: "c", HTTPClient: srv.Client()}
	pages, _, err := collectPages(cfg, Endpoints{Token: srv.URL + "/token"}, "p1")
	if err != nil {
		t.Fatalf("metadata-unreadable + $everything-fail must degrade to defaults, not fail: %v", err)
	}
	if !gotCondition {
		t.Fatal("expected the default compartment search to query Condition")
	}
	if len(pages) == 0 {
		t.Fatal("expected the default compartment search to import at least Patient + Condition")
	}
}

// A transient 504 on a resource is RETRIED, not immediately skipped — the second attempt succeeds and
// the resource imports (#341, Cerner's flaky gateway timeouts).
func TestFetchPatientData_RetriesTransient504(t *testing.T) {
	const meta = `{"resourceType":"CapabilityStatement","rest":[{"resource":[
		{"type":"Patient","interaction":[{"code":"read"}],"searchParam":[{"name":"_id"}]},
		{"type":"Condition","interaction":[{"code":"search-type"}],"searchParam":[{"name":"patient"}]}
	]}]}`
	var conditionAttempts int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fhir+json")
		switch r.URL.Path {
		case "/metadata":
			fmt.Fprint(w, meta)
		case "/Patient/p1":
			fmt.Fprint(w, `{"resourceType":"Patient","id":"p1"}`)
		case "/Condition":
			conditionAttempts++
			if conditionAttempts == 1 {
				w.WriteHeader(http.StatusGatewayTimeout) // transient 504 on the first attempt
				fmt.Fprint(w, `{"code":504,"message":"Gateway Timeout"}`)
				return
			}
			fmt.Fprint(w, `{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Condition","id":"c1"}}]}`)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()

	cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, ClientID: "c", HTTPClient: srv.Client()}
	pages, _, err := collectPages(cfg, Endpoints{Token: srv.URL + "/token"}, "p1")
	if err != nil {
		t.Fatalf("FetchPatientData: %v", err)
	}
	if conditionAttempts < 2 {
		t.Fatalf("expected Condition to be retried after a 504, got %d attempt(s)", conditionAttempts)
	}
	if len(pages) != 2 { // Patient + Condition (recovered on retry)
		t.Fatalf("expected 2 pages (Patient + retried Condition), got %d", len(pages))
	}
}

// A transiently-failed resource is retried AFTER the rest (deferred to a second pass), not inline — so
// a slow/flaky resource never blocks the others. Here CareTeam 504s first, gets deferred, and is only
// re-attempted after Condition (which sorts later) has already been fetched (#341).
func TestFetchPatientData_DefersRetryToEnd(t *testing.T) {
	const meta = `{"resourceType":"CapabilityStatement","rest":[{"resource":[
		{"type":"Patient","interaction":[{"code":"read"}],"searchParam":[{"name":"_id"}]},
		{"type":"CareTeam","interaction":[{"code":"search-type"}],"searchParam":[{"name":"patient"}]},
		{"type":"Condition","interaction":[{"code":"search-type"}],"searchParam":[{"name":"patient"}]}
	]}]}`
	var order []string
	var careTeamAttempts int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fhir+json")
		switch r.URL.Path {
		case "/metadata":
			fmt.Fprint(w, meta)
		case "/Patient/p1":
			order = append(order, "Patient")
			fmt.Fprint(w, `{"resourceType":"Patient","id":"p1"}`)
		case "/CareTeam":
			careTeamAttempts++
			order = append(order, fmt.Sprintf("CareTeam#%d", careTeamAttempts))
			if careTeamAttempts == 1 {
				w.WriteHeader(http.StatusGatewayTimeout) // 504 first time -> deferred
				fmt.Fprint(w, `{"code":504}`)
				return
			}
			fmt.Fprint(w, `{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"CareTeam","id":"ct1"}}]}`)
		case "/Condition":
			order = append(order, "Condition")
			fmt.Fprint(w, `{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Condition","id":"c1"}}]}`)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()

	cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, ClientID: "c", HTTPClient: srv.Client()}
	pages, _, err := collectPages(cfg, Endpoints{Token: srv.URL + "/token"}, "p1")
	if err != nil {
		t.Fatalf("FetchPatientData: %v", err)
	}
	if len(pages) != 3 { // Patient + Condition + CareTeam (on retry)
		t.Fatalf("expected 3 pages, got %d", len(pages))
	}
	// Deferral proof: Condition (pass 1) must be queried BEFORE the CareTeam retry (pass 2).
	want := []string{"Patient", "CareTeam#1", "Condition", "CareTeam#2"}
	if strings.Join(order, ",") != strings.Join(want, ",") {
		t.Errorf("request order = %v, want %v (CareTeam retry should be deferred to after Condition)", order, want)
	}
}

// Pages stream as they arrive, so a later FATAL error (401) keeps everything already delivered — the
// import is incremental, not all-or-nothing (#341).
func TestFetchPatientData_StreamsPagesBeforeFatalError(t *testing.T) {
	const meta = `{"resourceType":"CapabilityStatement","rest":[{"resource":[
		{"type":"Patient","interaction":[{"code":"read"}],"searchParam":[{"name":"_id"}]},
		{"type":"Condition","interaction":[{"code":"search-type"}],"searchParam":[{"name":"patient"}]}
	]}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fhir+json")
		switch r.URL.Path {
		case "/metadata":
			fmt.Fprint(w, meta)
		case "/Patient/p1":
			fmt.Fprint(w, `{"resourceType":"Patient","id":"p1"}`)
		case "/Condition":
			w.WriteHeader(http.StatusUnauthorized) // token died mid-import → fatal
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()

	cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, ClientID: "c", HTTPClient: srv.Client()}
	var streamed [][]byte
	_, err := cfg.FetchPatientData(context.Background(), Endpoints{Token: srv.URL + "/token"}, freshToken(), "p1", func(p []byte) error {
		streamed = append(streamed, p)
		return nil
	})
	if err == nil {
		t.Fatal("expected the mid-import 401 to be fatal")
	}
	if len(streamed) != 1 || !strings.Contains(string(streamed[0]), "Patient") {
		t.Fatalf("expected the Patient page to have streamed BEFORE the fatal 401 (incremental), got %d page(s)", len(streamed))
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

	cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, ClientID: "c", HTTPClient: srv.Client()}
	pages, _, err := collectPages(cfg, Endpoints{Token: srv.URL + "/token"}, "p1")
	if err != nil {
		t.Fatalf("FetchPatientData: %v", err)
	}
	if len(pages) != 2 {
		t.Errorf("expected 2 paginated pages, got %d", len(pages))
	}
}

// DiscoverPatientID resolves the patient id when the token had no `patient` context. CMS Blue Button
// 2.0 401s on /Patient unless the app collects demographic data, so the id is read from Coverage /
// ExplanationOfBenefit references first, falling back to /Patient.
func TestDiscoverPatientID(t *testing.T) {
	const bene = "-20140000008325"
	cases := []struct {
		name    string
		handler func(w http.ResponseWriter, r *http.Request)
	}{
		{
			name: "from Coverage beneficiary reference",
			handler: func(w http.ResponseWriter, r *http.Request) {
				if strings.HasPrefix(r.URL.Path, "/Coverage") {
					fmt.Fprintf(w, `{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Coverage","id":"c1","beneficiary":{"reference":"Patient/%s"}}}]}`, bene)
					return
				}
				w.WriteHeader(http.StatusNotFound)
			},
		},
		{
			name: "from EOB patient reference (full-URL form), Coverage empty",
			handler: func(w http.ResponseWriter, r *http.Request) {
				switch {
				case strings.HasPrefix(r.URL.Path, "/Coverage"):
					fmt.Fprint(w, `{"resourceType":"Bundle","entry":[]}`)
				case strings.HasPrefix(r.URL.Path, "/ExplanationOfBenefit"):
					fmt.Fprintf(w, `{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"ExplanationOfBenefit","id":"e1","patient":{"reference":"https://x/v2/fhir/Patient/%s"}}}]}`, bene)
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			},
		},
		{
			name: "Coverage/EOB 401, fall back to bare Patient",
			handler: func(w http.ResponseWriter, r *http.Request) {
				switch {
				case strings.HasPrefix(r.URL.Path, "/Coverage"), strings.HasPrefix(r.URL.Path, "/ExplanationOfBenefit"):
					w.WriteHeader(http.StatusUnauthorized)
				case r.URL.Path == "/Patient":
					fmt.Fprintf(w, `{"resourceType":"Patient","id":"%s"}`, bene)
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/fhir+json")
				tc.handler(w, r)
			}))
			defer srv.Close()

			cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, ClientID: "c", HTTPClient: srv.Client()}
			got, err := cfg.DiscoverPatientID(context.Background(), Endpoints{Token: srv.URL + "/token"}, freshToken())
			if err != nil {
				t.Fatalf("DiscoverPatientID: %v", err)
			}
			if got != bene {
				t.Fatalf("got %q want %q", got, bene)
			}
		})
	}
}

// All sources reachable but empty → an error, never a silent empty id.
func TestDiscoverPatientID_NoneFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fhir+json")
		fmt.Fprint(w, `{"resourceType":"Bundle","entry":[]}`)
	}))
	defer srv.Close()
	cfg := Config{FHIRBaseURL: srv.URL, AllowInternalHosts: true, ClientID: "c", HTTPClient: srv.Client()}
	if _, err := cfg.DiscoverPatientID(context.Background(), Endpoints{Token: srv.URL + "/token"}, freshToken()); err == nil {
		t.Fatal("expected an error when no patient id is found anywhere")
	}
}
