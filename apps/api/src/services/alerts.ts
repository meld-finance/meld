import type { Alert, AlertList, AlertSettings, AlertSeverity, AlertType } from '@meld/shared';
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, alerts, institutions, plaidItems, transactions } from '../db/schema';
import { localDate } from '../lib/networth';
import { addDays, daysBetween } from '../lib/recurring';
import { getAlertSettings } from './alert-settings';
import { getAutopayStatuses, getRecurringSeries } from './recurring';
import { countsTowardCashflow } from './transactions';

/** Alerts about a state that can clear on its own; the rest are about one event and stay until dismissed. */
const CONDITIONS = new Set<AlertType>(['autopay_short', 'low_balance', 'connection']);
const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, critical: 2 };
/** Charges this recent can raise a large-transaction alert; older history arriving from a new link can't. */
const LARGE_TXN_DAYS = 3;
/** A price change or new series this recent is news. */
const PRICE_CHANGE_DAYS = 10;
const NEW_SERIES_DAYS = 100;
/** An estimated autopay amount (statement not out yet) is worth an alert only this close to the due date. */
const ESTIMATE_ALERT_DAYS = 7;
/** Resolved and dismissed alerts are listed for this long. */
const HISTORY_DAYS = 30;

export type AlertCandidate = {
  type: AlertType;
  severity: AlertSeverity;
  key: string;
  title: string;
  body: string;
  href: string | null;
};

