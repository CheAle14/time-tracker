console.log("Loaded popup.js");
import {INTERNAL, InternalPacket, HELPERS} from "./classes.js"

var text = document.getElementById("text");
var inp = document.getElementById("tokenI");
var btn = document.getElementById("buttonI");
btn.onclick = submit;
btn.disabled = true;
var port = chrome.runtime.connect();
port.onMessage.addListener(function(message, sender, response) {
    console.log("[INT] << ", message);
    if(message.type === "sendInfo") {
        text.innerText = "Set token below";
        if(message.data.token) {
            text.innerText = text.innerText.replace("Set", "Update");
            inp.value = message.data.token;
        }
        if(message.data.name) {
            text.innerText = "Logged in as " + message.data.name;
            postMessage(new InternalPacket("getLatest", null));
        }
        btn.disabled = false;
    } else if(message.type === "sendData") {
        setTabs(message.data);
    } else if(message.type === INTERNAL.SEND_LATEST) {
        setLatest(message.data);
    } else if(message.type == "blocklist") {
        setBlacklist(message.data);
    }
});
function postMessage(packet) {
    console.debug("[INT] >> ", packet);
    port.postMessage(packet);
}
function pad(value, length) {
    return (value.toString().length < length) ? pad("0"+value, length):value;
}

function submit() {
    console.log("Sending!")
    postMessage({type: "setToken", data: inp.value});
}
function setTabs(data) {
    var ls = document.getElementById("ctabs");
    ls.innerHTML = "";
    for(const portId in data.ports) {
        const port = data.ports[portId];
        const vid = data.watching[portId];
        var elem = document.createElement("li");        
        var anchor = document.createElement("a");
        anchor.href = "#";
        anchor.innerText = `${portId}`;
        anchor.onclick = navigateToPort;
        elem.appendChild(anchor);
        var txt = document.createElement("span");
        if(vid) {
            var time = data.cache[vid];
            txt.innerText = time ? ` watching ${vid} @ ${HELPERS.ToTime(time.t)}` : ` watching ${vid}`;
        } else if(port.sender.url.startsWith("chrome-extension://")) {
            txt.innerText = " looking at popup page";
        } else {
            txt.innerText = ` on ${port.sender.url}`;
        }
        elem.appendChild(txt);
        ls.appendChild(elem);
    }
}
function setBlacklist(data) {
    var ls = document.getElementById("vignored");
    ls.innerHTML = "";
    for(const vidId in data) {
        var elem = document.createElement("li");
        var anchor = document.createElement("a");
        anchor.setAttribute("mlapi-id", vidId);
        anchor.href = "#";
        elem.appendChild(anchor);
        anchor.innerText = `${vidId}`;
        anchor.onclick = openNewId;
        ls.appendChild(elem);
    }
}
function setLatest(data) {
    var ls = document.getElementById("lWatched");
    ls.innerHTML = "";
    for(const vidId in data) {
        var vidData = data[vidId];
        var elem = document.createElement("li");
        var anchor = document.createElement("a");
        anchor.setAttribute("mlapi-id", vidId)
        anchor.href = "#";
        elem.appendChild(anchor);
        if(vidData.title) {
            anchor.innerText = vidData.title;
            var aa = document.createElement("span");
            aa.innerText = ` by ${vidData.author}`;
            elem.appendChild(aa);
        } else {
            anchor.innerText = `${vidId}`;
        }
        anchor.onclick = openNewId;
        var txt = document.createElement("span");
        var when = "";
        var diff = Date.now() - vidData.when;
        diff = diff / 1000; // convert ms -> s;
        if(diff > (3600 * 24)) {
            var d = new Date(vidData.when);
            console.log(d);
            when = `on ${d.toLocaleDateString()}`;
        } else {
            var hours = Math.floor(diff / 3600);
            diff -= (hours * 3600);
            var minutes = Math.floor(diff / 60);
            diff -= (minutes * 60);
            if(hours > 0)
                when = `${hours}h`;
            if(minutes > 0)
                when += `${minutes}m`;
            diff = Math.floor(diff);
            if(diff > 0 || when === "")
                when += `${diff}s`;
            when += " ago";
        }
        txt.innerText = ` @ ${HELPERS.ToTime(vidData.saved)}; ${when}`;
        elem.appendChild(txt);
        ls.appendChild(elem);
    }
}

function openNewId(event) {
    const vidId = this.getAttribute("mlapi-id");
    postMessage(new InternalPacket(INTERNAL.NAVIGATE_ID, vidId));
}

function navigateToPort(event) {
    const portId = parseInt(this.innerText);
    postMessage(new InternalPacket("highlightTab", portId));
}

postMessage({type: "getData"});
