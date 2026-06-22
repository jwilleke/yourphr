package database

import (
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// Database restore (#362). Restoring overwrites the ENTIRE single-file DB — every user's records — so it
// is admin-gated and DANGEROUS. We never swap a live, open DB: a restore is STAGED (validated, with an
// auto-backup of the current DB taken first), then APPLIED at the next startup before the DB is opened.

const restorePendingName = ".restore_pending.db"

func restorePendingPath(appConfig config.Interface) string {
	return filepath.Join(dbDirFromConfig(appConfig), restorePendingName)
}

// StageRestore validates a backup file and stages it for the next startup. It takes an auto-backup of
// the current DB first (so the restore is reversible), decompresses the candidate (if .gz), validates
// it is an intact SQLite database, then writes it to the pending path. The swap happens at startup.
func (gr *GormRepository) StageRestore(appConfig config.Interface, srcPath string) error {
	tmp, cleanup, err := decompressIfNeeded(srcPath)
	if err != nil {
		return err
	}
	defer cleanup()

	if err := validateSqliteFile(tmp); err != nil {
		return fmt.Errorf("not a valid/intact backup: %w", err)
	}
	// Reversibility (best-effort): take a durable timestamped backup of the current DB and prune to the
	// retention limit. A read-only/unavailable destination must NOT block the restore — ApplyPendingRestore
	// also writes <db>.pre-restore at apply time, which is the guaranteed safety copy (#368 #7).
	if _, _, err := gr.PerformBackup(appConfig, ""); err == nil {
		settings := LoadBackupSettings(appConfig)
		_, _ = PruneBackups(ResolveDestination(appConfig, settings), settings.MaxBackups)
	}
	if err := copyFile(tmp, restorePendingPath(appConfig)); err != nil {
		return fmt.Errorf("could not stage restore: %w", err)
	}
	return nil
}

// ApplyPendingRestore runs at startup BEFORE the DB is opened. If a restore is staged, it copies the
// current live DB aside (<db>.pre-restore), replaces it with the staged file, clears WAL/SHM (so SQLite
// rebuilds from the restored main file), and removes the pending marker. Returns whether it applied one.
func ApplyPendingRestore(appConfig config.Interface) (bool, error) {
	pending := restorePendingPath(appConfig)
	if _, err := os.Stat(pending); err != nil {
		return false, nil // nothing staged
	}
	live := appConfig.GetString("database.location")
	// Safety copy of the current DB is REQUIRED — never destroy the live DB if we can't back it up first
	// (#368). Only when a live DB actually exists.
	if _, err := os.Stat(live); err == nil {
		if err := copyFile(live, live+".pre-restore"); err != nil {
			return false, fmt.Errorf("aborting restore: could not write pre-restore safety copy: %w", err)
		}
	}
	// Atomic swap: copy to a sibling temp, then rename over the live path. Rename is atomic on the same
	// filesystem, so a crash/disk-full mid-copy can never leave a half-written live DB (#368 / finding #2).
	staging := live + ".restoring"
	if err := copyFile(pending, staging); err != nil {
		os.Remove(staging)
		return false, fmt.Errorf("apply restore failed (staging copy): %w", err)
	}
	if err := os.Rename(staging, live); err != nil {
		os.Remove(staging)
		return false, fmt.Errorf("apply restore failed (rename): %w", err)
	}
	_ = os.Remove(live + "-wal")
	_ = os.Remove(live + "-shm")
	_ = os.Remove(pending)
	return true, nil
}

// validateSqliteFile opens the file read-only and runs integrity_check (the sqlcipher driver opens a
// plaintext DB without a key). Errors if it's not a real, intact SQLite database.
func validateSqliteFile(path string) error {
	db, err := gorm.Open(sqlite.Open("file:"+path+"?mode=ro&_busy_timeout=2000"), &gorm.Config{})
	if err != nil {
		return err
	}
	if sqlDB, e := db.DB(); e == nil {
		defer sqlDB.Close()
	}
	var res string
	if err := db.Raw("PRAGMA integrity_check").Scan(&res).Error; err != nil {
		return err
	}
	if !strings.EqualFold(res, "ok") {
		return fmt.Errorf("integrity_check: %s", res)
	}
	return nil
}

// decompressIfNeeded returns the path to an uncompressed copy of src (when it's .gz), plus a cleanup
// func. For a non-.gz src it returns src and a no-op cleanup.
func decompressIfNeeded(src string) (string, func(), error) {
	if !strings.HasSuffix(src, ".gz") {
		return src, func() {}, nil
	}
	in, err := os.Open(src)
	if err != nil {
		return "", nil, err
	}
	defer in.Close()
	zr, err := gzip.NewReader(in)
	if err != nil {
		return "", nil, fmt.Errorf("not a gzip file: %w", err)
	}
	defer zr.Close()
	tmp, err := os.CreateTemp("", "yourphr-restore-*.db")
	if err != nil {
		return "", nil, err
	}
	if _, err := io.Copy(tmp, zr); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return "", nil, err
	}
	tmp.Close()
	return tmp.Name(), func() { os.Remove(tmp.Name()) }, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
