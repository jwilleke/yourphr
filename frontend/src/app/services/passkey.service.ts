import {Injectable} from '@angular/core';

/**
 * The browser half of passkeys (yourphr#876), ported from ngdpbase's public/js/passkey.js: turn the
 * server's JSON options into what navigator.credentials wants (base64url → bytes), and the
 * browser's credential back into the JSON @simplewebauthn/server verifies.
 */
@Injectable({providedIn: 'root'})
export class PasskeyService {
  /** Whether this browser can use passkeys at all. Hidden, not offered, where it cannot. */
  supported(): boolean {
    return typeof window !== 'undefined' && typeof (window as any).PublicKeyCredential === 'function'
      && !!navigator.credentials;
  }

  /**
   * Whether passkeys work HERE: the browser can use them and the page is on the host they are tied
   * to. On another name for the same server (an IP, a LAN name) the browser refuses them.
   */
  usableOn(host: string | null | undefined): boolean {
    return !!host && this.supported() && globalThis.location?.hostname === host;
  }

  /** Sign in or confirm: answer an authentication challenge with any passkey for this site. */
  async assert(options: any): Promise<any> {
    const publicKey = {...options, challenge: toBuffer(options.challenge)};
    if (Array.isArray(options.allowCredentials)) {
      publicKey.allowCredentials = options.allowCredentials.map((c: any) => ({...c, id: toBuffer(c.id)}));
    }
    const cred = await navigator.credentials.get({publicKey}) as PublicKeyCredential;
    return credentialJSON(cred);
  }

  /** Enrol: create a passkey for the options the server issued. */
  async create(options: any): Promise<any> {
    const publicKey = {
      ...options,
      challenge: toBuffer(options.challenge),
      user: {...options.user, id: toBuffer(options.user.id)},
      excludeCredentials: (options.excludeCredentials || []).map((c: any) => ({...c, id: toBuffer(c.id)})),
    };
    const cred = await navigator.credentials.create({publicKey}) as PublicKeyCredential;
    return credentialJSON(cred);
  }

  /**
   * A starting name for a new passkey: the browser and the kind of device (ngdpbase#1591). Browsers
   * never reveal a device's own name; Chromium can report a phone model, which replaces the word.
   */
  async suggestedName(): Promise<string> {
    const ua = navigator.userAgent || '';
    const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    let device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone'
      : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'this device';
    const data = (navigator as any).userAgentData;
    if (data?.getHighEntropyValues) {
      try {
        const v = await data.getHighEntropyValues(['model']);
        if (v?.model) device = v.model;
      } catch { /* the generic word stands */ }
    }
    return `${browser} on ${device}`;
  }

  /** The person's words for what went wrong — never the browser's exception text. */
  describeError(err: any, fallback: string): string {
    if (err?.name === 'NotAllowedError') return 'The passkey request was cancelled or timed out.';
    if (err?.name === 'InvalidStateError') return 'This device already has a passkey for this site.';
    return err?.error?.error || fallback;
  }
}

export function toBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '===='.slice(b64.length % 4);
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function toB64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The @simplewebauthn JSON shape, exactly as ngdpbase's credentialJSON builds it. */
export function credentialJSON(cred: PublicKeyCredential): any {
  const r = cred.response as any;
  const response: any = {clientDataJSON: toB64url(r.clientDataJSON)};
  if (r.attestationObject) {
    response.attestationObject = toB64url(r.attestationObject);
    if (typeof r.getTransports === 'function') response.transports = r.getTransports();
  } else {
    response.authenticatorData = toB64url(r.authenticatorData);
    response.signature = toB64url(r.signature);
    if (r.userHandle) response.userHandle = toB64url(r.userHandle);
  }
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    response,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: (cred as any).authenticatorAttachment || undefined,
  };
}
