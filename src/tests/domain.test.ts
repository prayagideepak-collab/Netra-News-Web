import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePowerTier,
  formatSourceTimestamp,
  getVerificationBadgeMeta,
  isRecordExpired,
  MAX_SELF_HEAL_RETRIES,
  prioritizeArticlesByPreferences,
  recordFailureAndAdvanceCircuit,
  resolveCityFromTransientCoords,
  sanitizeString,
  validateAndCreateArticleFeedback,
  validateAndCreateArticleReport,
  validateEventTimestamp,
  validateFeedEnvelope,
  validateHttpsCanonicalUrl,
} from '../domain/validation';
import { SOURCE_ALLOWLIST_LEDGER } from '../data/sourcesLedger';
import { PACKAGED_CITIES } from '../data/citiesDataset';
import {
  PRODUCTION_EMPTY_ENVELOPE,
  STAGE1_OFFICIAL_LINK_ENVELOPE,
  TEST_FIXTURE_ENVELOPE,
} from '../data/feedsData';
import { DEFAULT_LOCATION_PREFERENCE } from '../data/storage';
import { CircuitBreakerState } from '../domain/types';

const REF_NOW = '2026-11-06T06:00:00Z';

test('1. Schema validation: rejects incompatible schemaVersion and accepts empty verified envelope', () => {
  const badSchema = validateFeedEnvelope(
    { ...PRODUCTION_EMPTY_ENVELOPE, schemaVersion: 2 },
    SOURCE_ALLOWLIST_LEDGER,
    { isProduction: true, referenceNowIso: REF_NOW }
  );
  assert.equal(badSchema.validEnvelope, false);
  assert.match(badSchema.envelopeError ?? '', /expected 1/);

  const emptyValid = validateFeedEnvelope(PRODUCTION_EMPTY_ENVELOPE, SOURCE_ALLOWLIST_LEDGER, {
    isProduction: true,
    referenceNowIso: REF_NOW,
  });
  assert.equal(emptyValid.validEnvelope, true);
  assert.equal(emptyValid.acceptedItems.length, 0);
});

test('2. URL & source allowlist: enforces HTTPS, blocks credentials/IPs, and checks allowlist host', () => {
  const validPib = validateHttpsCanonicalUrl(
    'https://pib.gov.in/RssMain.aspx?utm_source=tracker',
    SOURCE_ALLOWLIST_LEDGER
  );
  assert.equal(validPib.valid, true);
  assert.equal(validPib.normalizedUrl, 'https://pib.gov.in/RssMain.aspx');

  const httpRejected = validateHttpsCanonicalUrl(
    'http://pib.gov.in/RssMain.aspx',
    SOURCE_ALLOWLIST_LEDGER
  );
  assert.equal(httpRejected.valid, false);
  assert.equal(httpRejected.reason, 'non_https_protocol');

  const unknownHost = validateHttpsCanonicalUrl(
    'https://unverified-news-scraper.example.com/story',
    SOURCE_ALLOWLIST_LEDGER
  );
  assert.equal(unknownHost.valid, false);
  assert.equal(unknownHost.reason, 'host_not_in_allowlist');

  const credentialsUrl = validateHttpsCanonicalUrl(
    'https://admin:secret@pib.gov.in/RssMain.aspx',
    SOURCE_ALLOWLIST_LEDGER
  );
  assert.equal(credentialsUrl.valid, false);
  assert.equal(credentialsUrl.reason, 'credentials_in_url');
});

test('3. HTML injection & Hindi Devanagari preservation: strips scripts and tags cleanly', () => {
  const dirty =
    'लखनऊ बुलेटिन <script>window.steal()</script><img src=x onerror="alert(1)"> javascript:void(0) मुख्य समाचार';
  const cleaned = sanitizeString(dirty);
  assert.equal(cleaned.includes('<script>'), false);
  assert.equal(cleaned.includes('onerror'), false);
  assert.equal(cleaned.includes('javascript:'), false);
  assert.equal(cleaned.includes('लखनऊ बुलेटिन'), true);
  assert.equal(cleaned.includes('मुख्य समाचार'), true);
});

test('4. Future and missing timestamps: rejected in production without substituting device clock', () => {
  const missingCheck = validateEventTimestamp(null, REF_NOW);
  assert.equal(missingCheck.valid, false);
  assert.equal(missingCheck.reason, 'missing');

  const futureCheck = validateEventTimestamp('2026-11-07T12:00:00Z', REF_NOW);
  assert.equal(futureCheck.valid, false);
  assert.equal(futureCheck.reason, 'future_timestamp');

  const validIstCheck = validateEventTimestamp('2026-11-06T10:30:00+05:30', REF_NOW);
  assert.equal(validIstCheck.valid, true);

  const labelForMissing = formatSourceTimestamp(null, 'en');
  assert.match(labelForMissing, /Source time unavailable/);
});

