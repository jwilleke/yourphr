/**
 * A FhirRepository backed by SQLite.
 *
 * THE THESIS THIS FILE EXISTS TO TEST
 *
 * YourPHR's Go backend carries 18.5k generated lines across 70 model files, one table per resource
 * type, one column per search parameter. That code exists to build a search index. Here the same job
 * is done by ~30 lines: for each SearchParameter that FHIR itself defines for a resource type,
 * evaluate its FHIRPath expression and write the results to ONE generic index table. See
 * `indexResource` below — that loop is the entire argument.
 *
 * Three tables serve every resource type. Compare with seventy.
 *
 * WHAT IS DELIBERATELY NOT IMPLEMENTED
 *
 * Chained parameters, _include/_revInclude, composite parameters, and history-based reads throw
 * rather than returning wrong answers quietly. A search that silently returns fewer rows than it
 * should looks exactly like working software, which is the failure mode that produced
 * https://github.com/jwilleke/yourphr/issues/528 in the other stack. Loud beats subtle.
 */
import {
  Operator,
  getSearchParameters,
  indexSearchParameterBundle,
  indexStructureDefinitionBundle,
} from '@medplum/core';
import type { Filter, SearchRequest, WithId } from '@medplum/core';
import { readJson } from '@medplum/definitions';
import { FhirRepository, type RepositoryMode } from '@medplum/fhir-router';
import type { Bundle, Reference, Resource, ResourceType, SearchParameter } from '@medplum/fhirtypes';
import { textFor } from './app/providers/record-text.js';
import Database from 'better-sqlite3-multiple-ciphers';
import fhirpath from 'fhirpath';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import fhirpathR4Model from 'fhirpath/fhir-context/r4/index.js';
import { randomUUID } from 'node:crypto';

let definitionsLoaded = false;

/**
 * Medplum keeps the schema in module-level state, so this is idempotent by design and cheap to call
 * from every constructor.
 */
function loadDefinitions(): void {
  if (definitionsLoaded) {
    return;
  }
  indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json'));
  indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json'));
  indexSearchParameterBundle(readJson('fhir/r4/search-parameters.json'));
  definitionsLoaded = true;
}

export interface SqliteFhirRepositoryOptions {
  /** SQLite file, or ':memory:'. */
  readonly file: string;
  /** SQLCipher key. Omit for an unencrypted database. */
  readonly key?: string;
  /**
   * Whose records this instance may see (#537).
   *
   * A PHR holds a family. YourPHR enforces this from the request context and every query carries
   * `WHERE user_id = ?`; the spike had NO concept of a user at all, so every caller saw every
   * record — on a family instance that is a disclosure, not a missing feature.
   *
   * Scoped per INSTANCE rather than per call, deliberately: FhirRepository's methods take no user,
   * so a caller that forgot to pass one would silently read everything. Constructing a repository
   * for a user makes the scope impossible to omit — the same reason the Go side derives it from the
   * context rather than from an argument.
   *
   * Undefined means unscoped, which is correct for admin tooling like reindexing and refused for
   * anything serving a request.
   */
  readonly userId?: string;
  /** Attributes writes to a provider so a cross-source id collision is refused, not silent. */
  readonly sourceId?: string;
}

export interface IndexStats {
  /** Resources whose id already existed — the identity seam, see the note on createResource. */
  collisions: number;
  /** Index rows written. */
  indexRows: number;
  /** SearchParameter expressions that threw while being evaluated, by "ResourceType.code". */
  failedExpressions: Record<string, string>;
}

/**
 * Whether two copies of a resource say the same thing, ignoring the two meta fields this store
 * stamps on every write (`versionId`, `lastUpdated`) — they differ on every copy by construction.
 * Key order is ignored too: providers and this store may serialize the same object differently.
 */
export function sameContent(a: Resource, b: Resource): boolean {
  return canonical(withoutStamps(a)) === canonical(withoutStamps(b));
}

