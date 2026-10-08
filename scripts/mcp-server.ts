/**
 * YourPHR as an MCP server (yourphr#657) — the patient's own AI client reads their own records.
 *
 *   YOURPHR_URL=http://localhost:8080 YOURPHR_AGENT_TOKEN=yphr_at_… npm run mcp
 *
 * A patient mints an agent token for themselves (yourphr#695), scoped to `Record search`, and hands
 * it to an AI client they already run. The client launches this bridge; the bridge asks YourPHR's
 * own HTTP API the same question the dashboard's search box asks. YourPHR transmits nothing to
 * anyone: the record goes to the client the patient chose, under the patient's own credential.
 *
 * WHY A BRIDGE RATHER THAN A ROUTE, which is the whole design and the reason this is small:
 *
 * The agent-token gate in server.ts is default-deny — an agent reaches a GET whose path has an
 * access category and whose category its token names, and nothing else. Presenting the token to
 * that surface inherits scoping, auditing and read-only *for free*. An MCP endpoint inside the
 * server could not: JSON-RPC is a POST, every POST is refused there, so it would have to sit
 * outside the gate and re-implement all three — the "beside it rather than on top of it" mistake.
 *
 * It also cannot live under src/ even if we wanted it to: `check:boundary` refuses `fetch` there,
 * because Node's fetch is undici and ignores the guarded DNS lookup that is the SSRF control.
 * scripts/ is the exempt place for loopback drivers, and that exemption is why this lives here —
 * the same reason scripts/agent-token-tests.ts does.
 *
 * So this process holds no database handle, no session, and no privilege. It is an HTTP client with
 * a scoped bearer token, and every safety property it has belongs to the server it calls.
 *
 * WHAT IT PUBLISHES: one read-only TOOL (`search_records`), seven RESOURCES — the categorised GET
 * routes an agent token can already reach — and three PROMPTS. The last two are what a client's
 * attachment picker lists, and publishing neither is why the first slice appeared in no picker.
 *
 * ZERO DEPENDENCIES, deliberately. The official SDK would be the conventional choice, but MCP's
 * stdio transport is newline-delimited JSON-RPC 2.0 and the surface used here is a handful of
 * methods. In a
 * store of medical records, a dependency tree is a standing supply-chain question, and this repo
 * runs on sixteen packages. If the maintainers would rather take the SDK, the shape below is the
 * same either way — only the plumbing changes.
 */
import { createInterface } from 'node:readline';
// The ONLY import out of src/, and a deliberate one: the sleep stages come back as bare SNOMED
// codes ("248220008"), and a client showing those to a patient is showing them nothing. The
// display strings are already written down once, in the catalog the server itself codes against —
// copying them here would be the second place for the record's meaning to drift, which is the
// mistake this file argues against everywhere else. catalog.ts is pure data with no imports of its
// own, so this stays an HTTP client with no database handle and no privilege.
import { codeableDisplay, lookupByMetricType } from '../src/app/health/catalog.js';

/** MCP revisions this bridge speaks. A client asking for one of these is answered in its own. */
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const FALLBACK_PROTOCOL = '2025-06-18';

const BASE = (process.env['YOURPHR_URL'] ?? '').replace(/\/+$/, '');
const TOKEN = process.env['YOURPHR_AGENT_TOKEN'] ?? '';

/** Diagnostics go to stderr; stdout is the JSON-RPC channel and carries nothing else. */
function note(message: string): void {
  process.stderr.write(`yourphr-mcp: ${message}\n`);
}

