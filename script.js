import {
  adminEmail,
  firebaseAuth,
  firebaseDatabase,
  firebaseFunctions
} from './firebase-config.js?v=20261014-7';
import {
  recordUserSession,
  updateSessionDuration
} from './session-records.js?v=20261014-7';
import {
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-functions.js';
import {
  doc,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

const sitePage = document.getElementById('site-page');
const accessState = document.getElementById('access-state');
const accessMessage = document.getElementById('access-message');
const accessRetry = document.getElementById('access-retry');
const blockedState = document.getElementById('blocked-state');
const blockedTitle = document.getElementById('blocked-title');
const blockedMessage = document.getElementById('blocked-message');
const loginScreen = document.getElementById('login-screen');
const socialScreen = document.getElementById('social-screen');
const loginButton = document.getElementById('google-login');
const appleLoginButton = document.getElementById('apple-login');
const guestButton = document.getElementById('guest-button');
const consentCheckbox = document.getElementById('privacy-consent');
const socialConsentCheckbox = document.getElementById('social-privacy-consent');
const loginNote = document.getElementById('login-note');
const logoutButton = document.getElementById('logout-button');
const adminLink = document.getElementById('admin-link');
const socialStatus = document.getElementById('social-status');
const backgroundVideo = document.querySelector('.background-video');
const backgroundAudio = document.getElementById('background-audio');
const audioControl = document.querySelector('.audio-control');
const audioToggle = document.getElementById('audio-toggle');
const volumeSlider = document.getElementById('volume-slider');
const checkAccessCallable = httpsCallable(firebaseFunctions, 'checkAccess', { timeout: 5000 });
const googleProvider = new GoogleAuthProvider();
const appleProvider = new OAuthProvider('apple.com');
const consentStorageKey = 'mesutxho-privacy-consent-v7';

let currentUser = null;
let authReady = false;
let loginBusy = false;
let localGuest = false;
let accessDenied = false;
let accessCheckPromise = null;
let accessCheckUnavailable = false;
let profileUnsubscribe = null;
let loggedVisitKeys = new Set();
let accessTimer = null;
let durationTimer = null;
let activeSession = null;
let lastInteractionAt = Date.now();
let authTimeoutId;

try {
  consentCheckbox.checked = sessionStorage.getItem(consentStorageKey) === 'accepted';
  socialConsentCheckbox.checked = consentCheckbox.checked;
} catch (error) {
  console.warn('Session storage is unavailable; consent will not persist for this tab:', error);
}

backgroundAudio.volume = Number(volumeSlider.value);

function startBackgroundVideo() {
  if (!backgroundVideo.paused) {
    return;
  }
  backgroundVideo.play().catch((error) => {
    console.warn('Background video playback was blocked:', error);
  });
}

function updateAudioControl() {
  const playing = !backgroundAudio.paused;
  audioControl.classList.toggle('is-playing', playing);
  audioToggle.setAttribute('aria-label', playing ? 'Pause music' : 'Play music');
  audioToggle.title = playing ? 'Pause music' : 'Play music';
}

function playMusic(reportFailure = false) {
  return backgroundAudio.play().then(() => true).catch((error) => {
    if (error.name !== 'NotAllowedError' || reportFailure) {
      console.warn('Background music playback failed:', error);
      loginNote.textContent = 'Müzik başlatılamadı. Oynat düğmesine dokunarak tekrar deneyebilirsin.';
    }
    return false;
  });
}

function showSocials() {
  socialConsentCheckbox.checked = consentCheckbox.checked;
  loginScreen.classList.add('hidden');
  socialScreen.classList.remove('hidden');
}

function showLogin() {
  consentCheckbox.checked = socialConsentCheckbox.checked;
  socialScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  adminLink.classList.add('hidden');
  socialStatus.textContent = '';
}

function updateAdminLink(user) {
  const isAdmin = Boolean(user?.emailVerified)
    && user.email?.toLowerCase() === adminEmail
    && user.providerData.some((providerData) => providerData.providerId === 'google.com');
  adminLink.classList.toggle('hidden', !isAdmin);
}

function updateLoginButtons() {
  loginButton.disabled = loginBusy;
  appleLoginButton.disabled = loginBusy;
  guestButton.disabled = loginBusy;
}

function stopProfileListener() {
  if (profileUnsubscribe) {
    profileUnsubscribe();
    profileUnsubscribe = null;
  }
}

async function showBlocked(reason) {
  accessDenied = true;
  sitePage.classList.add('hidden');
  accessState.classList.add('hidden');
  blockedState.classList.remove('hidden');
  if (reason === 'ip') {
    blockedTitle.textContent = 'IP Adresiniz Engellendi!';
    blockedMessage.textContent = 'Bu siteye erişiminiz yasaklanmıştır.';
  } else {
    blockedTitle.textContent = 'Hesabınız engellendi';
    blockedMessage.textContent = 'Bu hesapla siteye erişim izni bulunmuyor.';
  }
  if (currentUser) {
    try {
      await signOut(firebaseAuth);
    } catch (error) {
      console.error('Engellenen kullanıcının oturumu kapatılamadı:', error);
    }
  }
}

function showAccessFailure(error) {
  if (!accessCheckUnavailable) {
    const detail = error instanceof Error ? error.message : 'Erişim denetimi şu anda yanıt vermiyor.';
    console.warn('Erişim denetimi şu anda kullanılamıyor; site erişimi sürdürülüyor.', detail);
    accessCheckUnavailable = true;
  }
  authReady = true;
  accessDenied = false;
  showApp();
}

function showApp() {
  accessState.classList.add('hidden');
  blockedState.classList.add('hidden');
  sitePage.classList.remove('hidden');
  if (currentUser) {
    localGuest = false;
    showSocials();
    updateAdminLink(currentUser);
    return;
  }
  if (localGuest) {
    showSocials();
    updateAdminLink(null);
    socialStatus.textContent = 'Misafir Ziyaretçi olarak devam ediyorsun. Bu oturumda giriş yapılmadı.';
    return;
  }
  showLogin();
}

async function recordCurrentVisit() {
  if (!consentCheckbox.checked) {
    return;
  }
  const visitKey = currentUser?.uid || 'anonymous';
  if (loggedVisitKeys.has(visitKey)) {
    return;
  }
  loggedVisitKeys.add(visitKey);
  const visitStartedAt = Date.now();
  try {
    const result = await recordUserSession(currentUser);
    activeSession = {
      id: result.sessionId,
      token: result.durationToken,
      startedAt: visitStartedAt
    };
    if (durationTimer !== null) {
      window.clearInterval(durationTimer);
    }
    durationTimer = window.setInterval(() => {
      void persistSessionDuration();
    }, 15000);
    if (result.geoStatus === 'unavailable') {
      socialStatus.textContent = 'Oturum kaydedildi; şehir/ülke bilgisi GeoIP servisinden alınamadı.';
    } else {
      socialStatus.textContent = 'Oturum kaydedildi.';
    }
  } catch (error) {
    loggedVisitKeys.delete(visitKey);
    console.error('Oturum kaydı Firebase’e yazılamadı:', error);
    const message = 'Onaylı ziyaret kaydı oluşturulamadı. Bağlantıyı ve Firebase Functions dağıtımını kontrol et.';
    if (currentUser || localGuest) {
      socialStatus.textContent = message;
    } else {
      loginNote.textContent = message;
    }
  }
}

async function persistSessionDuration() {
  if (!activeSession || !consentCheckbox.checked) return;
  const durationSeconds = Math.floor((Date.now() - activeSession.startedAt) / 1000);
  const active = Date.now() - lastInteractionAt <= 60 * 1000;
  try {
    await updateSessionDuration(activeSession.id, activeSession.token, durationSeconds, active);
  } catch (error) {
    console.error('Oturum süresi Firebase’de güncellenemedi:', error);
    if (durationTimer !== null) {
      window.clearInterval(durationTimer);
      durationTimer = null;
    }
    socialStatus.textContent = 'Oturum kaydı alındı; geçirilen süre güncellenemedi.';
  }
}

async function refreshAccess() {
  if (!authReady || accessDenied) {
    return false;
  }
  if (accessCheckPromise) {
    return accessCheckPromise;
  }

  if (!sitePage.classList.contains('hidden')) {
    accessMessage.textContent = 'Erişim güvenli şekilde yeniden kontrol ediliyor...';
  }
  accessRetry.classList.add('hidden');
  accessCheckPromise = (async () => {
    try {
      const result = await checkAccessCallable();
      if (result.data?.allowed === false) {
        await showBlocked(result.data.reason);
        return false;
      }
      accessCheckUnavailable = false;
      showApp();
      if (consentCheckbox.checked) {
        void recordCurrentVisit();
      }
      return true;
    } catch (error) {
      showAccessFailure(error);
      if (consentCheckbox.checked) {
        void recordCurrentVisit();
      }
      return true;
    } finally {
      accessCheckPromise = null;
    }
  })();
  return accessCheckPromise;
}

function watchUserBan(user) {
  stopProfileListener();
  if (!user) {
    return;
  }

  profileUnsubscribe = onSnapshot(doc(firebaseDatabase, 'users', user.uid), (snapshot) => {
    if (snapshot.exists() && snapshot.data().banned === true) {
      void showBlocked('user');
    }
  }, (error) => {
    console.warn('Kullanıcı ban durumu geçici olarak doğrulanamıyor:', error);
  });
}

function getSignInErrorMessage(error, providerName) {
  if (error.code === 'auth/popup-closed-by-user') {
    return `${providerName} giriş penceresi kapatıldı. Tekrar deneyebilirsin.`;
  }
  if (error.code === 'auth/unauthorized-domain') {
    return 'Bu alan adı Firebase Authentication yetkili alan adlarında değil. Firebase Console > Authentication > Settings bölümüne ekle.';
  }
  if (error.code === 'auth/popup-blocked') {
    return 'Tarayıcı giriş penceresini engelledi. Açılır pencerelere izin verip tekrar dene.';
  }
  if (error.code === 'auth/configuration-not-found' || error.code === 'auth/operation-not-allowed') {
    return `Firebase Authentication'da ${providerName} sağlayıcısını etkinleştirip tekrar dene.`;
  }
  return `${providerName} girişi tamamlanamadı (${error.code || 'beklenmeyen hata'}). Sağlayıcı ayarlarını kontrol et.`;
}

async function handleProviderSignIn(provider, providerName) {
  if (loginBusy) {
    return;
  }
  loginBusy = true;
  updateLoginButtons();
  loginNote.textContent = `${providerName} hesabı açılıyor...`;

  try {
    if (consentCheckbox.checked) {
      try {
        sessionStorage.setItem(consentStorageKey, 'accepted');
      } catch (error) {
        console.warn('Consent could not be stored for this tab:', error);
      }
    }
    await signInWithPopup(firebaseAuth, provider);
    await refreshAccess();
    if (!accessDenied && currentUser) {
      void recordCurrentVisit();
    }
  } catch (error) {
    console.error(`${providerName} girişi başarısız:`, error);
    loginNote.textContent = error.code?.startsWith('auth/')
      ? getSignInErrorMessage(error, providerName)
      : `Giriş tamamlanamadı (${error.code || 'beklenmeyen hata'}). Tekrar deneyebilirsin.`;
  } finally {
    loginBusy = false;
    updateLoginButtons();
  }
}

function handleConsentChange(accepted) {
  consentCheckbox.checked = accepted;
  socialConsentCheckbox.checked = accepted;
  updateLoginButtons();
  loginNote.textContent = '';
  try {
    if (accepted) {
      sessionStorage.setItem(consentStorageKey, 'accepted');
    } else {
      sessionStorage.removeItem(consentStorageKey);
    }
  } catch (error) {
    console.warn('Consent preference could not be saved for this tab:', error);
  }
  if (accepted) {
    void recordCurrentVisit();
  } else {
    loggedVisitKeys = new Set();
    activeSession = null;
    if (durationTimer !== null) {
      window.clearInterval(durationTimer);
      durationTimer = null;
    }
    socialStatus.textContent = 'Bu ziyaret için yeni oturum kaydı tutulmayacak.';
  }
}

consentCheckbox.addEventListener('change', () => {
  handleConsentChange(consentCheckbox.checked);
});

socialConsentCheckbox.addEventListener('change', () => {
  handleConsentChange(socialConsentCheckbox.checked);
});

loginButton.addEventListener('click', () => {
  void handleProviderSignIn(googleProvider, 'Google');
});

appleProvider.addScope('email');
appleProvider.addScope('name');
appleLoginButton.addEventListener('click', () => {
  void handleProviderSignIn(appleProvider, 'Apple');
});

guestButton.addEventListener('click', async () => {
  if (loginBusy) {
    return;
  }
  loginBusy = true;
  updateLoginButtons();
  loginNote.textContent = '';
  try {
    if (currentUser) await signOut(firebaseAuth);
    currentUser = null;
    localGuest = true;
    await refreshAccess();
    if (!accessDenied && consentCheckbox.checked) {
      void recordCurrentVisit();
    }
  } catch (error) {
    console.error('Misafir oturumu açılamadı:', error);
    loginNote.textContent = 'Misafir erişimi başlatılamadı. Tekrar dene.';
  } finally {
    loginBusy = false;
    updateLoginButtons();
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    if (currentUser) {
      await signOut(firebaseAuth);
    }
    localGuest = false;
    showLogin();
    loginNote.textContent = '';
  } catch (error) {
    console.error('Çıkış yapılamadı:', error);
    socialStatus.textContent = 'Çıkış yapılamadı. Tekrar deneyebilirsin.';
  }
});

audioToggle.addEventListener('click', () => {
  if (backgroundAudio.paused) {
    void playMusic(true);
  } else {
    backgroundAudio.pause();
  }
});

volumeSlider.addEventListener('input', () => {
  backgroundAudio.volume = Number(volumeSlider.value);
});

backgroundAudio.addEventListener('play', updateAudioControl);
backgroundAudio.addEventListener('pause', updateAudioControl);
backgroundAudio.addEventListener('volumechange', updateAudioControl);

let audioStartPromise = null;

function startMusicAfterFirstInteraction(event) {
  if (event.target instanceof Element && audioToggle.contains(event.target)) {
    return;
  }
  if (audioStartPromise) return;
  audioStartPromise = playMusic();
  void audioStartPromise.then((playing) => {
    audioStartPromise = null;
    if (!playing) return;
    document.removeEventListener('pointerdown', startMusicAfterFirstInteraction, true);
    document.removeEventListener('touchstart', startMusicAfterFirstInteraction, true);
    document.removeEventListener('click', startMusicAfterFirstInteraction, true);
    document.removeEventListener('keydown', startMusicAfterFirstInteraction, true);
  });
}

document.addEventListener('pointerdown', startMusicAfterFirstInteraction, true);
document.addEventListener('touchstart', startMusicAfterFirstInteraction, { capture: true, passive: true });
document.addEventListener('click', startMusicAfterFirstInteraction, true);
document.addEventListener('keydown', startMusicAfterFirstInteraction, true);

accessRetry.addEventListener('click', () => {
  if (!authReady) {
    window.location.reload();
    return;
  }
  void refreshAccess();
});

authTimeoutId = window.setTimeout(() => {
  if (!authReady) {
    showAccessFailure(new Error('Firebase Authentication başlangıç durumu zaman aşımına uğradı.'));
  }
}, 5000);

onAuthStateChanged(firebaseAuth, (user) => {
  window.clearTimeout(authTimeoutId);
  if (currentUser?.uid !== user?.uid) {
    loggedVisitKeys = new Set();
    activeSession = null;
    if (durationTimer !== null) {
      window.clearInterval(durationTimer);
      durationTimer = null;
    }
  }
  currentUser = user;
  authReady = true;
  watchUserBan(user);
  void refreshAccess();
}, (error) => {
  window.clearTimeout(authTimeoutId);
  authReady = true;
  showAccessFailure(error);
});

accessTimer = window.setInterval(() => {
  if (!document.hidden && authReady && !accessDenied) {
    void refreshAccess();
  }
}, 30000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    void persistSessionDuration();
    return;
  }
  startBackgroundVideo();
  void refreshAccess();
});

for (const eventName of ['pointerdown', 'keydown', 'touchstart', 'scroll', 'input']) {
  document.addEventListener(eventName, () => {
    lastInteractionAt = Date.now();
  }, { passive: true });
}

startBackgroundVideo();
backgroundAudio.load();
void playMusic();
document.addEventListener('DOMContentLoaded', () => {
  if (backgroundAudio.paused) {
    void playMusic();
  }
}, { once: true });
window.addEventListener('load', () => {
  if (backgroundAudio.paused) {
    void playMusic();
  }
}, { once: true });
window.addEventListener('beforeunload', () => {
  void persistSessionDuration();
  if (accessTimer !== null) {
    window.clearInterval(accessTimer);
  }
  if (durationTimer !== null) {
    window.clearInterval(durationTimer);
  }
  stopProfileListener();
});
