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

  const baseUrl =
    env === "production" ? PlaidEnvironments.production :
    env === "development" ? PlaidEnvironments.development :
    PlaidEnvironments.sandbox;

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

/** Create a link token for the Plaid Link flow. */
export async function createLinkToken(userId: number): Promise<string> {
  const client = getClient();
  const response = await client.linkTokenCreate({
    user: { client_user_id: userId.toString() },
    client_name: "Life OS",
    products: [Products.Investments, Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  });
  return response.data.link_token;
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
