import type { OllamaDetectResult } from '@meld/shared';
import { useState, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Field, Input, formStyles } from '@/components/form-fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { detectOllama, testAnthropicKey, testOpenRouterKey, type AIForm } from '@/lib/setup';

import { KeyTest } from './key-test';

const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';
const OPENROUTER_KEYS_URL = 'https://openrouter.ai/settings/keys';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/models?supported_parameters=tools';
const OLLAMA_URL = 'https://ollama.com/download';
/** A model that handles Meld's tools well and fits on most Macs. */
const SUGGESTED_MODEL = 'qwen3.5';
const MODEL_LINE_HEIGHT = 20;

/**
 * Optional AI: an Anthropic API key (all AI features), an OpenRouter key (Gemini, GPT,
 * Claude and more, for Ask Meld) and/or Ollama (local models, for Ask Meld). `savedKey`
 * and `savedOpenRouterKey` are the masked saved keys from Settings.
 */
export function AIFields({
  value,
  onChange,
  savedKey,
  savedOpenRouterKey,
  afterAnthropic,
  afterOpenRouter,
  inSetup,
}: {
  value: AIForm;
  onChange: (next: AIForm) => void;
  savedKey?: string;
  savedOpenRouterKey?: string;
  afterAnthropic?: ReactNode;
  afterOpenRouter?: ReactNode;
  inSetup?: boolean;
}) {
  const theme = useTheme();
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
        All AI options are optional—Meld works without them. An Anthropic key turns on every AI feature (Ask Meld, reading
        insurance PDFs, and home/car value lookups). So does an OpenRouter key, with Gemini, GPT, Claude and other models
        on one account. Ollama runs completely free local models on this computer for Ask Meld so nothing leaves
        your machine.
        {inSetup ? ' You can also connect a ChatGPT plan in Settings after setup.' : ' Or sign in with your ChatGPT plan below.'}
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
      {afterAnthropic}

      <View style={[styles.subsection, { borderTopColor: theme.border }]}>
        <ThemedText type="cardTitle">OpenRouter (Gemini, GPT, Claude and more)</ThemedText>
      </View>
      <Field label="API key">
        <Input
          value={value.openrouterApiKey}
          onChangeText={(openrouterApiKey) => set({ openrouterApiKey })}
          placeholder={savedOpenRouterKey ? `Saved (${savedOpenRouterKey})` : 'sk-or-…'}
          secureTextEntry
          autoCapitalize="none"
        />
      </Field>
      <ThemedText type="small" themeColor="textSecondary">
        Turns on every AI feature, using Gemini for PDF reading and value lookups (with both keys, Anthropic does those).
        Create a key in{' '}
        <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(OPENROUTER_KEYS_URL)}>
          OpenRouter’s settings
        </ThemedText>{' '}
        and add credits; you pay OpenRouter for what you use. Questions with the account data they need, PDFs you upload and
        lookup details go to OpenRouter and the model’s maker (like Google for Gemini), using only providers that don’t
        store or train on them.
      </ThemedText>
      <KeyTest disabled={!value.openrouterApiKey && !savedOpenRouterKey} run={() => testOpenRouterKey(value.openrouterApiKey)} />
      {afterOpenRouter}
      <Field label="Models to offer in Ask Meld (one per line)">
        <Input
          value={value.openrouterModels}
          onChangeText={(openrouterModels) => set({ openrouterModels })}
          placeholder="Leave empty for the suggested models"
          multiline
          // Grows with the list, so every model shows without scrolling.
          style={{ minHeight: Math.max(4, value.openrouterModels.split('\n').length + 1) * MODEL_LINE_HEIGHT }}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>
      <ThemedText type="small" themeColor="textSecondary">
        Use IDs from{' '}
        <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(OPENROUTER_MODELS_URL)}>
          OpenRouter’s model list
        </ThemedText>
        , like <ThemedText type="code">google/gemini-4-carbon</ThemedText>. Only models that can use tools appear in Ask Meld.
      </ThemedText>

      <View style={[styles.subsection, { borderTopColor: theme.border }]}>
        <ThemedText type="cardTitle">Ollama (local models)</ThemedText>
      </View>
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
        {!!value.ollamaUrl && (
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
      {!detected && !!value.ollamaUrl && (
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
  subsection: { paddingTop: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
});
