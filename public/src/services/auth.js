// src/services/auth.js
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } 
from "https://www.gstatic.com/firebasejs/10.5.2/firebase-auth.js";
import { app } from "./config.js";

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export const login = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Login mislukt:", error);
        throw error;
    }
};

export const logout = () => signOut(auth);

// Deze functie gebruiken we op de landingspagina om te luisteren
export const watchUser = (callback) => {
    return onAuthStateChanged(auth, callback);
};

export const getCurrentUser = () => auth.currentUser;