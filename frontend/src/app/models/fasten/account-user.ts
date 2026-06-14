// The system user account (NOT the FHIR Patient record). Returned by GET /api/secure/account/me
// in sanitized form (no password hash). This is the "Account Profile" identity.
export interface AccountUser {
  id?: string;
  username?: string;
  full_name?: string;
  email?: string;
  role?: string;
  picture?: string;
}
