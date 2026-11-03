import {
  ESTATE_CATEGORY_LABELS,
  ESTATE_DOCUMENT_LABELS,
  ESTATE_METHOD_LABELS,
  ESTATE_ROLE_LABELS,
  type EstateCategory,
  type EstateDocument,
  type EstateStatus,
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
import { useEstate } from '@/lib/queries';

const STATUS: Record<Exclude<EstateStatus, 'n/a'>, { label: string; color: 'positive' | 'negative' | 'warning' }> = {
  ok: { label: 'Set up', color: 'positive' },
  missing: { label: 'No beneficiary', color: 'negative' },
  review: { label: 'Review', color: 'warning' },
};

/** Beneficiaries, trusts and estate documents, and the packet your family would use. */
export function EstateTab() {
  const estate = useEstate();
  if (estate.isPending) return <ThemedText themeColor="textSecondary">Loading…</ThemedText>;
  if (estate.isError) return <ThemedText themeColor="negative">Couldn’t load your estate plan: {estate.error.message}</ThemedText>;
  const s = estate.data;
  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        Make sure every account passes the way you intend, keep your documents current, and leave your family one packet with
        everything they’ll need. This helps you organize; it isn’t legal advice, so have an estate attorney draft and review your
        documents.
      </ThemedText>
      <Readiness summary={s} />
      <PacketCard summary={s} />
      <Targets targets={s.targets} />
      <Documents documents={s.documents} targets={s.targets} />
      <ContactsCard settings={s.settings} />
    </>
  );
}

function Readiness({ summary: s }: { summary: EstateSummary }) {
  const theme = useTheme();
  const pct = s.readiness.total ? s.readiness.done / s.readiness.total : 0;
  return (
    <Card title="Readiness" subtitle="Accounts and policies set up, core documents on file, and a current family packet.">
      <View style={styles.progressRow}>
        <ThemedText type="subtitle">
          {s.readiness.done} of {s.readiness.total}
        </ThemedText>
        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: theme.positive }]} />
        </View>
      </View>
      {s.issues.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing to fix. Review everything every few years, and after a marriage, divorce, birth or death.
        </ThemedText>
      ) : (
        s.issues.map((issue, i) => (
          <Pressable
            key={issue.id}
            disabled={!issue.href}
            onPress={() => issue.href && router.push(issue.href as Href)}
            style={({ pressed }) => [styles.issue, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }, pressed && styles.pressed]}>
            <Icon name={issue.severity === 'warning' ? 'info' : 'flag'} size={18} themeColor={issue.severity === 'warning' ? 'warning' : 'tint'} />
            <View style={styles.shrink}>
              <ThemedText type="smallBold">{issue.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {issue.body}
              </ThemedText>
            </View>
          </Pressable>
        ))
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

function describe(t: EstateTarget): string {
  if (t.category === 'debt') return t.detail;
  const how = t.method === 'trust' ? (t.trustName ? `In ${t.trustName}` : 'Trust') : ESTATE_METHOD_LABELS[t.method];
  const primary = t.beneficiaries.filter((b) => b.primary).map((b) => b.name);
  const contingent = t.beneficiaries.filter((b) => !b.primary).length;
  const people = primary.length ? `: ${primary.join(', ')}${contingent ? ` (+${contingent} contingent)` : ''}` : '';
  return [t.detail, `${how}${people}`].filter(Boolean).join(' · ');
}

function Targets({ targets }: { targets: EstateTarget[] }) {
  const groups = new Map<EstateCategory, EstateTarget[]>();
  for (const t of targets) if (t.category !== 'debt') groups.set(t.category, [...(groups.get(t.category) ?? []), t]);
  const debts = targets.filter((t) => t.category === 'debt').length;
  if (groups.size === 0) {
    return (
      <Card title="Accounts and property">
        <ThemedText type="small" themeColor="textSecondary">
          Link accounts or add property on the Accounts tab, and life insurance under Insurance, to set up how each one passes.
        </ThemedText>
      </Card>
    );
  }
  return (
    <Card
      title="Accounts and property"
      subtitle={`Record what each institution has on file. Beneficiaries are changed with the bank, brokerage or insurer, not here.${debts ? ` ${debts} debt${debts === 1 ? ' is' : 's are'} listed in the packet.` : ''}`}>
      {[...groups].map(([category, list]) => (
        <View key={category} style={styles.group}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {ESTATE_CATEGORY_LABELS[category]}
          </ThemedText>
          {list.map((t) => (
            <TargetRow key={t.id} target={t} />
          ))}
        </View>
      ))}
    </Card>
  );
}

function TargetRow({ target: t }: { target: EstateTarget }) {
  const status = t.status === 'n/a' ? null : STATUS[t.status];
  return (
    <Pressable onPress={() => router.push(t.href as Href)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.shrink}>
        <ThemedText numberOfLines={1}>{t.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {describe(t)}
        </ThemedText>
      </View>
      <View style={styles.amounts}>
        {t.value !== null && <ThemedText type="small">{formatWholeCurrency(t.value)}</ThemedText>}
        {status && (
          <ThemedText type="small" themeColor={status.color}>
            {t.category === 'education' && t.status === 'review' ? 'Name a successor' : t.status === 'review' && !t.designated ? 'Not set up' : status.label}
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
}

function Documents({ documents, targets }: { documents: EstateDocument[]; targets: EstateTarget[] }) {
  return (
    <Card
      title="Documents and trusts"
      subtitle="Who each one names and where the signed original is kept."
      action={<Button label="Add" variant="secondary" size="small" onPress={() => router.push('/estate/document/new')} />}>
      {documents.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          None yet. Add your trust, will, powers of attorney and healthcare directive once they’re signed.
        </ThemedText>
      )}
      {documents.map((d) => {
        const funded = targets.filter((t) => t.trustId === d.id).length;
        const details = [
          ESTATE_DOCUMENT_LABELS[d.kind],
          d.signedDate && `Signed ${formatDate(d.signedDate)}`,
          d.reviewedAt && `reviewed ${formatDate(d.reviewedAt)}`,
          funded > 0 && `${funded} account${funded === 1 ? '' : 's'} or asset${funded === 1 ? '' : 's'} in it`,
        ].filter(Boolean);
        const people = d.people.map((p) => `${ESTATE_ROLE_LABELS[p.role]}: ${p.name}`);
        return (
          <Pressable
            key={d.id}
            onPress={() => router.push({ pathname: '/estate/document/[id]', params: { id: d.id } })}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
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
            </View>
            {d.documentFilename && <Icon name="link" size={16} themeColor="textSecondary" />}
          </Pressable>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  track: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  issue: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingTop: Spacing.two },
  packetRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  password: { flexGrow: 1, minWidth: 200 },
  group: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  shrink: { flexShrink: 1, flexGrow: 1 },
  amounts: { alignItems: 'flex-end' },
  pressed: { opacity: 0.6 },
});
