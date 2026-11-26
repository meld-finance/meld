import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Field, Input, formStyles } from '@/components/form-fields';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { testPlaidKeys } from '@/lib/setup';

import { KeyTest } from './key-test';

const SIGNUP_URL = 'https://dashboard.plaid.com/signup';
const HOME_URL = 'https://dashboard.plaid.com/';
const KEYS_URL = 'https://dashboard.plaid.com/developers/keys';
const GUIDE_URL = 'https://meld-finance.github.io/meld/docs/plaid/';

/** The two keys Meld needs for real accounts. */
export type PlaidKeysForm = { clientId: string; productionSecret: string };

type Picture = { source: number; ratio: number; alt: string };
type Step = { title: string; body: ReactNode; link?: { label: string; url: string }; pictures?: Picture[] };

function Bold({ children }: { children: string }) {
  return <ThemedText type="smallBold">{children}</ThemedText>;
}

const STEPS: Step[] = [
  {
    title: 'Sign up for Plaid and choose Personal use',
    body: (
      <>
        Plaid is the service banking apps like Venmo use to connect to banks. When it asks how you’ll use it, pick{' '}
        <Bold>Personal use</Bold>.
      </>
    ),
    link: { label: 'Open Plaid sign-up', url: SIGNUP_URL },
    pictures: [{ source: require('@/assets/images/plaid/1-personal-use.jpg'), ratio: 2982 / 1518, alt: 'Plaid asks how you’ll use it, with Personal use selected' }],
  },
  {
    title: 'Create your account',
    body: <>Sign up with Google, or with your email and a password.</>,
    pictures: [{ source: require('@/assets/images/plaid/2-create-account.jpg'), ratio: 3072 / 1504, alt: 'Plaid’s Create your account page' }],
  },
  {
    title: 'Click “Try for free”',
    body: (
      <>
        On Plaid’s home page, click <Bold>Try for free</Bold>. It may be in the banner at the top or under the Sandbox
        client ID. Don’t pick <Bold>Get full access</Bold>: that’s Plaid’s business verification, which you don’t need.
      </>
    ),
    link: { label: 'Open Plaid’s home page', url: HOME_URL },
    pictures: [{ source: require('@/assets/images/plaid/3-try-for-free.jpg'), ratio: 3062 / 1348, alt: 'Plaid’s home page with the Try for free button' }],
  },
  {
    title: 'Fill in your info and submit',
    body: (
      <>
        Plaid asks for your address, phone and date of birth, and to accept its agreements. Submit, and Plaid reviews it,
        usually within a minute.
      </>
    ),
    pictures: [
      { source: require('@/assets/images/plaid/4-your-info.jpg'), ratio: 3090 / 1326, alt: 'Try for free: Your info and Agreements, both checked' },
      { source: require('@/assets/images/plaid/5-reviewing.jpg'), ratio: 3022 / 1324, alt: 'Plaid reviewing the project' },
    ],
  },
  {
    title: 'Turn on two-step sign-in',
    body: (
      <>
        Plaid shows your production secret only after you turn on two-step sign-in. Open <Bold>Settings</Bold> at the
        bottom left, add <Bold>Text message (SMS)</Bold> under Two-factor methods, and save the recovery code it shows you.
      </>
    ),
    pictures: [{ source: require('@/assets/images/plaid/6-two-factor.jpg'), ratio: 2840 / 942, alt: 'Two-factor methods enabled with text message' }],
  },
  {
    title: 'Copy your keys into Meld',
    body: (
      <>
        Open <Bold>Developers → Keys</Bold> and copy the <Bold>Client ID</Bold> and the <Bold>Production secret</Bold>{' '}
        (not the Sandbox one) into the boxes below.
      </>
    ),
    link: { label: 'Open Plaid’s Keys page', url: KEYS_URL },
    pictures: [{ source: require('@/assets/images/plaid/7-keys.jpg'), ratio: 2618 / 1146, alt: 'Plaid’s Keys page with the Client ID and Production secret' }],
  },
];

function Screenshot({ picture }: { picture: Picture }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={`${picture.alt}. Open full size.`}
      onPress={() => void Linking.openURL(GUIDE_URL)}
      style={[styles.picture, { borderColor: theme.border, aspectRatio: picture.ratio }]}>
      <Image source={picture.source} style={styles.fill} contentFit="contain" accessibilityLabel={picture.alt} />
    </Pressable>
  );
}

