const crypto = require('node:crypto');
const net = require('node:net');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');

initializeApp();

const database = getFirestore();
const adminEmail = 'mes223ut@gmail.com';
const privacyNoticeVersion = '2026-10-14-v7';
const sessionRetentionDays = 90;

function getClientIp(request) {
  const ip = request.rawRequest.ip;
  return typeof ip === 'string' && net.isIP(ip) !== 0 ? ip : '';
}

function getIpDocumentId(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

function isAdmin(request) {
  const auth = request.auth;
  return Boolean(
    auth
    && auth.token.email === adminEmail
    && auth.token.email_verified === true
    && auth.token.firebase?.sign_in_provider === 'google.com'
  );
}

function requireAdmin(request) {
  if (!isAdmin(request)) {
    throw new HttpsError('permission-denied', 'Bu işlem yalnızca yetkili yöneticiye açıktır.');
  }
}

async function getAccessStatus(ip, uid) {
  if (ip) {
    const ipDocument = await database.collection('bannedIPs').doc(getIpDocumentId(ip)).get();
    if (ipDocument.exists && ipDocument.get('banned') === true) {
      return { allowed: false, reason: 'ip' };
    }
  }

  if (uid) {
    const userDocument = await database.collection('users').doc(uid).get();
    if (userDocument.exists && userDocument.get('banned') === true) {
      return { allowed: false, reason: 'user' };
    }
  }
  return { allowed: true, reason: null };
}

function getDeviceDetails(userAgent, clientHints = {}) {
  let deviceType = 'Desktop';
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobi)/i.test(userAgent)) {
    deviceType = 'Tablet';
  } else if (/Mobi|Android|iPhone|iPod|IEMobile|Windows Phone/i.test(userAgent)) {
    deviceType = 'Mobile';
  }

  let browser = 'Bilinmiyor';
  let browserVersion = '';
  const browserMatch = [
    ['Edge', /Edg\/([\d.]+)/i],
    ['Opera', /OPR\/([\d.]+)/i],
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/i],
    ['Firefox', /Firefox\/([\d.]+)/i],
    ['Chrome', /Chrome\/([\d.]+)/i],
    ['Safari', /Version\/([\d.]+).*Safari/i]
  ].find(([, pattern]) => pattern.test(userAgent));
  if (browserMatch) {
    browser = browserMatch[0];
    browserVersion = userAgent.match(browserMatch[1])?.[1] || '';
  }

  let operatingSystem = 'Bilinmiyor';
  let operatingSystemVersion = '';
  if (/Windows NT ([\d.]+)/i.test(userAgent)) {
    operatingSystem = 'Windows';
    const version = userAgent.match(/Windows NT ([\d.]+)/i)?.[1];
    operatingSystemVersion = ({
      '10.0': '10/11',
      '6.3': '8.1',
      '6.2': '8',
      '6.1': '7'
    })[version] || version || '';
  } else if (/iPhone|iPad|iPod/i.test(userAgent)) {
    operatingSystem = 'iOS';
    operatingSystemVersion = userAgent.match(/OS ([\d_]+)/i)?.[1]?.replaceAll('_', '.') || '';
  } else if (/Android/i.test(userAgent)) {
    operatingSystem = 'Android';
    operatingSystemVersion = userAgent.match(/Android ([\d.]+)/i)?.[1] || '';
  } else if (/Mac OS X|Macintosh/i.test(userAgent)) {
    operatingSystem = 'macOS';
    operatingSystemVersion = userAgent.match(/Mac OS X ([\d_]+)/i)?.[1]?.replaceAll('_', '.') || '';
  } else if (/Linux/i.test(userAgent)) {
    operatingSystem = 'Linux';
  }
  let deviceModel = '';
  if (/iPhone/i.test(userAgent)) deviceModel = 'iPhone';
  else if (/iPad/i.test(userAgent)) deviceModel = 'iPad';
  else if (/Android/i.test(userAgent)) deviceModel = 'Android cihaz';
  else if (/Windows/i.test(userAgent)) deviceModel = 'Windows PC';
  else if (/Macintosh|Mac OS X/i.test(userAgent)) deviceModel = 'Mac';

  return {
    deviceType,
    browser: typeof clientHints.browserName === 'string' ? clientHints.browserName.slice(0, 80) : browser,
    browserVersion: typeof clientHints.browserVersion === 'string'
      ? clientHints.browserVersion.slice(0, 40)
      : browserVersion,
    operatingSystem: typeof clientHints.platform === 'string'
      ? clientHints.platform.slice(0, 80)
      : operatingSystem,
    operatingSystemVersion: typeof clientHints.platformVersion === 'string'
      ? clientHints.platformVersion.slice(0, 40)
      : operatingSystemVersion,
    deviceModel: typeof clientHints.deviceModel === 'string' && clientHints.deviceModel
      ? clientHints.deviceModel.slice(0, 120)
      : deviceModel
  };
}

