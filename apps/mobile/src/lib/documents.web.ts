import { apiBlob } from './api';

/** Documents need the bearer token, so fetch them and open a blob URL rather than linking directly. */
export async function openDocument(documentId: string, _filename: string) {
  // Open the tab synchronously (inside the click) so popup blockers allow it, then point it at the PDF.
  const tab = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await apiBlob(`/documents/${documentId}`));
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}
