importScripts('https://www.gstatic.com/firebasejs/3.5.2/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/3.5.2/firebase-messaging.js');

firebase.initializeApp({
    'messagingSenderId': '739898137035'
});

const messaging = firebase.messaging();

// messaging.setBackgroundMessageHandler(function(payload) {
//     console.log('[firebase-messaging-sw.js] Received background message ', payload);
//     // const notificationTitle = '' + payload.data.stationCode + ' is ' + payload.data.stationIdx;
//     const notificationTitle = JSON.stringify(payload);
//     const notificationOptions = {
//         body: notificationTitle
//     };
//
//     return self.registration.showNotification(notificationTitle,
//         notificationOptions);
// });