interface Rpc {
  jsonrpc: '2.0';
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function reply(id: number | string | null | undefined, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function fail(id: number | string | null | undefined, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

/** A tool result the model reads. `isError` keeps a refusal in-band, so the model can say why. */
function toolResult(text: string, isError = false): Record<string, unknown> {
  return { content: [{ type: 'text', text }], isError };
}

/** The longest query the bridge passes on. A search for more than a sentence is not a search. */
const MAX_QUERY = 200;

/**
 * Tool and prompt arguments come from the client — which in practice means from a model, and from
 * whatever text that model has been shown. So they are validated like any request body from outside
 * (yourphr#657): the declared shape and nothing else, before anything is sent to YourPHR. A refusal
 * names what to fix, so the model can correct itself; and because it happens here, a malformed call
 * never reaches the server, never becomes an access-log line, and never reaches the search index.
 */
function readSearchArguments(raw: unknown, allowed: readonly string[] = ['query', 'limit']): { ok: true; query: string; limit: number } | { ok: false; message: string } {
  if (raw === undefined) raw = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'The arguments must be an object.' };
  const args = raw as Record<string, unknown>;
  const unexpected = Object.keys(args).filter((k) => !allowed.includes(k));
  if (unexpected.length) return { ok: false, message: `Unexpected argument${unexpected.length === 1 ? '' : 's'}: ${unexpected.join(', ')}. Accepted: ${allowed.join(', ')}.` };
  if (args['query'] !== undefined && typeof args['query'] !== 'string') return { ok: false, message: 'query must be text.' };
  const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
  // Control characters have no place in words a person searches for, and a newline in a query is how
  // text meant for a model gets smuggled into one.
  if (/[\u0000-\u001f\u007f]/.test(query)) return { ok: false, message: 'query contains control characters; give plain words.' };
  if (query.length < 2) return { ok: false, message: 'Give at least two characters to search for.' };
  if (query.length > MAX_QUERY) return { ok: false, message: `query is longer than ${MAX_QUERY} characters; give a few words.` };
  const asked = args['limit'];
  if (asked !== undefined && !(typeof asked === 'number' && Number.isInteger(asked) && asked >= 1 && asked <= 100)) {
    return { ok: false, message: 'limit must be a whole number from 1 to 100.' };
  }
  return { ok: true, query, limit: typeof asked === 'number' ? asked : 20 };
}

const SEARCH_RECORDS = {
  name: 'search_records',
  title: 'Search health records',
  description:
    "Search the signed-in patient's own health records by words — conditions, medications, lab " +
    'results, immunizations, procedures, encounters and documents. Returns matching records with a ' +
    'short snippet each, newest and best-matching first. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words to look for, e.g. "metformin" or "blood pressure". At least two characters.' },
      limit: { type: 'integer', description: 'How many records to return (1–100). Defaults to 20.', minimum: 1, maximum: 100 },
    },
    required: ['query'],
    additionalProperties: false,
  },
} as const;

/**
 * Wearable metrics (yourphr sat-apple-health): the phone's own readings, which `search_records`
 * cannot reach and never will.
 *
 * Record search runs over the FHIR resources a provider sent. Raw samples live in phd-samples.db.
 * The daily trend is the Observation the rollup wrote. An individual reading is the only call that
 * reads the raw rows, and it is a different route under the same Health access category.
 *
 * TWO SHAPES, because the two questions are different sizes. The catalog resource is "what does my
 * phone record, and what was the last reading" — one row per metric, attachable. This tool is "what
 * has my heart rate done for a month", which is a series, and a series is only worth fetching once
 * the model knows which metric to ask for.
 */
const READ_HEALTH_METRIC = {
  name: 'read_health_metric',
  title: 'Read a wearable health metric',
  description:
    "Read one of the patient's own wearable/phone health metrics over time — heart rate, resting " +
    'heart rate, HRV, steps, blood pressure, body mass, oxygen saturation, body temperature, sleep. ' +
    'Returns the values with min/max/average for the window. Read the yourphr://health resource ' +
    'first to see which metrics this instance actually holds. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      metric_type: { type: 'string', description: 'The metric, e.g. "heart_rate", "step_count", "sleep_stage", "blood_pressure".' },
      days: { type: 'integer', description: 'How many days back from now (1-365). Defaults to 30.', minimum: 1, maximum: 365 },
      mode: {
        type: 'string',
        enum: ['points', 'day', 'daily-stats', 'stages'],
        description: 'daily-stats = the daily trend (default); day = one total per day (steps); stages = hours per sleep stage per night; points = individual readings, the only mode that reads raw samples.',
      },
    },
    required: ['metric_type'],
    additionalProperties: false,
  },
} as const;

/**
 * The records a client can ATTACH, rather than ask a question about (yourphr#657).
 *
 * The first slice published one tool and nothing else, which is why YourPHR did not appear in a
 * client's attachment picker at all: that menu lists RESOURCES and PROMPTS, and this server had
 * neither. A tool answers a question the model thought to ask; a resource is the patient handing
 * over a document deliberately, which is the more honest shape for "here are my medications".
 *
 * Every entry is a GET that already has an access category, so the same default-deny gate decides
 * it and the same access-log line records it. The `scope` field is not enforced here — it is what
 * the server will demand, repeated so a refusal can name the exact thing to tick when minting.
 *
 * The list is STATIC and deliberately not filtered to the token's own scopes: an agent token
 * cannot read its own record (managing one needs the owner's session), and probing each route to
 * find out would write an access-log line for every resource the patient never asked for. So all
 * of them are offered, and one the token does not carry refuses by name when it is read.
 */
