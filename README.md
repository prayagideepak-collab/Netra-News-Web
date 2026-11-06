# NETRA NEWS — नेत्र न्यूज़ (Stage 1 Website & Spatial XR Kiosk)

Hindi-first, source-labelled, rights-safe, ultra-low-power newspaper website and optional Spatial 3D / WebXR newsroom preview built according to the **6 Nov 2026 Build Specification v2 & v3**.

## Audited Repository Reference (6 Nov 2026, 12:28 IST)
- **Public Owner Repository**: `https://github.com/prayagideepak-collab/Netra-News-Web`
- **Audited Head Commit SHA**: `804931da1228cfbe3b1da8462ac9d95198db1fe4`
- **Audit Summary**: Verified at 12:28 IST on 6 Nov 2026 as an AI Studio XR Blocks / Three.js / Vite TypeScript starter shell (`xrblocks ~0.24.0`, `three ~0.186.0`) containing no Netra News routes, feeds, allowlist, or publisher-rights records. This implementation delivers the complete Stage 1 responsive newspaper website + optional spatial kiosk on top of that repository baseline.

## 1. Setup, Build & Test Commands

```bash
# Install dependencies
npm install

# Run fast-feedback unit tests (14 suites covering schema, allowlist, HTML injection,
# timestamps, TEST fixtures, duplicate consolidation, city ambiguity, power tiers,
# circuit breaker, verificationStatus/editorialState indicators, category preferences,
# 20-2000 char feedback validation, spam/honeypot/idempotency controls, and 403 reviewer gate)
npx --yes tsx --test src/tests/domain.test.ts

# Type-check codebase
npm run lint

# Build production static bundle
npm run build

# Start local development server on port 3000
npm run dev
```

## 2. What Is New (Stage 1 Delivery + Build Specification v3 Additions)
- **Responsive Navy-and-Amber Newspaper Shell**: Supports `320px`, `390px`, `768px`, and `1280px+` newspaper grid layouts, 200% text zoom, Hindi Devanagari wrapping, high-contrast focus rings, and `>=44px` touch targets.
- **Verification Indicators (Owner Addition — Spec v3 Page 7)**:
  - Allowed `article.verificationStatus` enum values are strictly `verified`, `pending`, and `blocked` (mapped to visible labels `✓ Verified`, `⏳ Pending`, `⛔ Blocked` so meaning never relies only on color).
  - Missing, unknown, or malformed status values fall back to `pending` (`Pending`), never `verified`.
  - Retraction is modeled as a separate `editorialState` (`'active' | 'retracted' | 'withheld'`) with correction history (`⚠ Retracted`).
  - Home cards show `Source: [publisher]` next to `Source verification: [Verified | Pending | Blocked]` and before the timestamp; Article Detail repeats `Source verification` with `verificationCheckedAt`, `verificationReason`, the original source link when safe, and the scope-honesty note: *"This is the source verification status recorded for the item, not a guarantee that every fact is true."*
  - `Pending` and `Blocked` items never appear in Breaking or Live; `Blocked` items have no scraped body/media and no clickable unsafe URL (showing a neutral withheld notice instead).
- **Feedback, Private Review & Minimal Data (Owner Addition — Spec v3 Page 8)**:
  - **Two entry points**: (a) **Report article issue** from each card/detail page (`articleId` prefilled) and (b) **General feedback** on `/corrections` and Footer (`articleId = null`).
  - **Validation & Spam Controls**: `description` requires `20–2000` plain-text characters (HTML/scripts stripped), optional `contact` (anonymous allowed, 1-click contact deletion supported), honeypot check, submission rate-limit cooldown, and idempotency token deduplication.
  - **Stage 1 Honest Storage Behavior**: Because no private server database is connected in Stage 1, remote server submission is explicitly disabled (`disabled` button + honest status notice) and reports are preserved only as optional local drafts on the user's device. Public/unauthenticated access to the private reviewer queue is denied (`HTTP 403`).
- **User Category Preferences (`localStorage`)**:
  - Users can select and save preferred news categories (`Local`, `State`, `National`, `World`, `Weather`, `Earthquakes`, `Blogs`, `Culture/Astrology`); Home prioritizes matching categories first while keeping language (`HI`/`EN`) and city controls in the top header.
- **Manual Country > State > City & Opt-In Approximate Location**:
  - Works 100% offline with atomic `localStorage` persistence; transient browser coordinates are resolved in memory to the nearest city and immediately discarded.
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
      "verificationCheckedAt": "2026-11-06T06:00:00Z",
      "verificationReason": "TEST fixture: awaiting publisher timestamp and rights verification.",
      "editorialState": "active",
      "rightsStatus": "blocked",
      "isTestFixture": true
    }
  ],
  "sourceHealth": [],
  "nextCursor": null
}
```
