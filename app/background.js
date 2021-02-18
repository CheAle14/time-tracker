/*chrome.browserAction.onClicked.addListener(function(tab) {
    chrome.tabs.create({url: "popup.html"})
});*/

/*var _oldLog = console.log;
console.log = function(str) {
    var inMessage;
    if(typeof str === "string")
        inMessage = str;
    else
        inMessage = str.toString();
    _oldLog(str);
    fetch(`${URL}/log`, {
        method: "POST",
        body: JSON.stringify({"message": inMessage})
    });
}*/

var INFO = {};
var PORTS = {};
var PORTS_WATCHING = {};
var URL = "https://ml-api.uk.ms/api/tracker";
var CACHE = {};
var GET_QUEUE = [];
var SET_QUEUE = {}
var UP_TO_DATE = true;
console.log("Background started");

function postMessage(message) {
    for(let key in PORTS) {
        PORTS[key].postMessage(message);
    }
}

function id(_tab) {
    return _tab.sender.tab ? _tab.sender.tab.id : 0;
}
function getName(_tab) {
    return _tab.sender.tab ? `${id(_tab)} @ ${_tab.sender.url}` : "popup @ " + _tab.sender.url;
}
function getWatchingId(url) {
    url = url;
    if(url.indexOf("?v=") === -1)
        return null;
    var id = url.substring(url.indexOf("?v=") + 3);

    var index = id.indexOf("&");
    if(index !== -1) {
        id = id.substring(0, index);
    }
    return id;
}

function getPortAlreadyWatching(videoId) {
    for(const portId in PORTS_WATCHING) {
        var port = PORTS[portId];
        var watching = PORTS_WATCHING[portId];
        if(watching === videoId) {
            return port;
        }
    }
    return null;
}

chrome.runtime.onConnect.addListener(function(thing) {
    /*if(TAB) {
        try {
            TAB.onMessage.removeListener(onMessage);
        } catch{}
        try {
            TAB.disconnect();
        } catch {}
        console.log(`Disconnecting ${id(TAB)}`);
    }*/
    console.log(thing);
    thing.id = id(thing);
    thing.name = getName(thing);
    if(INFO.name === null) {
        thing.postMessage({type: "error", data: "Connection was not established to server. Retrying - reload page in a bit"});
        thing.disconnect();
        setup();
        console.log(`Refused connection from ${thing.id} due to invalid startup`)
        return;
    }
    console.log(thing);
    console.log(`Connecting to ${thing.name}`);
    PORTS[thing.id] = thing;
    thing.onMessage.addListener(onMessage);
    thing.onDisconnect.addListener(function(tab) {
        console.log(`Disconnected from ${getName(tab)}`);
        delete PORTS[tab.id];
        delete PORTS_WATCHING[tab.id];
    });
    thing.postMessage({type: "sendInfo", data: INFO});
    if(typeof UP_TO_DATE === "string") {
        thing.postMessage({type: "update", data: UP_TO_DATE});
    }
});
chrome.runtime.onMessage.addListener(onMessage);

