// React Native's Alert is a no-op on web, so use the browser dialog.
export async function confirm(title: string, message: string, _confirmLabel?: string): Promise<boolean> {
  return window.confirm(`${title}\n\n${message}`);
}
