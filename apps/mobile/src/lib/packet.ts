import { Alert } from 'react-native';

export async function exportPacket(_password: string | null) {
  // TODO(mobile phase): save to the cache directory and open the share sheet.
  Alert.alert('Not available yet', 'Open the web app to export the family packet.');
  return false;
}
