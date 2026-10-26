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
    pending: boolean('pending').notNull().default(false),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [index('transactions_account_date_idx').on(t.accountId, t.date), index('transactions_date_idx').on(t.date)],
);

// --- Investments ------------------------------------------------------------

export const securities = pgTable('securities', {
  id: id(),
  plaidSecurityId: text('plaid_security_id').unique(),
  tickerSymbol: text('ticker_symbol'),
  name: text('name'),
  type: text('type'),
  closePrice: numeric('close_price', { precision: 18, scale: 6, mode: 'number' }),
  closePriceAsOf: date('close_price_as_of'),
  ...timestamps,
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
});

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
    /** Per-account balances on that date. */
    breakdown: jsonb('breakdown'),
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
  annualGrossIncome: money('annual_gross_income'),
  occupation: text('occupation'),
  employerBenefits: text('employer_benefits'),
  goals: text('goals'),
  ...timestamps,
});

// --- AI chat ----------------------------------------------------------------

export const chatSessions = pgTable('chat_sessions', {
  id: id(),
  title: text('title'),
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
