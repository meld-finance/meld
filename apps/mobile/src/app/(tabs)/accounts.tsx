import type { ReactNode } from 'react';

import { AccountsTab } from '@/components/accounts/accounts-tab';
import { InvestmentsTab } from '@/components/investments/investments-tab';
import { TabbedHeader } from '@/components/tabbed-header';
import { useTabParam } from '@/hooks/use-tab-param';

const TABS = [
  { value: 'accounts', label: 'Accounts' },
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
  return tab === 'investments' ? <InvestmentsTab header={header()} /> : <AccountsTab header={header} />;
}
