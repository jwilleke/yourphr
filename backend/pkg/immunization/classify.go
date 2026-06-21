// Package immunization classifies a patient's Immunization resources for legible display: it maps the
// FHIR status to a legible state, attributes the record's source from primarySource ("Recorded by
// provider" vs a reported/secondary source), and resolves "who administered it".
//
// Classify is a pure, stateless derivation over the raw FHIR JSON — no database, no HTTP. The "no
// guessing" principle holds: state and source attribution come only from explicit signals; an absent
// primarySource is "Unknown" (never assumed provider-recorded), and an entered-in-error record is
// dropped. One output row per input, mirroring pkg/condition and pkg/allergyintolerance.
package immunization

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

// State is the legible administration status, mapped from FHIR Immunization.status
// (entered-in-error is dropped, not labeled).
const (
	StateCompleted = "Completed" // status completed — the vaccine was given
	StateNotDone   = "NotDone"   // status not-done — not given (see StatusReason)
	StateUnknown   = "Unknown"   // status absent/unrecognized
)

// Source attributes where the record came from, derived from Immunization.primarySource. false does
// NOT necessarily mean the patient — it means a secondary source (registry, recall, transcription);
// ReportOrigin carries the stated detail. Only "Recorded by provider" is asserted from a true flag.
const (
	SourceProviderRecorded = "Recorded by provider" // primarySource = true
	SourceReported         = "Reported"             // primarySource = false (secondary; see ReportOrigin)
	SourceUnknown          = "Unknown"              // primarySource absent — never assumed
)

// InputResource is one stored Immunization row.
type InputResource struct {
	SourceResourceType string
	SourceResourceID   string
	SourceID           string
	Raw                json.RawMessage
}

// Coding is a fidelity passthrough of an original FHIR coding.
type Coding struct {
	System  string `json:"system,omitempty"`
	Code    string `json:"code,omitempty"`
	Display string `json:"display,omitempty"`
}

// ClassifiedImmunization is one Immunization with its legible state + source attribution and display
// fields. The raw record is never mutated; this is a read-time view-model.
type ClassifiedImmunization struct {
	SourceResourceType string `json:"sourceResourceType"`
	SourceResourceID   string `json:"sourceResourceId"`
	SourceID           string `json:"sourceId"`
	Title              string `json:"title"`
	State              string `json:"state"`
	Source             string `json:"source"`                 // legible primarySource attribution
	ReportOrigin       string `json:"reportOrigin,omitempty"` // stated secondary-source detail (when reported)

	Status          string   `json:"status,omitempty"`       // raw FHIR status
	StatusReason    string   `json:"statusReason,omitempty"` // why not given
	Occurrence      string   `json:"occurrence,omitempty"`   // latest administration date (deduped: most recent dose)
	Recorded        string   `json:"recorded,omitempty"`
	Doses           int      `json:"doses,omitempty"`        // administrations merged into this entry (same vaccine repeated) (#289)
	LastActivity    string   `json:"lastActivity,omitempty"` // latest administration/recorded date; sort key
	Manufacturer    string   `json:"manufacturer,omitempty"`
	LotNumber       string   `json:"lotNumber,omitempty"`
	ExpirationDate  string   `json:"expirationDate,omitempty"`
	Note            string   `json:"note,omitempty"`
	StandardCodings []Coding `json:"standardCodings,omitempty"`

	// Provenance ("who administered/recorded this") — resolved against the other stored resources via
	// the shared resolver (performer.actor); nil when no resolver is supplied.
	Provenance *provenance.Provenance `json:"provenance,omitempty"`
}

