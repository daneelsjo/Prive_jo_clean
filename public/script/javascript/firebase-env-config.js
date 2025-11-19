// Firebase config voor DEV omgeving
const firebaseConfigDev = {
apiKey: "AIzaSyAj22s14JWQpYsqU5qxqJXZRPvkd1RE6Lk",
  authDomain: "prive-jo-dev.firebaseapp.com",
  projectId: "prive-jo-dev",
  storageBucket: "prive-jo-dev.firebasestorage.app",
  messagingSenderId: "256555974148",
  appId: "1:256555974148:web:dd1e56b662020b8cd43f51"
}

// Firebase config voor MAIN omgeving
const firebaseConfigProd = {
apiKey: "AIzaSyBkVwWdSNwlPWjeNT_BRb7pFzkeVB2VT3Q",
    authDomain: "prive-jo.firebaseapp.com",
    projectId: "prive-jo",
    storageBucket: "prive-jo.firebasestorage.app",
    messagingSenderId: "849510732758",
    appId: "1:849510732758:web:6c506a7f7adcc5c1310a77",
    measurementId: "G-HN213KC33L"
}

// Hostnamen die jij als DEV beschouwt
const DEV_HOSTS = [
"localhost",
"127.0.0.1",
"prive-jo-dev.web.app",
"prive-jo-dev.firebaseapp.com"
]

// Huidige host bepalen
const currentHost = window.location.hostname

// Bepalen of dit DEV is
const IS_DEV_ENV = DEV_HOSTS.includes(currentHost)

// De config die de rest van je code gaat gebruiken
const firebaseConfig = IS_DEV_ENV ? firebaseConfigDev : firebaseConfigProd

// Eventueel nuttig voor thema en debugging
window.APP_ENV = IS_DEV_ENV ? "DEV" : "MAIN"