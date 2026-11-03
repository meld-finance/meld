import { createHash } from 'node:crypto';
import {
  accountEstateCategory,
  assetEstateCategory,
  EMPTY_ESTATE_SETTINGS,
  EstateSettings,
  isLapsed,
  isLifePolicy,
  isTrust,
  ownedBalance,
  type Beneficiary,
  type Contact,
  type EstateDesignationInput,
  type EstateDocument,
  type EstateDocumentInput,
  type EstateDocumentKind,
  type EstateMethod,
  type EstatePerson,
  type EstateSummary,
  type InsurancePolicyType,
} from '@meld/shared';
import { asc, eq, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { decrypt, encrypt } from '../lib/crypto';
import { accounts, documents, estateDesignations, estateDocuments, estateSettings, manualAssets } from '../db/schema';
import { policyMethod, summarizeEstate, type TargetDraft } from '../lib/estate';
import { HttpError } from '../lib/http';
import { localDate } from '../lib/networth';
import { listAccounts } from './accounts';
import { listPolicies } from './insurance';
import { getProfile } from './profile';

const LIFE_LABELS: Partial<Record<InsurancePolicyType, string>> = {
  life_term: 'Term life',
  life_whole: 'Whole life',
  life_universal: 'Universal life',
};

// --- Documents ------------------------------------------------------------------

const documentColumns = {
  id: estateDocuments.id,
  kind: estateDocuments.kind,
  name: estateDocuments.name,
  signedDate: estateDocuments.signedDate,
  state: estateDocuments.state,
  reviewedAt: estateDocuments.reviewedAt,
  originalLocation: estateDocuments.originalLocation,
  people: estateDocuments.people,
  attorney: estateDocuments.attorney,
  documentId: estateDocuments.documentId,
  documentFilename: documents.filename,
  notes: estateDocuments.notes,
  createdAt: estateDocuments.createdAt,
  updatedAt: estateDocuments.updatedAt,
};

const DOCUMENT_ORDER: EstateDocumentKind[] = [
  'revocable_trust',
  'irrevocable_trust',
  'will',
  'financial_poa',
  'healthcare_directive',
  'guardianship',
  'other',
];

export async function listEstateDocuments(db: Db, where?: SQL): Promise<EstateDocument[]> {
  const rows = await db
    .select(documentColumns)
    .from(estateDocuments)
    .leftJoin(documents, eq(documents.id, estateDocuments.documentId))
    .where(where)
    .orderBy(asc(estateDocuments.name));
  return rows
    .map((r) => ({
      ...r,
      kind: r.kind as EstateDocumentKind,
      people: r.people as EstatePerson[],
      attorney: (r.attorney as Contact | null) ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
    .sort((a, b) => DOCUMENT_ORDER.indexOf(a.kind) - DOCUMENT_ORDER.indexOf(b.kind));
}

export async function getEstateDocument(db: Db, id: string): Promise<EstateDocument> {
  const [doc] = await listEstateDocuments(db, eq(estateDocuments.id, id));
  if (!doc) throw new HttpError(404, 'Document not found');
  return doc;
}

async function checkAttachment(db: Db, documentId: string | null) {
  if (!documentId) return;
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, documentId) });
  if (!doc) throw new HttpError(400, 'Attached document not found');
}

export async function createEstateDocument(db: Db, input: EstateDocumentInput): Promise<EstateDocument> {
  await checkAttachment(db, input.documentId);
  const [row] = await db.insert(estateDocuments).values(input).returning({ id: estateDocuments.id });
  return getEstateDocument(db, row!.id);
}

/** Saves the document and returns the attachment it replaced, if any, for the caller to clean up. */
export async function updateEstateDocument(db: Db, id: string, input: EstateDocumentInput) {
  await checkAttachment(db, input.documentId);
  const before = await getEstateDocument(db, id);
  if (isTrust(before.kind) && !isTrust(input.kind)) {
    // Accounts titled to it no longer point at a trust.
    await db.update(estateDesignations).set({ trustId: null }).where(eq(estateDesignations.trustId, id));
  }
  await db.update(estateDocuments).set(input).where(eq(estateDocuments.id, id));
  return { doc: await getEstateDocument(db, id), replaced: before.documentId !== input.documentId ? before.documentId : null };
}

/** Deletes the document and returns its attachment id, for the caller to clean up. */
export async function deleteEstateDocument(db: Db, id: string): Promise<string | null> {
  const [row] = await db
    .delete(estateDocuments)
    .where(eq(estateDocuments.id, id))
    .returning({ documentId: estateDocuments.documentId });
  if (!row) throw new HttpError(404, 'Document not found');
  return row.documentId;
}

// --- Designations ------------------------------------------------------------------

const last4 = (accountNumber: string) => accountNumber.replace(/[^A-Za-z0-9]/g, '').slice(-4);

export async function saveDesignation(db: Db, input: EstateDesignationInput, encryptionKey: string) {
  if (input.accountId) {
    const account = await db.query.accounts.findFirst({ where: eq(accounts.id, input.accountId) });
    if (!account) throw new HttpError(404, 'Account not found');
  } else {
    const asset = await db.query.manualAssets.findFirst({ where: eq(manualAssets.id, input.manualAssetId!) });
    if (!asset) throw new HttpError(404, 'Asset not found');
  }
  if (input.trustId) {
    const trust = await db.query.estateDocuments.findFirst({ where: eq(estateDocuments.id, input.trustId) });
    if (!trust || !isTrust(trust.kind as EstateDocumentKind)) throw new HttpError(400, 'Pick one of your trusts');
  }
  // Beneficiaries only apply to methods that name people; a trust only to 'trust'.
  const { accountNumber, ...rest } = input;
  const values = {
    ...rest,
    // Left out, the saved number stays as it is.
    ...(accountNumber !== undefined && {
      accountNumberEnc: accountNumber && encrypt(accountNumber, encryptionKey),
      accountNumberLast4: accountNumber && last4(accountNumber),
    }),
    beneficiaries: input.method === 'beneficiary' || input.method === 'tod_pod' ? input.beneficiaries : [],
    trustId: input.method === 'trust' ? input.trustId : null,
  };
  const target = input.accountId ? estateDesignations.accountId : estateDesignations.manualAssetId;
  const { accountId: _a, manualAssetId: _m, ...set } = values;
  await db.insert(estateDesignations).values(values).onConflictDoUpdate({ target, set });
}

/** Full account numbers by account or asset id, decrypted for the packet. */
export async function loadAccountNumbers(db: Db, encryptionKey: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ accountId: estateDesignations.accountId, manualAssetId: estateDesignations.manualAssetId, enc: estateDesignations.accountNumberEnc })
    .from(estateDesignations);
  return new Map(rows.flatMap((r) => (r.enc ? [[(r.accountId ?? r.manualAssetId)!, decrypt(r.enc, encryptionKey)] as const] : [])));
}

