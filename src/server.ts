/**
 * The HTTP layer, serving YOURPHR's API contract rather than FHIR REST (#537).
 *
 * The evaluation assumes a backend rewrite does not force a frontend rewrite, because "the Angular
 * app talks to an HTTP contract a TypeScript backend can serve unchanged". This is the test of that
 * assumption, and it is not free: **the frontend does not speak FHIR REST.**
 *
 * Medplum's FhirRouter serves `GET /Condition?patient=x` returning a Bundle. The Angular app calls
 * `GET /api/secure/resource/fhir?sourceResourceType=Condition` and expects
 * `{success, data: ResourceFhir[]}`, where ResourceFhir WRAPS the FHIR resource with YourPHR's own
 * metadata:
 *
 *     { source_id, source_resource_type, source_resource_id, fhir_version,
 *       resource_raw, sort_title, sort_date, provenance?, classified? }
 *
 * So keeping the frontend means writing an adapter, and the adapter needs data a FHIR-native store
 * does not hold. That is the finding; the cost is real but bounded, and it is far smaller than
 * rewriting 76.8k lines of Angular.
 */
import { accessCategoryFor, consentNow, consentStatus } from './account/index.js';
import { appLog, VALID_LEVELS } from './log/index.js';
import {createServer, IncomingMessage, ServerResponse} from 'node:http';
import {createReadStream, existsSync, statSync} from 'node:fs';
import {dirname, extname, join, resolve, sep} from 'node:path';
import type {Resource, ResourceType} from '@medplum/fhirtypes';
import type {SqliteFhirRepository} from './SqliteFhirRepository.js';

import {sseFrame, type EventBus} from './events/index.js';
import {Engine} from './framework/Engine.js';
import {ApiContext, ApiError} from './framework/ApiContext.js';
import {RecordsManager} from './app/managers/RecordsManager.js';
import {SimpleRateLimiter} from './http/rate-limit.js';
import {clientIp} from './framework/managers/SessionsManager.js';
import {SqliteRecordsProvider} from './app/providers/SqliteRecordsProvider.js';
import {PatientEntryError, buildPatientVital, type PatientEntryRequest} from './patient-entry/index.js';

/**
 * The session cookie. HttpOnly throughout: the Angular app (yourphr#118 Phase 2b) never sees a
 * token and relies entirely on this being set on sign-in and read on /api/secure/*.
 *
 * It was `fasten_session` — the Go name, kept deliberately so a browser moving between the two
 * stacks during the cut-over (yourphr#588) held one session entry. The cut-over is done: both
 * instances serve TypeScript, and the Go pods are a rollback nobody browses to. So the name goes
 * with the rest of the upstream vocabulary (yourphr#676).
 *
 * Renaming it ENDS EVERY SESSION once, on the release that carries it. There is no migration to
 * write and none worth writing: the old cookie stops being read, its holder is treated as signed
 * out, and signing in again issues the new one. A dual-read fallback would keep the old name alive
 * in the codebase for the sake of skipping one sign-in.
 */
export const SESSION_COOKIE = 'yourphr_session';

function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

function readCookie(header: string | undefined, name: string): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

export interface ServerAuth {
  /** Lifetime of the session cookie — the session's absolute cap; default 12h like DefaultSessionPolicy. */
  cookieMaxAgeSeconds?: number;
  /** Mark the cookie Secure. False behind a TLS-terminating proxy that talks plain HTTP to us (Go's web.listen.https.enabled posture). */
  secureCookies?: boolean;
  /**
   * The repository serving a VERIFIED user's requests. This signature is the point of the wiring
   * (yourphr#541): the user id stops being server configuration and becomes something each request
   * proves with a session — the isolation #537 demonstrated, enforced on the wire.
   */
}

export interface ServerOptions {
  /** The pinned single-user repository — used only when `auth` is absent (the read-only harnesses). */
  /** The composition root (yourphr#608). When absent, a bare engine is built over `repo` for the contract harnesses. */
  engine?: Engine;
  /** Legacy: the contract harnesses hand one repository in and test reads, not auth. */
  repo?: SqliteFhirRepository;
  /** Which source every record is attributed to. See the note on sourceId below. */
  sourceId?: string;
  /**
   * When present, /api/secure/* requires a Bearer session from POST /api/auth/signin, and each
   * request is served as its verified user. Absent keeps the legacy pinned-user behavior for the
   * existing contract harnesses, which test reads, not auth.
   */
  auth?: ServerAuth;
  /**
   * Directory holding the BUILT Angular app (yourphr#585). When set, non-/api requests serve
   * static files with an SPA fallback to index.html — one container replaces one container at
   * cut-over. API routes always win.
   */
  webDir?: string;
  /** Reported by GET /api/version — the Angular footer shows it. */
  version?: string;
}

/**
 * Wrap a FHIR resource the way the Angular app expects to receive it.
 *
 * THREE FIELDS THE SPIKE CANNOT PRODUCE, and they are the honest cost of this layer:
 *
 *   source_id   — which connected provider a record came from. YourPHR stores it per record; a
 *                 FHIR-native store has no such concept. Migrating means persisting it alongside.
 *   sort_title  — a display title the Go backend derives per resource type at write time. The list
 *                 views sort and label by it, so an empty one gives a screen of blank rows.
 *   provenance / classified — attached on the read path (#271, #308/#309), not stored.
 *
 * None is hard; all are invisible until the screen renders wrong, which is exactly why this had to
 * be built rather than reasoned about.
 */
export function toResourceFhir(resource: Resource, sourceId: string): Record<string, unknown> {
  return {
    source_id: sourceId,
    source_resource_type: resource.resourceType,
    source_resource_id: resource.id,
    fhir_version: 'R4',
    resource_raw: resource,
    // Best effort from the resource itself. The Go side computes a richer title per type; matching
    // it exactly is adapter work, not a question about whether the approach can work.
    sort_title: titleFor(resource),
    sort_date: dateFor(resource),
  };
}

/**
 * What an Observation measured, in the words the record itself carries (yourphr#696).
 *
 * Blood pressure is the case that forced this: it holds no value of its own, only two components,
 * so a list showed the panel's LOINC display and never the reading. Anything this cannot phrase
 * from the record — a lab with no value yet, a panel of other shapes — falls through to the code
 * text, which is the honest answer rather than an invented one.
 */
function observationMeasurement(r: any): string {
  const label = (c: any): string => c?.text || c?.coding?.[0]?.display || '';
  const amount = (q: any): string => (q && typeof q.value === 'number' ? `${q.value}${q.unit ? ` ${q.unit}` : ''}` : '');

  const components: any[] = Array.isArray(r.component) ? r.component : [];
  const systolic = components.find((c) => c?.code?.coding?.some((k: any) => k?.code === '8480-6'));
  const diastolic = components.find((c) => c?.code?.coding?.some((k: any) => k?.code === '8462-4'));
  if (systolic?.valueQuantity?.value != null && diastolic?.valueQuantity?.value != null) {
    const unit = systolic.valueQuantity.unit === 'mm[Hg]' ? 'mmHg' : (systolic.valueQuantity.unit ?? '');
    return `Blood pressure ${systolic.valueQuantity.value}/${diastolic.valueQuantity.value}${unit ? ` ${unit}` : ''}`;
  }

  const name = label(r.code);
  const value = amount(r.valueQuantity) || (typeof r.valueString === 'string' ? r.valueString : '') || label(r.valueCodeableConcept);
  if (name !== '' && value !== '') return `${name} ${value}`;
  return '';
}

export function titleFor(resource: any): string {
  // An Observation's code alone is not what a person came to read: "Blood pressure panel with all
  // children optional" is the LOINC display, and the measurement is the point (yourphr#262, #696).
  // Only what the record states is used — no unit conversion, no rounding, no inferred label.
  if (resource?.resourceType === 'Observation') {
    const measured = observationMeasurement(resource);
    if (measured !== '') return measured;
  }
  return (
    resource.code?.text ||
    resource.code?.coding?.[0]?.display ||
    resource.type?.[0]?.text ||
    resource.type?.coding?.[0]?.display ||
    resource.medicationCodeableConcept?.text ||
    resource.medicationCodeableConcept?.coding?.[0]?.display ||
    resource.vaccineCode?.text ||
    resource.vaccineCode?.coding?.[0]?.display ||
    resource.description ||
    resource.name?.[0]?.text ||
    resource.name ||
    ''
  );
}