test('5. TEST fixture contract (test-001): strictly rejected in production, inspectable in test mode', () => {
  const prodResult = validateFeedEnvelope(TEST_FIXTURE_ENVELOPE, SOURCE_ALLOWLIST_LEDGER, {
    isProduction: true,
    referenceNowIso: REF_NOW,
  });
  assert.equal(prodResult.acceptedItems.length, 0);
  assert.equal(
    prodResult.rejectedItems.some((r) => r.id === 'test-001'),
    true
  );

  const devTestResult = validateFeedEnvelope(TEST_FIXTURE_ENVELOPE, SOURCE_ALLOWLIST_LEDGER, {
    isProduction: false,
    referenceNowIso: REF_NOW,
  });
  assert.equal(devTestResult.acceptedItems.length, 3);
  // Future timestamp item must have its verificationStatus demoted to 'pending' and script stripped
  const secondItem = devTestResult.acceptedItems.find((i) => i.id === 'test-002-future-time');
  assert.ok(secondItem);
  assert.equal(secondItem.verificationStatus, 'pending');
  assert.equal(secondItem.isBreaking, false);
  assert.equal(secondItem.title.includes('<script>'), false);

  const retractedItem = devTestResult.acceptedItems.find((i) => i.id === 'test-003-retracted');
  assert.ok(retractedItem);
  assert.equal(retractedItem.verificationStatus, 'retracted');
});

test('6. Duplicate IDs and duplicate canonical URLs: rejects duplicate IDs and consolidates duplicate URLs', () => {
  const baseItem = STAGE1_OFFICIAL_LINK_ENVELOPE.items[0];
  const envelopeWithDuplicates = {
    ...STAGE1_OFFICIAL_LINK_ENVELOPE,
    items: [
      baseItem,
      { ...baseItem }, // Duplicate ID
      {
        ...baseItem,
        id: 'link-up-lucknow-syndicate-2',
        publisher: 'UP District Information Mirror',
      }, // Different ID, same canonical URL
    ],
  };

  const res = validateFeedEnvelope(envelopeWithDuplicates, SOURCE_ALLOWLIST_LEDGER, {
    isProduction: true,
    referenceNowIso: REF_NOW,
  });

  assert.equal(res.acceptedItems.length, 1);
  assert.equal(
    res.rejectedItems.some((r) => r.reason === 'duplicate_id'),
    true
  );
  assert.equal(res.consolidatedCount, 1);
  assert.equal(res.acceptedItems[0].consolidatedSources?.length, 2);
});

test('7. Expired records: filtered out in production mode', () => {
  assert.equal(isRecordExpired('2026-11-05T00:00:00Z', REF_NOW), true);
  assert.equal(isRecordExpired('2026-11-07T00:00:00Z', REF_NOW), false);
});

test('8. Approximate location city resolution: resolves city, detects ambiguity, and discards raw coords', () => {
  // Coordinates right between New Delhi (28.6139, 77.2090) and Noida (28.5355, 77.3910) -> ~20km apart
  const resolution = resolveCityFromTransientCoords(28.58, 77.3, PACKAGED_CITIES, REF_NOW);
  assert.ok(resolution.resolved);
  assert.equal(resolution.isAmbiguous, true);
  assert.equal(resolution.ambiguousCandidates.length, 2);
  assert.ok(resolution.preferenceRecord);

  // Verify raw coordinates are NOT present anywhere in the persisted preferenceRecord
  const serialized = JSON.stringify(resolution.preferenceRecord);
  assert.equal(serialized.includes('28.58'), false);
  assert.equal(serialized.includes('77.3'), false);
  assert.equal('approxLat' in resolution.preferenceRecord, false);
});

test('9. Adaptive Power Tiers: enforces Normal/Saver/Critical/Survival thresholds, hysteresis, and thermal drop', () => {
  // Normal at 80%
  const t1 = evaluatePowerTier('Normal', {
    batteryPct: 80,
    isCharging: false,
    batterySaverOn: false,
    thermalStatus: 'nominal',
    screenOn: true,
    inForeground: true,
    networkMetered: false,
    dataSaverOn: false,
  });
  assert.equal(t1, 'Normal');

  // Thermal moderate drops Normal -> Saver immediately
  const tThermal = evaluatePowerTier('Normal', {
    batteryPct: 80,
    isCharging: false,
    batterySaverOn: false,
    thermalStatus: 'moderate',
    screenOn: true,
    inForeground: true,
    networkMetered: false,
    dataSaverOn: false,
  });
  assert.equal(tThermal, 'Saver');

  // Drop to Critical at 12%
  const tCrit = evaluatePowerTier('Saver', {
    batteryPct: 12,
    isCharging: false,
    batterySaverOn: false,
    thermalStatus: 'nominal',
    screenOn: true,
    inForeground: true,
    networkMetered: false,
    dataSaverOn: false,
  });
  assert.equal(tCrit, 'Critical');

  // Hysteresis: rising to 16% (within 15% + 3% buffer) stays Critical if not charging
  const tHyst = evaluatePowerTier('Critical', {
    batteryPct: 16,
    isCharging: false,
    batterySaverOn: false,
    thermalStatus: 'nominal',
    screenOn: true,
    inForeground: true,
    networkMetered: false,
    dataSaverOn: false,
  });
  assert.equal(tHyst, 'Critical');

  // Survival below 5%
  const tSurv = evaluatePowerTier('Critical', {
    batteryPct: 4,
    isCharging: false,
    batterySaverOn: false,
    thermalStatus: 'nominal',
    screenOn: false,
    inForeground: false,
    networkMetered: true,
    dataSaverOn: true,
  });
  assert.equal(tSurv, 'Survival');
});

