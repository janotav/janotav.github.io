console.log('Running.');

var config = {
    messagingSenderId: "739898137035"
};
firebase.initializeApp(config);

var myToken;
var myAlarm;
var myMeta;
var myLocation;
var myLocationJitter;
var myStations;
var myFilter;
var db;
var recentPlaceHistory = [];

var emission_types = {
    "NO2": "Oxid dusičitý",
    "SO2": "Oxid siřičitý",
    "CO": "Oxid uhelnatý",
    "O3": "Ozon",
    "PM10": "Prach 10 µm",
    "PM2_5": "Prach 2,5 µm"
};

var emission_limits = {
    "SO2_1h": [0, 25, 50, 120, 350, 500, -1],
    "NO2_1h": [0, 25, 50, 100, 200, 400, -1],
    "CO_8h": [0, 1000, 2000, 4000, 10000, 30000, -1],
    "O3_1h": [0, 33, 65, 120, 180, 240, -1],
    "PM10_1h": [0, 20, 40, 70, 90, 180, -1],
    // unofficial limits
    "PM2_5_1h": [0, 20, 40, 70, 90, 180, -1]
};

var emission_idx = [
    "undetermined",
    "incomplete",
    "very_good",
    "good",
    "satisfactory",
    "acceptable",
    "bad",
    "very_bad"];

var qualityLabel = {
    "undetermined": "Nestanovuje se",
    "incomplete": "Neúplná data",
    "very_good": "Velmi dobrá",
    "good": "Dobrá",
    "satisfactory": "Uspokojivá",
    "acceptable": "Vyhovující",
    "bad": "Špatná",
    "very_bad": "Velmi špatná"
};

function loadPosition(store) {
    if (navigator.geolocation) {
        console.log('Retrieving current position');
        navigator.geolocation.getCurrentPosition(function (position) {
            setPosition(position, store);
        });
    }
}

function setPosition(position, store) {
    myLocation = position;
    var jitter = false;
    var difference;
    if (typeof myLocationJitter !== "undefined") {
        difference = calculateDistance(myLocationJitter.latitude, myLocationJitter.longitude);
        console.log("Position difference: ", difference);
        jitter = difference < 0.5;
    }
    if (jitter) {
        console.log("Position difference negligible, distance not recalculated");
    } else {
        // position difference is more than negligible, update distance (prevent flicker otherwise)
        myLocationJitter = myLocation.coords;
        recalculateDistance();
    }
    if (store) {
        storeCurrentPlace();
    }
    displayLocation();
}

function displayLocation() {
    if (typeof myLocation !== 'undefined') {
        loadLocationName(myLocation.coords.latitude, myLocation.coords.longitude).then(function (name) {
            $("#location_name").text(name);
        });
    }
}

