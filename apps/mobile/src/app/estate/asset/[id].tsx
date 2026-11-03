import { useLocalSearchParams } from 'expo-router';

import { DesignationScreen } from '@/components/estate/designation-screen';

export default function AssetDesignationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DesignationScreen id={id} />;
}
