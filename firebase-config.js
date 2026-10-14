import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-functions.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDnDvAilHhDU1NrctC5bclxn63t2L9RFuM',
  authDomain: 'mesutxo.firebaseapp.com',
  projectId: 'mesutxo',
  storageBucket: 'mesutxo.firebasestorage.app',
  messagingSenderId: '95176426607',
  appId: '1:95176426607:web:e4ff44a672bd6675c3399a',
  measurementId: 'G-7JXDR8XPWZ'
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDatabase = getFirestore(firebaseApp);
export const firebaseFunctions = getFunctions(firebaseApp, 'us-central1');
export const adminEmail = 'mes223ut@gmail.com';
