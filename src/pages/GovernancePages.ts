import {
  EARTHQUAKE_EVENTS_BY_MODE,
  FEATURE_MATRIX_ROWS,
  OPEN_DECISIONS_LIST,
  POWER_BUDGET_TIERS,
  WEATHER_BULLETINS_BY_MODE,
} from '../data/feedsData';
import { SOURCE_ALLOWLIST_LEDGER } from '../data/sourcesLedger';
import { CorrectionDraft, DiagnosticLogEntry } from '../data/storage';
import {
  ArticleRecord,
  CircuitBreakerState,
  LanguageCode,
  LocationPreference,
  PowerStateInput,
  PowerTier,
} from '../domain/types';
import { formatSourceTimestamp } from '../domain/validation';

export function renderWeatherPage(
  lang: LanguageCode,
  locationPref: LocationPreference,
  hazardPreviewState: 'unavailable' | 'stale' | 'all_clear_test'
): string {
  const isHi = lang === 'hi';
  const bulletin = WEATHER_BULLETINS_BY_MODE[hazardPreviewState];

  return `
    <section class="newspaper-section" style="margin-top:16px; border-top:none; padding-top:0;">
      <div class="section-header-row">
        <div>
          <h1 class="section-title">${
            isHi ? 'मौसम संदर्भ एवं आधिकारिक बुलेटिन (Weather)' : 'Weather Reference & Official Bulletins'
          }</h1>
          <p class="section-subtitle">
            ${
              isHi
                ? `चयनित क्षेत्र: ${locationPref.cityLabelHi} · स्रोत: भारत मौसम विज्ञान विभाग (IMD)`
                : `Selected Area: ${locationPref.cityLabel} · Source: India Meteorological Department (IMD)`
            }
          </p>
        </div>
      </div>

      <div class="state-banner" data-state="stale" style="margin-top:12px;">
        <strong>${
          isHi
            ? 'महत्वपूर्ण अस्वीकरण (Not an Emergency Early-Warning System):'
            : 'Mandatory Safety Disclaimer (Not an Emergency Early-Warning System):'
        }</strong>
        <span>
          ${
            isHi
              ? 'नेत्र न्यूज़ कोई आपातकालीन पूर्व-चेतावनी प्रणाली नहीं है। वास्तविक समय की चेतावनियों के लिए हमेशा आधिकारिक IMD / NDMA बुलेटिन देखें।'
              : 'NETRA NEWS is NOT an emergency early-warning system without dedicated delivery and acceptance tests. Always verify active warnings directly on official IMD / NDMA portals.'
          }
        </span>
      </div>

      <div style="margin-top:20px; display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
        <span style="font-size:0.88rem; color:var(--text-secondary); font-weight:600;">
          ${isHi ? 'अवस्था दृश्य अंतर जांचें (Compare States):' : 'Inspect Distinct State Visuals:'}
        </span>
        <button type="button" class="hazard-state-btn ${
          hazardPreviewState === 'unavailable' ? 'btn-amber' : ''
        }" data-hazard-mode="unavailable">
          ${isHi ? '1. अनुपलब्ध (Stage 1 Default Unavailable)' : '1. Unavailable (Stage 1 Default)'}
        </button>
        <button type="button" class="hazard-state-btn ${
          hazardPreviewState === 'stale' ? 'btn-amber' : ''
        }" data-hazard-mode="stale">
          ${isHi ? '2. बासी / एक्सपायर्ड कैश [TEST Stale]' : '2. Stale / Expired Cache [TEST]'}
        </button>
        <button type="button" class="hazard-state-btn ${
          hazardPreviewState === 'all_clear_test' ? 'btn-amber' : ''
        }" data-hazard-mode="all_clear_test">
          ${isHi ? '3. वास्तविक शून्य / ऑल-क्लियर [TEST All-Clear]' : '3. Real Zero / All-Clear [TEST]'}
        </button>
      </div>

      <div class="state-banner" data-state="${bulletin.status}" style="margin-top:20px;">
        <div class="article-kicker-meta">
          <strong>${bulletin.status.toUpperCase()}</strong>
          <span aria-hidden="true"> · </span>
          <span>${bulletin.sourcePublisher}</span>
          <span aria-hidden="true"> · </span>
          <span>${isHi ? bulletin.areaHi : bulletin.areaEn}</span>
        </div>
        <h2 class="article-headline" style="margin-top:8px;">
          ${isHi ? bulletin.headlineHi : bulletin.headlineEn}
        </h2>
        <p class="article-summary" style="margin-top:8px;">
          ${isHi ? bulletin.noteHi : bulletin.noteEn}
        </p>

        <div class="article-timestamps" style="margin-top:16px;">
          <div>
            ${isHi ? 'स्रोत जारी समय (Source Issued At):' : 'Source Issued At:'}
            ${formatSourceTimestamp(bulletin.issuedAt, lang)}
          </div>
          <div>
            ${isHi ? 'अंतिम अद्यतन (Updated At):' : 'Updated At:'}
            ${formatSourceTimestamp(bulletin.updatedAt, lang)}
          </div>
          <div>
            ${isHi ? 'समाप्ति समय (Expires At):' : 'Expires At:'}
            ${formatSourceTimestamp(bulletin.expiresAt, lang)}
          </div>
          <div>
            ${isHi ? 'गंभीरता स्तर (Severity) एवं इकाइयां (Units):' : 'Severity & Metric Units:'}
            Severity=${bulletin.severity.toUpperCase()} ·
            Temp=${bulletin.temperatureC !== null ? `${bulletin.temperatureC} °C` : 'null (not fabricated)'} ·
            Rainfall=${bulletin.rainfallMm !== null ? `${bulletin.rainfallMm} mm` : 'null (not fabricated)'}
          </div>
        </div>

        <div class="article-actions" style="margin-top:16px;">
          <a
            href="${bulletin.sourceUrl}"
            target="_blank"
            rel="noopener noreferrer"
            class="ext-link-btn"
          >
            ${
              isHi
                ? 'आधिकारिक IMD मौसम बुलेटिन खोलें (mausam.imd.gov.in) ↗'
                : 'Open Official IMD Forecast Bulletin (mausam.imd.gov.in) ↗'
            }
          </a>
        </div>
      </div>
    </section>
  `;
}

