import {
  ArticleFeedbackEntry,
  ArticleIssueType,
  ArticleRecord,
  ArticleReportEntry,
  CircuitBreakerState,
  CityEntry,
  EditorialState,
  FeedEnvelope,
  FeedbackReviewStatus,
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

    // 3. Validate source publication time first (missing or future times cannot be verified)
    const pubCheck = validateEventTimestamp(rawItem?.publishedAt, nowIso);

    // 4. Normalize verificationStatus and editorialState per Spec v3 Page 7:
    // Allowed verificationStatus values: 'verified' | 'pending' | 'blocked'.
    // Missing, unknown, or malformed verificationStatus MUST fall back to 'pending', never 'verified'.
    // Retraction is a separate editorialState ('active' | 'retracted' | 'withheld').
    const rawVerStatus = rawItem?.verificationStatus as unknown;
    const rawEdState = rawItem?.editorialState as unknown;
    const rightsStatus = rawItem?.rightsStatus;

    if (
      rightsStatus !== 'linkOnly' &&
      rightsStatus !== 'licensed' &&
      rightsStatus !== 'original' &&
      rightsStatus !== 'blocked'
    ) {
      rejectedItems.push({ id: itemId, reason: 'invalid_rights_status' });
      continue;
    }

    const normalizedVer = normalizeVerificationStatus(rawVerStatus, pubCheck.valid);
    const verificationStatus: VerificationStatus = normalizedVer.status;
    let editorialState: EditorialState = 'active';
    if (rawEdState === 'retracted' || normalizedVer.editorialStateOverride === 'retracted') {
      editorialState = 'retracted';
    } else if (
      rawEdState === 'withheld' ||
      verificationStatus === 'blocked' ||
      rightsStatus === 'blocked'
    ) {
      editorialState = 'withheld';
    }

    // 5. Validate canonical source URL against HTTPS and source allowlist
    const urlCheck = validateHttpsCanonicalUrl(rawItem?.sourceUrl, allowlist);

    if (options.isProduction) {
      if (normalizedVer.fallbackUsed) {
        rejectedItems.push({ id: itemId, reason: 'invalid_or_demoted_verification_status' });
        continue;
      }
      if (verificationStatus !== 'verified') {
        rejectedItems.push({ id: itemId, reason: `unverified_status_${verificationStatus}` });
        continue;
      }
      if (editorialState !== 'active') {
        rejectedItems.push({ id: itemId, reason: `editorial_state_${editorialState}` });
        continue;
      }
      if (rightsStatus === 'blocked') {
        rejectedItems.push({ id: itemId, reason: 'rights_blocked' });
        continue;
      }
      if (!urlCheck.valid || !urlCheck.normalizedUrl) {
        rejectedItems.push({ id: itemId, reason: `invalid_source_url_${urlCheck.reason}` });
        continue;
      }
      if (!pubCheck.valid) {
        rejectedItems.push({ id: itemId, reason: `invalid_published_at_${pubCheck.reason}` });
        continue;
      }
      if (isRecordExpired(rawItem?.expiry ?? null, nowIso)) {
        rejectedItems.push({ id: itemId, reason: 'expired_record' });
        continue;
      }
    }

    const isBlockedContent =
      verificationStatus === 'blocked' ||
      rightsStatus === 'blocked' ||
      editorialState === 'withheld' ||
      !urlCheck.valid;

    const normalizedUrl = isBlockedContent
      ? ''
      : urlCheck.normalizedUrl ?? sanitizeString(rawItem?.sourceUrl);
    const cleanPublisher = sanitizeString(rawItem?.publisher);

    // 6. Consolidate duplicate canonical URLs without losing source attribution (for valid URLs)
    if (normalizedUrl) {
      const existingByUrl = urlToItemMap.get(normalizedUrl);
      if (existingByUrl) {
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
    }

    // 7. Enforce rights-safe summary rules & Blocked content rules (Spec v3 Page 7 Item 4):
    // Blocked content has NO scraped body/media and NO clickable unsafe URL.
    let safeSummaryEn =
      isBlockedContent || !rawItem?.permittedSummary
        ? null
        : sanitizeString(rawItem.permittedSummary);
    let safeSummaryHi =
      isBlockedContent || !rawItem?.permittedSummaryHi
        ? null
        : sanitizeString(rawItem.permittedSummaryHi);

    if (rightsStatus === 'linkOnly') {
      if (safeSummaryEn && safeSummaryEn.length > 180) {
        safeSummaryEn = safeSummaryEn.slice(0, 177) + '...';
      }
      if (safeSummaryHi && safeSummaryHi.length > 180) {
        safeSummaryHi = safeSummaryHi.slice(0, 177) + '...';
      }
    }

    const defaultVerReason =
      verificationStatus === 'verified'
        ? 'Canonical HTTPS publisher domain, source timestamp, and attribution verified against allowlist.'
        : verificationStatus === 'blocked'
          ? 'Blocked: source rights not granted or URL failed allowlist/HTTPS safety verification.'
          : !pubCheck.valid
            ? `Pending: source publication timestamp invalid or future (${pubCheck.reason ?? 'unknown'}).`
            : 'Pending: publisher verification or timestamp confirmation in progress.';

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
      sourceUrlWithheld: isBlockedContent,
      publishedAt: pubCheck.valid ? rawItem.publishedAt : null,
      timezone: sanitizeString(rawItem?.timezone || 'Asia/Kolkata'),
      fetchedAt: sanitizeString(rawItem?.fetchedAt || nowIso),
      verifiedAt: rawItem?.verifiedAt ? sanitizeString(rawItem.verifiedAt) : null,
      verificationCheckedAt: rawItem?.verificationCheckedAt
        ? sanitizeString(rawItem.verificationCheckedAt)
        : rawItem?.verifiedAt
          ? sanitizeString(rawItem.verifiedAt)
          : sanitizeString(rawItem?.fetchedAt || nowIso),
      verificationReason: rawItem?.verificationReason
        ? sanitizeString(rawItem.verificationReason)
        : defaultVerReason,
      verificationReasonHi: rawItem?.verificationReasonHi
        ? sanitizeString(rawItem.verificationReasonHi)
        : null,
      verificationStatus,
      editorialState,
      rightsStatus,
      permittedSummary: safeSummaryEn,
      permittedSummaryHi: safeSummaryHi,
      // Spec v3 Page 7 Item 4: Pending and Blocked content must NEVER appear in Breaking or Live.
      isBreaking:
        Boolean(rawItem?.isBreaking) &&
        verificationStatus === 'verified' &&
        editorialState === 'active' &&
        !isBlockedContent &&
        pubCheck.valid,
      corrections: Array.isArray(rawItem?.corrections)
        ? rawItem.corrections.map((c) => ({
            correctedAt: sanitizeString(c.correctedAt),
            reason: sanitizeString(c.reason),
            reasonHi: c.reasonHi ? sanitizeString(c.reasonHi) : undefined,
          }))
        : [],
      expiry: rawItem?.expiry ? sanitizeString(rawItem.expiry) : null,
      licensedImage:
        !isBlockedContent && (rightsStatus === 'licensed' || rightsStatus === 'original')
          ? rawItem?.licensedImage ?? null
          : null, // Never display unlicensed images in linkOnly mode or blocked mode
      consolidatedSources: normalizedUrl ? [{ publisher: cleanPublisher, sourceUrl: normalizedUrl }] : [],
      isTestFixture: isTestRecord,
    };

    if (normalizedUrl) {
      urlToItemMap.set(normalizedUrl, sanitizedItem);
    }
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
 * Normalizes a raw verificationStatus value per Build Specification v3 (Page 7, Item 1 & Item 5):
 * - Allowed enum values are 'verified' | 'pending' | 'blocked'.
 * - Missing, unknown, or malformed verificationStatus MUST fall back to 'pending' (Pending), never 'verified'.
 * - If 'verified' is supplied but publication timestamp is missing/future, demotes to 'pending'.
 * - If legacy 'retracted' is supplied in verificationStatus, maps verificationStatus to 'pending' and sets editorialStateOverride = 'retracted'.
 */
export function normalizeVerificationStatus(
  rawStatus: unknown,
  pubTimeValid: boolean = true
): {
  status: VerificationStatus;
  editorialStateOverride?: EditorialState;
  fallbackUsed: boolean;
} {
  if (rawStatus === 'blocked') {
    return { status: 'blocked', fallbackUsed: false };
  }
  if (rawStatus === 'pending') {
    return { status: 'pending', fallbackUsed: false };
  }
  if (rawStatus === 'verified') {
    if (!pubTimeValid) {
      return { status: 'pending', fallbackUsed: true };
    }
    return { status: 'verified', fallbackUsed: false };
  }
  if (rawStatus === 'retracted') {
    return {
      status: 'pending',
      editorialStateOverride: 'retracted',
      fallbackUsed: true,
    };
  }
  // Missing, unknown, or malformed status falls back to 'pending', never 'verified'
  return { status: 'pending', fallbackUsed: true };
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
  labelEn: 'Verified' | 'Pending' | 'Blocked';
  labelHi: string;
  displayLabel: string;
  descriptionEn: string;
  descriptionHi: string;
}

/**
 * Returns structured visual indicator metadata for a source/article verification status per Spec v3 Page 7:
 * - 'verified' -> 'Verified'
 * - 'pending' -> 'Pending' (also fallback for any missing/unknown/malformed status)
 * - 'blocked' -> 'Blocked'
 * Always pairs an icon + text label so meaning never relies only on color.
 */
export function getVerificationBadgeMeta(
  rawStatus: unknown,
  lang: 'hi' | 'en' = 'hi'
): VerificationBadgeMeta {
  const { status } = normalizeVerificationStatus(rawStatus, true);
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
  if (status === 'blocked') {
    return {
      status: 'blocked',
      icon: '⛔',
      labelEn: 'Blocked',
      labelHi: 'अवरुद्ध (Blocked)',
      displayLabel: lang === 'hi' ? '⛔ अवरुद्ध (Blocked)' : '⛔ Blocked',
      descriptionEn: 'Blocked: source rights not granted or URL failed allowlist/HTTPS safety verification. Body, media, and external link are withheld.',
      descriptionHi: 'अवरुद्ध (Blocked): स्रोत अधिकार प्राप्त नहीं हैं या URL सुरक्षा जांच में विफल रहा। सामग्री और बाहरी लिंक रोके गए हैं।',
    };
  }
  return {
    status: 'pending',
    icon: '⏳',
    labelEn: 'Pending',
    labelHi: 'लंबित (Pending)',
    displayLabel: lang === 'hi' ? '⏳ लंबित (Pending)' : '⏳ Pending',
    descriptionEn: 'Source timestamp or publisher permission is pending verification.',
    descriptionHi: 'स्रोत समय या प्रकाशक अनुमति का सत्यापन लंबित (Pending) है।',
  };
}

export interface EditorialStateBadgeMeta {
  editorialState: EditorialState;
  icon: string;
  labelEn: 'Active' | 'Retracted' | 'Withheld';
  labelHi: string;
  displayLabel: string;
  descriptionEn: string;
  descriptionHi: string;
}

/**
 * Returns structured visual indicator metadata for editorialState ('active' | 'retracted' | 'withheld'),
 * which is separate from source verificationStatus per Spec v3 Page 7 Item 1.
 */
export function getEditorialStateBadgeMeta(
  editorialState: EditorialState | undefined,
  lang: 'hi' | 'en' = 'hi'
): EditorialStateBadgeMeta {
  if (editorialState === 'retracted') {
    return {
      editorialState: 'retracted',
      icon: '⚠',
      labelEn: 'Retracted',
      labelHi: 'वापस लिया गया (Retracted)',
      displayLabel: lang === 'hi' ? '⚠ वापस लिया गया (Retracted)' : '⚠ Retracted',
      descriptionEn: 'Retracted by the publisher or editorial verification gate; preserved with correction history for transparency.',
      descriptionHi: 'प्रकाशक या संपादकीय जांच द्वारा वापस लिया गया (Retracted); पारदर्शिता हेतु सुधार इतिहास के साथ सुरक्षित।',
    };
  }
  if (editorialState === 'withheld') {
    return {
      editorialState: 'withheld',
      icon: '⊘',
      labelEn: 'Withheld',
      labelHi: 'रोका गया (Withheld)',
      displayLabel: lang === 'hi' ? '⊘ रोका गया (Withheld)' : '⊘ Withheld',
      descriptionEn: 'Content and external link withheld due to blocked source rights or safety policy.',
      descriptionHi: 'स्रोत अधिकार या सुरक्षा नीति के कारण सामग्री और बाहरी लिंक रोका गया (Withheld)।',
    };
  }
  return {
    editorialState: 'active',
    icon: '●',
    labelEn: 'Active',
    labelHi: 'सक्रिय (Active)',
    displayLabel: lang === 'hi' ? '● सक्रिय (Active)' : '● Active',
    descriptionEn: 'Active editorial record.',
    descriptionHi: 'सक्रिय संपादकीय रिकॉर्ड।',
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
      storageMode: 'local_draft_only',
    },
  };
}