/**
 * Step-by-step Plaid sign-up, with screenshots of each screen, ending in the two keys Meld
 * needs. Plaid's own flow is built for businesses, so this says exactly which buttons to press.
 */
export function PlaidGuide({
  value,
  onChange,
  savedSecret,
}: {
  value: PlaidKeysForm;
  onChange: (next: PlaidKeysForm) => void;
  /** The masked secret already saved, when changing keys from Settings. */
  savedSecret?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(0);
  const last = STEPS.length - 1;

  return (
    <View style={styles.guide}>
      <View style={[styles.need, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText type="smallBold">About 10 minutes. You’ll need:</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          An email address, a phone that gets texts, and your address and date of birth (Plaid asks for them). It’s free
          for up to 10 bank logins; one login can cover every account you have at that bank.
        </ThemedText>
      </View>

      {STEPS.map((step, i) => {
        const expanded = open === i;
        const done = i < open;
        return (
          <View key={step.title} style={[styles.step, { borderColor: expanded ? theme.tint : theme.border, backgroundColor: theme.backgroundElement }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setOpen(i)}
              style={({ pressed }) => [styles.stepHeader, pressed && styles.pressed]}>
              <View style={[styles.number, { backgroundColor: done ? theme.positive : expanded ? theme.tint : theme.backgroundSelected }]}>
                {done ? (
                  <Icon name="check" size={14} color="#ffffff" strokeWidth={2.5} />
                ) : (
                  <ThemedText type="smallBold" style={{ color: expanded ? '#ffffff' : theme.text }}>
                    {i + 1}
                  </ThemedText>
                )}
              </View>
              <ThemedText type={expanded ? 'smallBold' : 'small'} style={styles.stepTitle}>
                {step.title}
              </ThemedText>
            </Pressable>
            {expanded && (
              <View style={styles.stepBody}>
                <ThemedText type="small" themeColor="textSecondary">
                  {step.body}
                </ThemedText>
                {step.link && (
                  <ThemedText
                    type="smallBold"
                    themeColor="tint"
                    accessibilityRole="link"
                    onPress={() => void Linking.openURL(step.link!.url)}>
                    {step.link.label} ↗
                  </ThemedText>
                )}
                {step.pictures?.map((p) => <Screenshot key={p.alt} picture={p} />)}
                {i === last ? (
                  <KeyFields value={value} onChange={onChange} savedSecret={savedSecret} />
                ) : (
                  <View style={formStyles.buttons}>
                    <Button label="Done, next step" size="small" onPress={() => setOpen(i + 1)} />
                  </View>
                )}
              </View>
            )}
          </View>
        );
      })}

      <ThemedText type="small" themeColor="textSecondary">
        Keys are stored encrypted on this computer and sent only to Plaid. Stuck? The{' '}
        <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(GUIDE_URL)}>
          Plaid setup guide
        </ThemedText>{' '}
        has every step with larger pictures.
      </ThemedText>
    </View>
  );
}

function KeyFields({ value, onChange, savedSecret }: { value: PlaidKeysForm; onChange: (next: PlaidKeysForm) => void; savedSecret?: string }) {
  const set = (patch: Partial<PlaidKeysForm>) => onChange({ ...value, ...patch });
  return (
    <View style={styles.keys}>
      <Field label="Client ID">
        <Input value={value.clientId} onChangeText={(clientId) => set({ clientId: clientId.trim() })} autoCapitalize="none" autoCorrect={false} />
      </Field>
      <Field label="Production secret">
        <Input
          value={value.productionSecret}
          onChangeText={(productionSecret) => set({ productionSecret: productionSecret.trim() })}
          placeholder={savedSecret ? `Saved (${savedSecret})` : 'Not the Sandbox secret'}
          secureTextEntry
          autoCapitalize="none"
        />
      </Field>
      <KeyTest
        label="Test keys"
        disabled={!value.clientId || (!value.productionSecret && !savedSecret)}
        run={() => testPlaidKeys({ clientId: value.clientId, secret: value.productionSecret, env: 'production' })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  guide: { gap: Spacing.three },
  need: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  step: { borderWidth: 1, borderRadius: Spacing.three, overflow: 'hidden' },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + Spacing.one },
  stepTitle: { flex: 1 },
  number: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepBody: { gap: Spacing.three, paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  picture: { width: '100%', borderWidth: 1, borderRadius: Spacing.two, overflow: 'hidden', backgroundColor: '#ffffff' },
  fill: { width: '100%', height: '100%' },
  keys: { gap: Spacing.three },
  pressed: { opacity: 0.7 },
});
