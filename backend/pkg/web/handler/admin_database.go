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
// online backup to a server-side destination folder. The backup core lives in pkg/database (shared
// with the scheduled-backup worker). A backup is the ENTIRE single-file DB — every user's records
// (PHI) — so these endpoints are strictly admin-gated.

// DatabaseInfoResponse is the payload for GET /api/secure/admin/database.
type DatabaseInfoResponse struct {
	Location            string                `json:"location"`
	EncryptionEnabled   bool                  `json:"encryption_enabled"`
	SizeBytes           int64                 `json:"size_bytes"`
	Users               int64                 `json:"users"`
	Sources             int64                 `json:"sources"`
	IntegrityOk         bool                  `json:"integrity_ok"`
	BackupDestination string                  `json:"backup_destination"` // resolved destination folder
	Backups           []database.BackupFile   `json:"backups"`            // backups present there, newest first
	Schedule          database.BackupSettings `json:"schedule"`           // settable auto-backup settings
}

func gormRepoFromContext(c *gin.Context) (*database.GormRepository, bool) {
	repo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)
	gr, ok := repo.(*database.GormRepository)
	return gr, ok
}

// GetDatabaseInfo returns runtime database facts + the backup destination, existing backups, and the
// scheduled-backup settings. Admin-only.
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
	settings := database.LoadBackupSettings(appConfig)
	dest := database.ResolveDestination(appConfig, settings)
	resp := DatabaseInfoResponse{
		Location:          location,
		EncryptionEnabled: appConfig.GetBool("database.encryption.enabled"),
		BackupDestination: dest,
		Backups:           database.ListBackups(dest),
		Schedule:          settings,
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

// BackupDatabase writes a manual backup to the destination folder (or the last-used one) and remembers
// that folder. Admin-only; the artifact is the full multi-user PHI database.
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

	bf, full, err := gr.PerformBackup(appConfig, req.Destination)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"filename": bf.Name, "path": full, "destination": database.CurrentBackupDestination(appConfig), "size_bytes": bf.SizeBytes,
	}})
}

// BackupDatabaseDownload streams a fresh backup to the browser (the on-demand "Download backup" action;
// the browser's Save dialog chooses where it lands). Admin-only; the artifact is the full multi-user
// PHI database.
func BackupDatabaseDownload(c *gin.Context) {
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
	name := database.BackupFileName(time.Now(), appConfig.GetString("backup.label"))
	// Stage the snapshot in a PRIVATE (0700) temp dir, not directly in the world-readable os.TempDir(),
	// so the full PHI backup isn't readable by other local users during the request window (#368 #5).
	tmpDir, err := os.MkdirTemp("", "yourphr-download-")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	defer os.RemoveAll(tmpDir)
	tmp := filepath.Join(tmpDir, name)
	if err := gr.BackupToFile(tmp); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.FileAttachment(tmp, name)
}

// ScheduleRequest is the POST /api/secure/admin/database/schedule payload.
type ScheduleRequest struct {
	Enabled     bool   `json:"enabled"`
	Time        string `json:"time"`
	Days        string `json:"days"`
	Destination string `json:"destination"`
	MaxBackups  int    `json:"max_backups"`
}

// SetBackupSchedule persists the auto-backup settings (enable + time-of-day + days + destination +
// retention). The worker re-reads them each minute, so changes apply without a restart. Admin-only.
func SetBackupSchedule(c *gin.Context) {
	if !IsAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "admin role required"})
		return
	}
	appConfig := c.MustGet(pkg.ContextKeyTypeConfig).(config.Interface)
	var req ScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request"})
		return
	}
	s := database.BackupSettings{
		Enabled:     req.Enabled,
		Time:        strings.TrimSpace(req.Time),
		Days:        strings.ToLower(strings.TrimSpace(req.Days)),
		Destination: strings.TrimSpace(req.Destination),
		MaxBackups:  req.MaxBackups,
	}
	if s.Time == "" {
		s.Time = "02:00"
	}
	if _, _, ok := database.ParseHHMM(s.Time); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "time must be HH:MM (24-hour)"})
		return
	}
	if s.Days == "" {
		s.Days = "daily"
	}
	if s.Days != "daily" && s.Days != "weekly" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "days must be 'daily' or 'weekly'"})
		return
	}
	if s.Destination != "" && !filepath.IsAbs(s.Destination) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "destination must be an absolute path"})
		return
	}
	if s.MaxBackups <= 0 {
		s.MaxBackups = 7
	}
	if err := database.SaveBackupSettings(appConfig, s); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": fmt.Sprintf("save failed: %s", err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": s})
}

// RestoreRequest is the POST /api/secure/admin/database/restore payload.
type RestoreRequest struct {
	BackupName string `json:"backup_name"` // a file in the current backup destination
	Confirm    bool   `json:"confirm"`     // must be true (UI requires a typed confirmation)
}

// RestoreDatabase STAGES a restore from a backup in the destination folder. DANGER: applying it
// replaces the ENTIRE database (every user's records). It is staged + validated here (with an
// auto-backup of the current DB), then APPLIED on the next app restart — never swapped under a live DB.
// Admin-only.
func RestoreDatabase(c *gin.Context) {
	if !IsAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "admin role required"})
		return
	}
	appConfig := c.MustGet(pkg.ContextKeyTypeConfig).(config.Interface)
	gr, ok := gormRepoFromContext(c)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "database backend does not support restore"})
		return
	}
	var req RestoreRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request"})
		return
	}
	if !req.Confirm {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "restore must be confirmed"})
		return
	}
	// Allowlist: the requested name must EXACTLY match a backup ListBackups reports in the destination.
	// This is the path-traversal barrier — we never build a path from arbitrary request input, only from
	// a server-enumerated filename joined to the server-resolved destination.
	name := filepath.Base(strings.TrimSpace(req.BackupName))
	dest := database.CurrentBackupDestination(appConfig)
	var matched string
	for _, b := range database.ListBackups(dest) {
		if b.Name == name {
			matched = b.Name
			break
		}
	}
	if matched == "" {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "no such backup in the destination folder"})
		return
	}
	full := filepath.Join(dest, matched)
	if err := gr.StageRestore(appConfig, full); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"staged":  true,
		"message": "Restore staged (current DB auto-backed-up). Restart the app to apply it.",
	}})
}

// DirListing is the payload for GET /api/secure/admin/database/browse.
type DirListing struct {
	Path   string   `json:"path"`
	Parent string   `json:"parent"` // "" at filesystem root
	Dirs   []string `json:"dirs"`   // subdirectory names, sorted
}

// BrowseDirectories lists the subfolders of a server path so the admin can pick a backup destination
// (any folder). Admin-only; this exposes the server filesystem tree, acceptable for a trusted admin
// (who could shell in anyway). Defaults to the current backup destination.
func BrowseDirectories(c *gin.Context) {
	if !IsAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "admin role required"})
		return
	}
	appConfig := c.MustGet(pkg.ContextKeyTypeConfig).(config.Interface)
	path := strings.TrimSpace(c.Query("path"))
	if path == "" {
		path = database.CurrentBackupDestination(appConfig)
	}
	if !filepath.IsAbs(path) {
		path = string(filepath.Separator)
	}
	path = filepath.Clean(path)

	entries, err := os.ReadDir(path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("cannot read %q: %s", path, err)})
		return
	}
	dirs := []string{}
	for _, e := range entries {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			dirs = append(dirs, e.Name())
		}
	}
	sort.Strings(dirs)

	parent := filepath.Dir(path)
	if parent == path { // at root
		parent = ""
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": DirListing{Path: path, Parent: parent, Dirs: dirs}})
}
