import type { SettingsUpdate, SettingsView } from '@meld/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Field, Input, formStyles } from '@/components/form-fields';
import { Screen } from '@/components/screen';
import { AIFields } from '@/components/setup/ai-fields';
import { ChatGPTSection } from '@/components/setup/chatgpt-card';
import { McpCard } from '@/components/setup/mcp-card';
import { NoPassphraseNote } from '@/components/setup/no-passphrase-note';
import { PhoneAccessCard } from '@/components/setup/phone-access-card';
import { PlaidFields } from '@/components/setup/plaid-fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { desktop } from '@/lib/desktop';
import { useFeatures } from '@/lib/queries';
import { useSaveSettings, useSettings, useSetupStatus, type AIForm, type PlaidForm } from '@/lib/setup';

export default function SettingsScreen() {
  const settings = useSettings();
  const phoneAccess = useSetupStatus().data?.phoneAccess ?? false;
  const back = (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
      <ThemedText type="linkPrimary">‹ Back</ThemedText>
    </Pressable>
  );

  return (
    <Screen title="Settings" actions={back}>
      {settings.isPending ? (
        <ActivityIndicator />
      ) : settings.isError ? (
        <ThemedText themeColor="negative">Couldn’t load settings: {settings.error.message}</ThemedText>
      ) : (
        <>
          {phoneAccess && <PhoneAccessCard />}
          <SettingsCards view={settings.data} />
        </>
      )}
    </Screen>
  );
}

function SettingsCards({ view }: { view: SettingsView }) {
  const fixed = (section: SettingsView['fromEnv'][number]) => !view.editable || view.fromEnv.includes(section);
  return (
    <>
      <ThemedText themeColor="textSecondary">
        Saving restarts Meld, which takes a few seconds. Keys are stored encrypted on this computer.
      </ThemedText>
      <PlaidCard view={view} fixed={fixed('plaid')} />
      <AICard view={view} fixed={fixed('ai')} />
      <McpCard />
      <PassphraseCard on={view.passphrase} fixed={fixed('passphrase')} />
      <AboutCard />
    </>
  );
}

const ABOUT_LINKS = [
  { label: 'Website', url: 'https://meld-finance.github.io/meld/' },
  { label: 'Docs', url: 'https://meld-finance.github.io/meld/docs/' },
  { label: 'Source', url: 'https://github.com/meld-finance/meld' },
];

function AboutCard() {
  const features = useFeatures();
  const version = desktop()?.version || features.data?.version;
  return (
    <Card title="About Meld">
      <ThemedText>
        <ThemedText themeColor="tint" accessibilityRole="link" onPress={() => router.push('/releases')}>
          What’s new
        </ThemedText>
        {ABOUT_LINKS.map((l) => (
          <Text key={l.url}>
            {' · '}
            <ThemedText themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(l.url)}>
              {l.label}
            </ThemedText>
          </Text>
        ))}
      </ThemedText>
      {version && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.version} selectable>
          Version {version}
        </ThemedText>
      )}
    </Card>
  );
}

function FromEnvNote() {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      Set in <ThemedText type="code">.env</ThemedText>, which wins over the app. Change it there and restart Meld.
    </ThemedText>
  );
}

function SaveRow({
  onSave,
  dirty,
  afterRestart,
}: {
  onSave: (save: ReturnType<typeof useSaveSettings>) => void;
  dirty: boolean;
  afterRestart?: (body: SettingsUpdate) => Promise<void>;
}) {
  const save = useSaveSettings(afterRestart);
  return (
    <View style={styles.save}>
      <View style={formStyles.buttons}>
        <View style={formStyles.spacer} />
        <Button label={save.isSuccess && !dirty ? 'Saved' : 'Save'} onPress={() => onSave(save)} disabled={!dirty} loading={save.isPending} />
      </View>
      {save.isError && <ThemedText themeColor="negative">{save.error.message}</ThemedText>}
    </View>
  );
}

