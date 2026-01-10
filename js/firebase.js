// Initialize Firebase and export auth/db so other modules don't create circular imports

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const app = initializeApp({
  apiKey:"AIzaSyA32Jc5l0jcWW9iAT3q1gUEUsthN6QkY1k",
  authDomain:"math-katy.firebaseapp.com",
  projectId:"math-katy"
});

export const auth = getAuth(app);
export const db = getFirestore(app);
