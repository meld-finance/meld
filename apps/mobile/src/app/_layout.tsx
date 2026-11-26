import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { TourPanel } from '@/components/tour/tour-panel';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useSetupStatus } from '@/lib/setup';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootNavigator() {
  const { ready: authReady, isLoggedIn } = useAuth();
  const setup = useSetupStatus();
  // If the status can't be read (an older API), assume setup is done and show the lock screen.
  const configured = setup.data?.configured ?? true;
  const ready = authReady && !setup.isPending;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!configured}>
          <Stack.Screen name="setup" />
        </Stack.Protected>
        <Stack.Protected guard={configured && isLoggedIn} redirectTo={configured ? '/login' : '/setup'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="account/[id]" />
          <Stack.Screen name="equity/[id]" />
          <Stack.Screen name="insurance/[id]" />
          <Stack.Screen name="estate/account/[id]" />
          <Stack.Screen name="estate/asset/[id]" />
          <Stack.Screen name="estate/document/[id]" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="category/[category]" />
          <Stack.Screen name="rules" />
          <Stack.Screen name="alerts" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="releases" />
          <Stack.Screen name="connect" />
        </Stack.Protected>
        <Stack.Protected guard={configured && !isLoggedIn} redirectTo={configured ? '/' : '/setup'}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
      {configured && isLoggedIn && <TourPanel />}
    </>
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
