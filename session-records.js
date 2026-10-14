import { firebaseFunctions } from './firebase-config.js?v=20261014-6';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-functions.js';

export const privacyNoticeVersion = '2026-10-14-v6';

const recordVisit = httpsCallable(firebaseFunctions, 'recordVisit', { timeout: 35000 });
const updateVisitDuration = httpsCallable(firebaseFunctions, 'updateVisitDuration', { timeout: 10000 });

async function requestJson(url) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`Network information service returned HTTP ${response.status}.`);
    return await response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function requestText(url) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json, text/plain' }
    });
    if (!response.ok) throw new Error(`Network information service returned HTTP ${response.status}.`);
    return await response.text();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function normalizeClientGeo(data, provider) {
  const value = provider === 'ipwho'
    ? {
      city: data.city,
      region: data.region,
      postalCode: data.postal,
      country: data.country,
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone?.id,
      isp: data.connection?.isp || data.connection?.org
    }
    : {
      city: data.city,
      region: data.region,
      postalCode: data.postal,
      country: data.country_name,
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone,
      isp: data.org
    };
  const text = (item) => typeof item === 'string' ? item.slice(0, 200) : '';
  return {
    city: text(value.city),
    region: text(value.region),
    postalCode: text(value.postalCode),
    country: text(value.country),
    latitude: Number.isFinite(value.latitude) ? value.latitude : null,
    longitude: Number.isFinite(value.longitude) ? value.longitude : null,
    timezone: text(value.timezone),
    isp: text(value.isp)
  };
}

async function getClientNetworkDetails() {
  let ip = '';
  let geo = null;

  try {
    const data = await requestJson('https://ipapi.co/json/');
    if (typeof data.ip === 'string') ip = data.ip;
    if (ip && data.error !== true) {
      geo = normalizeClientGeo(data, 'ipapi');
      if (!geo.city && !geo.country && !geo.isp) geo = null;
    }
  } catch {
    // Continue with the next public-IP provider.
  }

  if (!ip) {
    try {
      const data = await requestText('https://api.bigdatacloud.net/data/client-ip');
      const parsed = (() => {
        try {
          return JSON.parse(data);
        } catch {
          return { ipString: data.trim() };
        }
      })();
      ip = typeof parsed.ipString === 'string' ? parsed.ipString : '';
    } catch {
      // Continue with the final public-IP provider.
    }
  }

  if (!ip) {
    try {
      const data = await requestJson('https://api.ipify.org?format=json');
      ip = typeof data.ip === 'string' ? data.ip : '';
    } catch {
      // IP logging is optional; visit recording still proceeds without it.
    }
  }

  if (ip && !geo) {
    for (const provider of [
      {
        url: `https://ipwho.is/${encodeURIComponent(ip)}`,
        parse(data) {
          if (data.success === false) throw new Error('ipwho.is lookup failed.');
          return normalizeClientGeo(data, 'ipwho');
        }
      },
      {
        url: `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
        parse(data) {
          if (data.error === true) throw new Error('ipapi.co lookup failed.');
          return normalizeClientGeo(data, 'ipapi');
        }
      }
    ]) {
      try {
        geo = provider.parse(await requestJson(provider.url));
        if (geo.city || geo.country || geo.isp) break;
        geo = null;
      } catch {
        // Keep location optional and continue with the next provider.
      }
    }
  }

  return { ip, geo };
}

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
  let networkDetails = { ip: '', geo: null };
  try {
    networkDetails = await getClientNetworkDetails();
  } catch (error) {
    console.warn('Optional visitor network details are unavailable:', error);
  }
  const metadata = {
    photoURL: user?.photoURL || '',
    clientIp: networkDetails.ip,
    geoLocation: networkDetails.geo,
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

export async function updateSessionDuration(sessionId, durationToken, durationSeconds, active) {
  const result = await updateVisitDuration({
    sessionId,
    durationToken,
    durationSeconds,
    active,
    consentAccepted: true,
    privacyNoticeVersion
  });
  return result.data;
}