function onMessage(message, sender, response) {
    console.log(message);
    if(message.type === "setToken") {
        setToken(message.data);
    } else if(message.type === "getTimes") {
        for(const vId of message.data) {
            if(!(vId in GET_QUEUE)) {
                GET_QUEUE.push(vId);
            }
        }
    } else if(message.type === "setTime") {
        for(const vId in message.data) {
            var time = message.data[vId];
            console.log(`Queued ${vId} to set ${time}`);
            SET_QUEUE[vId] = time;
            CACHE[vId] = {"t": time, "w": Date.now()};
        }
    } else if(message.type === "setWatching") {
        var vidId = message.data;
        if(vidId === null) {
            delete PORTS_WATCHING[sender.id];
            console.log(`${getName(sender)} has stopped watching any videos`);
            return;
        }
        var alsoWatching = getPortAlreadyWatching(vidId);
        console.log(alsoWatching);
        if(alsoWatching) {
            if(getName(alsoWatching) === getName(sender))
                return;
            sender.postMessage({type: "stop", data: {
                log: `Video ${vidId} being watched by port ${getName(alsoWatching)}`,
                display: "Video already being watched"
            }});
            var tab = alsoWatching.sender.tab;
            var param = {
                "tabs": tab.index,
                "windowId": tab.windowId
            };
            chrome.tabs.highlight(param);
        } else {
            PORTS_WATCHING[sender.id] = vidId;
            console.log(`${sender.name} now watching ${vidId}`);
        }
    } else if(message.type === "getData") {
        sender.postMessage({type: "sendData", data: {
            "info": INFO,
            "cache": CACHE,
            "ports": PORTS,
            "watching": PORTS_WATCHING
        }});
    } else if(message.type === "highlightTab") {
        var port = PORTS[message.data];
        if(port) {
            var tab = port.sender.tab;
            chrome.tabs.highlight({
                "tabs": tab.index,
                "windowId": tab.windowId
            });
        }
    }
}

async function setToken(token) {
    INFO.token = token;
    var response = await fetch(`${URL}/user`, {
        headers: {
            "X-SESSION": INFO.token
        }
    });
    try {
        var rText = await response.json();
        console.log(rText);
        if(rText) {
            INFO.name = rText.name;
            INFO.id = rText.id;
            INFO.interval = rText.interval;
            chrome.storage.local.set({"token": INFO.token}, function() {
                console.log("Set token!");
            });
        } else {
            INFO.name = null;
            INFO.id = null;
            INFO.interval = {set: 15000, get: 5000};
        }
        console.log(`Loaded token, logged in as ${INFO.name}`);
        postMessage({type: "sendInfo", data: INFO});
    } catch(e) {
        console.log("Failed to login using token.");
        console.error(e);
    }
}

async function getTimes(timesObject) {
    query = "";
    var respJson = {};
    for(let key of timesObject) {
        if(key in CACHE) {
            var cachedData = CACHE[key];
            var time = cachedData.t;
            var cachedAt = cachedData.w;
            var diff = Date.now() - cachedAt;
            if(diff < 10000) {
                respJson[key] = time;
                continue;
            }
        }
        query += encodeURI(key) + ",";
    }
    if(query.length === 0) // shortcut, don't bother.
        return respJson;
    var response = await fetch(`${URL}/times?ids=${query}`, {
        "headers": {
            "X-SESSION": INFO.token
        }
    });
    console.log(response);
    respJson = await response.json();
    for(const key in respJson) {
        CACHE[key] = {t: respJson[key], w: Date.now()};
    }
    return respJson;
}

async function setTimes(timesObject) {
    console.log(timesObject);
    var response = await fetch(`${URL}/times`, {
        "headers": {
            "X-SESSION": INFO.token
        },
        method: "POST",
        body: JSON.stringify(timesObject)
    });
    console.log(response);
    if(response.ok)
        return timesObject;
    return {};
}


function processGetQueue() {
    if(getObjectLength(PORTS) === 0)
        return;
    if(GET_QUEUE.length > 0) {
        var q = GET_QUEUE;
        GET_QUEUE = [];
        getTimes(q).then(function(times) {
            console.log("Gotten times! Sending...");
            postMessage({"type": "gotTimes", data: times});
        });
    }
}
function processSetQueue() {
    if(getObjectLength(PORTS) === 0)
        return;
    if(getObjectLength(SET_QUEUE) > 0) {
        console.log(`Sending queue of ${getObjectLength(SET_QUEUE)} items`);
        var q = SET_QUEUE;
        SET_QUEUE = {}
        setTimes(q).then(function(saved) {
            postMessage({type: "savedTime", data: saved});
        });
    }
}

