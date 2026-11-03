import { apiBlob } from './api';

/** Builds the family packet on the server and downloads it. Returns whether a file was saved. */
export async function exportPacket(password: string | null) {
  const blob = await apiBlob('/estate/packet', { method: 'POST', body: JSON.stringify({ password }) });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `family-packet-${new Date().toLocaleDateString('en-CA')}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
