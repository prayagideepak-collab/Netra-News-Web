import {
  ArticleFeedbackEntry,
  ArticleIssueType,
  ArticleRecord,
  ArticleReportEntry,
  CircuitBreakerState,
  CityEntry,
  FeedEnvelope,
  LocationPreference,
  PowerStateInput,
  PowerTier,
  PreferredCategoryKey,
  SourceLedgerEntry,
  VerificationStatus,
} from './types';

const FUTURE_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes max clock skew

/**
 * Sanitizes untrusted strings by rejecting active HTML/scripts, inline event handlers,
 * and dangerous URI schemes while preserving Devanagari and standard punctuation.
 */
export function sanitizeString(input: unknown): string {
  if (typeof input !== 'string') return '';
  let cleaned = input
    // Remove script/style/iframe/object/embed tags and their contents
    .replace(/<(script|style|iframe|object|embed|applet|meta|link)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Remove self-closing or unclosed HTML tags
    .replace(/<[^>]+>/g, '')
    // Neutralize javascript:, vbscript:, data:text/html protocols
    .replace(/(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/gi, '')
    // Strip inline event handler patterns if any leaked outside brackets
    .replace(/\bon[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    // Normalize control characters except newline
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  return cleaned;
}

/**
 * Validates that a canonical source URL is strictly HTTPS, has no embedded credentials,
 * is not an IP literal or localhost, and matches an allowlisted source host.
 */
export function validateHttpsCanonicalUrl(
  rawUrl: unknown,
  allowlist: SourceLedgerEntry[]
): { valid: boolean; reason?: string; matchedSource?: SourceLedgerEntry; normalizedUrl?: string } {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { valid: false, reason: 'missing_url' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, reason: 'malformed_url' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'non_https_protocol' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'credentials_in_url' };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.includes(':')
  ) {
    return { valid: false, reason: 'ip_or_local_host_forbidden' };
  }

  const matchedSource = allowlist.find(
    (entry) =>
      entry.canonicalHost.toLowerCase() === host ||
      host.endsWith('.' + entry.canonicalHost.toLowerCase())
  );

  if (!matchedSource) {
    return { valid: false, reason: 'host_not_in_allowlist' };
  }

  // Strip tracking query parameters
  const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
  for (const param of trackingParams) {
    parsed.searchParams.delete(param);
  }

  return {
    valid: true,
    matchedSource,
    normalizedUrl: parsed.toString(),
  };
}

/**
 * Validates an ISO 8601 timestamp string.
 * Rejects missing, unparseable, or future timestamps beyond 5m skew.
 * Never replaces missing/future timestamps with the device clock.
 */
export function validateEventTimestamp(
  isoString: unknown,
  referenceNowIso: string = new Date().toISOString()
): { valid: boolean; reason?: 'missing' | 'invalid_format' | 'future_timestamp'; epochMs?: number } {
  if (isoString === null || isoString === undefined || isoString === '') {
    return { valid: false, reason: 'missing' };
  }
  if (typeof isoString !== 'string') {
    return { valid: false, reason: 'invalid_format' };
  }
  // Require explicit timezone offset or Z
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(isoString.trim())) {
    return { valid: false, reason: 'invalid_format' };
  }

  const epochMs = Date.parse(isoString);
  const nowMs = Date.parse(referenceNowIso);
  if (Number.isNaN(epochMs) || Number.isNaN(nowMs)) {
    return { valid: false, reason: 'invalid_format' };
  }

  if (epochMs > nowMs + FUTURE_SKEW_TOLERANCE_MS) {
    return { valid: false, reason: 'future_timestamp' };
  }

  return { valid: true, epochMs };
}

/**
 * Checks whether an article or alert has expired relative to referenceNowIso.
 */
export function isRecordExpired(expiryIso: string | null, referenceNowIso: string): boolean {
  if (!expiryIso) return false;
  const expiryMs = Date.parse(expiryIso);
  const nowMs = Date.parse(referenceNowIso);
  if (Number.isNaN(expiryMs) || Number.isNaN(nowMs)) return false;
  return expiryMs <= nowMs;
}

export interface ValidationOptions {
  isProduction: boolean;
  referenceNowIso?: string;
}

export interface FeedValidationResult {
  validEnvelope: boolean;
  envelopeError: string | null;
  acceptedItems: ArticleRecord[];
  rejectedItems: Array<{ id: string; reason: string }>;
  consolidatedCount: number;
}

/**
 * Validates a complete FeedEnvelope against the Build Contract (Page 7):
 * - schemaVersion === 1
 * - generatedAt is valid UTC ISO timestamp
 * - Rejects test-001 and any TEST fixture in production mode
 * - Filters out pending/retracted/blocked items in production mode
 * - Rejects missing or future publishedAt timestamps from verified status
 * - Sanitizes all strings against HTML/script injection
 * - Consolidates duplicate IDs and duplicate canonical URLs while preserving attribution
 */
export function validateFeedEnvelope(
  rawEnvelope: unknown,
  allowlist: SourceLedgerEntry[],
  options: ValidationOptions
): FeedValidationResult {
  const nowIso = options.referenceNowIso ?? new Date().toISOString();

  if (!rawEnvelope || typeof rawEnvelope !== 'object') {
    return {
      validEnvelope: false,
      envelopeError: 'Incompatible feed: root envelope is not an object.',
      acceptedItems: [],
      rejectedItems: [],
      consolidatedCount: 0,
    };
  }

  const env = rawEnvelope as Partial<FeedEnvelope>;
  if (env.schemaVersion !== 1) {
    return {
      validEnvelope: false,
      envelopeError: `Incompatible schemaVersion: expected 1, received ${String(env.schemaVersion)}.`,
      acceptedItems: [],
      rejectedItems: [],
      consolidatedCount: 0,
    };
  }

  const genTimeCheck = validateEventTimestamp(env.generatedAt, nowIso);
  if (!genTimeCheck.valid) {
    return {
      validEnvelope: false,
      envelopeError: `Invalid generatedAt timestamp (${genTimeCheck.reason}).`,
      acceptedItems: [],
      rejectedItems: [],
      consolidatedCount: 0,
    };
  }

  if (!Array.isArray(env.items) || !Array.isArray(env.coverage) || !Array.isArray(env.sourceHealth)) {
    return {
      validEnvelope: false,
      envelopeError: 'Malformed feed envelope: items, coverage, and sourceHealth must be arrays.',
      acceptedItems: [],
      rejectedItems: [],
      consolidatedCount: 0,
    };
  }

  const acceptedItems: ArticleRecord[] = [];
  const rejectedItems: Array<{ id: string; reason: string }> = [];
  const seenIds = new Set<string>();
  const urlToItemMap = new Map<string, ArticleRecord>();
  let consolidatedCount = 0;

  for (const rawItem of env.items) {
    const itemId = typeof rawItem?.id === 'string' && rawItem.id.trim() ? sanitizeString(rawItem.id) : 'unknown-id';

    // 1. Reject duplicate opaque IDs
    if (seenIds.has(itemId)) {
      rejectedItems.push({ id: itemId, reason: 'duplicate_id' });
      continue;
    }
    seenIds.add(itemId);

    // 2. Check TEST fixture contract (id=test-001 or title starting with TEST - or isTestFixture)
    const rawTitle = sanitizeString(rawItem?.title);
    const isTestRecord =
      itemId === 'test-001' ||
      Boolean(rawItem?.isTestFixture) ||
      /^TEST\b/i.test(rawTitle) ||
      sanitizeString(rawItem?.publisher).toUpperCase() === 'TEST SOURCE';

    if (options.isProduction && isTestRecord) {
      rejectedItems.push({ id: itemId, reason: 'test_fixture_rejected_in_production' });
      continue;
    }

    // 3. Check verificationStatus and rightsStatus
    const verificationStatus = rawItem?.verificationStatus;
    const rightsStatus = rawItem?.rightsStatus;

    if (
      verificationStatus !== 'verified' &&
      verificationStatus !== 'pending' &&
      verificationStatus !== 'retracted'
    ) {
      rejectedItems.push({ id: itemId, reason: 'invalid_verification_status' });
      continue;
    }

    if (
      rightsStatus !== 'linkOnly' &&
      rightsStatus !== 'licensed' &&
      rightsStatus !== 'original' &&
      rightsStatus !== 'blocked'
    ) {
      rejectedItems.push({ id: itemId, reason: 'invalid_rights_status' });
      continue;
    }

    if (options.isProduction) {
      if (verificationStatus !== 'verified') {
        rejectedItems.push({ id: itemId, reason: `unverified_status_${verificationStatus}` });
        continue;
      }
      if (rightsStatus === 'blocked') {
        rejectedItems.push({ id: itemId, reason: 'rights_blocked' });
        continue;
      }
    }

    // 4. Validate canonical source URL against HTTPS and source allowlist
    const urlCheck = validateHttpsCanonicalUrl(rawItem?.sourceUrl, allowlist);
    if (!urlCheck.valid || !urlCheck.normalizedUrl) {
      if (options.isProduction) {
        rejectedItems.push({ id: itemId, reason: `invalid_source_url_${urlCheck.reason}` });
        continue;
      }
    }

    // 5. Validate source publication time (missing or future times cannot be verified)
    const pubCheck = validateEventTimestamp(rawItem?.publishedAt, nowIso);
    if (!pubCheck.valid && options.isProduction) {
      rejectedItems.push({ id: itemId, reason: `invalid_published_at_${pubCheck.reason}` });
      continue;
    }

    // 6. Check expiry
    if (isRecordExpired(rawItem?.expiry ?? null, nowIso) && options.isProduction) {
      rejectedItems.push({ id: itemId, reason: 'expired_record' });
      continue;
    }

    const normalizedUrl = urlCheck.normalizedUrl ?? sanitizeString(rawItem?.sourceUrl);
    const cleanPublisher = sanitizeString(rawItem?.publisher);

    // 7. Consolidate duplicate canonical URLs without losing source attribution
    const existingByUrl = urlToItemMap.get(normalizedUrl);
    if (existingByUrl && normalizedUrl) {
      existingByUrl.consolidatedSources = existingByUrl.consolidatedSources ?? [
        { publisher: existingByUrl.publisher, sourceUrl: existingByUrl.sourceUrl },
      ];
      const alreadyListed = existingByUrl.consolidatedSources.some(
        (s) => s.publisher === cleanPublisher && s.sourceUrl === normalizedUrl
      );
      if (!alreadyListed) {
        existingByUrl.consolidatedSources.push({
          publisher: cleanPublisher,
          sourceUrl: normalizedUrl,
        });
      }
      consolidatedCount += 1;
      continue;
    }

    // 8. Enforce rights-safe summary rules: if linkOnly, strip long scraped extracts (> 180 chars)
    let safeSummaryEn = rawItem?.permittedSummary ? sanitizeString(rawItem.permittedSummary) : null;
    let safeSummaryHi = rawItem?.permittedSummaryHi ? sanitizeString(rawItem.permittedSummaryHi) : null;
    if (rightsStatus === 'linkOnly') {
      if (safeSummaryEn && safeSummaryEn.length > 180) {
        safeSummaryEn = safeSummaryEn.slice(0, 177) + '...';
      }
      if (safeSummaryHi && safeSummaryHi.length > 180) {
        safeSummaryHi = safeSummaryHi.slice(0, 177) + '...';
      }
    }

    const sanitizedItem: ArticleRecord = {
      id: itemId,
      title: rawTitle,
      titleHi: sanitizeString(rawItem?.titleHi || rawItem?.title),
      language: rawItem?.language === 'en' ? 'en' : 'hi',
      category: sanitizeString(rawItem?.category || 'General'),
      categoryHi: sanitizeString(rawItem?.categoryHi || rawItem?.category || 'सामान्य'),
      scope: ['local', 'state', 'national', 'world'].includes(rawItem?.scope) ? rawItem.scope : 'national',
      countryCode: sanitizeString(rawItem?.countryCode || 'IN'),
      stateCode: rawItem?.stateCode ? sanitizeString(rawItem.stateCode) : null,
      cityId: rawItem?.cityId ? sanitizeString(rawItem.cityId) : null,
      publisherId: sanitizeString(rawItem?.publisherId || 'unknown'),
      publisher: cleanPublisher,
      publisherHi: sanitizeString(rawItem?.publisherHi || rawItem?.publisher),
      sourceUrl: normalizedUrl,
      publishedAt: pubCheck.valid ? rawItem.publishedAt : null,
      timezone: sanitizeString(rawItem?.timezone || 'Asia/Kolkata'),
      fetchedAt: sanitizeString(rawItem?.fetchedAt || nowIso),
      verifiedAt: rawItem?.verifiedAt ? sanitizeString(rawItem.verifiedAt) : null,
      verificationStatus:
        verificationStatus === 'retracted'
          ? 'retracted'
          : pubCheck.valid
            ? verificationStatus
            : 'pending',
      rightsStatus,
      permittedSummary: safeSummaryEn,
      permittedSummaryHi: safeSummaryHi,
      isBreaking: Boolean(rawItem?.isBreaking) && verificationStatus === 'verified' && pubCheck.valid,
      corrections: Array.isArray(rawItem?.corrections)
        ? rawItem.corrections.map((c) => ({
            correctedAt: sanitizeString(c.correctedAt),
            reason: sanitizeString(c.reason),
            reasonHi: c.reasonHi ? sanitizeString(c.reasonHi) : undefined,
          }))
        : [],
      expiry: rawItem?.expiry ? sanitizeString(rawItem.expiry) : null,
      licensedImage:
        rightsStatus === 'licensed' || rightsStatus === 'original'
          ? rawItem?.licensedImage ?? null
          : null, // Never display unlicensed images in linkOnly mode
      consolidatedSources: [{ publisher: cleanPublisher, sourceUrl: normalizedUrl }],
      isTestFixture: isTestRecord,
    };

    urlToItemMap.set(normalizedUrl, sanitizedItem);
    acceptedItems.push(sanitizedItem);
  }

  return {
    validEnvelope: true,
    envelopeError: null,
    acceptedItems,
    rejectedItems,
    consolidatedCount,
  };
}

/**
 * Calculates great-circle distance in km between two coordinates (used strictly in-memory
 * to resolve the nearest city from the local dataset before discarding raw coordinates).
 */
export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface NearestCityResolution {
  resolved: CityEntry | null;
  ambiguousCandidates: CityEntry[];
  isAmbiguous: boolean;
  preferenceRecord: LocationPreference | null;
}

/**
 * Resolves a city from transient coordinates using the packaged local city dataset,
 * checks nearest-city ambiguity (if runner-up is within 35 km of the closest city),
 * and returns a clean LocationPreference record WITHOUT raw coordinates.
 */
export function resolveCityFromTransientCoords(
  transientLat: number,
  transientLon: number,
  cities: CityEntry[],
  nowIso: string = new Date().toISOString()
): NearestCityResolution {
  if (
    !Number.isFinite(transientLat) ||
    !Number.isFinite(transientLon) ||
    cities.length === 0
  ) {
    return {
      resolved: null,
      ambiguousCandidates: [],
      isAmbiguous: false,
      preferenceRecord: null,
    };
  }

  const ranked = cities
    .map((city) => ({
      city,
      distKm: haversineDistanceKm(transientLat, transientLon, city.approxLat, city.approxLon),
    }))
    .sort((a, b) => a.distKm - b.distKm);

  const closest = ranked[0];
  if (!closest || closest.distKm > 450) {
    // Too far from any packaged city in the dataset
    return {
      resolved: null,
      ambiguousCandidates: [],
      isAmbiguous: false,
      preferenceRecord: null,
    };
  }

  const second = ranked[1];
  const isAmbiguous = Boolean(second && Math.abs(second.distKm - closest.distKm) <= 35);
  const ambiguousCandidates = isAmbiguous && second ? [closest.city, second.city] : [closest.city];

  const preferenceRecord: LocationPreference = {
    countryCode: closest.city.countryCode,
    stateCode: closest.city.stateCode,
    cityId: closest.city.cityId,
    cityLabel: `${closest.city.nameEn}, ${closest.city.stateNameEn}`,
    cityLabelHi: `${closest.city.nameHi}, ${closest.city.stateNameHi}`,
    selectionMode: 'approximate',
    updatedAt: nowIso,
    enabled: true,
  };

  return {
    resolved: closest.city,
    ambiguousCandidates,
    isAmbiguous,
    preferenceRecord,
  };
}

const TIER_ORDER: PowerTier[] = ['Normal', 'Saver', 'Critical', 'Survival'];

/**
 * Evaluates the Adaptive Power Tier per the Ultra-Low Power 24/7 Design Principle:
 * - Normal (charging or >30%): full features, batched work.
 * - Saver (15-30% or Battery Saver on): longer intervals, no non-essential sync, reduced rendering.
 * - Critical (<15%): Tier-0 only, maximum batching.
 * - Survival (<5%): minimal Tier-0, no sensors or animations, network only when required.
 * - Thermal throttling ('moderate' | 'severe' | 'critical'): drop one tier immediately.
 * - Hysteresis (+3% buffer on upward recovery) so tiers never flap.
 */
export function evaluatePowerTier(currentTier: PowerTier, input: PowerStateInput): PowerTier {
  const pct = Math.max(0, Math.min(100, input.batteryPct));
  const hysteresisBuffer = 3; // Require +3% to climb back up a tier when not charging

  let baseTier: PowerTier;

  if (pct < 5 && !input.isCharging) {
    baseTier = 'Survival';
  } else if (pct < 15 && !input.isCharging) {
    // Check hysteresis if currently in Survival
    if (currentTier === 'Survival' && pct < 5 + hysteresisBuffer) {
      baseTier = 'Survival';
    } else {
      baseTier = 'Critical';
    }
  } else if (input.batterySaverOn || (pct <= 30 && !input.isCharging)) {
    // Check hysteresis if currently in Critical
    if (currentTier === 'Critical' && !input.isCharging && pct < 15 + hysteresisBuffer) {
      baseTier = 'Critical';
    } else {
      baseTier = 'Saver';
    }
  } else {
    // pct > 30 or charging
    if (
      currentTier === 'Saver' &&
      !input.isCharging &&
      !input.batterySaverOn &&
      pct < 30 + hysteresisBuffer
    ) {
      baseTier = 'Saver';
    } else {
      baseTier = 'Normal';
    }
  }

  // Thermal throttling: drop one tier immediately when moderate, severe, or critical
  if (
    input.thermalStatus === 'moderate' ||
    input.thermalStatus === 'severe' ||
    input.thermalStatus === 'critical'
  ) {
    const idx = TIER_ORDER.indexOf(baseTier);
    const droppedIdx = Math.min(TIER_ORDER.length - 1, idx + 1);
    return TIER_ORDER[droppedIdx];
  }

  return baseTier;
}

export const MAX_SELF_HEAL_RETRIES = 4;

/**
 * Computes exponential backoff with deterministic/bounded jitter and enforces a hard retry cap
 * and circuit breaker that stops recovery attempts and defers to the next scheduled window.
 */
export function recordFailureAndAdvanceCircuit(
  prev: CircuitBreakerState,
  nowIso: string,
  baseDelayMs: number = 15000,
  jitterFraction: number = 0.2
): { nextState: CircuitBreakerState; backoffMs: number | null; deferredToNextWindow: boolean } {
  const failures = prev.consecutiveFailures + 1;
  const nowMs = Date.parse(nowIso);

  if (failures > MAX_SELF_HEAL_RETRIES) {
    // Trip circuit breaker to OPEN and defer for 1 hour (next scheduled window)
    const nextWindowMs = nowMs + 60 * 60 * 1000;
    return {
      nextState: {
        status: 'OPEN',
        consecutiveFailures: failures,
        lastFailureAt: nowIso,
        nextScheduledWindowAt: new Date(nextWindowMs).toISOString(),
      },
      backoffMs: null,
      deferredToNextWindow: true,
    };
  }

  const exponential = baseDelayMs * Math.pow(2, failures - 1);
  const clampedFraction = Math.max(0, Math.min(1, jitterFraction));
  const jitter = Math.round(exponential * clampedFraction * 0.5);
  const backoffMs = Math.min(exponential + jitter, 15 * 60 * 1000);

  return {
    nextState: {
      status: failures === MAX_SELF_HEAL_RETRIES ? 'HALF_OPEN' : 'CLOSED',
      consecutiveFailures: failures,
      lastFailureAt: nowIso,
      nextScheduledWindowAt: new Date(nowMs + backoffMs).toISOString(),
    },
    backoffMs,
    deferredToNextWindow: false,
  };
}

/**
 * Formats an ISO timestamp in Indian Standard Time (Asia/Kolkata, UTC+05:30) or UTC
 * safely without replacing missing/null timestamps with the device clock.
 */
export function formatSourceTimestamp(
  isoString: string | null | undefined,
  lang: 'hi' | 'en' = 'hi'
): string {
  if (!isoString) {
    return lang === 'hi' ? 'स्रोत समय अनुपलब्ध (असत्यापित)' : 'Source time unavailable (Unverified)';
  }
  const ms = Date.parse(isoString);
  if (Number.isNaN(ms)) {
    return lang === 'hi' ? 'अमान्य समय प्रारूप' : 'Invalid timestamp format';
  }
  try {
    const formatter = new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${formatter.format(new Date(ms))} IST`;
  } catch {
    return isoString;
  }
}

export interface VerificationBadgeMeta {
  status: VerificationStatus;
  icon: string;
  labelEn: 'Verified' | 'Pending Verification' | 'Retracted';
  labelHi: string;
  displayLabel: string;
  descriptionEn: string;
  descriptionHi: string;
}

/**
 * Returns structured visual indicator metadata for a source/article verification status:
 * - 'verified' -> 'Verified'
 * - 'pending' -> 'Pending Verification'
 * - 'retracted' -> 'Retracted'
 */
export function getVerificationBadgeMeta(
  status: VerificationStatus,
  lang: 'hi' | 'en' = 'hi'
): VerificationBadgeMeta {
  if (status === 'verified') {
    return {
      status: 'verified',
      icon: '✓',
      labelEn: 'Verified',
      labelHi: 'सत्यापित (Verified)',
      displayLabel: lang === 'hi' ? '✓ सत्यापित (Verified)' : '✓ Verified',
      descriptionEn: 'Canonical source host, timestamp, and attribution verified against the allowlist.',
      descriptionHi: 'अनुमति-सूची के विरुद्ध कैननिकल स्रोत होस्ट, समय और श्रेय सत्यापित।',
    };
  }
  if (status === 'retracted') {
    return {
      status: 'retracted',
      icon: '⚠',
      labelEn: 'Retracted',
      labelHi: 'वापस लिया गया (Retracted)',
      displayLabel: lang === 'hi' ? '⚠ वापस लिया गया (Retracted)' : '⚠ Retracted',
      descriptionEn: 'Withdrawn or retracted by the source publisher or editorial verification gate.',
      descriptionHi: 'स्रोत प्रकाशक या संपादकीय जांच द्वारा वापस लिया गया (Retracted)।',
    };
  }
  return {
    status: 'pending',
    icon: '⏳',
    labelEn: 'Pending Verification',
    labelHi: 'सत्यापन लंबित (Pending Verification)',
    displayLabel: lang === 'hi' ? '⏳ सत्यापन लंबित (Pending Verification)' : '⏳ Pending Verification',
    descriptionEn: 'Source timestamp or publisher permission is pending verification.',
    descriptionHi: 'स्रोत समय या प्रकाशक अनुमति का सत्यापन लंबित है।',
  };
}

/**
 * Maps an ArticleRecord to all matching PreferredCategoryKey values based on its scope and category/publisher.
 */
export function getArticleCategoryKeys(item: ArticleRecord): PreferredCategoryKey[] {
  const keys = new Set<PreferredCategoryKey>();
  if (
    item.scope === 'local' ||
    item.scope === 'state' ||
    item.scope === 'national' ||
    item.scope === 'world'
  ) {
    keys.add(item.scope);
  }

  const catLower = `${item.category} ${item.publisherId}`.toLowerCase();
  if (catLower.includes('weather') || catLower.includes('imd')) {
    keys.add('weather');
  }
  if (catLower.includes('seismo') || catLower.includes('earthquake') || catLower.includes('ncs')) {
    keys.add('earthquakes');
  }
  if (catLower.includes('blog')) {
    keys.add('blogs');
  }
  if (catLower.includes('culture') || catLower.includes('astrology') || catLower.includes('panchang')) {
    keys.add('culture');
  }

  return Array.from(keys);
}

export interface PrioritizedFeedFeedResult {
  prioritizedItems: ArticleRecord[];
  secondaryItems: ArticleRecord[];
  matchedCategoriesForArticle: Record<string, PreferredCategoryKey[]>;
}

/**
 * Prioritizes and orders articles according to the user's saved preferred categories
 * and selected city/state preference while preserving non-selected items in secondaryItems.
 */
export function prioritizeArticlesByPreferences(
  items: ArticleRecord[],
  selectedCategories: PreferredCategoryKey[],
  locationPref: LocationPreference
): PrioritizedFeedFeedResult {
  const selectedSet = new Set<PreferredCategoryKey>(selectedCategories);
  const prioritizedItems: ArticleRecord[] = [];
  const secondaryItems: ArticleRecord[] = [];
  const matchedCategoriesForArticle: Record<string, PreferredCategoryKey[]> = {};

  // Filter items that belong to another city/state when in local/state scope (unless test fixture)
  const regionFiltered = items.filter((i) => {
    if (i.isTestFixture) return true;
    if (i.scope === 'local') {
      return i.cityId === locationPref.cityId || i.stateCode === locationPref.stateCode;
    }
    if (i.scope === 'state') {
      return i.stateCode === locationPref.stateCode || !i.stateCode;
    }
    return true;
  });

  for (const item of regionFiltered) {
    const itemKeys = getArticleCategoryKeys(item);
    const matched = itemKeys.filter((k) => selectedSet.has(k));
    matchedCategoriesForArticle[item.id] = matched;
    if (matched.length > 0) {
      prioritizedItems.push(item);
    } else {
      secondaryItems.push(item);
    }
  }

  // Sort prioritizedItems by the user's selectedCategories order, then by Local -> State -> National
  const scopeRank: Record<string, number> = { local: 1, state: 2, national: 3, world: 4 };
  prioritizedItems.sort((a, b) => {
    const aMatches = matchedCategoriesForArticle[a.id] ?? [];
    const bMatches = matchedCategoriesForArticle[b.id] ?? [];
    const aFirstIdx = aMatches.length > 0 ? Math.min(...aMatches.map((k) => selectedCategories.indexOf(k))) : 99;
    const bFirstIdx = bMatches.length > 0 ? Math.min(...bMatches.map((k) => selectedCategories.indexOf(k))) : 99;
    if (aFirstIdx !== bFirstIdx) return aFirstIdx - bFirstIdx;
    return (scopeRank[a.scope] ?? 9) - (scopeRank[b.scope] ?? 9);
  });

  return {
    prioritizedItems,
    secondaryItems,
    matchedCategoriesForArticle,
  };
}

/**
 * Validates and constructs a login-free ArticleReportEntry for editorial review.
 */
export function validateAndCreateArticleReport(
  articleId: string,
  articleTitle: string,
  rawReason: string,
  nowIso: string = new Date().toISOString()
): { valid: boolean; errorEn?: string; errorHi?: string; entry?: ArticleReportEntry } {
  const cleanId = sanitizeString(articleId);
  const cleanTitle = sanitizeString(articleTitle) || 'Article';
  const cleanReason = sanitizeString(rawReason);

  if (!cleanId) {
    return {
      valid: false,
      errorEn: 'Missing article ID for report.',
      errorHi: 'रिपोर्ट के लिए लेख आईडी अनुपलब्ध है।',
    };
  }

  if (cleanReason.length < 5) {
    return {
      valid: false,
      errorEn: 'Please provide a brief reason for reporting (at least 5 characters).',
      errorHi: 'कृपया रिपोर्ट करने का संक्षिप्त कारण लिखें (कम से कम 5 अक्षर)।',
    };
  }

  return {
    valid: true,
    entry: {
      id: `rep-${Date.parse(nowIso) || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      articleId: cleanId,
      articleTitle: cleanTitle,
      reason: cleanReason,
      timestamp: nowIso,
      reviewStatus: 'pending_editorial_review',
    },
  };
}

const VALID_ISSUE_TYPES: ArticleIssueType[] = [
  'inaccuracy',
  'broken_link',
  'outdated_info',
  'attribution_issue',
];

/**
 * Validates and constructs an ArticleFeedbackEntry capturing articleId, issueType, and user comments.
 */
export function validateAndCreateArticleFeedback(
  articleId: string,
  articleTitle: string,
  rawIssueType: unknown,
  rawComments: string,
  nowIso: string = new Date().toISOString()
): { valid: boolean; errorEn?: string; errorHi?: string; entry?: ArticleFeedbackEntry } {
  const cleanId = sanitizeString(articleId);
  const cleanTitle = sanitizeString(articleTitle) || 'Article';
  const cleanComments = sanitizeString(rawComments);

  if (!cleanId) {
    return {
      valid: false,
      errorEn: 'Missing article ID for feedback.',
      errorHi: 'प्रतिक्रिया के लिए लेख आईडी अनुपलब्ध है।',
    };
  }

  if (typeof rawIssueType !== 'string' || !VALID_ISSUE_TYPES.includes(rawIssueType as ArticleIssueType)) {
    return {
      valid: false,
      errorEn: 'Please select a valid issue type (Inaccuracy, Broken Link, Outdated Information, or Attribution Issue).',
      errorHi: 'कृपया समस्या का सही प्रकार चुनें (तथ्यगत त्रुटि, टूटा हुआ लिंक, पुरानी जानकारी, या श्रेय समस्या)।',
    };
  }

  if (cleanComments.length < 5) {
    return {
      valid: false,
      errorEn: 'Please enter brief comments describing the issue (at least 5 characters).',
      errorHi: 'कृपया समस्या का वर्णन करते हुए संक्षिप्त टिप्पणी लिखें (कम से कम 5 अक्षर)।',
    };
  }

  return {
    valid: true,
    entry: {
      id: `fb-${Date.parse(nowIso) || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      articleId: cleanId,
      articleTitle: cleanTitle,
      issueType: rawIssueType as ArticleIssueType,
      comments: cleanComments,
      timestamp: nowIso,
      reviewStatus: 'logged_for_review',
    },
  };
}

