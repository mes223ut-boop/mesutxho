import {
  adminEmail,
  firebaseAuth,
  firebaseDatabase,
  firebaseFunctions
} from './firebase-config.js?v=20261014-8';
import { recordUserSession } from './session-records.js?v=20261014-8';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import {
  collection,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-functions.js';

const status = document.getElementById('admin-status');
const content = document.getElementById('admin-content');
const loginButton = document.getElementById('admin-google-login');
const loginConsent = document.getElementById('admin-login-consent');
const consentCheckbox = document.getElementById('admin-privacy-consent');
const signOutButton = document.getElementById('admin-sign-out');
const sidebarAvatar = document.getElementById('sidebar-avatar');
const sidebarProfileName = document.getElementById('sidebar-profile-name');
const sidebarProfileEmail = document.getElementById('sidebar-profile-email');
const navigationLinks = document.querySelectorAll('.sidebar-link[data-panel]');
const panels = document.querySelectorAll('.dashboard-panel');
const totalMetric = document.getElementById('metric-total');
const activeMetric = document.getElementById('metric-active');
const overviewDeviceMetrics = {
  Mobile: document.getElementById('device-mobile'),
  Desktop: document.getElementById('device-desktop'),
  Tablet: document.getElementById('device-tablet')
};
const deviceMetrics = {
  Mobile: [document.getElementById('device-count-mobile'), document.getElementById('device-percent-mobile')],
  Desktop: [document.getElementById('device-count-desktop'), document.getElementById('device-percent-desktop')],
  Tablet: [document.getElementById('device-count-tablet'), document.getElementById('device-percent-tablet')]
};
const recordRows = {
  recent: document.getElementById('recent-rows'),
  ip: document.getElementById('ip-rows'),
  devices: document.getElementById('device-rows'),
  users: document.getElementById('user-rows'),
  bannedIps: document.getElementById('banned-ip-rows'),
  bannedUsers: document.getElementById('banned-user-rows')
};
const ipSearch = document.getElementById('ip-search');
const userSearch = document.getElementById('user-search');
const providerBreakdown = document.getElementById('provider-breakdown');
const googleProvider = new GoogleAuthProvider();
const setUserBan = httpsCallable(firebaseFunctions, 'setUserBan', { timeout: 15000 });
const setIpBan = httpsCallable(firebaseFunctions, 'setIpBan', { timeout: 15000 });
const adminConsentStorageKey = 'mesutxho-admin-privacy-consent-v7';

let currentUser = null;
let sessions = [];
let legacySessions = [];
let visitRecords = [];
let bannedUsers = new Map();
let bannedIps = new Map();
let subscriptions = [];
let authGeneration = 0;
let authFlowActive = false;
let adminVisitLogged = false;
let authResolved = false;
let authTimeoutId;
let activeMetricTimer = null;
const busyActions = new Set();

try {
  consentCheckbox.checked = sessionStorage.getItem(adminConsentStorageKey) === 'accepted';
} catch (error) {
  console.warn('Yönetici gizlilik onayı bu sekmede saklanamadı:', error);
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function stopListeners() {
  subscriptions.forEach((unsubscribe) => unsubscribe());
  subscriptions = [];
  if (activeMetricTimer !== null) {
    window.clearInterval(activeMetricTimer);
    activeMetricTimer = null;
  }
  sessions = [];
  legacySessions = [];
  visitRecords = [];
  bannedUsers = new Map();
  bannedIps = new Map();
}

function getDate(value) {
  if (value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  return null;
}

function sessionDate(record) {
  return getDate(record.createdAt);
}

function formatTimestamp(value) {
  const date = getDate(value);
  return date
    ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'medium' }).format(date)
    : 'Bilinmiyor';
}

function formatUser(record) {
  return record.displayName || record.email || record.uid || 'Misafir Ziyaretçi';
}

function getAuthMethod(record) {
  return record.authMethod || (record.uid ? 'Other' : 'Guest');
}

function formatDuration(value) {
  if (!Number.isFinite(value) || value < 0) return 'Bilinmiyor';
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return minutes ? `${minutes} dk ${seconds} sn` : `${seconds} sn`;
}

function addCell(row, value, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = value === null || value === undefined || value === '' ? 'Bilinmiyor' : String(value);
  row.appendChild(cell);
  return cell;
}

function addLinkCell(row, value, label = value) {
  const cell = document.createElement('td');
  if (typeof value !== 'string' || !value) {
    cell.textContent = 'Bilinmiyor';
    row.appendChild(cell);
    return cell;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('HTTPS link required.');
    const link = document.createElement('a');
    link.href = url.href;
    link.textContent = label;
    link.title = value;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    cell.appendChild(link);
  } catch (error) {
    cell.textContent = value;
  }
  row.appendChild(cell);
  return cell;
}

function showEmpty(rowContainer, message, columnCount) {
  const row = document.createElement('tr');
  const cell = addCell(row, message, 'empty-row');
  cell.colSpan = columnCount;
  rowContainer.replaceChildren(row);
}

function createActionButton(label, callback, className = 'action-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', callback);
  return button;
}

