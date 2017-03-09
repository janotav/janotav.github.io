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
var myFavorites = {};
var db;
var recentPlaceHistory = [];
var busyLock = false;
var myCharts = [];
var myPatterns = {};

var emission_types = {
    "NO2": "Oxid dusičitý",
    "SO2": "Oxid siřičitý",
    "CO": "Oxid uhelnatý",
    "O3": "Ozon",
    "PM10": "Prach 10 µm",
    "PM2_5": "Prach 2,5 µm",
    "idx": "Index kvality"
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

var colorIndex = [
    "#CFCFCF",
    "#FFFFFF",
    "#C7EAFB",
    "#9BD3AE",
    "#FFF200",
    "#FAA61A",
    "#ED1C24",
    "#671F20"
];

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

        var request = idb.open("BuenosAires", 4);
        request.onsuccess = function (event) {
            db = event.target.result;
            restorePlaceHistory();
            restoreCurrentPlace();
            restoreFavorites();
        };
        request.onupgradeneeded = function (event) {
            console.info("IDB schema upgrade");
            var db = event.target.result;

            if (!db.objectStoreNames.contains("place")) {
                var placeStore = db.createObjectStore("place", { keyPath: "id" });
                placeStore.add({id: "recent", items: []});
                placeStore.add({id: "current", item: {}});
            }

            if (!db.objectStoreNames.contains("favorites")) {
                var favoriteStore = db.createObjectStore("favorites", { keyPath: "id" });
                favoriteStore.add({id: "favorites", items: {}});
            }
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

    recalculateMainPagePlaceHolder();

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
        recalculateMainPagePlaceHolder();
        filterChangeHandler();
    });

    $("#search_close").click(function () {
        search.addClass("invisible");
        recalculateMainPagePlaceHolder();
        myFilter = undefined;
        applyFilter();
    });

    $("#menu_manage_favorite").click(function () {
        menu_items.addClass("invisible");
        toggleFavoritesPage();
    });
    $("#favorites_navigation").click(function () {
        toggleFavoritesPage();
        updateFavoriteMenuItem(true);
        applyFavoriteFilter();
    });
    var menuFilterFavorite = $("#menu_filter_favorite");
    var menuFilterFavoriteCheck = $("#menu_filter_favorite_check");
    menuFilterFavorite.click(function() {
        if (menuFilterFavorite.hasClass("disabled")) {
            return;
        }
        menu_items.addClass("invisible");
        menuFilterFavoriteCheck.toggleClass("fa-square-o fa-check-square-o");
        myFavorites["enabled"] = menuFilterFavoriteCheck.hasClass("fa-check-square-o");
        storeFavorites();
        applyFavoriteFilter();
    });

    searchInput.change(filterChangeHandler);

    $("#location_navigation").click(toggleLocationPage);
    $("#location").click(toggleLocationPage);

    var locationPickerCurrent = $("#location_picker_current");
    if (navigator.geolocation) {
        // we assume position loading is so quick we don't need progress indication
        // the lock ensures we don't execute when others are running (rather than vice-versa)
        locationPickerCurrent.click(busyEnter(function() {
            busyLeave();
            loadPosition(true);
            toggleLocationPage();
        }));
    } else {
        locationPickerCurrent.addClass("invisible");
    }

    var locationPickerInput = $("#location_picker_input");
    var locationPickerSearch = $("#location_picker_search");
    var locationPickerRunning = $("#location_picker_running");
    var locationPickerResult = $("#location_picker_result");
    var searchHandler = busyEnter(function () {
        searchPlaces(locationPickerInput.val()).then(function (places) {
            busyLeave(locationPickerRunning);
            locationPickerResult.removeClass("invisible");
            var locationPickerItems = $("#location_picker_items");
            locationPickerItems.empty();
            places.forEach(function (place) {
                locationPickerItems.append(createItemPickerItem(place, true));
            });
        });
    }, locationPickerRunning);
    locationPickerInput.change(searchHandler);
    locationPickerSearch.click(searchHandler);

    var history_navigation = $("#history_navigation");
    history_navigation.click(function () {
        toggleHistoryPage();
    });

    var history_page = $("#history_page");
    $(window).scroll(function() {
        if (!history_page.hasClass("invisible")) {
            updateMeasurementName();
        }
    });

    var history_measurement_outer = $("#history_measurement_outer");
    history_measurement_outer.click(function () {
        history_measurement_outer.toggleClass("select_border");
        if (history_measurement_outer.hasClass("select_border")) {
            $("#history_measurement > .item").removeClass("invisible").addClass("selecting");
        } else {
            $("#history_measurement > .item:not(.select_item)").addClass("invisible");
            $("#history_measurement > .item").removeClass("selecting");
        }
    });
}

