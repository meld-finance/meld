import { Configuration, PlaidApi, PlaidEnvironments, type PlaidError } from 'plaid';
import { plaidSecret, type Env } from '../env';

export function createPlaidClient(
  env: Pick<Env, 'PLAID_ENV' | 'PLAID_CLIENT_ID' | 'PLAID_SANDBOX_SECRET' | 'PLAID_PRODUCTION_SECRET'>,
): PlaidApi {
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env.PLAID_ENV],
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': env.PLAID_CLIENT_ID,
          'PLAID-SECRET': plaidSecret(env),
        },
      },
    }),
  );
}

/** Extracts Plaid's error payload from an SDK (axios) error, if that's what it is. */
export function getPlaidError(err: unknown): PlaidError | null {
  const data = (err as { response?: { data?: unknown } } | null)?.response?.data;
  if (data && typeof data === 'object' && typeof (data as PlaidError).error_code === 'string') {
    return data as PlaidError;
  }
  return null;
}
