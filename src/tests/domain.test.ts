import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteContactFromFeedbackRecord,
  evaluatePowerTier,
  formatSourceTimestamp,
  getEditorialStateBadgeMeta,
  getVerificationBadgeMeta,
  isRecordExpired,
  MAX_SELF_HEAL_RETRIES,
  normalizeVerificationStatus,
  prioritizeArticlesByPreferences,
  recordFailureAndAdvanceCircuit,
  resolveCityFromTransientCoords,
  sanitizeString,
  submitFeedbackWithHonestStorage,
  validateAndCreateArticleFeedback,
  validateAndCreateArticleReport,
  validateEventTimestamp,
  validateFeedEnvelope,
  validateHttpsCanonicalUrl,
  verifyReviewerQueueAccess,
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

test('5. TEST fixture contract (test-001..004): strictly rejected in production, inspectable in test mode with Pending, Blocked, and Retracted rules', () => {
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
  assert.equal(devTestResult.acceptedItems.length, 4);

  // Future timestamp item must have its verificationStatus demoted to 'pending' and script stripped
  const secondItem = devTestResult.acceptedItems.find((i) => i.id === 'test-002-future-time');
  assert.ok(secondItem);
  assert.equal(secondItem.verificationStatus, 'pending');
  assert.equal(secondItem.isBreaking, false);
  assert.equal(secondItem.title.includes('<script>'), false);

  // Blocked source item must strip body, media, and unsafe URL
  const blockedItem = devTestResult.acceptedItems.find((i) => i.id === 'test-003-blocked-source');
  assert.ok(blockedItem);
  assert.equal(blockedItem.verificationStatus, 'blocked');
  assert.equal(blockedItem.editorialState, 'withheld');
  assert.equal(blockedItem.permittedSummary, null);
  assert.equal(blockedItem.licensedImage, null);
  assert.equal(blockedItem.sourceUrl, '');
  assert.equal(blockedItem.sourceUrlWithheld, true);
  assert.equal(blockedItem.isBreaking, false);

  // Retracted item uses separate editorialState ('retracted') while verificationStatus remains 'verified'
  const retractedItem = devTestResult.acceptedItems.find((i) => i.id === 'test-004-retracted');
  assert.ok(retractedItem);
  assert.equal(retractedItem.verificationStatus, 'verified');
  assert.equal(retractedItem.editorialState, 'retracted');
  assert.equal(retractedItem.isBreaking, false);
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

  const tripped = recordFailureAndAdvanceCircuit(state, REF_NOW, 10000, 0);
  assert.equal(tripped.nextState.status, 'OPEN');
  assert.equal(tripped.deferredToNextWindow, true);
  assert.equal(tripped.backoffMs, null);
});

test('11. Verification status & editorialState indicators (Spec v3 Page 7): maps verified/pending/blocked, falls back unknown to Pending, and separates Retracted', () => {
  assert.deepEqual(normalizeVerificationStatus('verified', true), {
    status: 'verified',
    fallbackUsed: false,
  });
  assert.deepEqual(normalizeVerificationStatus('pending', true), {
    status: 'pending',
    fallbackUsed: false,
  });
  assert.deepEqual(normalizeVerificationStatus('blocked', true), {
    status: 'blocked',
    fallbackUsed: false,
  });
  // Missing, unknown, or malformed status falls back to 'pending', never 'verified'
  assert.deepEqual(normalizeVerificationStatus(undefined, true), {
    status: 'pending',
    fallbackUsed: true,
  });
  assert.deepEqual(normalizeVerificationStatus(null, true), {
    status: 'pending',
    fallbackUsed: true,
  });
  assert.deepEqual(normalizeVerificationStatus('malformed_status', true), {
    status: 'pending',
    fallbackUsed: true,
  });
  assert.deepEqual(normalizeVerificationStatus('verified', false), {
    status: 'pending',
    fallbackUsed: true,
  });

  const vBadge = getVerificationBadgeMeta('verified', 'en');
  assert.equal(vBadge.status, 'verified');
  assert.equal(vBadge.labelEn, 'Verified');
  assert.match(vBadge.displayLabel, /✓ Verified/);

  const pBadge = getVerificationBadgeMeta('unknown_value', 'en');
  assert.equal(pBadge.status, 'pending');
  assert.equal(pBadge.labelEn, 'Pending');
  assert.match(pBadge.displayLabel, /⏳ Pending/);

  const bBadge = getVerificationBadgeMeta('blocked', 'en');
  assert.equal(bBadge.status, 'blocked');
  assert.equal(bBadge.labelEn, 'Blocked');
  assert.match(bBadge.displayLabel, /⛔ Blocked/);

  const rEditorial = getEditorialStateBadgeMeta('retracted', 'en');
  assert.ok(rEditorial);
  assert.equal(rEditorial.labelEn, 'Retracted');
  assert.match(rEditorial.displayLabel, /⚠ Retracted/);
});

