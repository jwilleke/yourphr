# YourPHR strategy under constrained patient FHIR access

## Purpose

YourPHR’s mission remains compelling: give patients a private, self-hosted place to collect and use their medical records. The difficult part is no longer proving that SMART on FHIR can work in principle. It is making access reliable when each vendor or provider organization controls registration, client identifiers, scopes, endpoint configuration, and production approval.

This memo proposes a product strategy that treats live synchronization as one acquisition path rather than the only path. The aim is to keep advancing patient access even when a vendor blocks or delays production integration.

## Current position

The repository already has a strong technical foundation:

- A generic SMART R4 client, PKCE authorization, token exchange, refresh, capability-driven fetching, and incremental resource storage.
- A self-hosted store-and-poll OAuth relay that keeps access and refresh tokens out of the browser.
- Provider-catalog authorization and connection flows in both the backend and user interface.
- Manual FHIR R4 bundle import and C-CDA/XML import.
- Display fallbacks for non-US-Core exports, including Veradigm-oriented data.

The main unresolved validation is operational rather than architectural: prove one non-sandbox provider path that lets a real patient authorize and import a non-empty record. The roadmap tracks this as issue #408. Dynamic Client Registration, issue #355, may reduce registration friction, but it does not replace production validation.

## Strategic principle

Do not make YourPHR’s usefulness depend on universal vendor cooperation.

Build a resilient acquisition ladder:

1. __Direct SMART connection__ when a provider supports it.
2. __Portal export import__ when direct connection is unavailable.
3. __Manual record entry__ for information the portal omits or the patient wants to add.
4. __Claims, public-program, and device sources__ where they broaden coverage.
5. __Document ingestion and extraction__ as a later fallback for PDFs and scans.

Every path should converge on the same normalized record, provenance model, deduplication logic, and user experience. A patient should care that the data arrived, not which transport succeeded.

---

## Workstream 1: Make import a first-class acquisition channel

Manual import should not feel like a degraded fallback. For many users, it may be the most reliable path for the foreseeable future.

### Recommended capabilities

- __Import portal downloads as-is.__ Accept ZIP packages, directories, FHIR JSON, C-CDA/XML, and mixed exports without asking the user to unpack or classify files.

- __Detect source flavor.__ Identify common export conventions from Epic MyChart, Oracle Health, FollowMyHealth/Veradigm, athenahealth, labs, and other portals. Keep detection heuristic and non-blocking: unknown packages should still enter the generic pipeline.

- __Create an import manifest.__ Before committing data, show files discovered, formats recognized, records parsed, warnings, unsupported content, and duplicates.

- __Preserve originals.__ Retain the source archive or document alongside normalized resources, with hashes and provenance, so processing can be repeated when parsers improve.

- __Make re-import safe.__ Harden deterministic deduplication and clearly distinguish exact duplicates, updated versions, and conflicting records.

- __Expose completeness.__ Report which clinical categories were found and which were absent without claiming that an absent category means the provider has no such data.

- __Design recovery paths.__ A partially malformed package should import valid content and produce actionable diagnostics for the rest.

### Product opportunity

A guided “Get records from your portal” workflow could provide vendor-specific instructions without coupling YourPHR to portal internals. A later companion extension or local uploader could reduce clicks, but only after validating that it can operate safely across changing portals and browser security boundaries. The durable investment is the import pipeline, not portal automation.

---

## Workstream 2: Prove one production SMART path

Treat issue #408 as a focused validation project, not a mandate to solve every vendor simultaneously.

### Selection criteria

Choose the first production target by:

- Real patient availability to the project team.
- Obtainable production registration.
- Stable SMART discovery and OAuth behavior.
- Sufficient scopes for a useful first import.
- Clear testing rules that do not require committing protected health information.
- Reasonable documentation and a support or escalation channel.

CMS Blue Button 2.0 is the roadmap’s leading self-serve candidate. Epic production is another candidate after sandbox validation. Veradigm should remain tracked, but blocked vendor registration should not hold the release plan hostage.

### Definition of done

