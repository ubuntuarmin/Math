(function injectModernTheme() {
    // 1. Inject Inter Font from Google
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap';
    document.head.appendChild(fontLink);

    // 2. Inject the CSS (assuming you saved the above as modern.css)
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = './modern.css'; // Make sure the path is correct
    document.head.appendChild(styleLink);

    // 3. Add fade-in classes to main containers once DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        const containers = ['appContainer', 'loginModal', 'welcomeModal'];
        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('screen-fade-in');
        });
    });

    console.log("🚀 Modern Theme Injected Successfully");
})();
