// Package rxterms resolves an RxNorm RxCUI to a patient-friendly RxTerms name + strength (e.g. RxCUI
// 313782 -> "Acetaminophen (Oral Pill)", "325 mg"). RxTerms is NLM's consumer-facing companion to
// RxNorm; the raw RxNorm name ("Acetaminophen 325 MG Oral Tablet") is optimized for machines.
//
// Two sources: the embedded offline Crosswalk (crosswalk.go, the default/production path, #387) and
// this Resolver over NLM's RxNav API (optional fallback for RxCUIs not in the bundle). Everything is
// BEST-EFFORT: any miss/error/timeout yields empty so the caller falls back to the raw title.
package rxterms

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

type apiResult struct{ name, strength string }

// Resolver maps RxCUI -> {name, strength} via the RxNav API, caching results (incl. negatives) in
// memory so a given RxCUI hits RxNav at most once per process.
type Resolver struct {
	client  *http.Client
	baseURL string

	mu    sync.Mutex
	cache map[string]apiResult
}

// NewResolver builds a Resolver pointed at the public RxNav RxTerms endpoint.
func NewResolver() *Resolver {
	return &Resolver{
		client:  &http.Client{Timeout: 3 * time.Second},
		baseURL: "https://rxnav.nlm.nih.gov/REST/RxTerms/rxcui",
		cache:   map[string]apiResult{},
	}
}

// Resolve returns the patient-friendly name and strength for rxcui (either "" if unresolvable).
func (r *Resolver) Resolve(ctx context.Context, rxcui string) (name, strength string) {
	rxcui = strings.TrimSpace(rxcui)
	if rxcui == "" {
		return "", ""
	}
	r.mu.Lock()
	if v, ok := r.cache[rxcui]; ok {
		r.mu.Unlock()
		return v.name, v.strength
	}
	r.mu.Unlock()

	res := r.fetch(ctx, rxcui)

	r.mu.Lock()
	r.cache[rxcui] = res // cache negatives too, so a bad rxcui isn't retried every request
	r.mu.Unlock()
	return res.name, res.strength
}

func (r *Resolver) fetch(ctx context.Context, rxcui string) apiResult {
	// allinfo returns both displayName and the canonical strength in one call, e.g.
	// {"displayName":"Acetaminophen (Oral Pill)","strength":"325 mg"} (combos: "250-125 mg").
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.baseURL+"/"+rxcui+"/allinfo.json", nil)
	if err != nil {
		return apiResult{}
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return apiResult{}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return apiResult{}
	}
	var out struct {
		RxTermsProperties struct {
			DisplayName string `json:"displayName"`
			Strength    string `json:"strength"`
		} `json:"rxtermsProperties"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return apiResult{}
	}
	return apiResult{
		name:     strings.TrimSpace(out.RxTermsProperties.DisplayName),
		strength: strings.TrimSpace(out.RxTermsProperties.Strength),
	}
}
