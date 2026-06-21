package database

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/version"
)

func TestBackupFileName(t *testing.T) {
	t0 := time.Date(2026, 6, 21, 12, 10, 3, 0, time.UTC)
	if got, want := BackupFileName(t0, ""), "2026-06-21T12-10-03Z-yourphr-"+version.VERSION+"-backup.db.gz"; got != want {
		t.Errorf("BackupFileName(no label) = %q, want %q", got, want)
	}
	if got, want := BackupFileName(t0, "dev"), "2026-06-21T12-10-03Z-yourphr-dev-"+version.VERSION+"-backup.db.gz"; got != want {
		t.Errorf("BackupFileName(dev) = %q, want %q", got, want)
	}
	if got, want := BackupFileName(t0, "weird/label name"), "2026-06-21T12-10-03Z-yourphr-weird-label-name-"+version.VERSION+"-backup.db.gz"; got != want {
		t.Errorf("BackupFileName(sanitize) = %q, want %q", got, want)
	}
}

func TestIsBackupFile(t *testing.T) {
	cases := map[string]bool{
		"2026-06-21T14-09-57Z-yourphr-1.9.0-backup.db.gz": true, // current version-stamped name
		"2026-06-21T12-10-03Z-yourphr-backup.db.gz":       true,
		"2026-06-21T12-10-03Z-yourphr-backup.db":          true,
		"yourphr-backup-20260101.db":                      true, // legacy name still recognized
		"random.db":                                       false,
		"yourphr-backup.txt":                              false,
		"notes.md":                                        false,
		"2026-06-21T12-10-03Z-yourphr-old-backup-notes.db": false, // foreign file, not a real backup (#368 #3)
		"company-backup.db":                                false, // no yourphr marker
	}
	for name, want := range cases {
		if got := isBackupFile(name); got != want {
			t.Errorf("isBackupFile(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestPruneBackups(t *testing.T) {
	dir := t.TempDir()
	base := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 5; i++ {
		mt := base.Add(time.Duration(i) * time.Hour)
		p := filepath.Join(dir, BackupFileName(mt, ""))
		if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		_ = os.Chtimes(p, mt, mt)
	}
	removed, err := PruneBackups(dir, 3)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 2 {
		t.Errorf("removed = %d, want 2", removed)
	}
	if got := len(ListBackups(dir)); got != 3 {
		t.Errorf("remaining = %d, want 3", got)
	}
}
