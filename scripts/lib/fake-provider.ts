/**
 * The fake FHIR provider (yourphr#610): one loopback server that answers SMART discovery, a token
 * endpoint, and a handful of synthetic resources per type — shared by the app harness and the E2E
 * journeys so both test against the same, PHI-free provider.
 */
import { createServer, type ServerResponse } from 'node:http';

export function startFakeProvider(token: string) {
  return createServer((req, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    // SMART discovery + token endpoint (yourphr#603): enough for authorize -> connect -> first sync.
    if (url.pathname === '/.well-known/smart-configuration') {
      const origin = `http://${req.headers.host}`;
      send(200, { authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token` });
      return;
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'good-code' && (form.get('code_verifier') ?? '').length > 20) {
          send(200, { access_token: token, refresh_token: 'ref', token_type: 'bearer', expires_in: 3600, patient: 'pa' });
        } else {
          send(400, { error: 'invalid_grant' });
        }
      });
      return;
    }
    if ((req.headers['authorization'] ?? '') !== `Bearer ${token}`) {
      send(401, { error: 'nope' });
      return;
    }
    const type = url.pathname.replace('/', '');
    // The person this connection was issued for (yourphr#761): the id the token names, with the
    // demographics a portal states. What makes the identity question answerable end to end.
    // Read by id, as the sync does it (`GET Patient/{id}`), and as a search — one person either way.
    if (type === 'Patient' || type.startsWith('Patient/')) {
      const patient = { resourceType: 'Patient', id: 'pa', name: [{ given: ['Jane'], family: 'Doe' }], birthDate: '1971-04-02', gender: 'female', identifier: [{ system: 'http://fake.example.org/mrn', value: 'E12345' }] };
      send(200, type === 'Patient' ? { resourceType: 'Bundle', type: 'searchset', entry: [{ resource: patient }] } : patient);
      return;
    }
    const entry = type === 'MedicationStatement'
      ? [{ resource: { resourceType: type, id: 'ms-1', status: 'active', medicationCodeableConcept: { text: 'Lisinopril 10 MG' } } }]
      : [1, 2, 3].map((i) => ({ resource: { resourceType: type, id: `${type.toLowerCase()}-${i}`, code: { text: `synthetic ${type} ${i}` }, recordedDate: '2024-01-10' } }));
    send(200, { resourceType: 'Bundle', type: 'searchset', entry });
  });
}


/** Listen on a loopback port and return the base URL. */
export function listenFake(server: ReturnType<typeof startFakeProvider>): Promise<string> {
  return new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`));
  });
}
