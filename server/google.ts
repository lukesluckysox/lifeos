/**
 * Google OAuth — minimal "Sign in with Google" flow.
 *
 * No SDK; we hit Google's OAuth 2.0 endpoints directly with fetch so this
 * stays consistent with how server/spotify.ts is structured.
 *
 * Flow:
 *   GET /api/auth/google/login    → redirects to Google consent screen
 *   GET /api/auth/google/callback → exchanges code, creates user session
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI       e.g. https://thelifeos.up.railway.app/api/auth/google/callback
 *
 * Scopes: openid email profile (identity only — no Gmail/Drive/Calendar
 * touched here, keep this dead-simple as a sign-in option).
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export interface GoogleAppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getAppConfig(): GoogleAppConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    "http://127.0.0.1:5000/api/auth/google/callback";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

export function buildAuthorizeUrl(state: string): string {
  const cfg = getAppConfig();
  if (!cfg) throw new Error("Google OAuth not configured");

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    // Only prompt if there is genuinely no existing Google session.
    // Removing "select_account" lets returning users skip the chooser
    // and stay signed in seamlessly. Users with multiple Google accounts
    // can still switch via the Settings logout → re-login flow.
    prompt: "none",
    include_granted_scopes: "true",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

export async function exchangeCodeForToken(
  code: string,
): Promise<GoogleTokenResponse> {
  const cfg = getAppConfig();
  if (!cfg) throw new Error("Google OAuth not configured");

  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${txt}`);
  }
  return res.json() as Promise<GoogleTokenResponse>;
}

export interface GoogleProfile {
  sub: string; // stable Google account ID — what we key on
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

export async function getMe(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Google userinfo failed: ${res.status} ${txt}`);
  }
  return res.json() as Promise<GoogleProfile>;
}
