# Legal documents

The Privacy Policy and Terms of Service moved out of the docs tree in [#463](https://github.com/jwilleke/yourphr/issues/463), and moved again when the Go stack was deleted ([#677](https://github.com/jwilleke/yourphr/issues/677)). They are no longer markdown files: they are string constants in [`src/legal/shipped.ts`](../../src/legal/shipped.ts), so the build carries them with no asset step.

They live beside the Go package because they are __embedded into the binary__ with `go:embed`, which cannot reach outside its own package directory. Embedding is what lets an instance serve its own policy with no external dependency — an offline home server still shows its terms, and there is no file to forget to mount.

| | |
|---|---|
| Source | [`src/legal/shipped.ts`](../../src/legal/shipped.ts) — `SHIPPED_PRIVACY_POLICY` and `SHIPPED_TERMS_OF_SERVICE` |
| Served at | `/privacy` and `/terms` on every instance |
| Operator override | `<data>/config/privacy-policy.md`, `<data>/config/terms-of-service.md` |
| Public copies | `yourphr.org/privacy.html`, `/terms.html` (gh-pages) — for people evaluating before installing |

See [`docs/deployment/README.md`](../deployment/README.md) for the operator override, and [`docs/EHR-vendors/cms-medicare/cms-bluebutton-production-access.md`](../EHR-vendors/cms-medicare/cms-bluebutton-production-access.md) for the CMS pre-approval rule that applies after production approval.