function initialize() {
    if ('indexedDB' in window) {
        var idb = window.indexedDB;

        var request = idb.open("BuenosAires", 3);
        request.onsuccess = function (event) {
            db = event.target.result;
            restorePlaceHistory();
            restoreCurrentPlace();
        };
        request.onupgradeneeded = function (event) {
            console.info("IDB schema upgrade");
            var store = event.target.result.createObjectStore("place", { keyPath: "id" });
            store.add({id: "recent", items: []});
            store.add({id: "current", item: {}});
        };
        request.onerror = function (event) {
            console.error("Failed to open IDB database BuenosAires: ", event);
            loadPosition(false);
        }
    } else {
        // no storage, assume current location
        loadPosition(false);
    }

    if ('serviceWorker' in navigator) {
        // service worker need in order for the app banner to appear
        navigator.serviceWorker.register('/service-worker.js').then(function(registration) {
            console.log('ServiceWorker registration successful with scope: ', registration.scope);
        }).catch(function(err) {
            console.log('ServiceWorker registration failed: ', err);
        });
    }

    loadMeta().then(function () {
        if (location.hash) {
            var stationCode = location.hash.substring(1);
            if (myStations[stationCode].name) {
                toggleDetail(stationCode, true);
                history.pushState("", document.title, window.location.pathname + window.location.search);
            }
        }
    });

    $("#alarm_toggle").click(function () {
        if (typeof myAlarm !== 'undefined' && typeof myAlarm.code !== 'undefined') {
            updateAlarm({
                token: myToken,
                remove: true
            });
        }
        return false;
    });

    $("#time_spin").click(reload);

    installPreventPullToReload();

    recalculatePlaceHolder();

    var menu_items = $("#menu_items");
    var search = $("#search");
    var searchInput = $("#search_input");

    $("#menu_expander").click(function () {
        menu_items.toggleClass("invisible");
    });

    $("#menu_search").click(function () {
        search.removeClass("invisible");
        menu_items.addClass("invisible");
        searchInput.focus();
        recalculatePlaceHolder();
        filterChangeHandler();
    });

    $("#search_close").click(function () {
        search.addClass("invisible");
        recalculatePlaceHolder();
        myFilter = undefined;
        applyFilter();
    });

    searchInput.change(filterChangeHandler);

    $("#location_picker_navigation").click(toggleLocationPage);
    $("#location").click(toggleLocationPage);

    var locationPickerCurrent = $("#location_picker_current");
    if (navigator.geolocation) {
        locationPickerCurrent.click(function() {
            loadPosition(true);
            toggleLocationPage();
        });
    } else {
        locationPickerCurrent.addClass("invisible");
    }

    var locationPickerInput = $("#location_picker_input");
    var locationPickerSearch = $("#location_picker_search");
    var locationPickerResult = $("#location_picker_result");
    locationPickerInput.change(function () {
        locationPickerSearch.removeClass("invisible");
        searchPlaces(locationPickerInput.val()).then(function (places) {
            locationPickerSearch.addClass("invisible");
            locationPickerResult.removeClass("invisible");
            var locationPickerItems = $("#location_picker_items");
            locationPickerItems.empty();
            places.forEach(function (place) {
                locationPickerItems.append(createItemPickerItem(place, true));
            });
        });
    });
}

function selectPlace(place, history) {
    return getPlaceLocation(place.id).then(function (coords) {
        if (history) {
            addPlaceHistory(place);
        }
        setPosition({
            coords: {
                latitude: coords.lat,
                longitude: coords.lng
            },
            custom: true
        }, true);
        toggleLocationPage();
        return place;
    });
}

function createItemPickerItem(place, history, callback) {
    var itemDiv = $("<div class='location_picker_item'/>");
    var placeDiv = $("<div/>");
    placeDiv.text(place.name.replace(/(.*),[^,]*/, "$1"));
    var refresh = $("<i class='fa fa-refresh fa-spin fa-fw invisible'/>");
    placeDiv.append(refresh);
    itemDiv.append(placeDiv);
    var regionDiv = $("<div class='location_picker_region'/>");
    regionDiv.text(place.name.replace(/.*,([^,]*)$/, "$1"));
    itemDiv.append(regionDiv);
    itemDiv.click(function () {
        refresh.removeClass("invisible");
        selectPlace(place, history).then(function () {
            refresh.addClass("invisible");
            if (typeof callback === 'function') {
                callback();
            }
        });
    });
    return itemDiv;
}

function addPlaceHistory(place) {

    function prependPlace() {
        recentItems.prepend(itemDiv);
        var idx = recentPlaceHistory.findIndex(function (item) {
            return item.id === place.id;
        });
        if (idx >= 0) {
            recentPlaceHistory.splice(idx, 1);
        }
        recentPlaceHistory.splice(0, 0, place);
        storePlaceHistory();
    }

    var recentItems = $("#location_picker_recent_items");
    recentItems.children().slice(4).remove();
    recentPlaceHistory.splice(4);

    var itemDiv = createItemPickerItem(place, false, function () {
        // modify recent list when select is done to avoid flicker
        prependPlace();
    });
    prependPlace();
}

function restorePlaceHistory() {
    var tx = db.transaction(["place"], "readonly", 1000);
    var req = tx.objectStore("place").get("recent");
    req.onsuccess = function (event) {
        event.target.result.items.reverse().forEach(addPlaceHistory);
    };
    req.onerror = function (event) {
        console.error("Failed to retrieved place history", event);
    };
}

