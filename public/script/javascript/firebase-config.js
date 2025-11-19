// Script/Javascript/firebase-config.js
// Centrale Firebase config met DEV vs MAIN op basis van hostname

import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.5.2/firebase-app.js";

// Hostnamen die als DEV tellen
const DEV_HOSTS = [
"localhost",
"127.0.0.1",
"prive-jo-dev.web.app",
"prive-jo-dev.firebaseapp.com"
];

const currentHost = window.location.hostname;
const IS_DEV_ENV = DEV_HOSTS.includes(currentHost);

// Firebase config voor DEV omgeving
const firebaseConfigDev = {
apiKey: "AIzaSyAj22s14JWQpYsqU5qxqJXZRPvkd1RE6Lk",
authDomain: "prive-jo-dev.firebaseapp.com",
projectId: "prive-jo-dev",
storageBucket: "prive-jo-dev.firebasestorage.app",
messagingSenderId: "256555974148",
appId: "1:256555974148:web:dd1e56b662020b8cd43f51"
};

// Firebase config voor MAIN omgeving
const firebaseConfigProd = {
apiKey: "AIzaSyBkVwWdSNwlPWjeNT_BRb7pFzkeVB2VT3Q",
authDomain: "prive-jo.firebaseapp.com",
projectId: "prive-jo",
storageBucket: "prive-jo.firebasestorage.app",
messagingSenderId: "849510732758",
appId: "1:849510732758:web:6c506a7f7adcc5c1310a77",
measurementId: "G-HN213KC33L"
};

// Config die de rest van de app gebruikt
export const firebaseConfig = IS_DEV_ENV ? firebaseConfigDev : firebaseConfigProd;

// Handige vlag voor UI en debugging
window.APP_ENV = IS_DEV_ENV ? "DEV" : "MAIN";

export function getFirebaseApp() {
return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

// Auth exports
export {
getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.5.2/firebase-auth.js";

// Firestore exports
export {
getFirestore, collection, addDoc, onSnapshot, doc, setDoc, getDoc, updateDoc,
deleteDoc, serverTimestamp, deleteField, query, orderBy, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.5.2/firebase-firestore.js";