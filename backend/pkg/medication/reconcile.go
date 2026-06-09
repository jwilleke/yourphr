// Package medication implements the reconciliation of a patient's medication resources
// (MedicationRequest / MedicationStatement / MedicationDispense / Medication) into a single
// "Current Medications" list. See docs/planning/medications-brainstorm-session.md.
//
// The core Reconcile function is a pure, stateless derivation over the raw FHIR JSON — no database,
// no HTTP — so the reconciliation rules (dedup, classification, precedence, conflict, sort) are
// unit-testable in isolation. The "no guessing" principle is load-bearing here: state and fields
// come only from what the record explicitly states; absent signals yield empty/"Unknown", never a
// fabricated value.
package medication

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"time"
)

const rxNormSystem = "http://www.nlm.nih.gov/research/umls/rxnorm"

// Classified states. Active/Suspended/Past come only from explicit status (or an explicit past
// end date); everything unknown/absent is Unknown — shown, never assumed active.
const (
	StateActive    = "Active"
	StateSuspended = "Suspended"
	StatePast      = "Past"
	StateUnknown   = "Unknown"
)

// InputResource is one stored medication resource: its type + id (authoritative, from the DB row)
// plus the full FHIR JSON body.
type InputResource struct {
	SourceResourceType string
	SourceResourceID   string
	Raw                json.RawMessage
}

// Coding is a passthrough of an original FHIR coding (fidelity field — "no proprietary data" means
// none in the contract/keying, not dropping the source coding).
type Coding struct {
	System  string `json:"system,omitempty"`
	Code    string `json:"code,omitempty"`
	Display string `json:"display,omitempty"`
}

// Contributor is one resource that fed a reconciled row — the evidence the frontend can expand.
type Contributor struct {
	ResourceType     string     `json:"resourceType"`
	SourceResourceID string     `json:"sourceResourceId"`
	Status           string     `json:"status,omitempty"` // raw FHIR status
	State            string     `json:"state,omitempty"`  // classified state (empty if the type carries no state signal)
	Date             *time.Time `json:"date,omitempty"`
	Dose             string     `json:"dose,omitempty"`
	Frequency        string     `json:"frequency,omitempty"`
	Sig              string     `json:"sig,omitempty"`
}

// ReconciledMedication is one drug+strength row in the Current Medications list.
type ReconciledMedication struct {
	Key             string        `json:"key"`
	Title           string        `json:"title"`
	RxNormCode      string        `json:"rxNormCode,omitempty"`
	State           string        `json:"state"`
	StateConflict   bool          `json:"stateConflict"`
	Dose            string        `json:"dose,omitempty"`
	Frequency       string        `json:"frequency,omitempty"`
	Sig             string        `json:"sig,omitempty"`
	Purpose         string        `json:"purpose,omitempty"`
	Prescriber      string        `json:"prescriber,omitempty"`
	LastActivity    *time.Time    `json:"lastActivity,omitempty"`
	OriginalCodings []Coding      `json:"originalCodings,omitempty"`
	Contributors    []Contributor `json:"contributors"`
}

// precedence: a lower number wins for field selection (prescribed > self-reported > dispense).
var typePrecedence = map[string]int{
	"MedicationRequest":   0,
	"MedicationStatement": 1,
	"MedicationDispense":  2,
	"Medication":          3,
}

// Reconcile groups the resources into one row per clinical drug (dose-specific) and derives each
// row's display fields, state, and evidence. `now` is used only to resolve explicit past end dates.
func Reconcile(resources []InputResource, now time.Time) []ReconciledMedication {
	type group struct {
		med        *ReconciledMedication
		parsed     []*rawMedicationResource // aligned with med.Contributors
		seenCoding map[string]bool
	}
	groups := map[string]*group{}
	var order []string // preserve first-seen order before final sort

	for _, in := range resources {
		var r rawMedicationResource
		if err := json.Unmarshal(in.Raw, &r); err != nil {
			continue // unparseable resource is skipped, not guessed at
		}
		r.sourceResourceType = in.SourceResourceType
		r.sourceResourceID = in.SourceResourceID

		// Medication resources are referenced by the others (contained or by-reference); they carry
		// no status/dosage of their own to reconcile, so skip them as standalone rows.
		if r.resolvedType() == "Medication" {
			continue
		}

		name, codings, rxCode := r.medication()
		key := dedupKey(name, rxCode)

		g, ok := groups[key]
		if !ok {
			g = &group{med: &ReconciledMedication{Key: key, RxNormCode: rxCode}, seenCoding: map[string]bool{}}
			groups[key] = g
			order = append(order, key)
		}
		// title: prefer a non-empty name; rxNorm code fills in if a later contributor has it
		if g.med.Title == "" && name != "" {
			g.med.Title = name
		}
		if g.med.RxNormCode == "" && rxCode != "" {
			g.med.RxNormCode = rxCode
		}
		for _, c := range codings {
			sig := c.System + "|" + c.Code + "|" + c.Display
			if !g.seenCoding[sig] {
				g.seenCoding[sig] = true
				g.med.OriginalCodings = append(g.med.OriginalCodings, Coding{System: c.System, Code: c.Code, Display: c.Display})
			}
		}

		state, excluded := r.classifyState(now)
		if excluded {
			continue // entered-in-error — drop this contributor entirely
		}
		dose, freq, sig := r.doseFrequencySig()
		date := r.relevantDate()
		g.med.Contributors = append(g.med.Contributors, Contributor{
			ResourceType:     r.resolvedType(),
			SourceResourceID: r.sourceResourceID,
			Status:           r.Status,
			State:            state,
			Date:             date,
			Dose:             dose,
			Frequency:        freq,
			Sig:              sig,
		})
		g.parsed = append(g.parsed, &r)
	}

	result := make([]ReconciledMedication, 0, len(order))
	for _, key := range order {
		g := groups[key]
		if len(g.med.Contributors) == 0 {
			continue // every contributor was entered-in-error
		}
		finalize(g.med, g.parsed)
		result = append(result, *g.med)
	}

	// Default order: newest on top (by last activity, desc). Undated rows sink to the bottom.
	sort.SliceStable(result, func(i, j int) bool {
		di, dj := result[i].LastActivity, result[j].LastActivity
		if di == nil && dj == nil {
			return result[i].Title < result[j].Title
		}
		if di == nil {
			return false
		}
		if dj == nil {
			return true
		}
		return di.After(*dj)
	})
	return result
}

