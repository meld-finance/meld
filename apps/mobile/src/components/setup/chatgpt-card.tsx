import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Field, Input, formStyles } from '@/components/form-fields';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { prefs } from '@/lib/prefs';
import { useChatGPT, useChatGPTSignOut, useFinishChatGPTSignIn, useStartChatGPTSignIn } from '@/lib/setup';

const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';
const PLANS_URL = 'https://learn.chatgpt.com/docs/sign-in-with-chatgpt';
/** Remembers that the "using your ChatGPT plan" notice was seen, so it shows only after the first sign-in. */
const WELCOMED_KEY = 'chatgptWelcomed';

/** Ask Meld on the user's ChatGPT plan, instead of an API key. Takes effect without saving or restarting. */
export function ChatGPTSection() {
  const theme = useTheme();
  const status = useChatGPT();
  const start = useStartChatGPTSignIn();
  const finish = useFinishChatGPTSignIn();
  const signOut = useChatGPTSignOut();
  const [pasted, setPasted] = useState('');
  const [welcomed, setWelcomed] = useState(true);
  const s = status.data;

  useEffect(() => {
    if (s?.state === 'signed-in') void prefs.get(WELCOMED_KEY).then((v) => setWelcomed(!!v));
  }, [s?.state]);

  function signIn() {
    start.mutate(undefined, { onSuccess: ({ authorizeUrl }) => void Linking.openURL(authorizeUrl) });
  }

  const link = (label: string, url: string) => (
    <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(url)}>
      {label}
    </ThemedText>
  );
  const error = start.error ?? finish.error ?? signOut.error;

  return (
    <View style={[styles.section, { borderTopColor: theme.border }]}>
      <View style={styles.header}>
        <ThemedText type="cardTitle">ChatGPT plan</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {s?.state === 'signed-in' ? `Signed in${s.email ? ` as ${s.email}` : ''}` : 'Takes effect right away—no restart needed.'}
        </ThemedText>
      </View>
      {!s ? (
        <ThemedText type="small" themeColor={status.isError ? 'negative' : 'textSecondary'}>
          {status.isError ? `Couldn’t check ChatGPT: ${status.error.message}` : 'Checking…'}
        </ThemedText>
      ) : s.state === 'signed-in' ? (
        <>
          {!welcomed && (
            <ThemedView type="backgroundSelected" style={styles.notice}>
              <ThemedText type="cardTitle">You’re using your ChatGPT plan</ThemedText>
              <ThemedText type="small">
                Ask Meld can now answer with ChatGPT models, on your plan’s usage. You can set a limit for Meld or disconnect it
                any time in ChatGPT’s settings.
              </ThemedText>
              <View style={formStyles.buttons}>
                <Button
                  label="Got it"
                  size="small"
                  onPress={() => {
                    setWelcomed(true);
                    void prefs.set(WELCOMED_KEY, '1');
                  }}
                />
              </View>
            </ThemedView>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            Pick a ChatGPT model in Ask Meld’s model list. Questions, with the account data they need, are sent to OpenAI.{' '}
            {link('Manage usage', MANAGE_USAGE_URL)}
          </ThemedText>
          <View style={formStyles.buttons}>
            <Button label="Sign out" variant="secondary" size="small" loading={signOut.isPending} onPress={() => signOut.mutate()} />
          </View>
          {signOut.data?.revoked === false && (
            <ThemedText type="small" themeColor="textSecondary">
              Signed out here, but ChatGPT didn’t confirm it. You can also disconnect Meld in ChatGPT’s settings.
            </ThemedText>
          )}
        </>
      ) : s.state === 'pending' ? (
        <>
          <ThemedText type="small">
            Finish signing in on the ChatGPT page that opened. If it didn’t open, {link('open it here', s.authorizeUrl)}.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Signing in from another device, or Meld runs in Docker? After you sign in, the browser lands on a page that won’t
            load, at an address starting with <ThemedText type="code">http://127.0.0.1</ThemedText>. Copy that address and paste it
            here.
          </ThemedText>
          <Field label="Address after signing in">
            <Input value={pasted} onChangeText={setPasted} placeholder="http://127.0.0.1:1455/auth/callback?code=…" autoCapitalize="none" autoCorrect={false} />
          </Field>
          <View style={formStyles.buttons}>
            <Button
              label="Finish signing in"
              size="small"
              disabled={!pasted.trim()}
              loading={finish.isPending}
              onPress={() => finish.mutate(pasted, { onSuccess: () => setPasted('') })}
            />
            <Button label="Cancel" variant="secondary" size="small" onPress={() => signOut.mutate()} />
          </View>
        </>
      ) : (
        <>
          <ThemedText type="small">
            Sign in to use your ChatGPT Go, Plus, Pro or Business plan for Ask Meld, with no API key or extra cost. Free plans
            can’t share usage, and on Business an admin has to allow Meld first. {link('Which plans work', PLANS_URL)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Questions, with the account data they need, are sent to OpenAI. Reading policy PDFs and home and car value lookups
            still need an Anthropic or OpenRouter key.
          </ThemedText>
          {!!s.error && (
            <ThemedText type="small" themeColor="negative">
              {s.error}
            </ThemedText>
          )}
          <View style={formStyles.buttons}>
            <Button label="Continue with ChatGPT" loading={start.isPending} onPress={signIn} />
          </View>
        </>
      )}
      {error && (
        <ThemedText type="small" themeColor="negative">
          {error.message}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three, paddingTop: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
  header: { gap: Spacing.half },
  notice: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.two },
});
