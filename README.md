# NETRA NEWS — नेत्र न्यूज़ (Stage 1 Website & Spatial XR Kiosk)

Hindi-first, source-labelled, rights-safe, ultra-low-power newspaper website and optional Spatial 3D / WebXR newsroom preview built according to the **6 Nov 2026 Build Specification**.

## 1. Setup, Build & Test Commands

```bash
# Install dependencies
npm install

# Run fast-feedback unit tests (10 suites covering schema, allowlist, HTML injection,
# timestamps, TEST fixtures, duplicate consolidation, city ambiguity, power tiers, and circuit breaker)
npx --yes tsx --test src/tests/domain.test.ts

# Type-check codebase
npm run lint

# Build production static bundle
npm run build

# Start local development server on port 3000
npm run dev
```

## 2. What Is New (Stage 1 Delivery)
- **Responsive Navy-and-Amber Newspaper Shell**: Supports `320px`, `390px`, `768px`, and `1280px+` newspaper grid layouts, 200% text zoom, Hindi Devanagari wrapping, high-contrast focus rings, and `>=44px` touch targets.
- **Shared Content, Evidence & Rights Contract (`src/domain/validation.ts`)**:
  - Validates `schemaVersion = 1` feed envelopes.
  - Rejects `id = "test-001"` and any `TEST` fixture in production mode (`isProduction: true`).
  - Defaults allowlisted official portals (`pib.gov.in`, `mausam.imd.gov.in`, `seismo.gov.in`, `ndma.gov.in`, `information.up.gov.in`) to `rightsStatus: "linkOnly"` until written republication permissions are verified.
- **Manual Country > State > City & Opt-In Approximate Location**:
  - Works 100% offline with atomic `localStorage` persistence.
  - Separate "Use approximate location" button resolves nearest city in memory, checks 35 km twin-city ambiguity (e.g., New Delhi / Noida), and immediately discards raw coordinates.
- **Weather (`/weather`) & Earthquakes (`/earthquakes`) Reference Pages**:
  - Visually distinguishes `Unavailable` (Stage 1 default), `Stale / Offline Cache`, and `Real Zero / All-Clear [TEST]`.
  - Displays mandatory non-early-warning safety disclaimers and direct links to IMD / NCS.
- **Ultra-Low Power 24/7 Adaptive Tier Governor (`/privacy`)**:
  - Enforces `Normal` (>30% or charging), `Saver` (15–30%), `Critical` (<15%), and `Survival` (<5%) budgets with +3% hysteresis and immediate 1-tier thermal drop.

## 3. Sample Labelled TEST Fixture Schema (`id=test-001`)

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-06T06:00:00Z",
  "coverage": ["local", "state", "national"],
  "items": [
    {
      "id": "test-001",
      "title": "TEST - feed unavailable example",
      "publisher": "TEST SOURCE",
      "sourceUrl": "https://pib.gov.in/RssMain.aspx",
      "publishedAt": null,
      "verificationStatus": "pending",
      "rightsStatus": "blocked",
      "isTestFixture": true
    }
  ],
  "sourceHealth": [],
  "nextCursor": null
}
```
