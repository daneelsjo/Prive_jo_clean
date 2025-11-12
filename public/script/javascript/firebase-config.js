// Script/Javascript/firebase-config.js
// Eén centrale plek voor Firebase-config + exports uit dezelfde SDK-versie.

import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.5.2/firebase-app.js";

// Publieke webconfig (mag client-side; beveilig via HTTP referrers + Firestore rules + App Check)
export const firebaseConfig = {
    apiKey: "AIzaSyBkVwWdSNwlPWjeNT_BRb7pFzkeVB2VT3Q",
    authDomain: "prive-jo.firebaseapp.com",
    projectId: "prive-jo",
    storageBucket: "prive-jo.firebasestorage.app",
    messagingSenderId: "849510732758",
    appId: "1:849510732758:web:6c506a7f7adcc5c1310a77",
    measurementId: "G-HN213KC33L"
};

export function getFirebaseApp() {
    return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

// ---- Exports: Auth ----
export {
    getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.5.2/firebase-auth.js";

// ---- Exports: Firestore (LET OP: inclusief query/orderBy/getDoc!) ----
export {
    getFirestore, collection, addDoc, onSnapshot, doc, setDoc, getDoc, updateDoc,
    deleteDoc, serverTimestamp, deleteField, query, orderBy, where,getDocs
} from "https://www.gstatic.com/firebasejs/10.5.2/firebase-firestore.js";
