chrome.browserAction.onClicked.addListener(function(tab) {
    chrome.tabs.create({url: "popup.html"})
});
chrome.contextMenus.onClicked.addListener(function(menu, tab) {
    console.log(menu, " ", tab);
    var vidUrl = menu.linkUrl || menu.pageUrl;
    localId = function(url) {
        url = url || window.location.href;
        if(url.indexOf("?v=") === -1)
            return null;
        var id = url.substring(url.indexOf("?v=") + 3);
    
        var index = id.indexOf("&");
        if(index !== -1) {
            id = id.substring(0, index);
        }
        return id;
    }
    var id = localId(vidUrl);
    var x = {};
    if(BLACKLISTED_VIDEOS[id]) {
        console.log(`ID ${id} is already blacklisted, removing it`);
        delete BLACKLISTED_VIDEOS[id];
        x[id] = false;
    } else {
        console.log(`Adding ${id} to blacklist`);
        x[id] = true;
        BLACKLISTED_VIDEOS[id] = true;
    }
    sendPacket({
        id: EXTERNAL.UPDATE_IGNORED_VIDEOS,
        content: x
    }, function(resp) {
        console.log("Gotten resp: ", resp);
        var port = PORTS[tab.id];
        console.log(port || PORTS);
        port.postMessage({type: "alert", data: `Video ` + (x[id] ? "has been" : "is no longer") + " blacklisted"});
    });
});
chrome.contextMenus.create({
    contexts: ["page"],
    documentUrlPatterns: ["https://*.youtube.com/watch*", "https://youtube.com/watch*"],
    id: "blacklistVid",
    title: "Toggle watching ignored"
}, function() {
    if(chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
    } else {
        console.log("Registered page context menu option");
    }
});
chrome.contextMenus.create({
    contexts: ["video", "link"],
    documentUrlPatterns: ["https://*.youtube.com/*", "https://youtube.com/*"],
    targetUrlPatterns: ["https://*.youtube.com/watch*", "https://youtube.com/watch*"],
    id: "blacklistLink",
    title: "Toggle right clicked ignored"
}, function() {
    if(chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
    } else {
        console.log("Registered video context menu option");
    }
});

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
function defaultInfo() {
    return {
        name: null,
        id: null,
        interval: {
            get: 15000,
            set: 30000
        }
    }
}
var INFO = defaultInfo();
var PORTS = {};
var PORTS_WATCHING = {};
const DEBUG = false;
const URL =  DEBUG ? "http://localhost:8887/api/tracker" : "https://ml-api.uk.ms/api/tracker";
const CACHE = new TrackerCache();
const BLACKLISTED_VIDEOS = {};
const API_VERSION = 2;
var WS_QUEUE = new WebSocketQueue();
var YT_GET_QUEUE = [];
var YT_SET_QUEUE = {}
var UP_TO_DATE = true;
var INTERVAL_IDS = {"get": 0, "set": 0, "ws": 0};
var WS = null;

var WS_CALLBACK = {};
var WS_NORESPONSE = {};
var WS_FAILED = 0;
var SEQUENCE = 1;
const CACHE_TIMEOUT = 20000;
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

function isPopupUrl(url) {
    return url.endsWith("popup.html") || url.endsWith("popup.html#");
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
    startProcessQueues();
    console.log(thing);
    thing.id = id(thing);
    thing.name = getName(thing);
    if(INFO.name === null && !isPopupUrl(thing.sender.url)) {
        thing.postMessage({type: "error", data: "Connection was not established to server."});
        setup();
    }
    console.log(thing);
    console.log(`Connecting to ${thing.name}`);
    PORTS[thing.id] = thing;
    thing.onMessage.addListener(onMessage);
    thing.onDisconnect.addListener(function(tab) {
        console.log(`Disconnected from ${getName(tab)}`);
        delete PORTS[tab.id];
        delete PORTS_WATCHING[tab.id];
        if(getObjectLength(PORTS) === 0) {
            console.log("All ports closed; commanding intervals to halt");
            STOP_QUEUE_NEXT = true;
        }
    });
    thing.postMessage({type: "sendInfo", data: INFO});
    if(typeof UP_TO_DATE === "string") {
        thing.postMessage({type: "update", data: UP_TO_DATE});
    }
    if(isPopupUrl(thing.sender.url)) {
        thing.postMessage({type: "provideBlacklist", data: BLACKLISTED_VIDEOS});
    }
});
chrome.runtime.onMessage.addListener(onMessage);

