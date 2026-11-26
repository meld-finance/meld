import { useGlobalSearchParams, usePathname } from 'expo-router';

type PageQuestions = { page: string; questions: string[]; helpQuestion: string };

const GENERAL: PageQuestions = {
  page: 'your finances',
  questions: [
    'How am I doing overall?',
    'Where is my money going this month?',
    'Should I pay down debt faster or invest more?',
    'What tax-saving moves should I consider this year?',
  ],
  helpQuestion: 'What features does Meld have, and where do I start?',
};

/** Starter questions for each page and sub-tab, keyed by `<path>` or `<path>?<tab>`. */
const BY_PAGE: Record<string, PageQuestions> = {
  '/': {
    page: 'your overview',
    questions: [
      'How am I doing overall?',
      'Why did my net worth change this month?',
      'Is anything coming up that I should plan for?',
      'What’s the one thing I should do next with my money?',
    ],
    helpQuestion: 'What features does Meld have, and how do I get the most out of it?',
  },
  '/accounts': {
    page: 'your accounts',
    questions: [
      'Am I keeping too much in checking or savings?',
      'Which debt should I pay off first?',
      'How big should my emergency fund be, and do I have enough?',
      'Should I pay extra on my mortgage?',
    ],
    helpQuestion: 'How do I link accounts, hide an account, or add my home?',
  },
  '/accounts?cash': {
    page: 'your cash',
    questions: [
      'How big should my emergency fund be, and do I have enough?',
      'Where could my cash earn a better rate?',
      'Should I invest my extra cash or pay down debt?',
      'Is a money market fund or a high-yield savings account better for me?',
    ],
    helpQuestion: 'How does Meld estimate APYs and my emergency fund target?',
  },
  '/accounts?investments': {
    page: 'your investments',
    questions: [
      'Is my asset allocation right for my age?',
      'How much of my portfolio growth came from markets vs. my own contributions?',
      'Am I too concentrated in any single stock or sector?',
      'Any tax-loss harvesting opportunities in my portfolio?',
      'Are my fund fees reasonable?',
    ],
    helpQuestion: 'How does Meld calculate returns and look-through exposure?',
  },
  '/accounts?investments&view=equity': {
    page: 'your equity & RSUs',
    questions: [
      'How much extra tax will my RSU vests add this year?',
      'Am I too concentrated in my employer stock?',
      'Should I sell RSUs when they vest or hold them?',
      'When is my vesting cliff, and how does my income change after it?',
    ],
    helpQuestion: 'How does Meld track unvested RSUs without counting them in net worth?',
  },
  '/spending': {
    page: 'your spending',
    questions: [
      'How does my spending compare to last year?',
      'What’s driving my biggest spending increase?',
      'Where can I cut back to save more for retirement?',
      'What will my spending look like next year?',
    ],
    helpQuestion: 'How does Meld calculate cash flow and exclude transfers?',
  },
  '/spending?transactions': {
    page: 'your transactions',
    questions: [
      'Do I have any subscriptions I might have forgotten about?',
      'Which merchants do I spend the most with?',
      'Are there any unusual charges this month?',
      'How much do I spend eating out each month?',
    ],
    helpQuestion: 'How do category rules work?',
  },
  '/spending?recurring': {
    page: 'your recurring payments',
    questions: [
      'Which subscriptions could I cancel?',
      'Will my checking account cover everything due this month?',
      'Did any of my bills or subscriptions go up recently?',
      'How much do I spend on subscriptions a year?',
    ],
    helpQuestion: 'How does autopay coverage tracking work?',
  },
  '/spending?budgets': {
    page: 'your budgets',
    questions: [
      'Which budgets am I likely to go over this month?',
      'Are my budgets realistic based on what I usually spend?',
      'Where should I set budgets that I don’t have yet?',
      'How can I stay under budget for the rest of the month?',
    ],
    helpQuestion: 'How do monthly budgets and category tracking work?',
  },
  '/plan': {
    page: 'your retirement plan',
    questions: [
      'Am I on track for retirement?',
      'How much more should I save each month to retire on time?',
      'When should I claim Social Security?',
      'Should I be putting more into Roth or traditional accounts?',
    ],
    helpQuestion: 'How do retirement projections, Social Security, and property sales work?',
  },
  '/plan?insurance': {
    page: 'your insurance',
    questions: [
      'Am I underinsured for life or disability?',
      'How does my insurance coverage look?',
      'Do I still need all the coverage I have?',
      'What happens to my family’s finances if I can’t work?',
    ],
    helpQuestion: 'How does insurance PDF upload work, and is my file private?',
  },
  '/plan?estate': {
    page: 'your estate plan',
    questions: [
      'Which of my accounts are missing a beneficiary?',
      'What would go through probate if I died today?',
      'Which estate documents should I have and am I missing any?',
      'Are my beneficiaries and estate documents due for a review?',
    ],
    helpQuestion: 'How does the estate checklist and family packet PDF work?',
  },
  '/plan?profile': {
    page: 'your profile',
    questions: [
      'What tax-saving moves should I consider this year?',
      'Am I getting the most from my employer benefits?',
      'How much should I be saving for my kids’ college?',
      'What tax bracket am I in, and what does that mean for me?',
    ],
    helpQuestion: 'Which features use my profile details?',
  },
  '/plan?tax': {
    page: 'your tax estimate',
    questions: [
      'What are the biggest moves to lower my taxes this year?',
      'What should I get done before December 31 for taxes?',
      'Which losses should I harvest before year-end?',
      'Should I do a Roth conversion or a backdoor Roth this year?',
      'Am I withholding enough to avoid owing in April?',
    ],
    helpQuestion: 'How does Meld estimate taxes and realized gains?',
  },
  '/alerts': {
    page: 'your alerts',
    questions: [
      'Do I have any urgent alerts or upcoming autopay risks?',
      'Did any of my subscriptions or bills go up recently?',
      'Are any of my bank accounts running low for upcoming bills?',
    ],
    helpQuestion: 'How do smart alerts and ntfy phone notifications work?',
  },
  '/settings': {
    page: 'Meld settings',
    questions: [
      'How do I access Meld from my phone with Tailscale?',
      'How do I use a local Ollama model or my ChatGPT plan?',
      'How do I enable the MCP server for external AI tools?',
      'What data stays on my machine vs. goes to outside services?',
    ],
    helpQuestion: 'How do I switch between Plaid Sandbox and real accounts?',
  },
};

/** Detail pages outside the tabs, keyed by their first path segment, and the tab they belong to. */
const SECTION_PAGES: Record<string, string> = {
  '/equity': '/accounts?investments&view=equity',
  '/estate': '/plan?estate',
  '/insurance': '/plan?insurance',
};

/** What the page being looked at is about, and questions to start a chat about it. */
export function usePageQuestions(): PageQuestions {
  const pathname = usePathname();
  const { tab, view } = useGlobalSearchParams<{ tab?: string; view?: string }>();
  const section = SECTION_PAGES[`/${pathname.split('/')[1]}`];
  return (
    (tab && view && BY_PAGE[`${pathname}?${tab}&view=${view}`]) ||
    (tab && BY_PAGE[`${pathname}?${tab}`]) ||
    BY_PAGE[pathname] ||
    (section && BY_PAGE[section]) ||
    GENERAL
  );
}
