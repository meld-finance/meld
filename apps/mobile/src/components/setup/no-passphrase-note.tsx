import { ThemedText } from '@/components/themed-text';

/** What turning the passphrase off means, shown wherever it can be turned off. */
export function NoPassphraseNote() {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      Meld will open straight in, with no lock. Anyone who can reach it (anyone using this computer, or your devices on
      Tailscale if phone access is on) can see all your accounts.
    </ThemedText>
  );
}
