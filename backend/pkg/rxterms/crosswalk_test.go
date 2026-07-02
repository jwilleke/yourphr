package rxterms

import "testing"

func TestCrosswalk_EmbeddedLookup(t *testing.T) {
	cw := DefaultCrosswalk()
	if n := cw.Len(); n < 10000 {
		t.Fatalf("embedded crosswalk should load thousands of entries, got %d", n)
	}
	for rx, want := range map[string]string{
		"313782": "Acetaminophen (Oral Pill) - 325 mg",
		"308192": "Amoxicillin (Oral Pill) - 500 mg",
		"562251": "Amoxicillin/Clavulanate (Oral Pill) - 250-125 mg",
	} {
		if got := cw.Lookup(rx); got != want {
			t.Errorf("Lookup(%s) = %q, want %q", rx, got, want)
		}
	}
	if got := cw.Lookup("0000000"); got != "" {
		t.Errorf("Lookup(unknown) = %q, want empty", got)
	}
	if got := cw.Lookup(""); got != "" {
		t.Errorf("Lookup(empty) = %q, want empty", got)
	}
}
