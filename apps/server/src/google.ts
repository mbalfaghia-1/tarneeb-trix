// Verifies a Google "Sign in with Google" ID token (a signed JWT the browser gets
// directly from Google Identity Services — no redirect, no client secret). We only need
// to confirm Google vouches for this identity; we never call a Google API on the user's
// behalf, so there is nothing here that needs a client secret or an access token.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// Cached across calls (jose handles its own key-rotation refresh/caching internally).
const liveJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

export interface GoogleIdentity {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
}

/** Core claim-checking logic, parameterized over the JWKS source so tests can supply a
 *  local test keyset instead of hitting Google's live endpoint — verifyGoogleIdToken
 *  below is just this with the real remote JWKS filled in. */
export async function verifyGoogleIdTokenWithJwks(
  idToken: string,
  clientId: string,
  jwks: JWTVerifyGetKey,
): Promise<GoogleIdentity | null> {
  try {
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: GOOGLE_ISSUERS,
      audience: clientId,
    });
    if (payload.email_verified !== true) return null;
    const sub = payload.sub;
    const email = payload.email;
    const name = typeof payload.name === 'string' ? payload.name : '';
    if (typeof sub !== 'string' || typeof email !== 'string') return null;
    return { sub, email, name };
  } catch {
    return null;
  }
}

/** Returns the verified identity, or null if the token is malformed, expired, signed by
 *  someone other than Google, issued for a different Client ID, or its email isn't
 *  verified by Google (email_verified !== true). Never throws. */
export function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleIdentity | null> {
  return verifyGoogleIdTokenWithJwks(idToken, clientId, liveJwks);
}
