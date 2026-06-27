'use strict';

const els = {
  themeToggle: document.getElementById('themeToggle'),
  langToggle: document.getElementById('langToggle'),
  logoutBtn: document.getElementById('logoutBtn'),
  menuToggle: document.getElementById('menuToggle'),
  topbarNav: document.querySelector('.topbar-nav'),
  configWarning: document.getElementById('config-warning'),

  // Dashboard
  syncAllBtn: document.getElementById('syncAllBtn'),
  notifyTestBtn: document.getElementById('notifyTestBtn'),
  sourceBadge: document.getElementById('sourceBadge'),
  dashMeta: document.getElementById('dashMeta'),
  dashStatus: document.getElementById('dashStatus'),
  dashTabs: document.getElementById('dashTabs'),
  tabBtnRatings: document.getElementById('tabBtnRatings'),
  tabBtnDownloads: document.getElementById('tabBtnDownloads'),
  tabRatings: document.getElementById('tabRatings'),
  tabDownloads: document.getElementById('tabDownloads'),
  ratingsPanel: document.getElementById('ratingsPanel'),
  ratingsBtn: document.getElementById('ratingsBtn') || {},
  ratingsSummary: document.getElementById('ratingsSummary'),
  ratingsSplit: document.getElementById('ratingsSplit'),
  ratingsCountryList: document.getElementById('ratingsCountryList'),
  ratingsHistoryPanel: document.getElementById('ratingsHistoryPanel'),
  ratingsHistoryBtn: document.getElementById('ratingsHistoryBtn') || {},
  ratingsHistoryNote: document.getElementById('ratingsHistoryNote'),
  ratingsPeriods: document.getElementById('ratingsPeriods'),
  ratingsStarDeltas: document.getElementById('ratingsStarDeltas'),
  ratingsBaselineDist: document.getElementById('ratingsBaselineDist'),
  ratingsTimelineList: document.getElementById('ratingsTimelineList'),
  starEditor: document.getElementById('starEditor'),
  starShotInput: document.getElementById('starShotInput'),
  starShotStatus: document.getElementById('starShotStatus'),
  starDate: document.getElementById('starDate'),
  starTotals: document.getElementById('starTotals'),
  starSaveBtn: document.getElementById('starSaveBtn'),
  starEditorMsg: document.getElementById('starEditorMsg'),
  starInputs: {
    5: document.getElementById('star5'),
    4: document.getElementById('star4'),
    3: document.getElementById('star3'),
    2: document.getElementById('star2'),
    1: document.getElementById('star1'),
  },
  reviewsTimeline: document.getElementById('reviewsTimeline'),
  reviewsTimelineChart: document.getElementById('reviewsTimelineChart'),
  reviewsTimelineNote: document.getElementById('reviewsTimelineNote'),
  reviewsTimelineRange: document.getElementById('reviewsTimelineRange'),
  downloadsPanel: document.getElementById('downloadsPanel'),
  downloadsBtn: document.getElementById('downloadsBtn') || {},
  downloadsNote: document.getElementById('downloadsNote'),
  downloadsSummary: document.getElementById('downloadsSummary'),
  downloadsCountryList: document.getElementById('downloadsCountryList'),
  versionPanel: document.getElementById('versionPanel'),
  versionBtn: document.getElementById('versionBtn') || {},
  versionNote: document.getElementById('versionNote'),
  versionLatest: document.getElementById('versionLatest'),
  report: document.getElementById('report'),
  reportTitle: document.getElementById('reportTitle'),
  reportSource: document.getElementById('reportSource'),
  reportSummary: document.getElementById('reportSummary'),
  painList: document.getElementById('painList'),
  praiseList: document.getElementById('praiseList'),
  actionsBlock: document.getElementById('actionsBlock'),
  actionsList: document.getElementById('actionsList'),

  // Written reviews
  writtenPanel: document.getElementById('writtenPanel'),
  writtenBtn: document.getElementById('writtenBtn') || {},
  writtenPdfBtn: document.getElementById('writtenPdfBtn'),
  writtenNote: document.getElementById('writtenNote'),
  writtenMonthPicker: document.getElementById('writtenMonthPicker'),
  writtenOverview: document.getElementById('writtenOverview'),
  writtenAnalysis: document.getElementById('writtenAnalysis'),
  writtenDays: document.getElementById('writtenDays'),
};

let appConfig = null;

// Cached payloads per panel so we can re-render in place when the language
// switches without re-fetching from the server.
const cache = {
  config: null,
  dashboard: null,
  report: null,
  ratings: null,
  ratingsHistory: null,
  downloads: null,
  version: null,
  timeline: null,
};

init();

async function init() {
  // Apply UI language to all static text before anything else.
  applyStaticTranslations();
  updateLangToggle();

  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    appConfig = cfg;
    cache.config = cfg;
    if (!cfg.configured) els.configWarning.classList.remove('hidden');
    renderConfigBadge();
    if (cfg.auth?.enabled && els.logoutBtn) {
      els.logoutBtn.classList.remove('hidden');
      els.logoutBtn.addEventListener('click', onLogout);
    }
  } catch {
    // Non-fatal.
  }

  // Theme toggle (light / dark), persisted in localStorage.
  initTheme();
  els.themeToggle.addEventListener('click', toggleTheme);

  // Language toggle (English / German), persisted in localStorage.
  els.langToggle.addEventListener('click', toggleLang);

  // Mobile hamburger menu for the topbar actions.
  initTopbarMenu();

  // Dashboard view tabs (Ratings & reviews / Downloads & adoption).
  initTabs();

  // Dashboard wiring
  els.syncAllBtn.addEventListener('click', onSyncAll);
  els.notifyTestBtn.addEventListener('click', onTestNotify);
  els.reviewsTimelineRange.addEventListener('change', () => loadReviewsTimeline());
  initStarEditor();
  els.writtenPdfBtn.addEventListener('click', exportWrittenPdf);

  if (appConfig?.configured) {
    loadDashboard();
    // Load ratings first (captures today's snapshot), then the history compare.
    loadRatings().then(() => loadRatingsHistory());
    loadWrittenReviews();
  }
  if (appConfig?.sales?.configured) {
    loadDownloads();
    loadVersionAdoption();
  } else {
    // No Sales Reports credentials — the Downloads & adoption tab has nothing to
    // show, so hide its button and force the ratings view.
    if (els.tabBtnDownloads) els.tabBtnDownloads.classList.add('hidden');
    if (currentTab() === 'downloads') switchTab('ratings', { persist: false });
  }
}

/* ===================== Theme ===================== */

function initTheme() {
  let theme = 'dark';
  try {
    theme = localStorage.getItem('theme') || 'dark';
  } catch {
    /* localStorage unavailable */
  }
  applyTheme(theme);
}

function applyTheme(theme) {
  const isLight = theme === 'light';
  document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
  if (els.themeToggle) {
    // The sun/moon icon is swapped by CSS via [data-theme]; only the text label
    // needs updating here (shown in the mobile dropdown).
    const label = els.themeToggle.querySelector('.theme-toggle-label');
    if (label) label.textContent = isLight ? t('themeLight') : t('themeDark');
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try {
    localStorage.setItem('theme', next);
  } catch {
    /* localStorage unavailable */
  }
}

async function onLogout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {
    /* ignore network errors; redirect anyway */
  }
  window.location.href = '/login';
}

/* ===================== Mobile hamburger menu ===================== */

function setTopbarMenu(open) {
  if (!els.topbarNav || !els.menuToggle) return;
  els.topbarNav.classList.toggle('open', open);
  els.menuToggle.setAttribute('aria-expanded', String(open));
}