function withoutStamps(r: Resource): Resource {
  if (!r.meta) return r;
  const { versionId: _v, lastUpdated: _l, ...meta } = r.meta;
  return Object.keys(meta).length ? { ...r, meta } : (({ meta: _m, ...rest }) => rest as Resource)(r);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => (value as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export class SqliteFhirRepository extends FhirRepository {
  readonly db: InstanceType<typeof Database>;
  readonly stats: IndexStats = { collisions: 0, indexRows: 0, failedExpressions: {} };
  readonly userId?: string;
  /** Which provider subsequent writes are attributed to. See the source_id column comment. */
  sourceId?: string;
  /** Where this handle points — so the records provider can open sibling handles on the same store. */
  readonly file: string;
  readonly key?: string;

  constructor(options: SqliteFhirRepositoryOptions) {
    super();
    loadDefinitions();
    this.userId = options.userId;
    this.sourceId = options.sourceId;
    this.file = options.file;
    this.key = options.key;

    this.db = new Database(options.file);
    if (options.key) {
      this.db.pragma("cipher='sqlcipher'");
      this.db.pragma(`key='${options.key.replace(/'/g, "''")}'`);
    }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  /**
   * Three tables, for every resource type there will ever be.
   *
   * `content` plays exactly the role `resource_raw` plays in the Go schema: the canonical resource,
   * stored whole and never reinterpreted. Everything else is derived and can be rebuilt from it,
   * which is what makes reindexing after a bug a non-event rather than a migration.
   */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS resources (
        resource_type TEXT NOT NULL,
        id            TEXT NOT NULL,
        -- Owner. Empty string rather than NULL so it can sit in the primary key: two accounts may
        -- legitimately hold the SAME resource id from the same provider, and keying on
        -- (type, id) alone made the second import look like a collision (#537).
        user_id       TEXT NOT NULL DEFAULT '',
        -- Which connected provider a record came from. NOT part of the primary key: FHIR identity
        -- is (resourceType, id), Medplum's FhirRepository.readResource takes no source, and
        -- references like "Patient/p1" resolve by that pair. Adding source here would fork the
        -- contract the whole spike is built on.
        --
        -- It is recorded so a COLLISION cannot be silent. YourPHR's Go backend keys on
        -- (source_id, type, id) precisely because two providers may issue the same id to one
        -- person; here the second write would simply overwrite the first, and a record would
        -- disappear rather than double. Storing the source turns that into a refusal.
        source_id     TEXT NOT NULL DEFAULT '',
        version_id    TEXT NOT NULL,
        last_updated  TEXT NOT NULL,
        deleted       INTEGER NOT NULL DEFAULT 0,
        content       TEXT NOT NULL,
        PRIMARY KEY (resource_type, id, user_id)
      );

      -- Keyed by the person as resources is (yourphr#812): two people can hold the same type/id —
      -- a shared Practitioner or Organization — and their histories must never mix, be read
      -- across, or be deleted by the other. A database made before this is re-keyed by the
      -- records ledger's history-per-person migration.
      CREATE TABLE IF NOT EXISTS resource_history (
        resource_type TEXT NOT NULL,
        id            TEXT NOT NULL,
        user_id       TEXT NOT NULL DEFAULT '',
        version_id    TEXT NOT NULL,
        last_updated  TEXT NOT NULL,
        content       TEXT NOT NULL,
        PRIMARY KEY (resource_type, id, user_id, version_id)
      );

      CREATE TABLE IF NOT EXISTS search_index (
        resource_type TEXT NOT NULL,
        resource_id   TEXT NOT NULL,
        user_id       TEXT NOT NULL DEFAULT '',
        code          TEXT NOT NULL,
        value         TEXT NOT NULL,
        PRIMARY KEY (resource_type, resource_id, user_id, code, value)
      );

      CREATE INDEX IF NOT EXISTS idx_search_lookup ON search_index (resource_type, code, value, user_id);

      -- Find anything by words (yourphr#599): the record's human-readable text, inside the same
      -- encrypted file, fed by the same write path as the search index. Never the raw JSON.
      CREATE VIRTUAL TABLE IF NOT EXISTS search_text USING fts5(
        resource_type UNINDEXED, resource_id UNINDEXED, user_id UNINDEXED, body,
        tokenize = 'porter unicode61'
      );
    `);
  }

  // ---------------------------------------------------------------------------------------------
  // Indexing — the part the whole spike is about
  // ---------------------------------------------------------------------------------------------

  /**
   * Derive every search value for a resource from FHIR's own SearchParameter definitions.
   *
   * No per-resource-type code. Adding support for a new resource type is adding nothing.
   */
  private indexResource(resource: WithId<Resource>): void {
    const params = getSearchParameters(resource.resourceType);
    if (!params) {
      return;
    }

    const owner = this.userId ?? '';
    const del = this.db.prepare(
      'DELETE FROM search_index WHERE resource_type = ? AND resource_id = ? AND user_id = ?'
    );
    del.run(resource.resourceType, resource.id, owner);
    this.db.prepare('DELETE FROM search_text WHERE resource_type = ? AND resource_id = ? AND user_id = ?').run(resource.resourceType, resource.id, owner);
    const body = textFor(resource);
    if (body !== '') {
      this.db.prepare('INSERT INTO search_text (resource_type, resource_id, user_id, body) VALUES (?, ?, ?, ?)').run(resource.resourceType, resource.id, owner, body);
    }

    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO search_index (resource_type, resource_id, user_id, code, value) VALUES (?, ?, ?, ?, ?)'
    );

    for (const param of Object.values(params) as SearchParameter[]) {
      if (!param.expression) {
        continue;
      }
      const { expression, allowedTypes } = stripResolveGuards(param.expression);
      let results: unknown[];
      try {
        results = fhirpath.evaluate(resource, expression, undefined, fhirpathR4Model) as unknown[];
      } catch (err) {
        // Recorded rather than thrown: one unsupported expression should not make a resource
        // unstorable, but a silent skip would overstate how well this works.
        this.stats.failedExpressions[`${resource.resourceType}.${param.code}`] = (err as Error).message;
        continue;
      }
      for (const result of results) {
        for (const value of normalizeValues(result, param.type)) {
          // Reinstate what the stripped guard was doing: keep only references to the types the
          // parameter actually targets, judged from the reference itself rather than by loading it.
          if (allowedTypes && !allowedTypes.some((t) => value.startsWith(`${t}/`))) {
            continue;
          }
          insert.run(resource.resourceType, resource.id, owner, param.code, value);
          this.stats.indexRows++;
        }
      }
    }
  }

  /** Rebuild every index row from `content`. Possible only because content is stored whole. */
  reindexAll(): void {
    const owner = this.userId ?? '';
    const rows = this.db
      .prepare('SELECT content FROM resources WHERE deleted = 0 AND user_id = ?')
      .all(owner) as {content: string}[];
    this.db.prepare('DELETE FROM search_index WHERE user_id = ?').run(owner);
    this.db.prepare('DELETE FROM search_text WHERE user_id = ?').run(owner);
    for (const row of rows) {
      this.indexResource(JSON.parse(row.content) as WithId<Resource>);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // FhirRepository implementation
  // ---------------------------------------------------------------------------------------------

  setMode(_mode: RepositoryMode): void {
    // Single-writer SQLite; there is no reader/writer split to honour.
  }

  generateId(): string {
    return randomUUID();
  }

  /**
   * IDENTITY SEAM. Medplum keys a resource as `ResourceType/id`. YourPHR keys as
   * `(source_id, source_resource_type, source_resource_id)`, because the same clinical record can
   * arrive from three providers and each keeps its own id. Two providers can therefore hand us the
   * same `id` for different resources.
   *
   * This is open question 1 in docs/planning/typescript-stack-evaluation.md, and the spike's job is
   * to find out whether it bites in practice. So a duplicate id is COUNTED and REJECTED here rather
   * than silently upserted — an overwrite would destroy one record and report success, which is
   * precisely the class of bug this exercise is meant to avoid repeating.
   */
  async createResource<T extends Resource>(resource: T): Promise<WithId<T>> {
    const id = resource.id ?? this.generateId();
    const existing = this.db
      .prepare('SELECT 1 FROM resources WHERE resource_type = ? AND id = ? AND user_id = ?')
      .get(resource.resourceType, id, this.userId ?? '');
    if (existing) {
      this.stats.collisions++;
      throw new Error(`duplicate id ${resource.resourceType}/${id}`);
    }
    return this.writeResource({ ...resource, id } as WithId<T>).stored;
  }

  async updateResource<T extends Resource>(resource: T): Promise<WithId<T>> {
    if (!resource.id) {
      throw new Error('updateResource requires an id');
    }
    return this.writeResource(resource as WithId<T>).stored;
  }

  /**
   * Store `resource` unless the stored copy already says exactly the same thing (yourphr#781).
   *
   * Every sync pass receives every record again, and writing each one anyway stamped a new version,
   * added a full copy to resource_history and re-indexed it — ~30,000 history rows a day on a
   * live instance, for records nobody changed, until records.db reached 8.4 GB. A version that is
   * byte-identical to the one before it is not a version. `changed` is false when nothing was
   * written; the caller reports it as unchanged rather than updated.
   */
  async upsertIfChanged<T extends Resource>(resource: T): Promise<{ resource: WithId<T>; changed: boolean }> {
    if (!resource.id) {
      throw new Error('upsertIfChanged requires an id');
    }
    const { stored, changed } = this.writeResource(resource as WithId<T>, { skipUnchanged: true });
    return { resource: stored, changed };
  }

  /**
   * Thrown when two providers issue the same id to one person.
   *
   * Overwriting is the wrong answer: a record does not double, it DISAPPEARS, and the loss is
   * invisible because the row count never changes. Refusing makes it a visible failure that names
   * both sources, which is the least a records system can do with data it cannot safely merge.
   */
  static readonly COLLISION = 'cross-source id collision';

  private writeResource<T extends Resource>(resource: WithId<T>, options: { skipUnchanged?: boolean } = {}): { stored: WithId<T>; changed: boolean } {
    const versionId = this.generateId();
    const lastUpdated = new Date().toISOString();
    const stored = {
      ...resource,
      meta: { ...resource.meta, versionId, lastUpdated },
    } as WithId<T>;
    const content = JSON.stringify(stored);

    const source = this.sourceId ?? '';

    let unchanged: WithId<T> | undefined;
    const tx = this.db.transaction(() => {
      if (options.skipUnchanged) {
        const held = this.db
          .prepare('SELECT source_id, deleted, content FROM resources WHERE resource_type = ? AND id = ? AND user_id = ?')
          .get(stored.resourceType, stored.id, this.userId ?? '') as { source_id: string; deleted: number; content: string } | undefined;
        // Same source, not deleted, same content: nothing to write. A different source falls
        // through to the collision rule below; a deleted record is being brought back, which is a change.
        if (held && held.deleted === 0 && held.source_id === source) {
          const previous = JSON.parse(held.content) as WithId<T>;
          if (sameContent(previous, stored)) {
            // Seen again, unchanged: move "last confirmed" (the row's last_updated, which provenance
            // reads) and nothing else. No new version, no history copy, no re-index.
            this.db
              .prepare('UPDATE resources SET last_updated = ? WHERE resource_type = ? AND id = ? AND user_id = ?')
              .run(lastUpdated, stored.resourceType, stored.id, this.userId ?? '');
            unchanged = previous;
            return;
          }
        }
      }
      // Only meaningful once writes are attributed. With no source set — every existing harness,
      // and any single-source install — this is inert and the behaviour is exactly as before.
      if (source !== '') {
        const held = this.db
          .prepare('SELECT source_id FROM resources WHERE resource_type = ? AND id = ? AND user_id = ?')
          .get(stored.resourceType, stored.id, this.userId ?? '') as { source_id: string } | undefined;
        if (held && held.source_id !== '' && held.source_id !== source) {
          throw new Error(
            `${SqliteFhirRepository.COLLISION}: ${stored.resourceType}/${stored.id} is already held ` +
              `from source ${held.source_id}; refusing to overwrite it with source ${source}`
          );
        }
      }

      this.db
        .prepare(
          `INSERT INTO resources (resource_type, id, user_id, source_id, version_id, last_updated, deleted, content)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT (resource_type, id, user_id) DO UPDATE SET
             source_id = excluded.source_id,
             version_id = excluded.version_id,
             last_updated = excluded.last_updated,
             deleted = 0,
             content = excluded.content`
        )
        .run(stored.resourceType, stored.id, this.userId ?? '', source, versionId, lastUpdated, content);
      this.db
        .prepare(
          `INSERT INTO resource_history (resource_type, id, user_id, version_id, last_updated, content)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(stored.resourceType, stored.id, this.userId ?? '', versionId, lastUpdated, content);
      this.indexResource(stored);
    });
    tx();

    return unchanged ? { stored: unchanged, changed: false } : { stored, changed: true };
  }

  async readResource<T extends Resource>(resourceType: string, id: string): Promise<WithId<T>> {
    const row = this.db
      .prepare('SELECT content, deleted FROM resources WHERE resource_type = ? AND id = ? AND user_id = ?')
      .get(resourceType, id, this.userId ?? '') as { content: string; deleted: number } | undefined;
    if (!row || row.deleted) {
      throw new Error(`not found: ${resourceType}/${id}`);
    }
    return JSON.parse(row.content) as WithId<T>;
  }

  async readReference<T extends Resource>(reference: Reference<T>): Promise<WithId<T>> {
    const parts = reference.reference?.split('/');
    if (!parts || parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`unsupported reference: ${reference.reference}`);
    }
    return this.readResource<T>(parts[0], parts[1]);
  }

  async readReferences<T extends Resource>(references: readonly Reference<T>[]): Promise<(T | Error)[]> {
    return Promise.all(
      references.map(async (reference) => {
        try {
          return await this.readReference(reference);
        } catch (err) {
          return err as Error;
        }
      })
    );
  }

  async deleteResource(resourceType: string, id: string): Promise<void> {
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE resources SET deleted = 1 WHERE resource_type = ? AND id = ? AND user_id = ?')
        .run(resourceType, id, this.userId ?? '');
      this.db
        .prepare('DELETE FROM search_index WHERE resource_type = ? AND resource_id = ? AND user_id = ?')
        .run(resourceType, id, this.userId ?? '');
      this.db
        .prepare('DELETE FROM search_text WHERE resource_type = ? AND resource_id = ? AND user_id = ?')
        .run(resourceType, id, this.userId ?? '');
    });
    tx();
  }

  async withTransaction<TResult>(callback: (repo: this) => Promise<TResult>): Promise<TResult> {
    // better-sqlite3 transactions are synchronous, so an async callback cannot be wrapped in one
    // without lying about atomicity. Saying so is better than pretending.
    throw new Error('withTransaction is not implemented in the spike — see README');
  }

  async readHistory<T extends Resource>(_resourceType: string, _id: string): Promise<Bundle<WithId<T>>> {
    throw new Error('readHistory is not implemented in the spike — see README');
  }

  async readVersion<T extends Resource>(_resourceType: string, _id: string, _vid: string): Promise<WithId<T>> {
    throw new Error('readVersion is not implemented in the spike — see README');
  }

  async patchResource<T extends Resource>(): Promise<WithId<T>> {
    throw new Error('patchResource is not implemented in the spike — see README');
  }

  async searchByReference<T extends Resource>(): Promise<Record<string, WithId<T>[]>> {
    throw new Error('searchByReference is not implemented in the spike — see README');
  }

  // ---------------------------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------------------------

  async search<T extends Resource>(searchRequest: SearchRequest<T>): Promise<Bundle<WithId<T>>> {
    if (searchRequest.include?.length || searchRequest.revInclude?.length) {
      throw new Error('_include / _revInclude are not implemented in the spike — see README');
    }

    // EVERY query carries the owner. Not a filter callers may add — the whole point is that it
    // cannot be forgotten (#537).
    const where: string[] = ['r.resource_type = ?', 'r.deleted = 0', 'r.user_id = ?'];
    const params: unknown[] = [searchRequest.resourceType, this.userId ?? ''];

    for (const filter of searchRequest.filters ?? []) {
      const { sql, values } = this.buildFilter(searchRequest.resourceType, filter);
      where.push(sql);
      params.push(...values);
    }

    const whereClause = where.join(' AND ');

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM resources r WHERE ${whereClause}`).get(...params) as {
        n: number;
      }
    ).n;

    const count = searchRequest.count ?? 20;
    const offset = searchRequest.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT r.content FROM resources r WHERE ${whereClause} ORDER BY r.last_updated DESC, r.id LIMIT ? OFFSET ?`
      )
      .all(...params, count, offset) as { content: string }[];

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total,
      entry: rows.map((row) => ({ resource: JSON.parse(row.content) as WithId<T> })),
    };
  }

  /**
   * One filter becomes one EXISTS against the generic index. No per-resource-type SQL anywhere.
   */
  private buildFilter(resourceType: string, filter: Filter): { sql: string; values: unknown[] } {
    const exists = (clause: string, values: unknown[]): { sql: string; values: unknown[] } => ({
      sql: `EXISTS (SELECT 1 FROM search_index si WHERE si.resource_type = r.resource_type AND si.resource_id = r.id AND si.user_id = r.user_id AND si.code = ? AND ${clause})`,
      values: [filter.code, ...values],
    });

    switch (filter.operator) {
      case Operator.EQUALS:
        // A token indexes as both "code" and "system|code", so either form matches.
        return exists('si.value = ?', [filter.value]);
      case Operator.CONTAINS:
        return exists('si.value LIKE ?', [`%${filter.value.toLowerCase()}%`]);
      case Operator.STARTS_WITH:
        return exists('si.value LIKE ?', [`${filter.value.toLowerCase()}%`]);
      case Operator.GREATER_THAN:
        return exists('si.value > ?', [filter.value]);
      case Operator.GREATER_THAN_OR_EQUALS:
        return exists('si.value >= ?', [filter.value]);
      case Operator.LESS_THAN:
        return exists('si.value < ?', [filter.value]);
      case Operator.LESS_THAN_OR_EQUALS:
        return exists('si.value <= ?', [filter.value]);
      case Operator.MISSING: {
        const missing = filter.value === 'true';
        return {
          sql: `${missing ? 'NOT ' : ''}EXISTS (SELECT 1 FROM search_index si WHERE si.resource_type = r.resource_type AND si.resource_id = r.id AND si.user_id = r.user_id AND si.code = ?)`,
          values: [filter.code],
        };
      }
      default:
        // Chained params, composites, :above/:below and the rest. Refusing beats guessing.
        throw new Error(
          `operator "${filter.operator}" is not implemented in the spike (${resourceType}.${filter.code}) — see README`
        );
    }
  }
}

