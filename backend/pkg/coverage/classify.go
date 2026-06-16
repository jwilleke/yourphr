// Package coverage classifies a patient's Coverage resources for legible display: it turns the coded
// CARIN-Blue-Button / Medicare representation (class group/plan, v3-ActCode type, a payor identifier,
// a partial period) into plain language — "Medicare Part A — Hospital, active since 1999-09-08" — and
// rolls a patient's several coverages up into one summary ("Active Medicare: Part A, B, C, D").
//
// Classify is a pure, stateless derivation over the raw FHIR JSON — no database, no HTTP — so the
// rules are unit-testable in isolation. The "no guessing" principle is load-bearing: plan, status,
// payor, and period come only from explicit signals in the record; an absent period (Part C) yields
// no dates, a start-only period (Part A/B) yields "since <date>" and never an invented end, an
// unrecognized plan yields no plain-language meaning. See the #295 issue.
package coverage

import (
	"encoding/json"
	"strings"
	"time"
)

// Medicare part codes (Coverage.class[plan].value).
const (
	PartA = "Part A"
	PartB = "Part B"
	PartC = "Part C"
	PartD = "Part D"
)

// partMeaning maps a Medicare part to its plain-language purpose. Unknown -> "" (never guessed).
func partMeaning(plan string) string {
	switch strings.ToUpper(strings.TrimSpace(plan)) {
	case "PART A":
		return "Hospital"
	case "PART B":
		return "Medical"
	case "PART C":
		return "Medicare Advantage"
	case "PART D":
		return "Prescription drugs"
	default:
		return ""
	}
}

// InputResource is one stored Coverage row: authoritative type/id/source from the DB row plus the
// full FHIR JSON body.
type InputResource struct {
	SourceResourceType string
	SourceResourceID   string
	SourceID           string
	Raw                json.RawMessage
}

// CoveragePeriod is the coverage's effective dates, included only when the record states them.
type CoveragePeriod struct {
	Start string `json:"start,omitempty"`
	End   string `json:"end,omitempty"`
}

// ClassifiedCoverage is one Coverage rendered for display. The raw record is never mutated.
type ClassifiedCoverage struct {
	SourceResourceType string `json:"sourceResourceType"`
	SourceResourceID   string `json:"sourceResourceId"`
	SourceID           string `json:"sourceId"`

	Group       string `json:"group,omitempty"`       // e.g. "Medicare" (Coverage.class[group])
	Plan        string `json:"plan,omitempty"`        // e.g. "Part A" (Coverage.class[plan])
	PlanMeaning string `json:"planMeaning,omitempty"` // plain language, e.g. "Hospital" ("" if unknown)
	Label       string `json:"label"`                 // e.g. "Medicare Part A — Hospital"

	Status string `json:"status,omitempty"` // raw FHIR status, e.g. "active"
	Active bool   `json:"active"`           // status == "active"

	Payor          string          `json:"payor,omitempty"`          // e.g. "Centers for Medicare and Medicaid Services"
	BeneficiaryRef string          `json:"beneficiaryRef,omitempty"` // "Patient/<id>" — the link for #296
	Period         *CoveragePeriod `json:"period,omitempty"`         // nil when the record states no period
	PeriodLabel    string          `json:"periodLabel,omitempty"`    // "since 1999-09-08" / "2025-01-01 to 2025-03-03"
}

// Classify returns one ClassifiedCoverage per input (in input order). Unparseable records are skipped
// rather than emitted as garbage. `now` is reserved for future date-based rules (e.g. flagging an
// elapsed period) and kept for signature symmetry with the other classifiers.
func Classify(resources []InputResource, now time.Time) []ClassifiedCoverage {
	out := make([]ClassifiedCoverage, 0, len(resources))
	for _, res := range resources {
		var raw rawCoverage
		if err := json.Unmarshal(res.Raw, &raw); err != nil {
			continue
		}

		group := raw.classValue("group")
		plan := raw.classValue("plan")
		status := strings.TrimSpace(raw.Status)

		cc := ClassifiedCoverage{
			SourceResourceType: res.SourceResourceType,
			SourceResourceID:   res.SourceResourceID,
			SourceID:           res.SourceID,
			Group:              group,
			Plan:               plan,
			PlanMeaning:        partMeaning(plan),
			Label:              planLabel(group, plan),
			Status:             status,
			Active:             strings.EqualFold(status, "active"),
			Payor:              raw.payorName(),
			BeneficiaryRef:     raw.beneficiaryRef(),
		}
		cc.Period, cc.PeriodLabel = periodOf(raw.Period)

		out = append(out, cc)
	}
	return out
}

// planLabel builds the human title: "<group> <plan> — <meaning>", degrading gracefully as fields are
// absent (no-guessing): group+plan -> "Medicare Part A — Hospital"; plan only -> "Part A"; group only
// -> "Medicare"; neither -> "Coverage".
func planLabel(group, plan string) string {
	parts := make([]string, 0, 2)
	if group != "" {
		parts = append(parts, group)
	}
	if plan != "" {
		parts = append(parts, plan)
	}
	if len(parts) == 0 {
		return "Coverage"
	}
	label := strings.Join(parts, " ")
	if m := partMeaning(plan); m != "" {
		label += " — " + m
	}
	return label
}

// periodOf derives the display period + label from the FHIR period. Three real-world shapes, each
// rendered honestly: start+end -> bounded range; start only -> "since <start>" (ongoing, no invented
// end); absent/empty -> nil (status carries the meaning). Returns (nil, "") when there is nothing.
func periodOf(p *fhirPeriod) (*CoveragePeriod, string) {
	if p == nil {
		return nil, ""
	}
	start, end := strings.TrimSpace(p.Start), strings.TrimSpace(p.End)
	if start == "" && end == "" {
		return nil, ""
	}
	cp := &CoveragePeriod{Start: start, End: end}
	switch {
	case start != "" && end != "":
		return cp, start + " to " + end
	case start != "":
		return cp, "since " + start
	default:
		return cp, "until " + end
	}
}

// CoverageSummary rolls a patient's coverages into one legible line.
type CoverageSummary struct {
	ActiveParts []string `json:"activeParts"` // e.g. ["Part A","Part B","Part C","Part D"], in input order
	Label       string   `json:"label"`       // e.g. "Active Medicare: Part A, Part B, Part C, Part D"
}

// Summarize collects the active coverages' plans into a single per-patient summary. Plans are listed
// in input order and de-duplicated; only active coverages count. With no active plans, Label is "".
func Summarize(coverages []ClassifiedCoverage) CoverageSummary {
	var parts []string
	seen := map[string]bool{}
	group := ""
	for _, c := range coverages {
		if !c.Active || c.Plan == "" || seen[c.Plan] {
			continue
		}
		seen[c.Plan] = true
		parts = append(parts, c.Plan)
		if group == "" {
			group = c.Group
		}
	}
	label := ""
	if len(parts) > 0 {
		prefix := "Active"
		if group != "" {
			prefix += " " + group
		}
		label = prefix + ": " + strings.Join(parts, ", ")
	}
	return CoverageSummary{ActiveParts: parts, Label: label}
}
