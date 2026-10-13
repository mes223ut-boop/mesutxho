import { adminEmail, firebaseAuth, firebaseDatabase } from './firebase-config.js?v=20261013-3';
import { privacyNoticeVersion, recordUserSession } from './session-records.js?v=20261013-3';
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

const status = document.getElementById('admin-status');
const content = document.getElementById('admin-content');
const loginButton = document.getElementById('admin-google-login');
const loginConsent = document.getElementById('admin-login-consent');
const consentCheckbox = document.getElementById('admin-privacy-consent');
const sidebarAvatar = document.getElementById('sidebar-avatar');
const sidebarProfileName = document.getElementById('sidebar-profile-name');
const sidebarProfileEmail = document.getElementById('sidebar-profile-email');
const sidebarNavigationLinks = document.querySelectorAll('.sidebar-link[href^="#"]');
const rows = document.getElementById('session-rows');
const searchInput = document.getElementById('session-search');
const searchResultCount = document.getElementById('search-result-count');
const totalMetric = document.getElementById('metric-total');
const activeMetric = document.getElementById('metric-active');
const deviceMetrics = {
  Mobile: document.getElementById('device-mobile'),
  Desktop: document.getElementById('device-desktop'),
  Tablet: document.getElementById('device-tablet')
};
const provider = new GoogleAuthProvider();
let loginFlowActive = false;
let auditWarning = '';
let sessionRecords = [];
let sessionUnsubscribe = null;
let authGeneration = 0;
let authResolved = false;
let authTimeoutId;
let latestSessions = [];

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function updateSidebarProfile(user) {
  const displayName = user?.displayName || 'Yönetici';
  const email = user?.email || 'Yönetici hesabı';
  const initial = displayName.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'M';
  sidebarProfileName.textContent = displayName;
  sidebarProfileEmail.textContent = email;
  sidebarAvatar.replaceChildren(document.createTextNode(initial));

  if (!user?.photoURL) {
    return;
  }

  try {
    const photoURL = new URL(user.photoURL);
    if (photoURL.protocol !== 'https:') {
      return;
    }

    const image = document.createElement('img');
    image.src = photoURL.href;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      image.remove();
      sidebarAvatar.textContent = initial;
    }, { once: true });
    sidebarAvatar.replaceChildren(image);
  } catch {
    sidebarAvatar.textContent = initial;
  }
}

function stopSessionListener() {
  if (sessionUnsubscribe) {
    sessionUnsubscribe();
    sessionUnsubscribe = null;
  }
  latestSessions = [];
}

function showError(error) {
  console.error('Admin authentication or Firestore listener failed:', error);
  stopSessionListener();
  status.textContent = 'Yetki veya oturum kayıtları doğrulanamadı. Google hesabını, yayımlanmış Firestore kurallarını ve bağlantıyı kontrol et.';
  content.classList.add('hidden');
  loginConsent.classList.remove('hidden');
  loginButton.classList.remove('hidden');
  loginButton.disabled = !consentCheckbox.checked;
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
  if (!refreshedUser || refreshedUser.uid !== user.uid) {
    return null;
  }

  const tokenResult = await refreshedUser.getIdTokenResult(true);
  return isAdminUser(refreshedUser, tokenResult.claims) ? refreshedUser : null;
}

function getSessionDate(data) {
  const value = data.createdAt || data.loggedAt;
  if (value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  return null;
}

function formatTimestamp(value) {
  const date = getSessionDate({ createdAt: value });
  return date
    ? new Intl.DateTimeFormat('tr-TR', {
      dateStyle: 'medium',
      timeStyle: 'medium'
    }).format(date)
    : '—';
}

function addCell(row, value, className = '') {
  const cell = document.createElement('td');
  if (className) {
    cell.className = className;
  }
  cell.textContent = value || '—';
  row.appendChild(cell);
  return cell;
}

function renderUserCell(row, data) {
  const cell = document.createElement('td');
  const user = document.createElement('div');
  user.className = 'user-cell';
  const avatar = document.createElement('span');
  avatar.className = 'user-avatar';
  const displayName = typeof data.displayName === 'string' ? data.displayName : '';
  const photoURL = typeof data.photoURL === 'string' ? data.photoURL : '';
  const initials = displayName.trim().charAt(0).toLocaleUpperCase('tr-TR')
    || (typeof data.email === 'string' ? data.email.charAt(0).toLocaleUpperCase('tr-TR') : '?');
  avatar.textContent = initials;

  if (photoURL) {
    try {
      const imageURL = new URL(photoURL);
      if (imageURL.protocol === 'https:') {
        const image = document.createElement('img');
        image.src = imageURL.href;
        image.alt = '';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => {
          image.remove();
          avatar.textContent = initials;
        }, { once: true });
        avatar.replaceChildren(image);
      }
    } catch {
      avatar.textContent = initials;
    }
  }

  const details = document.createElement('span');
  details.className = 'user-details';
  const name = document.createElement('span');
  name.className = 'user-name';
  name.textContent = displayName || 'İsimsiz kullanıcı';
  const email = document.createElement('span');
  email.className = 'user-email';
  email.textContent = typeof data.email === 'string' ? data.email : '—';
  details.append(name, email);
  user.append(avatar, details);
  cell.appendChild(user);
  row.appendChild(cell);
}

