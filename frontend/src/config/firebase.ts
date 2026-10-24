import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

export const firebaseConfig = {
  apiKey: "AIzaSyAqoObWgdeCrFgmQGwmzK6WtRXbDPrx5K4",
  authDomain: "triwizathon.firebaseapp.com",
  projectId: "triwizathon",
  storageBucket: "triwizathon.firebasestorage.app",
  messagingSenderId: "945748098990",
  appId: "1:945748098990:web:1baa5069453b1d8d28123f",
  measurementId: "G-WXQD34J2K4"
};

export const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const firebaseAuth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);
export const firebaseStorage = getStorage(firebaseApp);
