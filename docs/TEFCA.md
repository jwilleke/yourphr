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
