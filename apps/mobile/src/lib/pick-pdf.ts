import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

export type PickedPdf = { form: FormData; name: string };

/** Lets the user choose a PDF and wraps it for upload as the `file` field. */
export async function pickPdf(): Promise<PickedPdf | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0]!;
  const form = new FormData();
  if (Platform.OS === 'web' && asset.file) {
    form.append('file', asset.file, asset.name);
  } else {
    // React Native's FormData accepts a { uri, name, type } descriptor for files.
    form.append('file', { uri: asset.uri, name: asset.name, type: 'application/pdf' } as unknown as Blob);
  }
  return { form, name: asset.name };
}
