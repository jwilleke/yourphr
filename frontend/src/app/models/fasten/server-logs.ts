// Response from GET /api/secure/admin/logs (admin-only). `configured` is false when the deployment
// logs to STDOUT only (no log.file set), in which case `lines` is empty.
export interface ServerLogs {
  configured: boolean;
  path?: string;
  lines: string[];
}
