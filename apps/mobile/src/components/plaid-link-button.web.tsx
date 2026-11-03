import type { LinkTokenResponse } from '@meld/shared';
import { useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';

import { Button } from '@/components/button';
import { api } from '@/lib/api';
import { useExchangePublicToken, useSyncItem } from '@/lib/queries';

import type { PlaidLinkButtonProps } from './plaid-link-button';

/**
 * Opens Plaid Link. With `itemId`, runs Link in update mode to repair a
 * connection (no token exchange needed; the item keeps its access token).
 */
export function PlaidLinkButton({ itemId, consentAuth, label, variant, size, onLinked, onError }: PlaidLinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const exchange = useExchangePublicToken();
  const sync = useSyncItem();

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken) => {
      setLinkToken(null);
      try {
        if (itemId) await sync.mutateAsync(itemId);
        else if (publicToken) await exchange.mutateAsync(publicToken);
        else throw new Error('Plaid did not return a public token');
        onLinked?.();
      } catch (e) {
        onError?.(e instanceof Error ? e.message : 'Linking failed');
      }
    },
    onExit: (err) => {
      setLinkToken(null);
      if (err) onError?.(err.display_message || err.error_message);
    },
  });

  // Link can only open once the token is loaded into the SDK.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  async function start() {
    setFetching(true);
    try {
      const res = await api<LinkTokenResponse>('/plaid/link-token', {
        method: 'POST',
        body: JSON.stringify(itemId ? { itemId, ...(consentAuth && { consentAuth }) } : {}),
      });
      setLinkToken(res.linkToken);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Could not start Plaid Link');
    } finally {
      setFetching(false);
    }
  }

  return (
    <Button
      label={label ?? (itemId ? 'Reconnect' : 'Link account')}
      variant={variant}
      size={size}
      loading={fetching || exchange.isPending || (itemId ? sync.isPending : false)}
      onPress={start}
    />
  );
}
