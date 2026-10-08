/**
 * Passkeys — WebAuthn (yourphr#876), ported from ngdpbase's `PasskeyAuthProvider` (its #448), on
 * `@simplewebauthn/server` directly, exactly as there.
 *
 * A passkey alone signs a person in (NIST SP 800-63B: a multi-factor cryptographic authenticator
 * suffices for AAL2), and it is phishing-resistant: the browser signs only for the relying party it
 * was created for.
 *
 * - The relying party is the host of `yourphr.application.base-url`, never the request, so a passkey
 *   works only on that hostname. The Sessions manager registers this provider only when that key is
 *   set and is a secure context (https, or localhost).
 * - Passkeys live in the credentials store, kind `passkey`: the subject is the credential id, the
 *   secret the public key and its counter. The Sessions manager hands this provider two narrow
 *   functions for that, so the store keeps one owner.
 * - The challenge is single-use and kept server-side by the caller; this provider only generates
 *   options and verifies responses.
 *
 * yourPHR differences: logging goes through an injected function (no global logger), and the
 * provider does not implement ngdpbase's AuthProvider interface — yourPHR's password-shaped
 * BaseAuthProvider does not fit a challenge/response factor, and the Sessions manager calls
 * these methods directly.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON
} from '@simplewebauthn/server';
import type { CredentialRecord } from './BaseCredentialsProvider.js';

/** What a passkey row's `secret` holds. Public material only. */
export interface PasskeySecret {
  publicKey: string;
  counter: number;
  /** As the authenticator reported them; v14 types transports as plain strings. */
  transports?: string[];
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
}

export interface PasskeyRelyingParty {
  /** The host of base-url — the relying-party id. */
  rpID: string;
  /** The origin of base-url — what the browser must report. */
  origin: string;
  /** Shown by the authenticator when creating a passkey. */
  rpName: string;
}

/** The store access the Sessions manager grants: find by credential id, record a use. */
export interface PasskeyStoreAccess {
  find(credentialId: string): CredentialRecord | null;
  used(id: string, at: string, secret: string): Promise<void>;
}

/** The base-url origin, its host, and whether WebAuthn may run there (https, or localhost). */
export function relyingPartyFrom(baseUrl: string, rpName: string): PasskeyRelyingParty | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  return { rpID: url.hostname, origin: url.origin, rpName };
}

function parseSecret(secret: string): PasskeySecret | null {
  try {
    const s = JSON.parse(secret) as PasskeySecret;
    return typeof s.publicKey === 'string' && typeof s.counter === 'number' ? s : null;
  } catch {
    return null;
  }
}

/** ngdpbase's factor description: what a passkey sign-in proves. */
export interface FactorDescription { amr: string[]; aal: 0 | 1 | 2 | 3; acr?: 'phr' | 'phrh'; primary: boolean }

/** The WebAuthn assertion a sign-in presents, and the challenge it must answer. */
export interface PasskeyAssertion { response: unknown; expectedChallenge: string }

export class PasskeyAuthProvider {
  readonly id = 'passkey';
  readonly displayName = 'Passkey';
  /**
   * Something you have (the key) unlocked by something you know or are (the
   * PIN or biometric the authenticator requires): AAL2, phishing-resistant.
   * `swk` because most passkeys sync; a device-bound key is stronger, never
   * weaker, than what is claimed here.
   */
  readonly factor: FactorDescription = { amr: ['swk', 'user'], aal: 2, acr: 'phr', primary: true };

  constructor(private readonly rp: PasskeyRelyingParty, private readonly store: PasskeyStoreAccess, private readonly log: (line: string) => void = () => undefined) {}

  /** The relying party passkeys are tied to — for the admin page and the enrol screen. */
  relyingParty(): PasskeyRelyingParty {
    return { ...this.rp };
  }

  /** Options for enrolling a passkey; `existing` keeps one authenticator from enrolling twice. */
  async registrationOptions(username: string, displayName: string, existing: readonly CredentialRecord[]): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return generateRegistrationOptions({
      rpName: this.rp.rpName,
      rpID: this.rp.rpID,
      userName: username,
      userDisplayName: displayName || username,
      attestationType: 'none',
      excludeCredentials: existing.map(c => ({ id: c.subject, transports: parseSecret(c.secret)?.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
    });
  }

  /** Verify an enrolment; returns what the credentials store keeps, or null when it does not verify. */
  async verifyRegistration(response: RegistrationResponseJSON, expectedChallenge: string): Promise<{ subject: string; secret: string } | null> {
    try {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.rp.origin,
        expectedRPID: this.rp.rpID,
        requireUserVerification: true
      });
      if (!result.verified) return null;
      const info = result.registrationInfo;
      const secret: PasskeySecret = {
        publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
        counter: info.credential.counter,
        transports: info.credential.transports,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp
      };
      return { subject: info.credential.id, secret: JSON.stringify(secret) };
    } catch (err) {
      this.log(`passkey: enrolment did not verify: ${(err as Error).message}`);
      return null;
    }
  }

  /** Options for signing in: no username asked, any passkey for this host may answer. */
  async authenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return generateAuthenticationOptions({ rpID: this.rp.rpID, userVerification: 'required' });
  }

  /**
   * Verify a sign-in. The credential id names the passkey; its public key and
   * counter come from the store. A counter that does not move forward (where
   * the authenticator keeps one) is a cloned key and fails.
   */
  async verify(assertion: PasskeyAssertion | undefined): Promise<{ username: string; credentialId: string } | null> {
    if (!assertion) return null;
    const response = assertion.response as AuthenticationResponseJSON;
    const row = typeof response?.id === 'string' ? this.store.find(response.id) : null;
    const secret = row ? parseSecret(row.secret) : null;
    if (!row || !secret) return null;
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: assertion.expectedChallenge,
        expectedOrigin: this.rp.origin,
        expectedRPID: this.rp.rpID,
        credential: {
          id: row.subject,
          publicKey: new Uint8Array(Buffer.from(secret.publicKey, 'base64url')),
          counter: secret.counter,
          transports: secret.transports
        },
        requireUserVerification: true
      });
      if (!result.verified) return null;
      const next: PasskeySecret = { ...secret, counter: result.authenticationInfo.newCounter, backedUp: result.authenticationInfo.credentialBackedUp };
      await this.store.used(row.id, new Date().toISOString(), JSON.stringify(next));
      return { username: row.username, credentialId: row.id };
    } catch (err) {
      this.log(`passkey: sign-in did not verify for credential ${row.id}: ${(err as Error).message}`);
      return null;
    }
  }
}
