export class User {
  // The server's primary key, a uuid (models.ModelBase.ID). Needed by the admin password reset
  // (#511), which addresses the account by id rather than by name. Note `user_id` below is a
  // different, older field and is not this.
  id?: string
  user_id?: number
  full_name?: string
  username?: string
  email?: string
  password?: string
  role?: string
  // #512 — shown on the admin users list; absent until the first sign-in ("Never").
  last_login?: string
  login_count?: number
  // #792 — whether the account has given an email address. The Users list never carries the
  // address itself: an admin needs to know an alert can reach someone, not what their inbox is.
  has_email?: boolean
  // #919 — a test account: sandbox providers only, never real data. Set by an admin.
  is_test?: boolean
}
