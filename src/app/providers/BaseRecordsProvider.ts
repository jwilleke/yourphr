/**
 * The PHI-storage capability (yourphr#609): the one-active provider behind the Records manager.
 * Every operation is scoped to an account — a provider never answers for "all users". The search
 * index is the provider's internal: callers get INDEXED SEARCH and GROUPED AGGREGATION as
 * operations, never the table (the architecture doc's decision 4).
 *
 * A second implementation is plausible for an adopter (a server-grade database, an encrypted
 * object store); the interface is what lets that arrive without touching the manager.
 */
import type { Bundle, Resource, ResourceType } from '@medplum/fhirtypes';
import type { SearchRequest, WithId } from '@medplum/core';

export interface StoredRecord {
  resourceType: string;
  id: string;
  sourceId: string;
  lastUpdated: string;
  resource: Resource;
}

/** One condition on one indexed search parameter; alternatives OR, parameters AND. */
export interface IndexCondition {
  param: string;
  /** Each alternative: an exact value, a `system|` prefix match, or a prefixed comparison (eq/gt/ge/lt/le/ne). */
  alternatives: string[];
}

export interface RecordsWriter {
  /** Upsert one resource for the bound account and source. Throws on a cross-source id collision. */
  upsert(resource: Resource): Promise<'created' | 'updated'>;
  exists(resourceType: string, id: string): Promise<boolean>;
}

export abstract class BaseRecordsProvider {
  abstract initialize(): Promise<void>;
  abstract close(): Promise<void>;

  // --- reads ---
  abstract search<T extends Resource>(userId: string, request: SearchRequest<T>): Promise<Bundle<WithId<T>>>;
  abstract read(userId: string, resourceType: string, id: string): Promise<StoredRecord | undefined>;
  /** YourPHR addresses a record by id without its type; the provider finds it. */
  abstract readById(userId: string, id: string): Promise<StoredRecord | undefined>;
  abstract list(userId: string, filter?: { resourceType?: string; sourceId?: string }): Promise<StoredRecord[]>;
  abstract countByType(userId: string, sourceId?: string): Promise<{ resourceType: string; count: number }[]>;
  abstract typesHeld(userId: string): Promise<string[]>;
  /** Source attribution for every id of one type — how a list says where each record came from. */
  abstract sourceOf(userId: string, resourceType: string): Promise<Map<string, string>>;
  /** First time this instance received the record, and how many versions it has seen. */
  abstract history(userId: string, resourceType: string, id: string): Promise<{ firstReceivedAt: string | null; versions: number }>;
  /** Indexed search: records of one type matching every condition. */
  abstract indexedSearch(userId: string, resourceType: string, where: IndexCondition[]): Promise<StoredRecord[]>;
  /** The indexed `system|code` values of one record's parameter — the labels a grouped aggregation counts by. */
  abstract indexedValues(userId: string, resourceType: string, id: string, param: string): Promise<string[]>;
  /** Find anything by words (yourphr#599): the caller's records whose text matches, best first, with a snippet. */
  abstract textSearch(userId: string, q: string, page: { limit: number; offset: number }): Promise<{ resourceType: string; id: string; snippet: string }[]>;
  /** The references one record makes, as "Type/id" strings (yourphr#605) — the graph's out-edges. */
  abstract referencesFrom(userId: string, resourceType: string, id: string): Promise<string[]>;
  /** The records that reference "Type/id" (yourphr#605) — the graph's in-edges. */
  abstract referencedBy(userId: string, reference: string): Promise<{ resourceType: string; id: string }[]>;

  // --- writes ---
  abstract writer(userId: string, sourceId: string): RecordsWriter;
  abstract removeBySource(userId: string, sourceId: string): Promise<number>;
  abstract removeAll(userId: string): Promise<number>;
  /**
   * One record, gone without a trace (yourphr#762): the row, its index entries and its history.
   * Not the soft delete the FHIR repository does — a discarded record leaves nothing behind, which
   * is the decision for a record that was never a chart fact. Returns false if it was not there.
   */
  abstract removeRecord(userId: string, resourceType: string, id: string): Promise<boolean>;
  /** Drops the account's handle after removeAll, so a returning account starts clean. */
  abstract release(userId: string): Promise<void>;

  // --- the lifecycle the base contract demands ---
  abstract integrityOk(): Promise<boolean>;
  /** Where the data lives and how big it is — the admin's Database card (yourphr#619). */
  abstract storage(): { location: string; sizeBytes: number };
  /** An encrypted copy of the whole store under `key`; returns the file written. */
  abstract backup(options: { destination: string; key: string; maxBackups?: number; now?: Date; alsoExport?: unknown[] }): Promise<{ file: string; sizeBytes: number; pruned: string[] }>;
  /** Stage a backup back under this store's own key, next to its own files, for the next start. */
  abstract stageRestore(backupFile: string, backupKey: string): Promise<{ tables: number }>;
}

export type { ResourceType };
