# Vendors

Reference notes on the external health-IT vendors whose data and APIs YourPHR interoperates with. Each doc follows the same shape: **Overview · Ownership & History · Products · Contact · API & Integration · Known API Issues · Relevance to YourPHR · References**.

| Vendor | Doc | Why it matters to YourPHR |
|---|---|---|
| **FollowMyHealth** | [`followmyhealth.md`](./followmyhealth.md) | Patient portal; its FHIR R4 export is the primary real-world (non-US-Core) dataset YourPHR is hardened against. |
| **Veradigm** (formerly **Allscripts**) | [`veradigm-allscripts.md`](./veradigm-allscripts.md) | Owns FollowMyHealth and the SMART/FHIR developer program; the external gatekeeper for live sync ([#53](https://github.com/jwilleke/yourphr/issues/53)). |

Integration / topic notes (not vendor profiles): [`epic-sandbox.md`](./epic-sandbox.md) (connect to Epic's public SMART sandbox — the lowest-friction live target, [#257](https://github.com/jwilleke/yourphr/issues/257)) and [`clientid-friction.md`](./clientid-friction.md) (why obtaining a ClientID is the project's biggest blocker).

## Sandbox registration guides — where to register & what you need

How to obtain credentials for each test sandbox. The index with connect values + status is [`../test-sandboxes.md`](../test-sandboxes.md); actual credential values live in `private/secrets.md` (gitignored).

| Sandbox | Register at | What you get | Guide |
|---|---|---|---|
| **SMART Health IT** | _nothing — open sandbox_ | any `client_id`, no secret | [`smart-health-it.md`](./smart-health-it.md) |
| **CMS Blue Button 2.0** | <https://bluebutton.cms.gov/developers/> | `client_id` + `client_secret` (confidential) | [`blue-button.md`](./blue-button.md) |
| **Epic** | <https://fhir.epic.com> | `client_id` (public/PKCE) | [`epic-sandbox.md`](./epic-sandbox.md) |
| **FollowMyHealth / Veradigm** | <https://developer.veradigm.com> | `client_id` (public/PKCE) — ⛔ provisioning-gated | [`followmyhealth.md`](./followmyhealth.md) |
| **Oracle Health (Cerner)** | <https://code-console.cerner.com/> | `client_id` (public/PKCE), console-issued | [`oracle-cerner.md`](./oracle-cerner.md) |
| **athenahealth** | <https://mydata.athenahealth.com/access-the-apis> | `client_id` (public/PKCE) — approval-gated | [`athenahealth.md`](./athenahealth.md) |

See also: [`../FHIR/fhir-testing.md`](../FHIR/fhir-testing.md) (test-vs-real environments) and [`../FHIR/fhir-test-discovery-example.md`](../FHIR/fhir-test-discovery-example.md) (a captured FollowMyHealth discovery document).
