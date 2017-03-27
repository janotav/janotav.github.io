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
var myLocationName;
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
var swiper;
var ignoreSlideRestore;

var uvPrediction;
var uvPredictionChart;
var uvOnline;
var uvOnlineChart;

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

    // TODO: two distinct progress inidication? wait for both?

    $("#uv_running").remove();
    $("#alarm1").find(".alarm_running").removeClass("invisible");
    var slide1 = $("#slide1");
    slide1.find(".uv_outer").removeClass("invisible");
    updateSlideHeight(slide1.find(".slide_body"));

    if (typeof uvPredictionChart !== "undefined") {
        uvPredictionChart.destroy();
    }

    var options = {
        tooltips: {
            callbacks: {
                label: function (tooltipItems, data) {
                    var valueClass = uv_idx[uvIndex(uvPrediction[tooltipItems.index])];
                    return uvLabel[valueClass] + " (" + tooltipItems.xLabel + ")"
                }
            },
            titleFontSize: 30,
            bodyFontSize: 30
        },
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


function setUvOnline(uvData) {
    uvOnline = uvData;

    if (typeof uvOnlineChart !== "undefined") {
        uvOnlineChart.destroy();
    }

    if (typeof uvData.data === "undefined") {
        $("#uv_online_nodata").removeClass("invisible");
        return;
    }

    $("#uv_online_nodata").addClass("invisible");

    var tooltipIndex;
    var options = {
        tooltips: {
            mode: 'index',
            intersect: false,
            titleFontSize: 30,
            bodyFontSize: 30,
            multiKeyBackground: "#000000",
            bodySpacing: 10,
            callbacks: {
                title: function (tooltipItems, data) {
                    return timeLabels[tooltipIndex];
                },
                label: function (tooltipItem, data) {
                    tooltipIndex = tooltipItem.index;
                    return data.datasets[tooltipItem.datasetIndex].label + " " + tooltipItem.yLabel;
                }
            }
        },
        legend: {
            labels: {
                fontSize: 36
            }
        },
        scales: {
            xAxes: [{
                ticks: {
                    fontSize: 30,
                    beginAtZero:true,
                }
            }],
            yAxes: [{
                ticks: {
                    beginAtZero:true,
                    fontSize: 30,
                }
            }]
        }
    };

    function makeGaps(n) {
        return n < 0? null: n;
    }

    var timeLabels = generateTimeLabels(uvData.from, 600000, uvData.data["Hradec Králové"].length);

    uvOnlineChart = new Chart($("#uv_online"), {
        type: "line",
        data: {
            labels: timeLabels.map(function (time) {
                return time.endsWith(":00")? time: "";
            }),
            datasets: [{
                label: "Hradec Králové",
                data: uvData.data["Hradec Králové"].map(makeGaps),
                spanGaps: true,
                borderColor: "#FF0000"
            },{
                label: "Košetice",
                data: uvData.data["Košetice"].map(makeGaps),
                spanGaps: true,
                borderColor: "#00FF00"
            }, {
                label: "Kuchařovice",
                data: uvData.data["Kuchařovice"].map(makeGaps),
                spanGaps: true,
                borderColor: "#0000FF"
            }]
        },
        options: options
    });
}

function loadPosition(store) {
    if (navigator.geolocation) {
        console.log('Retrieving current position');
        navigator.geolocation.getCurrentPosition(function (position) {
            setPosition(position, store);
        });
    }
}

function setLocationName(name) {
    myLocationName = name;

    $(".location_name").text(name);
    $("#uv_alarm").find(".uv_toggle").each(function (index, element) {
        if (typeof myLocationName === "undefined") {
            $(element).addClass("inactive");
        } else {
            $(element).removeClass("inactive");
        }
    });
}

function setPosition(position, store) {
    myLocation = position;
    setLocationName(undefined);
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
        loadLocationName(myLocation.coords.latitude, myLocation.coords.longitude).then(setLocationName);
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
        if (typeof myAlarm !== 'undefined' && typeof myAlarm.emission !== 'undefined') {
            removeEmissionAlarm();
        }
        return false;
    });
    initializeAlarm($("#alarm1"), alarmComponent, function () {
        if (typeof myAlarm !== 'undefined' && typeof myAlarm.uv !== 'undefined') {
            removeUvPredictionAlarm();
        }
        return false;
    });

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
        bulletActiveClass: 'page-active',

        onTransitionStart: function () {
            ignoreSlideRestore = true;
            closeUserAction();
            disablePendingExit();
        },
        onTransitionEnd: function () {
            // when needed, menu items should be made context-aware
            if (swiper.activeIndex === 0) {
                $("#menu_expander").removeClass("invisible");
            } else {
                $("#menu_expander").addClass("invisible");
            }
            storeSlide();
        }
    };
    swiper = new Swiper('.swiper-container', options);
}