function getAuthMethod(auth) {
  if (!auth) return 'Guest';
  const provider = auth.token.firebase?.sign_in_provider;
  if (provider === 'google.com') return 'Google';
  if (provider === 'apple.com') return 'Apple';
  if (provider === 'anonymous') return 'Guest';
  return 'Other';
}

async function getGeoLocation(ip) {
  const endpoints = [
    {
      url: `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
      parse(data) {
        if (data.error === true) throw new Error('ipapi.co lookup failed.');
        return {
          city: data.city,
          region: data.region,
          postalCode: data.postal,
          country: data.country_name,
          latitude: data.latitude,
          longitude: data.longitude,
          timezone: data.timezone,
          isp: data.org
        };
      }
    },
    {
      url: `https://ipwho.is/${encodeURIComponent(ip)}`,
      parse(data) {
        if (data.success === false) throw new Error('ipwho.is lookup failed.');
        return {
          city: data.city,
          region: data.region,
          postalCode: data.postal,
          country: data.country,
          latitude: data.latitude,
          longitude: data.longitude,
          timezone: data.timezone?.id,
          isp: data.connection?.isp || data.connection?.org
        };
      }
    }
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        signal: AbortSignal.timeout(3000),
        headers: { accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`GeoIP service returned HTTP ${response.status}.`);
      const data = endpoint.parse(await response.json());
      if (!data.city && !data.country && !data.isp) {
        throw new Error('GeoIP service returned no location details.');
      }
      const text = (value, maxLength) => (
        typeof value === 'string' ? value.slice(0, maxLength) : ''
      );
      const coordinate = (value) => (
        typeof value === 'number' && Number.isFinite(value) ? value : null
      );
      return {
        city: text(data.city, 120),
        region: text(data.region, 120),
        postalCode: text(data.postalCode, 32),
        country: text(data.country, 120),
        latitude: coordinate(data.latitude),
        longitude: coordinate(data.longitude),
        timezone: text(data.timezone, 80),
        isp: text(data.isp, 200)
      };
    } catch (error) {
      logger.warn('GeoIP provider failed; trying the next provider.', error);
    }
  }
  throw new Error('All GeoIP providers failed.');
}

exports.checkAccess = onCall({ region: 'us-central1' }, async (request) => {
  const ip = getClientIp(request);
  const access = await getAccessStatus(ip, request.auth?.uid);
  return { allowed: access.allowed, reason: access.reason, ipAvailable: Boolean(ip) };
});

