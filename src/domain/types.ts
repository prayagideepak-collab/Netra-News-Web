export type LanguageCode = 'hi' | 'en';

export type NewsScope = 'local' | 'state' | 'national' | 'world';

export type VerificationStatus = 'verified' | 'pending' | 'retracted';

export type RightsStatus = 'linkOnly' | 'licensed' | 'original' | 'blocked';

export type FeedLoadState =
  | 'loading'
  | 'loaded'
  | 'empty'
  | 'stale'
  | 'offline'
  | 'failed';

export type FeedSimulationMode =
  | 'official_links'
  | 'production_empty'
  | 'test_fixtures'
  | 'stale_offline';

export interface CorrectionEntry {
  correctedAt: string;
  reason: string;
  reasonHi?: string;
}

export interface ArticleRecord {
  id: string;
  title: string;
  titleHi: string;
  language: LanguageCode;
  category: string;
  categoryHi: string;
  scope: NewsScope;
  countryCode: string;
  stateCode: string | null;
  cityId: string | null;
  publisherId: string;
  publisher: string;
  publisherHi: string;
  sourceUrl: string;
  publishedAt: string | null;
  timezone: string;
  fetchedAt: string;
  verifiedAt: string | null;
  verificationStatus: VerificationStatus;
  rightsStatus: RightsStatus;
  permittedSummary: string | null;
  permittedSummaryHi: string | null;
  isBreaking?: boolean;
  corrections: CorrectionEntry[];
  expiry: string | null;
  licensedImage: {
    url: string;
    credit: string;
    licenceRef: string;
  } | null;
  consolidatedSources?: Array<{
    publisher: string;
    sourceUrl: string;
  }>;
  isTestFixture?: boolean;
}

export interface SourceHealthEntry {
  sourceId: string;
  publisher: string;
  status: 'healthy' | 'degraded' | 'unavailable' | 'disabled_pending_rights';
  lastCheckedAt: string;
  httpStatus: number | null;
  errorReason: string | null;
}

export interface FeedEnvelope {
  schemaVersion: number;
  generatedAt: string;
  coverage: NewsScope[];
  items: ArticleRecord[];
  sourceHealth: SourceHealthEntry[];
  nextCursor: string | null;
}

export interface SourceLedgerEntry {
  id: string;
  publisher: string;
  publisherHi: string;
  canonicalHost: string;
  feedUrl: string;
  coverage: NewsScope[];
  updateCadenceMinutes: number;
  termsUrl: string;
  licenceNotes: string;
  rightsStatus: RightsStatus;
  permissionVerified: boolean;
  enabledInStage1: boolean;
}

export interface CityEntry {
  cityId: string;
  nameEn: string;
  nameHi: string;
  stateCode: string;
  stateNameEn: string;
  stateNameHi: string;
  countryCode: string;
  timezone: string;
  approxLat: number;
  approxLon: number;
}

export interface LocationPreference {
  countryCode: string;
  stateCode: string;
  cityId: string;
  cityLabel: string;
  cityLabelHi: string;
  selectionMode: 'manual' | 'approximate';
  updatedAt: string;
  enabled: boolean;
}

export type HazardDataStatus = 'verified_active' | 'all_clear' | 'stale' | 'unavailable';

export interface WeatherBulletin {
  id: string;
  status: HazardDataStatus;
  sourcePublisher: string;
  sourceUrl: string;
  issuedAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  areaEn: string;
  areaHi: string;
  stateCode: string;
  severity: 'none' | 'watch' | 'advisory' | 'warning' | 'unknown';
  temperatureC: number | null;
  humidityPct: number | null;
  rainfallMm: number | null;
  headlineEn: string;
  headlineHi: string;
  noteEn: string;
  noteHi: string;
}

export interface EarthquakeEvent {
  id: string;
  status: HazardDataStatus;
  sourcePublisher: string;
  sourceUrl: string;
  eventTime: string | null;
  updatedAt: string | null;
  regionEn: string;
  regionHi: string;
  magnitude: number | null;
  depthKm: number | null;
  severity: 'none' | 'light' | 'moderate' | 'strong' | 'unknown';
  noteEn: string;
  noteHi: string;
}

export type PowerTier = 'Normal' | 'Saver' | 'Critical' | 'Survival';

export type ThermalStatus = 'nominal' | 'light' | 'moderate' | 'severe' | 'critical';

export interface PowerStateInput {
  batteryPct: number;
  isCharging: boolean;
  batterySaverOn: boolean;
  thermalStatus: ThermalStatus;
  screenOn: boolean;
  inForeground: boolean;
  networkMetered: boolean;
  dataSaverOn: boolean;
}

export interface PowerTierBudget {
  tier: PowerTier;
  conditionSummaryEn: string;
  conditionSummaryHi: string;
  maxWakeupsPerHour: number;
  maxNetworkCallsPerHour: number;
  fetchIntervalMinutes: number | null;
  idleDrainTargetPct24h: number;
  allowSpatial3D: boolean;
  allowNonEssentialSync: boolean;
  allowAnimations: boolean;
}

export interface CircuitBreakerState {
  status: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  consecutiveFailures: number;
  lastFailureAt: string | null;
  nextScheduledWindowAt: string | null;
}

export interface FeatureMatrixRow {
  id: string;
  featureEn: string;
  featureHi: string;
  stage: string;
  powerTierMin: PowerTier;
  wakeupCostPerHour: string;
  networkCostPerHour: string;
  batteryImpactMah: string;
  required: boolean;
  implemented: boolean;
  tested: boolean;
  blockedReason: string | null;
}

export interface OpenDecisionItem {
  id: string;
  category: string;
  questionEn: string;
  questionHi: string;
  currentAssumption: string;
  status: 'Open Decision' | 'Confirmed Stage 1 Safe Default';
}
