[Meld home page](https://meld-finance.github.io/meld/) · [Docs](https://meld-finance.github.io/meld/docs/) · [Features](../features.md)

# Retirement

Project savings to retirement age, compare with what you'll need, and see the monthly saving that closes the gap—all in today's dollars.

![Retirement plan chart and gap](../images/features/retirement.png)

## Where to find it

- **Plan → Retirement**
- Profile birth year, optional partner (name, birth year, income), and income under **Plan → Profile** feed age, bridge-year pay, and Social Security estimates
- Opt a home into the plan from the Accounts tab

## The projection

**Plan → Retirement** projects your savings to retirement age, compares that with what you'll need for your money to last to the age you plan for, and shows the gap and the extra monthly saving that closes it. The chart shows your balance by age, growing until you retire and drawn down after.

Everything is in **today's dollars**: the return is after inflation (5% by default), and spending, contributions, Social Security and pensions are today's amounts.

## Partners and staggered retirement

Add an optional **Partner** (name, birth year and annual gross income) under **Plan → Profile** to give them their own retirement age, plan-to age, yearly savings, Social Security and pension:

- **Joint planning horizon:** Meld projects until whichever partner's plan-to age reaches furthest into the future.
- **Bridge years:** When you and your partner retire at different ages, the years in between are **bridge years**. Meld estimates the still-working partner's after-tax pay (with any active Social Security, pension or net rent) to cover household spending first, draws only any shortfall from savings, and caps bridge saving at the working partner's planned contribution when income covers spending.
- **Life events:** Time spending, saving, income or one-time life events by your age, your partner's age, or a child's age from your profile.

## Ways to adjust your plan

Below the chart, Meld shows single-change options toward a goal—either **Base** (steady expected return) or a Monte Carlo confidence target (**80%**, **85%**, **90%**, or **95%**) lasting to any **Last to age** you choose:

- **When you're short of the target:** see how much more to save per month, how many extra years to work, how much less to spend per month in retirement, or (when delaying to 70 is enough on its own) claiming Social Security later.
- **When you have room to spare:** see how much **more** you can afford to spend per month, how many years **earlier** you can retire, how much **less** you need to save now (down to $0/yr if current savings already cover the goal), and how old your savings still last (**Lasts longer**).

Click **Try it** on any option to preview it in the chart, KPI tiles, and stress test without saving yet, or **Undo** to revert that preview.

## Social Security

**Social Security** is estimated from your profile's income until you type the monthly amount at full retirement age from your statement (ssa.gov/myaccount). The estimate uses today's benefit formula and wage base, assuming you earn your current pay from 22 until you retire (up to 35 years).

- **With a partner on your profile:** Each person's benefit is estimated from their own income and stop-work age (or overridden individually) and claimed at their own claiming age (67 by default). When married and no statement figure is entered for the lower earner, Meld adds a spousal top-up up to half of the higher earner's full benefit (capped at full retirement age, with no delayed credits past FRA on the spousal top-up).
- **Without a partner on your profile:** A married estimate takes the lower of one earner plus a spousal benefit and two equal earners.

Meld adjusts the benefit for the age you claim: less before full retirement age, 8% a year more on your own benefit after it up to 70. Buttons show what 62, full retirement age and 70 pay, and tapping one sets the claiming age.

## Simple vs. Detailed mode

Meld supports two retirement planning modes—switch between them at the top of **Plan → Retirement** at any time:

- **Simple mode (default):** Treats all included accounts as one combined pool with no retirement income-tax modeling. Ideal if you're decades away from retiring or want a fast, low-friction check on savings rate and retirement age.
- **Detailed mode (tax-aware):** Splits your accounts into **three tax buckets** (Pre-tax, Tax-free Roth, and Taxable brokerage) and models federal & state income taxes, long-term capital gains, Social Security taxability, Required Minimum Distributions (RMDs), optional Roth conversions, early-withdrawal rules before age 59½, and IRS catch-up contributions.

As your plan gets closer to retirement—or when taxes and withdrawal rules start to have a meaningful impact—Meld shows friendly, dismissible **contextual tips** with plain-English explanations ("What does this mean?") so you can understand why a setting matters before turning it on.

## How retirement drawdowns work across account types

When you retire, a dollar in one account does not buy the same amount of spending as a dollar in another account, because the IRS taxes withdrawals differently depending on where the money lives:

| Bucket | Typical accounts | How withdrawals are taxed | Early-withdrawal & RMD rules |
| --- | --- | --- | --- |
| **Pre-tax (Tax-deferred)** | Traditional 401(k), 403(b), 457(b), TSP, Solo 401(k), Traditional / Rollover / SEP / SIMPLE IRA, Cash Balance Plan | **100% ordinary income tax** (federal + state) on every dollar withdrawn. Because you pay tax on the way out, you must withdraw *more* than your spending to cover the tax bill. | Subject to **RMDs** starting at age 73 or 75. Withdrawing before **age 59½** normally adds a **10% penalty** (except governmental **457(b)** plans, which are penalty-free after leaving the employer, or when you qualify for Rule of 55 / 72(t)). |
| **Taxable brokerage** | Individual or joint brokerage accounts, savings / cash set aside for retirement | **Only the gains are taxed**, at lower **long-term capital gains rates** (0%, 15%, or 20% federal, plus 3.8% NIIT for high incomes and applicable state tax). Your original deposit (**cost basis**) comes out tax-free. | **No RMDs** and **no early-withdrawal penalty** at any age—making taxable accounts the easiest bridge for early retirees. |
| **Tax-free (Roth / HSA)** | Roth IRA, Roth 401(k), Roth 403(b), Roth 457(b), Roth TSP, Roth Solo 401(k), HSA | **$0 tax** on qualified withdrawals—every dollar withdrawn is a full dollar of spending, and it doesn't push you into a higher tax bracket or make more of your Social Security taxable. | **No RMDs** during your lifetime. Your **original Roth contributions** can be withdrawn tax- and penalty-free at any age; investment earnings are penalty-free after 59½ (and the 5-year rule). |

In Detailed mode, Meld automatically sorts your included accounts into these three buckets (and estimates your taxable brokerage cost-basis percentage from your tracked holdings' cost basis—which you can override in **Taxes & withdrawals**).

### Withdrawal order strategies

In **Taxes & withdrawals**, choose which bucket Meld taps first when you need spending money (after any mandatory RMDs are satisfied):

1. **Taxable → Pre-tax → Roth (`Taxable first`, default):** Spends brokerage accounts first, letting tax-advantaged accounts keep compounding, then draws pre-tax, saving tax-free Roth for last. Simple and classic—though if your pre-tax balance is very large, waiting until RMD age can cause a tax spike in your 70s.
2. **Fill low tax bracket first (`Bracket fill`):** Pulls from pre-tax accounts up to the top of the 12% federal tax bracket (or your Roth conversion ceiling if set), then covers the rest of your spending from taxable and Roth. Smooths taxes across retirement and reduces future RMD spikes.
3. **Pre-tax → Taxable → Roth (`Pre-tax first`):** Draws down pre-tax accounts early while your income is lower, shrinking future RMDs and preserving taxable and Roth balances for later.
4. **Proportional across buckets (`Pro-rata`):** Pulls from all three buckets in proportion to their balances each year for a steady blended tax rate.

### Annual Roth conversions

In the years after you stop working—especially before Social Security and RMDs begin—your taxable income is often unusually low. Turning on **Annual Roth conversions** (12%, 22%, or 24% federal bracket) tells Meld to convert pre-tax dollars into your Roth bucket each retired year up to the top of that bracket, whenever spare taxable cash or surplus income can pay the conversion tax.

**Why people do it:** Paying 12% or 22% tax voluntarily in your 60s shrinks your pre-tax balance before RMDs begin in your 70s, potentially preventing 24%–32%+ tax spikes later and leaving more tax-free Roth money for late retirement or heirs.

### Required Minimum Distributions (RMDs)

Under **SECURE 2.0**, the IRS requires you to start withdrawing a minimum percentage from pre-tax retirement accounts (401(k), 403(b), 457(b), Traditional/Rollover/SEP/SIMPLE IRA) each year based on the **IRS Uniform Lifetime Table**:

- Born **1950 or earlier:** RMDs start at age **72**
- Born **1951–1959:** RMDs start at age **73**
- Born **1960 or later:** RMDs start at age **75**

In Detailed mode, Meld enforces RMDs automatically each year starting at your RMD age. If an RMD is larger than you need to spend, Meld pays the income tax on it and automatically **reinvests the leftover cash into your taxable brokerage bucket** (with 100% cost basis, since you already paid tax on it).

### Early retirement & the age 59½ rule

Normally, withdrawing from a 401(k), 403(b), or Traditional IRA before age 59½ triggers a **10% IRS early-withdrawal penalty** on top of income taxes. In Detailed mode, Meld automatically models penalty-free paths before age 60:

- **Taxable brokerage** is always tapped first before age 60 when available (0% early penalty).
- **Governmental 457(b)** balances are automatically exempt from the 10% early penalty once you separate from your employer.
- **Original Roth contributions** (entered as **Past Roth contributions** in **Taxes & withdrawals**) come out tax- and penalty-free before Roth earnings are touched.
- **Rule of 55 / 72(t) SEPP / Roth conversion ladder:** If you plan to use one of these IRS penalty-free early-access strategies, flip on **Penalty-free early access** in **Taxes & withdrawals** to waive the 10% penalty before age 60.

### Retirement tax state, Social Security tax, and catch-ups

- **Retirement tax state:** Uses your Profile state by default, or set a different state under **Taxes & withdrawals** to model relocating in retirement (for example, moving from California to Florida or Texas).
- **Social Security taxability:** Models the IRS provisional-income formula—depending on your other taxable income, 0%, up to 50%, or up to 85% of your Social Security benefit is included in federal taxable income.
- **Contribution split & catch-ups:** Choose how your ongoing annual savings split across Pre-tax, Roth, and Taxable accounts, and optionally turn on **Auto IRS catch-up contributions** to automatically add age-50+ ($8,000/yr) and age 60–63 super catch-up ($11,250/yr) workplace savings while working.

## Which accounts count

Every visible investment account counts at your ownership share, except 529, Coverdell, UTMA/UGMA and other education or custodial accounts. Turn off any account you're saving for something else (a down payment, say), and add cash set aside for retirement as **Other savings**.

Empty fields use suggestions: age from your profile's birth year, retirement at 65, planning to 95, and spending from your last 12 full months of cash flow. Edits update the projection as you type; **Save assumptions** keeps them.

## Properties

**Properties** you'd sell to fund retirement can count too. Turn on a home from the Accounts tab and set the age you'd sell it, its mortgage, and net rent per year (rent minus costs). At that age your share of the price (grown 1% a year after inflation by default, less 6% selling costs) minus what's left on the mortgage joins your savings; rent counts as saving before retirement and as income after, until the sale. The mortgage balance is projected from its rate and payment; taxes on the gain aren't included.

Ask Meld can read the plan (including Detailed mode tax summaries, RMDs, and nudges) and try what-ifs ("what if I retire at 60?", "what if I convert to the 22% bracket?", "what if I retire in Florida?") without changing what you saved.
