import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency, formatDate } from '@/lib/format';
import type { UpcomingPayment } from '@/lib/upcoming';

const COLLAPSED = 3;

export function UpcomingCard({ payments, style }: { payments: UpcomingPayment[]; style?: object }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? payments : payments.slice(0, COLLAPSED);

  return (
    <Card title="Upcoming" style={style}>
      {payments.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No upcoming payments. Loan and card due dates appear after your accounts sync; premiums appear once a policy
          has an amount, frequency and effective date.
        </ThemedText>
      ) : (
        <View>
          {shown.map((p, i) => (
            <View key={p.key} style={i > 0 && [styles.divider, { borderTopColor: theme.border }]}>
              <UpcomingRow payment={p} />
            </View>
          ))}
        </View>
      )}
      {payments.length > COLLAPSED && (
        <Pressable onPress={() => setExpanded((e) => !e)} style={styles.viewAll}>
          <ThemedText type="small" themeColor="tint">
            {expanded ? 'Show less' : `View all (${payments.length})`}
          </ThemedText>
        </Pressable>
      )}
    </Card>
  );
}

function UpcomingRow({ payment }: { payment: UpcomingPayment }) {
  const accent = useAccents()[payment.accent];
  return (
    <Pressable
      onPress={() => router.push(payment.href)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.badge, { backgroundColor: accent.bg }]}>
        <Icon name={payment.icon} size={20} color={accent.fg} />
      </View>
      <View style={styles.label}>
        <ThemedText numberOfLines={1}>{payment.label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {payment.detail}
        </ThemedText>
      </View>
      <View style={styles.amount}>
        <ThemedText type="smallBold">{formatCurrency(payment.amount)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Due {formatDate(payment.dueDate)}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three },
  divider: { borderTopWidth: 1 },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, minWidth: 0 },
  amount: { alignItems: 'flex-end' },
  viewAll: { alignSelf: 'flex-end', marginTop: 'auto' },
  pressed: { opacity: 0.6 },
});
