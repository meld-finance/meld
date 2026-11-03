import { AlertSettings, type AlertSeverity } from '@meld/shared';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Input } from '@/components/plan/profile-tab';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccounts, useAlertSettings, useSaveAlertSettings, useTestAlert } from '@/lib/queries';

export function AlertSettingsCard() {
  const settings = useAlertSettings();
  return (
    <Card title="Alert settings" subtitle="Which alerts Meld raises, and whether they’re pushed to your phone.">
      {settings.isPending ? (
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      ) : settings.isError ? (
        <ThemedText themeColor="negative">Couldn’t load settings: {settings.error.message}</ThemedText>
      ) : (
        <SettingsForm initial={settings.data} />
      )}
    </Card>
  );
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const num = (s: string) => (s.trim() ? Number(s.replace(/[$,\s]/g, '')) : null);
const SEVERITIES: { value: AlertSeverity; label: string }[] = [
  { value: 'critical', label: 'Urgent only' },
  { value: 'warning', label: 'Warnings and urgent' },
  { value: 'info', label: 'Everything' },
];

function SettingsForm({ initial }: { initial: AlertSettings }) {
  const theme = useTheme();
  const accounts = useAccounts();
  const save = useSaveAlertSettings();
  const test = useTestAlert();
  const [s, setS] = useState(initial);
  const [cushion, setCushion] = useState(str(initial.autopayCushion || null));
  const [large, setLarge] = useState(str(initial.largeTransaction));
  const [minimums, setMinimums] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial.lowBalance).map(([k, v]) => [k, String(v)])),
  );
  const [ntfy, setNtfy] = useState(initial.ntfyUrl ?? '');
  const [saved, setSaved] = useState(false);

  const banks = (accounts.data ?? []).filter((a) => a.type === 'depository' && !a.hidden);
  const lowBalance = Object.fromEntries(
    Object.entries(minimums)
      .map(([k, v]) => [k, num(v)] as const)
      .filter(([, v]) => v !== null),
  ) as Record<string, number>;
  const next: AlertSettings = {
    ...s,
    autopayCushion: num(cushion) ?? 0,
    largeTransaction: num(large),
    lowBalance,
    ntfyUrl: ntfy.trim() || null,
  };
  const parsed = AlertSettings.safeParse(next);
  const bad = {
    cushion: num(cushion) !== null && !(num(cushion)! >= 0),
    large: num(large) !== null && !(num(large)! > 0),
    ntfy: ntfy.trim() !== '' && !AlertSettings.shape.ntfyUrl.safeParse(ntfy.trim()).success,
  };
  const set = (patch: Partial<AlertSettings>) => {
    setSaved(false);
    setS({ ...s, ...patch });
  };

  return (
    <>
      <Toggle
        label="Autopay won’t be covered"
        detail="When a card or loan’s autopay is due and its bank account won’t hold enough, after other bills due first. Set up autopay under Spending → Recurring."
        value={s.autopay}
        onChange={(autopay) => set({ autopay })}>
        {s.autopay && (
          <>
            <Toggle
              label="Count paychecks due in first"
              detail="A recurring deposit expected into the account at least a day before the payment counts toward it. Turn off to plan around today’s balance alone."
              value={s.autopayCountIncome}
              onChange={(autopayCountIncome) => set({ autopayCountIncome })}
            />
            <View style={styles.inline}>
              <ThemedText type="small" style={styles.grow}>
                Also warn when less than this would be left after the payment
              </ThemedText>
              <Input
                value={cushion}
                onChangeText={(v) => (setSaved(false), setCushion(v))}
                placeholder="$0"
                keyboardType="decimal-pad"
                inputMode="decimal"
                accessibilityLabel="Cushion to keep after autopay, dollars"
                style={[styles.amount, bad.cushion && { borderColor: theme.negative }]}
              />
            </View>
          </>
        )}
      </Toggle>

      <Section label="Low balance" detail="Warn when a bank account drops below the amount you enter. Leave blank for no alert.">
        {banks.map((b) => (
          <View key={b.id} style={styles.inline}>
            <ThemedText type="small" style={styles.grow} numberOfLines={1}>
              {b.name}
              {b.mask ? ` ••${b.mask}` : ''}
            </ThemedText>
            <Input
              value={minimums[b.id] ?? ''}
              onChangeText={(v) => (setSaved(false), setMinimums((m) => ({ ...m, [b.id]: v })))}
              placeholder="Off"
              keyboardType="decimal-pad"
              inputMode="decimal"
              accessibilityLabel={`Minimum balance for ${b.name}, dollars`}
              style={[styles.amount, num(minimums[b.id] ?? '') !== null && !(num(minimums[b.id]!)! >= 0) && { borderColor: theme.negative }]}
            />
          </View>
        ))}
      </Section>

      <Section label="Large charges" detail="Any single card or bank charge at or above this amount. Leave blank for no alert.">
        <Input
          value={large}
          onChangeText={(v) => (setSaved(false), setLarge(v))}
          placeholder="Off"
          keyboardType="decimal-pad"
          inputMode="decimal"
          accessibilityLabel="Large charge threshold, dollars"
          style={[styles.amount, bad.large && { borderColor: theme.negative }]}
        />
      </Section>

      <Toggle
        label="Price increases"
        detail="A subscription or bill with a steady price charged more."
        value={s.priceIncrease}
        onChange={(priceIncrease) => set({ priceIncrease })}
      />
      <Toggle
        label="New recurring charges"
        detail="Something started charging on a schedule in the last few months. Shown in the app, not pushed unless you push everything."
        value={s.newRecurring}
        onChange={(newRecurring) => set({ newRecurring })}
      />
      <Toggle
        label="Bank connections"
        detail="A bank needs you to sign in again, so balances (and the alerts above) would go stale."
        value={s.connection}
        onChange={(connection) => set({ connection })}
      />

      <Section
        label="Push to your phone"
        detail="Meld can send alerts through ntfy, a free notification app. Install ntfy on your phone, subscribe to a long, hard-to-guess topic, and paste its URL here (for example https://ntfy.sh/meld-7f3k9q2x). Alert titles, account names and amounts go to that server, so use your own ntfy server if you’d rather they didn’t leave your network. Leave blank to keep alerts in the app.">
        <View style={styles.inline}>
          <Input
            value={ntfy}
            onChangeText={(v) => (setSaved(false), setNtfy(v))}
            placeholder="https://ntfy.sh/your-topic"
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            accessibilityLabel="ntfy topic URL"
            style={[styles.grow, bad.ntfy && { borderColor: theme.negative }]}
          />
          <Button
            label="Send test"
            variant="secondary"
            size="small"
            disabled={!ntfy.trim() || bad.ntfy}
            loading={test.isPending}
            onPress={() => test.mutate(ntfy.trim())}
          />
        </View>
        {test.isSuccess && (
          <ThemedText type="small" themeColor="positive">
            Sent. Check your phone.
          </ThemedText>
        )}
        {test.isError && (
          <ThemedText type="small" themeColor="negative">
            {test.error.message}
          </ThemedText>
        )}
        {ntfy.trim() !== '' && (
          <View style={styles.chips}>
            {SEVERITIES.map((o) => (
              <Chip key={o.value} label={o.label} selected={s.pushMinSeverity === o.value} onPress={() => set({ pushMinSeverity: o.value })} />
            ))}
          </View>
        )}
      </Section>

      {save.isError && <ThemedText themeColor="negative">{save.error.message}</ThemedText>}
      <View style={styles.inline}>
        <Button
          label="Save"
          disabled={!parsed.success || Object.values(bad).some(Boolean)}
          loading={save.isPending}
          onPress={() => parsed.success && save.mutate(parsed.data, { onSuccess: () => setSaved(true) })}
        />
        {saved && (
          <ThemedText type="small" themeColor="textSecondary">
            Saved.
          </ThemedText>
        )}
      </View>
    </>
  );
}

function Toggle({
  label,
  detail,
  value,
  onChange,
  children,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.section, { borderTopColor: theme.border }]}>
      <View style={styles.inline}>
        <View style={styles.grow}>
          <ThemedText type="smallBold">{label}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {detail}
          </ThemedText>
        </View>
        <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
      </View>
      {children}
    </View>
  );
}

function Section({ label, detail, children }: { label: string; detail: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.section, { borderTopColor: theme.border }]}>
      <View>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two, paddingTop: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1, minWidth: 0 },
  amount: { width: 120 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
