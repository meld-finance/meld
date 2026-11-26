import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type Accent } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';

type Node = { icon: 'bank' | 'monitor' | 'sparkles'; accent: Accent; title: string; note: string; dashed?: boolean };

const BANKS: Node = { icon: 'bank', accent: 'blue', title: 'Your banks', note: 'You sign in to them in Plaid’s own window, never in Meld' };
const COMPUTER: Node = { icon: 'monitor', accent: 'green', title: 'This computer', note: 'Every balance, transaction and document is stored here, encrypted' };
const AI: Node = { icon: 'sparkles', accent: 'purple', title: 'AI, if you want it', note: 'A model on this computer, or a cloud one you pick', dashed: true };

function Box({ node, highlight }: { node: Node; highlight?: boolean }) {
  const theme = useTheme();
  const accent = useAccents()[node.accent];
  return (
    <View
      style={[
        styles.box,
        { borderColor: highlight ? accent.fg : theme.border, borderStyle: node.dashed ? 'dashed' : 'solid', backgroundColor: theme.background },
      ]}>
      <View style={[styles.badge, { backgroundColor: accent.bg }]}>
        <Icon name={node.icon} size={20} color={accent.fg} />
      </View>
      <ThemedText type="smallBold">{node.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        {node.note}
      </ThemedText>
    </View>
  );
}

function Link({ label, vertical, dashed }: { label: string; vertical: boolean; dashed?: boolean }) {
  const theme = useTheme();
  const line = { borderColor: theme.textSecondary, borderStyle: dashed ? ('dashed' as const) : ('solid' as const) };
  if (vertical) {
    return (
      <View style={styles.linkVertical}>
        <View style={[styles.lineVertical, line]} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.linkLabel}>
          {label}
        </ThemedText>
        <Icon name="arrowDown" size={14} themeColor="textSecondary" />
      </View>
    );
  }
  return (
    <View style={styles.link}>
      <ThemedText type="small" themeColor="textSecondary" style={[styles.linkLabel, styles.center]}>
        {label}
      </ThemedText>
      <View style={styles.arrow}>
        <View style={[styles.line, line]} />
        <Icon name="arrowRight" size={14} themeColor="textSecondary" />
      </View>
    </View>
  );
}

/**
 * Where Meld's data lives and what leaves the computer: banks come in through Plaid, everything
 * is kept here, and AI only sees a question's worth when you turn it on. There's no Meld server.
 */
export function DataFlow() {
  // Side by side when there's room for three boxes, stacked otherwise.
  const [width, setWidth] = useState(0);
  const vertical = width < 600;
  return (
    <View
      style={styles.wrap}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="image"
      accessibilityLabel="Your banks connect through Plaid to this computer, where everything is stored. AI is optional.">
      <View style={vertical ? styles.column : styles.row}>
        <Box node={BANKS} />
        <Link label="through Plaid" vertical={vertical} />
        <Box node={COMPUTER} highlight />
        <Link label="only what a question needs" vertical={vertical} dashed />
        <Box node={AI} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  column: { flexDirection: 'column', alignItems: 'stretch' },
  box: { flex: 1, minWidth: 0, borderWidth: 1.5, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one, alignItems: 'center' },
  badge: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  center: { textAlign: 'center' },
  link: { width: 112, alignItems: 'stretch', justifyContent: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two },
  arrow: { flexDirection: 'row', alignItems: 'center', marginRight: -4 },
  linkVertical: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.one, gap: 2 },
  line: { flex: 1, borderTopWidth: 1.5 },
  lineVertical: { height: 8, borderLeftWidth: 1.5 },
  linkLabel: { fontSize: 12, lineHeight: 15 },
});
