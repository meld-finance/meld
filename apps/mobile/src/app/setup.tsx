import { DEFAULT_OPENROUTER_MODELS } from '@meld/shared';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Field, Input, formStyles } from '@/components/form-fields';
import { AIFields } from '@/components/setup/ai-fields';
import { NoPassphraseNote } from '@/components/setup/no-passphrase-note';
import { PlaidFields } from '@/components/setup/plaid-fields';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { aiSettings, modelsText, useCompleteSetup, useSetupStatus, type AIForm, type PlaidForm } from '@/lib/setup';

const STEPS = ['Passphrase', 'Plaid', 'AI'] as const;
const MIN_PASSPHRASE = 8;

/** First run: a passphrase (or none), Plaid keys and (optionally) AI, saved on this computer. */
export default function SetupScreen() {
  const status = useSetupStatus();
  const complete = useCompleteSetup();
  const [step, setStep] = useState(0);
  const [usePassphrase, setUsePassphrase] = useState(true);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [plaid, setPlaid] = useState<PlaidForm>({ clientId: '', sandboxSecret: '', productionSecret: '', env: 'sandbox' });
  const [ai, setAI] = useState<AIForm>({
    anthropicApiKey: '',
    openrouterApiKey: '',
    openrouterModels: modelsText(DEFAULT_OPENROUTER_MODELS),
    ollamaUrl: '',
    ollamaModels: [],
  });

  const passphraseError =
    passphrase.length < MIN_PASSPHRASE
      ? `At least ${MIN_PASSPHRASE} characters`
      : confirm && confirm !== passphrase
        ? 'The two don’t match'
        : null;
  const plaidSecret = plaid.env === 'production' ? plaid.productionSecret : plaid.sandboxSecret;
  const canContinue = [!usePassphrase || (!passphraseError && confirm === passphrase), !!plaid.clientId.trim() && !!plaidSecret.trim(), true][step];

  if (status.data && !status.data.editable) {
    return (
      <Shell>
        <Card title="Finish setting up in .env">
          <ThemedText themeColor="textSecondary">
            This Meld reads its settings from <ThemedText type="code">.env</ThemedText>. Set{' '}
            <ThemedText type="code">APP_PASSPHRASE</ThemedText> (or <ThemedText type="code">APP_PASSPHRASE_OFF=1</ThemedText>),{' '}
            <ThemedText type="code">PLAID_CLIENT_ID</ThemedText> and a Plaid
            secret there, then restart Meld.
          </ThemedText>
        </Card>
      </Shell>
    );
  }

  function next() {
    if (step < STEPS.length - 1) return setStep(step + 1);
    complete.mutate({ passphrase: usePassphrase ? passphrase : undefined, plaid, ai: aiSettings(ai) });
  }

  return (
    <Shell>
      <ThemedText themeColor="textSecondary">
        Everything you set here, and all your financial data, stays on this computer.
      </ThemedText>
      <View style={styles.steps}>
        {STEPS.map((s, i) => (
          <ThemedText key={s} type={i === step ? 'smallBold' : 'small'} themeColor={i === step ? 'text' : 'textSecondary'}>
            {i + 1}. {s}
          </ThemedText>
        ))}
      </View>

      {step === 0 && (
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
                <Input value={confirm} onChangeText={setConfirm} secureTextEntry onSubmitEditing={() => canContinue && next()} />
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
      )}
      {step === 1 && (
        <Card title="Connect Plaid">
          <PlaidFields value={plaid} onChange={setPlaid} />
        </Card>
      )}
      {step === 2 && (
        <Card title="AI (optional)">
          <AIFields value={ai} onChange={setAI} inSetup />
        </Card>
      )}

      {complete.isError && <ThemedText themeColor="negative">{complete.error.message}</ThemedText>}
      <View style={formStyles.buttons}>
        {step > 0 && <Button label="Back" variant="secondary" onPress={() => setStep(step - 1)} disabled={complete.isPending} />}
        <View style={formStyles.spacer} />
        <Button
          label={step < STEPS.length - 1 ? 'Continue' : ai.anthropicApiKey || ai.openrouterApiKey || ai.ollamaUrl ? 'Finish' : 'Skip AI and finish'}
          onPress={next}
          disabled={!canContinue}
          loading={complete.isPending}
        />
      </View>
      {complete.isPending && (
        <ThemedText type="small" themeColor="textSecondary">
          Saving and starting Meld…
        </ThemedText>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill}>
        <ScrollView contentContainerStyle={styles.container}>
          <ThemedText type="subtitle">Set up Meld</ThemedText>
          {children}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  container: { padding: Spacing.four, gap: Spacing.three, width: '100%', maxWidth: 560, alignSelf: 'center' },
  steps: { flexDirection: 'row', gap: Spacing.three, flexWrap: 'wrap' },
});
