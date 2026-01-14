import { db, auth } from "./firebase.js";
import { doc, getDoc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { sendNotification } from "./inbox.js";

let currentQuestion = 0;
let correctAnswer = 0;
let timeLeft = 14.0;
let timerInterval;

const mathModal = document.getElementById("mathModal");
const startBtn = document.getElementById("startMathBtn");
const timerDisplay = document.getElementById("mathTimer");
const equationDisplay = document.getElementById("equationDisplay");
const optionsContainer = document.getElementById("answerOptions");

export async function initMathChallenge() {
    startBtn.onclick = async () => {
        const user = auth.currentUser;
        if (!user) return;

        // 1. Check Cooldown
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const lastMath = userSnap.data().lastMathChallenge?.toMillis() || 0;
        const cooldown = 6 * 60 * 60 * 1000; // 6 Hours

        if (Date.now() - lastMath < cooldown) {
            const remaining = Math.ceil((cooldown - (Date.now() - lastMath)) / (1000 * 60));
            alert(`Too fast! Wait ${Math.floor(remaining/60)}h ${remaining%60}m.`);
            return;
        }

        startChallenge();
    };
}

function startChallenge() {
    currentQuestion = 1;
    timeLeft = 14.0;
    mathModal.classList.remove("hidden");
    generateQuestion();
    
    timerInterval = setInterval(() => {
        timeLeft -= 0.1;
        timerDisplay.textContent = timeLeft.toFixed(1) + "s";
        
        if (timeLeft <= 0) endGame(false);
    }, 100);
}

function generateQuestion() {
    document.getElementById("questionCounter").textContent = `${currentQuestion}/10`;
    document.getElementById("mathProgress").style.width = `${(currentQuestion / 10) * 100}%`;

    const a = Math.floor(Math.random() * 9) + 2; // 2-10
    const b = Math.floor(Math.random() * 9) + 2; // 2-10
    correctAnswer = a * b;
    equationDisplay.textContent = `${a} × ${b}`;

    // Generate Multiple Choice
    let options = [correctAnswer];
    while(options.length < 4) {
        let wrong = (a + Math.floor(Math.random()*3-1)) * (b + Math.floor(Math.random()*3-1)) + Math.floor(Math.random()*5);
        if(!options.includes(wrong) && wrong > 0) options.push(wrong);
    }
    options.sort(() => Math.random() - 0.5);

    optionsContainer.innerHTML = options.map(opt => `
        <button class="modern-card py-4 font-bold hover:bg-blue-600 transition" onclick="checkAnswer(${opt})">
            ${opt}
        </button>
    `).join("");
}

window.checkAnswer = (val) => {
    if (val === correctAnswer) {
        if (currentQuestion >= 10) {
            endGame(true);
        } else {
            currentQuestion++;
            generateQuestion();
        }
    } else {
        endGame(false); // One wrong answer ends it!
    }
};

async function endGame(success) {
    clearInterval(timerInterval);
    mathModal.classList.add("hidden");

    if (success) {
        const user = auth.currentUser;
        await updateDoc(doc(db, "users", user.uid), {
            credits: increment(15),
            totalEarned: increment(15),
            lastMathChallenge: new Date()
        });
        alert("Incredible Speed! +15 Credits earned.");
        // Optional: sendNotification(user.uid, "Speed Bonus!", "You solved 10 problems in under 14 seconds!");
    } else {
        alert("Challenge Failed! You must be faster and 100% accurate.");
    }
}

document.getElementById("closeMathBtn").onclick = () => {
    clearInterval(timerInterval);
    mathModal.classList.add("hidden");
};