// --- Settings & export --------------------------------------------------------------

async function getSettingsRow(db: Db) {
  const row = await db.query.estateSettings.findFirst({ where: eq(estateSettings.id, 1) });
  const parsed = EstateSettings.safeParse({ ...EMPTY_ESTATE_SETTINGS, ...(row?.settings ?? {}) });
  return {
    settings: parsed.success ? parsed.data : EMPTY_ESTATE_SETTINGS,
    lastExportedAt: row?.lastExportedAt?.toISOString() ?? null,
    exportFingerprint: row?.exportFingerprint ?? null,
  };
}

export async function saveEstateSettings(db: Db, settings: EstateSettings): Promise<EstateSettings> {
  await db
    .insert(estateSettings)
    .values({ id: 1, settings })
    .onConflictDoUpdate({ target: estateSettings.id, set: { settings } });
  return (await getSettingsRow(db)).settings;
}

export async function recordPacketExport(db: Db, fingerprint: string) {
  const settings = (await getSettingsRow(db)).settings;
  const values = { lastExportedAt: new Date(), exportFingerprint: fingerprint };
  await db
    .insert(estateSettings)
    .values({ id: 1, settings, ...values })
    .onConflictDoUpdate({ target: estateSettings.id, set: values });
}

// --- Summary --------------------------------------------------------------------

