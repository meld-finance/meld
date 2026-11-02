/** Daily closes by date (YYYY-MM-DD), or null when the source doesn't know the ticker. */
export type FetchCloses = (ticker: string, from: string, to: string) => Promise<Record<string, number> | null>;

/** Plaid writes share classes with a dot (BRK.B); Yahoo uses a dash. */
function yahooSymbol(ticker: string): string | null {
  if (ticker.startsWith('CUR:') || !/^[A-Z0-9.^-]{1,10}$/i.test(ticker)) return null;
  return /^[A-Z]+\.[A-Z]$/i.test(ticker) ? ticker.replace('.', '-') : ticker;
}

/**
 * Split-adjusted daily closes from Yahoo Finance's public chart endpoint. Only the ticker leaves
 * the machine. Closes aren't adjusted for dividends: those show up as transactions instead.
 */
export const fetchYahooCloses: FetchCloses = async (ticker, from, to) => {
  const symbol = yahooSymbol(ticker);
  if (!symbol) return null;
  const toSeconds = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('period1', String(toSeconds(from)));
  url.searchParams.set('period2', String(toSeconds(to) + 86400));
  url.searchParams.set('interval', '1d');
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Price lookup for ${ticker} failed: ${res.status}`);
  const body = (await res.json()) as {
    chart: {
      result?: {
        meta: { gmtoffset?: number };
        timestamp?: number[];
        indicators: { quote: { close?: (number | null)[] }[] };
      }[];
    };
  };
  const result = body.chart.result?.[0];
  if (!result?.timestamp) return null;
  const offset = result.meta.gmtoffset ?? 0;
  const closes: Record<string, number> = {};
  result.timestamp.forEach((t, i) => {
    const close = result.indicators.quote[0]?.close?.[i];
    if (close != null && close > 0) closes[new Date((t + offset) * 1000).toISOString().slice(0, 10)] = close;
  });
  return Object.keys(closes).length ? closes : null;
};

/** A fund's distributions over the last year over its latest price, as a fraction; null when unknown. */
export type FetchYield = (ticker: string) => Promise<number | null>;

/**
 * Trailing 12-month distribution yield from Yahoo Finance's chart endpoint, for cash ETFs like SGOV.
 * Money market funds report no distributions there, so they come back null. Only the ticker leaves
 * the machine.
 */
export const fetchYahooTrailingYield: FetchYield = async (ticker) => {
  const symbol = yahooSymbol(ticker);
  if (!symbol) return null;
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('range', '1y');
  url.searchParams.set('interval', '1d');
  url.searchParams.set('events', 'div');
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Yield lookup for ${ticker} failed: ${res.status}`);
  const body = (await res.json()) as {
    chart: {
      result?: {
        events?: { dividends?: Record<string, { amount: number }> };
        indicators: { quote: { close?: (number | null)[] }[] };
      }[];
    };
  };
  const result = body.chart.result?.[0];
  const closes = (result?.indicators.quote[0]?.close ?? []).filter((c): c is number => c != null && c > 0);
  const price = closes.at(-1);
  const paid = Object.values(result?.events?.dividends ?? {}).reduce((s, d) => s + d.amount, 0);
  return price && paid > 0 ? paid / price : null;
};

/** The 3-month Treasury bill yield (Yahoo's ^IRX), as a fraction; null when unavailable. */
export async function fetchTreasuryYield(fetchCloses: FetchCloses = fetchYahooCloses): Promise<number | null> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const closes = await fetchCloses('^IRX', from, to);
  const latest = closes && Object.entries(closes).sort(([a], [b]) => a.localeCompare(b)).at(-1)?.[1];
  return latest ? latest / 100 : null;
}
