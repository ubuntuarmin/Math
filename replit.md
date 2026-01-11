# Katy Math - Gamified Learning Platform

## Overview
A static web application for gamified math learning. Uses Firebase for authentication and data storage.

## Project Structure
```
/
├── index.html          # Main HTML file with login and dashboard UI
├── firebase.json       # Firebase hosting configuration
├── js/
│   ├── firebase.js     # Firebase initialization
│   ├── login.js        # Authentication logic
│   ├── auth.js         # Auth utilities
│   ├── dashboard.js    # Dashboard functionality
│   ├── tokens.js       # Token/credits management
│   ├── leaderboard.js  # Leaderboard features
│   ├── referral.js     # Referral system
│   └── utils.js        # Utility functions
└── package.json        # Node.js dependencies
```

## Technology Stack
- Frontend: Static HTML, Tailwind CSS (CDN), Vanilla JavaScript (ES6 Modules)
- Backend: Firebase (Authentication, Firestore Database)
- Hosting: Static file server (serve)

## Running Locally
The project is served as a static website on port 5000:
```
npx serve -s . -l 5000
```

## Firebase Configuration
Firebase is configured directly in the JavaScript files using client-side SDK loaded from CDN.

## Features
- User authentication (email/password)
- Credits/token system
- Learning path dashboard
- Leaderboard
- Referral system
- Tier-based progression
