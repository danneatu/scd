'use strict';

/*
 * Lightweight UI internationalization (English / German).
 *
 * Only the app's own chrome is translated. Content that originates elsewhere —
 * the written reviews themselves and the AI-generated analysis text — is left in
 * its original language on purpose.
 *
 * Values are either plain strings or functions (for interpolation / plurals).
 * Use t('key') or t('key', ...args). Missing keys fall back to English, then to
 * the key name itself.
 */

const I18N = {
  en: {
    /* Header */
    appTitle: 'App Ratings Analyzer',
    appSubtitle: 'Customer reviews via the App Store Connect API',
    themeDark: 'Dark',
    themeLight: 'Light',

    /* Config warning */
    configWarning:
      '<strong>Credentials not configured.</strong> Add your <code>ASC_ISSUER_ID</code>, ' +
      '<code>ASC_KEY_ID</code>, and private key to a <code>.env</code> file ' +
      '(see <code>.env.example</code>), then restart the server.',

    /* Dashboard controls */
    btnSync: 'Sync',
    btnTestEmail: 'Test email',

    /* View tabs */
    tabRatings: 'Ratings & reviews',
    tabDownloads: 'Downloads & adoption',

    /* Ratings overview */
    ratingsOverviewTitle: 'Ratings overview (all storefronts)',
    ratingsOverviewNote:
      'All-time totals from the public App Store, including <strong>star-only ratings</strong> ' +
      '(which the written-reviews API never returns).',
    topStorefronts: 'Top storefronts by ratings',
    statTotalRatings: 'Total ratings (all-time)',
    statAvgRating: 'Average rating',
    statWrittenCollected: 'Written reviews collected',
    statStarOnly: 'Star-only (approx.)',
    writtenReviewsColon: 'Written reviews:',
    starOnlyColon: 'Star-only (approx.):',
    ratingsCachedFrom: (withR, queried, cached) =>
      `From ${withR}/${queried} storefronts${cached ? ' · cached' : ''}`,

    /* Ratings over time */
    ratingsOverTimeTitle: 'Ratings over time',
    ratingsHistoryDefaultNote:
      'Compares the earliest stored snapshot with the latest. Today’s total is captured ' +
      'automatically each time ratings load, so the comparison grows over time.',
    noSnapshots: 'No snapshots stored yet.',
    changeVsEarlier:
      'Change in total ratings vs. earlier stored snapshots. New daily snapshots are captured ' +
      'automatically, so more periods unlock over time.',
    storedSnapshotNote: (day, total) =>
      `Stored ${day}’s snapshot (${total} ratings). Comparisons against yesterday / last week / ` +
      `last month will appear as more daily snapshots accumulate.`,
    vsDate: (date) => `vs ${date}`,
    avgDeltaTxt: (value) =>
      value === 0 ? '±0.00★ avg' : `${value > 0 ? '+' : ''}${value}★ avg`,
    periodFoot: (label, spanDays, perDay) => `${label} · ${spanDays}d · ~${perDay}/day`,
    periodYesterday: 'vs yesterday',
    periodWeek: 'vs last week',
    periodMonth: 'vs last month',
    periodBaseline: 'vs baseline',
    starsHeader: 'Stars',
    totalRow: 'Total',
    starBreakdownTitle: (day) => `Star breakdown — ${day}`,
    starAddedTitle: (day) =>
      `Ratings added by star — anchored on ${day} (latest star breakdown)`,
    starDeltasFoot:
      'Per-star changes need a star breakdown at both ends, which comes from App Store Connect ' +
      'screenshots. Add a fresh ASC snapshot to extend this.',

    /* Reviews-per-day timeline */
    reviewsPerDayTitle: 'Written reviews per day',
    range90: 'Last 90 days',
    range180: 'Last 180 days',
    range365: 'Last year',
    release: 'Release',
    noReviewsPeriod: 'No reviews in this period.',
    timelineAvgPart: (avg) => ` · avg ${avg}★`,
    timelineReleaseMarked: (list) => ` · release ${list} marked`,
    timelineNoRelease: ' · no release in this window',
    timelineNote: (count, days, avgPart, relText) =>
      `${count} written review${count === 1 ? '' : 's'} over ${days} days${avgPart}${relText}.`,
    timelineTip: (day, total, s5, s4, s3, s2, s1) =>
      `${day} — ${total} review${total === 1 ? '' : 's'} (5★:${s5} 4★:${s4} 3★:${s3} 2★:${s2} 1★:${s1})`,

    /* Star-breakdown editor */
    starEditorTitle: 'Update star breakdown (from App Store Connect)',
    starEditorNote:
      'Apple’s API doesn’t expose the 5★…1★ split, so add it here. Upload ' +
      '<strong>or just paste a screenshot</strong> (⌘V / Ctrl+V) of the App Store Connect ' +
      'ratings popover to auto-fill (read locally, never uploaded anywhere) — then confirm and save.',
    uploadScreenshot: 'Upload screenshot',
    orPaste: 'or paste (⌘V / Ctrl+V)',
    date: 'Date',
    saveSnapshot: 'Save snapshot',
    snapshotHistory: 'Snapshot history',
    starTotals: (total, avg) => `Total: ${total} · Avg: ${avg}`,
    ocrReading: 'Reading… (first run downloads the OCR model, ~a moment)',
    ocrRead: '✓ Read from screenshot — please verify the numbers.',
    lowConfidence: ' (low confidence — double-check)',
    detectedTotal: (n, note) => `Detected total ${n}${note}. Adjust if needed, then Save.`,
    enterStar: 'Enter at least one star count.',
    savedBreakdown: (day, total) => `✓ Saved breakdown for ${day} (${total} ratings).`,
    couldNotReadShot: 'Could not read the screenshot.',
    couldNotReadFile: 'Could not read the file.',

    /* Monthly insights / report */
    monthlyInsights: 'Monthly insights',
    monthlyInsightsMonth: (month) => `Monthly insights — ${month}`,
    painTitle: '😖 Biggest pain points',
    praiseTitle: '😊 What users love',
    actionsTitle: '✅ Suggested actions',
    aiSummary: 'AI summary',
    localAnalysis: 'Local analysis',
    cachedSuffix: ' (cached)',
    noPain: 'No notable complaints this month.',
    noPraise: 'No standout praise yet this month.',
    monthlyAnalysis: '📊 Monthly analysis',
    aiAgentLlm: 'AI agent + LLM',
    aiAgentLocal: 'AI agent (local skills)',
    risingVsMonth: 'Rising vs last month',
    fallingVsMonth: 'Falling vs last month',
    newThisMonth: 'New this month',
    newBadge: 'NEW',

    /* Written reviews */
    writtenReviewsTitle: 'Written reviews',
    exportPdf: 'Export PDF',
    writtenDefaultNote:
      'Day-by-day listing of written reviews, with a multi-month overview and a printable ' +
      'monthly report. Synced automatically every day.',
    writtenNote: (selLabels, total, avg, unansweredHtml) =>
      `<strong>${selLabels}</strong> · ${total} written review(s) · Ø ${avg}${unansweredHtml}. ` +
      `Pick one or more months below; synced automatically each day.`,
    needsReply: (n) => `${n} need${n === 1 ? 's' : ''} a reply`,
    allReplied: 'all replied ✓',
    reviewsCount: (n) => `${n} review${n === 1 ? '' : 's'}`,
    noMonths: 'No months with reviews yet.',
    monthsLabel: 'Months:',
    answered: '✓ Answered',
    needsReplyBadge: 'Needs reply',
    replied: 'Replied',
    repliedOn: (date) => `Replied ${date}`,
    yourReply: 'Your reply:',
    showAllReviews: 'Show all written reviews',
    tapToCollapse: ' (tap to collapse)',
    noWrittenSelected: 'No written reviews for the selected month(s).',
    noWrittenMonth: 'No written reviews this month.',
    anonymous: 'Anonymous',

    /* Version adoption */
    versionTitle: 'Latest version adoption',
    versionDefaultNote:
      'How many devices have moved onto the latest version vs. the total install base.',
    measuringVersion: 'Measuring latest-version adoption from Sales Reports…',
    versionRelReleased: (date) => `released ${date}`,
    versionRelLast: (days) => `last ${days} days`,
    versionInclPrev: (prevVer) => ` (incl. v${prevVer} and earlier)`,
    versionNote: (ver, relTxt, prevIncl, from, through, cached) =>
      `Devices that moved onto <strong>v${ver}</strong> (fresh installs + updates since it ${relTxt}), ` +
      `compared with the all-time install base. “On an older version” covers everyone not yet on ` +
      `v${ver}${prevIncl} — Sales Reports can’t split that across individual old versions; that ` +
      `needs App Analytics. Coverage ${from} → ${through}.${cached ? ' · cached' : ''}`,
    statUsersOnLatest: (ver) => `Users on latest (v${ver})`,
    statOnOlder: 'On an older version',
    statTotalInstall: 'Total install base',
    statOnLatestVersion: 'On latest version',
    versionSubUpdates: (updates, downloads) =>
      `${updates} updated · ${downloads} new installs`,
    versionSubNotLatest: (share, ver, prevVer) =>
      `${share != null ? share + '% — not yet on v' + ver : 'not yet on v' + ver}` +
      `${prevVer ? ' (incl. v' + prevVer + ')' : ''}`,
    versionSubAllTime: 'all-time first-time downloads',
    versionSubFloor: 'of the install base (floor)',

    /* Downloads */
    downloadsTitle: 'Downloads',
    downloadsDefaultNote:
      'First-time app downloads from App Store Connect <strong>Sales Reports</strong>.',
    downloadsNote: (fromYear, throughDate, cached) =>
      `First-time app downloads from App Store Connect <strong>Sales Reports</strong>. ` +
      `Coverage: ${fromYear}–present (through ${throughDate})${cached ? ' · cached' : ''}`,
    crunchingDownloads:
      'Crunching Sales Reports across all available periods… this can take a few seconds.',
    topCountries: 'Top countries by downloads',
    statAllTimeDownloads: 'All-time downloads',
    statYearToDate: 'Year to date',
    statMonthToDate: 'Month to date',
    statLast30: 'Last 30 days',

    /* Dashboard status / sync */
    dashLastSync: (ago, fetched, inserted, count, month) =>
      `Last sync ${ago} · ${fetched} fetched, ${inserted} new · ${count} written review(s) in ${month}.`,
    dashStored: (count, month) => `${count} written review(s) stored for ${month}.`,
    syncing: 'Syncing…',
    syncStart: 'Syncing the last 90 days of reviews from App Store Connect…',
    syncRefreshing: (fetched, inserted) =>
      `Synced ${fetched} fetched, ${inserted} new — refreshing ratings & analysis…`,
    syncComplete: '✅ Sync complete.',
    syncFailed: (msg) => `❌ Sync failed: ${msg}`,
    sending: 'Sending…',
    sendTestEmail: 'Sending test email…',
    testEmailSent: (to, transport, count) =>
      `✅ Test email sent to ${to} via ${transport} (previewed ${count} review${count === 1 ? '' : 's'}). ` +
      `Check your inbox.`,
    testEmailFailed: (msg) => `❌ Test email failed: ${msg}`,
    generatingReport: 'Pulling this month’s reviews and analyzing themes…',
    popupBlocked: 'Pop-up blocked. Allow pop-ups to export the PDF.',

    /* Config badge */
    aiBadge: (provider, model, free) => `AI: ${provider} (${model})${free ? ' · free' : ''}`,
    localHeuristicBadge: 'Local heuristic (add a free LLM key for richer summaries)',
    notifyTitle: (to, transport) => `Daily email to ${to} via ${transport}`,

    /* Button reset labels */
    loading: 'Loading…',
    refreshing: 'Refreshing…',
    saving: 'Saving…',
    refresh: 'Refresh',
    refreshRatings: 'Refresh ratings',
    refreshDownloads: 'Refresh downloads',

    /* Explore (ad-hoc) section */
    exploreTitle: 'Explore reviews (ad-hoc, live)',
    appIdLabel: 'App ID',
    maxReviewsLabel: 'Max reviews',
    territoryLabel: 'Territory (optional)',
    territoryPlaceholder: 'e.g. USA',
    sortLabel: 'Sort',
    sortNewest: 'Newest first',
    sortOldest: 'Oldest first',
    sortHighest: 'Highest rating',
    sortLowest: 'Lowest rating',
    btnFetch: 'Fetch reviews',
    fetching: 'Fetching…',
    statTotalReviews: 'Total reviews',
    statOldest: 'Oldest',
    statNewest: 'Newest',
    ratingDistribution: 'Rating distribution',
    reviewsTitle: 'Reviews',
    filterRatingLabel: 'Filter rating',
    filterAll: 'All',
    exportJson: 'Export JSON',
    pleaseEnterAppId: 'Please enter an App ID.',
    fetchingReviews: 'Fetching reviews from App Store Connect…',
    loadedReviews: (count) => `Loaded ${count} review${count === 1 ? '' : 's'}.`,
    requestFailed: (status) => `Request failed (${status}).`,
    noReviewsFilter: 'No reviews match the current filter.',
    noTitle: '(no title)',
    byAuthor: (name) => `by ${name}`,

    /* Relative time */
    justNow: 'just now',
    timeAgoMin: (m) => `${m}m ago`,
    timeAgoHr: (h) => `${h}h ago`,
    timeAgoDay: (d) => `${d}d ago`,

    /* Error fallbacks */
    errLoadRatings: 'Failed to load ratings.',
    errLoadDashboard: 'Failed to load dashboard.',
    errLoadDownloads: 'Failed to load downloads.',
    errLoadVersion: 'Failed to load version adoption.',
    errLoadHistory: 'Failed to load ratings history.',
    errLoadTimeline: 'Failed to load reviews timeline.',
    errLoadWritten: 'Failed to load written reviews.',
    errSync: 'Sync failed.',
    errReport: 'Report failed.',
    errTestEmail: 'Test email failed.',
    errSaveSnapshot: 'Failed to save snapshot.',
  },

  de: {
    /* Header */
    appTitle: 'App-Bewertungs-Analyse',
    appSubtitle: 'Kundenrezensionen über die App Store Connect API',
    themeDark: 'Dunkel',
    themeLight: 'Hell',

    /* Config warning */
    configWarning:
      '<strong>Zugangsdaten nicht konfiguriert.</strong> Füge <code>ASC_ISSUER_ID</code>, ' +
      '<code>ASC_KEY_ID</code> und den privaten Schlüssel in eine <code>.env</code>-Datei ein ' +
      '(siehe <code>.env.example</code>) und starte den Server neu.',

    /* Dashboard controls */
    btnSync: 'Synchronisieren',
    btnTestEmail: 'Test-E-Mail',

    /* View tabs */
    tabRatings: 'Bewertungen & Rezensionen',
    tabDownloads: 'Downloads & Verbreitung',

    /* Ratings overview */
    ratingsOverviewTitle: 'Bewertungsübersicht (alle Stores)',
    ratingsOverviewNote:
      'Gesamtwerte aus dem öffentlichen App Store, inklusive <strong>reiner Sternebewertungen</strong> ' +
      '(die die Rezensions-API nie zurückgibt).',
    topStorefronts: 'Top-Stores nach Bewertungen',
    statTotalRatings: 'Bewertungen gesamt',
    statAvgRating: 'Durchschnittsbewertung',
    statWrittenCollected: 'Erfasste schriftliche Rezensionen',
    statStarOnly: 'Nur Sterne (ca.)',
    writtenReviewsColon: 'Schriftliche Rezensionen:',
    starOnlyColon: 'Nur Sterne (ca.):',
    ratingsCachedFrom: (withR, queried, cached) =>
      `Aus ${withR}/${queried} Stores${cached ? ' · zwischengespeichert' : ''}`,

    /* Ratings over time */
    ratingsOverTimeTitle: 'Bewertungen im Zeitverlauf',
    ratingsHistoryDefaultNote:
      'Vergleicht den ältesten gespeicherten Snapshot mit dem neuesten. Der heutige Gesamtwert wird ' +
      'bei jedem Laden automatisch erfasst, sodass der Vergleich mit der Zeit wächst.',
    noSnapshots: 'Noch keine Snapshots gespeichert.',
    changeVsEarlier:
      'Veränderung der Gesamtbewertungen gegenüber früheren Snapshots. Neue Tages-Snapshots werden ' +
      'automatisch erfasst, sodass mit der Zeit mehr Zeiträume verfügbar werden.',
    storedSnapshotNote: (day, total) =>
      `Snapshot vom ${day} gespeichert (${total} Bewertungen). Vergleiche mit gestern / letzter Woche / ` +
      `letztem Monat erscheinen, sobald mehr Tages-Snapshots vorliegen.`,
    vsDate: (date) => `vs. ${date}`,
    avgDeltaTxt: (value) =>
      value === 0 ? '±0,00★ Ø' : `${value > 0 ? '+' : ''}${value}★ Ø`,
    periodFoot: (label, spanDays, perDay) => `${label} · ${spanDays}T · ~${perDay}/Tag`,
    periodYesterday: 'vs. gestern',
    periodWeek: 'vs. letzter Woche',
    periodMonth: 'vs. letztem Monat',
    periodBaseline: 'vs. Beginn',
    starsHeader: 'Sterne',
    totalRow: 'Gesamt',
    starBreakdownTitle: (day) => `Sterneverteilung — ${day}`,
    starAddedTitle: (day) =>
      `Hinzugekommene Bewertungen nach Sternen — Stichtag ${day} (neueste Sterneverteilung)`,
    starDeltasFoot:
      'Sternegenaue Änderungen brauchen an beiden Enden eine Sterneverteilung aus ' +
      'App-Store-Connect-Screenshots. Füge einen neuen ASC-Snapshot hinzu, um dies zu erweitern.',

    /* Reviews-per-day timeline */
    reviewsPerDayTitle: 'Schriftliche Rezensionen pro Tag',
    range90: 'Letzte 90 Tage',
    range180: 'Letzte 180 Tage',
    range365: 'Letztes Jahr',
    release: 'Release',
    noReviewsPeriod: 'Keine Rezensionen in diesem Zeitraum.',
    timelineAvgPart: (avg) => ` · Ø ${avg}★`,
    timelineReleaseMarked: (list) => ` · Release ${list} markiert`,
    timelineNoRelease: ' · kein Release in diesem Zeitraum',
    timelineNote: (count, days, avgPart, relText) =>
      `${count} schriftliche Rezension${count === 1 ? '' : 'en'} über ${days} Tage${avgPart}${relText}.`,
    timelineTip: (day, total, s5, s4, s3, s2, s1) =>
      `${day} — ${total} Rezension${total === 1 ? '' : 'en'} (5★:${s5} 4★:${s4} 3★:${s3} 2★:${s2} 1★:${s1})`,

    /* Star-breakdown editor */
    starEditorTitle: 'Sterneverteilung aktualisieren (aus App Store Connect)',
    starEditorNote:
      'Apples API liefert die Aufteilung 5★…1★ nicht, daher hier ergänzen. Lade ' +
      '<strong>oder füge einfach einen Screenshot ein</strong> (⌘V / Strg+V) des ' +
      'App-Store-Connect-Bewertungsfensters, um automatisch auszufüllen (lokal gelesen, nie ' +
      'hochgeladen) — dann prüfen und speichern.',
    uploadScreenshot: 'Screenshot hochladen',
    orPaste: 'oder einfügen (⌘V / Strg+V)',
    date: 'Datum',
    saveSnapshot: 'Snapshot speichern',
    snapshotHistory: 'Snapshot-Verlauf',
    starTotals: (total, avg) => `Gesamt: ${total} · Ø: ${avg}`,
    ocrReading: 'Lese… (beim ersten Mal wird das OCR-Modell geladen, einen Moment)',
    ocrRead: '✓ Aus Screenshot gelesen — bitte Zahlen prüfen.',
    lowConfidence: ' (geringe Sicherheit — bitte prüfen)',
    detectedTotal: (n, note) => `Erkannte Gesamtzahl ${n}${note}. Bei Bedarf anpassen, dann Speichern.`,
    enterStar: 'Mindestens eine Sterneanzahl eingeben.',
    savedBreakdown: (day, total) => `✓ Verteilung für ${day} gespeichert (${total} Bewertungen).`,
    couldNotReadShot: 'Screenshot konnte nicht gelesen werden.',
    couldNotReadFile: 'Datei konnte nicht gelesen werden.',

    /* Monthly insights / report */
    monthlyInsights: 'Monatliche Einblicke',
    monthlyInsightsMonth: (month) => `Monatliche Einblicke — ${month}`,
    painTitle: '😖 Größte Kritikpunkte',
    praiseTitle: '😊 Was Nutzer schätzen',
    actionsTitle: '✅ Empfohlene Maßnahmen',
    aiSummary: 'KI-Zusammenfassung',
    localAnalysis: 'Lokale Analyse',
    cachedSuffix: ' (zwischengespeichert)',
    noPain: 'Keine nennenswerten Beschwerden in diesem Monat.',
    noPraise: 'Noch kein herausragendes Lob in diesem Monat.',
    monthlyAnalysis: '📊 Monatsanalyse',
    aiAgentLlm: 'KI-Agent + LLM',
    aiAgentLocal: 'KI-Agent (lokale Skills)',
    risingVsMonth: 'Steigend ggü. letztem Monat',
    fallingVsMonth: 'Fallend ggü. letztem Monat',
    newThisMonth: 'Neu in diesem Monat',
    newBadge: 'NEU',

    /* Written reviews */
    writtenReviewsTitle: 'Schriftliche Rezensionen',
    exportPdf: 'PDF exportieren',
    writtenDefaultNote:
      'Tag-für-Tag-Auflistung schriftlicher Rezensionen, mit Mehrmonatsübersicht und druckbarem ' +
      'Monatsbericht. Wird täglich automatisch synchronisiert.',
    writtenNote: (selLabels, total, avg, unansweredHtml) =>
      `<strong>${selLabels}</strong> · ${total} schriftliche Rezension(en) · Ø ${avg}${unansweredHtml}. ` +
      `Wähle unten einen oder mehrere Monate; täglich automatisch synchronisiert.`,
    needsReply: (n) => `${n} ${n === 1 ? 'braucht' : 'brauchen'} eine Antwort`,
    allReplied: 'alle beantwortet ✓',
    reviewsCount: (n) => `${n} Rezension${n === 1 ? '' : 'en'}`,
    noMonths: 'Noch keine Monate mit Rezensionen.',
    monthsLabel: 'Monate:',
    answered: '✓ Beantwortet',
    needsReplyBadge: 'Antwort nötig',
    replied: 'Beantwortet',
    repliedOn: (date) => `Beantwortet ${date}`,
    yourReply: 'Deine Antwort:',
    showAllReviews: 'Alle schriftlichen Rezensionen anzeigen',
    tapToCollapse: ' (zum Einklappen tippen)',
    noWrittenSelected: 'Keine schriftlichen Rezensionen für die gewählten Monate.',
    noWrittenMonth: 'Keine schriftlichen Rezensionen in diesem Monat.',
    anonymous: 'Anonym',

    /* Version adoption */
    versionTitle: 'Verbreitung der neuesten Version',
    versionDefaultNote:
      'Wie viele Geräte auf die neueste Version gewechselt sind, im Vergleich zur gesamten ' +
      'Installationsbasis.',
    measuringVersion: 'Ermittle Verbreitung der neuesten Version aus Verkaufsberichten…',
    versionRelReleased: (date) => `veröffentlicht am ${date}`,
    versionRelLast: (days) => `letzte ${days} Tage`,
    versionInclPrev: (prevVer) => ` (inkl. v${prevVer} und früher)`,
    versionNote: (ver, relTxt, prevIncl, from, through, cached) =>
      `Geräte, die auf <strong>v${ver}</strong> gewechselt sind (Neuinstallationen + Updates seit ` +
      `${relTxt}), im Vergleich zur gesamten Installationsbasis. „Auf älterer Version“ umfasst alle, ` +
      `die noch nicht auf v${ver} sind${prevIncl} — Verkaufsberichte können das nicht nach einzelnen ` +
      `alten Versionen aufschlüsseln; dafür braucht es App Analytics. Zeitraum ${from} → ${through}.` +
      `${cached ? ' · zwischengespeichert' : ''}`,
    statUsersOnLatest: (ver) => `Nutzer auf neuester (v${ver})`,
    statOnOlder: 'Auf älterer Version',
    statTotalInstall: 'Gesamte Installationsbasis',
    statOnLatestVersion: 'Auf neuester Version',
    versionSubUpdates: (updates, downloads) =>
      `${updates} aktualisiert · ${downloads} Neuinstallationen`,
    versionSubNotLatest: (share, ver, prevVer) =>
      `${share != null ? share + '% — noch nicht auf v' + ver : 'noch nicht auf v' + ver}` +
      `${prevVer ? ' (inkl. v' + prevVer + ')' : ''}`,
    versionSubAllTime: 'gesamte Erstinstallationen',
    versionSubFloor: 'der Installationsbasis (Untergrenze)',

    /* Downloads */
    downloadsTitle: 'Downloads',
    downloadsDefaultNote:
      'Erstmalige App-Downloads aus App Store Connect <strong>Verkaufsberichten</strong>.',
    downloadsNote: (fromYear, throughDate, cached) =>
      `Erstmalige App-Downloads aus App Store Connect <strong>Verkaufsberichten</strong>. ` +
      `Zeitraum: ${fromYear}–heute (bis ${throughDate})${cached ? ' · zwischengespeichert' : ''}`,
    crunchingDownloads:
      'Werte Verkaufsberichte über alle verfügbaren Zeiträume aus… das kann ein paar Sekunden dauern.',
    topCountries: 'Top-Länder nach Downloads',
    statAllTimeDownloads: 'Downloads gesamt',
    statYearToDate: 'Seit Jahresbeginn',
    statMonthToDate: 'Seit Monatsbeginn',
    statLast30: 'Letzte 30 Tage',

    /* Dashboard status / sync */
    dashLastSync: (ago, fetched, inserted, count, month) =>
      `Letzte Synchronisierung ${ago} · ${fetched} abgerufen, ${inserted} neu · ${count} schriftliche ` +
      `Rezension(en) in ${month}.`,
    dashStored: (count, month) => `${count} schriftliche Rezension(en) für ${month} gespeichert.`,
    syncing: 'Synchronisiere…',
    syncStart: 'Synchronisiere die letzten 90 Tage an Rezensionen aus App Store Connect…',
    syncRefreshing: (fetched, inserted) =>
      `${fetched} abgerufen, ${inserted} neu — aktualisiere Bewertungen & Analyse…`,
    syncComplete: '✅ Synchronisierung abgeschlossen.',
    syncFailed: (msg) => `❌ Synchronisierung fehlgeschlagen: ${msg}`,
    sending: 'Sende…',
    sendTestEmail: 'Sende Test-E-Mail…',
    testEmailSent: (to, transport, count) =>
      `✅ Test-E-Mail an ${to} über ${transport} gesendet (Vorschau mit ${count} ` +
      `Rezension${count === 1 ? '' : 'en'}). Prüfe dein Postfach.`,
    testEmailFailed: (msg) => `❌ Test-E-Mail fehlgeschlagen: ${msg}`,
    generatingReport: 'Rufe die Rezensionen dieses Monats ab und analysiere Themen…',
    popupBlocked: 'Pop-up blockiert. Erlaube Pop-ups, um das PDF zu exportieren.',

    /* Config badge */
    aiBadge: (provider, model, free) => `KI: ${provider} (${model})${free ? ' · kostenlos' : ''}`,
    localHeuristicBadge:
      'Lokale Heuristik (füge einen kostenlosen LLM-Schlüssel für bessere Zusammenfassungen hinzu)',
    notifyTitle: (to, transport) => `Tägliche E-Mail an ${to} über ${transport}`,

    /* Button reset labels */
    loading: 'Lädt…',
    refreshing: 'Aktualisiere…',
    saving: 'Speichere…',
    refresh: 'Aktualisieren',
    refreshRatings: 'Bewertungen aktualisieren',
    refreshDownloads: 'Downloads aktualisieren',

    /* Explore (ad-hoc) section */
    exploreTitle: 'Rezensionen erkunden (ad hoc, live)',
    appIdLabel: 'App-ID',
    maxReviewsLabel: 'Max. Rezensionen',
    territoryLabel: 'Region (optional)',
    territoryPlaceholder: 'z. B. USA',
    sortLabel: 'Sortierung',
    sortNewest: 'Neueste zuerst',
    sortOldest: 'Älteste zuerst',
    sortHighest: 'Höchste Bewertung',
    sortLowest: 'Niedrigste Bewertung',
    btnFetch: 'Rezensionen abrufen',
    fetching: 'Rufe ab…',
    statTotalReviews: 'Rezensionen gesamt',
    statOldest: 'Älteste',
    statNewest: 'Neueste',
    ratingDistribution: 'Bewertungsverteilung',
    reviewsTitle: 'Rezensionen',
    filterRatingLabel: 'Nach Bewertung filtern',
    filterAll: 'Alle',
    exportJson: 'JSON exportieren',
    pleaseEnterAppId: 'Bitte eine App-ID eingeben.',
    fetchingReviews: 'Rufe Rezensionen aus App Store Connect ab…',
    loadedReviews: (count) => `${count} Rezension${count === 1 ? '' : 'en'} geladen.`,
    requestFailed: (status) => `Anfrage fehlgeschlagen (${status}).`,
    noReviewsFilter: 'Keine Rezensionen entsprechen dem aktuellen Filter.',
    noTitle: '(kein Titel)',
    byAuthor: (name) => `von ${name}`,

    /* Relative time */
    justNow: 'gerade eben',
    timeAgoMin: (m) => `vor ${m} Min.`,
    timeAgoHr: (h) => `vor ${h} Std.`,
    timeAgoDay: (d) => `vor ${d} Tagen`,

    /* Error fallbacks */
    errLoadRatings: 'Bewertungen konnten nicht geladen werden.',
    errLoadDashboard: 'Dashboard konnte nicht geladen werden.',
    errLoadDownloads: 'Downloads konnten nicht geladen werden.',
    errLoadVersion: 'Versionsverbreitung konnte nicht geladen werden.',
    errLoadHistory: 'Bewertungsverlauf konnte nicht geladen werden.',
    errLoadTimeline: 'Rezensions-Zeitverlauf konnte nicht geladen werden.',
    errLoadWritten: 'Schriftliche Rezensionen konnten nicht geladen werden.',
    errSync: 'Synchronisierung fehlgeschlagen.',
    errReport: 'Bericht fehlgeschlagen.',
    errTestEmail: 'Test-E-Mail fehlgeschlagen.',
    errSaveSnapshot: 'Snapshot konnte nicht gespeichert werden.',
  },
};

