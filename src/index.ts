import {
  CityModalState,
  renderCityPickerModal,
  runBrowserApproximateLocation,
} from './components/CityPickerModal';
import { PACKAGED_CITIES } from './data/citiesDataset';
import {
  PRODUCTION_EMPTY_ENVELOPE,
  STAGE1_OFFICIAL_LINK_ENVELOPE,
  TEST_FIXTURE_ENVELOPE,
} from './data/feedsData';
import { SOURCE_ALLOWLIST_LEDGER } from './data/sourcesLedger';
import {
  ALL_PREFERRED_CATEGORIES,
  appendBoundedLog,
  DEFAULT_CATEGORY_PREFERENCES,
  DEFAULT_CIRCUIT_BREAKER,
  deleteContactFromLocalFeedback,
  deleteLocalFeedbackEntry,
  loadArticleFeedback,
  loadArticleReports,
  loadBoundedLogs,
  loadCachedEnvelope,
  loadCategoryPreferences,
  loadCircuitBreaker,
  loadCorrectionDrafts,
  loadFeedMode,
  loadLanguage,
  loadLocationPreference,
  loadPowerInput,
  saveArticleFeedback,
  saveArticleReport,
  saveCachedEnvelope,
  saveCategoryPreferences,
  saveCircuitBreaker,
  saveFeedMode,
  saveLanguage,
  saveLocationPreference,
  savePowerInput,
} from './data/storage';
import {
  ArticleIssueType,
  ArticleRecord,
  CircuitBreakerState,
  FeedEnvelope,
  FeedLoadState,
  FeedSimulationMode,
  LanguageCode,
  LocationPreference,
  NewsScope,
  PowerStateInput,
  PowerTier,
  PreferredCategoryKey,
  UserCategoryPreferences,
} from './domain/types';
import {
  evaluatePowerTier,
  formatSourceTimestamp,
  getArticleCategoryKeys,
  getEditorialStateBadgeMeta,
  getVerificationBadgeMeta,
  prioritizeArticlesByPreferences,
  recordFailureAndAdvanceCircuit,
  resolveCityFromTransientCoords,
  sanitizeString,
  validateAndCreateArticleFeedback,
  validateAndCreateArticleReport,
  validateFeedEnvelope,
} from './domain/validation';
import {
  renderAboutAndHandoffPage,
  renderCorrectionsPage,
  renderEarthquakesPage,
  renderPrivacyAndPowerPage,
  renderSourcesLedgerPage,
  renderWeatherPage,
} from './pages/GovernancePages';
import { EmbeddedNewsroomViewport, launchFullWebXRSession } from './xr/SpatialNewsroom';

interface CategoryPrefsModalState {
  isOpen: boolean;
  draftCategories: PreferredCategoryKey[];
  savedNotice: string | null;
}

interface AppState {
  route: string;
  lang: LanguageCode;
  locationPref: LocationPreference;
  categoryPrefs: UserCategoryPreferences;
  categoryModal: CategoryPrefsModalState;
  feedMode: FeedSimulationMode;
  powerInput: PowerStateInput;
  powerTier: PowerTier;
  circuitBreaker: CircuitBreakerState;
  hazardPreviewState: 'unavailable' | 'stale' | 'all_clear_test';
  cityModal: CityModalState;
  reportPromptOpen: boolean;
  reportArticleNotice: string | null;
  reportArticleError: string | null;
  feedbackSelectedType: ArticleIssueType;
  feedbackNotice: string | null;
  feedbackError: string | null;
  generalFeedbackNotice: string | null;
  generalFeedbackError: string | null;
  lastFeedbackSubmittedAtMs: number | null;
  seenIdempotencyTokens: Set<string>;
  spatialKioskExpanded: boolean;
}

const embeddedViewport = new EmbeddedNewsroomViewport();

const initialLoc = loadLocationPreference();
const initialCatPrefs = loadCategoryPreferences();
const initialPowerInput = loadPowerInput();
const initialPowerTier = evaluatePowerTier('Normal', initialPowerInput);

const state: AppState = {
  route: normalizePath(window.location.pathname),
  lang: loadLanguage(),
  locationPref: initialLoc,
  categoryPrefs: initialCatPrefs,
  categoryModal: {
    isOpen: false,
    draftCategories: [...initialCatPrefs.selectedCategories],
    savedNotice: null,
  },
  feedMode: loadFeedMode(),
  powerInput: initialPowerInput,
  powerTier: initialPowerTier,
  circuitBreaker: loadCircuitBreaker(),
  hazardPreviewState: 'unavailable',
  cityModal: {
    isOpen: false,
    selectedCountry: initialLoc.countryCode,
    selectedState: initialLoc.stateCode,
    selectedCityId: initialLoc.cityId,
    geoStatusMessage: null,
    geoStatusType: null,
    ambiguousCandidates: [],
  },
  reportPromptOpen: false,
  reportArticleNotice: null,
  reportArticleError: null,
  feedbackSelectedType: 'inaccuracy',
  feedbackNotice: null,
  feedbackError: null,
  generalFeedbackNotice: null,
  generalFeedbackError: null,
  lastFeedbackSubmittedAtMs: null,
  seenIdempotencyTokens: new Set<string>(),
  spatialKioskExpanded: false,
};

function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/index.html') return '/';
  const cleaned = pathname.replace(/\/+$/, '');
  return cleaned === '' ? '/' : cleaned;
}

function getActiveEnvelopeAndValidation(): {
  envelope: FeedEnvelope;
  loadState: FeedLoadState;
  validation: ReturnType<typeof validateFeedEnvelope>;
} {
  let rawEnvelope: FeedEnvelope;
  let isProductionValidation = true;
  let loadState: FeedLoadState = 'loaded';

  if (state.feedMode === 'production_empty') {
    rawEnvelope = PRODUCTION_EMPTY_ENVELOPE;
    isProductionValidation = true;
  } else if (state.feedMode === 'test_fixtures') {
    rawEnvelope = TEST_FIXTURE_ENVELOPE;
    isProductionValidation = false; // Inspect TEST fixtures in diagnostic mode
  } else if (state.feedMode === 'stale_offline') {
    rawEnvelope = loadCachedEnvelope();
    isProductionValidation = true;
    loadState = 'stale';
  } else {
    rawEnvelope = STAGE1_OFFICIAL_LINK_ENVELOPE;
    saveCachedEnvelope(STAGE1_OFFICIAL_LINK_ENVELOPE);
    isProductionValidation = true;
  }

  const validation = validateFeedEnvelope(rawEnvelope, SOURCE_ALLOWLIST_LEDGER, {
    isProduction: isProductionValidation,
    referenceNowIso: '2026-11-06T06:00:00Z',
  });

  if (!validation.validEnvelope) {
    loadState = 'failed';
  } else if (validation.acceptedItems.length === 0 && loadState !== 'stale') {
    loadState = 'empty';
  }

  return { envelope: rawEnvelope, loadState, validation };
}

const CATEGORY_META: Record<
  PreferredCategoryKey,
  { labelEn: string; labelHi: string; stageNoteEn: string; stageNoteHi: string }
> = {
  local: {
    labelEn: 'Local',
    labelHi: 'स्थानीय (Local)',
    stageNoteEn: 'Stage 1 Active',
    stageNoteHi: 'चरण 1 सक्रिय',
  },
  state: {
    labelEn: 'State',
    labelHi: 'राज्य (State)',
    stageNoteEn: 'Stage 1 Active',
    stageNoteHi: 'चरण 1 सक्रिय',
  },
  national: {
    labelEn: 'National',
    labelHi: 'राष्ट्रीय (National)',
    stageNoteEn: 'Stage 1 Active',
    stageNoteHi: 'चरण 1 सक्रिय',
  },
  weather: {
    labelEn: 'Weather',
    labelHi: 'मौसम (Weather)',
    stageNoteEn: 'Stage 1 Active',
    stageNoteHi: 'चरण 1 सक्रिय',
  },
  earthquakes: {
    labelEn: 'Earthquakes',
    labelHi: 'भूकंप (Earthquakes)',
    stageNoteEn: 'Stage 1 Active',
    stageNoteHi: 'चरण 1 सक्रिय',
  },
  world: {
    labelEn: 'World',
    labelHi: 'विश्व (World)',
    stageNoteEn: 'Planned Stage 5 (Preference Saved)',
    stageNoteHi: 'चरण 5 नियोजित (प्राथमिकता सहेजी गई)',
  },
  blogs: {
    labelEn: 'Blogs',
    labelHi: 'ब्लॉग (Blogs)',
    stageNoteEn: 'Planned Stage 5 (Preference Saved)',
    stageNoteHi: 'चरण 5 नियोजित (प्राथमिकता सहेजी गई)',
  },
  culture: {
    labelEn: 'Culture/Astrology',
    labelHi: 'संस्कृति/ज्योतिष (Culture/Astrology)',
    stageNoteEn: 'Planned Stage 5 (Preference Saved)',
    stageNoteHi: 'चरण 5 नियोजित (प्राथमिकता सहेजी गई)',
  },
};