/** Everything the summary and packet are built from. */
async function loadTargets(db: Db, today: string): Promise<TargetDraft[]> {
  const [accountList, created, assets, policies, designations] = await Promise.all([
    listAccounts(db, eq(accounts.hidden, false)),
    db.select({ id: accounts.id, createdAt: accounts.createdAt }).from(accounts),
    db.select().from(manualAssets).orderBy(asc(manualAssets.name)),
    listPolicies(db),
    db.select().from(estateDesignations),
  ]);
  const createdAt = new Map(created.map((r) => [r.id, localDate(r.createdAt)]));
  const byAccount = new Map(designations.filter((d) => d.accountId).map((d) => [d.accountId!, d]));
  const byAsset = new Map(designations.filter((d) => d.manualAssetId).map((d) => [d.manualAssetId!, d]));
  const fromDesignation = (d: (typeof designations)[number] | undefined) => ({
    method: (d?.method as EstateMethod | undefined) ?? 'none',
    beneficiaries: (d?.beneficiaries as Beneficiary[] | undefined) ?? [],
    trustId: d?.trustId ?? null,
    reviewedAt: d?.reviewedAt ?? null,
    notes: d?.notes ?? null,
    accountNumberLast4: d?.accountNumberLast4 ?? null,
    designated: !!d,
  });

  return [
    ...accountList.map(
      (a): TargetDraft => ({
        kind: 'account',
        id: a.id,
        name: a.name,
        detail: [a.institutionName, a.subtype, a.mask && `••${a.mask}`].filter(Boolean).join(' · '),
        category: accountEstateCategory(a.type, a.subtype),
        value: a.currentBalance === null ? null : ownedBalance(a),
        ...fromDesignation(byAccount.get(a.id)),
        href: `/estate/account/${a.id}`,
        createdAt: createdAt.get(a.id),
      }),
    ),
    ...assets.map(
      (m): TargetDraft => ({
        kind: 'asset',
        id: m.id,
        name: m.name,
        detail: [m.address, m.ownershipPercent !== null && `${m.ownershipPercent}% yours`].filter(Boolean).join(' · '),
        category: assetEstateCategory(m.kind),
        value: Math.round(m.value * (m.ownershipPercent ?? 100)) / 100,
        ...fromDesignation(byAsset.get(m.id)),
        href: `/estate/asset/${m.id}`,
      }),
    ),
    ...policies
      .filter((p) => isLifePolicy(p.type) && !isLapsed(p, today))
      .map(
        (p): TargetDraft => ({
          kind: 'policy',
          id: p.id,
          name: `${p.carrier} ${(LIFE_LABELS[p.type] ?? 'life').toLowerCase()}`,
          detail: [p.employerProvided && 'Through work', p.insuredName, p.policyNumberMask && `••${p.policyNumberMask}`]
            .filter(Boolean)
            .join(' · '),
          category: 'life',
          value: p.coverageAmount,
          method: policyMethod(p.beneficiaries),
          beneficiaries: p.beneficiaries,
          trustId: null,
          reviewedAt: null,
          notes: p.notes,
          accountNumberLast4: null,
          designated: true,
          href: `/insurance/${p.id}`,
        }),
      ),
  ];
}

/**
 * A hash of what the packet says, apart from balances (which move daily) and review dates,
 * so a packet counts as out of date only when something your family would act on changed.
 */
export function packetFingerprint(targets: TargetDraft[], docs: EstateDocument[], settings: EstateSettings): string {
  const data = {
    targets: targets.map((t) => [t.kind, t.id, t.name, t.method, t.beneficiaries, t.trustId, t.notes, t.accountNumberLast4]),
    docs: docs.map(({ reviewedAt: _r, createdAt: _c, updatedAt: _u, documentId: _d, documentFilename: _f, ...d }) => d),
    contacts: settings.contacts,
    credentialsNote: settings.credentialsNote,
    instructions: settings.instructions,
  };
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export async function getEstateSummary(db: Db, today = localDate()): Promise<EstateSummary & { fingerprint: string }> {
  const [targets, docs, profile, row] = await Promise.all([
    loadTargets(db, today),
    listEstateDocuments(db),
    getProfile(db),
    getSettingsRow(db),
  ]);
  const fingerprint = packetFingerprint(targets, docs, row.settings);
  const summary = summarizeEstate({
    today,
    targets,
    documents: docs,
    children: profile.children,
    profileState: profile.state,
    settings: row.settings,
    packet: { lastExportedAt: row.lastExportedAt, exportFingerprint: row.exportFingerprint, fingerprint },
  });
  return { ...summary, documents: docs, settings: row.settings, fingerprint };
}