function getIp(record) {
  if (typeof record.ip !== 'string') return 'Bilinmeyen IP';
  const ip = record.ip.trim();
  const ipv4Parts = ip.split('.');
  const isIpv4 = ipv4Parts.length === 4 && ipv4Parts.every((part) => (
    /^\d{1,3}$/.test(part) && Number(part) <= 255
  ));
  if (isIpv4) return ip;
  if (ip.includes(':')) {
    try {
      if (new URL(`http://[${ip}]/`).hostname) return ip;
    } catch {
      return 'Bilinmeyen IP';
    }
  }
  return 'Bilinmeyen IP';
}

function getLocation(record) {
  const location = [record.city, record.region, record.country].filter(Boolean).join(', ');
  return location || record.location || 'Bilinmiyor';
}

function getDevice(record) {
  const deviceType = record.deviceType || 'Bilinmiyor';
  const platform = [record.operatingSystem, record.operatingSystemVersion].filter(Boolean).join(' ');
  return [deviceType, record.deviceModel, platform].filter(Boolean).join(' · ');
}

function renderActiveUsers() {
  const activeCutoff = Date.now() - 5 * 60 * 1000;
  const activeVisitors = new Set();
  for (const record of sessions) {
    const lastSeen = getDate(record.lastSeen);
    if (lastSeen && lastSeen.getTime() > activeCutoff) {
      activeVisitors.add(record.uid || record.id);
    }
  }
  activeMetric.textContent = activeVisitors.size.toLocaleString('tr-TR');
}

function renderRecentSessions() {
  const recent = sessions.slice(0, 20);
  if (!recent.length) {
    showEmpty(recordRows.recent, 'Henüz ziyaret kaydı bulunmuyor.', 6);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const record of recent) {
    const row = document.createElement('tr');
    addCell(row, formatUser(record));
    addCell(row, [getIp(record), getLocation(record)].join(' · '));
    addCell(row, getAuthMethod(record));
    addCell(row, formatTimestamp(record.createdAt));
    addCell(row, `${record.deviceType || 'Bilinmiyor'} · ${record.browser || 'Bilinmiyor'} ${record.browserVersion || ''}`.trim());
    addCell(row, formatDuration(record.durationSeconds));
    fragment.appendChild(row);
  }
  recordRows.recent.replaceChildren(fragment);
}

function renderProviderBreakdown() {
  const counts = new Map();
  for (const record of sessions) {
    const method = getAuthMethod(record);
    counts.set(method, (counts.get(method) || 0) + 1);
  }
  const total = sessions.length;
  if (!total) {
    providerBreakdown.textContent = 'Henüz gösterilecek kayıt bulunmuyor.';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const [method, count] of [...counts.entries()].sort((left, right) => right[1] - left[1])) {
    const item = document.createElement('div');
    item.className = 'provider-row';
    const label = document.createElement('span');
    label.className = 'provider-label';
    label.textContent = method;
    const track = document.createElement('span');
    track.className = 'provider-track';
    const bar = document.createElement('span');
    bar.className = 'provider-bar';
    bar.style.width = `${Math.round((count / total) * 100)}%`;
    track.appendChild(bar);
    const value = document.createElement('strong');
    value.textContent = `${count.toLocaleString('tr-TR')} (${Math.round((count / total) * 100)}%)`;
    item.append(label, track, value);
    fragment.appendChild(item);
  }
  providerBreakdown.replaceChildren(fragment);
}