function renderCategoryPrefsModal(): string {
  if (!state.categoryModal.isOpen) return '';
  const isHi = state.lang === 'hi';
  const selectedSet = new Set(state.categoryModal.draftCategories);

  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="category-prefs-modal-title">
      <div class="modal-card" data-testid="category-prefs-modal">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <h2 id="category-prefs-modal-title" style="margin:0; font-family:var(--font-serif); font-size:1.35rem;">
            ${
              isHi
                ? 'पसंदीदा समाचार श्रेणियां चुनें (Preferred News Categories)'
                : 'Select Preferred News Categories'
            }
          </h2>
          <button type="button" id="close-category-modal-btn" class="btn-quiet" aria-label="Close">✕</button>
        </div>

        <p style="margin:8px 0 14px; font-size:0.88rem; color:var(--text-secondary);">
          ${
            isHi
              ? 'अपनी पसंदीदा श्रेणियां चुनें और सहेजें। मुख्य पृष्ठ (Home) आपकी चयनित श्रेणियों के लेखों को सर्वोच्च प्राथमिकता देगा। ये प्राथमिकताएं आपके डिवाइस पर स्थानीय रूप से (localStorage में) सहेजी जाती हैं।'
              : 'Select and save your preferred news categories. The Home screen prioritizes and displays articles from your selected categories first. Stored locally on your device.'
          }
        </p>

        <form id="category-prefs-form">
          <div class="category-pref-grid">
            ${ALL_PREFERRED_CATEGORIES.map((key) => {
              const meta = CATEGORY_META[key];
              const checked = selectedSet.has(key);
              return `
                <label class="category-pref-option" for="cat-pref-check-${key}">
                  <input
                    type="checkbox"
                    id="cat-pref-check-${key}"
                    name="preferredCategory"
                    value="${key}"
                    ${checked ? 'checked' : ''}
                  />
                  <div>
                    <div style="font-weight:700; color:var(--text-primary);">
                      ${isHi ? meta.labelHi : meta.labelEn}
                    </div>
                    <div style="font-size:0.76rem; color:var(--text-muted);">
                      ${isHi ? meta.stageNoteHi : meta.stageNoteEn}
                    </div>
                  </div>
                </label>
              `;
            }).join('')}
          </div>

          <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; margin-top:18px;">
            <button type="button" id="reset-category-prefs-btn" class="btn-quiet">
              ${isHi ? 'डिफ़ॉल्ट श्रेणियां रीसेट करें' : 'Reset Default Categories'}
            </button>
            <div style="display:flex; gap:10px;">
              <button type="button" id="cancel-category-modal-btn" class="btn-quiet">
                ${isHi ? 'रद्द करें (Cancel)' : 'Cancel'}
              </button>
              <button type="submit" id="save-category-prefs-btn" class="btn-amber">
                ${isHi ? 'प्राथमिकताएं सहेजें (Save Preferences)' : 'Save Category Preferences'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderArticleCard(item: ArticleRecord, lang: LanguageCode, isStale: boolean): string {
  const isHi = lang === 'hi';
  const title = isHi ? item.titleHi : item.title;
  const publisher = isHi ? item.publisherHi : item.publisher;
  const category = isHi ? item.categoryHi : item.category;
  const badge = getVerificationBadgeMeta(item.verificationStatus, lang);
  const edBadge = getEditorialStateBadgeMeta(item.editorialState, lang);
  const isBlocked = badge.status === 'blocked' || Boolean(item.sourceUrlWithheld) || item.rightsStatus === 'blocked';
  const isWarningStatus = badge.status !== 'verified' || item.editorialState !== 'active';
  const summary = isBlocked ? null : isHi ? item.permittedSummaryHi : item.permittedSummary;
  const reasonText =
    (isHi ? item.verificationReasonHi || item.verificationReason : item.verificationReason) ||
    (isHi ? badge.descriptionHi : badge.descriptionEn);

  const matchedPrefs = getArticleCategoryKeys(item).filter((k) =>
    state.categoryPrefs.selectedCategories.includes(k)
  );

  const scopeLabel =
    item.scope === 'local'
      ? isHi
        ? 'स्थानीय (Local)'
        : 'Local'
      : item.scope === 'state'
        ? isHi
          ? 'राज्य (State)'
          : 'State'
        : isHi
          ? 'राष्ट्रीय फ़ॉलबैक (National Fallback)'
          : 'National Fallback';

  return `
    <article
      class="article-card"
      data-test-fixture="${Boolean(item.isTestFixture)}"
      data-verification-status="${badge.status}"
      data-editorial-state="${item.editorialState ?? 'active'}"
      data-article-id="${item.id}"
    >
      <div>
        <!-- Spec v3 Page 7 Item 2: Source: [publisher] right next to Source verification: [status] and before the timestamp -->
        <div class="article-kicker-meta" style="display:flex; flex-wrap:wrap; align-items:center; gap:6px;">
          <strong>${scopeLabel}</strong>
          <span aria-hidden="true">·</span>
          <span>${category}</span>
          <span aria-hidden="true">·</span>
          <span>Source: <strong>${publisher}</strong></span>
          <span
            class="verification-badge"
            data-verification="${badge.status}"
            data-testid="source-verification-badge"
            title="${isHi ? badge.descriptionHi : badge.descriptionEn}"
          >
            Source verification: ${badge.displayLabel}
          </span>
          ${
            item.editorialState && item.editorialState !== 'active'
              ? `<span
                  class="verification-badge"
                  data-editorial-state="${item.editorialState}"
                  data-testid="editorial-state-badge"
                  title="${isHi ? edBadge.descriptionHi : edBadge.descriptionEn}"
                >
                  Editorial: ${edBadge.displayLabel}
                </span>`
              : ''
          }
          <span aria-hidden="true">·</span>
          <span>${formatSourceTimestamp(item.publishedAt, lang)}</span>
          <span aria-hidden="true">·</span>
          <span>Rights: ${item.rightsStatus}</span>
          ${
            matchedPrefs.length > 0
              ? `<span aria-hidden="true">·</span><span style="color:var(--amber-300); font-weight:600;">★ ${
                  isHi ? 'पसंदीदा श्रेणी' : 'Preferred'
                } (${matchedPrefs.map((k) => CATEGORY_META[k].labelEn).join(', ')})</span>`
              : ''
          }
          ${
            isStale
              ? `<span aria-hidden="true">·</span><strong style="color:var(--amber-400);">${
                  isHi ? 'बासी / ऑफ़लाइन कैश (STALE)' : 'STALE / OFFLINE CACHE'
                }</strong>`
              : ''
          }
          ${
            item.isTestFixture
              ? `<span aria-hidden="true">·</span><strong style="color:var(--status-danger);">[TEST FIXTURE — NOT REAL NEWS]</strong>`
              : ''
          }
        </div>

        ${
          isWarningStatus
            ? `<div style="margin-top:8px; padding:6px 10px; border-radius:6px; border:1px solid ${
                isBlocked ? 'rgba(248,113,113,0.55)' : 'rgba(251,191,36,0.55)'
              }; background:${
                isBlocked ? 'rgba(248,113,113,0.1)' : 'rgba(245,158,11,0.1)'
              }; font-size:0.78rem; color:var(--text-secondary);">
                <strong>${
                  isHi
                    ? 'चेतावनी / स्थिति रिकॉर्ड (Warning / Status Record — सामान्य सत्यापित समाचार नहीं):'
                    : 'Warning / Status Record (Not an ordinary current verified story):'
                }</strong>
                <span> ${reasonText}</span>
              </div>`
            : ''
        }

        <h3 class="article-headline" style="margin-top:10px;">
          <a href="/article/${item.id}" data-nav="/article/${item.id}" style="color:inherit; text-decoration:none;">
            ${title}
          </a>
        </h3>

        ${
          summary
            ? `<p class="article-summary" style="margin-top:8px;">${summary}</p>`
            : isBlocked
              ? `<p class="article-summary" style="margin-top:8px; color:var(--text-muted); font-style:italic;" data-testid="blocked-withheld-body-notice">
                  ${
                    isHi
                      ? 'अवरुद्ध (Blocked) स्रोत: कोई स्क्रैप किया गया पाठ, मीडिया या असुरक्षित बाहरी लिंक प्रदर्शित नहीं किया गया है।'
                      : 'Blocked record: no scraped body, media, or unsafe external URL is displayed.'
                  }
                </p>`
              : ''
        }

        ${
          item.corrections.length > 0
            ? `<div style="margin-top:10px; font-size:0.8rem; color:var(--amber-400);">
                ${
                  isHi
                    ? `संशोधन उपलब्ध (${item.corrections.length}) — अद्यतन: ${formatSourceTimestamp(
                        item.corrections[0].correctedAt,
                        lang
                      )}`
                    : `Correction Logged (${item.corrections.length}) — Updated: ${formatSourceTimestamp(
                        item.corrections[0].correctedAt,
                        lang
                      )}`
                }
              </div>`
            : ''
        }
      </div>

      <div>
        <div class="article-timestamps">
          <div>
            ${isHi ? 'प्रकाशन समय (Published):' : 'Published:'}
            ${formatSourceTimestamp(item.publishedAt, lang)}
          </div>
          <div>
            ${isHi ? 'अंतिम जांच (Last Checked):' : 'Last Checked:'}
            ${formatSourceTimestamp(item.fetchedAt, lang)}
          </div>
          <div>
            ${isHi ? 'स्रोत सत्यापन स्थिति (Source verification):' : 'Source verification:'}
            <strong>${badge.labelEn}</strong> (${badge.displayLabel})
          </div>
        </div>

        <div class="article-actions" style="margin-top:12px;">
          ${
            isBlocked || !item.sourceUrl
              ? `<span class="withheld-link-notice" data-testid="withheld-unsafe-link-notice">
                  ⛔ ${
                    isHi
                      ? 'असुरक्षित / अनुमत-रहित बाहरी लिंक रोका गया (Withheld)'
                      : 'Unsafe / Unpermitted External URL Withheld'
                  }
                </span>`
              : `<a
                  href="${item.sourceUrl}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="ext-link-btn"
                >
                  ${isHi ? `मूल स्रोत खोलें (${publisher}) ↗` : `Open Original Source (${publisher}) ↗`}
                </a>`
          }
          <a
            href="/article/${item.id}"
            data-nav="/article/${item.id}"
            class="nav-link-btn"
            style="border:1px solid var(--border-subtle);"
          >
            ${isHi ? 'विवरण एवं सत्यापन देखें' : 'Article Detail & Attribution'}
          </a>
          <button
            type="button"
            class="btn-quiet card-report-issue-btn"
            data-report-article-id="${item.id}"
            style="min-height:44px; padding:8px 12px; font-size:0.8rem;"
          >
            🚩 ${isHi ? 'समस्या रिपोर्ट करें (Report Issue)' : 'Report Article Issue'}
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderHomeOrScopePage(
  scopeFilter: NewsScope | 'all',
  items: ArticleRecord[],
  loadState: FeedLoadState,
  envelopeError: string | null
): string {
  const isHi = state.lang === 'hi';
  const isStale = loadState === 'stale' || loadState === 'offline';

  // Verified current breaking item check (Spec §2.2: source-labelled breaking strip ONLY when verified current item exists)
  const verifiedBreakingItem = items.find(
    (item) => item.isBreaking && item.verificationStatus === 'verified' && !item.isTestFixture
  );

  // Filter items by scope and user's selected city/state preference
  const localItems = items.filter(
    (i) =>
      i.scope === 'local' &&
      (i.cityId === state.locationPref.cityId || i.stateCode === state.locationPref.stateCode || i.isTestFixture)
  );
  const stateItems = items.filter(
    (i) => i.scope === 'state' && (i.stateCode === state.locationPref.stateCode || !i.stateCode || i.isTestFixture)
  );
  const nationalItems = items.filter((i) => i.scope === 'national');

  const statusBannerHtml =
    loadState === 'failed'
      ? `<div class="state-banner" data-state="failed">
          <strong>${isHi ? 'फ़ीड स्कीमा अस्वीकृत (Schema Error):' : 'Feed Schema Rejected:'}</strong>
          <span>${envelopeError}</span>
        </div>`
      : loadState === 'stale'
        ? `<div class="state-banner" data-state="stale">
            <strong>${
              isHi
                ? 'ऑफ़लाइन / बासी कैश मोड सक्रिय (STALE / OFFLINE CACHE):'
                : 'STALE / OFFLINE CACHE ACTIVE:'
            }</strong>
            <span>
              ${
                isHi
                  ? 'नेटवर्क या फ़ीड अनुपलब्ध है। अंतिम सफल डेटा उसके वास्तविक प्रकाशन समय (publishedAt) और जांच समय (fetchedAt) के साथ दिखाया जा रहा है।'
                  : 'Live feed unreachable. Rendering last successful validated data with its original publishedAt and fetchedAt timestamps.'
              }
            </span>
          </div>`
        : state.feedMode === 'test_fixtures'
          ? `<div class="state-banner" data-state="unavailable">
              <strong>${
                isHi
                  ? '[TEST] डेवलपर परीक्षण फिक्स्चर मोड (Never Used in Production):'
                  : '[TEST] Developer Fixture Inspection Mode (Rejected in Production):'
              }</strong>
              <span>
                ${
                  isHi
                    ? 'ये रिकॉर्ड केवल बिल्ड अनुबंध §3 (id=test-001, भविष्य का समय, HTML सैनिटाइजेशन) के सत्यापन के लिए हैं। प्रोडक्शन मोड इन्हें स्वतः अस्वीकार कर देता है।'
                    : 'Displaying labelled TEST fixtures (id=test-001, future timestamp demotion, script sanitization). Production mode rejects these records automatically.'
                }
              </span>
            </div>`
          : '';

  const breakingStripHtml = verifiedBreakingItem
    ? `<div class="breaking-strip" role="region" aria-label="${
        isHi ? 'सत्यापित ताज़ा सूचना' : 'Verified Breaking Notice'
      }">
        <div class="article-kicker-meta">
          <strong>${isHi ? 'सत्यापित ताज़ा सूचना (BREAKING — NO ADS)' : 'VERIFIED BREAKING — NO ADS'}</strong>
          <span aria-hidden="true"> · </span>
          <span>${isHi ? verifiedBreakingItem.publisherHi : verifiedBreakingItem.publisher}</span>
          <span aria-hidden="true"> · </span>
          <span>${formatSourceTimestamp(verifiedBreakingItem.publishedAt, state.lang)}</span>
        </div>
        <div style="margin-top:6px; font-family:var(--font-serif); font-size:1.15rem; font-weight:700;">
          <a href="/article/${verifiedBreakingItem.id}" data-nav="/article/${verifiedBreakingItem.id}">
            ${isHi ? verifiedBreakingItem.titleHi : verifiedBreakingItem.title}
          </a>
        </div>
      </div>`
    : '';

  if (loadState === 'empty' || items.length === 0) {
    return `
      ${statusBannerHtml}
      <section class="state-banner" data-state="empty" style="margin-top:24px;">
        <div class="article-kicker-meta">
          <strong>EMPTY VERIFIED FEED (schemaVersion=1 · items=[])</strong>
          <span aria-hidden="true"> · </span>
          <span>${isHi ? `चयनित शहर: ${state.locationPref.cityLabelHi}` : `Selected City: ${state.locationPref.cityLabel}`}</span>
        </div>
        <h1 class="section-title" style="margin-top:10px;">
          ${
            isHi
              ? 'कोई सत्यापित लाइव समाचार उपलब्ध नहीं है (शून्य काल्पनिक समाचार नीति)'
              : 'No Verified Live News Items Available (Zero Invented Filler Policy)'
          }
        </h1>
        <p class="article-summary" style="margin-top:8px;">
          ${
            isHi
              ? 'बिल्ड अनुबंध §1 और §3 के अनुसार: जब तक प्रकाशक अनुमतियों की लिखित पुष्टि नहीं हो जाती, नेत्र न्यूज़ कोई नकली या स्क्रैप किया गया समाचार नहीं दिखाता। आप ऊपर दिए गए मोड सेलेक्टर से "Stage 1 Official Portal Link-Out" या "[TEST] Fixtures" की जांच कर सकते हैं।'
              : 'Per Build Contract §1 & §3: Empty items means no verified content — never invented filler. Use the Feed Verification Mode selector in the operational bar above to switch back to Stage 1 Official Link-Out Cards or inspect [TEST] fixtures.'
          }
        </p>
        <div class="article-actions" style="margin-top:16px;">
          <button type="button" id="restore-official-links-btn" class="btn-amber">
            ${
              isHi
                ? 'चरण 1 आधिकारिक पोर्टल लिंक-आउट दिखाएं (Show Stage 1 Official Links)'
                : 'Switch to Stage 1 Official Portal Links (Link-Only)'
            }
          </button>
          <a href="/sources" data-nav="/sources" class="nav-link-btn" style="border:1px solid var(--border-subtle);">
            ${isHi ? 'स्रोत एवं अधिकार खाता-बही देखें' : 'Inspect Source & Rights Ledger'}
          </a>
        </div>
      </section>
    `;
  }

  if (scopeFilter !== 'all') {
    const scopedList =
      scopeFilter === 'local'
        ? localItems
        : scopeFilter === 'state'
          ? stateItems
          : nationalItems;

    const scopeHeading =
      scopeFilter === 'local'
        ? isHi
          ? `स्थानीय अनुभाग — ${state.locationPref.cityLabelHi}`
          : `Local Section — ${state.locationPref.cityLabel}`
        : scopeFilter === 'state'
          ? isHi
            ? `राज्य अनुभाग (${state.locationPref.stateCode})`
            : `State Section (${state.locationPref.stateCode})`
          : isHi
            ? 'राष्ट्रीय फ़ॉलबैक (सत्यापित आधिकारिक स्रोत)'
            : 'National Fallback (Verified Official Sources)';

    return `
      ${statusBannerHtml}
      ${breakingStripHtml}
      <section class="newspaper-section" style="margin-top:16px; border-top:none; padding-top:0;">
        <div class="section-header-row">
          <div>
            <h1 class="section-title">${scopeHeading}</h1>
            <p class="section-subtitle">
              ${
                isHi
                  ? 'प्रत्येक कार्ड पर स्रोत का नाम, प्रकाशन समय, अंतिम जांच समय और अधिकार-सुरक्षित सारांश अनिवार्य है।'
                  : 'Every card displays source attribution, publication time, last checked timestamp, and rights-safe link-out.'
              }
            </p>
          </div>
        </div>
        ${
          scopedList.length === 0
            ? `<div class="state-banner">
                ${
                  isHi
                    ? `इस शहर/राज्य (${state.locationPref.cityLabelHi}) के लिए वर्तमान में कोई सीधा कार्ड नहीं है। कृपया नीचे राष्ट्रीय फ़ॉलबैक या अन्य शहर देखें।`
                    : `No items for ${state.locationPref.cityLabel} in this scope. Change city or view National fallback.`
                }
              </div>`
            : `<div class="newspaper-grid">
                ${scopedList.map((item) => renderArticleCard(item, state.lang, isStale)).join('')}
              </div>`
        }
      </section>
    `;
  }

  const prioritizedResult = prioritizeArticlesByPreferences(
    items,
    state.categoryPrefs.selectedCategories,
    state.locationPref
  );

  const categoryPrefsBannerHtml = `
    <section class="category-prefs-bar" data-testid="home-category-preferences-bar" aria-label="${
      isHi ? 'आपकी समाचार श्रेणी प्राथमिकताएं' : 'Your News Category Preferences'
    }">
      <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px;">
        <div>
          <strong style="color:var(--amber-400); font-size:0.95rem;">
            ${
              isHi
                ? '★ आपकी चयनित समाचार श्रेणियां (Saved Preferred Categories — On-Device):'
                : '★ Your Preferred News Categories (Saved On-Device):'
            }
          </strong>
          <div style="font-size:0.82rem; color:var(--text-secondary);">
            ${
              isHi
                ? 'मुख्य पृष्ठ आपकी चयनित श्रेणियों के लेखों को प्राथमिकता देता है। किसी भी श्रेणी पर क्लिक करके तुरंत टॉगल करें या प्राथमिकताएं अनुकूलित करें।'
                : 'The Home screen prioritizes articles from your selected categories. Click any chip below to toggle or open Category Preferences.'
            }
          </div>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:8px;">
          <button type="button" id="home-customize-categories-btn" class="btn-amber">
            ⚙️ ${isHi ? 'श्रेणियां चुनें / सहेजें (Customize Categories)' : 'Select & Save Categories'}
          </button>
          <button type="button" id="home-change-city-btn">
            📍 ${isHi ? 'शहर बदलें (Change City)' : 'Change City'}
          </button>
        </div>
      </div>

      <div class="category-chip-row" role="group" aria-label="${
        isHi ? 'श्रेणी फ़िल्टर चिप्स' : 'Category preference chips'
      }">
        ${ALL_PREFERRED_CATEGORIES.map((key) => {
          const meta = CATEGORY_META[key];
          const isSelected = state.categoryPrefs.selectedCategories.includes(key);
          return `
            <button
              type="button"
              class="category-chip quick-toggle-category-btn ${isSelected ? 'active' : ''}"
              data-category-key="${key}"
              aria-pressed="${isSelected}"
              title="${isHi ? meta.stageNoteHi : meta.stageNoteEn}"
            >
              <span>${isSelected ? '✓' : '+'}</span>
              <span>${isHi ? meta.labelHi : meta.labelEn}</span>
            </button>
          `;
        }).join('')}
      </div>

      ${
        state.categoryModal.savedNotice
          ? `<div style="font-size:0.82rem; color:var(--status-ok); font-weight:600;" data-testid="category-saved-notice">
              ${state.categoryModal.savedNotice}
            </div>`
          : ''
      }

      <div style="border-top:1px solid var(--border-subtle); padding-top:10px; display:flex; flex-wrap:wrap; align-items:center; gap:10px; font-size:0.8rem; color:var(--text-secondary);">
        <strong>${isHi ? 'स्रोत सत्यापन स्थिति संकेत (Source Verification Legend):' : 'Source Verification Status Key:'}</strong>
        <span class="verification-badge" data-verification="verified">
          ${isHi ? '✓ सत्यापित (Verified)' : '✓ Verified'}
        </span>
        <span class="verification-badge" data-verification="pending">
          ${isHi ? '⏳ लंबित (Pending)' : '⏳ Pending'}
        </span>
        <span class="verification-badge" data-verification="blocked">
          ${isHi ? '⛔ अवरुद्ध (Blocked)' : '⛔ Blocked'}
        </span>
        <span class="verification-badge" data-editorial-state="retracted">
          ${isHi ? 'Editorial: ⚠ वापस लिया गया (Retracted)' : 'Editorial: ⚠ Retracted'}
        </span>
      </div>
    </section>
  `;

  // Full Home Newspaper Hierarchy: Prioritized by Selected Categories + Local -> State -> National
  return `
    ${statusBannerHtml}
    ${breakingStripHtml}
    ${categoryPrefsBannerHtml}

    <section class="newspaper-section" style="margin-top:20px; border-top:none; padding-top:0;" data-testid="prioritized-articles-section">
      <div class="section-header-row">
        <div>
          <h1 class="section-title">
            ${
              isHi
                ? `★ आपकी पसंदीदा श्रेणियों से प्राथमिकता प्राप्त समाचार (${prioritizedResult.prioritizedItems.length})`
                : `★ Prioritized for Your Selected Categories (${prioritizedResult.prioritizedItems.length})`
            }
          </h1>
          <p class="section-subtitle">
            ${
              isHi
                ? `सक्रिय श्रेणियां: ${state.categoryPrefs.selectedCategories
                    .map((k) => CATEGORY_META[k].labelHi)
                    .join(', ')} · शहर: ${state.locationPref.cityLabelHi}`
                : `Active Categories: ${state.categoryPrefs.selectedCategories
                    .map((k) => CATEGORY_META[k].labelEn)
                    .join(', ')} · City: ${state.locationPref.cityLabel}`
            }
          </p>
        </div>
      </div>

      ${
        prioritizedResult.prioritizedItems.length === 0
          ? `<div class="state-banner">
              <p style="margin:0; font-size:0.92rem;">
                ${
                  isHi
                    ? 'आपकी वर्तमान में चयनित श्रेणियों से मेल खाने वाला कोई चरण-1 कार्ड नहीं है। कृपया ऊपर चिप्स पर क्लिक करके Local, State, National, Weather या Earthquakes सक्षम करें।'
                    : 'No Stage 1 articles match your currently selected categories. Enable Local, State, National, Weather, or Earthquakes above to display matching items.'
                }
              </p>
            </div>`
          : `<div class="newspaper-grid" data-testid="prioritized-articles-grid">
              ${prioritizedResult.prioritizedItems
                .map((item) => renderArticleCard(item, state.lang, isStale))
                .join('')}
            </div>`
      }
    </section>

    <section class="newspaper-section">
      <div class="section-header-row">
        <div>
          <h2 class="section-title">
            ${
              isHi
                ? `1. स्थानीय समाचार एवं नागरिक संदर्भ — ${state.locationPref.cityLabelHi}`
                : `1. Local Civic Reference — ${state.locationPref.cityLabel}`
            }
          </h2>
          <p class="section-subtitle">
            ${
              isHi
                ? `चयन मोड: ${state.locationPref.selectionMode.toUpperCase()} · स्थानीय पहले, फिर राज्य, फिर राष्ट्रीय फ़ॉलबैक`
                : `Selection Mode: ${state.locationPref.selectionMode.toUpperCase()} · Local first, then State, then National fallback`
            }
          </p>
        </div>
      </div>

      ${
        localItems.length === 0
          ? `<div class="state-banner">
              <p style="margin:0; font-size:0.92rem;">
                ${
                  isHi
                    ? `${state.locationPref.cityLabelHi} के लिए अभी कोई अलग स्थानीय पोर्टल कार्ड नहीं है — नीचे राज्य एवं राष्ट्रीय फ़ॉलबैक दिखाए गए हैं।`
                    : `No dedicated local card for ${state.locationPref.cityLabel} — showing State & National fallback sections below.`
                }
              </p>
            </div>`
          : `<div class="newspaper-grid">
              ${localItems.map((item) => renderArticleCard(item, state.lang, isStale)).join('')}
            </div>`
      }
    </section>

    <section class="newspaper-section">
      <div class="section-header-row">
        <div>
          <h2 class="section-title">
            ${
              isHi
                ? `2. राज्य अनुभाग (State — ${state.locationPref.stateCode})`
                : `2. State Section (${state.locationPref.stateCode})`
            }
          </h2>
          <p class="section-subtitle">
            ${
              isHi
                ? 'अनुमति सिद्ध होने तक केवल स्रोत-चिह्नित आधिकारिक लिंक-आउट (linkOnly)'
                : 'Minimal source-labelled link-out listing until publisher permissions are verified'
            }
          </p>
        </div>
      </div>
      <div class="newspaper-grid">
        ${stateItems.map((item) => renderArticleCard(item, state.lang, isStale)).join('')}
      </div>
    </section>

    <section class="newspaper-section">
      <div class="section-header-row">
        <div>
          <h2 class="section-title">
            ${
              isHi
                ? '3. राष्ट्रीय फ़ॉलबैक (National Fallback — Verified Official Portals)'
                : '3. National Fallback (Verified Official Portals)'
            }
          </h2>
          <p class="section-subtitle">
            ${
              isHi
                ? 'PIB, IMD, NCS एवं NDMA के सत्यापित HTTPS संदर्भ लिंक'
                : 'Verified HTTPS reference links to PIB, IMD, NCS, and NDMA'
            }
          </p>
        </div>
      </div>
      <div class="newspaper-grid">
        ${nationalItems.map((item) => renderArticleCard(item, state.lang, isStale)).join('')}
      </div>
    </section>
  `;
}

function renderArticleDetailPage(articleId: string, allItems: ArticleRecord[]): string {
  const isHi = state.lang === 'hi';
  let item = allItems.find((a) => a.id === articleId);
  if (!item) {
    const validatedStage1 = validateFeedEnvelope(STAGE1_OFFICIAL_LINK_ENVELOPE, SOURCE_ALLOWLIST_LEDGER, {
      isProduction: true,
      referenceNowIso: '2026-11-06T06:00:00Z',
    }).acceptedItems;
    const validatedFixtures = validateFeedEnvelope(TEST_FIXTURE_ENVELOPE, SOURCE_ALLOWLIST_LEDGER, {
      isProduction: false,
      referenceNowIso: '2026-11-06T06:00:00Z',
    }).acceptedItems;
    item =
      validatedStage1.find((a) => a.id === articleId) ||
      validatedFixtures.find((a) => a.id === articleId);
  }

  if (!item) {
    return renderNotFoundPage(`/article/${articleId}`);
  }

  const title = isHi ? item.titleHi : item.title;
  const publisher = isHi ? item.publisherHi : item.publisher;
  const badge = getVerificationBadgeMeta(item.verificationStatus, state.lang);
  const edBadge = getEditorialStateBadgeMeta(item.editorialState, state.lang);
  const isBlocked =
    badge.status === 'blocked' || Boolean(item.sourceUrlWithheld) || item.rightsStatus === 'blocked';
  const summary = isBlocked ? null : isHi ? item.permittedSummaryHi : item.permittedSummary;
  const verReason =
    (isHi ? item.verificationReasonHi || item.verificationReason : item.verificationReason) ||
    (isHi ? badge.descriptionHi : badge.descriptionEn);
  const articleReports = loadArticleReports().filter((r) => r.articleId === item.id);
  const articleFeedbackList = loadArticleFeedback().filter((f) => f.articleId === item.id);

  return `
    <article class="newspaper-section" style="margin-top:16px; border-top:none; padding-top:0;">
      <div style="margin-bottom:16px; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px;">
        <a href="/" data-nav="/" class="nav-link-btn" style="border:1px solid var(--border-subtle);">
          ← ${isHi ? 'मुख्य पृष्ठ पर लौटें (Back to Newspaper)' : 'Back to Newspaper Front Page'}
        </a>

        <button
          type="button"
          id="open-report-article-btn"
          class="btn-amber"
          data-testid="report-article-button"
        >
          🚩 ${isHi ? 'लेख की रिपोर्ट करें (Report Article)' : 'Report Article'}
        </button>
      </div>

      <div class="article-card" data-test-fixture="${Boolean(item.isTestFixture)}">
        <div class="article-kicker-meta" style="display:flex; flex-wrap:wrap; align-items:center; gap:6px;">
          <strong>${item.scope.toUpperCase()}</strong>
          <span aria-hidden="true">·</span>
          <span>${isHi ? item.categoryHi : item.category}</span>
          <span aria-hidden="true">·</span>
          <span>Source: <strong>${publisher}</strong></span>
          <span
            class="verification-badge"
            data-verification="${badge.status}"
            data-testid="detail-source-verification-badge"
            title="${isHi ? badge.descriptionHi : badge.descriptionEn}"
          >
            Source verification: ${badge.displayLabel}
          </span>
          ${
            item.editorialState && item.editorialState !== 'active'
              ? `<span
                  class="verification-badge"
                  data-editorial-state="${item.editorialState}"
                  data-testid="detail-editorial-state-badge"
                  title="${isHi ? edBadge.descriptionHi : edBadge.descriptionEn}"
                >
                  Editorial: ${edBadge.displayLabel}
                </span>`
              : ''
          }
          <span aria-hidden="true">·</span>
          <span>Rights Status: <strong>${item.rightsStatus}</strong></span>
        </div>

        <h1 class="section-title" style="margin-top:8px;">${title}</h1>

        <!-- Spec v3 Page 7 Item 3: Source verification, verificationCheckedAt, verificationReason, and Scope-Honesty Note -->
        <div class="article-timestamps" style="margin-top:12px;">
          <div>
            <strong>${isHi ? 'स्रोत सत्यापन स्थिति (Source verification):' : 'Source verification:'}</strong>
            <span><strong>${badge.labelEn}</strong> (${badge.displayLabel})</span>
          </div>
          <div>
            <strong>${isHi ? 'सत्यापन जांच समय (verificationCheckedAt):' : 'Verification Checked At (verificationCheckedAt):'}</strong>
            <span>${formatSourceTimestamp(item.verificationCheckedAt || item.verifiedAt || item.fetchedAt, state.lang)}</span>
          </div>
          <div>
            <strong>${isHi ? 'सत्यापन कारण (verificationReason):' : 'Verification Reason (verificationReason):'}</strong>
            <span>${verReason}</span>
          </div>
          ${
            item.editorialState && item.editorialState !== 'active'
              ? `<div>
                  <strong>${isHi ? 'संपादकीय स्थिति (editorialState):' : 'Editorial State (editorialState):'}</strong>
                  <span style="color:var(--status-danger); font-weight:700;">${edBadge.labelEn} (${edBadge.displayLabel})</span>
                </div>`
              : ''
          }
          <div>
            <strong>${isHi ? 'स्रोत प्रकाशन समय (Source Published At):' : 'Source Publication Time:'}</strong>
            ${formatSourceTimestamp(item.publishedAt, state.lang)} (${item.timezone})
          </div>
          <div>
            <strong>${isHi ? 'सिस्टम जांच समय (Fetched At):' : 'Fetched / Checked At:'}</strong>
            ${formatSourceTimestamp(item.fetchedAt, state.lang)}
          </div>
          <div>
            <strong>${isHi ? 'कैननिकल स्रोत URL:' : 'Canonical Source URL:'}</strong>
            <span style="word-break:break-all;">${
              isBlocked || !item.sourceUrl
                ? isHi
                  ? 'अवरुद्ध / असुरक्षित लिंक रोका गया (Withheld — Not Clickable)'
                  : 'Withheld (Unsafe or Unpermitted Source URL Blocked)'
                : item.sourceUrl
            }</span>
          </div>
        </div>

        <div
          style="margin-top:12px; padding:10px 14px; border-radius:6px; border:1px solid var(--border-amber); background:rgba(251, 191, 36, 0.08); font-size:0.84rem; color:var(--text-primary);"
          data-testid="scope-honesty-note"
        >
          <strong>${isHi ? 'सत्यापन सीमा स्पष्टीकरण (Scope-Honesty Note):' : 'Verification Scope Note:'}</strong>
          <span>
            This is the source verification status recorded for the item, not a guarantee that every fact is true.
            ${
              isHi
                ? ' (यह आइटम के लिए दर्ज की गई स्रोत सत्यापन स्थिति है, न कि इस बात की गारंटी कि प्रत्येक तथ्य पूर्णतः सत्य है।)'
                : ''
            }
          </span>
        </div>

        <div class="state-banner" style="margin-top:14px;">
          <h2 style="margin:0 0 6px; font-size:1.05rem; font-family:var(--font-serif);">
            ${
              isBlocked
                ? isHi
                  ? 'अवरुद्ध स्रोत सूचना (Blocked Source — Content & Link Withheld)'
                  : 'Blocked Source Notice (Content & Unsafe Link Withheld)'
                : isHi
                  ? 'अनुमत सारांश एवं अधिकार सूचना (Permitted Summary & Rights Notice)'
                  : 'Permitted Summary & Rights-Safe Attribution'
            }
          </h2>
          <p class="article-summary" data-testid="detail-summary-paragraph">
            ${
              isBlocked
                ? isHi
                  ? `अवरुद्ध (Blocked): इस आइटम का कोई भी स्क्रैप किया गया पाठ, मीडिया या बाहरी URL प्रदर्शित नहीं किया गया है। कारण: ${verReason}`
                  : `Blocked record: no scraped body, media, or clickable unsafe URL is shown. Reason: ${verReason}`
                : summary ||
                  (isHi
                    ? 'कोई अनुमत सारांश उपलब्ध नहीं है। पूर्ण सामग्री के लिए नीचे दिए गए आधिकारिक स्रोत लिंक पर जाएं।'
                    : 'No permitted summary extract. Visit the canonical source link below.')
            }
          </p>
          <p style="margin:10px 0 0; font-size:0.82rem; color:var(--text-muted);">
            ${
              isHi
                ? 'नेत्र न्यूज़ किसी मृत बटन के पीछे नकली पूर्ण लेख नहीं दिखाता और बिना लिखित लाइसेंस के पूर्ण पाठ या फ़ोटो की प्रतिलिपि नहीं बनाता।'
                : 'NETRA NEWS never places a pretend full article behind a dead button and never copies full articles or unlicensed photographs.'
            }
          </p>
          <div class="article-actions" style="margin-top:14px;">
            ${
              isBlocked || !item.sourceUrl
                ? `<span class="withheld-link-notice" data-testid="detail-withheld-link-notice">
                    ⛔ ${
                      isHi
                        ? 'असुरक्षित / अनुमत-रहित बाहरी लिंक रोका गया (Unsafe URL Withheld)'
                        : 'Unsafe / Unpermitted External URL Withheld (Non-Clickable)'
                    }
                  </span>`
                : `<a
                    href="${item.sourceUrl}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="ext-link-btn"
                  >
                    ${
                      isHi
                        ? `मूल प्रकाशक (${publisher}) पर पूर्ण सामग्री पढ़ें ↗`
                        : `Open Original Source at ${publisher} (Safe HTTPS Link) ↗`
                    }
                  </a>`
            }
          </div>
        </div>

        <div class="state-banner" style="margin-top:14px;">
          <h2 style="margin:0 0 6px; font-size:1.05rem; font-family:var(--font-serif);">
            ${isHi ? 'संशोधन इतिहास (Correction History)' : 'Correction History'}
          </h2>
          ${
            item.corrections.length === 0
              ? `<p style="margin:0; font-size:0.88rem; color:var(--text-muted);">
                  ${
                    isHi
                      ? 'इस आइटम के लिए कोई संशोधन दर्ज नहीं किया गया है।'
                      : 'No corrections logged for this record.'
                  }
                </p>`
              : item.corrections
                  .map(
                    (c) => `
                    <div style="font-family:var(--font-mono); font-size:0.82rem; color:var(--amber-400); margin-top:6px;">
                      Corrected At: ${formatSourceTimestamp(c.correctedAt, state.lang)} — ${
                        isHi ? c.reasonHi || c.reason : c.reason
                      }
                    </div>
                  `
                  )
                  .join('')
          }
        </div>

        <!-- 1. REPORT ARTICLE FEATURE (No login required; reviewed by editorial team) -->
        <div
          id="report-article-section"
          class="state-banner"
          style="margin-top:14px; border-color:${
            state.reportPromptOpen ? 'var(--amber-400)' : 'var(--border-subtle)'
          };"
          data-testid="report-article-section"
        >
          <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px;">
            <h2 style="margin:0; font-size:1.08rem; font-family:var(--font-serif); color:var(--amber-400);">
              🚩 ${
                isHi
                  ? 'लेख की रिपोर्ट करें (Report Article — Editorial Review)'
                  : 'Report Article (Editorial Team Review)'
              }
            </h2>
            <span style="font-family:var(--font-mono); font-size:0.76rem; color:var(--text-muted);">
              Article ID: ${item.id}
            </span>
          </div>

          <p style="margin:6px 0 12px; font-size:0.85rem; color:var(--text-secondary);">
            ${
              isHi
                ? 'इस सुविधा के लिए उपयोगकर्ता लॉगिन की आवश्यकता नहीं है। सबमिट की गई सभी रिपोर्टें लेख आईडी (Article ID), समय (Timestamp) और कारण के साथ लॉग की जाती हैं और नेत्र न्यूज़ संपादकीय टीम (Editorial Team) द्वारा उनकी समीक्षा की जाती है।'
                : 'No user login is required. All reports are logged with the Article ID, timestamp, and your reason, and are reviewed by the NETRA NEWS editorial team.'
            }
          </p>

          <form id="report-article-form" data-article-id="${item.id}" data-article-title="${title}">
            <div class="form-field-group" style="margin-top:8px;">
              <label for="report-article-reason-input">
                ${
                  isHi
                    ? 'रिपोर्ट करने का संक्षिप्त कारण लिखें (Brief reason for reporting):'
                    : 'Brief reason for reporting this article:'
                }
              </label>
              <textarea
                id="report-article-reason-input"
                name="reportReason"
                rows="2"
                placeholder="${
                  isHi
                    ? 'उदाहरण: स्रोत शीर्षक या श्रेय की संपादकीय जांच आवश्यक है...'
                    : 'e.g., Please review source attribution or verify latest bulletin update...'
                }"
              ></textarea>
            </div>
            ${
              state.reportArticleError
                ? `<div style="color:var(--status-danger); font-size:0.85rem; margin-bottom:10px; font-weight:600;" data-testid="report-article-error">
                    ${state.reportArticleError}
                  </div>`
                : ''
            }
            ${
              state.reportArticleNotice
                ? `<div style="color:var(--status-ok); font-size:0.85rem; margin-bottom:10px; font-weight:600;" data-testid="report-article-notice">
                    ${state.reportArticleNotice}
                  </div>`
                : ''
            }
            <button type="submit" class="btn-amber" id="submit-report-article-btn">
              ${
                isHi
                  ? 'संपादकीय समीक्षा के लिए रिपोर्ट सबमिट करें (Submit Article Report)'
                  : 'Submit Report for Editorial Review'
              }
            </button>
          </form>

          <div style="margin-top:14px; border-top:1px solid var(--border-subtle); padding-top:10px;" data-testid="article-reports-list">
            <strong style="font-size:0.84rem; color:var(--text-secondary);">
              ${
                isHi
                  ? `इस लेख के लिए दर्ज की गई रिपोर्टें (${articleReports.length}):`
                  : `Logged Reports for This Article (${articleReports.length}):`
              }
            </strong>
            ${
              articleReports.length === 0
                ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">
                    ${
                      isHi
                        ? 'इस लेख के लिए अभी तक कोई रिपोर्ट दर्ज नहीं की गई है।'
                        : 'No reports logged for this article yet.'
                    }
                  </div>`
                : articleReports
                    .map(
                      (r) => `
                      <div style="margin-top:8px; padding:8px 10px; border-radius:6px; background:var(--navy-950); border:1px solid var(--border-subtle); font-size:0.82rem;">
                        <div>
                          <strong>Article ID:</strong> <code>${r.articleId}</code> ·
                          <strong>Timestamp:</strong> <code>${r.timestamp}</code> ·
                          <span style="color:var(--amber-400);">Reviewed by Editorial Team Queue (${r.storageMode ?? 'local_draft_only'})</span>
                        </div>
                        <div style="margin-top:4px; color:var(--text-primary);">
                          <strong>Reason:</strong> ${r.reason}
                        </div>
                      </div>
                    `
                    )
                    .join('')
            }
          </div>
        </div>

        <!-- 2. STRUCTURED ARTICLE ISSUE FEEDBACK SYSTEM (Spec v3 Page 8 Items 1-9) -->
        <div class="state-banner" style="margin-top:14px;" id="article-feedback-section" data-testid="article-feedback-section">
          <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px;">
            <h2 style="margin:0 0 6px; font-size:1.08rem; font-family:var(--font-serif);">
              ${
                isHi
                  ? 'लेख प्रतिक्रिया एवं त्रुटि रिपोर्ट प्रणाली (Article Issue Feedback System — Spec v3 §8)'
                  : 'Article Issue Feedback System (Report Inaccuracies, Broken Links or Outdated Info)'
              }
            </h2>
            <span class="verification-badge" data-verification="pending">
              ${isHi ? 'चरण 1: स्थानीय ड्राफ्ट (Remote Submit Disabled)' : 'Stage 1: Local Draft Only (Remote Submit Disabled)'}
            </span>
          </div>
          <p style="margin:0 0 12px; font-size:0.85rem; color:var(--text-secondary);">
            ${
              isHi
                ? 'तथ्यगत त्रुटि (inaccuracy), टूटे हुए लिंक (brokenLink), पुरानी जानकारी (outdated) या अन्य समस्या की रिपोर्ट करें। बिना खाते या संपर्क के सबमिट किया जा सकता है। विवरण 20–2000 अक्षरों का होना चाहिए।'
                : 'Report inaccuracies, broken links, or outdated information without an account or contact. Description requires 20–2000 plain-text characters.'
            }
          </p>

          <form id="article-feedback-form" data-article-id="${item.id}" data-article-title="${title}">
            <div style="display:none;" aria-hidden="true">
              <label for="article-fb-honeypot">Leave empty</label>
              <input type="text" id="article-fb-honeypot" name="honeypot" tabindex="-1" autocomplete="off" />
            </div>

            <div class="form-field-group">
              <label for="feedback-article-id-input">
                ${isHi ? 'लेख आईडी (Prefilled Article ID):' : 'Prefilled Article ID:'}
              </label>
              <input
                type="text"
                id="feedback-article-id-input"
                name="articleId"
                value="${item.id}"
                readonly
                style="opacity:0.85; font-family:var(--font-mono);"
              />
            </div>

            <div class="form-field-group">
              <label for="feedback-issue-type-select">
                ${isHi ? 'समस्या का प्रकार चुनें (Select Issue Type):' : 'Issue Type:'}
              </label>
              <select id="feedback-issue-type-select" name="issueType">
                <option value="inaccuracy" ${state.feedbackSelectedType === 'inaccuracy' ? 'selected' : ''}>
                  ${isHi ? '1. तथ्यगत त्रुटि (inaccuracy — Factual Inaccuracy)' : '1. Factual Inaccuracy (inaccuracy)'}
                </option>
                <option value="brokenLink" ${state.feedbackSelectedType === 'brokenLink' ? 'selected' : ''}>
                  ${isHi ? '2. टूटा हुआ स्रोत लिंक (brokenLink — Broken Source Link)' : '2. Broken Source Link (brokenLink)'}
                </option>
                <option value="outdated" ${state.feedbackSelectedType === 'outdated' ? 'selected' : ''}>
                  ${isHi ? '3. पुरानी जानकारी (outdated — Outdated Information)' : '3. Outdated Information (outdated)'}
                </option>
                <option value="other" ${state.feedbackSelectedType === 'other' ? 'selected' : ''}>
                  ${isHi ? '4. अन्य / श्रेय समस्या (other — Other / Attribution Issue)' : '4. Other / Attribution Issue (other)'}
                </option>
                <option value="general" ${state.feedbackSelectedType === 'general' ? 'selected' : ''}>
                  ${isHi ? '5. सामान्य प्रतिक्रिया (general — General Feedback)' : '5. General Feedback (general)'}
                </option>
              </select>
            </div>

            <div class="form-field-group">
              <label for="feedback-comments-input">
                ${
                  isHi
                    ? 'समस्या का विवरण / टिप्पणी (Description — अनिवार्य, 20 से 2000 सादे अक्षर):'
                    : 'Issue Description / Comments (Required, 20–2000 plain-text characters):'
                }
              </label>
              <textarea
                id="feedback-comments-input"
                name="comments"
                rows="3"
                minlength="20"
                maxlength="2000"
                placeholder="${
                  isHi
                    ? 'कम से कम 20 अक्षरों में समस्या का विवरण लिखें (उदाहरण: कैननिकल लिंक 404 दे रहा है या प्रकाशन समय अपडेट करने की आवश्यकता है)...'
                    : 'Describe the inaccuracy, broken link, or outdated info in 20–2000 characters (do not include personal or child data)...'
                }"
              ></textarea>
            </div>

            <div class="form-field-group">
              <label for="feedback-contact-input">
                ${
                  isHi
                    ? 'वैकल्पिक संपर्क (Optional Contact — अधिकतम 160 अक्षर, अनाम रिपोर्ट के लिए खाली छोड़ें):'
                    : 'Optional Contact (Max 160 chars — leave blank for anonymous submission):'
                }
              </label>
              <input
                type="text"
                id="feedback-contact-input"
                name="contact"
                maxlength="160"
                placeholder="${
                  isHi
                    ? 'वैकल्पिक: केवल समस्या पर फॉलो-अप के लिए (1-क्लिक में हटाने योग्य)'
                    : 'Optional: used only to follow up on this issue (deletable anytime)'
                }"
              />
            </div>

            <div
              style="margin-bottom:12px; padding:10px 12px; border-radius:6px; background:var(--navy-950); border:1px solid var(--border-subtle); font-size:0.78rem; color:var(--text-secondary);"
              data-testid="feedback-privacy-retention-notice"
            >
              <strong>${
                isHi
                  ? 'गोपनीयता, बाल-सुरक्षा एवं प्रतिधारण नीति (Privacy & Retention Notice — Spec v3 §8.6–8.9):'
                  : 'Privacy, Child-Safety & Retention Notice (Spec v3 §8.6–8.9):'
              }</strong>
              <div style="margin-top:4px;">
                ${
                  isHi
                    ? '• वैकल्पिक संपर्क का उपयोग केवल फॉलो-अप के लिए किया जाता है, यह केवल प्रमाणित समीक्षकों के लिए सुलभ है (सार्वजनिक रूप से कभी नहीं), और आप इसे नीचे 1-क्लिक में हटा सकते हैं। विवरण में व्यक्तिगत डेटा या बच्चों का संपर्क न लिखें। प्रस्तावित प्रतिधारण डिफ़ॉल्ट (लॉन्च से पहले अनुमोदन हेतु): समाधान के 30 दिनों के भीतर संपर्क हटाना; अनसुलझी प्रतिक्रिया 90 दिनों तक। चरण 1 में निजी स्टोरेज न जुड़ा होने के कारण रिमोट सर्वर सबमिट अक्षम है।'
                    : '• Optional contact is used only for follow-up, accessible only to authenticated editorial reviewers (never public), and can be deleted anytime below. Do not include personal data or child contact in descriptions. Proposed retention defaults (to approve before launch): delete optional contact within 30 days after resolution; unresolved feedback within 90 days. Because private reviewer storage is not connected in Stage 1, remote submit is disabled and only a local draft is preserved on your device.'
                }
              </div>
            </div>

            ${
              state.feedbackError
                ? `<div style="color:var(--status-danger); font-size:0.85rem; margin-bottom:10px; font-weight:600;" data-testid="article-feedback-error">
                    ${state.feedbackError}
                  </div>`
                : ''
            }
            ${
              state.feedbackNotice
                ? `<div style="color:var(--status-ok); font-size:0.85rem; margin-bottom:10px; font-weight:600;" data-testid="article-feedback-notice">
                    ${state.feedbackNotice}
                  </div>`
                : ''
            }

            <div style="display:flex; flex-wrap:wrap; align-items:center; gap:10px;">
              <button
                type="button"
                disabled
                aria-disabled="true"
                class="btn-quiet"
                style="opacity:0.65; cursor:not-allowed;"
                data-testid="remote-article-submit-disabled-btn"
                title="Private editorial storage is not connected in Stage 1"
              >
                ${
                  isHi
                    ? '🔒 रिमोट सर्वर सबमिट अनुपलब्ध (Stage 1 Private Storage Unavailable)'
                    : '🔒 Remote Server Submit Unavailable (Stage 1 Private Storage Not Connected)'
                }
              </button>

              <button type="submit" class="btn-amber" id="submit-article-feedback-btn">
                ${
                  isHi
                    ? 'डिवाइस पर स्थानीय प्रतिक्रिया ड्राफ्ट दर्ज करें (Save Local Feedback Draft)'
                    : 'Save Local Feedback Draft for Review'
                }
              </button>
              <a href="/corrections" data-nav="/corrections" class="nav-link-btn" style="border:1px solid var(--border-subtle);">
                ${
                  isHi
                    ? 'सभी दर्ज रिपोर्ट और प्रतिक्रियाएं देखें (View Full Review Log)'
                    : 'View Full Editorial Review Log (/corrections)'
                }
              </a>
            </div>
          </form>

          <div style="margin-top:14px; border-top:1px solid var(--border-subtle); padding-top:10px;" data-testid="article-feedback-list">
            <strong style="font-size:0.84rem; color:var(--text-secondary);">
              ${
                isHi
                  ? `इस लेख के लिए स्थानीय प्रतिक्रिया ड्राफ्ट (${articleFeedbackList.length}):`
                  : `Local Issue Feedback Drafts for This Article (${articleFeedbackList.length}):`
              }
            </strong>
            ${
              articleFeedbackList.length === 0
                ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">
                    ${
                      isHi
                        ? 'इस लेख के लिए अभी तक कोई प्रतिक्रिया ड्राफ्ट दर्ज नहीं किया गया है।'
                        : 'No issue feedback drafts logged for this article yet.'
                    }
                  </div>`
                : articleFeedbackList
                    .map(
                      (fb) => `
                      <div style="margin-top:8px; padding:8px 10px; border-radius:6px; background:var(--navy-950); border:1px solid var(--border-subtle); font-size:0.82rem;">
                        <div>
                          <strong>Article ID:</strong> <code>${fb.articleId}</code> ·
                          <strong>Issue Type:</strong> <code>${fb.issueType}</code> ·
                          <strong>Status:</strong> <code>${fb.reviewStatus ?? 'new'} (${fb.storageMode ?? 'local_draft_only'})</code> ·
                          <strong>Created:</strong> <code>${fb.createdAt || fb.timestamp}</code>
                        </div>
                        <div style="margin-top:4px; color:var(--text-primary);">
                          <strong>Description:</strong> ${fb.description || fb.comments}
                        </div>
                        <div style="margin-top:4px; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px;">
                          <span style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-muted);">
                            Contact: ${fb.contact ? `[Saved: ${fb.contact}]` : 'None (Anonymous)'}
                          </span>
                          <div style="display:flex; gap:8px;">
                            ${
                              fb.contact
                                ? `<button type="button" class="btn-quiet delete-feedback-contact-btn" data-feedback-id="${
                                    fb.feedbackId || fb.id
                                  }" style="min-height:32px; padding:3px 8px; font-size:0.74rem;">
                                    🗑️ ${isHi ? 'संपर्क हटाएं (Delete Contact)' : 'Delete Optional Contact'}
                                  </button>`
                                : ''
                            }
                            <button type="button" class="btn-quiet delete-feedback-draft-btn" data-feedback-id="${
                              fb.feedbackId || fb.id
                            }" style="min-height:32px; padding:3px 8px; font-size:0.74rem;">
                              ✕ ${isHi ? 'ड्राफ्ट हटाएं' : 'Delete Draft'}
                            </button>
                          </div>
                        </div>
                      </div>
                    `
                    )
                    .join('')
            }
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderNotFoundPage(attemptedPath: string): string {
  const isHi = state.lang === 'hi';
  return `
    <section class="state-banner" data-state="unavailable" style="margin-top:24px;">
      <div class="article-kicker-meta">
        <strong>HTTP 404 — ROUTE NOT FOUND</strong>
        <span aria-hidden="true"> · </span>
        <span>Path: ${sanitizeString(attemptedPath)}</span>
      </div>
      <h1 class="section-title" style="margin-top:10px;">
        ${
          isHi
            ? 'पृष्ठ नहीं मिला (404 — यह मार्ग मौजूद नहीं है या चरण 5 के लिए नियोजित है)'
            : '404 — Page Not Found or Stage Not Yet Enabled'
        }
      </h1>
      <p class="article-summary" style="margin-top:8px;">
        ${
          isHi
            ? 'डीप लिंक को हमेशा एक वास्तविक पृष्ठ या स्पष्ट 404 लौटाना चाहिए। मुख्य समाचार पृष्ठ पर लौटने के लिए नीचे क्लिक करें।'
            : 'Deep links return either a verified Stage 1 route or this explicit 404 screen (never a fake placeholder page).'
        }
      </p>
      <div class="article-actions" style="margin-top:16px;">
        <a href="/" data-nav="/" class="btn-amber" style="padding:10px 18px; border-radius:6px; text-decoration:none;">
          ${isHi ? 'मुख्य पृष्ठ पर जाएं (Return Home)' : 'Return to Newspaper Home (/)'}
        </a>
      </div>
    </section>
  `;
}