const RESOURCES = [
  { uri: 'yourphr://summary', name: 'summary', title: 'Health summary', scope: 'Summary', path: '/api/secure/summary',
    description: 'The overview the patient sees first: their active problems, medications, allergies and recent activity.' },
  { uri: 'yourphr://summary/ips', name: 'summary-ips', title: 'International Patient Summary', scope: 'Summary (IPS)', path: '/api/secure/summary/ips',
    description: 'The same summary as an IPS FHIR bundle — the form a clinician abroad would be given.' },
  { uri: 'yourphr://medications', name: 'medications', title: 'Medications', scope: 'Medications', path: '/api/secure/medications/reconciled',
    description: "Reconciled medication list — one entry per drug, not one per prescription refill." },
  { uri: 'yourphr://conditions', name: 'conditions', title: 'Conditions', scope: 'Conditions', path: '/api/secure/conditions/reconciled',
    description: 'Reconciled problem list, de-duplicated across the sources the patient has connected.' },
  { uri: 'yourphr://allergies', name: 'allergies', title: 'Allergies', scope: 'Allergies', path: '/api/secure/allergies/classified',
    description: 'Allergies and intolerances, classified by what they are a reaction to.' },
  { uri: 'yourphr://immunizations', name: 'immunizations', title: 'Immunizations', scope: 'Immunizations', path: '/api/secure/immunizations/classified',
    description: 'Immunization history, classified by vaccine.' },
  { uri: 'yourphr://recent', name: 'recent', title: 'Recent records', scope: 'Record search', path: '/api/secure/resources/recent',
    description: 'The most recently added records across every type, newest first.' },
  { uri: 'yourphr://health', name: 'health', title: 'Wearable health metrics', scope: 'Health', path: '/api/secure/health/metrics',
    description: "What the patient's phone and wearables record — one entry per metric with its latest reading, how far back it goes, and how many samples there are." },
] as const;

/**
 * Prompts — the other half of what a picker lists, and the place to say HOW to answer.
 *
 * Each one carries the same instruction the product holds itself to: answer from the record or say
 * the record does not say. A model inventing a plausible medication history for someone reading it
 * as their own is the failure this server would be blamed for, and a prompt is the cheapest place
 * to refuse it.
 */
const GROUNDING =
  'Answer only from the records returned by this server. Quote the record date beside anything you ' +
  'state. If the records do not say, say that they do not say — never fill a gap with what is ' +
  'usually true. This is not medical advice, and you are not the patient\'s clinician.';

const PROMPTS = [
  {
    name: 'whats-in-my-record',
    title: 'What is in my record?',
    description: 'A plain-language tour of what this instance holds — conditions, medications, allergies, immunizations.',
    arguments: [],
    build: (): string =>
      'Read the yourphr://summary resource, then tell me in plain language what my health record ' +
      `currently holds. Group it by conditions, medications, allergies and immunizations. ${GROUNDING}`,
  },
  {
    name: 'my-medications',
    title: 'What am I taking, and why?',
    description: 'The reconciled medication list, matched against the conditions in the record.',
    arguments: [],
    build: (): string =>
      'Read the yourphr://medications and yourphr://conditions resources. List what I am taking, and ' +
      'where the record links a medication to a condition, say so. Where it does not, say the record ' +
      `does not say why. ${GROUNDING}`,
  },
  {
    name: 'find-in-my-record',
    title: 'Find something in my record',
    description: 'Search the record by words and explain what the matches are.',
    arguments: [{ name: 'query', description: 'What to look for, e.g. "metformin" or "blood pressure".', required: true }],
    build: (args: Record<string, unknown>): string => {
      const query = typeof args['query'] === 'string' ? args['query'] : '';
      return `Use the search_records tool to find "${query}" in my records, then explain what each ` +
        `match is, in plain language, with its date. ${GROUNDING}`;
    },
  },
] as const;

interface SearchHit {
  source_resource_type: string;
  source_resource_id: string;
  title: string;
  date?: string;
  snippet: string;
}

