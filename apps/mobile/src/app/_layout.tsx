import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/lib/auth';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootNavigator() {
  const { ready, isLoggedIn } = useAuth();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isLoggedIn} redirectTo="/login">
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="account/[id]" />
        <Stack.Screen name="insurance/[id]" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="category/[category]" />
        <Stack.Screen name="rules" />
      </Stack.Protected>
      <Stack.Protected guard={!isLoggedIn} redirectTo="/">
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Web: native controls and scrollbars follow the chosen scheme, not just the OS.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.colorScheme = colorScheme === 'dark' || colorScheme === 'light' ? colorScheme : 'light dark';
    }
  }, [colorScheme]);
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
