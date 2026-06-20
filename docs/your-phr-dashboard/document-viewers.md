# Document viewers

How YourPHR displays document attachments — the actual bytes behind a `DocumentReference`, a `DiagnosticReport.presentedForm`, or any FHIR `Binary` resource.

## Where documents come from

A document reaches the viewer as a FHIR [`Binary`](https://www.hl7.org/fhir/binary.html) (a `contentType` + base64 `data`). It can arrive three ways:

- **Inline** — the attachment already carries `data` (e.g. Synthea bundles, many manual uploads).
- **By reference** — the attachment has only a `url` pointing to a separate `Binary` (e.g. `Binary/{id}`, or an absolute `…/Binary/{id}`). This is the shape Oracle Health / Cerner and most SMART exports produce; the import engine fetches and stores the `Binary` ([#342](https://github.com/jwilleke/yourphr/issues/342)).
- **Raw upload** — a PDF/image/DICOM uploaded directly is wrapped as a `DocumentReference` + `Binary` on import ([#255](https://github.com/jwilleke/yourphr/issues/255)).

Resolution happens in `FastenApiService.getBinaryModel()` (`frontend/src/app/services/fasten-api.service.ts`): if the attachment is a reference (`url`, no `data`), it parses the `Binary/{id}` out of the URL and fetches the stored resource; otherwise it uses the inline data. The host component is `fhir-binary` (`frontend/src/app/components/fhir-card/resources/binary/binary.component.ts`), which dispatches to a type-specific viewer by `contentType`.

## Supported content types

| Content type | Viewer component | Rendering |
|---|---|---|
| `application/pdf` | `fhir-pdf` | `<embed>` with a `data:` URI (via `DomSanitizer`) |
| `image/jpeg`, `image/png` | `fhir-img` | `<img>` with a `data:` URI |
| `text/plain` | `fhir-binary-text` | decoded text in `<pre>` |
| `text/html`, `application/html` | `fhir-html` | sanitized HTML (`DomSanitizer`) |
| `text/markdown` | `fhir-markdown` | rendered markdown |
| `text/rtf` | `fhir-rtf` | parsed to HTML via `rtf.js` |
| `application/xml`, `application/json` | (inline) | syntax-highlighted via `ngx-highlightjs` |
| `application/dicom` | `fhir-dicom` | DICOM viewer via `dwv` (pan/zoom/windowing + metadata) |

All viewer components live under `frontend/src/app/components/fhir-card/datatypes/`.

## Behaviors (all content types)

- **Download** — every rendered document shows a **Download** button that saves the bytes to the user's device, including content types the inline viewer can't render well (e.g. `text/xml`). The filename comes from the attachment `title` plus an extension inferred from the `contentType`. ([#349](https://github.com/jwilleke/yourphr/issues/349))
- **Unavailable documents** — when a referenced `Binary` can't be retrieved (not downloaded yet, or skipped as oversized on import), the viewer shows a clear "document could not be retrieved" message instead of a broken/empty state. ([#349](https://github.com/jwilleke/yourphr/issues/349))
- **Unknown content type** — a type with no matching viewer shows an "Unknown Binary content type" message; the Download button is still available so the user can open it in a native app.

## Where documents appear

Attachments render on the **resource-detail page** (`/explore/:source_id/resource/:resource_id`), where the card is shown with `showDetails=false`. In list/summary views attachments are intentionally not rendered (a "details" link routes to the detail page) to keep lists light. A `DocumentReference`/`DiagnosticReport` with multiple attachments shows them as tabs.

## Notes / limitations

- The PDF and HTML viewers use `DomSanitizer.bypassSecurityTrust*`. Documents come from external providers, so a hardening pass on sanitization is worth doing (the HTML viewer carries a TODO).
- Very large attachments are skipped at import time (size cap) and surface as "unavailable" here — see [#342](https://github.com/jwilleke/yourphr/issues/342).
- End-to-end coverage: `frontend/e2e/binary-document.spec.ts` seeds a `DocumentReference → Binary` and asserts render + download in a real browser.
