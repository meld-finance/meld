import { router } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useProfile } from '@/lib/queries';

/** Below this window width the sidebar collapses to an icon rail. */
const COMPACT_BELOW = 1000;

// Web: a left sidebar instead of a bottom tab bar. Keep the order in step with _layout.tsx.
export default function TabLayout() {
  const compact = useWindowDimensions().width < COMPACT_BELOW;
  return (
    <Tabs style={styles.root}>
      {/* TabTriggers must be the sidebar's direct children so Tabs can discover them. */}
      <TabList asChild>
        <Sidebar compact={compact}>
          <TabTrigger name="index" href="/" asChild>
            <NavItem icon="home" compact={compact}>
              Home
            </NavItem>
          </TabTrigger>
          <TabTrigger name="ask" href="/ask" asChild>
            <NavItem icon="sparkles" compact={compact}>
              Ask Meld
            </NavItem>
          </TabTrigger>
          <TabTrigger name="accounts" href="/accounts" asChild>
            <NavItem icon="wallet" compact={compact}>
              Accounts
            </NavItem>
          </TabTrigger>
          <TabTrigger name="spending" href="/spending" asChild>
            <NavItem icon="barChart" compact={compact}>
              Spending
            </NavItem>
          </TabTrigger>
          <TabTrigger name="plan" href="/plan" asChild>
            <NavItem icon="flag" compact={compact}>
              Plan
            </NavItem>
          </TabTrigger>
        </Sidebar>
      </TabList>
      <ThemedView style={styles.main}>
        <TopBar />
        <TabSlot style={styles.main} />
      </ThemedView>
    </Tabs>
  );
}

function Sidebar({ compact, children, style: _style, ...props }: TabListProps & { compact: boolean }) {
  const theme = useTheme();
  return (
    <View
      {...props}
      style={[styles.sidebar, compact && styles.sidebarCompact, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={[styles.brand, compact && styles.brandCompact]}>
        <Logo />
        {!compact && <ThemedText style={styles.brandText}>meld</ThemedText>}
      </View>
      <View style={styles.nav}>{children}</View>
      {!compact && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.tagline}>
          All your money.{'\n'}All your goals. One place.
        </ThemedText>
      )}
    </View>
  );
}

type NavItemProps = Omit<TabTriggerSlotProps, 'children'> & { icon: IconName; compact: boolean; children: string };

// `ref` is dropped: the slot's ref type doesn't match Pressable's, and nav items don't need one.
function NavItem({ icon, compact, children, isFocused, ref: _ref, ...props }: NavItemProps) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      {...props}
      accessibilityLabel={children}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.navItem,
        compact && styles.navItemCompact,
        (isFocused || hovered) && { backgroundColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      <Icon name={icon} size={20} themeColor={isFocused ? 'tint' : 'text'} />
      {!compact && (
        <ThemedText themeColor={isFocused ? 'text' : 'textSecondary'} style={isFocused && styles.navTextActive}>
          {children}
        </ThemedText>
      )}
    </Pressable>
  );
}

function TopBar() {
  const theme = useTheme();
  const { logout } = useAuth();
  const profile = useProfile();
  const [open, setOpen] = useState(false);
  const name = profile.data?.displayName?.trim();
  const firstName = name?.split(/\s+/)[0];
  const initials = name
    ?.split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

  return (
    <View style={styles.topBar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account menu"
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.userButton, pressed && styles.pressed]}>
        <View style={[styles.avatar, { backgroundColor: theme.text }]}>
          {initials ? (
            <ThemedText type="smallBold" style={{ color: theme.backgroundElement }}>
              {initials}
            </ThemedText>
          ) : (
            <Icon name="user" size={16} color={theme.backgroundElement} />
          )}
        </View>
        <ThemedText type="small">{firstName ?? 'Account'}</ThemedText>
        <Icon name="chevronDown" size={16} themeColor="textSecondary" />
      </Pressable>
      {open && (
        <>
          {/* Click-away layer behind the menu. */}
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close menu" />
          <ThemedView type="backgroundElement" style={[styles.menu, { borderColor: theme.border }]}>
            <MenuItem
              icon="user"
              onPress={() => {
                setOpen(false);
                router.push({ pathname: '/plan', params: { tab: 'profile' } });
              }}>
              Profile
            </MenuItem>
            <MenuItem icon="lock" onPress={logout}>
              Lock
            </MenuItem>
          </ThemedView>
        </>
      )}
    </View>
  );
}

function MenuItem({ icon, onPress, children }: { icon: IconName; onPress: () => void; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.menuItem,
        hovered && { backgroundColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      <Icon name={icon} size={16} themeColor="textSecondary" />
      <ThemedText type="small">{children}</ThemedText>
    </Pressable>
  );
}

/** Two overlapping peaks: blue and green. */
function Logo() {
  return (
    <Svg width={30} height={20} viewBox="0 0 30 20">
      <Path d="M1 18 9 4l8 14H1Z" fill="#2E9E6B" />
      <Path d="M11 18 19.5 3 28 18H11Z" fill="#2563EB" opacity={0.92} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  main: { flex: 1 },
  sidebar: {
    width: 248,
    borderRightWidth: 1,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    gap: Spacing.one,
  },
  sidebarCompact: { width: 72, paddingHorizontal: Spacing.two, alignItems: 'center' },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    marginBottom: Spacing.four,
  },
  brandCompact: { paddingHorizontal: 0 },
  brandText: { fontSize: 26, lineHeight: 32, fontWeight: 700, letterSpacing: -0.5 },
  nav: { gap: Spacing.one },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two + Spacing.one,
  },
  navItemCompact: { paddingHorizontal: Spacing.three, gap: 0 },
  navTextActive: { fontWeight: 600 },
  tagline: { marginTop: 'auto', paddingHorizontal: Spacing.two },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    zIndex: 10,
  },
  userButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.one },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  backdrop: { position: 'absolute', top: -1000, right: -1000, bottom: -10000, left: -10000 },
  menu: {
    position: 'absolute',
    top: Spacing.three + 44,
    right: Spacing.four,
    minWidth: 180,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.one,
    shadowColor: '#0F1B3D',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  pressed: { opacity: 0.7 },
});