function onMessage(message, sender, response) {
    console.debug(`[${id(sender)}] << `, message);
    if(message.type === "setToken") {
        setToken(message.data);
    } else if(message.type === "getTimes") {
        var instantResponse = {};
        for(const vId of message.data) {
            if(!(vId in YT_GET_QUEUE)) {
                var cached = CACHE.Fetch(vId);
                if(cached) {
                    var diff = Date.now() - cached.cachedAt;
                    if(diff < CACHE_TIMEOUT) {
                        console.debug(`get: Found ${vId} in cache, out of date by ${diff}ms`);
                        instantResponse[vId] = cached.t;
                        continue;
                    }
                }
                YT_GET_QUEUE.push(vId);
            }
        }
        if(getObjectLength(instantResponse) > 0) {
            postMessage({"type": "gotTimes", data: instantResponse});
        }
    } else if(message.type === "setTime") {
        for(const vId in message.data) {
            var time = message.data[vId];
            YT_SET_QUEUE[vId] = time;
            CACHE.Insert(new YoutubeCacheItem(vId, Date.now(), time));
        }
    } else if(message.type === "setWatching") {
        var vidId = message.data;
        if(vidId === null) {
            delete PORTS_WATCHING[sender.id];
            console.log(`${getName(sender)} has stopped watching any videos`);
            return;
        }
        if(BLACKLISTED_VIDEOS[vidId]) {
            console.log(`${getName(sender)} has begun watching an ignored video, will tell them to continue`);
            sender.postMessage(new InternalPacket(INTERNAL.IGNORED_VIDEO, undefined));
            return;
        }
        var alsoWatching = getPortAlreadyWatching(vidId);
        if(alsoWatching) {
            if(getName(alsoWatching) === getName(sender))
                return;
            sender.postMessage(new StatePacket(false, 
                "Video already being watched", 
                `Video ${vidId} being watched by port ${getName(alsoWatching)}`));
            var tab = alsoWatching.sender.tab;
            var param = {
                "tabs": tab.index,
                "windowId": tab.windowId
            };
            chrome.tabs.highlight(param);
        } else {
            PORTS_WATCHING[sender.id] = vidId;
            console.log(`${sender.name} now watching ${vidId}`);
            //delete CACHE[vidId]; // ensure it is fresh
            // fresh from server perspective, but what if they're watching it
            // in this client? then cache is the most up-to-date...
            getTimes([message.data], function(times) {
                    postMessage({"type": "gotTimes", data: times});
            }, function(error) {
                error.res = message.seq;
                sender.postMessage(error);
            }); // Immediately begin fetching video time to save load times
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
    } else if(message.type === "getLatest") {
        getLatestWatched(function(obj) {
            sender.postMessage(new InternalPacket(INTERNAL.SEND_LATEST, obj));
        })
    } else if(message.type === INTERNAL.NAVIGATE_ID) {
        chrome.tabs.create({
            url: `https://youtube.com/watch?v=${message.data}`
        });
    } else if(message.type === INTERNAL.REDDIT_VISITED) {
        if(!message.data.id) {
            console.warn("Received null thread ID, not handling.");
            return;
        }
        CACHE.Insert(new RedditCacheItem(message.data.id, new Date(), message.data.count));
        sendPacket({
            id: EXTERNAL.VISITED_THREAD,
            content: message.data
        }, function(x) {
            if(message.seq !== undefined) {
                var resp = new InternalPacket("response", x);
                resp.res = message.seq
                sender.postMessage(resp);
            }
        });
    } else if(message.type === INTERNAL.GET_REDDIT_COUNT) {
        var cached = {};
        var remain = [];
        for(let threadId of message.data) {
            var item = CACHE.Fetch(threadId);
            if(item) {
                cached[threadId] = item;
            } else {
                remain.push(threadId);
            }
        }
        if(remain.length === 0) {
            if(message.seq !== undefined) {
                var resp = new InternalPacket("response", cached);
                resp.res = message.seq
                sender.postMessage(resp);
            }
        } else {
            sendPacket({
                id: EXTERNAL.GET_THREADS,
                content: message.data
            }, function(x) {
                for(let threadId in x) {
                    var data = x[threadId];
                    var cacheItem = new RedditCacheItem(threadId, data.when, data.count);
                    CACHE.Insert(cacheItem);
                    cached[threadId] = cacheItem;
                }

                if(message.seq !== undefined) {
                    var resp = new InternalPacket("response", cached);
                    resp.res = message.seq
                    sender.postMessage(resp);
                }
            }, function(arg) {
                sender.postMessage(arg);
            })
        }
        
    }
}

var firstOpen = true;
function wsOnOpen() {
    console.log("[WS] Open(ed|ing) connection");
    if(firstOpen) {
        firstOpen = false;
        checkVersion(null);
    }
    chrome.storage.local.get(["wsQueue"], function({wsQueue}) {
        console.log(wsQueue);
        if(typeof wsQueue === "string") 
            wsQueue = JSON.parse(wsQueue);
        else if (typeof wsQueue === "undefined" || typeof wsQueue === "null")
            wsQueue = [];
        console.log("Loaded prior WS queues: ", wsQueue);
        for(let item of wsQueue) {
            WS_QUEUE.Remove(item.id); // removes it if it exists
            WS_QUEUE.Enqueue(item);
        }
        if(WS_QUEUE.Length() > 0) {
            console.log("Re-starting queue interval as there's ", WS_QUEUE.Length(), " items to be sent");
            INTERVAL_IDS.ws = setInterval(wsInterval, 200);
        }
    })
}
function wsOnClose(event) {
    console.log("[WS] Disconnected ", event);
    if(WS_FAILED > 4) {
        postMessage(new InternalPacket("error", "Disconnect from WS"));
    }
    clearInterval(INTERVAL_IDS.ws);
    INTERVAL_IDS.ws = 0;
    WS_FAILED++;
    setTimeout(function() {
        console.log("[WS] Retrying connection...]");
        startWs();
    }, 5000 + (1000 * WS_FAILED));
    
}
function wsOnMessage(event) {
    if(WS_FAILED > 0) {
        WS_FAILED = 0;
        postMessage(new StatePacket(true, "Reconnected", "WebSocket connection restabilised"));
    }
    var packet = JSON.parse(event.data);
    console.log("[WS] <<", packet);
    if(packet.res !== undefined) {
        WS_QUEUE.MarkDone(packet.res);
        if(WS_QUEUE.Length === 0) {
            console.log("Ending WS queue interval");
            clearInterval(INTERVAL_IDS.ws);
            INTERVAL_IDS.ws = 0;
        }
        var onfail = WS_NORESPONSE[packet.res];
        if(onfail) {
            clearTimeout(onfail.timer);
            delete WS_NORESPONSE[packet.res];
        }
        var callback = WS_CALLBACK[packet.res];
        if(callback) {
            callback(packet.content);
            delete WS_CALLBACK[packet.res];
        }
    } else if(packet.id === "DirectRatelimit") {
        console.log(`Ratelimits updated`, packet.content);
        INFO.interval = packet.content;
        startProcessQueues(); // restarts intervals
        return;
    } else if(packet.id === "SendVersion") {
        handleVersion(packet.content);
    } else if(packet.id === "UpdateIgnored") {
        if(!packet.res) {
            for(let key in packet.content) {
                console.log(key);
                var value = packet.content[key];
                if(value) {
                    BLACKLISTED_VIDEOS[key] = true;
                } else {
                    delete BLACKLISTED_VIDEOS[key];
                }
            }
        }
    } else if(packet.retry) {
        console.log("[WS] Received duplicate retry packet, discarding ", packet);
    } else {
        console.warn("[WS] Unknown packet received ", packet);
    }
}
function sendPacket(packet, callback, onfail) {
    packet.seq = SEQUENCE++;
    console.debug(`[Queued] `, packet);
    WS_CALLBACK[packet.seq] = callback;
    if(onfail) {
        console.log("Setting up timeout for ", packet);
        var c = setTimeout(function() {
            delete WS_NORESPONSE[packet.seq];
            console.log("Sending timeout for ", packet);
            onfail(new NoResponsePacket("Timed out"));
        }, WS_QUEUE.RetryAfter(packet));
        WS_NORESPONSE[packet.seq] = {f: onfail, timer: c};
    }
    WS_QUEUE.Enqueue(packet);
    
    if(WS && WS.readyState == WebSocket.OPEN) {
        if(!INTERVAL_IDS.ws) {
            console.log("Starting WS queue due to new packet");
            INTERVAL_IDS.ws = setInterval(wsInterval, 5000);
        }
    } else {
        console.warn("Saving queue as we're disconnected!");
        saveQueue();
        if(onfail) {
            onfail(new NoResponsePacket("instant"));
        }
    }
}

function saveQueue() {
    var q = WS_QUEUE.Perist();
    chrome.storage.local.set({wsQueue: q}, function() {
        if(chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
        } else {
            console.log("Saved WS queue to local storage: ", q);
            WS_QUEUE._saved = true;
        }
    });
}

function wsInterval() {
    if(WS.readyState != WebSocket.OPEN) {
        clearInterval(INTERVAL_IDS.ws);
        INTERVAL_IDS.ws = 0;
        if(!WS_QUEUE._saved) {
            saveQueue();
        }
        return;
    }
    var last = WS_QUEUE.Waiting();
    if(last) {
        var diff = Date.now() - last.firstSent;
        var retryAfter = WS_QUEUE.RetryAfter(last) * (last.retries + 1);
        if(diff > retryAfter) {
            if(last.retries >= 5) {
                // Clearly there's an issue of some kind - let's disconnect and start over.
                console.error("Closing websocket connection - we've attempted too many retries.")
                WS.close(1000, "Retry too many times");
                WS_QUEUE._retries = 0;
                clearInterval(INTERVAL_IDS.ws);
                INTERVAL_IDS.ws = 0;
                return;
            }
            console.log(`%c[WS] Retrying ${last.retries} time after ${diff}ms >> `, "color:orange;", last.packet);
            WS_QUEUE._retries++;
            WS_QUEUE._last = Date.now();
            WS.send(JSON.stringify(last.packet));
        }
    } else {
        var next = WS_QUEUE.Next();
        if(next) {
            console.log(`[WS] >> `, next);
            WS.send(JSON.stringify(next));
        }
    }
}

function startWs() {
    var url = null;
    if(URL.startsWith("https")) {
        url = "wss://ml-api.uk.ms/time-tracker"
    } else {
        url = "ws://localhost:4650/time-tracker"
    }
    WS_CALLBACK = {};
    console.log(`Starting WS connection to ${url}`);
    WS = new WebSocket(`${url}?session=${INFO.token}&v=${API_VERSION}`);
    WS.onopen = wsOnOpen;
    WS.onclose = wsOnClose;
    WS.onmessage = wsOnMessage;
    WS.onerror = function(err) {
        console.error("[WS]", err);
    }
}

async function setToken(token) {
    INFO.token = token;
    chrome.storage.local.set({"token": INFO.token}, function() {
        console.log("Set token!");
    });
    try {
        var response = await fetch(`${URL}/user`, {
            headers: {
                "X-SESSION": INFO.token
            }
        });
    } catch (error) {
        console.error(`Failed to set login token `, error);
    }
    if(response && response.ok) {
        var rText = await response.json();
        console.log(rText);
        if(rText) {
            INFO.name = rText.name;
            INFO.id = rText.id;
            INFO.interval = rText.interval;
            startWs();
        } else {
            INFO = defaultInfo();
        }
    } else {
        INFO = defaultInfo();
    }
    postMessage({type: "sendInfo", data: INFO});
}

function getTimes(timesObject, callback, error_callback) {
    query = [];
    var respJson = {};
    for(let key of timesObject) {
        if(key in CACHE) {
            var cachedData = CACHE.Fetch(key);
            if(cachedData.Kind !== CACHE_KIND.YOUTUBE)
                continue;
            var time = cachedData.t;
            var cachedAt = cachedData.cachedAt;
            var diff = Date.now() - cachedAt;
            if(diff < CACHE_TIMEOUT) {
                console.debug(`GET: Found ${key} in cache, out of date by ${diff}ms`);
                respJson[key] = time;
                continue;
            }
        }
        query.push(key);
    }
    if(query.length === 0) {
        callback(respJson);
        return;
    }
    sendPacket({
        id: EXTERNAL.GET_TIMES,
        content: query,
    }, function(response) {
        console.log("Got callback:", response);
        for(let vId in response) {
            CACHE.Insert(new YoutubeCacheItem(vId, Date.now(), response[vId]));
        }
        callback(response);
    }, function(err) {
        console.log("Failed to get times: ", err);
        if(error_callback) {
            error_callback(err);
        }
    });
}

function getLatestWatched(callback) {
    sendPacket(new WebSocketPacket(EXTERNAL.GET_LATEST, null), function(data) {
        callback(data);
    });
}

async function setTimes(timesObject, callback) {
    console.log(timesObject);
    sendPacket({
        id: EXTERNAL.SET_TIMES,
        content: timesObject
    }, function(respContent) {
        console.log(`Set times: ${respContent}`);
        callback(timesObject);
    })
}


function processGetQueue() {
    if(YT_GET_QUEUE.length > 0) {
        var q = YT_GET_QUEUE.splice(0, 75);
        getTimes(q, function(times) {
            console.log("Gotten times! Sending... ");
            postMessage({"type": "gotTimes", data: times});
        });
    }
    if(STOP_QUEUE_NEXT) {
        clearInterval(INTERVAL_IDS.get);
        console.log("Get queue ceased")
    }
}
function processSetQueue() {
    if(getObjectLength(YT_SET_QUEUE) > 0) {
        console.log(`Sending queue of ${getObjectLength(YT_SET_QUEUE)} items`);
        var q = YT_SET_QUEUE;
        YT_SET_QUEUE = {}
        setTimes(q, function(saved) {
            postMessage({type: "savedTime", data: saved});
        });
    }
    if(STOP_QUEUE_NEXT) {
        clearInterval(INTERVAL_IDS.set);
        console.log("Set queue ceased");
    }
}

function handleVersion(webVersion) {
    if(UP_TO_DATE === webVersion)
        return;
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
        postMessage(new InternalPacket(INTERNAL.UPDATE, UP_TO_DATE));
    }
}

