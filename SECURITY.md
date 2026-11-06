# SECURITY.md — NETRA NEWS (नेत्र न्यूज़)

## 1. Zero-Secrets & Public Bundle Policy
- **No Client-Side Secrets**: Browser bundles and Android APKs are public artifacts. No API keys, service-account JSONs, tokens, keystores, or publisher credentials are stored in source files, fixtures, screenshots, or client configuration.
- **No Unverified Third-Party Analytics**: Analytics, tracking pixels, and advertising beacons are disabled by default. No ads are ever displayed during Live or Breaking News.

## 2. Location Privacy & Zero Coordinate Persistence
- **Manual First**: Manual `Country > State > City` selection is the default safe path and works 100% offline.
- **Opt-In Approximate Location**: `navigator.geolocation.getCurrentPosition` is called **only** after an explicit click on the "Use approximate location" button.
- **Immediate Coordinate Disposal**: Raw latitude/longitude coordinates are resolved in-memory against the packaged administrative centroid dataset (`src/data/citiesDataset.ts`) and immediately discarded. Only `countryCode`, `stateCode`, `cityId`, `cityLabel`, `selectionMode`, `updatedAt`, and `enabled` are persisted.
- **Zero Profiling**: No raw IP profiling, cell tower lookup, location history, or background location tracking is performed.

## 3. Content Sanitization & Source Allowlist
- **Strict HTTPS Allowlist**: Canonical source URLs (`sourceUrl`) are validated by `validateHttpsCanonicalUrl()` (`src/domain/validation.ts`). Non-HTTPS URLs, URLs with embedded credentials, localhost/IP literals, and hosts outside `SOURCE_ALLOWLIST_LEDGER` are rejected.
- **HTML & Script Stripping**: All imported strings are sanitized via `sanitizeString()` to strip `<script>`, `<iframe>`, `<object>`, inline `on*=` handlers, and `javascript:` URIs before rendering.
- **External Links**: All outbound source links open with `rel="noopener noreferrer"` and strip tracking parameters (`utm_*`, `fbclid`, `gclid`).

## 4. Ultra-Low Power 24/7 Safety & Self-Healing
- **Adaptive Power Tiers**: `evaluatePowerTier()` enforces `Normal`, `Saver`, `Critical`, and `Survival` (<5% battery) modes with a +3% hysteresis buffer and immediate 1-tier drop on thermal throttling (`moderate` / `severe` / `critical`).
- **Self-Healing Circuit Breaker**: Network/feed failures use exponential backoff with jitter (`recordFailureAndAdvanceCircuit`), capped at `MAX_SELF_HEAL_RETRIES = 4`, after which the circuit breaker trips to `OPEN` and defers recovery until the next scheduled window.
- **Bounded Local Log**: Diagnostic logs are rotated at a maximum of 50 entries in local storage with zero PII or location data, and log upload is strictly gated behind charging + unmetered network conditions.