function renderRow(data) {
  const row = document.createElement('tr');
  renderUserCell(row, data);
  addCell(row, data.uid);
  addCell(row, formatTimestamp(data.createdAt || data.loggedAt));

  const deviceCell = document.createElement('td');
  const deviceName = typeof data.deviceType === 'string' ? data.deviceType : 'Bilinmiyor';
  const deviceTag = document.createElement('span');
  deviceTag.className = 'device-tag';
  deviceTag.dataset.device = deviceName;
  deviceTag.textContent = deviceName;
  deviceCell.appendChild(deviceTag);
  if (Number.isInteger(data.batteryPercent) || typeof data.networkType === 'string') {
    const metadata = document.createElement('span');
    metadata.className = 'session-meta';
    const parts = [];
    if (typeof data.networkType === 'string' && data.networkType) {
      parts.push(data.networkType);
    }
    if (Number.isInteger(data.batteryPercent) && data.batteryPercent >= 0 && data.batteryPercent <= 100) {
      parts.push(`Pil %${data.batteryPercent}`);
    }
    metadata.textContent = parts.join(' · ');
    deviceCell.appendChild(metadata);
  }
  row.appendChild(deviceCell);

  const userAgent = addCell(row, data.userAgent, 'browser-cell');
  if (typeof data.userAgent === 'string') {
    userAgent.title = data.userAgent;
  }
  rows.appendChild(row);
}

function renderSearchResults() {
  const searchTerm = searchInput.value.trim().toLocaleLowerCase('tr-TR');
  const filteredRecords = searchTerm
    ? sessionRecords.filter((record) => record.searchText.includes(searchTerm))
    : sessionRecords;

  rows.replaceChildren();
  for (const record of filteredRecords) {
    renderRow(record.data);
  }

  if (filteredRecords.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.className = 'empty-row';
    cell.colSpan = 5;
    cell.textContent = searchTerm ? 'Aramanla eşleşen kayıt bulunamadı.' : 'Henüz oturum kaydı bulunmuyor.';
    row.appendChild(cell);
    rows.appendChild(row);
  }

  searchResultCount.textContent = searchTerm
    ? `${filteredRecords.length} / ${sessionRecords.length} kayıt gösteriliyor`
    : `${sessionRecords.length} kayıt gösteriliyor`;
}

function renderMetrics(sessions) {
  const activeUsers = new Set();
  const deviceCounts = { Mobile: 0, Desktop: 0, Tablet: 0 };
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  for (const data of sessions) {
    const sessionDate = getSessionDate(data);
    if (!sessionDate || sessionDate.getTime() < cutoff) {
      continue;
    }
    if (typeof data.uid === 'string' && data.uid.length > 0) {
      activeUsers.add(data.uid);
    }
    if (Object.hasOwn(deviceCounts, data.deviceType)) {
      deviceCounts[data.deviceType] += 1;
    }
  }

  totalMetric.textContent = sessions.length.toLocaleString('tr-TR');
  activeMetric.textContent = activeUsers.size.toLocaleString('tr-TR');
  for (const [device, element] of Object.entries(deviceMetrics)) {
    element.textContent = deviceCounts[device].toLocaleString('tr-TR');
  }
}

function updateLiveSessions(snapshot) {
  latestSessions = snapshot.docs.map((document) => document.data({
    serverTimestamps: 'estimate'
  }));
  latestSessions.sort((left, right) => (
    (getSessionDate(right)?.getTime() || 0) - (getSessionDate(left)?.getTime() || 0)
  ));

  renderMetrics(latestSessions);
  sessionRecords = latestSessions.slice(0, 100).map((data) => {
    const searchText = [
      data.displayName,
      data.email,
      data.uid,
      formatTimestamp(data.createdAt || data.loggedAt),
      data.deviceType,
      data.userAgent,
      data.networkType,
      Number.isInteger(data.batteryPercent) ? `${data.batteryPercent}%` : ''
    ]
      .filter((value) => typeof value === 'string')
      .join(' ')
      .toLocaleLowerCase('tr-TR');
    return { data, searchText };
  });
  renderSearchResults();

  const resultMessage = latestSessions.length === 0
    ? 'Yönetici hesabı doğrulandı. Henüz oturum kaydı bulunmuyor.'
    : `${sessionRecords.length} son kayıt gösteriliyor; veriler canlı güncelleniyor.`;
  status.textContent = auditWarning
    ? `${resultMessage} ${auditWarning}`
    : resultMessage;
  content.classList.remove('hidden');
  loginButton.classList.add('hidden');
}

