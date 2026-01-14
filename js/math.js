import { db, auth } from "./firebase.js";
import { doc, getDoc, updateDoc, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// 1. Find the HTML elements
const modal = document.getElementById("mathModal");
const startBtn = document.getElementById("startMathBtn");
const equationDisplay = document.getElementById("equationDisplay");
const optionsContainer = document.getElementById("answerOptions");
const timerDisplay = document.getElementById("mathTimer");
const progress = document.getElementById("mathProgress");

let count = 1;
let target = 0;
let timer;
let timeLeft = 14.0;

export function initMath() {
    startBtn.onclick = async () => {
        // Checking the 6-hour rule in the database
        const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
        const last = snap.data().lastMathChallenge?.toMillis() || 0;
        
        if (Date.now() - last < 6 * 60 * 60 * 1000) {
            alert("Cooldown active! Try again later.");
            return;
        }
        startRunning();
    };
}

function startRunning() {
    count = 1;
    timeLeft = 14.0;
    modal.classList.remove("hidden");
    nextQuest();
    
    timer = setInterval(() => {
        timeLeft -= 0.1;
        timerDisplay.textContent = timeLeft.toFixed(1) + "s";
        if (timeLeft <= 0) finish(false);
    }, 100);
}

function nextQuest() {
    document.getElementById("questionCounter").textContent = `${count}/10`;
    progress.style.width = `${(count / 10) * 100}%`;

    const num1 = Math.floor(Math.random() * 8) + 2;
    const num2 = Math.floor(Math.random() * 8) + 2;
    target = num1 * num2;
    equationDisplay.textContent = `${num1} × ${num2}`;

    // Create 4 buttons
    let choices = [target, target+2, target-2, target+5].sort(() => Math.random() - 0.5);
    optionsContainer.innerHTML = choices.map(c => `
        <button onclick="checkAnswer(${c})" class="modern-card py-4 font-bold hover:bg-blue-600 transition">
            ${c}
        </button>
    `).join("");
}

// THIS IS WHAT THE HTML BUTTON LOOKS FOR
window.checkAnswer = (val) => {
    if (val === target) {
        if (count >= 10) finish(true);
        else { count++; nextQuest(); }
    } else { finish(false); }
};

async function finish(win) {
    clearInterval(timer);
    modal.classList.add("hidden");
    if (win) {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
            credits: increment(15),
            totalEarned: increment(15),
            lastMathChallenge: serverTimestamp()
        });
        alert("Success! +15 Credits.");
    } else { alert("Failed! Try again in 6 hours."); }
}
