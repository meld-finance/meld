import { TabList, TabSlot, TabTrigger, Tabs, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

// Web: a top navigation bar instead of a bottom tab bar.
export default function TabLayout() {
  return (
    <Tabs>
      <TabList asChild>
        <NavBar>
          <TabTrigger name="index" href="/" asChild>
            <TabButton>Home</TabButton>
          </TabTrigger>
          <TabTrigger name="accounts" href="/accounts" asChild>
            <TabButton>Accounts</TabButton>
          </TabTrigger>
          <TabTrigger name="transactions" href="/transactions" asChild>
            <TabButton>Transactions</TabButton>
          </TabTrigger>
        </NavBar>
      </TabList>
      <TabSlot style={{ flex: 1 }} />
    </Tabs>
  );
}

// `ref` is dropped: the slot's ref type doesn't match Pressable's, and tab buttons don't need one.
function TabButton({ children, isFocused, ref: _ref, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type={isFocused ? 'backgroundSelected' : 'backgroundElement'} style={styles.tabButton}>
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function NavBar(props: TabListProps) {
  const { logout } = useAuth();
  return (
    <View {...props} style={styles.container}>
      <ThemedView type="backgroundElement" style={styles.inner}>
        <ThemedText type="smallBold" style={styles.brand}>
          Meld
        </ThemedText>
        {props.children}
        <Pressable onPress={logout} style={styles.lock}>
          <ThemedText type="small" themeColor="textSecondary">
            Lock
          </ThemedText>
        </Pressable>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.three, alignItems: 'center' },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.five,
  },
  brand: { marginRight: 'auto' },
  tabButton: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: Spacing.three },
  lock: { marginLeft: Spacing.three },
  pressed: { opacity: 0.7 },
});
