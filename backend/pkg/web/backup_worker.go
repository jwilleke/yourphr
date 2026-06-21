package web

import (
	"strconv"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
)

// startBackupWorker runs scheduled DB backups. It polls the persisted BackupSettings every minute, so
// changes made from the admin Database card take effect WITHOUT a restart (the "settable schedule").
// Schedule model mirrors the ngdpbase BackupManager: enable + time-of-day (server-local "HH:MM") +
// days (daily|weekly). The server deploy also has a k8s backup-cronjob; this is most useful for the
// desktop build + dashboard control. Blocks; launch in a goroutine.
func (ae *AppEngine) startBackupWorker() {
	gr, ok := ae.deviceRepo.(*database.GormRepository)
	if !ok {
		ae.Logger.Warn("scheduled-backup worker: database backend does not support backup; disabled")
		return
	}

	// Seed lastRun from the newest existing backup so a restart doesn't re-trigger today's backup.
	lastRun := ""
	if files := database.ListBackups(database.CurrentBackupDestination(ae.Config)); len(files) > 0 {
		if t, err := time.Parse(time.RFC3339, files[0].Modified); err == nil {
			lastRun = t.Local().Format("2006-01-02")
		}
	}

	ae.Logger.Info("scheduled-backup worker started (checks backup settings every minute)")
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for now := range ticker.C {
		s := database.LoadBackupSettings(ae.Config)
		if !s.Enabled {
			continue
		}
		h, m, valid := parseHHMM(s.Time)
		if !valid {
			continue
		}
		now = now.Local()
		today := now.Format("2006-01-02")
		if lastRun == today {
			continue // already backed up today
		}
		if strings.EqualFold(s.Days, "weekly") && now.Weekday() != time.Sunday {
			continue
		}
		if now.Hour()*60+now.Minute() < h*60+m {
			continue // scheduled time-of-day not reached yet
		}

		_, full, err := gr.PerformBackup(ae.Config, "")
		if err != nil {
			ae.Logger.Errorf("scheduled backup failed: %s", err)
			continue
		}
		ae.Logger.Infof("scheduled backup written: %s", full)
		lastRun = today
		dest := database.CurrentBackupDestination(ae.Config)
		if removed, err := database.PruneBackups(dest, s.MaxBackups); err == nil && removed > 0 {
			ae.Logger.Infof("pruned %d old backup(s) in %s", removed, dest)
		}
	}
}

// parseHHMM parses a "HH:MM" 24-hour string.
func parseHHMM(v string) (int, int, bool) {
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
