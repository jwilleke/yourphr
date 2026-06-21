package handler

import (
	"net/http"
	"os"
	"strings"

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
	BackupDestination   string                `json:"backup_destination"`    // default/last-used folder
	Backups             []database.BackupFile `json:"backups"`               // backups present there, newest first
	BackupIntervalHours int                   `json:"backup_interval_hours"` // scheduled-backup interval (0 = off)
	BackupRetention     int                   `json:"backup_retention"`      // scheduled backups kept
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
	dest := database.CurrentBackupDestination(appConfig)
	resp := DatabaseInfoResponse{
		Location:            location,
		EncryptionEnabled:   appConfig.GetBool("database.encryption.enabled"),
		BackupDestination:   dest,
		Backups:             database.ListBackups(dest),
		BackupIntervalHours: appConfig.GetInt("backup.interval_hours"),
		BackupRetention:     appConfig.GetInt("backup.retention"),
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