/**
 * One search, as the patient, against their own instance.
 *
 * The refusals are worth as much as the results here: an agent token that has been revoked, expired
 * or minted without `Record search` is the normal way this stops working, and a model that is told
 * which of those happened can tell the patient what to do about it.
 */
async function searchRecords(query: string, limit: number): Promise<Record<string, unknown>> {
  const url = `${BASE}/api/secure/resources/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json' } });
  } catch (err) {
    return toolResult(`Could not reach YourPHR at ${BASE}: ${(err as Error).message}`, true);
  }

  if (res.status === 401) {
    return toolResult(
      'YourPHR refused the agent token. It has been revoked, or it has expired — agent tokens last at ' +
        'most 24 hours. Mint a fresh one from Account Profile and update this client.',
      true,
    );
  }
  if (res.status === 403) {
    return toolResult(
      'This agent token was not given access to record search. Mint one from Account Profile with the ' +
        '"Record search" scope selected.',
      true,
    );
  }
  if (!res.ok) {
    return toolResult(`YourPHR answered ${res.status} ${res.statusText}.`, true);
  }

  const body = (await res.json()) as { data?: SearchHit[] };
  const hits = body.data ?? [];
  if (hits.length === 0) return toolResult(`No records matched "${query}".`);

  // Rendered rather than raw JSON: the reference is what a follow-up question needs, the title and
  // date are what a person recognises, and the snippet is the evidence for the match.
  const lines = hits.map((h) => {
    const when = h.date ? ` (${h.date})` : '';
    const snippet = h.snippet ? ` — ${h.snippet.replace(/\s+/g, ' ').trim()}` : '';
    return `- ${h.source_resource_type}/${h.source_resource_id}: ${h.title}${when}${snippet}`;
  });
  return toolResult(`${hits.length} record${hits.length === 1 ? '' : 's'} matching "${query}":\n${lines.join('\n')}`);
}

/**
 * One resource, read as the patient. The refusals carry the same sentences the tool uses, because
 * a patient meets them the same way: a token that expired, or one minted without the box ticked.
 */
async function readResource(entry: (typeof RESOURCES)[number]): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${entry.path}`, { headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json' } });
  } catch (err) {
    return { ok: false, message: `Could not reach YourPHR at ${BASE}: ${(err as Error).message}` };
  }
  if (res.status === 401) {
    return { ok: false, message: 'YourPHR refused the agent token. It has been revoked, or it has expired — agent tokens last at most 24 hours. Mint a fresh one from Account Profile and update this client.' };
  }
  if (res.status === 403) {
    return { ok: false, message: `This agent token was not given access to ${entry.title.toLowerCase()}. Mint one from Account Profile with the "${entry.scope}" scope selected.` };
  }
  if (!res.ok) return { ok: false, message: `YourPHR answered ${res.status} ${res.statusText}.` };
  // JSON as it stands, not a rendering: a resource is the document itself, and a summary written
  // here would be a second place for the record's meaning to drift from the app's.
  return { ok: true, text: await res.text() };
}

/** Two decimals: a daily step total printed as 3314.7400000000002 is arithmetic showing through. */
const round = (value: number): number => Math.round(value * 100) / 100;

interface SeriesPoint { t: string; v: number }
interface DailyBucket { date: string; value: number }
interface StageNight { date: string; stages: Record<string, number> }
interface Series {
  metric_type?: string;
  vendor_type?: string;
  unit?: string;
  total?: number;
  downsampled?: boolean;
  points?: SeriesPoint[];
  daily?: DailyBucket[];
  nights?: StageNight[];
  /** A panel metric (blood pressure) has no single value: one series PER COMPONENT code, keyed by it. */
  components?: Record<string, SeriesPoint[]>;
  stats?: { min?: number; max?: number; avg?: number };
}

/**
 * One metric's series, as the patient.
 *
 * RENDERED, not raw JSON, and that is the whole reason this is a tool rather than a second
 * resource: a month of five-minute heart rate is thousands of (t, v) pairs, and handing the model
 * that array spends the context window on numbers it will summarise into the three the server
 * already computed. The server downsamples and computes min/max/avg; this prints those, the window,
 * and a bounded tail of the values so a specific reading can still be quoted with its timestamp.
 */
