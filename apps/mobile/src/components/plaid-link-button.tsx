import { Alert } from 'react-native';

import { Button } from '@/components/button';

export type PlaidLinkButtonProps = {
  /** Set to repair an existing connection (Plaid update mode). */
  itemId?: string;
  label?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'regular' | 'small';
  onLinked?: () => void;
  onError?: (message: string) => void;
};

// Native Plaid Link needs react-native-plaid-link-sdk and a development build;
// that lands with the mobile phase. Until then, linking happens on web.
export function PlaidLinkButton({ itemId, label, variant, size }: PlaidLinkButtonProps) {
  return (
    <Button
      label={label ?? (itemId ? 'Reconnect' : 'Link account')}
      variant={variant}
      size={size}
      onPress={() => Alert.alert('Use the web app', 'Linking accounts on mobile is coming soon. Use the web app for now.')}
    />
  );
}