exports.recordVisit = onCall({ region: 'us-central1' }, async (request) => {
  if (request.data?.consentAccepted !== true
    || request.data?.privacyNoticeVersion !== privacyNoticeVersion) {
    throw new HttpsError('failed-precondition', 'Güncel gizlilik bildirimi onayı gereklidir.');
  }

  const serverIp = getClientIp(request);
  const clientIp = typeof request.data?.metadata?.clientIp === 'string'
    && net.isIP(request.data.metadata.clientIp) !== 0
    ? request.data.metadata.clientIp
    : '';
  const ip = clientIp || serverIp || 'Bilinmeyen IP';
  const access = await getAccessStatus(serverIp, request.auth?.uid);
  if (!access.allowed) {
    throw new HttpsError('permission-denied', 'Bu siteye erişiminiz engellenmiştir.');
  }

  const userAgent = String(request.rawRequest.get('user-agent') || '').slice(0, 1000);
  const metadata = request.data?.metadata && typeof request.data.metadata === 'object'
    ? request.data.metadata
    : {};
  const clientHints = metadata.clientHints && typeof metadata.clientHints === 'object'
    ? metadata.clientHints
    : {};
  const {
    deviceType,
    browser,
    browserVersion,
    operatingSystem,
    operatingSystemVersion,
    deviceModel
  } = getDeviceDetails(userAgent, clientHints);
  const auth = request.auth;
  const profile = auth?.token || {};
  let geoLocation = {
    city: '',
    region: '',
    postalCode: '',
    country: '',
    latitude: null,
    longitude: null,
    timezone: '',
    isp: ''
  };
  let geoStatus = 'unavailable';
  try {
    if (net.isIP(ip) === 0) throw new Error('A public client IP is unavailable.');
    geoLocation = await getGeoLocation(ip);
    geoStatus = 'available';
    if (!geoLocation.city && !geoLocation.country && !geoLocation.isp) {
      geoStatus = 'unavailable';
      logger.warn('GeoIP provider returned no location for a visitor.');
    }
  } catch (error) {
    const clientGeo = metadata.geoLocation && typeof metadata.geoLocation === 'object'
      ? metadata.geoLocation
      : {};
    const text = (value, maxLength) => (
      typeof value === 'string' ? value.slice(0, maxLength) : ''
    );
    const coordinate = (value) => (
      typeof value === 'number' && Number.isFinite(value) ? value : null
    );
    geoLocation = {
      city: text(clientGeo.city, 120),
      region: text(clientGeo.region, 120),
      postalCode: text(clientGeo.postalCode, 32),
      country: text(clientGeo.country, 120),
      latitude: coordinate(clientGeo.latitude),
      longitude: coordinate(clientGeo.longitude),
      timezone: text(clientGeo.timezone, 80),
      isp: text(clientGeo.isp, 200)
    };
    geoStatus = Object.values(geoLocation).some(Boolean) ? 'client-fallback' : 'unavailable';
    logger.warn('Server GeoIP lookup failed; using available client details if provided.', error);
  }

  const expiresAt = Timestamp.fromMillis(
    Date.now() + sessionRetentionDays * 24 * 60 * 60 * 1000
  );
  const durationToken = crypto.randomBytes(32).toString('base64url');
  const record = {
    uid: auth?.uid || '',
    email: typeof profile.email === 'string' ? profile.email.slice(0, 320) : '',
    displayName: typeof profile.name === 'string'
      ? profile.name.slice(0, 200)
      : typeof metadata.displayName === 'string'
        ? metadata.displayName.slice(0, 200)
        : '',
    phoneNumber: typeof profile.phone_number === 'string' ? profile.phone_number.slice(0, 40) : '',
    photoURL: typeof metadata.photoURL === 'string' && metadata.photoURL.startsWith('https://')
      ? metadata.photoURL.slice(0, 2000)
      : '',
    authMethod: getAuthMethod(auth),
    ip,
    city: geoLocation.city,
    region: geoLocation.region,
    location: [geoLocation.city, geoLocation.region, geoLocation.country]
      .filter(Boolean)
      .join(', ') || 'Bilinmiyor',
    postalCode: geoLocation.postalCode,
    country: geoLocation.country,
    latitude: geoLocation.latitude,
    longitude: geoLocation.longitude,
    timezone: geoLocation.timezone,
    isp: geoLocation.isp,
    geoStatus,
    deviceType,
    browser,
    browserVersion,
    operatingSystem,
    operatingSystemVersion,
    deviceModel,
    screenResolution: typeof metadata.screenResolution === 'string'
      ? metadata.screenResolution.slice(0, 40)
      : '',
    viewportResolution: typeof metadata.viewportResolution === 'string'
      ? metadata.viewportResolution.slice(0, 40)
      : '',
    language: typeof metadata.language === 'string' ? metadata.language.slice(0, 40) : '',
    clientTimezone: typeof metadata.timezone === 'string' ? metadata.timezone.slice(0, 80) : '',
    referrer: typeof metadata.referrer === 'string' ? metadata.referrer.slice(0, 500) : '',
    pagePath: typeof metadata.pagePath === 'string' ? metadata.pagePath.slice(0, 300) : '',
    userAgent,
    consentAccepted: true,
    privacyNoticeVersion,
    durationSeconds: 0,
    lastSeen: FieldValue.serverTimestamp(),
    durationTokenHash: crypto.createHash('sha256').update(durationToken).digest('hex'),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt
  };
  const session = await database.collection('visits').add(record);
  return { recorded: true, sessionId: session.id, durationToken, geoStatus };
});

