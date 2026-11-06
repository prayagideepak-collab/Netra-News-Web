import {
  CircuitBreakerState,
  FeedEnvelope,
  FeedSimulationMode,
  LanguageCode,
  LocationPreference,
  PowerStateInput,
} from '../domain/types';
import { PACKAGED_CITIES } from './citiesDataset';
import { STAGE1_OFFICIAL_LINK_ENVELOPE } from './feedsData';

const STORAGE_KEYS = {
  LOCATION_PREF: 'netra_news_v1_location_pref',
  LANGUAGE: 'netra_news_v1_lang',
  FEED_MODE: 'netra_news_v1_feed_mode',
  CACHED_ENVELOPE: 'netra_news_v1_cached_envelope',
  POWER_INPUT: 'netra_news_v1_power_input',
  CIRCUIT_BREAKER: 'netra_news_v1_circuit_breaker',
  DIAGNOSTIC_LOG: 'netra_news_v1_bounded_log',
  CORRECTION_DRAFTS: 'netra_news_v1_correction_drafts',
};

const MAX_LOG_ENTRIES = 50;

export interface DiagnosticLogEntry {
  timestamp: string;
  event: string;
  tier: string;
  detail: string;
}

export interface CorrectionDraft {
  id: string;
  articleId: string;
  articleTitle: string;
  reason: string;
  createdAt: string;
}

export const DEFAULT_LOCATION_PREFERENCE: LocationPreference = {
  countryCode: 'IN',
  stateCode: 'UP',
  cityId: 'in-up-lucknow',
  cityLabel: 'Lucknow, Uttar Pradesh',
  cityLabelHi: 'लखनऊ, उत्तर प्रदेश',
  selectionMode: 'manual',
  updatedAt: '2026-11-06T00:00:00Z',
  enabled: true,
};

export const DEFAULT_POWER_INPUT: PowerStateInput = {
  batteryPct: 82,
  isCharging: false,
  batterySaverOn: false,
  thermalStatus: 'nominal',
  screenOn: true,
  inForeground: true,
  networkMetered: false,
  dataSaverOn: false,
};

export const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerState = {
  status: 'CLOSED',
  consecutiveFailures: 0,
  lastFailureAt: null,
  nextScheduledWindowAt: null,
};

function safeGetItem(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore quota or private-browsing storage errors gracefully
  }
}

/**
 * Loads LocationPreference and strictly strips any accidental raw coordinate properties
 * to enforce the Privacy Contract ("Do not persist raw coordinates").
 */
export function loadLocationPreference(): LocationPreference {
  const raw = safeGetItem(STORAGE_KEYS.LOCATION_PREF);
  if (!raw) return { ...DEFAULT_LOCATION_PREFERENCE };
  try {
    const parsed = JSON.parse(raw);
    const matchedCity = PACKAGED_CITIES.find((c) => c.cityId === parsed.cityId);
    if (!matchedCity) return { ...DEFAULT_LOCATION_PREFERENCE };
    return {
      countryCode: matchedCity.countryCode,
      stateCode: matchedCity.stateCode,
      cityId: matchedCity.cityId,
      cityLabel: `${matchedCity.nameEn}, ${matchedCity.stateNameEn}`,
      cityLabelHi: `${matchedCity.nameHi}, ${matchedCity.stateNameHi}`,
      selectionMode: parsed.selectionMode === 'approximate' ? 'approximate' : 'manual',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      enabled: Boolean(parsed.enabled ?? true),
    };
  } catch {
    return { ...DEFAULT_LOCATION_PREFERENCE };
  }
}

/**
 * Atomically saves LocationPreference, guaranteeing only the 7 permitted schema keys are written.
 */
export function saveLocationPreference(pref: LocationPreference): LocationPreference {
  const clean: LocationPreference = {
    countryCode: pref.countryCode,
    stateCode: pref.stateCode,
    cityId: pref.cityId,
    cityLabel: pref.cityLabel,
    cityLabelHi: pref.cityLabelHi,
    selectionMode: pref.selectionMode === 'approximate' ? 'approximate' : 'manual',
    updatedAt: pref.updatedAt,
    enabled: Boolean(pref.enabled),
  };
  safeSetItem(STORAGE_KEYS.LOCATION_PREF, JSON.stringify(clean));
  return clean;
}

