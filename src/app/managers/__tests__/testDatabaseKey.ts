/**
 * The database key the health tests and harnesses run under (yourphr#991).
 *
 * Health turns on only with a database key, so these tests run encrypted. A passphrase key costs a
 * key derivation (PBKDF2, 64,007 rounds) on every connection, and a records call opens one, so a
 * passphrase made the health tests about twenty times slower and starved unrelated tests on CI's
 * smaller runners. This is a RAW 256-bit key in SQLite3 Multiple Ciphers' x'…' form: the files are
 * still encrypted (a wrong key still fails, nothing is readable on disk), but no derivation runs.
 * A test value, never a real key.
 */
export const TEST_DATABASE_KEY = `x'${'7e'.repeat(32)}'`;
