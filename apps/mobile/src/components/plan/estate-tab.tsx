import {
  ESTATE_CATEGORY_LABELS,
  ESTATE_DOCUMENT_LABELS,
  ESTATE_METHOD_LABELS,
  ESTATE_ROLE_LABELS,
  type EstateCategory,
  type EstateSummary,
  type EstateTarget,
} from '@meld/shared';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Input } from '@/components/form-fields';
import { Icon } from '@/components/icon';
import { ContactsCard } from '@/components/plan/estate-contacts';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatRelativeTime, formatWholeCurrency } from '@/lib/format';
import { exportPacket } from '@/lib/packet';
import { confirm } from '@/lib/confirm';
import { useEstate, useLeaveToWill } from '@/lib/queries';

/** Beneficiaries, trusts and estate documents, and the packet your family would use. */
export function EstateTab() {
  const estate = useEstate();
  if (estate.isPending) return <ThemedText themeColor="textSecondary">Loading…</ThemedText>;
  if (estate.isError) return <ThemedText themeColor="negative">Couldn’t load your estate plan: {estate.error.message}</ThemedText>;
  const s = estate.data;
  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        Four steps: record how each account passes, keep your documents on file, list who to call, and export one packet for your
        family. This helps you organize; it isn’t legal advice, so have an estate attorney draft and review your documents.
      </ThemedText>
      <Checklist summary={s} />
      <Targets targets={s.targets} hasTrust={s.documents.some((d) => d.kind === 'revocable_trust')} />
      <Documents summary={s} />
      <ContactsCard settings={s.settings} />
      <PacketCard summary={s} />
    </>
  );
}

/** A check when done, an empty circle when not. */
function Mark({ done }: { done: boolean }) {
  const theme = useTheme();
  return done ? (
    <View style={[styles.mark, { backgroundColor: theme.positive, borderColor: theme.positive }]}>
      <Icon name="check" size={12} color={theme.background} strokeWidth={3} />
    </View>
  ) : (
    <View style={[styles.mark, { borderColor: theme.textSecondary }]} />
  );
}

function Checklist({ summary: s }: { summary: EstateSummary }) {
  const theme = useTheme();
  const { readiness: r, packet } = s;
  const pct = r.total ? r.done / r.total : 0;
  const steps = [
    {
      label: 'Accounts and policies',
      done: r.targets.done === r.targets.total,
      detail: r.targets.total ? `${r.targets.done} of ${r.targets.total} set up` : 'Nothing linked yet',
    },
    { label: 'Documents', done: r.documents.done === r.documents.total, detail: `${r.documents.done} of ${r.documents.total} on file` },
    {
      label: 'Who to call',
      done: r.contacts,
      detail: r.contacts ? plural(s.settings.contacts.length, 'contact') : 'No one listed',
    },
    {
      label: 'Family packet',
      done: !packet.stale,
      detail: packet.lastExportedAt ? (packet.stale ? 'Out of date' : `Exported ${formatRelativeTime(packet.lastExportedAt)}`) : 'Not exported',
    },
  ];
  return (
    <Card title="Checklist" subtitle="Each item checks itself off as you fill in the sections below.">
      <View style={styles.progressRow}>
        <ThemedText type="subtitle">
          {r.done} of {r.total}
        </ThemedText>
        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: theme.positive }]} />
        </View>
      </View>
      {steps.map((step) => (
        <View key={step.label} style={styles.step}>
          <Mark done={step.done} />
          <ThemedText style={styles.shrink}>{step.label}</ThemedText>
          <ThemedText type="small" themeColor={step.done ? 'textSecondary' : 'warning'}>
            {step.detail}
          </ThemedText>
        </View>
      ))}
    </Card>
  );
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function describe(t: EstateTarget): string {
  if (t.category === 'debt') return t.detail;
  const how = t.method === 'trust' ? (t.trustName ? `In ${t.trustName}` : 'Trust') : ESTATE_METHOD_LABELS[t.method];
  const primary = t.beneficiaries.filter((b) => b.primary).map((b) => b.name);
  const contingent = t.beneficiaries.filter((b) => !b.primary).length;
  const people = primary.length ? `: ${primary.join(', ')}${contingent ? ` (+${contingent} contingent)` : ''}` : '';
  return [t.detail, t.method === 'none' ? null : `${how}${people}`].filter(Boolean).join(' · ');
}

