// Thin wrapper over Resend's HTTP API — a single fetch call, no SDK dependency needed.
// Self-hosting SMTP was deliberately ruled out: deliverability from a fresh server/IP is
// genuinely hard (SPF/DKIM/DMARC, reputation warm-up), not something worth DIY-ing for a
// casual game. Gracefully no-ops (returns false, never throws) if RESEND_API_KEY isn't
// set — same pattern as GOOGLE_CLIENT_ID: a feature that's silently dormant until
// configured, not a hard failure.
const RESEND_API_URL = 'https://api.resend.com/emails';

/** Starts on Resend's shared test domain (works immediately, no DNS setup) — swap to a
 *  verified custom domain later via the EMAIL_FROM env var alone, no code change. */
const DEFAULT_FROM = 'Tarneeb & Trix <onboarding@resend.dev>';

export interface EmailSender {
  send(to: string, subject: string, html: string): Promise<boolean>;
}

export function createEmailSender(): EmailSender {
  const apiKey = process.env.RESEND_API_KEY ?? '';
  const from = process.env.EMAIL_FROM ?? DEFAULT_FROM;

  return {
    async send(to, subject, html) {
      if (!apiKey) return false; // not configured — caller treats this as "email not sent"
      try {
        const res = await fetch(RESEND_API_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, html }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
