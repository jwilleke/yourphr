package smart

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"golang.org/x/oauth2"
)

// Capability-driven fetch (#250). Not every FHIR server supports Patient/$everything — CMS Blue
// Button 2.0, for example, exposes only Patient/Coverage/ExplanationOfBenefit and no operations. For
// those, we read the server's CapabilityStatement and fetch each patient-compartment resource by
// search instead. Servers that do advertise $everything keep using it (one efficient call).

type capNamed struct {
	Name string `json:"name"`
}

type capResource struct {
	Type        string     `json:"type"`
	Operation   []capNamed `json:"operation"`
	SearchParam []capNamed `json:"searchParam"`
}

type capabilityStatement struct {
	Rest []struct {
		Resource []capResource `json:"resource"`
	} `json:"rest"`
}

// patientCompartmentParams maps a resource type to the search parameter(s), in preference order, that
// link it to a Patient. The chosen param must also be advertised by the server's CapabilityStatement.
var patientCompartmentParams = map[string][]string{
	"Coverage":             {"beneficiary", "patient", "subscriber"},
	"ExplanationOfBenefit": {"patient"},
	"Claim":                {"patient"},
}

// defaultPatientParams are tried for resource types not in patientCompartmentParams — most
// patient-compartment clinical resources link via "patient" or "subject".
var defaultPatientParams = []string{"patient", "subject"}

// FetchPatientData fetches all of a patient's data, choosing a strategy from the server's
// CapabilityStatement and DEGRADING GRACEFULLY so one failing strategy never produces a silent empty
// import (#341):
//   - capability readable + advertises Patient/$everything: use $everything; if it errors (anything
//     but 401), fall back to a per-resource compartment search built from the capability;
//   - capability readable, no $everything: per-resource search from the capability;
//   - capability unreadable: try $everything, else fall back to a default US-Core patient-compartment
//     search so we still import what we can.
//
// A 401 stays fatal everywhere — auth itself is broken, so every strategy would fail too.
func (c Config) FetchPatientData(ctx context.Context, ep Endpoints, tok *oauth2.Token, patientID string, onPage PageFunc) (refreshed *oauth2.Token, err error) {
	cap, cerr := c.fetchCapability(ctx, ep, tok)

	if cerr == nil && cap.supportsPatientEverything() {
		refr, eerr := c.FetchEverything(ctx, ep, tok, patientID, onPage)
		if eerr == nil {
			c.logf("smart sync: Patient/$everything completed")
			return refr, nil
		}
		if isUnauthorized(eerr) {
			return refr, eerr
		}
		c.logf("smart sync: Patient/$everything failed (%v) — falling back to per-resource search", eerr)
		return c.fetchSearches(ctx, ep, tok, patientID, searchesFromCapability(cap), onPage)
	}

	if cerr != nil {
		c.logf("smart sync: CapabilityStatement unreadable (%v) — trying Patient/$everything", cerr)
		refr, eerr := c.FetchEverything(ctx, ep, tok, patientID, onPage)
		if eerr == nil {
			c.logf("smart sync: Patient/$everything completed")
			return refr, nil
		}
		if isUnauthorized(eerr) {
			return refr, eerr
		}
		c.logf("smart sync: $everything failed (%v) — using default patient-compartment search", eerr)
		return c.fetchSearches(ctx, ep, tok, patientID, defaultPatientCompartment, onPage)
	}

	c.logf("smart sync: no Patient/$everything — per-resource search across the patient compartment")
	return c.fetchSearches(ctx, ep, tok, patientID, searchesFromCapability(cap), onPage)
}

// patientRef parses just enough of a FHIR resource (bare or as a Bundle entry) to find a Patient:
// a Patient's own id, or a patient/beneficiary reference on a claims resource.
type patientRef struct {
	ResourceType string `json:"resourceType"`
	ID           string `json:"id"`
	Patient      struct {
		Reference string `json:"reference"`
	} `json:"patient"`
	Beneficiary struct {
		Reference string `json:"reference"`
	} `json:"beneficiary"`
}

// patientID returns the Patient id this resource points at: its own id if it is a Patient, else the
// id parsed from its patient (EOB) or beneficiary (Coverage) reference.
func (r patientRef) patientID() string {
	if r.ResourceType == "Patient" && r.ID != "" {
		return r.ID
	}
	if id := idFromReference(r.Patient.Reference); id != "" {
		return id
	}
	return idFromReference(r.Beneficiary.Reference)
}

