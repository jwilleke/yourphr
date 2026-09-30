/**
 * The request context (yourphr#608): who is asking, built fresh per request from verified session
 * state and passed INTO every manager call. ngdpbase's `ApiContext`, with the doc's two
 * corrections: the authorization facts are required and immutable (a missing value must not fail
 * closed by luck), and there is no process-global context — this object lives one request.
 *
 * The engine rides on it for handler convenience (the doc's line 221). A manager never reads
 * `ctx.engine`; the store-boundary lint says so and CI proves it.
 *
 * Guards throw ApiError, which one error boundary renders in the API envelope. The messages are
 * the Go stack's, because the Angular app reads them.
 */
import type { Engine } from './Engine.js';
import type { Permission } from './policy.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Extra envelope fields (Go's error_code and friends). */
    public readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A role name as the configuration defines it (yourphr#648); the users table stores one of these. */
export type Role = string;

/**
 * The role a CONTEXT carries. `anonymous` is a role with an empty permission list rather than an
 * `if` at the edge (yourphr#620), so the unauthenticated path goes through the same evaluator as
 * every other. It is never a stored role — the users table holds `Role`.
 */
export type ContextRole = Role | 'anonymous';

export interface Principal {
  username: string;
  role: Role;
  /** The account's token generation at verification time — the #528 revocation fact. */
  tokenGeneration?: number;
  /**
   * Set when the caller is an AGENT holding a token the owner minted (yourphr#695), absent for an
   * ordinary session. ngdpbase carries the same fact under the same name.
   */
  viaToken?: ViaToken;
}

/**
 * The agent standing behind a request, and the ceiling on what it may read.
 *
 * `scopes` are ACCESS CATEGORIES — the access log's vocabulary — because this stack has no
 * record-level permissions for a scope to narrow; see `ACCESS_CATEGORIES`. An empty list is
 * "nothing", never "everything": the difference is the whole safety of the feature.
 */
export interface ViaToken {
  id: string;
  /** What the patient named it — and what the access log calls the actor. */
  name: string;
  scopes: readonly string[];
  /** The connected-device grant this key belongs to (yourphr#808); absent for an ordinary agent token. */
  grantId?: string;
}

export class ApiContext {
  readonly engine: Engine;
  readonly isAuthenticated: boolean;
  readonly username: string;
  readonly role: ContextRole;
  /** What this caller may do, resolved once from the role at construction (yourphr#620). */
  readonly permissions: readonly Permission[];
  readonly tokenGeneration: number | undefined;
  /** A named non-human caller (the migration tool, the worker); '' for a person. */
  readonly system: string;
  /** Present only when an agent token authenticated this request (yourphr#695). */
  readonly viaToken: ViaToken | undefined;

  private constructor(engine: Engine, principal: Principal | null, system = '') {
    this.engine = engine;
    this.isAuthenticated = principal !== null;
    this.username = principal?.username ?? '';
    this.role = principal?.role ?? 'anonymous';
    // Resolved live, per request, from the role — never carried in a token (yourphr#620): a
    // demoted admin loses their powers on the next call, not when a token expires. The answer is
    // the policy manager's, which reads the operator's configured roles (yourphr#623). An engine
    // with no policy manager grants NOTHING: failing closed is the only safe direction here.
    this.permissions = Object.freeze(engine.has('policy') ? [...engine.managers.policy.permissionsFor(this.role)] : []);
    this.tokenGeneration = principal?.tokenGeneration;
    this.system = system;
    // Copied, and the scope array with it: this list is the read ceiling, so sharing the caller's
    // array would let anything downstream widen a token in place — the defect ngdpbase#1108 found
    // in exactly this seam, where the stored record's scopes reached the ACL layer by reference.
    this.viaToken = principal?.viaToken
      ? Object.freeze({ ...principal.viaToken, scopes: Object.freeze([...principal.viaToken.scopes]) })
      : undefined;
    Object.freeze(this);
  }

  /** A signed-in person, from the session the transport already verified. */
  static from(principal: Principal, engine: Engine): ApiContext {
    return new ApiContext(engine, principal);
  }

  /**
   * An agent acting for `owner` under a token the owner minted (yourphr#695).
   *
   * The role is deliberately NOT the owner's. An agent token can never carry an admin power —
   * ngdpbase refuses `admin-*` scopes outright for the same reason — so the context is built at
   * the ordinary member role whoever owns it, and the scope list narrows from there.
   */
  static agent(owner: string, via: ViaToken, engine: Engine): ApiContext {
    return new ApiContext(engine, { username: owner, role: 'user', viaToken: via });
  }

  /** Nobody: the public routes. */
  static anonymous(engine: Engine): ApiContext {
    return new ApiContext(engine, null);
  }

  /** A named system actor acting for an account — the migration tool, the worker's sync pass. */
  static system(name: string, onBehalfOf: string, engine: Engine): ApiContext {
    return new ApiContext(engine, { username: onBehalfOf, role: 'user' }, name);
  }

  /**
   * The actor as the access log names it.
   *
   * An agent is named by ITS OWN token name, so the log reads "Claude Desktop read your
   * medications" rather than attributing the read to the patient who was not at the keyboard.
   * That attribution is the point of yourphr#657 and the thing it wrongly assumed already worked.
   */
  get actor(): string {
    if (this.viaToken) return this.viaToken.name;
    return this.system !== '' ? this.system : this.username;
  }

  /**
   * May this caller read the given access category (yourphr#695)?
   *
   * An ordinary session may read anything its compartment holds — categories are not a permission
   * gate for people. An agent may read only what its token names, and an empty scope list reads
   * nothing.
   */
  canRead(category: string): boolean {
    if (!this.isAuthenticated) return false;
    if (!this.viaToken) return true;
    return this.viaToken.scopes.includes(category);
  }

  requireAuthenticated(): void {
    if (!this.isAuthenticated) throw new ApiError(401, 'unauthorized');
  }

  /** Does this caller hold the permission? The whole question, asked one way (yourphr#620). */
  can(permission: Permission): boolean {
    return this.isAuthenticated && this.permissions.includes(permission);
  }

  /**
   * The gate: 401 when nobody is asking, 403 when somebody is but may not. The message stays the
   * Go stack's default because the Angular app reads it; a caller passes its own where Go's screen
   * says something more specific.
   */
  require(permission: Permission, message = 'admin role required'): void {
    this.requireAuthenticated();
    if (!this.can(permission)) throw new ApiError(403, message);
  }
}