function renderApp(): void {
  const root = document.getElementById('root');
  if (!root) return;

  document.documentElement.lang = state.lang;
  document.body.setAttribute('data-power-tier', state.powerTier);
  document.body.setAttribute('data-route', state.route);

  const isHi = state.lang === 'hi';
  const { envelope, loadState, validation } = getActiveEnvelopeAndValidation();
  const items = validation.acceptedItems;

  let mainContentHtml = '';
  if (state.route === '/') {
    mainContentHtml = renderHomeOrScopePage('all', items, loadState, validation.envelopeError);
  } else if (state.route === '/local') {
    mainContentHtml = renderHomeOrScopePage('local', items, loadState, validation.envelopeError);
  } else if (state.route === '/state') {
    mainContentHtml = renderHomeOrScopePage('state', items, loadState, validation.envelopeError);
  } else if (state.route === '/national') {
    mainContentHtml = renderHomeOrScopePage('national', items, loadState, validation.envelopeError);
  } else if (state.route.startsWith('/article/')) {
    const id = state.route.replace('/article/', '');
    mainContentHtml = renderArticleDetailPage(id, items);
  } else if (state.route === '/weather') {
    mainContentHtml = renderWeatherPage(state.lang, state.locationPref, state.hazardPreviewState);
  } else if (state.route === '/earthquakes') {
    mainContentHtml = renderEarthquakesPage(state.lang, state.hazardPreviewState);
  } else if (state.route === '/sources') {
    mainContentHtml = renderSourcesLedgerPage(state.lang);
  } else if (state.route === '/corrections') {
    mainContentHtml = renderCorrectionsPage(
      state.lang,
      items,
      loadCorrectionDrafts(),
      loadArticleReports(),
      loadArticleFeedback(),
      {
        error: state.generalFeedbackError,
        notice: state.generalFeedbackNotice,
      }
    );
  } else if (state.route === '/privacy') {
    mainContentHtml = renderPrivacyAndPowerPage(
      state.lang,
      state.powerInput,
      state.powerTier,
      state.circuitBreaker,
      loadBoundedLogs()
    );
  } else if (state.route === '/about') {
    mainContentHtml = renderAboutAndHandoffPage(
      state.lang,
      state.powerTier,
      state.spatialKioskExpanded
    );
  } else {
    mainContentHtml = renderNotFoundPage(state.route);
  }

  root.innerHTML = `
    <header class="netra-header">
      <div class="netra-header-inner">
        <div class="brand-lockup">
          <a href="/" data-nav="/" class="brand-title-link">
            ${isHi ? 'नेत्र न्यूज़ — NETRA NEWS' : 'NETRA NEWS — नेत्र न्यूज़'}
          </a>
          <div class="brand-meta-line">
            v0.1.0-stage1 · 6 Nov 2026 · Schema v${envelope.schemaVersion} · Power Tier: ${state.powerTier} (${state.powerInput.batteryPct}%)
          </div>
        </div>

        <div class="header-controls">
          <button
            type="button"
            id="header-category-prefs-btn"
            aria-label="${isHi ? 'पसंदीदा श्रेणियां चुनें' : 'Select Preferred Categories'}"
          >
            ⚙️ ${
              isHi
                ? `श्रेणियां (${state.categoryPrefs.selectedCategories.length})`
                : `Categories (${state.categoryPrefs.selectedCategories.length})`
            }
          </button>

          <button
            type="button"
            id="header-city-picker-btn"
            aria-label="${isHi ? 'शहर बदलें' : 'Change City'}"
          >
            📍 ${isHi ? state.locationPref.cityLabelHi : state.locationPref.cityLabel}
          </button>

          <button
            type="button"
            id="header-lang-toggle-btn"
            class="btn-amber"
            aria-label="${isHi ? 'Switch language to English' : 'भाषा बदलकर हिन्दी करें'}"
          >
            ${isHi ? 'English (EN)' : 'हिन्दी (HI)'}
          </button>
        </div>
      </div>

      <nav class="netra-nav-bar" aria-label="${isHi ? 'मुख्य नेविगेशन' : 'Primary Navigation'}">
        <div class="netra-nav-inner">
          <a id="nav-home" href="/" data-nav="/" class="nav-link-btn" ${state.route === '/' ? 'aria-current="page"' : ''}>
            ${isHi ? 'मुख्य पृष्ठ (Home)' : 'Home'}
          </a>
          <a id="nav-local" href="/local" data-nav="/local" class="nav-link-btn" ${state.route === '/local' ? 'aria-current="page"' : ''}>
            ${isHi ? 'स्थानीय (Local)' : 'Local'}
          </a>
          <a id="nav-state" href="/state" data-nav="/state" class="nav-link-btn" ${state.route === '/state' ? 'aria-current="page"' : ''}>
            ${isHi ? 'राज्य (State)' : 'State'}
          </a>
          <a id="nav-national" href="/national" data-nav="/national" class="nav-link-btn" ${state.route === '/national' ? 'aria-current="page"' : ''}>
            ${isHi ? 'राष्ट्रीय (National)' : 'National'}
          </a>
          <a id="nav-weather" href="/weather" data-nav="/weather" class="nav-link-btn" ${state.route === '/weather' ? 'aria-current="page"' : ''}>
            ${isHi ? 'मौसम (Weather)' : 'Weather'}
          </a>
          <a id="nav-earthquakes" href="/earthquakes" data-nav="/earthquakes" class="nav-link-btn" ${state.route === '/earthquakes' ? 'aria-current="page"' : ''}>
            ${isHi ? 'भूकंप (Earthquakes)' : 'Earthquakes'}
          </a>
          <a id="nav-sources" href="/sources" data-nav="/sources" class="nav-link-btn" ${state.route === '/sources' ? 'aria-current="page"' : ''}>
            ${isHi ? 'स्रोत (Sources)' : 'Sources'}
          </a>
          <a id="nav-about" href="/about" data-nav="/about" class="nav-link-btn" ${state.route === '/about' ? 'aria-current="page"' : ''}>
            ${isHi ? 'फ़ीचर मैट्रिक्स एवं 3D (About & XR)' : 'About & XR'}
          </a>

          <button
            type="button"
            class="nav-planned-item"
            disabled
            aria-disabled="true"
            title="Planned for Stage 5 expansion after Local/State/National verification"
          >
            ${isHi ? 'विश्व (Planned Stage 5)' : 'World (Planned)'}
          </button>
          <button
            type="button"
            class="nav-planned-item"
            disabled
            aria-disabled="true"
            title="Planned for Stage 5: requires human editorial byline & review workflow"
          >
            ${isHi ? 'ब्लॉग (Planned Stage 5)' : 'Blogs (Planned)'}
          </button>
          <button
            type="button"
            class="nav-planned-item"
            disabled
            aria-disabled="true"
            title="Planned for Stage 5: requires permitted Panchang source & timezone ephemeris"
          >
            ${isHi ? 'संस्कृति/ज्योतिष (Planned Stage 5)' : 'Culture/Astrology (Planned)'}
          </button>
        </div>
      </nav>

      <div class="operational-ribbon">
        <div class="operational-ribbon-inner">
          <div>
            <strong>${isHi ? 'फ़ीड सत्यापन मोड (Feed Contract Mode):' : 'Feed Contract Mode:'}</strong>
            <span>
              ${
                isHi
                  ? 'खाली, लिंक-ओनली, ऑफ़लाइन कैश और [TEST] फिक्स्चर व्यवहार का निरीक्षण करें'
                  : 'Inspect Stage 1 Official Link-Only, Production Empty, Stale/Offline, and [TEST] Fixture states'
              }
            </span>
          </div>
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
            <label for="feed-mode-select" style="font-weight:600;">
              ${isHi ? 'फ़ीड अवस्था:' : 'Feed State:'}
            </label>
            <select id="feed-mode-select" class="mode-select" aria-label="Feed verification mode">
              <option value="official_links" ${state.feedMode === 'official_links' ? 'selected' : ''}>
                1. Stage 1 Official Portal Links (rightsStatus=linkOnly)
              </option>
              <option value="production_empty" ${state.feedMode === 'production_empty' ? 'selected' : ''}>
                2. Production Empty Verified Feed (items=[])
              </option>
              <option value="stale_offline" ${state.feedMode === 'stale_offline' ? 'selected' : ''}>
                3. Stale / Offline Cache Simulation
              </option>
              <option value="test_fixtures" ${state.feedMode === 'test_fixtures' ? 'selected' : ''}>
                4. [TEST] Specification Fixture Inspection (id=test-001..004)
              </option>
            </select>
          </div>
        </div>
      </div>
    </header>

    <main id="main-content" class="netra-shell">
      ${mainContentHtml}

      <footer class="netra-footer">
        <div class="footer-columns">
          <div>
            <strong style="color:var(--text-primary); font-family:var(--font-serif); font-size:1.05rem;">
              ${isHi ? 'नेत्र न्यूज़ (NETRA NEWS)' : 'NETRA NEWS (नेत्र न्यूज़)'}
            </strong>
            <p style="margin:8px 0 0;">
              ${
                isHi
                  ? 'हिन्दी-प्रथम, स्रोत-चिह्नित, अधिकार-सुरक्षित और अल्ट्रा-लो-पावर 24/7 समाचार पत्र वेबसाइट (लक्ष्य: 15 नवंबर 2026)। ब्रेकिंग या लाइव समाचार के दौरान कोई विज्ञापन नहीं।'
                  : 'Hindi-first, source-labelled, rights-safe, ultra-low-power 24/7 newspaper website (Target: 15 Nov 2026). Zero ads during Live or Breaking News.'
              }
            </p>
          </div>

          <div>
            <strong style="color:var(--text-primary);">
              ${isHi ? 'संपादकीय एवं नीति पृष्ठ (Governance & Policies)' : 'Editorial & Governance Links'}
            </strong>
            <ul class="footer-nav-list">
              <li><a href="/about" data-nav="/about">${isHi ? 'हमारे बारे में एवं फ़ीचर मैट्रिक्स (About & Matrix)' : 'About, Feature Matrix & Open Decisions'}</a></li>
              <li><a href="/sources" data-nav="/sources">${isHi ? 'संपादकीय एवं स्रोत नीति (Editorial & Source Policy)' : 'Editorial & Source Allowlist Policy'}</a></li>
              <li><a href="/corrections" data-nav="/corrections">${isHi ? 'संशोधन, समस्या रिपोर्ट एवं सामान्य प्रतिक्रिया (Corrections & Feedback)' : 'Corrections, Issue Reports & General Feedback'}</a></li>
              <li><a href="/privacy" data-nav="/privacy">${isHi ? 'गोपनीयता, शर्तें एवं पावर बजट (Privacy, Terms & Power)' : 'Privacy, Terms, Accessibility & Power Budget'}</a></li>
            </ul>
          </div>

          <div>
            <strong style="color:var(--text-primary);">
              ${isHi ? 'नेत्र इकोसिस्टम एवं सामाजिक लिंक (Netra Ecosystem)' : 'Netra Ecosystem & Verified Destinations'}
            </strong>
            <p style="margin:8px 0 0; font-size:0.82rem;">
              ${
                isHi
                  ? 'नेत्र परिवार लिंक नीति: केवल हैंडऑफ़ के दौरान प्रदान किए गए सत्यापित वर्तमान ऐप पृष्ठ जोड़े जाते हैं। कोई अनुमानित सोशल मीडिया हैंडल या असत्यापित लिंक शामिल नहीं किया गया है।'
                  : 'Netra Family Link Policy: Links only to verified current app pages supplied during owner handoff. No guessed social media handles or unverified URLs are rendered.'
              }
            </p>
          </div>
        </div>
      </footer>
    </main>

    ${renderCityPickerModal(state.cityModal, state.locationPref, state.lang, state.powerTier)}
    ${renderCategoryPrefsModal()}
  `;

  bindEventsAndLifecycle(items);
}

