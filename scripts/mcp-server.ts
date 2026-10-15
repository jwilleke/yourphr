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
      reply(id, { tools: [SEARCH_RECORDS] });
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
      if (call?.name !== SEARCH_RECORDS.name) {
        fail(id, -32602, `unknown tool: ${String(call?.name ?? '')}`);
        return;
      }
      const args = readSearchArguments(call.arguments);
      if (!args.ok) {
        reply(id, toolResult(args.message, true));
        return;
      }
      reply(id, await searchRecords(args.query, args.limit));
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
