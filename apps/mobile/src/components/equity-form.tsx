import {
  DEFAULT_FEDERAL_SUPPLEMENTAL_RATE,
  defaultSupplementalStateRate,
  EquityVestStatus,
  generateVestSchedule,
  maskPolicyNumber,
  VestSchedulePreset,
  WithholdingMethod,
  type EquityGrantInput,
  type EquityVestInput,
} from '@meld/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Dropdown } from '@/components/dropdown';
import { Field, formStyles, Input, parseAmount, parseDate, Row } from '@/components/form-fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccounts, useProfile } from '@/lib/queries';

type Props = {
  initial: EquityGrantInput | null;
  saving: boolean;
  error: string | null;
  onSave: (input: EquityGrantInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
  deleting?: boolean;
};

type VestDraft = {
  key: string;
  id?: string;
  vestDate: string;
  shares: string;
  status: EquityVestStatus;
  vestPrice: string;
  taxWithheld: string;
};

const NO_ACCOUNT = '__none';

const METHOD_LABELS: Record<WithholdingMethod, string> = {
  sell_to_cover: 'Sell to cover',
  net_share: 'Net shares',
  cash: 'Cash',
};

const VEST_STATUS_LABELS: Record<EquityVestStatus, string> = {
  scheduled: 'Scheduled',
  vested: 'Vested',
  forfeited: 'Forfeited',
};

const PRESET_OPTIONS: { value: Exclude<VestSchedulePreset, 'custom'>; label: string }[] = [
  { value: '4yr_1yr_cliff_quarterly', label: '4yr · 1yr cliff' },
  { value: '4yr_quarterly', label: '4yr quarterly' },
  { value: '4yr_1yr_cliff_monthly', label: '4yr cliff · monthly' },
  { value: '4yr_annual', label: '4yr annual' },
  { value: 'backloaded_5_15_40_40', label: '5/15/40/40' },
  { value: 'frontloaded_38_32_20_10', label: '38/32/20/10' },
];

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : String(v));
let nextKey = 0;
const keyFor = () => `v-${++nextKey}`;

function toVestDrafts(vests: EquityVestInput[]): VestDraft[] {
  if (!vests.length) {
    return [{ key: keyFor(), vestDate: '', shares: '', status: 'scheduled', vestPrice: '', taxWithheld: '' }];
  }
  return vests.map((v) => ({
    key: keyFor(),
    id: v.id,
    vestDate: v.vestDate,
    shares: String(v.shares),
    status: v.status,
    vestPrice: str(v.vestPrice),
    taxWithheld: str(v.taxWithheld),
  }));
}