test('12. User category preferences: prioritizes and orders articles matching selected categories', () => {
  const validItems = validateFeedEnvelope(STAGE1_OFFICIAL_LINK_ENVELOPE, SOURCE_ALLOWLIST_LEDGER, {
    isProduction: true,
    referenceNowIso: REF_NOW,
  }).acceptedItems;

  const prioritized = prioritizeArticlesByPreferences(
    validItems,
    ['earthquakes', 'weather'],
    DEFAULT_LOCATION_PREFERENCE
  );

  assert.equal(prioritized.prioritizedItems.length, 2);
  assert.equal(prioritized.prioritizedItems[0].id, 'link-national-ncs-01');
  assert.equal(prioritized.prioritizedItems[1].id, 'link-state-imd-01');
  assert.ok(prioritized.secondaryItems.length >= 2);
});

test('13. Report Article & Spec v3 Feedback validators: 20-2000 char limits, script stripping, anonymous contact, contact deletion, spam/honeypot/rate-limit/idempotency', () => {
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
  assert.equal(validReport.entry?.reason.includes('<script>'), false);

  // Under 20 chars rejected
  const shortFeedback = validateAndCreateArticleFeedback({
    articleId: 'link-state-imd-01',
    articleTitle: 'IMD Bulletin',
    issueType: 'brokenLink',
    description: 'Too short text',
    nowIso: REF_NOW,
  });
  assert.equal(shortFeedback.valid, false);
  assert.equal(shortFeedback.errorCode, 'description_too_short');

  // Over 2000 chars rejected
  const longFeedback = validateAndCreateArticleFeedback({
    articleId: 'link-state-imd-01',
    articleTitle: 'IMD Bulletin',
    issueType: 'inaccuracy',
    description: 'a'.repeat(2005),
    nowIso: REF_NOW,
  });
  assert.equal(longFeedback.valid, false);
  assert.equal(longFeedback.errorCode, 'description_too_long');

  // Honeypot spam rejected
  const spamHoneypot = validateAndCreateArticleFeedback({
    articleId: 'link-state-imd-01',
    articleTitle: 'IMD Bulletin',
    issueType: 'inaccuracy',
    description: 'This is a valid length description for testing honeypot.',
    honeypot: 'bot-filled-value',
    nowIso: REF_NOW,
  });
  assert.equal(spamHoneypot.valid, false);
  assert.equal(spamHoneypot.errorCode, 'spam_honeypot');

  // Valid anonymous feedback (no contact) + script stripped
  const seenTokens = new Set<string>();
  const validFeedback = validateAndCreateArticleFeedback({
    articleId: 'link-state-imd-01',
    articleTitle: 'IMD Bulletin',
    issueType: 'brokenLink',
    description: 'The canonical forecast URL timed out during check <script>evil()</script>.',
    contact: null,
    idempotencyToken: 'token-fixed-001',
    nowIso: REF_NOW,
    seenIdempotencyTokens: seenTokens,
  });
  assert.equal(validFeedback.valid, true);
  assert.equal(validFeedback.entry?.articleId, 'link-state-imd-01');
  assert.equal(validFeedback.entry?.issueType, 'brokenLink');
  assert.equal(validFeedback.entry?.contact, null);
  assert.equal(validFeedback.entry?.description.includes('<script>'), false);
  assert.equal(validFeedback.entry?.reviewStatus, 'new');

  // Idempotency duplicate retry rejected
  const duplicateFeedback = validateAndCreateArticleFeedback({
    articleId: 'link-state-imd-01',
    articleTitle: 'IMD Bulletin',
    issueType: 'brokenLink',
    description: 'The canonical forecast URL timed out during check <script>evil()</script>.',
    idempotencyToken: 'token-fixed-001',
    nowIso: REF_NOW,
    seenIdempotencyTokens: seenTokens,
  });
  assert.equal(duplicateFeedback.valid, false);
  assert.equal(duplicateFeedback.errorCode, 'duplicate_retry');

  // Optional contact deletion
  const withContact = validateAndCreateArticleFeedback({
    articleId: null,
    articleTitle: 'General Feedback',
    issueType: 'general',
    description: 'General feedback from Help/Footer without an article ID attached.',
    contact: 'reader@example.org',
    nowIso: REF_NOW,
  });
  assert.equal(withContact.valid, true);
  assert.equal(withContact.entry?.articleId, null);
  assert.equal(withContact.entry?.contact, 'reader@example.org');

  const strippedContact = deleteContactFromFeedbackRecord(withContact.entry!);
  assert.equal(strippedContact.contact, null);
});

