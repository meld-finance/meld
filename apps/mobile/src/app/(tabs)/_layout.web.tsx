import { router } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { ChatPanel } from '@/components/chat/chat-panel';
import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { ChatPanelProvider, useChatPanel } from '@/lib/chat-panel';
import { useAlerts, useProfile } from '@/lib/queries';
import { useThemePref, type ThemePref } from '@/lib/theme-pref';

/** Below this window width the sidebar collapses to an icon rail. */
const COMPACT_BELOW = 1000;
/** Below this window width (phones) the nav moves to a bottom tab bar, leaving the page the full width. */
const PHONE_BELOW = 640;

// Web: a left sidebar instead of a bottom tab bar. Keep the order in step with _layout.tsx.
export default function TabLayout() {
  return (
    <ChatPanelProvider>
      <TabNavigator />
    </ChatPanelProvider>
  );
}

type NavLayout = 'wide' | 'compact' | 'phone';

function TabNavigator() {
  const width = useWindowDimensions().width;
  const layout: NavLayout = width < PHONE_BELOW ? 'phone' : width < COMPACT_BELOW ? 'compact' : 'wide';
  const phone = layout === 'phone';
  const panel = useChatPanel();
  // Hidden rather than unmounted, so the page keeps its scroll and state under an expanded chat.
  const pageHidden = !!panel?.isOpen && panel.expanded;
  // TabTriggers must be the nav's direct children so Tabs can discover them.
  const items = [
    <TabTrigger key="index" name="index" href="/" asChild>
      <NavItem icon="home" layout={layout}>
        Home
      </NavItem>
    </TabTrigger>,
    <TabTrigger key="ask" name="ask" href="/ask" asChild>
      <NavItem icon="sparkles" layout={layout}>
        Ask Meld
      </NavItem>
    </TabTrigger>,
    <TabTrigger key="accounts" name="accounts" href="/accounts" asChild>
      <NavItem icon="wallet" layout={layout}>
        Accounts
      </NavItem>
    </TabTrigger>,
    <TabTrigger key="spending" name="spending" href="/spending" asChild>
      <NavItem icon="barChart" layout={layout}>
        Spending
      </NavItem>
    </TabTrigger>,
    <TabTrigger key="plan" name="plan" href="/plan" asChild>
      <NavItem icon="flag" layout={layout}>
        Plan
      </NavItem>
    </TabTrigger>,
  ];
  return (
    <Tabs style={[styles.root, phone && styles.rootPhone]}>
      {!phone && (
        <TabList asChild>
          <Sidebar compact={layout === 'compact'}>{items}</Sidebar>
        </TabList>
      )}
      <View style={styles.content}>
        <ThemedView style={[styles.main, pageHidden && styles.hidden]}>
          <TopBar phone={phone} />
          <TabSlot style={styles.main} />
        </ThemedView>
        <ChatPanel />
      </View>
      {phone && (
        <TabList asChild>
          <BottomBar>{items}</BottomBar>
        </TabList>
      )}
    </Tabs>
  );
}

function BottomBar({ children, style: _style, ...props }: TabListProps) {
  const theme = useTheme();
  return (
    <View {...props} style={[styles.bottomBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {children}
    </View>
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
      <View style={[styles.footer, compact && styles.footerCompact]}>
        {!compact && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.tagline}>
            All your money.{'\n'}All your goals. One place.
          </ThemedText>
        )}
        <ThemeToggle compact={compact} />
      </View>
    </View>
  );
}

const THEME_OPTIONS: { value: ThemePref; icon: IconName; label: string }[] = [
  { value: 'system', icon: 'monitor', label: 'Match system' },
  { value: 'light', icon: 'sun', label: 'Light' },
  { value: 'dark', icon: 'moon', label: 'Dark' },
];

