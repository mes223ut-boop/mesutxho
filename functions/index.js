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
const privacyNoticeVersion = '2026-10-13-v4';
const sessionRetentionDays = 90;

function getClientIp(request) {
  const ip = request.rawRequest.ip;
  if (typeof ip !== 'string' || net.isIP(ip) === 0) {
    throw new HttpsError('failed-precondition', 'Ziyaretçi IP adresi güvenilir şekilde belirlenemedi.');
  }
  return ip;
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
  const ipDocument = await database.collection('bannedIPs').doc(getIpDocumentId(ip)).get();
  if (ipDocument.exists && ipDocument.get('banned') === true) {
    return { allowed: false, reason: 'ip' };
  }

  if (uid) {
    const userDocument = await database.collection('users').doc(uid).get();
    if (userDocument.exists && userDocument.get('banned') === true) {
      return { allowed: false, reason: 'user' };
    }
  }
  return { allowed: true, reason: null };
}

function getDeviceDetails(userAgent) {
  let deviceType = 'Desktop';
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobi)/i.test(userAgent)) {
    deviceType = 'Tablet';
  } else if (/Mobi|Android|iPhone|iPod|IEMobile|Windows Phone/i.test(userAgent)) {
    deviceType = 'Mobile';
  }

  let browser = 'Bilinmiyor';
  if (/Edg\//i.test(userAgent)) browser = 'Edge';
  else if (/OPR\//i.test(userAgent)) browser = 'Opera';
  else if (/SamsungBrowser\//i.test(userAgent)) browser = 'Samsung Internet';
  else if (/Firefox\//i.test(userAgent)) browser = 'Firefox';
  else if (/Chrome\//i.test(userAgent)) browser = 'Chrome';
  else if (/Safari\//i.test(userAgent)) browser = 'Safari';

  let operatingSystem = 'Bilinmiyor';
  if (/Windows/i.test(userAgent)) operatingSystem = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(userAgent)) operatingSystem = 'iOS';
  else if (/Android/i.test(userAgent)) operatingSystem = 'Android';
  else if (/Mac OS X|Macintosh/i.test(userAgent)) operatingSystem = 'macOS';
  else if (/Linux/i.test(userAgent)) operatingSystem = 'Linux';

  return { deviceType, browser, operatingSystem };
}

function getAuthMethod(auth) {
  if (!auth) return 'Anonymous';
  const provider = auth.token.firebase?.sign_in_provider;
  if (provider === 'google.com') return 'Google';
  if (provider === 'apple.com') return 'Apple';
  if (provider === 'anonymous') return 'Guest';
  return 'Anonymous';
}

async function getGeoLocation(ip) {
  const response = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
    signal: AbortSignal.timeout(4000),
    headers: { accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error(`GeoIP service returned HTTP ${response.status}.`);
  }

  const data = await response.json();
  if (data.error === true) {
    throw new Error(`GeoIP service rejected the lookup: ${String(data.reason || 'unknown error')}.`);
  }
  return {
    city: typeof data.city === 'string' ? data.city.slice(0, 120) : '',
    country: typeof data.country_name === 'string' ? data.country_name.slice(0, 120) : ''
  };
}

exports.checkAccess = onCall({ region: 'us-central1' }, async (request) => {
  const ip = getClientIp(request);
  const access = await getAccessStatus(ip, request.auth?.uid);
  return { allowed: access.allowed, reason: access.reason };
});

exports.recordVisit = onCall({ region: 'us-central1' }, async (request) => {
  if (request.data?.consentAccepted !== true
    || request.data?.privacyNoticeVersion !== privacyNoticeVersion) {
    throw new HttpsError('failed-precondition', 'Güncel gizlilik bildirimi onayı gereklidir.');
  }

  const ip = getClientIp(request);
  const access = await getAccessStatus(ip, request.auth?.uid);
  if (!access.allowed) {
    throw new HttpsError('permission-denied', 'Bu siteye erişiminiz engellenmiştir.');
  }

  const userAgent = String(request.rawRequest.get('user-agent') || '').slice(0, 1000);
  const { deviceType, browser, operatingSystem } = getDeviceDetails(userAgent);
  const auth = request.auth;
  const profile = auth?.token || {};
  let geoLocation = { city: '', country: '' };
  let geoStatus = 'available';
  try {
    geoLocation = await getGeoLocation(ip);
    if (!geoLocation.city && !geoLocation.country) {
      geoStatus = 'unavailable';
      logger.warn('GeoIP provider returned no location for a visitor.');
    }
  } catch (error) {
    geoStatus = 'unavailable';
    logger.error('GeoIP lookup failed; recording the session with an unavailable location.', error);
  }

  const expiresAt = Timestamp.fromMillis(
    Date.now() + sessionRetentionDays * 24 * 60 * 60 * 1000
  );
  const record = {
    uid: auth?.uid || '',
    email: typeof profile.email === 'string' ? profile.email.slice(0, 320) : '',
    displayName: typeof profile.name === 'string' ? profile.name.slice(0, 200) : '',
    authMethod: getAuthMethod(auth),
    ip,
    city: geoLocation.city,
    country: geoLocation.country,
    geoStatus,
    deviceType,
    browser,
    operatingSystem,
    userAgent,
    consentAccepted: true,
    privacyNoticeVersion,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt
  };
  const session = await database.collection('sessions').add(record);
  return { recorded: true, sessionId: session.id, geoStatus };
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
