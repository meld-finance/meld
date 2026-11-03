import { z } from 'zod';
import { Beneficiary } from './insurance';
import { isEducationAccount } from './retirement';

// --- How an account or asset passes on death ---------------------------------

/**
 * 'beneficiary': a beneficiary designation (retirement accounts, HSAs, annuities; a 529's successor owner);
 * 'tod_pod': transfer or payable on death; 'joint_survivorship': joint with right of survivorship;
 * 'trust': titled to a trust, or the trust is the beneficiary; 'will': passes under the will (probate);
 * 'none': nothing set up yet.
 */
export const EstateMethod = z.enum(['beneficiary', 'tod_pod', 'joint_survivorship', 'trust', 'will', 'none']);
export type EstateMethod = z.infer<typeof EstateMethod>;

export const ESTATE_METHOD_LABELS: Record<EstateMethod, string> = {
  beneficiary: 'Beneficiary designation',
  tod_pod: 'Transfer / payable on death',
  joint_survivorship: 'Joint with survivorship',
  trust: 'Trust',
  will: 'By will',
  none: 'Not set up',
};

/** Methods that name people, so the beneficiary list applies. */
export const methodNamesPeople = (m: EstateMethod) => m === 'beneficiary' || m === 'tod_pod';

export const EstateDesignationInput = z
  .object({
    accountId: z.uuid().nullable(),
    manualAssetId: z.uuid().nullable(),
    method: EstateMethod,
    /** Primary and contingent (`primary: false`) beneficiaries, for 'beneficiary' and 'tod_pod'. */
    beneficiaries: z.array(Beneficiary).max(20),
    /** The trust it's titled to or names as beneficiary, for 'trust'. */
    trustId: z.uuid().nullable(),
    /** When you last checked this against the institution's records. */
    reviewedAt: z.iso.date().nullable(),
    /** E.g. the institution's estate services phone number. */
    notes: z.string().trim().max(2000).nullable(),
    /**
     * The full account number, printed in the family packet and otherwise never sent back.
     * Omit to keep the saved one; null removes it.
     */
    accountNumber: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9 -]{2,38}[A-Za-z0-9]$/, 'Use 4 to 40 letters, digits, spaces or dashes')
      .nullable()
      .optional(),
  })
  .refine((d) => (d.accountId === null) !== (d.manualAssetId === null), { message: 'Pick one account or asset' });
export type EstateDesignationInput = z.infer<typeof EstateDesignationInput>;

/** Marks several accounts and assets as passing by will in one go, e.g. everything still flagged for probate. */
export const LeaveToWillInput = z.object({
  accountIds: z.array(z.uuid()).max(500),
  manualAssetIds: z.array(z.uuid()).max(500),
});
export type LeaveToWillInput = z.infer<typeof LeaveToWillInput>;

/** What a target is, for which checks apply. */
export const EstateCategory = z.enum([
  'retirement',
  'hsa',
  'education',
  'custodial',
  'taxable',
  'bank',
  'property',
  'vehicle',
  'life',
  'debt',
  'other',
]);
export type EstateCategory = z.infer<typeof EstateCategory>;

export const ESTATE_CATEGORY_LABELS: Record<EstateCategory, string> = {
  retirement: 'Retirement accounts',
  hsa: 'Health savings',
  education: 'Education savings',
  custodial: 'Custodial accounts',
  taxable: 'Brokerage accounts',
  bank: 'Bank accounts',
  property: 'Property',
  vehicle: 'Vehicles',
  life: 'Life insurance',
  debt: 'Debts',
  other: 'Other',
};

const RETIREMENT = new Set([
  '401a', '401k', '403b', '457b', 'ira', 'roth', 'roth 401k', 'keogh', 'pension', 'profit sharing plan', 'retirement',
  'sarsep', 'sep ira', 'simple ira', 'thrift savings plan', 'fixed annuity', 'variable annuity', 'other annuity',
]);
const CUSTODIAL = new Set(['ugma', 'utma']);

export function accountEstateCategory(type: string, subtype: string | null): EstateCategory {
  const s = subtype?.toLowerCase() ?? '';
  if (type === 'credit' || type === 'loan' || type === 'mortgage') return 'debt';
  if (type === 'depository') return s === 'hsa' ? 'hsa' : 'bank';
  if (type !== 'investment') return 'other';
  if (s === 'hsa') return 'hsa';
  if (RETIREMENT.has(s)) return 'retirement';
  if (CUSTODIAL.has(s)) return 'custodial';
  if (isEducationAccount(s)) return 'education';
  return 'taxable';
}

