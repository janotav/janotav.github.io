importScripts('https://www.gstatic.com/firebasejs/3.6.9/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/3.6.9/firebase-messaging.js');

firebase.initializeApp({
    'messagingSenderId': '739898137035'
});

// messaging must be started
const messaging = firebase.messaging();
