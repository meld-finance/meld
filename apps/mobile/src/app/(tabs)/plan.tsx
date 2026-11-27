import { router } from 'expo-router';
import { RefreshControl } from 'react-native';

import { Button } from '@/components/button';
import { EstateTab } from '@/components/plan/estate-tab';
import { InsuranceTab } from '@/components/plan/insurance-tab';
import { ProfileTab } from '@/components/plan/profile-tab';
import { RetirementTab } from '@/components/plan/retirement-tab';
import { TaxTab } from '@/components/plan/tax-tab';
import { Screen } from '@/components/screen';
import { TabbedHeader } from '@/components/tabbed-header';
import { useTabParam } from '@/hooks/use-tab-param';
import { useEstate, useInsurancePolicies, useRetirement } from '@/lib/queries';

const TABS = [
  { value: 'retirement', label: 'Retirement' },
  { value: 'tax', label: 'Tax' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'estate', label: 'Estate' },
  { value: 'profile', label: 'Profile' },
] as const;

export default function PlanScreen() {
  const [tab, setTab] = useTabParam(TABS);
  const policies = useInsurancePolicies();
  const retirement = useRetirement();
  const estate = useEstate();
  const refreshing = policies.isRefetching || retirement.isRefetching || estate.isRefetching;
  const refresh = () => void Promise.all([policies.refetch(), retirement.refetch(), estate.refetch()]);

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <TabbedHeader
        title="Plan"
        description="Plan for retirement, estimate taxes, make sure your family is covered, and leave things in order."
        options={[...TABS]}
        value={tab}
        onChange={setTab}
        actions={
          (tab === 'insurance' && <Button label="Add policy" size="small" onPress={() => router.push('/insurance/new')} />) ||
          (tab === 'estate' && <Button label="Add document" size="small" onPress={() => router.push('/estate/document/new')} />)
        }
      />
      {tab === 'retirement' && <RetirementTab onShowProfile={() => setTab('profile')} />}
      {tab === 'tax' && <TaxTab onShowProfile={() => setTab('profile')} />}
      {tab === 'insurance' && <InsuranceTab policies={policies} />}
      {tab === 'estate' && <EstateTab />}
      {tab === 'profile' && <ProfileTab />}
    </Screen>
  );
}
