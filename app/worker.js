console.log("Loaded worker.");
import {InternalPacket} from "./scripts/classes.js";

// TODO: setup websocket connection
// TODO: setup popup page get information.
// TODO: setup get queue.
// TODO: setup set queue.
// TODO: setup message passing for the above get and set stuff.


function getState(key) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(key, (items) => {
            if (chrome.runtime.lastError) {
              return reject(chrome.runtime.lastError);
            }
            for(let key in items) {
                items[key] = deserialise(items[key]);
            }
            if(typeof key === "string") {
                items = items[key];
            }
            console.log("GET: ", key, " = ", items);
            resolve(items);
          });
    })
}
function serialise(obj) {
    if(typeof obj === "object") {
        return "json:" + JSON.stringify(obj);
    } else {
        return obj;
    }
}
function deserialise(obj) {
    if(typeof obj === "string") {
        if(obj.startsWith("json:")) {
            return JSON.parse(obj.substring("json:".length));
        }
    }
    return obj;
}
function setState(key, value) {
    return new Promise((resolve, reject) => {
        value = serialise(value);
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
    handleMessage(message, sender, reply).then(() => {
    });
    
    return true;
});

chrome.runtime.onConnect.addListener(function(port) {
    console.log("[CONNECT] ", port);

    port.onMessage.addListener((msg) => {
        handleMessage(msg, port, (data) => {
            var x = port.postMessage(data);
            if(data.error) port.disconnect();
            return x;
        }).then(() => {

        });
        return true;
    })
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

var INFO = null;
var CONFIG = null;
async function init() {
    if(INFO === null) {
        INFO = {
            token: null, 
            id: null,
            name: null
        };
        INFO = await getState("info");
    }
    if(CONFIG === null) {
        CONFIG = {
            api: null 
        };
        CONFIG = await getState("config");
        if(!CONFIG.api) {
            CONFIG.api = "https://ml-api.uk.ms/api/tracker";
            await setState("config", CONFIG);
        }
    }
}
async function sync() {
    await setState("info", INFO);
    await setState("config", CONFIG);
}
async function handleMessage(message, sender, reply) {
    console.log(sender, message);
    await init();
    if(message.type === "getData") {
        reply({type: "sendInfo", data: INFO});
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
}

var WS = null;

