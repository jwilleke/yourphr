// The system user account (NOT the FHIR Patient record). Returned by GET /api/secure/account/me
// in sanitized form (no password hash). This is the "Account Profile" identity.
export interface AccountUser {
  id?: string;
  username?: string;
  full_name?: string;
  email?: string;
  role?: string;
  picture?: string;
  /**
   * True when this session is the shared public-demo account (#496). The server derives it from
   * demo.enabled + demo.username, so the demo account's name is never published.
   *
   * A rendering hint only — the connect routes enforce the same rule server-side, because a
   * disabled button is not a control.
   */
  demo_account?: boolean;
  /** yourphr#919: an administrator marked this a test account — sandbox providers only, never real data. */
  test_account?: boolean;
  /**
   * When this account last signed in, and how many times it has (#512). Absent until the first
   * sign-in, which the UI renders as "Never" rather than inventing a date.
   *
   * Deliberately no IP address and no user-agent anywhere in this: on a product whose pitch is that
   * nobody else holds your data, keeping a log of your household's own addresses would need a
   * retention policy and a privacy decision (#507). A timestamp and a counter answer "has anyone
   * else been in my record?" without building that.
   */
  last_login?: string;
  login_count?: number;
}
