import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const MAX_WIDTH = 320;
const EDGE = Spacing.three;
const GAP = Spacing.one + Spacing.half;

type Rect = { x: number; y: number; width: number; height: number };

/** A term and its explanation; blank lines in `body` start new paragraphs. */
export type Tip = { title: string; body: string };

/**
 * A small ⓘ that explains a term in plain words. Tapping opens a bubble next to it; tapping anywhere
 * (or Escape on the web) closes it.
 */
export function InfoTip({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  const window = useWindowDimensions();
  const anchor = useRef<ComponentRef<typeof Pressable>>(null);
  const [at, setAt] = useState<Rect | null>(null);

  const open = () => anchor.current?.measureInWindow((x, y, width, height) => setAt({ x, y, width, height }));
  const close = () => setAt(null);

  const width = Math.min(MAX_WIDTH, window.width - EDGE * 2);
  // Centered on the icon but kept on screen; below it in the top half of the screen, above it otherwise.
  const place = at && {
    width,
    left: Math.min(Math.max(at.x + at.width / 2 - width / 2, EDGE), window.width - EDGE - width),
    ...(at.y < window.height * 0.55 ? { top: at.y + at.height + GAP } : { bottom: window.height - at.y + GAP }),
  };

  return (
    <>
      <Pressable
        ref={anchor}
        onPress={open}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`What’s ${title.toLowerCase()}?`}
        style={({ hovered, pressed }) => [styles.icon, (hovered || pressed || at) && { opacity: 1 }]}>
        <Icon name="info" size={15} themeColor={at ? 'tint' : 'textSecondary'} strokeWidth={2} />
      </Pressable>
      <Modal transparent visible={!!at} onRequestClose={close} animationType="fade">
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
        {place && (
          <ThemedView
            type="backgroundElement"
            accessibilityRole="summary"
            style={[styles.bubble, place, { borderColor: theme.border }]}>
            <ThemedText type="smallBold">{title}</ThemedText>
            {typeof children === 'string' ? (
              children.split('\n\n').map((p) => (
                <ThemedText key={p} type="small" themeColor="textSecondary">
                  {p}
                </ThemedText>
              ))
            ) : (
              children
            )}
          </ThemedView>
        )}
      </Modal>
    </>
  );
}

/** A label followed by its ⓘ, for headings and field labels. */
export function WithTip({ tip, children }: { tip?: Tip; children: ReactNode }) {
  if (!tip) return children;
  return (
    <View style={styles.labelled}>
      {children}
      <InfoTip title={tip.title}>{tip.body}</InfoTip>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { opacity: 0.85, padding: 1 },
  labelled: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexShrink: 1 },
  bubble: {
    position: 'absolute',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