let currentLang = (function () {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'en' || saved === 'de') return saved;
  } catch (e) {
    /* localStorage unavailable */
  }
  try {
    if ((navigator.language || '').toLowerCase().startsWith('de')) return 'de';
  } catch (e) {
    /* navigator unavailable */
  }
  return 'en';
})();

/** Returns the active language code ('en' | 'de'). */
function getLang() {
  return currentLang;
}

/** Sets and persists the active language. */
function setLang(lang) {
  currentLang = lang === 'de' ? 'de' : 'en';
  try {
    localStorage.setItem('lang', currentLang);
  } catch (e) {
    /* localStorage unavailable */
  }
  return currentLang;
}

/** Locale string for Intl/date formatting based on the active language. */
function currentLocale() {
  return currentLang === 'de' ? 'de-DE' : 'en-US';
}

/** Translate a key; strings are returned as-is, functions are invoked with args. */
function t(key, ...args) {
  const dict = I18N[currentLang] || I18N.en;
  let v = dict[key];
  if (v == null) v = I18N.en[key];
  if (v == null) return key;
  return typeof v === 'function' ? v(...args) : v;
}

/** Applies translations to all elements carrying data-i18n* attributes. */
function applyStaticTranslations(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = t(el.getAttribute('data-i18n'));
    if (v != null) el.textContent = v;
  });
  scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const v = t(el.getAttribute('data-i18n-html'));
    if (v != null) el.innerHTML = v;
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const v = t(el.getAttribute('data-i18n-placeholder'));
    if (v != null) el.setAttribute('placeholder', v);
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const v = t(el.getAttribute('data-i18n-title'));
    if (v != null) el.setAttribute('title', v);
  });
  document.documentElement.setAttribute('lang', currentLang);
}
