console.log('Running.');

var config = {
    messagingSenderId: "739898137035"
};
firebase.initializeApp(config);

const messaging = firebase.messaging();

console.log('Asking for notification permission.');

function setToken(token) {
    document.getElementById("token").innerHTML = token;
}

messaging.requestPermission()
    .then(function() {
        console.log('Notification permission granted.');

        messaging.getToken()
            .then(function(currentToken) {
                console.log('Got token', currentToken);
                setToken(currentToken);
            })
            .catch(function(err) {
                console.log('An error occurred while retrieving token. ', err);
            });
    })
    .catch(function(err) {
        console.log('Unable to get permission to notify.', err);
    });

messaging.onTokenRefresh(function() {
    messaging.getToken()
        .then(function(refreshedToken) {
            console.log('Token refreshed', refreshedToken);
            setToken(refreshedToken);
        })
        .catch(function(err) {
            console.log('Unable to retrieve refreshed token ', err);
        });
});

messaging.onMessage(function(payload) {
    console.log("Message received", payload);
    document.getElementById("message").innerHTML = payload.notification.body;
});

