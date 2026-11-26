import { Linking, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { Field, Input, formStyles } from '@/components/form-fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { testPlaidKeys, type PlaidForm } from '@/lib/setup';

import { KeyTest } from './key-test';

const KEYS_URL = 'https://dashboard.plaid.com/developers/keys';
const PLAID_DOCS_URL = 'https://meld-finance.github.io/meld/docs/plaid/';

/**
 * Plaid keys in Settings. `saved` holds the masked secrets: a secret field left empty keeps the
 * saved one. Without `advanced`, only what real accounts need (client ID and production secret);
 * with it, the sandbox secret and the switch between Plaid's environments too.
 */
export function PlaidFields({
  value,
  onChange,
  saved,
  advanced,
}: {
  value: PlaidForm;
  onChange: (next: PlaidForm) => void;
  saved?: { sandboxSecret: string; productionSecret: string };
  advanced?: boolean;
}) {
  const set = (patch: Partial<PlaidForm>) => onChange({ ...value, ...patch });
  const secret = value.env === 'production' ? value.productionSecret : value.sandboxSecret;
  const hasSaved = !!(value.env === 'production' ? saved?.productionSecret : saved?.sandboxSecret);

  return (
    <View style={styles.fields}>
      <ThemedText type="small" themeColor="textSecondary">
        Meld reads your accounts through your own Plaid account, free for up to 10 bank logins (a login covers every account
        you have at that bank). Your keys are on Plaid’s{' '}
        <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(KEYS_URL)}>
          Developers → Keys
        </ThemedText>{' '}
        page; the{' '}
        <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(PLAID_DOCS_URL)}>
          Plaid setup guide
        </ThemedText>{' '}
        shows each step. Keys are stored encrypted on this computer and sent only to Plaid.
      </ThemedText>
      <Field label="Client ID">
        <Input value={value.clientId} onChangeText={(clientId) => set({ clientId })} autoCapitalize="none" autoCorrect={false} />
      </Field>
      <Field label="Production secret">
        <Input
          value={value.productionSecret}
          onChangeText={(productionSecret) => set({ productionSecret })}
          placeholder={saved?.productionSecret ? `Saved (${saved.productionSecret})` : 'For your real accounts'}
          secureTextEntry
          autoCapitalize="none"
        />
      </Field>
      {advanced && (
        <>
          <Field label="Sandbox secret">
            <Input
              value={value.sandboxSecret}
              onChangeText={(sandboxSecret) => set({ sandboxSecret })}
              placeholder={saved?.sandboxSecret ? `Saved (${saved.sandboxSecret})` : 'For Plaid’s test banks'}
              secureTextEntry
              autoCapitalize="none"
            />
          </Field>
          <Field label="Use">
            <View style={formStyles.chips}>
              <Chip label="Production (real accounts)" selected={value.env === 'production'} onPress={() => set({ env: 'production' })} />
              <Chip label="Sandbox (test banks)" selected={value.env === 'sandbox'} onPress={() => set({ env: 'sandbox' })} />
            </View>
          </Field>
          <ThemedText type="small" themeColor="textSecondary">
            {value.env === 'sandbox'
              ? 'Sandbox is for developers: made-up banks you sign in to with user_good / pass_good. Its data is kept apart from real data.'
              : 'Production reads your real accounts. Its data is kept apart from Sandbox’s.'}
          </ThemedText>
        </>
      )}
      <KeyTest
        label="Test keys"
        disabled={!value.clientId || (!secret && !hasSaved)}
        run={() => testPlaidKeys({ clientId: value.clientId, secret, env: value.env })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: Spacing.three },
});
