#!/usr/bin/env node
// Generates the static web documentation portal under site/docs/ from the repository's
// canonical Markdown files (docs/*.md, PRIVACY.md, SECURITY.md, CONTRIBUTING.md).
//
// Usage:
//   node scripts/build-docs.mjs          # generate site/docs/
//   node scripts/build-docs.mjs --check  # verify site/docs/ is up to date & links are valid
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = join(root, 'site');
const docsOutDir = join(siteDir, 'docs');
export const API_DOCS_OUT_REL = 'apps/api/src/ai/meld-docs.generated.ts';
const apiDocsOutFile = join(root, API_DOCS_OUT_REL);

const REPO_URL = 'https://github.com/meld-finance/meld';
const SITE_HOME_REL = '../';
const DOCS_SUBTITLE = 'Guides for installing, connecting banks, securing your setup, and developing Meld.';

export const DOC_GROUPS = [
  {
    id: 'using-meld',
    inAppHelp: true,
    title: 'Using Meld',
    description: 'Everything you need to connect accounts, understand each screen, and reach Meld from your phone or server.',
    docs: [
      {
        slug: 'install',
        sourcePath: 'docs/install.md',
        title: 'Install',
        description: 'Install the Mac or Windows app, get through first-run setup, and keep Meld running around the clock.',
        icon: 'download',
      },
      {
        slug: 'features',
        sourcePath: 'docs/features.md',
        title: 'Features & Guide',
        description: 'How accounts, spending, autopay, cash, investments, retirement, tax, insurance, estate, and Ask Meld work.',
        icon: 'compass',
      },
      {
        slug: 'plaid',
        sourcePath: 'docs/plaid.md',
        title: 'Plaid Bank Setup',
        description: 'Set up your own free Plaid developer keys, try Sandbox test data, and switch to live bank connections.',
        icon: 'link',
      },
      {
        slug: 'phone-access',
        sourcePath: 'docs/phone-access.md',
        title: 'Phone Access (Tailscale)',
        description: 'Reach Meld securely from your phone over your own Tailscale tailnet without exposing it to the internet.',
        icon: 'phone',
      },
      {
        slug: 'docker',
        sourcePath: 'docs/docker.md',
        title: 'Self-Hosting with Docker',
        description: 'Run Meld on Linux, a NAS, or a headless server that starts without anyone logging in.',
        icon: 'server',
      },
    ],
  },
  {
    id: 'privacy-security',
    inAppHelp: true,
    title: 'Privacy & Security',
    description: 'Exactly what data stays on disk, what leaves your machine, and how Meld protects your household data.',
    docs: [
      {
        slug: 'privacy',
        sourcePath: 'PRIVACY.md',
        title: 'Privacy',
        description: 'Every outside service Meld talks to, what is sent, how digit masking works, and what is encrypted on disk.',
        icon: 'eye',
      },
      {
        slug: 'security',
        sourcePath: 'SECURITY.md',
        title: 'Security',
        description: 'Threat model, localhost-only design, AES-256-GCM encryption at rest, and how to report vulnerabilities.',
        icon: 'shield',
      },
    ],
  },
  {
    id: 'developers',
    inAppHelp: false,
    title: 'Developers',
    description: 'Build from source, run desktop and mobile workspaces, ship releases, and contribute pull requests.',
    docs: [
      {
        slug: 'development',
        sourcePath: 'docs/development.md',
        title: 'Development',
        description: 'Monorepo layout, local setup, desktop Electron builds, common commands, and the release workflow.',
        icon: 'code',
      },
      {
        slug: 'contributing',
        sourcePath: 'CONTRIBUTING.md',
        title: 'Contributing',
        description: 'Guidelines for issues, pull requests, schema migrations, documentation checks, and licensing.',
        icon: 'git-pr',
      },
    ],
  },
];

export const ALL_DOCS = DOC_GROUPS.flatMap((group) =>
  group.docs.map((doc) => ({ ...doc, groupId: group.id, groupTitle: group.title, inAppHelp: group.inAppHelp })),
);

const DOC_BY_SOURCE = new Map(ALL_DOCS.map((doc) => [doc.sourcePath, doc]));

const ICONS = {
  download:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  compass:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
  link:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M12 18h.01"/></svg>',
  server:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  eye:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  shield:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
  code:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  'git-pr':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>',
};

const THEME_PREINIT = `<script>try{const t=localStorage.getItem('meld.site.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch{}</script>`;

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripInlineMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/(^|[^\w])_([^_]+)_([^\w]|$)/g, '$1$2$3');
}

