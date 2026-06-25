package database

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/version"
)

// Database backup support (#361). A backup is a consistent ONLINE snapshot of the SQLite DB via
// `VACUUM INTO` (safe on a live DB, never a raw file copy). Shared by the admin handler (manual
// "Backup now") and the scheduled-backup worker. The backup is the entire single-file DB — every
// user's records (PHI) — so callers must gate on the admin role / run server-side only.

// Filenames are DATE-FIRST, ISO-ish, UTC, filesystem-safe (colons -> dashes), embed an optional
// instance label (the `backup.label` config / YOURPHR_BACKUP_LABEL env, e.g. "dev"/"prod") and the app
// version that produced them, and are gzip-compressed:
//
//	2026-06-21T14-09-57Z-yourphr-dev-1.9.0-backup.db.gz   (label "dev")
//	2026-06-21T14-09-57Z-yourphr-1.9.0-backup.db.gz       (no label)
//
// — so they sort chronologically by name and you can tell which instance + app version wrote each
// backup (useful when deciding whether a backup is safe to restore). Aligned with ngdpbase (gzip).

// ErrEncryptionEnabled gates backup + restore while at-rest encryption is on (#367 / #363). VACUUM INTO
// would write a PLAINTEXT snapshot of an encrypted DB (PHI leak), and a restore couldn't be opened with
// the cipher key — neither is handled yet. Refuse rather than silently leak/break. No-op when encryption
// is disabled (the default + current deployment), so normal backup/restore is unaffected.
var ErrEncryptionEnabled = errors.New("backup and restore are not available while at-rest database encryption is enabled")

// BackupRestoreGated reports whether backup/restore must be refused (at-rest encryption enabled).
func BackupRestoreGated(appConfig config.Interface) bool {
	return appConfig.GetBool("database.encryption.enabled")
}

// BackupFileName builds the canonical date-first, label+version-stamped, gzip filename for time t.
func BackupFileName(t time.Time, label string) string {
	seg := "yourphr-"
	if l := sanitizeLabel(label); l != "" {
		seg += l + "-"
	}
	return t.UTC().Format("2006-01-02T15-04-05") + "Z-" + seg + version.VERSION + "-backup.db.gz"
}