- A catalog entry or documented operator configuration exists.
- The instance displays the exact callback URL that must be registered.
- A real, non-sandbox user completes authorization.
- The sync produces a non-empty import.
- Tokens refresh or fail with a clear recovery path.
- Known-good settings and provider-specific limitations are documented.
- Test evidence contains no committed patient data.

### Instrumentation to add

Capture privacy-preserving operational evidence:

- SMART metadata discovered.
- Scopes requested and granted.
- Resource types advertised and returned.
- `$everything` versus compartment-search path chosen.
- HTTP status classes, paging behavior, and rate-limit events.
- Attachment retrieval success or failure.
- Token expiry and refresh behavior.

This turns “it failed” into a reproducible provider compatibility report.

---

## Workstream 3: Reduce registration friction without hiding it

Dynamic Client Registration is worth pursuing where a provider advertises a registration endpoint, but support will remain inconsistent.

Build a registration ladder:

1. __Automatic DCR__ when metadata and policy permit it.
2. __Known shared registration__ when a client identifier can be distributed across participating institutions.
3. __Operator-supplied registration__ through the provider catalog for self-hosted instances.
4. __Documented manual import__ when registration is unavailable.

For operator-supplied registration, create a registration assistant that:

- Displays the callback URL and requested scopes in copyable form.
- Explains public versus confidential client configuration.
- Validates the FHIR base URL and SMART configuration before saving.
- Performs a preflight check for mismatched redirect URIs and missing endpoints.
- Stores client secrets only server-side.
- Generates a redacted diagnostic bundle suitable for a vendor support ticket.

A failure should end with a specific next action: correct local configuration, contact the provider, use portal export, or choose another source.

## Workstream 4: Turn the provider catalog into shared compatibility knowledge

A useful catalog needs more than institution names and logos. It should capture what actually works.

For each provider or network, model:

- Institution and EHR vendor.
- FHIR base URL and discovery status.
- Patient-facing authorization availability.
- Registration method and client type.
- Required scopes and known scope limits.
- `$everything` support or fallback behavior.
- Refresh-token behavior.
- Document and Binary availability.
- Last verification date and software version, when known.
- Evidence source and confidence level.

The Apple Health institution list can help prioritize institutions that appear to expose patient access, but it is not an endpoint registry and does not remove client-registration requirements. Pair it with public endpoint registries and direct verification rather than treating it as a source of connection settings.

A later community contribution flow could accept redacted compatibility reports. Keep submissions reviewable and separate observed facts from assumptions.

---

## Workstream 5: Add alternative acquisition routes selectively

### High-value candidates

- __CMS Blue Button 2.0.__ Useful for Medicare claims and a plausible first production proof, while recognizing that claims are not a complete clinical record.

- __VA Clinical Health.__ Already represented in the roadmap and potentially valuable to a defined patient population.

- __Manual patient-authored records.__ Essential for over-the-counter medications, symptoms, home measurements, family history, corrections, and records that never appear in an EHR export.

- __Wearable and device data.__ Useful when kept distinct from clinician-authored data and accompanied by device provenance.

### Optional commercial bridge

Consider a plugin interface for aggregators such as commercial health-data networks, but keep these adapters optional and clearly labeled. A bring-your-own-account connector could unblock some users without making a paid intermediary part of the core architecture. Before implementation, evaluate cost, redistribution rights, retention terms, supported institutions, and whether credentials can remain under the operator’s control.

### Defer

TEFCA/QHIN integration is strategically relevant but should remain a watch item until there is a practical participation path for a self-hosted consumer application. Do not let it displace near-term import and production-SMART work.

## Workstream 6: Differentiate after acquisition

Vendor restrictions matter less if YourPHR is uniquely useful once data arrives.

Priorities include:

- __Unified longitudinal view.__ Merge records across providers while preserving source provenance.
- __Patient annotations.__ Let users add context without altering the imported clinical source.
- __Local search and question answering.__ Explore the upstream RAG/Ollama work as an optional, local-first capability with citations back to source records.
- __Patient-controlled sharing.__ Evaluate scoped exports or SMART Health Links so a user can share selected information intentionally.
- __Data quality feedback.__ Flag contradictions, stale medication lists, duplicate conditions, and missing units as review prompts, not medical conclusions.

