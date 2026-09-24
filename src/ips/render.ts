/**
 * The patient summary as a page a person can read (yourphr#687).
 *
 * "Save Report" and "Send to Email" both asked for a FORMAT — html, pdf, json — and the endpoint
 * ignored it, returning the API envelope every time. So a person pressing *save as HTML* got a file
 * called `yourphr-records.html` holding `{"success":true,"data":{…}}`: not a document, not a bundle
 * another system could import, and not obviously wrong until they opened it.
 *
 * What this renders is only what the IPS already states. Every section's body is the FHIR narrative
 * the composer wrote (`section.text.div`) — the same words the standard says a receiving system may
 * show when it cannot process the structured data. Nothing is summarised again here, and nothing
 * that is not in the bundle appears.
 *
 * There is no PDF. Producing one needs a renderer this stack does not have, and a `.pdf` containing
 * something else is the defect being fixed rather than a smaller version of it. The page prints.
 */
import type { Bundle, Composition } from '@medplum/fhirtypes';

/** Escapes text for HTML. The narratives are already XHTML and are NOT escaped — see below. */
function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The narrative is XHTML the composer built from escaped values, so it is embedded as markup.
 * Everything that reaches it goes through `escapeXhtml` first, which is what makes that safe; the
 * guard here is that only a `<div …>` from that builder is accepted, and anything else is dropped
 * rather than trusted.
 */
function narrative(div: unknown): string {
  const text = typeof div === 'string' ? div.trim() : '';
  return /^<div\s+xmlns="http:\/\/www\.w3\.org\/1999\/xhtml">[\s\S]*<\/div>$/.test(text) ? text : '';
}

/** A person's name as the record states it — no initials invented, no placeholder. */
function patientName(bundle: Bundle): string {
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource as { resourceType?: string; name?: { text?: string; given?: string[]; family?: string }[] } | undefined;
    if (resource?.resourceType !== 'Patient') continue;
    for (const n of resource.name ?? []) {
      if (n.text) return n.text.trim();
      const joined = [...(n.given ?? []), n.family ?? ''].filter(Boolean).join(' ').trim();
      if (joined !== '') return joined;
    }
  }
  return '';
}

/** The IPS as a self-contained HTML document: no scripts, no external anything. */
export function renderIpsHtml(bundle: Bundle): string {
  const composition = (bundle.entry ?? []).map((e) => e.resource).find((r) => r?.resourceType === 'Composition') as Composition | undefined;
  const title = composition?.title ?? 'Patient summary';
  const who = patientName(bundle);
  const when = composition?.date ?? bundle.timestamp ?? '';

  const sections = (composition?.section ?? [])
    .map((s) => {
      const body = narrative(s.text?.div);
      // A section whose narrative cannot be shown says so rather than appearing empty, which would
      // read as "nothing recorded" — a different and worse claim.
      return body === ''
        ? `<section><h2>${escapeText(s.title ?? 'Section')}</h2><p class="none">This section could not be shown here. The full record is in the FHIR download.</p></section>`
        : `<section>${body}</section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}${who ? ` — ${escapeText(who)}` : ''}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; margin: 2rem auto; max-width: 48rem; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.6rem; margin-bottom: .25rem; }
  h2 { font-size: 1.15rem; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: .25rem; }
  ul { padding-left: 1.25rem; }
  li { margin: .2rem 0; }
  .meta { color: #666; font-size: .9rem; }
  .none { color: #666; font-style: italic; }
  .warning { border: 1px solid #e0b400; background: #fff9e6; padding: .75rem 1rem; border-radius: .25rem; margin: 1.5rem 0; }
  @media print { .warning { border-color: #999; background: none; } }
</style>
</head>
<body>
<h1>${escapeText(title)}</h1>
<p class="meta">${who ? `${escapeText(who)} · ` : ''}${when ? `prepared ${escapeText(when.slice(0, 10))}` : ''}</p>
<div class="warning">
  This file holds your medical summary in plain text. Anyone who opens it can read it — email, cloud folders and
  messaging apps included. Send it only where you mean it to go.
</div>
${sections}
</body>
</html>
`;
}
