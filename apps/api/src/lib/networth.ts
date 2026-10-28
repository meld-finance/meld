import { isLiabilityType, ownedBalance, ownedValue, type AccountType, type NetWorthSummary } from '@meld/shared';

type BalanceInput = { type: AccountType; currentBalance: number | null; ownershipPercent?: number | null };
type ManualInput = Parameters<typeof ownedValue>[0];

/**
 * Shared accounts and manual assets count only your ownership share; manual assets count at their
 * depreciated current value. Life insurance counts at its
 * surrender value (already net of policy loans, so loans aren't a liability here).
 * Plaid reports liabilities (credit, loans, mortgages) as positive amounts owed,
 * so they're summed separately and subtracted.
 */
export function computeNetWorth(
  accounts: BalanceInput[],
  manualAssets: ManualInput[],
  insuranceCashValues: number[] = [],
): NetWorthSummary {
  const byType = new Map<NetWorthSummary['byType'][number]['type'], number>();
  let assets = 0;
  let liabilities = 0;

  for (const a of accounts) {
    const balance = ownedBalance(a);
    byType.set(a.type, (byType.get(a.type) ?? 0) + balance);
    if (isLiabilityType(a.type)) liabilities += balance;
    else assets += balance;
  }
  const manualTotal = manualAssets.reduce((sum, m) => sum + ownedValue(m), 0);
  if (manualAssets.length) byType.set('manual', manualTotal);
  assets += manualTotal;
  const insuranceTotal = insuranceCashValues.reduce((sum, v) => sum + v, 0);
  if (insuranceCashValues.length) byType.set('insurance', insuranceTotal);
  assets += insuranceTotal;

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
