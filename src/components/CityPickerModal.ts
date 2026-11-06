import {
  CITY_DATASET_METADATA,
  COUNTRIES_LIST,
  PACKAGED_CITIES,
  STATES_LIST,
} from '../data/citiesDataset';
import { CityEntry, LanguageCode, LocationPreference, PowerTier } from '../domain/types';
import { resolveCityFromTransientCoords } from '../domain/validation';

export interface CityModalState {
  isOpen: boolean;
  selectedCountry: string;
  selectedState: string;
  selectedCityId: string;
  geoStatusMessage: string | null;
  geoStatusType: 'info' | 'warning' | 'error' | null;
  ambiguousCandidates: CityEntry[];
}

export function renderCityPickerModal(
  modalState: CityModalState,
  currentPref: LocationPreference,
  lang: LanguageCode,
  powerTier: PowerTier
): string {
  if (!modalState.isOpen) return '';

  const isHi = lang === 'hi';
  const filteredCities = PACKAGED_CITIES.filter((c) => c.stateCode === modalState.selectedState);
  const approxDisabled = powerTier === 'Survival';

  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="city-modal-title">
      <div class="modal-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:16px;">
          <div>
            <h2 id="city-modal-title" style="margin:0; font-family:var(--font-serif); font-size:1.4rem;">
              ${isHi ? 'स्थान एवं शहर चयन (Country > State > City)' : 'Select City & Region (Country > State > City)'}
            </h2>
            <p style="margin:4px 0 0; font-size:0.85rem; color:var(--text-muted);">
              ${
                isHi
                  ? 'मैनुअल चयन हमेशा कार्य करता है और डिफ़ॉल्ट सुरक्षित पथ है। कोई कच्चा GPS निर्देशांक कभी सहेजा नहीं जाता।'
                  : 'Manual selection always works and is the default safe path. Raw GPS coordinates are never stored.'
              }
            </p>
          </div>
          <button type="button" id="close-city-modal-btn" aria-label="${isHi ? 'शहर चयन बंद करें' : 'Close city selector'}">
            ✕
          </button>
        </div>

        <form id="manual-city-form">
          <div class="form-field-group">
            <label for="select-country">${isHi ? '1. देश (Country)' : '1. Country'}</label>
            <select id="select-country" name="countryCode">
              ${COUNTRIES_LIST.map(
                (c) =>
                  `<option value="${c.countryCode}" ${
                    c.countryCode === modalState.selectedCountry ? 'selected' : ''
                  }>${isHi ? c.nameHi : c.nameEn}</option>`
              ).join('')}
            </select>
          </div>

          <div class="form-field-group">
            <label for="select-state">${isHi ? '2. राज्य / केंद्र शासित प्रदेश (State)' : '2. State / UT'}</label>
            <select id="select-state" name="stateCode">
              ${STATES_LIST.map(
                (s) =>
                  `<option value="${s.stateCode}" ${
                    s.stateCode === modalState.selectedState ? 'selected' : ''
                  }>${isHi ? `${s.nameHi} (${s.stateCode})` : `${s.nameEn} (${s.stateCode})`}</option>`
              ).join('')}
            </select>
          </div>

          <div class="form-field-group">
            <label for="select-city">${isHi ? '3. शहर / जनपद (City)' : '3. City / District'}</label>
            <select id="select-city" name="cityId">
              ${filteredCities
                .map(
                  (city) =>
                    `<option value="${city.cityId}" ${
                      city.cityId === modalState.selectedCityId ? 'selected' : ''
                    }>${isHi ? `${city.nameHi} (${city.nameEn})` : `${city.nameEn} (${city.nameHi})`}</option>`
                )
                .join('')}
            </select>
          </div>

          <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:16px;">
            <button type="submit" class="btn-amber" id="save-manual-city-btn">
              ${isHi ? 'मैनुअल शहर सहेजें (Save Manual City)' : 'Save Manual City Preference'}
            </button>
            <button type="button" id="cancel-city-modal-btn" class="btn-quiet">
              ${isHi ? 'रद्द करें (Cancel)' : 'Cancel'}
            </button>
          </div>
        </form>

        <div style="margin-top:24px; padding-top:20px; border-top:1px solid var(--border-subtle);">
          <h3 style="margin:0 0 6px; font-size:1rem;">
            ${isHi ? 'वैकल्पिक: अनुमानित स्थान (Opt-in Approximate Location)' : 'Optional: Use Approximate Location'}
          </h3>
          <p style="margin:0 0 12px; font-size:0.84rem; color:var(--text-secondary);">
            ${
              isHi
                ? 'केवल स्पष्ट क्लिक के बाद ब्राउज़र जियोलोकेशन का उपयोग करता है, स्थानीय डेटासेट से निकटतम शहर तय करता है, और कच्चे निर्देशांक तुरंत हटा देता है।'
                : 'Calls browser geolocation only after explicit action, resolves a city from the local dataset, and immediately discards raw coordinates.'
            }
          </p>

          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            <button
              type="button"
              id="use-approx-location-btn"
              ${approxDisabled ? 'disabled aria-disabled="true"' : ''}
            >
              ${
                approxDisabled
                  ? isHi
                    ? 'अनुमानित स्थान (Survival टियर में सेंसर बंद)'
                    : 'Use approximate location (Disabled in Survival Tier)'
                  : isHi
                    ? 'अनुमानित स्थान का उपयोग करें (Use approximate location)'
                    : 'Use approximate location'
              }
            </button>
            <button
              type="button"
              id="sim-ambiguous-geo-btn"
              class="btn-quiet"
              ${approxDisabled ? 'disabled aria-disabled="true"' : ''}
            >
              ${isHi ? '[TEST] द्विअर्थी NCR स्थान जांचें' : '[TEST] Simulate Ambiguous NCR Coords'}
            </button>
            <button
              type="button"
              id="sim-denied-geo-btn"
              class="btn-quiet"
            >
              ${isHi ? '[TEST] अनुमति अस्वीकृति जांचें' : '[TEST] Simulate Permission Denied'}
            </button>
          </div>

          ${
            modalState.geoStatusMessage
              ? `<div class="state-banner" data-state="${
                  modalState.geoStatusType === 'error'
                    ? 'unavailable'
                    : modalState.geoStatusType === 'warning'
                      ? 'stale'
                      : 'all_clear'
                }" style="margin-top:12px; padding:12px;">
                  <div style="font-weight:600; font-size:0.88rem;">${modalState.geoStatusMessage}</div>
                  ${
                    modalState.ambiguousCandidates.length > 1
                      ? `<div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px;">
                          ${modalState.ambiguousCandidates
                            .map(
                              (cand) =>
                                `<button type="button" class="btn-amber resolve-ambiguous-city-btn" data-city-id="${cand.cityId}">
                                  ${isHi ? `${cand.nameHi} चुनें` : `Confirm ${cand.nameEn}`}
                                </button>`
                            )
                            .join('')}
                        </div>`
                      : ''
                  }
                </div>`
              : ''
          }
        </div>

        <div style="margin-top:18px; padding-top:12px; border-top:1px solid var(--border-subtle); font-family:var(--font-mono); font-size:0.75rem; color:var(--text-muted);">
          <div>Current Saved Mode: ${currentPref.selectionMode} · City ID: ${currentPref.cityId} · Updated: ${currentPref.updatedAt}</div>
          <div>Packaged Dataset: ${CITY_DATASET_METADATA.datasetId} v${CITY_DATASET_METADATA.version} (${CITY_DATASET_METADATA.licence})</div>
        </div>
      </div>
    </div>
  `;
}

export function runBrowserApproximateLocation(
  onResult: (res: {
    ok: boolean;
    message: string;
    type: 'info' | 'warning' | 'error';
    candidates: CityEntry[];
    pref: LocationPreference | null;
  }) => void,
  lang: LanguageCode
): void {
  const isHi = lang === 'hi';
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onResult({
      ok: false,
      type: 'error',
      candidates: [],
      pref: null,
      message: isHi
        ? 'ब्राउज़र जियोलोकेशन उपलब्ध नहीं है। समाचार अवरुद्ध नहीं हैं — कृपया ऊपर मैनुअल शहर पिकर का उपयोग करें।'
        : 'Browser geolocation is unavailable. News is not blocked — please use the manual Country > State > City picker above.',
    });
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      // Immediately resolve nearest city in memory and discard raw pos.coords
      const resolution = resolveCityFromTransientCoords(
        pos.coords.latitude,
        pos.coords.longitude,
        PACKAGED_CITIES,
        new Date().toISOString()
      );
      if (!resolution.resolved || !resolution.preferenceRecord) {
        onResult({
          ok: false,
          type: 'warning',
          candidates: [],
          pref: null,
          message: isHi
            ? 'अनुमानित निर्देशांक किसी पैकेज्ड शहर से मेल नहीं खाते (कच्चे निर्देशांक हटा दिए गए)। कृपया मैनुअल रूप से शहर चुनें।'
            : 'Approximate location did not match a packaged city within range (raw coordinates discarded). Please select a city manually.',
        });
        return;
      }

      if (resolution.isAmbiguous) {
        onResult({
          ok: true,
          type: 'warning',
          candidates: resolution.ambiguousCandidates,
          pref: resolution.preferenceRecord,
          message: isHi
            ? `निकटतम शहर अस्पष्टता: ${resolution.ambiguousCandidates
                .map((c) => c.nameHi)
                .join(' / ')} दोनों 35 किमी के भीतर हैं। कच्चे निर्देशांक हटा दिए गए हैं — कृपया नीचे पुष्टि करें:`
            : `Nearest-city ambiguity detected: ${resolution.ambiguousCandidates
                .map((c) => c.nameEn)
                .join(' / ')} are within 35 km. Raw coordinates discarded — please confirm your city below:`,
        });
      } else {
        onResult({
          ok: true,
          type: 'info',
          candidates: [resolution.resolved],
          pref: resolution.preferenceRecord,
          message: isHi
            ? `अनुमानित शहर सेट किया गया: ${resolution.resolved.nameHi} (कच्चे निर्देशांक तुरंत हटा दिए गए)।`
            : `Approximate city resolved: ${resolution.resolved.nameEn} (raw coordinates immediately discarded).`,
        });
      }
    },
    (err) => {
      const codeInfo = err?.code === 1 ? 'PERMISSION_DENIED' : 'POSITION_UNAVAILABLE';
      onResult({
        ok: false,
        type: 'error',
        candidates: [],
        pref: null,
        message: isHi
          ? `स्थान अनुमति अस्वीकृत या अनुपलब्ध (${codeInfo})। समाचार अवरुद्ध नहीं हैं — मैनुअल चयन सक्रिय है।`
          : `Location permission denied or unavailable (${codeInfo}). News is never blocked on denial — manual city selection remains active.`,
      });
    },
    {
      enableHighAccuracy: false,
      timeout: 6000,
      maximumAge: 600000,
    }
  );
}
