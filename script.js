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
var favoritesManipulated = false;
var db;
var recentPlaceHistory = [];
var busyLock = false;
var myCharts = [];
var myPatterns = {};
var myHistoryStation;
var userAction;
var backNavigation;
var exitPending = false;
var exitPendingId = 0;

var uvPrediction;
var uvPredictionChart;

// structural elements
var main_page;

const precision = {
    VERY_GOOD: 0,
    GOOD: 1,
    BAD: 2,
    INTERPOLATION: 3
};

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

var uv_idx = [
    "good",
    "satisfactory",
    "acceptable",
    "bad",
    "very_bad"
];

var uvLabel = {
    "good": "Nízký",
    "satisfactory": "Střední",
    "acceptable": "Vysoký",
    "bad": "Velmi vysoký",
    "very_bad": "Extrémní"
};

function uvIndex(value) {
    var idx = Math.round(value);
    if (idx <= 2) {
        return 0;
    } else if (idx <= 5) {
        return 1;
    } else if (idx <= 7) {
        return 2;
    } else if (idx <= 10) {
        return 3;
    } else {
        return 4;
    }
}

function setUvPrediction(prediction) {
    uvPrediction = prediction;

    $("#uv_running").remove();
    $("#alarm1").find(".alarm_running").removeClass("invisible");
    $("#slide1").find(".uv_outer").removeClass("invisible");

    if (typeof uvPredictionChart !== "undefined") {
        uvPredictionChart.destroy();
    }

    var options = {
        legend: {
            display: false
        },
        scales: {
            xAxes: [{
                scaleLabel: {
                    display: true,
                    labelString: "UV-Index",
                    fontSize: 36
                },
                ticks: {
                    fontSize: 30,
                    beginAtZero:true,
                    stepSize: 1,
                    suggestedMax: 11
                }
            }],
            yAxes: [{
                ticks: {
                    fontSize: 30
                }
            }]
        }
    };

    var currentTime = new Date().getTime();

    function dateStr(n) {
        var date = new Date(currentTime + n * 86400000);
        return date.getDate() + "." + (date.getMonth() + 1) + ".";
    }

    var labels = ["dnes", "zítra", dateStr(2), dateStr(3), dateStr(4), dateStr(5)];
    var background = prediction.map(function (value) {
        return colorIndex[uvIndex(value) + 3];
    });
    uvPredictionChart = new Chart($("#uv_prediction"), {
        type: "horizontalBar",
        data: {
            labels: labels,
            datasets: [{
                data: uvPrediction,
                borderColor: ["#FFFFFF"],
                borderWidth: [4],
                backgroundColor: background
            }]
        },
        options: options
    });

    displayUvPredictionAlarm();
}

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

        // reload UV index prediction
        loadUvPrediction();
    }
    if (store) {
        storeCurrentPlace();
    }
    displayLocation();
}

function displayLocation() {
    if (typeof myLocation !== 'undefined') {
        loadLocationName(myLocation.coords.latitude, myLocation.coords.longitude).then(function (name) {
            $(".location_name").text(name);
        });
    }
}

function initializeAlarm(targetElem, component, onClickFunc) {
    targetElem.append(component.clone());
    targetElem.find(".alarm_icon").click(onClickFunc);
}

function initializeComponents() {
    var components = $("#components");

    var alarmComponent = components.find(".alarm_component");
    initializeAlarm($("#alarm0"), alarmComponent, function () {
        if (typeof myAlarm !== 'undefined' && typeof myAlarm.code !== 'undefined') {
            removeEmissionAlarm();
        }
        return false;
    });
    initializeAlarm($("#alarm1"), alarmComponent, function () {});

    components.remove();
}

function updateSlidesHeight() {
    $(".slide_body").each(function (index, element) {
        updateSlideHeight($(element));
    });
}

function updateSlideHeight(slideBody) {
    slideBody.css("height", window.innerHeight - $(".footer").outerHeight() - slideBody.closest(".swiper-slide").find(".slide_header").outerHeight());
}


function initializeSwiper() {
    updateSlidesHeight();

    var pager = [
        '<i class="fa fa-leaf page" aria-hidden="true"></i>',
        '<i class="fa fa-sun-o page" aria-hidden="true"></i>'
    ];

    var options = {
        direction: 'horizontal',
        effect: 'flip',

        pagination: '.swiper-pagination',
        paginationClickable: true,
        paginationBulletRender: function (swiper, index, className) {
            return pager[index];
        },
        bulletClass: 'page',
        bulletActiveClass: 'page-active'
    };
    new Swiper('.swiper-container', options);
}

function initialize() {
    main_page = $("#main_page");

    initializeComponents();
    initializeSwiper();

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

        navigator.serviceWorker.addEventListener('message', notificationHandler);
    }

    loadMeta().then(function () {
        if (location.hash) {
            var stationCode = location.hash.substring(1);
            if (myStations[stationCode].name) {
                toggleDetail(stationCode, true);
            }
        }
        // make sure that we don't lose scroll position on "back"
        if ("scrollRestoration" in history) {
            history.scrollRestoration = "manual";
        }
        // TODO: applicable to either page
        // make sure "back" does not close the window
        history.pushState("", document.title, window.location.pathname + window.location.search);
        $(window).on('popstate', function() {
            if (!closeUserAction()) {
                // no outstanding action on current page
                if (typeof backNavigation !== "undefined") {
                    // navigate to main page
                    backNavigation();
                    backNavigation = undefined;
                } else {
                    // back on homepage with no outstanding action
                    console.log("Pending exit");
                    exitPending = true;
                    var myExit = ++exitPendingId;
                    setTimeout(function () {
                        if (exitPending && myExit == exitPendingId) {
                            console.log("Pending exit timed out, pushing state to history");
                            exitPending = false;
                            history.pushState("", document.title, window.location.pathname + window.location.search);
                        }
                    }, 1000);
                    return;
                }
            }
            console.log("Pushing state to history");
            history.pushState("", document.title, window.location.pathname + window.location.search);
        });
    });

    $("#time_spin").click(reload);

    installPreventPullToReload();

    recalculateMainPagePlaceHolder();

    var menu_items = $("#menu_items");
    var search = $("#search");
    var searchInput = $("#search_input");

    $("#menu_expander").click(function () {
        if (menu_items.hasClass("invisible")) {
            menu_items.removeClass("invisible");
            registerUserAction(function () {
                menu_items.addClass("invisible");
            });
        } else {
            closeUserAction();
        }
    });

    $("#menu_search").click(function () {
        search.removeClass("invisible");
        closeUserAction();
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
        closeUserAction();
        showFavoritesPage();
    });
    $("#favorites_navigation").click(hideFavoritesPage);
    var menuFilterFavorite = $("#menu_filter_favorite");
    var menuFilterFavoriteCheck = $("#menu_filter_favorite_check");
    menuFilterFavorite.click(function() {
        if (menuFilterFavorite.hasClass("disabled")) {
            return;
        }
        closeUserAction();
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
        locationPickerCurrent.click(busyCheck(function() {
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
        closeUserAction();
        hideHistoryPage();
    });

    var history_page = $("#history_page");
    var history_running = $("#history_running");
    $(window).scroll(function() {
        if (!history_page.hasClass("invisible") && history_running.hasClass("invisible")) {
            updateMeasurementName();
        }
    });

    var history_measurement_outer = $("#history_measurement_outer");
    select_dropdown(history_measurement_outer);

    var history_period_outer = $("#history_period_outer");
    select_dropdown(history_period_outer);

    select_item($("#history_period_1"), historyLoader);
    select_item($("#history_period_7"), historyLoader);
    select_item($("#history_period_28"), historyLoader);
}

function select_item(item, callback) {
    var select_outer = item.closest(".history_select");
    item.click(busyCheck(function () {
        if (select_outer.hasClass("select_border")) {
            if (!item.hasClass("select_item")) {
                select_outer.find(".select_item").removeClass("select_item");
                item.addClass("select_item");
                callback(item);
            }
            closeUserAction();
            return false;
        }
        return true;
    }));
}

function close_dropdown(select_outer) {
    select_outer.toggleClass("select_border no_border");
    select_outer.find(".item:not(.select_item)").addClass("invisible");
    select_outer.find(".item").removeClass("selecting");
}

function select_dropdown(select_outer) {
    select_outer.click(busyCheck(function () {
        if (!select_outer.hasClass("select_border")) {
            select_outer.toggleClass("select_border no_border");
            select_outer.find(".item").removeClass("invisible").addClass("selecting");
            registerUserAction(function () {
                close_dropdown(select_outer);
            });
        } else {
            closeUserAction();
        }
    }));
}

function registerUserAction(callback) {
    closeUserAction();
    userAction = {
        close: callback
    };
}

function closeUserAction() {
    if (typeof userAction !== "undefined") {
        userAction.close();
        userAction = undefined;
        return true;
    } else {
        return false;
    }
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
            return callback();
        }
    }
}