/** Groups by category, in the order the targets already come in. */
function byCategory(targets: EstateTarget[]) {
  const groups = new Map<EstateCategory, EstateTarget[]>();
  for (const t of targets) groups.set(t.category, [...(groups.get(t.category) ?? []), t]);
  return [...groups];
}

function Targets({ targets, hasTrust }: { targets: EstateTarget[]; hasTrust: boolean }) {
  const [showDone, setShowDone] = useState(false);
  const leave = useLeaveToWill();
  const listed = targets.filter((t) => t.category !== 'debt');
  const debts = targets.length - listed.length;
  if (listed.length === 0) {
    return (
      <Card title="Accounts and policies">
        <ThemedText type="small" themeColor="textSecondary">
          Link accounts or add property on the Accounts tab, and life insurance under Insurance, to set up how each one passes.
        </ThemedText>
      </Card>
    );
  }
  const todo = listed.filter((t) => t.status === 'missing' || t.status === 'review');
  const done = listed.filter((t) => !todo.includes(t));
  // Accounts with nothing set up that would go through probate; one tap says that's the plan.
  const probate = todo.filter((t) => t.kind !== 'policy' && t.status === 'review' && t.method === 'none' && t.category !== 'education');

  async function leaveRest() {
    const ok = await confirm(
      `Leave ${plural(probate.length, 'account')} to your will?`,
      'They’ll be marked “By will”: they go through probate and pass as your will says. You can still add a TOD/POD beneficiary to any of them later.',
      'Leave to will',
    );
    if (!ok) return;
    leave.mutate({
      accountIds: probate.filter((t) => t.kind === 'account').map((t) => t.id),
      manualAssetIds: probate.filter((t) => t.kind === 'asset').map((t) => t.id),
    });
  }

  return (
    <Card
      title="Accounts and policies"
      subtitle={`Tap one to record what the institution has on file. Beneficiaries are changed with the bank, brokerage or insurer, not here.${debts ? ` ${plural(debts, 'debt')} ${debts === 1 ? 'is' : 'are'} listed in the packet.` : ''}`}>
      {todo.length > 0 ? (
        <>
          <ThemedText type="smallBold">To do ({todo.length})</ThemedText>
          {byCategory(todo).map(([category, list]) => (
            <TargetGroup key={category} category={category} targets={list} />
          ))}
          {probate.length > 1 && !hasTrust && (
            <View style={styles.bulk}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.shrink}>
                Planning to leave the {probate.length} accounts with nothing set up to your will?
              </ThemedText>
              <Button label="Leave them to my will" variant="secondary" size="small" loading={leave.isPending} onPress={() => void leaveRest()} />
            </View>
          )}
          {leave.isError && (
            <ThemedText type="small" themeColor="negative">
              {leave.error.message}
            </ThemedText>
          )}
        </>
      ) : (
        <ThemedText type="small" themeColor="positive">
          Every account and policy is set up.
        </ThemedText>
      )}
      {done.length > 0 && (
        <>
          <Pressable onPress={() => setShowDone(!showDone)} style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}>
            <ThemedText type="smallBold">Set up ({done.length})</ThemedText>
            <Icon name={showDone ? 'chevronUp' : 'chevronDown'} size={16} themeColor="textSecondary" />
          </Pressable>
          {showDone && byCategory(done).map(([category, list]) => <TargetGroup key={category} category={category} targets={list} />)}
        </>
      )}
    </Card>
  );
}

function TargetGroup({ category, targets }: { category: EstateCategory; targets: EstateTarget[] }) {
  return (
    <View style={styles.group}>
      <ThemedText type="small" themeColor="textSecondary">
        {ESTATE_CATEGORY_LABELS[category]}
      </ThemedText>
      {targets.map((t) => (
        <TargetRow key={t.id} target={t} />
      ))}
    </View>
  );
}

