import {
  hasCashValue,
  InsurancePolicyType,
  isDisabilityPolicy,
  isLifePolicy,
  PremiumFrequency,
  type Beneficiary,
  type InsurancePolicyInput,
} from '@meld/shared';
import { useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { coverageLabel, FREQUENCY_LABELS, POLICY_TYPE_LABELS } from '@/lib/insurance';

type Props = {
  initial: InsurancePolicyInput | null;
  saving: boolean;
  error: string | null;
  onSave: (input: InsurancePolicyInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
  deleting?: boolean;
};

type BeneficiaryDraft = { name: string; relationship: string; percentage: string; primary: boolean };

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : String(v));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** '' → null; otherwise a non-negative number, or undefined when unreadable. */
function num(value: string): number | null | undefined {
  const t = value.replace(/[$,%\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function date(value: string): string | null | undefined {
  const t = value.trim();
  if (!t) return null;
  return ISO_DATE.test(t) && !Number.isNaN(Date.parse(t)) ? t : undefined;
}

export function PolicyForm({ initial, saving, error, onSave, onCancel, onDelete, deleting }: Props) {
  const [type, setType] = useState<InsurancePolicyType>(initial?.type ?? 'life_term');
  const [carrier, setCarrier] = useState(initial?.carrier ?? '');
  const [insuredName, setInsuredName] = useState(initial?.insuredName ?? '');
  const [policyNumberMask, setPolicyNumberMask] = useState(initial?.policyNumberMask ?? '');
  const [coverage, setCoverage] = useState(str(initial?.coverageAmount));
  const [benefitPercent, setBenefitPercent] = useState(str(initial?.benefitPercentOfIncome));
  const [premium, setPremium] = useState(str(initial?.premiumAmount));
  const [frequency, setFrequency] = useState<PremiumFrequency | null>(initial?.premiumFrequency ?? 'monthly');
  const [effectiveDate, setEffectiveDate] = useState(initial?.effectiveDate ?? '');
  const [termEndDate, setTermEndDate] = useState(initial?.termEndDate ?? '');
  const [elimination, setElimination] = useState(str(initial?.eliminationPeriodDays));
  const [benefitPeriod, setBenefitPeriod] = useState(initial?.benefitPeriod ?? '');
  const [ownOccupation, setOwnOccupation] = useState(initial?.ownOccupation ?? null);
  const [employerProvided, setEmployerProvided] = useState(initial?.employerProvided ?? null);
  const [cashValue, setCashValue] = useState(str(initial?.cashValue));
  const [surrenderValue, setSurrenderValue] = useState(str(initial?.cashSurrenderValue));
  const [loanBalance, setLoanBalance] = useState(str(initial?.loanBalance));
  const [valuesAsOf, setValuesAsOf] = useState(initial?.valuesAsOf ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryDraft[]>(
    (initial?.beneficiaries ?? []).map((b) => ({ ...b, relationship: b.relationship ?? '', percentage: str(b.percentage) })),
  );

  const life = isLifePolicy(type);
  const disability = isDisabilityPolicy(type);
  const permanent = hasCashValue(type);

  // Fields hidden for the chosen type are sent as null so stale values don't linger.
  const parsed = {
    coverageAmount: num(coverage),
    benefitPercentOfIncome: disability ? num(benefitPercent) : null,
    premiumAmount: num(premium),
    effectiveDate: date(effectiveDate),
    termEndDate: type === 'life_term' ? date(termEndDate) : null,
    eliminationPeriodDays: disability ? num(elimination) : null,
    cashValue: permanent ? num(cashValue) : null,
    cashSurrenderValue: permanent ? num(surrenderValue) : null,
    loanBalance: permanent ? num(loanBalance) : null,
    valuesAsOf: permanent ? date(valuesAsOf) : null,
  };
  const invalid = new Set(Object.entries(parsed).filter(([, v]) => v === undefined).map(([k]) => k));
  if (parsed.benefitPercentOfIncome && parsed.benefitPercentOfIncome > 100) invalid.add('benefitPercentOfIncome');
  if (parsed.eliminationPeriodDays && !Number.isInteger(parsed.eliminationPeriodDays)) invalid.add('eliminationPeriodDays');

  const parsedBeneficiaries: (Beneficiary | null)[] = life
    ? beneficiaries.map((b) => {
        const pct = num(b.percentage);
        if (!b.name.trim() || pct === null || pct === undefined || pct > 100) return null;
        return { name: b.name.trim(), relationship: b.relationship.trim() || null, percentage: pct, primary: b.primary };
      })
    : [];
  const beneficiariesValid = parsedBeneficiaries.every(Boolean);
  const shareWarning = life ? beneficiaryShareWarning(parsedBeneficiaries.filter((b): b is Beneficiary => !!b)) : null;

  const valid = carrier.trim().length > 0 && invalid.size === 0 && beneficiariesValid;

  function submit() {
    if (!valid) return;
    onSave({
      type,
      carrier: carrier.trim(),
      insuredName: insuredName.trim() || null,
      policyNumberMask: policyNumberMask.trim() || null,
      coverageAmount: parsed.coverageAmount ?? null,
      benefitPercentOfIncome: parsed.benefitPercentOfIncome ?? null,
      premiumAmount: parsed.premiumAmount ?? null,
      premiumFrequency: parsed.premiumAmount === null ? null : frequency,
      effectiveDate: parsed.effectiveDate ?? null,
      termEndDate: parsed.termEndDate ?? null,
      eliminationPeriodDays: parsed.eliminationPeriodDays ?? null,
      benefitPeriod: disability ? benefitPeriod.trim() || null : null,
      ownOccupation: disability ? ownOccupation : null,
      employerProvided,
      cashValue: parsed.cashValue ?? null,
      cashSurrenderValue: parsed.cashSurrenderValue ?? null,
      loanBalance: parsed.loanBalance ?? null,
      valuesAsOf: parsed.valuesAsOf ?? null,
      beneficiaries: parsedBeneficiaries as Beneficiary[],
      notes: notes.trim() || null,
      documentId: initial?.documentId ?? null,
    });
  }

  const updateBeneficiary = (i: number, patch: Partial<BeneficiaryDraft>) =>
    setBeneficiaries((list) => list.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <>
      <Card title="Policy">
        <Field label="Type">
          <View style={styles.chips}>
            {InsurancePolicyType.options.map((t) => (
              <Chip key={t} label={POLICY_TYPE_LABELS[t]} selected={type === t} onPress={() => setType(t)} />
            ))}
          </View>
        </Field>
        <Field label="Insurance company">
          <Input value={carrier} onChangeText={setCarrier} placeholder="e.g. Guardian" />
        </Field>
        <Row>
          <Field label="Insured person" flex>
            <Input value={insuredName} onChangeText={setInsuredName} placeholder="Name" />
          </Field>
          <Field label="Policy # (last 4)" flex>
            <Input value={policyNumberMask} onChangeText={setPolicyNumberMask} maxLength={4} autoCapitalize="characters" />
          </Field>
        </Row>
        <Field label="Employer-provided?">
          <YesNo value={employerProvided} onChange={setEmployerProvided} />
        </Field>
      </Card>

      <Card title="Coverage">
        <Row>
          <Field label={coverageLabel(type)} invalid={invalid.has('coverageAmount')} flex>
            <Input value={coverage} onChangeText={setCoverage} placeholder="$" keyboardType="decimal-pad" inputMode="decimal" />
          </Field>
          {disability && (
            <Field label="% of income" invalid={invalid.has('benefitPercentOfIncome')} flex>
              <Input value={benefitPercent} onChangeText={setBenefitPercent} placeholder="e.g. 60" keyboardType="decimal-pad" inputMode="decimal" />
            </Field>
          )}
        </Row>
        {disability && (
          <>
            <Row>
              <Field label="Waiting period (days)" invalid={invalid.has('eliminationPeriodDays')} flex>
                <Input value={elimination} onChangeText={setElimination} placeholder="e.g. 90" keyboardType="number-pad" inputMode="numeric" />
              </Field>
              <Field label="Benefits last" flex>
                <Input value={benefitPeriod} onChangeText={setBenefitPeriod} placeholder="e.g. to age 65" />
              </Field>
            </Row>
            <Field label="Own-occupation definition?">
              <YesNo value={ownOccupation} onChange={setOwnOccupation} />
            </Field>
          </>
        )}
        <Row>
          <Field label="Effective date" invalid={invalid.has('effectiveDate')} flex>
            <Input value={effectiveDate} onChangeText={setEffectiveDate} placeholder="YYYY-MM-DD" />
          </Field>
          {type === 'life_term' && (
            <Field label="Term ends" invalid={invalid.has('termEndDate')} flex>
              <Input value={termEndDate} onChangeText={setTermEndDate} placeholder="YYYY-MM-DD" />
            </Field>
          )}
        </Row>
      </Card>

      {permanent && (
        <Card
          title="Cash value"
          subtitle="From your latest annual statement. The surrender value counts toward your net worth; without it, cash value minus loans is used.">
          <Row>
            <Field label="Cash value" invalid={invalid.has('cashValue')} flex>
              <Input value={cashValue} onChangeText={setCashValue} placeholder="$" keyboardType="decimal-pad" inputMode="decimal" />
            </Field>
            <Field label="Cash surrender value" invalid={invalid.has('cashSurrenderValue')} flex>
              <Input value={surrenderValue} onChangeText={setSurrenderValue} placeholder="$" keyboardType="decimal-pad" inputMode="decimal" />
            </Field>
          </Row>
          <Row>
            <Field label="Policy loans" invalid={invalid.has('loanBalance')} flex>
              <Input value={loanBalance} onChangeText={setLoanBalance} placeholder="$" keyboardType="decimal-pad" inputMode="decimal" />
            </Field>
            <Field label="Values as of" invalid={invalid.has('valuesAsOf')} flex>
              <Input value={valuesAsOf} onChangeText={setValuesAsOf} placeholder="YYYY-MM-DD" />
            </Field>
          </Row>
        </Card>
      )}

      <Card title="Premium" subtitle="What you pay. Use 0 if your employer pays all of it.">
        <Field label="Amount" invalid={invalid.has('premiumAmount')}>
          <Input value={premium} onChangeText={setPremium} placeholder="$" keyboardType="decimal-pad" inputMode="decimal" />
        </Field>
        <View style={styles.chips}>
          {PremiumFrequency.options.map((f) => (
            <Chip key={f} label={FREQUENCY_LABELS[f]} selected={frequency === f} onPress={() => setFrequency(f)} />
          ))}
        </View>
      </Card>

      {life && (
        <Card
          title="Beneficiaries"
          action={
            <Button
              label="Add"
              variant="secondary"
              size="small"
              onPress={() =>
                setBeneficiaries((list) => [
                  ...list,
                  { name: '', relationship: '', percentage: list.length ? '' : '100', primary: true },
                ])
              }
            />
          }>
          {beneficiaries.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              None entered.
            </ThemedText>
          )}
          {beneficiaries.map((b, i) => (
            <View key={i} style={styles.beneficiary}>
              <Row>
                <Field label="Name" invalid={!b.name.trim() && !!b.percentage} flex>
                  <Input value={b.name} onChangeText={(name) => updateBeneficiary(i, { name })} />
                </Field>
                <Field label="Relationship" flex>
                  <Input value={b.relationship} onChangeText={(relationship) => updateBeneficiary(i, { relationship })} />
                </Field>
                <Field label="Share %" invalid={parsedBeneficiaries[i] === null && !!b.name.trim()}>
                  <Input
                    value={b.percentage}
                    onChangeText={(percentage) => updateBeneficiary(i, { percentage })}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    style={styles.percent}
                  />
                </Field>
              </Row>
              <View style={styles.chips}>
                <Chip label="Primary" selected={b.primary} onPress={() => updateBeneficiary(i, { primary: true })} />
                <Chip label="Contingent" selected={!b.primary} onPress={() => updateBeneficiary(i, { primary: false })} />
                <View style={styles.spacer} />
                <Button
                  label="Remove"
                  variant="secondary"
                  size="small"
                  onPress={() => setBeneficiaries((list) => list.filter((_, j) => j !== i))}
                />
              </View>
            </View>
          ))}
          {shareWarning && (
            <ThemedText type="small" themeColor="warning">
              {shareWarning}
            </ThemedText>
          )}
        </Card>
      )}

      <Card title="Notes">
        <Input
          value={notes}
          onChangeText={setNotes}
          placeholder="Riders, conversion options, when coverage ends…"
          multiline
          style={styles.notes}
        />
      </Card>

      {error && <ThemedText themeColor="negative">{error}</ThemedText>}
      {!valid && (
        <ThemedText type="small" themeColor="textSecondary">
          {!carrier.trim() ? 'Enter the insurance company to save.' : 'Fix the highlighted fields to save.'}
        </ThemedText>
      )}
      <View style={styles.buttons}>
        <Button label="Save policy" disabled={!valid} loading={saving} onPress={submit} />
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
        <View style={styles.spacer} />
        {onDelete && <Button label="Delete" variant="danger" loading={deleting} onPress={onDelete} />}
      </View>
    </>
  );
}

function beneficiaryShareWarning(list: Beneficiary[]): string | null {
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

function Field({ label, invalid, flex, children }: { label: string; invalid?: boolean; flex?: boolean; children: ReactNode }) {
  return (
    <View style={[styles.field, flex && styles.flex]}>
      <ThemedText type="small" themeColor={invalid ? 'negative' : 'textSecondary'}>
        {label}
        {invalid ? ' · check this' : ''}
      </ThemedText>
      {children}
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function Input({ style, ...props }: TextInputProps) {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.textSecondary}
      style={[styles.input, { color: theme.text, backgroundColor: theme.background }, style]}
      {...props}
    />
  );
}

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <View style={styles.chips}>
      <Chip label="Yes" selected={value === true} onPress={() => onChange(true)} />
      <Chip label="No" selected={value === false} onPress={() => onChange(false)} />
      <Chip label="Not sure" selected={value === null} onPress={() => onChange(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  field: { gap: Spacing.one, minWidth: 140 },
  flex: { flex: 1 },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  percent: { width: 80 },
  notes: { minHeight: 72, textAlignVertical: 'top' },
  beneficiary: { gap: Spacing.two },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  spacer: { flex: 1 },
});
