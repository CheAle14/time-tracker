chrome.browserAction.onClicked.addListener(function(tab) {
    chrome.tabs.create({url: "popup.html"})
});

console.log("Background started");
var INFO = {};
var TAB = null;
var URL = "https://ml-api.uk.ms/api/tracker";
var CACHE = {};
var GET_QUEUE = [];
var SET_QUEUE = {}

function id(_tab) {
    return `${_tab.sender.tab.id} @ ${_tab.sender.url}`;
}

chrome.runtime.onConnect.addListener(function(thing) {
    thing.id = function() {
        return id(this);
    }
    if(TAB) {
        try {
            TAB.onMessage.removeListener(onMessage);
        } catch{}
        try {
            TAB.disconnect();
        } catch {}
        console.log(`Disconnecting ${id(TAB)}`);
    }
    if(INFO.name === null) {
        thing.postMessage({type: "error", data: "Connection was not established to server. Retrying - reload page in a bit"});
        thing.disconnect();
        setup();
        console.log(`Refused connection from ${thing.id()} due to invalid startup`)
        return;
    }
    console.log(`Connecting to ${thing.id()}`);
    thing.onMessage.addListener(onMessage);
    thing.onDisconnect.addListener(function(tab) {
        console.log(`Disconnected from ${id(tab)}`);
        if(id(tab) === id(TAB)) {
            TAB = null;
            clearInterval(processQueues);
        }
        
    });
    thing.postMessage({type: "sendInfo", data: INFO});
    TAB = thing;
    setInterval(processQueues, 5000);
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
            CACHE[vId] = {"t": vId, "w": Date.now()};
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
        if(rText) {
            INFO.name = rText.name;
            INFO.id = rText.id;
        } else {
            INFO.name = null;
            INFO.id = null;
        }
        console.log(`Loaded token, logged in as ${INFO.name}`);
        if(TAB)
            TAB.postMessage({type: "sendInfo", data: INFO});
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

function processQueues() {
    if(TAB === null)
        return;
    if(GET_QUEUE.length > 0) {
        var q = GET_QUEUE;
        GET_QUEUE = [];
        getTimes(q).then(function(times) {
            console.log("Gotten times! Sending...");
            TAB.postMessage({"type": "gotTimes", data: times});
        });
    }
    if(getObjectLength(SET_QUEUE) > 0) {
        var q = SET_QUEUE;
        SET_QUEUE = {}
        setTimes(q).then(function(saved) {
            TAB.postMessage({type: "savedTime", data: saved});
        });
    }
}

async function setup() {
    chrome.storage.local.get(["token"], async function(result) {
        await setToken(result.token);
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