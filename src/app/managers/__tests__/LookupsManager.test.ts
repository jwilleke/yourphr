/**
 * Lookups (yourphr#774): the server asks the NPI registry, never the browser, and only when the
 * operator binds a provider. The teeth: off by default says so; a single keystroke is never sent;
 * a failed lookup does not log the typed name; the provider reads NLM's answer shape faithfully.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Engine } from '../../../framework/Engine.js';
import { ApiContext } from '../../../framework/ApiContext.js';
import { LookupsManager } from '../LookupsManager.js';
import { NullNpiLookupProvider } from '../../providers/BaseNpiLookupProvider.js';
import { NlmNpiLookupProvider } from '../../providers/NlmNpiLookupProvider.js';

let nlm: Server;
let endpoint = '';
const asked: string[] = [];

beforeAll(async () => {
  nlm = createServer((req, res) => {
    asked.push(req.url ?? '');
    const terms = new URL(req.url ?? '/', 'http://x').searchParams.get('terms');
    if (terms === 'boom') { res.statusCode = 503; res.end('down'); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify([1, ['1234567890'], null, [[
      '1234567890', 'GRACE SYNTHETIC', 'Family Medicine Physician',
      JSON.stringify({ line1: '1 Main St', city: 'Springfield', state: 'OH', zip: '45501', country: 'US', phone: '555-0100', fax: '' }),
      '207Q00000X',
    ]]]));
  });
  await new Promise<void>((done) => nlm.listen(0, '127.0.0.1', done));
  endpoint = `http://127.0.0.1:${(nlm.address() as { port: number }).port}/api/npi_idv/v3/search`;
});
afterAll(() => { nlm.close(); });

async function boot(provider: NullNpiLookupProvider | NlmNpiLookupProvider): Promise<{ lookups: LookupsManager; lines: string[]; ctx: ApiContext }> {
  const engine = new Engine();
  const lines: string[] = [];
  const lookups = new LookupsManager(engine, provider, (l) => lines.push(l));
  engine.register('lookups', lookups);
  await engine.initialize();
  return { lookups, lines, ctx: ApiContext.system('test', 'jim', engine) };
}

describe('LookupsManager — the NPI registry, asked by the server (yourphr#774)', () => {
  it('is off by default, says why, and sends nothing', async () => {
    const { lookups, ctx, lines } = await boot(new NullNpiLookupProvider());
    const answer = await lookups.searchClinicians(ctx, 'grace');
    expect(answer).toEqual({ available: false, reason: expect.stringContaining('off on this instance'), results: [] });
    expect(lines[0]).toContain("provider 'null'");
  });

  it('with a provider bound, returns clinicians in the form\'s shape', async () => {
    asked.length = 0;
    const { lookups, ctx } = await boot(new NlmNpiLookupProvider({ allowInternal: true, endpoint }));
    const answer = await lookups.searchClinicians(ctx, 'grace syn');
    expect(answer.available).toBe(true);
    expect(answer.results).toEqual([{
      npi: '1234567890', name: 'GRACE SYNTHETIC', providerType: 'Family Medicine Physician', taxonomyCode: '207Q00000X',
      address: { line1: '1 Main St', line2: '', city: 'Springfield', state: 'OH', zip: '45501', country: 'US' }, phone: '555-0100', fax: '',
    }]);
    expect(asked[0]).toContain('terms=grace+syn');
    expect(asked[0]).toContain('df=NPI%2Cname.full');
  });

  it('never sends a single keystroke — under 2 characters asks nothing', async () => {
    asked.length = 0;
    const { lookups, ctx } = await boot(new NlmNpiLookupProvider({ allowInternal: true, endpoint }));
    expect((await lookups.searchClinicians(ctx, 'g')).results).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('a failed lookup is a 502 in plain words, and the log never carries what was typed', async () => {
    const { lookups, ctx, lines } = await boot(new NlmNpiLookupProvider({ allowInternal: true, endpoint }));
    await expect(lookups.searchClinicians(ctx, 'boom')).rejects.toMatchObject({ status: 502 });
    expect(lines.join('\n')).not.toContain('boom');
  });

  it('refuses nobody-signed-in and over-long searches', async () => {
    const { lookups } = await boot(new NullNpiLookupProvider());
    const engine = new Engine();
    await expect(lookups.searchClinicians(ApiContext.anonymous(engine), 'grace')).rejects.toMatchObject({ status: 401 });
    const { lookups: l2, ctx } = await boot(new NullNpiLookupProvider());
    await expect(l2.searchClinicians(ctx, 'x'.repeat(81))).rejects.toMatchObject({ status: 400 });
  });
});
