import { z } from 'zod';

export const AlertType = z.enum(['autopay_short', 'low_balance', 'large_transaction', 'price_increase', 'new_recurring', 'connection']);
export type AlertType = z.infer<typeof AlertType>;

export const AlertSeverity = z.enum(['info', 'warning', 'critical']);
export type AlertSeverity = z.infer<typeof AlertSeverity>;

export const Alert = z.object({
  id: z.uuid(),
  type: AlertType,
  severity: AlertSeverity,
  title: z.string(),
  body: z.string(),
  /** An in-app path to open for more, e.g. `/spending?tab=recurring`. */
  href: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  readAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
  /** The condition cleared on its own (the account was topped up, the bank reconnected). */
  resolvedAt: z.string().nullable(),
});
export type Alert = z.infer<typeof Alert>;

export const AlertList = z.object({
  alerts: z.array(Alert),
  /** Unread alerts that are still open (not dismissed or resolved). */
  unread: z.number().int(),
});
export type AlertList = z.infer<typeof AlertList>;

export const AlertSettings = z.object({
  /** A card or loan's autopay won't be covered by its bank account. */
  autopay: z.boolean(),
  /** Count paychecks expected into the bank account before the due date. */
  autopayCountIncome: z.boolean(),
  /** Warn when the bank account would be left with less than this after the payment; 0 warns only when it's short. */
  autopayCushion: z.number().nonnegative(),
  /** Minimum balances by account id; an alert fires when an account drops below its minimum. */
  lowBalance: z.record(z.string(), z.number().nonnegative()),
  /** Any single charge at or above this, or null for off. */
  largeTransaction: z.number().positive().nullable(),
  /** A subscription or bill that's steady in price charged a different amount. */
  priceIncrease: z.boolean(),
  /** Meld spotted a new recurring charge. */
  newRecurring: z.boolean(),
  /** A bank connection needs you to sign in again. */
  connection: z.boolean(),
  /** Push notifications through ntfy (https://ntfy.sh or your own server): the full topic URL, or null for in-app only. */
  ntfyUrl: z.url({ protocol: /^https?$/ }).nullable(),
  /** Only push alerts at or above this severity. */
  pushMinSeverity: AlertSeverity,
});
export type AlertSettings = z.infer<typeof AlertSettings>;

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  autopay: true,
  autopayCountIncome: true,
  autopayCushion: 0,
  lowBalance: {},
  largeTransaction: null,
  priceIncrease: true,
  newRecurring: true,
  connection: true,
  ntfyUrl: null,
  pushMinSeverity: 'warning',
};