function storePlaceHistory() {
    if (db) {
        var tx = db.transaction(["place"], "readwrite", 1000);
        var req = tx.objectStore("place").put({id: "recent", items: recentPlaceHistory});
        req.onerror = function (event) {
            console.error("Failed to write place history", event);
        }
    }
}

function restoreCurrentPlace() {
    var tx = db.transaction(["place"], "readonly", 1000);
    var req = tx.objectStore("place").get("current");
    req.onsuccess = function (event) {
        if (event.target.result.item.custom === true) {
            // explicit coordinates: restore them
            setPosition(event.target.result.item, false);
        } else {
            // load current position
            loadPosition(false);
        }
    };
    req.onerror = function (event) {
        console.error("Failed to retrieved current place", event);
        loadPosition(false);
    };
}

function storeCurrentPlace() {
    if (db) {
        var current = {};
        if (myLocation.custom) {
            // only store/restore custom coordinates
            current.custom = true;
            current.coords = {
                latitude: myLocation.coords.latitude,
                longitude: myLocation.coords.longitude
            };
        }
        var tx = db.transaction(["place"], "readwrite", 1000);
        var req = tx.objectStore("place").put({id: "current", item: current});
        req.onsuccess = function (event) {
            console.log("Stored current position: ", current);
        };
        req.onerror = function (event) {
            console.error("Failed to write current position: ", event);
        };
    }
}

function toggleLocationPage() {
    $("#location_page").toggleClass("invisible");
    $("#main_page").toggleClass("invisible");
}

function filterChangeHandler() {
    myFilter = $("#search_input").val();
    applyFilter();
}

function applyFilter() {
    Object.keys(myStations).forEach(function (stationCode) {
        applyStationFilter($("#" + stationCode), $("#" + stationCode + "_detail"), myStations[stationCode]);
    });
}

function applyStationFilter(stationDiv, stationDetailDiv, station) {
    if (myFilter && ((station.name + ' ' + station.regionName).toLocaleLowerCase().indexOf(myFilter.toLocaleLowerCase()) < 0)) {
        stationDiv.addClass("search_invisible");
        stationDetailDiv.addClass("search_invisible");
    } else {
        stationDiv.removeClass("search_invisible");
        stationDetailDiv.removeClass("search_invisible");
    }
}

function recalculatePlaceHolder() {
    $("#header_place_holder").css("height", $("#header_outer").height());
}

function installPreventPullToReload() {
    var preventRefresh = false;
    var lastTouchY = 0;

    function touchstartHandler(e) {
        if (e.touches.length != 1) {
            return;
        }
        lastTouchY = e.touches[0].clientY;
        preventRefresh = window.pageYOffset == 0;
    }

    function touchmoveHandler(e) {
        var touchY = e.touches[0].clientY;
        var touchYDelta = touchY - lastTouchY;
        lastTouchY = touchY;

        if (preventRefresh) {
            preventRefresh = false;
            if (touchYDelta > 0) {
                console.log('Prevent default page reload');
                e.preventDefault();

                console.log('Perform custom page reload');
                reload();
            }
        }
    }

    window.addEventListener('touchstart', touchstartHandler, {passive: false});
    window.addEventListener('touchmove', touchmoveHandler, {passive: false});
}

function reload() {
    var timeSpin = $("#time_spin");
    
    if (timeSpin.hasClass("fa-spin")) {
        console.log('Reload discarded another reload running');
        return;
    }

    if (timeSpin.hasClass("inactive")) {
        console.log('Reload discarded due to quiet period');
        return;
    }

    if (typeof myLocation === "undefined" || myLocation.custom !== true) {
        // reload position only if custom coordinates are not set
        loadPosition(false);
    }

    loadAlarm();

    timeSpin.addClass("fa-spin");
    loadMeta().then(function (done, fail) {
        timeSpin.removeClass("fa-spin");
        timeSpin.addClass("inactive");
        window.setTimeout(function () {
            timeSpin.removeClass("inactive");
        }, 60000);
    });
}

function recalculateDistance() {
    if (typeof myStations === 'undefined') {
        return;
    }
    Object.keys(myStations).forEach(updateDistance);
}

