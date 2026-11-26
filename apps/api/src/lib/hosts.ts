import { isIP } from 'node:net';

/** The host name from a Host header (no port, lower case); null when there isn't one or it doesn't parse. */
export function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether Meld should answer a request addressed to `hostHeader`. A web page can point a name
 * it controls at 127.0.0.1 (DNS rebinding) and read the answers as its own, so only names an
 * outside site can't control are allowed: IP addresses, localhost, single-label names (Docker
 * services, MagicDNS short names), *.local (mDNS) and *.ts.net (Tailscale), plus `extra`.
 */
export function isAllowedHost(hostHeader: string | undefined, extra: readonly string[] = []): boolean {
  // Browsers always send Host; a request without one didn't come from a web page.
  if (hostHeader === undefined) return true;
  const host = hostnameOf(hostHeader);
  if (!host) return false;
  const bare = host.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(bare)) return true;
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  if (!bare.includes('.')) return true;
  if (bare.endsWith('.local') || bare.endsWith('.ts.net')) return true;
  return extra.some((h) => h.toLowerCase().replace(/\.$/, '') === bare);
}
