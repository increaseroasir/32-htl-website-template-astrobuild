/// <reference types="astro/client" />

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}

/**
 * Worker bindings and secrets.
 *
 * Secrets are NEVER in client.config.ts and never in git. Config records
 * only the BINDING NAME and an on/off flag; the values live in
 * `wrangler secret put` and are read from here at runtime.
 */
interface Env {
  // Bindings (names declared in wrangler.toml, mirrored in config.integrations)
  DB: D1Database;
  PRODUCT_IMAGES: R2Bucket;

  // Admin auth — reused as-is from the existing Sun Pool pattern (Phase 6).
  ADMIN_PASSWORD: string;
  ADMIN_SESSION_SECRET: string;

  // R2 public host for product images
  R2_PUBLIC_BUCKET_ID?: string;
  R2_PUBLIC_BASE_URL?: string;
  /** Optional override of the 6 MB upload cap. */
  MAX_PRODUCT_IMAGE_BYTES?: string;

  // CRM (Phase 8)
  GHL_API_KEY?: string;
  GHL_LOCATION_ID?: string;

  // Meta CAPI (Phase 8)
  META_PIXEL_ID?: string;
  META_CAPI_ACCESS_TOKEN?: string;
  META_TEST_EVENT_CODE?: string;

  /**
   * Conversion value ladder. Commercial figures, so they are secrets per
   * client rather than config — see src/lib/capi-events.ts for why Lead is
   * immovably 0 (no env override exists) and why Purchase has no default.
   */
  META_VALUE_QUALIFIED?: string;
  META_VALUE_SCHEDULE?: string;
  META_VALUE_SHOWED?: string;

  /** Bearer token the CRM presents to POST /api/lead-stage. */
  STAGE_WEBHOOK_SECRET?: string;

  /**
   * THE LEAD VAULT (Google Sheets mirror — src/lib/sheets.ts). One
   * service account per agency; each client's sheet shared with it as
   * Editor. The PRIVATE KEY arrives from `wrangler secret put` with
   * literal \n two-character sequences — sheets.ts un-escapes it; never
   * paste a re-formatted key. All three are TRIMMED before the
   * configured check (a whitespace-only secret is truthy and produces an
   * opaque Google auth error instead of a config error).
   */
  GOOGLE_SHEETS_ID?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;

  /**
   * Failure alerts (src/lib/alert.ts): a Slack-compatible webhook URL
   * (Slack, Discord /slack endpoint, or a GHL inbound webhook). Trimmed
   * before the configured check. Unconfigured = failures fall back to a
   * loud console.error that says no alert channel exists.
   */
  ALERT_WEBHOOK_URL?: string;

  // Monitoring
  PUBLIC_SENTRY_DSN?: string;
}