// finalize derives the row-level fields from its contributors: field precedence, state +
// conflict, prescriber, and last-activity.
func finalize(med *ReconciledMedication, parsed []*rawMedicationResource) {
	// sort contributor indices by type precedence for field selection
	idx := make([]int, len(parsed))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool {
		return typePrecedence[parsed[idx[a]].resolvedType()] < typePrecedence[parsed[idx[b]].resolvedType()]
	})

	for _, i := range idx {
		c := med.Contributors[i]
		if med.Dose == "" {
			med.Dose = c.Dose
		}
		if med.Frequency == "" {
			med.Frequency = c.Frequency
		}
		if med.Sig == "" {
			med.Sig = c.Sig
		}
		if med.Purpose == "" {
			med.Purpose = parsed[i].purpose()
		}
		if med.Prescriber == "" && parsed[i].resolvedType() == "MedicationRequest" {
			med.Prescriber = parsed[i].prescriber()
		}
	}

	// last activity = max contributor date
	for _, c := range med.Contributors {
		if c.Date != nil && (med.LastActivity == nil || c.Date.After(*med.LastActivity)) {
			med.LastActivity = c.Date
		}
	}

	med.State, med.StateConflict = resolveState(med.Contributors)
}

// resolveState reduces the contributors' classified states to one badge. Only contributors that
// carry a state signal (Request/Statement) count. Conflicts are surfaced, not resolved away.
func resolveState(contributors []Contributor) (string, bool) {
	distinct := map[string]bool{}
	for _, c := range contributors {
		if c.State != "" && c.State != StateUnknown {
			distinct[c.State] = true
		}
	}
	if len(distinct) == 0 {
		return StateUnknown, false
	}
	if len(distinct) == 1 {
		for s := range distinct {
			return s, false
		}
	}
	// Conflict: the most-recently-dated stated contributor drives the badge; if none is dated, fall
	// back to a deterministic priority (Active > Suspended > Past). Either way, flag the conflict.
	var best Contributor
	var bestHasDate bool
	for _, c := range contributors {
		if c.State == "" || c.State == StateUnknown {
			continue
		}
		if best.State == "" {
			best = c
			bestHasDate = c.Date != nil
			continue
		}
		switch {
		case c.Date != nil && (!bestHasDate || c.Date.After(*best.Date)):
			best = c
			bestHasDate = true
		case c.Date == nil && !bestHasDate && statePriority(c.State) < statePriority(best.State):
			best = c
		}
	}
	return best.State, true
}

func statePriority(s string) int {
	switch s {
	case StateActive:
		return 0
	case StateSuspended:
		return 1
	case StatePast:
		return 2
	default:
		return 3
	}
}

// dedupKey groups at the clinical-drug (dose-specific) level: by RxNorm code when present,
// otherwise by exact normalized display string (never fuzzy — under-merge is safe, wrong-merge is
// dangerous). An un-named resource keys to itself so it is never merged blindly.
func dedupKey(name, rxCode string) string {
	if rxCode != "" {
		return "rxnorm:" + rxCode
	}
	norm := strings.ToLower(strings.Join(strings.Fields(name), " "))
	if norm != "" {
		return "text:" + norm
	}
	return ""
}

func parseFHIRDate(s string) *time.Time {
	if s == "" {
		return nil
	}
	layouts := []string{time.RFC3339, time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02", "2006-01", "2006"}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			u := t.UTC()
			return &u
		}
	}
	return nil
}

func formatQuantity(q *fhirQuantity) string {
	if q == nil || q.Value == 0 && q.Unit == "" {
		return ""
	}
	v := strconv.FormatFloat(q.Value, 'g', -1, 64)
	if q.Unit == "" {
		return v
	}
	return v + " " + q.Unit
}

var periodUnitWord = map[string]string{
	"s": "second", "min": "minute", "h": "hour", "d": "day", "wk": "week", "mo": "month", "a": "year",
}
