import { router, type Href } from 'expo-router';
import { useSyncExternalStore } from 'react';

import { prefs } from './prefs';

export type TourStep = {
  /** A question people ask about their money. */
  question: string;
  /** Where Meld answers it. */
  place: string;
  href: Href;
  /** How that page answers it, with what the demo household shows there. */
  answer: string;
};

/** A walk through the demo: common money questions, each answered on the page that handles it. */
export const TOUR: TourStep[] = [
  {
    question: 'What am I actually worth?',
    place: 'Home',
    href: '/',
    answer:
      'Home adds up every account, your home and car, less what you owe, and charts it over time. Below that: what needs your attention, and what’s due in the next two weeks.',
  },
  {
    question: 'Is a payment about to bounce?',
    place: 'Alerts',
    href: '/alerts',
    answer:
      'Meld checks each autopay against the bank account that pays it, counting the bills due first. Here, checking won’t cover the card payment due in a few days, so it’s flagged as urgent.',
  },
  {
    question: 'Where does my money go?',
    place: 'Spending',
    href: '/spending',
    answer:
      'Spending sorts purchases by category, compares them with last year and tracks your budgets. Eating out is up this month, which pushes food over budget. Tap a category to see what’s behind it.',
  },
  {
    question: 'What am I still subscribed to?',
    place: 'Spending → Recurring',
    href: '/spending?tab=recurring',
    answer:
      'Meld finds subscriptions, bills and paychecks by itself. Here it caught a Netflix price rise and a new Headspace charge, and it lists Disney+ as stopped.',
  },
  {
    question: 'Is my cash earning enough?',
    place: 'Accounts → Cash',
    href: '/accounts?tab=cash',
    answer:
      'Cash works out what each account really earns and how many months of spending you have put away. The demo savings account earns about 0.4%, far less than high-yield accounts pay.',
  },
  {
    question: 'Am I on track to retire?',
    place: 'Plan → Retirement',
    href: '/plan',
    answer:
      'Retirement projects your savings, Social Security and spending in today’s dollars, and shows what closes any gap—or how much extra spending or earlier retirement your cushion can support. Try a different retirement age.',
  },
  {
    question: 'Am I missing tax savings?',
    place: 'Plan → Tax',
    href: '/plan?tab=tax',
    answer:
      'Tax estimates this year’s bill and lists moves with what each one saves: here, 401(k) room, a fund to sell at a loss, and a Roth IRA contribution.',
  },
  {
    question: 'Would my family know what to do?',
    place: 'Plan → Estate',
    href: '/plan?tab=estate',
    answer:
      'Estate checks that every account passes the way you mean it to. The rollover IRA here has no beneficiary, and the will is older than the younger child. It also builds a packet for your family.',
  },
  {
    question: 'Can I just ask?',
    place: 'Ask Meld',
    href: '/ask',
    answer:
      'Ask Meld answers questions about your money in plain English. It’s optional and needs an AI model: one that runs on this computer, or a cloud model you choose.',
  },
  {
    question: 'Ready for your own numbers?',
    place: 'Connect your banks',
    href: '/connect',
    answer:
      'Connecting takes about 10 minutes with a free Plaid account. Your data stays on this computer, and the demo household goes away.',
  },
];

const KEY = 'tour';

type State = { active: boolean; index: number; minimized: boolean };
let state: State = { active: false, index: 0, minimized: false };
let touched = false;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  touched = true;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
  void prefs.set(KEY, state.active ? JSON.stringify({ index: state.index }) : '');
}

// Pick up where a reload left off.
void prefs.get(KEY).then((saved) => {
  if (!saved || state.active || touched) return;
  try {
    const { index } = JSON.parse(saved) as { index: number };
    if (index >= 0 && index < TOUR.length) set({ active: true, index, minimized: true });
  } catch {}
});

/** Opens the tour at its first stop once Meld comes up, e.g. right after choosing demo data. */
export function startTourOnArrival() {
  set({ active: true, index: 0, minimized: false });
}

/** Starts the tour immediately from step 1 on Home. */
export function startTour() {
  set({ active: true, index: 0, minimized: false });
  router.replace(TOUR[0]!.href);
}

/** Ends and clears any active or minimized tour. */
export function endTour() {
  set({ active: false, index: 0, minimized: false });
}

function go(index: number) {
  const i = Math.max(0, Math.min(TOUR.length - 1, index));
  set({ active: true, index: i, minimized: false });
  router.navigate(TOUR[i]!.href);
}

export function useTour() {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  return {
    ...s,
    step: TOUR[s.index]!,
    start: () => go(0),
    next: () => go(s.index + 1),
    back: () => go(s.index - 1),
    end: endTour,
    minimize: (minimized: boolean) => set({ minimized }),
  };
}
