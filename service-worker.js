self.addEventListener('install', function(e) {
    e.waitUntil(
        caches.open('buenosAires').then(function(cache) {
            return cache.addAll([
                '/index.html',
                '/script.js',
                '/img/alarm.png',
                '/img/eco_green_factory_icon.png',
                '/img/eco_green_factory_icon_144x144.png',
                '/img/powered_by_google.png'
            ]).then(function () {
                var external = [
                    'https://ajax.googleapis.com/ajax/libs/jquery/3.1.1/jquery.min.js',
                    'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/2.5.0/Chart.min.js',
                    'https://cdnjs.cloudflare.com/ajax/libs/Swiper/3.4.2/js/swiper.jquery.min.js',
                    'https://use.fontawesome.com/dd6ad41192.js',
                    'https://use.fontawesome.com/dd6ad41192.css',
                    'https://www.gstatic.com/firebasejs/3.6.9/firebase-app.js',
                    'https://www.gstatic.com/firebasejs/3.6.9/firebase-messaging.js',
                    'https://cdnjs.cloudflare.com/ajax/libs/Swiper/3.4.2/css/swiper.min.css',
                    'https://fonts.googleapis.com/icon?family=Material+Icons'
                ];
                return Promise.all(external.map(function (url) {
                    return fetch(url, { mode: 'no-cors' }).then(function (response) {
                        return cache.put(url, response);
                    });
                }));
            });
        })
    );
});

self.addEventListener('fetch', function(event) {
    event.respondWith(
        caches.match(event.request).then(function(response) {
            return response || fetch(event.request);
        })
    );
});

// force cache update