const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const exactDollars = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Everything that deserves an alert right now, given the settings. */
export async function alertCandidates(db: Db, settings: AlertSettings, today = localDate()): Promise<AlertCandidate[]> {
  const out: AlertCandidate[] = [];
  const series = await getRecurringSeries(db, today);

  if (settings.autopay) {
    const { statuses } = await getAutopayStatuses(db, series, settings, today);
    for (const a of statuses) {
      if ((a.health !== 'short' && a.health !== 'tight') || !a.dueDate) continue;
      if (a.amountSource === 'estimate' && daysBetween(today, a.dueDate) > ESTIMATE_ALERT_DAYS) continue;
      const short = a.health === 'short';
      out.push({
        type: 'autopay_short',
        severity: short ? 'critical' : 'warning',
        key: `autopay:${a.id}:${a.dueDate}`,
        title: short
          ? `${a.fundingName} won’t cover the ${a.payeeName} autopay`
          : `${a.fundingName} will be low after the ${a.payeeName} autopay`,
        body: a.summary,
        href: '/spending?tab=recurring',
      });
    }
  }

  const minimums = Object.entries(settings.lowBalance);
  if (minimums.length) {
    const rows = await db
      .select({ id: accounts.id, name: accounts.name, current: accounts.currentBalance, available: accounts.availableBalance })
      .from(accounts)
      .where(and(inArray(accounts.id, minimums.map(([id]) => id)), eq(accounts.hidden, false)));
    for (const r of rows) {
      const min = settings.lowBalance[r.id]!;
      const balance = r.available ?? r.current;
      if (balance === null || balance >= min) continue;
      out.push({
        type: 'low_balance',
        severity: 'warning',
        key: `low:${r.id}`,
        title: `${r.name} is below ${dollars(min)}`,
        body: `${r.name} has ${exactDollars(balance)}, under the ${dollars(min)} you want to keep in it.`,
        href: `/account/${r.id}`,
      });
    }
  }

  if (settings.connection) {
    const items = await db
      .select({ id: plaidItems.id, status: plaidItems.status, error: plaidItems.lastError, institution: institutions.name })
      .from(plaidItems)
      .leftJoin(institutions, eq(institutions.id, plaidItems.institutionId))
      .where(inArray(plaidItems.status, ['login_required', 'error']));
    for (const i of items) {
      const name = i.institution ?? 'A bank';
      out.push({
        type: 'connection',
        severity: 'warning',
        key: `connection:${i.id}`,
        title: i.status === 'login_required' ? `Reconnect ${name}` : `${name} isn’t syncing`,
        body:
          i.status === 'login_required'
            ? `${name} needs you to sign in again before Meld can see new transactions and balances.`
            : `The last sync with ${name} failed${i.error ? `: ${i.error}` : ''}. Balances and alerts for its accounts may be out of date.`,
        href: '/accounts',
      });
    }
  }

  if (settings.largeTransaction !== null) {
    const rows = await db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        accountName: accounts.name,
        date: transactions.date,
        amount: transactions.amount,
        name: sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(
        and(
          countsTowardCashflow,
          eq(transactions.pending, false),
          gte(transactions.date, addDays(today, -LARGE_TXN_DAYS)),
          gte(transactions.amount, settings.largeTransaction),
        ),
      );
    for (const t of rows) {
      out.push({
        type: 'large_transaction',
        severity: 'warning',
        key: `large:${t.id}`,
        title: `${exactDollars(t.amount)} at ${t.name}`,
        body: `${t.accountName} was charged ${exactDollars(t.amount)} at ${t.name} on ${shortDate(t.date)}.`,
        href: `/account/${t.accountId}`,
      });
    }
  }

  for (const s of series) {
    if (s.status !== 'active' || s.kind === 'income') continue;
    const p = s.priceChange;
    if (settings.priceIncrease && p && p.to > p.from && daysBetween(p.date, today) <= PRICE_CHANGE_DAYS) {
      out.push({
        type: 'price_increase',
        severity: 'warning',
        key: `price:${s.key}:${p.date}`,
        title: `${s.name} went up to ${exactDollars(p.to)}`,
        body: `${s.name} charged ${exactDollars(p.to)} on ${shortDate(p.date)}, up from ${exactDollars(p.from)}: about ${dollars(((p.to - p.from) * s.monthlyAmount * 12) / s.amount)} more a year.`,
        href: '/spending?tab=recurring',
      });
    }
    if (settings.newRecurring && daysBetween(s.firstDate, today) <= NEW_SERIES_DAYS) {
      out.push({
        type: 'new_recurring',
        severity: 'info',
        key: `new:${s.key}`,
        title: `New recurring charge: ${s.name}`,
        body: `${s.name} has charged ${s.accountName} ${s.occurrences} times since ${shortDate(s.firstDate)}, about ${exactDollars(s.amount)} each time. If you didn’t sign up for it, look into it.`,
        href: '/spending?tab=recurring',
      });
    }
  }
  return out;
}

export type Notifier = (alert: AlertCandidate, settings: AlertSettings) => Promise<void>;

/** Publishes through ntfy's JSON API: the topic URL's last path segment is the topic. */
export const ntfyNotifier: Notifier = async (alert, settings) => {
  if (!settings.ntfyUrl) return;
  const url = new URL(settings.ntfyUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  const topic = segments.pop();
  if (!topic) throw new Error('The ntfy URL needs a topic, like https://ntfy.sh/your-topic');
  url.pathname = `/${segments.join('/')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      title: alert.title,
      message: alert.body,
      priority: alert.severity === 'critical' ? 5 : alert.severity === 'warning' ? 4 : 3,
      tags: [alert.severity === 'critical' ? 'rotating_light' : alert.severity === 'warning' ? 'warning' : 'information_source'],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ntfy answered ${res.status}`);
};

let running: Promise<unknown> = Promise.resolve();

/**
 * Opens alerts for new conditions and events, updates open ones, and resolves conditions that
 * have cleared. Runs one at a time, since syncs of several banks can finish together.
 */
export function evaluateAlerts(db: Db, notify: Notifier = ntfyNotifier, today = localDate()): Promise<{ opened: number; resolved: number }> {
  const run = running.then(() => runEvaluation(db, notify, today));
  running = run.catch(() => undefined);
  return run;
}

