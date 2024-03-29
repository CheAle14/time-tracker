console.log("Loaded worker.");
import {DeferredInternalRequest, DeferredPromise, EXTERNAL, getObjectLength, HELPERS, INTERNAL, InternalPacket, NoResponsePacket, RedditCacheItem, TrackerCache, WebSocketPacket, YoutubeCacheItem} from "./scripts/classes.js";

// DONE: setup websocket connection 
// DONE: setup popup page get information. (DONE, except for other tab info)
// IGNORE: setup get queue. 
// IGNORE: setup set queue. 
// DONE: setup message passing for the above get and set stuff. 
// DONE: blocklist video context menu

// TODO: reddit

const API_VERSION = 3;

function getState(key) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(key, (items) => {
            if (chrome.runtime.lastError) {
              return reject(chrome.runtime.lastError);
            }
            if(typeof key === "string") {
                items = items[key];
            }
            
            console.log("GET: ", key, " = ", items);
            resolve(items);
          });
    })
}

function setState(key, value) {
    return new Promise((resolve, reject) => {
        console.log("SET: ", key, ": ", value);
        var saving = {};
        saving[key] = value;
        chrome.storage.local.set(saving, () => {
            if (chrome.runtime.lastError) {
                return reject(chrome.runtime.lastError);
            }
            resolve();
        });
    })
}

chrome.webRequest.onCompleted.addListener(async (details) => {
    const port = PORTS[details.tabId];
    if(port) {
        port.postMessage({type: INTERNAL.CHECK_FOR_VIDEOS});
    }
}, {
    urls: ["https://www.youtube.com/youtubei/v1/browse*"]
})

chrome.runtime.onMessage.addListener((message, sender, reply) => {
    console.log(sender, message, reply);
    handleMessage(message, sender, (data) => {
        console.log(`[${id(sender)}] R>> `, data);
        reply(data);
    }).then(() => {
    });
    
    return true;
});
function id(_tab) {
    if(_tab.tab) return id(_tab.tab);
    if(_tab.sender) return id(_tab.sender);
    return _tab.id ? _tab.id : 0;
}
function getName(_tab) {
    return _tab.sender.tab ? `${id(_tab)} @ ${_tab.sender.url}` : "popup @ " + _tab.sender.url;
}

function checkCloseWs() {
    if(getObjectLength(PORTS) === 0) {
        console.log("All ports closed");
        if(WS) {
            if(getObjectLength(WS_CALLBACK) > 0) {
                console.log("Not closing WS, as there's still outstanding requests.");
            } else {
                console.log("Closing WS.");
                WS.close();
                WS = null;
            }
        }
    }
}

chrome.runtime.onSuspend.addListener(() => {
    console.log("WE ARE SUSPENDING");
    checkCloseWs();
});

chrome.runtime.onSuspendCanceled.addListener(() => {
    console.log("SUSPENSION CANCELLED - WE ARE BACK IN ORDER.");
});

chrome.runtime.onConnect.addListener(function(port) {
    port.id = id(port);
    console.log("[CONNECT] ", port);
    port.name = getName(port);
    PORTS[port.id] = port;
    port.onMessage.addListener((msg) => {
        handleMessage(msg, port, (data) => {
            data.res = msg.seq;
            console.log(`[${port.id}] >> `, data);
            var x = port.postMessage(data);
            if(data.error) port.disconnect();
            return x;
        }).then(() => {

        });
        return true;
    })
    port.onDisconnect.addListener((d) => {
        console.log(`[DISCONNECT] ${port.id}`);
        delete PORTS[port.id];
    });
    init().then(() => {
        port.postMessage({type: "sendInfo", data: INFO});
        port.postMessage({type: "blocklist", data: BLOCKLIST});
    })
});