function initTopbarMenu() {
  if (!els.menuToggle || !els.topbarNav) return;

  els.menuToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setTopbarMenu(!els.topbarNav.classList.contains('open'));
  });

  // Close after picking an action, when tapping outside, or pressing Escape.
  els.topbarNav.addEventListener('click', (e) => {
    if (e.target.closest('.icon-btn') && !e.target.closest('.menu-toggle')) {
      setTopbarMenu(false);
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.topbar-nav')) setTopbarMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setTopbarMenu(false);
  });
}

/* ===================== Dashboard view tabs ===================== */

// Maps a tab name to its panel element key.
const TAB_PANELS = { ratings: 'tabRatings', downloads: 'tabDownloads' };

function currentTab() {
  const active = els.dashTabs?.querySelector('.dash-tab--active');
  return active?.dataset.tab || 'ratings';
}

function initTabs() {
  if (!els.dashTabs) return;
  // Restore the last-used tab (defaults to ratings).
  let saved = 'ratings';
  try {
    const v = localStorage.getItem('dashTab');
    if (v && TAB_PANELS[v]) saved = v;
  } catch {
    /* localStorage unavailable */
  }
  switchTab(saved, { persist: false });
  for (const btn of els.dashTabs.querySelectorAll('.dash-tab')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }
}

function switchTab(tab, { persist = true } = {}) {
  const valid = TAB_PANELS[tab] ? tab : 'ratings';
  for (const [name, panelKey] of Object.entries(TAB_PANELS)) {
    const panel = els[panelKey];
    if (panel) panel.classList.toggle('hidden', name !== valid);
  }
  for (const btn of els.dashTabs?.querySelectorAll('.dash-tab') || []) {
    const active = btn.dataset.tab === valid;
    btn.classList.toggle('dash-tab--active', active);
    btn.setAttribute('aria-selected', String(active));
  }
  if (persist) {
    try {
      localStorage.setItem('dashTab', valid);
    } catch {
      /* localStorage unavailable */
    }
  }
}

/* ===================== Language ===================== */

function updateLangToggle() {
  if (!els.langToggle) return;
  const lang = getLang() === 'de' ? 'de' : 'en';
  // Highlight the active segment in the EN / DE switch.
  const segs = els.langToggle.querySelectorAll('.lang-seg');
  if (segs.length) {
    segs.forEach((seg) => seg.classList.toggle('active', seg.dataset.lang === lang));
  }
  // Back-compat: simple single-label variant (mobile dropdown).
  const label = els.langToggle.querySelector('.lang-toggle-label');
  if (label) label.textContent = lang === 'de' ? 'DE' : 'EN';
}

function toggleLang() {
  setLang(getLang() === 'de' ? 'en' : 'de');
  applyLanguage();
}

/** Re-applies the active language to static text and re-renders cached panels. */
function applyLanguage() {
  applyStaticTranslations();
  updateLangToggle();
  applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  renderConfigBadge();

  if (cache.dashboard) renderDashboardSummary(cache.dashboard);
  if (cache.ratings) renderRatings(cache.ratings);
  if (cache.ratingsHistory) renderRatingsHistory(cache.ratingsHistory);
  if (cache.report) renderReport(cache.report);
  if (writtenData) renderWrittenReviews(writtenData);
  if (cache.timeline) renderReviewsTimeline(cache.timeline);
  if (cache.downloads) renderDownloads(cache.downloads);
  if (cache.version) renderVersionAdoption(cache.version);
  updateStarTotals();
}

/** Renders the AI/heuristic source badge + notify button title in the active language. */
function renderConfigBadge() {
  const cfg = cache.config;
  if (!cfg) return;
  const llm = cfg.llm || {};
  els.sourceBadge.textContent = llm.configured
    ? t('aiBadge', llm.provider, llm.model, llm.free)
    : t('localHeuristicBadge');
  els.sourceBadge.classList.remove('hidden');
  if (cfg.notify?.configured) {
    els.notifyTestBtn.classList.remove('hidden');
    els.notifyTestBtn.title = t('notifyTitle', cfg.notify.to, cfg.notify.transport);
  }
}

/* ===================== Dashboard ===================== */

function currentMonthValue() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function dashStatus(message, isError) {
  els.dashStatus.textContent = message;
  els.dashStatus.classList.toggle('error', Boolean(isError));
  els.dashStatus.classList.toggle('hidden', !message);
}

