package handler

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/gin-gonic/gin"
)

// Admin Database card (#361). Admin-only. Surfaces facts about the runtime SQLite DB and provides a
// safe online backup. NOTE: the backup is the ENTIRE single-file DB — i.e. every user's complete
// records (PHI) — so these endpoints are strictly admin-gated and the UI warns before download.

// DatabaseInfoResponse is the payload for GET /api/secure/admin/database.
type DatabaseInfoResponse struct {
	Location          string `json:"location"`
	EncryptionEnabled bool   `json:"encryption_enabled"`
	SizeBytes         int64  `json:"size_bytes"`
	Users             int64  `json:"users"`
	Sources           int64  `json:"sources"`
	IntegrityOk       bool   `json:"integrity_ok"`
}

// gormRepoFromContext returns the concrete GORM repository (the only backend that supports these
// DB-level ops). SQLite is the only working backend; postgres is unsupported.
func gormRepoFromContext(c *gin.Context) (*database.GormRepository, bool) {
	repo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)
	gr, ok := repo.(*database.GormRepository)
	return gr, ok
}

// GetDatabaseInfo returns runtime database facts for the admin Database card. Admin-only.
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
	resp := DatabaseInfoResponse{
		Location:          location,
		EncryptionEnabled: appConfig.GetBool("database.encryption.enabled"),
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

// BackupDatabase streams a consistent online snapshot of the database (SQLite `VACUUM INTO`, the
// recommended online-backup method — safe on a live DB, never a raw file copy) as a download.
// Admin-only; the artifact is the full multi-user PHI database.
func BackupDatabase(c *gin.Context) {
	if !IsAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "admin role required"})
		return
	}
	gr, ok := gormRepoFromContext(c)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "database backend does not support backup"})
		return
	}

	stamp := time.Now().UTC().Format("20060102-150405")
	name := fmt.Sprintf("yourphr-backup-%s.db", stamp)
	tmp := filepath.Join(os.TempDir(), name)

	// VACUUM INTO does not accept a bound parameter for the path; the path is server-generated (no user
	// input), and we escape single quotes defensively.
	safePath := strings.ReplaceAll(tmp, "'", "''")
	if err := gr.GormClient.Exec(fmt.Sprintf("VACUUM INTO '%s'", safePath)).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": fmt.Sprintf("backup failed: %s", err)})
		return
	}
	defer os.Remove(tmp)

	c.FileAttachment(tmp, name)
}
