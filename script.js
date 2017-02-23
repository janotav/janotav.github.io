console.log('Running.');

var config = {
    messagingSenderId: "739898137035"
};
firebase.initializeApp(config);

var myToken;
var myAlarm;
var myMeta;
var myLocation;
var myStations;

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

if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(function (position) {
        myLocation = position;
        recalculateDistance();
    });
}

function initialize() {
    loadMeta().then(function () {
        if (location.hash) {
            var stationCode = location.hash.substring(1);
            if (myStations[stationCode].name) {
                toggleDetail(stationCode, true);
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
}

function toggleDetail(stationCode, forceShow) {
    var station = myStations[stationCode];
    if (typeof station.detail === 'undefined') {
        var stationDiv = $("#" + stationCode);
        var stationSpinnerDiv = $("#" + stationCode + "_spinner");
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
    if (station.qualityClass === 'undetermined' || station.qualityClass === 'incomplete') {
        // TODO: how to represent better/worse choice if there is no base to start from
    } else {
        addAlarmPanelToDetail(stationCode, detail);
    }
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
            if (level < emission_idx.indexOf(station.qualityClass) - 1) {
                level = -level;
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
        alarmPanelDiv.append(alarmToggle);
    });
    detail.append(alarmPanelDiv);
}

function setMeta(meta) {
    myMeta = meta;
    
    $("#time_outer").removeClass("invisible");
    $("#loader").remove();

    var stations = $("#stations");
    stations.empty();
    myStations = {};

    var date = new Date(Date.parse(meta.date));
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
    return $.ajax({
        url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/summary',
        method: 'GET',
        headers: {
            'x-api-key': 'api_key_public_access'
        }
    }).done(function (meta) {
        console.log('Current server meta summary: ', meta);
        setMeta(meta);
        return Promise.resolve(meta);
    });
}

function loadDetail(stationCode) {
    console.log('Retrieving station data from the server');
    return $.ajax({
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
        return Promise.resolve(detail);
    }).fail(function (err) {
        console.log('Station ' + stationCode + ' error: ', err);
        setDetail(stationCode, []);
        return Promise.reject(err);
    });
}
