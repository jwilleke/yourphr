# Security Policy

YourPHR is a self-hosted __Personal Health Record__ viewer — a community continuation of Fasten OnPrem (GPL v3). It stores and displays __Protected Health Information (PHI)__ and personally identifying information (PII), so security and privacy are first-order concerns.

## ⚠️ Never include real PHI/PII in a report

When reporting a bug or a vulnerability — in a GitHub issue, a security advisory, logs, screenshots, or attached files — __never include real patient data, personal identifiers, access tokens, secrets, or database files.__ Reproduce with __synthetic data only__ (e.g. Synthea-generated FHIR bundles). A leak of real PHI is irreversible. If you believe real PHI has actually been exposed somewhere, say so privately (see below) — but do not attach the data itself.

## Reporting a vulnerability

Please report security vulnerabilities __privately__, not in a public issue:

- __Preferred:__ GitHub __private vulnerability reporting__ — go to the repository's __Security__ tab → __Report a vulnerability__ (GitHub Security Advisories). This keeps the report private until a fix is ready.
- Include: the affected version/commit, a __synthetic-data__ reproduction, the impact, and any suggested fix.

We aim to acknowledge reports within a few days and to coordinate a fix and a disclosure timeline with you. There is no paid bug-bounty program.

## Supported versions

YourPHR ships from `main` (rolling release). Security fixes land on `main` and the published `ghcr.io/jwilleke/yourphr:main-<N>` images — run the latest. Older image tags are not separately patched.

## For operators — handling secrets & data

- __Never commit__ secrets, keys, `.env`, real FHIR bundles, or the SQLite DB. See the "NEVER commit personal health data or unencrypted secrets" section of `AGENTS.md`. `*.db`, `/db/`, `.env`, `certs/`, and key files are gitignored — keep them that way. The `.env.*.example` templates are committed and must never hold a real value.
- DB encryption is __on by default__. There is no default `jwt.issuer.key` — a strong one is generated and persisted at `<data>/.jwt_issuer_key` on first start. Pin your own via `YOURPHR_JWT_ISSUER_KEY` only if you have a reason to.
- The app is meant to run behind your own authentication and network controls (e.g. a reverse proxy / forward-auth) on a trusted network — it is not hardened for direct exposure to the public internet.

## Attribution

Built on Fasten OnPrem by Jason Kulatunga ([@AnalogJ](https://github.com/AnalogJ)) and contributors (GPL v3); attribution retained.
