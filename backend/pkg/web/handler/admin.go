package handler

import (
	"fmt"
	"net/http"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/applog"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// Admin Dashboard endpoints (#170). Admin-only; the dashboard is a set of cards. The Server Logs card
// (/admin/logs) reads from an in-memory ring buffer that always holds the most recent log lines — no
// log.file, no restart — and lets an admin change the running log level at runtime (#170 follow-up).

// ServerLogsResponse is the payload for GET /api/secure/admin/logs.
type ServerLogsResponse struct {
	Level       string   `json:"level"`        // the running log level, e.g. "info"
	ValidLevels []string `json:"valid_levels"` // selectable levels for the UI
	Lines       []string `json:"lines"`        // most-recent log lines, oldest first
}

// GetServerLogs returns the recent in-memory log lines and the current level. Admin-only — logs can
// contain sensitive operational detail.
func GetServerLogs(c *gin.Context) {
	if !IsAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "admin role required"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": ServerLogsResponse{
		Level:       applog.Level(),
		ValidLevels: applog.ValidLevels,
		Lines:       applog.Recent(),
	}})
}

// SetLogLevelRequest is the PUT /api/secure/admin/log-level payload.
type SetLogLevelRequest struct {
	Level string `json:"level"`
}

// SetLogLevel changes the running server log level at runtime (admin-only). Runtime-only by design:
// it resets to the configured log.level on restart.
func SetLogLevel(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	if !IsAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "admin role required"})
		return
	}
	var req SetLogLevelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid request: %s", err)})
		return
	}
	if err := applog.SetLevel(req.Level); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid log level %q: %s", req.Level, err)})
		return
	}
	// Emitted at Info so the change is itself visible in the log stream.
	logger.Infof("admin changed server log level to %q", applog.Level())
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"level": applog.Level()}})
}
