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
const QR_SIZE = 168;

function Link({ url, children }: { url: string; children: string }) {
  return (
    <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(url)}>
      {children}
    </ThemedText>
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
            <Link url={INSTALL_URL}>Install Tailscale</Link> on this Mac and on your phone, and sign in to both with the same
            account. It’s free for personal use.
          </ThemedText>
          <View style={formStyles.buttons}>{recheck}</View>
        </>
      ) : data?.state === 'not-running' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Tailscale is installed but not connected. Open it and sign in, then check again.
          </ThemedText>
          <View style={formStyles.buttons}>{recheck}</View>
        </>
      ) : data?.state === 'no-https' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Your tailnet needs HTTPS certificates turned on (one switch in the Tailscale admin console:{' '}
            <Link url={HTTPS_URL}>how</Link>), so your phone gets a secure address.
          </ThemedText>
          <View style={formStyles.buttons}>{recheck}</View>
        </>
      ) : data?.state === 'off' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Your devices on Tailscale will reach Meld at a private https address while this Mac is awake and Meld is open
            (closing the window keeps it running in the menu bar).{' '}
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
                On your phone, open Tailscale, then scan this code with the camera or go to
              </ThemedText>
              <ThemedText type="smallBold" selectable>
                {data.url}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Add it to your home screen to open Meld like an app.
              </ThemedText>
            </View>
          </View>
          <View style={formStyles.buttons}>
            <Button label="Turn off" variant="secondary" size="small" loading={set.isPending} onPress={() => set.mutate(false)} />
          </View>
        </>
      ) : null}
      {set.isError && <ThemedText themeColor="negative">{set.error.message}</ThemedText>}
    </Card>
  );
}

const styles = StyleSheet.create({
  on: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four, alignItems: 'center' },
  qr: { padding: Spacing.three, borderRadius: Spacing.three, borderWidth: 1 },
  onText: { flex: 1, minWidth: 200, gap: Spacing.two },
});
