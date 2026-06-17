// Response from GET /api/secure/admin/logs (admin-only). Logs are kept in an in-memory ring buffer on
// the server, so recent lines are always available — no log.file, no restart. `level` is the running
// log level; `valid_levels` are the selectable options for the UI.
export interface ServerLogs {
  level: string;
  valid_levels: string[];
  lines: string[];
}