chrome.action.onClicked.addListener(function() {
    chrome.tabs.create({url: 'popup.html'});
});
chrome.contextMenus.onClicked.addListener(async function(menu, tab) {  
    await init();
    console.log(menu, " ", tab);
    console.log("exist: ", BLOCKLIST);
    var vidUrl = menu.linkUrl || menu.pageUrl;
    var id = HELPERS.GetVideoId(vidUrl);
    var x = {};
    if(BLOCKLIST[id]) {
        console.log(`ID ${id} is already blacklisted, removing it`);
        delete BLOCKLIST[id];
        x[id] = false;
    } else {
        console.log(`Adding ${id} to blacklist`);
        x[id] = true;
        BLOCKLIST[id] = true;
    }
    await setState("blocklist", Object.keys(BLOCKLIST));
    var resp = await fetchWs(new WebSocketPacket(EXTERNAL.UPDATE_IGNORED_VIDEOS, x));
    var port = PORTS[tab.id];
    console.log(port || PORTS);
    port.postMessage({type: "alert", data: `Video ` + (x[id] ? "has been" : "is no longer") + " blacklisted"});
});
chrome.runtime.onInstalled.addListener(function() {
    console.log("Installed!");
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
    checkToken().then(() => {
        console.log("Token checked.");
    })
})

async function setToken(token) {
    var response = await fetch(`${CONFIG.api}/user`, {
        headers: {
            "X-API-KEY": token
        }
    });
    if(!response.ok) {
        INFO.name = null;
        INFO.id = null;
        return false;
    }
    var j = await response.json();
    INFO.token = token;
    INFO.name = j.name;
    INFO.id = j.id;
    INFO.warnedNoToken = false;

    await sync();
    return true;
}

// These will be reset each time the service worker restarts.

var CACHE = null;

var INFO = null;
var CONFIG = null;
var WS = null;
var BLOCKLIST = null;
var SEQUENCE = 1;
var WS_CALLBACK = {};
var PORTS = {};
var PENDING_QUEUE = []; // requests to be processed after we reconnect
var PENDING_INTERVAL = null;
var PENDING_RETRIES = 0;

var WS_PROMISE = null;

async function execScript(tab, fileName) {
    if(chrome.scripting && chrome.scripting.executeScript) {
        console.log("Executing using new scripting method: ", tab);
        return await chrome.scripting.executeScript({
            files: [fileName],
            target: {
                tabId: tab.id
            }
        });
    } else {
        console.log("Executing script using old tabs method: ", tab);
        return await chrome.tabs.executeScript(tab.id, {
            file: fileName
        });
    }
}

async function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, ms);
    })
}

async function checkToken() {
    await init();
    if(!INFO.token && !INFO.warnedNoToken) {
        INFO.warnedNoToken = true;
        console.log("No token! Opening website to try and get one..");
        chrome.tabs.create({
            active: true,
            url: CONFIG.api.replace("/api", "")
        }, (tab) => {
            console.log("Opened, listening for load");
            chrome.tabs.onUpdated.addListener(function cb(tabId, changeInfo, newTab)  {
                if(tabId !== tab.id) return;
                console.log(tabId, changeInfo, newTab);
                if(newTab.url && newTab.status === "complete") {
                    chrome.tabs.onUpdated.removeListener(cb);
                    execScript(newTab, "scripts/inject_tab.js").then((r) => {
                        console.log("Injection result: ", r);
                    });
                }
            });
        });
        await setState("info", INFO);
    }
}