Local intelligence should never obscure provenance. Every generated answer or summary should point back to the exact records that support it.

---

## Workstream 7: Make access failures visible and actionable

Provider restrictions are easier to address when YourPHR can describe them precisely.

Add a patient-readable connection report that distinguishes:

- App registration denied or pending.
- Endpoint discovery failure.
- Redirect URI mismatch.
- Authentication failure.
- Requested scope denied.
- Successful authorization but empty result.
- Resource type omitted.
- Document metadata present but Binary unavailable.
- Rate limiting or transient provider outage.

Keep the default explanation plain-language, with expandable technical details. Offer a redacted export for support or regulatory complaints. Do not automatically characterize every limitation as unlawful information blocking; preserve the evidence and let the patient or an advocate decide whether to escalate.

An “access help kit” could include:

- A provider IT request template.
- A checklist of the exact information needed to register YourPHR.
- Links to official patient-access and information-blocking guidance.
- A record of attempts, dates, responses, and missing data categories.

## Recommended sequence

### Phase 1: Reliability first

- Finish robust archive and mixed-format import.
- Harden deduplication and provenance.
- Add import manifests and partial-failure recovery.
- Improve manual record entry.

__Outcome:__ YourPHR is useful even when no live connection is possible.

### Phase 2: One production proof

- Select a single production target using explicit criteria.
- Add the required catalog configuration and operator guide.
- Instrument the complete authorization and sync path.
- Publish a redacted compatibility report.

__Outcome:__ the project can demonstrate real patient access outside a sandbox.

### Phase 3: Scale what was learned

- Implement DCR where advertised and validated.
- Build the registration assistant.
- Expand the catalog through verified entries.
- Add redacted diagnostics and community compatibility reports.

__Outcome:__ each new provider costs less effort to onboard and troubleshoot.

### Phase 4: Increase patient value

- Add local search and record-grounded question answering.
- Improve cross-provider reconciliation and patient annotations.
- Add selective sharing and carefully chosen alternate sources.

__Outcome:__ YourPHR becomes more than an EHR mirror.

## What not to do yet

- Do not promise universal provider sync.
- Do not onboard many vendors before one production path is repeatable.
- Do not treat DCR as universally available.
- Do not scrape portals as the core architecture.
- Do not infer that a missing resource means the patient has no such clinical history.
- Do not make a commercial aggregator mandatory for the open-source product.
- Do not prioritize broad AI features before imports, provenance, and citations are trustworthy.

## Product message

A more durable promise than “connect to every provider” is:

> YourPHR gives you the best available path to bring your records home, preserve where they came from, understand what is missing, and use them privately.

That promise is honest about today’s ecosystem while still supporting the long-term goal of seamless live sync.

---

## Proposed next decisions

1. Choose the production target for issue #408 and assign a time-boxed validation effort.
2. Define a provider compatibility report schema before onboarding the next vendor.
3. Decide the minimum “portal export as-is” formats for the next import milestone.
4. Separate DCR discovery from implementation: first inventory real support, then build against verified targets.
5. Decide whether optional commercial connectors fit the project’s principles and maintenance capacity.
6. Define provenance and citation requirements before integrating local question answering.

## Sources

- YourPHR repository: <https://github.com/jwilleke/yourphr>
- Roadmap: <https://github.com/jwilleke/yourphr/blob/main/docs/Roadmap.md>
- SMART on FHIR flow map: <https://github.com/jwilleke/yourphr/blob/main/docs/architecture/SMART-flow-map.md>
- Production SMART provider issue: <https://github.com/jwilleke/yourphr/issues/408>
- Dynamic Client Registration issue: <https://github.com/jwilleke/yourphr/issues/355>
- Apple Health institution-list exploration: <https://github.com/jwilleke/yourphr/issues/251>
