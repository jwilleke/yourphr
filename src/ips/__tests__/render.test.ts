import { describe, expect, it } from 'vitest';
import type { Bundle } from '@medplum/fhirtypes';
import { renderIpsHtml } from '../render.js';

/**
 * The summary as a page (yourphr#687). What matters here is that the file IS what it claims: a
 * person pressing "save as a web page" used to get the API's JSON envelope in a .html file.
 */
const bundle = (): Bundle => ({
  resourceType: 'Bundle',
  type: 'document',
  timestamp: '2026-09-24T12:00:00Z',
  entry: [
    {
      resource: {
        resourceType: 'Composition',
        id: 'ips-composition',
        status: 'final',
        type: { coding: [{ code: '60591-5' }] },
        date: '2026-09-24T12:00:00Z',
        title: 'International Patient Summary',
        author: [{ display: 'YourPHR' }],
        section: [
          { title: 'Allergies', text: { status: 'generated', div: '<div xmlns="http://www.w3.org/1999/xhtml"><h2>Allergies</h2><ul><li>Penicillin</li></ul></div>' } },
          { title: 'Medications', text: { status: 'generated', div: 'not a narrative' } },
        ],
      },
    },
    { resource: { resourceType: 'Patient', id: 'p1', name: [{ given: ['Jane'], family: 'Doe' }] } },
  ],
});

describe('the patient summary as a page', () => {
  it('is an HTML document, not an API envelope in a file named .html', () => {
    const html = renderIpsHtml(bundle());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).not.toContain('"success"');
  });

  it('shows the person and the date the record states, and no more', () => {
    const html = renderIpsHtml(bundle());
    expect(html).toContain('Jane Doe');
    expect(html).toContain('prepared 2026-09-24');
  });

  it('shows each section as the narrative the summary already wrote', () => {
    const html = renderIpsHtml(bundle());
    expect(html).toContain('<h2>Allergies</h2>');
    expect(html).toContain('<li>Penicillin</li>');
  });

  // An empty section would read as "nothing recorded", which is a different and worse claim than
  // "this could not be shown here".
  it('says when a section cannot be shown rather than rendering it empty', () => {
    const html = renderIpsHtml(bundle());
    expect(html).toContain('This section could not be shown here');
    expect(html).not.toContain('not a narrative');
  });

  it('warns, in the file itself, that it is readable by anyone who opens it', () => {
    expect(renderIpsHtml(bundle())).toContain('Anyone who opens it can read it');
  });

  it('carries no script and nothing fetched from elsewhere — it has to work offline, forever', () => {
    const html = renderIpsHtml(bundle());
    expect(html).not.toMatch(/<script|src=|href="http/);
  });

  it('says nothing about a person the bundle does not name', () => {
    const anonymous = bundle();
    anonymous.entry = anonymous.entry!.filter((e) => e.resource?.resourceType !== 'Patient');
    const html = renderIpsHtml(anonymous);
    expect(html).toContain('International Patient Summary');
    expect(html).not.toContain('Jane');
  });
});
