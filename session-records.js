import { firebaseAuth, firebaseDatabase } from './firebase-config.js?v=20261013-3';
import {
  addDoc,
  collection,
  serverTimestamp,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

export const privacyNoticeVersion = '2026-10-13-v3';

const retentionDays = 90;
const allowedNetworkTypes = new Set([
  'Wi-Fi',
  '4G',
  '3G',
  '2G',
  'Mobil ağ',
  'Ethernet',
  '4G (tahmini)',
  '3G (tahmini)',
  '2G (tahmini)'
]);

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function classifyDevice(userAgent) {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobi)/i.test(userAgent)) {
    return 'Tablet';
  }
  if (/Mobi|Android|iPhone|iPod|IEMobile|Windows Phone/i.test(userAgent)) {
    return 'Mobile';
  }
  return 'Desktop';
}

async function getBatteryPercent() {
  if (typeof navigator.getBattery !== 'function') {
    return null;
  }

  let timeoutId;
  try {
    const battery = await Promise.race([
      navigator.getBattery(),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(null), 1500);
      })
    ]);
    return battery ? Math.round(battery.level * 100) : null;
  } catch (error) {
    console.warn('Battery level was not available:', error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getNetworkType() {
  try {
    const connection = navigator.connection;
    if (!connection) {
      return null;
    }

    const type = typeof connection.type === 'string' ? connection.type.toLowerCase() : '';
    const effectiveType = typeof connection.effectiveType === 'string'
      ? connection.effectiveType.toLowerCase()
      : '';

    if (type === 'wifi') {
      return 'Wi-Fi';
    }
    if (type === 'cellular') {
      return ['2g', '3g', '4g'].includes(effectiveType)
        ? effectiveType.toUpperCase()
        : 'Mobil ağ';
    }
    if (type === 'ethernet') {
      return 'Ethernet';
    }
    if (['2g', '3g', '4g'].includes(effectiveType)) {
      return `${effectiveType.toUpperCase()} (tahmini)`;
    }
    return null;
  } catch (error) {
    console.warn('Network type was not available:', error);
    return null;
  }
}

export async function recordUserSession(user) {
  if (!user || user.uid !== firebaseAuth.currentUser?.uid) {
    throw new Error('Oturum kaydı için geçerli giriş kullanıcısı bulunamadı.');
  }
  if (!user.emailVerified || typeof user.email !== 'string' || user.email.length === 0) {
    throw new Error('Google hesabından doğrulanabilir e-posta alınamadı.');
  }
  if (!user.providerData.some((provider) => provider.providerId === 'google.com')) {
    throw new Error('Oturum kaydı için Google sağlayıcısı gerekir.');
  }

  const userAgent = navigator.userAgent;
  const batteryPercent = await getBatteryPercent();
  const networkType = getNetworkType();
  const requestedPhotoURL = typeof user.photoURL === 'string' ? user.photoURL : '';
  let photoURL = '';
  try {
    const parsedPhotoURL = new URL(requestedPhotoURL);
    if (parsedPhotoURL.protocol === 'https:'
      && parsedPhotoURL.hostname.endsWith('.googleusercontent.com')) {
      photoURL = parsedPhotoURL.href;
    }
  } catch {
    photoURL = '';
  }

  const expiresAt = Timestamp.fromMillis(
    Date.now() + retentionDays * 24 * 60 * 60 * 1000
  );

  const write = addDoc(collection(firebaseDatabase, 'sessions'), {
    uid: user.uid,
    email: user.email,
    displayName: (user.displayName || 'İsimsiz').slice(0, 200),
    photoURL,
    batteryPercent,
    networkType: networkType && allowedNetworkTypes.has(networkType) ? networkType : null,
    deviceType: classifyDevice(userAgent),
    userAgent: userAgent.slice(0, 1000),
    consentAccepted: true,
    privacyNoticeVersion,
    createdAt: serverTimestamp(),
    expiresAt
  });
  return withTimeout(
    write,
    15000,
    'Firestore oturum kaydı 15 saniye içinde onaylanmadı; bağlantı ve Firestore durumunu kontrol et.'
  );
}
