package provenance

import (
	"encoding/json"
	"strings"
)

// Provenance kinds — the rung of the ladder that answered "who said this".
const (
	KindPractitioner = "practitioner"  // a named clinician (asserter/recorder)
	KindSelfReported = "self-reported" // the Patient asserted it
	KindOrganization = "organization"  // a named organization (asserter or encounter service provider)
	KindProvenance   = "provenance"    // a Provenance resource targets the record
	KindSource       = "source"        // floor: the import source/connection
)

// Provenance is the resolved "who said this" for a resource: the best level found, labeled, never
// fabricated. Level is the ladder rung (1 strongest), useful for badges/sorting. Recorded is the
// USCDI "Author Time Stamp" — when the record states it was authored/asserted — passed through from
// the record as a raw FHIR date string ("" when the record gives none; never fabricated).
type Provenance struct {
	Kind     string `json:"kind"`
	Display  string `json:"display"`
	Level    int    `json:"level"`
	Recorded string `json:"recorded,omitempty"`
}

// Request is a generic provenance query: author references in priority order (e.g. asserter then
// recorder, or requester then informationSource), the resource's encounter (if any), the target's
// own type/id (to find a Provenance resource pointing at it), and the import source label (the floor).
type Request struct {
	Authors     []Reference
	Encounter   Reference
	TargetType  string
	TargetID    string
	SourceLabel string
	// AuthoredTime is the record's own author timestamp (e.g. Condition.recordedDate,
	// MedicationRequest.authoredOn) — the USCDI "Author Time Stamp". Passed straight through onto the
	// result's Recorded field; "" when the record gives none.
	AuthoredTime string
}

// ResolveProvenance walks the provenance ladder and returns the best-labeled author, never inventing one:
//  1. an author reference (asserter → recorder): Patient ⇒ "Self-reported"; else a named Practitioner/Organization
//  2. the encounter's service provider (Encounter.serviceProvider)
//  3. a Provenance resource targeting the record
//  4. floor: "Source: <import source>"
func (s *ResourceSet) ResolveProvenance(req Request) Provenance {
	p := s.resolveLadder(req)
	p.Recorded = req.AuthoredTime // USCDI Author Time Stamp — the record's own, never fabricated
	return p
}

func (s *ResourceSet) resolveLadder(req Request) Provenance {
	// 1. authors, in priority order
	for _, a := range req.Authors {
		if p, ok := s.resolveAuthor(a); ok {
			return p
		}
	}
	// 2. encounter → service provider
	if p, ok := s.resolveEncounterProvider(req.Encounter); ok {
		return p
	}
	// 3. a Provenance resource targeting this record
	if req.TargetType != "" && req.TargetID != "" {
		if provs := s.provByTarget[req.TargetType+"/"+req.TargetID]; len(provs) > 0 {
			name := provenanceAgentName(provs[0])
			if name == "" {
				name = "Provenance record"
			}
			return Provenance{Kind: KindProvenance, Display: name, Level: 3}
		}
	}
	// 4. floor: never invent an originating clinic
	label := req.SourceLabel
	if label == "" {
		label = "import source"
	}
	return Provenance{Kind: KindSource, Display: "Source: " + label, Level: 4}
}

// resolveAuthor resolves a single author reference. A Patient reference is self-reported (knowable
// from the type alone). Otherwise we need a name — from the reference's own display, or by resolving
// the referenced resource. If neither yields a name, we cannot attribute it (no fabrication).
func (s *ResourceSet) resolveAuthor(ref Reference) (Provenance, bool) {
	typ, _ := parseReference(ref.Reference)
	if typ == "" {
		return Provenance{}, false
	}
	if typ == "Patient" || typ == "RelatedPerson" {
		return Provenance{Kind: KindSelfReported, Display: "Self-reported", Level: 1}, true
	}
	name := ref.Display
	if name == "" {
		if r, ok := s.Resolve(ref.Reference); ok {
			name = displayName(r.Raw)
		}
	}
	if name == "" {
		return Provenance{}, false // a reference we can't name — fall through rather than guess
	}
	if typ == "Organization" {
		return Provenance{Kind: KindOrganization, Display: name, Level: 1}, true
	}
	return Provenance{Kind: KindPractitioner, Display: name, Level: 1}, true
}

// resolveEncounterProvider resolves Encounter → Encounter.serviceProvider (an Organization).
func (s *ResourceSet) resolveEncounterProvider(enc Reference) (Provenance, bool) {
	if enc.Reference == "" {
		return Provenance{}, false
	}
	r, ok := s.Resolve(enc.Reference)
	if !ok {
		return Provenance{}, false
	}
	var e struct {
		ServiceProvider *Reference `json:"serviceProvider"`
	}
	if json.Unmarshal(r.Raw, &e) != nil || e.ServiceProvider == nil {
		return Provenance{}, false
	}
	name := e.ServiceProvider.Display
	if name == "" {
		if org, ok := s.Resolve(e.ServiceProvider.Reference); ok {
			name = displayName(org.Raw)
		}
	}
	if name == "" {
		return Provenance{}, false
	}
	return Provenance{Kind: KindOrganization, Display: name, Level: 2}, true
}

// --- name extraction --------------------------------------------------------

type humanName struct {
	Text   string   `json:"text"`
	Family string   `json:"family"`
	Given  []string `json:"given"`
	Prefix []string `json:"prefix"`
}

// displayName extracts a human label from a Practitioner/Organization (or any named) resource.
func displayName(raw json.RawMessage) string {
	var r struct {
		Name json.RawMessage `json:"name"`
	}
	if json.Unmarshal(raw, &r) != nil || len(r.Name) == 0 {
		return ""
	}
	// Organization.name is a string; Practitioner.name is an array of HumanName.
	var orgName string
	if json.Unmarshal(r.Name, &orgName) == nil && orgName != "" {
		return orgName
	}
	var names []humanName
	if json.Unmarshal(r.Name, &names) == nil {
		for _, n := range names {
			if formatted := formatHumanName(n); formatted != "" {
				return formatted
			}
		}
	}
	return ""
}

func formatHumanName(n humanName) string {
	if n.Text != "" {
		return n.Text
	}
	var parts []string
	parts = append(parts, n.Prefix...)
	parts = append(parts, n.Given...)
	if n.Family != "" {
		parts = append(parts, n.Family)
	}
	return strings.TrimSpace(strings.Join(parts, " "))
}

// provenanceAgentName pulls a display name from a Provenance resource's first agent.who.
func provenanceAgentName(p Resource) string {
	var prov struct {
		Agent []struct {
			Who *Reference `json:"who"`
		} `json:"agent"`
	}
	if json.Unmarshal(p.Raw, &prov) != nil {
		return ""
	}
	for _, a := range prov.Agent {
		if a.Who == nil {
			continue
		}
		if a.Who.Display != "" {
			return a.Who.Display
		}
	}
	return ""
}
