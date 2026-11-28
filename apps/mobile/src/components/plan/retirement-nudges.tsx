import type { RetirementNudge, RetirementNudgeAction } from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useStartChat } from '@/hooks/use-start-chat';
import { useTheme } from '@/hooks/use-theme';

/**
 * Contextual, plain-English nudges surfaced only when the user's age, accounts, or timeline
 * make taxes, withdrawal order, RMDs, or early-access rules meaningfully important.
 */
export function RetirementNudges({
  nudges,
  onEnableDetailed,
  onOpenProfile,
  onOpenDetailedSettings,
}: {
  nudges: RetirementNudge[];
  onEnableDetailed: () => void;
  onOpenProfile: () => void;
  onOpenDetailedSettings: () => void;
}) {
  const theme = useTheme();
  const accents = useAccents();
  const startChat = useStartChat();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const visible = nudges.filter((n) => !dismissed.includes(n.id));
  if (visible.length === 0) return null;

  function runAction(action: RetirementNudgeAction) {
    if (action.kind === 'enable_detailed') onEnableDetailed();
    else if (action.kind === 'open_profile') onOpenProfile();
    else if (action.kind === 'open_detailed_settings') onOpenDetailedSettings();
    else if (action.kind === 'ask_meld') startChat.start(action.question);
  }

  return (
    <View style={styles.stack}>
      {visible.map((nudge) => {
        const isWarn = nudge.tone === 'warning';
        const accent = isWarn ? accents.orange : accents.blue;
        const open = !!expanded[nudge.id];
        return (
          <View
            key={nudge.id}
            style={[
              styles.card,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: isWarn ? accent.fg : theme.border,
              },
            ]}>
            <View style={styles.header}>
              <View style={[styles.iconWrap, { backgroundColor: accent.bg }]}>
                <Icon name={isWarn ? 'info' : 'sparkles'} size={15} color={accent.fg} />
              </View>
              <View style={styles.textCol}>
                <ThemedText type="smallBold">{nudge.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {nudge.summary}
                </ThemedText>
              </View>
              <Pressable
                onPress={() => setDismissed((d) => [...d, nudge.id])}
                accessibilityRole="button"
                accessibilityLabel={`Dismiss ${nudge.title}`}
                hitSlop={8}
                style={({ pressed }) => [styles.dismissBtn, pressed && styles.pressed]}>
                <Icon name="close" size={14} themeColor="textSecondary" />
              </Pressable>
            </View>

            {open && (
              <View style={[styles.explainerBox, { backgroundColor: theme.background, borderColor: theme.border }]}>
                <ThemedText type="smallBold" style={styles.explainerHeading}>
                  In plain English
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {nudge.explainer}
                </ThemedText>
              </View>
            )}

            <View style={styles.footer}>
              <Button
                label={nudge.action.label}
                variant={nudge.action.kind === 'enable_detailed' ? 'primary' : 'secondary'}
                size="small"
                onPress={() => runAction(nudge.action)}
              />
              <Pressable
                onPress={() => setExpanded((e) => ({ ...e, [nudge.id]: !open }))}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                style={({ hovered, pressed }) => [
                  styles.learnBtn,
                  hovered && { opacity: 0.8 },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="small" themeColor="tint">
                  {open ? 'Hide explanation' : 'What does this mean?'}
                </ThemedText>
                <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} themeColor="tint" />
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.two },
  card: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.half },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  textCol: { flex: 1, flexShrink: 1, gap: 3 },
  dismissBtn: { padding: Spacing.half },
  explainerBox: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two + Spacing.half,
    gap: Spacing.one,
  },
  explainerHeading: { fontSize: 12 },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  learnBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  pressed: { opacity: 0.7 },
});