/** Light, dark, or the device's scheme. Compact, one button steps through them. */
function ThemeToggle({ compact }: { compact: boolean }) {
  const theme = useTheme();
  const [pref, setPref] = useThemePref();
  if (compact) {
    const i = THEME_OPTIONS.findIndex((o) => o.value === pref);
    const current = THEME_OPTIONS[i]!;
    const next = THEME_OPTIONS[(i + 1) % THEME_OPTIONS.length]!;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Theme: ${current.label}. Switch to ${next.label}`}
        onPress={() => setPref(next.value)}
        style={({ hovered, pressed }) => [
          styles.themeOption,
          hovered && { backgroundColor: theme.backgroundSelected },
          pressed && styles.pressed,
        ]}>
        <Icon name={current.icon} size={18} themeColor="textSecondary" />
      </Pressable>
    );
  }
  return (
    <View accessibilityRole="radiogroup" style={[styles.themeToggle, { borderColor: theme.border }]}>
      {THEME_OPTIONS.map((o) => {
        const selected = o.value === pref;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected }}
            onPress={() => setPref(o.value)}
            style={({ hovered, pressed }) => [
              styles.themeOption,
              styles.themeOptionWide,
              selected ? { backgroundColor: theme.backgroundSelected } : hovered && { backgroundColor: theme.background },
              pressed && styles.pressed,
            ]}>
            <Icon name={o.icon} size={16} themeColor={selected ? 'tint' : 'textSecondary'} />
          </Pressable>
        );
      })}
    </View>
  );
}

type NavItemProps = Omit<TabTriggerSlotProps, 'children'> & { icon: IconName; layout: NavLayout; children: string };

// `ref` is dropped: the slot's ref type doesn't match Pressable's, and nav items don't need one.
function NavItem({ icon, layout, children, isFocused, ref: _ref, ...props }: NavItemProps) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const compact = layout === 'compact';
  if (layout === 'phone') {
    return (
      <Pressable {...props} accessibilityLabel={children} style={({ pressed }) => [styles.tabItem, pressed && styles.pressed]}>
        <Icon name={icon} size={22} themeColor={isFocused ? 'tint' : 'textSecondary'} />
        <ThemedText
          numberOfLines={1}
          themeColor={isFocused ? 'text' : 'textSecondary'}
          style={[styles.tabLabel, isFocused && styles.navTextActive]}>
          {children}
        </ThemedText>
      </Pressable>
    );
  }
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

function TopBar({ phone }: { phone: boolean }) {
  const theme = useTheme();
  const accent = useAccents().blue;
  const panel = useChatPanel();
  const { logout } = useAuth();
  const profile = useProfile();
  const unread = useAlerts().data?.unread ?? 0;
  const [open, setOpen] = useState(false);
  const name = profile.data?.displayName?.trim();
  const firstName = name?.split(/\s+/)[0];
  const initials = name
    ?.split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

  return (
    <View style={[styles.topBar, phone && styles.topBarPhone]}>
      {phone && (
        <View style={styles.topBrand}>
          <Logo />
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ask Meld about this page"
        onPress={() => (panel?.isOpen ? panel.close() : panel?.openHome())}
        style={({ hovered, pressed }) => [
          styles.askButton,
          { borderColor: hovered ? accent.fg : theme.border, backgroundColor: theme.backgroundElement },
          pressed && styles.pressed,
        ]}>
        <Icon name="sparkles" size={18} color={accent.fg} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={unread ? `Alerts, ${unread} unread` : 'Alerts'}
        onPress={() => router.push('/alerts')}
        style={({ hovered, pressed }) => [
          styles.askButton,
          { borderColor: hovered ? theme.tint : theme.border, backgroundColor: theme.backgroundElement },
          pressed && styles.pressed,
        ]}>
        <Icon name="bell" size={18} themeColor={unread ? 'text' : 'textSecondary'} />
        {unread > 0 && (
          <View style={[styles.unread, { backgroundColor: theme.negative, borderColor: theme.background }]}>
            <ThemedText style={styles.unreadText}>{unread > 9 ? '9+' : unread}</ThemedText>
          </View>
        )}
      </Pressable>
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
        {!phone && <ThemedText type="small">{firstName ?? 'Account'}</ThemedText>}
        <Icon name="chevronDown" size={16} themeColor="textSecondary" />
      </Pressable>
      {open && (
        <>
          {/* Click-away layer behind the menu. */}
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close menu" />
          <ThemedView type="backgroundElement" style={[styles.menu, phone && styles.menuPhone, { borderColor: theme.border }]}>
            <MenuItem
              icon="user"
              onPress={() => {
                setOpen(false);
                router.push({ pathname: '/plan', params: { tab: 'profile' } });
              }}>
              Profile
            </MenuItem>
            {/* Phones have no sidebar, so the theme toggle lives here. */}
            {phone && (
              <View style={styles.menuTheme}>
                <ThemeToggle compact={false} />
              </View>
            )}
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
  rootPhone: { flexDirection: 'column' },
  content: { flex: 1, flexDirection: 'row' },
  main: { flex: 1 },
  bottomBar: { flexDirection: 'row', borderTopWidth: 1, paddingVertical: Spacing.one },
  tabItem: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: Spacing.one, minWidth: 0 },
  tabLabel: { fontSize: 11, lineHeight: 14 },
  hidden: { display: 'none' },
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
  footer: { marginTop: 'auto', gap: Spacing.three },
  footerCompact: { alignItems: 'center' },
  tagline: { paddingHorizontal: Spacing.two },
  themeToggle: { flexDirection: 'row', borderWidth: 1, borderRadius: Spacing.five, padding: Spacing.half, gap: Spacing.half },
  themeOption: { padding: Spacing.two, borderRadius: Spacing.five, alignItems: 'center' },
  themeOptionWide: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    zIndex: 10,
  },
  topBarPhone: { paddingHorizontal: Spacing.three },
  topBrand: { marginRight: 'auto' },
  askButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unread: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { color: '#ffffff', fontSize: 10, lineHeight: 12, fontWeight: 700 },
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
  menuPhone: { right: Spacing.three },
  menuTheme: { padding: Spacing.one },
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