export function renderEarthquakesPage(
  lang: LanguageCode,
  hazardPreviewState: 'unavailable' | 'stale' | 'all_clear_test'
): string {
  const isHi = lang === 'hi';
  const eq = EARTHQUAKE_EVENTS_BY_MODE[hazardPreviewState];

  return `
    <section class="newspaper-section" style="margin-top:16px; border-top:none; padding-top:0;">
      <div class="section-header-row">
        <div>
          <h1 class="section-title">${
            isHi ? 'भूकंप विज्ञान संदर्भ (Earthquakes — NCS)' : 'Earthquakes Reference (National Center for Seismology)'
          }</h1>
          <p class="section-subtitle">
            ${
              isHi
                ? 'स्रोत-जारी घटना समय, क्षेत्र, इकाइयां (Magnitude M / Depth km), और आधिकारिक लिंक'
                : 'Source-issued event time, area, units (Magnitude M / Depth km), severity, and canonical link'
            }
          </p>
        </div>
      </div>

      <div class="state-banner" data-state="stale" style="margin-top:12px;">
        <strong>${
          isHi
            ? 'महत्वपूर्ण अस्वीकरण (Not an Earthquake Early-Warning System):'
            : 'Mandatory Safety Disclaimer (Not an Earthquake Early-Warning System):'
        }</strong>
        <span>
          ${
            isHi
              ? 'यह पृष्ठ केवल आधिकारिक राष्ट्रीय भूकंप विज्ञान केंद्र (NCS) का संदर्भ लिंक प्रदान करता है। अनुपलब्ध या बासी डेटा का अर्थ "कोई भूकंप नहीं" (All-Clear) कदापि नहीं है।'
              : 'This page provides reference links to the National Center for Seismology (NCS). Unavailable or stale states never imply zero seismic activity.'
          }
        </span>
      </div>

      <div style="margin-top:20px; display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
        <span style="font-size:0.88rem; color:var(--text-secondary); font-weight:600;">
          ${isHi ? 'अवस्था दृश्य अंतर जांचें (Compare States):' : 'Inspect Distinct State Visuals:'}
        </span>
        <button type="button" class="hazard-state-btn ${
          hazardPreviewState === 'unavailable' ? 'btn-amber' : ''
        }" data-hazard-mode="unavailable">
          ${isHi ? '1. अनुपलब्ध (Stage 1 Default Unavailable)' : '1. Unavailable (Stage 1 Default)'}
        </button>
        <button type="button" class="hazard-state-btn ${
          hazardPreviewState === 'stale' ? 'btn-amber' : ''
        }" data-hazard-mode="stale">
          ${isHi ? '2. बासी / ऑफ़लाइन कैश [TEST Stale]' : '2. Stale / Offline Cache [TEST]'}
        </button>
        <button type="button" class="hazard-state-btn ${
          hazardPreviewState === 'all_clear_test' ? 'btn-amber' : ''
        }" data-hazard-mode="all_clear_test">
          ${isHi ? '3. वास्तविक शून्य / ऑल-क्लियर [TEST All-Clear]' : '3. Real Zero / All-Clear [TEST]'}
        </button>
      </div>

      <div class="state-banner" data-state="${eq.status}" style="margin-top:20px;">
        <div class="article-kicker-meta">
          <strong>${eq.status.toUpperCase()}</strong>
          <span aria-hidden="true"> · </span>
          <span>${eq.sourcePublisher}</span>
          <span aria-hidden="true"> · </span>
          <span>${isHi ? eq.regionHi : eq.regionEn}</span>
        </div>
        <h2 class="article-headline" style="margin-top:8px;">
          ${
            eq.status === 'unavailable'
              ? isHi
                ? 'लाइव NCS भूकंप फ़ीड अभी जुड़ी नहीं है (चरण 1)'
                : 'Live NCS Seismic Ingestion Not Connected (Stage 1)'
              : eq.status === 'stale'
                ? isHi
                  ? 'TEST पुराना स्नैपशॉट — फ़ीड कनेक्शन ऑफ़लाइन'
                  : 'TEST Stale Snapshot — Feed Connection Offline'
                : isHi
                  ? 'TEST ऑल-क्लियर: निगरानी विंडो में 0 भूकंप'
                  : 'TEST All-Clear: 0 Reported Events Above Threshold'
          }
        </h2>
        <p class="article-summary" style="margin-top:8px;">
          ${isHi ? eq.noteHi : eq.noteEn}
        </p>

        <div class="article-timestamps" style="margin-top:16px;">
          <div>
            ${isHi ? 'स्रोत घटना समय (Event Time):' : 'Source Event Time:'}
            ${formatSourceTimestamp(eq.eventTime, lang)}
          </div>
          <div>
            ${isHi ? 'अंतिम जांच (Updated At):' : 'Updated At:'}
            ${formatSourceTimestamp(eq.updatedAt, lang)}
          </div>
          <div>
            ${isHi ? 'माप इकाइयां (Units & Severity):' : 'Units & Severity:'}
            Severity=${eq.severity.toUpperCase()} ·
            Magnitude=${eq.magnitude !== null ? `${eq.magnitude} M` : 'null (not fabricated)'} ·
            Focal Depth=${eq.depthKm !== null ? `${eq.depthKm} km` : 'null (not fabricated)'}
          </div>
        </div>

        <div class="article-actions" style="margin-top:16px;">
          <a
            href="${eq.sourceUrl}"
            target="_blank"
            rel="noopener noreferrer"
            class="ext-link-btn"
          >
            ${
              isHi
                ? 'आधिकारिक NCS भूकंप पोर्टल खोलें (seismo.gov.in) ↗'
                : 'Open Official NCS Earthquake Dashboard (seismo.gov.in) ↗'
            }
          </a>
        </div>
      </div>
    </section>
  `;
}

