console.warn("Content script loaded!")
var port = chrome.runtime.connect();
var CONNECTED = true;
var LOADED = false;
var HALTED = false;

var fetchingToast = null;
var watchingToast = null;

console.log("Connected to port");
port.onMessage.addListener(function(message, sender, response) {
    console.log(message);
    if(message.type === "gotTimes") {
        for(let a in message.data) {
            CACHE[a] = message.data[a];
        }
        setTimes();
    } else if (message.type === "error") {
        console.error(message.data);
        HALTED = true;
    } else if(message.type === "savedTime" && HALTED === false) {
        for(let id in message.data) {
            if(id === WATCHING) {
                console.log(`Saved up to ${message.data[id]}`);
                getVideoTxt().innerText = toTime(message.data[id]);
            }
        }
    } else if(message.type === "stop") {
        LOADED = true;
        HALTED = true;
        console.warn(`Stopping video playback due to instruction: ${message.data.log}`);
        try {
            pause();
            var txt = getVideoTxt();
            txt.innerText = "Halted: " + message.data.display;
            txt.style.color = "red";
        } catch {}
    } else if(message.type === "update") {
        Toastify({
            text: `Update available: ${message.data}; click to go to github`,
            duration: -1,
            close: true,
            gravity: "top", // `top` or `bottom`
            position: "right", // `left`, `center` or `right`
            backgroundColor: "red",
            stopOnFocus: true, // Prevents dismissing of toast on hover
            onClick: function() {
                window.location.href = "https://github.com/CheAle14/time-tracker/releases/latest";
            }
        }).showToast();
    }
});
port.onDisconnect.addListener(function() {
    console.warn("Disconnected from port.");
    CONNECTED = false;
    if(getVideo()) {
        pause();
        getVideoTxt().innerText = "!! Disconnected !!";
    }
    Toastify({
        text: "Disconnected from backend server - syncing cannot occur; video paused",
        duration: -1,
        close: true,
        gravity: "top", // `top` or `bottom`
        position: "right", // `left`, `center` or `right`
        backgroundColor: "red",
        stopOnFocus: true, // Prevents dismissing of toast on hover
    }).showToast();
})
const CACHE = {}
var WATCHING = null;
console.log(window.location);
var IS_MOBILE = window.location.hostname.startsWith("m.");

function getTxtContainer() {
    if(IS_MOBILE) {
        return document.getElementsByClassName("time-display-content cbox")[0];
    } else {
        return document.getElementsByClassName("ytp-time-display notranslate")[0];
    }
}

function getVideoTxt() {
    var txt = document.getElementById("mlapi-time-display");
    if(txt)
        return txt;
    var container = getTxtContainer();
    if(container === null || container === undefined) {
        txt = document.createElement("span");
        return txt; // temp var for now.
    }
    var sep = document.createElement("span");
    sep.classList.add(IS_MOBILE ? "time-delimiter" : "ytp-time-separator");
    sep.innerText = " -- ";
    container.appendChild(sep);
    txt = document.createElement("span");
    txt.id = "mlapi-time-display";
    txt.classList.add(IS_MOBILE ? "time-second" : "ytp-time-current");
    container.appendChild(txt);
    return txt;
}

