// /js/blockExtensions.js

// Block errors from foreign injected scripts
window.addEventListener('error', (event) => {
  if (event.filename && event.filename.includes('giveFreely')) {
    console.warn('Blocked GiveFreely extension error:', event.message);
    event.preventDefault();
  }
});

// Block unhandled promise rejections from foreign scripts
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.stack?.includes('giveFreely')) {
    console.warn('Blocked GiveFreely promise error.');
    event.preventDefault();
  }
});

// Optional: block any other known extension patterns
const blockedPatterns = ['giveFreely', 'someOtherExtension'];
window.addEventListener('error', (event) => {
  if (blockedPatterns.some(p => event.filename?.includes(p))) {
    console.warn('Blocked extension error from:', event.filename);
    event.preventDefault();
  }
});