test('10. Self-healing exponential backoff and circuit breaker cap', () => {
  let state: CircuitBreakerState = {
    status: 'CLOSED',
    consecutiveFailures: 0,
    lastFailureAt: null,
    nextScheduledWindowAt: null,
  };

  for (let i = 1; i <= MAX_SELF_HEAL_RETRIES; i++) {
    const step = recordFailureAndAdvanceCircuit(state, REF_NOW, 10000, 0);
    state = step.nextState;
    assert.equal(step.deferredToNextWindow, false);
    assert.ok(step.backoffMs && step.backoffMs >= 10000 * Math.pow(2, i - 1));
  }

  // Exceeding MAX_SELF_HEAL_RETRIES trips circuit breaker to OPEN and defers recovery
  const tripped = recordFailureAndAdvanceCircuit(state, REF_NOW, 10000, 0);
  assert.equal(tripped.nextState.status, 'OPEN');
  assert.equal(tripped.deferredToNextWindow, true);
  assert.equal(tripped.backoffMs, null);
});

test('11. Verification status visual indicator metadata: maps verified, pending, and retracted accurately', () => {
  const vBadge = getVerificationBadgeMeta('verified', 'en');
  assert.equal(vBadge.labelEn, 'Verified');
  assert.match(vBadge.displayLabel, /Verified/);

  const pBadge = getVerificationBadgeMeta('pending', 'en');
  assert.equal(pBadge.labelEn, 'Pending Verification');
  assert.match(pBadge.displayLabel, /Pending Verification/);

  const rBadge = getVerificationBadgeMeta('retracted', 'en');
  assert.equal(rBadge.labelEn, 'Retracted');
  assert.match(rBadge.displayLabel, /Retracted/);
});

test('12. User category preferences: prioritizes and orders articles matching selected categories', () => {
  const validItems = validateFeedEnvelope(STAGE1_OFFICIAL_LINK_ENVELOPE, SOURCE_ALLOWLIST_LEDGER, {
    isProduction: true,
    referenceNowIso: REF_NOW,
  }).acceptedItems;

  // Prioritize 'earthquakes' and 'weather' only
  const prioritized = prioritizeArticlesByPreferences(
    validItems,
    ['earthquakes', 'weather'],
    DEFAULT_LOCATION_PREFERENCE
  );

  assert.equal(prioritized.prioritizedItems.length, 2);
  // Earthquakes was listed first in selectedCategories, so NCS earthquake item comes first
  assert.equal(prioritized.prioritizedItems[0].id, 'link-national-ncs-01');
  assert.equal(prioritized.prioritizedItems[1].id, 'link-state-imd-01');
  assert.ok(prioritized.secondaryItems.length >= 2);
});

test('13. Report Article & Article Issue Feedback validators: sanitize strings, capture IDs/timestamps, and reject invalid input', () => {
  const badReport = validateAndCreateArticleReport('link-up-lucknow-01', 'Lucknow Bulletin', 'bad', REF_NOW);
  assert.equal(badReport.valid, false);

  const validReport = validateAndCreateArticleReport(
    'link-up-lucknow-01',
    'Lucknow Bulletin',
    'Please verify updated district link <script>alert(1)</script>',
    REF_NOW
  );
  assert.equal(validReport.valid, true);
  assert.equal(validReport.entry?.articleId, 'link-up-lucknow-01');
  assert.equal(validReport.entry?.timestamp, REF_NOW);
  assert.equal(validReport.entry?.reason.includes('<script>'), false);

  const badFeedback = validateAndCreateArticleFeedback(
    'link-state-imd-01',
    'IMD Bulletin',
    'invalid_type',
    'Broken link to PDF',
    REF_NOW
  );
  assert.equal(badFeedback.valid, false);

  const validFeedback = validateAndCreateArticleFeedback(
    'link-state-imd-01',
    'IMD Bulletin',
    'broken_link',
    'The canonical forecast URL timed out during check.',
    REF_NOW
  );
  assert.equal(validFeedback.valid, true);
  assert.equal(validFeedback.entry?.articleId, 'link-state-imd-01');
  assert.equal(validFeedback.entry?.issueType, 'broken_link');
  assert.equal(validFeedback.entry?.timestamp, REF_NOW);
});

