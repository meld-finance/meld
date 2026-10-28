import * as SecureStore from 'expo-secure-store';

// Native: small app preferences, kept alongside the session token.
export const prefs = {
  get: (key: string) => SecureStore.getItemAsync(`meld.${key}`).catch(() => null),
  set: (key: string, value: string) => SecureStore.setItemAsync(`meld.${key}`, value).catch(() => {}),
};