const ISSUE_TYPE_ALIAS_MAP: Record<string, ArticleIssueType> = {
  inaccuracy: 'inaccuracy',
  brokenLink: 'brokenLink',
  broken_link: 'brokenLink',
  outdated: 'outdated',
  outdated_info: 'outdated',
  other: 'other',
  attribution_issue: 'other',
  general: 'general',
};

export interface FeedbackSubmissionInput {
  articleId?: string | null;
  articleTitle?: string | null;
  issueType: unknown;
  description: string;
  comments?: string | null;
  contact?: string | null;
  honeypot?: string | null;
  idempotencyToken?: string | null;
  nowIso?: string;
  lastSubmittedAtMs?: number | null;
  seenIdempotencyTokens?: Set<string>;
  cooldownMs?: number;
}

/**
 * Validates and constructs an ArticleFeedbackEntry per Build Specification v3 (Page 8, Items 1–9):
 * - Supports both Article Issue reports (articleId prefilled) and General Feedback (articleId = null)
 * - Validates issueType ('inaccuracy' | 'brokenLink' | 'outdated' | 'other' | 'general')
 * - Requires description between 20 and 2000 plain-text characters (after stripping HTML/scripts)
 * - Allows anonymous submission without account or contact; caps optional contact at 160 chars
 * - Enforces spam controls: honeypot check, submission rate-limit cooldown, and idempotency token deduplication
 */