function renderOverview() {
  const deviceCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const devices = { Mobile: 0, Desktop: 0, Tablet: 0 };
  for (const record of sessions) {
    const visitDate = sessionDate(record);
    if (visitDate && visitDate.getTime() >= deviceCutoff) {
      if (Object.hasOwn(devices, record.deviceType)) {
        devices[record.deviceType] += 1;
      }
    }
  }
  totalMetric.textContent = sessions.length.toLocaleString('tr-TR');
  renderActiveUsers();
  for (const [device, element] of Object.entries(overviewDeviceMetrics)) {
    element.textContent = devices[device].toLocaleString('tr-TR');
  }
  renderProviderBreakdown();
  renderRecentSessions();
}

function renderIpRows() {
  const term = ipSearch.value.trim().toLocaleLowerCase('tr-TR');
  const filtered = sessions.filter((record) => [
    record.ip,
    record.city,
    record.region,
    record.location,
    record.country,
    record.postalCode,
    record.timezone,
    record.isp,
    record.uid,
    record.email
  ].some((value) => typeof value === 'string' && value.toLocaleLowerCase('tr-TR').includes(term)));
  if (!filtered.length) {
    showEmpty(recordRows.ip, term ? 'Aramanla eşleşen IP kaydı bulunamadı.' : 'Henüz IP kaydı bulunmuyor.', 9);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const record of filtered) {
    const row = document.createElement('tr');
    addCell(row, getIp(record));
    const location = getLocation(record);
    addCell(row, location === 'Bilinmiyor' && record.geoStatus === 'unavailable'
      ? 'GeoIP alınamadı'
      : location);
    addCell(row, record.postalCode);
    addCell(row, Number.isFinite(record.latitude) && Number.isFinite(record.longitude)
      ? `${record.latitude}, ${record.longitude}`
      : '');
    addCell(row, record.timezone || record.clientTimezone);
    addCell(row, record.isp || 'Bilinmiyor');
    addCell(row, formatUser(record));
    addCell(row, formatTimestamp(record.createdAt));
    const actionCell = document.createElement('td');
    const ip = getIp(record);
    const ipIsBanned = bannedIps.has(ip);
    const button = createActionButton(
      ipIsBanned ? 'IP banını kaldır' : 'IP banla',
      () => void changeIpBan(ip, !ipIsBanned),
      ipIsBanned ? 'action-button unban-button' : 'action-button danger-button'
    );
    button.disabled = ip === 'Bilinmeyen IP' || busyActions.has(`ip:${ip}`);
    actionCell.appendChild(button);
    row.appendChild(actionCell);
    fragment.appendChild(row);
  }
  recordRows.ip.replaceChildren(fragment);
}

function renderBannedIps() {
  const records = [...bannedIps.values()].sort((left, right) => (
    (getDate(right.createdAt)?.getTime() || 0) - (getDate(left.createdAt)?.getTime() || 0)
  ));
  if (!records.length) {
    showEmpty(recordRows.bannedIps, 'Engellenen IP adresi bulunmuyor.', 3);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const record of records) {
    const row = document.createElement('tr');
    addCell(row, getIp(record));
    addCell(row, formatTimestamp(record.createdAt));
    const cell = document.createElement('td');
    cell.appendChild(createActionButton(
      'Banı kaldır',
      () => void changeIpBan(record.ip, false),
      'action-button unban-button'
    ));
    row.appendChild(cell);
    fragment.appendChild(row);
  }
  recordRows.bannedIps.replaceChildren(fragment);
}