test('14. Stage 1 Honest Storage & Reviewer Queue Access Control (Spec v3 Page 8 Items 5, 8, 9)', async () => {
  const fbInput = {
    articleId: 'link-up-lucknow-01',
    articleTitle: 'Lucknow Bulletin',
    issueType: 'outdated',
    description: 'The press release timestamp has been superseded by an evening update.',
    nowIso: REF_NOW,
  };

  // Unconnected backend in Stage 1: remote submit is disabled, preserves local draft honestly
  const stage1Submit = await submitFeedbackWithHonestStorage(fbInput, null);
  assert.equal(stage1Submit.ok, false);
  assert.equal(stage1Submit.remoteSubmitDisabled, true);
  assert.equal(stage1Submit.record?.storageMode, 'local_draft_only');

  // Connected backend simulation: network failure preserves local draft honestly
  const failedNetworkSubmit = await submitFeedbackWithHonestStorage(fbInput, async () => {
    throw new Error('503 Service Unavailable');
  });
  assert.equal(failedNetworkSubmit.ok, false);
  assert.equal(failedNetworkSubmit.record?.storageMode, 'local_draft_only');
  assert.equal(failedNetworkSubmit.errorCode, 'network_failure');

  // Connected backend simulation: durable storage confirmed
  const durableSuccess = await submitFeedbackWithHonestStorage(fbInput, async () => ({
    stored: true,
    receiptId: 'srv-receipt-101',
  }));
  assert.equal(durableSuccess.ok, true);
  assert.equal(durableSuccess.record?.storageMode, 'durable_server');

  // Reviewer queue access control: denies public/unauthenticated requests with 403
  const publicAccess = verifyReviewerQueueAccess({
    authenticated: false,
    role: 'public',
  });
  assert.equal(publicAccess.allowed, false);
  assert.equal(publicAccess.statusCode, 403);

  const reviewerAccess = verifyReviewerQueueAccess({
    authenticated: true,
    role: 'editorial_reviewer',
  });
  assert.equal(reviewerAccess.allowed, true);
  assert.equal(reviewerAccess.statusCode, 200);
});
