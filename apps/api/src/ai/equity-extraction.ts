import {
  EquityGrantInput,
  EquityVestStatus,
  maskPolicyNumber,
  WithholdingMethod,
  type EquityVestInput,
} from '@meld/shared';
import { z } from 'zod';
import type { ExtractedEquityGrant } from './provider';

/**
 * Structured output schema for RSU grant PDFs and pasted broker vesting schedules.
 * Text and date fields use '' when missing to stay well under Anthropic's MAX_UNION_FIELDS limit.
 */
export const EquityExtractionSchema = z.object({
  employer: z.string(),
  name: z.string(),
  ticker: z.string(),
  grantDate: z.string(),
  grantNumberLast4: z.string(),
  totalShares: z.number().nullable(),
  manualPrice: z.number().nullable(),
  withholdingMethod: WithholdingMethod,
  vests: z.array(
    z.object({
      vestDate: z.string(),
      shares: z.number(),
      status: EquityVestStatus,
      vestPrice: z.number().nullable(),
    }),
  ),
  notes: z.string(),
  warnings: z.array(z.string()),
});

export const MAX_EQUITY_UNION_FIELDS = 16;
export type RawEquityExtraction = z.infer<typeof EquityExtractionSchema>;

export const EQUITY_EXTRACTION_PROMPT = `Extract RSU (Restricted Stock Unit) grant details and vesting tranches from this document or vesting table.

- employer: Company name granting the RSUs.
- name: Grant name or label (e.g., "2025 New Hire RSU", "Q1 2026 Refresher", or the plan/grant title).
- ticker: Stock ticker symbol in uppercase (e.g., "GOOG", "META"). Use "" for private companies.
- grantDate: Grant date as YYYY-MM-DD. If only vest dates exist, leave "" and note in warnings.
- grantNumberLast4: ONLY the last 4 alphanumeric characters of the grant ID/number, never the full number.
- totalShares: Total granted shares (positive number).
- manualPrice: Share price or 409A value ONLY if the company is private or a fixed valuation price is explicitly listed; otherwise null.
- withholdingMethod: "sell_to_cover", "net_share", or "cash" (default "sell_to_cover" if unclear).
- vests: Every individual vesting tranche with:
  - vestDate: YYYY-MM-DD
  - shares: positive share count for that tranche
  - status: "vested" if already vested/released/settled, "forfeited" if cancelled/forfeited, otherwise "scheduled"
  - vestPrice: fair market value per share on the vest date if stated (usually only for already-vested tranches); otherwise null
- notes: Short note for anything important (cliff rules, performance conditions, blackout/trading window notes).
- warnings: Short warning for every field inferred, approximated, rounded, or missing that would normally be expected.

Do not invent vest dates or share counts not supported by the source. Use "" for missing strings/dates and null for missing numbers.`;

const isoDate = z.iso.date();

export function normalizeEquityExtraction(raw: RawEquityExtraction, today = new Date().toISOString().slice(0, 10)): ExtractedEquityGrant {
  const warnings = [...raw.warnings];

  const employer = raw.employer.trim();
  if (!employer) warnings.push('Couldn’t find the employer name.');

  const name = raw.name.trim() || 'RSU Grant';
  if (!raw.name.trim()) warnings.push('No grant label was found; defaulted to “RSU Grant”.');

  const tickerRaw = raw.ticker.trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, '');
  const ticker = tickerRaw && tickerRaw.length <= 12 ? tickerRaw : null;
  if (raw.ticker.trim() && !ticker) warnings.push(`Ignored an unreadable ticker (${raw.ticker.trim()}).`);

  const grantDateParsed = raw.grantDate.trim() ? isoDate.safeParse(raw.grantDate.trim()) : null;
  let grantDate = today;
  if (grantDateParsed?.success) {
    grantDate = grantDateParsed.data;
  } else {
    warnings.push(raw.grantDate.trim() ? `Ignored an unreadable grant date (${raw.grantDate.trim()}); defaulted to today.` : 'Grant date wasn’t listed; defaulted to today.');
  }

  const vests: EquityVestInput[] = [];
  let droppedVests = 0;
  for (const v of raw.vests) {
    const d = isoDate.safeParse(v.vestDate.trim());
    if (!d.success || !Number.isFinite(v.shares) || v.shares <= 0) {
      droppedVests++;
      continue;
    }
    const vestPrice = v.vestPrice !== null && Number.isFinite(v.vestPrice) && v.vestPrice > 0 ? v.vestPrice : null;
    vests.push({
      vestDate: d.data,
      shares: v.shares,
      status: v.status,
      vestPrice,
      sharesWithheld: null,
      taxWithheld: null,
    });
  }
  if (droppedVests > 0) warnings.push(`Skipped ${droppedVests} vest row${droppedVests === 1 ? '' : 's'} that couldn’t be read.`);
  vests.sort((a, b) => a.vestDate.localeCompare(b.vestDate));

  if (!vests.length) {
    warnings.push('No vesting tranches could be read; added a placeholder tranche to edit.');
    vests.push({
      vestDate: grantDate,
      shares: raw.totalShares && raw.totalShares > 0 ? raw.totalShares : 100,
      status: 'scheduled',
      vestPrice: null,
      sharesWithheld: null,
      taxWithheld: null,
    });
  }

  const vestSum = Math.round(vests.reduce((s, v) => s + v.shares, 0) * 10_000) / 10_000;
  let totalShares = vestSum;
  if (raw.totalShares !== null && Number.isFinite(raw.totalShares) && raw.totalShares > 0) {
    totalShares = raw.totalShares;
  } else {
    warnings.push('Total shares wasn’t listed; summed from the vesting tranches.');
  }

  const manualPrice = raw.manualPrice !== null && Number.isFinite(raw.manualPrice) && raw.manualPrice > 0 ? raw.manualPrice : null;
  const grantNumberMask = maskPolicyNumber(raw.grantNumberLast4);

  const hasScheduled = vests.some((v) => v.status === 'scheduled');
  const draft: EquityGrantInput = {
    kind: 'rsu',
    employer: employer || 'Employer',
    name,
    ticker,
    manualPrice,
    priceAsOf: manualPrice ? today : null,
    grantDate,
    grantNumberMask,
    totalShares,
    linkedAccountId: null,
    withholdingMethod: raw.withholdingMethod,
    federalWithholdingRate: null,
    stateWithholdingRate: null,
    status: hasScheduled ? 'active' : 'completed',
    documentId: null,
    notes: raw.notes.trim() || null,
    vests,
  };

  return { draft, warnings };
}