function slugifyHeading(text, used) {
  const plain = stripInlineMarkdown(text).trim().toLowerCase();
  const base = plain
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/ /g, '-') || 'section';
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function rewriteHref(rawHref, sourcePath) {
  const trimmed = rawHref.trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) {
    return { href: trimmed, external: true };
  }
  if (trimmed.startsWith('#')) {
    return { href: trimmed, external: false };
  }

  const hashIdx = trimmed.indexOf('#');
  const pathPart = hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx);
  const hashPart = hashIdx === -1 ? '' : trimmed.slice(hashIdx);
  const sourceDir = posix.dirname(sourcePath);
  const normalized = posix.normalize(sourceDir === '.' ? pathPart : posix.join(sourceDir, pathPart));

  const targetDoc = DOC_BY_SOURCE.get(normalized);
  if (targetDoc) {
    return { href: `../${targetDoc.slug}/${hashPart}`, external: false };
  }
  if (normalized === 'README.md') {
    return { href: `${REPO_URL}${hashPart || '#readme'}`, external: true };
  }
  if (normalized === 'LICENSE') {
    return { href: `${REPO_URL}/blob/main/LICENSE`, external: true };
  }
  if (normalized.startsWith('site/')) {
    return { href: `../../${normalized.slice('site/'.length)}${hashPart}`, external: false };
  }
  return { href: `${REPO_URL}/blob/main/${normalized}${hashPart}`, external: true };
}

function renderInline(text, sourcePath) {
  const tokens = [];
  const hold = (html) => {
    const key = `\u0000T${tokens.length}\u0000`;
    tokens.push(html);
    return key;
  };

  // 1. Protect inline code spans first so _, *, and URLs inside backticks stay literal.
  let out = text.replace(/`([^`\n]+)`/g, (_m, code) => hold(`<code>${escapeHtml(code)}</code>`));

  // 2. Protect Markdown links [label](href) while recursively formatting link labels.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g, (_m, label, rawTarget) => {
    const rawHref = rawTarget.replace(/\s+"[^"]*"$/, '');
    const { href, external } = rewriteHref(rawHref, sourcePath);
    const labelHtml = renderInlineBasic(escapeHtml(label), tokens);
    const attrs = external ? ' target="_blank" rel="noopener"' : '';
    return hold(`<a href="${escapeHtml(href)}"${attrs}>${labelHtml}</a>`);
  });

  // 3. Protect bare URLs while preserving trailing sentence punctuation outside </a>.
  out = out.replace(/https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*/g, (rawUrl) => {
    let url = rawUrl;
    let trail = '';
    while (/[.,;:!?]$/.test(url)) {
      trail = url.slice(-1) + trail;
      url = url.slice(0, -1);
    }
    return hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`) + trail;
  });

  // 4. Escape remaining text, apply emphasis, and restore protected tokens.
  out = escapeHtml(out);
  out = renderInlineBasic(out, tokens);
  return out.replace(/\u0000T(\d+)\u0000/g, (_m, idx) => tokens[Number(idx)]);
}

function renderInlineBasic(escaped, tokens) {
  let out = escaped
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+?)~~/g, '<del>$1</del>')
    .replace(/(^|[^\w*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\n]+?)_(?=$|[^\w])/g, '$1<em>$2</em>');
  if (tokens) {
    out = out.replace(/\u0000T(\d+)\u0000/g, (_m, idx) => tokens[Number(idx)]);
  }
  return out;
}

