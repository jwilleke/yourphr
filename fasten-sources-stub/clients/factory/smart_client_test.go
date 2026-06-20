package factory

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fastenhealth/fasten-sources/clients/models"
	"github.com/fastenhealth/fasten-sources/clients/smart"
	"github.com/sirupsen/logrus"
)

// syncCred is a SourceCredential wired for a full SyncAll run (patient id + FHIR base + a valid token),
// reusing fakeCred (refresh_test.go) for the rest of the interface.
type syncCred struct {
	*fakeCred
	patientID string
	clientID  string
}

func (s *syncCred) GetPatientId() string { return s.patientID }
func (s *syncCred) GetClientId() string  { return s.clientID }

// fakeDB records every upserted resource so a test can assert what was imported.
type fakeDB struct{ upserts []models.RawResourceFhir }

func (d *fakeDB) UpsertRawResource(_ context.Context, _ models.SourceCredential, r models.RawResourceFhir) (bool, error) {
	d.upserts = append(d.upserts, r)
	return true, nil
}

var _ models.DatabaseRepository = (*fakeDB)(nil)

// End-to-end: SyncAll imports a DocumentReference, then follows its attachment URL to fetch and store
// the referenced Binary (the document bytes). #342.
func TestSyncAllFollowsDocumentReferenceToBinary(t *testing.T) {
	smart.AllowInternalHostsForTest = true // allow httptest loopback through the SSRF guard
	defer func() { smart.AllowInternalHostsForTest = false }()

	var base string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/.well-known/smart-configuration":
			fmt.Fprintf(w, `{"authorization_endpoint":%q,"token_endpoint":%q}`, base+"/auth", base+"/token")
		case r.URL.Path == "/metadata":
			http.NotFound(w, r) // CapabilityStatement unreadable → falls back to Patient/$everything
		case strings.Contains(r.URL.Path, "$everything"):
			if r.Header.Get("Authorization") != "Bearer tok" {
				http.Error(w, "missing bearer", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/fhir+json")
			fmt.Fprintf(w, `{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"DocumentReference","id":"d1","content":[{"attachment":{"contentType":"application/pdf","url":%q}}]}}]}`, base+"/Binary/b1")
		case r.URL.Path == "/Binary/b1":
			if r.Header.Get("Authorization") != "Bearer tok" {
				http.Error(w, "missing bearer", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/fhir+json")
			fmt.Fprint(w, `{"resourceType":"Binary","id":"b1","contentType":"application/pdf","data":"aGVsbG8="}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	base = srv.URL

	cred := &syncCred{
		fakeCred:  &fakeCred{accessToken: "tok", expiresAt: time.Now().Add(time.Hour).Unix(), fhirBase: srv.URL},
		patientID: "p1",
		clientID:  "c1",
	}
	client := newSmartClient(context.Background(), logrus.WithField("t", t.Name()), cred)
	db := &fakeDB{}

	summary, err := client.SyncAll(db)
	if err != nil {
		t.Fatalf("SyncAll: %v", err)
	}

	var sawDoc, sawBin bool
	for _, u := range db.upserts {
		if u.SourceResourceType == "DocumentReference" && u.SourceResourceID == "d1" {
			sawDoc = true
		}
		if u.SourceResourceType == "Binary" && u.SourceResourceID == "b1" {
			sawBin = true
		}
	}
	if !sawDoc {
		t.Error("DocumentReference/d1 was not imported")
	}
	if !sawBin {
		t.Error("Binary/b1 (the document bytes) was not fetched and imported")
	}
	if summary.TotalResources != 2 {
		t.Errorf("TotalResources = %d, want 2 (DocumentReference + Binary)", summary.TotalResources)
	}
}

func TestExtractAttachmentURLs(t *testing.T) {
	docRef := []byte(`{"resourceType":"DocumentReference","content":[
		{"attachment":{"contentType":"application/pdf","url":"Binary/b1"}},
		{"attachment":{"contentType":"text/plain","data":"aGk="}},
		{"attachment":{"contentType":"text/xml","url":"https://x/Binary/b2"}}
	]}`)
	got := extractAttachmentURLs("DocumentReference", docRef)
	if len(got) != 2 || got[0] != "Binary/b1" || got[1] != "https://x/Binary/b2" {
		t.Errorf("DocumentReference urls = %v, want [Binary/b1 https://x/Binary/b2] (inline-data attachment skipped)", got)
	}

	diag := []byte(`{"resourceType":"DiagnosticReport","presentedForm":[
		{"contentType":"application/pdf","url":"Binary/dr1"},
		{"contentType":"application/pdf","data":"aGk="}
	]}`)
	got = extractAttachmentURLs("DiagnosticReport", diag)
	if len(got) != 1 || got[0] != "Binary/dr1" {
		t.Errorf("DiagnosticReport urls = %v, want [Binary/dr1]", got)
	}

	if got := extractAttachmentURLs("Observation", []byte(`{"resourceType":"Observation"}`)); len(got) != 0 {
		t.Errorf("non-document resource should yield no urls, got %v", got)
	}
}