function busyLeave(progressElement) {
    busyLock = false;
    if (typeof progressElement !== "undefined") {
        progressElement.addClass("invisible");
    }
}

function busyCheck(callback) {
    return function() {
        if (!busyLock) {
            return callback();
        }
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

function disablePendingExit() {
    if (exitPending) {
        console.log("Navigation disables pending exit, pushing state to history");
        exitPending = false;
        history.pushState("", document.title, window.location.pathname + window.location.search);
    }
}

function toggleLocationPage() {
    disablePendingExit();
    $("#footer").toggleClass("invisible");
    $("#location_page").toggleClass("invisible");
    main_page.toggleClass("invisible");
    if (main_page.hasClass("invisible")) {
        backNavigation = toggleLocationPage;
    }
    recalculateLocationPlaceHolder();
}

function filterChangeHandler() {
    myFilter = $("#search_input").val();
    applyFilter();
}

function showFavoritesPage() {
    disablePendingExit();
    $("#footer").addClass("invisible");
    main_page.addClass("invisible");
    $("#favorites_page").removeClass("invisible");
    backNavigation = hideFavoritesPage;
    recalculateFavoritesPlaceHolder();
}

function hideFavoritesPage() {
    $("#footer").removeClass("invisible");
    $("#favorites_page").addClass("invisible");
    main_page.removeClass("invisible");
    updateFavoriteMenuItem(true);
    applyFavoriteFilter();
    favoritesManipulated = false;
}

var historySaveScrollTop;

function orientationErr(err) {
    console.warn("cannot switch orientation", err);
}

function showHistoryPage() {
    disablePendingExit();
    $("#footer").addClass("invisible");
    historySaveScrollTop = $(window).scrollTop();
    main_page.addClass("invisible");
    $("#history_page").removeClass("invisible");
    backNavigation = hideHistoryPage;
    screen.orientation.lock("landscape").catch(orientationErr);
    recalculateHistoryPlaceHolder();
}

function hideHistoryPage() {
    $("#footer").removeClass("invisible");
    $("#history_page").addClass("invisible");
    main_page.removeClass("invisible");
    screen.orientation.lock("portrait").catch(orientationErr);
    $(window).scrollTop(historySaveScrollTop);
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
    var customRefresh = false;
    var lastTouchY = 0;

    function touchstartHandler(e) {
        if (e.touches.length != 1) {
            return;
        }
        lastTouchY = e.touches[0].clientY;
        preventRefresh = window.pageYOffset == 0;
        customRefresh = false;
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
                customRefresh = true;
            }
        }

        if (customRefresh && touchYDelta > 100) {
            customRefresh = false;
            console.log('Perform custom page reload');
            reload();
        }
    }

    window.addEventListener('touchstart', touchstartHandler, {passive: false});
    window.addEventListener('touchmove', touchmoveHandler, {passive: false});
}