export function EquityForm({ initial, saving, error, onSave, onCancel, onDelete, deleting }: Props) {
  const theme = useTheme();
  const accounts = useAccounts();
  const profile = useProfile();

  const [employer, setEmployer] = useState(initial?.employer ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [ticker, setTicker] = useState(initial?.ticker ?? '');
  const [manualPrice, setManualPrice] = useState(str(initial?.manualPrice));
  const [priceAsOf, setPriceAsOf] = useState(initial?.priceAsOf ?? '');
  const [grantDate, setGrantDate] = useState(initial?.grantDate ?? new Date().toLocaleDateString('en-CA'));
  const [grantNumberMask, setGrantNumberMask] = useState(initial?.grantNumberMask ?? '');
  const [totalShares, setTotalShares] = useState(str(initial?.totalShares));
  const [linkedAccountId, setLinkedAccountId] = useState(initial?.linkedAccountId ?? NO_ACCOUNT);
  const [withholdingMethod, setWithholdingMethod] = useState<WithholdingMethod>(initial?.withholdingMethod ?? 'sell_to_cover');
  const [fedRate, setFedRate] = useState(str(initial?.federalWithholdingRate));
  const [stateRate, setStateRate] = useState(str(initial?.stateWithholdingRate));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [preset, setPreset] = useState<Exclude<VestSchedulePreset, 'custom'>>('4yr_1yr_cliff_quarterly');
  const [vests, setVests] = useState<VestDraft[]>(() => toVestDrafts(initial?.vests ?? []));

  const investmentAccounts = (accounts.data ?? []).filter((a) => a.type === 'investment');
  const defaultStatePct = defaultSupplementalStateRate(profile.data?.state ?? null);

  const parsedGrantDate = parseDate(grantDate);
  const parsedTotalShares = parseAmount(totalShares);
  const parsedManualPrice = parseAmount(manualPrice);
  const parsedPriceAsOf = parseDate(priceAsOf);
  const parsedFed = parseAmount(fedRate);
  const parsedState = parseAmount(stateRate);

  const invalidGrant = new Set<string>();
  if (!employer.trim()) invalidGrant.add('employer');
  if (!name.trim()) invalidGrant.add('name');
  if (!parsedGrantDate) invalidGrant.add('grantDate');
  if (parsedTotalShares === undefined || parsedTotalShares === null || parsedTotalShares <= 0) invalidGrant.add('totalShares');
  if (parsedManualPrice === undefined || (parsedManualPrice !== null && parsedManualPrice <= 0)) invalidGrant.add('manualPrice');
  if (parsedPriceAsOf === undefined) invalidGrant.add('priceAsOf');
  if (parsedFed === undefined || (parsedFed !== null && parsedFed > 50)) invalidGrant.add('fedRate');
  if (parsedState === undefined || (parsedState !== null && parsedState > 20)) invalidGrant.add('stateRate');
  if (ticker.trim().length > 12) invalidGrant.add('ticker');

  const parsedVests = vests.map((v) => {
    const vestDate = parseDate(v.vestDate);
    const shares = parseAmount(v.shares);
    const vestPrice = parseAmount(v.vestPrice);
    const taxWithheld = parseAmount(v.taxWithheld);
    const validRow =
      Boolean(vestDate) &&
      shares !== undefined &&
      shares !== null &&
      shares > 0 &&
      vestPrice !== undefined &&
      (vestPrice === null || vestPrice > 0) &&
      taxWithheld !== undefined;
    return { v, vestDate, shares, vestPrice, taxWithheld, validRow };
  });

  const vestsValid = parsedVests.length > 0 && parsedVests.every((x) => x.validRow);
  const valid = invalidGrant.size === 0 && vestsValid;
  const vestSum = parsedVests.reduce((s, x) => s + (x.shares ?? 0), 0);

  const updateVest = (key: string, patch: Partial<VestDraft>) => {
    setVests((all) => all.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  };

  const applySchedule = () => {
    if (!parsedGrantDate || !parsedTotalShares || parsedTotalShares <= 0) return;
    const today = new Date().toLocaleDateString('en-CA');
    const generated = generateVestSchedule({ grantDate: parsedGrantDate, totalShares: parsedTotalShares, preset });
    setVests(
      generated.map((g) => ({
        key: keyFor(),
        vestDate: g.vestDate,
        shares: String(g.shares),
        status: g.vestDate < today ? 'vested' : 'scheduled',
        vestPrice: '',
        taxWithheld: '',
      })),
    );
  };

  function submit() {
    if (!valid || !parsedGrantDate || !parsedTotalShares) return;
    const cleanVests: EquityVestInput[] = parsedVests.map(({ v, vestDate, shares, vestPrice, taxWithheld }) => ({
      ...(v.id ? { id: v.id } : {}),
      vestDate: vestDate!,
      shares: shares!,
      status: v.status,
      vestPrice: v.status === 'vested' ? (vestPrice ?? null) : null,
      sharesWithheld: null,
      taxWithheld: v.status === 'vested' ? (taxWithheld ?? null) : null,
    }));

    const hasScheduled = cleanVests.some((v) => v.status === 'scheduled');
    onSave({
      kind: 'rsu',
      employer: employer.trim(),
      name: name.trim(),
      ticker: ticker.trim().toUpperCase() || null,
      manualPrice: parsedManualPrice ?? null,
      priceAsOf: parsedPriceAsOf ?? null,
      grantDate: parsedGrantDate,
      grantNumberMask: maskPolicyNumber(grantNumberMask),
      totalShares: parsedTotalShares,
      linkedAccountId: linkedAccountId === NO_ACCOUNT ? null : linkedAccountId,
      withholdingMethod,
      federalWithholdingRate: parsedFed ?? null,
      stateWithholdingRate: parsedState ?? null,
      status: hasScheduled ? 'active' : initial?.status === 'forfeited' ? 'forfeited' : 'completed',
      documentId: initial?.documentId ?? null,
      notes: notes.trim() || null,
      vests: cleanVests,
    });
  }

  return (
    <>
      <Card title="Grant">
        <Row>
          <Field label="Employer" invalid={employer.length > 0 && invalidGrant.has('employer')} flex>
            <Input value={employer} onChangeText={setEmployer} placeholder="e.g. Acme Corp" />
          </Field>
          <Field label="Grant name" invalid={name.length > 0 && invalidGrant.has('name')} flex>
            <Input value={name} onChangeText={setName} placeholder="e.g. 2025 New Hire RSU" />
          </Field>
        </Row>
        <Row>
          <Field label="Ticker (blank for private)" invalid={invalidGrant.has('ticker')} flex>
            <Input value={ticker} onChangeText={setTicker} placeholder="e.g. GOOG" autoCapitalize="characters" autoCorrect={false} />
          </Field>
          <Field label="Grant date" invalid={grantDate.length > 0 && invalidGrant.has('grantDate')} flex>
            <Input value={grantDate} onChangeText={setGrantDate} placeholder="YYYY-MM-DD" />
          </Field>
          <Field label="Total shares" invalid={totalShares.length > 0 && invalidGrant.has('totalShares')} flex>
            <Input value={totalShares} onChangeText={setTotalShares} placeholder="e.g. 1000" keyboardType="decimal-pad" inputMode="decimal" />
          </Field>
        </Row>
        <Row>
          <Field label={ticker.trim() ? 'Fallback price ($/sh)' : 'Private 409A price ($/sh)'} invalid={invalidGrant.has('manualPrice')} flex>
            <Input value={manualPrice} onChangeText={setManualPrice} placeholder={ticker.trim() ? 'Optional (uses Yahoo)' : '$'} keyboardType="decimal-pad" inputMode="decimal" />
          </Field>
          <Field label="Price as of" invalid={invalidGrant.has('priceAsOf')} flex>
            <Input value={priceAsOf} onChangeText={setPriceAsOf} placeholder="YYYY-MM-DD" />
          </Field>
          <Field label="Grant ID (last 4)" flex>
            <Input value={grantNumberMask} onChangeText={setGrantNumberMask} placeholder="Optional" autoCapitalize="characters" autoCorrect={false} />
          </Field>
        </Row>
        {investmentAccounts.length > 0 && (
          <Field label="Linked brokerage / stock plan account">
            <Dropdown
              accessibilityLabel="Linked account"
              value={linkedAccountId}
              onChange={setLinkedAccountId}
              options={[{ value: NO_ACCOUNT, label: 'None / not linked' }, ...investmentAccounts.map((a) => ({ value: a.id, label: a.name }))]}
            />
          </Field>
        )}
      </Card>

      <Card title="Tax withholding" subtitle="Used to estimate after-tax vest value and check for supplemental withholding shortfalls in Plan → Tax.">
        <Field label="Method">
          <View style={formStyles.chips}>
            {WithholdingMethod.options.map((m) => (
              <Chip key={m} label={METHOD_LABELS[m]} selected={withholdingMethod === m} onPress={() => setWithholdingMethod(m)} />
            ))}
          </View>
        </Field>
        <Row>
          <Field label="Federal supplemental (%)" invalid={invalidGrant.has('fedRate')} flex>
            <Input
              value={fedRate}
              onChangeText={setFedRate}
              placeholder={`${DEFAULT_FEDERAL_SUPPLEMENTAL_RATE}% default`}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
          </Field>
          <Field label="State supplemental (%)" invalid={invalidGrant.has('stateRate')} flex>
            <Input
              value={stateRate}
              onChangeText={setStateRate}
              placeholder={`${defaultStatePct}% default`}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
          </Field>
        </Row>
      </Card>

      <Card
        title="Vesting schedule"
        subtitle="Generate a standard schedule from your grant date and total shares, or add and edit tranches by hand."
        action={
          <Button
            label="Generate schedule"
            variant="secondary"
            size="small"
            disabled={!parsedGrantDate || !parsedTotalShares || parsedTotalShares <= 0}
            onPress={applySchedule}
          />
        }>
        <View style={formStyles.chips}>
          {PRESET_OPTIONS.map((p) => (
            <Chip key={p.value} label={p.label} selected={preset === p.value} onPress={() => setPreset(p.value)} />
          ))}
        </View>

        <View style={styles.tranches}>
          {vests.map((v, i) => {
            const p = parsedVests[i]!;
            return (
              <View key={v.key} style={[styles.trancheRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingTop: Spacing.three }]}>
                <Row>
                  <Field label="Vest date" invalid={v.vestDate.length > 0 && !p.vestDate} flex>
                    <Input value={v.vestDate} onChangeText={(vestDate) => updateVest(v.key, { vestDate })} placeholder="YYYY-MM-DD" />
                  </Field>
                  <Field label="Shares" invalid={v.shares.length > 0 && (!p.shares || p.shares <= 0)} flex>
                    <Input value={v.shares} onChangeText={(shares) => updateVest(v.key, { shares })} placeholder="0" keyboardType="decimal-pad" inputMode="decimal" />
                  </Field>
                  <Field label="Status">
                    <View style={formStyles.chips}>
                      {EquityVestStatus.options.map((s) => (
                        <Chip key={s} label={VEST_STATUS_LABELS[s]} selected={v.status === s} onPress={() => updateVest(v.key, { status: s })} />
                      ))}
                    </View>
                  </Field>
                </Row>
                {v.status === 'vested' && (
                  <Row>
                    <Field label="Vest-date price ($/sh)" invalid={p.vestPrice === undefined || (p.vestPrice !== null && p.vestPrice <= 0)} flex>
                      <Input value={v.vestPrice} onChangeText={(vestPrice) => updateVest(v.key, { vestPrice })} placeholder="Auto from close" keyboardType="decimal-pad" inputMode="decimal" />
                    </Field>
                    <Field label="Tax withheld ($)" invalid={p.taxWithheld === undefined} flex>
                      <Input value={v.taxWithheld} onChangeText={(taxWithheld) => updateVest(v.key, { taxWithheld })} placeholder="Optional" keyboardType="decimal-pad" inputMode="decimal" />
                    </Field>
                  </Row>
                )}
                {vests.length > 1 && (
                  <View style={styles.removeRow}>
                    <Button
                      label="Remove"
                      variant="secondary"
                      size="small"
                      onPress={() => setVests((all) => all.filter((x) => x.key !== v.key))}
                    />
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.scheduleFooter}>
          <Button
            label="Add vest date"
            variant="secondary"
            size="small"
            onPress={() => setVests((all) => [...all, { key: keyFor(), vestDate: '', shares: '', status: 'scheduled', vestPrice: '', taxWithheld: '' }])}
          />
          <ThemedText type="small" themeColor={parsedTotalShares && Math.abs(vestSum - parsedTotalShares) > 0.01 ? 'warning' : 'textSecondary'}>
            Tranches sum: {Math.round(vestSum * 100) / 100}
            {parsedTotalShares ? ` / ${parsedTotalShares} shares` : ' shares'}
          </ThemedText>
        </View>
      </Card>

      <Card title="Notes">
        <Field label="Grant notes">
          <Input value={notes} onChangeText={setNotes} placeholder="Cliff terms, trading window reminders, blackout dates…" multiline />
        </Field>
      </Card>

      {error && (
        <ThemedText type="small" themeColor="negative">
          {error}
        </ThemedText>
      )}
      <View style={formStyles.buttons}>
        <Button label="Save grant" disabled={!valid} loading={saving} onPress={submit} />
        <Button label="Cancel" variant="secondary" disabled={saving || deleting} onPress={onCancel} />
        <View style={formStyles.spacer} />
        {onDelete && <Button label="Delete" variant="danger" loading={deleting} disabled={saving} onPress={onDelete} />}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  tranches: { gap: Spacing.three },
  trancheRow: { gap: Spacing.two },
  removeRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  scheduleFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
});
