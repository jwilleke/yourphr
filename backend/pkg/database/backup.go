package database

import (
	"bytes"
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
// the cipher key — neither is handled yet. Refuse rather than silently leak/break.
//
// Encryption is ENABLED by default (#470), so this gate fires on a stock install — which composed into
// #545: a default install had no backup path and nothing said so. The gate is now surfaced loudly (a
// startup warning and a persistent admin-UI banner) rather than only at the moment a backup is
// attempted. #461 (encrypted backups via sqlcipher_export) is what lifts it.
var ErrEncryptionEnabled = errors.New("backup and restore are not available while at-rest database encryption is enabled")

// BackupRestoreGated reports whether backup/restore must be refused (at-rest encryption enabled).
func BackupRestoreGated(appConfig config.Interface) bool {
	return appConfig.GetBool("database.encryption.enabled")
}

// BackupsUnavailableReason is the one sentence shown wherever the operator must learn that this
// instance cannot produce backups ("" when backups work). One string, shared by the startup warning,
// the admin API and the UI, so the wording cannot drift (#545).
func BackupsUnavailableReason(appConfig config.Interface) string {
	if !BackupRestoreGated(appConfig) {
		return ""
	}
	return "Backups and restore are unavailable on this instance: at-rest database encryption is enabled, and a backup would be written as plaintext. Until encrypted backup ships (#461), keep an external copy of the data volume."
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
// The `.tar.gz` alternative is the whole-data-root archive (yourphr#467); `.db[.gz]` are the
// database-only backups every existing instance already has, which must keep listing and restoring.
var backupFileRe = regexp.MustCompile(`(?i)yourphr-(.*-)?backup(-\d{8})?(\.db(\.gz)?|\.tar\.gz)$`)

func isBackupFile(name string) bool {
	return backupFileRe.MatchString(name)
}

// BackupFile describes one backup present in a destination folder.
type BackupFile struct {
	Name      string `json:"name"`
	SizeBytes int64  `json:"size_bytes"`
	Modified  string `json:"modified"` // RFC3339 UTC
}

// dbDirFromConfig is the instance data root. Kept as a thin alias because it is the name
// every settings file in this package already reaches for; config.DataDir is the definition
// (storage.data_dir, falling back to the DB's parent directory) — see #451.
func dbDirFromConfig(appConfig config.Interface) string {
	return config.DataDir(appConfig)
}

// DefaultBackupDir is where backups go unless a destination is chosen: a "backups" folder next to the
// DB (same data volume, so it persists).
func DefaultBackupDir(appConfig config.Interface) string {
	return filepath.Join(dbDirFromConfig(appConfig), "backups")
}

// BackupSettings is the admin-settable backup configuration. Since #545 it lives in the
// CONFIGURATION SYSTEM (the backup.* keys, persisted to app-custom-config.json via
// config.SetCustomValues) rather than a private .backup_settings.json side-store — the ngdpbase
// pattern, and the #472 rule: one config store, visible and editable in Admin → Configuration,
// covered by whatever protects the config overlay. Saves apply to the running config immediately,
// and the worker re-reads every tick, so a change still takes effect with no restart.
// Schedule model mirrors the ngdpbase BackupManager: enable + time-of-day + days, plus
// destination + retention.
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

// backupSettingsKeys maps BackupSettings onto its configuration keys — the single place the two
// shapes correspond, used by both load and save.
func backupSettingsKeys(s BackupSettings) map[string]interface{} {
	return map[string]interface{}{
		"backup.auto-backup":      s.Enabled,
		"backup.auto-backup-time": s.Time,
		"backup.auto-backup-days": s.Days,
		"backup.destination":      s.Destination,
		"backup.max-backups":      s.MaxBackups,
	}
}

// LoadBackupSettings reads the backup configuration from the config system (after migrating any
// legacy side-store — see migrateLegacyBackupSettings), then fills hard defaults.
func LoadBackupSettings(appConfig config.Interface) BackupSettings {
	migrateLegacyBackupSettings(appConfig)
	s := BackupSettings{
		Enabled:     appConfig.GetBool("backup.auto-backup"),
		Time:        appConfig.GetString("backup.auto-backup-time"),
		Days:        appConfig.GetString("backup.auto-backup-days"),
		Destination: appConfig.GetString("backup.destination"),
		MaxBackups:  appConfig.GetInt("backup.max-backups"),
	}
	s.normalize()
	return s
}

// migrateLegacyBackupSettings folds the two retired side-stores into the config overlay, once:
//
//   - .backup_settings.json — the pre-#545 Admin-UI store. Its values win over config seeds, exactly
//     as they did when it was read live, so an operator's schedule survives the upgrade.
//   - .backup_dest — the pre-v1.9.0 one-line destination marker (#368 #6), honoured only when no
//     newer source names a destination.
//
// Each file is renamed to <name>.migrated after its values land, so this runs once per instance and
// a failed config write leaves the file in place for the next attempt. Idempotent and cheap: two
// os.Stat calls on the every-minute worker path once migration is done.
func migrateLegacyBackupSettings(appConfig config.Interface) {
	settingsFile := backupSettingsPath(appConfig)
	if b, err := os.ReadFile(settingsFile); err == nil {
		s := BackupSettings{
			Enabled:     appConfig.GetBool("backup.auto-backup"),
			Time:        appConfig.GetString("backup.auto-backup-time"),
			Days:        appConfig.GetString("backup.auto-backup-days"),
			Destination: appConfig.GetString("backup.destination"),
			MaxBackups:  appConfig.GetInt("backup.max-backups"),
		}
		if json.Unmarshal(b, &s) == nil {
			if err := config.SetCustomValues(appConfig, backupSettingsKeys(s)); err != nil {
				return // keep the file; retry on the next load
			}
		}
		_ = os.Rename(settingsFile, settingsFile+".migrated")
	}
	destFile := filepath.Join(dbDirFromConfig(appConfig), ".backup_dest")
	if b, err := os.ReadFile(destFile); err == nil {
		if p := strings.TrimSpace(string(b)); p != "" && strings.TrimSpace(appConfig.GetString("backup.destination")) == "" {
			if err := config.SetCustomValues(appConfig, map[string]interface{}{"backup.destination": p}); err != nil {
				return
			}
		}
		_ = os.Rename(destFile, destFile+".migrated")
	}
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

// SaveBackupSettings persists the settings into the config system (#545/#472): written to the
// custom overlay and applied to the running configuration, so the worker's next tick sees them.
//
// A key pinned by the environment is refused with the same rule the configuration screen enforces:
// env wins and a UI write would silently not apply, so saying no is the honest answer.
func SaveBackupSettings(appConfig config.Interface, s BackupSettings) error {
	for key := range backupSettingsKeys(s) {
		if config.IsSetByEnvironment(key) {
			return fmt.Errorf("%s is set in the environment; remove the environment variable to manage backups here", key)
		}
	}
	return config.SetCustomValues(appConfig, backupSettingsKeys(s))
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

// AllowedBackupRoots is the allowlist of base directories a backup destination may live under:
//   - the data volume (covers DefaultBackupDir)
//   - static backup.destination (config / env)
//   - static backup.allowed-roots
//   - destination already stored in .backup_settings.json (Admin UI) — so UI-only NAS paths
//     keep working after #383 and aren't "invisible" to the allowlist (#434)
//
// Confinement still applies: new paths must equal or sit under one of these roots.
// Prefer also listing external mounts in backup.allowed-roots in config for clarity.
func AllowedBackupRoots(appConfig config.Interface) []string {
	seen := map[string]struct{}{}
	var roots []string
	add := func(p string) {
		p = filepath.Clean(strings.TrimSpace(p))
		if p == "" || p == "." {
			return
		}
		if _, ok := seen[p]; ok {
			return
		}
		seen[p] = struct{}{}
		roots = append(roots, p)
	}
	add(dbDirFromConfig(appConfig))
	add(appConfig.GetString("backup.destination"))
	for _, r := range appConfig.GetStringSlice("backup.allowed-roots") {
		add(r)
	}
	// Legacy pre-#545 side-store, honoured until its one-time migration into the config overlay
	// runs (after which backup.destination above covers it and this file no longer exists).
	if b, err := os.ReadFile(backupSettingsPath(appConfig)); err == nil {
		var s BackupSettings
		if json.Unmarshal(b, &s) == nil {
			add(s.Destination)
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

	// Whole data root, not just the database (yourphr#467). BackupToFile still exists and still
	// writes a single *.db.gz — the download endpoint uses it, where a bare database is what the
	// browser should receive.
	name := BackupArchiveName(time.Now(), appConfig.GetString("backup.label"))
	full := filepath.Join(dest, name)
	if err := gr.WriteBackupArchive(appConfig, full); err != nil {
		return BackupFile{}, "", err
	}
	// Manual + scheduled paths both call PerformBackup — record health for Admin UI (#434).
	RecordBackupSuccess(appConfig, full)

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

// TestedDestinationMarker is written, fsynced, read back and removed by TestBackupDestination.
// Named so an operator who finds a stray one knows what left it there.
const TestedDestinationMarker = ".yourphr-backup-write-test"

// TestBackupDestination proves a destination actually works, and returns the real OS error when it
// does not (yourphr#468).
//
// This exists because SetBackupSchedule validated the time format and the path allowlist and never
// checked the directory existed, was writable, or had space. A schedule could therefore be saved
// pointing somewhere that failed silently at 02:00 every night — discovered when a backup was
// needed and there wasn't one.
//
// It writes a MARKER rather than a real backup. A real backup would prove the path end to end, but
// it writes the entire PHI database to a location nobody is yet sure about — which is the thing
// being tested. The marker is a few bytes, and it exercises the same four failures that matter:
// no such directory, permission denied, read-only filesystem, out of space.
//
// fsync is not ceremony. A plain write can succeed against the page cache and only fail when the
// kernel flushes — on a full disk or a dropped network mount, which is exactly the destination an
// operator most needs warning about. Without the fsync this returns success for a path that cannot
// hold a backup.
//
// Deliberately does NOT create the directory. "I made it for you" turns a typo into a stray
// directory in an unexpected place; a missing directory is a legitimate answer to "does this work".
func TestBackupDestination(dest string) error {
	dest = strings.TrimSpace(dest)
	if dest == "" {
		return fmt.Errorf("destination is empty")
	}
	if !filepath.IsAbs(dest) {
		return fmt.Errorf("destination must be an absolute path")
	}
	dest = filepath.Clean(dest)

	info, err := os.Stat(dest)
	if err != nil {
		return err // the real OS error: no such file or directory, permission denied, ...
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a directory", dest)
	}

	marker := filepath.Join(dest, TestedDestinationMarker)
	// Remove any marker left by an interrupted earlier test, so O_EXCL below cannot fail on our own
	// litter and report a healthy path as broken.
	_ = os.Remove(marker)

	payload := []byte("yourphr backup destination write test\n")
	f, err := os.OpenFile(marker, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(payload); err != nil {
		f.Close()
		os.Remove(marker)
		return err
	}
	// Catches the full disk / dropped mount that a buffered write hides.
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(marker)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(marker)
		return err
	}

	readBack, err := os.ReadFile(marker)
	if err != nil {
		os.Remove(marker)
		return err
	}
	if !bytes.Equal(readBack, payload) {
		os.Remove(marker)
		return fmt.Errorf("wrote %d bytes to %s but read back %d — the destination is not storing data reliably",
			len(payload), dest, len(readBack))
	}

	// Removal is part of the test: a destination we cannot clean up is one where pruning will fail.
	if err := os.Remove(marker); err != nil {
		return fmt.Errorf("wrote to %s but could not remove the test file, so backup pruning would fail: %w", dest, err)
	}
	return nil
}
