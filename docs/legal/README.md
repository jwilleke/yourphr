# Legal documents

The Privacy Policy and Terms of Service sources moved to [`backend/pkg/legal/`](../../backend/pkg/legal/) in [#463](https://github.com/jwilleke/yourphr/issues/463).

They live beside the Go package because they are __embedded into the binary__ with `go:embed`, which cannot reach outside its own package directory. Embedding is what lets an instance serve its own policy with no external dependency — an offline home server still shows its terms, and there is no file to forget to mount.

| | |
|---|---|
| Source | [`backend/pkg/legal/privacy-policy.md`](../../backend/pkg/legal/privacy-policy.md), [`backend/pkg/legal/terms-of-service.md`](../../backend/pkg/legal/terms-of-service.md) |
| Served at | `/privacy` and `/terms` on every instance |
| Operator override | `<data>/config/privacy-policy.md`, `<data>/config/terms-of-service.md` |
| Public copies | `yourphr.org/privacy.html`, `/terms.html` (gh-pages) — for people evaluating before installing |

See [`docs/deployment/README.md`](../deployment/README.md) for the operator override, and [`docs/cms-bluebutton-production-access.md`](../cms-bluebutton-production-access.md) for the CMS pre-approval rule that applies after production approval.