function navigateTo(path: string): void {
  const normalized = normalizePath(path);
  state.route = normalized;
  state.reportPromptOpen = false;
  state.reportArticleError = null;
  state.reportArticleNotice = null;
  state.feedbackError = null;
  state.feedbackNotice = null;
  state.generalFeedbackError = null;
  state.generalFeedbackNotice = null;
  window.history.pushState({}, '', normalized);
  renderApp();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function bindEventsAndLifecycle(activeArticles: ArticleRecord[]): void {
  // Mount or dispose the Embedded 3D Newsroom Viewport based on route, expansion, and PowerTier
  const viewportEl = document.getElementById('embedded-3d-viewport');
  if (state.route === '/about' && state.spatialKioskExpanded && state.powerTier === 'Normal' && viewportEl) {
    embeddedViewport.mount(viewportEl, state.powerTier);
  } else {
    embeddedViewport.dispose();
  }

  // SPA navigation links
  document.querySelectorAll<HTMLAnchorElement>('a[data-nav]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      const target = anchor.getAttribute('data-nav') || '/';
      navigateTo(target);
    });
  });

  // Language toggle
  document.getElementById('header-lang-toggle-btn')?.addEventListener('click', () => {
    state.lang = state.lang === 'hi' ? 'en' : 'hi';
    saveLanguage(state.lang);
    renderApp();
  });

  // Feed mode selector
  const feedSelect = document.getElementById('feed-mode-select') as HTMLSelectElement | null;
  feedSelect?.addEventListener('change', () => {
    const val = feedSelect.value as FeedSimulationMode;
    state.feedMode = val;
    saveFeedMode(val);
    appendBoundedLog('FEED_MODE_CHANGE', state.powerTier, `Switched feed mode to ${val}`);
    renderApp();
  });

  // Restore official links from empty state
  document.getElementById('restore-official-links-btn')?.addEventListener('click', () => {
    state.feedMode = 'official_links';
    saveFeedMode('official_links');
    renderApp();
  });

  // Open City Picker Modal
  const openCityModal = () => {
    state.cityModal = {
      isOpen: true,
      selectedCountry: state.locationPref.countryCode,
      selectedState: state.locationPref.stateCode,
      selectedCityId: state.locationPref.cityId,
      geoStatusMessage: null,
      geoStatusType: null,
      ambiguousCandidates: [],
    };
    renderApp();
  };
  document.getElementById('header-city-picker-btn')?.addEventListener('click', openCityModal);
  document.getElementById('home-change-city-btn')?.addEventListener('click', openCityModal);

  // Close City Picker Modal
  const closeCityModal = () => {
    state.cityModal.isOpen = false;
    renderApp();
  };
  document.getElementById('close-city-modal-btn')?.addEventListener('click', closeCityModal);
  document.getElementById('cancel-city-modal-btn')?.addEventListener('click', closeCityModal);

  // State dropdown inside City Picker Modal updates City dropdown
  const stateSelect = document.getElementById('select-state') as HTMLSelectElement | null;
  stateSelect?.addEventListener('change', () => {
    const newStateCode = stateSelect.value;
    const firstCityInState = PACKAGED_CITIES.find((c) => c.stateCode === newStateCode);
    state.cityModal.selectedState = newStateCode;
    if (firstCityInState) {
      state.cityModal.selectedCityId = firstCityInState.cityId;
    }
    renderApp();
  });

  const citySelect = document.getElementById('select-city') as HTMLSelectElement | null;
  citySelect?.addEventListener('change', () => {
    state.cityModal.selectedCityId = citySelect.value;
  });

  // Save manual Country > State > City form
  const manualForm = document.getElementById('manual-city-form') as HTMLFormElement | null;
  manualForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const chosenCity = PACKAGED_CITIES.find((c) => c.cityId === state.cityModal.selectedCityId);
    if (!chosenCity) return;
    const updatedPref: LocationPreference = {
      countryCode: chosenCity.countryCode,
      stateCode: chosenCity.stateCode,
      cityId: chosenCity.cityId,
      cityLabel: `${chosenCity.nameEn}, ${chosenCity.stateNameEn}`,
      cityLabelHi: `${chosenCity.nameHi}, ${chosenCity.stateNameHi}`,
      selectionMode: 'manual',
      updatedAt: new Date().toISOString(),
      enabled: true,
    };
    state.locationPref = saveLocationPreference(updatedPref);
    state.cityModal.isOpen = false;
    appendBoundedLog('MANUAL_CITY_SAVED', state.powerTier, `City set to ${chosenCity.cityId}`);
    renderApp();
  });

  // Opt-in Approximate Location Button
  document.getElementById('use-approx-location-btn')?.addEventListener('click', () => {
    runBrowserApproximateLocation((res) => {
      state.cityModal.geoStatusMessage = res.message;
      state.cityModal.geoStatusType = res.type;
      state.cityModal.ambiguousCandidates = res.candidates;
      if (res.ok && res.pref && res.candidates.length === 1) {
        state.locationPref = saveLocationPreference(res.pref);
        state.cityModal.selectedState = res.pref.stateCode;
        state.cityModal.selectedCityId = res.pref.cityId;
      }
      appendBoundedLog('APPROX_LOCATION_ATTEMPT', state.powerTier, `Result ok=${res.ok} (raw coords discarded)`);
      renderApp();
    }, state.lang);
  });

  // Simulate Ambiguous NCR Coordinates (New Delhi / Noida)
  document.getElementById('sim-ambiguous-geo-btn')?.addEventListener('click', () => {
    const res = resolveCityFromTransientCoords(28.58, 77.3, PACKAGED_CITIES, new Date().toISOString());
    state.cityModal.geoStatusType = 'warning';
    state.cityModal.ambiguousCandidates = res.ambiguousCandidates;
    state.cityModal.geoStatusMessage =
      state.lang === 'hi'
        ? 'निकटतम शहर अस्पष्टता: नई दिल्ली और नोएडा दोनों 35 किमी के भीतर हैं। कच्चे निर्देशांक हटा दिए गए हैं — कृपया अपना शहर चुनें:'
        : 'Nearest-city ambiguity detected: New Delhi and Noida are within 35 km. Raw coordinates discarded — please confirm your city:';
    renderApp();
  });

  // Simulate Geolocation Permission Denied
  document.getElementById('sim-denied-geo-btn')?.addEventListener('click', () => {
    state.cityModal.geoStatusType = 'error';
    state.cityModal.ambiguousCandidates = [];
    state.cityModal.geoStatusMessage =
      state.lang === 'hi'
        ? 'स्थान अनुमति अस्वीकृत (PERMISSION_DENIED)। समाचार अवरुद्ध नहीं हैं — मैनुअल शहर चयन सक्रिय है।'
        : 'Browser geolocation permission denied (PERMISSION_DENIED). News is never blocked — manual city selection remains active.';
    renderApp();
  });

  // Confirm ambiguous city candidate
  document.querySelectorAll<HTMLButtonElement>('.resolve-ambiguous-city-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cid = btn.getAttribute('data-city-id');
      const city = PACKAGED_CITIES.find((c) => c.cityId === cid);
      if (!city) return;
      const updatedPref: LocationPreference = {
        countryCode: city.countryCode,
        stateCode: city.stateCode,
        cityId: city.cityId,
        cityLabel: `${city.nameEn}, ${city.stateNameEn}`,
        cityLabelHi: `${city.nameHi}, ${city.stateNameHi}`,
        selectionMode: 'approximate',
        updatedAt: new Date().toISOString(),
        enabled: true,
      };
      state.locationPref = saveLocationPreference(updatedPref);
      state.cityModal.selectedState = city.stateCode;
      state.cityModal.selectedCityId = city.cityId;
      state.cityModal.ambiguousCandidates = [];
      state.cityModal.geoStatusType = 'info';
      state.cityModal.geoStatusMessage =
        state.lang === 'hi'
          ? `${city.nameHi} की पुष्टि की गई (कच्चे निर्देशांक सहेजे नहीं गए)।`
          : `Confirmed ${city.nameEn} (raw coordinates never persisted).`;
      renderApp();
    });
  });

  // Weather & Earthquakes state switcher buttons
  document.querySelectorAll<HTMLButtonElement>('.hazard-state-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-hazard-mode') as
        | 'unavailable'
        | 'stale'
        | 'all_clear_test'
        | null;
      if (mode) {
        state.hazardPreviewState = mode;
        renderApp();
      }
    });
  });

  // Open Category Preferences Modal
  const openCategoryModal = () => {
    state.categoryModal = {
      isOpen: true,
      draftCategories: [...state.categoryPrefs.selectedCategories],
      savedNotice: null,
    };
    renderApp();
  };
  document.getElementById('header-category-prefs-btn')?.addEventListener('click', openCategoryModal);
  document.getElementById('home-customize-categories-btn')?.addEventListener('click', openCategoryModal);

  const closeCategoryModal = () => {
    state.categoryModal.isOpen = false;
    renderApp();
  };
  document.getElementById('close-category-modal-btn')?.addEventListener('click', closeCategoryModal);
  document.getElementById('cancel-category-modal-btn')?.addEventListener('click', closeCategoryModal);

  // Reset Category Preferences to default
  document.getElementById('reset-category-prefs-btn')?.addEventListener('click', () => {
    state.categoryModal.draftCategories = [...DEFAULT_CATEGORY_PREFERENCES.selectedCategories];
    renderApp();
  });

  // Save Category Preferences Form inside Modal
  const categoryPrefsForm = document.getElementById('category-prefs-form') as HTMLFormElement | null;
  categoryPrefsForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const checkedBoxes = Array.from(
      categoryPrefsForm.querySelectorAll<HTMLInputElement>('input[name="preferredCategory"]:checked')
    );
    const chosen = checkedBoxes.map((cb) => cb.value as PreferredCategoryKey);
    const saved = saveCategoryPreferences({
      selectedCategories: chosen.length > 0 ? chosen : [...DEFAULT_CATEGORY_PREFERENCES.selectedCategories],
      updatedAt: new Date().toISOString(),
    });
    state.categoryPrefs = saved;
    state.categoryModal.isOpen = false;
    state.categoryModal.savedNotice =
      state.lang === 'hi'
        ? `आपकी पसंदीदा श्रेणियां (${saved.selectedCategories.length}) डिवाइस पर सहेज ली गई हैं।`
        : `Saved ${saved.selectedCategories.length} preferred categories to device storage.`;
    appendBoundedLog(
      'CATEGORY_PREFS_SAVED',
      state.powerTier,
      `Categories=${saved.selectedCategories.join(',')}`
    );
    renderApp();
  });

  // Quick-toggle category chips on the Home bar
  document.querySelectorAll<HTMLButtonElement>('.quick-toggle-category-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-category-key') as PreferredCategoryKey | null;
      if (!key) return;
      const current = new Set(state.categoryPrefs.selectedCategories);
      if (current.has(key) && current.size > 1) {
        current.delete(key);
      } else {
        current.add(key);
      }
      const saved = saveCategoryPreferences({
        selectedCategories: Array.from(current),
        updatedAt: new Date().toISOString(),
      });
      state.categoryPrefs = saved;
      state.categoryModal.savedNotice =
        state.lang === 'hi'
          ? `श्रेणी प्राथमिकता अद्यतन: ${saved.selectedCategories.map((k) => CATEGORY_META[k].labelHi).join(', ')}`
          : `Updated preferred categories: ${saved.selectedCategories.map((k) => CATEGORY_META[k].labelEn).join(', ')}`;
      renderApp();
    });
  });

  // Card "Report article issue" shortcut button on Home / section cards (Spec v3 Page 8 Item 1)
  document.querySelectorAll<HTMLButtonElement>('.card-report-issue-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const aid = btn.getAttribute('data-report-article-id');
      if (!aid) return;
      navigateTo(`/article/${aid}`);
      const sectionEl = document.getElementById('article-feedback-section');
      const inputEl = document.getElementById('feedback-comments-input') as HTMLTextAreaElement | null;
      sectionEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      inputEl?.focus();
    });
  });

  // Top "Report Article" button on Article Detail page scrolls to and focuses the Report Article form
  document.getElementById('open-report-article-btn')?.addEventListener('click', () => {
    state.reportPromptOpen = true;
    renderApp();
    const sectionEl = document.getElementById('report-article-section');
    const inputEl = document.getElementById('report-article-reason-input') as HTMLTextAreaElement | null;
    sectionEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    inputEl?.focus();
  });

  // Submit Login-Free "Report Article" Form (Editorial Review)
  const reportArticleForm = document.getElementById('report-article-form') as HTMLFormElement | null;
  reportArticleForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const textarea = document.getElementById('report-article-reason-input') as HTMLTextAreaElement | null;
    const articleId = reportArticleForm.getAttribute('data-article-id') || '';
    const articleTitle = reportArticleForm.getAttribute('data-article-title') || 'Article';
    const result = validateAndCreateArticleReport(
      articleId,
      articleTitle,
      textarea?.value ?? '',
      new Date().toISOString()
    );

    if (!result.valid || !result.entry) {
      state.reportArticleError = state.lang === 'hi' ? result.errorHi ?? null : result.errorEn ?? null;
      state.reportArticleNotice = null;
      renderApp();
      return;
    }

    saveArticleReport(result.entry);
    appendBoundedLog(
      'ARTICLE_REPORTED',
      state.powerTier,
      `Article=${result.entry.articleId} reported at ${result.entry.timestamp}`
    );
    state.reportArticleError = null;
    state.reportArticleNotice =
      state.lang === 'hi'
        ? `रिपोर्ट दर्ज हो गई (ID: ${result.entry.articleId}, समय: ${result.entry.timestamp})। संपादकीय टीम द्वारा इसकी समीक्षा की जाएगी।`
        : `Report logged (Article ID: ${result.entry.articleId}, Timestamp: ${result.entry.timestamp}). Reports are reviewed by the editorial team.`;
    renderApp();
  });

  // Track issue type dropdown in Article Issue Feedback Form
  const issueTypeSelect = document.getElementById('feedback-issue-type-select') as HTMLSelectElement | null;
  issueTypeSelect?.addEventListener('change', () => {
    state.feedbackSelectedType = issueTypeSelect.value as ArticleIssueType;
  });

  // Submit Structured Article Issue Feedback Form (Spec v3 Page 8 Items 1-9)
  const feedbackForm = document.getElementById('article-feedback-form') as HTMLFormElement | null;
  feedbackForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const selectEl = document.getElementById('feedback-issue-type-select') as HTMLSelectElement | null;
    const commentsEl = document.getElementById('feedback-comments-input') as HTMLTextAreaElement | null;
    const contactEl = document.getElementById('feedback-contact-input') as HTMLInputElement | null;
    const honeypotEl = document.getElementById('feedback-honeypot-input') as HTMLInputElement | null;
    const articleId = feedbackForm.getAttribute('data-article-id') || '';
    const articleTitle = feedbackForm.getAttribute('data-article-title') || 'Article';

    const issueTypeVal = selectEl?.value ?? state.feedbackSelectedType;
    const result = validateAndCreateArticleFeedback({
      articleId,
      articleTitle,
      issueType: issueTypeVal,
      description: commentsEl?.value ?? '',
      contact: contactEl?.value ?? '',
      honeypot: honeypotEl?.value ?? '',
      nowIso: new Date().toISOString(),
      lastSubmittedAtMs: state.lastFeedbackSubmittedAtMs,
      seenIdempotencyTokens: state.seenIdempotencyTokens,
      cooldownMs: 3000,
    });

    if (!result.valid || !result.entry) {
      state.feedbackError = state.lang === 'hi' ? result.errorHi ?? null : result.errorEn ?? null;
      state.feedbackNotice = null;
      renderApp();
      return;
    }

    state.lastFeedbackSubmittedAtMs = Date.now();
    state.seenIdempotencyTokens.add(result.entry.idempotencyToken);

    saveArticleFeedback(result.entry);
    appendBoundedLog(
      'ARTICLE_FEEDBACK_LOGGED',
      state.powerTier,
      `Article=${result.entry.articleId}, Type=${result.entry.issueType}, Mode=${result.entry.storageMode}`
    );
    state.feedbackError = null;
    state.feedbackNotice =
      state.lang === 'hi'
        ? `स्थानीय ड्राफ्ट दर्ज किया गया (ID: ${result.entry.feedbackId}, लेख: ${result.entry.articleId}, प्रकार: ${result.entry.issueType})। रिमोट सर्वर सबमिशन चरण 1 में असंबद्ध/अक्षम है।`
        : `Local feedback draft saved on this device (Feedback ID: ${result.entry.feedbackId}, Article ID: ${result.entry.articleId}, Issue Type: ${result.entry.issueType}). Remote server submit remains disabled in Stage 1 until durable storage is connected.`;
    renderApp();
  });

  // Submit General Feedback Form on /corrections (`articleId = null`, Spec v3 Page 8 Item 1)
  const generalFeedbackForm = document.getElementById('general-feedback-form') as HTMLFormElement | null;
  generalFeedbackForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const selectEl = document.getElementById('general-feedback-type-select') as HTMLSelectElement | null;
    const descEl = document.getElementById('general-feedback-desc-input') as HTMLTextAreaElement | null;
    const contactEl = document.getElementById('general-feedback-contact-input') as HTMLInputElement | null;
    const honeypotEl = document.getElementById('general-feedback-honeypot') as HTMLInputElement | null;

    const result = validateAndCreateArticleFeedback({
      articleId: null,
      articleTitle: 'General Feedback (No Article ID)',
      issueType: selectEl?.value ?? 'general',
      description: descEl?.value ?? '',
      contact: contactEl?.value ?? '',
      honeypot: honeypotEl?.value ?? '',
      nowIso: new Date().toISOString(),
      lastSubmittedAtMs: state.lastFeedbackSubmittedAtMs,
      seenIdempotencyTokens: state.seenIdempotencyTokens,
      cooldownMs: 3000,
    });

    if (!result.valid || !result.entry) {
      state.generalFeedbackError = state.lang === 'hi' ? result.errorHi ?? null : result.errorEn ?? null;
      state.generalFeedbackNotice = null;
      renderApp();
      return;
    }

    state.lastFeedbackSubmittedAtMs = Date.now();
    state.seenIdempotencyTokens.add(result.entry.idempotencyToken);

    saveArticleFeedback(result.entry);
    appendBoundedLog(
      'GENERAL_FEEDBACK_LOGGED',
      state.powerTier,
      `Article=null, Type=${result.entry.issueType}, Mode=${result.entry.storageMode}`
    );
    state.generalFeedbackError = null;
    state.generalFeedbackNotice =
      state.lang === 'hi'
        ? `सामान्य प्रतिक्रिया स्थानीय ड्राफ्ट के रूप में सहेजी गई (ID: ${result.entry.feedbackId}, articleId: null)। रिमोट सर्वर सबमिशन चरण 1 में असंबद्ध है।`
        : `General feedback saved as a local draft on this device (ID: ${result.entry.feedbackId}, articleId: null). Remote server submit remains disabled in Stage 1.`;
    renderApp();
  });

  // 1-Click Delete Optional Contact from a saved feedback draft (Spec v3 Page 8 Item 6)
  document.querySelectorAll<HTMLButtonElement>('.delete-feedback-contact-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fid = btn.getAttribute('data-feedback-id');
      if (!fid) return;
      deleteContactFromLocalFeedback(fid);
      appendBoundedLog('FEEDBACK_CONTACT_DELETED', state.powerTier, `Removed optional contact from ${fid}`);
      renderApp();
    });
  });

  // 1-Click Delete Feedback Draft (Spec v3 Page 8 Item 9)
  document.querySelectorAll<HTMLButtonElement>('.delete-feedback-draft-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fid = btn.getAttribute('data-feedback-id');
      if (!fid) return;
      deleteLocalFeedbackEntry(fid);
      appendBoundedLog('FEEDBACK_DRAFT_DELETED', state.powerTier, `Deleted local feedback draft ${fid}`);
      renderApp();
    });
  });

  // Power Tier Simulator Presets on /privacy
  document.querySelectorAll<HTMLButtonElement>('.power-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const batteryPct = Number(btn.getAttribute('data-battery') ?? 80);
      const isCharging = btn.getAttribute('data-charging') === 'true';
      const thermalStatus = (btn.getAttribute('data-thermal') ?? 'nominal') as PowerStateInput['thermalStatus'];
      const nextInput: PowerStateInput = {
        ...state.powerInput,
        batteryPct,
        isCharging,
        thermalStatus,
      };
      const nextTier = evaluatePowerTier(state.powerTier, nextInput);
      state.powerInput = nextInput;
      state.powerTier = nextTier;
      savePowerInput(nextInput);
      appendBoundedLog(
        'POWER_TIER_TRANSITION',
        nextTier,
        `Battery=${batteryPct}%, Charging=${isCharging}, Thermal=${thermalStatus} -> Tier=${nextTier}`
      );
      renderApp();
    });
  });

  // Self-healing circuit breaker test buttons on /privacy
  document.getElementById('sim-feed-failure-backoff-btn')?.addEventListener('click', () => {
    const result = recordFailureAndAdvanceCircuit(
      state.circuitBreaker,
      new Date().toISOString(),
      15000,
      0.2
    );
    state.circuitBreaker = result.nextState;
    saveCircuitBreaker(result.nextState);
    appendBoundedLog(
      'SELF_HEAL_BACKOFF',
      state.powerTier,
      result.deferredToNextWindow
        ? `Circuit tripped to OPEN after ${result.nextState.consecutiveFailures} failures; recovery deferred to next window.`
        : `Failure #${result.nextState.consecutiveFailures}: scheduled backoff=${result.backoffMs}ms.`
    );
    renderApp();
  });

  document.getElementById('reset-circuit-breaker-btn')?.addEventListener('click', () => {
    state.circuitBreaker = { ...DEFAULT_CIRCUIT_BREAKER };
    saveCircuitBreaker(state.circuitBreaker);
    appendBoundedLog('CIRCUIT_RESET', state.powerTier, 'Circuit breaker reset to CLOSED.');
    renderApp();
  });

  // Spatial 3D Kiosk controls on /about
  document.getElementById('toggle-3d-kiosk-btn')?.addEventListener('click', () => {
    state.spatialKioskExpanded = !state.spatialKioskExpanded;
    renderApp();
  });

  document.querySelectorAll<HTMLButtonElement>('.kiosk-cam-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-cam') as 'front' | 'side' | 'top' | null;
      if (preset) {
        embeddedViewport.setCameraPreset(preset);
      }
    });
  });

  document.getElementById('kiosk-rotate-globe-btn')?.addEventListener('click', () => {
    embeddedViewport.rotateGlobeStep(Math.PI / 4);
  });

  document.getElementById('launch-webxr-session-btn')?.addEventListener('click', async () => {
    document.body.classList.add('xr-session-ready');
    await launchFullWebXRSession(state.locationPref, activeArticles);
  });
}

window.addEventListener('popstate', () => {
  state.route = normalizePath(window.location.pathname);
  renderApp();
});

// Pause non-essential 3D work when document visibility is hidden (Efficiency Rule: Pause UI work when not visible)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    embeddedViewport.dispose();
  } else if (state.route === '/about' && state.spatialKioskExpanded && state.powerTier === 'Normal') {
    const viewportEl = document.getElementById('embedded-3d-viewport');
    if (viewportEl) {
      embeddedViewport.mount(viewportEl, state.powerTier);
    }
  }
});

document.addEventListener('DOMContentLoaded', () => {
  renderApp();
});
