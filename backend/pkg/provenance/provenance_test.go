package provenance

import "testing"

func TestResolveProvenance_Ladder(t *testing.T) {
	s := NewResourceSet(testResources())

	cases := []struct {
		name        string
		req         Request
		wantKind    string
		wantDisplay string
		wantLevel   int
	}{
		{
			name:     "asserter resolves to a named practitioner",
			req:      Request{Authors: []Reference{{Reference: "Practitioner/dr-1"}}, SourceLabel: "FollowMyHealth"},
			wantKind: KindPractitioner, wantDisplay: "Dr. Jane Synthetic", wantLevel: 1,
		},
		{
			name:     "patient asserter is self-reported (from the type alone)",
			req:      Request{Authors: []Reference{{Reference: "Patient/pat-1"}}, SourceLabel: "FollowMyHealth"},
			wantKind: KindSelfReported, wantDisplay: "Self-reported", wantLevel: 1,
		},
		{
			name:     "falls back from empty asserter to recorder",
			req:      Request{Authors: []Reference{{Reference: ""}, {Reference: "Practitioner/dr-2"}}, SourceLabel: "FollowMyHealth"},
			wantKind: KindPractitioner, wantDisplay: "Dr. John Doe", wantLevel: 1,
		},
		{
			name:     "inline reference display is used without resolving",
			req:      Request{Authors: []Reference{{Reference: "Practitioner/not-in-set", Display: "Dr. Inline"}}, SourceLabel: "FollowMyHealth"},
			wantKind: KindPractitioner, wantDisplay: "Dr. Inline", wantLevel: 1,
		},
		{
			name:     "encounter service provider when no author (underscore reference)",
			req:      Request{Encounter: Reference{Reference: "Encounter/pat-1_enc-1"}, SourceLabel: "FollowMyHealth"},
			wantKind: KindOrganization, wantDisplay: "Synthetic Clinic", wantLevel: 2,
		},
		{
			name:     "provenance resource targeting the record",
			req:      Request{TargetType: "Condition", TargetID: "cond-prov", SourceLabel: "FollowMyHealth"},
			wantKind: KindProvenance, wantDisplay: "Audit System", wantLevel: 3,
		},
		{
			name:     "floor when nothing resolves — never invents a clinician",
			req:      Request{Authors: []Reference{{Reference: "Practitioner/ghost"}}, SourceLabel: "FollowMyHealth"},
			wantKind: KindSource, wantDisplay: "Source: FollowMyHealth", wantLevel: 4,
		},
	}

	for _, c := range cases {
		got := s.ResolveProvenance(c.req)
		if got.Kind != c.wantKind || got.Display != c.wantDisplay || got.Level != c.wantLevel {
			t.Errorf("%s: got %+v, want {Kind:%s Display:%q Level:%d}", c.name, got, c.wantKind, c.wantDisplay, c.wantLevel)
		}
	}
}

// The USCDI Author Time Stamp passes through onto the result, regardless of which rung answered, and
// is never fabricated when absent.
func TestResolveProvenance_AuthorTimeStamp(t *testing.T) {
	s := NewResourceSet(testResources())

	withTime := s.ResolveProvenance(Request{
		Authors:      []Reference{{Reference: "Practitioner/dr-1"}},
		AuthoredTime: "2019-03-14",
		SourceLabel:  "FollowMyHealth",
	})
	if withTime.Recorded != "2019-03-14" {
		t.Errorf("recorded = %q, want %q", withTime.Recorded, "2019-03-14")
	}

	// Floor rung still carries the timestamp.
	floorWithTime := s.ResolveProvenance(Request{
		Authors:      []Reference{{Reference: "Practitioner/ghost"}},
		AuthoredTime: "2020-01-02",
		SourceLabel:  "FollowMyHealth",
	})
	if floorWithTime.Kind != KindSource || floorWithTime.Recorded != "2020-01-02" {
		t.Errorf("floor: got kind=%q recorded=%q, want source / 2020-01-02", floorWithTime.Kind, floorWithTime.Recorded)
	}

	// Absent author time is left empty, never fabricated.
	noTime := s.ResolveProvenance(Request{Authors: []Reference{{Reference: "Patient/pat-1"}}})
	if noTime.Recorded != "" {
		t.Errorf("recorded = %q, want empty when the record gives no author time", noTime.Recorded)
	}
}
