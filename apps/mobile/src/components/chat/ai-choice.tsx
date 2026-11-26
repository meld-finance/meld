import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type Accent } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useChatModels } from '@/lib/queries';

type Option = { icon: 'monitor' | 'sparkles'; accent: Accent; title: string; points: string[]; action: string };

const OPTIONS: Option[] = [
  {
    icon: 'monitor',
    accent: 'green',
    title: 'On this computer',
    points: [
      'Nothing leaves this computer, and it’s free.',
      'Needs the free Ollama app and a model download of a few gigabytes.',
      'Slower, and less reliable on harder questions.',
    ],
    action: 'Set up local AI',
  },
  {
    icon: 'sparkles',
    accent: 'purple',
    title: 'A cloud model',
    points: [
      'Claude, ChatGPT or Gemini: the best answers.',
      'Each question sends only what it needs (a few transactions, say), with account numbers masked. Nothing is uploaded to keep.',
      'Uses your ChatGPT plan, or an API key you pay for as you go.',
    ],
    action: 'Set up cloud AI',
  },
];

/** Whether any model can answer; false only once the list has loaded empty. */
export function useNoChatModels() {
  const list = useChatModels();
  return !!list.data && list.data.models.length === 0;
}

/**
 * Shown in Ask Meld until an AI model is set up: everything else works without one, and here's
 * the choice between private-but-slower and better-but-cloud, in plain words.
 */
export function AIChoice({ compact }: { compact?: boolean }) {
  const theme = useTheme();
  const accents = useAccents();
  return (
    <Card
      title="Ask Meld needs an AI model"
      subtitle="Everything else in Meld works without AI. To ask questions in plain English, choose where the AI runs. You can change it any time in Settings.">
      <View style={[styles.options, compact && styles.column]}>
        {OPTIONS.map((o) => {
          const accent = accents[o.accent];
          return (
            <View key={o.title} style={[styles.option, { borderColor: theme.border, backgroundColor: theme.background }]}>
              <View style={styles.optionTitle}>
                <View style={[styles.badge, { backgroundColor: accent.bg }]}>
                  <Icon name={o.icon} size={18} color={accent.fg} />
                </View>
                <ThemedText type="smallBold">{o.title}</ThemedText>
              </View>
              {o.points.map((p) => (
                <View key={p} style={styles.point}>
                  <ThemedText type="small" themeColor="textSecondary">
                    •
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.shrink}>
                    {p}
                  </ThemedText>
                </View>
              ))}
              <View style={styles.action}>
                <Button label={o.action} variant="secondary" size="small" onPress={() => router.push('/settings')} />
              </View>
            </View>
          );
        })}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Either way, your accounts and history stay on this computer. Unlike apps that keep your finances on their servers, the AI
        only sees what one question needs, when you ask it.
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  column: { flexDirection: 'column' },
  option: { flexGrow: 1, flexBasis: 240, borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  optionTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  point: { flexDirection: 'row', gap: Spacing.two },
  shrink: { flexShrink: 1 },
  action: { alignSelf: 'flex-start', marginTop: 'auto', paddingTop: Spacing.one },
});
