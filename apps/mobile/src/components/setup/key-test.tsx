import type { KeyTestResult } from '@meld/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** A "Test" button and what it found. */
export function KeyTest({ label = 'Test', run, disabled }: { label?: string; run: () => Promise<KeyTestResult>; disabled?: boolean }) {
  const [state, setState] = useState<{ running: boolean; result: KeyTestResult | null }>({ running: false, result: null });

  async function test() {
    setState({ running: true, result: null });
    const result = await run().catch((e: unknown): KeyTestResult => ({ ok: false, error: e instanceof Error ? e.message : 'Test failed' }));
    setState({ running: false, result });
  }

  return (
    <View style={styles.row}>
      <Button label={label} variant="secondary" size="small" loading={state.running} disabled={disabled} onPress={test} />
      {state.result && (
        <ThemedText type="small" themeColor={state.result.ok ? 'positive' : 'negative'} style={styles.result}>
          {state.result.ok ? '✓ Works' : state.result.error}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  result: { flexShrink: 1 },
});
