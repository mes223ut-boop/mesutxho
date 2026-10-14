import { firebaseFunctions } from './firebase-config.js?v=20261014-5';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-functions.js';

export const privacyNoticeVersion = '2026-10-14-v5';

const recordVisit = httpsCallable(firebaseFunctions, 'recordVisit', { timeout: 20000 });
const updateVisitDuration = httpsCallable(firebaseFunctions, 'updateVisitDuration', { timeout: 10000 });

function getReferrer() {
  if (!document.referrer) return 'Direkt / bilinmiyor';
  try {
    const referrer = new URL(document.referrer);
    return `${referrer.origin}${referrer.pathname}`.slice(0, 500);
  } catch (error) {
    console.warn('Referrer URL could not be parsed:', error);
    return 'Bilinmiyor';
  }
}

async function getClientHints() {
  const userAgentData = navigator.userAgentData;
  if (!userAgentData) return {};
  try {
    const highEntropy = await userAgentData.getHighEntropyValues([
      'model',
      'platformVersion',
      'fullVersionList'
    ]);
    const browser = highEntropy.fullVersionList?.find((item) => (
      !/Not.A.Brand/i.test(item.brand)
    ));
    let platformVersion = highEntropy.platformVersion || '';
    if (userAgentData.platform === 'Windows') {
      const majorVersion = Number.parseInt(platformVersion, 10);
      if (Number.isFinite(majorVersion)) {
        platformVersion = majorVersion >= 13 ? '11' : majorVersion >= 10 ? '10' : platformVersion;
      }
    }
    return {
      deviceModel: highEntropy.model || '',
      platform: userAgentData.platform || '',
      platformVersion,
      browserName: browser?.brand || '',
      browserVersion: browser?.version || ''
    };
  } catch (error) {
    console.warn('High-entropy browser details are unavailable:', error);
    return {};
  }
}

export async function recordUserSession(user = null) {
  const metadata = {
    photoURL: user?.photoURL || '',
    screenResolution: `${screen.width}x${screen.height}`,
    viewportResolution: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    referrer: getReferrer(),
    pagePath: window.location.pathname,
    clientHints: await getClientHints()
  };
  const result = await recordVisit({
    consentAccepted: true,
    privacyNoticeVersion,
    metadata
  });
  return result.data;
}

export async function updateSessionDuration(sessionId, durationToken, durationSeconds) {
  const result = await updateVisitDuration({
    sessionId,
    durationToken,
    durationSeconds,
    consentAccepted: true,
    privacyNoticeVersion
  });
  return result.data;
}