function renderDeviceRows() {
  const groups = new Map();
  const counts = { Mobile: 0, Desktop: 0, Tablet: 0 };
  for (const record of sessions) {
    const device = record.deviceType || 'Bilinmiyor';
    if (Object.hasOwn(counts, device)) counts[device] += 1;
    const browser = record.browser || 'Bilinmiyor';
    const operatingSystem = record.operatingSystem || 'Bilinmiyor';
    const key = `${browser}\u0000${operatingSystem}\u0000${device}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      if ((sessionDate(record)?.getTime() || 0) > (sessionDate(group.latest)?.getTime() || 0)) {
        group.latest = record;
      }
    } else {
      groups.set(key, { count: 1, latest: record });
    }
  }
  for (const [device, [countElement, percentElement]] of Object.entries(deviceMetrics)) {
    countElement.textContent = counts[device].toLocaleString('tr-TR');
    percentElement.textContent = sessions.length
      ? `Ziyaretlerin %${Math.round((counts[device] / sessions.length) * 100)}'i`
      : 'Ziyaretlerin %0\'ı';
  }
  if (!groups.size) {
    showEmpty(recordRows.devices, 'Henüz cihaz kaydı bulunmuyor.', 7);
    return;
  }
  const fragment = document.createDocumentFragment();
  const sorted = [...groups.values()].sort((left, right) => right.count - left.count);
  for (const group of sorted) {
    const record = group.latest;
    const row = document.createElement('tr');
    addCell(row, `${record.browser || 'Bilinmiyor'} ${record.browserVersion || ''}`.trim());
    addCell(row, `${record.operatingSystem || 'Bilinmiyor'} ${record.operatingSystemVersion || ''}`.trim());
    addCell(row, `${record.deviceType || 'Bilinmiyor'}${record.deviceModel ? ` · ${record.deviceModel}` : ''}`);
    addCell(row, [record.screenResolution, record.viewportResolution].filter(Boolean).join(' / '));
    addCell(row, [record.language, record.clientTimezone || record.timezone].filter(Boolean).join(' · '));
    const percent = Math.round((group.count / sessions.length) * 100);
    addCell(row, `${group.count.toLocaleString('tr-TR')} (%${percent})`);
    addCell(row, formatTimestamp(record.createdAt));
    fragment.appendChild(row);
  }
  recordRows.devices.replaceChildren(fragment);
}

function renderUserRows() {
  const term = userSearch.value.trim().toLocaleLowerCase('tr-TR');
  const filtered = sessions.filter((record) => [
    record.displayName,
    record.email,
    record.uid,
    getAuthMethod(record),
    getIp(record),
    getLocation(record),
    record.isp,
    getDevice(record)
  ].some((value) => typeof value === 'string' && value.toLocaleLowerCase('tr-TR').includes(term)));
  if (!filtered.length) {
    showEmpty(recordRows.users, term ? 'Aramanla eşleşen kayıt bulunamadı.' : 'Henüz kullanıcı/oturum kaydı bulunmuyor.', 13);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const record of filtered) {
    const row = document.createElement('tr');
    addCell(row, `${formatUser(record)}${record.email && record.displayName ? ` · ${record.email}` : ''}`);
    addLinkCell(row, record.photoURL, record.photoURL || '');
    addCell(row, record.phoneNumber);
    addCell(row, getAuthMethod(record));
    addCell(row, record.uid);
    addCell(row, getIp(record));
    addCell(row, getLocation(record));
    addCell(row, record.isp || 'Bilinmiyor');
    addCell(row, getDevice(record));
    addCell(row, [record.referrer, record.pagePath].filter(Boolean).join(' → '));
    addCell(row, formatDuration(record.durationSeconds));
    addCell(row, formatTimestamp(record.createdAt));
    const actions = document.createElement('td');
    const actionGroup = document.createElement('div');
    actionGroup.className = 'row-actions';
    const userIsBanned = bannedUsers.get(record.uid)?.banned === true;
    if (record.uid) {
      const banButton = createActionButton(
        userIsBanned ? 'Banı kaldır' : 'Kullanıcıyı banla',
        () => void changeUserBan(record.uid, !userIsBanned),
        userIsBanned ? 'action-button unban-button' : 'action-button danger-button'
      );
      banButton.disabled = record.uid === currentUser?.uid || busyActions.has(`user:${record.uid}`);
      actionGroup.appendChild(banButton);
    }
    const ip = getIp(record);
    if (ip !== 'Bilinmeyen IP') {
      const ipIsBanned = bannedIps.has(ip);
      actionGroup.appendChild(createActionButton(
        ipIsBanned ? 'IP banını kaldır' : 'IP banla',
        () => void changeIpBan(ip, !ipIsBanned),
        ipIsBanned ? 'action-button unban-button' : 'action-button danger-button'
      ));
    }
    actions.appendChild(actionGroup);
    row.appendChild(actions);
    fragment.appendChild(row);
  }
  recordRows.users.replaceChildren(fragment);
}