export function loadLanguage(): LanguageCode {
  const raw = safeGetItem(STORAGE_KEYS.LANGUAGE);
  return raw === 'en' ? 'en' : 'hi';
}

export function saveLanguage(lang: LanguageCode): void {
  safeSetItem(STORAGE_KEYS.LANGUAGE, lang);
}

export function loadFeedMode(): FeedSimulationMode {
  const raw = safeGetItem(STORAGE_KEYS.FEED_MODE);
  if (
    raw === 'official_links' ||
    raw === 'production_empty' ||
    raw === 'test_fixtures' ||
    raw === 'stale_offline'
  ) {
    return raw;
  }
  return 'official_links';
}

export function saveFeedMode(mode: FeedSimulationMode): void {
  safeSetItem(STORAGE_KEYS.FEED_MODE, mode);
}

export function loadCachedEnvelope(): FeedEnvelope {
  const raw = safeGetItem(STORAGE_KEYS.CACHED_ENVELOPE);
  if (!raw) return STAGE1_OFFICIAL_LINK_ENVELOPE;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.items)) {
      return parsed as FeedEnvelope;
    }
    return STAGE1_OFFICIAL_LINK_ENVELOPE;
  } catch {
    return STAGE1_OFFICIAL_LINK_ENVELOPE;
  }
}

export function saveCachedEnvelope(envelope: FeedEnvelope): void {
  safeSetItem(STORAGE_KEYS.CACHED_ENVELOPE, JSON.stringify(envelope));
}

export function loadPowerInput(): PowerStateInput {
  const raw = safeGetItem(STORAGE_KEYS.POWER_INPUT);
  if (!raw) return { ...DEFAULT_POWER_INPUT };
  try {
    return { ...DEFAULT_POWER_INPUT, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_POWER_INPUT };
  }
}

export function savePowerInput(input: PowerStateInput): void {
  safeSetItem(STORAGE_KEYS.POWER_INPUT, JSON.stringify(input));
}

export function loadCircuitBreaker(): CircuitBreakerState {
  const raw = safeGetItem(STORAGE_KEYS.CIRCUIT_BREAKER);
  if (!raw) return { ...DEFAULT_CIRCUIT_BREAKER };
  try {
    return { ...DEFAULT_CIRCUIT_BREAKER, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CIRCUIT_BREAKER };
  }
}

export function saveCircuitBreaker(state: CircuitBreakerState): void {
  safeSetItem(STORAGE_KEYS.CIRCUIT_BREAKER, JSON.stringify(state));
}

/**
 * Bounded, rotated local diagnostic log (max 50 entries; no user locations or PII).
 * Upload is strictly gated until charging on an unmetered network.
 */
export function appendBoundedLog(event: string, tier: string, detail: string): DiagnosticLogEntry[] {
  const current = loadBoundedLogs();
  const entry: DiagnosticLogEntry = {
    timestamp: new Date().toISOString(),
    event,
    tier,
    detail,
  };
  const updated = [entry, ...current].slice(0, MAX_LOG_ENTRIES);
  safeSetItem(STORAGE_KEYS.DIAGNOSTIC_LOG, JSON.stringify(updated));
  return updated;
}

export function loadBoundedLogs(): DiagnosticLogEntry[] {
  const raw = safeGetItem(STORAGE_KEYS.DIAGNOSTIC_LOG);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_LOG_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function loadCorrectionDrafts(): CorrectionDraft[] {
  const raw = safeGetItem(STORAGE_KEYS.CORRECTION_DRAFTS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCorrectionDraft(draft: CorrectionDraft): CorrectionDraft[] {
  const existing = loadCorrectionDrafts();
  const updated = [draft, ...existing].slice(0, 25);
  safeSetItem(STORAGE_KEYS.CORRECTION_DRAFTS, JSON.stringify(updated));
  return updated;
}
