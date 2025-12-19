// src/services/config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.2/firebase-app.js";

const DEV_HOSTS = ["localhost", "127.0.0.1", "prive-jo-dev.web.app"];
export const IS_DEV = DEV_HOSTS.includes(window.location.hostname);

const firebaseConfigDev = {
    apiKey: "AIzaSyAj22s14JWQpYsqU5qxqJXZRPvkd1RE6Lk",
    authDomain: "prive-jo-dev.firebaseapp.com",
    projectId: "prive-jo-dev",
    storageBucket: "prive-jo-dev.firebasestorage.app",
    messagingSenderId: "256555974148",
    appId: "1:256555974148:web:dd1e56b662020b8cd43f51"
};

const firebaseConfigProd = {
    apiKey: "AIzaSyBkVwWdSNwlPWjeNT_BRb7pFzkeVB2VT3Q",
    authDomain: "prive-jo.firebaseapp.com",
    projectId: "prive-jo",
    storageBucket: "prive-jo.firebasestorage.app",
    messagingSenderId: "849510732758",
    appId: "1:849510732758:web:6c506a7f7adcc5c1310a77",
    measurementId: "G-HN213KC33L"
};

export const app = initializeApp(IS_DEV ? firebaseConfigDev : firebaseConfigProd);