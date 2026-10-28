import { NativeTabs } from 'expo-router/native-tabs';

import { useTheme } from '@/hooks/use-theme';

// Same order as the web sidebar (_layout.web.tsx).
export default function TabLayout() {
  const theme = useTheme();
  return (
    <NativeTabs
      backgroundColor={theme.background}
      indicatorColor={theme.backgroundSelected}
      labelStyle={{ selected: { color: theme.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="ask">
        <NativeTabs.Trigger.Label>Ask Meld</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="accounts">
        <NativeTabs.Trigger.Label>Accounts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="building.columns" md="account_balance" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="cashflow">
        <NativeTabs.Trigger.Label>Cash Flow</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.bar" md="bar_chart" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="transactions">
        <NativeTabs.Trigger.Label>Transactions</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet.rectangle" md="receipt_long" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="budget">
        <NativeTabs.Trigger.Label>Budgets</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.pie" md="pie_chart" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="investments">
        <NativeTabs.Trigger.Label>Investments</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.line.uptrend.xyaxis" md="trending_up" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="plan">
        <NativeTabs.Trigger.Label>Plan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'flag', selected: 'flag.fill' }} md="flag" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
