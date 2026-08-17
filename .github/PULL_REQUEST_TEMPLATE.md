<!-- Thanks for contributing to YourPHR! Keep PRs focused; one logical change per PR. -->

## Summary

<!-- What does this PR do, and why? -->

## Related issue

<!-- e.g. Fixes #123 — link the issue this addresses. -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Docs
- [ ] Refactor / chore
- [ ] CI / build

## Checklist

- [ ] __No PHI/PII, secrets, keys, `.env`, real FHIR bundles, or `*.db` files__ are included — only synthetic fixtures (this is a Personal Health Record app; a leak is irreversible).
- [ ] Tests pass (`make test`) and I added/updated tests where it makes sense.
- [ ] Lint passes (`make lint-frontend`; markdownlint for docs).
- [ ] If I changed a tygo-exported Go struct or `search-parameters.json`, I re-ran `make generate-backend` and committed the regenerated files.
- [ ] Docs updated if behavior or architecture changed.