export function dateFor(resource: any): string | null {
  return (
    resource.effectiveDateTime ||
    resource.effectivePeriod?.start ||
    resource.issued ||
    resource.onsetDateTime ||
    resource.recordedDate ||
    resource.occurrenceDateTime ||
    resource.performedDateTime ||
    resource.performedPeriod?.start ||
    resource.authoredOn ||
    resource.date ||
    resource.created ||
    resource.dateAsserted ||
    resource.period?.start ||
    resource.period?.end || // a visit with only an end still happened then
    null // never meta.lastUpdated: when THIS instance stored it is not when anything happened
  );
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  res.writeHead(status, {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded)});
  res.end(encoded);
}

/**
 * Serves the subset of YourPHR's API the record screens actually use. Read-only, and deliberately
 * so: this exists to answer "can the existing frontend load records from the TypeScript stack",
 * not to be a backend.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Serves the built Angular app (yourphr#585). The one security rule that matters: the resolved
 * path must stay INSIDE webDir — a traversal (%2e%2e, ../) gets 404, not the file. SPA fallback:
 * an extensionless path is an Angular route and gets index.html; a missing asset (has an
 * extension) is an honest 404, because serving index.html as main.js breaks the app confusingly.
 */
function serveStatic(webDir: string, pathname: string, res: ServerResponse): void {
  const root = resolve(webDir);
  const decoded = decodeURIComponent(pathname);
  const candidate = resolve(join(root, decoded));
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    res.writeHead(404, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({success: false, error: 'not found'}));
    return;
  }

  let file = candidate;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(decoded) !== '') {
      res.writeHead(404, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: false, error: 'not found'}));
      return;
    }
    file = join(root, 'index.html'); // the SPA fallback — Angular owns the route
  }

  const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    // index.html must revalidate (it names the hashed bundles); hashed assets may cache hard.
    'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(file).pipe(res);
}

/** Reads a small JSON body; refuses anything over 64KB — sign-in bodies have no reason to be big. */
function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        req.destroy();
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

/**
 * The `file` part of a multipart upload (yourphr#736) — what the Sources page's upload sends.
 *
 * Parsed by the runtime's own `Request.formData()` rather than a hand-rolled boundary scanner or a
 * new dependency; it is a body parser here, not a network call. Capped: an over-size body is
 * drained and refused, never held in memory past the cap.
 */
async function readUpload(req: IncomingMessage, maxBytes: number): Promise<{ file: { filename: string; bytes: Buffer } } | { status: number; error: string }> {
  const type = req.headers['content-type'] ?? '';
  if (!/^multipart\/form-data/i.test(type)) return { status: 400, error: 'send the file as multipart/form-data, in a field named "file"' };
  const tooLarge = { status: 413, error: `the file is larger than this instance accepts (${Math.floor(maxBytes / (1024 * 1024))} MB — yourphr.sources.upload.max-bytes)` };
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size <= maxBytes) chunks.push(chunk as Buffer);
    }
  } catch {
    return { status: 400, error: 'the upload was interrupted' };
  }
  if (size > maxBytes) return tooLarge;
  let form: FormData;
  try {
    form = await new Request('http://upload.invalid/', { method: 'POST', headers: { 'content-type': type }, body: Buffer.concat(chunks) }).formData();
  } catch {
    return { status: 400, error: 'the upload is not valid multipart/form-data' };
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return { status: 400, error: 'the upload carried no file in the "file" field' };
  return { file: { filename: file.name, bytes: Buffer.from(await file.arrayBuffer()) } };
}

