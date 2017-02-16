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

    var stationDiv = $("<div class='station'></div>");
    stationDiv.attr('id', stationCode);
    stationDiv.addClass(emission_idx[station.idx + 1]);
    stationDiv.append(station.name);
    var distance = $("<span class='distance'/>");
    distance.attr('id', stationCode + "_distance");
    stationDiv.append(distance);
    stations.append(stationDiv);

    var detailDiv = $("<div class='detail invisible'/>");
    detailDiv.attr('id', stationCode + "_detail");
    stations.append(detailDiv);

    stationDiv.click(function () {
        if (typeof station.detail === 'undefined') {
            loadDetail(stationCode);
        }
        if (detailDiv.hasClass("invisible")) {
            detailDiv.removeClass("invisible");
        } else {
            detailDiv.addClass("invisible");
        }
        return false;
    });

    updateDistance(stationCode);
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
    myStations[stationCode].detail = {
        data: data
    };

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
}

function setMeta(meta) {
    myMeta = meta;

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
}

function setToken(token) {
    if (token !== myToken) {
        myToken = token;
        getAlarm(token);
    }
}

function setAlarm(item) {
    myAlarm = item;
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
    document.getElementById("message").innerHTML = payload.data.stationCode + ' is ' + payload.data.stationIdx;
});