async function loadDashboard({ sync = false } = {}) {
  const month = currentMonthValue();
  try {
    const params = new URLSearchParams({ month });
    if (sync) params.set('sync', '1');
    const res = await fetch(`/api/dashboard?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('errLoadDashboard'));
    renderDashboardSummary(data);
  } catch (err) {
    dashStatus(err.message, true);
  }
}

function renderDashboardSummary(data) {
  cache.dashboard = data;
  const last = data.lastSync;
  if (last && last.ranAt) {
    els.dashMeta.textContent = t(
      'dashLastSync',
      timeAgo(last.ranAt),
      last.fetched,
      last.inserted,
      data.count,
      data.month
    );
  } else {
    els.dashMeta.textContent = t('dashStored', data.count, data.month);
  }
}

async function onSyncAll() {
  els.syncAllBtn.disabled = true;
  const original = els.syncAllBtn.textContent;
  els.syncAllBtn.textContent = t('syncing');
  try {
    // 1) Pull the last 90 days of written reviews (independent of the month picker).
    dashStatus(t('syncStart'), false);
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 90 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('errSync'));

    dashStatus(t('syncRefreshing', data.fetched, data.inserted), false);

    // 2) Refresh ratings (captures today's snapshot), then the history compare + timeline.
    await loadRatings({ force: true });
    await loadRatingsHistory();
    await loadReviewsTimeline();

    // 3) Refresh written reviews listing.
    await loadWrittenReviews({ refresh: true });

    // 4) Sales-backed panels (only if configured).
    if (appConfig?.sales?.configured) {
      await loadDownloads({ force: true });
      await loadVersionAdoption({ force: true });
    }

    // 5) Re-run the monthly AI analysis.
    await generateReport({ silent: true });

    // 6) Refresh the dashboard summary (updates the last-sync line).
    await loadDashboard();
    dashStatus(t('syncComplete'), false);
  } catch (err) {
    dashStatus(t('syncFailed', err.message), true);
  } finally {
    els.syncAllBtn.disabled = false;
    els.syncAllBtn.textContent = original;
  }
}

async function onTestNotify() {
  els.notifyTestBtn.disabled = true;
  const original = els.notifyTestBtn.textContent;
  els.notifyTestBtn.textContent = t('sending');
  dashStatus(t('sendTestEmail'), false);
  try {
    const res = await fetch('/api/notify-test', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || t('errTestEmail'));
    }
    dashStatus(t('testEmailSent', data.to, data.transport, data.count), false);
  } catch (err) {
    dashStatus(t('testEmailFailed', err.message), true);
  } finally {
    els.notifyTestBtn.disabled = false;
    els.notifyTestBtn.textContent = original;
  }
}

async function generateReport({ silent = false } = {}) {
  const month = currentMonthValue();
  if (!silent) dashStatus(t('generatingReport'), false);
  const res = await fetch(`/api/monthly-report?month=${month}&refresh=1`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || t('errReport'));
  renderReport(data);
}

function renderReport(data) {
  cache.report = data;
  els.reportTitle.textContent = t('monthlyInsightsMonth', data.month);
  const sourceLabel =
    data.source === 'llm' ? t('aiSummary') : data.source === 'heuristic' ? t('localAnalysis') : data.source;
  els.reportSource.textContent = sourceLabel + (data.cached ? t('cachedSuffix') : '');
  els.reportSummary.textContent = data.summary || '';

  renderInsightList(els.painList, data.painPoints || [], 'pain');
  renderInsightList(els.praiseList, data.praises || [], 'praise');

  const actions = data.suggestedActions || [];
  els.actionsList.innerHTML = '';
  if (actions.length) {
    for (const item of actions) {
      const li = document.createElement('li');
      li.textContent = item;
      els.actionsList.appendChild(li);
    }
    els.actionsBlock.classList.remove('hidden');
  } else {
    els.actionsBlock.classList.add('hidden');
  }

  if (data.note) dashStatus(data.note, false);
  els.report.classList.remove('hidden');
}

function renderInsightList(container, items, type) {
  container.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'insight-item';
    li.textContent = type === 'pain' ? t('noPain') : t('noPraise');
    container.appendChild(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.className = `insight-item ${type}`;
    const tags = [];
    if (item.frequency != null) tags.push(`<span class="tag">×${item.frequency}</span>`);
    if (item.severity) tags.push(`<span class="tag sev-${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span>`);
    const examples = (item.examples || [])
      .map((e) => `<li>“${escapeHtml(e)}”</li>`)
      .join('');
    li.innerHTML = `
      <div class="insight-item-top">
        <span class="insight-theme">${escapeHtml(item.theme || '')}</span>
        <span class="insight-tags">${tags.join('')}</span>
      </div>
      ${item.description ? `<p class="insight-desc">${escapeHtml(item.description)}</p>` : ''}
      ${examples ? `<ul class="insight-examples">${examples}</ul>` : ''}
    `;
    container.appendChild(li);
  }
}

/* ===================== Written reviews (day-by-day + PDF) ===================== */

let writtenData = null;
let writtenSelected = null; // array of "YYYY-MM"; null until first load

async function loadWrittenReviews({ refresh = false } = {}) {
  els.writtenPanel.classList.remove('hidden');
  els.writtenBtn.disabled = true;
  els.writtenBtn.textContent = refresh ? t('syncing') : t('loading');
  if (!els.writtenDays.childElementCount) {
    els.writtenNote.textContent = t('loading');
  }
  try {
    const params = new URLSearchParams();
    if (writtenSelected && writtenSelected.length) params.set('months', writtenSelected.join(','));
    if (refresh) params.set('refresh', '1');
    const res = await fetch(`/api/written-reviews?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('errLoadWritten'));
    writtenData = data;
    writtenSelected = data.months || [];
    renderWrittenReviews(data);
  } catch (err) {
    els.writtenNote.textContent = err.message;
  } finally {
    els.writtenBtn.disabled = false;
    els.writtenBtn.textContent = t('refresh');
  }
}

function renderWrittenReviews(data) {
  const selected = data.months || [];
  const selectedSet = new Set(selected);
  const avg = data.averageRating != null ? `${data.averageRating.toFixed(1)} ★` : '—';
  const selLabels = selected.map((m) => formatMonthLabel(m)).join(', ') || '—';
  const unanswered = (data.sections || [])
    .flatMap((s) => s.days || [])
    .flatMap((d) => d.reviews || [])
    .filter((r) => !r.responded).length;
  const unansweredNote = unanswered
    ? ` · <span class="wr-unanswered-count">${escapeHtml(t('needsReply', unanswered))}</span>`
    : ` · <span class="wr-answered-all">${escapeHtml(t('allReplied'))}</span>`;
  els.writtenNote.innerHTML = t('writtenNote', escapeHtml(selLabels), data.total, avg, unansweredNote);

  // Month selector (checkboxes, limited to the last 3 months with reviews).
  renderMonthPicker(data.availableMonths || [], selectedSet);

  // Overview cards mirror the available choices; selected ones are highlighted.
  els.writtenOverview.innerHTML = (data.overview || [])
    .map((m) => {
      const a = m.averageRating != null ? `${m.averageRating.toFixed(1)} ★` : '—';
      const current = selectedSet.has(m.month) ? ' written-month-card--current' : '';
      return `
        <div class="written-month-card${current}">
          <span class="wm-month">${escapeHtml(formatMonthLabel(m.month))}</span>
          <span class="wm-count">${escapeHtml(t('reviewsCount', m.count))}</span>
          <span class="wm-avg">Ø ${a}</span>
        </div>`;
    })
    .join('');

  // Aggregated analysis (skill-based review agent) across the selected months.
  renderWrittenAnalysis(data.report);

  // Per-month day-by-day listing.
  const sections = data.sections || [];
  const hasAny = sections.some((s) => s.days && s.days.length);
  if (!hasAny) {
    els.writtenDays.innerHTML = `<p class="written-empty">${escapeHtml(t('noWrittenSelected'))}</p>`;
    return;
  }
  const sectionsHtml = sections
    .map((section) => {
      const sa = section.averageRating != null ? `${section.averageRating.toFixed(1)} ★` : '—';
      const dayBlocks = (section.days || [])
        .map((day) => {
          const a = day.averageRating != null ? `${day.averageRating.toFixed(1)} ★` : '—';
          const items = day.reviews
            .map(
              (r) => `
              <li class="written-review${r.responded ? '' : ' written-review--unanswered'}">
                <div class="wr-top">
                  <span class="wr-stars">${stars(r.rating)}</span>
                  <span class="wr-name">${escapeHtml(r.reviewerNickname) || escapeHtml(t('anonymous'))}</span>
                  ${r.territory ? `<span class="wr-territory">${escapeHtml(r.territory)}</span>` : ''}
                  ${
                    r.responded
                      ? `<span class="wr-reply-badge wr-reply-badge--done" title="${
                          r.responseDate ? escapeHtml(t('repliedOn', formatDate(r.responseDate))) : escapeHtml(t('replied'))
                        }">${escapeHtml(t('answered'))}</span>`
                      : `<span class="wr-reply-badge wr-reply-badge--todo">${escapeHtml(t('needsReplyBadge'))}</span>`
                  }
                </div>
                ${r.title ? `<div class="wr-title">${escapeHtml(r.title)}</div>` : ''}
                ${r.body ? `<p class="wr-body">${escapeHtml(r.body)}</p>` : ''}
                ${
                  r.responded && r.responseBody
                    ? `<p class="wr-reply"><span class="wr-reply-label">${escapeHtml(t('yourReply'))}</span> ${escapeHtml(
                        r.responseBody
                      )}</p>`
                    : ''
                }
              </li>`
            )
            .join('');
          const head = `
            <div class="written-day">
              <div class="written-day-head">
                <span class="wd-date">${escapeHtml(formatDate(day.date))}</span>
                <span class="wd-meta">${escapeHtml(t('reviewsCount', day.count))} · Ø ${a}</span>
              </div>
              <ul class="written-review-list">${items}</ul>
            </div>`;
          return head;
        })
        .join('');
      const body = dayBlocks || `<p class="written-empty">${escapeHtml(t('noWrittenMonth'))}</p>`;
      return `
        <div class="written-section">
          <h3 class="written-section-head">${escapeHtml(formatMonthLabel(section.month))}
            <span class="ws-meta">${escapeHtml(t('reviewsCount', section.total))} · Ø ${sa}</span></h3>
          ${body}
        </div>`;
    })
    .join('');

  const totalReviews = sections.reduce((sum, s) => sum + (s.total || 0), 0);
  els.writtenDays.innerHTML = `
    <details class="written-reviews-toggle">
      <summary class="written-reviews-summary">
        <span class="wrt-caret" aria-hidden="true">▸</span>
        <span class="wrt-label">${escapeHtml(t('showAllReviews'))}</span>
        <span class="wrt-count">${totalReviews}</span>
      </summary>
      <div class="written-reviews-body">${sectionsHtml}</div>
    </details>`;
}

function renderMonthPicker(choices, selectedSet) {
  if (!choices.length) {
    els.writtenMonthPicker.innerHTML =
      `<span class="written-empty">${escapeHtml(t('noMonths'))}</span>`;
    return;
  }
  els.writtenMonthPicker.innerHTML =
    `<span class="wmp-label">${escapeHtml(t('monthsLabel'))}</span>` +
    choices
      .map((c) => {
        const checked = selectedSet.has(c.month) ? ' checked' : '';
        return `
        <label class="wmp-chip${checked ? ' wmp-chip--on' : ''}">
          <input type="checkbox" value="${c.month}"${checked} />
          ${escapeHtml(formatMonthLabel(c.month))}
          <span class="wmp-count">${c.count}</span>
        </label>`;
      })
      .join('');

  for (const input of els.writtenMonthPicker.querySelectorAll('input[type="checkbox"]')) {
    input.addEventListener('change', onMonthSelectionChange);
  }
}

function onMonthSelectionChange() {
  const checked = [...els.writtenMonthPicker.querySelectorAll('input[type="checkbox"]:checked')].map(
    (i) => i.value
  );
  // Always keep at least one month selected.
  if (!checked.length) {
    const all = [...els.writtenMonthPicker.querySelectorAll('input[type="checkbox"]')];
    if (writtenSelected && writtenSelected.length) {
      const restore = all.find((i) => i.value === writtenSelected[0]);
      if (restore) restore.checked = true;
    } else if (all[0]) {
      all[0].checked = true;
    }
    return;
  }
  writtenSelected = checked.sort((a, b) => (a < b ? 1 : -1));
  loadWrittenReviews();
}

function formatMonthLabel(month, locale) {
  const [y, m] = String(month).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString(locale || currentLocale(), { year: 'numeric', month: 'long' });
}

/** Localized labels for the exported PDF report. */
const PDF_I18N = {
  en: {
    locale: 'en-US',
    title: 'App Store reviews',
    reviewsWord: 'reviews',
    sub: (n, avg) => `${n} written review(s) · Ø ${avg}`,
    overview: 'Overview',
    summary: 'Summary',
    pain: 'Biggest pain points',
    praise: 'What users love',
    actions: 'Suggested actions',
    reviewsSection: 'Reviews',
    empty: 'No written reviews this month.',
    anonymous: 'Anonymous',
    dayHeader: (date, count, avg, word) => `${date} — ${count} ${word} | Ø ${avg}`,
  },
  de: {
    locale: 'de-DE',
    title: 'App Store Rezensionen',
    reviewsWord: 'Rezensionen',
    sub: (n, avg) => `${n} schriftliche Rezension(en) · Ø ${avg}`,
    overview: 'Gesamtübersicht',
    summary: 'Zusammenfassung',
    pain: 'Häufigste Kritikpunkte',
    praise: 'Was Nutzer schätzen',
    actions: 'Empfohlene Maßnahmen',
    reviewsSection: 'Rezensionen',
    empty: 'Keine schriftlichen Rezensionen in diesem Monat.',
    anonymous: 'Anonym',
    dayHeader: (date, count, avg, word) => `${date} — ${count} ${word} | Ø ${avg}`,
  },
};

function pdfLabels(code) {
  return PDF_I18N[code] || PDF_I18N.en;
}

/**
 * Renders the skill-based agent's analysis (summary, pain points, praise,
 * suggested actions, category chips) inside the written-reviews panel.
 */
function renderWrittenAnalysis(report) {
  const el = els.writtenAnalysis;
  if (!report || (!report.painPoints?.length && !report.praises?.length && !report.summary)) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }

  const agent = report.agent || {};
  const sourceLabel =
    report.source === 'agent+llm'
      ? t('aiAgentLlm')
      : report.source === 'agent'
        ? t('aiAgentLocal')
        : report.source;
  const skills = (agent.skills || []).join(' \u2192 ');

  const chips = (report.categories || [])
    .map(
      (c) =>
        `<span class="cat-chip sev-${escapeHtml(c.severity || 'low')}">${escapeHtml(c.label)}
          <span class="cat-count">${c.frequency}\u00d7</span>${trendIcon(c.trend)}</span>`
    )
    .join('');

  el.innerHTML = `
    <div class="wa-head">
      <h3 class="wa-title">${escapeHtml(t('monthlyAnalysis'))}</h3>
      <span class="wa-source" title="Skills: ${escapeHtml(skills)}">${escapeHtml(sourceLabel)}</span>
    </div>
    ${report.summary ? `<p class="wa-summary">${escapeHtml(report.summary)}</p>` : ''}
    ${chips ? `<div class="cat-chips">${chips}</div>` : ''}
    <div class="insight-grid">
      <div class="insight-col">
        <h4 class="insight-h insight-h--bad">${escapeHtml(t('painTitle'))}</h4>
        <ul class="insight-list" id="waPain"></ul>
      </div>
      <div class="insight-col">
        <h4 class="insight-h insight-h--good">${escapeHtml(t('praiseTitle'))}</h4>
        <ul class="insight-list" id="waPraise"></ul>
      </div>
    </div>
    ${
      (report.suggestedActions || []).length
        ? `<div class="actions-block"><h4 class="insight-h">${escapeHtml(t('actionsTitle'))}</h4>
            <ul class="actions-list">${report.suggestedActions
              .map((a) => `<li>${escapeHtml(a)}</li>`)
              .join('')}</ul></div>`
        : ''
    }`;

  renderInsightList(document.getElementById('waPain'), report.painPoints || [], 'pain');
  renderInsightList(document.getElementById('waPraise'), report.praises || [], 'praise');
  el.classList.remove('hidden');
}

function trendIcon(trend) {
  if (trend === 'up') return ` <span class="trend-up" title="${escapeHtml(t('risingVsMonth'))}">\u25b2</span>`;
  if (trend === 'down') return ` <span class="trend-down" title="${escapeHtml(t('fallingVsMonth'))}">\u25bc</span>`;
  if (trend === 'new') return ` <span class="trend-new" title="${escapeHtml(t('newThisMonth'))}">${escapeHtml(t('newBadge'))}</span>`;
  return '';
}

/**
 * Builds a printable monthly report (matching the original PDF layout) and opens
 * the browser print dialog so it can be saved as a PDF.
 */
function exportWrittenPdf() {
  if (!writtenData) {
    loadWrittenReviews().then(() => writtenData && openWrittenPrint(writtenData));
    return;
  }
  openWrittenPrint(writtenData);
}

function openWrittenPrint(data) {
  const report = data.report || {};
  const lang = report.agent?.language || appConfig?.reportLanguage?.code || 'en';
  const L = pdfLabels(lang);
  const locale = L.locale;
  const selectedMonths = data.months || [];
  const monthLabel = selectedMonths.map((m) => formatMonthLabel(m, locale)).join(', ') || '—';
  const avg = data.averageRating != null ? `${data.averageRating.toFixed(1)} ★` : '—';

  const overviewCards = (data.overview || [])
    .map((m) => {
      const a = m.averageRating != null ? `${m.averageRating.toFixed(1)} ★` : '—';
      return `<div class="card"><div class="card-m">${escapeHtml(formatMonthLabel(m.month, locale))}</div>
        <div class="card-c">${m.count} ${escapeHtml(L.reviewsWord)}</div><div class="card-a">Ø ${a}</div></div>`;
    })
    .join('');

  const painItems = (report.painPoints || [])
    .map(
      (p) => `<li><strong>${escapeHtml(p.theme || '')}</strong>${
        p.frequency != null ? ` <span class="freq">${p.frequency}×</span>` : ''
      }${p.description ? `<div class="desc">${escapeHtml(p.description)}</div>` : ''}</li>`
    )
    .join('');

  const praiseItems = (report.praises || [])
    .map(
      (p) => `<li><strong>${escapeHtml(p.theme || '')}</strong>${
        p.frequency != null ? ` <span class="freq">${p.frequency}×</span>` : ''
      }${p.description ? `<div class="desc">${escapeHtml(p.description)}</div>` : ''}</li>`
    )
    .join('');

  const actionItems = (report.suggestedActions || [])
    .map((a) => `<li>${escapeHtml(a)}</li>`)
    .join('');

  const renderDay = (day) => {
    const a = day.averageRating != null ? `${day.averageRating.toFixed(1)} ★` : '—';
    const items = day.reviews
      .map(
        (r) => `<div class="rev"><span class="rstars">${stars(r.rating)}</span>
            <span class="rname">${escapeHtml(r.reviewerNickname) || L.anonymous}</span>
            ${r.title ? `<div class="rtitle">${escapeHtml(r.title)}</div>` : ''}
            ${r.body ? `<div class="rbody">${escapeHtml(r.body)}</div>` : ''}</div>`
      )
      .join('');
    const head = L.dayHeader(escapeHtml(formatDate(day.date, locale)), day.count, a, escapeHtml(L.reviewsWord));
    return `<div class="day"><h3>${head}</h3>${items}</div>`;
  };

  // Per-month sections (matches the source PDF: one section per month).
  const sectionBlocks = (data.sections || [])
    .map((section) => {
      const sa = section.averageRating != null ? `${section.averageRating.toFixed(1)} ★` : '—';
      const monthHead = `${escapeHtml(formatMonthLabel(section.month, locale))} — ${section.total} ${escapeHtml(
        L.reviewsWord
      )} | Ø ${sa}`;
      const body = (section.days || []).map(renderDay).join('') || `<p>${escapeHtml(L.empty)}</p>`;
      return `<div class="month-section"><h2 class="month-h">${monthHead}</h2>${body}</div>`;
    })
    .join('');

  const html = `<!DOCTYPE html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">
    <title>${escapeHtml(L.title)} — ${escapeHtml(monthLabel)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; margin: 32px; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      h2 { font-size: 16px; margin: 28px 0 10px; border-bottom: 2px solid #eee; padding-bottom: 4px; }
      .month-h { margin-top: 24px; }
      .month-section { page-break-inside: auto; }
      .sub { color: #666; margin: 0 0 20px; }
      .cards { display: flex; flex-wrap: wrap; gap: 12px; }
      .card { border: 1px solid #ddd; border-radius: 10px; padding: 12px 16px; min-width: 150px; }
      .card-m { font-weight: 600; }
      .card-c { color: #444; margin-top: 4px; }
      .card-a { color: #b8860b; font-weight: 600; margin-top: 2px; }
      ul { padding-left: 18px; }
      li { margin: 8px 0; }
      .freq { color: #fff; background: #c0392b; border-radius: 6px; padding: 1px 7px; font-size: 12px; }
      ul.praise .freq { background: #1e8449; }
      .desc { color: #555; font-size: 13px; margin-top: 3px; }
      .summary { background: #f7f7f7; border-radius: 8px; padding: 12px 14px; }
      .day { margin: 16px 0; page-break-inside: avoid; }
      .day h3 { font-size: 14px; margin: 0 0 8px; color: #333; }
      .rev { margin: 8px 0; padding-left: 10px; border-left: 3px solid #eee; page-break-inside: avoid; }
      .rstars { color: #f1c40f; letter-spacing: 1px; }
      .rname { color: #666; font-size: 12px; margin-left: 8px; }
      .rtitle { font-weight: 600; margin-top: 2px; }
      .rbody { color: #333; margin-top: 2px; white-space: pre-wrap; }
      @media print { body { margin: 12px; } }
    </style></head><body>
    <h1>${escapeHtml(L.title)} — ${escapeHtml(monthLabel)}</h1>
    <p class="sub">${L.sub(data.total, avg)}</p>

    <h2>${escapeHtml(L.overview)}</h2>
    <div class="cards">${overviewCards}</div>

    ${report.summary ? `<h2>${escapeHtml(L.summary)}</h2><div class="summary">${escapeHtml(report.summary)}</div>` : ''}
    ${painItems ? `<h2>${escapeHtml(L.pain)}</h2><ul class="pain">${painItems}</ul>` : ''}
    ${praiseItems ? `<h2>${escapeHtml(L.praise)}</h2><ul class="praise">${praiseItems}</ul>` : ''}
    ${actionItems ? `<h2>${escapeHtml(L.actions)}</h2><ul class="actions">${actionItems}</ul>` : ''}

    ${sectionBlocks || `<p>${escapeHtml(L.empty)}</p>`}
    <script>window.onload = function () { window.print(); };<\/script>
    </body></html>`;

  const win = window.open('', '_blank');
  if (!win) {
    dashStatus(t('popupBlocked'), true);
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/* ===================== Downloads (Sales Reports) ===================== */

/** Builds N redacted stat-card placeholders (with optional sub line). */
function skeletonStatCards(count, { withSub = false } = {}) {
  const sub = withSub ? '<span class="skeleton-line skeleton-line--sub"></span>' : '';
  return Array.from({ length: count })
    .map(
      () =>
        `<div class="stat-card skeleton-card"><span class="skeleton-line skeleton-line--label"></span><span class="skeleton-line skeleton-line--value"></span>${sub}</div>`
    )
    .join('');
}

/** Builds N redacted country rows. */
function skeletonRows(count) {
  return Array.from({ length: count })
    .map(() => '<div class="skeleton-row"></div>')
    .join('');
}

async function loadDownloads({ force = false } = {}) {
  els.downloadsBtn.disabled = true;
  els.downloadsBtn.textContent = force ? t('refreshing') : t('loading');
  // Show the panel immediately with a loading hint (all-time can take a moment).
  els.downloadsPanel.classList.remove('hidden');
  // Show redacted placeholders while data loads (only when nothing is rendered
  // yet, so a manual refresh keeps the existing numbers visible).
  if (!els.downloadsSummary.querySelector('.stat-card:not(.skeleton-card)')) {
    els.downloadsSummary.innerHTML = skeletonStatCards(4);
    els.downloadsCountryList.innerHTML = skeletonRows(5);
    els.downloadsNote.textContent = t('crunchingDownloads');
  }
  try {
    const res = await fetch(`/api/downloads-summary${force ? '?force=1' : ''}`);
    const data = await res.json();
    if (res.status === 409 && data.needsConfig) {
      els.downloadsNote.textContent = data.error;
      els.downloadsSummary.innerHTML = '';
      els.downloadsCountryList.innerHTML = '';
      return;
    }
    if (!res.ok) throw new Error(data.error || t('errLoadDownloads'));
    renderDownloads(data);
  } catch (err) {
    els.downloadsNote.textContent = err.message;
    // Drop the redacted preview so a failure doesn't look like it's still loading.
    els.downloadsSummary.querySelectorAll('.skeleton-card').forEach((el) => el.remove());
    els.downloadsCountryList.querySelectorAll('.skeleton-row').forEach((el) => el.remove());
  } finally {
    els.downloadsBtn.disabled = false;
    els.downloadsBtn.textContent = t('refreshDownloads');
  }
}

function renderDownloads(data) {
  cache.downloads = data;
  els.downloadsNote.innerHTML = t(
    'downloadsNote',
    data.coverage.fromYear,
    data.coverage.throughDate,
    data.cached
  );

  els.downloadsSummary.innerHTML = `
    <div class="stat-card">
      <span class="stat-label">${escapeHtml(t('statAllTimeDownloads'))}</span>
      <span class="stat-value">${(data.allTime || 0).toLocaleString()}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">${escapeHtml(t('statYearToDate'))}</span>
      <span class="stat-value">${(data.yearToDate || 0).toLocaleString()}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">${escapeHtml(t('statMonthToDate'))}</span>
      <span class="stat-value">${(data.monthToDate || 0).toLocaleString()}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">${escapeHtml(t('statLast30'))}</span>
      <span class="stat-value">${(data.last30Days || 0).toLocaleString()}</span>
    </div>
  `;

  const top = data.topCountries || [];
  els.downloadsCountryList.innerHTML = top
    .map(
      (c) =>
        `<div class="ratings-country"><span class="rc-country">${escapeHtml(c.country)}</span><span>${c.downloads.toLocaleString()}</span></div>`
    )
    .join('');

  els.downloadsPanel.classList.remove('hidden');
}

/* ===================== Version adoption (Sales Reports) ===================== */

async function loadVersionAdoption({ force = false } = {}) {
  els.versionBtn.disabled = true;
  els.versionBtn.textContent = force ? t('refreshing') : t('loading');
  els.versionPanel.classList.remove('hidden');
  if (!els.versionLatest.querySelector('.stat-card:not(.skeleton-card)')) {
    els.versionLatest.innerHTML = skeletonStatCards(4, { withSub: true });
    els.versionNote.textContent = t('measuringVersion');
  }
  try {
    const res = await fetch(`/api/version-adoption${force ? '?force=1' : ''}`);
    const data = await res.json();
    if (res.status === 409 && data.needsConfig) {
      els.versionNote.textContent = data.error;
      els.versionLatest.innerHTML = '';
      return;
    }
    if (!res.ok) throw new Error(data.error || t('errLoadVersion'));
    renderVersionAdoption(data);
  } catch (err) {
    els.versionNote.textContent = err.message;
    els.versionLatest.querySelectorAll('.skeleton-card').forEach((el) => el.remove());
  } finally {
    els.versionBtn.disabled = false;
    els.versionBtn.textContent = t('refresh');
  }
}

function renderVersionAdoption(data) {
  cache.version = data;
  const onLatest = data.onLatest || { total: 0, updates: 0, downloads: 0 };
  const base = data.totalInstallBase;
  const share = data.shareOfBase;
  const ver = escapeHtml(data.latestVersion || '—');
  const prevVer = data.previousVersion ? escapeHtml(data.previousVersion) : null;
  const notOnLatest = data.notOnLatest;
  const notShare = data.notOnLatestShare;

  const relTxt = data.releaseDate
    ? t('versionRelReleased', escapeHtml(String(data.releaseDate).slice(0, 10)))
    : t('versionRelLast', data.windowDays);
  const prevIncl = prevVer ? t('versionInclPrev', prevVer) : '';
  els.versionNote.innerHTML = t(
    'versionNote',
    ver,
    relTxt,
    prevIncl,
    data.coverageFrom,
    data.coverageThrough,
    data.cached
  );

  els.versionLatest.innerHTML = `
    <div class="stat-card stat-card--accent">
      <span class="stat-label">${escapeHtml(t('statUsersOnLatest', ver))}</span>
      <span class="stat-value">${(onLatest.total || 0).toLocaleString()}</span>
      <span class="stat-sub">${escapeHtml(t('versionSubUpdates', (onLatest.updates || 0).toLocaleString(), (onLatest.downloads || 0).toLocaleString()))}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">${escapeHtml(t('statOnOlder'))}</span>
      <span class="stat-value">${notOnLatest != null ? notOnLatest.toLocaleString() : '—'}</span>
      <span class="stat-sub">${escapeHtml(t('versionSubNotLatest', notShare, ver, prevVer))}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">${escapeHtml(t('statTotalInstall'))}</span>
      <span class="stat-value">${base != null ? base.toLocaleString() : '—'}</span>
      <span class="stat-sub">${escapeHtml(t('versionSubAllTime'))}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">${escapeHtml(t('statOnLatestVersion'))}</span>
      <span class="stat-value">${share != null ? share + '%' : '—'}</span>
      <span class="stat-sub">${escapeHtml(t('versionSubFloor'))}</span>
    </div>
  `;

  els.versionPanel.classList.remove('hidden');
}

async function loadRatings({ force = false } = {}) {
  els.ratingsBtn.disabled = true;
  els.ratingsBtn.textContent = force ? t('refreshing') : t('loading');
  try {
    const res = await fetch(`/api/ratings-summary${force ? '?force=1' : ''}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('errLoadRatings'));
    renderRatings(data);
  } catch (err) {
    dashStatus(err.message, true);
  } finally {
    els.ratingsBtn.disabled = false;
    els.ratingsBtn.textContent = t('refreshRatings');
  }
}

function renderRatings(data) {
  cache.ratings = data;
  const written = data.writtenReviews || 0;
  const starOnly = data.starOnlyEstimate ?? Math.max((data.totalRatings || 0) - written, 0);

  els.ratingsSummary.innerHTML = `
    <div class="stat-card">
      <span class="stat-label">${escapeHtml(t('statTotalRatings'))}</span>
      <span class="stat-value">${(data.totalRatings || 0).toLocaleString()}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">${escapeHtml(t('statAvgRating'))}</span>
      <span class="stat-value">${data.averageRating != null ? `${data.averageRating} ★` : '—'}</span>
    </div>
  `;

  els.ratingsSplit.innerHTML = `
    <div class="ratings-split-legend">
      <span>${escapeHtml(t('writtenReviewsColon'))} <strong>${written.toLocaleString()}</strong></span>
      <span>${escapeHtml(t('starOnlyColon'))} <strong>${starOnly.toLocaleString()}</strong></span>
      <span style="color:var(--muted)">${escapeHtml(t('ratingsCachedFrom', data.storefrontsWithRatings, data.storefrontsQueried, data.cached))}</span>
    </div>
  `;

  const top = (data.perStorefront || []).slice(0, 30);
  els.ratingsCountryList.innerHTML = top
    .map(
      (s) =>
        `<div class="ratings-country"><span class="rc-country">${escapeHtml(s.country)}</span><span>${s.count.toLocaleString()} · ${
          s.average != null ? s.average.toFixed(2) + '★' : '—'
        }</span></div>`
    )
    .join('');

  els.ratingsPanel.classList.remove('hidden');
}

/* ============== Star-breakdown editor (manual + screenshot OCR) ============== */

function initStarEditor() {
  if (!els.starEditor) return;
  // Default the date to today.
  if (els.starDate && !els.starDate.value) {
    els.starDate.value = new Date().toISOString().slice(0, 10);
  }
  for (const star of [5, 4, 3, 2, 1]) {
    els.starInputs[star].addEventListener('input', updateStarTotals);
  }
  els.starShotInput.addEventListener('change', onStarScreenshot);
  els.starSaveBtn.addEventListener('click', onSaveStarSnapshot);
  // Paste a screenshot directly (Cmd/Ctrl+V) anywhere while the editor is open.
  document.addEventListener('paste', onStarPaste);
  updateStarTotals();
}

function readStarInputs() {
  const dist = {};
  let total = 0;
  let valid = true;
  for (const star of [5, 4, 3, 2, 1]) {
    const raw = els.starInputs[star].value.trim();
    const n = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      valid = star === 5 && raw === '' ? valid : false;
    }
    const v = Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
    dist[star] = v;
    total += v;
  }
  return { dist, total, valid };
}

function updateStarTotals() {
  const { dist, total } = readStarInputs();
  let weighted = 0;
  for (const star of [5, 4, 3, 2, 1]) weighted += star * dist[star];
  const avg = total > 0 ? (weighted / total).toFixed(2) : null;
  els.starTotals.textContent = t(
    'starTotals',
    total ? total.toLocaleString() : '—',
    avg != null ? avg + '★' : '—'
  );
  els.starSaveBtn.disabled = total <= 0;
}

function setStarMsg(text, isError) {
  els.starEditorMsg.textContent = text || '';
  els.starEditorMsg.classList.toggle('error', Boolean(isError));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(t('couldNotReadFile')));
    reader.readAsDataURL(file);
  });
}

async function onStarScreenshot(evt) {
  const file = evt.target.files && evt.target.files[0];
  if (!file) return;
  try {
    await processStarImage(file);
  } finally {
    evt.target.value = '';
  }
}

/**
 * Handles a clipboard paste of an image (e.g. Cmd+V after a screenshot).
 * Works even when the editor is collapsed: an image paste auto-opens it so the
 * user sees the detected numbers. Plain-text pastes (and pastes into input
 * fields) are left untouched.
 */
async function onStarPaste(evt) {
  if (!els.starEditor) return;
  // Don't hijack pastes into editable fields (text inputs, textareas, etc.).
  const target = evt.target;
  if (
    target &&
    (target.isContentEditable ||
      /^(input|textarea|select)$/i.test(target.tagName || ''))
  ) {
    return;
  }
  const items = evt.clipboardData && evt.clipboardData.items;
  if (!items) return;
  let imageFile = null;
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      imageFile = it.getAsFile();
      break;
    }
  }
  if (!imageFile) return; // not an image paste — let it behave normally
  evt.preventDefault();
  // Reveal the editor (it's collapsed by default) so the result is visible.
  els.starEditor.open = true;
  els.starEditor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  await processStarImage(imageFile);
}

/** Shared OCR flow for an image File/Blob from upload or paste. */
async function processStarImage(file) {
  els.starShotStatus.textContent = t('ocrReading');
  setStarMsg('');
  try {
    const image = await fileToDataUrl(file);
    const res = await fetch('/api/ratings-ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
    });
    const data = await res.json();
    if (!res.ok || !data.distribution) {
      throw new Error(data.error || t('couldNotReadShot'));
    }
    for (const star of [5, 4, 3, 2, 1]) {
      els.starInputs[star].value = data.distribution[star] ?? '';
    }
    updateStarTotals();
    els.starShotStatus.textContent = t('ocrRead');
    const note = data.confident ? '' : t('lowConfidence');
    setStarMsg(t('detectedTotal', Number(data.totalRatings || 0).toLocaleString(), note));
  } catch (err) {
    els.starShotStatus.textContent = '';
    setStarMsg(err.message, true);
  }
}

async function onSaveStarSnapshot() {
  const { dist, total } = readStarInputs();
  if (total <= 0) {
    setStarMsg(t('enterStar'), true);
    return;
  }
  const day = els.starDate.value || new Date().toISOString().slice(0, 10);
  els.starSaveBtn.disabled = true;
  const original = els.starSaveBtn.textContent;
  els.starSaveBtn.textContent = t('saving');
  try {
    const res = await fetch('/api/ratings-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day, distribution: dist }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('errSaveSnapshot'));
    setStarMsg(t('savedBreakdown', fmtDay(day), total.toLocaleString()));
    els.starShotStatus.textContent = '';
    // Refresh the history panel so the new distribution + deltas show.
    loadRatingsHistory();
  } catch (err) {
    setStarMsg(err.message, true);
  } finally {
    els.starSaveBtn.disabled = false;
    els.starSaveBtn.textContent = original;
  }
}

/* ===================== Ratings over time (snapshots) ===================== */

async function loadRatingsHistory() {
  els.ratingsHistoryBtn.disabled = true;
  els.ratingsHistoryBtn.textContent = t('loading');
  try {
    const res = await fetch('/api/ratings-history');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('errLoadHistory'));
    renderRatingsHistory(data);
  } catch (err) {
    els.ratingsHistoryNote.textContent = err.message;
  } finally {
    els.ratingsHistoryBtn.disabled = false;
    els.ratingsHistoryBtn.textContent = t('refresh');
  }
  loadReviewsTimeline();
}

/* ---------- Written-reviews-per-day chart (stacked by star + release) ---------- */

const RT_STAR_COLORS = {
  5: 'var(--rt-5, #2f9e57)',
  4: 'var(--rt-4, #7bc86c)',
  3: 'var(--rt-3, #d9b13b)',
  2: 'var(--rt-2, #e08a3c)',
  1: 'var(--rt-1, #d6453d)',
};

async function loadReviewsTimeline() {
  const days = Number(els.reviewsTimelineRange?.value) || 90;
  try {
    const res = await fetch(`/api/reviews-timeline?days=${days}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('errLoadTimeline'));
    renderReviewsTimeline(data);
    els.reviewsTimeline.classList.remove('hidden');
  } catch (err) {
    els.reviewsTimelineNote.textContent = err.message;
    els.reviewsTimeline.classList.remove('hidden');
  }
}

function renderReviewsTimeline(data) {
  cache.timeline = data;
  const buckets = data.buckets || [];
  const totals = data.totals || { count: 0, avg: null, stars: {} };
  const releases = data.releases || [];

  const relText = releases.length
    ? t(
        'timelineReleaseMarked',
        releases
          .map((r) => `${r.version ? 'v' + r.version + ' ' : ''}${fmtDay(r.date)}`)
          .join(', ')
      )
    : t('timelineNoRelease');
  const avgPart = totals.avg != null ? t('timelineAvgPart', totals.avg) : '';
  els.reviewsTimelineNote.textContent = t('timelineNote', totals.count, data.days, avgPart, relText);

  els.reviewsTimelineChart.innerHTML = buildTimelineSvg(buckets, releases, data.maxDayTotal || 0);
}

function buildTimelineSvg(buckets, releases, maxDayTotal) {
  if (!buckets.length) return `<div class="rt-empty">${escapeHtml(t('noReviewsPeriod'))}</div>`;

  // Geometry
  const W = 880;
  const H = 240;
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = buckets.length;
  const slot = plotW / n;
  const barW = Math.max(1, Math.min(slot * 0.8, 16));

  // Y scale: nice ceiling at least 1.
  const yMax = Math.max(1, maxDayTotal);
  const niceMax = yMax <= 5 ? yMax : Math.ceil(yMax / 5) * 5;
  const yOf = (v) => padT + plotH - (v / niceMax) * plotH;

  // Gridlines (0, mid, max)
  const ticks = [0, Math.round(niceMax / 2), niceMax].filter((v, i, a) => a.indexOf(v) === i);
  let grid = '';
  for (const t of ticks) {
    const y = yOf(t);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="rt-grid"/>`;
    grid += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" class="rt-ytick">${t}</text>`;
  }

  // X index lookup for release markers + month labels.
  const dayIndex = new Map(buckets.map((b, i) => [b.day, i]));
  const xCenter = (i) => padL + slot * i + slot / 2;

  // Bars (stacked 5 at bottom → 1 on top so the worst ratings pop on top).
  let bars = '';
  const order = [5, 4, 3, 2, 1];
  for (let i = 0; i < n; i += 1) {
    const b = buckets[i];
    if (!b.total) continue;
    const x = (xCenter(i) - barW / 2).toFixed(1);
    let yCursor = padT + plotH;
    const segs = order
      .map((star) => {
        const count = b.stars[star] || 0;
        if (!count) return '';
        const h = (count / niceMax) * plotH;
        yCursor -= h;
        return `<rect x="${x}" y="${yCursor.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(
          1
        )}" fill="${RT_STAR_COLORS[star]}" rx="1"/>`;
      })
      .join('');
    const tip = t('timelineTip', fmtDay(b.day), b.total, b.stars[5], b.stars[4], b.stars[3], b.stars[2], b.stars[1]);
    bars += `<g class="rt-bar"><title>${escapeHtml(tip)}</title>${segs}</g>`;
  }

  // Month boundary labels along the X axis.
  let xlabels = '';
  let lastMonth = '';
  for (let i = 0; i < n; i += 1) {
    const month = buckets[i].day.slice(0, 7);
    if (month !== lastMonth) {
      lastMonth = month;
      const x = xCenter(i);
      const label = new Date(`${buckets[i].day}T00:00:00Z`).toLocaleDateString(currentLocale(), {
        month: 'short',
      });
      xlabels += `<text x="${x.toFixed(1)}" y="${H - 8}" class="rt-xtick">${label}</text>`;
    }
  }

  // Release markers (vertical dashed line + flag label).
  let markers = '';
  for (const r of releases) {
    let i = dayIndex.get(r.date);
    if (i == null) {
      // Nearest day if exact not present (shouldn't happen with dense buckets).
      i = buckets.findIndex((b) => b.day >= r.date);
      if (i < 0) i = n - 1;
    }
    const x = xCenter(i);
    const label = r.version ? `v${r.version}` : t('release');
    markers +=
      `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + plotH}" class="rt-release"/>` +
      `<g class="rt-flag"><title>${escapeHtml(`${label} · ${fmtDay(r.date)}`)}</title>` +
      `<rect x="${(x + 3).toFixed(1)}" y="${padT}" width="${Math.max(28, label.length * 7 + 8)}" height="16" rx="3" class="rt-flag-bg"/>` +
      `<text x="${(x + 7).toFixed(1)}" y="${padT + 12}" class="rt-flag-tx">${escapeHtml(label)}</text></g>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" class="rt-svg" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="Written reviews per day, stacked by star rating, with release marker">
    ${grid}${bars}${markers}${xlabels}
  </svg>`;
}

function fmtDay(day) {
  if (!day) return '—';
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Localized label for a comparison period, keyed by its stable key. */
function periodLabel(key, fallback) {
  switch (key) {
    case 'yesterday':
      return t('periodYesterday');
    case 'week':
      return t('periodWeek');
    case 'month':
      return t('periodMonth');
    case 'baseline':
      return t('periodBaseline');
    default:
      return fallback || key;
  }
}

function deltaBadge(value, { suffix = '', decimals = 0 } = {}) {
  if (value == null) return '<span class="delta delta--flat">—</span>';
  const rounded = Number(value.toFixed(decimals));
  if (rounded === 0) return `<span class="delta delta--flat">±0${suffix}</span>`;
  const cls = rounded > 0 ? 'delta--up' : 'delta--down';
  const sign = rounded > 0 ? '+' : '';
  return `<span class="delta ${cls}">${sign}${rounded.toLocaleString()}${suffix}</span>`;
}
// (deltaBadge retained for potential reuse in detailed comparison views.)
void deltaBadge;

function renderRatingsHistory(data) {
  cache.ratingsHistory = data;
  const latest = data.latest;
  if (!latest) {
    els.ratingsHistoryNote.textContent = t('noSnapshots');
    els.ratingsPeriods.innerHTML = '';
    els.ratingsBaselineDist.innerHTML = '';
    els.ratingsTimelineList.innerHTML = '';
    els.ratingsHistoryPanel.classList.remove('hidden');
    return;
  }

  const periods = data.periods || [];
  const hasAny = periods.some((p) => p.available);
  if (!hasAny) {
    els.ratingsHistoryNote.textContent = t(
      'storedSnapshotNote',
      fmtDay(latest.day),
      (latest.totalRatings || 0).toLocaleString()
    );
  } else {
    els.ratingsHistoryNote.innerHTML = t('changeVsEarlier');
  }
  els.ratingsPeriods.innerHTML = periods
    .filter((p) => p.available)
    .map((p) => {
      const ref = p.reference;
      const up = p.totalDelta > 0;
      const flat = p.totalDelta === 0;
      const cls = flat ? 'flat' : up ? 'up' : 'down';
      const sign = up ? '+' : '';
      const avgTxt = p.avgDelta == null ? '' : t('avgDeltaTxt', p.avgDelta);
      // Show the actual reference date (the last snapshot it compares to)
      // instead of a relative label like "vs yesterday".
      const refLabel = t('vsDate', fmtDay(ref.day));
      const periodName = periodLabel(p.key, p.label);
      return `
        <div class="period-card period-card--${cls}">
          <span class="period-label">${escapeHtml(refLabel)}</span>
          <span class="period-delta">${sign}${p.totalDelta.toLocaleString()}</span>
          <span class="period-sub">${sign}${p.totalDeltaPct}% · ${avgTxt}</span>
          <span class="period-foot">${escapeHtml(t('periodFoot', periodName, p.spanDays, p.perDay))}</span>
        </div>`;
    })
    .join('');

  // Per-star deltas table (5★…1★ added since each period).
  renderStarDeltas(data.starComparisons || [], data.starAnchor);

  // Star distribution from the most recent snapshot that carries one.
  const distSnap = data.latestWithDist;
  if (distSnap && distSnap.distribution) {
    const dist = distSnap.distribution;
    const max = Math.max(...[1, 2, 3, 4, 5].map((s) => dist[s] || 0)) || 1;
    els.ratingsBaselineDist.innerHTML =
      `<div class="dist-title">${escapeHtml(t('starBreakdownTitle', fmtDay(distSnap.day)))}</div>` +
      [5, 4, 3, 2, 1]
        .map((star) => {
          const n = dist[star] || 0;
          const w = Math.max(1, Math.round((n / max) * 100));
          return `<div class="dist-row">
            <span class="dist-star">${'★'.repeat(star)}</span>
            <span class="dist-bar"><span class="dist-bar-fill dist-${star}" style="width:${w}%"></span></span>
            <span class="dist-num">${n.toLocaleString()}</span>
          </div>`;
        })
        .join('');
  } else {
    els.ratingsBaselineDist.innerHTML = '';
  }

  // Timeline list (newest first).
  const rows = (data.snapshots || []).slice().reverse();
  els.ratingsTimelineList.innerHTML = rows
    .map(
      (s) =>
        `<div class="ratings-country"><span class="rc-country">${fmtDay(s.day)} · ${escapeHtml(
          s.source
        )}</span><span>${(s.totalRatings || 0).toLocaleString()} · ${
          s.averageRating != null ? s.averageRating + '★' : '—'
        }</span></div>`
    )
    .join('');

  els.ratingsHistoryPanel.classList.remove('hidden');
}

function starCell(n) {
  if (n == null) return '<td class="sd-num sd-flat">—</td>';
  if (n === 0) return '<td class="sd-num sd-flat">±0</td>';
  const cls = n > 0 ? 'sd-up' : 'sd-down';
  const sign = n > 0 ? '+' : '';
  return `<td class="sd-num ${cls}">${sign}${n.toLocaleString()}</td>`;
}

/**
 * Renders a table of how many of each star rating were added per period.
 * Only periods whose endpoints both have a star distribution appear.
 */
function renderStarDeltas(rows, anchor) {
  if (!rows.length || !anchor) {
    els.ratingsStarDeltas.innerHTML = '';
    return;
  }
  const header =
    `<tr><th>${escapeHtml(t('starsHeader'))}</th>` +
    rows
      .map(
        (r) =>
          `<th>${escapeHtml(t('vsDate', fmtDay(r.reference.day)))}<span class="sd-since">${escapeHtml(periodLabel(r.key, r.label))}</span></th>`
      )
      .join('') +
    `</tr>`;

  const body = [5, 4, 3, 2, 1]
    .map((star) => {
      const cells = rows.map((r) => starCell(r.perStar[star])).join('');
      return `<tr><td class="sd-star">${'★'.repeat(star)}</td>${cells}</tr>`;
    })
    .join('');

  const totalRow =
    `<tr class="sd-total"><td class="sd-star">${escapeHtml(t('totalRow'))}</td>` +
    rows.map((r) => starCell(r.total)).join('') +
    `</tr>`;

  els.ratingsStarDeltas.innerHTML = `
    <div class="sd-title">${escapeHtml(t('starAddedTitle', fmtDay(anchor.day)))}</div>
    <table class="sd-table">
      <thead>${header}</thead>
      <tbody>${body}${totalRow}</tbody>
    </table>
    <p class="sd-foot">${escapeHtml(t('starDeltasFoot'))}</p>
  `;
}

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return t('justNow');
  if (mins < 60) return t('timeAgoMin', mins);
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t('timeAgoHr', hrs);
  const days = Math.round(hrs / 24);
  return t('timeAgoDay', days);
}

function stars(rating) {
  if (typeof rating !== 'number') return '';
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

function formatDate(iso, locale) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale || currentLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
