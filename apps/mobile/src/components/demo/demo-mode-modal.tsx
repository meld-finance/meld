import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useSwitchDemoMode } from '@/lib/setup';

type Props = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Switcher dialog letting the user enter demo mode either with the guided tour
 * or directly in the sample sandbox on their own.
 */
export function DemoModeModal({ visible, onClose }: Props) {
  const theme = useTheme();
  const accents = useAccents();
  const switchDemo = useSwitchDemoMode();
  const [fresh, setFresh] = useState(false);
  const { reset } = switchDemo;

  useEffect(() => {
    if (visible) reset();
  }, [visible, reset]);

  function handleClose() {
    if (!switchDemo.isPending) onClose();
  }

  function enter(tour: boolean) {
    switchDemo.mutate(
      { enabled: true, tour, reset: fresh },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={styles.sheetWrap} onPress={() => {}}>
          <ThemedView type="backgroundElement" style={[styles.sheet, { borderColor: theme.border }]}>
            <View style={styles.header}>
              <View style={styles.titleBlock}>
                <ThemedText type="cardTitle">Switch to demo mode</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Preview Meld with the sample Rivera household. Your real accounts stay untouched and hidden until you
                  switch back.
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close dialog"
                disabled={switchDemo.isPending}
                onPress={handleClose}
                hitSlop={8}
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}>
                <Icon name="close" size={18} themeColor="textSecondary" />
              </Pressable>
            </View>

            <View style={styles.options}>
              <ChoiceRow
                icon="flag"
                badgeBg={accents.purple.bg}
                badgeFg={accents.purple.fg}
                title="Start with guided tour"
                description="Walk through 10 common money questions with a floating guide that opens each screen."
                disabled={switchDemo.isPending}
                onPress={() => enter(true)}
              />
              <ChoiceRow
                icon="compass"
                badgeBg={accents.blue.bg}
                badgeFg={accents.blue.fg}
                title="Explore sandbox on my own"
                description="Jump straight into the sample household with no tour overlay. Start the tour or reset data anytime from the top bar."
                disabled={switchDemo.isPending}
                onPress={() => enter(false)}
              />
            </View>

            <View style={[styles.toggleRow, { borderTopColor: theme.border }]}>
              <View style={styles.toggleText}>
                <ThemedText type="smallBold">Start with fresh sample data</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Rebuilds the Rivera household from scratch
                </ThemedText>
              </View>
              <Switch
                value={fresh}
                onValueChange={setFresh}
                disabled={switchDemo.isPending}
                accessibilityLabel="Start with fresh sample data"
              />
            </View>

            {switchDemo.isPending && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={theme.tint} />
                <ThemedText type="small" themeColor="textSecondary">
                  Switching to demo mode…
                </ThemedText>
              </View>
            )}

            {switchDemo.isError && (
              <ThemedText type="small" themeColor="negative">
                {switchDemo.error.message}
              </ThemedText>
            )}
          </ThemedView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ChoiceRow({
  icon,
  badgeBg,
  badgeFg,
  title,
  description,
  disabled,
  onPress,
}: {
  icon: IconName;
  badgeBg: string;
  badgeFg: string;
  title: string;
  description: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.choice,
        {
          borderColor: hovered ? badgeFg : theme.border,
          backgroundColor: hovered ? theme.backgroundSelected : theme.background,
          opacity: disabled ? 0.6 : pressed ? 0.8 : 1,
        },
      ]}>
      <View style={[styles.choiceBadge, { backgroundColor: badgeBg }]}>
        <Icon name={icon} size={18} color={badgeFg} />
      </View>
      <View style={styles.choiceText}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {description}
        </ThemedText>
      </View>
      <Icon name="chevronRight" size={16} themeColor="textSecondary" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  sheetWrap: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  sheet: {
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  titleBlock: {
    flex: 1,
    gap: Spacing.one,
  },
  closeBtn: {
    padding: Spacing.one,
  },
  options: {
    gap: Spacing.two,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  choiceBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  choiceText: {
    flex: 1,
    gap: Spacing.half,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    borderTopWidth: 1,
    paddingTop: Spacing.three,
  },
  toggleText: {
    flex: 1,
    gap: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
});
