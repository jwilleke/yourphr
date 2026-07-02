// Package rxterms resolves an RxNorm RxCUI to a patient-friendly RxTerms display name via NLM's RxNav
// API (e.g. RxCUI 313782 -> "Acetaminophen (Oral Pill)"). RxTerms is NLM's consumer-facing companion
// to RxNorm; the raw RxNorm name ("Acetaminophen 325 MG Oral Tablet") is optimized for machines.
//
// PROTOTYPE for #387. This is the API path; the production path is a local RxTerms crosswalk (offline,
// no per-med external call — see #387). Everything here is BEST-EFFORT: any miss/error/timeout returns
// "" so the caller falls back to the raw title. Only meds that carry an RxCUI can be resolved.
package rxterms

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Resolver maps RxCUI -> RxTerms display name, caching results (including negatives) in memory so a
// given RxCUI hits RxNav at most once per process.
type Resolver struct {
	client  *http.Client
	baseURL string

	mu    sync.Mutex
	cache map[string]string
}

// NewResolver builds a Resolver pointed at the public RxNav RxTerms endpoint.
func NewResolver() *Resolver {
	return &Resolver{
		client:  &http.Client{Timeout: 3 * time.Second},
		baseURL: "https://rxnav.nlm.nih.gov/REST/RxTerms/rxcui",
		cache:   map[string]string{},
	}
}

// DisplayName returns the patient-friendly RxTerms name for rxcui, or "" if it can't be resolved
// (empty rxcui, no RxTerms entry, or any network/parse error). Results are cached.
func (r *Resolver) DisplayName(ctx context.Context, rxcui string) string {
	rxcui = strings.TrimSpace(rxcui)
	if rxcui == "" {
		return ""
	}
	r.mu.Lock()
	if v, ok := r.cache[rxcui]; ok {
		r.mu.Unlock()
		return v
	}
	r.mu.Unlock()

	name := r.fetch(ctx, rxcui)

	r.mu.Lock()
	r.cache[rxcui] = name // cache negatives too, so a bad rxcui isn't retried every request
	r.mu.Unlock()
	return name
}

func (r *Resolver) fetch(ctx context.Context, rxcui string) string {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.baseURL+"/"+rxcui+"/name.json", nil)
	if err != nil {
		return ""
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	var out struct {
		DisplayGroup struct {
			DisplayName string `json:"displayName"`
		} `json:"displayGroup"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return ""
	}
	return strings.TrimSpace(out.DisplayGroup.DisplayName)
}
