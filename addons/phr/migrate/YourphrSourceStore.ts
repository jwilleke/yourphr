/**
 * yourPHR's old records store (`records.db`, main's `src/SqliteFhirRepository.ts`),
 * read for the move into phr (yourphr#969). The only code in phr with SQL on
 * that database, as PhrRecordStore is the only code with SQL on phr.db.
 *
 * Read-only by construction: SELECTs on `resources`, its live rows, by owner.
 * The handle is opened read-only by core (DatabaseManager.openReadOnly,
 * ngdpbase#2076), which refuses writes as well. The derived tables
 * (search_index, text_rowids) and history are not read.
 */

/** What this needs from a read-only SQLite handle. */
export interface SourceDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

/** One live record row: where it came from, and its FHIR JSON. Never logged. */
export interface SourceRow { source_id: string; content: string }

export class YourphrSourceStore {
  constructor(private readonly db: SourceDb) {}

  /** The users who hold live records, by username (yourPHR's `user_id`). */
  owners(): string[] {
    return (this.db.prepare("SELECT DISTINCT user_id FROM resources WHERE deleted = 0 AND user_id <> '' ORDER BY user_id").all() as { user_id: string }[])
      .map((r) => r.user_id);
  }

  /** A user's live records, ordered by source, kind and id. */
  rowsOf(owner: string): SourceRow[] {
    return this.db.prepare('SELECT source_id, content FROM resources WHERE user_id = ? AND deleted = 0 ORDER BY source_id, resource_type, id')
      .all(owner) as SourceRow[];
  }

  /** Live records of each kind a user holds. */
  countsOf(owner: string): Map<string, number> {
    const rows = this.db.prepare('SELECT resource_type, COUNT(*) AS n FROM resources WHERE user_id = ? AND deleted = 0 GROUP BY resource_type')
      .all(owner) as { resource_type: string; n: number }[];
    return new Map(rows.map((r) => [r.resource_type, Number(r.n)]));
  }
}
