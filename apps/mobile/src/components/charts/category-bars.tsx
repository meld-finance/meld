import type { CategorySpend } from '@meld/shared';

import { formatCategory } from '@/lib/format';

import { RankedBars } from './ranked-bars';

export function CategoryBars({ spending }: { spending: CategorySpend[] }) {
  return (
    <RankedBars rows={spending.map((s) => ({ key: s.category, label: formatCategory(s.category), amount: s.amount }))} />
  );
}