async function runEvaluation(db: Db, notify: Notifier, today: string) {
  const settings = await getAlertSettings(db);
  const candidates = await alertCandidates(db, settings, today);
  const keys = candidates.map((c) => c.key);
  // Event alerts never resolve, so an open row is any row for an event; conditions may have older resolved rows.
  const open = keys.length
    ? await db.select().from(alerts).where(and(inArray(alerts.key, keys), isNull(alerts.resolvedAt)))
    : [];
  const openByKey = new Map(open.map((a) => [a.key, a]));
  const toPush: { candidate: AlertCandidate; id: string }[] = [];
  let opened = 0;

  for (const c of candidates) {
    const existing = openByKey.get(c.key);
    if (!existing) {
      const [row] = await db.insert(alerts).values(c).returning({ id: alerts.id });
      toPush.push({ candidate: c, id: row!.id });
      opened++;
      continue;
    }
    if (!CONDITIONS.has(c.type)) continue;
    const worse = SEVERITY_RANK[c.severity] > SEVERITY_RANK[existing.severity as AlertSeverity];
    if (worse || existing.title !== c.title || existing.body !== c.body) {
      // Getting worse brings a dismissed alert back and pushes it again; a changed amount just updates the text.
      await db
        .update(alerts)
        .set({ severity: c.severity, title: c.title, body: c.body, ...(worse ? { readAt: null, dismissedAt: null } : {}) })
        .where(eq(alerts.id, existing.id));
      if (worse) toPush.push({ candidate: c, id: existing.id });
    }
  }

  const stale = await db
    .select({ id: alerts.id, key: alerts.key })
    .from(alerts)
    .where(and(inArray(alerts.type, [...CONDITIONS]), isNull(alerts.resolvedAt)));
  const live = new Set(keys);
  const resolvedIds = stale.filter((a) => !live.has(a.key)).map((a) => a.id);
  if (resolvedIds.length) await db.update(alerts).set({ resolvedAt: new Date() }).where(inArray(alerts.id, resolvedIds));

  if (settings.ntfyUrl) {
    for (const { candidate, id } of toPush) {
      if (SEVERITY_RANK[candidate.severity] < SEVERITY_RANK[settings.pushMinSeverity]) continue;
      try {
        await notify(candidate, settings);
        await db.update(alerts).set({ notifiedAt: new Date() }).where(eq(alerts.id, id));
      } catch (err) {
        console.warn(`[alerts] push failed: ${(err as Error).message}`);
      }
    }
  }
  return { opened, resolved: resolvedIds.length };
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

export async function listAlerts(db: Db): Promise<AlertList> {
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
  const rows = await db
    .select()
    .from(alerts)
    .where(or(and(isNull(alerts.resolvedAt), isNull(alerts.dismissedAt)), gte(alerts.updatedAt, since)))
    .orderBy(desc(alerts.createdAt))
    .limit(200);
  const list: Alert[] = rows.map((a) => ({
    id: a.id,
    type: a.type as AlertType,
    severity: a.severity as AlertSeverity,
    title: a.title,
    body: a.body,
    href: a.href,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    readAt: iso(a.readAt),
    dismissedAt: iso(a.dismissedAt),
    resolvedAt: iso(a.resolvedAt),
  }));
  return { alerts: list, unread: list.filter((a) => !a.readAt && !a.dismissedAt && !a.resolvedAt).length };
}

export async function markAlertsRead(db: Db, ids?: string[]) {
  await db
    .update(alerts)
    .set({ readAt: new Date() })
    .where(and(isNull(alerts.readAt), ids ? inArray(alerts.id, ids) : undefined));
}

export async function dismissAlert(db: Db, id: string, dismissed: boolean) {
  await db
    .update(alerts)
    .set(dismissed ? { dismissedAt: new Date(), readAt: sql`coalesce(${alerts.readAt}, now())` } : { dismissedAt: null })
    .where(eq(alerts.id, id));
}
