# Legal document sources

`privacy-policy.md` and `terms-of-service.md` are the source of truth for YourPHR's Privacy Policy and Terms. They are embedded into the binary with `go:embed` and served by every instance at `/web/privacy` and `/web/terms` ([#463](https://github.com/jwilleke/yourphr/issues/463)).

__Maintainer notes live here, not in the documents.__ Anything written into those files is rendered to a patient reading a legal page. A line like *"update `gh-pages` `privacy.html` when you change it"* is an instruction to us and was appearing in the served output.

## After editing either file

1. Republish the public copies on `gh-pages` — `privacy.html` and `terms.html` are a separate manual copy, not generated from these files.
2. Consider whether the change is substantive. `Last updated:` should move for a change of meaning, not for a typo or a link fix — the date is what a reader uses to decide whether to re-read.
3. Note that the __digest changes__ whenever the bytes change. `Digest()` hashes the Markdown, and that digest is displayed at the foot of the served page and is intended to pin consent records ([#465](https://github.com/jwilleke/yourphr/issues/465)). A cosmetic edit therefore produces a new digest, so avoid churn once consent pinning ships.

## Links inside these documents

They are read in three places, and a link that works in one can break the others:

| Context | Path |
|---|---|
| Served by an instance | `/web/privacy`, `/web/terms` — __the one patients actually read__ |
| GitHub | the `.md` files in this directory |
| yourphr.org | `privacy.html`, `terms.html` on `gh-pages` |

Cross-references between the two documents use a __page-relative__ target (`terms`, `privacy`) rather than `terms-of-service.md` or `/web/terms`:

- `terms-of-service.md` worked on GitHub and 404'd on the served page — the bug this note exists because of.
- `/web/terms` breaks on any instance served under a `web.listen.basepath` prefix.
- `terms` resolves against the current page, so `/web/privacy` → `/web/terms` and `/foo/web/privacy` → `/foo/web/terms`.

The trade is that the link is not clickable when browsing this directory on GitHub. That is the right way round: the served page is the product, and its readers are patients rather than developers.

__Do not use trailing two-space hard breaks.__ Blackfriday renders them as `<br>`, which produced arbitrary mid-sentence line breaks in the served HTML. Use a blank line for a new paragraph.

## Operator overrides

An operator can replace either document by dropping `privacy-policy.md` or `terms-of-service.md` into `<data>/config/`. The served page states whether it is showing the operator's document or the shipped one, so a patient can tell whose terms they are reading.
