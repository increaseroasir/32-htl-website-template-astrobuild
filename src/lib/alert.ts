/**
 * FAILURE ALERTS (Lead Vault, Job 4) — ported from the Sun Pool build's
 * sendFailureAlert idea: a submit-path failure becomes something a human
 * FINDS OUT ABOUT, not a console.error nobody reads.
 *
 * Mechanism: one webhook URL (ALERT_WEBHOOK_URL secret), POSTed a
 * Slack-compatible `{ text }` payload — works as-is for Slack, Discord
 * (slack-compat endpoint), or a GHL inbound webhook. Scoped to the
 * submit path specifically, not a general error firehose (spec:
 * "Alerting").
 *
 * NEVER THROWS, never blocks a lead — it runs inside the vault's
 * waitUntil task. Unconfigured is honest: the console.error fallback
 * says loudly that a failure had no alert channel.
 */

export interface AlertConfig {
  webhookUrl: string;
}

/** Trim-before-configured — same rule as the Sheets secrets. */
export function alertConfigFromEnv(env: { ALERT_WEBHOOK_URL?: string }): AlertConfig | null {
  const webhookUrl = (env.ALERT_WEBHOOK_URL ?? '').trim();
  return webhookUrl ? { webhookUrl } : null;
}

export type FailureKind = 'ghl' | 'capi' | 'vault';

export interface FailureAlert {
  /** Which leg failed. */
  kind: FailureKind;
  leadUuid: string;
  detail: string;
}

export interface AlertResult {
  ok: boolean;
  status: number;
  error?: string;
}

export async function sendFailureAlert(
  config: AlertConfig | null,
  alert: FailureAlert,
): Promise<AlertResult> {
  const text =
    `LEAD PIPELINE FAILURE [${alert.kind}] — lead ${alert.leadUuid}: ` +
    alert.detail.slice(0, 500);
  if (!config) {
    // The one legitimate console-only path, and it names itself: the
    // operator chose (or forgot) to run without an alert channel.
    console.error(`[alert] UNCONFIGURED — no ALERT_WEBHOOK_URL; failure had no alert channel: ${text}`);
    return { ok: false, status: 0, error: 'unconfigured' };
  }
  try {
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`[alert] webhook rejected the alert (${res.status}): ${text}`);
      return { ok: false, status: res.status, error: `webhook ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[alert] webhook unreachable (${detail}): ${text}`);
    return { ok: false, status: 0, error: detail };
  }
}