// patientBundle is a search response: either a bare resource or a Bundle of them.
type patientBundle struct {
	patientRef
	Entry []struct {
		Resource patientRef `json:"resource"`
	} `json:"entry"`
}

// idFromReference extracts the id from a FHIR reference like "Patient/-2014" or ".../Patient/-2014".
func idFromReference(ref string) string {
	const marker = "Patient/"
	i := strings.LastIndex(ref, marker)
	if i < 0 {
		return ""
	}
	return ref[i+len(marker):]
}

// DiscoverPatientID resolves the patient FHIR id when the token response carried no `patient` launch
// context. CMS Blue Button 2.0 omits `patient` from the initial token AND returns 401 on GET /Patient
// unless the app is approved to collect beneficiary demographic data — so we read the id from a claims
// resource's patient reference (Coverage.beneficiary / ExplanationOfBenefit.patient), which CMS
// recommends, and only then fall back to GET /Patient. Errors (never a silent empty id) if none work.
func (c Config) DiscoverPatientID(ctx context.Context, ep Endpoints, tok *oauth2.Token) (string, error) {
	base, err := c.safeBaseURL()
	if err != nil {
		return "", err
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.httpClient())
	client := oauth2.NewClient(ctx, c.oauth2Config(ep).TokenSource(ctx, tok))

	// Claims resources first (not gated by the demographic-data setting), then /Patient.
	var lastErr error
	for _, path := range []string{"/Coverage?_count=1", "/ExplanationOfBenefit?_count=1", "/Patient"} {
		id, err := c.patientIDFrom(ctx, client, base+path)
		if err != nil {
			lastErr = err
			continue
		}
		if id != "" {
			return id, nil
		}
	}
	if lastErr != nil {
		return "", lastErr
	}
	return "", fmt.Errorf("authorized, but no patient id found in Coverage, ExplanationOfBenefit, or /Patient (was a beneficiary with data selected?)")
}

// patientIDFrom GETs a FHIR URL and extracts a Patient id from a bare resource or the first Bundle
// entry. "" with a nil error means HTTP 200 but nothing usable was found (caller tries the next URL).
func (c Config) patientIDFrom(ctx context.Context, client *http.Client, reqURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/fhir+json")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GET %s HTTP %d", reqURL, resp.StatusCode)
	}
	var b patientBundle
	if err := json.NewDecoder(resp.Body).Decode(&b); err != nil {
		return "", fmt.Errorf("decoding %s: %w", reqURL, err)
	}
	if id := b.patientID(); id != "" { // bare resource (e.g. a Patient read)
		return id, nil
	}
	for _, e := range b.Entry { // first usable resource in the search Bundle
		if id := e.Resource.patientID(); id != "" {
			return id, nil
		}
	}
	return "", nil
}

