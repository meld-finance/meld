import { isLiabilityType, ownedValue, type AccountType, type NetWorthSummary } from '@meld/shared';

type BalanceInput = { type: AccountType; currentBalance: number | null };
type ManualInput = { value: number; ownershipPercent?: number | null };

/**
 * Manual assets count only your ownership share.
 * Plaid reports liabilities (credit, loans, mortgages) as positive amounts owed,
 * so they're summed separately and subtracted.
 */
export function computeNetWorth(accounts: BalanceInput[], manualAssets: ManualInput[]): NetWorthSummary {
  const byType = new Map<NetWorthSummary['byType'][number]['type'], number>();
  let assets = 0;
  let liabilities = 0;

  for (const a of accounts) {
    const balance = a.currentBalance ?? 0;
    byType.set(a.type, (byType.get(a.type) ?? 0) + balance);
    if (isLiabilityType(a.type)) liabilities += balance;
    else assets += balance;
  }
  const manualTotal = manualAssets.reduce((sum, m) => sum + ownedValue(m), 0);
  if (manualAssets.length) byType.set('manual', manualTotal);
  assets += manualTotal;

  return {
    assets: round2(assets),
    liabilities: round2(liabilities),
    netWorth: round2(assets - liabilities),
    byType: [...byType].map(([type, total]) => ({ type, total: round2(total) })),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  return d.toLocaleDateString('en-CA');
}
