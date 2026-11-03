import type { Beneficiary, InsurancePolicy } from '@meld/shared';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { documents, insurancePolicies } from '../db/schema';

const columns = {
  id: insurancePolicies.id,
  type: insurancePolicies.type,
  carrier: insurancePolicies.carrier,
  policyNumberMask: insurancePolicies.policyNumberMask,
  hasPolicyNumber: sql<boolean>`${insurancePolicies.policyNumberEnc} is not null`,
  insuredName: insurancePolicies.insuredName,
  coverageAmount: insurancePolicies.coverageAmount,
  benefitPercentOfIncome: insurancePolicies.benefitPercentOfIncome,
  premiumAmount: insurancePolicies.premiumAmount,
  premiumFrequency: insurancePolicies.premiumFrequency,
  effectiveDate: insurancePolicies.effectiveDate,
  termEndDate: insurancePolicies.termEndDate,
  eliminationPeriodDays: insurancePolicies.eliminationPeriodDays,
  benefitPeriod: insurancePolicies.benefitPeriod,
  ownOccupation: insurancePolicies.ownOccupation,
  employerProvided: insurancePolicies.employerProvided,
  cashValue: insurancePolicies.cashValue,
  cashSurrenderValue: insurancePolicies.cashSurrenderValue,
  loanBalance: insurancePolicies.loanBalance,
  valuesAsOf: insurancePolicies.valuesAsOf,
  beneficiaries: insurancePolicies.beneficiaries,
  notes: insurancePolicies.notes,
  documentId: insurancePolicies.documentId,
  documentFilename: documents.filename,
  createdAt: insurancePolicies.createdAt,
  updatedAt: insurancePolicies.updatedAt,
};

type PolicyRow = Omit<InsurancePolicy, 'beneficiaries' | 'createdAt' | 'updatedAt'> & {
  beneficiaries: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const toPolicy = (r: PolicyRow): InsurancePolicy => ({
  ...r,
  beneficiaries: r.beneficiaries as Beneficiary[],
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export async function listPolicies(db: Db, where?: SQL): Promise<InsurancePolicy[]> {
  const rows = await db
    .select(columns)
    .from(insurancePolicies)
    .leftJoin(documents, eq(documents.id, insurancePolicies.documentId))
    .where(where)
    .orderBy(asc(insurancePolicies.type), asc(insurancePolicies.carrier));
  return rows.map(toPolicy);
}