exports.updateVisitDuration = onCall({ region: 'us-central1' }, async (request) => {
  const sessionId = request.data?.sessionId;
  const durationSeconds = request.data?.durationSeconds;
  const active = request.data?.active;
  if (request.data?.consentAccepted !== true
    || request.data?.privacyNoticeVersion !== privacyNoticeVersion
    || typeof sessionId !== 'string'
    || sessionId.length < 1
    || sessionId.length > 128
    || typeof request.data?.durationToken !== 'string'
    || request.data.durationToken.length !== 43
    || !Number.isInteger(durationSeconds)
    || durationSeconds < 0
    || durationSeconds > 7 * 24 * 60 * 60
    || typeof active !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Geçerli onaylı oturum ve süre gereklidir.');
  }

  let sessionRef = database.collection('visits').doc(sessionId);
  let session = await sessionRef.get();
  if (!session.exists) {
    sessionRef = database.collection('sessions').doc(sessionId);
    session = await sessionRef.get();
  }
  if (!session.exists) {
    throw new HttpsError('permission-denied', 'Bu oturum kaydını güncelleme yetkiniz yok.');
  }
  const expectedHash = session.get('durationTokenHash');
  const suppliedHash = crypto.createHash('sha256').update(request.data.durationToken).digest('hex');
  const ownsSession = Boolean(request.auth?.uid && session.get('uid') === request.auth.uid);
  const hasValidToken = typeof expectedHash === 'string'
    && /^[\da-f]{64}$/i.test(expectedHash)
    && crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(suppliedHash, 'hex'));
  if (!ownsSession && !hasValidToken) {
    throw new HttpsError('permission-denied', 'Bu oturum kaydını güncelleme yetkiniz yok.');
  }
  const update = {
    durationSeconds,
    lastActivityAt: FieldValue.serverTimestamp()
  };
  if (active) update.lastSeen = FieldValue.serverTimestamp();
  await sessionRef.update(update);
  return { updated: true };
});

exports.setUserBan = onCall({ region: 'us-central1' }, async (request) => {
  requireAdmin(request);
  const uid = request.data?.uid;
  const banned = request.data?.banned;
  if (typeof uid !== 'string' || uid.length < 1 || uid.length > 128 || typeof banned !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Geçerli UID ve banned değeri gereklidir.');
  }

  if (uid === request.auth.uid) {
    throw new HttpsError('failed-precondition', 'Yönetici kendi hesabını engelleyemez.');
  }
  const user = await getAuth().getUser(uid);
  if (user.email?.toLowerCase() === adminEmail) {
    throw new HttpsError('failed-precondition', 'Yönetici hesabı engellenemez.');
  }

  await database.collection('users').doc(uid).set({
    banned,
    email: user.email || '',
    displayName: user.displayName || '',
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid,
    ...(banned
      ? { bannedAt: FieldValue.serverTimestamp(), bannedBy: request.auth.uid }
      : { bannedAt: null, bannedBy: null })
  }, { merge: true });
  return { uid, banned };
});

exports.setIpBan = onCall({ region: 'us-central1' }, async (request) => {
  requireAdmin(request);
  const ip = typeof request.data?.ip === 'string' ? request.data.ip.trim() : '';
  const banned = request.data?.banned;
  if (net.isIP(ip) === 0 || typeof banned !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Geçerli IP adresi ve banned değeri gereklidir.');
  }

  const document = database.collection('bannedIPs').doc(getIpDocumentId(ip));
  if (banned) {
    await document.set({
      ip,
      banned: true,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: request.auth.uid
    });
  } else {
    const existing = await document.get();
    if (!existing.exists) {
      throw new HttpsError('not-found', 'Bu IP adresi için etkin bir engel bulunamadı.');
    }
    await document.delete();
  }
  return { ip, banned };
});