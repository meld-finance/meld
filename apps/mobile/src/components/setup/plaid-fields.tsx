import { Linking, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { Field, Input, formStyles } from '@/components/form-fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { testPlaidKeys, type PlaidForm } from '@/lib/setup';

import { KeyTest } from './key-test';

const KEYS_URL = 'https://dashboard.plaid.com/developers/keys';
const SIGNUP_URL = 'https://dashboard.plaid.com/signup';

/**
 * Plaid client ID, secrets and environment. `saved` holds the masked secrets from
 * Settings: a secret field left empty keeps the saved one.
 */
export function PlaidFields({
  value,
  onChange,
  saved,
}: {
  value: PlaidForm;
  onChange: (next: PlaidForm) => void;
  saved?: { sandboxSecret: string; productionSecret: string };
}) {
  const set = (patch: Partial<PlaidForm>) => onChange({ ...value, ...patch });
  const secret = value.env === 'production' ? value.productionSecret : value.sandboxSecret;
  const hasSaved = !!(value.env === 'production' ? saved?.productionSecret : saved?.sandboxSecret);

  return (
    <View style={styles.fields}>
      <ThemedText type="small" themeColor="textSecondary">
        Meld uses Plaid to read your accounts. A Plaid developer account is free:{' '}
        <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(SIGNUP_URL)}>
          sign up
        </ThemedText>
        , then copy your client ID and secrets from{' '}
        <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(KEYS_URL)}>
          Developers → Keys
        </ThemedText>
        . They’re stored encrypted on this computer and sent only to Plaid.
      </ThemedText>
      <Field label="Client ID">
        <Input value={value.clientId} onChangeText={(clientId) => set({ clientId })} autoCapitalize="none" autoCorrect={false} />
      </Field>
      <Field label="Sandbox secret">
        <Input
          value={value.sandboxSecret}
          onChangeText={(sandboxSecret) => set({ sandboxSecret })}
          placeholder={saved?.sandboxSecret ? `Saved (${saved.sandboxSecret})` : 'For trying Meld with test banks'}
          secureTextEntry
          autoCapitalize="none"
        />
      </Field>
      <Field label="Production secret">
        <Input
          value={value.productionSecret}
          onChangeText={(productionSecret) => set({ productionSecret })}
          placeholder={saved?.productionSecret ? `Saved (${saved.productionSecret})` : 'For your real accounts (optional for now)'}
          secureTextEntry
          autoCapitalize="none"
        />
      </Field>
      <Field label="Use">
        <View style={formStyles.chips}>
          <Chip label="Sandbox (test banks)" selected={value.env === 'sandbox'} onPress={() => set({ env: 'sandbox' })} />
          <Chip label="Production (real accounts)" selected={value.env === 'production'} onPress={() => set({ env: 'production' })} />
        </View>
      </Field>
      <ThemedText type="small" themeColor="textSecondary">
        {value.env === 'sandbox'
          ? 'Sandbox has made-up banks: pick any and sign in with user_good / pass_good. Its data is kept apart from real data, so you can switch to production any time.'
          : 'Production needs Plaid to approve your account for real data, which is free for up to 10 bank logins.'}
      </ThemedText>
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
