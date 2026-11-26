import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { formStyles } from '@/components/form-fields';
import { Screen } from '@/components/screen';
import { PlaidGuide, type PlaidKeysForm } from '@/components/setup/plaid-guide';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSaveSettings, useSettings, useSwitchDemoMode } from '@/lib/setup';

/**
 * From demo data (or Settings) to your own accounts: the guided Plaid sign-up, then saving the
 * keys, which restarts Meld on your real database. Linking banks happens on the Accounts tab.
 */
export default function ConnectScreen() {
  const settings = useSettings();
  const save = useSaveSettings();
  const switchDemo = useSwitchDemoMode();
  const [keys, setKeys] = useState<PlaidKeysForm>({ clientId: '', productionSecret: '' });
  const view = settings.data;
  const fixed = !!view && (!view.editable || view.fromEnv.includes('plaid'));
  const back = (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
      <ThemedText type="linkPrimary">‹ Back</ThemedText>
    </Pressable>
  );

  function connect() {
    save.mutate(
      { plaid: { clientId: keys.clientId, productionSecret: keys.productionSecret, sandboxSecret: '', env: 'production' } },
      { onSuccess: () => router.replace('/accounts') },
    );
  }

  return (
    <Screen title="Connect your banks" actions={back}>
      <View style={styles.body}>
        {settings.isPending ? (
          <ActivityIndicator />
        ) : (
          <>
            {view?.demo && view.plaidReady && (
              <Card
                title="Your Plaid keys are already saved"
                subtitle="You’re previewing demo data right now. Switch back anytime without re-entering your keys.">
                <View style={formStyles.buttons}>
                  <Button
                    label="Back to my accounts"
                    loading={switchDemo.isPending}
                    onPress={() => switchDemo.mutate({ enabled: false })}
                  />
                </View>
                {switchDemo.isError && <ThemedText themeColor="negative">{switchDemo.error.message}</ThemedText>}
              </Card>
            )}
            {fixed ? (
              <Card title="Plaid keys come from .env here">
                <ThemedText themeColor="textSecondary">
                  {view.plaidReady ? (
                    <>
                      Your Plaid keys are set in <ThemedText type="code">.env</ThemedText>, so they can’t be edited from
                      the app. Change them there and restart Meld if you ever need to update them.
                    </>
                  ) : (
                    <>
                      Set <ThemedText type="code">PLAID_CLIENT_ID</ThemedText>,{' '}
                      <ThemedText type="code">PLAID_PRODUCTION_SECRET</ThemedText> and{' '}
                      <ThemedText type="code">PLAID_ENV=production</ThemedText>, remove{' '}
                      <ThemedText type="code">MELD_DEMO</ThemedText>, and restart Meld.
                    </>
                  )}
                </ThemedText>
              </Card>
            ) : (
              <>
                <ThemedText themeColor="textSecondary">
                  Meld reads your accounts through your own free Plaid account, so the connection is between you, Plaid and your bank.
                  {view?.demo ? ' Once your keys are saved, Meld opens on your own accounts.' : ''}
                </ThemedText>
                <PlaidGuide value={keys} onChange={setKeys} />
                {save.isError && <ThemedText themeColor="negative">{save.error.message}</ThemedText>}
                <View style={formStyles.buttons}>
                  <View style={formStyles.spacer} />
                  <Button
                    label="Save and link accounts"
                    onPress={connect}
                    disabled={!keys.clientId || !keys.productionSecret}
                    loading={save.isPending}
                  />
                </View>
                {save.isPending && (
                  <ThemedText type="small" themeColor="textSecondary">
                    Saving and restarting Meld…
                  </ThemedText>
                )}
              </>
            )}
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.three, maxWidth: 820 },
});
