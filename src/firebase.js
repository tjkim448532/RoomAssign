import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// TODO: Replace with your Firebase config
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyC8qpRx-r4MZZV2znj5d_Y6pAtH9TJHrlU",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "roomassign-f04a6.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "roomassign-f04a6",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "roomassign-f04a6.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "512620035420",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:512620035420:web:b86d9333c256074ded1599"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
