/**
 * Postgres schema (Drizzle ORM). Run `npm run db:generate` after any change.
 *
 * Sections:
 *   - Institutions & Plaid (institutions, plaidItems)
 *   - Accounts & transactions (accounts, transactions, categoryRules)
 *   - Investments (securities, priceHistory, holdings, investmentTransactions)
 *   - Equity grants & vesting (equityGrants, equityVests)
 *   - Liabilities (liabilities)
 *   - Insurance & documents (documents, insurancePolicies)
 *   - Manual assets, snapshots, budgets, profile (manualAssets, balanceSnapshots, budgets, userProfile, taxSettings, cashSettings, retirementScenarios, retirementSimulations)
 *   - Recurring payments, autopay, alerts (recurringOverrides, autopayLinks, alerts, alertSettings)
 *   - Estate (estateDocuments, estateDesignations, estateSettings)
 *   - AI chat (chatSessions, chatMessages)
 */
import type {
  AlertSettings,
  Beneficiary,
  CashSettings,
  Child,
  Contact,
  EstatePerson,
  EstateSettings,
  FixedIncomeTerms,
  RetirementInputs,
  RetirementPlan,
  SecurityProfile,
  SimulationResult,
  SimulationSettings,
  TaxSettings,
  ValuationSource,
  VehicleDetails,
} from '@meld/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const money = (name: string) => numeric(name, { precision: 18, scale: 2, mode: 'number' });
const id = () => uuid('id').primaryKey().defaultRandom();
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const accountType = pgEnum('account_type', ['depository', 'credit', 'investment', 'loan', 'mortgage', 'other']);
export const accountSource = pgEnum('account_source', ['plaid', 'manual']);
export const plaidItemStatus = pgEnum('plaid_item_status', ['active', 'login_required', 'error', 'revoked']);
export const policyType = pgEnum('policy_type', [
  'life_term',
  'life_whole',
  'life_universal',
  'disability_short',
  'disability_long',
  'other',
]);
export const premiumFrequency = pgEnum('premium_frequency', ['monthly', 'quarterly', 'semiannual', 'annual']);
export const chatRole = pgEnum('chat_role', ['user', 'assistant']);

// --- Institutions & Plaid ---------------------------------------------------

export const institutions = pgTable('institutions', {
  id: id(),
  plaidInstitutionId: text('plaid_institution_id').unique(),
  name: text('name').notNull(),
  ...timestamps,
});

export const plaidItems = pgTable('plaid_items', {
  id: id(),
  plaidItemId: text('plaid_item_id').notNull().unique(),
  institutionId: uuid('institution_id').references(() => institutions.id),
  /** AES-256-GCM encrypted; see lib/crypto.ts. */
  accessTokenEnc: text('access_token_enc').notNull(),
  transactionsCursor: text('transactions_cursor'),
  status: plaidItemStatus('status').notNull().default('active'),
  lastError: text('last_error'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  ...timestamps,
});

// --- Accounts & transactions ------------------------------------------------

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    source: accountSource('source').notNull(),
    plaidItemId: uuid('plaid_item_id').references(() => plaidItems.id, { onDelete: 'cascade' }),
    plaidAccountId: text('plaid_account_id').unique(),
    institutionId: uuid('institution_id').references(() => institutions.id),
    name: text('name').notNull(),
    officialName: text('official_name'),
    mask: text('mask'),
    type: accountType('type').notNull(),
    subtype: text('subtype'),
    currentBalance: money('current_balance'),
    availableBalance: money('available_balance'),
    creditLimit: money('credit_limit'),
    currency: text('currency').notNull().default('USD'),
    hidden: boolean('hidden').notNull().default(false),
    /** Your share of a jointly held account, 0–100; null means 100. Never written by sync. */
    ownershipPercent: numeric('ownership_percent', { precision: 5, scale: 2, mode: 'number' }),
    ...timestamps,
  },
  (t) => [index('accounts_item_idx').on(t.plaidItemId)],
);

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    plaidTransactionId: text('plaid_transaction_id').unique(),
    /** Plaid convention: positive = money out, negative = money in. */
    amount: money('amount').notNull(),
    currency: text('currency').notNull().default('USD'),
    date: date('date').notNull(),
    authorizedDate: date('authorized_date'),
    name: text('name').notNull(),
    merchantName: text('merchant_name'),
    plaidCategoryPrimary: text('plaid_category_primary'),
    plaidCategoryDetailed: text('plaid_category_detailed'),
    /** User override; falls back to Plaid category when null. */
    category: text('category'),
    /** User override of the subcategory; see `effectiveSubcategory` for the fallback. */
    subcategory: text('subcategory'),
    /** The rule that set `category`, if one did; null for manual edits. */
    categoryRuleId: uuid('category_rule_id').references(() => categoryRules.id, { onDelete: 'set null' }),
    /** The user has confirmed the category (by setting it or accepting it); rules leave these alone. */
    categoryVerified: boolean('category_verified').notNull().default(false),
    pending: boolean('pending').notNull().default(false),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [index('transactions_account_date_idx').on(t.accountId, t.date), index('transactions_date_idx').on(t.date)],
);