export function assetEstateCategory(kind: string): EstateCategory {
  return kind === 'home' ? 'property' : kind === 'vehicle' ? 'vehicle' : 'other';
}

/**
 * 'ok': it passes the way you set up; 'missing': it needs a beneficiary and has none;
 * 'review': it would go through probate or something looks off; 'n/a': nothing to set up (debts, custodial accounts).
 */
export const EstateStatus = z.enum(['ok', 'missing', 'review', 'n/a']);
export type EstateStatus = z.infer<typeof EstateStatus>;

/** An account, manual asset or life policy, and how it passes. */
export const EstateTarget = z.object({
  kind: z.enum(['account', 'asset', 'policy']),
  id: z.uuid(),
  name: z.string(),
  /** Institution, type and last 4, for telling accounts apart. */
  detail: z.string(),
  category: EstateCategory,
  /** Your share of the balance or value; a policy's death benefit. */
  value: z.number().nullable(),
  method: EstateMethod,
  beneficiaries: z.array(Beneficiary),
  trustId: z.uuid().nullable(),
  trustName: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  notes: z.string().nullable(),
  /** Last 4 of the full account or policy number saved for the packet, if any. */
  accountNumberLast4: z.string().nullable(),
  /** A linked checking or savings account, whose full number can be fetched from the bank. */
  numberFromBank: z.boolean(),
  /** What to do about it, in a sentence, or a note on something to check when it's set up; null when there's nothing. */
  todo: z.string().nullable(),
  /** Whether a designation has been saved; policies always count as set up from their own form. */
  designated: z.boolean(),
  status: EstateStatus,
  /** Where to fix it in the app. */
  href: z.string(),
});
export type EstateTarget = z.infer<typeof EstateTarget>;

// --- Estate documents ---------------------------------------------------------

export const EstateDocumentKind = z.enum([
  'revocable_trust',
  'irrevocable_trust',
  'will',
  'financial_poa',
  'healthcare_directive',
  'guardianship',
  'other',
]);
export type EstateDocumentKind = z.infer<typeof EstateDocumentKind>;

export const ESTATE_DOCUMENT_LABELS: Record<EstateDocumentKind, string> = {
  revocable_trust: 'Revocable living trust',
  irrevocable_trust: 'Irrevocable trust',
  will: 'Will',
  financial_poa: 'Financial power of attorney',
  healthcare_directive: 'Healthcare directive',
  guardianship: 'Guardianship nomination',
  other: 'Other',
};

export const isTrust = (k: EstateDocumentKind) => k === 'revocable_trust' || k === 'irrevocable_trust';

export const EstateRole = z.enum([
  'trustee',
  'successor_trustee',
  'executor',
  'agent',
  'alternate_agent',
  'guardian',
  'alternate_guardian',
  'other',
]);
export type EstateRole = z.infer<typeof EstateRole>;

export const ESTATE_ROLE_LABELS: Record<EstateRole, string> = {
  trustee: 'Trustee',
  successor_trustee: 'Successor trustee',
  executor: 'Executor',
  agent: 'Agent',
  alternate_agent: 'Alternate agent',
  guardian: 'Guardian',
  alternate_guardian: 'Alternate guardian',
  other: 'Other',
};

/** The roles each kind of document names, in the order they're usually listed. */
export const DOCUMENT_ROLES: Record<EstateDocumentKind, EstateRole[]> = {
  revocable_trust: ['trustee', 'successor_trustee'],
  irrevocable_trust: ['trustee', 'successor_trustee'],
  will: ['executor'],
  financial_poa: ['agent', 'alternate_agent'],
  healthcare_directive: ['agent', 'alternate_agent'],
  guardianship: ['guardian', 'alternate_guardian'],
  other: ['other'],
};

const text = (max: number) => z.string().trim().max(max).nullable();

export const Contact = z.object({
  name: z.string().trim().min(1).max(100),
  relationship: text(100),
  phone: text(40),
  email: text(200),
});
export type Contact = z.infer<typeof Contact>;

export const EstatePerson = Contact.extend({ role: EstateRole });
export type EstatePerson = z.infer<typeof EstatePerson>;