function renderBannedUsers() {
  const records = [...bannedUsers.entries()]
    .filter(([, record]) => record.banned === true)
    .sort((left, right) => (
      (getDate(right[1].bannedAt)?.getTime() || 0) - (getDate(left[1].bannedAt)?.getTime() || 0)
    ));
  if (!records.length) {
    showEmpty(recordRows.bannedUsers, 'Engellenen kullanıcı bulunmuyor.', 4);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const [uid, record] of records) {
    const row = document.createElement('tr');
    addCell(row, record.displayName || record.email || uid);
    addCell(row, uid);
    addCell(row, formatTimestamp(record.bannedAt));
    const cell = document.createElement('td');
    const button = createActionButton(
      'Banı kaldır',
      () => void changeUserBan(uid, false),
      'action-button unban-button'
    );
    button.disabled = busyActions.has(`user:${uid}`);
    cell.appendChild(button);
    row.appendChild(cell);
    fragment.appendChild(row);
  }
  recordRows.bannedUsers.replaceChildren(fragment);
}

function renderAll() {
  renderOverview();
  renderIpRows();
  renderBannedIps();
  renderDeviceRows();
  renderUserRows();
  renderBannedUsers();
}

async function changeUserBan(uid, banned) {
  const actionKey = `user:${uid}`;
  if (busyActions.has(actionKey)) return;
  if (banned && !window.confirm('Bu kullanıcıyı engellemek ve mevcut oturumunu kapatmak istiyor musun?')) return;
  busyActions.add(actionKey);
  status.textContent = banned ? 'Kullanıcı engelleniyor...' : 'Kullanıcı engeli kaldırılıyor...';
  renderAll();
  try {
    await setUserBan({ uid, banned });
    status.textContent = banned
      ? 'Kullanıcı engellendi; aktif oturumu kapatılacak.'
      : 'Kullanıcı engeli kaldırıldı.';
  } catch (error) {
    console.error('Kullanıcı ban işlemi başarısız:', error);
    status.textContent = `Kullanıcı ban işlemi başarısız (${error.code || 'beklenmeyen hata'}). Yönetici yetkisini ve Functions dağıtımını kontrol et.`;
  } finally {
    busyActions.delete(actionKey);
    renderAll();
  }
}

async function changeIpBan(ip, banned) {
  if (typeof ip !== 'string' || !ip) return;
  const actionKey = `ip:${ip}`;
  if (busyActions.has(actionKey)) return;
  if (banned && !window.confirm(`${ip} IP adresini engellemek istiyor musun? Bu ağdan gelen ziyaretçiler de engellenebilir.`)) return;
  busyActions.add(actionKey);
  status.textContent = banned ? 'IP adresi engelleniyor...' : 'IP adresi engeli kaldırılıyor...';
  renderAll();
  try {
    await setIpBan({ ip, banned });
    status.textContent = banned
      ? 'IP engellendi. Ziyaretçiler sonraki erişim denetiminde engellenir.'
      : 'IP engeli kaldırıldı.';
  } catch (error) {
    console.error('IP ban işlemi başarısız:', error);
    status.textContent = `IP ban işlemi başarısız (${error.code || 'beklenmeyen hata'}). Yönetici yetkisini ve Functions dağıtımını kontrol et.`;
  } finally {
    busyActions.delete(actionKey);
    renderAll();
  }
}

function updateProfile(user) {
  const displayName = user?.displayName || 'Yönetici';
  const email = user?.email || 'Yönetici hesabı';
  const initial = displayName.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'M';
  sidebarProfileName.textContent = displayName;
  sidebarProfileEmail.textContent = email;
  sidebarAvatar.replaceChildren(document.createTextNode(initial));
  if (!user?.photoURL) return;

  try {
    const imageUrl = new URL(user.photoURL);
    if (imageUrl.protocol !== 'https:') return;
    const image = document.createElement('img');
    image.src = imageUrl.href;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      image.remove();
      sidebarAvatar.textContent = initial;
    }, { once: true });
    sidebarAvatar.replaceChildren(image);
  } catch (error) {
    console.warn('Yönetici profil fotoğrafı URL değeri geçersiz:', error);
  }
}

function isAdminUser(user, claims) {
  return user.emailVerified
    && user.email?.toLowerCase() === adminEmail
    && claims.email?.toLowerCase() === adminEmail
    && claims.email_verified === true
    && claims.firebase?.sign_in_provider === 'google.com'
    && user.providerData.some((providerData) => providerData.providerId === 'google.com');
}