function getAlarm(token) {
    $.ajax({
        url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/alarm',
        method: 'POST',
        data: JSON.stringify({
            token: token,
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
   // setMeta({
   //     "date": "2017-02-19 10:00:00.0 UTC",
   //     "regions": {
   //      "Středočeský": {
   //          "SPBRA": {
   //              "loc": [
   //                  "49.676315",
   //                  "13.991222"
   //              ],
   //                  "name": "Příbram-Březové Hory",
   //                  "idx": 1
   //          },
   //          "SBERA": {
   //              "loc": [
   //                  "49.957928",
   //                  "14.058300"
   //              ],
   //                  "name": "Beroun",
   //                  "idx": 3
   //          },
   //          "SKLSA": {
   //              "loc": [
   //                  "50.167412",
   //                  "14.106048"
   //              ],
   //                  "name": "Kladno-Švermov",
   //                  "idx": 1
   //          },
   //          "SONRA": {
   //              "loc": [
   //                  "49.913513",
   //                  "14.782625"
   //              ],
   //                  "name": "Ondřejov",
   //                  "idx": -1
   //          },
   //          "SRORA": {
   //              "loc": [
   //                  "50.301983",
   //                  "15.178303"
   //              ],
   //                  "name": "Rožďalovice-Ruská",
   //                  "idx": 3
   //          },
   //          "STCSA": {
   //              "loc": [
   //                  "49.918503",
   //                  "14.094489"
   //              ],
   //                  "name": "Tobolka-Čertovy schody",
   //                  "idx": -1
   //          },
   //          "SKLMA": {
   //              "loc": [
   //                  "50.143860",
   //                  "14.101784"
   //              ],
   //                  "name": "Kladno-střed města",
   //                  "idx": 2
   //          },
   //          "SMBOA": {
   //              "loc": [
   //                  "50.428646",
   //                  "14.913859"
   //              ],
   //                  "name": "Mladá Boleslav",
   //                  "idx": 3
   //          }
   //      },
   //      "Vysočina": {
   //          "JKMYA": {
   //              "loc": [
   //                  "49.159153",
   //                  "15.439048"
   //              ],
   //                  "name": "Kostelní Myslová",
   //                  "idx": -1
   //          },
   //          "JJIZA": {
   //              "loc": [
   //                  "49.393333",
   //                  "15.592500"
   //              ],
   //                  "name": "Jihlava-Znojemská",
   //                  "idx": 1
   //          },
   //          "JHBSA": {
   //              "loc": [
   //                  "49.605556",
   //                  "15.579167"
   //              ],
   //                  "name": "Havl.Brod-Smetan.nám.",
   //                  "idx": 1
   //          },
   //          "JJIHA": {
   //              "loc": [
   //                  "49.401596",
   //                  "15.610246"
   //              ],
   //                  "name": "Jihlava",
   //                  "idx": 3
   //          },
   //          "JZNZA": {
   //              "loc": [
   //                  "49.559723",
   //                  "15.943056"
   //              ],
   //                  "name": "Ždár nad Sázavou",
   //                  "idx": 2
   //          },
   //          "JKOSA": {
   //              "loc": [
   //                  "49.573395",
   //                  "15.080278"
   //              ],
   //                  "name": "Košetice",
   //                  "idx": 2
   //          },
   //          "JTREA": {
   //              "loc": [
   //                  "49.223438",
   //                  "15.865778"
   //              ],
   //                  "name": "Třebíč",
   //                  "idx": 4
   //          }
   //      },
   //      "Praha": {
   //          "ALEGA": {
   //              "loc": [
   //                  "50.072388",
   //                  "14.430673"
   //              ],
   //                  "name": "Praha 2-Legerova (hot spot)",
   //                  "idx": 2
   //          },
   //          "ASMIA": {
   //              "loc": [
   //                  "50.073135",
   //                  "14.398141"
   //              ],
   //                  "name": "Praha 5-Smíchov",
   //                  "idx": 4
   //          },
   //          "ALIBA": {
   //              "loc": [
   //                  "50.007305",
   //                  "14.445933"
   //              ],
   //                  "name": "Praha 4-Libuš",
   //                  "idx": 1
   //          },
   //          "ACHOA": {
   //              "loc": [
   //                  "50.030170",
   //                  "14.517450"
   //              ],
   //                  "name": "Praha 4-Chodov",
   //                  "idx": 1
   //          },
   //          "AVYNA": {
   //              "loc": [
   //                  "50.111080",
   //                  "14.503096"
   //              ],
   //                  "name": "Praha 9-Vysočany",
   //                  "idx": 3
   //          },
   //          "ARIEA": {
   //              "loc": [
   //                  "50.081482",
   //                  "14.442692"
   //              ],
   //                  "name": "Praha 2-Riegrovy sady",
   //                  "idx": 2
   //          },
   //          "ASTOA": {
   //              "loc": [
   //                  "50.046131",
   //                  "14.331413"
   //              ],
   //                  "name": "Praha 5-Stodůlky",
   //                  "idx": 1
   //          },
   //          "AKOBA": {
   //              "loc": [
   //                  "50.122189",
   //                  "14.467578"
   //              ],
   //                  "name": "Praha 8-Kobylisy",
   //                  "idx": 2
   //          },
   //          "APRUA": {
   //              "loc": [
   //                  "50.062298",
   //                  "14.537820"
   //              ],
   //                  "name": "Praha 10-Průmyslová",
   //                  "idx": 1
   //          },
   //          "AVRSA": {
   //              "loc": [
   //                  "50.066429",
   //                  "14.446152"
   //              ],
   //                  "name": "Praha 10-Vršovice",
   //                  "idx": 2
   //          },
   //          "AKALA": {
   //              "loc": [
   //                  "50.094238",
   //                  "14.442049"
   //              ],
   //                  "name": "Praha 8-Karlín",
   //                  "idx": 2
   //          },
   //          "ASUCA": {
   //              "loc": [
   //                  "50.126530",
   //                  "14.384639"
   //              ],
   //                  "name": "Praha 6-Suchdol",
   //                  "idx": 2
   //          },
   //          "ABREA": {
   //              "loc": [
   //                  "50.084385",
   //                  "14.380116"
   //              ],
   //                  "name": "Praha 6-Břevnov",
   //                  "idx": 1
   //          },
   //          "AREPA": {
   //              "loc": [
   //                  "50.088066",
   //                  "14.429220"
   //              ],
   //                  "name": "Praha 1-n. Republiky",
   //                  "idx": 0
   //          }
   //      },
   //      "Královéhradecký": {
   //          "HHKBA": {
   //              "loc": [
   //                  "50.195362",
   //                  "15.846376"
   //              ],
   //                  "name": "Hradec Králové-Brněnská",
   //                  "idx": 2
   //          },
   //          "HPLOA": {
   //              "loc": [
   //                  "50.350277",
   //                  "16.322500"
   //              ],
   //                  "name": "Polom",
   //                  "idx": 1
   //          },
   //          "HTRTA": {
   //              "loc": [
   //                  "50.565880",
   //                  "15.903927"
   //              ],
   //                  "name": "Trutnov - Tkalcovská",
   //                  "idx": 2
   //          },
   //          "HKRYA": {
   //              "loc": [
   //                  "50.660439",
   //                  "15.850090"
   //              ],
   //                  "name": "Krkonoše-Rýchory",
   //                  "idx": -1
   //          },
   //          "HHKOK": {
   //              "loc": [
   //                  "50.177631",
   //                  "15.838390"
   //              ],
   //                  "name": "Hradec Králové-observatoř",
   //                  "idx": -1
   //          }
   //      },
   //      "Zlínský": {
   //          "ZZLNA": {
   //              "loc": [
   //                  "49.232906",
   //                  "17.667175"
   //              ],
   //                  "name": "Zlín",
   //                  "idx": 2
   //          },
   //          "ZTNVA": {
   //              "loc": [
   //                  "49.259392",
   //                  "17.410561"
   //              ],
   //                  "name": "Těšnovice",
   //                  "idx": 3
   //          },
   //          "ZVMZA": {
   //              "loc": [
   //                  "49.472057",
   //                  "17.966976"
   //              ],
   //                  "name": "Valašské Meziříčí",
   //                  "idx": 2
   //          },
   //          "ZUHRA": {
   //              "loc": [
   //                  "49.067951",
   //                  "17.466848"
   //              ],
   //                  "name": "Uherské Hradiště",
   //                  "idx": 4
   //          },
   //          "ZOTMA": {
   //              "loc": [
   //                  "49.208912",
   //                  "17.534742"
   //              ],
   //                  "name": "Otrokovice-město",
   //                  "idx": 0
   //          },
   //          "ZSNVA": {
   //              "loc": [
   //                  "49.047817",
   //                  "18.007828"
   //              ],
   //                  "name": "Štítná n.Vláří",
   //                  "idx": -1
   //          }
   //      },
   //      "Pardubický": {
   //          "EPAUA": {
   //              "loc": [
   //                  "50.024036",
   //                  "15.763549"
   //              ],
   //                  "name": "Pardubice Dukla",
   //                  "idx": 3
   //          },
   //          "ESVRA": {
   //              "loc": [
   //                  "49.735085",
   //                  "16.034197"
   //              ],
   //                  "name": "Svratouch",
   //                  "idx": -1
   //          },
   //          "EPAOA": {
   //              "loc": [
   //                  "50.042198",
   //                  "15.739414"
   //              ],
   //                  "name": "Pardubice-Rosice",
   //                  "idx": -1
   //          },
   //          "EMTPA": {
   //              "loc": [
   //                  "49.758995",
   //                  "16.666721"
   //              ],
   //                  "name": "Moravská Třebová - Piaristická.",
   //                  "idx": 2
   //          }
   //      },
   //      "Plzeňský": {
   //          "PPLAA": {
   //              "loc": [
   //                  "49.732449",
   //                  "13.402281"
   //              ],
   //                  "name": "Plzeň-Slovany",
   //                  "idx": 3
   //          },
   //          "PPMOA": {
   //              "loc": [
   //                  "49.692787",
   //                  "13.352594"
   //              ],
   //                  "name": "Plzeň - mobil 20.03.2013 Plzeň - Litice",
   //                  "idx": 2
   //          },
   //          "PPLEA": {
   //              "loc": [
   //                  "49.747330",
   //                  "13.381039"
   //              ],
   //                  "name": "Plzeň-střed",
   //                  "idx": 0
   //          },
   //          "PPLSA": {
   //              "loc": [
   //                  "49.745991",
   //                  "13.320748"
   //              ],
   //                  "name": "Plzeň-Skvrňany",
   //                  "idx": 0
   //          },
   //          "PPLBA": {
   //              "loc": [
   //                  "49.728394",
   //                  "13.375540"
   //              ],
   //                  "name": "Plzeň-Bory",
   //                  "idx": 0
   //          },
   //          "PPRMA": {
   //              "loc": [
   //                  "49.669582",
   //                  "12.677884"
   //              ],
   //                  "name": "Přimda",
   //                  "idx": -1
   //          },
   //          "PKUJA": {
   //              "loc": [
   //                  "49.722000",
   //                  "13.618538"
   //              ],
   //                  "name": "Kamenný Újezd",
   //                  "idx": 2
   //          },
   //          "PPLVA": {
   //              "loc": [
   //                  "49.768616",
   //                  "13.423381"
   //              ],
   //                  "name": "Plzeň-Doubravka",
   //                  "idx": 3
   //          },
   //          "PPLLA": {
   //              "loc": [
   //                  "49.770126",
   //                  "13.368221"
   //              ],
   //                  "name": "Plzeň-Lochotín",
   //                  "idx": 2
   //          }
   //      },
   //      "Moravskoslezský": {
   //          "TOPOA": {
   //              "loc": [
   //                  "49.825294",
   //                  "18.159275"
   //              ],
   //                  "name": "Ostrava-Poruba/ČHMÚ",
   //                  "idx": -1
   //          },
   //          "TKAOK": {
   //              "loc": [
   //                  "49.858891",
   //                  "18.557777"
   //              ],
   //                  "name": "Karviná-ZÚ",
   //                  "idx": 2
   //          },
   //          "TCTNA": {
   //              "loc": [
   //                  "49.748959",
   //                  "18.609726"
   //              ],
   //                  "name": "Český Těšín",
   //                  "idx": 1
   //          },
   //          "TOVKA": {
   //              "loc": [
   //                  "49.944988",
   //                  "17.909531"
   //              ],
   //                  "name": "Opava-Kateřinky",
   //                  "idx": 2
   //          },
   //          "TOROK": {
   //              "loc": [
   //                  "49.818539",
   //                  "18.340343"
   //              ],
   //                  "name": "Ostrava-Radvanice OZO",
   //                  "idx": 2
   //          },
   //          "TOREK": {
   //              "loc": [
   //                  "49.807056",
   //                  "18.339138"
   //              ],
   //                  "name": "Ostrava-Radvanice ZÚ",
   //                  "idx": 3
   //          },
   //          "TCERA": {
   //              "loc": [
   //                  "49.777142",
   //                  "17.541946"
   //              ],
   //                  "name": "Červená hora",
   //                  "idx": -1
   //          },
   //          "TCTAA": {
   //              "loc": [
   //                  "49.745152",
   //                  "18.621593"
   //              ],
   //                  "name": "Český Těšín-autobusové nádraží",
   //                  "idx": 1
   //          },
   //          "TONVA": {
   //              "loc": [
   //                  "49.824116",
   //                  "18.234913"
   //              ],
   //                  "name": "Ostrava Nová Ves-areál OVak",
   //                  "idx": 2
   //          },
   //          "TKARA": {
   //              "loc": [
   //                  "49.863796",
   //                  "18.551453"
   //              ],
   //                  "name": "Karviná",
   //                  "idx": 3
   //          },
   //          "TOPRA": {
   //              "loc": [
   //                  "49.856258",
   //                  "18.269741"
   //              ],
   //                  "name": "Ostrava-Přívoz",
   //                  "idx": 3
   //          },
   //          "TOFFA": {
   //              "loc": [
   //                  "49.839188",
   //                  "18.263689"
   //              ],
   //                  "name": "Ostrava-Fifejdy",
   //                  "idx": 2
   //          },
   //          "TOCBA": {
   //              "loc": [
   //                  "49.839848",
   //                  "18.289976"
   //              ],
   //                  "name": "Ostrava-Českobratrská (hot spot)",
   //                  "idx": 2
   //          },
   //          "TTROA": {
   //              "loc": [
   //                  "49.668114",
   //                  "18.677799"
   //              ],
   //                  "name": "Třinec-Kosmos",
   //                  "idx": 1
   //          },
   //          "TOUZA": {
   //              "loc": [
   //                  "49.936539",
   //                  "17.905169"
   //              ],
   //                  "name": "Opava-univerzitní zahrada",
   //                  "idx": 1
   //          },
   //          "TOZRA": {
   //              "loc": [
   //                  "49.796040",
   //                  "18.247181"
   //              ],
   //                  "name": "Ostrava-Zábřeh",
   //                  "idx": 3
   //          },
   //          "TTRKA": {
   //              "loc": [
   //                  "49.672379",
   //                  "18.643038"
   //              ],
   //                  "name": "Třinec-Kanada",
   //                  "idx": 1
   //          },
   //          "TOMHK": {
   //              "loc": [
   //                  "49.824860",
   //                  "18.263655"
   //              ],
   //                  "name": "Ostrava-Mariánské Hory",
   //                  "idx": 2
   //          },
   //          "TBKRA": {
   //              "loc": [
   //                  "49.502609",
   //                  "18.538561"
   //              ],
   //                  "name": "Bílý Kříž",
   //                  "idx": -1
   //          },
   //          "TFMIA": {
   //              "loc": [
   //                  "49.671791",
   //                  "18.351070"
   //              ],
   //                  "name": "Frýdek-Místek",
   //                  "idx": 1
   //          },
   //          "TSTDA": {
   //              "loc": [
   //                  "49.720936",
   //                  "18.089306"
   //              ],
   //                  "name": "Studénka",
   //                  "idx": 2
   //          },
   //          "TVERA": {
   //              "loc": [
   //                  "49.924679",
   //                  "18.422873"
   //              ],
   //                  "name": "Věřňovice",
   //                  "idx": 2
   //          },
   //          "TOPDA": {
   //              "loc": [
   //                  "49.835506",
   //                  "18.165279"
   //              ],
   //                  "name": "Ostrava-Poruba, DD",
   //                  "idx": 2
   //          },
   //          "THARA": {
   //              "loc": [
   //                  "49.790977",
   //                  "18.406836"
   //              ],
   //                  "name": "Havířov",
   //                  "idx": 3
   //          },
   //          "TRYCA": {
   //              "loc": [
   //                  "49.871670",
   //                  "18.377254"
   //              ],
   //                  "name": "Rychvald",
   //                  "idx": 3
   //          }
   //      },
   //      "Jihočeský": {
   //          "CCBDA": {
   //              "loc": [
   //                  "48.984386",
   //                  "14.465684"
   //              ],
   //                  "name": "České Budějovice",
   //                  "idx": 2
   //          },
   //          "CPRAA": {
   //              "loc": [
   //                  "49.016087",
   //                  "14.000444"
   //              ],
   //                  "name": "Prachatice",
   //                  "idx": 2
   //          },
   //          "CHVOA": {
   //              "loc": [
   //                  "48.724197",
   //                  "14.723382"
   //              ],
   //                  "name": "Hojná Voda",
   //                  "idx": 1
   //          },
   //          "CKOCA": {
   //              "loc": [
   //                  "49.467243",
   //                  "13.838234"
   //              ],
   //                  "name": "Kocelovice",
   //                  "idx": -1
   //          },
   //          "CTABA": {
   //              "loc": [
   //                  "49.411232",
   //                  "14.676389"
   //              ],
   //                  "name": "Tábor",
   //                  "idx": 4
   //          },
   //          "CCHUA": {
   //              "loc": [
   //                  "49.068436",
   //                  "13.614801"
   //              ],
   //                  "name": "Churáňov",
   //                  "idx": -1
   //          }
   //      },
   //      "Jihomoravský": {
   //          "BBMLA": {
   //              "loc": [
   //                  "49.165260",
   //                  "16.580812"
   //              ],
   //                  "name": "Brno-Lány",
   //                  "idx": 2
   //          },
   //          "BMOCA": {
   //              "loc": [
   //                  "49.208195",
   //                  "16.778444"
   //              ],
   //                  "name": "Sivice",
   //                  "idx": 2
   //          },
   //          "BZNOA": {
   //              "loc": [
   //                  "48.842957",
   //                  "16.060127"
   //              ],
   //                  "name": "Znojmo",
   //                  "idx": 3
   //          },
   //          "BHODA": {
   //              "loc": [
   //                  "48.857224",
   //                  "17.133333"
   //              ],
   //                  "name": "Hodonín",
   //                  "idx": 3
   //          },
   //          "BBNIA": {
   //              "loc": [
   //                  "49.213211",
   //                  "16.678024"
   //              ],
   //                  "name": "Brno-Líšeň",
   //                  "idx": 1
   //          },
   //          "BMISA": {
   //              "loc": [
   //                  "48.791767",
   //                  "16.724497"
   //              ],
   //                  "name": "Mikulov-Sedlec",
   //                  "idx": 1
   //          },
   //          "BBMAA": {
   //              "loc": [
   //                  "49.216087",
   //                  "16.613836"
   //              ],
   //                  "name": "Brno-Arboretum",
   //                  "idx": 2
   //          },
   //          "BBNAA": {
   //              "loc": [
   //                  "49.188889",
   //                  "16.626944"
   //              ],
   //                  "name": "Brno-Masná",
   //                  "idx": 0
   //          },
   //          "BKUCA": {
   //              "loc": [
   //                  "48.881355",
   //                  "16.085817"
   //              ],
   //                  "name": "Kuchařovice",
   //                  "idx": 0
   //          },
   //          "BBMZA": {
   //              "loc": [
   //                  "49.185883",
   //                  "16.613661"
   //              ],
   //                  "name": "Brno-Zvonařka",
   //                  "idx": 2
   //          },
   //          "BBDNA": {
   //              "loc": [
   //                  "49.202724",
   //                  "16.616287"
   //              ],
   //                  "name": "Brno - Dětská nemocnice",
   //                  "idx": 3
   //          },
   //          "BBNYA": {
   //              "loc": [
   //                  "49.148972",
   //                  "16.696217"
   //              ],
   //                  "name": "Brno-Tuřany",
   //                  "idx": 2
   //          },
   //          "BBNVA": {
   //              "loc": [
   //                  "49.198090",
   //                  "16.593643"
   //              ],
   //                  "name": "Brno-Úvoz (hot spot)",
   //                  "idx": 3
   //          },
   //          "BBMVA": {
   //              "loc": [
   //                  "49.189621",
   //                  "16.569538"
   //              ],
   //                  "name": "Brno-Výstaviště",
   //                  "idx": 2
   //          },
   //          "BBMSA": {
   //              "loc": [
   //                  "49.208160",
   //                  "16.642517"
   //              ],
   //                  "name": "Brno-Svatoplukova",
   //                  "idx": 2
   //          },
   //          "BMOKA": {
   //              "loc": [
   //                  "49.219444",
   //                  "16.755306"
   //              ],
   //                  "name": "Mokrá",
   //                  "idx": 2
   //          }
   //      },
   //      "Karlovarský": {
   //          "KCHMA": {
   //              "loc": [
   //                  "50.065861",
   //                  "12.363442"
   //              ],
   //                  "name": "Cheb",
   //                  "idx": 2
   //          },
   //          "KPRBA": {
   //              "loc": [
   //                  "50.372478",
   //                  "12.615380"
   //              ],
   //                  "name": "Přebuz",
   //                  "idx": -1
   //          },
   //          "KSOMA": {
   //              "loc": [
   //                  "50.172825",
   //                  "12.672818"
   //              ],
   //                  "name": "Sokolov",
   //                  "idx": 1
   //          }
   //      },
   //      "Ústecký": {
   //          "UCHMA": {
   //              "loc": [
   //                  "50.467529",
   //                  "13.412696"
   //              ],
   //                  "name": "Chomutov",
   //                  "idx": 1
   //          },
   //          "USNZA": {
   //              "loc": [
   //                  "50.789444",
   //                  "14.086799"
   //              ],
   //                  "name": "Sněžník",
   //                  "idx": -1
   //          },
   //          "UDCMA": {
   //              "loc": [
   //                  "50.774151",
   //                  "14.218794"
   //              ],
   //                  "name": "Děčín",
   //                  "idx": 3
   //          },
   //          "URVHA": {
   //              "loc": [
   //                  "50.579834",
   //                  "13.419506"
   //              ],
   //                  "name": "Rudolice v Horách",
   //                  "idx": 1
   //          },
   //          "UTPMA": {
   //              "loc": [
   //                  "50.645279",
   //                  "13.851250"
   //              ],
   //                  "name": "Teplice ",
   //                  "idx": 4
   //          },
   //          "UTUSA": {
   //              "loc": [
   //                  "50.376587",
   //                  "13.327622"
   //              ],
   //                  "name": "Tušimice",
   //                  "idx": 1
   //          },
   //          "UULMA": {
   //              "loc": [
   //                  "50.661095",
   //                  "14.043063"
   //              ],
   //                  "name": "Ústí n.L.-město",
   //                  "idx": 4
   //          },
   //          "UULKA": {
   //              "loc": [
   //                  "50.683525",
   //                  "14.041195"
   //              ],
   //                  "name": "Ústí n.L.-Kočkov",
   //                  "idx": 2
   //          },
   //          "UKRUA": {
   //              "loc": [
   //                  "50.696671",
   //                  "13.847692"
   //              ],
   //                  "name": "Krupka",
   //                  "idx": 2
   //          },
   //          "UMOMA": {
   //              "loc": [
   //                  "50.510365",
   //                  "13.645272"
   //              ],
   //                  "name": "Most",
   //                  "idx": 2
   //          },
   //          "UDOKA": {
   //              "loc": [
   //                  "50.458855",
   //                  "14.170162"
   //              ],
   //                  "name": "Doksany",
   //                  "idx": -1
   //          },
   //          "ULTTA": {
   //              "loc": [
   //                  "50.540897",
   //                  "14.119409"
   //              ],
   //                  "name": "Litoměřice",
   //                  "idx": 4
   //          },
   //          "UMEDA": {
   //              "loc": [
   //                  "50.427589",
   //                  "13.130143"
   //              ],
   //                  "name": "Měděnec",
   //                  "idx": 1
   //          },
   //          "UULDA": {
   //              "loc": [
   //                  "50.683125",
   //                  "13.997873"
   //              ],
   //                  "name": "Ústí n.L.-Všebořická (hot spot)",
   //                  "idx": 2
   //          },
   //          "ULOMA": {
   //              "loc": [
   //                  "50.585766",
   //                  "13.673418"
   //              ],
   //                  "name": "Lom",
   //                  "idx": 2
   //          }
   //      },
   //      "Olomoucký": {
   //          "MOLJA": {
   //              "loc": [
   //                  "49.601463",
   //                  "17.238073"
   //              ],
   //                  "name": "Olomouc-Hejčín",
   //                  "idx": 3
   //          },
   //          "MBELA": {
   //              "loc": [
   //                  "49.587082",
   //                  "17.804220"
   //              ],
   //                  "name": "Bělotín",
   //                  "idx": 3
   //          },
   //          "MJESA": {
   //              "loc": [
   //                  "50.242241",
   //                  "17.190180"
   //              ],
   //                  "name": "Jeseník-lázně",
   //                  "idx": 1
   //          },
   //          "MOLSA": {
   //              "loc": [
   //                  "49.592865",
   //                  "17.266094"
   //              ],
   //                  "name": "Olomouc-Šmeralova",
   //                  "idx": 3
   //          },
   //          "MPRRA": {
   //              "loc": [
   //                  "49.451656",
   //                  "17.454159"
   //              ],
   //                  "name": "Přerov",
   //                  "idx": 3
   //          },
   //          "MPSTA": {
   //              "loc": [
   //                  "49.467857",
   //                  "17.114725"
   //              ],
   //                  "name": "Prostějov",
   //                  "idx": 4
   //          }
   //      },
   //      "Liberecký": {
   //          "LSOUA": {
   //              "loc": [
   //                  "50.789646",
   //                  "15.319683"
   //              ],
   //                  "name": "Souš",
   //                  "idx": -1
   //          },
   //          "LFRTA": {
   //              "loc": [
   //                  "50.940651",
   //                  "15.069817"
   //              ],
   //                  "name": "Frýdlant",
   //                  "idx": -1
   //          },
   //          "LCLMA": {
   //              "loc": [
   //                  "50.698044",
   //                  "14.537345"
   //              ],
   //                  "name": "Česká Lípa",
   //                  "idx": 3
   //          },
   //          "LLILA": {
   //              "loc": [
   //                  "50.755100",
   //                  "15.069967"
   //              ],
   //                  "name": "Liberec Rochlice",
   //                  "idx": 1
   //          }
   //      }
   //  }
   //  });
    console.log('Retrieving meta data from the server');
    $.ajax({
        url: 'https://dph57g603c.execute-api.eu-central-1.amazonaws.com/prod/summary',
        method: 'GET',
        headers: {
            'x-api-key': 'api_key_public_access'
        }
    }).done(function (meta) {
        console.log('Current server meta summary: ', meta);
        setMeta(meta);
    });
}

function loadDetail(stationCode) {
    // setDetail(stationCode, [
    //     {"val":"1.3","idx":1,"type":"SO2","int":"1h"},
    //     {"val":"21.6","idx":1,"type":"NO2","int":"1h"},
    //     {"val":"376","idx":1,"type":"CO","int":"8h"},
    //     {"val":"5.8","idx":1,"type":"PM10","int":"1h"},
    //     {"val":"56.7","idx":-2,"type":"O3","int":"1h"},
    //     {"val":"22.5","idx":-2,"type":"PM10","int":"24h"},
    //     {"val":"8.0","idx":-2,"type":"PM2_5","int":"1h"}]);
    console.log('Retrieving station data from the server');
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
     }).fail(function (err) {
         console.log('Station ' + stationCode + ' error: ', err);
         setDetail(stationCode, []);
     });
}
