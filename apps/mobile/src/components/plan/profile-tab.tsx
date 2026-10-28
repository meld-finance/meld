import { FilingStatus, type UserProfile } from '@meld/shared';
import { useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useProfile, useSaveProfile } from '@/lib/queries';

const FILING_LABELS: Record<FilingStatus, string> = {
  single: 'Single',
  married_joint: 'Married, filing jointly',
  married_separate: 'Married, filing separately',
  head_of_household: 'Head of household',
  qualifying_widow: 'Qualifying surviving spouse',
};

/** About you, taxes, benefits and goals: the inputs Ask Meld and future planning tools use. */
export function ProfileTab() {
  const profile = useProfile();
  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        Used by Ask Meld for tax, retirement and insurance questions. Every field is optional; leave out anything you’d
        rather not share.
      </ThemedText>
      {profile.isPending ? (
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      ) : profile.isError ? (
        <ThemedText themeColor="negative">{profile.error.message}</ThemedText>
      ) : (
        <ProfileForm initial={profile.data} />
      )}
    </>
  );
}

const str = (v: number | string | null) => (v === null ? '' : String(v));
const int = (s: string) => (s.trim() ? Number(s.replace(/[$,\s]/g, '')) : null);

function ProfileForm({ initial }: { initial: UserProfile }) {
  const save = useSaveProfile();
  const [displayName, setDisplayName] = useState(str(initial.displayName));
  const [birthYear, setBirthYear] = useState(str(initial.birthYear));
  const [filingStatus, setFilingStatus] = useState(initial.filingStatus);
  const [state, setState] = useState(str(initial.state));
  const [dependents, setDependents] = useState(str(initial.dependents));
  const [income, setIncome] = useState(str(initial.annualGrossIncome));
  const [occupation, setOccupation] = useState(str(initial.occupation));
  const [benefits, setBenefits] = useState(str(initial.employerBenefits));
  const [goals, setGoals] = useState(str(initial.goals));
  const [saved, setSaved] = useState(false);

  const numbers = { birthYear: int(birthYear), dependents: int(dependents), annualGrossIncome: int(income) };
  const invalid = {
    birthYear: numbers.birthYear !== null && !(Number.isInteger(numbers.birthYear) && numbers.birthYear > 1900 && numbers.birthYear <= new Date().getFullYear()),
    dependents: numbers.dependents !== null && !(Number.isInteger(numbers.dependents) && numbers.dependents >= 0),
    annualGrossIncome: numbers.annualGrossIncome !== null && !(Number.isFinite(numbers.annualGrossIncome) && numbers.annualGrossIncome >= 0),
    state: !!state.trim() && !/^[A-Za-z]{2}$/.test(state.trim()),
  };
  const valid = !Object.values(invalid).some(Boolean);
  const text = (s: string) => s.trim() || null;

  function submit() {
    if (!valid) return;
    setSaved(false);
    save.mutate(
      {
        displayName: text(displayName),
        birthYear: numbers.birthYear,
        filingStatus,
        state: text(state)?.toUpperCase() ?? null,
        dependents: numbers.dependents,
        annualGrossIncome: numbers.annualGrossIncome,
        occupation: text(occupation),
        employerBenefits: text(benefits),
        goals: text(goals),
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  return (
    <>
      <Card title="About you">
        <Row>
          <Field label="Name">
            <Input value={displayName} onChangeText={setDisplayName} placeholder="Optional" />
          </Field>
          <Field label="Birth year" invalid={invalid.birthYear}>
            <Input value={birthYear} onChangeText={setBirthYear} placeholder="e.g. 1988" keyboardType="number-pad" inputMode="numeric" maxLength={4} />
          </Field>
        </Row>
        <Field label="Occupation">
          <Input value={occupation} onChangeText={setOccupation} placeholder="Used for disability insurance questions" />
        </Field>
      </Card>

      <Card title="Taxes">
        <Field label="Filing status">
          <View style={styles.chips}>
            {FilingStatus.options.map((f) => (
              <Chip key={f} label={FILING_LABELS[f]} selected={filingStatus === f} onPress={() => setFilingStatus(filingStatus === f ? null : f)} />
            ))}
          </View>
        </Field>
        <Row>
          <Field label="State" invalid={invalid.state}>
            <Input value={state} onChangeText={setState} placeholder="e.g. CA" autoCapitalize="characters" maxLength={2} />
          </Field>
          <Field label="Dependents" invalid={invalid.dependents}>
            <Input value={dependents} onChangeText={setDependents} placeholder="0" keyboardType="number-pad" inputMode="numeric" />
          </Field>
          <Field label="Household gross income / yr" invalid={invalid.annualGrossIncome}>
            <Input value={income} onChangeText={setIncome} placeholder="$" keyboardType="decimal-pad" inputMode="decimal" />
          </Field>
        </Row>
      </Card>

      <Card title="Benefits and goals">
        <Field label="Employer benefits">
          <Input
            value={benefits}
            onChangeText={setBenefits}
            placeholder="e.g. 401(k) match 50% up to 6%, HSA-eligible plan, ESPP 15% discount, RSUs vesting quarterly"
            multiline
            style={styles.multiline}
          />
        </Field>
        <Field label="Goals">
          <Input
            value={goals}
            onChangeText={setGoals}
            placeholder="e.g. Retire at 55, buy a home in 3 years, save for two kids’ college"
            multiline
            style={styles.multiline}
          />
        </Field>
      </Card>

      {save.isError && <ThemedText themeColor="negative">{save.error.message}</ThemedText>}
      <View style={styles.buttons}>
        <Button label="Save profile" disabled={!valid} loading={save.isPending} onPress={submit} />
        {saved && (
          <ThemedText type="small" themeColor="textSecondary">
            Saved. New conversations will use it.
          </ThemedText>
        )}
      </View>
    </>
  );
}

export function Field({ label, invalid, children }: { label: string; invalid?: boolean; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor={invalid ? 'negative' : 'textSecondary'}>
        {label}
        {invalid ? ' · check this' : ''}
      </ThemedText>
      {children}
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function Input({ style, ...props }: TextInputProps) {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.textSecondary}
      style={[styles.input, { color: theme.text, backgroundColor: theme.background }, style]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  field: { gap: Spacing.one, flex: 1, minWidth: 160 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
