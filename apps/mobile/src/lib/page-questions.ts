import { useGlobalSearchParams, usePathname } from 'expo-router';

type PageQuestions = { page: string; questions: string[] };

const GENERAL: PageQuestions = {
  page: 'your finances',
  questions: [
    'How am I doing overall?',
    'Where is my money going this month?',
    'Should I pay down debt faster or invest more?',
    'What tax-saving moves should I consider this year?',
  ],
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
  },
  '/accounts': {
    page: 'your accounts',
    questions: [
      'Am I keeping too much in checking or savings?',
      'Which debt should I pay off first?',
      'How big should my emergency fund be, and do I have enough?',
      'Should I pay extra on my mortgage?',
    ],
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
  },
  '/spending': {
    page: 'your spending',
    questions: [
      'How does my spending compare to last year?',
      'What’s driving my biggest spending increase?',
      'Where can I cut back to save more for retirement?',
      'What will my spending look like next year?',
    ],
  },
  '/spending?transactions': {
    page: 'your transactions',
    questions: [
      'Do I have any subscriptions I might have forgotten about?',
      'Which merchants do I spend the most with?',
      'Are there any unusual charges this month?',
      'How much do I spend eating out each month?',
    ],
  },
  '/spending?budgets': {
    page: 'your budgets',
    questions: [
      'Which budgets am I likely to go over this month?',
      'Are my budgets realistic based on what I usually spend?',
      'Where should I set budgets that I don’t have yet?',
      'How can I stay under budget for the rest of the month?',
    ],
  },
  '/plan': {
    page: 'your retirement plan',
    questions: [
      'Am I on track for retirement?',
      'How much more should I save each month to retire on time?',
      'When should I claim Social Security?',
      'Should I be putting more into Roth or traditional accounts?',
    ],
  },
  '/plan?insurance': {
    page: 'your insurance',
    questions: [
      'Am I underinsured for life or disability?',
      'How does my insurance coverage look?',
      'Do I still need all the coverage I have?',
      'What happens to my family’s finances if I can’t work?',
    ],
  },
  '/plan?profile': {
    page: 'your profile',
    questions: [
      'What tax-saving moves should I consider this year?',
      'Am I getting the most from my employer benefits?',
      'How much should I be saving for my kids’ college?',
      'What tax bracket am I in, and what does that mean for me?',
    ],
  },
};

/** What the page being looked at is about, and questions to start a chat about it. */
export function usePageQuestions(): PageQuestions {
  const pathname = usePathname();
  const { tab } = useGlobalSearchParams<{ tab?: string }>();
  return (tab && BY_PAGE[`${pathname}?${tab}`]) || BY_PAGE[pathname] || GENERAL;
}
