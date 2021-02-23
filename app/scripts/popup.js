
var text = document.getElementById("text");
var inp = document.getElementById("tokenI");
var btn = document.getElementById("buttonI");
btn.onclick = submit;
btn.disabled = true;
var port = chrome.runtime.connect();
port.onMessage.addListener(function(message, sender, response) {
    console.log(message);
    if(message.type === "sendInfo") {
        text.innerText = "Set token below";
        if(message.data.token) {
            text.innerText = text.innerText.replace("Set", "Update");
            inp.value = message.data.token;
        }
        if(message.data.name) {
            text.innerText = "Logged in as " + message.data.name;
        }
        btn.disabled = false;
    } else if(message.type === "sendData") {
        setTabs(message.data);
    }
});
function pad(value, length) {
    return (value.toString().length < length) ? pad("0"+value, length):value;
}
function toTime(diff) {
    var hours = Math.floor(diff / (60 * 60));
    diff -= hours * (60 * 60);
    var mins = Math.floor(diff / (60));
    diff -= mins * (60);
    var seconds = Math.floor(diff);
    if(hours === 0) {
        return `${pad(mins, 2)}:${pad(seconds, 2)}`;
    } else {
        return `${pad(hours, 2)}:${pad(mins, 2)}:${pad(seconds, 2)}`;
    }
}
function submit() {
    console.log("Sending!")
    port.postMessage({type: "setToken", data: inp.value});
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
        anchor.onclick = thing;
        elem.appendChild(anchor);
        var txt = document.createElement("span");
        if(vid) {
            var time = data.cache[vid];
            txt.innerText = time ? ` watching ${vid} @ ${toTime(time.t)}` : ` watching ${vid}`;
        } else if(port.sender.url.startsWith("chrome-extension://")) {
            txt.innerText = " looking at popup page";
        } else {
            txt.innerText = ` on ${port.sender.url}`;
        }
        elem.appendChild(txt);
        ls.appendChild(elem);
    }
}

function thing(event) {
    const portId = parseInt(this.innerText);
    port.postMessage({type: "highlightTab", data: portId});
}

setInterval(function() {
    port.postMessage({type: "getData"});
}, 5000);
port.postMessage({type: "getData"});