/** Individual readings. This is the only health call that reads the raw samples. */
async function readHealthSamples(metricType: string, days: number): Promise<Record<string, unknown>> {
  const startAfter = new Date(Date.now() - days * 86_400_000).toISOString();
  const params = new URLSearchParams({ metric_type: metricType, start_after: startAfter, limit: '50', sort: 'desc' });
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/secure/health/samples?${params.toString()}`, {
      headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json' },
    });
  } catch (err) {
    return toolResult(`Could not reach YourPHR at ${BASE}: ${(err as Error).message}`, true);
  }
  if (res.status === 401 || res.status === 403) {
    return toolResult('This agent token was not given access to health metrics. Mint one from Account Profile with the "Health" scope selected.', true);
  }
  if (!res.ok) return toolResult(`YourPHR answered ${res.status} ${res.statusText}.`, true);
  const page = ((await res.json()) as { data?: { total?: number; samples?: { start_time?: string; value_num?: number; value_text?: string; unit?: string; components?: { code: string; display?: string; value: number }[] }[] } }).data ?? {};
  const samples = page.samples ?? [];
  const head = `${metricType} readings over the last ${days} day${days === 1 ? '' : 's'}`;
  if (samples.length === 0) return toolResult(`${head}: no samples recorded.`);
  const lines = samples.map((sample) => {
    const when = sample.start_time ?? '';
    if (sample.components?.length) {
      const parts = sample.components.map((part) => `${part.display || part.code} ${round(part.value)}`).join(' / ');
      return `- ${when}: ${parts}`;
    }
    if (sample.value_num != null) return `- ${when}: ${round(sample.value_num)}${sample.unit ? ` ${sample.unit}` : ''}`;
    return `- ${when}: ${sample.value_text || '—'}`;
  });
  return toolResult(`${head} — ${page.total ?? samples.length} reading(s), showing ${samples.length}:\n${lines.join('\n')}`);
}

async function readHealthMetric(metricType: string, days: number, mode: string): Promise<Record<string, unknown>> {
  if (mode === 'points') return readHealthSamples(metricType, days);
  const startAfter = new Date(Date.now() - days * 86_400_000).toISOString();
  const params = new URLSearchParams({ metric_type: metricType, start_after: startAfter, mode });
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/secure/health/series?${params.toString()}`, {
      headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json' },
    });
  } catch (err) {
    return toolResult(`Could not reach YourPHR at ${BASE}: ${(err as Error).message}`, true);
  }
  if (res.status === 401) {
    return toolResult(
      'YourPHR refused the agent token. It has been revoked, or it has expired — agent tokens last at ' +
        'most 24 hours. Mint a fresh one from Account Profile and update this client.',
      true,
    );
  }
  if (res.status === 403) {
    return toolResult(
      'This agent token was not given access to health metrics. Mint one from Account Profile with the ' +
        '"Health" scope selected.',
      true,
    );
  }
  // A metric this instance has never recorded is a 400 from the server, and saying which ones it
  // does hold is more use to the patient than the status code.
  if (res.status === 400) {
    return toolResult(
      `YourPHR does not recognise the metric "${metricType}". Read the yourphr://health resource to see ` +
        'which metrics this instance holds.',
      true,
    );
  }
  if (!res.ok) return toolResult(`YourPHR answered ${res.status} ${res.statusText}.`, true);

  const series = ((await res.json()) as { data?: Series }).data ?? {};
  const unit = series.unit ? ` ${series.unit}` : '';
  const head = `${series.metric_type || metricType} over the last ${days} day${days === 1 ? '' : 's'}` +
    ` (since ${startAfter.slice(0, 10)})`;

  if (series.nights?.length) {
    const metric = lookupByMetricType(series.metric_type || metricType);
    const lines = series.nights.map((n) => {
      const stages = Object.entries(n.stages)
        .map(([code, hours]) => `${metric ? codeableDisplay(metric, code) : code} ${hours.toFixed(1)}h`)
        .join(', ');
      return `- ${n.date}: ${stages}`;
    });
    return toolResult(`${head} — ${series.nights.length} night(s):\n${lines.join('\n')}`);
  }

  if (series.daily?.length) {
    const lines = series.daily.map((d) => `- ${d.date}: ${round(d.value)}${unit}`);
    return toolResult(`${head} — ${series.daily.length} day(s):\n${lines.join('\n')}`);
  }

  // A panel before the plain points, because a panel HAS no points and falling through to them is
  // how blood pressure came back as "no samples recorded" while thirty cuff readings sat in the
  // table. Systolic and diastolic are printed on one line per reading: a pair is what a clinician
  // reads, and splitting it into two lists loses which half went with which.
  if (series.components && Object.keys(series.components).length > 0) {
    const metric = lookupByMetricType(series.metric_type || metricType);
    const codes = Object.keys(series.components);
    const label = (code: string): string =>
      metric?.components?.find((c) => c.code === code)?.display ?? code;
    const byTime = new Map<string, Map<string, number>>();
    for (const code of codes) {
      for (const point of series.components[code] ?? []) {
        if (!byTime.has(point.t)) byTime.set(point.t, new Map());
        byTime.get(point.t)!.set(code, point.v);
      }
    }
    const times = [...byTime.keys()].sort();
    const TAIL_PANEL = 60;
    const shownTimes = times.slice(-TAIL_PANEL);
    const lines = shownTimes.map((t) => {
      const values = codes
        .filter((code) => byTime.get(t)!.has(code))
        .map((code) => `${label(code)} ${round(byTime.get(t)!.get(code)!)}${unit}`)
        .join(' / ');
      return `- ${t}: ${values}`;
    });
    const trimmed = times.length > TAIL_PANEL ? ` (showing the most recent ${TAIL_PANEL})` : '';
    return toolResult(`${head}: ${series.total ?? times.length} reading(s)${trimmed}\n${lines.join('\n')}`);
  }

  const points = series.points ?? [];
  if (points.length === 0) return toolResult(`${head}: no samples recorded.`);

  const s = series.stats ?? {};
  const stats = [
    s.min !== undefined ? `min ${s.min}${unit}` : '',
    s.max !== undefined ? `max ${s.max}${unit}` : '',
    s.avg !== undefined ? `avg ${Number(s.avg).toFixed(1)}${unit}` : '',
  ].filter(Boolean).join(', ');

  // The tail is bounded because the context window is: the stats above are computed over the WHOLE
  // window by the server, so truncating the listing loses detail but never distorts the summary.
  const TAIL = 60;
  const shown = points.slice(-TAIL);
  const lines = shown.map((p) => `- ${p.t}: ${round(p.v)}${unit}`);
  const note = points.length > TAIL ? ` (showing the most recent ${TAIL})` : '';
  const sampled = series.downsampled ? ' The server downsampled this window, so each value is a bucket average.' : '';

  return toolResult(
    `${head}: ${series.total ?? points.length} sample(s)${stats ? `, ${stats}` : ''}.${sampled}${note}\n${lines.join('\n')}`,
  );
}