function reload() {
    var timeSpin = $("#time_spin");

    if (main_page.hasClass("invisible")) {
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
    var stationSpinner = $("<i class='fa fa-refresh fa-spin fa-fw invisible station_spinner'/>");
    stationSpinner.attr('id', stationCode + "_spinner");
    // stationSpinner.addClass(station.qualityClass + "_spinner");
    stationDiv.append(stationSpinner);
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
                scrollTop: $("#" + stationCode).offset().top - $("#header_place_holder").height() - parseInt($("body").css('margin-top'))
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

function setDetail(pDetail) {
    var stationCode = pDetail.code;
    var data = pDetail.data;

    var station = myStations[stationCode];

    station.detail = {
        data: data
    };
    
    $("#" + stationCode + "_spinner").addClass("invisible");

    var detail = $("#" + stationCode + "_detail");

    var summaryDiv = $("<div class='detail_panel'>");
    summaryDiv.addClass(station.qualityClass);
    summaryDiv.text("Kvalita ovzduší: " + qualityLabel[station.qualityClass]);
    if (typeof pDetail.lastIdx !== "undefined" && station.idx > 0 && pDetail.lastIdx > 0) {
        var trend = $("<i class='material-icons md-50'></i>");
        if (pDetail.lastIdx < station.idx) {
            trend.text("trending_down"); // getting worse
        } else if (pDetail.lastIdx > station.idx) {
            trend.text("trending_up"); // getting better
        } else {
            trend.text("trending_flat");
        }
        summaryDiv.append(trend);
    }
    detail.append(summaryDiv);

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

    if (detail.children().length == 1) { // only summary
        var noDataAvailable = $("<div class='nodata incomplete'>Nejsou k dispozici žádná měření</div>");
        detail.append(noDataAvailable);
    }

    var historyDiv = $("<div class='detail_panel history_panel'></div>");
    historyDiv.addClass(station.qualityClass);
    historyDiv.append($("<i class='fa fa-bar-chart history_panel' aria-hidden='true'></i>"));
    historyDiv.append(document.createTextNode("Historie měření"));
    historyDiv.click(function () {
        myHistoryStation = stationCode;
        showHistoryPage();
        historyLoader();
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
                    updateEmissionAlarm(stationCode, targetLevel);
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
                    updateEmissionAlarm(stationCode, level);
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
    $("#stations_running").remove();
    showAlarmProgress($("#alarm0"));
    var slide = $("#slide0");
    slide.find(".stations_outer").removeClass("invisible");
    updateSlideHeight((slide.find(".slide_body")));

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

    displayEmissionAlarm();
}

function updateFavoriteMenuItem(store) {
    var menuFilterFavorite = $("#menu_filter_favorite");
    var menuFilterFavoriteCheck = $("#menu_filter_favorite_check");
    var idx = Object.keys(myFavorites).findIndex(function (item) {
        return myFavorites[item] === true && item !== "enabled";
    });
    if (idx < 0) {
        menuFilterFavoriteCheck.removeClass("fa-check-square-o");
        menuFilterFavoriteCheck.addClass("fa-square-o");
        menuFilterFavorite.addClass("disabled");
        if (myFavorites["enabled"] === true) {
            myFavorites["enabled"] = false;
            store = true;
        }
    } else {
        if (store && favoritesManipulated) {
            // if favorites were manipulated, enable them
            menuFilterFavoriteCheck.addClass("fa-check-square-o");
            menuFilterFavoriteCheck.removeClass("fa-square-o");
            myFavorites["enabled"] = true;
        }
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
        favoritesManipulated = true;
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

function showAlarmProgress(alarm) {
    alarm.find(".alarm_running").removeClass("invisible");
}

function setToken(token) {

    function removeAlarmProgress() {
        var alarms = $(".alarm_component");
        alarms.find(".alarm_running").remove();
        alarms.find(".alarm_outer").removeClass("invisible").addClass("visible");
    }

    if (token !== myToken) {
        myToken = token;
        if (token !== false) {
            loadAlarm().then(removeAlarmProgress);
            addAlarmPanelToDetails();
        } else {
            setAlarm(false);
            removeAlarmProgress();
        }
    }
}

function setAlarm(alarm) {
    myAlarm = alarm;
    displayAlarms();
}

function displayAlarms() {
    displayEmissionAlarm();
    displayUvPredictionAlarm();
}

function displayAlarm(alarm, active, stationName, valueText, valueClass, levelText, levelNumber, levelClass, levelImprovement, direction) {
    var alarmOuterElems = alarm.find(".alarm_outer");
    var alarmLevel = alarm.find(".alarm_level");
    var alarmDirection = alarm.find(".alarm_direction");
    var alarmValue = alarm.find(".alarm_value");
    var alarmLocation = alarm.find(".alarm_location_name");
    var alarmLevelNumber = alarm.find(".alarm_level_number");

    // make the alarm visible
    alarmOuterElems.removeClass("invisible").addClass("visible");

    if (active) {
        alarmOuterElems.removeClass("inactive");
    } else {
        alarmOuterElems.addClass("inactive");
    }

    alarmLocation.text(stationName);
    alarmValue.text(valueText).removeClass("undetermined incomplete very_good good satisfactory acceptable bad very_bad").addClass(valueClass);
    alarmLevel.text(levelText).removeClass("very_good good satisfactory acceptable bad very_bad").addClass(levelClass);
    alarmLevelNumber.text(levelNumber).removeClass("very_good good satisfactory acceptable bad very_bad quality_improvement").addClass(levelClass);
    if (levelImprovement) {
        alarmLevelNumber.addClass("quality_improvement");
    }
    alarmDirection.text(direction);
}

function displayUvPredictionAlarm() {
    var alarm = $("#alarm1");

    if (typeof uvPrediction === "undefined" || typeof myAlarm === "undefined") {
        return;
    }

    if (myAlarm === false || typeof myAlarm.uvLevel === "undefined") {
        displayAlarm(alarm, false, "", "", "", "nenastaveno", "", "", false, "");
        return;
    }

    var valueClass = uv_idx[uvIndex(uvPrediction[0])];
    var valueText = uvLabel[valueClass] + "-" + Math.round(uvPrediction[0]);
    var levelClass = uv_idx[uvIndex(myAlarm.uvLevel)];
    var levelText = uvLabel[levelClass] + "-" + myAlarm.uvLevel;

    displayAlarm(alarm, true, myAlarm.uvLocation, valueText, valueClass, levelText, myAlarm.uvLevel, levelClass, "", "a horší");
}

function displayEmissionAlarm() {
    var alarm = $("#alarm0");

    if (typeof myStations === "undefined" || typeof myAlarm === 'undefined') {
        return;
    }

    if (myAlarm === false || typeof myAlarm.code === "undefined") {
        displayAlarm(alarm, false, "", "", "", "nenastaveno", "", "", false, "");
        return;
    }

    var station = myStations[myAlarm.code];
    var stationName = typeof myStations[myAlarm.code] === "undefined"? "neznámá stanice": myStations[myAlarm.code].name;

    var valueClass = emission_idx[station.idx + 1];
    var valueText = qualityLabel[valueClass];
    var levelClass = emission_idx[Math.abs(myAlarm.level) + 1];
    var levelText = qualityLabel[levelClass];
    var levelImprovement = (myAlarm.level < 0);

    var direction;
    if (myAlarm.level == -1 || myAlarm.level == 6) {
        direction = "";
    } else if (myAlarm.level > 0) {
        direction = " a horší";
    } else {
        direction = " a lepší";
    }

    displayAlarm(alarm, true, stationName, valueText, valueClass, levelText, Math.abs(myAlarm.level), levelClass, levelImprovement, direction);
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

function notificationHandler(payload) {
    console.log("Message received, reload alarm and meta", payload);

    loadAlarm();
    loadMeta().then(function () {
        console.log('Load detail of the station in alarm');
        toggleDetail(payload.data.stationCode, true);
        foregroundAlarm(parseInt(payload.data.stationIdx));
    });
}

messaging.onMessage(notificationHandler);

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

function removeEmissionAlarm() {
    // TODO: refactor alarm structure & lambda
    delete myAlarm.code;
    delete myAlarm.level;
    myAlarm.remove = true;
    updateAlarm();
    displayEmissionAlarm();
}

function updateEmissionAlarm(code, level) {
    myAlarm.code = code;
    myAlarm.level = level;
    delete myAlarm.remove;
    updateAlarm();
    displayEmissionAlarm();
}

function updateAlarm() {
    myAlarm.token = myToken;
    // waiting for the server call makes the app look a little bit unresponsive, let's assume the operation succeeds
    $.ajax({
        url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/alarm',
        method: 'POST',
        data: JSON.stringify(myAlarm),
        contentType: 'application/json',
        headers: {
            'x-api-key': 'api_key_public_access'
        }
    }).fail(function (err) {
        console.error("Unablet to set alarm: ", myAlarm, err);
        // revert to previous setting if server didn't succeed
        // TODO: reload from server and show
    });
}

function loadAlarm() {
    return new Promise(function (resolve, reject) {
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
            resolve(item);
        });
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

function precisionFunc(days) {
    return function(count) {
        if (days === 1) {
            if (count === 1) {
                return precision.VERY_GOOD;
            } else {
                return precision.INTERPOLATION;
            }
        } else if (days === 7) {
            if (count >= 6) {
                return precision.VERY_GOOD;
            } else if (count >= 4) {
                return precision.GOOD;
            } else if (count >= 1) {
                return precision.BAD;
            } else {
                return precision.INTERPOLATION;
            }
        } else if (days === 28) {
            if (count >= 25) {
                return precision.VERY_GOOD;
            } else if (count >= 13) {
                return precision.GOOD;
            } else if (count >= 1) {
                return precision.BAD;
            } else {
                return precision.INTERPOLATION;
            }
        } else {
            console.warn("Unsupported internval: " + days + " days");
            return 0;
        }
    }
}

function historyLoader() {
    var measurementType = $("#history_measurement").find(".select_item").data("type");
    var history_navigation = $("#history_navigation");
    var history_running = $("#history_running");
    history_navigation.addClass("invisible");
    history_running.removeClass("invisible");
    busyLock = true;
    displayHistory(measurementType).then(function () {
        busyLock = false;
        history_running.addClass("invisible");
        history_navigation.removeClass("invisible");
    });
}

function displayHistory(measurementType) {
    var station = myStations[myHistoryStation];
    $("#history_station").text(station.name);
    $("#history_charts").empty();

    var days = $("#history_period > .select_item").data("value");
    var to = myMeta.date;
    var from = new Date(parseUtcDate(to).getTime() - 1000 * 60 * 60 * (24 * days - 1));
    var multipleDays = (days > 1);
    return loadHistory(myHistoryStation, toUtcDate(from), to, precisionFunc(days), measurementType, multipleDays).then(function (measurementTypeSelected) {
        if (!measurementTypeSelected) {
            updateMeasurementName();
        }
    });
}

function colorPattern(color, p) {
    var colorAndPrecision = color + "_" + p;
    if (typeof myPatterns[colorAndPrecision] === "undefined") {
        var canvas = document.createElement("canvas");
        var context = canvas.getContext("2d");

        canvas.width = 10;
        canvas.height = 10;

        context.beginPath();
        context.fillStyle = color;
        context.fillRect(0, 0, 10, 10);
        context.moveTo(0, 10);
        context.lineTo(10, 0);
        if (p === precision.BAD) {
            context.moveTo(10, 10);
            context.lineTo(0, 0);
        }
        context.stroke();

        myPatterns[colorAndPrecision] = context.createPattern(canvas, "repeat");
    }
    return myPatterns[colorAndPrecision];
}

function createDataset(values, idxFunc, precisionFunc) {
    var bg = [];
    var data = [];
    var borderColor = [];
    var borderWidth = [];
    for (var i = 0; i < values.length; i++) {
        var value = values[i][0];
        data.push(value);
        var color = colorIndex[idxFunc(value) + 1];

        var p = precisionFunc(values[i][1]);
        switch (p) {
            case precision.VERY_GOOD:
                // solid bar
                bg.push(color);
                borderColor.push(undefined);
                borderWidth.push(0);
                break;

            case precision.GOOD:
            case precision.BAD:
                // pattern
                bg.push(colorPattern(color, p));
                borderColor.push(undefined);
                borderWidth.push(0);
                break;

            case precision.INTERPOLATION:
                // border only
                bg.push("#000000");
                borderColor.push(color);
                borderWidth.push(4);
                break;
        }
    }
    return {
        data: data,
        background: bg,
        borderColor: borderColor,
        borderWidth: borderWidth
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

function generateTimeLabels(to) {

    function pad(n) {
        return n < 10? "0" + String(n): String(n);
    }
    var toDate = parseUtcDate(to);
    var fromTime = toDate.getTime() - 3600000 * 23;
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

function sortMeasurements(a, b) {
    function w(val) {
        switch (val) {
            case "idx":
                return "0";

            case "PM10_1h":
                return "1";

            case "PM2_5_1h":
                return "9";

            default:
                return "5" + val;
        }
    }
    var wa = w(a);
    var wb = w(b);
    return wa == wb? 0: (wa < wb? -1: 1);
}

function setHistory(to, history, precisionFunc, selectMeasurementType, multipleDays) {
    var charts = $("#history_charts");
    charts.empty();
    myCharts = [];

    var measurements = $("#history_measurement");
    measurements.empty();

    var measurementTypeSelected = false;
    var types = Object.keys(history);
    types.sort(sortMeasurements);
    types.forEach(function (type) {
        var idxValueFunc;
        if (type === "idx") {
            idxValueFunc = function (value) {
                return Math.round(value);
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

        function scrollTo() {
            $('html, body').animate({
                scrollTop: chartDiv.offset().top - $("#history_place_holder").height() - parseInt($("body").css('margin-top'))
            }, 100);
        }

        var measurementDiv = $("<div class='item invisible'>");
        measurementDiv.data("type", type);
        measurementDiv.text(getMeasurementName(type));
        measurementDiv.click(function () {
            var historyMeasurementOuter = $("#history_measurement_outer");
            if (historyMeasurementOuter.hasClass("select_border")) {
                closeUserAction();
                scrollTo();
                return false;
            } else {
                return true;
            }
        });
        measurements.append(measurementDiv);

        myCharts.push({ elem: canvas, measurement: measurementDiv });

        if (type === selectMeasurementType) {
            scrollTo();
            measurementDiv.toggleClass("select_item invisible");
            measurementTypeSelected = true;
        }

        var options = {
            tooltips: {
                callbacks: {
                    label: function (tooltipItems, data) {
                        var count = history[type][(tooltipItems.index + startOffset) % 24][1];
                        var suffix = [];
                        if (type !== "idx") {
                            suffix.push(tooltipItems.yLabel.toFixed(2) + " µg/m³");
                        }
                        if (count === 0) {
                            suffix.push("interpolace");
                        } else if (multipleDays) {
                            suffix.push("ø " + count + " měření");
                        }
                        var suffixStr = suffix.join(", ");
                        if (suffixStr.length > 0) {
                            suffixStr = " (" + suffixStr + ")";
                        }
                        return qualityLabel[emission_idx[idxValueFunc(tooltipItems.yLabel) + 1]] + suffixStr;
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
        var dataset = createDataset(history[type], idxValueFunc, precisionFunc);
        var timeLabels = generateTimeLabels(to);
        var startOffset = 0;
        if (multipleDays) {
            startOffset = timeLabels.indexOf("0:00");
            if (startOffset > 0) {
                Array.prototype.push.apply(timeLabels, timeLabels.splice(0, startOffset));
                Array.prototype.push.apply(dataset.data, dataset.data.splice(0, startOffset));
                Array.prototype.push.apply(dataset.background, dataset.background.splice(0, startOffset));
                Array.prototype.push.apply(dataset.borderColor, dataset.borderColor.splice(0, startOffset));
                Array.prototype.push.apply(dataset.borderWidth, dataset.borderWidth.splice(0, startOffset));
            }
        }
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: timeLabels,
                datasets: [{
                    data: dataset.data,
                    backgroundColor: dataset.background,
                    borderColor: dataset.borderColor,
                    borderWidth: dataset.borderWidth
                }]
            },
            options: options
        });
    });

    return measurementTypeSelected;
}

function loadHistory(station, from, to, precisionFunc, type, multipleDays) {
    console.log('Retrieving station history data from the server');
    return new Promise(function (resolve, reject) {
        $.ajax({
            url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/history',
            method: 'GET',
            data: {
                station: station,
                from: from,
                to: to,
                byHour: true
            },
            headers: {
                'x-api-key': 'api_key_public_access'
            }
        }).done(function (result) {
            console.log("History query result: ", result);
            var typeSelected = setHistory(to, result, precisionFunc, type, multipleDays);
            resolve(typeSelected);
        }).catch(function (err) {
            console.error("Failed to retrieve station history: ", err);
            reject(err);
        });
    });
}

function loadUvPrediction() {
    console.log("Retrieving UV prediction data");
    return new Promise(function (resolve, reject) {
        $.ajax({
            url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/uv/prediction',
            method: 'GET',
            headers: {
                'x-api-key': 'api_key_public_access'
            },
            data: {
                lat: myLocation.coords.latitude,
                lon: myLocation.coords.longitude
            }
        }).done(function (prediction) {
            console.log("UV index prediction: ", prediction);
            setUvPrediction(prediction);
            resolve(prediction);
        }).catch(function (err) {
            console.error("Failed to retrieve UV index prediction: ", err);
            reject(err);
        });
    });
}

function loadMeta() {
    console.log('Retrieving meta data from the server');
    return new Promise(function (resolve, reject) {
        var meta = {"date":"2017-03-22 08:00:00.0 UTC","regions":{"Středočeský":{"SPBRA":{"loc":["49.676315","13.991222"],"name":"Příbram-Březové Hory","idx":1,"regionName":"Středočeský","qualityClass":"very_good","distance":53.07},"SBERA":{"loc":["49.957928","14.058300"],"name":"Beroun","idx":2,"regionName":"Středočeský","qualityClass":"good","distance":30.2},"SKLSA":{"loc":["50.167412","14.106048"],"name":"Kladno-Švermov","idx":3,"regionName":"Středočeský","qualityClass":"satisfactory","distance":28.41},"SONRA":{"loc":["49.913513","14.782625"],"name":"Ondřejov","idx":-1,"regionName":"Středočeský","qualityClass":"undetermined","distance":27.59},"SRORA":{"loc":["50.301983","15.178303"],"name":"Rožďalovice-Ruská","idx":1,"regionName":"Středočeský","qualityClass":"very_good","distance":58.64},"STCSA":{"loc":["49.918503","14.094489"],"name":"Tobolka-Čertovy schody","idx":-1,"regionName":"Středočeský","qualityClass":"undetermined","distance":29.63},"SKLMA":{"loc":["50.143860","14.101784"],"name":"Kladno-střed města","idx":1,"regionName":"Středočeský","qualityClass":"very_good","distance":27.56},"SMBOA":{"loc":["50.428646","14.913859"],"name":"Mladá Boleslav","idx":1,"regionName":"Středočeský","qualityClass":"very_good","distance":53.42}},"Vysočina":{"JKMYA":{"loc":["49.159153","15.439048"],"name":"Kostelní Myslová","idx":-1,"regionName":"Vysočina","qualityClass":"undetermined","distance":121.45},"JJIZA":{"loc":["49.393333","15.592500"],"name":"Jihlava-Znojemská","idx":3,"regionName":"Vysočina","qualityClass":"satisfactory","distance":109.28},"JHBSA":{"loc":["49.605556","15.579167"],"name":"Havl.Brod-Smetan.nám.","idx":1,"regionName":"Vysočina","qualityClass":"very_good","distance":94.26},"JJIHA":{"loc":["49.401596","15.610246"],"name":"Jihlava","idx":2,"regionName":"Vysočina","qualityClass":"good","distance":109.63},"JZNZA":{"loc":["49.559723","15.943056"],"name":"Ždár nad Sázavou","idx":1,"regionName":"Vysočina","qualityClass":"very_good","distance":119.6},"JKOSA":{"loc":["49.573395","15.080278"],"name":"Košetice","idx":1,"regionName":"Vysočina","qualityClass":"very_good","distance":69.08},"JTREA":{"loc":["49.223438","15.865778"],"name":"Třebíč","idx":3,"regionName":"Vysočina","qualityClass":"satisfactory","distance":136.65}},"Praha":{"ALEGA":{"loc":["50.072388","14.430673"],"name":"Praha 2-Legerova (hot spot)","idx":3,"regionName":"Praha","qualityClass":"satisfactory","distance":3.4},"ASMIA":{"loc":["50.073135","14.398141"],"name":"Praha 5-Smíchov","idx":2,"regionName":"Praha","qualityClass":"good","distance":5.13},"ALIBA":{"loc":["50.007305","14.445933"],"name":"Praha 4-Libuš","idx":2,"regionName":"Praha","qualityClass":"good","distance":4.5},"ACHOA":{"loc":["50.030170","14.517450"],"name":"Praha 4-Chodov","idx":0,"regionName":"Praha","qualityClass":"incomplete","distance":4.68},"AVYNA":{"loc":["50.111080","14.503096"],"name":"Praha 9-Vysočany","idx":3,"regionName":"Praha","qualityClass":"satisfactory","distance":7.83},"ARIEA":{"loc":["50.081482","14.442692"],"name":"Praha 2-Riegrovy sady","idx":2,"regionName":"Praha","qualityClass":"good","distance":3.97},"ASTOA":{"loc":["50.046131","14.331413"],"name":"Praha 5-Stodůlky","idx":1,"regionName":"Praha","qualityClass":"very_good","distance":9},"AKOBA":{"loc":["50.122189","14.467578"],"name":"Praha 8-Kobylisy","idx":1,"regionName":"Praha","qualityClass":"very_good","distance":8.39},"APRUA":{"loc":["50.062298","14.537820"],"name":"Praha 10-Průmyslová","idx":2,"regionName":"Praha","qualityClass":"good","distance":5.98},"AVRSA":{"loc":["50.066429","14.446152"],"name":"Praha 10-Vršovice","idx":1,"regionName":"Praha","qualityClass":"very_good","distance":2.3},"AKALA":{"loc":["50.094238","14.442049"],"name":"Praha 8-Karlín","idx":1,"regionName":"Praha","qualityClass":"very_good","distance":5.36},"ASUCA":{"loc":["50.126530","14.384639"],"name":"Praha 6-Suchdol","idx":1,"regionName":"Praha","qualityClass":"very_good","distance":10.25},"ABREA":{"loc":["50.084385","14.380116"],"name":"Praha 6-Břevnov","idx":3,"regionName":"Praha","qualityClass":"satisfactory","distance":6.91},"AREPA":{"loc":["50.088066","14.429220"],"name":"Praha 1-n. Republiky","idx":3,"regionName":"Praha","qualityClass":"satisfactory","distance":4.98}},"Královéhradecký":{"HHKBA":{"loc":["50.195362","15.846376"],"name":"Hradec Králové-Brněnská","idx":1,"regionName":"Královéhradecký","qualityClass":"very_good","distance":100.39},"HPLOA":{"loc":["50.350277","16.322500"],"name":"Polom","idx":1,"regionName":"Královéhradecký","qualityClass":"very_good","distance":136.96},"HTRTA":{"loc":["50.565880","15.903927"],"name":"Trutnov - Tkalcovská","idx":1,"regionName":"Královéhradecký","qualityClass":"very_good","distance":117.81},"HKRYA":{"loc":["50.660439","15.850090"],"name":"Krkonoše-Rýchory","idx":-1,"regionName":"Královéhradecký","qualityClass":"undetermined","distance":120.06},"HHKOK":{"loc":["50.177631","15.838390"],"name":"Hradec Králové-observatoř","idx":-1,"regionName":"Královéhradecký","qualityClass":"undetermined","distance":99.54}},"Zlínský":{"ZZLNA":{"loc":["49.232906","17.667175"],"name":"Zlín","idx":1,"regionName":"Zlínský","qualityClass":"very_good","distance":248.2},"ZTNVA":{"loc":["49.259392","17.410561"],"name":"Těšnovice","idx":1,"regionName":"Zlínský","qualityClass":"very_good","distance":229.91},"ZVMZA":{"loc":["49.472057","17.966976"],"name":"Valašské Meziříčí","idx":1,"regionName":"Zlínský","qualityClass":"very_good","distance":260.05},"ZUHRA":{"loc":["49.067951","17.466848"],"name":"Uherské Hradiště","idx":2,"regionName":"Zlínský","qualityClass":"good","distance":242.82},"ZOTMA":{"loc":["49.208912","17.534742"],"name":"Otrokovice-město","idx":0,"regionName":"Zlínský","qualityClass":"incomplete","distance":240.42},"ZSNVA":{"loc":["49.047817","18.007828"],"name":"Štítná n.Vláří","idx":-1,"regionName":"Zlínský","qualityClass":"undetermined","distance":279.17}},"Pardubický":{"EPAUA":{"loc":["50.024036","15.763549"],"name":"Pardubice Dukla","idx":1,"regionName":"Pardubický","qualityClass":"very_good","distance":93.32},"ESVRA":{"loc":["49.735085","16.034197"],"name":"Svratouch","idx":-1,"regionName":"Pardubický","qualityClass":"undetermined","distance":118.16},"EPAOA":{"loc":["50.042198","15.739414"],"name":"Pardubice-Rosice","idx":-1,"regionName":"Pardubický","qualityClass":"undetermined","distance":91.54},"EMTPA":{"loc":["49.758995","16.666721"],"name":"Moravská Třebová - Piaristická.","idx":3,"regionName":"Pardubický","qualityClass":"satisfactory","distance":161.43}},"Plzeňský":{"PPLAA":{"loc":["49.732449","13.402281"],"name":"Plzeň-Slovany","idx":2,"regionName":"Plzeňský","qualityClass":"good","distance":83.29},"PPMOA":{"loc":["49.692787","13.352594"],"name":"Plzeň - mobil 20.03.2013 Plzeň - Litice","idx":1,"regionName":"Plzeňský","qualityClass":"very_good","distance":88.44},"PPLEA":{"loc":["49.747330","13.381039"],"name":"Plzeň-střed","idx":1,"regionName":"Plzeňský","qualityClass":"very_good","distance":83.99},"PPLSA":{"loc":["49.745991","13.320748"],"name":"Plzeň-Skvrňany","idx":0,"regionName":"Plzeňský","qualityClass":"incomplete","distance":88.03},"PPLBA":{"loc":["49.728394","13.375540"],"name":"Plzeň-Bory","idx":0,"regionName":"Plzeňský","qualityClass":"incomplete","distance":85.22},"PPRMA":{"loc":["49.669582","12.677884"],"name":"Přimda","idx":-1,"regionName":"Plzeňský","qualityClass":"undetermined","distance":134.29},"PKUJA":{"loc":["49.722000","13.618538"],"name":"Kamenný Újezd","idx":1,"regionName":"Plzeňský","qualityClass":"very_good","distance":70.13},"PPLVA":{"loc":["49.768616","13.423381"],"name":"Plzeň-Doubravka","idx":0,"regionName":"Plzeňský","qualityClass":"incomplete","distance":80.26},"PPLLA":{"loc":["49.770126","13.368221"],"name":"Plzeň-Lochotín","idx":1,"regionName":"Plzeňský","qualityClass":"very_good","distance":83.86}},"Moravskoslezský":{"TOPOA":{"loc":["49.825294","18.159275"],"name":"Ostrava-Poruba/ČHMÚ","idx":-1,"regionName":"Moravskoslezský","qualityClass":"undetermined","distance":266.06},"TKAOK":{"loc":["49.858891","18.557777"],"name":"Karviná-ZÚ","idx":2,"regionName":"Moravskoslezský","qualityClass":"good","distance":294.07},"TCTNA":{"loc":["49.748959","18.609726"],"name":"Český Těšín","idx":2,"regionName":"Moravskoslezský","qualityClass":"good","distance":299.21},"TOVKA":{"loc":["49.944988","17.909531"],"name":"Opava-Kateřinky","idx":1,"regionName":"Moravskoslezský","qualityClass":"very_good","distance":247},"TOROK":{"loc":["49.818539","18.340343"],"name":"Ostrava-Radvanice OZO","idx":1,"regionName":"Moravskoslezský","qualityClass":"very_good","distance":279.04},"TOREK":{"loc":["49.807056","18.339138"],"name":"Ostrava-Radvanice ZÚ","idx":0,"regionName":"Moravskoslezský","qualityClass":"incomplete","distance":279.11},"TCERA":{"loc":["49.777142","17.541946"],"name":"Červená hora","idx":-1,"regionName":"Moravskoslezský","qualityClass":"undetermined","distance":222.88},"TCTAA":{"loc":["49.745152","18.621593"],"name":"Český Těšín-autobusové nádraží","idx":2,"regionName":"Moravskoslezský","qualityClass":"good","distance":300.12},"TONVA":{"loc":["49.824116","18.234913"],"name":"Ostrava Nová Ves-areál OVak","idx":3,"regionName":"Moravskoslezský","qualityClass":"satisfactory","distance":271.46},"TKARA":{"loc":["49.863796","18.551453"],"name":"Karviná","idx":2,"regionName":"Moravskoslezský","qualityClass":"good","distance":293.56},"TOPRA":{"loc":["49.856258","18.269741"],"name":"Ostrava-Přívoz","idx":2,"regionName":"Moravskoslezský","qualityClass":"good","distance":273.55},"TOFFA":{"loc":["49.839188","18.263689"],"name":"Ostrava-Fifejdy","idx":1,"regionName":"Moravskoslezský","qualityClass":"very_good","distance":273.32},"TOCBA":{"loc":["49.839848","18.289976"],"name":"Ostrava-Českobratrská (hot spot)","idx":3,"regionName":"Moravskoslezský","qualityClass":"satisfactory","distance":275.19},"TTROA":{"loc":["49.668114","18.677799"],"name":"Třinec-Kosmos","idx":2,"regionName":"Moravskoslezský","qualityClass":"good","distance":305.42},"TOUZA":{"loc":["49.936539","17.905169"],"name":"Opava-univerzitní zahrada","idx":1,"regionName":"Moravskoslezský","qualityClass":"very_good","distance":246.75},"TOZRA":{"loc":["49.796040","18.247181"],"name":"Ostrava-Zábřeh","idx":1,"regionName":"Moravskoslezský","qualityClass":"very_good","distance":272.71},"TTRKA":{"loc":["49.672379","18.643038"],"name":"Třinec-Kanada","idx":2,"regionName":"Moravskoslezský","qualityClass":"good","distance":302.87},"TOMHK":{"loc":["49.824860","18.263655"],"name":"Ostrava-Mariánské Hory","idx":1,"regionName":"Moravskoslezský","qualityClass":"very_good","distance":273.5},"TBKRA":{"loc":["49.502609","18.538561"],"name":"Bílý Kříž","idx":-1,"regionName":"Moravskoslezský","qualityClass":"undetermined","distance":299.21},"TFMIA":{"loc":["49.671791","18.351070"],"name":"Frýdek-Místek","idx":2,"regionName":"Moravskoslezský","qualityClass":"good","distance":282.18},"TSTDA":{"loc":["49.720936","18.089306"],"name":"Studénka","idx":1,"regionName":"Moravskoslezský","qualityClass":"very_good","distance":262.7},"TVERA":{"loc":["49.924679","18.422873"],"name":"Věřňovice","idx":1,"regionName":"Moravskoslezský","qualityClass":"very_good","distance":283.8},"TOPDA":{"loc":["49.835506","18.165279"],"name":"Ostrava-Poruba, DD","idx":1,"regionName":"Moravskoslezský","qualityClass":"very_good","distance":266.35},"THARA":{"loc":["49.790977","18.406836"],"name":"Havířov","idx":3,"regionName":"Moravskoslezský","qualityClass":"satisfactory","distance":284.15},"TRYCA":{"loc":["49.871670","18.377254"],"name":"Rychvald","idx":1,"regionName":"Moravskoslezský","qualityClass":"very_good","distance":281.05}},"Jihočeský":{"CCBDA":{"loc":["48.984386","14.465684"],"name":"České Budějovice","idx":1,"regionName":"Jihočeský","qualityClass":"very_good","distance":118.17},"CPRAA":{"loc":["49.016087","14.000444"],"name":"Prachatice","idx":1,"regionName":"Jihočeský","qualityClass":"very_good","distance":119.29},"CHVOA":{"loc":["48.724197","14.723382"],"name":"Hojná Voda","idx":1,"regionName":"Jihočeský","qualityClass":"very_good","distance":148.35},"CKOCA":{"loc":["49.467243","13.838234"],"name":"Kocelovice","idx":-1,"regionName":"Jihočeský","qualityClass":"undetermined","distance":78.33},"CTABA":{"loc":["49.411232","14.676389"],"name":"Tábor","idx":1,"regionName":"Jihočeský","qualityClass":"very_good","distance":72.43},"CCHUA":{"loc":["49.068436","13.614801"],"name":"Churáňov","idx":-1,"regionName":"Jihočeský","qualityClass":"undetermined","distance":124.64}},"Jihomoravský":{"BBMLA":{"loc":["49.165260","16.580812"],"name":"Brno-Lány","idx":1,"regionName":"Jihomoravský","qualityClass":"very_good","distance":181.72},"BMOCA":{"loc":["49.208195","16.778444"],"name":"Sivice","idx":2,"regionName":"Jihomoravský","qualityClass":"good","distance":191.42},"BZNOA":{"loc":["48.842957","16.060127"],"name":"Znojmo","idx":2,"regionName":"Jihomoravský","qualityClass":"good","distance":177.06},"BHODA":{"loc":["48.857224","17.133333"],"name":"Hodonín","idx":1,"regionName":"Jihomoravský","qualityClass":"very_good","distance":234.33},"BBNIA":{"loc":["49.213211","16.678024"],"name":"Brno-Líšeň","idx":1,"regionName":"Jihomoravský","qualityClass":"very_good","distance":184.86},"BMISA":{"loc":["48.791767","16.724497"],"name":"Mikulov-Sedlec","idx":1,"regionName":"Jihomoravský","qualityClass":"very_good","distance":215.33},"BBMAA":{"loc":["49.216087","16.613836"],"name":"Brno-Arboretum","idx":1,"regionName":"Jihomoravský","qualityClass":"very_good","distance":180.7},"BBNAA":{"loc":["49.188889","16.626944"],"name":"Brno-Masná","idx":2,"regionName":"Jihomoravský","qualityClass":"good","distance":183.11},"BKUCA":{"loc":["48.881355","16.085817"],"name":"Kuchařovice","idx":0,"regionName":"Jihomoravský","qualityClass":"incomplete","distance":175.06},"BBMZA":{"loc":["49.185883","16.613661"],"name":"Brno-Zvonařka","idx":2,"regionName":"Jihomoravský","qualityClass":"good","distance":182.47},"BBDNA":{"loc":["49.202724","16.616287"],"name":"Brno - Dětská nemocnice","idx":1,"regionName":"Jihomoravský","qualityClass":"very_good","distance":181.64},"BBNYA":{"loc":["49.148972","16.696217"],"name":"Brno-Tuřany","idx":1,"regionName":"Jihomoravský","qualityClass":"very_good","distance":189.74},"BBNVA":{"loc":["49.198090","16.593643"],"name":"Brno-Úvoz (hot spot)","idx":3,"regionName":"Jihomoravský","qualityClass":"satisfactory","distance":180.52},"BBMVA":{"loc":["49.189621","16.569538"],"name":"Brno-Výstaviště","idx":3,"regionName":"Jihomoravský","qualityClass":"satisfactory","distance":179.55},"BBMSA":{"loc":["49.208160","16.642517"],"name":"Brno-Svatoplukova","idx":0,"regionName":"Jihomoravský","qualityClass":"incomplete","distance":182.94},"BMOKA":{"loc":["49.219444","16.755306"],"name":"Mokrá","idx":1,"regionName":"Jihomoravský","qualityClass":"very_good","distance":189.34}},"Karlovarský":{"KCHMA":{"loc":["50.065861","12.363442"],"name":"Cheb","idx":2,"regionName":"Karlovarský","qualityClass":"good","distance":149.5},"KPRBA":{"loc":["50.372478","12.615380"],"name":"Přebuz","idx":-1,"regionName":"Karlovarský","qualityClass":"undetermined","distance":135.98},"KSOMA":{"loc":["50.172825","12.672818"],"name":"Sokolov","idx":1,"regionName":"Karlovarský","qualityClass":"very_good","distance":128.03}},"Ústecký":{"UCHMA":{"loc":["50.467529","13.412696"],"name":"Chomutov","idx":2,"regionName":"Ústecký","qualityClass":"good","distance":87.76},"USNZA":{"loc":["50.789444","14.086799"],"name":"Sněžník","idx":-1,"regionName":"Ústecký","qualityClass":"undetermined","distance":86.63},"UDCMA":{"loc":["50.774151","14.218794"],"name":"Děčín","idx":1,"regionName":"Ústecký","qualityClass":"very_good","distance":82.6},"URVHA":{"loc":["50.579834","13.419506"],"name":"Rudolice v Horách","idx":2,"regionName":"Ústecký","qualityClass":"good","distance":94.56},"UTPMA":{"loc":["50.645279","13.851250"],"name":"Teplice ","idx":1,"regionName":"Ústecký","qualityClass":"very_good","distance":79.21},"UTUSA":{"loc":["50.376587","13.327622"],"name":"Tušimice","idx":1,"regionName":"Ústecký","qualityClass":"very_good","distance":88.35},"UULMA":{"loc":["50.661095","14.043063"],"name":"Ústí n.L.-město","idx":2,"regionName":"Ústecký","qualityClass":"good","distance":74.34},"UULKA":{"loc":["50.683525","14.041195"],"name":"Ústí n.L.-Kočkov","idx":1,"regionName":"Ústecký","qualityClass":"very_good","distance":76.68},"UKRUA":{"loc":["50.696671","13.847692"],"name":"Krupka","idx":3,"regionName":"Ústecký","qualityClass":"satisfactory","distance":84.19},"UMOMA":{"loc":["50.510365","13.645272"],"name":"Most","idx":2,"regionName":"Ústecký","qualityClass":"good","distance":77.36},"UDOKA":{"loc":["50.458855","14.170162"],"name":"Doksany","idx":-1,"regionName":"Ústecký","qualityClass":"undetermined","distance":50.14},"ULTTA":{"loc":["50.540897","14.119409"],"name":"Litoměřice","idx":1,"regionName":"Ústecký","qualityClass":"very_good","distance":59.93},"UMEDA":{"loc":["50.427589","13.130143"],"name":"Měděnec","idx":1,"regionName":"Ústecký","qualityClass":"very_good","distance":103.45},"UULDA":{"loc":["50.683125","13.997873"],"name":"Ústí n.L.-Všebořická (hot spot)","idx":2,"regionName":"Ústecký","qualityClass":"good","distance":77.88},"ULOMA":{"loc":["50.585766","13.673418"],"name":"Lom","idx":1,"regionName":"Ústecký","qualityClass":"very_good","distance":81.77}},"Olomoucký":{"MOLJA":{"loc":["49.601463","17.238073"],"name":"Olomouc-Hejčín","idx":1,"regionName":"Olomoucký","qualityClass":"very_good","distance":205.52},"MBELA":{"loc":["49.587082","17.804220"],"name":"Bělotín","idx":1,"regionName":"Olomoucký","qualityClass":"very_good","distance":245.48},"MJESA":{"loc":["50.242241","17.190180"],"name":"Jeseník-lázně","idx":1,"regionName":"Olomoucký","qualityClass":"very_good","distance":195.93},"MOLSA":{"loc":["49.592865","17.266094"],"name":"Olomouc-Šmeralova","idx":1,"regionName":"Olomoucký","qualityClass":"very_good","distance":207.72},"MPRRA":{"loc":["49.451656","17.454159"],"name":"Přerov","idx":1,"regionName":"Olomoucký","qualityClass":"very_good","distance":225.24},"MPSTA":{"loc":["49.467857","17.114725"],"name":"Prostějov","idx":1,"regionName":"Olomoucký","qualityClass":"very_good","distance":201.44}},"Liberecký":{"LSOUA":{"loc":["50.789646","15.319683"],"name":"Souš","idx":-1,"regionName":"Liberecký","qualityClass":"undetermined","distance":102.71},"LFRTA":{"loc":["50.940651","15.069817"],"name":"Frýdlant","idx":-1,"regionName":"Liberecký","qualityClass":"undetermined","distance":108.39},"LCLMA":{"loc":["50.698044","14.537345"],"name":"Česká Lípa","idx":2,"regionName":"Liberecký","qualityClass":"good","distance":72.61},"LLILA":{"loc":["50.755100","15.069967"],"name":"Liberec Rochlice","idx":1,"regionName":"Liberecký","qualityClass":"very_good","distance":89.91}}}};
        // var meta = {
        //     "date": "2017-03-22 08:00:00.0 UTC",
        //     "regions": {
        //         "Praha": {
        //             "ALEGA": {
        //                 "loc": ["50.072388", "14.430673"],
        //                 "name": "Praha 2-Legerova (hot spot)",
        //                 "idx": 3,
        //                 "regionName": "Praha",
        //                 "qualityClass": "satisfactory",
        //                 "distance": 3.4
        //             },
        //             "ASMIA": {
        //                 "loc": ["50.073135", "14.398141"],
        //                 "name": "Praha 5-Smíchov",
        //                 "idx": 2,
        //                 "regionName": "Praha",
        //                 "qualityClass": "good",
        //                 "distance": 5.13
        //             },
        //             "ALIBA": {
        //                 "loc": ["50.007305", "14.445933"],
        //                 "name": "Praha 4-Libuš",
        //                 "idx": 2,
        //                 "regionName": "Praha",
        //                 "qualityClass": "good",
        //                 "distance": 4.5
        //             },
        //             "ACHOA": {
        //                 "loc": ["50.030170", "14.517450"],
        //                 "name": "Praha 4-Chodov",
        //                 "idx": 0,
        //                 "regionName": "Praha",
        //                 "qualityClass": "incomplete",
        //                 "distance": 4.68
        //             },
        //             "AVYNA": {
        //                 "loc": ["50.111080", "14.503096"],
        //                 "name": "Praha 9-Vysočany",
        //                 "idx": 3,
        //                 "regionName": "Praha",
        //                 "qualityClass": "satisfactory",
        //                 "distance": 7.83
        //             },
        //             "ARIEA": {
        //                 "loc": ["50.081482", "14.442692"],
        //                 "name": "Praha 2-Riegrovy sady",
        //                 "idx": 2,
        //                 "regionName": "Praha",
        //                 "qualityClass": "good",
        //                 "distance": 3.97
        //             },
        //             "ASTOA": {
        //                 "loc": ["50.046131", "14.331413"],
        //                 "name": "Praha 5-Stodůlky",
        //                 "idx": 1,
        //                 "regionName": "Praha",
        //                 "qualityClass": "very_good",
        //                 "distance": 9
        //             },
        //             "AKOBA": {
        //                 "loc": ["50.122189", "14.467578"],
        //                 "name": "Praha 8-Kobylisy",
        //                 "idx": 1,
        //                 "regionName": "Praha",
        //                 "qualityClass": "very_good",
        //                 "distance": 8.39
        //             },
        //             "APRUA": {
        //                 "loc": ["50.062298", "14.537820"],
        //                 "name": "Praha 10-Průmyslová",
        //                 "idx": 2,
        //                 "regionName": "Praha",
        //                 "qualityClass": "good",
        //                 "distance": 5.98
        //             },
        //             "AVRSA": {
        //                 "loc": ["50.066429", "14.446152"],
        //                 "name": "Praha 10-Vršovice",
        //                 "idx": 1,
        //                 "regionName": "Praha",
        //                 "qualityClass": "very_good",
        //                 "distance": 2.3
        //             },
        //             "AKALA": {
        //                 "loc": ["50.094238", "14.442049"],
        //                 "name": "Praha 8-Karlín",
        //                 "idx": 1,
        //                 "regionName": "Praha",
        //                 "qualityClass": "very_good",
        //                 "distance": 5.36
        //             },
        //             "ASUCA": {
        //                 "loc": ["50.126530", "14.384639"],
        //                 "name": "Praha 6-Suchdol",
        //                 "idx": 1,
        //                 "regionName": "Praha",
        //                 "qualityClass": "very_good",
        //                 "distance": 10.25
        //             },
        //             "ABREA": {
        //                 "loc": ["50.084385", "14.380116"],
        //                 "name": "Praha 6-Břevnov",
        //                 "idx": 3,
        //                 "regionName": "Praha",
        //                 "qualityClass": "satisfactory",
        //                 "distance": 6.91
        //             },
        //             "AREPA": {
        //                 "loc": ["50.088066", "14.429220"],
        //                 "name": "Praha 1-n. Republiky",
        //                 "idx": 3,
        //                 "regionName": "Praha",
        //                 "qualityClass": "satisfactory",
        //                 "distance": 4.98
        //             }
        //         }
        //     }
        // };
        setMeta(meta);
        resolve(meta);
        return;
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
            console.log('Station data: ', detail);
            setDetail(detail);
            resolve(detail);
        }).fail(function (err) {
            console.error('Station ' + stationCode + ' error: ', err);
            setDetail({
                code: stationCode,
                data: []
            });
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
        var result = {
            "results" : [
                {
                    "address_components" : [
                        {
                            "long_name" : "Za Brumlovkou",
                            "short_name" : "Za Brumlovkou",
                            "types" : [ "route" ]
                        },
                        {
                            "long_name" : "Praha 4",
                            "short_name" : "Praha 4",
                            "types" : [ "political", "sublocality", "sublocality_level_1" ]
                        },
                        {
                            "long_name" : "Praha",
                            "short_name" : "Praha",
                            "types" : [ "locality", "political" ]
                        },
                        {
                            "long_name" : "Česko",
                            "short_name" : "CZ",
                            "types" : [ "country", "political" ]
                        },
                        {
                            "long_name" : "140 00",
                            "short_name" : "140 00",
                            "types" : [ "postal_code" ]
                        }
                    ],
                    "formatted_address" : "Za Brumlovkou, 140 00 Praha 4, Česko",
                    "geometry" : {
                        "bounds" : {
                            "northeast" : {
                                "lat" : 50.0472487,
                                "lng" : 14.4581717
                            },
                            "southwest" : {
                                "lat" : 50.0471276,
                                "lng" : 14.4569701
                            }
                        },
                        "location" : {
                            "lat" : 50.0471696,
                            "lng" : 14.457576
                        },
                        "location_type" : "GEOMETRIC_CENTER",
                        "viewport" : {
                            "northeast" : {
                                "lat" : 50.0485371302915,
                                "lng" : 14.4589198802915
                            },
                            "southwest" : {
                                "lat" : 50.0458391697085,
                                "lng" : 14.4562219197085
                            }
                        }
                    },
                    "place_id" : "ChIJV_ugBpOTC0cRUBAsr32I9jA",
                    "types" : [ "route" ]
                },
                {
                    "address_components" : [
                        {
                            "long_name" : "Praha 4",
                            "short_name" : "Praha 4",
                            "types" : [ "political", "sublocality", "sublocality_level_1" ]
                        },
                        {
                            "long_name" : "Praha",
                            "short_name" : "Praha",
                            "types" : [ "locality", "political" ]
                        },
                        {
                            "long_name" : "Hlavní město Praha",
                            "short_name" : "Hlavní město Praha",
                            "types" : [ "administrative_area_level_2", "political" ]
                        },
                        {
                            "long_name" : "Hlavní město Praha",
                            "short_name" : "Hlavní město Praha",
                            "types" : [ "administrative_area_level_1", "political" ]
                        },
                        {
                            "long_name" : "Česko",
                            "short_name" : "CZ",
                            "types" : [ "country", "political" ]
                        }
                    ],
                    "formatted_address" : "Praha 4, Česko",
                    "geometry" : {
                        "bounds" : {
                            "northeast" : {
                                "lat" : 50.0680017,
                                "lng" : 14.4962484
                            },
                            "southwest" : {
                                "lat" : 50.0132128,
                                "lng" : 14.3958785
                            }
                        },
                        "location" : {
                            "lat" : 50.0624463,
                            "lng" : 14.4404548
                        },
                        "location_type" : "APPROXIMATE",
                        "viewport" : {
                            "northeast" : {
                                "lat" : 50.0680017,
                                "lng" : 14.4962484
                            },
                            "southwest" : {
                                "lat" : 50.0132128,
                                "lng" : 14.3958785
                            }
                        }
                    },
                    "place_id" : "ChIJ89Z1ePGTC0cRILMVZg-vAAU",
                    "types" : [ "political", "sublocality", "sublocality_level_1" ]
                },
                {
                    "address_components" : [
                        {
                            "long_name" : "Praha",
                            "short_name" : "Praha",
                            "types" : [ "locality", "political" ]
                        },
                        {
                            "long_name" : "Hlavní město Praha",
                            "short_name" : "Hlavní město Praha",
                            "types" : [ "administrative_area_level_2", "political" ]
                        },
                        {
                            "long_name" : "Hlavní město Praha",
                            "short_name" : "Hlavní město Praha",
                            "types" : [ "administrative_area_level_1", "political" ]
                        },
                        {
                            "long_name" : "Česko",
                            "short_name" : "CZ",
                            "types" : [ "country", "political" ]
                        }
                    ],
                    "formatted_address" : "Praha, Česko",
                    "geometry" : {
                        "bounds" : {
                            "northeast" : {
                                "lat" : 50.177403,
                                "lng" : 14.7067945
                            },
                            "southwest" : {
                                "lat" : 49.94193629999999,
                                "lng" : 14.2244533
                            }
                        },
                        "location" : {
                            "lat" : 50.0755381,
                            "lng" : 14.4378005
                        },
                        "location_type" : "APPROXIMATE",
                        "viewport" : {
                            "northeast" : {
                                "lat" : 50.177403,
                                "lng" : 14.7067945
                            },
                            "southwest" : {
                                "lat" : 49.94193629999999,
                                "lng" : 14.2244533
                            }
                        }
                    },
                    "place_id" : "ChIJi3lwCZyTC0cRkEAWZg-vAAQ",
                    "types" : [ "locality", "political" ]
                },
                {
                    "address_components" : [
                        {
                            "long_name" : "Praha 4",
                            "short_name" : "Praha 4",
                            "types" : [ "postal_town" ]
                        },
                        {
                            "long_name" : "Česko",
                            "short_name" : "CZ",
                            "types" : [ "country", "political" ]
                        },
                        {
                            "long_name" : "140 00",
                            "short_name" : "140 00",
                            "types" : [ "postal_code" ]
                        }
                    ],
                    "formatted_address" : "Praha 4, 140 00, Česko",
                    "geometry" : {
                        "bounds" : {
                            "northeast" : {
                                "lat" : 50.0680261,
                                "lng" : 14.477242
                            },
                            "southwest" : {
                                "lat" : 50.0216708,
                                "lng" : 14.4226236
                            }
                        },
                        "location" : {
                            "lat" : 50.041463,
                            "lng" : 14.4429612
                        },
                        "location_type" : "APPROXIMATE",
                        "viewport" : {
                            "northeast" : {
                                "lat" : 50.0680261,
                                "lng" : 14.477242
                            },
                            "southwest" : {
                                "lat" : 50.0216708,
                                "lng" : 14.4226236
                            }
                        }
                    },
                    "place_id" : "ChIJEQAOS0WRC0cRmJYjXaCxvic",
                    "types" : [ "postal_town" ]
                },
                {
                    "address_components" : [
                        {
                            "long_name" : "140 00",
                            "short_name" : "140 00",
                            "types" : [ "postal_code" ]
                        },
                        {
                            "long_name" : "Praha 4",
                            "short_name" : "Praha 4",
                            "types" : [ "political", "sublocality", "sublocality_level_1" ]
                        },
                        {
                            "long_name" : "Praha",
                            "short_name" : "Praha",
                            "types" : [ "locality", "political" ]
                        },
                        {
                            "long_name" : "Česko",
                            "short_name" : "CZ",
                            "types" : [ "country", "political" ]
                        }
                    ],
                    "formatted_address" : "140 00 Praha-Praha 4, Česko",
                    "geometry" : {
                        "bounds" : {
                            "northeast" : {
                                "lat" : 50.0680261,
                                "lng" : 14.477242
                            },
                            "southwest" : {
                                "lat" : 50.0216708,
                                "lng" : 14.4226236
                            }
                        },
                        "location" : {
                            "lat" : 50.041463,
                            "lng" : 14.4429612
                        },
                        "location_type" : "APPROXIMATE",
                        "viewport" : {
                            "northeast" : {
                                "lat" : 50.0680261,
                                "lng" : 14.477242
                            },
                            "southwest" : {
                                "lat" : 50.0216708,
                                "lng" : 14.4226236
                            }
                        }
                    },
                    "place_id" : "ChIJe1crwfKTC0cRIAljmBKvABw",
                    "types" : [ "postal_code" ]
                },
                {
                    "address_components" : [
                        {
                            "long_name" : "Hlavní město Praha",
                            "short_name" : "Hlavní město Praha",
                            "types" : [ "administrative_area_level_2", "political" ]
                        },
                        {
                            "long_name" : "Hlavní město Praha",
                            "short_name" : "Hlavní město Praha",
                            "types" : [ "administrative_area_level_1", "political" ]
                        },
                        {
                            "long_name" : "Česko",
                            "short_name" : "CZ",
                            "types" : [ "country", "political" ]
                        }
                    ],
                    "formatted_address" : "Hlavní město Praha, Česko",
                    "geometry" : {
                        "bounds" : {
                            "northeast" : {
                                "lat" : 50.177403,
                                "lng" : 14.7067945
                            },
                            "southwest" : {
                                "lat" : 49.94193629999999,
                                "lng" : 14.2244533
                            }
                        },
                        "location" : {
                            "lat" : 50.0599268,
                            "lng" : 14.5039935
                        },
                        "location_type" : "APPROXIMATE",
                        "viewport" : {
                            "northeast" : {
                                "lat" : 50.177403,
                                "lng" : 14.7067945
                            },
                            "southwest" : {
                                "lat" : 49.94193629999999,
                                "lng" : 14.2244533
                            }
                        }
                    },
                    "place_id" : "ChIJi3lwCZyTC0cRAKkUZg-vAAM",
                    "types" : [ "administrative_area_level_2", "political" ]
                },
                {
                    "address_components" : [
                        {
                            "long_name" : "Hlavní město Praha",
                            "short_name" : "Hlavní město Praha",
                            "types" : [ "administrative_area_level_1", "political" ]
                        },
                        {
                            "long_name" : "Česko",
                            "short_name" : "CZ",
                            "types" : [ "country", "political" ]
                        }
                    ],
                    "formatted_address" : "Hlavní město Praha, Česko",
                    "geometry" : {
                        "bounds" : {
                            "northeast" : {
                                "lat" : 50.177403,
                                "lng" : 14.7067945
                            },
                            "southwest" : {
                                "lat" : 49.94193629999999,
                                "lng" : 14.2244533
                            }
                        },
                        "location" : {
                            "lat" : 50.0599268,
                            "lng" : 14.5039935
                        },
                        "location_type" : "APPROXIMATE",
                        "viewport" : {
                            "northeast" : {
                                "lat" : 50.177403,
                                "lng" : 14.7067945
                            },
                            "southwest" : {
                                "lat" : 49.94193629999999,
                                "lng" : 14.2244533
                            }
                        }
                    },
                    "place_id" : "ChIJi3lwCZyTC0cRIKgUZg-vAAE",
                    "types" : [ "administrative_area_level_1", "political" ]
                },
                {
                    "address_components" : [
                        {
                            "long_name" : "Česko",
                            "short_name" : "CZ",
                            "types" : [ "country", "political" ]
                        }
                    ],
                    "formatted_address" : "Česko",
                    "geometry" : {
                        "bounds" : {
                            "northeast" : {
                                "lat" : 51.0557185,
                                "lng" : 18.8592361
                            },
                            "southwest" : {
                                "lat" : 48.5518081,
                                "lng" : 12.090589
                            }
                        },
                        "location" : {
                            "lat" : 49.81749199999999,
                            "lng" : 15.472962
                        },
                        "location_type" : "APPROXIMATE",
                        "viewport" : {
                            "northeast" : {
                                "lat" : 51.0556786,
                                "lng" : 18.8592361
                            },
                            "southwest" : {
                                "lat" : 48.5518081,
                                "lng" : 12.090589
                            }
                        }
                    },
                    "place_id" : "ChIJQ4Ld14-UC0cRb1jb03UcZvg",
                    "types" : [ "country", "political" ]
                }
            ],
            "status" : "OK"
        };
        var address = collectAddress(result.results[0].address_components, ["neighborhood", "sublocality", "locality"]);
        resolve(address);
        return;
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
