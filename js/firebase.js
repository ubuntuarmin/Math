// Initialize Firebase and export auth/db/rtdb so other modules don't create circular imports

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-database.js";

const app = initializeApp({
  apiKey:"AIzaSyA32Jc5l0jcWW9iAT3q1gUEUsthN6QkY1k",
  authDomain:"math-katy.firebaseapp.com",
  projectId:"math-katy",
  databaseURL:"https://math-katy-default-rtdb.firebaseio.com"
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
