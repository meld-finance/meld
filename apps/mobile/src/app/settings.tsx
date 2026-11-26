import type { SettingsUpdate, SettingsView } from '@meld/shared';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
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
import { aiSettings, modelsText, useSaveSettings, useSettings, useSetupStatus, type AIForm, type PlaidForm } from '@/lib/setup';

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
      <PassphraseCard view={view} fixed={fixed('passphrase')} />
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
  left,
}: {
  onSave: (save: ReturnType<typeof useSaveSettings>) => void;
  dirty: boolean;
  afterRestart?: (body: SettingsUpdate) => Promise<void>;
  /** Other actions, to the left of Save. */
  left?: ReactNode;
}) {
  const save = useSaveSettings(afterRestart);
  return (
    <View style={styles.save}>
      <View style={[formStyles.buttons, styles.wrap]}>
        {left}
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
  // Sandbox and test banks are for developers; most people only ever need production keys.
  const [advanced, setAdvanced] = useState(view.plaid.env === 'sandbox');
  const switchData = useSaveSettings();
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  if (view.demo) {
    return (
      <Card title="Bank connections" subtitle="Showing demo data">
        {fixed ? (
          <FromEnvNote />
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              Meld is showing a made-up household. Connect your banks to see your own accounts instead.
            </ThemedText>
            <View style={formStyles.buttons}>
              <Button label="Connect my banks" onPress={() => router.push('/connect')} />
              {view.plaidReady && (
                <Button label="Use my accounts" variant="secondary" loading={switchData.isPending} onPress={() => switchData.mutate({ demo: false })} />
              )}
            </View>
            {switchData.isError && <ThemedText themeColor="negative">{switchData.error.message}</ThemedText>}
          </>
        )}
      </Card>
    );
  }

  return (
    <Card title="Bank connections" subtitle={view.plaid.env === 'production' ? 'Through Plaid' : `Through Plaid (${view.plaid.env})`}>
      {fixed ? (
        <FromEnvNote />
      ) : (
        <>
          <PlaidFields value={form} onChange={setForm} saved={view.plaid} advanced={advanced} />
          <SaveRow
            dirty={dirty}
            onSave={(save) =>
              save.mutate({ plaid: form }, { onSuccess: () => setSaved((s) => ({ ...form, sandboxSecret: s.sandboxSecret, productionSecret: s.productionSecret })) })
            }
            left={
              <>
                <Button
                  label={advanced ? 'Hide developer options' : 'Developer options'}
                  variant="secondary"
                  size="small"
                  onPress={() => setAdvanced(!advanced)}
                />
                <Button label="Show demo data" variant="secondary" size="small" loading={switchData.isPending} onPress={() => switchData.mutate({ demo: true })} />
              </>
            }
          />
          {switchData.isError && <ThemedText themeColor="negative">{switchData.error.message}</ThemedText>}
        </>
      )}
    </Card>
  );
}

function AICard({ view, fixed }: { view: SettingsView; fixed: boolean }) {
  const initial: AIForm = {
    anthropicApiKey: '',
    openrouterApiKey: '',
    openrouterModels: modelsText(view.ai.openrouterModels),
    ollamaUrl: view.ai.ollamaUrl,
    ollamaModels: view.ai.ollamaModels,
  };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [remove, setRemove] = useState({ anthropic: false, openrouter: false });
  const dirty = remove.anthropic || remove.openrouter || JSON.stringify(form) !== JSON.stringify(saved);
  /** Shown under a saved key while its field is empty: drop it on save, or change your mind. */
  const removeButton = (which: 'anthropic' | 'openrouter', name: string, savedKey: string, typed: string) =>
    !!savedKey &&
    !typed && (
      <View style={formStyles.buttons}>
        <Button
          label={remove[which] ? `Keep the saved ${name} key` : `Remove the saved ${name} key`}
          variant={remove[which] ? 'secondary' : 'danger'}
          size="small"
          onPress={() => setRemove({ ...remove, [which]: !remove[which] })}
        />
      </View>
    );
  return (
    <Card title="AI">
      {fixed ? (
        <FromEnvNote />
      ) : (
        <>
          <AIFields
            value={form}
            onChange={setForm}
            savedKey={remove.anthropic ? '' : view.ai.anthropicApiKey}
            savedOpenRouterKey={remove.openrouter ? '' : view.ai.openrouterApiKey}
            afterAnthropic={removeButton('anthropic', 'Anthropic', view.ai.anthropicApiKey, form.anthropicApiKey)}
            afterOpenRouter={removeButton('openrouter', 'OpenRouter', view.ai.openrouterApiKey, form.openrouterApiKey)}
          />
          <SaveRow
            dirty={dirty}
            onSave={(save) =>
              save.mutate(
                { ai: aiSettings(form, remove) },
                {
                  onSuccess: () => {
                    setSaved(form);
                    setRemove({ anthropic: false, openrouter: false });
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

function PassphraseCard({ view, fixed }: { view: SettingsView; fixed: boolean }) {
  const { login, isDesktopWindow } = useAuth();
  // On the desktop app the switch is "a passphrase for browsers and phones"; its own window never needs one.
  const on = view.desktop ? view.passphraseSet : view.passphrase;
  const [want, setWant] = useState(on);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const turningOff = on && !want;
  // The desktop window can change or remove it without the old one (e.g. when it's forgotten).
  const needsCurrent = on && view.passphraseSet && !isDesktopWindow;
  const nextValid = next.length >= 8 && next === confirm;
  // Changing or turning it off takes the current one; turning it on only a new one.
  const dirty = turningOff ? !needsCurrent || !!current : want && nextValid && (!needsCurrent || !!current);
  const subtitle = fixed
    ? undefined
    : view.desktop
      ? turningOff
        ? needsCurrent
          ? 'Enter your current passphrase to remove it.'
          : 'Removing it leaves only Meld’s own window able to open Meld.'
        : on
          ? 'Browsers and your phone ask for it. Meld’s own window never does.'
          : want
            ? 'Choose one to open Meld in a browser or on your phone.'
            : view.passphrase
              ? 'Not set: only Meld’s own window can open Meld. Set one to use it in a browser or on your phone.'
              : 'Off: anyone who can reach Meld can open it.'
      : turningOff
        ? 'Enter your current passphrase to turn it off.'
        : on
          ? 'Meld asks for it to unlock.'
          : want
            ? 'Choose one to turn it on.'
            : 'Off: Meld opens without one.';
  return (
    <Card
      title={view.desktop ? 'Passphrase for browsers and phones' : 'Passphrase'}
      subtitle={subtitle}
      action={fixed ? undefined : <Switch value={want} onValueChange={setWant} accessibilityLabel="Require a passphrase" />}>
      {fixed ? (
        <FromEnvNote />
      ) : (
        <>
          {needsCurrent && (
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
          {turningOff && !view.desktop && <NoPassphraseNote />}
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
  wrap: { flexWrap: 'wrap' },
  version: { opacity: 0.75 },
});
