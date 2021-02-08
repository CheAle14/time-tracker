chrome.browserAction.onClicked.addListener(function(tab) {
    chrome.tabs.create({url: "popup.html"})
});

console.log("Background started");
var INFO = {}
var TAB = null;

chrome.runtime.onConnect.addListener(function(thing) {
    if(TAB) {
        TAB.postMessage({type: "disconnect", data: "New connection established"});
        TAB.onMessage.removeListener(onMessage);
        console.log(`Disconnecting ${TAB.sender.tab.title}`);
    }
    TAB = thing;
    console.log(`Connecting to ${TAB.sender.tab.title}`);
    TAB.onMessage.addListener(onMessage);
    thing.postMessage({type: "sendInfo", data: INFO});
});
chrome.runtime.onMessage.addListener(onMessage);

function onMessage(message, sender, response) {
    console.log(message);
    if(message.type === "setToken") {
        setToken(message.data);
    }
}

async function setToken(token) {
    INFO.token = token;
    var response = await fetch("http://127.0.0.1:8887/authed/user", {
        headers: {
            "X-SESSION": INFO.token
        }
    });
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
}

async function setup() {
    chrome.storage.local.get(["token"], async function(result) {
        await setToken(result.token);
    });
}
setup();