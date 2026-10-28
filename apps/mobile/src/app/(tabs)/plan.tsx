import { router } from 'expo-router';
import { RefreshControl } from 'react-native';

import { Button } from '@/components/button';
import { InsuranceTab } from '@/components/plan/insurance-tab';
import { ProfileTab } from '@/components/plan/profile-tab';
import { RetirementTab } from '@/components/plan/retirement-tab';
import { Screen } from '@/components/screen';
import { TabbedHeader } from '@/components/tabbed-header';
import { useTabParam } from '@/hooks/use-tab-param';
import { useInsurancePolicies, useRetirement } from '@/lib/queries';

const TABS = [
  { value: 'retirement', label: 'Retirement' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'profile', label: 'Profile' },
] as const;

export default function PlanScreen() {
  const [tab, setTab] = useTabParam(TABS);
  const policies = useInsurancePolicies();
  const retirement = useRetirement();
  const refreshing = policies.isRefetching || retirement.isRefetching;
  const refresh = () => void Promise.all([policies.refetch(), retirement.refetch()]);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <TabbedHeader
        title="Plan"
        description="Plan for retirement and make sure you and your family are covered."
        options={[...TABS]}
        value={tab}
        onChange={setTab}
        actions={
          tab === 'insurance' && <Button label="Add policy" size="small" onPress={() => router.push('/insurance/new')} />
        }
      />
      {tab === 'retirement' && <RetirementTab onShowProfile={() => setTab('profile')} />}
      {tab === 'insurance' && <InsuranceTab policies={policies} />}
      {tab === 'profile' && <ProfileTab />}
    </Screen>
  );
}
