package database

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// TestBackupRestoreRoundTrip is the critical verifiable test for #362: data is backed up, then changed,
// then restored — and must come back EXACTLY. Restore is staged + applied at "startup" (as in
// production), never an in-place swap of an open DB.
func TestBackupRestoreRoundTrip(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "fasten.db")

	appConfig, err := config.Create()
	if err != nil {
		t.Fatal(err)
	}
	appConfig.Set("database.location", dbPath)

	openDB := func() *gorm.DB {
		db, err := gorm.Open(sqlite.Open("file:"+dbPath+"?_busy_timeout=5000"), &gorm.Config{})
		if err != nil {
			t.Fatalf("open db: %v", err)
		}
		return db
	}
	closeDB := func(db *gorm.DB) {
		if s, e := db.DB(); e == nil {
			_ = s.Close()
		}
	}

	// 1. Seed known data.
	db := openDB()
	if err := db.Exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO notes (id, body) VALUES (1, 'original')").Error; err != nil {
		t.Fatal(err)
	}
	gr := &GormRepository{GormClient: db}

	// 2. Back up (gzip).
	_, backupPath, err := gr.PerformBackup(appConfig, "")
	if err != nil {
		t.Fatalf("backup: %v", err)
	}
	if filepath.Ext(backupPath) != ".gz" {
		t.Errorf("expected a .gz backup, got %s", backupPath)
	}

	// 3. Mutate (simulate data loss / a bad change).
	if err := db.Exec("UPDATE notes SET body='CHANGED' WHERE id=1").Error; err != nil {
		t.Fatal(err)
	}

	// 4. Stage a restore from the backup (validates + auto-backs-up the current DB).
	if err := gr.StageRestore(appConfig, backupPath); err != nil {
		t.Fatalf("stage restore: %v", err)
	}

	// 5. Simulate shutdown, then apply at "startup".
	closeDB(db)
	applied, err := ApplyPendingRestore(appConfig)
	if err != nil {
		t.Fatalf("apply restore: %v", err)
	}
	if !applied {
		t.Fatal("expected a staged restore to apply")
	}

	// 6. Reopen and verify the data is the ORIGINAL (round-trip succeeded).
	db2 := openDB()
	defer closeDB(db2)
	var body string
	if err := db2.Raw("SELECT body FROM notes WHERE id=1").Scan(&body).Error; err != nil {
		t.Fatal(err)
	}
	if body != "original" {
		t.Fatalf("after restore, body = %q, want %q — restore did NOT round-trip", body, "original")
	}

	// 7. A pre-restore safety copy exists; the pending marker is cleared.
	if _, err := os.Stat(dbPath + ".pre-restore"); err != nil {
		t.Errorf("expected a pre-restore safety copy of the prior DB")
	}
	if _, err := os.Stat(restorePendingPath(appConfig)); err == nil {
		t.Errorf("pending restore should be removed after apply")
	}
}

// TestStageRestore_RejectsGarbage ensures a non-SQLite / corrupt file is rejected and never staged.
func TestStageRestore_RejectsGarbage(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "fasten.db")
	appConfig, _ := config.Create()
	appConfig.Set("database.location", dbPath)

	db, err := gorm.Open(sqlite.Open("file:"+dbPath), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE x (a int)").Error; err != nil {
		t.Fatal(err)
	}
	gr := &GormRepository{GormClient: db}

	garbage := filepath.Join(dir, "junk.db")
	if err := os.WriteFile(garbage, []byte("this is not a sqlite database"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := gr.StageRestore(appConfig, garbage); err == nil {
		t.Fatal("expected StageRestore to reject a non-SQLite file")
	}
	if _, err := os.Stat(restorePendingPath(appConfig)); err == nil {
		t.Error("a rejected restore must not be staged")
	}
}