function selectPlace(place, history) {

    function selectPlace_() {
        if (history) {
            addPlaceHistory(place);
        }
        setPosition({
            coords: {
                latitude: place.coords.lat,
                longitude: place.coords.lng
            },
            custom: true
        }, true);
        toggleLocationPage();
    }
    if (typeof place.coords !== "undefined") {
        // coordinates are known (e.g. history item)
        return new Promise(function (resolve) {
            selectPlace_();
            resolve(place);
        });
    } else {
        // coordinates must be requested first (e.g. search item or legacy history item)
        return getPlaceLocation(place.id).then(function (coords) {
            console.info("Adding coordinates to place item");
            place.coords = coords;
            selectPlace_();
            return place;
        });
    }
}

function busyEnter(callback, progressElement) {
    return function () {
        if (!busyLock) {
            if (typeof progressElement !== "undefined") {
                progressElement.removeClass("invisible");
            }
            busyLock = true;
            callback();
        }
    }
}

function busyLeave(progressElement) {
    busyLock = false;
    if (typeof progressElement !== "undefined") {
        progressElement.addClass("invisible");
    }
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
    itemDiv.click(busyEnter(function () {
        selectPlace(place, history).then(function () {
            busyLeave(refresh);
            if (typeof callback === 'function') {
                callback();
            }
        });
    }, refresh));
    return itemDiv;
}

function addPlaceHistory(place) {

    function prependPlace() {
        recentItems.prepend(itemDiv);
        recentPlaceHistory.splice(0, 0, place);
        storePlaceHistory();
    }

    var recentItems = $("#location_picker_recent_items");
    var idx = recentPlaceHistory.findIndex(function (item) {
        return item.id === place.id;
    });
    if (idx >= 0) {
        recentPlaceHistory.splice(idx, 1);
        recentItems.children().slice(idx, idx + 1).remove();
    } else {
        recentPlaceHistory.splice(4);
        recentItems.children().slice(4).remove();
    }

    var itemDiv = createItemPickerItem(place, false, function () {
        // modify recent list when select is done to avoid flicker
        prependPlace();
    });
    prependPlace();
}

function restoreFavorites() {
    var tx = db.transaction(["favorites"], "readonly", 1000);
    var req = tx.objectStore("favorites").get("favorites");
    req.onsuccess = function (event) {
        myFavorites = event.target.result.items;
        updateFavoriteIcons();
    };
    req.onerror = function (event) {
        console.error("Failed to retrieved favorites ", event);
    };
}

function storeFavorites() {
    if (db) {
        console.log("Store favorites settings");
        var tx = db.transaction(["favorites"], "readwrite", 1000);
        var req = tx.objectStore("favorites").put({id: "favorites", items: myFavorites});
        req.onerror = function (event) {
            console.error("Failed to write favorites", event);
        }
    }
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
    recalculateLocationPlaceHolder();
}

function filterChangeHandler() {
    myFilter = $("#search_input").val();
    applyFilter();
}

function toggleFavoritesPage() {
    $("#favorites_page").toggleClass("invisible");
    $("#main_page").toggleClass("invisible");
    recalculateFavoritesPlaceHolder();
}

var historySaveScrollTop;

function toggleHistoryPage() {
    function orientationErr(err) {
        console.warn("cannot switch orientation", err);
    }
    var historyPage = $("#history_page");
    if (historyPage.hasClass("invisible")) {
        historySaveScrollTop = $(window).scrollTop();
    }
    historyPage.toggleClass("invisible");
    $("#main_page").toggleClass("invisible");
    if (!historyPage.hasClass("invisible")) {
        screen.orientation.lock("landscape").catch(orientationErr);
        recalculateHistoryPlaceHolder();
    } else {
        screen.orientation.lock("portrait").catch(orientationErr);
        $(window).scrollTop(historySaveScrollTop);
    }
}

