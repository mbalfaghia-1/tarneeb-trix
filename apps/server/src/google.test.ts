import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK, type JWK, type KeyLike } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyGoogleIdTokenWithJwks } from './google.js';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const KID = 'test-key-1';

describe('verifyGoogleIdTokenWithJwks', () => {
  let privateKey: KeyLike;
  let jwks: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
    jwks = createLocalJWKSet({ keys: [publicJwk] });
  });

  const sign = (claims: Record<string, unknown>, opts: { issuer?: string; audience?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(opts.issuer ?? 'https://accounts.google.com')
      .setAudience(opts.audience ?? CLIENT_ID)
      .setSubject(typeof claims.sub === 'string' ? claims.sub : 'default-sub')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

  it('accepts a correctly signed token with a verified email', async () => {
    const token = await sign({ sub: 'google-sub-1', email: 'user@gmail.com', email_verified: true, name: 'User' });
    const result = await verifyGoogleIdTokenWithJwks(token, CLIENT_ID, jwks);
    expect(result).toEqual({ sub: 'google-sub-1', email: 'user@gmail.com', name: 'User' });
  });

  it('rejects a completely malformed token', async () => {
    const result = await verifyGoogleIdTokenWithJwks('not-a-jwt-at-all', CLIENT_ID, jwks);
    expect(result).toBeNull();
  });

  it('rejects a token issued for a different Client ID (wrong audience)', async () => {
    const token = await sign(
      { sub: 'google-sub-2', email: 'user@gmail.com', email_verified: true },
      { audience: 'some-other-app.apps.googleusercontent.com' },
    );
    const result = await verifyGoogleIdTokenWithJwks(token, CLIENT_ID, jwks);
    expect(result).toBeNull();
  });

  it('rejects a token from an unrecognized issuer', async () => {
    const token = await sign(
      { sub: 'google-sub-3', email: 'user@gmail.com', email_verified: true },
      { issuer: 'https://not-google.example.com' },
    );
    const result = await verifyGoogleIdTokenWithJwks(token, CLIENT_ID, jwks);
    expect(result).toBeNull();
  });

  it('rejects a token whose email is not verified', async () => {
    const token = await sign({ sub: 'google-sub-4', email: 'user@gmail.com', email_verified: false });
    const result = await verifyGoogleIdTokenWithJwks(token, CLIENT_ID, jwks);
    expect(result).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await new SignJWT({ sub: 'google-sub-5', email: 'user@gmail.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer('https://accounts.google.com')
      .setAudience(CLIENT_ID)
      .setSubject('google-sub-5')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired an hour ago
      .sign(privateKey);
    const result = await verifyGoogleIdTokenWithJwks(token, CLIENT_ID, jwks);
    expect(result).toBeNull();
  });

  it('rejects a token signed by a different key (not actually from Google)', async () => {
    const forgedPair = await generateKeyPair('RS256');
    const token = await new SignJWT({ sub: 'google-sub-6', email: 'user@gmail.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: KID }) // claims the real kid, but signed with a different key
      .setIssuer('https://accounts.google.com')
      .setAudience(CLIENT_ID)
      .setSubject('google-sub-6')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(forgedPair.privateKey);
    const result = await verifyGoogleIdTokenWithJwks(token, CLIENT_ID, jwks);
    expect(result).toBeNull();
  });
});