export function validateAndCreateArticleFeedback(
  articleIdOrInput: string | null | FeedbackSubmissionInput,
  articleTitle?: string,
  rawIssueType?: unknown,
  rawDescription?: string,
  nowIsoArg: string = new Date().toISOString(),
  optionalFields?: {
    comments?: string | null;
    contact?: string | null;
    honeypot?: string | null;
    idempotencyToken?: string | null;
    lastSubmittedAtMs?: number | null;
    seenIdempotencyTokens?: Set<string>;
    cooldownMs?: number;
  }
): {
  valid: boolean;
  errorCode?:
    | 'spam_honeypot'
    | 'rate_limited'
    | 'duplicate_retry'
    | 'invalid_issue_type'
    | 'description_too_short'
    | 'description_too_long'
    | 'contact_too_long';
  errorEn?: string;
  errorHi?: string;
  entry?: ArticleFeedbackEntry;
} {
  const input: FeedbackSubmissionInput =
    typeof articleIdOrInput === 'object' && articleIdOrInput !== null
      ? articleIdOrInput
      : {
          articleId: articleIdOrInput,
          articleTitle: articleTitle ?? null,
          issueType: rawIssueType,
          description: rawDescription ?? '',
          comments: optionalFields?.comments ?? null,
          contact: optionalFields?.contact ?? null,
          honeypot: optionalFields?.honeypot ?? null,
          idempotencyToken: optionalFields?.idempotencyToken ?? null,
          nowIso: nowIsoArg,
          lastSubmittedAtMs: optionalFields?.lastSubmittedAtMs ?? null,
          seenIdempotencyTokens: optionalFields?.seenIdempotencyTokens,
          cooldownMs: optionalFields?.cooldownMs,
        };

  const nowIso = input.nowIso ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso) || Date.now();

  // 1. Spam control: Honeypot field must be empty
  if (typeof input.honeypot === 'string' && input.honeypot.trim().length > 0) {
    return {
      valid: false,
      errorCode: 'spam_honeypot',
      errorEn: 'Automated spam submission rejected.',
      errorHi: 'स्वचालित स्पैम सबमिशन अस्वीकार किया गया।',
    };
  }

  // 2. Spam control: Rate-limit cooldown (default 10 seconds)
  const cooldownMs = input.cooldownMs ?? 10000;
  if (
    typeof input.lastSubmittedAtMs === 'number' &&
    nowMs - input.lastSubmittedAtMs >= 0 &&
    nowMs - input.lastSubmittedAtMs < cooldownMs
  ) {
    return {
      valid: false,
      errorCode: 'rate_limited',
      errorEn: 'Please wait a few seconds before submitting another feedback report.',
      errorHi: 'कृपया दूसरी प्रतिक्रिया भेजने से पहले कुछ सेकंड प्रतीक्षा करें।',
    };
  }

  // 3. Idempotency check: prevent duplicate submission retries
  const cleanToken = sanitizeString(input.idempotencyToken) || `idem-${nowMs}-${Math.random().toString(36).slice(2, 7)}`;
  if (input.seenIdempotencyTokens && input.seenIdempotencyTokens.has(cleanToken)) {
    return {
      valid: false,
      errorCode: 'duplicate_retry',
      errorEn: 'Duplicate submission ignored (idempotency token already recorded).',
      errorHi: 'डुप्लिकेट सबमिशन अनदेखा किया गया (यह रिपोर्ट पहले ही दर्ज हो चुकी है)।',
    };
  }

  // 4. Validate issueType
  const mappedIssueType =
    typeof input.issueType === 'string' ? ISSUE_TYPE_ALIAS_MAP[input.issueType.trim()] : undefined;
  if (!mappedIssueType) {
    return {
      valid: false,
      errorCode: 'invalid_issue_type',
      errorEn: 'Please select a valid issue type (Inaccuracy, Broken Link, Outdated, Other, or General).',
      errorHi: 'कृपया समस्या का सही प्रकार चुनें (तथ्यगत त्रुटि, टूटा हुआ लिंक, पुरानी जानकारी, अन्य, या सामान्य)।',
    };
  }

  // 5. Sanitize and validate description (20-2000 plain-text characters per Spec v3 Page 8 Item 2)
  const cleanDescription = sanitizeString(input.description);
  if (cleanDescription.length < 20) {
    return {
      valid: false,
      errorCode: 'description_too_short',
      errorEn: `Description must be between 20 and 2000 plain-text characters (currently ${cleanDescription.length} characters).`,
      errorHi: `विवरण 20 से 2000 सादे अक्षरों के बीच होना चाहिए (वर्तमान में ${cleanDescription.length} अक्षर)।`,
    };
  }
  if (cleanDescription.length > 2000) {
    return {
      valid: false,
      errorCode: 'description_too_long',
      errorEn: `Description must not exceed 2000 characters (currently ${cleanDescription.length} characters).`,
      errorHi: `विवरण 2000 अक्षरों से अधिक नहीं होना चाहिए (वर्तमान में ${cleanDescription.length} अक्षर)।`,
    };
  }

  // 6. Optional comments & optional contact (anonymous allowed)
  const cleanComments = input.comments ? sanitizeString(input.comments).slice(0, 1000) : null;
  const cleanContact = input.contact ? sanitizeString(input.contact) : null;
  if (cleanContact && cleanContact.length > 160) {
    return {
      valid: false,
      errorCode: 'contact_too_long',
      errorEn: 'Optional contact details must not exceed 160 characters.',
      errorHi: 'वैकल्पिक संपर्क विवरण 160 अक्षरों से अधिक नहीं होना चाहिए।',
    };
  }

  const cleanArticleId = input.articleId ? sanitizeString(input.articleId) : null;
  const cleanArticleTitle = input.articleTitle
    ? sanitizeString(input.articleTitle)
    : cleanArticleId
      ? 'Article Report'
      : 'General Feedback';

  const feedbackId = `fb-${nowMs}-${Math.random().toString(36).slice(2, 6)}`;
  if (input.seenIdempotencyTokens) {
    input.seenIdempotencyTokens.add(cleanToken);
  }

  const entry: ArticleFeedbackEntry = {
    id: feedbackId,
    feedbackId,
    articleId: cleanArticleId || null,
    articleTitle: cleanArticleTitle,
    issueType: mappedIssueType,
    description: cleanDescription,
    comments: cleanComments || null,
    contact: cleanContact || null,
    createdAt: nowIso,
    timestamp: nowIso,
    reviewStatus: 'new',
    reviewerNote: null,
    resolvedAt: null,
    idempotencyToken: cleanToken,
    storageMode: 'local_draft_only',
  };

  return {
    valid: true,
    entry,
  };
}

