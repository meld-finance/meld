import {
  hasCashValue,
  InsurancePolicyType,
  isDisabilityPolicy,
  isLifePolicy,
  PremiumFrequency,
  type Beneficiary,
  type InsurancePolicyInput,
} from '@meld/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BeneficiariesEditor, parseBeneficiaries, toBeneficiaryDrafts, type BeneficiaryDraft } from '@/components/beneficiaries-editor';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Field, formStyles, Input, parseAmount, parseDate, Row, YesNo } from '@/components/form-fields';
import { ThemedText } from '@/components/themed-text';
import { coverageLabel, FREQUENCY_LABELS, POLICY_TYPE_LABELS } from '@/lib/insurance';

type Props = {
  /** A saved policy says whether its full number is on file; the number itself never comes back. */
  initial: (InsurancePolicyInput & { hasPolicyNumber?: boolean }) | null;
  saving: boolean;
  error: string | null;
  onSave: (input: InsurancePolicyInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
  deleting?: boolean;
};

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : String(v));
const num = parseAmount;
const date = parseDate;

export function PolicyForm({ initial, saving, error, onSave, onCancel, onDelete, deleting }: Props) {
  const [type, setType] = useState<InsurancePolicyType>(initial?.type ?? 'life_term');
  const [carrier, setCarrier] = useState(initial?.carrier ?? '');
  const [insuredName, setInsuredName] = useState(initial?.insuredName ?? '');
  // Blank keeps what's saved.
  const [policyNumber, setPolicyNumber] = useState('');
  const [savedMask, setSavedMask] = useState(initial?.policyNumberMask ?? null);
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
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryDraft[]>(toBeneficiaryDrafts(initial?.beneficiaries ?? []));

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

  const parsedBeneficiaries = life ? parseBeneficiaries(beneficiaries) : [];
  const beneficiariesValid = parsedBeneficiaries.every(Boolean);

  const number = policyNumber.trim();
  if (number && !/^[A-Za-z0-9][A-Za-z0-9 -]{2,38}[A-Za-z0-9]$/.test(number)) invalid.add('policyNumber');
  const valid = carrier.trim().length > 0 && invalid.size === 0 && beneficiariesValid;
  const savedPlaceholder = savedMask
    ? initial?.hasPolicyNumber
      ? `Saved, ending ${savedMask}. Type to replace`
      : `Ending ${savedMask}. Enter the full number`
    : 'For the family packet';

  function submit() {
    if (!valid) return;
    onSave({
      type,
      carrier: carrier.trim(),
      insuredName: insuredName.trim() || null,
      // A new number sets both; removing clears both; otherwise the saved ones stay.
      ...(number
        ? { policyNumber: number, policyNumberMask: null }
        : savedMask === (initial?.policyNumberMask ?? null)
          ? { policyNumberMask: savedMask }
          : { policyNumber: null, policyNumberMask: null }),
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
          <Field label="Policy number" invalid={invalid.has('policyNumber')} flex>
            <Input
              value={policyNumber}
              onChangeText={setPolicyNumber}
              placeholder={savedPlaceholder}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </Field>
        </Row>
        {savedMask && !number && (
          <Button label="Remove saved number" variant="secondary" size="small" onPress={() => setSavedMask(null)} />
        )}
        {life && (
          <ThemedText type="small" themeColor="textSecondary">
            The full number is printed in the family packet for whoever files the claim. It’s stored encrypted, the app only
            shows the last 4, and Ask Meld never sees it.
          </ThemedText>
        )}
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

      {life && <BeneficiariesEditor value={beneficiaries} onChange={setBeneficiaries} />}

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

const styles = StyleSheet.create({
  ...formStyles,
  notes: { minHeight: 72, textAlignVertical: 'top' },
});
