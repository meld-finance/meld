import { useLocalSearchParams } from 'expo-router';

import { DesignationScreen } from '@/components/estate/designation-screen';

export default function AccountDesignationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DesignationScreen id={id} />;
}
