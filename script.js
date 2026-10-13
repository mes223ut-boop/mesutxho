import { adminEmail, firebaseAuth } from './firebase-config.js?v=20261013-3';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { recordUserSession } from './session-records.js?v=20261013-3';

const loginScreen = document.getElementById('login-screen');
const socialScreen = document.getElementById('social-screen');
const loginButton = document.getElementById('google-login');
const consentCheckbox = document.getElementById('privacy-consent');
const loginNote = document.getElementById('login-note');
const logoutButton = document.getElementById('logout-button');
const adminLink = document.getElementById('admin-link');
const socialStatus = document.getElementById('social-status');
const backgroundVideo = document.querySelector('.background-video');
const backgroundAudio = document.getElementById('background-audio');
const audioControl = document.querySelector('.audio-control');
const audioToggle = document.getElementById('audio-toggle');
const volumeSlider = document.getElementById('volume-slider');
const googleProvider = new GoogleAuthProvider();

let signingIn = false;
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
  return backgroundAudio.play().catch((error) => {
    if (error.name !== 'NotAllowedError' || reportFailure) {
      console.warn('Background music playback failed:', error);
      loginNote.textContent = 'Müzik başlatılamadı. Sağ üstteki oynat düğmesine dokun.';
    }
    return false;
  });
}

function showSocials() {
  loginScreen.classList.add('hidden');
  socialScreen.classList.remove('hidden');
}

function showLogin() {
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

function getSignInErrorMessage(error) {
  if (error.code === 'auth/popup-closed-by-user') {
    return 'Google giriş penceresi kapatıldı. Tekrar deneyebilirsin.';
  }
  if (error.code === 'auth/unauthorized-domain') {
    return 'Bu site Firebase Authentication yetkili alan adlarında değil. Firebase Console > Authentication > Settings bölümüne bu alan adını ekle.';
  }
  if (error.code === 'auth/popup-blocked') {
    return 'Tarayıcı giriş penceresini engelledi. Açılır pencerelere izin verip tekrar dene.';
  }
  if (error.code === 'auth/configuration-not-found') {
    return 'Firebase Authentication yapılandırılmamış. Firebase Console’da Authentication hizmetini ve Google girişini etkinleştir.';
  }
  return `Google girişi tamamlanamadı (${error.code || 'beklenmeyen hata'}). Firebase Authentication ayarlarını kontrol et.`;
}

async function handleGoogleSignIn(event) {
  event.preventDefault();
  if (!consentCheckbox.checked || signingIn) {
    return;
  }

  signingIn = true;
  loginButton.disabled = true;
  loginNote.textContent = 'Google hesabı açılıyor...';

  try {
    const credential = await signInWithPopup(firebaseAuth, googleProvider);
    showSocials();
    updateAdminLink(credential.user);
    loginNote.textContent = 'Oturum kaydı oluşturuluyor...';

    try {
      await recordUserSession(credential.user);
      socialStatus.textContent = 'Giriş yapıldı; oturum kaydedildi.';
    } catch (error) {
      console.error('Session record could not be saved:', error);
      socialStatus.textContent = 'Giriş yapıldı ancak oturum kaydı oluşturulamadı. Firestore kurallarını ve bağlantıyı kontrol et.';
    }

    void playMusic(true);
  } catch (error) {
    console.error('Google sign-in failed:', error);
    loginNote.textContent = error.code?.startsWith('auth/')
      ? getSignInErrorMessage(error)
      : `Giriş tamamlanamadı (${error.code || 'beklenmeyen hata'}). Tekrar deneyebilirsin.`;
  } finally {
    signingIn = false;
    loginButton.disabled = !consentCheckbox.checked;
  }
}

consentCheckbox.addEventListener('change', () => {
  loginButton.disabled = !consentCheckbox.checked || signingIn;
  if (consentCheckbox.checked) {
    loginNote.textContent = '';
  }
});

loginButton.addEventListener('click', handleGoogleSignIn);

logoutButton.addEventListener('click', async () => {
  try {
    await signOut(firebaseAuth);
    showLogin();
    loginNote.textContent = '';
  } catch (error) {
    console.error('Sign-out failed:', error);
    loginNote.textContent = 'Çıkış yapılamadı. Tekrar deneyebilirsin.';
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

function startMusicAfterFirstInteraction(event) {
  if (event.target instanceof Element && audioToggle.contains(event.target)) {
    return;
  }

  document.removeEventListener('pointerdown', startMusicAfterFirstInteraction, true);
  document.removeEventListener('touchstart', startMusicAfterFirstInteraction, true);
  document.removeEventListener('keydown', startMusicAfterFirstInteraction, true);
  void playMusic(true);
}

document.addEventListener('pointerdown', startMusicAfterFirstInteraction, true);
document.addEventListener('touchstart', startMusicAfterFirstInteraction, { capture: true, passive: true });
document.addEventListener('keydown', startMusicAfterFirstInteraction, true);

onAuthStateChanged(firebaseAuth, (user) => {
  if (signingIn) {
    return;
  }
  if (user) {
    showSocials();
    updateAdminLink(user);
  } else {
    showLogin();
  }
}, (error) => {
  console.error('Firebase authentication state failed:', error);
  loginNote.textContent = 'Giriş durumu doğrulanamadı. Sayfayı yenileyip tekrar dene.';
});

startBackgroundVideo();
backgroundAudio.load();
void playMusic();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    startBackgroundVideo();
  }
});