function TargetRow({ target: t }: { target: EstateTarget }) {
  const needsWork = t.status === 'missing' || t.status === 'review';
  return (
    <Pressable onPress={() => router.push(t.href as Href)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Mark done={!needsWork} />
      <View style={styles.shrink}>
        <ThemedText numberOfLines={1}>{t.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {describe(t)}
        </ThemedText>
        {t.todo && (
          <ThemedText type="small" themeColor={t.status === 'missing' ? 'negative' : needsWork ? 'warning' : 'textSecondary'}>
            {t.todo}
          </ThemedText>
        )}
      </View>
      {t.value !== null && <ThemedText type="small">{formatWholeCurrency(t.value)}</ThemedText>}
    </Pressable>
  );
}

/** The core documents, as rows to fill in until they're on file. */
const CORE_KINDS = ['will', 'financial_poa', 'healthcare_directive', 'guardianship'] as const;

function Documents({ summary: s }: { summary: EstateSummary }) {
  const { documents, targets, issues } = s;
  // Missing core documents come from the readiness checks, which know about trusts and minor children.
  const missing = CORE_KINDS.flatMap((kind) => issues.filter((i) => i.id === `doc:${kind}`));
  return (
    <Card
      title="Documents and trusts"
      subtitle="Who each one names and where the signed original is kept."
      action={<Button label="Add" variant="secondary" size="small" onPress={() => router.push('/estate/document/new')} />}>
      {missing.map((issue) => (
        <Pressable
          key={issue.id}
          onPress={() => issue.href && router.push(issue.href as Href)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Mark done={false} />
          <View style={styles.shrink}>
            <ThemedText>{issue.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {issue.body}
            </ThemedText>
          </View>
          <ThemedText type="linkPrimary">Add</ThemedText>
        </Pressable>
      ))}
      {documents.map((d) => {
        const funded = targets.filter((t) => t.trustId === d.id).length;
        const details = [
          ESTATE_DOCUMENT_LABELS[d.kind],
          d.signedDate && `Signed ${formatDate(d.signedDate)}`,
          d.reviewedAt && `reviewed ${formatDate(d.reviewedAt)}`,
          funded > 0 && `${funded} account${funded === 1 ? '' : 's'} or asset${funded === 1 ? '' : 's'} in it`,
        ].filter(Boolean);
        const people = d.people.map((p) => `${ESTATE_ROLE_LABELS[p.role]}: ${p.name}`);
        const notes = issues.filter((i) => i.subject === d.id);
        return (
          <Pressable
            key={d.id}
            onPress={() => router.push({ pathname: '/estate/document/[id]', params: { id: d.id } })}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <Mark done />
            <View style={styles.shrink}>
              <ThemedText numberOfLines={1}>{d.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {details.join(' · ')}
              </ThemedText>
              {people.length > 0 && (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                  {people.join(' · ')}
                </ThemedText>
              )}
              {notes.map((n) => (
                <ThemedText key={n.id} type="small" themeColor="warning">
                  {n.title}. {n.body}
                </ThemedText>
              ))}
            </View>
            {d.documentFilename && <Icon name="link" size={16} themeColor="textSecondary" />}
          </Pressable>
        );
      })}
      {documents.length === 0 && missing.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          None yet. Add your trust, will, powers of attorney and healthcare directive once they’re signed.
        </ThemedText>
      )}
    </Card>
  );
}

function PacketCard({ summary: s }: { summary: EstateSummary }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const estate = useEstate();
  const tooShort = password.length > 0 && password.length < 6;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (await exportPacket(password || null)) {
        setPassword('');
        await estate.refetch();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const { lastExportedAt, stale } = s.packet;
  return (
    <Card
      title="Family packet"
      subtitle="A PDF with your accounts, how each one passes, insurance, documents, who to call and what to do first. It holds no passwords. Print it or keep it with your will, and tell your executor where it is.">
      <ThemedText type="small" themeColor={stale ? 'warning' : 'textSecondary'}>
        {lastExportedAt
          ? `Last exported ${formatRelativeTime(lastExportedAt)}${stale ? ': out of date, so export a new copy and replace the old one.' : ', still current.'}`
          : 'Not exported yet.'}
      </ThemedText>
      <View style={styles.packetRow}>
        <Input
          value={password}
          onChangeText={setPassword}
          placeholder="Password (optional)"
          secureTextEntry
          autoComplete="new-password"
          accessibilityLabel="Password for the PDF"
          style={styles.password}
        />
        <Button label="Export PDF" loading={busy} disabled={tooShort} onPress={() => void run()} />
      </View>
      <ThemedText type="small" themeColor={tooShort ? 'negative' : 'textSecondary'}>
        {tooShort
          ? 'Use at least 6 characters.'
          : 'With a password the PDF is encrypted and opens only with it. Store the password where your family will find it, such as a sealed envelope with your will.'}
      </ThemedText>
      {error && (
        <ThemedText type="small" themeColor="negative">
          {error}
        </ThemedText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  track: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  mark: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  bulk: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  packetRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  password: { flexGrow: 1, minWidth: 200 },
  group: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  shrink: { flexShrink: 1, flexGrow: 1 },
  amounts: { alignItems: 'flex-end' },
  pressed: { opacity: 0.6 },
});