// fetchCapability fetches and parses GET {FHIRBaseURL}/metadata.
func (c Config) fetchCapability(ctx context.Context, ep Endpoints, tok *oauth2.Token) (capabilityStatement, error) {
	var cap capabilityStatement
	base, err := c.safeBaseURL()
	if err != nil {
		return cap, err
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.httpClient())
	client := oauth2.NewClient(ctx, c.oauth2Config(ep).TokenSource(ctx, tok))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/metadata", nil)
	if err != nil {
		return cap, err
	}
	req.Header.Set("Accept", "application/fhir+json")
	resp, err := client.Do(req)
	if err != nil {
		return cap, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return cap, fmt.Errorf("metadata HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(&cap); err != nil {
		return cap, fmt.Errorf("decoding CapabilityStatement: %w", err)
	}
	return cap, nil
}

func (cs capabilityStatement) supportsPatientEverything() bool {
	for _, rest := range cs.Rest {
		for _, r := range rest.Resource {
			if r.Type != "Patient" {
				continue
			}
			for _, op := range r.Operation {
				if op.Name == "everything" {
					return true
				}
			}
		}
	}
	return false
}

// resourceSearch is one resource type to fetch and the search param linking it to a Patient. An empty
// Param means "read the resource by id" (used for Patient itself).
type resourceSearch struct {
	Type  string
	Param string
}

// defaultPatientCompartment is the resource set tried when the server's CapabilityStatement cannot be
// read — the common US-Core patient-compartment clinical resources, linked by "patient". It lets a
// metadata hiccup degrade to a best-effort per-resource import instead of failing fully empty (#341).
var defaultPatientCompartment = []resourceSearch{
	{Type: "Patient"},
	{Type: "AllergyIntolerance", Param: "patient"},
	{Type: "CarePlan", Param: "patient"},
	{Type: "CareTeam", Param: "patient"},
	{Type: "Condition", Param: "patient"},
	{Type: "Device", Param: "patient"},
	{Type: "DiagnosticReport", Param: "patient"},
	{Type: "DocumentReference", Param: "patient"},
	{Type: "Encounter", Param: "patient"},
	{Type: "Goal", Param: "patient"},
	{Type: "Immunization", Param: "patient"},
	{Type: "MedicationRequest", Param: "patient"},
	{Type: "Observation", Param: "patient"},
	{Type: "Procedure", Param: "patient"},
	{Type: "Provenance", Param: "patient"},
}

// searchesFromCapability builds the per-resource search plan from a CapabilityStatement: Patient is
// read by id; every other advertised type is searched by its patient-linking param when the server
// advertises one (else skipped — never guessed).
func searchesFromCapability(cs capabilityStatement) []resourceSearch {
	var out []resourceSearch
	for _, rest := range cs.Rest {
		for _, r := range rest.Resource {
			if r.Type == "Patient" {
				out = append(out, resourceSearch{Type: "Patient"})
				continue
			}
			if param := patientParamFor(r.Type, r.SearchParam); param != "" {
				out = append(out, resourceSearch{Type: r.Type, Param: param})
			}
		}
	}
	return out
}

// isUnauthorized reports whether err is an HTTP 401 — auth itself is broken, so no fallback would help.
func isUnauthorized(err error) bool {
	var hse *httpStatusError
	return errors.As(err, &hse) && hse.StatusCode == http.StatusUnauthorized
}

// fetchSearches runs a per-resource patient-compartment fetch over the given plan: Patient is read by
// id, every other type is searched by its patient param, following Bundle "next" pagination. A type
// the server advertises but then refuses (400/403/404/422/…) is SKIPPED so one inaccessible type never
// fails the whole import; only 401 (auth broken) and non-HTTP errors are fatal (#250 / #341).
func (c Config) fetchSearches(ctx context.Context, ep Endpoints, tok *oauth2.Token, patientID string, searches []resourceSearch, onPage PageFunc) (refreshed *oauth2.Token, err error) {
	const pageCap = 1000
	base, err := c.safeBaseURL()
	if err != nil {
		return nil, err
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.httpClient())
	ts := c.oauth2Config(ep).TokenSource(ctx, tok)
	// Surface a refreshed token on EVERY exit (incl. errors) so an aborted-partway import still persists
	// the renewed token (#341).
	defer func() {
		if t, terr := ts.Token(); terr == nil && t.AccessToken != tok.AccessToken {
			refreshed = t
		}
	}()
	httpClient := oauth2.NewClient(ctx, ts)

	total := 0
	for _, s := range searches {
		var next string
		if s.Param == "" {
			next = fmt.Sprintf("%s/%s/%s", base, s.Type, url.PathEscape(patientID))
		} else {
			next = fmt.Sprintf("%s/%s?%s=%s", base, s.Type, s.Param, url.QueryEscape(patientID))
		}

		fetched := 0
		for next != "" {
			body, link, gerr := getBundlePageRetry(ctx, httpClient, next)
			if gerr != nil {
				var hse *httpStatusError
				if errors.As(gerr, &hse) && hse.StatusCode != http.StatusUnauthorized {
					c.logf("smart sync: %s skipped (%v)", s.Type, gerr)
					break // stop paging this type; continue with the next
				}
				return refreshed, fmt.Errorf("fetching %s: %w", s.Type, gerr)
			}
			if perr := onPage(body); perr != nil {
				return refreshed, perr
			}
			fetched++
			total++
			next = link
			if total >= pageCap {
				return refreshed, fmt.Errorf("aborting capability fetch: exceeded %d pages", pageCap)
			}
		}
		if fetched > 0 {
			c.logf("smart sync: %s fetched %d page(s)", s.Type, fetched)
		}
	}

	return refreshed, nil
}

// patientParamFor returns the search param linking resourceType to a Patient — chosen from the known
// compartment params (else "patient"/"subject") AND advertised by the server. "" if none usable.
func patientParamFor(resourceType string, advertised []capNamed) string {
	candidates := patientCompartmentParams[resourceType]
	if candidates == nil {
		candidates = defaultPatientParams
	}
	for _, cand := range candidates {
		for _, sp := range advertised {
			if sp.Name == cand {
				return cand
			}
		}
	}
	return ""
}