async function verifyAdminUser(user) {
  await user.reload();
  const refreshedUser = firebaseAuth.currentUser;
  if (!refreshedUser || refreshedUser.uid !== user.uid) return null;
  const tokenResult = await refreshedUser.getIdTokenResult(true);
  return isAdminUser(refreshedUser, tokenResult.claims) ? refreshedUser : null;
}

function showLogin(message) {
  stopListeners();
  currentUser = null;
  content.classList.add('hidden');
  loginConsent.classList.remove('hidden');
  loginButton.classList.remove('hidden');
  signOutButton.classList.add('hidden');
  loginButton.disabled = !consentCheckbox.checked || authFlowActive;
  if (message) status.textContent = message;
}

function showError(error) {
  console.error('Yönetici doğrulaması veya kayıt akışı başarısız:', error);
  if (currentUser) {
    stopListeners();
    status.textContent = 'Yetki veya kayıtlar doğrulanamadı. Google hesabını, Firestore kurallarını ve Firebase Functions dağıtımını kontrol et; yeniden deneyebilir veya oturumu kapatabilirsin.';
    content.classList.add('hidden');
    loginConsent.classList.add('hidden');
    loginButton.classList.add('hidden');
    signOutButton.classList.remove('hidden');
    return;
  }
  showLogin('Yetki veya kayıtlar doğrulanamadı. Google hesabını, Firestore kurallarını ve Firebase Functions dağıtımını kontrol et.');
}

function startListeners() {
  stopListeners();
  status.textContent = 'Ziyaret, IP ve kullanıcı kayıtları canlı yükleniyor...';
  activeMetricTimer = window.setInterval(renderActiveUsers, 15000);
  try {
    const updateVisits = () => {
      sessions = [...legacySessions, ...visitRecords];
      sessions.sort((left, right) => (
        (sessionDate(right)?.getTime() || 0) - (sessionDate(left)?.getTime() || 0)
      ));
      renderAll();
      status.textContent = `${sessions.length.toLocaleString('tr-TR')} ziyaret kaydı canlı olarak izleniyor.`;
      content.classList.remove('hidden');
      loginConsent.classList.toggle('hidden', consentCheckbox.checked);
      loginButton.classList.add('hidden');
      signOutButton.classList.remove('hidden');
    };

    subscriptions.push(onSnapshot(collection(firebaseDatabase, 'visits'), (snapshot) => {
      visitRecords = snapshot.docs.map((document) => ({
        id: `visit:${document.id}`,
        ...document.data({ serverTimestamps: 'estimate' })
      }));
      updateVisits();
    }, showError));

    subscriptions.push(onSnapshot(collection(firebaseDatabase, 'sessions'), (snapshot) => {
      legacySessions = snapshot.docs.map((document) => ({
        id: `session:${document.id}`,
        ...document.data({ serverTimestamps: 'estimate' })
      }));
      updateVisits();
    }, showError));

    subscriptions.push(onSnapshot(collection(firebaseDatabase, 'users'), (snapshot) => {
      bannedUsers = new Map(snapshot.docs.map((document) => [
        document.id,
        document.data({ serverTimestamps: 'estimate' })
      ]));
      renderAll();
    }, showError));

    subscriptions.push(onSnapshot(collection(firebaseDatabase, 'bannedIPs'), (snapshot) => {
      bannedIps = new Map(snapshot.docs.map((document) => {
        const data = document.data({ serverTimestamps: 'estimate' });
        return [data.ip, data];
      }).filter(([ip]) => typeof ip === 'string' && ip.length > 0));
      renderAll();
    }, showError));
  } catch (error) {
    showError(error);
  }
}

async function handleAuthStateChanged(user, generation) {
  updateProfile(user);
  if (authFlowActive || generation !== authGeneration) return;
  stopListeners();
  if (!user) {
    showLogin('Yönetici hesabıyla devam etmek için Google ile giriş yap.');
    return;
  }

  status.textContent = 'Yönetici hesabı doğrulanıyor...';
  try {
    const adminUser = await withTimeout(
      verifyAdminUser(user),
      12000,
      'Yönetici hesabı 12 saniye içinde doğrulanamadı.'
    );
    if (generation !== authGeneration) return;
    if (!adminUser) {
      try {
        await signOut(firebaseAuth);
      } catch (error) {
        console.error('Yetkisiz yönetici oturumu kapatılamadı:', error);
      }
      showLogin(`Yönetici erişimi yalnızca ${adminEmail} adresine sahip doğrulanmış Google hesabına açıktır.`);
      return;
    }

    currentUser = adminUser;
    loginConsent.classList.toggle('hidden', consentCheckbox.checked);
    loginButton.classList.add('hidden');
    signOutButton.classList.remove('hidden');
    startListeners();
    if (consentCheckbox.checked && !adminVisitLogged) {
      void recordAdminVisit();
    }
  } catch (error) {
    if (generation === authGeneration) showError(error);
  }
}

