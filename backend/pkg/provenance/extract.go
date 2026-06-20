package provenance

import "encoding/json"

// ExtractRequest builds a provenance Request from any FHIR resource's raw JSON, reading the superset
// of common author/informant/encounter fields and author-time elements across resource types. It is
// the generic entry point for the read path (one call works for all ~70 types); absent fields are
// simply skipped, so it never fabricates an author or a time.
//
// Author priority mirrors the bespoke wirings: asserter → recorder → requester → informationSource →
// performer → author[]. A Patient reference among these resolves to "Self-reported" in the ladder.
// Author time is the first present of recordedDate / authoredOn / dateAsserted / issued / recorded / date.
//
// The resolved Provenance this feeds (attached to every resource on the read path, see handler
// attachProvenance) is the ONE source of "who" for the whole app: the detail cards' "Reported by"
// (#308) and the /medical-history group-by-Provider/Place dimension (#351) both read it — neither
// should re-extract performers/authors itself.
func ExtractRequest(raw json.RawMessage, targetType, targetID, sourceLabel string) Request {
	var r struct {
		Asserter          *Reference  `json:"asserter"`
		Recorder          *Reference  `json:"recorder"`
		Requester         *Reference  `json:"requester"`
		InformationSource *Reference  `json:"informationSource"`
		Author            []Reference `json:"author"`
		Encounter         *Reference  `json:"encounter"`

		// performer covers two FHIR shapes: a plain reference array (DiagnosticReport, Observation)
		// and a BackboneElement carrying an `actor` (Procedure, Immunization, MedicationAdministration).
		// Both are captured per element below — it is the "who" for performed/administered records.
		Performer []struct {
			Reference string     `json:"reference"`
			Display   string     `json:"display"`
			Actor     *Reference `json:"actor"`
		} `json:"performer"`

		RecordedDate string `json:"recordedDate"`
		AuthoredOn   string `json:"authoredOn"`
		DateAsserted string `json:"dateAsserted"`
		Issued       string `json:"issued"`
		Recorded     string `json:"recorded"`
		Date         string `json:"date"`
	}
	_ = json.Unmarshal(raw, &r) // absent/!= fields stay zero — never fabricated

	var authors []Reference
	for _, ref := range []*Reference{r.Asserter, r.Recorder, r.Requester, r.InformationSource} {
		if ref != nil && ref.Reference != "" {
			authors = append(authors, *ref)
		}
	}
	for _, p := range r.Performer {
		if p.Actor != nil && p.Actor.Reference != "" {
			authors = append(authors, *p.Actor) // BackboneElement.performer[].actor
		} else if p.Reference != "" {
			authors = append(authors, Reference{Reference: p.Reference, Display: p.Display}) // plain reference
		}
	}
	for _, a := range r.Author {
		if a.Reference != "" {
			authors = append(authors, a)
		}
	}

	enc := Reference{}
	if r.Encounter != nil {
		enc = *r.Encounter
	}

	return Request{
		Authors:      authors,
		Encounter:    enc,
		TargetType:   targetType,
		TargetID:     targetID,
		SourceLabel:  sourceLabel,
		AuthoredTime: firstNonEmpty(r.RecordedDate, r.AuthoredOn, r.DateAsserted, r.Issued, r.Recorded, r.Date),
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