async function checkPending() {
    if(PENDING_QUEUE.length === 0) {
        console.log("Pending queue is empty, ceasing interval.");
        clearInterval(PENDING_INTERVAL)
    } else if(WS === null) {
        console.log("WS is null, init");
        initWs();
    } else if(WS_PROMISE.isResolved) {
        // WS has connected and initial packet is received
        console.log(`WS has connected, handling ${PENDING_QUEUE.length} pending`);
        PENDING_RETRIES = 0;
        clearInterval(PENDING_INTERVAL);
        while(PENDING_QUEUE.length > 0) {
            var deferred = PENDING_QUEUE.splice(0, 1)[0];
            console.log("WS pending: ", deferred);
            try {
                await handleMessageWithWs(deferred.message, deferred.sender, deferred.reply);
                console.log("Handled packet.")
            } catch(err) {
                console.log("Errored processing packet ", err);
                PENDING_QUEUE.push(deferred);
                await disconnectWs();
                setInterval(checkPending, 1000);
                throw err;
            }
        }
    } else if (WS.readyState === 3) {
        // WS is closed. 
        var min = 1000 + Math.pow(2, PENDING_RETRIES);
        var diff = Date.now() - WS.started;
        if(diff > min) {
            console.log("WS is closed, retrying connection", PENDING_RETRIES)
            PENDING_RETRIES += 1;
            initWs();
        }
    }
}

async function init() {
    if(INFO === null) {
        INFO = await getState("info") || {
            token: null, 
            id: null,
            name: null,
            warnedNoToken: false
        };
    }
    if(CONFIG === null) {
        CONFIG = await getState("config") || {
            api: null 
        };
        var dirty = false;
        if(!CONFIG.api || CONFIG.api.indexOf('ml-api.uk.ms') >= 0) {
            CONFIG.api = "https://mlapi.cheale14.com/api/tracker";
            dirty = true;
        }
        if(!CONFIG.ws || CONFIG.ws.indexOf('ml-api.uk.ms') >= 0) {
            if(CONFIG.api.startsWith("https://")) {
                CONFIG.ws = "wss://mlapi.cheale14.com/wss/time-tracker"
            } else {
                CONFIG.ws = "ws://localhost:4650/time-tracker"
            }
            dirty = true;
        }

        if(dirty) {
            await setState("config", CONFIG);
        }
    }
    if(CACHE == null) {
        var saved = await getState("cache") || [];
        CACHE = new TrackerCache();
        CACHE.Load(saved);
        CACHE.dirty = false; // we've just loaded it from storage, it can't be dirty.
        console.log("Loaded cache: ", CACHE);
    }
    if(WS == null || WS.readyState === 3) {
        console.logws = (...data) => {
            console.log("[WS] ", ...data);
        }
        if(INFO.token)
            initWs();
    }
    if(BLOCKLIST == null) {
        BLOCKLIST = {};
        var arr = await getState("blocklist") || [];
        for(var item of arr) {
            BLOCKLIST[item] = true;
        }
    }
}
function initWs() {
    WS_PROMISE = new DeferredPromise(null);
    if(WS) {
        try{
            WS.close();
        } finally {
            WS = null;
        }
    }
    var since = "";
    if(CACHE && CACHE.timestamp) {
        since = `&since=${CACHE.timestamp}`;
    }


    WS = new WebSocket(`${CONFIG.ws}?api-key=${INFO.token}&v=${API_VERSION}${since}`);
    WS.started = Date.now();
    WS.onopen = wsOpen;
    WS.onclose = wsClose;
    WS.onmessage = wsMessage;
    WS.onerror = wsError;
}
async function sync() {
    await setState("info", INFO);
    await setState("config", CONFIG);
    await setState("cache", CACHE.Save());
}
async function broadcastMessage(message) {
    for (const [id, port] of Object.entries(PORTS)) {
        port.postMessage(message);
    }
}
async function handleMessage(message, sender, reply) {
    console.log(id(sender), " << ", message);
    await init();
    if(message.type === "getData") {
        reply({type: "sendConfig", data: CONFIG});
    } else if (message.type === "setToken") {
        var resp = await setToken(message.data);

        reply({type: "sendInfo", data: INFO});
        return;
    } else if(message.type === "updateConfig") {
        for(let key in message.data) {
            CONFIG[key] = message.data[key];
            await sync();
        }
        return;
    }

    if(!INFO.token) {
        reply({error: true, message: "No token has been provided"});
        return;
    }

    if(message.type === INTERNAL.NAVIGATE_ID) {
        chrome.tabs.create({
            url: `https://youtube.com/watch?v=${encodeURIComponent(message.data)}`
        });
    } else {
        await handleMessageWithWs(message, sender, reply);
    }
}