function updateDistance(code) {
    var station = myStations[code];
    var distanceKm = calculateDistance(station.loc[0], station.loc[1]);
    $("#" + code + "_distance").text(distanceDisplay(distanceKm, station.regionName));
    var order = Math.round(distanceKm * 100);
    $("#" + code).css('order', order);
    $("#" + code + "_detail").css('order', order);
    station.distance = distanceKm;
}

function distanceDisplay(distanceKm, regionName) {
    if (distanceKm < 0) {
        return "vzdálenost neznámá, " + regionName;
    } else {
        return distanceKm + " km, " + regionName;
    }
}

function calculateDistance(lat1, lon1) {

    function deg2rad(deg) {
        return deg * (Math.PI/180)
    }

    if (typeof myLocation === 'undefined') {
        return -1;
    }

    var lat2 = myLocation.coords.latitude;
    var lon2 = myLocation.coords.longitude;

    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2-lat1);
    var dLon = deg2rad(lon2-lon1);
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c * 100) / 100;
}

function addStation(stations, stationCode, station, regionName) {
    myStations[stationCode] = station;
    station.regionName = regionName;
    station.qualityClass = emission_idx[station.idx + 1];

    var stationDiv = $("<div class='station'></div>");
    stationDiv.attr('id', stationCode);
    stationDiv.addClass(station.qualityClass);
    stationDiv.append(station.name);
    var distance = $("<span class='distance'/>");
    distance.attr('id', stationCode + "_distance");
    stationDiv.append(distance);
    var stationSpinnerDiv = $("<div class='invisible small_spinner'/>");
    stationSpinnerDiv.attr('id', stationCode + "_spinner");
    stationSpinnerDiv.addClass(station.qualityClass + "_spinner");
    stationDiv.append(stationSpinnerDiv);
    stations.append(stationDiv);

    var detailDiv = $("<div class='detail invisible'/>");
    detailDiv.attr('id', stationCode + "_detail");
    stations.append(detailDiv);

    stationDiv.click(function () {
        toggleDetail(stationCode, false);
        return false;
    });

    updateDistance(stationCode);
    applyStationFilter(stationDiv, detailDiv, station);
}

function toggleDetail(stationCode, forceShow) {
    var station = myStations[stationCode];
    var stationSpinnerDiv = $("#" + stationCode + "_spinner");
    if (!stationSpinnerDiv.hasClass("invisible")) {
        // do nothing if already loading:
        // - prevents loading twice
        // - prevents closing once loaded
        return;
    }
    if (typeof station.detail === 'undefined') {
        var stationDiv = $("#" + stationCode);
        stationSpinnerDiv.removeClass("invisible");
        loadDetail(stationCode).then(function () {
            if (forceShow) {
                var header_place_holder = $("#header_place_holder");
                $('html,body').animate({ 
                    scrollTop: stationDiv.offset().top - header_place_holder.height() 
                }, 'slow');
            }            
        });
    }
    var stationDetailDiv = $("#" + stationCode + "_detail");
    if (forceShow || stationDetailDiv.hasClass("invisible")) {
        stationDetailDiv.removeClass("invisible");
    } else {
        stationDetailDiv.addClass("invisible");
    }
}

function limitDescription(measurement) {
    var limits = emission_limits[measurement.type + '_' + measurement.int];
    if (typeof limits !== 'undefined' && measurement.idx > 0) {
        var min = limits[measurement.idx - 1];
        var max = limits[measurement.idx];
        if (max > 0) {
            return ' (' + min + ' - ' + max + ' µg/m³)';
        } else {
            return ' (> ' + min + ' µg/m³)';
        }
    } else {
        return '';
    }
}

function fixMeasurementIndex(measurement) {
    if (typeof measurement.idx === 'undefined' || measurement.idx < -1) {
        var intervals = emission_limits[measurement.type + "_" + measurement.int];
        if (typeof intervals !== 'undefined') { // not all measurements have intervals
            var idx = -1;
            while (idx + 1 < intervals.length && measurement.val > intervals[idx + 1]) {
                ++idx;
            }
            measurement.idx = Math.min(idx + 1, 6);
        }
    }
}

