// This deployment's effective SMART on FHIR OAuth relay settings, served by
// GET /secure/source/relay-config (#399, extended in #402). The relay is a deployment concern, so
// these values come from the backend at runtime — they are NOT compiled into the frontend bundle.

// Where a resolved value came from. The operator-facing question is rarely "is this URL right" but
// "is my configuration being read at all" — a value that silently fell back to a default looks
// identical to one set on purpose, which is what made #399 and #397 hard to diagnose.
export type RelayValueSource =
  // the key itself carries a value
  | 'configured'
  // public_url was not set, so the (public https) poll URL was reused
  | 'inherited'
  // nothing was set — this is the built-in project relay
  | 'default'
  // no value and no default (only meaningful for the secret)
  | 'unset';

export interface RelayResolvedValue {
  value: string;
  source: RelayValueSource;
  // Where the value WOULD be set. Absent when the value is a built-in default, since there is no
  // key to point at. Naming both forms is deliberate: the backend cannot reliably tell config.yaml
  // from an environment variable, so claiming one would be a guess.
  config_key?: string;
  env_var?: string;
}

export interface RelayConfig {
  // The OAuth redirect_uri this instance uses. This is the value the operator must register with
  // each FHIR vendor; it must match exactly.
  callback_url: string;
  // Whether a relay shared secret is configured. Retained under its original name from #399.
  configured: boolean;
  // True when a relay-poll connect can actually complete.
  ready: boolean;
  // The public origin providers redirect the browser to (`callback_url` minus /callback).
  public_url: RelayResolvedValue;
  // Where the backend polls /pending — may legitimately be private/cluster-internal.
  poll_url: RelayResolvedValue;
  // Presence and provenance of the shared secret. `value` is ALWAYS empty — never echoed.
  secret: RelayResolvedValue;
}

// The admin dashboard's relay warning, served by GET /secure/admin/relay-status (#870): the catalog
// has enabled SMART providers but the relay is not configured, or it is configured and its
// /healthz did not answer. Both mean every provider connect will fail.
export interface RelayWarning {
  code: 'relay_not_configured' | 'relay_unreachable';
  message: string;
  // relay_not_configured only: the settings still to set (config key or environment variable).
  missing?: string[];
}

export interface RelayHealth {
  ok: boolean;
  // The poll URL that was probed (already shown on the relay card).
  url: string;
  status?: number;
  error?: string;
}

export interface RelayStatus {
  smart_providers: number;
  ready: boolean;
  // null when no probe was made (no providers, or the relay is not configured).
  health: RelayHealth | null;
  warning: RelayWarning | null;
}