async function handleMessageWithWs(message, sender, reply) {
    if(WS === null || WS.readyState !== 1) { // null or not OPEN
        // defer processing this request to later.
        console.log("WS is not connected, deferring", message);
        if(message.type === INTERNAL.SET_WATCHING) {
            // cannot be deferred.
            reply(new NoResponsePacket("instant"));
        } else {
            var def = new DeferredInternalRequest(message, sender, reply);
            PENDING_QUEUE.push(def);
    
            if(PENDING_INTERVAL === null) {
                PENDING_INTERVAL = setInterval(checkPending, 1000);
            }
        }

        return;
    }


    if(message.type === "getLatest") {
        var latest = await fetchWs(new WebSocketPacket(EXTERNAL.GET_LATEST, null));
        console.log("Latest: ", latest);
        reply(new InternalPacket(INTERNAL.SEND_LATEST, latest.content));
    } else if (message.type === INTERNAL.GET_TIMES) {
        var result = await getTimes(message.data);
        reply(new InternalPacket(INTERNAL.GOT_TIMES, result));
    } else if(message.type === INTERNAL.SET_WATCHING) {
        var result = await fetchWs(new WebSocketPacket(EXTERNAL.GET_TIMES, [message.data]));
        reply(new InternalPacket(INTERNAL.GOT_TIMES, result.content));
    } else if(message.type === "setTime") {
        for(let key in message.data) {
            var c = new YoutubeCacheItem(key, Date.now(), message.data[key]);
            CACHE.Insert(c);
        }
        var result = await fetchWs(new WebSocketPacket(EXTERNAL.SET_TIMES, message.data));
        reply(new InternalPacket("savedTime", message.data));
    } else if(message.type === INTERNAL.GET_REDDIT_COUNT) {
        var result = await getThreadCounts(message.data);
        var p = new InternalPacket("response", result);
        p.res = message.seq;
        reply(p);
    } else if(message.type === INTERNAL.REDDIT_VISITED) {
        if(!message.data.id) {
            console.warn("Received null thread ID, not handling.");
            return;
        }
        var existing = CACHE.Fetch(message.data.id);
        if(!existing) {
            console.debug(`No cache for visited thread ${message.data.id}, creating`)
            existing = new RedditCacheItem(message.data.id, 0, [], 0);
        }
        existing.cachedAt = Date.now();
        let new_entry = {
            t: Date.now(),
            c: message.data.count
        };
        existing.visits.push(new_entry);
        CACHE.Insert(existing);
        await setState("cache", CACHE.Save());
        var rep = await fetchWs(new WebSocketPacket(EXTERNAL.VISITED_THREAD, message.data));
        var p = new InternalPacket("response", rep);
        p.res = message.seq;
        reply(p);
    } else if (message.type === INTERNAL.CLEAR_CACHE) {
        CACHE.Clear();
        await setState("cache", CACHE.Save());
        var p = new InternalPacket("response", null)
        p.res = message.seq;
        reply(p);
    } else {
        console.warn("Unknown internal message type:", message);
    }
}

async function getThreadCounts(idArray) {
    var result = {};
    var mustfetch = [];
    for(let id of idArray) {
        var cached = CACHE.Fetch(id);
        if(cached) {
            result[id] = cached;
        } else {
            mustfetch.push(id);
            result[id] = new RedditCacheItem(id, Date.now(), [], -1); // set something as default
        }
    }
    if(mustfetch.length > 0) {
        var wsResponse = await fetchWs(new WebSocketPacket(EXTERNAL.GET_THREADS, mustfetch));
        for(let id in wsResponse.content) {
            var data = wsResponse.content[id];
            var item = new RedditCacheItem(id, Date.now(), data.when);
            CACHE.Add(item);
            result[id] = item;
        }
    }
    console.log("CACHE: ", CACHE);
    if(CACHE.dirty) {
        await setState("cache", CACHE.Save());
    }
    return result;
}

