import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/** Builds an onConflictDoUpdate `set` that takes each listed column from the incoming row. */
export function excluded<T extends PgTable>(table: T, keys: (keyof T['$inferInsert'] & string)[]) {
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  return Object.fromEntries(
    keys.map((key) => [key, sql.raw(`excluded."${columns[key]!.name}"`)]),
  ) as Partial<Record<keyof T['$inferInsert'], SQL>>;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
