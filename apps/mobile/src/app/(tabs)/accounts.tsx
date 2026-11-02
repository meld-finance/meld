import type { ReactNode } from 'react';

import { AccountsTab } from '@/components/accounts/accounts-tab';
import { CashTab } from '@/components/cash/cash-tab';
import { InvestmentsTab } from '@/components/investments/investments-tab';
import { TabbedHeader } from '@/components/tabbed-header';
import { useTabParam } from '@/hooks/use-tab-param';

const TABS = [
  { value: 'accounts', label: 'Accounts' },
  { value: 'cash', label: 'Cash' },
  { value: 'investments', label: 'Investments' },
] as const;

export default function AccountsScreen() {
  const [tab, setTab] = useTabParam(TABS);
  const header = (actions?: ReactNode) => (
    <TabbedHeader
      title="Accounts"
      description="All your financial accounts in one place: link them, manage them, and see how your money is doing."
      options={[...TABS]}
      value={tab}
      onChange={setTab}
      actions={actions}
    />
  );
  if (tab === 'investments') return <InvestmentsTab header={header()} />;
  if (tab === 'cash') return <CashTab header={header()} />;
  return <AccountsTab header={header} />;
}
