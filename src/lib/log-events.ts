// Named identifiers for every log line the picker emits. The `Logger`
// interface accepts a `LogEvent` instead of a free-form string so the
// compiler can enforce one source of truth — adding a new event means
// adding a constant here, and removing one fails at every call site.
//
// Naming: dotted, lower-snake. Group prefix names the surface that emits
// the event (forkable, scorer, mailer, run, etc.).

export const LOG_EVENTS = {
  // Run / command lifecycle
  RUN_ACCOUNT: 'run.account',
  RUN_MODE: 'run.mode',
  RUN_TARGET_WEEK: 'run.target_week',
  RUN_NO_DELIVERIES: 'run.no_deliveries',
  RUN_NO_MAILER: 'run.no_mailer_configured',
  RUN_MAIL_SEND_FAILED: 'run.failure_email_failed',

  // Forkable client
  FORKABLE_WARMUP: 'forkable.warmup',
  FORKABLE_LOGIN_OK: 'forkable.login_ok',
  FORKABLE_SESSION_COOKIE: 'forkable.session_cookie_attached',
  FORKABLE_ME_OK: 'forkable.me_ok',
  FORKABLE_REPLACE_OK: 'forkable.replace_piece_ok',
  FORKABLE_POST_OUT: 'forkable.post_out',
  FORKABLE_POST_IN: 'forkable.post_in',

  // Scorer
  SCORER_NETWORK_FAILED: 'scorer.network_failed',
  SCORER_INVALID_JSON: 'scorer.invalid_json',
  SCORER_SCHEMA_FAILED: 'scorer.schema_failed',

  // Mailer
  MAILER_EMAIL_SENT: 'mailer.email_sent',

  // CSV writer
  CSV_WRITTEN: 'csv.written',

  // show-week command
  SHOW_WEEK_FETCH: 'show_week.fetch',
  SHOW_WEEK_NO_DELIVERIES: 'show_week.no_deliveries',
} as const;

export type LogEvent = (typeof LOG_EVENTS)[keyof typeof LOG_EVENTS];