/**
 * Processes a validated feedback submission against an optional durable backend adapter.
 * Per Spec v3 Page 8 Item 9:
 * - If private storage is not connected (`durableAdapter === null`), returns `remoteSubmitDisabled: true`
 *   with an honest unavailable message and preserves the local draft on the user device.
 * - If a durable adapter is provided, awaits durable storage before returning success; on network/storage
 *   failure, preserves the local draft and returns an honest failure state without faking success.
 */
export async function submitFeedbackWithHonestStorage(
  input: FeedbackSubmissionInput,
  durableAdapter: null | ((record: ArticleFeedbackEntry) => Promise<{ stored: boolean; receiptId?: string }>) = null
): Promise<{
  ok: boolean;
  remoteSubmitDisabled: boolean;
  statusMessageEn: string;
  statusMessageHi: string;
  record: ArticleFeedbackEntry | null;
  errorCode?: string;
}> {
  const validation = validateAndCreateArticleFeedback(input);
  if (!validation.valid || !validation.entry) {
    return {
      ok: false,
      remoteSubmitDisabled: false,
      statusMessageEn: validation.errorEn ?? 'Invalid feedback input.',
      statusMessageHi: validation.errorHi ?? 'अमान्य प्रतिक्रिया इनपुट।',
      record: null,
      errorCode: validation.errorCode,
    };
  }

  const draftRecord = validation.entry;

  if (!durableAdapter) {
    return {
      ok: false,
      remoteSubmitDisabled: true,
      statusMessageEn:
        'Private editorial review storage is not connected in Stage 1. Remote server submit is disabled; your report has been preserved only as a local draft on this device.',
      statusMessageHi:
        'चरण 1 में निजी संपादकीय समीक्षा स्टोरेज जुड़ा नहीं है। रिमोट सर्वर सबमिट अक्षम है; आपकी रिपोर्ट केवल इस डिवाइस पर स्थानीय ड्राफ्ट के रूप में सुरक्षित की गई है।',
      record: { ...draftRecord, storageMode: 'local_draft_only' },
    };
  }

  try {
    const res = await durableAdapter(draftRecord);
    if (!res.stored) {
      return {
        ok: false,
        remoteSubmitDisabled: false,
        statusMessageEn:
          'Durable storage did not confirm receipt. Your report is preserved locally on this device so you can retry.',
        statusMessageHi:
          'स्थायी स्टोरेज ने प्राप्ति की पुष्टि नहीं की। आपकी रिपोर्ट इस डिवाइस पर सुरक्षित रखी गई है ताकि आप पुनः प्रयास कर सकें।',
        record: { ...draftRecord, storageMode: 'local_draft_only' },
        errorCode: 'storage_unconfirmed',
      };
    }
    return {
      ok: true,
      remoteSubmitDisabled: false,
      statusMessageEn: `Feedback durably recorded (${res.receiptId ?? draftRecord.feedbackId}).`,
      statusMessageHi: `प्रतिक्रिया स्थायी रूप से दर्ज की गई (${res.receiptId ?? draftRecord.feedbackId})।`,
      record: { ...draftRecord, storageMode: 'durable_server' },
    };
  } catch {
    return {
      ok: false,
      remoteSubmitDisabled: false,
      statusMessageEn:
        'Network or storage error while sending feedback. Your draft has been preserved locally on this device.',
      statusMessageHi:
        'प्रतिक्रिया भेजते समय नेटवर्क या स्टोरेज त्रुटि। आपका ड्राफ्ट इस डिवाइस पर सुरक्षित रखा गया है।',
      record: { ...draftRecord, storageMode: 'local_draft_only' },
      errorCode: 'network_failure',
    };
  }
}

/**
 * Removes optional contact information from a feedback record while preserving the anonymous issue report.
 */
export function deleteContactFromFeedbackRecord(record: ArticleFeedbackEntry): ArticleFeedbackEntry {
  return {
    ...record,
    contact: null,
  };
}

/**
 * Enforces private reviewer queue access control per Spec v3 Page 8 Item 5:
 * Never exposes the private reviewer queue publicly or to unauthenticated callers.
 */
export function verifyReviewerQueueAccess(authSession: {
  authenticated?: boolean;
  role?: string;
} | null | undefined): { allowed: boolean; statusCode: 200 | 403; reason: string } {
  if (!authSession || authSession.authenticated !== true || authSession.role !== 'editorial_reviewer') {
    return {
      allowed: false,
      statusCode: 403,
      reason: '403_FORBIDDEN_UNAUTHENTICATED_REVIEWER: Private reviewer queue is never publicly accessible.',
    };
  }
  return {
    allowed: true,
    statusCode: 200,
    reason: 'Authenticated editorial reviewer access verified.',
  };
}


