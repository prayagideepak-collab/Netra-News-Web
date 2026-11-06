import { SourceLedgerEntry } from '../domain/types';

/**
 * Source & Licence Ledger (Stage 1).
 * Official status is NOT automatic republication permission; RSS availability is NOT a licence.
 * Until written republication permission is verified, allowlisted public portals default to
 * `rightsStatus: 'linkOnly'` (neutral link label + canonical HTTPS source link, no scraped prose or photos).
 */
export const SOURCE_ALLOWLIST_LEDGER: SourceLedgerEntry[] = [
  {
    id: 'pib-india',
    publisher: 'Press Information Bureau (PIB India)',
    publisherHi: 'पत्र सूचना कार्यालय (PIB भारत सरकार)',
    canonicalHost: 'pib.gov.in',
    feedUrl: 'https://pib.gov.in/RssMain.aspx',
    coverage: ['local', 'state', 'national'],
    updateCadenceMinutes: 30,
    termsUrl: 'https://pib.gov.in/newsite/copyright.aspx',
    licenceNotes:
      'Government of India public releases. Configured as strict linkOnly in Stage 1 until automated feed terms and attribution format are signed off by owner.',
    rightsStatus: 'linkOnly',
    permissionVerified: false,
    enabledInStage1: true,
  },
  {
    id: 'imd-mausam',
    publisher: 'India Meteorological Department (IMD)',
    publisherHi: 'भारत मौसम विज्ञान विभाग (IMD)',
    canonicalHost: 'mausam.imd.gov.in',
    feedUrl: 'https://mausam.imd.gov.in/imd_latest/contents/all_india_forcast_bulletin.php',
    coverage: ['local', 'state', 'national'],
    updateCadenceMinutes: 60,
    termsUrl: 'https://mausam.imd.gov.in/imd_latest/contents/disclaimer.php',
    licenceNotes:
      'Official meteorological bulletins. Used in linkOnly mode with explicit disclaimer that NETRA NEWS is not an emergency early-warning system.',
    rightsStatus: 'linkOnly',
    permissionVerified: false,
    enabledInStage1: true,
  },
  {
    id: 'ncs-seismo',
    publisher: 'National Center for Seismology (NCS)',
    publisherHi: 'राष्ट्रीय भूकंप विज्ञान केंद्र (NCS)',
    canonicalHost: 'seismo.gov.in',
    feedUrl: 'https://seismo.gov.in/MIS/ris/earthquake',
    coverage: ['state', 'national'],
    updateCadenceMinutes: 30,
    termsUrl: 'https://seismo.gov.in/website-policies',
    licenceNotes:
      'Official seismic event parameters. Link-out listing only; raw scraping prohibited.',
    rightsStatus: 'linkOnly',
    permissionVerified: false,
    enabledInStage1: true,
  },
  {
    id: 'ndma-india',
    publisher: 'National Disaster Management Authority (NDMA)',
    publisherHi: 'राष्ट्रीय आपदा प्रबंधन प्राधिकरण (NDMA)',
    canonicalHost: 'ndma.gov.in',
    feedUrl: 'https://ndma.gov.in/',
    coverage: ['state', 'national'],
    updateCadenceMinutes: 60,
    termsUrl: 'https://ndma.gov.in/Terms-of-Use',
    licenceNotes:
      'Public preparedness advisories. LinkOnly attribution enforced.',
    rightsStatus: 'linkOnly',
    permissionVerified: false,
    enabledInStage1: true,
  },
  {
    id: 'up-info-dept',
    publisher: 'Information & Public Relations Dept, Uttar Pradesh',
    publisherHi: 'सूचना एवं जनसंपर्क विभाग, उत्तर प्रदेश',
    canonicalHost: 'information.up.gov.in',
    feedUrl: 'https://information.up.gov.in/',
    coverage: ['local', 'state'],
    updateCadenceMinutes: 60,
    termsUrl: 'https://information.up.gov.in/',
    licenceNotes:
      'State district press notes. Enabled as neutral linkOnly reference in Stage 1.',
    rightsStatus: 'linkOnly',
    permissionVerified: false,
    enabledInStage1: true,
  },
  {
    id: 'dd-news-pending',
    publisher: 'DD News (Prasar Bharati)',
    publisherHi: 'डीडी न्यूज़ (प्रसार भारती)',
    canonicalHost: 'ddnews.gov.in',
    feedUrl: 'https://ddnews.gov.in/rss',
    coverage: ['state', 'national'],
    updateCadenceMinutes: 30,
    termsUrl: 'https://ddnews.gov.in/terms-use',
    licenceNotes:
      'Publisher permission request recorded earlier; current reply and syndicate rights NOT verified. Blocked from automatic text ingestion until written reply is archived.',
    rightsStatus: 'blocked',
    permissionVerified: false,
    enabledInStage1: false,
  },
  {
    id: 'regional-print-pending',
    publisher: 'Regional Hindi Daily Syndicate (Permission Pending)',
    publisherHi: 'क्षेत्रीय हिन्दी दैनिक सिंडिकेट (अनुमति लंबित)',
    canonicalHost: 'example-publisher-pending.in',
    feedUrl: 'https://example-publisher-pending.in/feed',
    coverage: ['local', 'state'],
    updateCadenceMinutes: 60,
    termsUrl: 'https://example-publisher-pending.in/terms',
    licenceNotes:
      'Publisher permission request sent 4-5 Nov; reply unverified. Disabled by default per Rights Contract §5.',
    rightsStatus: 'blocked',
    permissionVerified: false,
    enabledInStage1: false,
  },
];
