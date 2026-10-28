import { UserProfile } from '@meld/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { userProfile } from '../db/schema';

const EMPTY: UserProfile = {
  displayName: null,
  birthYear: null,
  filingStatus: null,
  state: null,
  dependents: null,
  children: [],
  annualGrossIncome: null,
  occupation: null,
  employerBenefits: null,
  goals: null,
};

export async function getProfile(db: Db): Promise<UserProfile> {
  const row = await db.query.userProfile.findFirst({ where: eq(userProfile.id, 1) });
  if (!row) return EMPTY;
  // Pick known fields only (drops id/timestamps); the DB stores filing status as text.
  return UserProfile.parse(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, row[k as keyof typeof row]])));
}

export async function saveProfile(db: Db, profile: UserProfile): Promise<UserProfile> {
  await db.insert(userProfile).values({ id: 1, ...profile }).onConflictDoUpdate({ target: userProfile.id, set: profile });
  return getProfile(db);
}