export function createYourPhrServer(options: ServerOptions) {
  const auth = options.auth;
  // The engine: the assembled one, or — for the contract harnesses that hand a repository in — a
  // bare one with a Records manager over that handle. Either way every record goes through the door.
  const engineReady: Promise<Engine> = options.engine
    ? Promise.resolve(options.engine)
    : (async () => {
        if (!options.repo) throw new Error('createYourPhrServer needs an engine or a repository');
        const e = new Engine();
        e.register('records', new RecordsManager(e, SqliteRecordsProvider.overRepository(options.repo)));
        await e.initialize();
        return e;
      })();
  const legacyUser = options.repo?.userId ?? '';

  /**
   * The per-IP budget for the unauthenticated auth routes (yourphr#647). Built once, on the first
   * request, because the configuration manager only exists after the engine has initialised.
   *
   * A budget of 0 or less turns it OFF, deliberately: an automated suite driving real logins from
   * one address is the case that needs that switch (Go learned it in yourphr#481, where the E2E run
   * was silently collecting 429s). A non-positive WINDOW is a typo rather than an instruction, so it
   * falls back to the shipped 60s instead of reading as "disable the backstop".
   */
  let authLimiter: SimpleRateLimiter | undefined;
  let limiterSettings = '';
  const limiterFor = (engine: Engine): SimpleRateLimiter | undefined => {
    if (!engine.has('configuration')) return authLimiter;
    const config = engine.managers.configuration;
    const max = config.getInt('yourphr.auth.rate-limit.max-requests');
    const windowSeconds = config.getInt('yourphr.auth.rate-limit.window-seconds');
    const options = { max, windowMs: (windowSeconds > 0 ? windowSeconds : 60) * 1000 };
    const settings = `${options.max}/${options.windowMs}`;
    if (settings !== limiterSettings) {
      // Re-read rather than freeze at boot, so an operator narrowing the budget on Admin ->
      // Configuration does not need a restart — ngdpbase's `configure()` seam, same reasoning.
      // Existing buckets are kept: tightening the limiter must not hand a live flood a clean slate.
      limiterSettings = settings;
      authLimiter ? authLimiter.configure(options) : (authLimiter = new SimpleRateLimiter(options));
      if (!authLimiter.enabled) {
        appLog.warn(`yourphr.auth.rate-limit.max-requests is ${max} — the per-IP throttle on the sign-in routes is OFF on this instance`);
      }
    }
    return authLimiter;
  };


  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const engine = await engineReady;

      // The auth routes answer before anything else can slow them down, so the budget is spent on
      // the REQUEST, not on the failure. The failure throttle inside SessionsManager asks a
      // different question — is somebody guessing this account — and both still apply.
      const withinRateLimit = (): boolean => {
        const limiter = limiterFor(engine);
        if (!limiter?.enabled) return true;
        const proxies = engine.has('configuration') ? engine.managers.configuration.getStringList('yourphr.auth.trusted-proxies') : [];
        const xff = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : undefined;
        const result = limiter.consume(clientIp(req.socket.remoteAddress ?? '', xff, proxies));
        if (result.allowed) return true;
        res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
        send(res, 429, {success: false, error: 'too many requests — try again shortly'});
        return false;
      };

      // GET /healthz — liveness/readiness for the orchestrator (yourphr#587). No session, no data:
      // it says the process is up and serving, nothing about who is asking.
      if (url.pathname === '/healthz' && req.method === 'GET') {
        send(res, 200, {ok: true});
        return;
      }

      // The Angular app's boot calls (found by the parity audit, yourphr#591) — Go's shapes exactly.
      if (url.pathname === '/api/version' && req.method === 'GET') {
        // environment_name is what this instance calls itself — '' on a family install, 'demo' on
        // the public demo, which is how a visitor tells them apart. It was hardcoded empty until
        // yourphr#642, so every instance would have called itself the same thing. The FIELD name is
        // Go's wire format, read by the Angular app; the config key follows our own convention.
        send(res, 200, {success: true, data: {
          version: options.version ?? '0.0.0-dev',
          environment_name: engine.has('configuration') ? engine.managers.configuration.getString('yourphr.web.environment-name') : '',
        }});
        return;
      }
      if (url.pathname === '/api/health' && req.method === 'GET') {
        send(res, 200, {success: true, data: {first_run_wizard: false, standby_mode: false}});
        return;
      }
      const legalMatch = url.pathname.match(/^\/api\/legal\/([^/]+)$/);
      if (engine.has('settings') && legalMatch && req.method === 'GET') {
        const document = engine.managers.settings.legalDocument(ApiContext.anonymous(engine), decodeURIComponent(legalMatch[1]!));
        document === undefined ? send(res, 404, {success: false, error: `unknown legal document "${legalMatch[1]}"`}) : send(res, 200, {success: true, data: document});
        return;
      }
      if (url.pathname === '/api/instance/public' && req.method === 'GET') {
        send(res, 200, {success: true, data: engine.has('settings') ? engine.managers.settings.publicInstance(ApiContext.anonymous(engine)) : {}});
        return;
      }
      // Logout clears the HttpOnly cookie — the one thing JavaScript cannot do itself.
      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        res.setHeader('Set-Cookie', sessionCookie('', 0, auth?.secureCookies ?? false));
        send(res, 200, {success: true});
        return;
      }

      // POST /api/auth/signup — self-service registration (yourphr#691), OFF unless an operator
      // turns it on. The Angular route and form have always existed; the server half never did, so
      // the form rendered and 404'd on submit after the person had typed everything.
      //
      // Default closed, and the reason is the shape of the product: a self-hosted PHR reachable
      // from the internet with an open signup form hands an account to whoever arrives first. The
      // first start already creates a bootstrap admin and writes its password to
      // <data>/.admin_bootstrap_password, so nobody needs signup to get INTO a new instance — it
      // exists for a household whose members should enrol themselves.
      //
      // Rate limited exactly like signin: it is unauthenticated, it writes, and it reveals whether
      // a username is taken.
      if (auth && url.pathname === '/api/auth/signup' && req.method === 'POST') {
        if (!withinRateLimit()) return;
        if (!engine.managers.configuration.getBool('yourphr.auth.signup.enabled')) {
          // 403, not 404: the route exists and the instance has decided against it. Pretending it
          // is absent would send an operator hunting for a missing build rather than a setting.
          send(res, 403, {success: false, error: 'self-service signup is closed on this instance'});
          return;
        }
        const body = await readJsonBody(req);
        const username = typeof body?.['username'] === 'string' ? (body['username'] as string).trim() : '';
        const password = typeof body?.['password'] === 'string' ? (body['password'] as string) : '';
        // A system principal: nobody is signed in, so there is no actor to check `user-create`
        // against. The gate above IS the authorisation, which is why it comes first.
        await engine.managers.users.createUser(ApiContext.system('signup', username, engine), username, password);
        send(res, 201, {success: true, data: username});
        return;
      }

      // POST /api/auth/signin — the only route that exists without a session. Throttling, the
      // generic error and the trusted-proxy rule all live in AuthStore; this is just transport.
      if (auth && url.pathname === '/api/auth/signin' && req.method === 'POST') {
        if (!withinRateLimit()) return;
        const body = await readJsonBody(req);
        const username = typeof body?.['username'] === 'string' ? (body['username'] as string) : '';
        const password = typeof body?.['password'] === 'string' ? (body['password'] as string) : '';
        const result = await engine.managers.sessions.signIn(username, { password }, {
          remoteAddr: req.socket.remoteAddress ?? '',
          xff: typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : undefined,
        });
        if (!result.ok) {
          send(res, 401, {success: false, error: result.error});
          return;
        }
        // The Go envelope, exactly: data IS the token string — the Angular auth service does
        // setAuthToken(resp.data). Wrapping it in an object signed the user straight back out
        // (found by the parity audit, yourphr#591).
        res.setHeader('Set-Cookie', sessionCookie(result.token, auth.cookieMaxAgeSeconds ?? 12 * 60 * 60, auth.secureCookies ?? false));
        send(res, 200, {success: true, data: result.token});
        return;
      }

      // POST /api/auth/demo-signin (yourphr#643) — the public demo's one-click entrance. The caller
      // posts NOTHING: the manager verifies the configured credential against the stored hash and
      // mints the session, so a visitor never holds a password. 403 on an instance that did not opt
      // in, which is every ordinary install, so this route is inert rather than absent.
      if (auth && engine.has('demo') && url.pathname === '/api/auth/demo-signin' && req.method === 'POST') {
        // The one that needs it most: anonymous, no body, and a bcrypt verify per call. It spends
        // no failure-throttle budget by design (a restart loop would lock the demo out of its own
        // front door), so this limiter is the only thing bounding it.
        if (!withinRateLimit()) return;
        const result = await engine.managers.demo.signIn();
        if (!result.ok) {
          send(res, 403, {success: false, error: result.error});
          return;
        }
        // Go's envelope: data IS the token string (the parity lesson from yourphr#591).
        res.setHeader('Set-Cookie', sessionCookie(result.token, auth.cookieMaxAgeSeconds ?? 12 * 60 * 60, auth.secureCookies ?? false));
        send(res, 200, {success: true, data: result.token});
        return;
      }

      // POST /api/auth/demo-signin/admin (yourphr#644) — the read-only admin tour. Same mechanics
      // as the patient entrance and gated on demo.admin.enabled as well, so it is inert on a demo
      // that only offers the patient tour.
      if (auth && engine.has('demo') && url.pathname === '/api/auth/demo-signin/admin' && req.method === 'POST') {
        if (!withinRateLimit()) return;
        const result = await engine.managers.demo.signInAsAdmin();
        if (!result.ok) {
          send(res, 403, {success: false, error: result.error});
          return;
        }
        res.setHeader('Set-Cookie', sessionCookie(result.token, auth.cookieMaxAgeSeconds ?? 12 * 60 * 60, auth.secureCookies ?? false));
        send(res, 200, {success: true, data: result.token});
        return;
      }

      // The session gate: with auth wired, every /api/secure/* request proves who it is, and is
      // served by THAT user's repository. 401 for no token, a tampered token, an expired one, or a
      // token whose generation the account has moved past (a password change ends it mid-flight).
      let sessionUser = legacyUser;
      let ctx = ApiContext.from({username: legacyUser, role: 'user'}, engine);
      /** yourphr#695: this request was authenticated by an agent token rather than a session. */
      let agentRequest = false;
      if (auth && url.pathname.startsWith('/api/secure/')) {
        // Bearer first (API clients, the harnesses), else the HttpOnly cookie (the browser).
        const header = req.headers['authorization'] ?? '';
        const bearer = typeof header === 'string' && header.toLowerCase().startsWith('bearer ') ? header.slice(7) : '';
        const token = bearer !== '' ? bearer : readCookie(req.headers['cookie'], SESSION_COOKIE);
        const session = token ? await engine.managers.sessions.verify(token) : ({ok: false} as const);
        if (!session.ok) {
          // Not a session — it may be an AGENT TOKEN (yourphr#695), which is an alternative to a
          // session rather than a replacement for one. Tried second and never for a cookie: an
          // agent presents a Bearer header, and accepting one from a cookie would make it usable
          // by a browser page, which is exactly what a delegated read credential must not be.
          const agent = bearer !== '' && engine.has('agentTokens')
            ? await engine.managers.agentTokens.verify(bearer)
            : undefined;
          if (!agent) {
            send(res, 401, {success: false, error: 'unauthorized'});
            return;
          }
          sessionUser = agent.owner;
          ctx = ApiContext.agent(agent.owner, {id: agent.id, name: agent.name, scopes: agent.scopes}, engine);
          agentRequest = true;
        } else {
        if (session.renewed) {
          res.setHeader('X-Renewed-Token', session.renewed);
          res.setHeader('Set-Cookie', sessionCookie(session.renewed, auth.cookieMaxAgeSeconds ?? 12 * 60 * 60, auth.secureCookies ?? false));
        }
        sessionUser = session.principal.username;
        // Who is asking, for every manager call this request makes (yourphr#608).
        ctx = ApiContext.from(session.principal, engine);
        }
        // The read-only demo admin (yourphr#644), enforced here rather than route by route:
        // DEFAULT-DENY by method, so a route added next year is refused by inheritance instead of
        // by somebody remembering to guard it. Inert for every other caller and every other
        // instance — see DemoManager.refuseUnlessRead for what it refuses and why.
        if (engine.has('demo')) engine.managers.demo.refuseUnlessRead(ctx, req.method ?? 'GET', url.pathname);
      }

      // The agent-token gate (yourphr#695) — DEFAULT DENY, and the reason the first cut is
      // read-only without needing a flag to enforce it.
      //
      // An agent may reach exactly one kind of request: a GET whose path has an ACCESS CATEGORY,
      // and only a category its token names. Everything else is refused here, at the edge, before
      // any manager sees the request:
      //
      //   - every POST/PUT/DELETE, because no write path has a category — so a route added next
      //     year is refused by inheritance rather than by somebody remembering to guard it;
      //   - every unlisted GET, including the token-management routes themselves, so a token can
      //     never mint, renew or revoke anything (the manager refuses that too — this is the
      //     outer of the two locks);
      //   - a listed GET outside the token's scopes.
      //
      // Refusing the UNLISTED read is the deliberate half. A read with no category is one the
      // access log cannot record, and an agent's unrecordable read is precisely what yourphr#614
      // says must not happen: "an unaudited disclosure did not happen".
      if (auth && agentRequest && url.pathname.startsWith('/api/secure/')) {
        const category = req.method === 'GET' ? accessCategoryFor(url.pathname) : undefined;
        if (!category) {
          send(res, 403, {success: false, error: 'an agent token may only read your records, and only what it was given'});
          return;
        }
        if (!ctx.canRead(category)) {
          send(res, 403, {success: false, error: `this token was not given access to ${category}`});
          return;
        }
      }

      // The access log (yourphr#596, #614): a listed GET by a signed-in user is an access of their
      // record, kept by the Audit manager BEFORE the read is served — one that cannot be kept fails here.
      // An agent's read is recorded under the TOKEN's name (ApiContext.actor), so the log says
      // "Claude Desktop" rather than attributing it to a patient who was not at the keyboard.
      if (auth && engine.has('audit') && req.method === 'GET') {
        const category = accessCategoryFor(url.pathname);
        if (category) await engine.managers.audit.record(ctx, category);
      }

      // --- the account page (yourphr#596) ---
      // The route composes doors; no manager reaches through another. Consent is the users
      // manager's fact, the disconnect that follows a revocation is the sources manager's rule
      // (yourphr#619), and the shape both render into is Go's, because the page reads it.
      if (auth && url.pathname.startsWith('/api/secure/account/')) {
        const users = engine.managers.users;
        if (engine.has('audit') && url.pathname === '/api/secure/account/access-log' && req.method === 'GET') {
          send(res, 200, {success: true, data: await engine.managers.audit.list(ctx)});
          return;
        }
        // --- agent tokens (yourphr#695) ---
        // On the account page because that is where revocation already lives: the list a patient
        // reads to answer "what is out there, and when does it stop" is the same list they revoke
        // from. Every one of these needs a human session — AgentTokensManager.requireHuman refuses
        // an agent token, and the edge gate above has already refused it for being an unlisted path.
        if (engine.has('agentTokens') && url.pathname === '/api/secure/account/agent-tokens') {
          const tokens = engine.managers.agentTokens;
          if (req.method === 'GET') {
            const policy = tokens.settings;
            send(res, 200, {success: true, data: {
              tokens: await tokens.listForOwner(ctx),
              // The minting screen's vocabulary, so the patient is told plainly what a token lets
              // an agent read — yourphr#657's argument only holds if that is stated.
              available_scopes: tokens.availableScopes,
              max_ttl_hours: policy.maxTtlHours,
              default_ttl_hours: policy.defaultTtlHours,
              max_per_user: policy.maxPerUser,
              renewable: policy.renewable,
              renew_window_hours: policy.renewWindowHours,
              read_only: policy.readOnly,
            }});
            return;
          }
          if (req.method === 'POST') {
            if (engine.has('demo')) engine.managers.demo.refuseWrite(ctx, 'minting an agent token');
            const body = (await readJsonBody(req)) ?? {};
            const minted = await tokens.mint(
              ctx,
              String(body['name'] ?? ''),
              Array.isArray(body['scopes']) ? (body['scopes'] as string[]) : [],
              body['ttl_hours'] === undefined ? undefined : Number(body['ttl_hours']),
            );
            // The cleartext rides back ONCE and is never stored; the screen must say so, because
            // there is no second chance to copy it.
            send(res, 200, {success: true, data: {token: minted.token, record: minted.record}});
            return;
          }
        }
        const agentTokenAction = /^\/api\/secure\/account\/agent-tokens\/([^/]+)\/(renew|revoke)$/.exec(url.pathname);
        if (engine.has('agentTokens') && agentTokenAction && req.method === 'POST') {
          if (engine.has('demo')) engine.managers.demo.refuseWrite(ctx, 'changing an agent token');
          const tokens = engine.managers.agentTokens;
          const id = decodeURIComponent(agentTokenAction[1] as string);
          if (agentTokenAction[2] === 'renew') {
            const renewed = await tokens.renew(ctx, id);
            send(res, 200, {success: true, data: {token: renewed.token, record: renewed.record}});
            return;
          }
          send(res, 200, {success: true, data: {revoked: await tokens.revoke(ctx, id)}});
          return;
        }
        if (url.pathname === '/api/secure/account/legal-consent' && req.method === 'GET') {
          send(res, 200, {success: true, data: consentStatus(await users.consentAcceptedAt(ctx))});
          return;
        }
        if (url.pathname === '/api/secure/account/legal-consent/grant' && req.method === 'POST') {
          const now = consentNow();
          await users.setConsent(ctx, now);
          send(res, 200, {success: true, data: consentStatus(now)});
          return;
        }
        if (url.pathname === '/api/secure/account/legal-consent/revoke' && req.method === 'POST') {
          await users.setConsent(ctx, '');
          // Go's rule: revoking the consent disconnects the sources that required it.
          const disconnected = engine.has('sources') ? await engine.managers.sources.disconnectConsentRequired(ctx) : 0;
          send(res, 200, {success: true, data: {...consentStatus(''), medicare_sources_disconnected: disconnected}});
          return;
        }
        if (url.pathname === '/api/secure/account/password' && req.method === 'POST') {
          // The shared demo account may not do this (yourphr#514): the configured password would
          // stop matching the stored hash, and demo sign-in — the only advertised way in — would
          // refuse every visitor until an operator restarted the instance.
          //
          // Guarded HERE rather than in UsersManager, unlike the connect refusal: accounts are a
          // framework resource and demo mode is an app concept, so the framework must not learn
          // about it. This route table is app code, and it is the only caller.
          if (engine.has('demo')) engine.managers.demo.refuseWrite(ctx, 'changing the password');
          const body = await readJsonBody(req);
          const current = typeof body?.['current_password'] === 'string' ? (body['current_password'] as string) : '';
          const next = typeof body?.['new_password'] === 'string' ? (body['new_password'] as string) : '';
          if (!body || current === '' || next === '') {
            send(res, 400, {success: false, error: 'invalid request'});
            return;
          }
          // 401 wrong current, 400 policy — as ApiError, into the one error boundary. The
          // generation bump ends every session, so a fresh token is issued for this one.
          await users.changePassword(ctx, current, next);
          const token = await engine.managers.sessions.issueFor(ctx.username);
          // The generation bump ended this session too; a fresh one rides back on the cookie, as Go does.
          if (token) {
            res.setHeader('Set-Cookie', sessionCookie(token, auth.cookieMaxAgeSeconds ?? 12 * 60 * 60, auth.secureCookies ?? false));
            send(res, 200, {success: true, data: token});
          } else {
            send(res, 200, {success: true});
          }
          return;
        }
        if (url.pathname === '/api/secure/account/sign-out-everywhere' && req.method === 'POST') {
          // Recoverable, unlike the other two, but it is still one visitor ending every other
          // visitor's session mid-read (yourphr#514).
          if (engine.has('demo')) engine.managers.demo.refuseWrite(ctx, 'signing out everywhere');
          await engine.managers.sessions.revokeAll(ctx);
          res.setHeader('Set-Cookie', sessionCookie('', 0, auth.secureCookies ?? false));
          send(res, 200, {success: true});
          return;
        }
        if (url.pathname === '/api/secure/account/me' && req.method === 'DELETE') {
          // Deleting the shared account leaves the one-click entrance with nothing to sign in to,
          // for everyone, until an operator rebuilds it (yourphr#514).
          if (engine.has('demo')) engine.managers.demo.refuseWrite(ctx, 'deleting the account');
          // Everything the account owns, then the account: its sources, every record (the Records
          // manager removes rows, index and history and drops the handle), the access log, then
          // the account itself (consent goes with it). Order matters — each door is asked in turn.
          if (engine.has('sources')) await engine.managers.sources.removeAll(ctx);
          await engine.managers.records.removeAll(ctx);
          if (engine.has('audit')) await engine.managers.audit.removeForUser(ctx);
          await users.deleteSelf(ctx);
          res.setHeader('Set-Cookie', sessionCookie('', 0, auth.secureCookies ?? false));
          send(res, 200, {success: true});
          return;
        }
      }

      // Who am I — the call the Angular app makes on every route to decide it is signed in, and
      // where it learns the role. Fields the spike does not store (full_name, email, picture) are
      // empty, not invented; id is the username because that is the spike's account identity.
      if (auth && url.pathname === '/api/secure/account/me' && req.method === 'GET') {
        send(res, 200, {success: true, data: {
          id: sessionUser, username: sessionUser, full_name: '', email: '', picture: '',
          role: ctx.role,
          // demo_account tells the UI to render the connect affordances as disabled rather than
          // offering an action the server will refuse (yourphr#496). Derived from demo mode plus
          // the configured name, so the demo account's NAME is never published.
          demo_account: engine.has('demo') && engine.managers.demo.isDemoSession(ctx),
          last_login: null, login_count: 0,
        }});
        return;
      }

      // The two calls every page makes (yourphr#593): who runs this instance, and the job indicator.
      if (engine.has('settings') && url.pathname === '/api/secure/instance' && req.method === 'GET') {
        send(res, 200, {success: true, data: engine.managers.settings.instanceForUser(ctx)});
        return;
      }
      if (engine.has('jobs') && url.pathname === '/api/secure/jobs' && req.method === 'GET') {
        const limitParam = Number(url.searchParams.get('limit') ?? 0);
        const pageParam = Number(url.searchParams.get('page') ?? 0);
        if (!Number.isInteger(limitParam) || limitParam < 0 || !Number.isInteger(pageParam) || pageParam < 0) {
          send(res, 400, {success: false, error: 'limit and page must be non-negative integers'});
          return;
        }
        const query = {
          limit: limitParam === 0 ? 20 : limitParam, // Go's ResourceListPageSize when unset or 0
          page: pageParam,
          status: url.searchParams.get('status') ?? undefined,
          jobType: url.searchParams.get('jobType') ?? undefined,
        };
        send(res, 200, {success: true, data: await engine.managers.jobs.forUser(ctx, query)});
        return;
      }

      // --- the Users page (yourphr#604): the admin's list, create, and password reset ---
      if (url.pathname === '/api/secure/users' || /^\/api\/secure\/users\/[^/]+\/password$/.test(url.pathname)) {
        // Go answers a non-admin here with 401 "Unauthorized"; the page treats both as "not for you".
        // The permission is the one the Users manager requires behind this wall (yourphr#620), so
        // the outer gate and the real one cannot drift apart.
        if (!ctx.can('user-read')) {
          send(res, 401, {success: false, error: 'Unauthorized'});
          return;
        }
        if (url.pathname === '/api/secure/users' && req.method === 'GET') {
          send(res, 200, {success: true, data: (await engine.managers.users.listUsers(ctx)).map((u) => ({id: u.username, username: u.username, role: u.role, created_at: u.created_at, login_count: 0}))});
          return;
        }
        if (url.pathname === '/api/secure/users' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const username = typeof body?.['username'] === 'string' ? (body['username'] as string).trim() : '';
          const password = typeof body?.['password'] === 'string' ? (body['password'] as string) : '';
          // Any role name this instance defines (yourphr#648) — the manager refuses one it does not,
          // naming the ones it does. Coercing an unknown name to 'user' here would silently give the
          // operator a different account from the one they asked for.
          const role = typeof body?.['role'] === 'string' && (body['role'] as string).trim() !== '' ? (body['role'] as string).trim() : 'user';
          if (!body || username === '' || password === '') {
            send(res, 400, {success: false, error: 'username and password are required'});
            return;
          }
          await engine.managers.users.createUser(ctx, username, password, role); // ApiError (400) -> the error boundary
          // Go echoes the user it made. This stack stores no full_name or email — they are absent,
          // not invented; id is the username, as /account/me already says.
          send(res, 200, {success: true, data: {id: username, username, role}});
          return;
        }
        const resetMatch = url.pathname.match(/^\/api\/secure\/users\/([^/]+)\/password$/);
        if (resetMatch && req.method === 'POST') {
          const username = decodeURIComponent(resetMatch[1]!);
          send(res, 200, {success: true, data: {username, password: await engine.managers.users.adminResetPassword(ctx, username)}});
          return;
        }
      }

      // --- the provider catalog (yourphr#603): admin curates, members connect ---
      if (engine.has('catalog') && url.pathname.startsWith('/api/secure/provider-catalog')) {
        const cat = engine.managers.catalog;
        const fail = (err: unknown): void => {
          const e = err as Error & { status?: number; extra?: Record<string, unknown> };
          send(res, e.status ?? 400, {success: false, error: e.message, ...(e.extra ?? {})});
        };
        if (url.pathname === '/api/secure/provider-catalog/sandbox' && req.method === 'GET') {
          send(res, 200, {success: true, data: await cat.sandbox(ctx)});
          return;
        }
        const connectMatch = url.pathname.match(/^\/api\/secure\/provider-catalog\/([^/]+)\/(authorize|connect)$/);
        if (connectMatch && req.method === 'POST') {
          const body = (await readJsonBody(req)) ?? {};
          try {
            if (connectMatch[2] === 'authorize') {
              send(res, 200, {success: true, ...(await cat.authorize(ctx, decodeURIComponent(connectMatch[1]!), body))});
            } else {
              const r = await cat.connect(ctx, decodeURIComponent(connectMatch[1]!), body);
              send(res, 200, {success: true, source: r.source, data: r.data});
            }
          } catch (err) {
            fail(err);
          }
          return;
        }
        if (url.pathname !== '/api/secure/provider-catalog/connectable') {
          // Everything else is the admin's: the catalog is instance configuration.
          if (!ctx.can('admin-system')) { send(res, 403, {success: false, error: 'admin role required to manage the provider catalog'}); return; }
          if (url.pathname === '/api/secure/provider-catalog' && req.method === 'GET') {
            send(res, 200, {success: true, data: await cat.list(ctx)});
            return;
          }
          if (url.pathname === '/api/secure/provider-catalog' && req.method === 'POST') {
            const body = await readJsonBody(req);
            if (!body) { send(res, 400, {success: false, error: 'invalid request'}); return; }
            try { send(res, 200, {success: true, data: await cat.create(ctx, body)}); } catch (err) { fail(err); }
            return;
          }
          const idMatch = url.pathname.match(/^\/api\/secure\/provider-catalog\/([^/]+)$/);
          if (idMatch) {
            const id = decodeURIComponent(idMatch[1]!);
            if (req.method === 'GET') {
              const entry = await cat.get(ctx, id);
              entry === undefined ? send(res, 404, {success: false, error: 'no such catalog entry'}) : send(res, 200, {success: true, data: entry});
              return;
            }
            if (req.method === 'PUT') {
              const body = await readJsonBody(req);
              if (!body) { send(res, 400, {success: false, error: 'invalid request'}); return; }
              try {
                const entry = await cat.update(ctx, id, body);
                entry === undefined ? send(res, 404, {success: false, error: 'no such catalog entry'}) : send(res, 200, {success: true, data: entry});
              } catch (err) { fail(err); }
              return;
            }
            if (req.method === 'DELETE') {
              send(res, 200, {success: true, data: {deleted: (await cat.remove(ctx, id)) ? 1 : 0}});
              return;
            }
          }
        }
      }

      // The SMART relay card (yourphr#602) — before the per-source routes, whose :id would swallow it.
      // Real effective settings with provenance (yourphr#700); the secret's value is never echoed.
      if (url.pathname === '/api/secure/source/relay-config' && req.method === 'GET') {
        const relay = engine.has('catalog') ? engine.managers.catalog.relayResolved() : undefined;
        send(res, 200, {success: true, data: relay ?? {callback_url: '', configured: false, ready: false, public_url: '', poll_url: '', secret: ''}});
        return;
      }

      // --- the Sources page (yourphr#594) ---
      if (engine.has('catalog') && url.pathname === '/api/secure/provider-catalog/connectable' && req.method === 'GET') {
        send(res, 200, {success: true, data: await engine.managers.catalog.connectable(ctx)});
        return;
      }
      if (engine.has('sources')) {
        const src = engine.managers.sources;
        if (url.pathname === '/api/secure/source' && req.method === 'GET') {
          send(res, 200, {success: true, data: await src.listShaped(ctx)});
          return;
        }
        if (src.events && url.pathname === '/api/secure/events/stream' && req.method === 'GET') {
          // Server-sent events, Go's framing (event:message, JSON data). A keep-alive every 15s so
          // an idle connection survives a proxy; the subscription ends when the client goes away.
          res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'});
          res.write(sseFrame({event_type: 'keep_alive'}));
          const unsubscribe = src.events.subscribe(sessionUser, (event) => res.write(sseFrame(event)));
          const keepAlive = setInterval(() => res.write(sseFrame({event_type: 'keep_alive'})), 15_000);
          const close = (): void => { clearInterval(keepAlive); unsubscribe(); res.end(); };
          req.on('close', close);
          res.on('error', close);
          return;
        }
        // Both BEFORE the /source/:id match below, which would otherwise read "manual" and
        // "cda-converter" as source ids — how the upload 404'd from v3.0.0 to v3.4.0 (yourphr#736).
        if (url.pathname === '/api/secure/source/cda-converter/status' && req.method === 'GET') {
          send(res, 200, {success: true, data: src.converterStatus(ctx, 'ccda')});
          return;
        }
        if (url.pathname === '/api/secure/source/manual' && req.method === 'POST') {
          const maxBytes = engine.has('configuration') ? engine.managers.configuration.getInt('yourphr.sources.upload.max-bytes') : 100 * 1024 * 1024;
          const upload = await readUpload(req, maxBytes > 0 ? maxBytes : 100 * 1024 * 1024);
          if (!('file' in upload)) {
            send(res, upload.status, {success: false, error: upload.error});
            return;
          }
          const result = await src.importUpload(ctx, upload.file); // ApiError -> the error boundary
          send(res, 200, {success: true, data: result.data, source: result.source});
          return;
        }
        const sourceMatch = url.pathname.match(/^\/api\/secure\/source\/([^/]+)(?:\/(summary|sync|disconnect|remove-data|export))?$/);
        if (sourceMatch) {
          const id = decodeURIComponent(sourceMatch[1]!);
          const action = sourceMatch[2];
          const notFound = (): void => send(res, 404, {success: false, error: 'source not found'});
          if (!action && req.method === 'GET') {
            const source = await src.getShaped(ctx, id);
            source === undefined ? notFound() : send(res, 200, {success: true, data: source});
            return;
          }
          if (!action && req.method === 'DELETE') {
            const rows = await src.remove(ctx, id);
            rows === undefined ? notFound() : send(res, 200, {success: true, data: rows});
            return;
          }
          if (action === 'summary' && req.method === 'GET') {
            const summary = await src.summary(ctx, id);
            summary === undefined ? notFound() : send(res, 200, {success: true, data: summary});
            return;
          }
          if (action === 'sync' && req.method === 'POST') {
            let result: { source: unknown; data: unknown } | undefined;
            try {
              result = await src.syncNow(ctx, id);
            } catch (err) {
              send(res, 500, {success: false, error: `record sync failed: ${(err as Error).message}`});
              return;
            }
            result === undefined ? notFound() : send(res, 200, {success: true, source: result.source, data: result.data});
            return;
          }
          if (action === 'disconnect' && req.method === 'POST') {
            (await src.disconnect(ctx, id)) ? send(res, 200, {success: true, data: {disconnected: true}}) : notFound();
            return;
          }
          if (action === 'remove-data' && req.method === 'POST') {
            const rows = await src.removeData(ctx, id);
            rows === undefined ? notFound() : send(res, 200, {success: true, data: rows});
            return;
          }
          if (action === 'export' && req.method === 'GET') {
            const exported = await src.exportBundle(ctx, id);
            if (exported === undefined) {
              notFound();
              return;
            }
            const body = JSON.stringify(exported.bundle, null, 2);
            res.writeHead(200, {
              'Content-Type': 'application/fhir+json',
              'Content-Disposition': `attachment; filename=${exported.filename}`,
              'Content-Length': Buffer.byteLength(body),
            });
            res.end(body);
            return;
          }
        }
      }
      if (url.pathname === '/api/secure/summary/ips' && req.method === 'GET') {
        send(res, 200, {success: true, data: (await engine.managers.records.ips(ctx)).bundle});
        return;
      }
      const provMatch = url.pathname.match(/^\/api\/secure\/resource\/provenance\/([^/]+)\/([^/]+)$/);
      if (provMatch && req.method === 'GET') {
        const p = await engine.managers.records.provenance(ctx, provMatch[1]!, provMatch[2]!);
        if (!p) {
          send(res, 404, {success: false, error: 'not found'});
          return;
        }
        send(res, 200, {success: true, data: p});
        return;
      }
      // The glossary (yourphr#640): what a coded value actually means, in plain language. Go
      // serves this unauthenticated; here it sits under /api/secure because it can trigger an
      // outbound request, and an unauthenticated endpoint that does that is an amplification
      // surface for no benefit — a code is not PHI, so nothing is lost by requiring a session.
      if (engine.has('glossary') && url.pathname === '/api/secure/glossary/code' && req.method === 'GET') {
        const glossary = engine.managers.glossary;
        const explanation = await glossary.explain(ctx, url.searchParams.get('code') ?? '', url.searchParams.get('code_system') ?? '');
        if (explanation) {
          send(res, 200, {success: true, data: explanation});
          return;
        }
        // Not an error: neither the cache nor the source describes every code, and the screen
        // must be able to say "no explanation available" rather than render an empty box.
        send(res, 200, {success: false, error: glossary.unavailable() || 'no explanation is available for this code'});
        return;
      }

      if (url.pathname === '/api/secure/medications/reconciled' && req.method === 'GET') {
        send(res, 200, {success: true, data: await engine.managers.records.medications(ctx)});
        return;
      }

      // --- the dashboard and record pages (yourphr#595) ---
      {
        const records = engine.managers.records;
        // Find anything by words (yourphr#599): the dashboard's search box.
        if ((url.pathname === '/api/secure/resources/search' || url.pathname === '/api/secure/search') && req.method === 'GET') {
          const limit = Number(url.searchParams.get('limit') ?? 20);
          const page = Number(url.searchParams.get('page') ?? 0);
          const items = await records.searchText(ctx, url.searchParams.get('q') ?? '', { limit: Number.isInteger(limit) ? limit : 20, page: Number.isInteger(page) ? page : 0 });
          const fallback = options.sourceId ?? 'spike';
          send(res, 200, {success: true, data: items.map((i) => (i.source_id === '' ? {...i, source_id: fallback} : i))});
          return;
        }
        if (url.pathname === '/api/secure/resources/recent' && req.method === 'GET') {
          const limit = Number(url.searchParams.get('limit') ?? 5);
          send(res, 200, {success: true, data: await records.recent(ctx, Number.isInteger(limit) && limit > 0 ? limit : 5)});
          return;
        }
        if (url.pathname === '/api/secure/conditions/reconciled' && req.method === 'GET') {
          send(res, 200, {success: true, data: await records.conditions(ctx)});
          return;
        }
        if (url.pathname === '/api/secure/allergies/classified' && req.method === 'GET') {
          send(res, 200, {success: true, data: await records.allergies(ctx)});
          return;
        }
        if (url.pathname === '/api/secure/immunizations/classified' && req.method === 'GET') {
          send(res, 200, {success: true, data: await records.immunizations(ctx)});
          return;
        }
        if (url.pathname === '/api/secure/query' && req.method === 'POST') {
          const body = await readJsonBody(req);
          if (!body || typeof body['from'] !== 'string') {
            send(res, 400, {success: false, error: 'query must name a resource type in "from"'});
            return;
          }
          try {
            send(res, 200, {success: true, data: await records.query(ctx, body as never)});
          } catch (err) {
            send(res, err instanceof ApiError ? err.status : 400, {success: false, error: (err as Error).message});
          }
          return;
        }
      }
      // Favourites (yourphr#616): an annotation on a record, through the Records door.
      if (url.pathname === '/api/secure/user/favorites') {
        const records = engine.managers.records;
        if (req.method === 'GET') {
          send(res, 200, {success: true, data: await records.favorites(ctx, url.searchParams.get('resource_type') ?? '')});
          return;
        }
        if (req.method === 'POST' || req.method === 'DELETE') {
          const body = await readJsonBody(req);
          const str = (k: string): string => (typeof body?.[k] === 'string' ? (body[k] as string) : '');
          const fav = {source_id: str('source_id'), resource_type: str('resource_type'), resource_id: str('resource_id')};
          if (req.method === 'POST') send(res, 200, {success: true, data: await records.addFavorite(ctx, fav)});
          else send(res, 200, {success: true, data: {removed: await records.removeFavorite(ctx, fav)}});
          return;
        }
      }
      if (url.pathname.startsWith('/api/secure/admin/')) {
        // Operator-only. The gate names the least this subtree needs (yourphr#620) — reading an
        // admin screen — and each manager behind it requires its own; a caller who may read but not
        // change is refused at the door that changes, not here. It is a permission check, not a
        // route secret: a caller without it gets 403 with no detail about what lives here.
        if (!ctx.can('admin-read')) {
          send(res, 403, {success: false, error: 'admin role required'});
          return;
        }
        // The configuration and instance cards (yourphr#602, #618): the settings manager holds the
        // policy and throws ApiError — 400 unknown/invalid, 409 env-pinned — into the error boundary.
        if (engine.has('settings')) {
          const settings = engine.managers.settings;
          if (url.pathname === '/api/secure/admin/config' && req.method === 'GET') {
            send(res, 200, {success: true, data: settings.configSnapshot(ctx)});
            return;
          }
          const reveal = url.pathname.match(/^\/api\/secure\/admin\/config\/reveal\/([^/]+)$/);
          if (reveal && req.method === 'GET') {
            const revealed = settings.configReveal(ctx, decodeURIComponent(reveal[1]!));
            revealed === undefined ? send(res, 404, {success: false, error: 'unknown configuration key'}) : send(res, 200, {success: true, data: revealed});
            return;
          }
          if (url.pathname === '/api/secure/admin/config' && req.method === 'PUT') {
            const body = await readJsonBody(req);
            const key = typeof body?.['key'] === 'string' ? (body['key'] as string).trim().toLowerCase() : '';
            if (!body || key === '' || !('value' in body)) {
              send(res, 400, {success: false, error: 'invalid request'});
              return;
            }
            settings.configSet(ctx, key, body['value']);
            send(res, 200, {success: true, data: {key}});
            return;
          }
          const resetKey = url.pathname.match(/^\/api\/secure\/admin\/config\/([^/]+)$/);
          if (resetKey && req.method === 'DELETE') {
            const key = decodeURIComponent(resetKey[1]!);
            send(res, 200, {success: true, data: {key, cleared: settings.configReset(ctx, key.toLowerCase())}});
            return;
          }
          if (url.pathname === '/api/secure/admin/instance' && req.method === 'GET') {
            send(res, 200, {success: true, data: settings.instanceSettings(ctx)});
            return;
          }
          if (url.pathname === '/api/secure/admin/instance' && req.method === 'PUT') {
            const body = await readJsonBody(req);
            if (!body) {
              send(res, 400, {success: false, error: 'invalid request'});
              return;
            }
            const str = (k: string): string => (typeof body[k] === 'string' ? (body[k] as string) : '');
            send(res, 200, {success: true, data: settings.setInstanceSettings(ctx, {name: str('name'), contact_email: str('contact_email'), contact_url: str('contact_url')})});
            return;
          }
        }
        if (engine.has('sources') && url.pathname === '/api/secure/admin/metrics' && req.method === 'GET') {
          send(res, 200, {success: true, data: await engine.managers.sources.adminMetrics(ctx)});
          return;
        }
        const backups = engine.has('backups') ? engine.managers.backups : undefined;
        // Go's DatabaseInfoResponse over this stack's two files — a view composed from the doors,
        // each of which answers for its own storage (yourphr#619). No manager reads another's file.
        if (url.pathname === '/api/secure/admin/database' && req.method === 'GET') {
          const app = engine.managers.database.storage(ctx);
          const phi = engine.managers.records.storage(ctx);
          send(res, 200, {success: true, data: {
            location: [app.location, phi.location].join(' + '),
            encryption_enabled: engine.has('settings') && engine.managers.configuration.getString('yourphr.database.encryption.key') !== '',
            size_bytes: app.sizeBytes + phi.sizeBytes,
            users: await engine.managers.users.count(ctx),
            sources: engine.has('sources') ? await engine.managers.sources.count() : 0,
            integrity_ok: (await engine.managers.database.integrityOk()) && (await engine.managers.records.integrityOk()),
            backup_destination: backups?.destination() ?? '',
            backups: backups ? (await backups.list(ctx)).map((b) => ({name: b.name, size_bytes: b.sizeBytes, modified: b.modified})) : [],
            schedule: backups?.schedule(),
            backup_health: backups?.health(),
            allowed_backup_roots: [],
            backups_unavailable: backups?.unavailable() ?? 'no backup storage is configured on this instance',
          }});
          return;
        }
        const backupFailed = (err: unknown): void => send(res, (err as ApiError).status ?? 400, {success: false, error: (err as Error).message});
        if (backups && url.pathname === '/api/secure/admin/database/backup' && req.method === 'POST') {
          try {
            const b = await backups.backupNow(ctx);
            send(res, 200, {success: true, data: {filename: b.name, path: b.file, destination: dirname(b.file), size_bytes: b.sizeBytes}});
          } catch (err) {
            backupFailed(err);
          }
          return;
        }
        if (backups && url.pathname === '/api/secure/admin/database/backup/download' && req.method === 'POST') {
          let b: { file: string; name: string; sizeBytes: number };
          try {
            b = await backups.backupNow(ctx);
          } catch (err) {
            backupFailed(err);
            return;
          }
          res.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename=${b.name}`, 'Content-Length': b.sizeBytes});
          createReadStream(b.file).pipe(res);
          return;
        }
        if (backups && url.pathname === '/api/secure/admin/database/schedule' && req.method === 'POST') {
          const body = await readJsonBody(req);
          if (!body) {
            send(res, 400, {success: false, error: 'invalid request'});
            return;
          }
          try {
            send(res, 200, {success: true, data: backups.setSchedule(ctx, body as never)});
          } catch (err) {
            backupFailed(err);
          }
          return;
        }
        if (backups && url.pathname === '/api/secure/admin/database/backup/test' && req.method === 'POST') {
          const body = await readJsonBody(req);
          send(res, 200, {success: true, data: await backups.testDestination(ctx, typeof body?.['destination'] === 'string' ? (body['destination'] as string) : '')});
          return;
        }
        if (backups && url.pathname === '/api/secure/admin/database/browse' && req.method === 'GET') {
          try {
            send(res, 200, {success: true, data: await backups.browse(ctx, url.searchParams.get('path') ?? '')});
          } catch (err) {
            backupFailed(err);
          }
          return;
        }
        if (backups && url.pathname === '/api/secure/admin/database/restore' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const name = typeof body?.['backup_name'] === 'string' ? (body['backup_name'] as string) : '';
          if (!body || name === '') {
            send(res, 400, {success: false, error: 'invalid request'});
            return;
          }
          if (body['confirm'] !== true) {
            send(res, 400, {success: false, error: 'restore must be confirmed'});
            return;
          }
          try {
            send(res, 200, {success: true, data: await backups.stageRestore(ctx, name)});
          } catch (err) {
            backupFailed(err);
          }
          return;
        }
        if (url.pathname === '/api/secure/admin/logs' && req.method === 'GET') {
          send(res, 200, {success: true, data: {level: appLog.currentLevel(), valid_levels: VALID_LEVELS, lines: appLog.recent()}});
          return;
        }
        if (url.pathname === '/api/secure/admin/log-level' && req.method === 'PUT') {
          const body = await readJsonBody(req);
          const level = typeof body?.['level'] === 'string' ? (body['level'] as string) : '';
          try {
            const set = appLog.setLevel(level);
            appLog.info(`${ctx.actor} changed server log level to ${JSON.stringify(set)}`);
            send(res, 200, {success: true, data: {level: set}});
          } catch (err) {
            send(res, 400, {success: false, error: (err as Error).message});
          }
          return;
        }
        if (engine.has('catalog') && url.pathname === '/api/secure/admin/catalog' && req.method === 'GET') {
          send(res, 200, {success: true, data: await engine.managers.catalog.entries(ctx)});
          return;
        }
        if (engine.has('backups') && url.pathname === '/api/secure/admin/backup' && req.method === 'POST') {
          send(res, 200, {success: true, data: await engine.managers.backups.backupNow(ctx)});
          return;
        }
        if (url.pathname === '/api/secure/admin/users' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const username = typeof body?.['username'] === 'string' ? (body['username'] as string) : '';
          const password = typeof body?.['password'] === 'string' ? (body['password'] as string) : '';
          // Both create routes take a role NAME and let the manager refuse an undefined one
          // (yourphr#648). This one used to ignore `role` entirely, which meant an operator could
          // ask for an admin here and silently get a member.
          const role = typeof body?.['role'] === 'string' && (body['role'] as string).trim() !== '' ? (body['role'] as string).trim() : 'user';
          await engine.managers.users.createUser(ctx, username, password, role);
          send(res, 200, {success: true});
          return;
        }
      }

      // The record routes go through the one door (yourphr#609). A record with no source
      // attribution is shown under the legacy `sourceId` the contract harnesses pin.
      const fallbackSource = options.sourceId ?? 'spike';
      const attributed = (row: Record<string, unknown>): Record<string, unknown> => (row['source_id'] === '' ? {...row, source_id: fallbackSource} : row);

      // POST /api/secure/resource/graph/:graphType (yourphr#605) — the medical-history page's encounter graph.
      const graphMatch = url.pathname.match(/^\/api\/secure\/resource\/graph\/([^/]+)$/);
      if (graphMatch && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (!body) {
          send(res, 400, {success: false, error: 'invalid request'});
          return;
        }
        const ids = Array.isArray(body['resource_ids']) ? (body['resource_ids'] as Record<string, unknown>[]) : [];
        const graph = await engine.managers.records.graph(ctx, decodeURIComponent(graphMatch[1]!), ids);
        for (const list of Object.values(graph.results)) {
          for (const row of list) {
            Object.assign(row, attributed(row));
            row['related_resources'] = (row['related_resources'] as Record<string, unknown>[]).map(attributed);
          }
        }
        send(res, 200, {success: true, data: graph});
        return;
      }

      // --- what is waiting for the person to resolve (yourphr#762) ---
      //
      // A record they wrote that could not be fully understood is kept and held out of the chart.
      // This is where they see it and say what it should be. Read from the records themselves —
      // the tag says a record is waiting, its notes say why — so the list cannot fall out of step
      // with what is stored.
      if (url.pathname === '/api/secure/records/review' && req.method === 'GET') {
        send(res, 200, {success: true, data: await engine.managers.records.awaitingReview(ctx)});
        return;
      }
      {
        const confirm = url.pathname.match(/^\/api\/secure\/records\/review\/([^/]+)\/confirm$/);
        if (confirm && req.method === 'POST') {
          // "Yes, that is right as written." Nothing missing is filled in here: confirming an
          // undated record leaves it undated. Supplying the missing piece is an ordinary edit.
          const done = await engine.managers.records.confirmReview(ctx, decodeURIComponent(confirm[1]!));
          send(res, 200, {success: true, data: done});
          return;
        }
      }

      // --- a vital the patient measured at home (yourphr#696; the product's #313) ---
      //
      // "Add record" is a primary call to action in three places in the app, and this is the route
      // its form posted to. Until now there was none, so the form filled in, submitted and 404'd.
      // The Observation is built in src/patient-entry (ported from Go's patient_entry.go) and saved
      // through the account's own `manual` source, so a hand-typed blood pressure is never
      // mistaken for one a hospital asserted.
      if (url.pathname === '/api/secure/resource/patient-entry' && req.method === 'POST') {
        const body = (await readJsonBody(req)) ?? {};
        // Who it is about and who measured it — the account's own person record (yourphr#696).
        const self = await engine.managers.records.selfPatient(ctx);
        let built;
        try {
          built = buildPatientVital(body as PatientEntryRequest, new Date(), {subject: self.reference});
        } catch (err) {
          // The only refusal left: nothing was said at all.
          if (err instanceof PatientEntryError) {
            send(res, 400, {success: false, error: (err as Error).message});
            return;
          }
          throw err;
        }
        const saved = await engine.managers.records.savePatientRecord(ctx, built.observation);
        const manual = await engine.managers.sources.manualSource(ctx);
        send(res, 200, {
          success: true,
          data: {
            resource_type: 'Observation',
            source_resource_id: saved.id,
            source_id: `source-${manual.id}`,
            sort_title: built.sortTitle,
            // What was kept but still needs a person: the form shows this instead of an error,
            // because the record was stored either way.
            needs_review: built.review,
            resource: built.observation,
          },
        });
        return;
      }

      // --- practitioners the patient maintains (yourphr#683) ---
      //
      // The Address book LIST already worked, through /resource/fhir?sourceResourceType=Practitioner.
      // These are the three that did not: a patient could see their care team and not correct it.
      //
      // They write through the account's own `manual` source, never a provider's, so a
      // hand-entered practitioner stays distinguishable from one a portal asserted (yourphr#611).
      {
        const practitionerHistory = url.pathname.match(/^\/api\/secure\/practitioners\/([^/]+)\/history$/);
        if (practitionerHistory && req.method === 'GET') {
          // The encounters that NAME this practitioner. The Angular page reads `relatedResources`
          // at the top level rather than under `data` — its shape, kept rather than corrected,
          // because changing it here would break the page this route exists to fix.
          const related = await engine.managers.records.referencing(ctx, 'Practitioner', decodeURIComponent(practitionerHistory[1]!), 'Encounter');
          send(res, 200, {success: true, relatedResources: related});
          return;
        }
        const practitionerUpdate = url.pathname.match(/^\/api\/secure\/practitioners\/([^/]+)$/);
        if ((url.pathname === '/api/secure/practitioners' && req.method === 'POST') || (practitionerUpdate && req.method === 'PUT')) {
          const body = await readJsonBody(req);
          const resource = (body?.['resource'] ?? null) as Record<string, unknown> | null;
          if (!resource || typeof resource !== 'object') {
            send(res, 400, {success: false, error: 'a resource is required'});
            return;
          }
          if (String(resource['resourceType'] ?? '') !== 'Practitioner') {
            send(res, 400, {success: false, error: 'this route saves a Practitioner'});
            return;
          }
          // On PUT the id in the PATH wins over any id in the body: a request that says one thing
          // in its URL and another in its payload must not get to choose which record it edits.
          if (practitionerUpdate) resource['id'] = decodeURIComponent(practitionerUpdate[1]!);
          const saved = await engine.managers.records.savePatientRecord(ctx, resource as never);
          send(res, saved.outcome === 'created' ? 201 : 200, {success: true, data: saved});
          return;
        }
      }

      // GET /api/secure/resource/fhir?sourceResourceType=Condition[&sourceID=…]
      if (url.pathname === '/api/secure/resource/fhir' && req.method === 'GET') {
        const resourceType = url.searchParams.get('sourceResourceType');
        if (!resourceType) {
          send(res, 400, {success: false, error: 'sourceResourceType is required'});
          return;
        }
        const rows = await engine.managers.records.list(ctx, resourceType, {
          limit: Number(url.searchParams.get('limit') ?? 100000),
          sourceId: url.searchParams.get('sourceID') ?? undefined,
        });
        send(res, 200, {success: true, data: rows.map(attributed)});
        return;
      }

      // GET /api/secure/resource/fhir/:sourceId/:resourceId — the detail page
      const detail = url.pathname.match(/^\/api\/secure\/resource\/fhir\/([^/]+)\/([^/]+)$/);
      if (detail && req.method === 'GET') {
        send(res, 200, {success: true, data: attributed(await engine.managers.records.detail(ctx, detail[2]!))});
        return;
      }

      // GET /api/secure/summary — what the dashboard counts from
      if (url.pathname === '/api/secure/summary' && req.method === 'GET') {
        send(res, 200, {
          success: true,
          data: {
            resource_type_counts: await engine.managers.records.countsByType(ctx),
            sources: engine.has('sources') ? await engine.managers.sources.listShaped(ctx) : [{id: fallbackSource, display: 'spike'}],
            patients: [],
          },
        });
        return;
      }

      if (options.webDir && !url.pathname.startsWith('/api/')) {
        // The Go stack served the app under /web/ and those URLs live on in bookmarks (yourphr#706).
        // Left alone, /web/dashboard hits the SPA fallback and the page's relative asset URLs
        // resolve under /web/ — every script 404s and the patient sees a blank page. Redirect
        // permanently to the same route at the root, keeping any query string.
        if (url.pathname === '/web' || url.pathname.startsWith('/web/')) {
          res.writeHead(301, {Location: (url.pathname.slice('/web'.length) || '/') + url.search});
          res.end();
          return;
        }
        serveStatic(options.webDir, url.pathname, res);
        return;
      }

      send(res, 404, {success: false, error: 'not found'});
    } catch (err) {
      // The one error boundary: a guard's refusal in the envelope, everything else a 500 that
      // reaches the caller rather than vanishing — the lesson of the product repo's #527.
      if (err instanceof ApiError) {
        send(res, err.status, {success: false, error: err.message, ...err.extra});
        return;
      }
      send(res, 500, {success: false, error: (err as Error).message});
    }
  });
}
