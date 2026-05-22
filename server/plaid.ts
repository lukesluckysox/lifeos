/**
 * Plaid integration.
 * Uses PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (defaults to "sandbox").
 * Products: investments, transactions.
 */

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from "plaid";

export class PlaidNotConfiguredError extends Error {
  constructor() {
    super("Plaid is not configured. Set PLAID_CLIENT_ID, PLAID_SECRET in environment variables.");
    this.name = "PlaidNotConfiguredError";
  }
}

function getClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = (process.env.PLAID_ENV || "sandbox").toLowerCase();

  if (!clientId || !secret) {
    throw new PlaidNotConfiguredError();
  }

  // Plaid SDK v36+ removed the legacy `development` environment. We map it
  // to `production` (real banks) and continue — sandbox stays the default.
  const baseUrl =
    env === "production" || env === "development"
      ? PlaidEnvironments.production
      : PlaidEnvironments.sandbox;

  const config = new Configuration({
    basePath: baseUrl,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  return new PlaidApi(config);
}

/**
 * Per-user in-flight Plaid link_token cache.
 *
 * Plaid OAuth requires that you re-initialize Plaid Link on the OAuth
 * redirect-back with the EXACT SAME link_token that was used to start
 * the flow. Since we can't use localStorage in the client (sandboxed
 * iframe + CSP), we stash the token server-side keyed by userId.
 *
 * Persisted to the `secrets` table so it survives Railway redeploys /
 * container restarts — an in-memory Map silently lost the token whenever
 * the dyno cycled, which made Plaid Link return to a blank blue screen.
 *
 * Entries expire after 30 minutes (Plaid link tokens are valid for 4h
 * but the OAuth round-trip should be much shorter).
 */
import { storage } from "./storage";
const LINK_TOKEN_SECRET_KEY = "plaid:inflight_link_token";
const LINK_TOKEN_TS_KEY = "plaid:inflight_link_token_ts";
const LINK_TOKEN_TTL_MS = 30 * 60 * 1000;

export async function getInflightLinkToken(userId: number): Promise<string | null> {
  const token = await storage.getSecret(userId, LINK_TOKEN_SECRET_KEY);
  if (!token) return null;
  const tsStr = await storage.getSecret(userId, LINK_TOKEN_TS_KEY);
  const ts = tsStr ? parseInt(tsStr, 10) : 0;
  if (!ts || Date.now() - ts > LINK_TOKEN_TTL_MS) {
    await clearInflightLinkToken(userId);
    return null;
  }
  return token;
}

export async function setInflightLinkToken(userId: number, token: string): Promise<void> {
  await storage.setSecret(userId, LINK_TOKEN_SECRET_KEY, token);
  await storage.setSecret(userId, LINK_TOKEN_TS_KEY, Date.now().toString());
}

export async function clearInflightLinkToken(userId: number): Promise<void> {
  // setSecret is upsert; we don't have a deleteSecret helper, so just
  // blank the values. getInflightLinkToken treats empty as missing.
  await storage.setSecret(userId, LINK_TOKEN_SECRET_KEY, "");
  await storage.setSecret(userId, LINK_TOKEN_TS_KEY, "");
}

/** Create a link token for the Plaid Link flow. */
export async function createLinkToken(userId: number): Promise<string> {
  const client = getClient();

  // For OAuth-based banks (Chase, BoA, Wells Fargo, etc.) Plaid requires a
  // redirect_uri that has been registered in the Plaid Dashboard under
  // "Allowed redirect URIs". If you haven't whitelisted the URI, Plaid
  // returns a 400 on linkTokenCreate — so we ONLY include redirect_uri
  // when PLAID_REDIRECT_URI is explicitly set in env. Sandbox flows work
  // fine without it.
  //
  // To enable OAuth banks:
  //   1. Add the URI to Plaid Dashboard → Team Settings → API
  //      → Allowed redirect URIs (e.g. https://thelifeos.up.railway.app/)
  //      Plaid does NOT accept fragments (#/finance) — use the bare origin
  //      with a trailing slash.
  //   2. Set PLAID_REDIRECT_URI to the same value in Railway env vars.
  const redirectUri = process.env.PLAID_REDIRECT_URI;

  const params: any = {
    user: { client_user_id: userId.toString() },
    client_name: "Life OS",
    products: [Products.Investments, Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  };
  if (redirectUri) {
    params.redirect_uri = redirectUri;
  }

  try {
    const response = await client.linkTokenCreate(params);
    const token = response.data.link_token;
    // Stash for OAuth resume — see comment above.
    await setInflightLinkToken(userId, token);
    return token;
  } catch (err: any) {
    // Plaid SDK wraps real errors inside err.response.data — surface them
    // so we don't lose the actual error_code/error_message in the logs.
    const plaidErr = err?.response?.data;
    if (plaidErr) {
      console.error("[plaid] linkTokenCreate failed:", JSON.stringify(plaidErr));
      const msg = plaidErr.error_message || plaidErr.error_code || "Plaid request failed";
      throw new Error(msg);
    }
    throw err;
  }
}

/** Exchange a public token (from Plaid Link) for an access token. */
export async function exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }> {
  const client = getClient();
  const response = await client.itemPublicTokenExchange({ public_token: publicToken });
  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  };
}

/** Get investment holdings for an access token. */
export async function getInvestmentHoldings(accessToken: string): Promise<any> {
  const client = getClient();
  const response = await client.investmentsHoldingsGet({ access_token: accessToken });
  return response.data;
}

/** Get investment transactions for an access token. */
export async function getInvestmentTransactions(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<any> {
  const client = getClient();
  const response = await client.investmentsTransactionsGet({
    access_token: accessToken,
    start_date: startDate,
    end_date: endDate,
  });
  return response.data;
}

/** Get institution name for an access token. */
export async function getInstitutionName(accessToken: string): Promise<string> {
  try {
    const client = getClient();
    const itemResp = await client.itemGet({ access_token: accessToken });
    const institutionId = itemResp.data.item.institution_id;
    if (!institutionId) return "Unknown Institution";
    const instResp = await client.institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Us],
    });
    return instResp.data.institution.name;
  } catch {
    return "Unknown Institution";
  }
}
