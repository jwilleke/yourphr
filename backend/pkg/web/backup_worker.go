package web

import (
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
)

// startBackupWorker writes a scheduled DB backup on a ticker for the server's lifetime, then prunes to
// the retention count. Mirrors startTokenRefreshWorker. Disabled by default (backup.interval_hours<=0,
// opt-in). The server deploy also has a k8s backup-cronjob, so this is most useful for the desktop /
// single-binary build and to make scheduled backups visible/configurable in the admin Database card
// (#361). Backups land in the same destination the manual "Backup now" uses. Blocks; launch in a
// goroutine.
func (ae *AppEngine) startBackupWorker() {
	ae.Config.SetDefault("backup.interval_hours", 0)
	ae.Config.SetDefault("backup.retention", 7)

	intervalHours := ae.Config.GetInt("backup.interval_hours")
	if intervalHours <= 0 {
		ae.Logger.Info("scheduled-backup worker disabled (backup.interval_hours <= 0)")
		return
	}
	gr, ok := ae.deviceRepo.(*database.GormRepository)
	if !ok {
		ae.Logger.Warn("scheduled-backup worker: database backend does not support backup; disabled")
		return
	}
	retention := ae.Config.GetInt("backup.retention")

	ticker := time.NewTicker(time.Duration(intervalHours) * time.Hour)
	defer ticker.Stop()
	ae.Logger.Infof("scheduled-backup worker started (every %d h, retention %d)", intervalHours, retention)
	for range ticker.C {
		_, full, err := gr.PerformBackup(ae.Config, "")
		if err != nil {
			ae.Logger.Errorf("scheduled backup failed: %s", err)
			continue
		}
		ae.Logger.Infof("scheduled backup written: %s", full)
		dest := database.CurrentBackupDestination(ae.Config)
		if removed, err := database.PruneBackups(dest, retention); err == nil && removed > 0 {
			ae.Logger.Infof("pruned %d old backup(s) in %s", removed, dest)
		}
	}
}
