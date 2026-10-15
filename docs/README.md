# yourPHR documentation

Your medical records, immediately and in your hands — for free.

Start with the section that fits what you're doing.

## Using yourPHR

| Document | What it covers |
|---|---|
| [Glossary](./Glossary.md) | Plain-language meanings for the words around medical records |
| [Demo mode](./guides/demo-mode.md) | The public demo and its read-only admin |
| [Connected devices](./devices/README.md) | Mobile device apps, and patient-entered implants |
| [Importing C-CDA](./import/c-cda.md) | Uploading health summaries downloaded from a patient portal |

## Getting your records from providers

| Document | What it covers |
|---|---|
| [EHR vendors](./EHR-vendors/README.md) | One folder per vendor (Epic, Oracle, NextGen, eClinicalWorks, Greenway and more), plus a [registration comparison](./EHR-vendors/registration-comparison.md) |
| [Health interoperability frameworks](./health-Interoperability-Frameworks.md) | National networks: TEFCA, Carequality, CommonWell, CMS Aligned Networks, payer APIs |
| [TEFCA](./TEFCA.md) | The government's national network, and Individual Access Services |

## Running yourPHR

| Document | What it covers |
|---|---|
| [Deployment](./deployment/README.md) | Installing and configuring an instance; the [deployment contract](./deployment/deployment-contract.md); [upgrading from v2](./deployment/upgrading-v2-to-v3.md) |
| [Email setup](./admin/email-setup.md) | Outbound mail for notifications |
| [Backup and recovery](./recovery/README.md) | The backup model and data recovery |

## How it works

| Document | What it covers |
|---|---|
| [Architecture](./architecture/architecture.md) | The system as a whole |
| [Configuration system](./architecture/configuration-system.md) | How settings are layered and edited |
| [SMART flow map](./architecture/SMART-flow-map.md) | How a provider connection works, step by step |
| [Connection policy](./architecture/connection-policy.md) | Which sources a person may connect |
| [Provider catalog](./architecture/provider-catalog.md) | Admin-configured provider entries |
| [Agent access policy](./architecture/agent-access-policy.md) | AI agents reading records through agent tokens |
| [Dependency scanning](./architecture/dependency-scanning.md) | How vulnerable dependencies are found |

## Health data

| Folder | What it covers |
|---|---|
| [FHIR](./FHIR/) | FHIR versions, USCDI vs US Core, the C-CDA converter, edge cases |
| [US Core](./us-core/README.md) | US Core support and display-conformance coverage |
| [Dashboard and display](./your-phr-dashboard/README.md) | Classification, patient-legible display, document viewers |

## Developing yourPHR

| Document | What it covers |
|---|---|
| [Dev servers](./development/devserver.md) | Running yourPHR locally |
| [Testing and test data](./development/testing-and-data.md) | Test suites and synthetic data |
| [Test sandboxes](./development/test-sandboxes.md) | Vendor sandboxes and their test patients |
| [Data-quality framework](./development/data-quality-framework.md) | How messy real-world data is handled |
| [SMART on FHIR testing](./FHIR/fhir-testing.md) | Testing the connect flow |
| [Releasing](./development/releasing.md) | Cutting a release |
| [Performance](./performance/) | The latest performance baselines (older ones are in git history) |

## Plans and history

| Document | What it covers |
|---|---|
| [Roadmap](./Roadmap.md) | Where yourPHR is going |
| [YourPHR on ngdpbase: direction](./planning/ngdp-move.md) | The lead document for yourPHR's direction |
| [Planning](./planning/) | Active plans, design notes and reviews |
| [Archive](./archive/README.md) | Finished work: the move from Go to TypeScript |
| [Legal](./legal/README.md) and [Attributions](./Attributions.md) | Terms, privacy, third-party credits |