function setDetail(stationCode, data) {
    var station = myStations[stationCode];

    station.detail = {
        data: data
    };
    
    $("#" + stationCode + "_spinner").addClass("invisible");

    var detail = $("#" + stationCode + "_detail");
    data.forEach(function (measurement) {
        fixMeasurementIndex(measurement);
        if (measurement.idx < -1) {
            // ignore values without limits (e.g. PM10_24h)
            return;
        }
        var measurementDiv = $("<div class='measurement'/>");
        var qualityClass = emission_idx[measurement.idx + 1];
        measurementDiv.addClass(qualityClass);
        var labelDiv = $("<div>");
        labelDiv.text(emission_types[measurement.type] + ": " + measurement.val + " µg/m³");
        measurementDiv.append(labelDiv);
        var descDiv = $("<div>");
        var limitSpan = $("<span class='limit'/>");
        limitSpan.text(qualityLabel[qualityClass] + limitDescription(measurement));
        descDiv.append(limitSpan);
        measurementDiv.append(descDiv);
        detail.append(measurementDiv);
    });

    if (detail.children().length == 0) {
        var noDataAvailable = $("<div class='nodata incomplete'>Nejsou k dispozici žádná měření</div>");
        detail.append(noDataAvailable);
    }

    if (typeof myToken === 'undefined' || myToken === false) {
        // token not ready or not supported, don't display panel
        return;
    }
    if (station.qualityClass === 'undetermined') {
        // station has no index, can't set alarms
        return;
    }

    addAlarmPanelToDetail(stationCode, detail);
}

function addAlarmPanelToDetails() {
    if (typeof myStations !== 'undefined') {
        Object.keys(myStations).forEach(function (stationCode) {
            if (typeof myStations[stationCode].detail !== 'undefined') {
                var detail = $("#" + stationCode + "_detail");
                addAlarmPanelToDetail(stationCode, detail);
            }
        });
    }
}

function addAlarmPanelToDetail(stationCode, detail) {
    var station = myStations[stationCode];
    var alarmPanelDiv = $("<div class='alarm_panel'>Upozornění</div>");
    alarmPanelDiv.addClass(station.qualityClass);
    emission_idx.slice(2).forEach(function (alarmClass) {
        var alarmToggle = $("<div class='alarm_toggle'/>");
        alarmToggle.attr('id', stationCode + "_" + alarmClass);
        alarmToggle.addClass(alarmClass);
        if (station.qualityClass === alarmClass) {
            alarmToggle.text("|");
        } else {
            var level = emission_idx.indexOf(alarmClass) - 1;
            alarmToggle.text(level);
            if (station.qualityClass === "incomplete") {
                // without current index, we cannot reliably decide if we want worse or better than
                if (level <= emission_idx.indexOf("satisfactory") - 1) {
                    // assume we are interested in "better than" if satisfactory and better is specified
                    alarmToggle.addClass("quality_improvement");
                }
                alarmToggle.click(function () {
                    var targetLevel;
                    if (alarmToggle.hasClass("quality_improvement")) {
                        targetLevel = -level;
                    } else {
                        targetLevel = level;
                    }
                    updateAlarm({
                        token: myToken,
                        code: stationCode,
                        level: targetLevel
                    });
                    if (level !== 1 && level !== 6) {
                        alarmToggle.toggleClass("quality_improvement");
                    }
                    return false;
                });
            } else {
                if (level < emission_idx.indexOf(station.qualityClass) - 1) {
                    level = -level;
                    alarmToggle.addClass("quality_improvement");
                }
                alarmToggle.click(function () {
                    updateAlarm({
                        token: myToken,
                        code: stationCode,
                        level: level
                    });
                    return false;
                });
            }

        }
        alarmPanelDiv.append(alarmToggle);
    });
    detail.append(alarmPanelDiv);
}