async function handle(msg: Rpc): Promise<void> {
  const { id, method, params } = msg;

  // A notification has no id and takes no reply — `notifications/initialized` is the common one.
  const isNotification = id === undefined;

  switch (method) {
    case 'initialize': {
      const asked = String((params as { protocolVersion?: string } | undefined)?.protocolVersion ?? '');
      reply(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : FALLBACK_PROTOCOL,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'yourphr', version: '1.0.0' },
        instructions:
          'These are one patient\'s own health records, read live from their YourPHR instance. Every ' +
          'read is recorded in their access log under this client\'s name. Nothing here can be changed. ' +
          'Answer only from what these records say, with the record date beside anything you state; ' +
          'where they do not say, say so rather than filling the gap with what is usually true.',
      });
      return;
    }

    case 'notifications/initialized':
      return;

    case 'ping':
      reply(id, {});
      return;

    case 'tools/list':
      reply(id, { tools: [SEARCH_RECORDS, READ_HEALTH_METRIC] });
      return;

    case 'resources/list':
      reply(id, { resources: RESOURCES.map(({ uri, name, title, description }) => ({ uri, name, title, description, mimeType: 'application/json' })) });
      return;

    // Asked by clients that support parameterised resources. This server publishes none, and an
    // empty list is the answer; a "method not found" makes some clients drop the server entirely.
    case 'resources/templates/list':
      reply(id, { resourceTemplates: [] });
      return;

    case 'resources/read': {
      const uri = String((params as { uri?: string } | undefined)?.uri ?? '');
      const entry = RESOURCES.find((r) => r.uri === uri);
      if (!entry) {
        fail(id, -32002, `no such resource: ${uri}`);
        return;
      }
      const read = await readResource(entry);
      // A refusal is an ERROR here rather than content: a resource that answers with the reason it
      // could not be read would be attached to the conversation as if it were the record.
      if (!read.ok) fail(id, -32002, read.message);
      else reply(id, { contents: [{ uri, mimeType: 'application/json', text: read.text }] });
      return;
    }

    case 'prompts/list':
      reply(id, { prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args })) });
      return;

    case 'prompts/get': {
      const asked = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      const prompt = PROMPTS.find((p) => p.name === asked?.name);
      if (!prompt) {
        fail(id, -32602, `unknown prompt: ${String(asked?.name ?? '')}`);
        return;
      }
      // A prompt's arguments are written into text the model will read as the patient's own words,
      // so they pass the same checks as a tool's (yourphr#657).
      const declared = prompt.arguments.map((a) => a.name);
      if (declared.length) {
        const checked = readSearchArguments(asked?.arguments, declared);
        if (!checked.ok) {
          fail(id, -32602, checked.message);
          return;
        }
      } else if (asked?.arguments && Object.keys(asked.arguments).length) {
        fail(id, -32602, `this prompt takes no arguments`);
        return;
      }
      reply(id, {
        description: prompt.description,
        messages: [{ role: 'user', content: { type: 'text', text: prompt.build(asked?.arguments ?? {}) } }],
      });
      return;
    }

    case 'tools/call': {
      const call = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      const args = call?.arguments ?? {};

      if (call?.name === READ_HEALTH_METRIC.name) {
        const metricType = typeof args['metric_type'] === 'string' ? args['metric_type'].trim() : '';
        if (metricType === '') {
          reply(id, toolResult('Name the metric to read, e.g. "heart_rate". The yourphr://health resource lists them.', true));
          return;
        }
        const askedDays = Number(args['days'] ?? 30);
        const days = Number.isInteger(askedDays) ? Math.min(Math.max(askedDays, 1), 365) : 30;
        const askedMode = typeof args['mode'] === 'string' ? args['mode'] : '';
        // The mode a metric wants is a property of the metric, not of the question: steps are a
        // daily total and sleep is a set of stages, and a client that omits it should still get the
        // chart the app would draw rather than a raw sample list.
        const mode = askedMode !== '' ? askedMode
          : metricType === 'step_count' ? 'day'
          : metricType === 'sleep_stage' ? 'stages'
          : 'daily-stats';
        reply(id, await readHealthMetric(metricType, days, mode));
        return;
      }

      if (call?.name !== SEARCH_RECORDS.name) {
        fail(id, -32602, `unknown tool: ${String(call?.name ?? '')}`);
        return;
      }
      const search = readSearchArguments(call.arguments);
      if (!search.ok) {
        reply(id, toolResult(search.message, true));
        return;
      }
      reply(id, await searchRecords(search.query, search.limit));
      return;
    }

    default:
      if (!isNotification) fail(id, -32601, `method not found: ${String(method ?? '')}`);
  }
}

