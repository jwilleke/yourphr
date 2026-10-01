// Mirrors handler.DatabaseInfoResponse (GET /api/secure/admin/database). Admin-only.
export interface BackupFile {
  name: string;
  size_bytes: number;
  modified: string; // RFC3339 UTC
}

// Mirrors database.BackupHealthStatus — durable last backup outcome for Admin UI (#434).
export interface BackupHealth {
  ok: boolean;
  schedule_enabled: boolean;
  destination?: string;
  last_success_at?: string;
  last_success_path?: string;
  last_attempt_at?: string;
  last_error?: string;
  consecutive_failures: number;
  days_since_success?: number | null;
  failing_stale: boolean;
  summary: string;
}

export interface DatabaseInfo {
  location: string;
  encryption_enabled: boolean;
  size_bytes: number;
  users: number;
  sources: number;
  // The last whole-file check of the records store (#856). It runs on a worker thread at start and
  // once a day, never on page load; null until the first one since the start has finished.
  integrity_ok: boolean | null;
  integrity_detail?: string;            // 'ok', or SQLite's complaints
  integrity_checked_at?: string | null; // when the last check finished
  integrity_running?: boolean;
  backup_destination: string;     // resolved folder backups are written to
  backups: BackupFile[];          // backups present there, newest first
  schedule: BackupSettings;       // settable auto-backup settings
  backup_health?: BackupHealth;   // last scheduled/manual outcome (#434)
  allowed_backup_roots?: string[]; // operator-visible allowlist
  backups_unavailable?: string;   // one-sentence reason backups are refused, "" when they work (#545)
}

// Mirrors handler.DirListing — server-folder browser (GET /admin/database/browse).
export interface DirListing {
  path: string;
  parent: string; // "" at filesystem root
  dirs: string[];
}

// Mirrors database.BackupSettings — the settable auto-backup config (time-of-day model).
export interface BackupSettings {
  enabled: boolean;
  time: string;        // "HH:MM" (server-local)
  days: string;        // "daily" | "weekly"
  destination: string; // absolute folder; "" => default
  max_backups: number; // retention
}

export interface BackupResult {
  filename: string;
  path: string;
  destination: string;
  size_bytes: number;
}

// BackupDestinationTest is the verdict from POST /secure/admin/database/backup/test (#468).
//
// A schedule pointing at a directory that does not exist used to save happily and fail silently at
// 02:00 every night — discovered when a backup was needed and absent. This answers "does this
// actually work?" before the schedule can rely on it.
export interface BackupDestinationTest {
  destination: string   // the path actually tested (the default folder when none was supplied)
  writable: boolean
  error?: string        // the real OS error when writable is false: permission denied, no such directory, ...
}

// SearchIndexInfo is GET /secure/admin/database/search-index (#713): which derivation built the
// search index, against this build's, and the rebuild running now or last finished. Counts only.
export interface SearchIndexInfo {
  builtWith: number
  current: number
  stale: boolean      // records stored before an upgrade are not findable by everything they say
  rebuild: {
    state: 'idle' | 'running' | 'done' | 'failed'
    by?: string
    startedAt?: string
    finishedAt?: string
    progress?: string   // while running: "account 1 of 2"
    summary?: string    // when done: "Rebuilt 25,114 records across 2 account(s)."
    error?: string
  }
}
