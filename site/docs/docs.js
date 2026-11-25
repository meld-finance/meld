(() => {
  const THEME_KEY = 'meld.site.theme';
  const root = document.documentElement;
  const docsRoot = root.dataset.docsRoot || '.';

  // --- Theme Toggle ---
  const themeBtn = document.querySelector('[data-theme-toggle]');
  function resolvedTheme() {
    const explicit = root.dataset.theme;
    if (explicit === 'light' || explicit === 'dark') return explicit;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function updateThemeButton() {
    if (!themeBtn) return;
    const current = resolvedTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    themeBtn.setAttribute('aria-label', `Switch to ${next} mode`);
    themeBtn.setAttribute('title', `Switch to ${next} mode`);
  }
  if (themeBtn) {
    updateThemeButton();
    themeBtn.addEventListener('click', () => {
      const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {}
      updateThemeButton();
    });
  }

  // --- Mobile Sidebar Drawer ---
  const sidebar = document.querySelector('[data-sidebar]');
  const backdrop = document.querySelector('[data-sidebar-backdrop]');
  const menuBtn = document.querySelector('[data-menu-toggle]');
  function setDrawer(open) {
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    backdrop?.classList.toggle('open', open);
    menuBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
  }
  menuBtn?.addEventListener('click', () => setDrawer(!sidebar?.classList.contains('open')));
  backdrop?.addEventListener('click', () => setDrawer(false));
  sidebar?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setDrawer(false)));

  // --- Copy Code Buttons ---
  document.querySelectorAll('.code-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const codeEl = btn.closest('.code-block')?.querySelector('pre code');
      if (!codeEl) return;
      const text = codeEl.textContent || '';
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        btn.classList.add('copied');
        const label = btn.querySelector('.copy-text');
        if (label) label.textContent = 'Copied';
        setTimeout(() => {
          btn.classList.remove('copied');
          if (label) label.textContent = 'Copy';
        }, 1800);
      } catch {}
    });
  });

  // --- Right TOC Scroll-Spy ---
  const tocLinks = [...document.querySelectorAll('.toc-link')];
  if (tocLinks.length > 0) {
    const targets = tocLinks
      .map((link) => {
        const id = decodeURIComponent((link.getAttribute('href') || '').replace(/^#/, ''));
        return { link, el: id ? document.getElementById(id) : null };
      })
      .filter((entry) => entry.el);

    function syncActiveHeading() {
      const offset = 110;
      let current = targets[0];
      for (const item of targets) {
        if (item.el.getBoundingClientRect().top <= offset) {
          current = item;
        } else {
          break;
        }
      }
      tocLinks.forEach((l) => l.classList.remove('active'));
      if (current) current.link.classList.add('active');
    }

    let rafPending = false;
    window.addEventListener(
      'scroll',
      () => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          syncActiveHeading();
        });
      },
      { passive: true },
    );
    syncActiveHeading();
  }

  // --- Client-side Search Modal ---
  const modal = document.querySelector('[data-search-modal]');
  const searchInput = modal?.querySelector('[data-search-input]');
  const resultsEl = modal?.querySelector('[data-search-results]');
  const closeBtn = modal?.querySelector('[data-search-close]');
  let indexPromise = null;
  let searchItems = [];
  let selectedIdx = 0;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function resolveDocUrl(relUrl) {
    return docsRoot === '.' ? `./${relUrl}` : `${docsRoot}/${relUrl}`;
  }

  async function ensureIndex() {
    if (!indexPromise) {
      indexPromise = fetch(`${docsRoot}/search-index.json`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          searchItems = Array.isArray(data) ? data : [];
          return searchItems;
        })
        .catch(() => []);
    }
    return indexPromise;
  }

  function highlightTerms(snippet, tokens) {
    if (!tokens.length) return escapeHtml(snippet);
    const lower = snippet.toLowerCase();
    const ranges = [];
    for (const token of tokens) {
      if (!token) continue;
      let pos = 0;
      while ((pos = lower.indexOf(token, pos)) !== -1) {
        ranges.push([pos, pos + token.length]);
        pos += token.length;
      }
    }
    if (!ranges.length) return escapeHtml(snippet);
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
      const prev = merged[merged.length - 1];
      if (ranges[i][0] <= prev[1]) {
        prev[1] = Math.max(prev[1], ranges[i][1]);
      } else {
        merged.push(ranges[i]);
      }
    }
    let out = '';
    let cursor = 0;
    for (const [start, end] of merged) {
      out += escapeHtml(snippet.slice(cursor, start));
      out += `<mark>${escapeHtml(snippet.slice(start, end))}</mark>`;
      cursor = end;
    }
    out += escapeHtml(snippet.slice(cursor));
    return out;
  }

  function buildSnippet(text, tokens) {
    const clean = (text || '').trim();
    if (!clean) return '';
    const lower = clean.toLowerCase();
    let bestIdx = -1;
    for (const t of tokens) {
      const i = lower.indexOf(t);
      if (i !== -1 && (bestIdx === -1 || i < bestIdx)) bestIdx = i;
    }
    if (bestIdx === -1) return clean.length > 150 ? `${clean.slice(0, 147)}…` : clean;
    const start = Math.max(0, bestIdx - 48);
    const end = Math.min(clean.length, start + 156);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < clean.length ? '…' : '';
    return `${prefix}${clean.slice(start, end)}${suffix}`;
  }

  function scoreItem(item, tokens) {
    const title = (item.pageTitle || '').toLowerCase();
    const heading = (item.heading || '').toLowerCase();
    const text = (item.text || '').toLowerCase();
    const group = (item.group || '').toLowerCase();
    let score = 0;
    for (const t of tokens) {
      let matched = false;
      if (heading.includes(t)) {
        score += heading.startsWith(t) ? 14 : 10;
        matched = true;
      }
      if (title.includes(t)) {
        score += title.startsWith(t) ? 10 : 7;
        matched = true;
      }
      if (group.includes(t)) {
        score += 3;
        matched = true;
      }
      if (text.includes(t)) {
        score += 2;
        matched = true;
      }
      if (!matched) return 0;
    }
    if (!item.heading && score > 0) score += 2;
    return score;
  }

  function renderResults(query) {
    if (!resultsEl) return;
    const trimmed = query.trim().toLowerCase();
    const tokens = trimmed.split(/\s+/).filter(Boolean);

    let matches;
    let label = '';
    if (tokens.length === 0) {
      matches = searchItems.filter((item) => item.isPage);
      label = 'Guides';
    } else {
      matches = searchItems
        .map((item) => ({ item, score: scoreItem(item, tokens) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 16)
        .map((entry) => entry.item);
      label = `${matches.length} ${matches.length === 1 ? 'result' : 'results'}`;
    }

    selectedIdx = 0;
    if (matches.length === 0) {
      resultsEl.innerHTML = `<div class="search-empty">No matching documentation for “${escapeHtml(query.trim())}”.</div>`;
      return;
    }

    const html = [
      `<div class="search-section-label">${escapeHtml(label)}</div>`,
      ...matches.map((item, idx) => {
        const href = resolveDocUrl(item.url);
        const title = item.heading ? item.heading : item.pageTitle;
        const snippetRaw = buildSnippet(item.text, tokens);
        const snippetHtml = snippetRaw ? highlightTerms(snippetRaw, tokens) : '';
        return `<a class="search-item${idx === 0 ? ' selected' : ''}" href="${escapeHtml(href)}" role="option" aria-selected="${idx === 0 ? 'true' : 'false'}">
          <span class="search-item-head">
            <span class="search-item-badge">${escapeHtml(item.pageTitle)}</span>
            <span class="search-item-title">${escapeHtml(title)}</span>
          </span>
          ${snippetHtml ? `<span class="search-item-snippet">${snippetHtml}</span>` : ''}
        </a>`;
      }),
    ].join('');
    resultsEl.innerHTML = html;
  }

  function updateSelection(nextIdx) {
    if (!resultsEl) return;
    const items = [...resultsEl.querySelectorAll('.search-item')];
    if (!items.length) return;
    selectedIdx = ((nextIdx % items.length) + items.length) % items.length;
    items.forEach((el, idx) => {
      const sel = idx === selectedIdx;
      el.classList.toggle('selected', sel);
      el.setAttribute('aria-selected', sel ? 'true' : 'false');
      if (sel) el.scrollIntoView({ block: 'nearest' });
    });
  }

  async function openSearch() {
    if (!modal || !searchInput) return;
    setDrawer(false);
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    searchInput.focus();
    await ensureIndex();
    renderResults(searchInput.value);
  }

  function closeSearch() {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  document.querySelectorAll('[data-search-open]').forEach((btn) => {
    btn.addEventListener('click', () => void openSearch());
  });
  closeBtn?.addEventListener('click', closeSearch);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeSearch();
  });

  searchInput?.addEventListener('input', () => renderResults(searchInput.value));
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      updateSelection(selectedIdx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      updateSelection(selectedIdx - 1);
    } else if (e.key === 'Enter') {
      const current = resultsEl?.querySelector('.search-item.selected');
      if (current instanceof HTMLAnchorElement) {
        e.preventDefault();
        window.location.href = current.href;
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (modal?.hidden) void openSearch();
      else closeSearch();
    } else if (
      e.key === '/' &&
      modal?.hidden &&
      !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || document.activeElement?.isContentEditable)
    ) {
      e.preventDefault();
      void openSearch();
    } else if (e.key === 'Escape') {
      if (modal && !modal.hidden) closeSearch();
      else if (sidebar?.classList.contains('open')) setDrawer(false);
    }
  });
})();
