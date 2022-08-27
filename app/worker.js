console.log("Loaded worker.");
import {DeferredPromise, EXTERNAL, INTERNAL, InternalPacket, TrackerCache, WebSocketPacket, YoutubeCacheItem} from "./scripts/classes.js";

// DONE: setup websocket connection 
// DONE: setup popup page get information. (DONE, except for other tab info)
// IGNORE: setup get queue. 
// IGNORE: setup set queue. 
// DONE: setup message passing for the above get and set stuff. 

// TODO: blocklist video context menu
// TODO: reddit

const API_VERSION = 2;

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

chrome.runtime.onMessage.addListener((message, sender, reply) => {
    handleMessage(message, sender, (data) => {
        console.log(`[${id(sender)}] R>> `, data);
        reply(data);
    }).then(() => {
    });
    
    return true;
});
function id(_tab) {
    return _tab.sender.tab ? _tab.sender.tab.id : 0;
}
function getName(_tab) {
    return _tab.sender.tab ? `${id(_tab)} @ ${_tab.sender.url}` : "popup @ " + _tab.sender.url;
}
chrome.runtime.onConnect.addListener(function(port) {
    console.log("[CONNECT] ", port);
    port.id = id(port);
    port.name = getName(port);

    port.onMessage.addListener((msg) => {
        handleMessage(msg, port, (data) => {
            console.log(`[${port.id}] >> `, data);
            var x = port.postMessage(data);
            if(data.error) port.disconnect();
            return x;
        }).then(() => {

        });
        return true;
    })
    init().then(() => {
        port.postMessage({type: "sendInfo", data: INFO});
        port.postMessage({type: "blocklist", data: BLOCKLIST});
    })
});

chrome.storage.onChanged.addListener(function (changes, namespace) {
    for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
        console.log(
        `Storage key "${key}" in namespace "${namespace}" changed.`,
        `Old value was "${oldValue}", new value is "${newValue}".`
        );
        if(key === "blocklist") {
            BLOCKLIST = {};
            for(var item of newValue) {
                console.log(item);
                BLOCKLIST[item] = true;
            }
        }
    }
  });

chrome.action.onClicked.addListener(function() {
    chrome.tabs.create({url: 'popup.html'});
});

async function setToken(token) {
    var response = await fetch(`${CONFIG.api}/user`, {
        headers: {
            "X-API-KEY": token
        }
    });
    if(!response.ok) {
        return false;
    }
    var j = await response.json();
    INFO.token = token;
    INFO.name = j.name;
    INFO.id = j.id;

    await sync();
    return true;
}

// These will be reset each time the service worker restarts.

var CACHE = null;

var INFO = null;
var CONFIG = null;
var WS = null;
var BLOCKLIST = {};
var SEQUENCE = 1;
var WS_CALLBACK = {};

var WS_PROMISE = null;


async function init() {
    if(INFO === null) {
        INFO = await getState("info") || {
            token: null, 
            id: null,
            name: null
        };
    }
    if(CONFIG === null) {
        CONFIG = await getState("config") || {
            api: null 
        };
        var dirty = false;
        if(!CONFIG.api) {
            CONFIG.api = "https://ml-api.uk.ms/api/tracker";
            dirty = true;
        }
        if(!CONFIG.ws) {
            if(CONFIG.api.startsWith("https://")) {
                CONFIG.ws = "wss://ml-api.uk.ms/time-tracker"
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
        var saved = await getState("cache") || {};
        CACHE = new TrackerCache();
        CACHE.Load(saved);
        console.log("Loaded cache: ", CACHE);
    }
    if(WS == null) {
        console.logws = (...data) => {
            console.log("[WS] ", ...data);
        }
        initWs();
    }
    if(BLOCKLIST == null) {
        var arr = await getState("blocklist") || [];
        for(item in arr) {
            BLOCKLIST[item] = true;
        }
    }
}
function initWs() {
    WS_PROMISE = new DeferredPromise(null);
    WS = new WebSocket(`${CONFIG.ws}?api-key=${INFO.token}&v=${API_VERSION}`);
    WS.onopen = wsOpen;
    WS.onclose = wsClose;
    WS.onmessage = wsMessage;
    WS.onerror = wsError;
}
async function sync() {
    await setState("info", INFO);
    await setState("config", CONFIG);
}
async function handleMessage(message, sender, reply) {
    console.log(id(sender), " << ", message);
    await init();
    if(message.type === "getData") {
        return;
    } else if (message.type === "setToken") {
        var resp = await setToken(message.data);
        reply({type: "sendInfo", data: INFO});
        return;
    }

    if(!INFO.token) {
        reply({error: true, message: "No token has been provided"});
        return;
    }

    if(message.type === "getLatest") {
        var latest = await fetchWs(new WebSocketPacket(EXTERNAL.GET_LATEST, null));
        console.log("Latest: ", latest);
        reply(new InternalPacket(INTERNAL.SEND_LATEST, latest.content));
    } else if (message.type === INTERNAL.GET_TIMES) {
        var result = await getTimes(message.data);
        reply(new InternalPacket(INTERNAL.GOT_TIMES, result));
    } else if(message.type === "setWatching") {
        var result = await fetchWs(new WebSocketPacket(EXTERNAL.GET_TIMES, [message.data]));
        reply(new InternalPacket(INTERNAL.GOT_TIMES, result.content));
    } else if(message.type === "setTime") {
        var result = await fetchWs(new WebSocketPacket(EXTERNAL.SET_TIMES, message.data));
        reply(new InternalPacket("savedTime", message.data));
    }
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
    return result;
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
    const packet = JSON.parse(event.data);
    console.logws("[<<] ", packet);

    if(packet.res) {
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
    }
}

async function fetchWs(packet) {
    packet.seq = SEQUENCE++;
    var retries = 0;
    while(retries < 3 && retries !== -1)  {
        try {
            await WS_PROMISE.promise; // ensure the WS is open.
            retries = -1;
        } catch(err) {
            retries += 1;
            console.error(err);
            initWs();
        }
    }
    if(retries > -1) {
        throw new Error("Failed to send web socket packet.");
    }

    var prom = new DeferredPromise(30000) // timeout in ms
    WS_CALLBACK[packet.seq] = prom;

    console.logws("[>>] ", packet);
    WS.send(JSON.stringify(packet));

    return await prom.promise;
}


