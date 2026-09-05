'use strict';

// Canonical VFM guest destinations. LINKS + DEALS in public/map.html use these
// same URLs. The Natively iOS/Android app is not in this repo; native-only
// buttons must be updated in the Natively builder if they hardcode links.

const VFM_VENDOR_PORTAL_URL = 'https://vfm.buzzonmarketing.com/vendors';
const VFM_APP_DOWNLOAD_URL = 'https://visitfirstmonday.com/app-download';
const VFM_APP_STORE_URL = 'https://apps.apple.com/us/app/visit-first-monday/id6746057595';
const VFM_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.TnCzkYTWJRzX.natively';
const VFM_PLAY_STORE_ID = 'com.TnCzkYTWJRzX.natively';
const VFM_APP_STORE_ID = '6746057595';

function hostnameOf(host) {
  return String(host || '').split(':')[0].toLowerCase();
}

function isVisitFirstMondayHost(host) {
  const h = hostnameOf(host).replace(/^www\./, '');
  return h === 'visitfirstmonday.com';
}

module.exports = {
  hostnameOf,
  isVisitFirstMondayHost,
  VFM_VENDOR_PORTAL_URL,
  VFM_APP_DOWNLOAD_URL,
  VFM_APP_STORE_URL,
  VFM_PLAY_STORE_URL,
  VFM_PLAY_STORE_ID,
  VFM_APP_STORE_ID
};
