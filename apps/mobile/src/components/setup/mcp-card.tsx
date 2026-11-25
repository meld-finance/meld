import type { McpStatus } from '@meld/shared';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { formStyles } from '@/components/form-fields';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { API_URL } from '@/lib/config';
import { useMcpStatus, useRevokeMcpToken, useRotateMcpToken, useUpdateMcpConfig } from '@/lib/setup';

type ClientTab = 'claude' | 'json' | 'stdio';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const isWeb = Platform.OS === 'web';

function resolveEndpointUrl(status: McpStatus): string {
  if (isWeb && typeof window !== 'undefined' && API_URL === '/api' && LOOPBACK_HOSTS.has(window.location.hostname)) {
    return `${window.location.origin}${status.endpointPath}`;
  }
  if (API_URL.startsWith('http://') || API_URL.startsWith('https://')) {
    return `${API_URL.replace(/\/$/, '')}${status.endpointPath}`;
  }
  return `http://127.0.0.1:${status.port}${status.endpointPath}`;
}

function buildSnippet(tab: ClientTab, url: string, token: string): string {
  switch (tab) {
    case 'claude':
      return `claude mcp add --transport http meld ${url} --header "Authorization: Bearer ${token}"`;
    case 'json':
      return JSON.stringify(
        {
          mcpServers: {
            meld: {
              url,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        },
        null,
        2,
      );
    case 'stdio':
      return JSON.stringify(
        {
          mcpServers: {
            meld: {
              command: 'node',
              args: ['/path/to/meld/scripts/meld-mcp.mjs'],
              env: {
                MELD_URL: url,
                MELD_MCP_TOKEN: token,
              },
            },
          },
        },
        null,
        2,
      );
  }
}

function CopyButton({
  text,
  label = 'Copy',
  variant = 'secondary',
}: {
  text: string;
  label?: string;
  variant?: 'primary' | 'secondary';
}) {
  const [copied, setCopied] = useState(false);
  if (!isWeb || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return null;
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    });
  };
  return <Button label={copied ? 'Copied' : label} variant={variant} size="small" onPress={copy} />;
}

/**
 * Settings → External agents (MCP): opt-in, localhost-only, read-only MCP server
 * for tools like Claude Code, Cursor, Codex, and Claude Desktop.
 */