// sanitizeLabel keeps the instance label filesystem-safe ([A-Za-z0-9._-]; others -> '-').
func sanitizeLabel(label string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(label) {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '_', r == '-':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	return b.String()
}

// backupFileRe matches ONLY our own backup filenames — the current name
// (<iso>Z-yourphr-[<label>-]<version>-backup.db.gz) and older ones (yourphr-backup.db,
// yourphr-backup-<date>.db, <iso>Z-yourphr-backup.db[.gz]). It is anchored on "-backup.db[.gz]" (or the
// legacy "yourphr-backup-<8 digits>.db") so an unrelated file dropped in the destination
// (e.g. "…-yourphr-old-backup-notes.db") is NOT treated as a restorable/prunable backup (#368, finding #3).
var backupFileRe = regexp.MustCompile(`(?i)yourphr-(.*-)?backup(-\d{8})?\.db(\.gz)?$`)

func isBackupFile(name string) bool {
	return backupFileRe.MatchString(name)
}

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

// BackupSettings is the persisted, admin-settable backup configuration — a JSON file in the data dir so
// it survives restarts AND is editable at runtime (the worker re-reads it, so a save takes effect with
// no restart). Config values seed the initial defaults. Schedule model mirrors the ngdpbase
// BackupManager: enable + time-of-day + days, plus destination + retention.
type BackupSettings struct {
	Enabled     bool   `json:"enabled"`     // run scheduled backups
	Time        string `json:"time"`        // "HH:MM" (server-local) — when the scheduled backup runs
	Days        string `json:"days"`        // "daily" | "weekly"
	Destination string `json:"destination"` // absolute folder; "" => DefaultBackupDir
	MaxBackups  int    `json:"max_backups"` // retention; <= 0 disables pruning
}

func backupSettingsPath(appConfig config.Interface) string {
	return filepath.Join(dbDirFromConfig(appConfig), ".backup_settings.json")
}

// LoadBackupSettings reads the persisted settings, falling back to config defaults then hard defaults.
func LoadBackupSettings(appConfig config.Interface) BackupSettings {
	s := BackupSettings{
		Enabled:     appConfig.GetBool("backup.auto-backup"),
		Time:        appConfig.GetString("backup.auto-backup-time"),
		Days:        appConfig.GetString("backup.auto-backup-days"),
		Destination: appConfig.GetString("backup.destination"),
		MaxBackups:  appConfig.GetInt("backup.max-backups"),
	}
	settingsExist := false
	if b, err := os.ReadFile(backupSettingsPath(appConfig)); err == nil {
		_ = json.Unmarshal(b, &s)
		settingsExist = true
	}
	// Migrate the legacy one-line .backup_dest marker (pre-v1.9.0) when there's no settings file and no
	// configured destination, so an admin's custom destination isn't silently lost on upgrade (#368 #6).
	if !settingsExist && strings.TrimSpace(s.Destination) == "" {
		if b, err := os.ReadFile(filepath.Join(dbDirFromConfig(appConfig), ".backup_dest")); err == nil {
			if p := strings.TrimSpace(string(b)); p != "" {
				s.Destination = p
			}
		}
	}
	s.normalize()
	return s
}

// normalize fills hard defaults. Single source of truth for defaulting, shared by LoadBackupSettings and
// SetBackupSchedule so the two can't drift (#368 cleanup).
func (s *BackupSettings) normalize() {
	if s.Time == "" {
		s.Time = "02:00"
	}
	if s.Days == "" {
		s.Days = "daily"
	}
	if s.MaxBackups <= 0 {
		s.MaxBackups = 7
	}
}

// ParseHHMM parses a 24-hour "H:MM"/"HH:MM" time-of-day string. Single shared parser used by both the
// schedule save-validator and the backup worker so the accepted format can't diverge (#368 #9).
func ParseHHMM(v string) (hour, minute int, ok bool) {
	parts := strings.SplitN(strings.TrimSpace(v), ":", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	h, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	m, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, 0, false
	}
	return h, m, true
}

// SaveBackupSettings persists the settings.
func SaveBackupSettings(appConfig config.Interface, s BackupSettings) error {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(backupSettingsPath(appConfig), b, 0o600)
}

// ResolveDestination returns the configured destination, or the default folder when unset.
func ResolveDestination(appConfig config.Interface, s BackupSettings) string {
	if d := strings.TrimSpace(s.Destination); d != "" {
		return d
	}
	return DefaultBackupDir(appConfig)
}

// CurrentBackupDestination is the resolved destination from the current settings.
func CurrentBackupDestination(appConfig config.Interface) string {
	return ResolveDestination(appConfig, LoadBackupSettings(appConfig))
}

// AllowedBackupRoots is the allowlist of base directories a backup destination may live under: the data
// volume (covers DefaultBackupDir), the configured backup.destination (covers the prod NAS mount), and
// any operator-configured backup.allowed-roots. A chosen destination must equal or sit under one of
// these — this confines the admin-provided destination so a full-PHI backup can't be written to an
// arbitrary path (path-injection, #383).
func AllowedBackupRoots(appConfig config.Interface) []string {
	roots := []string{filepath.Clean(dbDirFromConfig(appConfig))}
	if d := strings.TrimSpace(appConfig.GetString("backup.destination")); d != "" {
		roots = append(roots, filepath.Clean(d))
	}
	for _, r := range appConfig.GetStringSlice("backup.allowed-roots") {
		if r = strings.TrimSpace(r); r != "" {
			roots = append(roots, filepath.Clean(r))
		}
	}
	return roots
}

// ValidateBackupDestination cleans dest and confirms it is an absolute path confined to an allowed root.
// Returns the cleaned path. Rejects empty, relative, and out-of-allowlist (incl. ".." escape) paths.
func ValidateBackupDestination(appConfig config.Interface, dest string) (string, error) {
	dest = strings.TrimSpace(dest)
	if dest == "" {
		return "", fmt.Errorf("destination is empty")
	}
	if !filepath.IsAbs(dest) {
		return "", fmt.Errorf("destination must be an absolute path")
	}
	dest = filepath.Clean(dest)
	for _, root := range AllowedBackupRoots(appConfig) {
		if dest == root || strings.HasPrefix(dest, root+string(os.PathSeparator)) {
			return dest, nil
		}
	}
	return "", fmt.Errorf("destination %q is outside the allowed backup roots", dest)
}

// ListBackups returns the backups in dir, newest first.
func ListBackups(dir string) []BackupFile {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []BackupFile{}
	}
	out := make([]BackupFile, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !isBackupFile(e.Name()) {
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
// filename is canonical and sortable: 2026-06-21T12-10-03Z-yourphr-backup.db.
func (gr *GormRepository) PerformBackup(appConfig config.Interface, destOverride string) (BackupFile, string, error) {
	if BackupRestoreGated(appConfig) {
		return BackupFile{}, "", ErrEncryptionEnabled
	}
	dest := strings.TrimSpace(destOverride)
	if dest == "" {
		dest = CurrentBackupDestination(appConfig)
	}
	dest, err := ValidateBackupDestination(appConfig, dest) // confine to allowlisted roots (#383 path-injection)
	if err != nil {
		return BackupFile{}, "", err
	}
	if err := os.MkdirAll(dest, 0o750); err != nil {
		return BackupFile{}, "", fmt.Errorf("cannot create destination: %w", err)
	}

	name := BackupFileName(time.Now(), appConfig.GetString("backup.label"))
	full := filepath.Join(dest, name)
	if err := gr.BackupToFile(full); err != nil {
		return BackupFile{}, "", err
	}

	// If the caller explicitly chose a destination, remember it (persists until changed).
	if strings.TrimSpace(destOverride) != "" {
		s := LoadBackupSettings(appConfig)
		if s.Destination != dest {
			s.Destination = dest
			_ = SaveBackupSettings(appConfig, s)
		}
	}

	bf := BackupFile{Name: name, Modified: time.Now().UTC().Format(time.RFC3339)}
	if fi, err := os.Stat(full); err == nil {
		bf.SizeBytes = fi.Size()
	}
	return bf, full, nil
}

// BackupToFile writes a consistent online snapshot to fullPath (a *.db.gz): VACUUM INTO a temp
// uncompressed snapshot, then gzip it to fullPath and remove the temp. Used by PerformBackup (to a
// destination folder) and by the on-demand download path (to a temp file). VACUUM INTO does not accept
// a bound parameter for the path; the path is server/admin-controlled, single quotes escaped.
func (gr *GormRepository) BackupToFile(fullPath string) error {
	// VACUUM INTO a fresh, unique private temp dir (0700) next to the target, then gzip to fullPath. A
	// per-call temp dir avoids two concurrent backups colliding on a shared temp name (#368, finding #4)
	// and keeps the uncompressed snapshot off a world-readable location.
	tmpDir, err := os.MkdirTemp(filepath.Dir(fullPath), ".yourphr-backup-")
	if err != nil {
		return fmt.Errorf("backup failed (temp dir): %w", err)
	}
	defer os.RemoveAll(tmpDir)
	tmp := filepath.Join(tmpDir, "snapshot.db")

	safe := strings.ReplaceAll(tmp, "'", "''")
	if err := gr.GormClient.Exec(fmt.Sprintf("VACUUM INTO '%s'", safe)).Error; err != nil {
		return fmt.Errorf("backup failed: %w", err)
	}
	if err := gzipFile(tmp, fullPath); err != nil {
		os.Remove(fullPath)
		return fmt.Errorf("compress failed: %w", err)
	}
	return nil
}

func gzipFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	gw := gzip.NewWriter(out)
	if _, err := io.Copy(gw, in); err != nil {
		gw.Close()
		return err
	}
	return gw.Close()
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
