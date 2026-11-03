import {
  AUTOPAY_AMOUNT_LABELS,
  CADENCE_LABELS,
  ESTATE_CATEGORY_LABELS,
  ESTATE_DOCUMENT_LABELS,
  ESTATE_METHOD_LABELS,
  ESTATE_ROLE_LABELS,
  KEY_CONTACT_LABELS,
  type AutopayStatus,
  type Beneficiary,
  type Contact,
  type EstateCategory,
  type EstateSummary,
  type EstateTarget,
  type RecurringSeries,
} from '@meld/shared';
import PDFDocument from 'pdfkit';

export type PacketData = {
  preparedFor: string | null;
  summary: EstateSummary;
  /** Active subscriptions and bills. */
  bills: RecurringSeries[];
  autopay: AutopayStatus[];
};

const MARGIN = 54;
const INK = '#111111';
const MUTED = '#555555';
const RULE = '#cccccc';

const dollars = (n: number | null) => (n === null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const longDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const contactLine = (c: Contact) => [c.relationship, c.phone, c.email].filter(Boolean).join(' · ');
const beneficiaryLine = (b: Beneficiary) =>
  `${b.primary ? 'Primary' : 'Contingent'}: ${b.name}${b.relationship ? ` (${b.relationship})` : ''}, ${b.percentage}%`;

const FIRST_STEPS = [
  'Order 10 or more certified copies of the death certificate from the funeral home. Most institutions want their own.',
  'Contact the executor or successor trustee and the estate attorney, listed under “Who to call”.',
  'Find the signed originals of the will and trust (where they are kept is listed under Estate documents).',
  'Notify Social Security (1-800-772-1213). The funeral home often does this; benefits paid for the month of death are returned.',
  'Call each life insurer and employer HR to claim benefits. They will ask for the policy number and a death certificate.',
  'Call each bank and brokerage’s estate services team. Accounts with a beneficiary or TOD/POD pass directly to them.',
  'Keep paying the bills below that protect property (mortgage, insurance, utilities) and cancel subscriptions.',
  'Do not close joint accounts or cancel cards until autopay and income deposits have moved.',
];

/** Renders the family packet. With a password, the PDF is encrypted (AES-256) and can't be opened without it. */
export function renderPacket(data: PacketData, password: string | null): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: MARGIN,
    bufferPages: true,
    info: { Title: 'Family packet', Creator: 'Meld', ...(data.preparedFor ? { Author: data.preparedFor } : {}) },
    ...(password ? { userPassword: password, ownerPassword: password, pdfVersion: '1.7ext3' as const, permissions: { printing: 'highResolution' as const } } : {}),
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const { summary } = data;
  const width = doc.page.width - MARGIN * 2;

  const heading = (title: string) => {
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(15).fillColor(INK).text(title);
    const y = doc.y + 2;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + width, y).strokeColor(RULE).lineWidth(0.75).stroke();
    doc.moveDown(0.5);
  };
  const subheading = (title: string) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.4).font('Helvetica-Bold').fontSize(11.5).fillColor(INK).text(title);
  };
  const para = (text: string, opts: { muted?: boolean; size?: number } = {}) =>
    doc
      .font('Helvetica')
      .fontSize(opts.size ?? 10)
      .fillColor(opts.muted ? MUTED : INK)
      .text(text, { width, lineGap: 1.5 });
  const line = (label: string, value: string | null | undefined) => {
    if (!value) return;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`${label}: `, { continued: true, width });
    doc.font('Helvetica').text(value, { width });
  };
  const bullet = (text: string) => para(`•  ${text}`);
  /** One block per entry, kept together on a page where it fits. */
  const block = (lines: number, render: () => void) => {
    if (doc.y + lines * 14 > doc.page.height - MARGIN) doc.addPage();
    render();
    doc.moveDown(0.5);
  };

  // --- Cover
  doc.font('Helvetica-Bold').fontSize(24).fillColor(INK).text('Family packet');
  doc.moveDown(0.2);
  para(`${data.preparedFor ? `Prepared by ${data.preparedFor}` : 'Prepared'} on ${longDate(summary.asOf)}.`, { muted: true, size: 11 });
  doc.moveDown(0.6);
  para(
    'This packet lists the accounts, insurance, property and legal documents you will need to settle my affairs, ' +
      'who to call, and how each account passes. It holds no passwords. Balances are approximate as of the date above. ' +
      'Start with “First steps”, then work through each section with the executor or successor trustee.',
  );
  const originals = summary.documents.filter((d) => d.originalLocation);
  if (originals.length) {
    doc.moveDown(0.4);
    subheading('Where the originals are');
    for (const d of originals) bullet(`${d.name}: ${d.originalLocation}`);
  }

  // --- Instructions & contacts
  const { settings } = summary;
  if (settings.instructions) {
    heading('A note from me');
    para(settings.instructions);
  }
  heading('Who to call');
  if (settings.contacts.length === 0) para('No contacts entered.', { muted: true });
  for (const c of settings.contacts) {
    block(2, () => {
      line(KEY_CONTACT_LABELS[c.role], c.name);
      const rest = contactLine(c);
      if (rest) para(rest, { muted: true });
    });
  }
  if (settings.credentialsNote) {
    subheading('Logins and passwords');
    para(settings.credentialsNote);
  }

  heading('First steps');
  FIRST_STEPS.forEach((s, i) => para(`${i + 1}.  ${s}`));

  // --- Documents
  heading('Estate documents');
  if (summary.documents.length === 0) para('None recorded.', { muted: true });
  for (const d of summary.documents) {
    block(4 + d.people.length, () => {
      subheading(d.name);
      para(
        [ESTATE_DOCUMENT_LABELS[d.kind], d.signedDate && `signed ${longDate(d.signedDate)}`, d.state && `${d.state} law`]
          .filter(Boolean)
          .join(' · '),
        { muted: true },
      );
      line('Original kept', d.originalLocation);
      for (const p of d.people) line(ESTATE_ROLE_LABELS[p.role], [p.name, contactLine(p)].filter(Boolean).join(' · '));
      if (d.attorney) line('Attorney', [d.attorney.name, contactLine(d.attorney)].filter(Boolean).join(' · '));
      if (d.kind === 'revocable_trust' || d.kind === 'irrevocable_trust') {
        const funded = summary.targets.filter((t) => t.trustId === d.id).map((t) => t.name);
        if (funded.length) line('Held in or payable to this trust', funded.join(', '));
      }
      if (d.notes) para(d.notes, { muted: true });
    });
  }

  // --- Accounts, property, insurance, debts
  const groups = new Map<EstateCategory, EstateTarget[]>();
  for (const t of summary.targets) groups.set(t.category, [...(groups.get(t.category) ?? []), t]);
  const assetCategories = [...groups.keys()].filter((c) => c !== 'debt');
  heading('Accounts, insurance and property');
  para('How each one passes: a named beneficiary or TOD/POD goes straight to that person; a trust follows the trust; anything else goes through the will and probate.', { muted: true });
  for (const category of assetCategories) {
    subheading(ESTATE_CATEGORY_LABELS[category]);
    for (const t of groups.get(category)!) {
      block(3 + t.beneficiaries.length, () => {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(t.name, { continued: true, width });
        doc.font('Helvetica').text(`   ${category === 'life' ? `${dollars(t.value)} death benefit` : dollars(t.value)}`, { width });
        if (t.detail) para(t.detail, { muted: true });
        const how = t.method === 'trust' && t.trustName ? `Trust (${t.trustName})` : ESTATE_METHOD_LABELS[t.method];
        line('Passes by', how);
        for (const b of t.beneficiaries) para(`    ${beneficiaryLine(b)}`);
        if (t.notes) para(t.notes, { muted: true });
      });
    }
  }

  const debts = groups.get('debt') ?? [];
  if (debts.length) {
    heading('Debts');
    para('Debts are paid from the estate before anything is distributed. Heirs usually aren’t personally liable unless they co-signed.', { muted: true });
    for (const t of debts) {
      block(2, () => {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(t.name, { continued: true, width });
        doc.font('Helvetica').text(`   ${dollars(t.value)} owed`, { width });
        if (t.detail) para(t.detail, { muted: true });
      });
    }
  }

  // --- Bills
  if (data.autopay.length || data.bills.length) {
    heading('Bills and subscriptions');
    if (data.autopay.length) {
      subheading('Paid automatically');
      for (const a of data.autopay) bullet(`${a.payeeName}: ${AUTOPAY_AMOUNT_LABELS[a.amountRule].toLowerCase()}, from ${a.fundingName}`);
    }
    const byKind = [
      ['Bills to keep paying', data.bills.filter((s) => s.kind === 'bill')],
      ['Subscriptions to cancel or transfer', data.bills.filter((s) => s.kind === 'subscription')],
    ] as const;
    for (const [title, series] of byKind) {
      if (!series.length) continue;
      subheading(title);
      for (const s of series) {
        bullet(`${s.name}: about $${s.amount.toFixed(2)} ${CADENCE_LABELS[s.cadence].toLowerCase()}, charged to ${s.accountName}`);
      }
    }
  }

  // Footer on every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would otherwise start a new page.
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `Family packet · ${longDate(summary.asOf)} · page ${i + 1} of ${range.count} · Confidential`,
        MARGIN,
        doc.page.height - MARGIN + 18,
        { width, align: 'center', lineBreak: false },
      );
  }
  doc.end();
  return done;
}
