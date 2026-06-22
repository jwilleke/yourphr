package web

import (
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

	ae.Logger.Info("scheduled-backup worker started (checks backup settings every minute)")
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for now := range ticker.C {
		s := database.LoadBackupSettings(ae.Config)
		if !s.Enabled {
			continue
		}
		h, m, valid := database.ParseHHMM(s.Time)
		if !valid {
			continue
		}
		now = now.Local()
		if strings.EqualFold(s.Days, "weekly") && now.Weekday() != time.Sunday {
			continue
		}
		if now.Hour()*60+now.Minute() < h*60+m {
			continue // scheduled time-of-day not reached yet
		}
		// "Already backed up today?" is answered from the CURRENT destination's newest backup, not an
		// in-memory seed — so it stays correct across restarts AND when the admin changes the destination
		// at runtime (a fresh/empty destination correctly gets its first backup) (#368 #10).
		dest := database.CurrentBackupDestination(ae.Config)
		if newestBackupLocalDate(dest) == now.Format("2006-01-02") {
			continue
		}

		_, full, err := gr.PerformBackup(ae.Config, "")
		if err != nil {
			ae.Logger.Errorf("scheduled backup failed: %s", err)
			continue
		}
		ae.Logger.Infof("scheduled backup written: %s", full)
		if removed, err := database.PruneBackups(dest, s.MaxBackups); err == nil && removed > 0 {
			ae.Logger.Infof("pruned %d old backup(s) in %s", removed, dest)
		}
	}
}

// newestBackupLocalDate returns the server-local YYYY-MM-DD of the most recent backup in dir, or "".
func newestBackupLocalDate(dir string) string {
	files := database.ListBackups(dir)
	if len(files) == 0 {
		return ""
	}
	if t, err := time.Parse(time.RFC3339, files[0].Modified); err == nil {
		return t.Local().Format("2006-01-02")
	}
	return ""
}