/** "Always categorize transactions matching `pattern` as …", applied as new transactions sync. */
export const categoryRules = pgTable(
  'category_rules',
  {
    id: id(),
    /** Case-insensitive text matched anywhere in the merchant name or description. */
    pattern: text('pattern').notNull(),
    category: text('category').notNull(),
    subcategory: text('subcategory'),
    ...timestamps,
  },
  (t) => [uniqueIndex('category_rules_pattern_idx').on(sql`lower(${t.pattern})`)],
);

// --- Investments ------------------------------------------------------------

export const securities = pgTable('securities', {
  id: id(),
  plaidSecurityId: text('plaid_security_id').unique(),
  tickerSymbol: text('ticker_symbol'),
  name: text('name'),
  type: text('type'),
  subtype: text('subtype'),
  /** Plaid's sector and industry, for individual stocks. */
  sector: text('sector'),
  industry: text('industry'),
  closePrice: numeric('close_price', { precision: 18, scale: 6, mode: 'number' }),
  closePriceAsOf: date('close_price_as_of'),
  /** What the security holds, from an AI lookup; null with `profiledAt` set means it wasn't recognized. */
  profile: jsonb('profile').$type<SecurityProfile>(),
  profiledAt: timestamp('profiled_at', { withTimezone: true }),
  /** Plaid's terms for an individual bond; null for everything else. */
  fixedIncome: jsonb('fixed_income').$type<FixedIncomeTerms>(),
  ...timestamps,
});

/** Daily closing prices per ticker from a public market data source, for valuing holdings in the past. */
export const priceHistory = pgTable('price_history', {
  ticker: text('ticker').primaryKey(),
  /** Close by date (YYYY-MM-DD); null when the source doesn't know the ticker. */
  closes: jsonb('closes').$type<Record<string, number>>(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
});

export const holdings = pgTable(
  'holdings',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    securityId: uuid('security_id')
      .notNull()
      .references(() => securities.id),
    quantity: numeric('quantity', { precision: 24, scale: 8, mode: 'number' }).notNull(),
    institutionPrice: numeric('institution_price', { precision: 18, scale: 6, mode: 'number' }),
    institutionValue: money('institution_value'),
    costBasis: money('cost_basis'),
    vestedQuantity: numeric('vested_quantity', { precision: 24, scale: 8, mode: 'number' }),
    vestedValue: money('vested_value'),
    ...timestamps,
  },
  (t) => [uniqueIndex('holdings_account_security_idx').on(t.accountId, t.securityId)],
);

export const investmentTransactions = pgTable('investment_transactions', {
  id: id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  securityId: uuid('security_id').references(() => securities.id),
  plaidInvestmentTransactionId: text('plaid_investment_transaction_id').unique(),
  date: date('date').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  subtype: text('subtype'),
  quantity: numeric('quantity', { precision: 24, scale: 8, mode: 'number' }),
  price: numeric('price', { precision: 18, scale: 6, mode: 'number' }),
    amount: money('amount'),
    fees: money('fees'),
    ...timestamps,
  },
);

// --- Equity grants & vesting ------------------------------------------------