export function renderSourcesLedgerPage(lang: LanguageCode): string {
  const isHi = lang === 'hi';
  return `
    <section class="newspaper-section" style="margin-top:16px; border-top:none; padding-top:0;">
      <div class="section-header-row">
        <div>
          <h1 class="section-title">${
            isHi
              ? 'स्रोत एवं अधिकार खाता-बही (Source & Rights Ledger)'
              : 'Source Allowlist, Editorial Policy & Rights Ledger'
          }</h1>
          <p class="section-subtitle">
            ${
              isHi
                ? 'आधिकारिक स्थिति स्वतः पुनर्प्रकाशन अनुमति नहीं है; RSS उपलब्धता लाइसेंस नहीं है। अनुमति सिद्ध होने तक केवल लिंक-आउट (linkOnly)।'
                : 'Official status is not automatic republication permission; RSS availability is not a licence. Defaulting to linkOnly until written permission is verified.'
            }
          </p>
        </div>
      </div>

      <div class="table-scroll-wrap">
        <table class="netra-table">
          <thead>
            <tr>
              <th>${isHi ? 'स्रोत आईडी एवं प्रकाशक' : 'Source ID & Publisher'}</th>
              <th>${isHi ? 'कैननिकल HTTPS होस्ट' : 'Canonical HTTPS Host'}</th>
              <th>${isHi ? 'कवरेज एवं अंतराल' : 'Coverage & Cadence'}</th>
              <th>${isHi ? 'अधिकार स्थिति (Rights Status)' : 'Rights Status & Permission'}</th>
              <th>${isHi ? 'लाइसेंस नोट्स एवं शर्तें' : 'Licence Notes & Terms'}</th>
            </tr>
          </thead>
          <tbody>
            ${SOURCE_ALLOWLIST_LEDGER.map(
              (entry) => `
                <tr>
                  <td>
                    <strong>${isHi ? entry.publisherHi : entry.publisher}</strong>
                    <div style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-muted);">${entry.id}</div>
                  </td>
                  <td style="font-family:var(--font-mono); font-size:0.8rem;">
                    <div>https://${entry.canonicalHost}</div>
                    <a href="${entry.termsUrl}" target="_blank" rel="noopener noreferrer" style="font-size:0.76rem;">
                      ${isHi ? 'शर्तें देखें ↗' : 'Terms Policy ↗'}
                    </a>
                  </td>
                  <td>
                    <div>${entry.coverage.join(', ').toUpperCase()}</div>
                    <div style="color:var(--text-muted); font-size:0.78rem;">Every ${entry.updateCadenceMinutes} min</div>
                  </td>
                  <td>
                    <strong>${entry.rightsStatus}</strong>
                    <div style="font-size:0.78rem; color:${
                      entry.enabledInStage1 ? 'var(--amber-400)' : 'var(--status-danger)'
                    };">
                      ${
                        entry.enabledInStage1
                          ? isHi
                            ? 'चरण 1 में लिंक-ओनली सक्रिय'
                            : 'Enabled (Link-Only Stage 1)'
                          : isHi
                            ? 'अवरुद्ध (लिखित अनुमति लंबित)'
                            : 'Blocked (Written Reply Unverified)'
                      }
                    </div>
                  </td>
                  <td style="font-size:0.82rem; color:var(--text-secondary);">
                    ${entry.licenceNotes}
                  </td>
                </tr>
              `
            ).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function renderCorrectionsPage(
  lang: LanguageCode,
  articles: ArticleRecord[],
  drafts: CorrectionDraft[]
): string {
  const isHi = lang === 'hi';
  const itemsWithCorrections = articles.filter((a) => a.corrections.length > 0);

  return `
    <section class="newspaper-section" style="margin-top:16px; border-top:none; padding-top:0;">
      <div class="section-header-row">
        <div>
          <h1 class="section-title">${
            isHi ? 'संशोधन नीति एवं पारदर्शी लॉग (Corrections & Updates)' : 'Corrections Policy & Transparent Log'
          }</h1>
          <p class="section-subtitle">
            ${
              isHi
                ? 'प्रत्येक संशोधन समय (correctedAt) और कारण (reason) के साथ स्थायी रूप से दृश्यमान रहता है।'
                : 'Corrections remain permanently visible with correctedAt timestamp and reason.'
            }
          </p>
        </div>
      </div>

      <div class="state-banner" style="margin-top:16px;">
        <h2 style="margin:0 0 8px; font-size:1.15rem; font-family:var(--font-serif);">
          ${isHi ? 'प्रकाशित संशोधन इतिहास (Published Correction Log)' : 'Published Correction Log'}
        </h2>
        ${
          itemsWithCorrections.length === 0
            ? `<p style="margin:0; color:var(--text-muted);">
                ${
                  isHi
                    ? 'वर्तमान फ़ीड मोड में कोई प्रकाशित संशोधन प्रविष्टि नहीं है।'
                    : 'No published correction entries in the currently active feed mode.'
                }
              </p>`
            : itemsWithCorrections
                .map(
                  (art) => `
                  <div style="padding:12px 0; border-top:1px solid var(--border-subtle);">
                    <div style="font-weight:700;">
                      <a href="/article/${art.id}" data-nav="/article/${art.id}">
                        ${isHi ? art.titleHi : art.title}
                      </a>
                    </div>
                    ${art.corrections
                      .map(
                        (c) => `
                        <div style="font-family:var(--font-mono); font-size:0.8rem; color:var(--amber-400); margin-top:4px;">
                          Corrected At: ${formatSourceTimestamp(c.correctedAt, lang)} — ${
                            isHi ? c.reasonHi || c.reason : c.reason
                          }
                        </div>
                      `
                      )
                      .join('')}
                  </div>
                `
                )
                .join('')
        }
      </div>

      <div class="state-banner" style="margin-top:20px;">
        <h2 style="margin:0 0 8px; font-size:1.15rem; font-family:var(--font-serif);">
          ${
            isHi
              ? 'डिवाइस पर सहेजे गए समस्या / सुधार ड्राफ्ट (On-Device Problem Reports)'
              : 'On-Device Saved Correction / Problem Report Packets'
          }
        </h2>
        <p style="margin:0 0 12px; font-size:0.86rem; color:var(--text-secondary);">
          ${
            isHi
              ? 'सार्वजनिक फॉर्म/रेटिंग के लिए स्वीकृत बैकएंड और दुरुपयोग-रोधी नीति आवश्यक है (चरण 4)। तब तक आपकी रिपोर्ट आपके डिवाइस पर सुरक्षित रूप से तैयार होती है।'
              : 'Public forms require an approved backend and abuse policy (Stage 4). Until then, problem reports are structured locally so you can copy and send them.'
          }
        </p>
        ${
          drafts.length === 0
            ? `<p style="margin:0; color:var(--text-muted); font-size:0.88rem;">
                ${
                  isHi
                    ? 'अभी तक कोई समस्या रिपोर्ट ड्राफ्ट नहीं बनाई गई है। किसी भी लेख कार्ड पर "समस्या रिपोर्ट करें" पर क्लिक करें।'
                    : 'No problem report drafts recorded yet. Open any article detail page to create one.'
                }
              </p>`
            : drafts
                .map(
                  (d) => `
                  <div style="padding:10px 0; border-top:1px solid var(--border-subtle); font-size:0.85rem;">
                    <strong>Article: ${d.articleTitle} (${d.articleId})</strong>
                    <div style="color:var(--text-secondary); margin-top:4px;">Reason: ${d.reason}</div>
                    <div style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
                      Created: ${d.createdAt}
                    </div>
                  </div>
                `
                )
                .join('')
        }
      </div>
    </section>
  `;
}

export function renderPrivacyAndPowerPage(
  lang: LanguageCode,
  powerInput: PowerStateInput,
  currentTier: PowerTier,
  circuitBreaker: CircuitBreakerState,
  logs: DiagnosticLogEntry[]
): string {
  const isHi = lang === 'hi';
  const activeBudget = POWER_BUDGET_TIERS.find((b) => b.tier === currentTier) ?? POWER_BUDGET_TIERS[0];
  const canUploadLogs = powerInput.isCharging && !powerInput.networkMetered;

  return `
    <section class="newspaper-section" style="margin-top:16px; border-top:none; padding-top:0;">
      <div class="section-header-row">
        <div>
          <h1 class="section-title">${
            isHi
              ? 'गोपनीयता, सुरक्षा एवं अल्ट्रा-लो पावर 24/7 गवर्नर (Privacy & Power Budget)'
              : 'Privacy, Security & Ultra-Low Power 24/7 Governor'
          }</h1>
          <p class="section-subtitle">
            ${
              isHi
                ? 'शून्य कच्चा GPS संग्रहण · शून्य IP प्रोफाइलिंग · डिफ़ॉल्ट रूप से कोई एनालिटिक्स नहीं · अनुकूली बैटरी टियर'
                : 'Zero raw GPS storage · Zero IP profiling · No analytics by default · Adaptive Battery Tiers with Hysteresis'
            }
          </p>
        </div>
      </div>

      <div class="state-banner" style="margin-top:16px;">
        <div class="article-kicker-meta">
          <strong>ACTIVE POWER TIER: ${currentTier.toUpperCase()}</strong>
          <span aria-hidden="true"> · </span>
          <span>Battery: ${powerInput.batteryPct}% (${powerInput.isCharging ? 'Charging' : 'Discharging'})</span>
          <span aria-hidden="true"> · </span>
          <span>Thermal: ${powerInput.thermalStatus.toUpperCase()}</span>
          <span aria-hidden="true"> · </span>
          <span>Max Wakeups: ${activeBudget.maxWakeupsPerHour}/h · Max Network: ${activeBudget.maxNetworkCallsPerHour}/h</span>
        </div>

        <h2 style="margin:10px 0 8px; font-size:1.15rem; font-family:var(--font-serif);">
          ${
            isHi
              ? 'अनुकूली पावर टियर सिम्युलेटर (100%, 25%, 12%, 4% और थर्मल थ्रॉटलिंग परीक्षण)'
              : 'Adaptive Power Tier Verification Harness (Test 100%, 25%, 12%, 4% & Thermal Drop)'
          }
        </h2>
        <p style="margin:0 0 12px; font-size:0.86rem; color:var(--text-secondary);">
          ${
            isHi
              ? 'बैटरी प्रतिशत या थर्मल स्थिति बदलकर जांचें कि ऐप कैसे गैर-आवश्यक सिंक, एनिमेशन और 3D कियोस्क को तुरंत रोकता है और हिस्टैरिसीस (+3%) लागू करता है।'
              : 'Simulate battery levels, Battery Saver, and thermal throttling to verify immediate tier drops, +3% hysteresis anti-flapping, and Survival mode restrictions.'
          }
        </p>

        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
          <button type="button" class="power-preset-btn ${
            powerInput.batteryPct === 100 ? 'btn-amber' : ''
          }" data-battery="100" data-charging="true" data-thermal="nominal">
            100% Charging (Normal)
          </button>
          <button type="button" class="power-preset-btn ${
            powerInput.batteryPct === 24 && !powerInput.isCharging ? 'btn-amber' : ''
          }" data-battery="24" data-charging="false" data-thermal="nominal">
            24% Discharging (Saver)
          </button>
          <button type="button" class="power-preset-btn ${
            powerInput.batteryPct === 12 && !powerInput.isCharging ? 'btn-amber' : ''
          }" data-battery="12" data-charging="false" data-thermal="nominal">
            12% Battery (Critical Tier-0 Only)
          </button>
          <button type="button" class="power-preset-btn ${
            powerInput.batteryPct === 4 && !powerInput.isCharging ? 'btn-amber' : ''
          }" data-battery="4" data-charging="false" data-thermal="nominal">
            4% Battery (Survival &lt;5% — No Sensors/Animations)
          </button>
          <button type="button" class="power-preset-btn ${
            powerInput.thermalStatus === 'moderate' ? 'btn-amber' : ''
          }" data-battery="${powerInput.batteryPct}" data-charging="${powerInput.isCharging}" data-thermal="moderate">
            Thermal Throttling (Drop 1 Tier Immediately)
          </button>
        </div>

        <div class="table-scroll-wrap">
          <table class="netra-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Entry Condition & Hysteresis (+3%)</th>
                <th>Idle Drain Target (24h)</th>
                <th>Max Wakeups / Network</th>
                <th>Allowed Capabilities</th>
              </tr>
            </thead>
            <tbody>
              ${POWER_BUDGET_TIERS.map(
                (b) => `
                  <tr style="${
                    b.tier === currentTier ? 'background-color:rgba(251, 191, 36, 0.12);' : ''
                  }">
                    <td><strong>${b.tier}</strong> ${b.tier === currentTier ? '← ACTIVE' : ''}</td>
                    <td>${isHi ? b.conditionSummaryHi : b.conditionSummaryEn}</td>
                    <td>&lt;= ${b.idleDrainTargetPct24h}% / 24h</td>
                    <td>${b.maxWakeupsPerHour} wakeups/h · ${b.maxNetworkCallsPerHour} calls/h</td>
                    <td>
                      Tier-0 News/City: YES ·
                      Animations: ${b.allowAnimations ? 'YES' : 'OFF'} ·
                      Spatial 3D: ${b.allowSpatial3D ? 'YES' : 'SUSPENDED'}
                    </td>
                  </tr>
                `
              ).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="state-banner" style="margin-top:20px;">
        <h2 style="margin:0 0 8px; font-size:1.15rem; font-family:var(--font-serif);">
          ${
            isHi
              ? 'सेल्फ-हीलिंग सर्किट ब्रेकर एवं बाउंडेड लोकल लॉग (Self-Healing Without Drain)'
              : 'Self-Healing Circuit Breaker & Bounded Rotated Local Log'
          }
        </h2>
        <p style="margin:0 0 12px; font-size:0.86rem; color:var(--text-secondary);">
          ${
            isHi
              ? 'केवल प्राकृतिक वेक पॉइंट्स पर स्वास्थ्य जांच। एक्सपोनेंशियल बैकऑफ़ + जिटर, अधिकतम 4 रिट्राई कैप, और सर्किट ब्रेकर जो अगली निर्धारित विंडो तक रिकवरी रोकता है।'
              : 'Health checks run only at natural wake points. Exponential backoff + jitter, hard retry cap (4), and a circuit breaker that defers recovery to the next scheduled window.'
          }
        </p>
        <div style="font-family:var(--font-mono); font-size:0.82rem; margin-bottom:12px;">
          Circuit Status: <strong>${circuitBreaker.status}</strong> ·
          Consecutive Failures: ${circuitBreaker.consecutiveFailures} / 4 ·
          Next Window: ${circuitBreaker.nextScheduledWindowAt ?? 'Immediate (Healthy)'} ·
          Log Upload Gate: ${
            canUploadLogs
              ? 'PERMITTED (Charging + Unmetered)'
              : 'BLOCKED (Requires Charging + Unmetered Network)'
          }
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:8px;">
          <button type="button" id="sim-feed-failure-backoff-btn">
            ${isHi ? '[TEST] फ़ीड विफलता एवं बैकऑफ़ ट्रिगर करें' : '[TEST] Simulate Feed Failure (Advance Backoff / Circuit Breaker)'}
          </button>
          <button type="button" id="reset-circuit-breaker-btn" class="btn-quiet">
            ${isHi ? 'सर्किट ब्रेकर रीसेट करें' : 'Reset Circuit Breaker'}
          </button>
        </div>

        <div style="margin-top:14px; max-height:160px; overflow-y:auto; border:1px solid var(--border-subtle); border-radius:6px; padding:10px; font-family:var(--font-mono); font-size:0.76rem; background:var(--navy-950);">
          ${
            logs.length === 0
              ? 'Bounded rotated log (max 50 entries, 0 PII/coordinates): Ready.'
              : logs
                  .map((l) => `<div>[${l.timestamp}] [${l.tier}] ${l.event}: ${l.detail}</div>`)
                  .join('')
          }
        </div>
      </div>
    </section>
  `;
}

export function renderAboutAndHandoffPage(
  lang: LanguageCode,
  powerTier: PowerTier,
  spatialKioskExpanded: boolean
): string {
  const isHi = lang === 'hi';
  const spatialAllowed = powerTier === 'Normal';

  return `
    <section class="newspaper-section" style="margin-top:16px; border-top:none; padding-top:0;">
      <div class="section-header-row">
        <div>
          <h1 class="section-title">${
            isHi
              ? 'नेत्र न्यूज़ के बारे में, फ़ीचर मैट्रिक्स एवं बिल्डर हैंडऑफ़ पैकेट'
              : 'About NETRA NEWS, Feature Matrix & Builder Handoff Packet'
          }</h1>
          <p class="section-subtitle">
            ${
              isHi
                ? 'चरण 1 कार्यान्वयन, ओपन डिसीजन, पावर बजट गेट और स्पेशल XR न्यूज़रूम प्रीव्यू'
                : 'Stage 1 implementation contract, assumptions & open decisions, feature gate, and Spatial XR Newsroom preview'
            }
          </p>
        </div>
      </div>

      <div class="state-banner" style="margin-top:16px;">
        <h2 style="margin:0 0 8px; font-size:1.18rem; font-family:var(--font-serif);">
          ${
            isHi
              ? 'स्पेशल 3D / WebXR न्यूज़रूम कियोस्क (XR Blocks + Three.js)'
              : 'Spatial 3D / WebXR Newsroom Kiosk (XR Blocks + Three.js)'
          }
        </h2>
        <p style="margin:0 0 12px; font-size:0.86rem; color:var(--text-secondary);">
          The XR app is best viewed in an Android XR device like Galaxy XR or XREAL AURA. On desktop, we provide you a simulated environment for previewing the app.
        </p>
        ${
          !spatialAllowed
            ? `<div style="color:var(--amber-400); font-size:0.88rem; font-weight:600;">
                ${
                  isHi
                    ? `पावर गवर्नर द्वारा निलंबित: वर्तमान पावर टियर "${powerTier}" है। बैटरी बचाने के लिए 3D / WebXR कियोस्क केवल "Normal" टियर (>30% या चार्जिंग) में सक्रिय होता है।`
                    : `Suspended by Power Governor: Current Power Tier is "${powerTier}". To guarantee minimum battery consumption, 3D / WebXR rendering is strictly gated to the "Normal" tier (>30% or charging).`
                }
              </div>`
            : `<div style="display:flex; flex-wrap:wrap; gap:10px;">
                <button type="button" id="toggle-3d-kiosk-btn" class="btn-amber">
                  ${
                    spatialKioskExpanded
                      ? isHi
                        ? '3D कियोस्क प्रीव्यू बंद करें (Hide 3D Kiosk)'
                        : 'Hide 3D Newsroom Kiosk Preview'
                      : isHi
                        ? '3D न्यूज़रूम कियोस्क प्रीव्यू खोलें (Inspect 3D Kiosk)'
                        : 'Open 3D Newsroom Kiosk Preview'
                  }
                </button>
                <button type="button" id="launch-webxr-session-btn">
                  ${isHi ? 'WebXR सिम्युलेटर लॉन्च करें (Enter XR Blocks Mode)' : 'Launch Full XR Blocks Simulator'}
                </button>
              </div>
              ${
                spatialKioskExpanded
                  ? `<div>
                      <div id="embedded-3d-viewport" class="spatial-viewport-box" data-testid="spatial-3d-viewport"></div>
                      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;">
                        <button type="button" class="kiosk-cam-btn" data-cam="front">Front View</button>
                        <button type="button" class="kiosk-cam-btn" data-cam="side">Side Angle</button>
                        <button type="button" class="kiosk-cam-btn" data-cam="top">Top Meridian View</button>
                        <button type="button" id="kiosk-rotate-globe-btn" class="btn-amber">Rotate Globe (+45°)</button>
                      </div>
                    </div>`
                  : ''
              }`
        }
      </div>

      <div style="margin-top:28px;">
        <h2 class="section-title" style="font-size:1.3rem;">
          ${
            isHi
              ? 'फ़ीचर मैट्रिक्स एवं पावर गेट (Required / Implemented / Tested / Blocked)'
              : 'Feature Matrix & Power Gate (Required / Implemented / Tested / Blocked)'
          }
        </h2>
        <div class="table-scroll-wrap">
          <table class="netra-table">
            <thead>
              <tr>
                <th>Feature & Stage</th>
                <th>Power Tier & Cost (Wakeups / Network / mAh)</th>
                <th>Required</th>
                <th>Implemented</th>
                <th>Tested</th>
                <th>Blocked / Status</th>
              </tr>
            </thead>
            <tbody>
              ${FEATURE_MATRIX_ROWS.map(
                (row) => `
                  <tr>
                    <td>
                      <strong>${isHi ? row.featureHi : row.featureEn}</strong>
                      <div style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-muted);">${row.stage}</div>
                    </td>
                    <td style="font-size:0.8rem;">
                      <div>Min Tier: <strong>${row.powerTierMin}</strong></div>
                      <div>${row.wakeupCostPerHour} · ${row.networkCostPerHour}</div>
                      <div style="color:var(--text-muted);">${row.batteryImpactMah}</div>
                    </td>
                    <td>${row.required ? 'YES' : 'Optional'}</td>
                    <td style="color:${row.implemented ? 'var(--status-ok)' : 'var(--text-muted)'}; font-weight:700;">
                      ${row.implemented ? 'YES (Stage 1)' : 'PLANNED'}
                    </td>
                    <td style="color:${row.tested ? 'var(--status-ok)' : 'var(--text-muted)'}; font-weight:700;">
                      ${row.tested ? 'YES' : 'Pending Stage'}
                    </td>
                    <td style="font-size:0.8rem; color:${
                      row.blockedReason ? 'var(--amber-400)' : 'var(--status-ok)'
                    };">
                      ${row.blockedReason ?? 'Active & Verified in Stage 1'}
                    </td>
                  </tr>
                `
              ).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div style="margin-top:32px;">
        <h2 class="section-title" style="font-size:1.3rem;">
          ${
            isHi
              ? 'मान्यताएं एवं अनसुलझे निर्णय (Assumptions & Open Decisions — Spec §8.4)'
              : 'Assumptions & Unresolved Owner Decisions (Specification §8.4)'
          }
        </h2>
        <div class="table-scroll-wrap">
          <table class="netra-table">
            <thead>
              <tr>
                <th>Decision Area</th>
                <th>Unresolved Question for Owner</th>
                <th>Stage 1 Safe Default / Assumption</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${OPEN_DECISIONS_LIST.map(
                (item) => `
                  <tr>
                    <td><strong>${item.category}</strong></td>
                    <td>${isHi ? item.questionHi : item.questionEn}</td>
                    <td style="color:var(--text-secondary);">${item.currentAssumption}</td>
                    <td><strong>${item.status}</strong></td>
                  </tr>
                `
              ).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}
