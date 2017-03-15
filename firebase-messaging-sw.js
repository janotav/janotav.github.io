importScripts('https://www.gstatic.com/firebasejs/3.6.9/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/3.6.9/firebase-messaging.js');

firebase.initializeApp({
    'messagingSenderId': '739898137035'
});

// messaging must be started
const messaging = firebase.messaging();

self.addEventListener('notificationclick', function(event) {
    const clickedNotification = event.notification;
    clickedNotification.close();

    const promiseChain = clients.matchAll({
        type: 'window',
        includeUncontrolled: true
    }).then((windowClients) => {
        if (windowClients.length > 0) {
            return windowClients[0].focus();
        } else {
            return clients.openWindow(clickedNotification.data.url);
        }
    });
    event.waitUntil(promiseChain);
});

messaging.setBackgroundMessageHandler(function(payload) {
    return clients.matchAll({
        type: 'window',
        includeUncontrolled: true
    }).then((windowClients) => {
        for (let i = 0; i < windowClients.length; i++) {
            windowClients[i].postMessage(payload.data);
        }
    }).then(() => {
        return registration.getNotifications();
    }).then((notifications) => {
        for(let i = 0; i < notifications.length; i++) {
            notifications[i].close();
        }        
        return registration.showNotification(payload.data.title, {
            body: payload.data.body,
            icon: "/img/eco_green_factory_icon_144x144.png",
            data: {
                url: payload.data.url
            }
        });
    });
});