function applyFavoriteFilter() {
    Object.keys(myStations).forEach(function (stationCode) {
        applyStationFavoriteFilter($("#" + stationCode), $("#" + stationCode + "_detail"), stationCode);
    });
}

function applyStationFavoriteFilter(stationDiv, stationDetailDiv, code) {
    if (myFavorites["enabled"] === true && myFavorites[code] !== true) {
        stationDiv.addClass("favorite_invisible");
        stationDetailDiv.addClass("favorite_invisible");
    } else {
        stationDiv.removeClass("favorite_invisible");
        stationDetailDiv.removeClass("favorite_invisible");
    }
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

function recalculateMainPagePlaceHolder() {
    recalculatePlaceHolder($("#header_place_holder"), $("#header_outer"));
}

function recalculateLocationPlaceHolder() {
    recalculatePlaceHolder($("#location_place_holder"), $("#location_navigation"));
}

function recalculateFavoritesPlaceHolder() {
    recalculatePlaceHolder($("#favorites_place_holder"), $("#favorites_navigation"));
}

function recalculateHistoryPlaceHolder() {
    recalculatePlaceHolder($("#history_place_holder"), $("#history_header"));
}

function recalculatePlaceHolder(target, source) {
    target.css("height", source.height() - parseInt($("body").css('margin-top')));
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

    if ($("#main_page").hasClass("invisible")) {
        console.log('Reload discarded in history view');
        return;
    }
    
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

    function scrollTo() {
        if (forceShow) {
            $('html,body').animate({
                scrollTop: $("#" + stationCode).offset().top - $("#header_place_holder").height() - parseInt($("body").css('margin'))
            }, 'slow');
        }
    }

    var station = myStations[stationCode];
    var stationSpinnerDiv = $("#" + stationCode + "_spinner");
    if (!stationSpinnerDiv.hasClass("invisible")) {
        // do nothing if already loading:
        // - prevents loading twice
        // - prevents closing once loaded
        return;
    }
    if (typeof station.detail === 'undefined') {
        stationSpinnerDiv.removeClass("invisible");
        // scroll after  detail is loaded to avoid flickr
        loadDetail(stationCode).then(scrollTo);
    } else {
        scrollTo();
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

function getMeasurementIndex(type, val) {
    var intervals = emission_limits[type];
    if (typeof intervals !== "undefined") {
        var idx = -1;
        while (idx + 1 < intervals.length && val > intervals[idx + 1]) {
            ++idx;
        }
        return Math.min(idx + 1, 6);
    } else {
        // not all measurements have intervals
        return undefined;
    }
}

function fixMeasurementIndex(measurement) {
    if (typeof measurement.idx === 'undefined' || measurement.idx < -1) {
        var idx = getMeasurementIndex(measurement.type + "_" + measurement.int, measurement.val);
        if (typeof idx !== "undefined") {
            measurement.idx = idx;
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

    var historyDiv = $("<div class='detail_panel history_panel'></div>");
    historyDiv.addClass(station.qualityClass);
    historyDiv.append($("<i class='fa fa-bar-chart history_panel' aria-hidden='true'></i>"));
    historyDiv.append(document.createTextNode("Historie měření"));
    historyDiv.click(function () {
        toggleHistoryPage();
        displayHistory(stationCode);
    });
    detail.append(historyDiv);

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
    var alarmPanelDiv = $("<div class='detail_panel alarm_panel'>Upozornění</div>");
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

    var date = parseUtcDate(meta.date);
    $("#date").text(date.toLocaleString("cs-CZ"));

    var regionNames = Object.keys(meta.regions);
    regionNames.forEach(function (regionName) {
        var stationCodes = Object.keys(meta.regions[regionName]);
        stationCodes.forEach(function (stationCode) {
            addStation(stations, stationCode, meta.regions[regionName][stationCode], regionName);
        });
    });

    var favorites = $("#favorites");
    favorites.empty();
    regionNames.sort(function (name1, name2) {
        return name1.localeCompare(name2);
    });
    regionNames.forEach(function (regionName) {
        var stationCodes = Object.keys(meta.regions[regionName]);
        stationCodes.sort(function (code1, code2) {
            return meta.regions[regionName][code1].name.localeCompare(meta.regions[regionName][code2].name);
        });
        var regionCode = stationCodes[0].substring(0, 1);
        var favRegion = $("<div class='favorites_region'/>");
        addFavoriteIcon(regionCode, favRegion, function () {
            stationCodes.forEach(function (stationCode) {
                myFavorites[stationCode] = myFavorites[regionCode];
                setFavoriteIcon(stationCode);
            });
        });
        favRegion.append(document.createTextNode(regionName));
        favorites.append(favRegion);
        stationCodes.forEach(function (stationCode) {
            var favStation = $("<div class='favorites_station'/>");
            addFavoriteIcon(stationCode, favStation, function () {
                if (!myFavorites[stationCode]) {
                    myFavorites[regionCode] = false;
                    setFavoriteIcon(regionCode);
                }
            });
            favStation.append(document.createTextNode(meta.regions[regionName][stationCode].name));
            favorites.append(favStation);
        });
    });
    updateFavoriteIcons();

    displayAlarm();
}

function updateFavoriteMenuItem(store) {
    var menuFilterFavorite = $("#menu_filter_favorite");
    var idx = Object.keys(myFavorites).findIndex(function (item) {
        return myFavorites[item] === true && item !== "enabled";
    });
    if (idx < 0) {
        var menuFilterFavoriteCheck = $("#menu_filter_favorite_check");
        menuFilterFavoriteCheck.removeClass("fa-check-square-o");
        menuFilterFavoriteCheck.addClass("fa-square-o");
        menuFilterFavorite.addClass("disabled");
        if (myFavorites["enabled"] === true) {
            myFavorites["enabled"] = false;
            store = true;
        }
    } else {
        menuFilterFavorite.removeClass("disabled");
    }
    if (store) {
        storeFavorites();
    }
}

function updateFavoriteIcons() {
    updateFavoriteMenuItem(false);

    if (typeof myMeta === "undefined") {
        return;
    }
    var regionNames = Object.keys(myMeta.regions);
    regionNames.forEach(function (regionName) {
        var stationCodes = Object.keys(myMeta.regions[regionName]);
        var regionCode = stationCodes[0].substring(0, 1);
        setFavoriteIcon(regionCode);
        stationCodes.forEach(function (stationCode) {
            setFavoriteIcon(stationCode);
        });
    });
    var favoriteCheck = $("#menu_filter_favorite_check");
    if (myFavorites["enabled"] === true) {
        favoriteCheck.addClass("fa-check-square-o");
        favoriteCheck.removeClass("fa-square-o");
    } else {
        favoriteCheck.addClass("fa-square-o");
        favoriteCheck.removeClass("fa-check-square-o");
    }
    applyFavoriteFilter();
}

function addFavoriteIcon(code, element, callback) {
    var favIcon = $("<i class='favorite fa' aria-hidden='true'/>");
    favIcon.attr("id", code + "_fav");
    element.click(function () {
        favIcon.toggleClass("fa-star fa-star-o");
        myFavorites[code] = favIcon.hasClass("fa-star");
        if (typeof callback === "function") {
            callback();
        }
    });
    element.append(favIcon);
}

function setFavoriteIcon(code) {
    var favIcon = $("#" + code + "_fav");
    if (myFavorites[code] === true) {
        favIcon.addClass("fa-star");
        favIcon.removeClass("fa-star-o");
    } else {
        favIcon.addClass("fa-star-o");
        favIcon.removeClass("fa-star");
    }
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

    var alarmClass = emission_idx[Math.abs(myAlarm.level) + 1];
    alarmLevel.text(qualityLabel[alarmClass]);
    alarmLevel.removeClass("very_good good satisfactory acceptable bad very_bad").addClass(alarmClass);
    alarmLevelNumber.text(Math.abs(myAlarm.level));
    alarmLevelNumber.removeClass("very_good good satisfactory acceptable bad very_bad").addClass(alarmClass);
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

    var station = myStations[myAlarm.code];
    if (typeof station === "undefined") {
        console.error("Alarm references unknown station: ", myAlarm.code);
        alarmLocation.text("neznámá stanice");
        alarmValue.text("");
        return;
    }

    var qualityClass = emission_idx[station.idx + 1];
    alarmLocation.text(station.name);
    alarmValue.text(qualityLabel[qualityClass]);
    alarmValue.removeClass("undetermined incomplete very_good good satisfactory acceptable bad very_bad").addClass(qualityClass);
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
        foregroundAlarm(parseInt(payload.data.stationIdx));
    });
});

function foregroundAlarm(stationIdx) {
    var qualityClass = emission_idx[stationIdx + 1];
    var headerInner = $("#header_inner");
    blink(headerInner, qualityClass, 3);
    if ("vibrate" in navigator) {
        navigator.vibrate([200, 200, 200]);
    }
}

function blink(headerInner, qualityClass, n) {
    headerInner.addClass(qualityClass);
    setTimeout(function () {
        headerInner.removeClass(qualityClass);
        if (--n > 0) {
            setTimeout(function () {
                blink(headerInner, qualityClass, n);
            }, 100);
        }
    }, 100);
}

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

function parseUtcDate(utcDateStr) {
    // convert to ISO format (original not supported by firefox)
    var dateIso = utcDateStr.replace(/ UTC$/, 'Z').replace(/ /,'T');
    return new Date(Date.parse(dateIso));
}

function toUtcDate(date) {
    return date.toISOString().replace(/T/, ' ').replace(/(\..).+/, '$1 UTC');
}

function displayHistory(stationCode) {
    var station = myStations[stationCode];
    $("#history_station").text(station.name);
    $("#history_charts").empty();

    var days = $("#history_period > .select_item").data("value");
    var to = myMeta.date;
    var from = new Date(parseUtcDate(to).getTime() - 1000 * 60 * 60 * (24 * days - 1));
    loadHistory(stationCode, toUtcDate(from), to).then(function () {
        updateMeasurementName();
    });
}

function colorPattern(color) {
    if (typeof myPatterns[color] === "undefined") {
        var canvas = document.createElement("canvas");
        var context = canvas.getContext("2d");

        canvas.width = 10;
        canvas.height = 10;

        context.beginPath();
        context.fillStyle = color;
        context.fillRect(0, 0, 10, 10);
        context.moveTo(0, 10);
        context.lineTo(10, 0);
        context.stroke();

        myPatterns[color] = context.createPattern(canvas, "repeat");
    }
    return myPatterns[color];
}

function createDataset(values, idxFunc) {
    var bg = [];
    var data = [];
    var lastValue;
    for (var i = 0; i < values.length; i++) {
        var value = values[i];
        if (value < 0) {
            if (typeof lastValue === "undefined") {
                for (var j = i + 1; j < values.length; j++) {
                    if (values[j] >= 0) {
                        lastValue = values[j];
                        break;
                    }
                }
            }
            data.push(lastValue);
            bg.push(colorPattern(colorIndex[idxFunc(lastValue) + 1]));
        } else {
            data.push(value);
            bg.push(colorIndex[idxFunc(value) + 1]);
            lastValue = value;
        }
    }
    return {
        data: data,
        background: bg
    }
}

function updateMeasurementName() {
    if ($("#history_measurement_outer").hasClass("select_border")) {
        return;
    }
    var max = 0;
    var oldMeasurement = $("#history_measurement > .select_item");
    var newMeasurement;
    myCharts.forEach(function (chart) {
        var visibility = calculateVisibility(chart.elem);
        if (visibility > max) {
            max = visibility;
            newMeasurement = chart.measurement;
        }
    });
    if (typeof newMeasurement !== "undefined" && newMeasurement !== oldMeasurement) {
        oldMeasurement.addClass("invisible");
        oldMeasurement.removeClass("select_item");
        newMeasurement.removeClass("invisible");
        newMeasurement.addClass("select_item");
    }
}

function calculateVisibility(elem) {
    var win = $(window);
    var visible_y_min = win.scrollTop() + $("#history_charts").offset().top;
    var visible_y_max = win.scrollTop() + window.innerHeight;

    var idx_y_min = elem.offset().top;
    var idx_y_max = idx_y_min + elem.height();
    return Math.max(0, Math.min(idx_y_max, visible_y_max) - Math.max(idx_y_min, visible_y_min));
}

function getMeasurementName(type) {
    var res = type.match(/(.*)_(.+)$/);
    if (res === null) {
        return emission_types[type];
    }

    return emission_types[res[1]];
}

function generateTimeLabels(from, to) {

    function pad(n) {
        return n < 10? "0" + String(n): String(n);
    }
    var fromTime = parseUtcDate(from).getTime();
    var toDate = parseUtcDate(to);
    var ret = [];

    while (true) {
        ret.push(String(toDate.getHours()) + ":" + pad(toDate.getMinutes()));
        var newTime = toDate.getTime() - 3600000;
        if (newTime < fromTime) {
            break;
        }
        toDate = new Date(newTime);
    }

    ret.reverse();
    return ret;
}

function setHistory(from, to, history) {
    var charts = $("#history_charts");
    charts.empty();
    myCharts = [];

    var measurements = $("#history_measurement");
    measurements.empty();

    var types = Object.keys(history);
    types.forEach(function (type) {
        var idxValueFunc;
        if (type === "idx") {
            idxValueFunc = function (value) {
                return value;
            };
        } else if (typeof emission_limits[type] === "undefined") {
            // ignore measurements without limits (e.g. PM10_24h)
            return;
        } else {
            idxValueFunc = function (value) {
                return getMeasurementIndex(type, value);
            };
        }
        var chartDiv = $("<div>");
        var canvas = $("<canvas>");
        canvas.attr("id", "canvas_" + type);
        chartDiv.append(canvas);
        charts.append(chartDiv);

        var measurementDiv = $("<div class='item invisible'>");
        measurementDiv.text(getMeasurementName(type));
        measurementDiv.click(function () {
            var historyMeasurementOuter = $("#history_measurement_outer");
            if (historyMeasurementOuter.hasClass("select_border")) {
                historyMeasurementOuter.removeClass("select_border");
                $("#history_measurement > .item").addClass("invisible").removeClass("selecting");
                $('html, body').animate({
                    scrollTop: chartDiv.offset().top - $("#history_place_holder").height() - parseInt($("body").css('margin'))
                }, 100);
                return false;
            } else {
                return true;
            }
        });
        measurements.append(measurementDiv);

        myCharts.push({ elem: canvas, measurement: measurementDiv });

        var options = {
            tooltips: {
                callbacks: {
                    label: function (tooltipItems, data) {
                        if (history[type][tooltipItems.index] < 0) {
                            return "Hodnota není k dispozici";
                        } else {
                            return qualityLabel[emission_idx[idxValueFunc(tooltipItems.yLabel) + 1]] + (type !== "idx"? " (" + tooltipItems.yLabel + " µg/m³)": "")
                        }
                    },
                    labelColor: function (tooltipItems, data) {
                        return {
                            backgroundColor: colorIndex[idxValueFunc(tooltipItems.yLabel) + 1]
                        };
                    }
                }
            },
            legend: {
                display: false
            },
            scales: {
                yAxes: [{
                    ticks: {
                        beginAtZero:true
                    }
                }]
            }
        };
        if (type === "idx") {
            options.scales.yAxes[0].ticks.stepSize = 1;
            options.scales.yAxes[0].ticks.max = 6;
        } else {
            // fix the scale?
            //options.scales.yAxes[0].ticks.max = emission_limits[type].slice(-2, -1)[0];
        }
        var dataset = createDataset(history[type], idxValueFunc);
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: generateTimeLabels(from, to),
                datasets: [{
                    data: dataset.data,
                    backgroundColor: dataset.background
                }]
            },
            options: options
        });
    });
}

function loadHistory(station, from, to) {
    console.log('Retrieving station history data from the server');
    return new Promise(function (resolve, reject) {
        $.ajax({
            url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/history',
            method: 'GET',
            data: {
                station: station,
                from: from,
                to: to
            },
            headers: {
                'x-api-key': 'api_key_public_access'
            }
        }).done(function (result) {
            console.log("History query result: ", result);
            setHistory(from, to, result);
            resolve(result);
        }).catch(function (err) {
            console.error("Failed to retrieve station history: ", err);
            reject(err);
        });
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