function main(): void {
  if (BASE === '' || TOKEN === '') {
    note('set YOURPHR_URL and YOURPHR_AGENT_TOKEN. Mint a token at Account Profile → Agent tokens,');
    note('with the "Record search" scope. See docs/architecture/agent-access-policy.md.');
    process.exit(1);
  }

  // Newline-delimited JSON, which is MCP's stdio framing (not LSP's Content-Length headers).
  const lines = createInterface({ input: process.stdin });

  // A tool call is a round trip to the server, so requests are in flight when stdin closes —
  // which is the normal end of a piped session, not only a shutdown. Exiting on `close` alone
  // dropped every answer that had not come back yet: the handshake replied and the searches
  // vanished. Drain instead, so the last question asked is still answered.
  let pending = 0;
  let inputClosed = false;
  const exitWhenDrained = (): void => { if (inputClosed && pending === 0) process.exit(0); };

  lines.on('line', (line) => {
    const text = line.trim();
    if (text === '') return;
    let msg: Rpc;
    try {
      msg = JSON.parse(text) as Rpc;
    } catch {
      fail(null, -32700, 'parse error');
      return;
    }
    pending += 1;
    void handle(msg)
      .catch((err) => {
        // Never the record, and never a stack: a tool failure is a sentence the model can pass on.
        note(`request failed: ${(err as Error).message}`);
        if (msg.id !== undefined) fail(msg.id, -32603, 'internal error');
      })
      .finally(() => { pending -= 1; exitWhenDrained(); });
  });
  lines.on('close', () => { inputClosed = true; exitWhenDrained(); });
  note(`ready — ${BASE}`);
}

main();
