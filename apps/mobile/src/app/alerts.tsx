import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';

import { AlertRow, isOpen } from '@/components/alerts/alert-row';
import { AlertSettingsCard } from '@/components/alerts/alert-settings-card';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useAlerts, useCheckAlerts, useMarkAlertsRead } from '@/lib/queries';

export default function AlertsScreen() {
  const alerts = useAlerts();
  const check = useCheckAlerts();
  const markRead = useMarkAlertsRead();
  const unread = alerts.data?.unread ?? 0;

  // Seeing the list reads them; the dots stay for this visit so you can tell what was new.
  useEffect(() => {
    if (unread > 0 && !markRead.isPending) {
      const t = setTimeout(() => markRead.mutate(undefined), 2_000);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  const list = alerts.data?.alerts ?? [];
  const open = list.filter(isOpen);
  const earlier = list.filter((a) => !isOpen(a));

  const back = (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
      <ThemedText type="linkPrimary">‹ Back</ThemedText>
    </Pressable>
  );

  return (
    <Screen title="Alerts" actions={back} refreshControl={<RefreshControl refreshing={alerts.isRefetching} onRefresh={() => void alerts.refetch()} />}>
      <ThemedText themeColor="textSecondary">
        Meld checks for alerts after every sync (every 6 hours, and when you refresh). Alerts about a state, like an autopay that won’t be
        covered, clear themselves once it’s fixed.
      </ThemedText>
      <Card
        title="Open"
        action={<Button label="Check now" variant="secondary" size="small" loading={check.isPending} onPress={() => check.mutate()} />}>
        {alerts.isPending ? (
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        ) : alerts.isError ? (
          <ThemedText themeColor="negative">Couldn’t load alerts: {alerts.error.message}</ThemedText>
        ) : open.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing needs your attention.
          </ThemedText>
        ) : (
          <View>
            {open.map((a, i) => (
              <AlertRow key={a.id} alert={a} divider={i > 0} />
            ))}
          </View>
        )}
        {check.isError && <ThemedText themeColor="negative">{check.error.message}</ThemedText>}
      </Card>
      {earlier.length > 0 && (
        <Card title="Earlier" subtitle="Cleared or dismissed in the last 30 days.">
          <View>
            {earlier.map((a, i) => (
              <AlertRow key={a.id} alert={a} divider={i > 0} />
            ))}
          </View>
        </Card>
      )}
      <AlertSettingsCard />
    </Screen>
  );
}