function renderCodeBlock(code, lang) {
  const cleanLang = (lang || '').trim();
  const label = cleanLang ? `<span class="code-lang">${escapeHtml(cleanLang)}</span>` : '<span class="code-lang">Snippet</span>';
  return `<div class="code-block">
  <div class="code-bar">
    ${label}
    <button type="button" class="code-copy" aria-label="Copy code"><span class="copy-text">Copy</span></button>
  </div>
  <pre><code>${escapeHtml(code)}</code></pre>
</div>`;
}

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += s[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function parseTableAlignments(line) {
  return splitTableRow(line).map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

function isHeading(line) {
  return /^ {0,3}(#{1,6})\s+(.+?)\s*#*$/.test(line);
}

function isHr(line) {
  return /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

function matchListLine(line) {
  const ul = line.match(/^(\s*)[-*+]\s+(.*)$/);
  if (ul) return { type: 'ul', indent: ul[1].length, markerLen: 2, text: ul[2] };
  const ol = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (ol) return { type: 'ol', indent: ol[1].length, markerLen: ol[2].length + 2, text: ol[3] };
  return null;
}

function preprocessMarkdown(raw) {
  let text = raw.replace(/\r\n/g, '\n');
  // Strip canonical top cross-link bar (`[Meld home page](...) · ...`).
  text = text.replace(/^\[Meld home page\]\([^)]+\)[^\n]*\n+/, '');
  // Strip manual GitHub TOC block wrapped in <!-- toc --> ... <!-- /toc -->.
  text = text.replace(/<!--\s*toc\s*-->[\s\S]*?<!--\s*\/toc\s*-->\s*/gi, '');

  let h1Title = null;
  text = text.replace(/^#\s+(.+)\n+/, (_m, title) => {
    h1Title = stripInlineMarkdown(title.trim());
    return '';
  });

  return { h1Title, body: text };
}

function parseBlocks(body, sourcePath) {
  const lines = body.split('\n');
  const slugCounts = new Map();
  const toc = [];
  const sections = [];
  let activeSection = null;

  function pushSectionText(plain) {
    if (!plain) return;
    if (activeSection) activeSection.chunks.push(plain);
    else {
      activeSection = { heading: '', id: '', chunks: [plain] };
      sections.push(activeSection);
    }
  }

  function parseList(startIdx, baseIndent) {
    const first = matchListLine(lines[startIdx]);
    const listType = first.type;
    const items = [];
    let i = startIdx;

    while (i < lines.length) {
      const m = matchListLine(lines[i]);
      if (!m || m.indent !== baseIndent || m.type !== listType) break;

      const contentIndent = baseIndent + m.markerLen;
      const itemBlocks = [];
      let currentPara = [m.text];
      i++;

      const flushPara = () => {
        if (currentPara.length > 0) {
          const joined = currentPara.join(' ').trim();
          if (joined) {
            pushSectionText(stripInlineMarkdown(joined));
            itemBlocks.push({ kind: 'p', html: renderInline(joined, sourcePath) });
          }
          currentPara = [];
        }
      };

      while (i < lines.length) {
        const line = lines[i];

        if (line.trim() === '') {
          // Look ahead across blank lines to see if the list item continues.
          let look = i + 1;
          while (look < lines.length && lines[look].trim() === '') look++;
          if (look >= lines.length) {
            i = look;
            break;
          }
          const next = lines[look];
          const nextList = matchListLine(next);
          if (nextList) {
            if (nextList.indent >= contentIndent) {
              flushPara();
              i = look;
              const sub = parseList(i, nextList.indent);
              itemBlocks.push({ kind: 'raw', html: sub.html });
              i = sub.nextIdx;
              continue;
            }
            if (nextList.indent === baseIndent && nextList.type === listType) {
              i = look;
            }
            break;
          }
          const nextIndent = next.match(/^(\s*)/)[1].length;
          if (nextIndent >= contentIndent) {
            flushPara();
            i = look;
            continue;
          }
          break;
        }

        const nested = matchListLine(line);
        if (nested) {
          if (nested.indent >= contentIndent) {
            flushPara();
            const sub = parseList(i, nested.indent);
            itemBlocks.push({ kind: 'raw', html: sub.html });
            i = sub.nextIdx;
            continue;
          }
          break;
        }

        const fence = line.match(/^(\s*)(```|~~~)(.*)$/);
        if (fence && fence[1].length >= contentIndent) {
          flushPara();
          const marker = fence[2];
          const lang = fence[3].trim();
          const codeLines = [];
          i++;
          while (i < lines.length && !lines[i].trim().startsWith(marker)) {
            codeLines.push(lines[i].slice(Math.min(fence[1].length, lines[i].search(/\S|$/) )));
            i++;
          }
          if (i < lines.length) i++;
          itemBlocks.push({ kind: 'raw', html: renderCodeBlock(codeLines.join('\n'), lang) });
          continue;
        }

        const indent = line.match(/^(\s*)/)[1].length;
        if (indent >= contentIndent || (currentPara.length > 0 && !isHeading(line) && !isHr(line) && !/^ {0,3}>/.test(line))) {
          currentPara.push(line.trim());
          i++;
          continue;
        }
        break;
      }

      flushPara();

      const onlySimpleParagraphs = itemBlocks.length === 1 && itemBlocks[0].kind === 'p';
      const innerHtml = onlySimpleParagraphs
        ? itemBlocks[0].html
        : itemBlocks.map((b) => (b.kind === 'p' ? `<p>${b.html}</p>` : b.html)).join('\n');
      items.push(`<li>${innerHtml}</li>`);
    }

    return {
      html: `<${listType}>\n${items.join('\n')}\n</${listType}>`,
      nextIdx: i,
    };
  }

  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code blocks
    const fence = line.match(/^ {0,3}(```+|~~~+)(.*)$/);
    if (fence) {
      const marker = fence[1][0].repeat(3);
      const lang = fence[2].trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      out.push(renderCodeBlock(codeLines.join('\n'), lang));
      continue;
    }

    // Headings
    const hm = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if (hm) {
      const depth = hm[1].length;
      const rawHeading = hm[2];
      const plainHeading = stripInlineMarkdown(rawHeading);
      const id = slugifyHeading(rawHeading, slugCounts);
      if (depth >= 2 && depth <= 3) {
        toc.push({ depth, id, text: plainHeading });
        activeSection = { heading: plainHeading, id, chunks: [] };
        sections.push(activeSection);
      }
      const anchor = `<a class="heading-anchor" href="#${escapeHtml(id)}" aria-label="Link to ${escapeHtml(plainHeading)}">#</a>`;
      out.push(`<h${depth} id="${escapeHtml(id)}">${renderInline(rawHeading, sourcePath)}${anchor}</h${depth}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (isHr(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // Blockquote
    if (/^ {0,3}>/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && (/^ {0,3}>/.test(lines[i]) || (lines[i].trim() !== '' && quoteLines.length > 0 && !isHeading(lines[i])))) {
        if (/^ {0,3}>/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^ {0,3}>\s?/, ''));
        } else {
          quoteLines.push(lines[i]);
        }
        i++;
      }
      const inner = parseBlocks(quoteLines.join('\n'), sourcePath);
      pushSectionText(quoteLines.map(stripInlineMarkdown).join(' '));
      out.push(`<blockquote>\n${inner.html}\n</blockquote>`);
      continue;
    }

    // GFM Table
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      const align = parseTableAlignments(lines[i + 1]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const thHtml = headers
        .map((cell, colIdx) => {
          const a = align[colIdx] && align[colIdx] !== 'left' ? ` style="text-align:${align[colIdx]}"` : '';
          return `<th scope="col"${a}>${renderInline(cell, sourcePath)}</th>`;
        })
        .join('');
      const trHtml = rows
        .map((row) => {
          const tds = headers
            .map((_h, colIdx) => {
              const cell = row[colIdx] ?? '';
              const a = align[colIdx] && align[colIdx] !== 'left' ? ` style="text-align:${align[colIdx]}"` : '';
              return `<td${a}>${renderInline(cell, sourcePath)}</td>`;
            })
            .join('');
          return `<tr>${tds}</tr>`;
        })
        .join('\n');
      pushSectionText([headers.join(' '), ...rows.map((r) => r.join(' '))].map(stripInlineMarkdown).join(' '));
      out.push(`<div class="table-wrap">\n<table>\n<thead><tr>${thHtml}</tr></thead>\n<tbody>\n${trHtml}\n</tbody>\n</table>\n</div>`);
      continue;
    }

    // Lists
    const lm = matchListLine(line);
    if (lm) {
      const parsed = parseList(i, lm.indent);
      out.push(parsed.html);
      i = parsed.nextIdx;
      continue;
    }

    // Paragraph
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isHeading(lines[i]) &&
      !isHr(lines[i]) &&
      !/^ {0,3}(```+|~~~+)/.test(lines[i]) &&
      !/^ {0,3}>/.test(lines[i]) &&
      !matchListLine(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    const paraText = paraLines.join(' ');
    pushSectionText(stripInlineMarkdown(paraText));
    out.push(`<p>${renderInline(paraText, sourcePath)}</p>`);
  }

  return { html: out.join('\n\n'), toc, sections };
}

function estimateReadMinutes(markdown) {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end).join('\n');
}

function extractHelpSections(body, doc) {
  const lines = body.split('\n');
  const slugCounts = new Map();
  const sections = [];
  let active = null;
  let buffer = [];
  let fenceChar = null;
  let fenceLen = 0;

  const flush = () => {
    const content = trimBlankLines(buffer);
    buffer = [];
    if (!content) return;
    if (active) {
      sections.push({
        id: `${doc.slug}#${active.id}`,
        doc: doc.slug,
        docTitle: doc.title,
        heading: active.heading,
        content,
      });
    } else {
      sections.push({
        id: `${doc.slug}#overview`,
        doc: doc.slug,
        docTitle: doc.title,
        heading: 'Overview',
        content,
      });
    }
  };

  for (const line of lines) {
    if (fenceChar) {
      buffer.push(line);
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
      continue;
    }

    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      fenceChar = fence[1][0];
      fenceLen = fence[1].length;
      buffer.push(line);
      continue;
    }

    const h2 = line.match(/^ {0,3}##\s+(.+?)\s*#*$/);
    if (h2) {
      flush();
      const rawHeading = h2[1];
      active = {
        id: slugifyHeading(rawHeading, slugCounts),
        heading: stripInlineMarkdown(rawHeading),
      };
      continue;
    }

    buffer.push(line);
  }
  flush();

  return sections;
}

function renderApiDocsModule(helpGuides, helpSections) {
  return `// Generated by scripts/build-docs.mjs from docs/*.md, PRIVACY.md, and SECURITY.md.
// Do not edit by hand; run \`npm run docs:build\` after updating Markdown docs.

export type MeldDocSection = {
  readonly id: string;
  readonly doc: string;
  readonly docTitle: string;
  readonly heading: string;
  readonly content: string;
};

export type MeldDocGuide = {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly sourcePath: string;
  readonly sections: readonly { readonly id: string; readonly heading: string }[];
};

export const MELD_DOC_GUIDES: readonly MeldDocGuide[] = ${JSON.stringify(helpGuides, null, 2)};

export const MELD_DOC_SECTIONS: readonly MeldDocSection[] = ${JSON.stringify(helpSections, null, 2)};
`;
}

function renderTopBar({ docsRoot, showMenuBtn }) {
  const siteRoot = docsRoot === '.' ? '../' : '../../';
  const docsIndex = docsRoot === '.' ? './' : '../';
  return `<header class="top">
  <div class="top-inner">
    ${
      showMenuBtn
        ? `<button type="button" class="icon-btn menu-btn" data-menu-toggle aria-label="Toggle navigation" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>`
        : ''
    }
    <div class="brand-group">
      <a class="brand" href="${siteRoot}"><img src="${siteRoot}logo.svg" alt="" width="28" height="28">Meld</a>
      <span class="brand-sep" aria-hidden="true">/</span>
      <a class="docs-badge" href="${docsIndex}">Docs</a>
    </div>
    <div class="top-spacer"></div>
    <button type="button" class="search-trigger" data-search-open aria-label="Search documentation">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <span class="search-label">Search docs…</span>
      <kbd>⌘K</kbd>
    </button>
    <nav class="top-links" aria-label="Primary">
      <a class="hide-xs" href="${siteRoot}">Home</a>
      <a href="${REPO_URL}">GitHub</a>
    </nav>
    <button type="button" class="icon-btn theme-toggle" data-theme-toggle aria-label="Switch color theme" title="Switch color theme">
      <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>
      <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
    </button>
  </div>
</header>`;
}

function renderSearchModal() {
  return `<div class="search-modal" data-search-modal hidden role="dialog" aria-modal="true" aria-label="Search documentation">
  <div class="search-dialog">
    <div class="search-input-row">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input type="search" class="search-input" data-search-input placeholder="Search Meld documentation…" autocomplete="off" spellcheck="false" aria-label="Search documentation">
      <button type="button" class="search-close" data-search-close>ESC</button>
    </div>
    <div class="search-results" data-search-results role="listbox" aria-label="Search results"></div>
    <div class="search-footer">
      <span>↑↓ navigate · ↵ open · esc close</span>
      <span>Tip: press / anywhere to search</span>
    </div>
  </div>
</div>`;
}

function renderFooter(docsRoot) {
  const siteRoot = docsRoot === '.' ? '../' : '../../';
  const docsIndex = docsRoot === '.' ? './' : '../';
  return `<footer class="docs-footer">
  <div class="foot-inner">
    <span>Meld is free software under the <a href="${REPO_URL}/blob/main/LICENSE">GNU AGPL v3</a>.</span>
    <nav aria-label="Footer">
      <a href="${siteRoot}">Home</a>
      <a href="${docsIndex}">Docs</a>
      <a href="${docsIndex}privacy/">Privacy</a>
      <a href="${docsIndex}security/">Security</a>
      <a href="${docsIndex}contributing/">Contributing</a>
      <a href="${REPO_URL}">GitHub</a>
    </nav>
  </div>
</footer>`;
}

function renderSidebar(activeSlug) {
  const groupsHtml = DOC_GROUPS.map((group) => {
    const links = group.docs
      .map((doc) => {
        const active = doc.slug === activeSlug ? ' active' : '';
        const current = doc.slug === activeSlug ? ' aria-current="page"' : '';
        return `<li><a class="nav-link${active}" href="../${doc.slug}/"${current}>${escapeHtml(doc.title)}</a></li>`;
      })
      .join('\n        ');
    return `<div class="nav-group">
      <div class="nav-group-title">${escapeHtml(group.title)}</div>
      <ul class="nav-list">
        ${links}
      </ul>
    </div>`;
  }).join('\n    ');

  return `<div class="sidebar-backdrop" data-sidebar-backdrop></div>
  <aside class="sidebar" data-sidebar aria-label="Documentation navigation">
    <a class="nav-home" href="../">← All documentation</a>
    ${groupsHtml}
  </aside>`;
}

function renderDocPage(doc, parsed, prevDoc, nextDoc) {
  const pageTitle = `${doc.title} — Meld Docs`;
  const tocLinks = parsed.toc
    .map(
      (item) =>
        `<li><a class="toc-link depth-${item.depth}" href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a></li>`,
    )
    .join('\n          ');
  const mobileTocLinks = parsed.toc
    .map((item) => `<a class="depth-${item.depth}" href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a>`)
    .join('\n          ');

  const pagerHtml =
    prevDoc || nextDoc
      ? `<nav class="pager" aria-label="Page navigation">
      ${
        prevDoc
          ? `<a class="pager-card prev" href="../${prevDoc.slug}/">
        <span class="pager-dir">← Previous</span>
        <span class="pager-title">${escapeHtml(prevDoc.title)}</span>
      </a>`
          : '<div></div>'
      }
      ${
        nextDoc
          ? `<a class="pager-card next" href="../${nextDoc.slug}/">
        <span class="pager-dir">Next →</span>
        <span class="pager-title">${escapeHtml(nextDoc.title)}</span>
      </a>`
          : '<div></div>'
      }
    </nav>`
      : '';

  return `<!doctype html>
<html lang="en" data-docs-root="..">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(doc.description)}">
<meta name="theme-color" content="#1a7fe6">
<link rel="icon" type="image/png" href="../../favicon.png">
<link rel="apple-touch-icon" href="../../apple-touch-icon.png">
${THEME_PREINIT}
<link rel="stylesheet" href="../docs.css">
</head>
<body>
${renderTopBar({ docsRoot: '..', showMenuBtn: true })}
<div class="docs-shell">
  ${renderSidebar(doc.slug)}
  <main class="doc-main">
    <article class="doc-article">
      <div class="doc-header">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <a href="../">Docs</a>
          <span class="sep" aria-hidden="true">/</span>
          <span>${escapeHtml(doc.groupTitle)}</span>
          <span class="sep" aria-hidden="true">/</span>
          <span aria-current="page">${escapeHtml(doc.title)}</span>
        </nav>
        <h1>${escapeHtml(parsed.h1Title || doc.title)}</h1>
        <p class="doc-summary">${escapeHtml(doc.description)}</p>
        <div class="doc-meta">
          <span class="doc-meta-pill">${parsed.readMinutes} min read</span>
          <a class="edit-link" href="${REPO_URL}/blob/main/${doc.sourcePath}">View ${escapeHtml(doc.sourcePath)} on GitHub ↗</a>
        </div>
      </div>
      ${
        parsed.toc.length > 0
          ? `<details class="mobile-toc">
        <summary>On this page</summary>
        <nav aria-label="On this page">
          ${mobileTocLinks}
        </nav>
      </details>`
          : ''
      }
      <div class="prose">
        ${parsed.html}
      </div>
      ${pagerHtml}
    </article>
  </main>
  ${
    parsed.toc.length > 0
      ? `<aside class="toc" aria-label="On this page">
    <div class="toc-title">On this page</div>
    <ul class="toc-list">
      ${tocLinks}
    </ul>
  </aside>`
      : ''
  }
</div>
${renderFooter('..')}
${renderSearchModal()}
<script src="../docs.js" defer></script>
</body>
</html>
`;
}

function renderDocsHub(docMetaBySlug) {
  const sectionsHtml = DOC_GROUPS.map((group) => {
    const cards = group.docs
      .map((doc) => {
        const meta = docMetaBySlug.get(doc.slug);
        const sectionLabel =
          meta && meta.sectionCount > 0 ? `${meta.sectionCount} sections · ${meta.readMinutes} min` : `${meta?.readMinutes ?? 2} min read`;
        return `<a class="doc-card" href="./${doc.slug}/">
        <div class="doc-card-top">
          <span class="doc-card-icon">${ICONS[doc.icon] ?? ICONS.compass}</span>
          <span class="doc-card-meta">${escapeHtml(sectionLabel)}</span>
        </div>
        <h3>${escapeHtml(doc.title)} <span class="arrow" aria-hidden="true">→</span></h3>
        <p>${escapeHtml(doc.description)}</p>
      </a>`;
      })
      .join('\n      ');
    return `<section class="hub-section" aria-labelledby="group-${group.id}">
      <div class="hub-section-head">
        <h2 id="group-${group.id}">${escapeHtml(group.title)}</h2>
        <p>${escapeHtml(group.description)}</p>
      </div>
      <div class="doc-grid">
        ${cards}
      </div>
    </section>`;
  }).join('\n    ');

  return `<!doctype html>
<html lang="en" data-docs-root=".">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meld Documentation — Guides, Privacy, Security &amp; Development</title>
<meta name="description" content="${escapeHtml(DOCS_SUBTITLE)}">
<meta name="theme-color" content="#1a7fe6">
<link rel="icon" type="image/png" href="../favicon.png">
<link rel="apple-touch-icon" href="../apple-touch-icon.png">
${THEME_PREINIT}
<link rel="stylesheet" href="./docs.css">
</head>
<body>
${renderTopBar({ docsRoot: '.', showMenuBtn: false })}
<main>
  <section class="hub-hero">
    <div class="hub-wrap">
      <span class="eyebrow">Meld Documentation</span>
      <h1>Everything you need to <span class="soft">run Meld yourself.</span></h1>
      <p class="hub-lede">${escapeHtml(DOCS_SUBTITLE)}</p>
      <button type="button" class="hub-search-bar" data-search-open>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <span>Search features, Plaid, Docker, privacy…</span>
        <kbd>⌘K</kbd>
      </button>
      <div class="quick-chips">
        <a class="quick-chip" href="./install/">Install</a>
        <a class="quick-chip" href="./features/">Features overview</a>
        <a class="quick-chip" href="./plaid/">Connect Plaid</a>
        <a class="quick-chip" href="./phone-access/">Phone access</a>
        <a class="quick-chip" href="./docker/">Docker self-hosting</a>
        <a class="quick-chip" href="./privacy/">Privacy model</a>
      </div>
    </div>
  </section>
  <div class="hub-main">
    <div class="hub-wrap">
      ${sectionsHtml}
      <div class="install-band">
        <div>
          <h2>New to Meld?</h2>
          <p>Download the Mac or Windows app and start with Plaid Sandbox in minutes. On Linux or a NAS, run it with Docker.</p>
        </div>
        <div class="install-actions">
          <a class="btn btn-primary" href="./install/">Install Meld</a>
          <a class="btn" href="./plaid/">Plaid setup</a>
          <a class="btn" href="./docker/">Docker guide</a>
        </div>
      </div>
    </div>
  </div>
</main>
${renderFooter('.')}
${renderSearchModal()}
<script src="./docs.js" defer></script>
</body>
</html>
`;
}

function validateGeneratedLinks(generatedFiles) {
  const errors = [];
  const docIdsBySlug = new Map();

  for (const [relPath, content] of generatedFiles) {
    if (!relPath.endsWith('.html')) continue;
    const slugMatch = relPath.match(/^([^/]+)\/index\.html$/);
    if (slugMatch) {
      const ids = new Set([...content.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
      docIdsBySlug.set(slugMatch[1], ids);
    }
  }

  // Validate internal links inside generated docs HTML.
  for (const [relPath, content] of generatedFiles) {
    if (!relPath.endsWith('.html')) continue;
    const isSubPage = relPath !== 'index.html';
    const currentSlug = isSubPage ? relPath.split('/')[0] : null;
    for (const m of content.matchAll(/\bhref="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:\/\/|mailto:|tel:)/.test(href)) continue;
      if (href.startsWith('#')) {
        const id = href.slice(1);
        const ids = currentSlug ? docIdsBySlug.get(currentSlug) : null;
        if (currentSlug && (!ids || !ids.has(id))) {
          errors.push(`Broken anchor ${href} in site/docs/${relPath}`);
        }
        continue;
      }
      const [pathPart, hashPart] = href.split('#');
      if (pathPart.startsWith('/')) {
        errors.push(`Root-absolute link "${href}" in site/docs/${relPath} breaks GitHub Pages subpath (/meld/)`);
        continue;
      }
      const cleanPath = pathPart.replace(/^\.\//, '');
      const dir = dirname(relPath) === '.' ? '' : `${dirname(relPath)}/`;
      const resolved = posix.normalize(`${dir}${cleanPath}`).replace(/^\.\//, '');
      if (resolved.startsWith('..')) {
        // Links to parent site/ (e.g. ../, ../../favicon.png, ../#install).
        const siteTarget = posix.normalize(posix.join('docs', resolved)).replace(/\/$/, '');
        const candidate = siteTarget === '' || siteTarget === '.' ? join(siteDir, 'index.html') : join(siteDir, siteTarget);
        const htmlCandidate = candidate.endsWith('.html') || candidate.includes('.') ? candidate : join(candidate, 'index.html');
        if (!existsSync(candidate) && !existsSync(htmlCandidate)) {
          errors.push(`Broken site link "${href}" in site/docs/${relPath}`);
        }
        continue;
      }
      const targetHtml =
        resolved === '' || resolved === '.' ? 'index.html' : resolved.endsWith('/') ? `${resolved}index.html` : resolved;
      if (!generatedFiles.has(targetHtml) && !existsSync(join(docsOutDir, targetHtml))) {
        errors.push(`Broken docs link "${href}" -> "${targetHtml}" in site/docs/${relPath}`);
        continue;
      }
      if (hashPart) {
        const targetSlug = targetHtml.split('/')[0];
        const ids = docIdsBySlug.get(targetSlug);
        if (ids && !ids.has(hashPart)) {
          errors.push(`Broken anchor "${href}" in site/docs/${relPath}`);
        }
      }
    }
  }

  // Validate docs/ links inside site/index.html as well.
  const indexHtml = readFileSync(join(siteDir, 'index.html'), 'utf8');
  for (const m of indexHtml.matchAll(/\bhref="(docs\/[^"]*)"/g)) {
    const href = m[1];
    const [pathPart, hashPart] = href.split('#');
    const rel = pathPart.slice('docs/'.length);
    const targetHtml = rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel;
    if (!generatedFiles.has(targetHtml) && !existsSync(join(docsOutDir, targetHtml))) {
      errors.push(`Broken docs link "${href}" in site/index.html`);
      continue;
    }
    if (hashPart) {
      const targetSlug = targetHtml.split('/')[0];
      const ids = docIdsBySlug.get(targetSlug);
      if (ids && !ids.has(hashPart)) {
        errors.push(`Broken anchor "${href}" in site/index.html`);
      }
    }
  }

  return errors;
}

export function buildDocs({ check = false } = {}) {
  const errors = [];

  // 1. Ensure every Markdown file in docs/ is registered in DOC_GROUPS.
  const docsDirFiles = readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).sort();
  for (const file of docsDirFiles) {
    const rel = `docs/${file}`;
    if (!DOC_BY_SOURCE.has(rel)) {
      errors.push(`Unregistered doc "${rel}". Add it to DOC_GROUPS in scripts/build-docs.mjs.`);
    }
  }

  for (const staticAsset of ['docs.css', 'docs.js']) {
    if (!existsSync(join(docsOutDir, staticAsset))) {
      errors.push(`Missing static docs asset: site/docs/${staticAsset}`);
    }
  }

  // 2. Parse Markdown files and build deterministic outputs.
  const generated = new Map();
  const searchIndex = [];
  const docMetaBySlug = new Map();
  const helpGuides = [];
  const helpSections = [];

  for (let idx = 0; idx < ALL_DOCS.length; idx++) {
    const doc = ALL_DOCS[idx];
    const absSource = join(root, doc.sourcePath);
    if (!existsSync(absSource)) {
      errors.push(`Missing doc source: ${doc.sourcePath}`);
      continue;
    }
    const raw = readFileSync(absSource, 'utf8');
    const { h1Title, body } = preprocessMarkdown(raw);
    const parsed = parseBlocks(body, doc.sourcePath);
    parsed.h1Title = h1Title;
    parsed.readMinutes = estimateReadMinutes(body);

    const prevDoc = idx > 0 ? ALL_DOCS[idx - 1] : null;
    const nextDoc = idx < ALL_DOCS.length - 1 ? ALL_DOCS[idx + 1] : null;

    docMetaBySlug.set(doc.slug, {
      sectionCount: parsed.toc.filter((t) => t.depth === 2).length,
      readMinutes: parsed.readMinutes,
    });

    generated.set(`${doc.slug}/index.html`, renderDocPage(doc, parsed, prevDoc, nextDoc));

    searchIndex.push({
      isPage: true,
      pageTitle: doc.title,
      group: doc.groupTitle,
      heading: '',
      url: `${doc.slug}/`,
      text: doc.description,
    });

    for (const sec of parsed.sections) {
      if (!sec.heading) continue;
      const plain = sec.chunks.join(' ').replace(/\s+/g, ' ').trim();
      searchIndex.push({
        isPage: false,
        pageTitle: doc.title,
        group: doc.groupTitle,
        heading: sec.heading,
        url: `${doc.slug}/#${sec.id}`,
        text: plain,
      });
    }

    if (doc.inAppHelp) {
      const sections = extractHelpSections(body, doc);
      helpSections.push(...sections);
      helpGuides.push({
        slug: doc.slug,
        title: doc.title,
        description: doc.description,
        sourcePath: doc.sourcePath,
        sections: sections.map(({ id, heading }) => ({ id, heading })),
      });
    }
  }

  generated.set('index.html', renderDocsHub(docMetaBySlug));
  generated.set('search-index.json', `${JSON.stringify(searchIndex, null, 2)}\n`);
  const expectedApiDocs = renderApiDocsModule(helpGuides, helpSections);

  errors.push(...validateGeneratedLinks(generated));

  if (check) {
    for (const [relPath, expected] of generated) {
      const fullPath = join(docsOutDir, relPath);
      if (!existsSync(fullPath)) {
        errors.push(`Missing generated file: site/docs/${relPath} (run npm run docs:build)`);
        continue;
      }
      const actual = readFileSync(fullPath, 'utf8');
      if (actual !== expected) {
        errors.push(`Stale generated file: site/docs/${relPath} (run npm run docs:build)`);
      }
    }

    if (!existsSync(apiDocsOutFile)) {
      errors.push(`Missing generated file: ${API_DOCS_OUT_REL} (run npm run docs:build)`);
    } else if (readFileSync(apiDocsOutFile, 'utf8') !== expectedApiDocs) {
      errors.push(`Stale generated file: ${API_DOCS_OUT_REL} (run npm run docs:build)`);
    }

    // Check for orphaned generated directories/files in site/docs/.
    if (existsSync(docsOutDir)) {
      const allowedTop = new Set(['docs.css', 'docs.js', 'index.html', 'search-index.json', ...ALL_DOCS.map((d) => d.slug)]);
      for (const entry of readdirSync(docsOutDir)) {
        if (!allowedTop.has(entry)) {
          errors.push(`Unexpected file or directory in site/docs/: ${entry} (run npm run docs:build)`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`Docs check failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    }
    return { count: ALL_DOCS.length, files: generated.size, helpSections: helpSections.length };
  }

  if (errors.length > 0) {
    throw new Error(`Docs build failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }

  // Write generated outputs and prune stale directories.
  mkdirSync(docsOutDir, { recursive: true });
  const allowedTop = new Set(['docs.css', 'docs.js', 'index.html', 'search-index.json', ...ALL_DOCS.map((d) => d.slug)]);
  for (const entry of readdirSync(docsOutDir)) {
    if (!allowedTop.has(entry)) {
      rmSync(join(docsOutDir, entry), { recursive: true, force: true });
    }
  }
  for (const [relPath, content] of generated) {
    const fullPath = join(docsOutDir, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  mkdirSync(dirname(apiDocsOutFile), { recursive: true });
  writeFileSync(apiDocsOutFile, expectedApiDocs);
  return { count: ALL_DOCS.length, files: generated.size, helpSections: helpSections.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const isCheck = process.argv.includes('--check');
  try {
    const res = buildDocs({ check: isCheck });
    if (isCheck) {
      console.log(`✓ Verified ${res.count} docs pages, ${res.files} generated files in site/docs/, and ${res.helpSections} Ask Meld guide sections`);
    } else {
      console.log(`✓ Built ${res.count} docs pages (${res.files} files) in site/docs/ and ${res.helpSections} Ask Meld guide sections in ${API_DOCS_OUT_REL}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
