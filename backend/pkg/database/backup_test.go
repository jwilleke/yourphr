package database

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/version"
)

func TestBackupRestore_GatedWhenEncrypted(t *testing.T) {
	appConfig, err := config.Create()
	if err != nil {
		t.Fatal(err)
	}
	appConfig.Set("database.location", filepath.Join(t.TempDir(), "fasten.db"))
	appConfig.Set("database.encryption.enabled", true)
	gr := &GormRepository{} // gate returns before touching the DB client

	if _, _, err := gr.PerformBackup(appConfig, ""); !errors.Is(err, ErrEncryptionEnabled) {
		t.Errorf("PerformBackup should be gated when encryption is enabled, got: %v", err)
	}
	if err := gr.StageRestore(appConfig, "anything"); !errors.Is(err, ErrEncryptionEnabled) {
		t.Errorf("StageRestore should be gated when encryption is enabled, got: %v", err)
	}
}

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

func TestParseHHMM(t *testing.T) {
	cases := []struct {
		in   string
		ok   bool
		h, m int
	}{
		{"02:00", true, 2, 0}, {"2:5", true, 2, 5}, {"23:59", true, 23, 59},
		{"24:00", false, 0, 0}, {"12:60", false, 0, 0}, {"abc", false, 0, 0}, {"1230", false, 0, 0}, {"", false, 0, 0},
	}
	for _, c := range cases {
		h, m, ok := ParseHHMM(c.in)
		if ok != c.ok || (ok && (h != c.h || m != c.m)) {
			t.Errorf("ParseHHMM(%q) = %d,%d,%v; want %d,%d,%v", c.in, h, m, ok, c.h, c.m, c.ok)
		}
	}
}

func TestLoadBackupSettings_MigratesLegacyDest(t *testing.T) {
	dir := t.TempDir()
	appConfig, err := config.Create()
	if err != nil {
		t.Fatal(err)
	}
	appConfig.Set("database.location", filepath.Join(dir, "fasten.db"))
	if err := os.WriteFile(filepath.Join(dir, ".backup_dest"), []byte("/some/custom/dir\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := LoadBackupSettings(appConfig).Destination; got != "/some/custom/dir" {
		t.Errorf("legacy .backup_dest not migrated: Destination = %q, want /some/custom/dir", got)
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