/**
 * Remove `.where(resolve() is Type)` guards from a SearchParameter expression, returning the types
 * they named.
 *
 * FINDING, worth keeping: FHIR defines reference parameters like `Condition.patient` as
 * `Condition.subject.where(resolve() is Patient)`. fhirpath.js refuses `resolve()` in synchronous
 * mode, so those expressions threw while sibling parameters with plain paths — `Immunization.patient`
 * — evaluated fine. The visible symptom was `Condition?patient=X` returning zero while
 * `Immunization?patient=X` returned six: a search that is confidently wrong, not one that errors.
 *
 * Resolving the reference is unnecessary to answer the question. A reference already carries its own
 * type ("Patient/123"), so the guard is reinstated at index time by matching the prefix. The
 * alternative — fhirpath's async mode with a resolver that reads from the database — would make
 * indexing depend on referential integrity that a partially synced PHR does not have.
 */
export function stripResolveGuards(expression: string): { expression: string; allowedTypes?: string[] } {
  if (!expression.includes('resolve()')) {
    return { expression };
  }

  const types: string[] = [];
  let out = '';
  let i = 0;

  while (i < expression.length) {
    const start = expression.indexOf('.where(', i);
    if (start === -1) {
      out += expression.slice(i);
      break;
    }

    // Walk to the matching close paren; `resolve()` contributes parens of its own.
    let depth = 0;
    let end = start + '.where('.length - 1;
    for (; end < expression.length; end++) {
      if (expression[end] === '(') {
        depth++;
      } else if (expression[end] === ')') {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }

    const clause = expression.slice(start, end + 1);
    if (clause.includes('resolve()')) {
      for (const match of clause.matchAll(/resolve\(\)\s+is\s+([A-Za-z]+)/g)) {
        if (match[1]) {
          types.push(match[1]);
        }
      }
      out += expression.slice(i, start); // drop the guard
    } else {
      out += expression.slice(i, end + 1); // an unrelated where() — keep it
    }
    i = end + 1;
  }

  return { expression: out, allowedTypes: types.length > 0 ? types : undefined };
}

/**
 * Flatten one FHIRPath result into the string forms a search can match.
 *
 * Deliberately small. It covers the value types the seed corpus actually contains; anything else
 * falls through to a JSON string, which will not match and is meant to be visible rather than
 * silently absent.
 */
export function normalizeValues(value: unknown, paramType: SearchParameter['type']): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === 'string') {
    return [paramType === 'string' ? value.toLowerCase() : value];
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (typeof value !== 'object') {
    return [];
  }

  const obj = value as Record<string, unknown>;

  // Reference: "Patient/123"
  if (typeof obj.reference === 'string') {
    return [obj.reference];
  }

  // CodeableConcept
  if (Array.isArray(obj.coding)) {
    const out: string[] = [];
    for (const coding of obj.coding as Record<string, unknown>[]) {
      out.push(...codingValues(coding));
    }
    if (typeof obj.text === 'string') {
      out.push(obj.text.toLowerCase());
    }
    return out;
  }

  // Coding / Identifier
  if (typeof obj.code === 'string' || typeof obj.value === 'string') {
    return codingValues(obj);
  }

  // Period — index the start, which is what a date search compares against
  if (typeof obj.start === 'string') {
    return [obj.start];
  }

  // Quantity
  if (typeof obj.value === 'number') {
    return [String(obj.value)];
  }

  // HumanName / Address and friends: index their text parts so `name=smith` has something to hit
  const textParts = ['text', 'family', 'city', 'state', 'postalCode', 'display']
    .map((key) => obj[key])
    .filter((v): v is string => typeof v === 'string');
  if (Array.isArray(obj.given)) {
    textParts.push(...(obj.given as unknown[]).filter((v): v is string => typeof v === 'string'));
  }
  if (textParts.length > 0) {
    return textParts.map((t) => t.toLowerCase());
  }

  return [];
}

function codingValues(coding: Record<string, unknown>): string[] {
  const code = (coding.code ?? coding.value) as string | undefined;
  const system = coding.system as string | undefined;
  if (!code) {
    return [];
  }
  return system ? [code, `${system}|${code}`] : [code];
}

export type { ResourceType };