async function recordAdminVisit() {
  if (!consentCheckbox.checked || adminVisitLogged) return;
  adminVisitLogged = true;
  try {
    await recordUserSession(currentUser);
    loginConsent.classList.add('hidden');
  } catch (error) {
    adminVisitLogged = false;
    console.error('Yönetici oturumu kaydedilemedi:', error);
    loginConsent.classList.remove('hidden');
    status.textContent = 'Yönetici girişi başarılı; ancak onaylı oturum kaydı oluşturulamadı.';
  }
}

loginButton.addEventListener('click', async () => {
  if (!consentCheckbox.checked || authFlowActive) return;
  authFlowActive = true;
  loginButton.disabled = true;
  status.textContent = 'Google yönetici hesabı doğrulanıyor...';
  try {
    const credential = await signInWithPopup(firebaseAuth, googleProvider);
    const adminUser = await verifyAdminUser(credential.user);
    if (!adminUser) {
      await signOut(firebaseAuth);
      showLogin(`Yönetici erişimi yalnızca ${adminEmail} adresine sahip doğrulanmış Google hesabına açıktır.`);
      return;
    }
    currentUser = adminUser;
    void recordAdminVisit();
  } catch (error) {
    console.error('Yönetici girişi başarısız:', error);
    status.textContent = error.code === 'auth/unauthorized-domain'
      ? 'Bu alan adı Firebase Authentication yetkili alan adlarında değil.'
      : `Yönetici girişi tamamlanamadı (${error.code || 'beklenmeyen hata'}). Google sağlayıcı ayarlarını kontrol et.`;
  } finally {
    authFlowActive = false;
    loginButton.disabled = !consentCheckbox.checked;
    if (currentUser) startListeners();
  }
});

consentCheckbox.addEventListener('change', () => {
  loginButton.disabled = !consentCheckbox.checked || authFlowActive;
  try {
    if (consentCheckbox.checked) {
      sessionStorage.setItem(adminConsentStorageKey, 'accepted');
    } else {
      sessionStorage.removeItem(adminConsentStorageKey);
    }
  } catch (error) {
    console.warn('Yönetici gizlilik onayı bu sekmede saklanamadı:', error);
  }
  if (consentCheckbox.checked && currentUser) {
    void recordAdminVisit();
  } else if (currentUser) {
    loginConsent.classList.remove('hidden');
  }
});

signOutButton.addEventListener('click', async () => {
  try {
    await signOut(firebaseAuth);
    adminVisitLogged = false;
  } catch (error) {
    console.error('Yönetici oturumu kapatılamadı:', error);
    status.textContent = 'Yönetici oturumu kapatılamadı. Tekrar dene.';
  }
});

navigationLinks.forEach((link) => {
  link.addEventListener('click', () => {
    const targetId = link.dataset.panel;
    navigationLinks.forEach((item) => {
      item.classList.remove('active');
      item.removeAttribute('aria-current');
    });
    panels.forEach((panel) => panel.classList.toggle('active', panel.id === targetId));
    link.classList.add('active');
    link.setAttribute('aria-current', 'page');
  });
});

window.setInterval(renderActiveUsers, 15000);

ipSearch.addEventListener('input', renderIpRows);
userSearch.addEventListener('input', renderUserRows);

authTimeoutId = window.setTimeout(() => {
  if (!authResolved) {
    showError(new Error('Firebase Authentication başlangıç durumu 12 saniyede yanıt vermedi.'));
  }
}, 12000);

onAuthStateChanged(firebaseAuth, (user) => {
  authResolved = true;
  window.clearTimeout(authTimeoutId);
  const generation = ++authGeneration;
  void handleAuthStateChanged(user, generation).catch(showError);
}, (error) => {
  authResolved = true;
  window.clearTimeout(authTimeoutId);
  showError(error);
});
