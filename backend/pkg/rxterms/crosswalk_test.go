package rxterms

import "testing"

func TestCrosswalk_EmbeddedLookup(t *testing.T) {
	cw := DefaultCrosswalk()
	if n := cw.Len(); n < 10000 {
		t.Fatalf("embedded crosswalk should load thousands of entries, got %d", n)
	}
	for rx, want := range map[string][2]string{
		"313782": {"Acetaminophen (Oral Pill)", "325 mg"},
		"308192": {"Amoxicillin (Oral Pill)", "500 mg"},
		"562251": {"Amoxicillin/Clavulanate (Oral Pill)", "250-125 mg"},
	} {
		name, strength := cw.Lookup(rx)
		if name != want[0] || strength != want[1] {
			t.Errorf("Lookup(%s) = (%q, %q), want (%q, %q)", rx, name, strength, want[0], want[1])
		}
	}
	if name, strength := cw.Lookup("0000000"); name != "" || strength != "" {
		t.Errorf("Lookup(unknown) = (%q, %q), want empty", name, strength)
	}
	if name, strength := cw.Lookup(""); name != "" || strength != "" {
		t.Errorf("Lookup(empty) = (%q, %q), want empty", name, strength)
	}
}
