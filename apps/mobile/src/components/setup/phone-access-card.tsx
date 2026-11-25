import { Linking, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { formStyles } from '@/components/form-fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePhoneAccess, useSetPhoneAccess, useSetupStatus } from '@/lib/setup';

const INSTALL_URL = 'https://tailscale.com/download';
const HTTPS_URL = 'https://tailscale.com/kb/1153/enabling-https';
const PHONE_DOCS_URL = 'https://meld-finance.github.io/meld/docs/phone-access/';
const QR_SIZE = 168;

function Link({ url, children }: { url: string; children: string }) {
  return (
    <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(url)}>
      {children}
    </ThemedText>
  );
}

function TailscaleChecklist() {
  return (
    <View style={styles.steps}>
      <ThemedText type="smallBold">How to set up Tailscale</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        1. <Link url={INSTALL_URL}>Install Tailscale</Link> on <ThemedText type="smallBold">both this computer and your phone</ThemedText>, and sign in to both with the same account (free for personal use).
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        2. Turn on <Link url={HTTPS_URL}>HTTPS certificates</Link> for your tailnet (one switch in the Tailscale admin console under DNS).
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        3. Turn on phone access below, open Tailscale on your phone, scan the QR code, and use Add to Home Screen so Meld opens like an app.{' '}
        <Link url={PHONE_DOCS_URL}>Step-by-step setup guide →</Link>
      </ThemedText>
    </View>
  );
}

/**
 * Desktop app: shares Meld with your other devices over Tailscale, a private network
 * only your devices are on. Nothing is opened to the internet.
 */
export function PhoneAccessCard() {
  const theme = useTheme();
  const phone = usePhoneAccess(true);
  const set = useSetPhoneAccess();
  const data = phone.data;
  const passphrase = useSetupStatus().data?.passphrase ?? true;

  const recheck = <Button label="Check again" variant="secondary" size="small" loading={phone.isFetching} onPress={() => void phone.refetch()} />;

  return (
    <Card title="Phone access" subtitle="Use Meld on your phone through Tailscale, a private network only your devices are on.">
      {phone.isPending ? (
        <ThemedText type="small" themeColor="textSecondary">
          Checking Tailscale…
        </ThemedText>
      ) : phone.isError ? (
        <ThemedText themeColor="negative">Couldn’t check Tailscale: {phone.error.message}</ThemedText>
      ) : data?.state === 'not-installed' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Tailscale isn’t installed on this computer yet. Set it up beforehand so your phone can reach Meld privately:
          </ThemedText>
          <TailscaleChecklist />
          <View style={formStyles.buttons}>{recheck}</View>
        </>
      ) : data?.state === 'not-running' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Tailscale is installed on this computer, but not connected yet. Open it and sign in, then check again.
          </ThemedText>
          <TailscaleChecklist />
          <View style={formStyles.buttons}>{recheck}</View>
        </>
      ) : data?.state === 'no-https' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Your tailnet needs HTTPS certificates turned on (one switch in the Tailscale admin console under DNS:{' '}
            <Link url={HTTPS_URL}>how to turn it on</Link>), so your phone gets a secure address.
          </ThemedText>
          <TailscaleChecklist />
          <View style={formStyles.buttons}>{recheck}</View>
        </>
      ) : data?.state === 'off' ? (
        <>
          <TailscaleChecklist />
          <ThemedText type="small" themeColor="textSecondary">
            Once turned on, your devices on Tailscale can reach Meld while this computer is awake and Meld is open
            (closing the window keeps it running in the menu bar/tray).{' '}
            {passphrase ? 'You’ll still need your passphrase.' : 'With no passphrase, anyone on your tailnet can open it.'}
          </ThemedText>
          <View style={formStyles.buttons}>
            <Button label="Turn on phone access" loading={set.isPending} onPress={() => set.mutate(true)} />
          </View>
        </>
      ) : data?.state === 'on' ? (
        <>
          <View style={styles.on}>
            <View style={[styles.qr, { backgroundColor: '#ffffff', borderColor: theme.border }]}>
              <QRCode value={data.url} size={QR_SIZE} />
            </View>
            <View style={styles.onText}>
              <ThemedText type="small" themeColor="textSecondary">
                Make sure Tailscale is installed and connected on your phone (signed in to the same account), then scan this code with your camera or go to
              </ThemedText>
              <ThemedText type="smallBold" selectable>
                {data.url}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Add it to your home screen to open Meld like an app.
              </ThemedText>
            </View>
          </View>
          <View style={styles.onActions}>
            <Button label="Turn off" variant="secondary" size="small" loading={set.isPending} onPress={() => set.mutate(false)} />
            <Link url={PHONE_DOCS_URL}>Setup & troubleshooting guide →</Link>
          </View>
        </>
      ) : null}
      {set.isError && <ThemedText themeColor="negative">{set.error.message}</ThemedText>}
    </Card>
  );
}

const styles = StyleSheet.create({
  steps: { gap: Spacing.one },
  on: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four, alignItems: 'center' },
  qr: { padding: Spacing.three, borderRadius: Spacing.three, borderWidth: 1 },
  onText: { flex: 1, minWidth: 200, gap: Spacing.two },
  onActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three },
});