function getId(url) {
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
function parseToSeconds(text) {
    var split = `${text}`.split(":");
    var hours = 0;
    var mins = 0;
    var secs = 0;
    if(split.length === 3) {
        hours = parseInt(split[0]);
        mins = parseInt(split[1]);
        secs = parseInt(split[2]);
    } else if(split.length === 2) {
        mins = parseInt(split[0]);
        secs = parseInt(split[1]);
    } else {
        secs = parseInt(split[0]);
    }
    return (hours * 60 * 60) + (mins * 60) + secs;
}

function getThumbnails() {
    if(IS_MOBILE) {
        return document.getElementsByTagName("ytm-thumbnail-overlay-time-status-renderer");
    } else {
        return document.getElementsByClassName("style-scope ytd-thumbnail-overlay-time-status-renderer");
    }
}

function getVideo() {
    if(IS_MOBILE) 
        return document.getElementsByClassName("video-stream html5-main-video")[0];
    else
        return document.getElementsByClassName("video-stream html5-main-video")[0];
}

function setThumbnails() {
    //console.log(CACHE);
    var mustFetch = []
    var thumbNails = getThumbnails();
    for(const i in thumbNails) {
        var element = thumbNails[i];
        if(IS_MOBILE) {
            if(element.nodeName !== "YTM-THUMBNAIL-OVERLAY-TIME-STATUS-RENDERER") {
                continue;
            }
        } else {
            if(element.nodeName !== "SPAN")
                continue;
        }
        var state = element.getAttribute("mlapi-done") || "unfetched";
        if(state === "fetched")
            continue;
        var anchor = element.parentElement.parentElement.parentElement;
        var id = getId(anchor.href);
        if(id) {
            if(id in CACHE) {
                var time = CACHE[id];
                var vidLength = parseToSeconds(element.innerText);
                var perc = time / vidLength;
                if(perc >= 0.9) {
                    element.innerText = "✔️ " + element.innerText;
                    element.style.color = "green";
                    if(IS_MOBILE)
                        element.style.backgroundColor = "white";
                } else if(perc > 0) {
                    var remaining = vidLength - time;
                    element.innerText = toTime(remaining);
                    element.style.color = "orange";
                    if(IS_MOBILE)
                        element.style.backgroundColor = "blue";
                }
                CACHE[id] = time;
                element.setAttribute("mlapi-done", "fetched")
            } else {
                if(state === "fetching") {
                } else {
                    element.setAttribute("mlapi-done", "fetching");
                    mustFetch.push(id);
                }
            }
        }
    }
    return mustFetch;
}

function setTimes() {
    var mustFetch = setThumbnails();

    if(WATCHING !== null && LOADED === false) {
        var data = CACHE[WATCHING];
        if(data !== null && data !== undefined) {
            getVideo().currentTime = data;
            getVideoTxt().innerText = toTime(data);
            LOADED = true;
            if(fetchingToast) {
                fetchingToast.hideToast();
                fetchingToast = null;
            }
            if(watchingToast) {
                watchingToast.hideToast();
                watchingToast = null;
            }
            if(getVideo().paused)
                play();
        }
    }

    if(mustFetch.length > 0) {
        port.postMessage({type: "getTimes", data: mustFetch});
        if(fetchingToast) {
            fetchingToast.toastElement.innerText = `Fetching ${mustFetch.length} more thumbnails`;
        }
    }
}

function getThumbnailFor(id) {
    var thumbNails = getThumbnails();
    for(const element in thumbNails) {
        var anchor = element.parentElement.parentElement.parentElement;
        if(anchor && anchor.href.contains(id))
            return element;
    }
    return null;
}

function pause() {
    getVideo().pause();
    if(IS_MOBILE) {
        addVideoListeners();
    }
}
function play() {
    var promise = getVideo().play();
    if (promise !== undefined) {
        promise.then(_ => {
            // Autoplay started!
        }).catch(error => {
            Toastify({
                text: `Video can be played!`,
                duration: 5000,
                close: true,
                gravity: "top", // `top` or `bottom`
                position: "right", // `left`, `center` or `right`
                backgroundColor: "blue",
                stopOnFocus: true, // Prevents dismissing of toast on hover
                onClick: function(){} // Callback after click
            }).showToast();
        });
    }
}

function addVideoListeners() {
    var vid = getVideo();
    vid.onpause = function() {
        if(LOADED === false)
            return false;
        if(HALTED)
            return;
        console.log("Video play stopped.");
        if(CONNECTED)
            saveTime();
        clearInterval(videoSync);
        getVideoTxt().innerText += " | Paused";
    };
    vid.onplay = function() {
        if(HALTED) {
            pause();
            getVideo().currentTime = CACHE[WATCHING] || 0;
            return;
        }
        if(LOADED === false) {
            pause();
            getVideo().currentTime = CACHE[WATCHING] || 0;
            return;
        }
        console.log("Video play started.");
        if(CONNECTED === false) {
            pause();
            console.error("Cannot play video: not syncing");
            return;
        }
        setInterval(videoSync, 1000);
        getVideoTxt().innerText = "Sync started...";
    };
    vid.onended = function() {
        if(HALTED)
            return;
        saveTime();
        clearInterval(videoSync);
        getVideoTxt().innerText += " | Ended";
    }
    vid.setAttribute("mlapi-events", "true")
}

function boot() {
    WATCHING = getId();
    if(WATCHING) {
        console.log(`Loaded watching ${WATCHING}`);
        pause();
        if(IS_MOBILE === false)
            addVideoListeners();
        getVideoTxt().innerText = "Fetching...";
        port.postMessage({type: "getTimes", data: [WATCHING]});
    }
}

function saveTime() {
    if(HALTED) {
        pause();
        pause();
        getVideo().currentTime = CACHE[WATCHING] || 0;
    }
    thing = {};
    thing[WATCHING] = getVideo().currentTime;
    port.postMessage({type: "setTime", data: thing});
}

function videoSync() {
    if(getVideo().paused || HALTED)
        return;
    saveTime();
}

setInterval(function() {
    var tofetch = setThumbnails();
    if(tofetch.length > 0) {
        port.postMessage({type: "getTimes", data: tofetch});
        if(fetchingToast) {
            fetchingToast.toastElement.innerText = `Fetching ${tofetch.length} thumbnails..`;
        } else {
            fetchingToast = Toastify({
                text: `Fetching ${tofetch.length} thumbnails..`,
                duration: -1,
                close: true,
                gravity: "top", // `top` or `bottom`
                position: "right", // `left`, `center` or `right`
                backgroundColor: "linear-gradient(to right, #00b09b, #96c93d)",
                stopOnFocus: true, // Prevents dismissing of toast on hover
                onClick: function(){} // Callback after click
            }).showToast();
        }
    } else if(fetchingToast) {
        fetchingToast.hideToast();
        fetchingToast = null;
    }
}, 5000);

setInterval(function() {
    var w = getId();
    if(WATCHING !== w) {
        WATCHING = w;
        if(w) {
            LOADED = false;
            console.log(`Now watching ${w}`);
            port.postMessage({type: "setWatching", data: WATCHING});
            if(watchingToast) {
                watchingToast.toastElement.innerText = "Fetching video saved time..";
            } else {
                watchingToast = Toastify({
                    text: `Fetching video saved time..`,
                    duration: -1,
                    close: true,
                    gravity: "top", // `top` or `bottom`
                    position: "right", // `left`, `center` or `right`
                    backgroundColor: "linear-gradient(to right, red, blue)",
                    stopOnFocus: true, // Prevents dismissing of toast on hover
                    onClick: function(){} // Callback after click
                }).showToast();
            }
            boot();
        } else {
            console.log(`Stopped watching video`);
        }
    }
    if(IS_MOBILE && WATCHING) {
        if(getVideo().getAttribute("mlapi-events") != "true")
            addVideoListeners();
        if(HALTED || !LOADED) {
            getVideo().pause();
            getVideo().currentTime = CACHE[WATCHING] || 0;
        }
    }
}, 500);
