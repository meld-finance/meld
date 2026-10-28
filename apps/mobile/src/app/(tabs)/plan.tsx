import { router } from 'expo-router';
import { RefreshControl } from 'react-native';

import { Button } from '@/components/button';
import { InsuranceTab } from '@/components/plan/insurance-tab';
import { ProfileTab } from '@/components/plan/profile-tab';
import { Screen } from '@/components/screen';
import { TabbedHeader } from '@/components/tabbed-header';
import { useTabParam } from '@/hooks/use-tab-param';
import { useInsurancePolicies } from '@/lib/queries';

// Retirement and other planning tools join these as they arrive.
const TABS = [
  { value: 'insurance', label: 'Insurance' },
  { value: 'profile', label: 'Profile' },
] as const;

export default function PlanScreen() {
  const [tab, setTab] = useTabParam(TABS);
  const policies = useInsurancePolicies();

  return (
    <Screen refreshControl={<RefreshControl refreshing={policies.isRefetching} onRefresh={() => void policies.refetch()} />}>
      <TabbedHeader
        title="Plan"
        description="Make sure you and your family are covered, today and later."
        options={[...TABS]}
        value={tab}
        onChange={setTab}
        actions={
          tab === 'insurance' && <Button label="Add policy" size="small" onPress={() => router.push('/insurance/new')} />
        }
      />
      {tab === 'insurance' && <InsuranceTab policies={policies} />}
      {tab === 'profile' && <ProfileTab />}
    </Screen>
  );
}
