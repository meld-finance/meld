import { TaxSettings } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/http';
import { localDate } from '../lib/networth';
import type { AppDeps } from '../server';
import { getTaxPlan, getTaxSettings, saveTaxSettings } from '../services/tax';

/** The tax year; this year when left out. */
const YearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
const yearOf = (query: unknown) => parse(YearQuery, query).year ?? Number(localDate().slice(0, 4));

export async function registerTaxRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/tax', (req) => getTaxPlan(db, yearOf(req.query)));
  app.get('/tax/settings', (req) => getTaxSettings(db, yearOf(req.query)));
  app.put('/tax/settings', (req) => saveTaxSettings(db, yearOf(req.query), parse(TaxSettings, req.body)));
}