function setMeta(meta) {
    if (typeof myMeta !== 'undefined' && myMeta.date === meta.date) {
        // do nothing unless data changed (prevent collapsing on reload without data change)
        return;
    }

    myMeta = meta;
    
    $("#time_outer").removeClass("invisible");
    $("#menu_expander").removeClass("invisible");
    $("#location").removeClass("invisible");
    $("#loader").remove();

    var stations = $("#stations");
    stations.empty();
    myStations = {};

    // convert to ISO format (original not supported by firefox)
    var dateIso = meta.date.replace(/ UTC$/, 'Z').replace(/ /,'T');
    var date = new Date(Date.parse(dateIso));
    $("#date").text(date.toLocaleString("cs-CZ"));

    var regionNames = Object.keys(meta.regions);
    regionNames.forEach(function (regionName) {
        var stationCodes = Object.keys(meta.regions[regionName]);
        stationCodes.forEach(function (stationCode) {
            addStation(stations, stationCode, meta.regions[regionName][stationCode], regionName);
        });
    });

    displayAlarm();
}

function setToken(token) {
    if (token !== myToken) {
        myToken = token;
        if (token !== false) {
            loadAlarm();
            addAlarmPanelToDetails();
        } else {
            setAlarm(false);
        }
    }
}

function setAlarm(alarm) {
    myAlarm = alarm;
    displayAlarm();
}

function displayAlarm() {
    if (typeof myStations === 'undefined') {
        return;
    }

    var alarmDirection = $("#alarm_direction");
    var alarmOuter = $("#alarm_outer");
    var alarmLoader = $("#alarm_loader");

    if (myAlarm === false) {
        alarmOuter.addClass("alarm_outer inactive");
        alarmOuter.removeClass("invisible");
        alarmLoader.remove();
        alarmDirection.text("nepodporováno");
        return;
    }

    if (typeof myAlarm === 'undefined') {
        alarmLoader.removeClass("invisible");
        return;
    }

    var alarmLevel = $("#alarm_level");
    var alarmValue = $("#alarm_value");
    var alarmLocation = $("#alarm_location");
    var alarmLevelNumber = $("#alarm_level_number");

    if (typeof myAlarm.code === 'undefined') {
        alarmLocation.text("");
        alarmValue.text("");
        alarmLevel.text("");
        alarmLevelNumber.text("");
        alarmOuter.addClass("alarm_outer inactive");
        alarmOuter.removeClass("invisible");
        alarmLoader.remove();
        alarmDirection.text("nenastaveno");
        return;
    }

    var station = myStations[myAlarm.code];
    var qualityClass = emission_idx[station.idx + 1];
    var alarmClass = emission_idx[Math.abs(myAlarm.level) + 1];
    alarmLocation.text(station.name);
    alarmValue.text(qualityLabel[qualityClass]);
    alarmValue.removeClass("undetermined incomplete very_good good satisfactory acceptable bad very_bad").addClass(qualityClass);
    alarmLevel.text(qualityLabel[alarmClass]);
    alarmLevel.removeClass("very_good good satisfactory acceptable bad very_bad").addClass(alarmClass);
    alarmLevelNumber.text(Math.abs(myAlarm.level));
    alarmLevelNumber.removeClass("very_good good satisfactory acceptable bad very_bad").addClass(alarmClass);
    alarmOuter.removeClass("inactive");
    if (myAlarm.level == -1 || myAlarm.level == 6) {
        alarmDirection.text("");
    } else if (myAlarm.level > 0) {
        alarmDirection.text(" a horší");
    } else {
        alarmDirection.text(" a lepší");
    }
    if (myAlarm.level < 0) {
        alarmLevelNumber.addClass("quality_improvement");
    } else {
        alarmLevelNumber.removeClass("quality_improvement");
    }
    alarmOuter.addClass("alarm_outer");
    alarmOuter.removeClass("invisible inactive");
    alarmLoader.remove();
}

const messaging = firebase.messaging();

console.log('Asking for notification permission.');

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
                setToken(false);
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
    console.log("Message received, reload alarm and meta", payload);

    loadAlarm();
    loadMeta().then(function () {
        console.log('Load detail of the station in alarm');
        toggleDetail(payload.data.stationCode, true);
    });
});

function updateAlarm(alarm) {
    // waiting for the server call makes the app look a little bit unresponsive, let's assume the operation succeeds
    var oldAlarm = myAlarm;
    setAlarm(alarm);
    $.ajax({
        url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/alarm',
        method: 'POST',
        data: JSON.stringify(alarm),
        contentType: 'application/json',
        headers: {
            'x-api-key': 'api_key_public_access'
        }
    }).fail(function () {
        // revert to previous setting if server didn't succeed
        setAlarm(oldAlarm);
    });
}