// Classify returns one ClassifiedImmunization per input (in input order), except records marked
// entered-in-error, which are omitted. `now` is reserved for future date-based rules.
//
// resolver and sourceLabel are optional (pass nil for both to skip provenance in pure unit tests).
func Classify(resources []InputResource, now time.Time, resolver *provenance.ResourceSet, sourceLabel func(sourceID string) string) []ClassifiedImmunization {
	perRecord := make([]ClassifiedImmunization, 0, len(resources))
	for _, res := range resources {
		var raw rawImmunization
		if err := json.Unmarshal(res.Raw, &raw); err != nil {
			continue
		}
		if strings.ToLower(raw.Status) == "entered-in-error" {
			continue // the record says this was a mistake — honor it, omit entirely
		}

		ci := ClassifiedImmunization{
			SourceResourceType: res.SourceResourceType,
			SourceResourceID:   res.SourceResourceID,
			SourceID:           res.SourceID,
			Title:              raw.title(),
			State:              stateLabel(raw.Status),
			Source:             sourceAttribution(raw.PrimarySource),
			ReportOrigin:       reportOriginText(&raw),
			Status:             raw.Status,
			StatusReason:       conceptText(raw.StatusReason),
			Occurrence:         raw.occurrence(),
			Recorded:           raw.Recorded,
			Doses:              1,
			LastActivity:       firstNonEmpty(raw.occurrence(), raw.Recorded),
			Manufacturer:       raw.manufacturerName(),
			LotNumber:          raw.LotNumber,
			ExpirationDate:     raw.ExpirationDate,
			Note:               raw.noteText(),
			StandardCodings:    standardCodings(raw.VaccineCode),
		}

		if resolver != nil {
			label := ""
			if sourceLabel != nil {
				label = sourceLabel(res.SourceID)
			}
			var authors []provenance.Reference
			for _, p := range raw.Performer {
				if p.Actor != nil && p.Actor.Reference != "" {
					authors = append(authors, provenance.Reference{Reference: p.Actor.Reference, Display: p.Actor.Display})
				}
			}
			prov := resolver.ResolveProvenance(provenance.Request{
				Authors:      authors,
				Encounter:    provRef(raw.Encounter),
				TargetType:   res.SourceResourceType,
				TargetID:     res.SourceResourceID,
				SourceLabel:  label,
				AuthoredTime: raw.Recorded, // Immunization.recorded = author time
			})
			ci.Provenance = &prov
		}

		perRecord = append(perRecord, ci)
	}
	return dedupeImmunizations(perRecord)
}

// dedupeImmunizations collapses administrations of the SAME vaccine (by standard code, else normalized
// title) into ONE entry with a dose count — a vaccine given/recorded across encounters should appear
// once, not repeated per encounter (#289). Immunizations are point-in-time, so there is no date range:
// the representative (and its Occurrence date) is the most-recent administration; Doses = count. Group
// order follows first appearance (stable).
func dedupeImmunizations(in []ClassifiedImmunization) []ClassifiedImmunization {
	order := make([]string, 0, len(in))
	groups := make(map[string][]ClassifiedImmunization)
	for _, c := range in {
		k := immunizationDedupKey(c)
		if _, ok := groups[k]; !ok {
			order = append(order, k)
		}
		groups[k] = append(groups[k], c)
	}
	out := make([]ClassifiedImmunization, 0, len(order))
	for _, k := range order {
		g := groups[k]
		rep := g[0]
		for _, c := range g[1:] {
			if firstNonEmpty(c.LastActivity) > firstNonEmpty(rep.LastActivity) {
				rep = c // most-recent administration drives the displayed date/status
			}
		}
		rep.Doses = len(g)
		out = append(out, rep)
	}
	return out
}

func immunizationDedupKey(c ClassifiedImmunization) string {
	for _, cd := range c.StandardCodings {
		if cd.Code != "" {
			return "code:" + strings.ToLower(cd.System) + "|" + strings.ToLower(cd.Code)
		}
	}
	return "title:" + strings.ToLower(strings.TrimSpace(c.Title))
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func stateLabel(status string) string {
	switch strings.ToLower(status) {
	case "completed":
		return StateCompleted
	case "not-done":
		return StateNotDone
	default:
		return StateUnknown
	}
}

// sourceAttribution maps primarySource to a legible label. nil (absent) is Unknown — silence is never
// upgraded to "Recorded by provider".
func sourceAttribution(primarySource *bool) string {
	if primarySource == nil {
		return SourceUnknown
	}
	if *primarySource {
		return SourceProviderRecorded
	}
	return SourceReported
}

// reportOriginText surfaces the stated secondary-source detail, only meaningful when the record is a
// reported (non-primary) source.
func reportOriginText(raw *rawImmunization) string {
	if raw.PrimarySource != nil && !*raw.PrimarySource {
		return conceptText(raw.ReportOrigin)
	}
	return ""
}

func provRef(ref *fhirReference) provenance.Reference {
	if ref == nil {
		return provenance.Reference{}
	}
	return provenance.Reference{Reference: ref.Reference, Display: ref.Display}
}
