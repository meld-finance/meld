import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Field, Input, formStyles } from '@/components/form-fields';
import { Logo } from '@/components/logo';
import { DataFlow } from '@/components/setup/data-flow';
import { NoPassphraseNote } from '@/components/setup/no-passphrase-note';
import { PlaidGuide, type PlaidKeysForm } from '@/components/setup/plaid-guide';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCompleteSetup, useSetupStatus } from '@/lib/setup';
import { startTourOnArrival } from '@/lib/tour';

const MIN_PASSPHRASE = 8;

type Step = 'passphrase' | 'welcome' | 'banks';

/**
 * First run. The desktop app's window signs itself in, so it starts at the welcome: a picture of
 * where data goes, then demo data or the guided Plaid sign-up. AI is set up later, where it's
 * used. Elsewhere (Docker) a passphrase comes first, since a browser is the only way in.
 */
export default function SetupScreen() {
  const status = useSetupStatus();
  const complete = useCompleteSetup();
  const desktopApp = status.data?.desktop ?? false;
  const [step, setStep] = useState<Step>(desktopApp ? 'welcome' : 'passphrase');
  const [usePassphrase, setUsePassphrase] = useState(true);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [keys, setKeys] = useState<PlaidKeysForm>({ clientId: '', productionSecret: '' });

  if (status.data && !status.data.editable) {
    return (
      <Shell>
        <Card title="Finish setting up in .env">
          <ThemedText themeColor="textSecondary">
            This Meld reads its settings from <ThemedText type="code">.env</ThemedText>. Set{' '}
            <ThemedText type="code">APP_PASSPHRASE</ThemedText> (or <ThemedText type="code">APP_PASSPHRASE_OFF=1</ThemedText>), then
            either <ThemedText type="code">PLAID_CLIENT_ID</ThemedText> and a Plaid secret, or{' '}
            <ThemedText type="code">MELD_DEMO=1</ThemedText> to look around with demo data, and restart Meld.
          </ThemedText>
        </Card>
      </Shell>
    );
  }

  const passphraseError =
    passphrase.length < MIN_PASSPHRASE ? `At least ${MIN_PASSPHRASE} characters` : confirm && confirm !== passphrase ? 'The two don’t match' : null;
  const passphraseReady = !usePassphrase || (!passphraseError && confirm === passphrase);
  const chosenPassphrase = !desktopApp && usePassphrase ? passphrase : undefined;

  function startDemo() {
    startTourOnArrival();
    complete.mutate({ passphrase: chosenPassphrase });
  }

  function connect() {
    complete.mutate({
      passphrase: chosenPassphrase,
      plaid: { clientId: keys.clientId, productionSecret: keys.productionSecret, sandboxSecret: '', env: 'production' },
    });
  }

  const saving = (
    <>
      {complete.isError && <ThemedText themeColor="negative">{complete.error.message}</ThemedText>}
      {complete.isPending && (
        <ThemedText type="small" themeColor="textSecondary">
          Saving and starting Meld…
        </ThemedText>
      )}
    </>
  );

  if (step === 'passphrase') {
    return (
      <Shell>
        <Card
          title={usePassphrase ? 'Choose a passphrase' : 'No passphrase'}
          subtitle={usePassphrase ? 'You’ll unlock Meld with it, here and on your phone.' : undefined}
          action={<Switch value={usePassphrase} onValueChange={setUsePassphrase} accessibilityLabel="Require a passphrase" />}>
          {usePassphrase ? (
            <>
              <Field label="Passphrase" invalid={!!passphrase && passphrase.length < MIN_PASSPHRASE}>
                <Input value={passphrase} onChangeText={setPassphrase} secureTextEntry autoFocus placeholder={`${MIN_PASSPHRASE}+ characters`} />
              </Field>
              <Field label="Type it again" invalid={!!confirm && confirm !== passphrase}>
                <Input value={confirm} onChangeText={setConfirm} secureTextEntry onSubmitEditing={() => passphraseReady && setStep('welcome')} />
              </Field>
              {(passphrase || confirm) && passphraseError && (
                <ThemedText type="small" themeColor="textSecondary">
                  {passphraseError}
                </ThemedText>
              )}
              <ThemedText type="small" themeColor="textSecondary">
                There’s no way to recover it, so keep it somewhere safe. You can change it, or turn it off, later in Settings.
              </ThemedText>
            </>
          ) : (
            <>
              <NoPassphraseNote />
              <ThemedText type="small" themeColor="textSecondary">
                You can add one later in Settings.
              </ThemedText>
            </>
          )}
        </Card>
        <View style={formStyles.buttons}>
          <View style={formStyles.spacer} />
          <Button label="Continue" onPress={() => setStep('welcome')} disabled={!passphraseReady} />
        </View>
      </Shell>
    );
  }

  if (step === 'banks') {
    return (
      <Shell>
        <View style={styles.intro}>
          <ThemedText type="subtitle">Connect your banks</ThemedText>
          <ThemedText themeColor="textSecondary">
            Meld reads your accounts through your own free Plaid account, so the connection is between you, Plaid and your
            bank. Here’s exactly what to click.
          </ThemedText>
        </View>
        <PlaidGuide value={keys} onChange={setKeys} />
        {saving}
        <View style={formStyles.buttons}>
          <Button label="Back" variant="secondary" onPress={() => setStep('welcome')} disabled={complete.isPending} />
          <View style={formStyles.spacer} />
          <Button label="Finish" onPress={connect} disabled={!keys.clientId || !keys.productionSecret} loading={complete.isPending} />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          Not now?{' '}
          <ThemedText type="small" themeColor="tint" accessibilityRole="button" onPress={complete.isPending ? undefined : startDemo}>
            Look around with demo data
          </ThemedText>{' '}
          and connect your banks later from Settings.
        </ThemedText>
      </Shell>
    );
  }

  return (
    <Shell>
      <View style={styles.intro}>
        <View style={styles.brand}>
          <Logo size={36} />
          <ThemedText type="subtitle">Welcome to Meld</ThemedText>
        </View>
        <ThemedText themeColor="textSecondary">
          Your accounts, bills, investments and plans in one place, kept on this computer. There’s no Meld account to make and
          no Meld server holding your data.
        </ThemedText>
      </View>
      <Card title="Where your data goes">
        <DataFlow />
        <ThemedText type="small" themeColor="textSecondary">
          Meld runs here, the way a spreadsheet does. Plaid passes your balances and transactions from your bank to this
          computer, as it does for apps like Venmo. AI is off until you turn it on in Ask Meld, and then it only sees what a
          question needs.
        </ThemedText>
      </Card>
      <View style={styles.choices}>
        <Choice
          title="Look around first"
          body="Explore Meld with a made-up household and a short tour of what it can do. Nothing to set up."
          action={<Button label="Start with demo data" onPress={startDemo} loading={complete.isPending} />}
        />
        <Choice
          title="Connect my banks"
          body="Make a free Plaid account (about 10 minutes, with pictures of each step), then link your accounts."
          action={<Button label="Connect my banks" variant="secondary" onPress={() => setStep('banks')} disabled={complete.isPending} />}
        />
      </View>
      {saving}
      {!desktopApp && (
        <View style={formStyles.buttons}>
          <Button label="Back" variant="secondary" onPress={() => setStep('passphrase')} disabled={complete.isPending} />
        </View>
      )}
    </Shell>
  );
}

function Choice({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={[styles.choice, { borderColor: theme.border }]}>
      <ThemedText type="cardTitle">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.choiceBody}>
        {body}
      </ThemedText>
      <View style={styles.choiceAction}>{action}</View>
    </ThemedView>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill}>
        <ScrollView contentContainerStyle={styles.container}>{children}</ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  container: { padding: Spacing.four, gap: Spacing.four, width: '100%', maxWidth: 820, alignSelf: 'center' },
  intro: { gap: Spacing.two },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  choice: { flexGrow: 1, flexBasis: 280, borderWidth: 1, borderRadius: Spacing.three + Spacing.one, padding: Spacing.four, gap: Spacing.two },
  choiceBody: { flexGrow: 1 },
  choiceAction: { alignSelf: 'flex-start', marginTop: Spacing.two },
});
