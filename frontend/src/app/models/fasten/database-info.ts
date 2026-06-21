// Mirrors handler.DatabaseInfoResponse (GET /api/secure/admin/database). Admin-only.
export interface BackupFile {
  name: string;
  size_bytes: number;
  modified: string; // RFC3339 UTC
}

export interface DatabaseInfo {
  location: string;
  encryption_enabled: boolean;
  size_bytes: number;
  users: number;
  sources: number;
  integrity_ok: boolean;
  backup_destination: string;     // default/last-used folder backups are written to
  backups: BackupFile[];          // backups present there, newest first
  backup_interval_hours: number;  // scheduled-backup interval (0 = off)
  backup_retention: number;       // scheduled backups kept
}

export interface BackupResult {
  filename: string;
  path: string;
  destination: string;
  size_bytes: number;
}
