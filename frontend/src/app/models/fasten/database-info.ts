// Mirrors handler.DatabaseInfoResponse (GET /api/secure/admin/database). Admin-only.
export interface DatabaseInfo {
  location: string;
  encryption_enabled: boolean;
  size_bytes: number;
  users: number;
  sources: number;
  integrity_ok: boolean;
}
