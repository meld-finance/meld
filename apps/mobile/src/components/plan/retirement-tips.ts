import { RETIREMENT_DEFAULTS, SPENDING_DECLINE_AGE } from '@meld/shared';

import type { Tip } from '@/components/info-tip';

/** Retirement terms in plain words, for the ⓘ next to each one. */
export const TIPS = {
  todaysDollars: {
    title: 'Today’s dollars',
    body: 'Prices rise over time, so $1 million in 30 years will buy much less than $1 million does now. Meld takes rising prices out of every number, so each amount means what it would buy today.\n\nThat’s why returns are “after inflation”: the growth left over once prices have gone up.',
  },
  retirementAge: {
    title: 'Retire at age',
    body: 'The age you stop working and start living on your savings. Every extra year of work helps twice: one more year of saving, and one less year your money has to cover.',
  },
  planToAge: {
    title: 'Plan to age',
    body: `How long your money needs to last. ${RETIREMENT_DEFAULTS.lifeExpectancy} is cautious on purpose: many people live well into their 90s, and running out of money late in life is much worse than leaving some behind.`,
  },
  expectedReturn: {
    title: 'Return after inflation',
    body: `How much your investments grow each year beyond rising prices. Over the long run, US stocks have grown about 7% a year after inflation and bonds about 2%; a mix of the two, somewhere between.\n\nMeld uses ${RETIREMENT_DEFAULTS.expectedReturn}% unless you change it. A lower number is the safer assumption.`,
  },
  contribution: {
    title: 'Saving per year',
    body: 'Everything that goes into your retirement savings in a year: what comes out of your paycheck for your 401(k), your employer’s match (free money your employer adds when you contribute), and anything you put in an IRA or brokerage account for retirement.\n\nA common rule of thumb is to save 15% of your income, match included.',
  },
  spending: {
    title: 'Spending per year',
    body: 'What you expect to spend each year once you retire, in today’s dollars. Your spending now is a good place to start: some costs go away (commuting, saving for retirement), others grow (travel, health care).\n\nUse life events below for changes you can see coming, like a paid-off mortgage.',
  },
  spendingDecline: {
    title: 'Spending slows with age',
    body: `Most people travel and shop less as they get older. Households over 75 spend about a fifth less than those 65 to 74, even with higher health costs. This trims your spending a little each year after ${SPENDING_DECLINE_AGE}.\n\nSet it to 0 to keep spending flat, which is more cautious.`,
  },
  socialSecurity: {
    title: 'Social Security',
    body: 'A monthly payment from the government for life, based on how much you earned over your career. Your statement at ssa.gov shows what you’d get at your full retirement age.\n\nIt rises with inflation each year, so it’s already in today’s dollars.',
  },
  fullRetirementAge: {
    title: 'Full retirement age',
    body: 'The age Social Security pays your full benefit: 67 for anyone born in 1960 or later. You can start as early as 62 or as late as 70.',
  },
  claimAge: {
    title: 'When you claim',
    body: 'Claiming Social Security early gives you smaller checks for life: about 30% less at 62. Waiting past full retirement age adds about 8% a year, up to 70.\n\nWaiting usually pays off if you live past your early 80s, and helps a spouse who may outlive you. Claiming early can make sense if you need the money or have health concerns.',
  },
  pension: {
    title: 'Pension',
    body: 'A fixed yearly payment from a former employer, if you have one. Most private-sector workers don’t; teachers, government workers and some union jobs often do. Enter it in today’s dollars.',
  },
  otherSavings: {
    title: 'Other savings',
    body: 'Money you’ve set aside for retirement that isn’t in a linked investment account, like cash in savings you won’t need before then.',
  },
  projected: {
    title: 'Projected savings',
    body: 'What your savings could grow to by the day you retire, if you keep saving what you entered and your investments earn the return you set.',
  },
  needed: {
    title: 'Needed at retirement',
    body: 'How much you’d need on the day you retire for your savings to cover your spending every year until your plan-to age, after Social Security, pensions and other income. Your money keeps earning a return while you draw it down.',
  },
  status: {
    title: 'On track or short',
    body: 'The difference between what you’re projected to have and what you’ll need. If you’re short, you can save more, retire later, spend less, or claim Social Security later; try changing a number to see the effect.',
  },
  lifeEvents: {
    title: 'Life events',
    body: 'Big changes you can see coming: kids leaving home, paying off the mortgage, working part-time in retirement, an inheritance, a new roof. Each one changes your spending, income or saving from a certain age, or adds or takes a one-time sum.\n\nTime them by your age, or by a child’s age if you’ve added children on your profile.',
  },
  spendingEvent: {
    title: 'Spending change',
    body: 'Changes how much you spend each year in retirement, like a paid-off mortgage (less) or travel in your first years retired (more).\n\nIt doesn’t change the years before you retire: there, what you save is what matters. If a cost before retirement means you’ll save less, add a saving change instead.',
  },
  incomeEvent: {
    title: 'Income',
    body: 'Money coming in, like part-time work, consulting, an annuity or a spouse’s pension. In retirement it pays for spending, so you draw less from savings; anything left over is saved. Before you retire, Meld assumes all of it is saved, so enter only the part you’d save.',
  },
  savingEvent: {
    title: 'Saving change',
    body: 'Changes what you put away each year before you retire, like a raise you’ll save, or saving less while kids are in daycare or college.\n\nAt 50, you can also put more into a 401(k) and IRA each year (“catch-up contributions”).',
  },
  onceEvent: {
    title: 'One-time',
    body: 'A single sum added to or taken from your savings at one age: an inheritance or the sale of a business coming in; a wedding, a new car or a big renovation going out.',
  },
  childAges: {
    title: 'Whose age',
    body: 'Time an event by your age, or by a child’s, like “when Maya turns 18”. Meld works out how old you’ll be then.',
  },
  counted: {
    title: 'What’s counted',
    body: 'The investment accounts your retirement draws from. Turn off any you’re saving for something else, like a house. College savings (529) and accounts held for a child are never counted.',
  },
  taxTreatment: {
    title: 'Tax types',
    body: 'Tax-deferred (traditional 401(k), IRA): no tax going in, taxed when you take it out.\n\nTax-free (Roth): taxed going in, nothing to pay when you take it out.\n\nTaxable (brokerage): no special treatment; you pay tax on dividends and gains along the way.\n\nThe projection doesn’t subtract taxes, so leave room for them in your spending.',
  },
  properties: {
    title: 'Selling a property',
    body: 'Many people sell a home or rental to help pay for retirement, for example by downsizing. Meld grows today’s value until the sale, takes off selling costs and what’s left on the mortgage, and adds the rest to your savings that year.',
  },
  appreciation: {
    title: 'Value growth after inflation',
    body: 'How much faster than prices in general home values rise each year. Over the long run US homes have grown only about 1% a year after inflation, though it varies a lot by place.',
  },
  sellingCosts: {
    title: 'Selling costs',
    body: 'Agent commissions, closing costs and fix-ups when you sell, as a share of the price. Around 6 to 8% is typical.',
  },
  netRent: {
    title: 'Net rent',
    body: 'For a rental: rent you collect each year, minus the mortgage interest, taxes, insurance and upkeep. Negative if it costs more than it brings in. Counted until you sell.',
  },
  scenarios: {
    title: 'Scenarios',
    body: 'Separate versions of your plan, like “Retire at 60” and “Retire at 67”, so you can compare them side by side. The active one is the plan the rest of Meld, including Ask Meld, uses.',
  },
  monteCarlo: {
    title: 'Chance of success',
    body: 'Markets don’t return the same amount every year. Meld replays your plan many times, each with a different random run of good and bad years, and counts how often the money lasts.\n\nA bad run just after you retire hurts most, because you’re selling while prices are down. Many planners aim for 80% or more.',
  },
  volatility: {
    title: 'Volatility',
    body: 'How much returns swing from year to year. Around 12% suits a mostly-stock portfolio, 6 to 8% a balanced one. Higher volatility means a wider range of outcomes.',
  },
} satisfies Record<string, Tip>;
