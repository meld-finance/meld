import { BudgetsTab } from '@/components/spending/budgets-tab';
import { OverviewTab } from '@/components/spending/overview-tab';
import { TransactionsTab } from '@/components/spending/transactions-tab';
import { TabbedHeader } from '@/components/tabbed-header';
import { useTabParam } from '@/hooks/use-tab-param';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'budgets', label: 'Budgets' },
] as const;

export default function SpendingScreen() {
  const [tab, setTab] = useTabParam(TABS);
  // Each tab owns its Screen, since they scroll differently (Transactions is a list). All are wide so the header stays put.
  const header = (
    <TabbedHeader
      title="Spending"
      description="Where your money goes, how it changes over time, and how it tracks against your budgets."
      options={[...TABS]}
      value={tab}
      onChange={setTab}
    />
  );
  if (tab === 'transactions') return <TransactionsTab header={header} />;
  if (tab === 'budgets') return <BudgetsTab header={header} />;
  return <OverviewTab header={header} />;
}
