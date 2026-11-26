/**
 * Session storage (yourphr#814): the server-side record behind every signed-in session.
 *
 * ngdpbase keeps its sessions on the server (an express-session store), so signing out ends the
 * session itself. yourPHR's session token was stateless until #814: sign-out cleared the cookie
 * and the token kept working until it expired. Now every token names a session id (`sid`), and a
 * token is good only while its record is here. Sign-out deletes the record; so does revoking one
 * session from the list, and "sign out everywhere" deletes them all.
 *
 * The provider stores; the manager decides. It never sees a token — only the random session id
 * the token carries — and it never judges whether a record is live.
 */

export interface SessionRecord {
  /** Random, unguessable, the `sid` claim. Not a credential on its own: a token also needs the HMAC. */
  sid: string;
  username: string;
  /** The account's token generation when the session was minted (the #528 revocation fact). */
  generation: number;
  /** Epoch seconds. */
  createdAt: number;
  /** Epoch seconds: the last time the session was renewed (sign-in counts as the first). */
  lastSeenAt: number;
  /** Epoch seconds: the sliding expiry, moved forward on each renewal, never past `capAt`. */
  expiresAt: number;
  /** Epoch seconds: the absolute cap, fixed at sign-in. */
  capAt: number;
}

export abstract class BaseSessionsProvider {
  abstract initialize(): Promise<void>;
  abstract create(record: SessionRecord): Promise<void>;
  abstract get(sid: string): Promise<SessionRecord | undefined>;
  /** Moves the sliding expiry and last-seen time of one session. */
  abstract touch(sid: string, lastSeenAt: number, expiresAt: number): Promise<void>;
  /** Answers whether a record was deleted. */
  abstract delete(sid: string): Promise<boolean>;
  /** Every session of one account; answers how many were deleted. */
  abstract deleteForUser(username: string): Promise<number>;
  abstract listForUser(username: string): Promise<SessionRecord[]>;
  /** Drops every record past its sliding expiry or its cap; answers how many. */
  abstract prune(nowSeconds: number): Promise<number>;
}

/**
 * In memory: the harnesses' default, and what a SessionsManager built without a store uses. A
 * restart forgets every session, so everyone signs in again. That fails closed: nobody keeps a
 * session they should not have. The app wires the SQLite provider instead (src/app.ts).
 */
export class MemorySessionsProvider extends BaseSessionsProvider {
  private readonly rows = new Map<string, SessionRecord>();
  async initialize(): Promise<void> { /* nothing to open */ }
  async create(record: SessionRecord): Promise<void> {
    if (this.rows.has(record.sid)) throw new Error('session id already exists');
    this.rows.set(record.sid, { ...record });
  }
  async get(sid: string): Promise<SessionRecord | undefined> {
    const r = this.rows.get(sid);
    return r ? { ...r } : undefined;
  }
  async touch(sid: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    const r = this.rows.get(sid);
    if (r) { r.lastSeenAt = lastSeenAt; r.expiresAt = expiresAt; }
  }
  async delete(sid: string): Promise<boolean> { return this.rows.delete(sid); }
  async deleteForUser(username: string): Promise<number> {
    let n = 0;
    for (const [sid, r] of this.rows) if (r.username === username) { this.rows.delete(sid); n++; }
    return n;
  }
  async listForUser(username: string): Promise<SessionRecord[]> {
    return [...this.rows.values()].filter((r) => r.username === username).map((r) => ({ ...r })).sort((a, b) => b.createdAt - a.createdAt);
  }
  async prune(nowSeconds: number): Promise<number> {
    let n = 0;
    for (const [sid, r] of this.rows) if (r.expiresAt <= nowSeconds || r.capAt <= nowSeconds) { this.rows.delete(sid); n++; }
    return n;
  }
}