async function getTimes(idArray) {
    var result = {};
    var mustfetch = [];
    for(let id of idArray) {
        var cached = CACHE.Fetch(id);
        if(cached) {
            result[id] = cached.t;
        } else {
            mustfetch.push(id);
            result[id] = 0; // default to zero: not watched yet.
        }
    }
    if(mustfetch.length > 0) {
        var wsResponse = await fetchWs(new WebSocketPacket(EXTERNAL.GET_TIMES, mustfetch));
        for(let id in wsResponse.content) {
            var time = wsResponse.content[id];
            var item = new YoutubeCacheItem(id, Date.now(), time);
            CACHE.Add(item);
            result[id] = time;
        }
    }
    console.log("CACHE: ", CACHE);
    if(CACHE.dirty) {
        await setState("cache", CACHE.Save());
    }
    return result;
}
async function disconnectWs() {
    try {
        WS.close();
    } finally {
        WS = null;
        broadcastMessage(new InternalPacket("disconnected", {}));
    }
}
async function wsOpen(event) {
    console.logws("[OPEN] ", event);
}
async function wsClose(event) {
    console.logws("[CLOSE] ", event);
    if(!WS_PROMISE.isResolved) WS_PROMISE.reject(event);
}
async function wsError(err) {
    console.logws("[ERR] ", err);
}
async function wsMessage(event) {
    timeouts = 0;
    const packet = JSON.parse(event.data);
    console.logws("[<<] ", packet);

    if(packet.res !== undefined) {
        var prom = WS_CALLBACK[packet.res];
        if(prom) {
            prom.resolve(packet);
            delete WS_CALLBACK[packet.res];
        } else {
            console.logws("Unknown packet response ", packet.res);
        }

        return;
    }

    if(packet.id === EXTERNAL.UPDATE_IGNORED_VIDEOS) {
        await setState("blocklist", Object.keys(packet.content));
        if(!WS_PROMISE.isResolved) WS_PROMISE.resolve();
    } else if(packet.id === EXTERNAL.GET_TIMES) {
        // catchup times on initial connection
        for(let id in packet.content) {
            var time = packet.content[id];
            var item = new YoutubeCacheItem(id, Date.now(), time, 3600); // cache these for an hour
            CACHE.Add(item);
        }
        if(CACHE.dirty) {
            await setState("cache", CACHE.Save());
        }
    } else if(packet.id === EXTERNAL.GET_THREADS) {
        // similarly, catchup with threads.
        for(let id in packet.content) {
            var data = packet.content[id];
            var item = new RedditCacheItem(id, Date.now(), data.when);
            CACHE.Add(item);
        }
        if(CACHE.dirty) {
            await setState("cache", CACHE.Save());
        }
    }
}

var timeouts = 0;
async function fetchWs(packet) {
    packet.seq = SEQUENCE++;

    if(timeouts > 3) {
        console.log("Too many timeouts have occured on previous packets. We will attempt a reconnect..");
        await disconnectWs();
    }

    if(!WS) {
        console.log("WS is closed, starting reconnection before sending packet..");
        await initWs();
    }

    var retries = 0;
    while(retries < 3 && retries !== -1)  {
        try {
            await WS_PROMISE.promise; // ensure the WS is open.
            retries = -1;
        } catch(err) {
            retries += 1;
            console.error(err);
            await sleep(retries * 1000);
            initWs();
        }
    }
    if(retries > -1) {
        throw new Error("Failed to send web socket packet: could not open connection");
    }

    var prom = new DeferredPromise(30000) // timeout in ms
    WS_CALLBACK[packet.seq] = prom;

    console.logws("[>>] ", packet);
    WS.send(JSON.stringify(packet));

    try {
        var rtn = await prom.promise;
        timeouts = 0;
        return rtn;
    } catch(err) {
        if(err === "Timed out") {
            timeouts += 1;


            throw err;
        }
    }
}