function PlaidCard({ view, fixed }: { view: SettingsView; fixed: boolean }) {
  const initial: PlaidForm = { clientId: view.plaid.clientId, sandboxSecret: '', productionSecret: '', env: view.plaid.env };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  return (
    <Card title="Plaid" subtitle={`Using ${view.plaid.env}`}>
      {fixed ? (
        <FromEnvNote />
      ) : (
        <>
          <PlaidFields value={form} onChange={setForm} saved={view.plaid} />
          <SaveRow
            dirty={dirty}
            onSave={(save) =>
              save.mutate({ plaid: form }, { onSuccess: () => setSaved((s) => ({ ...form, sandboxSecret: s.sandboxSecret, productionSecret: s.productionSecret })) })
            }
          />
        </>
      )}
    </Card>
  );
}

function AICard({ view, fixed }: { view: SettingsView; fixed: boolean }) {
  const initial: AIForm = { anthropicApiKey: '', ollamaUrl: view.ai.ollamaUrl, ollamaModels: view.ai.ollamaModels };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [removeKey, setRemoveKey] = useState(false);
  const dirty = removeKey || JSON.stringify(form) !== JSON.stringify(saved);
  return (
    <Card title="AI">
      {fixed ? (
        <FromEnvNote />
      ) : (
        <>
          <AIFields
            value={form}
            onChange={setForm}
            savedKey={removeKey ? '' : view.ai.anthropicApiKey}
            afterAnthropic={
              !!view.ai.anthropicApiKey &&
              !form.anthropicApiKey && (
                <View style={formStyles.buttons}>
                  <Button
                    label={removeKey ? 'Keep the saved Anthropic key' : 'Remove the saved Anthropic key'}
                    variant={removeKey ? 'secondary' : 'danger'}
                    size="small"
                    onPress={() => setRemoveKey(!removeKey)}
                  />
                </View>
              )
            }
          />
          <SaveRow
            dirty={dirty}
            onSave={(save) =>
              save.mutate(
                { ai: { ...form, removeAnthropicKey: removeKey } },
                {
                  onSuccess: () => {
                    setSaved(form);
                    setRemoveKey(false);
                  },
                },
              )
            }
          />
        </>
      )}
      <ChatGPTSection />
    </Card>
  );
}

function PassphraseCard({ on, fixed }: { on: boolean; fixed: boolean }) {
  const { login } = useAuth();
  const [want, setWant] = useState(on);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const turningOff = on && !want;
  const nextValid = next.length >= 8 && next === confirm;
  // Changing or turning it off takes the current one; turning it on only a new one.
  const dirty = turningOff ? !!current : want && nextValid && (!on || !!current);
  return (
    <Card
      title="Passphrase"
      subtitle={
        fixed
          ? undefined
          : turningOff
            ? 'Enter your current passphrase to turn it off.'
            : on
              ? 'Meld asks for it to unlock.'
              : want
                ? 'Choose one to turn it on.'
                : 'Off: Meld opens without one.'
      }
      action={fixed ? undefined : <Switch value={want} onValueChange={setWant} accessibilityLabel="Require a passphrase" />}>
      {fixed ? (
        <FromEnvNote />
      ) : (
        <>
          {on && (
            <Field label="Current passphrase">
              <Input value={current} onChangeText={setCurrent} secureTextEntry />
            </Field>
          )}
          {want && (
            <>
              <Field label="New passphrase" invalid={!!next && next.length < 8}>
                <Input value={next} onChangeText={setNext} secureTextEntry placeholder="8+ characters" />
              </Field>
              <Field label="Type it again" invalid={!!confirm && confirm !== next}>
                <Input value={confirm} onChangeText={setConfirm} secureTextEntry />
              </Field>
            </>
          )}
          {!want && on && <NoPassphraseNote />}
          {(on || want) && (
            <SaveRow
              dirty={dirty}
              // Turning it on locks this device out on restart, so unlock it with the new one first.
              afterRestart={on ? undefined : async (body) => (body.passphrase?.next ? login(body.passphrase.next) : undefined)}
              onSave={(save) =>
                save.mutate(
                  { passphrase: { current, next: want ? next : null } },
                  {
                    onSuccess: () => {
                      setCurrent('');
                      setNext('');
                      setConfirm('');
                    },
                  },
                )
              }
            />
          )}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  save: { gap: Spacing.two },
  version: { opacity: 0.75 },
});
