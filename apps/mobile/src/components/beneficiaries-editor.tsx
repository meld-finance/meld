import type { Beneficiary } from '@meld/shared';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Field, formStyles, Input, parseAmount, Row } from '@/components/form-fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export type BeneficiaryDraft = { name: string; relationship: string; percentage: string; primary: boolean };

export const toBeneficiaryDrafts = (list: Beneficiary[]): BeneficiaryDraft[] =>
  list.map((b) => ({ ...b, relationship: b.relationship ?? '', percentage: String(b.percentage) }));

/** Each draft as a beneficiary, or null where it can't be saved yet. */
export function parseBeneficiaries(drafts: BeneficiaryDraft[]): (Beneficiary | null)[] {
  return drafts.map((b) => {
    const pct = parseAmount(b.percentage);
    if (!b.name.trim() || pct === null || pct === undefined || pct > 100) return null;
    return { name: b.name.trim(), relationship: b.relationship.trim() || null, percentage: pct, primary: b.primary };
  });
}

function shareWarning(list: Beneficiary[]): string | null {
  for (const [primary, label] of [
    [true, 'Primary'],
    [false, 'Contingent'],
  ] as const) {
    const group = list.filter((b) => b.primary === primary);
    const total = group.reduce((sum, b) => sum + b.percentage, 0);
    if (group.length && Math.abs(total - 100) > 0.01) return `${label} beneficiary shares add up to ${total}%, not 100%.`;
  }
  return null;
}

/** Primary and contingent beneficiaries with their shares, for a policy or an account. */
export function BeneficiariesEditor({
  value,
  onChange,
  title = 'Beneficiaries',
  subtitle,
}: {
  value: BeneficiaryDraft[];
  onChange: (next: BeneficiaryDraft[]) => void;
  title?: string;
  subtitle?: string;
}) {
  const parsed = parseBeneficiaries(value);
  const warning = shareWarning(parsed.filter((b): b is Beneficiary => !!b));
  const update = (i: number, patch: Partial<BeneficiaryDraft>) => onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <Card
      title={title}
      subtitle={subtitle}
      action={
        <Button
          label="Add"
          variant="secondary"
          size="small"
          onPress={() => onChange([...value, { name: '', relationship: '', percentage: value.length ? '' : '100', primary: true }])}
        />
      }>
      {value.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          None entered.
        </ThemedText>
      )}
      {value.map((b, i) => (
        <View key={i} style={styles.beneficiary}>
          <Row>
            <Field label="Name" invalid={!b.name.trim() && !!b.percentage} flex>
              <Input value={b.name} onChangeText={(name) => update(i, { name })} />
            </Field>
            <Field label="Relationship" flex>
              <Input value={b.relationship} onChangeText={(relationship) => update(i, { relationship })} />
            </Field>
            <Field label="Share %" invalid={parsed[i] === null && !!b.name.trim()}>
              <Input
                value={b.percentage}
                onChangeText={(percentage) => update(i, { percentage })}
                keyboardType="decimal-pad"
                inputMode="decimal"
                style={styles.percent}
              />
            </Field>
          </Row>
          <View style={formStyles.chips}>
            <Chip label="Primary" selected={b.primary} onPress={() => update(i, { primary: true })} />
            <Chip label="Contingent" selected={!b.primary} onPress={() => update(i, { primary: false })} />
            <View style={formStyles.spacer} />
            <Button label="Remove" variant="secondary" size="small" onPress={() => onChange(value.filter((_, j) => j !== i))} />
          </View>
        </View>
      ))}
      {warning && (
        <ThemedText type="small" themeColor="warning">
          {warning}
        </ThemedText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  beneficiary: { gap: Spacing.two },
  percent: { width: 80 },
});