export const EstateDocumentInput = z.object({
  kind: EstateDocumentKind,
  name: z.string().trim().min(1).max(200),
  signedDate: z.iso.date().nullable(),
  /** Two-letter state whose law it was drafted under. */
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a two-letter state code')
    .nullable(),
  /** When you last read it through and confirmed it still says what you want. */
  reviewedAt: z.iso.date().nullable(),
  /** Where the signed original is kept, e.g. "Fireproof safe, hall closet" or "With the attorney". */
  originalLocation: text(500),
  people: z.array(EstatePerson).max(20),
  attorney: Contact.nullable(),
  /** A scanned copy, encrypted like policy PDFs. */
  documentId: z.uuid().nullable(),
  notes: text(4000),
});
export type EstateDocumentInput = z.infer<typeof EstateDocumentInput>;

export const EstateDocument = EstateDocumentInput.extend({
  id: z.uuid(),
  documentFilename: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EstateDocument = z.infer<typeof EstateDocument>;

// --- Contacts, instructions, packet ----------------------------------------------------

export const KeyContactRole = z.enum(['executor', 'attorney', 'cpa', 'advisor', 'employer_hr', 'insurance_agent', 'other']);
export type KeyContactRole = z.infer<typeof KeyContactRole>;

export const KEY_CONTACT_LABELS: Record<KeyContactRole, string> = {
  executor: 'Executor / successor trustee',
  attorney: 'Estate attorney',
  cpa: 'Accountant (CPA)',
  advisor: 'Financial advisor',
  employer_hr: 'Employer HR / benefits',
  insurance_agent: 'Insurance agent',
  other: 'Other',
};

export const KeyContact = Contact.extend({ role: KeyContactRole });
export type KeyContact = z.infer<typeof KeyContact>;

export const EstateSettings = z.object({
  contacts: z.array(KeyContact).max(30),
  /** Where to find logins, never the logins themselves: "1Password family vault; emergency kit in the safe". */
  credentialsNote: text(2000),
  /** A letter to whoever handles things: wishes, where things are, what to do first. */
  instructions: text(10000),
  /** Documents and beneficiaries are due for a look after this many years. */
  reviewIntervalYears: z.number().int().min(1).max(10),
});
export type EstateSettings = z.infer<typeof EstateSettings>;

export const EMPTY_ESTATE_SETTINGS: EstateSettings = {
  contacts: [],
  credentialsNote: null,
  instructions: null,
  reviewIntervalYears: 3,
};

/** Fetching an account's full number from the bank through Plaid. */
export type BankNumberResult =
  | { status: 'ok'; accountNumber: string }
  /** The bank connection hasn't allowed account numbers yet; reconnect it in update mode with consentAuth. */
  | { status: 'consent_required'; itemId: string }
  | { status: 'unavailable'; message: string };

export const PacketRequest = z.object({
  /** Encrypts the PDF (AES-256) so it opens only with this password. */
  password: z.string().min(6).max(200).nullable(),
});
export type PacketRequest = z.infer<typeof PacketRequest>;

// --- Readiness -------------------------------------------------------------------

export const EstateIssue = z.object({
  /** Stable across checks, for keys and alerts. */
  id: z.string(),
  severity: z.enum(['info', 'warning']),
  title: z.string(),
  body: z.string(),
  href: z.string().nullable(),
  /** The target or document it's about, so the app can show it on that row; null for plan-wide issues. */
  subject: z.string().nullable(),
});
export type EstateIssue = z.infer<typeof EstateIssue>;

export const EstateSummary = z.object({
  asOf: z.string(),
  targets: z.array(EstateTarget),
  documents: z.array(EstateDocument),
  settings: EstateSettings,
  issues: z.array(EstateIssue),
  /** Steps done out of everything that applies: each account, asset and policy, each core document, contacts and the packet. */
  readiness: z.object({
    done: z.number().int(),
    total: z.number().int(),
    targets: z.object({ done: z.number().int(), total: z.number().int() }),
    documents: z.object({ done: z.number().int(), total: z.number().int() }),
    /** At least one person to call is entered. */
    contacts: z.boolean(),
  }),
  packet: z.object({
    lastExportedAt: z.string().nullable(),
    /** Something in the packet changed since it was exported, or it's over a year old. */
    stale: z.boolean(),
  }),
});
export type EstateSummary = z.infer<typeof EstateSummary>;