export function McpCard() {
  const theme = useTheme();
  const status = useMcpStatus();
  const update = useUpdateMcpConfig();
  const rotate = useRotateMcpToken();
  const revoke = useRevokeMcpToken();
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [tab, setTab] = useState<ClientTab>('claude');

  const data = status.data;
  const busy = update.isPending || rotate.isPending || revoke.isPending;
  const error = update.error ?? rotate.error ?? revoke.error;

  const toggle = (enabled: boolean) => {
    update.mutate(
      { enabled },
      {
        onSuccess: (res) => {
          if (res.token) setFreshToken(res.token);
          if (!enabled) setFreshToken(null);
        },
      },
    );
  };

  const url = data ? resolveEndpointUrl(data) : '';
  const displayToken = freshToken ?? '<YOUR_MELD_MCP_TOKEN>';
  const snippet = data ? buildSnippet(tab, url, displayToken) : '';

  return (
    <Card
      title="External agents (MCP)"
      subtitle="Let external AI tools like Claude Code, Cursor or Codex read your Meld data locally."
      action={
        data && !data.fromEnv ? (
          <Switch value={data.enabled} disabled={busy} onValueChange={toggle} accessibilityLabel="Enable MCP server" />
        ) : undefined
      }>
      {!data ? (
        <ThemedText type="small" themeColor={status.isError ? 'negative' : 'textSecondary'}>
          {status.isError ? `Couldn’t load MCP settings: ${status.error.message}` : 'Checking MCP status…'}
        </ThemedText>
      ) : (
        <>
          {data.fromEnv && (
            <ThemedText type="small" themeColor="textSecondary">
              Controlled by <ThemedText type="code">MCP_ENABLED</ThemedText> and <ThemedText type="code">MCP_TOKEN</ThemedText> in{' '}
              <ThemedText type="code">.env</ThemedText>. Edit it and restart Meld to change.
            </ThemedText>
          )}

          {!data.enabled ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Off by default. Turning it on exposes Meld’s read-only tools and data conventions over Streamable HTTP on localhost, protected by a dedicated bearer token.
              </ThemedText>
              {!data.fromEnv && (
                <View style={formStyles.buttons}>
                  <Button label="Turn on MCP server" loading={busy} onPress={() => toggle(true)} />
                </View>
              )}
            </>
          ) : (
            <>
              <View style={styles.fieldGroup}>
                <ThemedText type="small" themeColor="textSecondary">
                  Endpoint
                </ThemedText>
                <ThemedView type="background" style={[styles.codeRow, { borderColor: theme.border }]}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.codeFlex}>
                    <ThemedText type="code" selectable>
                      {url}
                    </ThemedText>
                  </ScrollView>
                  <CopyButton text={url} />
                </ThemedView>
              </View>

              {freshToken ? (
                <ThemedView type="backgroundSelected" style={[styles.tokenNotice, { borderColor: theme.border }]}>
                  <View style={styles.tokenHeader}>
                    <ThemedText type="smallBold">New MCP token</ThemedText>
                    <CopyButton text={freshToken} label="Copy token" variant="primary" />
                  </View>
                  <ThemedText type="code" selectable style={styles.codeWrap}>
                    {freshToken}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Shown once—copy it now. Meld only stores a cryptographic hash.
                  </ThemedText>
                </ThemedView>
              ) : (
                <View style={styles.fieldGroup}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Bearer token
                  </ThemedText>
                  <ThemedView type="background" style={[styles.codeRow, { borderColor: theme.border }]}>
                    <ThemedText type="code" selectable style={styles.codeFlex}>
                      {data.tokenMask ?? 'Not set (MCP_TOKEN is empty)'}
                    </ThemedText>
                  </ThemedView>
                </View>
              )}

              {!data.fromEnv && (
                <View style={styles.actions}>
                  <Button
                    label="Rotate token"
                    variant="secondary"
                    size="small"
                    disabled={busy}
                    loading={rotate.isPending}
                    onPress={() => rotate.mutate(undefined, { onSuccess: (res) => setFreshToken(res.token) })}
                  />
                  <Button
                    label="Revoke & turn off"
                    variant="danger"
                    size="small"
                    disabled={busy}
                    loading={revoke.isPending}
                    onPress={() => revoke.mutate(undefined, { onSuccess: () => setFreshToken(null) })}
                  />
                </View>
              )}

              <View style={[styles.section, { borderTopColor: theme.border }]}>
                <ThemedText type="smallBold">Client setup</ThemedText>
                <View style={formStyles.chips}>
                  <Chip label="Claude Code" selected={tab === 'claude'} onPress={() => setTab('claude')} />
                  <Chip label="Cursor / HTTP JSON" selected={tab === 'json'} onPress={() => setTab('json')} />
                  <Chip label="Stdio bridge" selected={tab === 'stdio'} onPress={() => setTab('stdio')} />
                </View>
                <ThemedView type="background" style={[styles.snippetBox, { borderColor: theme.border }]}>
                  <ThemedText type="code" selectable style={styles.snippetText}>
                    {snippet}
                  </ThemedText>
                </ThemedView>
                <View style={styles.snippetFooter}>
                  <CopyButton text={snippet} label="Copy config" />
                  {!freshToken && (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                      Replace <ThemedText type="code">{'<YOUR_MELD_MCP_TOKEN>'}</ThemedText> with your saved token (or rotate to get a new one).
                    </ThemedText>
                  )}
                </View>
              </View>

              <ThemedText type="small" themeColor="textSecondary">
                Read-only and {data.allowRemote ? 'token-protected (remote access allowed)' : 'localhost-only'}. Account and policy numbers are masked and estate contact details are omitted. Synced bank descriptions come from outside institutions, so be cautious connecting agents that also have shell or web tools.
              </ThemedText>
            </>
          )}

          {error && (
            <ThemedText type="small" themeColor="negative">
              {error.message}
            </ThemedText>
          )}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  fieldGroup: { gap: Spacing.one },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
  codeFlex: { flex: 1, minWidth: 0 },
  codeWrap: { flexShrink: 1, ...(isWeb ? ({ overflowWrap: 'anywhere' } as object) : {}) },
  tokenNotice: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.two, borderWidth: 1 },
  tokenHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  section: { gap: Spacing.two, paddingTop: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
  snippetBox: { padding: Spacing.three, borderRadius: Spacing.two, borderWidth: 1 },
  snippetText: {
    lineHeight: 18,
    flexShrink: 1,
    ...(isWeb ? ({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as object) : {}),
  },
  snippetFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  hint: { flex: 1, minWidth: 200 },
});
