import { firebaseFunctions } from './firebase-config.js?v=20261013-4';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-functions.js';

export const privacyNoticeVersion = '2026-10-13-v4';

const recordVisit = httpsCallable(firebaseFunctions, 'recordVisit', { timeout: 20000 });

export async function recordUserSession() {
  const result = await recordVisit({
    consentAccepted: true,
    privacyNoticeVersion
  });
  return result.data;
}