async function checkVersion(alarm) {
    if(alarm.name !== "versionCheck")
    console.log(alarm);
    var response = await fetch(`${URL}/latestVersion`, {
        "headers": {
            "X-SESSION": INFO.token
        }
    });
    var webVersion = await response.text();
    var manifest = chrome.runtime.getManifest();
    console.log(manifest);
    console.log(webVersion);
    var selfVersion = manifest.version;
    var compare = versionCompare(selfVersion, webVersion);
    if(compare === 0) {
        console.log("Running latest version");
    } else if (compare > 0) {
        console.log("Running newer version")
    } else if(compare < 0) {
        console.warn("Running older version")
        UP_TO_DATE = webVersion;
        for(let portId in PORTS) {
            var port = PORTS[portId];
            port.postMessage({type: "update", data: UP_TO_DATE});
        }
    }
}

async function setup() {
    chrome.storage.local.get(["token"], async function(result) {
        await setToken(result.token);
        setInterval(processGetQueue, INFO.interval.get);
        setInterval(processSetQueue, INFO.interval.set);
    });
    chrome.alarms.onAlarm.addListener(checkVersion);
    chrome.alarms.get("versionCheck", function(alarm) {
        if(!alarm) {
            chrome.alarms.create("versionCheck", {
                delayInMinutes: 0.1 // 24 hours
            });
        }
    });
}
setup();

// Helpers.
function ObjectLength_Modern( object ) {
    return Object.keys(object).length;
}

function ObjectLength_Legacy( object ) {
    var length = 0;
    for( var key in object ) {
        if( object.hasOwnProperty(key) ) {
            ++length;
        }
    }
    return length;
}

var getObjectLength =
    Object.keys ? ObjectLength_Modern : ObjectLength_Legacy;

/**
 * Compares two software version numbers (e.g. "1.7.1" or "1.2b").
 *
 * This function was born in http://stackoverflow.com/a/6832721.
 *
 * @param {string} v1 The first version to be compared.
 * @param {string} v2 The second version to be compared.
 * @param {object} [options] Optional flags that affect comparison behavior:
 * <ul>
 *     <li>
 *         <tt>lexicographical: true</tt> compares each part of the version strings lexicographically instead of
 *         naturally; this allows suffixes such as "b" or "dev" but will cause "1.10" to be considered smaller than
 *         "1.2".
 *     </li>
 *     <li>
 *         <tt>zeroExtend: true</tt> changes the result if one version string has less parts than the other. In
 *         this case the shorter string will be padded with "zero" parts instead of being considered smaller.
 *     </li>
 * </ul>
 * @returns {number|NaN}
 * <ul>
 *    <li>0 if the versions are equal</li>
 *    <li>a negative integer iff v1 < v2</li>
 *    <li>a positive integer iff v1 > v2</li>
 *    <li>NaN if either version string is in the wrong format</li>
 * </ul>
 *
 * @copyright by Jon Papaioannou (["john", "papaioannou"].join(".") + "@gmail.com")
 * @license This function is in the public domain. Do what you want with it, no strings attached.
 */
function versionCompare(v1, v2, options) {
    var lexicographical = options && options.lexicographical,
        zeroExtend = options && options.zeroExtend,
        v1parts = v1.split('.'),
        v2parts = v2.split('.');

    function isValidPart(x) {
        return (lexicographical ? /^\d+[A-Za-z]*$/ : /^\d+$/).test(x);
    }

    if (!v1parts.every(isValidPart) || !v2parts.every(isValidPart)) {
        return NaN;
    }

    if (zeroExtend) {
        while (v1parts.length < v2parts.length) v1parts.push("0");
        while (v2parts.length < v1parts.length) v2parts.push("0");
    }

    if (!lexicographical) {
        v1parts = v1parts.map(Number);
        v2parts = v2parts.map(Number);
    }

    for (var i = 0; i < v1parts.length; ++i) {
        if (v2parts.length == i) {
            return 1;
        }

        if (v1parts[i] == v2parts[i]) {
            continue;
        }
        else if (v1parts[i] > v2parts[i]) {
            return 1;
        }
        else {
            return -1;
        }
    }

    if (v1parts.length != v2parts.length) {
        return -1;
    }

    return 0;
}