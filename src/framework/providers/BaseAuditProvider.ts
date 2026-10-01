/**
 * Audit storage (yourphr#614): who accessed which category of a person's records on which day,
 * aggregated per (owner, actor, category, day) with a count and first/last times — the row shape
 * Go keeps, so "who has looked at my record" is answerable and the table stays bounded.
 * Deliberately no IP address and no user agent (the #507/#512 stance). A REQUIRED capability:
 * there is no Null provider, and the manager refuses to boot over one that is not healthy.
 */
export interface AccessEvent {
  actor_username: string;
  category: string;
  day: string;
  count: number;
  first_at: string;
  last_at: string;
}

export abstract class BaseAuditProvider {
  abstract initialize(): Promise<void>;
  /** Can this provider take a write right now? The manager refuses to boot on false. */
  abstract healthCheck(): Promise<boolean>;
  /** One access, folded into its (actor, category, day) bucket. Throws when it cannot be kept. */
  abstract record(owner: string, actor: string, category: string, at: Date): Promise<void>;
  /** Carries a bucket recorded elsewhere (the migration); an existing bucket is kept. True when added. */
  abstract importEvent(owner: string, event: AccessEvent): Promise<boolean>;
  /** The complete log of one owner, newest day first — unfiltered, unedited. */
  abstract list(owner: string): Promise<AccessEvent[]>;
  abstract removeForOwner(owner: string): Promise<void>;
  /**
   * The owner trims their own log (yourphr#507): every bucket dated before `beforeDay` (YYYY-MM-DD)
   * goes, EXCEPT those of `keepCategory` — the record of trims, which a trim never removes.
   * Returns how many buckets went.
   */
  abstract trim(owner: string, beforeDay: string, keepCategory: string): Promise<number>;
}