function loadAlarm() {
    console.log('Retrieving alarm from the server');
    $.ajax({
        url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/alarm',
        method: 'POST',
        data: JSON.stringify({
            token: myToken,
            remove: false
        }),
        contentType: 'application/json',
        headers: {
            'x-api-key': 'api_key_public_access'
        }
    }).done(function (item) {
        console.log('Current server alarm: ', item);
        setAlarm(item);
    });
}

function loadMeta() {
    console.log('Retrieving meta data from the server');
    return new Promise(function (resolve, reject) {
        $.ajax({
            url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/summary',
            method: 'GET',
            headers: {
                'x-api-key': 'api_key_public_access'
            }
        }).done(function (meta) {
            console.log('Current server meta summary: ', meta);
            setMeta(meta);
            resolve(meta);
        }).catch(function (err) {
            console.error('Failed to retrieve meta summary: ', err);
            reject(err);
        });
    });
}

function loadDetail(stationCode) {
    console.log('Retrieving station data from the server');
    return new Promise(function (resolve, reject) {
        $.ajax({
            url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/summary',
            method: 'GET',
            data: {
                station: stationCode,
                date: myMeta.date
            },
            headers: {
                'x-api-key': 'api_key_public_access'
            }
        }).done(function (detail) {
            console.log('Station ' + stationCode + ' data: ', detail);
            setDetail(stationCode, detail);
            resolve(detail);
        }).fail(function (err) {
            console.error('Station ' + stationCode + ' error: ', err);
            setDetail(stationCode, []);
            reject(err);
        });
    });
}

function findAddressComponent(components, type) {
    var component = components.find(function (item) {
        var idx = item.types.findIndex(function (itemType) {
            return type === itemType;
        });
        return idx >= 0;
    });
    return component;
}

function collectAddress(components, fields) {
    var address = "";
    var count = 0;
    fields.forEach(function (field) {
        if (count == 2) {
            return;
        }
        var component = findAddressComponent(components, field);
        if (!component) {
            return;
        }

        if (address.indexOf(component.short_name) >= 0) {
            // don't duplicate (e.g. Praha 4, Praha)
            return;
        }

        if (++count > 1) {
            address += ", ";
        }
        address += component.short_name;
    });
    return address;
}

function getPlaceLocation(id) {
    console.log("Perform place location query: ", name);
    return new Promise(function (resolve, reject) {
        $.ajax({
            url: "https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/place/detail",
            method: "GET",
            headers: {
                "x-api-key": "api_key_public_access"
            },
            data: {
                id: id
            }
        }).done(function (places) {
            console.log("Place location result: ", places);
            resolve(places);
        }).catch(function (err) {
            console.error("Place loction error: ", err);
            reject(err);
        });
    });
}

function searchPlaces(name) {
    console.log("Perform search place query: ", name);
    return new Promise(function (resolve, reject) {
        $.ajax({
            url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/place',
            method: 'GET',
            headers: {
                'x-api-key': 'api_key_public_access'
            },
            data: {
                name: name
            }
        }).done(function (places) {
            console.log("Place search result: ", places);
            resolve(places);
        }).catch(function (err) {
            console.error("Place search error: ", err);
            resolve([]);
        });
    });
}

function loadLocationName(lat, lon) {
    return new Promise(function (resolve, reject) {
        console.log("Perform geocode query: ", name);
        $.ajax({
            url: 'https://maps.googleapis.com/maps/api/geocode/json',
            method: 'GET',
            data: {
                latlng: lat+','+lon,
                language: 'cs'
            }
        }).done(function (result) {
            if (result.status === "OK") {
                var address = collectAddress(result.results[0].address_components, ["neighborhood", "sublocality", "locality"]);
                resolve(address);
            } else {
                console.error("Negative response for location coordinates", result);
                reject(result.status);
            }
        }).fail(function (err) {
            console.error("Failed to resolve location coordinates", err);
            reject(err);
        });
    });
}
