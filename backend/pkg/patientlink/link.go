// Package patientlink associates non-clinical resources — ExplanationOfBenefit (claims) and Coverage —
// with the imported Patient they explicitly reference, so they can be shown in the patient's context
// instead of orphaned. It is the third leg of the Medicare display work (#296), alongside the EOB
// classifier (#294, pkg/explanationofbenefit) and the Coverage classifier (#295, pkg/coverage).
//
// It reuses the shared reference resolver in pkg/provenance (relative "Type/id", absolute-URL, and the
// FollowMyHealth underscore-joined forms) rather than re-parsing references here. The "no guessing"
// principle is load-bearing: a claim/coverage is associated with a patient ONLY on an explicit
// reference that resolves to an imported Patient. A missing reference, a malformed one, or one that
// resolves to nothing is reported as unresolved — never inferred (e.g. never "there's only one patient,
// so it must be theirs"). EOB references the patient via `patient`, Coverage via `beneficiary`; both
// arrive here already extracted by their classifiers as a plain "Patient/<id>" string.
//
// Pure and stateless over the provided Patient set — no DB, no HTTP. See
// docs/your-phr-dashboard/classification-and-display-architecture.md.
package patientlink

import (
	"encoding/json"
	"strings"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

// PatientCard is the minimal patient identity used when surfacing claims/coverage under a patient.
type PatientCard struct {
	Ref       string `json:"ref"`            // resolved "Type/id" key, e.g. "Patient/-10000010254618"
	Name      string `json:"name,omitempty"` // human name from the Patient record, when present
	Confirmed bool   `json:"confirmed"`      // true only when the reference resolved to an imported Patient
}

// Resolver resolves patient/beneficiary references against the set of imported Patient resources.
type Resolver struct {
	set *provenance.ResourceSet
}

// NewResolver indexes the imported Patient resources for reference resolution.
func NewResolver(patients []provenance.Resource) *Resolver {
	return &Resolver{set: provenance.NewResourceSet(patients)}
}

// Resolve resolves an explicit patient/beneficiary reference to an imported Patient. It returns
// (card, true) only when the reference is non-empty AND resolves to a stored Patient resource;
// otherwise (zero, false). It never guesses — an empty or unresolved reference is not a patient.
func (r *Resolver) Resolve(reference string) (PatientCard, bool) {
	reference = strings.TrimSpace(reference)
	if reference == "" {
		return PatientCard{}, false
	}
	res, ok := r.set.Resolve(reference)
	if !ok || res.SourceResourceType != "Patient" {
		return PatientCard{}, false
	}
	return PatientCard{
		Ref:       "Patient/" + res.SourceResourceID,
		Name:      patientName(res.Raw),
		Confirmed: true,
	}, true
}

// Item is one resource to associate — its caller-chosen key plus the patient reference it states.
type Item struct {
	ID         string // caller key (SourceResourceID)
	PatientRef string // "Patient/<id>" as stated on the resource ("" if the resource named no patient)
}

// Group is the claims and coverage that resolve to a single imported patient.
type Group struct {
	Patient     PatientCard `json:"patient"`
	ClaimIDs    []string    `json:"claimIds,omitempty"`
	CoverageIDs []string    `json:"coverageIds,omitempty"`
}

// Result is the association outcome: claims/coverage grouped under each resolved patient, plus the
// IDs that could not be associated (no reference, or it resolved to no imported Patient).
type Result struct {
	Patients           []Group  `json:"patients"`
	UnresolvedClaims   []string `json:"unresolvedClaims,omitempty"`
	UnresolvedCoverage []string `json:"unresolvedCoverage,omitempty"`
}

// Associate groups claims and coverage under the imported patients they explicitly reference. Patient
// groups appear in first-seen order (stable across claims then coverage). Anything without an explicit,
// resolvable reference lands in the unresolved lists — never silently attached to a patient.
func (r *Resolver) Associate(claims, coverages []Item) Result {
	res := Result{}
	groups := map[string]*Group{}
	var order []string

	get := func(card PatientCard) *Group {
		g, ok := groups[card.Ref]
		if !ok {
			g = &Group{Patient: card}
			groups[card.Ref] = g
			order = append(order, card.Ref)
		}
		return g
	}

	for _, it := range claims {
		if card, ok := r.Resolve(it.PatientRef); ok {
			get(card).ClaimIDs = append(get(card).ClaimIDs, it.ID)
		} else {
			res.UnresolvedClaims = append(res.UnresolvedClaims, it.ID)
		}
	}
	for _, it := range coverages {
		if card, ok := r.Resolve(it.PatientRef); ok {
			get(card).CoverageIDs = append(get(card).CoverageIDs, it.ID)
		} else {
			res.UnresolvedCoverage = append(res.UnresolvedCoverage, it.ID)
		}
	}

	for _, ref := range order {
		res.Patients = append(res.Patients, *groups[ref])
	}
	return res
}

// patientName renders a human name from a Patient record: name.text when present, else the first
// name's given + family. Returns "" when the record carries no usable name (no-guessing — no synthesis).
func patientName(raw json.RawMessage) string {
	var p struct {
		Name []struct {
			Text   string   `json:"text"`
			Family string   `json:"family"`
			Given  []string `json:"given"`
		} `json:"name"`
	}
	if json.Unmarshal(raw, &p) != nil {
		return ""
	}
	for _, n := range p.Name {
		if t := strings.TrimSpace(n.Text); t != "" {
			return t
		}
		parts := append([]string{}, n.Given...)
		if f := strings.TrimSpace(n.Family); f != "" {
			parts = append(parts, f)
		}
		if name := strings.TrimSpace(strings.Join(parts, " ")); name != "" {
			return name
		}
	}
	return ""
}
