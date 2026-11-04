import type { OllamaDetectResult } from '@meld/shared';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Field, Input, formStyles } from '@/components/form-fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { detectOllama, testAnthropicKey, type AIForm } from '@/lib/setup';

import { KeyTest } from './key-test';

const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';
const OLLAMA_URL = 'https://ollama.com/download';
/** A model that handles Meld's tools well and fits on most Macs. */
const SUGGESTED_MODEL = 'qwen3.5';

/**
 * Optional AI: an Anthropic API key (all AI features) and/or Ollama (local models,
 * for Ask Meld only). `savedKey` is the masked saved key from Settings.
 */
export function AIFields({ value, onChange, savedKey }: { value: AIForm; onChange: (next: AIForm) => void; savedKey?: string }) {
  const set = (patch: Partial<AIForm>) => onChange({ ...value, ...patch });
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<OllamaDetectResult | null>(null);

  async function detect() {
    setDetecting(true);
    try {
      const result = await detectOllama(value.ollamaUrl);
      setDetected(result);
      if (result.found) set({ ollamaUrl: result.url, ollamaModels: value.ollamaModels.filter((m) => result.models.includes(m)) });
    } catch {
      setDetected({ found: false, tried: [value.ollamaUrl || 'http://127.0.0.1:11434'] });
    } finally {
      setDetecting(false);
    }
  }

  const toggleModel = (m: string) =>
    set({ ollamaModels: value.ollamaModels.includes(m) ? value.ollamaModels.filter((x) => x !== m) : [...value.ollamaModels, m] });

  return (
    <View style={styles.fields}>
      <ThemedText type="small" themeColor="textSecondary">
        Both are optional, and Meld works without either. An Anthropic key turns on every AI feature: Ask Meld, reading
        insurance PDFs, and home and car value lookups. Ollama runs models on this computer, so nothing leaves it, but only
        for Ask Meld.
      </ThemedText>

      <ThemedText type="cardTitle">Anthropic (Claude)</ThemedText>
      <Field label="API key">
        <Input
          value={value.anthropicApiKey}
          onChangeText={(anthropicApiKey) => set({ anthropicApiKey })}
          placeholder={savedKey ? `Saved (${savedKey})` : 'sk-ant-…'}
          secureTextEntry
          autoCapitalize="none"
        />
      </Field>
      <ThemedText type="small" themeColor="textSecondary">
        Create one in the{' '}
        <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(ANTHROPIC_KEYS_URL)}>
          Anthropic Console
        </ThemedText>
        . Questions you ask, with the account data they need, are sent to Anthropic; you pay Anthropic for what you use.
      </ThemedText>
      <KeyTest disabled={!value.anthropicApiKey && !savedKey} run={() => testAnthropicKey(value.anthropicApiKey)} />

      <ThemedText type="cardTitle">Ollama (local models)</ThemedText>
      <Field label="Ollama address">
        <Input
          value={value.ollamaUrl}
          onChangeText={(ollamaUrl) => {
            set({ ollamaUrl });
            setDetected(null);
          }}
          placeholder="Leave empty to find it automatically"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>
      <View style={formStyles.buttons}>
        <Button label={detected?.found ? 'Check again' : 'Find Ollama'} variant="secondary" size="small" loading={detecting} onPress={detect} />
        {value.ollamaUrl && (
          <Button
            label="Turn off"
            variant="secondary"
            size="small"
            onPress={() => {
              set({ ollamaUrl: '', ollamaModels: [] });
              setDetected(null);
            }}
          />
        )}
      </View>
      {detected?.found === false && (
        <ThemedText type="small" themeColor="textSecondary">
          Ollama isn’t running (tried {detected.tried.join(', ')}). To use it,{' '}
          <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(OLLAMA_URL)}>
            install Ollama
          </ThemedText>{' '}
          (or <ThemedText type="code">brew install ollama</ThemedText>), open it, download a model that can use tools with{' '}
          <ThemedText type="code">ollama pull {SUGGESTED_MODEL}</ThemedText>, then try again.
        </ThemedText>
      )}
      {detected?.found &&
        (detected.models.length ? (
          <Field label={`Models to offer in Ask Meld (none picked offers all ${detected.models.length})`}>
            <View style={formStyles.chips}>
              {detected.models.map((m) => (
                <Chip key={m} label={m} selected={value.ollamaModels.includes(m)} onPress={() => toggleModel(m)} />
              ))}
            </View>
          </Field>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Found Ollama at {detected.url}, but none of its models can use tools, which Ask Meld needs. Try{' '}
            <ThemedText type="code">ollama pull {SUGGESTED_MODEL}</ThemedText>, then check again.
          </ThemedText>
        ))}
      {!detected && value.ollamaUrl && (
        <ThemedText type="small" themeColor="textSecondary">
          Using Ollama at {value.ollamaUrl}
          {value.ollamaModels.length ? ` with ${value.ollamaModels.join(', ')}` : ', with every model that can use tools'}.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: Spacing.three },
});
