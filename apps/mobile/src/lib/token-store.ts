import * as SecureStore from 'expo-secure-store';

// Native: session token lives in the iOS Keychain / Android Keystore.
const KEY = 'meld.session';

export const tokenStore = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (token: string) => SecureStore.setItemAsync(KEY, token),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
