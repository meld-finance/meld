import {
  PropertySale,
  RETIREMENT_DEFAULTS,
  saleBreakdown,
  type RetirementSummary,
} from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Dropdown } from '@/components/dropdown';
import { Icon } from '@/components/icon';
import { TIPS } from '@/components/plan/retirement-tips';
import { Field, Input, Row } from '@/components/plan/profile-tab';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';

/** One property's controls, as typed. */
export type PropertyDraft = {
  on: boolean;
  sellAge: string;
  mortgageAccountId: string | null;
  rent: string;
  /** Showing the inline editor rather than the compact summary. */
  open: boolean;
};

const NO_MORTGAGE = 'none';

const parseNum = (s: string) => (s.trim() ? Number(s.replace(/[$,%\s]/g, '')) : null);

/** Spacious property sale planner: summary strip, collapsible sub-cards, full-width mortgage dropdown, and live proceeds breakdown. */
export function RetirementProperties({
  summary,
  properties,
  invalidProperty,
  appreciationText,
  sellingCostText,
  invalidAppreciation,
  invalidSellingCost,
  appreciation,
  sellingCost,
  birthYear,
  currentAge,
  retirementAge,
  onChangeProperty,
  onChangeAppreciation,
  onChangeSellingCost,
}: {
  summary: RetirementSummary;
  properties: Record<string, PropertyDraft>;
  invalidProperty: (id: string) => { sellAge: boolean; rent: boolean };
  appreciationText: string;
  sellingCostText: string;
  invalidAppreciation: boolean;
  invalidSellingCost: boolean;
  appreciation: number;
  sellingCost: number;
  birthYear: number | null;
  currentAge: number | null;
  retirementAge: number;
  onChangeProperty: (id: string, change: Partial<PropertyDraft>) => void;
  onChangeAppreciation: (text: string) => void;
  onChangeSellingCost: (text: string) => void;
}) {
  const theme = useTheme();
  const accents = useAccents();
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  const countedRows = summary.properties.flatMap((p) => {
    const d = properties[p.id];
    if (!d?.on) return [];
    const sellAge = parseNum(d.sellAge);
    const validAge = sellAge !== null && PropertySale.shape.sellAge.safeParse(sellAge).success;
    const rentVal = parseNum(d.rent);
    const validRent = PropertySale.shape.netRentAnnual.safeParse(rentVal).success;
    if (!validAge || !validRent) return [];
    const mortgage = summary.mortgages.find((m) => m.id === d.mortgageAccountId) ?? null;
    const effectiveAge = currentAge !== null ? Math.max(sellAge, currentAge) : sellAge;
    const years = currentAge !== null ? Math.max(0, effectiveAge - currentAge) : 0;
    const breakdown =
      currentAge !== null ? saleBreakdown(p, mortgage, years, appreciation, sellingCost) : null;
    return [{ property: p, sellAge: effectiveAge, rent: rentVal ?? 0, breakdown }];
  });

  const totalProceeds = countedRows.reduce((s, r) => s + (r.breakdown?.proceeds ?? 0), 0);
  const totalNetRent = countedRows.reduce((s, r) => s + r.rent, 0);
  const showAssumptions = assumptionsOpen || invalidAppreciation || invalidSellingCost;

  return (
    <Card
      title="Properties"
      tip={TIPS.properties}
      subtitle="Count a home or rental you’d sell to help pay for retirement. What you get from the sale joins your savings that year.">
      {summary.properties.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No properties yet. Add a home or rental on the Accounts tab to count a future sale here.
        </ThemedText>
      ) : (
        <>
          {countedRows.length > 0 && (
            <View style={[styles.summaryStrip, { backgroundColor: accents.teal.bg, borderColor: theme.border }]}>
              <ThemedText type="smallBold" style={{ color: accents.teal.fg }}>
                {countedRows.length} of {summary.properties.length} counted
              </ThemedText>
              {currentAge !== null && (
                <ThemedText type="small" themeColor="text">
                  · Est. net proceeds {formatWholeCurrency(totalProceeds)}
                </ThemedText>
              )}
              {totalNetRent !== 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  · Net rent {totalNetRent > 0 ? '+' : '−'}
                  {formatWholeCurrency(Math.abs(totalNetRent))}/yr
                </ThemedText>
              )}
            </View>
          )}

          <View style={styles.list}>
            {summary.properties.map((p, i) => {
              const d = properties[p.id]!;
              const bad = invalidProperty(p.id);
              const hasProblem = bad.sellAge || bad.rent;
              const expanded = d.on && (d.open || hasProblem);

              const sellAgeNum = parseNum(d.sellAge);
              const validSellAge = sellAgeNum !== null && PropertySale.shape.sellAge.safeParse(sellAgeNum).success;
              const rentNum = parseNum(d.rent);
              const mortgage = summary.mortgages.find((m) => m.id === d.mortgageAccountId) ?? null;
              const effectiveAge =
                validSellAge && currentAge !== null ? Math.max(sellAgeNum, currentAge) : sellAgeNum;
              const years =
                validSellAge && currentAge !== null ? Math.max(0, effectiveAge! - currentAge) : null;
              const breakdown =
                years !== null ? saleBreakdown(p, mortgage, years, appreciation, sellingCost) : null;

              const minSellAge = Math.max(18, currentAge ?? 18);
              const stepSellAge = (delta: number) => {
                const base = validSellAge ? sellAgeNum : Math.max(minSellAge, retirementAge);
                const next = Math.min(120, Math.max(minSellAge, Math.round(base + delta)));
                onChangeProperty(p.id, { sellAge: String(next) });
              };

              const mortgageLabel = mortgage
                ? [mortgage.institutionName, mortgage.name].filter(Boolean).join(' · ')
                : 'None';

              return (
                // Descending zIndex keeps an open mortgage dropdown above subsequent property cards.
                <View
                  key={p.id}
                  style={[
                    styles.propCard,
                    { borderColor: theme.border, zIndex: summary.properties.length - i },
                    !d.on && styles.propOff,
                  ]}>
                  <View style={styles.propHead}>
                    <View
                      style={[
                        styles.badge,
                        { backgroundColor: d.on ? accents.teal.bg : theme.backgroundSelected },
                      ]}>
                      <Icon name="home" size={18} color={d.on ? accents.teal.fg : theme.textSecondary} />
                    </View>
                    <Pressable
                      style={styles.propTitleWrap}
                      disabled={!d.on || hasProblem}
                      onPress={() => d.on && onChangeProperty(p.id, { open: !d.open })}
                      accessibilityRole={d.on ? 'button' : undefined}
                      accessibilityLabel={d.on ? `${p.name}: toggle edit` : undefined}>
                      <ThemedText type="smallBold" numberOfLines={1} themeColor={d.on ? 'text' : 'textSecondary'}>
                        {p.name}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {[p.address, `${formatWholeCurrency(p.value)} your share today`].filter(Boolean).join(' · ')}
                      </ThemedText>
                    </Pressable>
                    <View style={styles.headRight}>
                      {d.on && breakdown !== null && effectiveAge !== null && (
                        <View
                          style={[
                            styles.proceedsPill,
                            { backgroundColor: breakdown.proceeds >= 0 ? accents.teal.bg : theme.backgroundSelected },
                          ]}>
                          <ThemedText
                            type="smallBold"
                            style={{
                              color: breakdown.proceeds >= 0 ? accents.teal.fg : theme.negative,
                              fontSize: 12,
                              lineHeight: 16,
                            }}>
                            {breakdown.proceeds >= 0 ? '+' : '−'}
                            {formatCompactCurrency(Math.abs(breakdown.proceeds))} at {effectiveAge}
                          </ThemedText>
                        </View>
                      )}
                      {d.on && !hasProblem && (
                        <Pressable
                          onPress={() => onChangeProperty(p.id, { open: !d.open })}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={d.open ? `Done editing ${p.name}` : `Edit ${p.name}`}
                          style={({ hovered }) => [styles.iconBtn, hovered && { backgroundColor: theme.backgroundSelected }]}>
                          <Icon name={d.open ? 'chevronUp' : 'chevronDown'} size={18} themeColor="textSecondary" />
                        </Pressable>
                      )}
                      <Switch
                        value={d.on}
                        onValueChange={(on) => onChangeProperty(p.id, { on, open: on })}
                        accessibilityLabel={`Count selling ${p.name} toward retirement`}
                      />
                    </View>
                  </View>

                  {d.on && !expanded && validSellAge && (
                    <Pressable
                      onPress={() => onChangeProperty(p.id, { open: true })}
                      style={styles.summaryMeta}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Sell at age {effectiveAge}
                        {birthYear !== null && effectiveAge !== null ? ` (${birthYear + effectiveAge})` : ''} · Mortgage:{' '}
                        {mortgageLabel}
                        {rentNum !== null && rentNum !== 0
                          ? ` · Net rent: ${rentNum > 0 ? '+' : '−'}${formatWholeCurrency(Math.abs(rentNum))}/yr`
                          : ''}
                      </ThemedText>
                    </Pressable>
                  )}

                  {expanded && (
                    <View style={[styles.editor, { borderTopColor: theme.border }]}>
                      <Row>
                        <Field label="Sell at age" invalid={bad.sellAge}>
                          <View style={styles.stepperRow}>
                            <Pressable
                              onPress={() => stepSellAge(-1)}
                              accessibilityRole="button"
                              accessibilityLabel={`Decrease sell age for ${p.name}`}
                              style={({ hovered, pressed }) => [
                                styles.stepBtn,
                                { backgroundColor: theme.background, borderColor: hovered ? theme.tint : theme.border },
                                pressed && styles.pressed,
                              ]}>
                              <ThemedText type="smallBold">−</ThemedText>
                            </Pressable>
                            <Input
                              value={d.sellAge}
                              onChangeText={(sellAge) => onChangeProperty(p.id, { sellAge })}
                              keyboardType="number-pad"
                              inputMode="numeric"
                              maxLength={3}
                              style={styles.stepperInput}
                            />
                            <Pressable
                              onPress={() => stepSellAge(1)}
                              accessibilityRole="button"
                              accessibilityLabel={`Increase sell age for ${p.name}`}
                              style={({ hovered, pressed }) => [
                                styles.stepBtn,
                                { backgroundColor: theme.background, borderColor: hovered ? theme.tint : theme.border },
                                pressed && styles.pressed,
                              ]}>
                              <ThemedText type="smallBold">+</ThemedText>
                            </Pressable>
                          </View>
                          {validSellAge && birthYear !== null && effectiveAge !== null && (
                            <ThemedText type="small" themeColor="textSecondary">
                              In {birthYear + effectiveAge}
                              {currentAge !== null && effectiveAge > currentAge
                                ? ` (${effectiveAge - currentAge} yrs from now)`
                                : ' (this year)'}
                            </ThemedText>
                          )}
                        </Field>
                        <Field label="Net rent per year" invalid={bad.rent} tip={TIPS.netRent}>
                          <Input
                            value={d.rent}
                            onChangeText={(rent) => onChangeProperty(p.id, { rent })}
                            placeholder="$0 · rent minus costs"
                            keyboardType="numbers-and-punctuation"
                            inputMode="decimal"
                          />
                          {rentNum !== null && Number.isFinite(rentNum) && rentNum !== 0 && (
                            <ThemedText type="small" themeColor="textSecondary">
                              {rentNum > 0 ? '+' : '−'}
                              {formatWholeCurrency(Math.abs(Math.round(rentNum / 12)))}/mo until sale
                            </ThemedText>
                          )}
                        </Field>
                      </Row>

                      <View style={styles.dropdownWrap}>
                        <Field label="Mortgage on it">
                          <Dropdown
                            accessibilityLabel={`Mortgage on ${p.name}`}
                            value={d.mortgageAccountId ?? NO_MORTGAGE}
                            onChange={(v) =>
                              onChangeProperty(p.id, { mortgageAccountId: v === NO_MORTGAGE ? null : v })
                            }
                            options={[
                              { value: NO_MORTGAGE, label: 'None, or paid off' },
                              ...summary.mortgages.map((m) => ({
                                value: m.id,
                                label: [m.institutionName, m.name, formatCompactCurrency(m.balance)]
                                  .filter(Boolean)
                                  .join(' · '),
                              })),
                            ]}
                          />
                        </Field>
                      </View>

                      {breakdown !== null && effectiveAge !== null && (
                        <View style={[styles.breakdownBox, { backgroundColor: theme.background }]}>
                          <BreakdownLine
                            label={`Projected value at ${effectiveAge} (${appreciation}%/yr)`}
                            value={formatWholeCurrency(breakdown.futurePrice)}
                          />
                          <BreakdownLine
                            label={`Selling costs (${sellingCost}%)`}
                            value={`−${formatWholeCurrency(breakdown.sellingCosts)}`}
                          />
                          {mortgage && (
                            <BreakdownLine
                              label={`Mortgage left at ${effectiveAge}`}
                              value={
                                breakdown.mortgageLeft > 0
                                  ? `−${formatWholeCurrency(breakdown.mortgageLeft)}`
                                  : '$0 (paid off)'
                              }
                            />
                          )}
                          <View style={[styles.breakdownTotal, { borderTopColor: theme.border }]}>
                            <ThemedText type="smallBold">Estimated net proceeds</ThemedText>
                            <ThemedText type="smallBold" style={styles.amount}>
                              {formatWholeCurrency(breakdown.proceeds)}
                            </ThemedText>
                          </View>
                          <ThemedText type="small" themeColor="textSecondary">
                            Taxes on any gain aren’t included.
                          </ThemedText>
                        </View>
                      )}

                      {!hasProblem && (
                        <View style={styles.doneRow}>
                          <Button
                            label="Done"
                            variant="secondary"
                            size="small"
                            onPress={() => onChangeProperty(p.id, { open: false })}
                          />
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          <View style={[styles.assumptionsBox, { borderColor: theme.border }]}>
            <Pressable
              onPress={() => setAssumptionsOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showAssumptions }}
              style={styles.assumptionsHead}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.shrink}>
                <ThemedText type="smallBold">Sale assumptions</ThemedText> · {appreciation}%/yr value growth ·{' '}
                {sellingCost}% selling costs
              </ThemedText>
              <View style={styles.adjustAction}>
                <ThemedText type="small" themeColor="tint">
                  {showAssumptions ? 'Hide' : 'Adjust'}
                </ThemedText>
                <Icon name={showAssumptions ? 'chevronUp' : 'chevronDown'} size={16} themeColor="tint" />
              </View>
            </Pressable>
            {showAssumptions && (
              <View style={[styles.assumptionsBody, { borderTopColor: theme.border }]}>
                <Row>
                  <Field
                    label="Value growth after inflation, %"
                    invalid={invalidAppreciation}
                    tip={TIPS.appreciation}>
                    <Input
                      value={appreciationText}
                      onChangeText={onChangeAppreciation}
                      placeholder={String(RETIREMENT_DEFAULTS.propertyAppreciation)}
                      keyboardType="numbers-and-punctuation"
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="Selling costs, %" invalid={invalidSellingCost} tip={TIPS.sellingCosts}>
                    <Input
                      value={sellingCostText}
                      onChangeText={onChangeSellingCost}
                      placeholder={String(RETIREMENT_DEFAULTS.sellingCostPercent)}
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                    />
                  </Field>
                </Row>
              </View>
            )}
          </View>

          {countedRows.length > 0 && (
            <View style={[styles.noteBox, { backgroundColor: theme.background }]}>
              <Icon name="info" size={16} themeColor="textSecondary" />
              <ThemedText type="small" themeColor="textSecondary" style={styles.shrink}>
                Selling the home you live in? You’ll still need somewhere to live, so include rent or a smaller home’s
                costs in your retirement spending.
              </ThemedText>
            </View>
          )}
        </>
      )}
    </Card>
  );
}

function BreakdownLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.breakdownRow}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.shrink}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.amount}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
  },
  list: { gap: Spacing.three },
  propCard: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  propOff: { opacity: 0.78 },
  propHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  propTitleWrap: { flex: 1, flexShrink: 1, minWidth: 170, gap: 2 },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginLeft: 'auto' },
  proceedsPill: { paddingHorizontal: Spacing.two, paddingVertical: 3, borderRadius: Spacing.three },
  iconBtn: { padding: Spacing.one, borderRadius: Spacing.two },
  summaryMeta: { paddingLeft: 36 + Spacing.three },
  editor: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, gap: Spacing.three },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperInput: { flex: 1, textAlign: 'center', minWidth: 56 },
  pressed: { opacity: 0.7 },
  dropdownWrap: { zIndex: 10 },
  breakdownBox: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.one },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.two },
  breakdownTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.one + Spacing.half,
    marginTop: Spacing.half,
  },
  doneRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  assumptionsBox: { borderWidth: 1, borderRadius: Spacing.three },
  assumptionsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, padding: Spacing.three },
  adjustAction: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  assumptionsBody: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.three },
  noteBox: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, borderRadius: Spacing.two, padding: Spacing.three },
  amount: { fontVariant: ['tabular-nums'], textAlign: 'right' },
  shrink: { flex: 1, flexShrink: 1 },
});
