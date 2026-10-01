/**
 * The PHI-storage capability (yourphr#609): the one-active provider behind the Records manager.
 * Every operation is scoped to an account — a provider never answers for "all users". The search
 * index is the provider's internal: callers get INDEXED SEARCH and GROUPED AGGREGATION as
 * operations, never the table (the architecture doc's decision 4).
 *
 * A second implementation is plausible for an adopter (a server-grade database, an encrypted
 * object store); the interface is what lets that arrive without touching the manager.
 */
import type { BackupData } from '../../framework/BaseManager.js';
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
  /**
   * Upsert one resource for the bound account and source. Throws on a cross-source id collision.
   * 'unchanged' when the stored copy already says the same thing and nothing was written (yourphr#781).
   */
  upsert(resource: Resource): Promise<'created' | 'updated' | 'unchanged'>;
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
  abstract backup(options: { destination: string; key: string; maxBackups?: number; now?: Date; alsoExport?: unknown[]; payloads?: BackupData[] }): Promise<{ file: string; sizeBytes: number; pruned: string[] }>;
  /** Stage a backup back under this store's own key, next to its own files, for the next start. */
  abstract stageRestore(backupFile: string, backupKey: string): Promise<{ tables: number }>;
  /** Other managers' payloads carried in a backup (yourphr#631), by manager; {} when it carries none. */
  abstract readPayloads(backupFile: string, backupKey: string): Promise<Record<string, BackupData>>;
  /**
   * Offline maintenance (yourphr#781): drop history copies identical to the version before them,
   * then give the space back. Run with the server stopped — it is synchronous and takes the file.
   */
  abstract compact(options?: { dryRun?: boolean; vacuum?: boolean }): Promise<CompactReport>;
  /**
   * The whole-file integrity check (yourphr#856), off the request thread: it reads every page, and
   * on the server's own thread it would stop every request until it finished.
   */
  abstract checkIntegrity(): Promise<{ ok: boolean; detail: string }>;
  /** Which derivation built the search index, and whether that is older than this build's (yourphr#713). */
  abstract searchIndex(): SearchIndexStatus;
  /**
   * Rebuild the search index from stored content (yourphr#713): every account, or one. Each account
   * is one transaction, so an interrupted rebuild leaves that account's old index whole. The store is
   * marked current only when every account has been rebuilt.
   */
  abstract rebuildSearchIndex(options?: { userId?: string; onProgress?: (accountsDone: number, accounts: number) => void }): Promise<{ accounts: number; records: number }>;
}

/** The search index's derivation version against this build's (yourphr#713). */
export interface SearchIndexStatus {
  builtWith: number;
  current: number;
  stale: boolean;
}

/** What `compact` found and did. Counts are rows; sizes are bytes of the main database file. */
export interface CompactReport {
  resources: number;
  historyBefore: number;
  /** History rows identical to the version before them — removed, or that would be on a dry run. */
  duplicates: number;
  historyAfter: number;
  /** Records whose current version was a duplicate, repointed to the first copy of that content. */
  repointed: number;
  /**
   * Record ids with legacy history the re-keying migration could not give to one person (yourphr#812:
   * an id two people held before history carried the person), left untouched — those rows cannot be
   * told apart, so compacting them could cross accounts. Everything else is compacted per person.
   */
  skippedShared: number;
  bytesBefore: number;
  bytesAfter: number;
  vacuumed: boolean;
  /** quick_check after the work: 'ok', or what SQLite reported. */
  integrity: string;
  dryRun: boolean;
}

export type { ResourceType };
