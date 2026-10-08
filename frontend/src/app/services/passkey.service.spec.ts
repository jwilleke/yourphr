import {PasskeyService, credentialJSON, toB64url, toBuffer} from './passkey.service';

// #876: the browser half of passkeys, ported from ngdpbase's passkey.js.
describe('PasskeyService', () => {
  it('base64url round-trips bytes, without padding', () => {
    const bytes = new Uint8Array([0, 255, 62, 63, 1, 2, 3]);
    const text = toB64url(bytes.buffer);
    expect(text).not.toContain('=');
    expect(Array.from(new Uint8Array(toBuffer(text)))).toEqual(Array.from(bytes));
  });

  it('turns an enrolment credential into the JSON the server verifies, transports included', () => {
    const cred: any = {
      id: 'abc', rawId: new Uint8Array([1, 2]).buffer, type: 'public-key',
      response: {clientDataJSON: new Uint8Array([3]).buffer, attestationObject: new Uint8Array([4]).buffer, getTransports: () => ['internal']},
      getClientExtensionResults: () => ({}),
    };
    expect(credentialJSON(cred)).toEqual(jasmine.objectContaining({id: 'abc', rawId: 'AQI', response: {clientDataJSON: 'Aw', attestationObject: 'BA', transports: ['internal']}}));
  });

  it('turns an assertion into the sign-in JSON', () => {
    const cred: any = {
      id: 'abc', rawId: new Uint8Array([1]).buffer, type: 'public-key',
      response: {clientDataJSON: new Uint8Array([3]).buffer, authenticatorData: new Uint8Array([5]).buffer, signature: new Uint8Array([6]).buffer},
    };
    expect(credentialJSON(cred).response).toEqual({clientDataJSON: 'Aw', authenticatorData: 'BQ', signature: 'Bg'});
  });

  it('describes a cancelled request in plain words, and prefers the server\'s message otherwise', () => {
    const svc = new PasskeyService();
    expect(svc.describeError({name: 'NotAllowedError'}, 'x')).toContain('cancelled');
    expect(svc.describeError({error: {error: 'That did not confirm it is you.'}}, 'x')).toBe('That did not confirm it is you.');
    expect(svc.describeError({}, 'fallback')).toBe('fallback');
  });

  it('is usable only on the host passkeys are tied to', () => {
    const svc = new PasskeyService();
    spyOn(svc, 'supported').and.returnValue(true);
    expect(svc.usableOn(location.hostname)).toBeTrue();
    expect(svc.usableOn('phr.example.org')).toBeFalse();
    expect(svc.usableOn(null)).toBeFalse();
  });
});
