package models

import (
	"strings"
	"testing"
)

// The shipped defaults carry the known non-secret config but NO credentials, and start disabled.
func TestDefaultProviderCatalogEntries_NoCredentials(t *testing.T) {
	entries := DefaultProviderCatalogEntries()
	// One default entry per sandbox seed — derive the count so adding a sandbox doesn't break this.
	if want := len(SandboxProviderSeeds()); len(entries) != want {
		t.Fatalf("expected %d default entries (one per sandbox seed), got %d", want, len(entries))
	}
	if len(entries) == 0 {
		t.Fatal("expected at least one default entry")
	}
	for _, e := range entries {
		if e.ClientId != "" || e.ClientSecret != "" {
			t.Errorf("default %q must ship with empty credentials, got client_id=%q secret_set=%v", e.Display, e.ClientId, e.ClientSecret != "")
		}
		if e.Enabled {
			t.Errorf("default %q must ship disabled (admin enables after adding a client_id)", e.Display)
		}
		if e.ApiEndpointBaseUrl == "" || e.Scopes == "" {
			t.Errorf("default %q must pre-fill base URL + scopes", e.Display)
		}
	}
}

// Blue Button's seeded scopes must match the verified sandbox set — NO offline_access (it 400s there).
func TestDefaultProviderCatalogEntries_BlueButtonScopes(t *testing.T) {
	var bb *ProviderCatalogEntry
	for i := range DefaultProviderCatalogEntries() {
		if strings.Contains(DefaultProviderCatalogEntries()[i].Display, "Blue Button") {
			e := DefaultProviderCatalogEntries()[i]
			bb = &e
		}
	}
	if bb == nil {
		t.Fatal("no Blue Button default entry")
	}
	if strings.Contains(bb.Scopes, "offline_access") {
		t.Errorf("Blue Button scopes must NOT include offline_access (sandbox rejects it): %q", bb.Scopes)
	}
	for _, want := range []string{"patient/Patient.read", "patient/Coverage.read", "patient/ExplanationOfBenefit.read"} {
		if !strings.Contains(bb.Scopes, want) {
			t.Errorf("Blue Button scopes missing %q: %q", want, bb.Scopes)
		}
	}
}
