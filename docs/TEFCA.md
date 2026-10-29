# TEFCA — the national network, and what it could mean for yourPHR

Plain-language notes on TEFCA, the US government's framework for exchanging health records nationally, and on how yourPHR could use its __Individual Access Services__ to reach a patient's records at every participating hospital without registering with each vendor. Written 2026-10-15. Nothing here is decided. The wider picture (Carequality, CommonWell, CMS Aligned Networks) is in [`health-Interoperability-Frameworks.md`](./health-Interoperability-Frameworks.md), and the terms are in the [glossary](./Glossary.md#health-information-networks).

## What TEFCA is

__TEFCA__ (Trusted Exchange Framework and Common Agreement) is the "network of networks" that the 21st Century Cures Act (2016, § 4003) told HHS to create.

- __The Framework:__ the principles every participant agrees to.
- __The Common Agreement:__ the legal contract that makes them binding.
- __Standard Operating Procedures (SOPs):__ the detailed rules, one per topic.

### Who's behind it

| Role | Who |
|---|---|
| Sets policy | ASTP/ONC, part of HHS |
| Runs it day to day (the *Recognized Coordinating Entity*, RCE) | The Sequoia Project: <https://rce.sequoiaproject.org> |
| The hubs: __QHINs__ (Qualified Health Information Networks) | About __11__ designated as of 2026, including eHealth Exchange, Epic Nexus, Health Gorilla, KONZA, MedAllies, CommonWell, Kno2, Oracle Health and Surescripts. The official current list is on the RCE site. |
| Everyone else | Hospitals, clinics, health systems and apps join as *Participants* or *Subparticipants* of one QHIN |

Every QHIN connects to every other. Joining one QHIN reaches the whole network.

### What it carries

Each request states a __purpose__ (an *Exchange Purpose*): treatment, payment, public health, government benefits, and the one that matters here, __Individual Access Services (IAS)__.

## Individual Access Services (IAS)

IAS is how a __patient__, through an app of their choice, gets their own records from everyone on TEFCA.

How it works, in outline:

1. The patient uses an app that is an __IAS Provider__: an app that has joined TEFCA through a QHIN.
2. The app __verifies the patient's identity__ to a high standard (IAL2): a government ID plus a selfie, or a mobile driver's licence, through an approved credential service.
3. The app sends an __IAS query__. The network's __record locator__ finds the hospitals and clinics that hold records about that person.
4. Those organizations respond with the records, as documents (C-CDA) or, increasingly, FHIR.

The rules are in the IAS SOPs, which cover identity verification, privacy and security, and the purpose code `T-IAS`. Version 3.0 was effective 2026-08-03. IAS Providers that aren't covered by HIPAA must still meet TEFCA's privacy and security requirements.

Epic describes an IAS app joining by contracting with a QHIN, getting an entry in the RCE Directory, and querying Epic organizations over FHIR: <https://open.epic.com/Home/Interoperate/TEFCA/IAS>

## Why it matters for yourPHR

| Today, vendor by vendor | Through TEFCA IAS |
|---|---|
| Register with each EHR vendor; some need per-hospital activation (Epic: 522 organizations) | __One contract__ with one QHIN |
| Only hospitals on vendors we've registered with | Every TEFCA participant, Epic included |
| The patient has to know which hospitals hold their records | The __record locator finds them__ |
| The patient signs in at each hospital's portal | The patient proves who they are __once__ |

### Epic ID and MyChart Central in an IAS flow

__MyChart Central__ is Epic's single sign-on for MyChart: one __Epic ID__ that is linked to a patient's MyChart accounts at several organizations. Fasten Health announced on 2026-10-28 that its TEFCA IAS flow supports it. The patient signs in once with their Epic ID, picks the healthcare organizations linked to their MyChart, and authorizes all of them to share records in one pass. Fasten describes it as available for testing, with limited production support.

What it means for yourPHR:

- It removes the last "sign in at each hospital" step for Epic organizations, which even dynamic client registration on the direct SMART route doesn't (one MyChart sign-in per organization).
- It's reached through TEFCA IAS, so it carries the same contract, identity-proofing and cost questions below.
- A commercial app vendor building on TEFCA IAS plus Epic ID is a signal that this is the scaled patient path at Epic. The direct route (per-organization SMART, see [#924](https://github.com/jwilleke/yourphr/issues/924)) remains the one that works today.
- Add to the QHIN questions in __Next step__: whether MyChart Central is offered to IAS Providers in production, and through which QHINs.

## Who is an IAS Provider today

As of 2026-10-29, the RCE's [TEFCA for Individuals](https://rce.sequoiaproject.org/rce-tefca-for-individuals/) page lists __26 IAS Providers__.

- __3 are bidirectional__ (they fetch records and also share them): Doctronic, Fasten Health, and Health 100 Personal Health Records.
- __23 are request-only__ (they fetch, they don't share). Among them: b.well, Flexpa, HealthEx, Guava Health, SEQSTER, xCures, Consolidate Health, "SMART IAS", and several AI and legal-records companies.
- __Not on the list:__ Unblock Health, which announced TEFCA access with Health Gorilla and CLEAR in 2024, and Evidation.

How live it is:

- IAS SOP v3.0 took effect 2026-08-03. After the rollout, IAS traffic broke in early October and the RCE declared it restored on 2026-10-26, with some networks still troubleshooting ([RCE status](https://rce.sequoiaproject.org/current-status-of-ias-sop-version-3-0/)).
- The RCE connections map (last updated September 2026) showed only a few IAS Providers as live: Citizen.health, Doctronic, eHealth Technologies and Solverein.
- __CLEAR__ recurs as the IAL2 identity verifier (xCures, Unblock Health).

Epic's side:

- __Register once.__ An IAS app contracts with a QHIN and registers once with __Epic Nexus__; its client ID then syncs to every Epic Nexus participant that supports FHIR-based IAS ([open.epic](https://open.epic.com/Home/Interoperate/TEFCA/IAS)). Compare the 522 × 2 per-organization activations on the direct route ([#924](https://github.com/jwilleke/yourphr/issues/924)).
- __Precedent:__ HealthEx and Epic have turned on patient-directed access over TEFCA.

What it means for yourPHR:

- Every listed IAS Provider is a company with a contract. No free or open-source IAS Provider was found; yourPHR would be the first.
- __Health 100 Personal Health Records__ is the closest match: a PHR, and one of only 3 bidirectional providers. Worth learning how it's structured and priced.
- __"SMART IAS"__ is unidentified. If it's a shared IAS service for SMART apps, it could be a way in without yourPHR becoming an IAS Provider itself.

## Costs and catches

- __Fees:__ who can charge whom.

  | Who | Charges? |
  |---|---|
  | The patient | Nothing: federal rules don't allow charging for electronic access to one's own records |
  | Organizations answering an IAS or treatment query | Can't charge: the Common Agreement forbids fees for those queries |
  | One QHIN to another | Forbidden by the Common Agreement |
  | The RCE (Sequoia) | Nothing today; it has said it may add application, annual and testing fees later |
  | __A QHIN to its own participants__ (yourPHR) | __Set by each QHIN, not published, usually negotiated.__ eHealth Exchange says TEFCA connectivity costs its existing participants nothing extra |

  The only fee that matters for yourPHR is the joining QHIN's. It's unknown until we ask.
- __Identity proofing__ is required for every patient, and usually costs money per check through the credential service.
- __Format:__ much of what comes back is __C-CDA__ (summary documents), because the networks were built before FHIR. yourPHR already imports C-CDA. FHIR over TEFCA is on its roadmap.
- __Self-hosting is new territory.__ TEFCA expects an IAS Provider to be one accountable organization. yourPHR is many self-hosted installs. The likely shape is one yourPHR IAS registration run centrally, with records delivered to each patient's own install. That needs confirming with a QHIN before anything else.
- __Obligations:__ a contract, TEFCA's privacy and security requirements, and the operator answering for them.

## Next step

An investigation, not a build: ask two QHINs (for example Epic Nexus and Health Gorilla), and the RCE, whether a free, open-source, self-hosted patient app can be an IAS Provider, on what terms and at what cost, and how identity proofing works for it. Record the answers here.

Also ask:

- Epic Nexus: whether register-once applies to a self-hosted app with one central IAS registration.
- Health 100 Personal Health Records: how a PHR operates as a bidirectional IAS Provider.
- The RCE: who or what "SMART IAS" is, and whether apps can use it.

## Sources

- The Sequoia Project, RCE: <https://rce.sequoiaproject.org>
- IAS Exchange Purpose SOP v3.0 (June 2026, effective 2026-08-03): <https://rce.sequoiaproject.org/wp-content/uploads/2026/07/SOP-IAS-XP-v3_June2026_Clean_-5081.pdf>
- TEFCA Glossary (January 2026): <https://rce.sequoiaproject.org/wp-content/uploads/2026/01/TEFCA-Glossary_Jan-2026-v2_508.pdf>
- ASTP/ONC, the history and growth of TEFCA: <https://healthit.gov/resources/data-liquidity-affordability-and-access-the-history-growth-of-tefca/>
- Epic, TEFCA for Individual Access Services: <https://open.epic.com/Home/Interoperate/TEFCA/IAS>
- Health Gorilla, TEFCA for Individual Access Services: <https://www.healthgorilla.com/home/use-cases/ias>
- RCE, 11th QHIN designated (Oracle Health): <https://rce.sequoiaproject.org/new-designated-qhin-new-sops-and-more/>
- RCE, frequently asked questions: <https://rce.sequoiaproject.org/rce/faqs/>
- eHealth Exchange, TEFCA FAQs: <https://ehealthexchange.org/tefca-faqs/>
- Fasten Health newsletter, "Epic ID and MyChart Central Support for TEFCA" (email, 2026-10-28)
- RCE, TEFCA for Individuals (IAS Provider list): <https://rce.sequoiaproject.org/rce-tefca-for-individuals/>
- RCE, current status of IAS SOP v3.0: <https://rce.sequoiaproject.org/current-status-of-ias-sop-version-3-0/>
- RCE, TEFCA connections map: <https://rce.sequoiaproject.org/tefca-map-search/>
- Health Gorilla, Unblock Health collaboration (2024): <https://healthgorilla.com/blog/unblock-health-and-health-gorilla-announce-collaboration-to-enhance-patient-data-access-through-tefca>
- CMS, xCures pledge demo: <https://www.cms.gov/initiatives/health-technology-ecosystem/overview/pledge-demo-showcase/xcures>
- Healthcare IT News, HealthEx and Epic patient-directed access: <https://www.healthcareitnews.com/news/healthex-epic-turn-patient-directed-access-medical-records>
