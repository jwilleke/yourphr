package handler

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/gin-gonic/gin"
)

// Admin Database card (#361). Admin-only. Surfaces facts about the runtime SQLite DB and writes a safe
// online backup to a server-side destination folder. NOTE: a backup is the ENTIRE single-file DB —
// every user's complete records (PHI) — so these endpoints are strictly admin-gated.

const backupFilePrefix = "yourphr-backup-"

// BackupFile is one backup present in the destination folder.
type BackupFile struct {
	Name      string `json:"name"`
	SizeBytes int64  `json:"size_bytes"`
	Modified  string `json:"modified"` // RFC3339 UTC
}

// DatabaseInfoResponse is the payload for GET /api/secure/admin/database.
type DatabaseInfoResponse struct {
	Location          string       `json:"location"`
	EncryptionEnabled bool         `json:"encryption_enabled"`
	SizeBytes         int64        `json:"size_bytes"`
	Users             int64        `json:"users"`
	Sources           int64        `json:"sources"`
	IntegrityOk       bool         `json:"integrity_ok"`
	BackupDestination string       `json:"backup_destination"` // default/last-used folder backups are written to
	Backups           []BackupFile `json:"backups"`            // backups present in that folder, newest first
}

func gormRepoFromContext(c *gin.Context) (*database.GormRepository, bool) {
	repo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)
	gr, ok := repo.(*database.GormRepository)
	return gr, ok
}

// dbDir is the directory holding the database file.
func dbDir(appConfig config.Interface) string {
	return filepath.Dir(appConfig.GetString("database.location"))
}

// defaultBackupDir is where backups go unless the admin picks elsewhere: a "backups" folder next to
// the DB (on the same data volume, so it persists).
func defaultBackupDir(appConfig config.Interface) string {
	return filepath.Join(dbDir(appConfig), "backups")
}

// markerPath stores the last-used backup destination (a one-line file in the data dir) so the dashboard
// can default to "the last backed up location" across restarts without a settings-schema change.
func markerPath(appConfig config.Interface) string {
	return filepath.Join(dbDir(appConfig), ".backup_dest")
}

func currentBackupDest(appConfig config.Interface) string {
	if b, err := os.ReadFile(markerPath(appConfig)); err == nil {
		if p := strings.TrimSpace(string(b)); p != "" {
			return p
		}
	}
	return defaultBackupDir(appConfig)
}

func listBackups(dir string) []BackupFile {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []BackupFile{}
	}
	out := make([]BackupFile, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasPrefix(e.Name(), backupFilePrefix) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, BackupFile{Name: e.Name(), SizeBytes: info.Size(), Modified: info.ModTime().UTC().Format(time.RFC3339)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Modified > out[j].Modified }) // newest first
	return out
}

// GetDatabaseInfo returns runtime database facts + the backup destination and existing backups. Admin-only.
func GetDatabaseInfo(c *gin.Context) {
	if !IsAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "admin role required"})
		return
	}
	appConfig := c.MustGet(pkg.ContextKeyTypeConfig).(config.Interface)
	gr, ok := gormRepoFromContext(c)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "database backend does not support this operation"})
		return
	}

	location := appConfig.GetString("database.location")
	dest := currentBackupDest(appConfig)
	resp := DatabaseInfoResponse{
		Location:          location,
		EncryptionEnabled: appConfig.GetBool("database.encryption.enabled"),
		BackupDestination: dest,
		Backups:           listBackups(dest),
	}
	if fi, err := os.Stat(location); err == nil {
		resp.SizeBytes = fi.Size()
	}
	gr.GormClient.Model(&models.User{}).Count(&resp.Users)
	gr.GormClient.Table("source_credentials").Count(&resp.Sources)

	var check string
	if err := gr.GormClient.Raw("PRAGMA quick_check").Scan(&check).Error; err == nil {
		resp.IntegrityOk = strings.EqualFold(check, "ok")
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": resp})
}

// BackupRequest optionally overrides the destination folder for this backup.
type BackupRequest struct {
	Destination string `json:"destination"`
}

// BackupDatabase writes a consistent online snapshot (SQLite VACUUM INTO — safe on a live DB, never a
// raw copy) to a canonically-dated file in the destination folder, and remembers that folder as the
// default for next time. Admin-only; the artifact is the full multi-user PHI database.
func BackupDatabase(c *gin.Context) {
	if !IsAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "admin role required"})
		return
	}
	appConfig := c.MustGet(pkg.ContextKeyTypeConfig).(config.Interface)
	gr, ok := gormRepoFromContext(c)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "database backend does not support backup"})
		return
	}

	var req BackupRequest
	_ = c.ShouldBindJSON(&req) // body optional
	dest := strings.TrimSpace(req.Destination)
	if dest == "" {
		dest = currentBackupDest(appConfig)
	}
	if !filepath.IsAbs(dest) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "destination must be an absolute path"})
		return
	}
	if err := os.MkdirAll(dest, 0o750); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("cannot create destination: %s", err)})
		return
	}

	// Canonical, sortable filename: yourphr-backup-2026-06-21-071234.db
	name := backupFilePrefix + time.Now().UTC().Format("2006-01-02-150405") + ".db"
	full := filepath.Join(dest, name)

	// VACUUM INTO does not accept a bound parameter for the path; it is server/admin-controlled. Escape
	// single quotes defensively.
	safePath := strings.ReplaceAll(full, "'", "''")
	if err := gr.GormClient.Exec(fmt.Sprintf("VACUUM INTO '%s'", safePath)).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": fmt.Sprintf("backup failed: %s", err)})
		return
	}

	// Remember this destination as the default for next time (best-effort).
	_ = os.WriteFile(markerPath(appConfig), []byte(dest), 0o600)

	var size int64
	if fi, err := os.Stat(full); err == nil {
		size = fi.Size()
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"filename": name, "path": full, "destination": dest, "size_bytes": size,
	}})
}
