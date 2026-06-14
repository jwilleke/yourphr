package smart

import (
	"context"
	"encoding/json"
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

// FetchPatientData fetches all of a patient's data, choosing the strategy from the server's
// CapabilityStatement: Patient/$everything when supported, otherwise a per-resource search across the
// patient compartment. If the CapabilityStatement cannot be read, it falls back to $everything so
// existing $everything-capable providers are unaffected.
func (c Config) FetchPatientData(ctx context.Context, ep Endpoints, tok *oauth2.Token, patientID string) (pages [][]byte, refreshed *oauth2.Token, err error) {
	cap, cerr := c.fetchCapability(ctx, ep, tok)
	if cerr != nil || cap.supportsPatientEverything() {
		return c.FetchEverything(ctx, ep, tok, patientID)
	}
	return c.fetchByCapability(ctx, ep, tok, patientID, cap)
}

// patientIDResponse parses GET /Patient as either a search Bundle or a bare Patient resource,
// to extract the beneficiary's Patient.id.
type patientIDResponse struct {
	ResourceType string `json:"resourceType"`
	ID           string `json:"id"`
	Entry        []struct {
		Resource struct {
			ResourceType string `json:"resourceType"`
			ID           string `json:"id"`
		} `json:"resource"`
	} `json:"entry"`
}

// DiscoverPatientID resolves the patient FHIR id from the FHIR API when the token response did not
// carry a `patient` launch context. CMS Blue Button 2.0, for example, omits `patient` from the
// initial token (it only appears on refresh) and documents reading the id from the API instead. This
// GETs {FHIRBaseURL}/Patient with the patient-scoped token and returns the single beneficiary's id.
func (c Config) DiscoverPatientID(ctx context.Context, ep Endpoints, tok *oauth2.Token) (string, error) {
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.httpClient())
	client := oauth2.NewClient(ctx, c.oauth2Config(ep).TokenSource(ctx, tok))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(c.FHIRBaseURL, "/")+"/Patient", nil)
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
		return "", fmt.Errorf("GET /Patient HTTP %d", resp.StatusCode)
	}
	var pr patientIDResponse
	if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil {
		return "", fmt.Errorf("decoding /Patient response: %w", err)
	}
	if pr.ResourceType == "Patient" && pr.ID != "" {
		return pr.ID, nil // server returned a bare Patient
	}
	for _, e := range pr.Entry {
		if e.Resource.ResourceType == "Patient" && e.Resource.ID != "" {
			return e.Resource.ID, nil // first Patient in the search Bundle
		}
	}
	return "", fmt.Errorf("no Patient resource found at GET /Patient")
}

// fetchCapability fetches and parses GET {FHIRBaseURL}/metadata.
func (c Config) fetchCapability(ctx context.Context, ep Endpoints, tok *oauth2.Token) (capabilityStatement, error) {
	var cap capabilityStatement
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.httpClient())
	client := oauth2.NewClient(ctx, c.oauth2Config(ep).TokenSource(ctx, tok))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(c.FHIRBaseURL, "/")+"/metadata", nil)
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

// fetchByCapability fetches the patient's data per resource type the server advertises: Patient is
// read by id; every other type is searched by its patient-linking param. Resources with no usable
// patient link are skipped (never guessed). Pagination follows Bundle "next" links.
func (c Config) fetchByCapability(ctx context.Context, ep Endpoints, tok *oauth2.Token, patientID string, cs capabilityStatement) (pages [][]byte, refreshed *oauth2.Token, err error) {
	const pageCap = 1000
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.httpClient())
	ts := c.oauth2Config(ep).TokenSource(ctx, tok)
	httpClient := oauth2.NewClient(ctx, ts)
	base := strings.TrimRight(c.FHIRBaseURL, "/")

	for _, rest := range cs.Rest {
		for _, r := range rest.Resource {
			var next string
			if r.Type == "Patient" {
				next = fmt.Sprintf("%s/Patient/%s", base, url.PathEscape(patientID))
			} else if param := patientParamFor(r.Type, r.SearchParam); param != "" {
				next = fmt.Sprintf("%s/%s?%s=%s", base, r.Type, param, url.QueryEscape(patientID))
			} else {
				continue // no usable patient link for this resource — skip rather than guess
			}

			for next != "" {
				body, link, gerr := getBundlePage(ctx, httpClient, next)
				if gerr != nil {
					return pages, nil, fmt.Errorf("fetching %s: %w", r.Type, gerr)
				}
				pages = append(pages, body)
				next = link
				if len(pages) >= pageCap {
					return pages, nil, fmt.Errorf("aborting capability fetch: exceeded %d pages", pageCap)
				}
			}
		}
	}

	if t, terr := ts.Token(); terr == nil && t.AccessToken != tok.AccessToken {
		refreshed = t
	}
	return pages, refreshed, nil
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