async function checkVersion(alarm) {
    sendPacket({
        id: EXTERNAL.GET_VERSION,
        content: null
    }, handleVersion);
}

async function alarmRaised(alarm) {
    if(alarm.name === "versionCheck") {
        checkVersion(alarm);
    }
}

function startProcessQueues() {
    STOP_QUEUE_NEXT = false;
    clearInterval(INTERVAL_IDS.get);
    clearInterval(INTERVAL_IDS.set);
    INTERVAL_IDS.get = setInterval(processGetQueue, INFO.interval.get);
    INTERVAL_IDS.set = setInterval(processSetQueue, INFO.interval.set);
}



async function setup() {
    chrome.storage.local.get(["token"], async function(result) {
        if(result && result.token) {
            await setToken(result.token);
        } else {
            console.debug(result);
        }
    });
    chrome.alarms.onAlarm.addListener(alarmRaised);
    chrome.alarms.get("versionCheck", function(alarm) {
        if(!alarm) {
            chrome.alarms.create("versionCheck", {
                periodInMinutes: 1440 // 24 hours
            });
        }
    });
    chrome.runtime.onInstalled.addListener(function(details) {
        console.log(details);
        chrome.storage.local.get("token", async function(result) {
            if(result && result.token) {}
            else {
                chrome.tabs.create({url: "popup.html"});
            }
        });
    })
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