function startSessionListener() {
  stopSessionListener();
  status.textContent = 'Oturum kayıtları canlı olarak yükleniyor...';
  try {
    sessionUnsubscribe = onSnapshot(
      collection(firebaseDatabase, 'sessions'),
      updateLiveSessions,
      showError
    );
  } catch (error) {
    showError(error);
  }
}

function showUnauthorized() {
  stopSessionListener();
  status.textContent = `Yönetici erişimi yalnızca ${adminEmail} adresine sahip doğrulanmış Google hesabına açıktır.`;
  content.classList.add('hidden');
  loginConsent.classList.remove('hidden');
  loginButton.classList.remove('hidden');
  loginButton.disabled = !consentCheckbox.checked;
}

async function handleAuthStateChanged(user, generation) {
  updateSidebarProfile(user);
  if (loginFlowActive || generation !== authGeneration) {
    return;
  }

  stopSessionListener();
  if (!user) {
    content.classList.add('hidden');
    status.textContent = 'Yönetici hesabıyla devam etmek için Google ile giriş yap.';
    loginConsent.classList.remove('hidden');
    loginButton.classList.remove('hidden');
    loginButton.disabled = !consentCheckbox.checked;
    return;
  }

  status.textContent = 'Yönetici hesabı güvenli şekilde doğrulanıyor...';
  try {
    const adminUser = await withTimeout(
      verifyAdminUser(user),
      12000,
      'Yönetici hesabı 12 saniye içinde doğrulanamadı.'
    );
    if (generation !== authGeneration) {
      return;
    }
    if (!adminUser) {
      try {
        await signOut(firebaseAuth);
      } catch (error) {
        console.error('Could not sign out a non-admin user:', error);
      }
      showUnauthorized();
      return;
    }

    loginConsent.classList.add('hidden');
    loginButton.classList.add('hidden');
    startSessionListener();
  } catch (error) {
    if (generation === authGeneration) {
      showError(error);
    }
  }
}

searchInput.addEventListener('input', renderSearchResults);

sidebarNavigationLinks.forEach((link) => {
  link.addEventListener('click', () => {
    sidebarNavigationLinks.forEach((navigationLink) => {
      navigationLink.classList.remove('active');
      navigationLink.removeAttribute('aria-current');
    });
    link.classList.add('active');
    link.setAttribute('aria-current', 'page');
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey
    && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = '';
    renderSearchResults();
    searchInput.blur();
  }
});

loginButton.addEventListener('click', async (event) => {
  event.preventDefault();
  if (!consentCheckbox.checked || loginFlowActive) {
    return;
  }

  loginButton.disabled = true;
  loginFlowActive = true;
  status.textContent = 'Google hesabı doğrulanıyor...';
  try {
    const credential = await signInWithPopup(firebaseAuth, provider);
    const adminUser = await withTimeout(
      verifyAdminUser(credential.user),
      12000,
      'Yönetici hesabı 12 saniye içinde doğrulanamadı.'
    );
    if (!adminUser) {
      try {
        await signOut(firebaseAuth);
      } catch (error) {
        console.error('Could not sign out a non-admin user:', error);
      }
      showUnauthorized();
      return;
    }

    try {
      await recordUserSession(adminUser);
      auditWarning = '';
    } catch (error) {
      console.error('Admin sign-in session record could not be saved:', error);
      auditWarning = 'Bu girişin oturum kaydı yazılamadı; Firestore kurallarını ve bağlantıyı kontrol et.';
    }

    loginConsent.classList.add('hidden');
    loginButton.classList.add('hidden');
    startSessionListener();
  } catch (error) {
    showError(error);
  } finally {
    loginFlowActive = false;
    loginButton.disabled = !consentCheckbox.checked;
  }
});

consentCheckbox.addEventListener('change', () => {
  loginButton.disabled = !consentCheckbox.checked || loginFlowActive;
});

authTimeoutId = setTimeout(() => {
  if (!authResolved) {
    showError(new Error('Firebase Authentication başlangıç durumu 12 saniyede yanıt vermedi.'));
  }
}, 12000);

onAuthStateChanged(firebaseAuth, (user) => {
  authResolved = true;
  clearTimeout(authTimeoutId);
  const generation = ++authGeneration;
  void handleAuthStateChanged(user, generation).catch(showError);
}, (error) => {
  authResolved = true;
  clearTimeout(authTimeoutId);
  showError(error);
});
