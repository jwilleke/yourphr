package database

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
)

// Database backup support (#361). A backup is a consistent ONLINE snapshot of the SQLite DB via
// `VACUUM INTO` (safe on a live DB, never a raw file copy). Shared by the admin handler (manual
// "Backup now") and the scheduled-backup worker. The backup is the entire single-file DB — every
// user's records (PHI) — so callers must gate on the admin role / run server-side only.

const BackupFilePrefix = "yourphr-backup-"

// BackupFile describes one backup present in a destination folder.
type BackupFile struct {
	Name      string `json:"name"`
	SizeBytes int64  `json:"size_bytes"`
	Modified  string `json:"modified"` // RFC3339 UTC
}

func dbDirFromConfig(appConfig config.Interface) string {
	return filepath.Dir(appConfig.GetString("database.location"))
}

// DefaultBackupDir is where backups go unless a destination is chosen: a "backups" folder next to the
// DB (same data volume, so it persists).
func DefaultBackupDir(appConfig config.Interface) string {
	return filepath.Join(dbDirFromConfig(appConfig), "backups")
}

// backupMarkerPath holds the last-used destination (a one-line file in the data dir) so the chosen
// destination persists until changed — without a settings-schema change.
func backupMarkerPath(appConfig config.Interface) string {
	return filepath.Join(dbDirFromConfig(appConfig), ".backup_dest")
}

// CurrentBackupDestination is the last-used destination, falling back to the default folder.
func CurrentBackupDestination(appConfig config.Interface) string {
	if b, err := os.ReadFile(backupMarkerPath(appConfig)); err == nil {
		if p := strings.TrimSpace(string(b)); p != "" {
			return p
		}
	}
	return DefaultBackupDir(appConfig)
}

// ListBackups returns the backups in dir, newest first.
func ListBackups(dir string) []BackupFile {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []BackupFile{}
	}
	out := make([]BackupFile, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasPrefix(e.Name(), BackupFilePrefix) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, BackupFile{Name: e.Name(), SizeBytes: info.Size(), Modified: info.ModTime().UTC().Format(time.RFC3339)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Modified > out[j].Modified })
	return out
}

// PerformBackup writes a consistent snapshot into destOverride (or the current/last-used destination),
// records that destination as the new default, and returns the created file + its full path. The
// filename is canonical and sortable: yourphr-backup-2026-06-21-071234.db.
func (gr *GormRepository) PerformBackup(appConfig config.Interface, destOverride string) (BackupFile, string, error) {
	dest := strings.TrimSpace(destOverride)
	if dest == "" {
		dest = CurrentBackupDestination(appConfig)
	}
	if !filepath.IsAbs(dest) {
		return BackupFile{}, "", fmt.Errorf("destination must be an absolute path")
	}
	if err := os.MkdirAll(dest, 0o750); err != nil {
		return BackupFile{}, "", fmt.Errorf("cannot create destination: %w", err)
	}

	name := BackupFilePrefix + time.Now().UTC().Format("2006-01-02-150405") + ".db"
	full := filepath.Join(dest, name)

	// VACUUM INTO does not accept a bound parameter for the path; it's server/admin-controlled. Escape
	// single quotes defensively.
	safe := strings.ReplaceAll(full, "'", "''")
	if err := gr.GormClient.Exec(fmt.Sprintf("VACUUM INTO '%s'", safe)).Error; err != nil {
		return BackupFile{}, "", fmt.Errorf("backup failed: %w", err)
	}

	_ = os.WriteFile(backupMarkerPath(appConfig), []byte(dest), 0o600) // remember as default (best-effort)

	bf := BackupFile{Name: name, Modified: time.Now().UTC().Format(time.RFC3339)}
	if fi, err := os.Stat(full); err == nil {
		bf.SizeBytes = fi.Size()
	}
	return bf, full, nil
}

// PruneBackups keeps the newest `keep` backups in dir and deletes the rest. keep <= 0 disables pruning.
func PruneBackups(dir string, keep int) (int, error) {
	if keep <= 0 {
		return 0, nil
	}
	files := ListBackups(dir) // newest first
	if len(files) <= keep {
		return 0, nil
	}
	removed := 0
	for _, f := range files[keep:] {
		if err := os.Remove(filepath.Join(dir, f.Name)); err == nil {
			removed++
		}
	}
	return removed, nil
}
