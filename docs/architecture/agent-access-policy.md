# AI agent access policy

__Status: proposed with the first slice (yourphr#657), for review before merge.__

__Code:__ `scripts/mcp-server.ts` (the bridge), `src/framework/managers/AgentTokensManager.ts` (the credential), `src/account/index.ts` (`accessCategoryFor`, the scope and log vocabulary), `src/server.ts` (the gate)
__Harnesses:__ `npm run mcp-tests`, `npm run agent-tokens`
__Companion to:__ [`connection-policy.md`](./connection-policy.md), which answers the same shape of question for medical sources — what leaves, on whose decision, and what is refused.

This is the written policy [yourphr#599](https://github.com/jwilleke/yourphr/issues/599) asked for before any LLM touched a record: *"records must not leave the machine without an explicit, per-conversation statement."*

## The posture, in one paragraph

YourPHR runs no model, bundles no weights, calls no inference service, and sends no record anywhere. A patient who wants an AI to help them read their own records mints a short-lived, scoped credential for themselves and hands it to a client they already run. That client fetches their records, under their own credential, on their own machine, subject to whatever terms they accepted from whoever wrote it. YourPHR's part is to serve an authenticated read and record that it happened.

The distinction is the whole design and it is not a technicality: __the product is not the party disclosing anything.__ There is no configuration in which YourPHR transmits a record to a third party of its own accord, and adding one would be a different decision requiring its own review.

## Default posture

| Question | Default |
|---|---|
| Agent tokens | __Off__ — `yourphr.auth.agent-token.enabled` is `false`; an operator opts in |
| Token lifetime | __24 hours__, a ceiling rather than a default; there is no never-expires option |
| Token capability | __Read-only__ — no write scope exists to grant |
| Scope | __Required__ — an unscoped token is rejected, never treated as unrestricted |
| Which records | __Only the minting patient's own__, by the same `user_id` seam every other read uses |
| The MCP bridge | Runs on the __patient's machine__, launched by their client; the server neither hosts nor advertises it |

Nothing in that table is new to this feature. Every row is a property of [yourphr#695](https://github.com/jwilleke/yourphr/issues/695), inherited rather than re-implemented, which is the point of building the bridge on the HTTP surface instead of beside it.

## What may leave the machine, and on whose decision

Records leave only when a patient has taken three deliberate steps, each of which they can undo:

1. An operator enabled agent tokens for the instance.
2. The patient minted a token, chose its scopes, and saw what those scopes let an agent read.
3. The patient pasted that token into a client they chose and configured.

The __per-conversation statement__ yourphr#599 requires is served by the bridge itself. Its `initialize` response tells the connecting client, in words the model reads at the start of every session:

> These are one patient's own health records, read live from their YourPHR instance. Every read is recorded in their access log under this client's name. Nothing here can be changed.

That is a statement to the model rather than a consent dialog to the human, and it is worth being honest about the difference. The human's consent moment is the minting screen, which is where the scopes are chosen and where the words have to be right.

## What is recorded

Every agent read is written to the patient's access log __before__ the read is served, under the __token's name__ rather than the patient's — so the log says "Claude Desktop read your record search" and not "you did", on a day the patient may not have opened the app at all. `npm run mcp-tests` asserts both halves: that the agent's name appears, and that the patient's does not.

The log is bucketed per owner, actor, category and day, with a count. So a chatty agent produces one row with a rising number rather than a flood, and the patient can still see how much was read and when it started and stopped.

## What the product refuses

- __Any write.__ Not "no write tool is offered" — no write path has an access category, and the gate admits only categorised GETs, so a write route added next year is refused by inheritance rather than by someone remembering.
- __Any read with no category.__ An uncategorised read is one the log cannot record, and yourphr#614's rule is that an unaudited disclosure did not happen. An agent asking for one gets a 403.
- __A token used from a browser.__ Agent tokens are accepted from an `Authorization` header only, never from a cookie, so a page cannot silently borrow one.
- __A token that renews or mints another.__ Two independent locks: the edge gate refuses the route, and `AgentTokensManager.requireHuman` refuses the call.
- __Bundling, recommending, or proxying a model.__ Out of scope by policy, not merely unimplemented.
- __Tool and prompt arguments outside their declared shape.__ They come from the client, which means from a model and whatever text it was shown, so the bridge treats them as untrusted input: an undeclared argument, a query that is not text, holds control characters, or runs past 200 characters, or a `limit` outside 1–100 is refused with a message naming the fix — before anything reaches YourPHR, so a malformed call is never an access-log line ([#657](https://github.com/jwilleke/yourphr/issues/657)).

## The decision this policy owes: is the audit a guarantee or a list?

[yourphr#657](https://github.com/jwilleke/yourphr/issues/657) asked whether "who read this record" is a manager guarantee or an HTTP-layer allow-list, and said the MCP safety case rests on the answer.

__Today it is an allow-list.__ `accessCategoryFor(pathname)` maps a path to a category; `src/server.ts` consults it and writes the log entry. The managers — which `scripts/check-store-boundary.sh` does prove are the only path to a store — have no part in it. A read that reaches a manager through an uncategorised route is served and never recorded.

That is not hypothetical. Find-anything-by-words ([yourphr#599](https://github.com/jwilleke/yourphr/issues/599)) shipped with no category, so the dashboard's search box read across every resource type a patient owns and the access log said nothing had happened. This slice is what fixes it, because it had to: an uncategorised route is also unreachable by an agent token, so `search_records` could not work until the route was named.

__The allow-list is fail-safe for agents and fail-open for sessions.__ Omit a category and an agent gets a 403 — loud, immediate, and the reason this gap surfaced at all. Omit it and a signed-in patient's own read goes unlogged, silently, forever. The two halves of one mechanism fail in opposite directions, and only one of them tells you.

__The recommendation is to keep the allow-list and make omission loud.__ Moving the audit into the managers is the tempting answer and the wrong one here: scopes are the log's categories, so a category is a property of *the surface a request arrives on*, not of the manager underneath — several routes with different categories share one manager, and `Full export` and `Records (FHIR)` are the same manager reached two ways. Binding audit to the manager would break the property that makes scoping trustworthy.

What was missing was not a different mechanism but a check that fails, per the twelfth architecture principle. __It now exists:__ `npm run check:categories` (`scripts/check-access-categories.ts`, in Server CI) requires every GET under `/api/secure/` to resolve a category, to be exempt with a stated reason, or to be a tracked gap with its issue — so a silent hole is a build failure, as yourphr#599's search route would have been on the commit that introduced it. Its first run found two: practitioner history and record provenance ([#798](https://github.com/jwilleke/yourphr/issues/798)).

## Connecting a client

Verified end to end against Cursor and a hand-driven client. Four steps, and the reason for each.

### 1. Turn agent tokens on

Off by default, so nothing below is reachable until an operator opts in:

```bash
YOURPHR_AUTH_AGENT_TOKEN_ENABLED=true
```

### 2. Mint a token

__There is no minting screen yet.__ [yourphr#695](https://github.com/jwilleke/yourphr/issues/695) shipped the server side — `GET`/`POST /api/secure/account/agent-tokens`, which already serve `available_scopes` and the TTL policy for exactly such a screen — but the Angular half does not exist, so today a patient cannot do this without a terminal. That is a real gap for a feature aimed at patients rather than operators, and it is the natural next issue; the API is settled, so it is a screen over a finished contract.

Until then, with a signed-in session token:

```bash
curl -s -X POST "$BASE/api/secure/account/agent-tokens" \
  -H "authorization: Bearer $SESSION" -H 'content-type: application/json' \
  -d '{"name":"Claude Desktop","scopes":["Record search"]}'
```

The `name` is what the access log will show, so it should say which client this is rather than which person — the log already knows the person. The cleartext token comes back __once__ and is never stored.

### 3. Point a client at the bridge

Claude Desktop reads `~/Library/Application Support/Claude/claude_desktop_config.json`; Cursor reads `~/.cursor/mcp.json`. The same block works in both:

```json
{
  "mcpServers": {
    "yourphr": {
      "command": "/path/to/yourphr/node_modules/.bin/tsx",
      "args": ["/path/to/yourphr/scripts/mcp-server.ts"],
      "env": {
        "YOURPHR_URL": "http://127.0.0.1:8080",
        "YOURPHR_AGENT_TOKEN": "yphr_at_…"
      }
    }
  }
}
```

__Absolute paths, and the local `tsx` binary rather than `npx`.__ A desktop client is launched by the window manager, not a shell, so it inherits neither the shell `PATH` nor a useful working directory: `npx tsx` there resolves nothing locally and tries to fetch the package over the network, which fails on exactly the offline instance this product is built for. Naming the binary in `node_modules/.bin` removes both problems.

### 4. Ask a question, or attach a record

The bridge offers three kinds of thing, and they are reached differently:

| | reached by | what it is |
|---|---|---|
| __tool__ — `search_records` | the model, when a question warrants it | find-anything-by-words over the patient's own index |
| __resources__ — summary, IPS summary, medications, conditions, allergies, immunizations, recent records | the PATIENT, from the attachment picker | the document itself, as JSON, exactly as the app's own screens read it |
| __prompts__ — *What is in my record?*, *What am I taking, and why?*, *Find something in my record* | the patient, from the same menu | a question already written, carrying the instruction to answer only from the record |

Resources and prompts are what a client's attachment picker lists, which is why the first slice appeared in no picker at all — it published a tool and nothing else.

Every resource is a GET that already has an access category, so the same default-deny gate decides it and the same access-log line records it. The list offered is the full seven and is __not__ filtered to the token's own scopes: an agent token cannot read its own record, and probing each route to find out would write an access-log line for a resource the patient never asked for. Reading one the token does not carry is refused by name — *"not given access to medications … mint one with the 'Medications' scope selected"* — and refused as a protocol __error__ rather than as content, so a reason can never be attached to a conversation as though it were the record.

Then simply ask — *"search my records for metformin"*, *"when was my last tetanus shot?"* — and check the access log afterwards, where the read appears under the token's name.

A token lasts at most 24 hours by design; when it expires the client stops working and says so, and the patient mints another. That friction is the feature — a credential that outlives the patient's attention is the thing yourphr#695 exists to prevent.

## What this policy does not cover

- __Whether the patient's chosen client is trustworthy.__ It cannot; that is theirs to judge, and the honest scope of this design is that it makes the judgement theirs rather than the product's. What YourPHR owes is that the credential is short-lived, narrow, revocable, and that every use of it is visible.
- __Prompt injection.__ Hostile text inside an imported document could try to induce a client to fetch more than the patient meant. Read-only, scoping and the audit bound the blast radius; they do not eliminate the class. The first slice noted that a second *tool* returning whole resources would widen it, and that is still the position: whole records are published as MCP __resources__, which the patient attaches, rather than as tools the model can decide to call. The reach is unchanged either way — a token scoped to `Record search` already matches words across every resource type — and what bounds it is the same thing it always was: the categories the patient ticked when they minted the credential.
- __What a model infers.__ A summary drawn from real records can be wrong in ways the records are not. Nothing here makes an AI's reading of a record clinically reliable, and no part of the product should imply otherwise.
