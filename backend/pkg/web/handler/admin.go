package handler

import (
	"bufio"
	"bytes"
	"io"
	"net/http"
	"os"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// Admin Dashboard endpoints (#170). Admin-only; the dashboard is a set of cards that grows over
// time — the first is "Server Logs".

// ServerLogsResponse is the payload for GET /api/secure/admin/logs.
type ServerLogsResponse struct {
	// Configured is false when no log.file is set (logs go to STDOUT only and can't be read back).
	Configured bool     `json:"configured"`
	Path       string   `json:"path,omitempty"`
	Lines      []string `json:"lines"`
}

const serverLogsMaxLines = 500
const serverLogsMaxBytes = 256 * 1024 // bound memory: only the tail of the file is read

// GetServerLogs returns the tail of the configured log file. Admin-only — server logs can contain
// sensitive operational detail, so this is gated behind the admin role and only works when the
// deployment has opted in by setting `log.file` (otherwise logs are STDOUT-only).
func GetServerLogs(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	if !IsAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "admin role required"})
		return
	}

	appConfig := c.MustGet(pkg.ContextKeyTypeConfig).(config.Interface)
	logPath := appConfig.GetString("log.file")
	if logPath == "" {
		// Not an error — the deployment simply logs to STDOUT. The card explains how to enable.
		c.JSON(http.StatusOK, gin.H{"success": true, "data": ServerLogsResponse{Configured: false, Lines: []string{}}})
		return
	}

	lines, err := tailFile(logPath, serverLogsMaxLines, serverLogsMaxBytes)
	if err != nil {
		logger.Errorf("admin: could not read log file %s: %v", logPath, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not read log file"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": ServerLogsResponse{Configured: true, Path: logPath, Lines: lines}})
}

// tailFile returns the last maxLines lines of the file, reading at most the final maxBytes so a large
// log can't blow up memory.
func tailFile(path string, maxLines int, maxBytes int64) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	start := int64(0)
	if info.Size() > maxBytes {
		start = info.Size() - maxBytes
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}

	data, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}
	// If we started mid-file, drop the (likely partial) first line.
	if start > 0 {
		if idx := bytes.IndexByte(data, '\n'); idx >= 0 {
			data = data[idx+1:]
		}
	}

	lines := []string{}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	return lines, nil
}
