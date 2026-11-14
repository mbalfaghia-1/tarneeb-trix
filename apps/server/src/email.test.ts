import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmailSender } from './email.js';

describe('email sender', () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalFrom;
  });

  it('no-ops (returns false, never throws) when RESEND_API_KEY is not set', async () => {
    delete process.env.RESEND_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const sender = createEmailSender();
    const ok = await sender.send('someone@example.com', 'Subject', '<p>Hi</p>');
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts to the Resend API with the configured key/from when set', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'Test Sender <test@example.com>';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const sender = createEmailSender();
    const ok = await sender.send('someone@example.com', 'Verify your email', '<p>Click here</p>');
    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers).toMatchObject({ authorization: 'Bearer test-key' });
    const body = JSON.parse(init.body as string) as { from: string; to: string[]; subject: string };
    expect(body.from).toBe('Test Sender <test@example.com>');
    expect(body.to).toEqual(['someone@example.com']);
    expect(body.subject).toBe('Verify your email');
  });

  it('returns false (never throws) when the Resend API responds with an error status', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    const sender = createEmailSender();
    expect(await sender.send('someone@example.com', 'Subject', '<p>Hi</p>')).toBe(false);
  });

  it('returns false (never throws) when the network request itself fails', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const sender = createEmailSender();
    expect(await sender.send('someone@example.com', 'Subject', '<p>Hi</p>')).toBe(false);
  });
});