function initialize() {
    main_page = $("#main_page");

    initializeComponents();
    initializeSwiper();

    if ('indexedDB' in window) {
        var idb = window.indexedDB;

        var request = idb.open("BuenosAires", 5);
        request.onsuccess = function (event) {
            db = event.target.result;
            restorePlaceHistory();
            restoreCurrentPlace();
            restoreFavorites();
            restoreSlide();
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

            if (!db.objectStoreNames.contains("settings")) {
                var settingsStore = db.createObjectStore("settings", { keyPath: "id" });
                settingsStore.add({id: "lastPage", value: 0});
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

    var locationHash;
    if (location.hash) {
        ignoreSlideRestore = true;
        if (location.hash === "#uv") {
            swiper.slideTo(1);
        } else {
            locationHash = location.hash;
        }
    }

    // make sure that we don't lose scroll position on "back"
    if ("scrollRestoration" in history) {
        history.scrollRestoration = "manual";
    }

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

    loadMeta().then(function () {
        if (locationHash) {
            var stationCode = locationHash.substring(1);
            if (myStations[stationCode].name) {
                toggleDetail(stationCode, true);
            }
        }
    });

    loadUvOnline();

    $("#time_spin").click(reload);

    var uvOnlineSync = $("#uv_online_sync");
    uvOnlineSync.click(function () {
        return onSync(uvOnlineSync, loadUvOnline);
    });

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

    $("#uv_alarm").find(".uv_toggle").each(function (index, element) {
        var jqElem = $(element);
        jqElem.click(function () {
            if (typeof myLocationName !== "undefined") {
                updateUvPredictionAlarm(Number(jqElem.text()), myLocationName);
            }
        });
    });
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

function restoreSlide() {
    var tx = db.transaction(["settings"], "readonly", 1000);
    var req = tx.objectStore("settings").get("lastPage");
    req.onsuccess = function (event) {
        if (!ignoreSlideRestore) {
            swiper.slideTo(event.target.result.value);
            console.log("Moved to lastPage");
        } else {
            console.log("Move to lastPage ignored");
        }
    };
    req.onerror = function (event) {
        console.error("Failed to restore lastPage", event);
    };
}

function storeSlide() {
    if (db) {
        var lastPage = swiper.activeIndex;
        var tx = db.transaction(["settings"], "readwrite", 1000);
        var req = tx.objectStore("settings").put({id: "lastPage", value: lastPage});
        req.onsuccess = function (event) {
            console.log("Stored lastPage: ", lastPage);
        };
        req.onerror = function (event) {
            console.error("Failed to store lastPage: ", event);
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

function onSync(element, callback) {
    if (element.hasClass("fa-spin")) {
        console.log('Reload discarded another reload running');
        return;
    }

    if (element.hasClass("inactive")) {
        console.log('Reload discarded due to quiet period');
        return;
    }

    element.addClass("fa-spin");
    callback().then(function() {
        element.removeClass("fa-spin");
        element.addClass("inactive");
        window.setTimeout(function () {
            element.removeClass("inactive");
        }, 60000);
    });
}

function reload() {
    if (main_page.hasClass("invisible")) {
        console.log("Reload discarded outside main page");
        return;
    }

    if (swiper.activeIndex !== 0) {
        console.log("Reload discarded outside stations view");
        return;
    }

    onSync($("#time_spin"), function() {
        if (typeof myLocation === "undefined" || myLocation.custom !== true) {
            // reload position only if custom coordinates are not set
            loadPosition(false);
        }
        return Promise.all([
            loadAlarm(),
            loadMeta()
        ]);
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
    $("#location").removeClass("invisible");
    $("#stations_running").remove();
    showAlarmProgress($("#alarm0"));

    var stations = $("#stations");
    stations.empty();
    myStations = {};

    var date = parseUtcDate(meta.date);
    $("#time").text(date.toLocaleString("cs-CZ"));

    setTimeout(function () {
        // trying to fix height not being calculated correctly sometimes
        var slide = $("#slide0");
        slide.find(".stations_outer").removeClass("invisible");
        updateSlideHeight(slide.find(".slide_body"));
    }, 100);

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

    var uv = myAlarm.uv;

    if (myAlarm === false || typeof uv === "undefined") {
        displayAlarm(alarm, false, "", "", "", "nenastaveno", "", "", false, "");
        return;
    }

    var valueClass = uv_idx[uvIndex(uvPrediction[0])];
    var valueText = uvLabel[valueClass] + "-" + Math.round(uvPrediction[0]);
    var levelClass = uv_idx[uvIndex(uv.level)];
    var levelText = uvLabel[levelClass] + "-" + uv.level;

    displayAlarm(alarm, true, uv.name, valueText, valueClass, levelText, uv.level, levelClass, "", "a horší");
}

function displayEmissionAlarm() {
    var alarm = $("#alarm0");

    if (typeof myStations === "undefined" || typeof myAlarm === 'undefined') {
        return;
    }

    var emission = myAlarm.emission;
    if (myAlarm === false || typeof emission === "undefined") {
        displayAlarm(alarm, false, "", "", "", "nenastaveno", "", "", false, "");
        return;
    }

    var station = myStations[emission.code];
    var stationName = typeof myStations[emission.code] === "undefined"? "neznámá stanice": myStations[emission.code].name;

    var valueClass = emission_idx[station.idx + 1];
    var valueText = qualityLabel[valueClass];
    var levelClass = emission_idx[Math.abs(emission.level) + 1];
    var levelText = qualityLabel[levelClass];
    var levelImprovement = (emission.level < 0);

    var direction;
    if (emission.level == -1 || emission.level == 6) {
        direction = "";
    } else if (emission.level > 0) {
        direction = " a horší";
    } else {
        direction = " a lepší";
    }

    displayAlarm(alarm, true, stationName, valueText, valueClass, levelText, Math.abs(emission.level), levelClass, levelImprovement, direction);
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
    delete myAlarm.emission;
    updateAlarm({token: myToken, emission: {}});
    displayEmissionAlarm();
}

function updateEmissionAlarm(code, level) {
    myAlarm.emission = {
        code: code,
        level: level
    };
    updateAlarm({token: myToken, emission: myAlarm.emission});
    displayEmissionAlarm();
}

function removeUvPredictionAlarm() {
    delete myAlarm.uv;
    updateAlarm({token: myToken, uv: {}});
    displayUvPredictionAlarm();
}

function updateUvPredictionAlarm(level, name) {
    myAlarm.uv = {
        level: level,
        lat: myLocation.coords.latitude,
        lon: myLocation.coords.longitude,
        name: name
    };
    updateAlarm({token: myToken, uv: myAlarm.uv});
    displayUvPredictionAlarm();
}

function updateAlarm(alarm) {
    // waiting for the server call makes the app look a little bit unresponsive, let's assume the operation succeeds
    $.ajax({
        url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/alarm2',
        method: 'POST',
        data: JSON.stringify(alarm),
        contentType: 'application/json',
        headers: {
            'x-api-key': 'api_key_public_access'
        }
    }).fail(function (err) {
        console.error("Unablet to set alarm: ", alarm, err);
        // revert to previous setting if server didn't succeed
        loadAlarm();
    });
}

function loadAlarm() {
    return new Promise(function (resolve, reject) {
        console.log('Retrieving alarm from the server');
        $.ajax({
            url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/alarm2',
            method: 'GET',
            data: {
                token: myToken
            },
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

function generateTimeLabels(date, step, count) {

    function pad(n) {
        return n < 10? "0" + String(n): String(n);
    }
    var initialDate = parseUtcDate(date);
    var ret = [];

    for (var i = 0; i < count; i++) {
        ret.push(String(initialDate.getHours()) + ":" + pad(initialDate.getMinutes()));
        initialDate = new Date(initialDate.getTime() + step);
    }

    if (step < 0) {
        ret.reverse();
    }
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
        var timeLabels = generateTimeLabels(to, -3600000, 24);
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

function loadUvOnline() {
    console.log("Retrieving UV online data");
    return new Promise(function (resolve, reject) {
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var tomorrow = new Date(today.getTime() + 86400000);
        $.ajax({
            url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/uv',
            method: 'GET',
            headers: {
                'x-api-key': 'api_key_public_access'
            },
            data: {
                from: toUtcDate(today),
                to: toUtcDate(tomorrow)
            }
        }).done(function (onlineData) {
            console.log("UV online data: ", onlineData);
            setUvOnline(onlineData);
            resolve(onlineData);
        }).catch(function (err) {
            console.error("Failed to retrieve UV online data: ", err);
            setUvOnline({});
            resolve({});
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