export const equityGrants = pgTable('equity_grants', {
  id: id(),
  /** EquityGrantKind: rsu */
  kind: text('kind').notNull().default('rsu'),
  employer: text('employer').notNull(),
  name: text('name').notNull(),
  ticker: text('ticker'),
  manualPrice: numeric('manual_price', { precision: 18, scale: 6, mode: 'number' }),
  priceAsOf: date('price_as_of'),
  grantDate: date('grant_date').notNull(),
  grantNumberMask: text('grant_number_mask'),
  totalShares: numeric('total_shares', { precision: 24, scale: 8, mode: 'number' }).notNull(),
  linkedAccountId: uuid('linked_account_id').references(() => accounts.id, { onDelete: 'set null' }),
  /** WithholdingMethod: sell_to_cover | net_share | cash */
  withholdingMethod: text('withholding_method').notNull().default('sell_to_cover'),
  federalWithholdingRate: numeric('federal_withholding_rate', { precision: 5, scale: 2, mode: 'number' }),
  stateWithholdingRate: numeric('state_withholding_rate', { precision: 5, scale: 2, mode: 'number' }),
  /** EquityGrantStatus: active | completed | forfeited */
  status: text('status').notNull().default('active'),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  notes: text('notes'),
  ...timestamps,
});

export const equityVests = pgTable(
  'equity_vests',
  {
    id: id(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => equityGrants.id, { onDelete: 'cascade' }),
    vestDate: date('vest_date').notNull(),
    shares: numeric('shares', { precision: 24, scale: 8, mode: 'number' }).notNull(),
    /** EquityVestStatus: scheduled | vested | forfeited */
    status: text('status').notNull().default('scheduled'),
    vestPrice: numeric('vest_price', { precision: 18, scale: 6, mode: 'number' }),
    sharesWithheld: numeric('shares_withheld', { precision: 24, scale: 8, mode: 'number' }),
    taxWithheld: money('tax_withheld'),
    matchedTxnId: uuid('matched_txn_id').references(() => investmentTransactions.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('equity_vests_grant_date_idx').on(t.grantId, t.vestDate), index('equity_vests_date_idx').on(t.vestDate)],
);

// --- Liabilities ------------------------------------------------------------

export const liabilities = pgTable('liabilities', {
  id: id(),
  accountId: uuid('account_id')
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  /** credit | mortgage | student */
  kind: text('kind').notNull(),
  interestRatePct: numeric('interest_rate_pct', { precision: 7, scale: 4, mode: 'number' }),
  minimumPayment: money('minimum_payment'),
  nextPaymentDueDate: date('next_payment_due_date'),
  originationDate: date('origination_date'),
  originationPrincipal: money('origination_principal'),
  maturityDate: date('maturity_date'),
  escrowBalance: money('escrow_balance'),
  /** Full Plaid liability payload for fields not modeled above. */
  details: jsonb('details'),
  ...timestamps,
});

// --- Insurance & documents --------------------------------------------------

export const documents = pgTable('documents', {
  id: id(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  /** Key within the storage backend (local disk now, S3 later). */
  storageKey: text('storage_key').notNull(),
  ...timestamps,
});

export const insurancePolicies = pgTable('insurance_policies', {
  id: id(),
  type: policyType('type').notNull(),
  carrier: text('carrier').notNull(),
  policyNumberMask: text('policy_number_mask'),
  /** The full policy number for the family packet, AES-256-GCM encrypted; see lib/crypto.ts. */
  policyNumberEnc: text('policy_number_enc'),
  insuredName: text('insured_name'),
  coverageAmount: money('coverage_amount'),
  benefitPercentOfIncome: numeric('benefit_percent_of_income', { precision: 5, scale: 2, mode: 'number' }),
  premiumAmount: money('premium_amount'),
  premiumFrequency: premiumFrequency('premium_frequency'),
  effectiveDate: date('effective_date'),
  termEndDate: date('term_end_date'),
  eliminationPeriodDays: integer('elimination_period_days'),
  benefitPeriod: text('benefit_period'),
  ownOccupation: boolean('own_occupation'),
  employerProvided: boolean('employer_provided'),
  cashValue: money('cash_value'),
  cashSurrenderValue: money('cash_surrender_value'),
  loanBalance: money('loan_balance'),
  valuesAsOf: date('values_as_of'),
  beneficiaries: jsonb('beneficiaries').notNull().default([]),
  notes: text('notes'),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  ...timestamps,
});

// --- Manual assets, snapshots, budgets, profile -----------------------------

export const manualAssets = pgTable('manual_assets', {
  id: id(),
  /** home | vehicle | other */
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  value: money('value').notNull(),
  valueAsOf: date('value_as_of'),
  notes: text('notes'),
  address: text('address'),
  /** Your share, 0–100; null means 100. */
  ownershipPercent: numeric('ownership_percent', { precision: 5, scale: 2, mode: 'number' }),
  /** ValuationSource[] from the last automatic estimate. */
  valuationSources: jsonb('valuation_sources').$type<ValuationSource[]>(),
  /** Year, make, model etc. for a vehicle whose value was looked up. */
  vehicle: jsonb('vehicle').$type<VehicleDetails>(),
  /** Yearly loss in value, compounded from `valueAsOf`; null means the value holds. */
  depreciationPercent: numeric('depreciation_percent', { precision: 5, scale: 2, mode: 'number' }),
  ...timestamps,
});

export const balanceSnapshots = pgTable(
  'balance_snapshots',
  {
    id: id(),
    date: date('date').notNull(),
    totalAssets: money('total_assets').notNull(),
    totalLiabilities: money('total_liabilities').notNull(),
    netWorth: money('net_worth').notNull(),
    /** Balance totals per account type on that date (NetWorthSummary['byType']). */
    breakdown: jsonb('breakdown'),
    /** Your share of each account, manual asset and policy cash value on that date, by id. */
    balances: jsonb('balances').$type<Record<string, number>>(),
    ...timestamps,
  },
  (t) => [uniqueIndex('balance_snapshots_date_idx').on(t.date)],
);

export const budgets = pgTable('budgets', {
  id: id(),
  category: text('category').notNull().unique(),
  monthlyTarget: money('monthly_target').notNull(),
  ...timestamps,
});

/** Single-row table holding the user's profile. */
export const userProfile = pgTable('user_profile', {
  id: integer('id').primaryKey().default(1),
  displayName: text('display_name'),
  birthYear: integer('birth_year'),
  filingStatus: text('filing_status'),
  state: text('state'),
  dependents: integer('dependents'),
  /** Child[]: each child's birth year. */
  children: jsonb('children').$type<Child[]>().notNull().default([]),
  annualGrossIncome: money('annual_gross_income'),
  occupation: text('occupation'),
  employerBenefits: text('employer_benefits'),
  goals: text('goals'),
  ...timestamps,
});

/** Tax inputs Meld can't see in synced accounts, one row per tax year. */
export const taxSettings = pgTable('tax_settings', {
  year: integer('year').primaryKey(),
  /** TaxSettings; read over EMPTY_TAX_SETTINGS so fields added later still parse. */
  settings: jsonb('settings').$type<TaxSettings>().notNull(),
  ...timestamps,
});

/** Single-row table holding the cash page's settings. */
export const cashSettings = pgTable('cash_settings', {
  id: integer('id').primaryKey().default(1),
  /** CashSettings; read over EMPTY_CASH_SETTINGS so fields added later still parse. */
  settings: jsonb('settings').$type<CashSettings>().notNull(),
  ...timestamps,
});

/** Named versions of the retirement plan; exactly one is active once any exist. */
export const retirementScenarios = pgTable(
  'retirement_scenarios',
  {
    id: id(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(false),
    /** RetirementPlan; read over EMPTY_RETIREMENT_PLAN so fields added later still parse. */
    plan: jsonb('plan').$type<RetirementPlan>().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('retirement_scenarios_active_idx').on(t.active).where(sql`${t.active}`)],
);

/** Saved Monte Carlo runs: a snapshot of the inputs on the day they ran, and what they found. */
export const retirementSimulations = pgTable('retirement_simulations', {
  id: id(),
  scenarioId: uuid('scenario_id')
    .notNull()
    .references(() => retirementScenarios.id, { onDelete: 'cascade' }),
  settings: jsonb('settings').$type<SimulationSettings>().notNull(),
  inputs: jsonb('inputs').$type<RetirementInputs>().notNull(),
  result: jsonb('result').$type<SimulationResult>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Recurring payments, autopay, alerts ------------------------------------

/** Your corrections to a detected recurring series, by its key; the series themselves are worked out from transactions. */
export const recurringOverrides = pgTable('recurring_overrides', {
  key: text('key').primaryKey(),
  ignored: boolean('ignored').notNull().default(false),
  /** RecurringKind, or null to keep Meld's guess. */
  kind: text('kind'),
  name: text('name'),
  ...timestamps,
});

/** "This card (or loan) is paid automatically from that bank account." */
export const autopayLinks = pgTable('autopay_links', {
  id: id(),
  payeeAccountId: uuid('payee_account_id')
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  fundingAccountId: uuid('funding_account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  /** AutopayAmount */
  amountRule: text('amount_rule').notNull(),
  fixedAmount: money('fixed_amount'),
  ...timestamps,
});

export const alerts = pgTable(
  'alerts',
  {
    id: id(),
    /** AlertType */
    type: text('type').notNull(),
    /** AlertSeverity */
    severity: text('severity').notNull(),
    /** What the alert is about, so the same condition or event never raises two open alerts. */
    key: text('key').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    href: text('href'),
    readAt: timestamp('read_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    /** The condition cleared on its own; a later recurrence opens a new alert. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** When it was last pushed, so an alert isn't pushed again unless it gets worse. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('alerts_open_key_idx').on(t.key).where(sql`${t.resolvedAt} is null`),
    index('alerts_created_idx').on(t.createdAt),
  ],
);

/** Single-row table holding which alerts are on and where they're pushed. */
export const alertSettings = pgTable('alert_settings', {
  id: integer('id').primaryKey().default(1),
  /** AlertSettings; read over DEFAULT_ALERT_SETTINGS so fields added later still parse. */
  settings: jsonb('settings').$type<AlertSettings>().notNull(),
  ...timestamps,
});

// --- Estate -----------------------------------------------------------------

/** A trust, will, power of attorney or directive: who it names and where the original is. */
export const estateDocuments = pgTable('estate_documents', {
  id: id(),
  /** EstateDocumentKind */
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  signedDate: date('signed_date'),
  state: text('state'),
  reviewedAt: date('reviewed_at'),
  originalLocation: text('original_location'),
  people: jsonb('people').$type<EstatePerson[]>().notNull().default([]),
  attorney: jsonb('attorney').$type<Contact>(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  notes: text('notes'),
  ...timestamps,
});

/** How one account or manual asset passes on death. Kept apart from accounts so sync never touches it. */
export const estateDesignations = pgTable('estate_designations', {
  id: id(),
  accountId: uuid('account_id')
    .unique()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  manualAssetId: uuid('manual_asset_id')
    .unique()
    .references(() => manualAssets.id, { onDelete: 'cascade' }),
  /** EstateMethod */
  method: text('method').notNull(),
  beneficiaries: jsonb('beneficiaries').$type<Beneficiary[]>().notNull().default([]),
  trustId: uuid('trust_id').references(() => estateDocuments.id, { onDelete: 'set null' }),
  reviewedAt: date('reviewed_at'),
  notes: text('notes'),
  /** The full account number for the family packet, AES-256-GCM encrypted; see lib/crypto.ts. */
  accountNumberEnc: text('account_number_enc'),
  /** Its last 4, so the app can show one is saved without decrypting it. */
  accountNumberLast4: text('account_number_last4'),
  ...timestamps,
});

/** Single-row table: key contacts, instructions, and when the family packet was last exported. */
export const estateSettings = pgTable('estate_settings', {
  id: integer('id').primaryKey().default(1),
  /** EstateSettings; read over EMPTY_ESTATE_SETTINGS so fields added later still parse. */
  settings: jsonb('settings').$type<EstateSettings>().notNull(),
  lastExportedAt: timestamp('last_exported_at', { withTimezone: true }),
  /** Hash of the packet's contents at that export, to tell when it's out of date. */
  exportFingerprint: text('export_fingerprint'),
  ...timestamps,
});

// --- AI chat ----------------------------------------------------------------

export const chatSessions = pgTable('chat_sessions', {
  id: id(),
  title: text('title'),
  /** Financial snapshot given to the AI, fixed when the session starts so the prompt stays stable. */
  context: text('context'),
  ...timestamps,
});

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: id(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: chatRole('role').notNull(),
    /** Provider-neutral content blocks (text, tool calls, tool results). */
    content: jsonb('content').notNull(),
    ...timestamps,
  },
  (t) => [index('chat_messages_session_idx').on(t.sessionId, t.createdAt)],
);
