import { auth, db } from "./firebase.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const onboardModal = document.getElementById("onboardModal");
const onboardPanel = document.getElementById("onboardPanel");
const firstInput = document.getElementById("onboardFirst");
const lastInput = document.getElementById("onboardLast");
const gradeSelect = document.getElementById("onboardGrade");
const saveBtn = document.getElementById("onboardSave");
const errorEl = document.getElementById("onboardError");

let _isSaving = false;

// UI State Management
function setSavingState(on) {
    _isSaving = !!on;
    if (saveBtn) {
        saveBtn.disabled = _isSaving;
        saveBtn.innerHTML = _isSaving ? 
            `<span class="flex items-center justify-center gap-2">
                <svg class="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Saving...
            </span>` : "Save & Continue";
    }
    [firstInput, lastInput, gradeSelect].forEach(el => { if(el) el.disabled = _isSaving; });
}

export function showOnboarding() {
    if (!onboardModal) return;
    onboardModal.classList.remove("hidden");
    onboardModal.classList.add("flex"); // Ensure flex is applied for centering
    onboardModal.setAttribute("aria-hidden", "false");
    
    // Smooth entrance
    onboardPanel?.animate([
        { transform: "translateY(20px)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 }
    ], { duration: 400, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });

    setTimeout(() => firstInput?.focus(), 100);
}

function showSuccessAndClose(name) {
    if (!onboardPanel) return;

    // Clear the flag IMMEDIATELY so auth.js doesn't try to re-show this modal
    sessionStorage.removeItem("justSignedUp");

    // Use Tailwind classes for the success state instead of hardcoded styles
    onboardPanel.innerHTML = `
        <div class="text-center py-6 animate-in fade-in zoom-in duration-300">
            <div class="w-20 h-20 bg-emerald-500/20 text-emerald-400 rounded-2xl flex items-center justify-center text-4xl mx-auto mb-4 border border-emerald-500/30">
                ✓
            </div>
            <h3 class="text-2xl font-bold text-white mb-2">Welcome, ${name}!</h3>
            <p class="text-slate-400">Setting up your math dashboard...</p>
        </div>
    `;

    // Wait for the user to enjoy their success before switching
    setTimeout(() => {
        window.dispatchEvent(new CustomEvent("userProfileUpdated"));
        onboardModal.classList.add("hidden");
        onboardModal.classList.remove("flex");
    }, 1500);
}

// Validation & Save
saveBtn?.addEventListener("click", async () => {
    if (_isSaving) return;
    if (errorEl) errorEl.textContent = "";

    const uid = auth.currentUser?.uid;
    const first = (firstInput.value || "").trim();
    const last = (lastInput.value || "").trim();
    const grade = (gradeSelect.value || "").trim();

    if (!uid) {
        if (errorEl) errorEl.textContent = "Session expired. Please refresh.";
        return;
    }

    if (!first || !grade) {
        if (errorEl) errorEl.textContent = "First name and grade are required.";
        return;
    }

    setSavingState(true);

    try {
        const userRef = doc(db, "users", uid);
        await updateDoc(userRef, {
            firstName: first,
            lastName: last,
            grade: grade,
            setupComplete: true // Helpful flag for future logic
        });

        showSuccessAndClose(first);
    } catch (err) {
        console.error("Onboarding error:", err);
        if (errorEl) errorEl.textContent = "Error saving: " + err.message;
        setSavingState(false);
    }
});

// Keyboard Support
[firstInput, lastInput, gradeSelect].forEach(el => {
    el?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            saveBtn?.click();
        }
    });
});
