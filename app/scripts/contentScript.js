console.warn("Content script loaded!")
var port = chrome.runtime.connect();
var CONNECTED = true;
var LOADED = false;
var HALTED = false;
var CALLBACKS = {};
var SEQUENCE = 0;

const vidToolTip = new VideoToolTip();
var flavRemoveLoaded = []; // flavours to remove once loaded
var flavRemoveSave = []; // flavours to remove once saved

var fetchingToast = null;
var watchingToast = null;
var oldVideoState = null;

function postMessage(packet, callback) {
    if(callback) {
        packet.seq = SEQUENCE++;
        CALLBACKS[packet.seq] = callback;
    }
    console.log(`[PORT] >>`, packet);
    port.postMessage(packet);
}

console.log("Connected to port");
port.onMessage.addListener(function(message, sender, response) {
    console.log("[PORT] <<", message);
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
                vidToolTip.SavedTime = HELPERS.ToTime(message.data[id]);
                var x = 0;
                while(x < flavRemoveSave.length) {
                    var f = flavRemoveSave[x];
                    vidToolTip.RemoveFlavour(f);
                    flavRemoveSave.splice(x, 1);
                    x++;
                }
            }
        }
    } else if(message.type === "setState") {
        var state = new StatePacket(message.data.play, message.data.display, message.data.log);
        console.log(state.log);
        LOADED = true;
        if(state.play) {
            HALTED = false;
            try {
                if(oldVideoState)
                    play();
            } catch {}
            vidToolTip.Style = {};
            vidToolTip.Error = null;
            vidToolTip.AddFlavour(new VideoToolTipFlavour(state.display, {color: "blue"}, 10000));
        } else {
            oldVideoState = !getVideo().paused;
            HALTED = true;
            try {
                pause();
            } catch {}
            vidToolTip.Error = new VideoToolTipFlavour(message.data.display, {color: "red"}, -1);
        }
    } else if(message.type === TYPE.UPDATE) {
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
    if(message.res) {
        var cb = CALLBACKS[message.res]
        delete CALLBACKS[message.res]
        console.log(`[PORT] Invoking callback handler for ${message.res}`);
        cb(message);
    }
});
port.onDisconnect.addListener(function() {
    console.warn("Disconnected from ");
    HALTED = true;
    CONNECTED = false;
    if(getVideo()) {
        pause();
        vidToolTip.Error = new VideoToolTipFlavour("Disconnected", {color: "red"}, -1);
    }
    Toastify({
        text: "Disconnected from backend server; reloading...",
        duration: -1,
        close: true,
        gravity: "top", // `top` or `bottom`
        position: "right", // `left`, `center` or `right`
        backgroundColor: "red",
        stopOnFocus: true, // Prevents dismissing of toast on hover
    }).showToast();
    setTimeout(function() {
        window.location.reload();
    }, 5000);
})
const CACHE = {}
var WATCHING = null;
console.log(window.location);
var IS_MOBILE = window.location.hostname.startsWith("m.");

function isWatchingFullScreen() {
    return WATCHING && (window.fullScreen || (window.innerWidth == screen.width && window.innerHeight == screen.height));
}

function getTxtContainer() {
    if(IS_MOBILE) {
        return document.getElementsByClassName("player-controls-top")[0];
    } else {
        var elems = document.getElementsByClassName("ytp-time-display notranslate");
        for(var thing of elems) {
            var p = thing.parentElement;
            if(p.classList.contains("ytp-left-controls"))
                return thing; 
        }
        return elems[0];
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
    if(IS_MOBILE) {
        txt.style.position = "relative";
        txt.style.left = "-150px";
        container.insertBefore(txt, container.firstChild);
    } else {
        container.appendChild(txt);
    }
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
    if(IS_MOBILE) {
        return document.getElementsByClassName("video-stream html5-main-video")[0];
    }
    else {
        return document.getElementsByClassName("video-stream html5-main-video")[0];
    }
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
        var anchor = element.parentElement.parentElement.parentElement;
        var id = getId(anchor.href);
        if(!id)
            continue;
        var state = element.getAttribute("mlapi-state") || "unfetched";
        if(state === "fetched") {
            var doneAt = parseInt(element.getAttribute("mlapi-done"));
            var diff = Date.now() - doneAt;
            if(diff < 30000) {
                continue;
            }
            delete CACHE[id];
            state = "redoing";
            element.setAttribute("mlapi-state", "redoing");
        }
        var vidLength = element.getAttribute("mlapi-vid-length");
        if(!vidLength) {
            vidLength = parseToSeconds(element.innerText);
            element.setAttribute("mlapi-vid-length", parseToSeconds(vidLength));
        }
        if(id in CACHE) {
            var time = CACHE[id];
            var perc = time / vidLength;
            if(perc >= 0.9) {
                element.innerText = `✔️ ${HELPERS.ToTime(vidLength)}`;
                element.style.color = "green";
                if(IS_MOBILE)
                    element.style.backgroundColor = "white";
            } else if(perc > 0) {
                var remaining = vidLength - time;
                element.innerText = HELPERS.ToTime(remaining);
                element.style.color = "orange";
                if(IS_MOBILE)
                    element.style.backgroundColor = "blue";
            } else {
                element.innerText = HELPERS.ToTime(vidLength);
            }
            CACHE[id] = time;
            element.setAttribute("mlapi-state", "fetched")
            element.setAttribute("mlapi-done", Date.now());
        } else {
            if(state === "fetching") {
                var prefix = element.innerText.startsWith("🔄") ? "🔃" : "🔄";
                element.innerText = `${prefix} ${HELPERS.ToTime(vidLength)}`;
            } else {
                element.setAttribute("mlapi-state", "fetching");
                element.innerText = `🔄 ${HELPERS.ToTime(vidLength)}`;
                delete CACHE[id];
                mustFetch.push(id);
            }
        }
    }
    return mustFetch;
}

function setCurrentTimeCorrect() {
    console.log("Invoked setCurrentTimeCorrect");
    var vid = getVideo();
    console.log("Got video as ", vid);
    var time = vid.currentTime;
    console.log("Got time as ", time);
    var cache = CACHE[WATCHING];
    console.log("Got cached time as ", cache);
    var diff = Math.abs(time - cache);
    console.log(`Difference is ${diff}s, wanting to set to ${CACHE[WATCHING]}`)
    if(diff > 1.5) {
        console.log("Setting current time as it is beyond cache");
        getVideo().currentTime = CACHE[WATCHING];
        setTimeout(function() {
            console.log("Checking timestamp");
            setCurrentTimeCorrect();
        }, 500);
    } else {
        console.log("Satisfactory, playing...");
        LOADED = true;
        if(getVideo().paused)
            play();
    }

}

function setTimes() {
    var mustFetch = setThumbnails();

    if(WATCHING !== null && LOADED === false) {
        var data = CACHE[WATCHING];
        if(data !== null && data !== undefined) {
            console.log(`Setting video currentTime to ${data}`);
            try {
                var time = HELPERS.ToTime(data);
                vidToolTip.AddFlavour(new VideoToolTipFlavour(`Loaded ${time}`, {color: "orange"}, 20000));
                while(flavRemoveLoaded.length > 0) {
                    var id = flavRemoveLoaded[0];
                    vidToolTip.RemoveFlavour(id);
                    flavRemoveLoaded.splice(0, 1);
                }
                vidToolTip.SavedTime = time;
                setCurrentTimeCorrect();
            } catch (error) {
                console.error(error);
            }
            if(fetchingToast) {
                fetchingToast.hideToast();
                fetchingToast = null;
            }
            if(watchingToast) {
                watchingToast.hideToast();
                watchingToast = null;
            }
        }
    }

    if(mustFetch.length > 0) {
        postMessage({type: "getTimes", data: mustFetch});
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
    console.log("Pausing video");
    getVideo().pause();
    if(IS_MOBILE) {
        addVideoListeners();
    }
}
function playToast() {
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
}
function play() {
    if(IS_MOBILE) {
        playToast();
        return;
    }
    console.log("Playing...");
    var promise = getVideo().play();
    if (promise !== undefined) {
        promise.then(e => {
            // Autoplay started!
            console.log("Play has begun", e);
        }).catch(error => {
            playToast();
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
        vidToolTip.Paused = true;
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
        if(CONNECTED === false) {
            pause();
            console.error("Cannot play video: not syncing");
            return;
        }
        console.log("Video play started.");
        setInterval(videoSync, 1000);
        vidToolTip.Paused = false;
        vidToolTip.Ended = false;
        flavRemoveSave.push(vidToolTip.AddFlavour(new VideoToolTipFlavour("Sync started", {color: "green"}, -1)));
    };
    vid.onended = function() {
        if(HALTED)
            return;
        saveTime();
        clearInterval(videoSync);
        vidToolTip.Ended = true;
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
        flavRemoveLoaded.push(vidToolTip.AddFlavour(new VideoToolTipFlavour("Fetching..", {color: "blue"}, 5000)));
    }
}

function saveTime() {
    if(HALTED) {
        pause();
        pause();
        getVideo().currentTime = CACHE[WATCHING] || 0;
    }
    navigateToPort = {};
    navigateToPort[WATCHING] = getVideo().currentTime;
    postMessage({type: "setTime", data: navigateToPort});
}

function videoSync() {
    if(getVideo().paused || HALTED)
        return;
    saveTime();
}

setInterval(function() {
    var tofetch = setThumbnails();
    if(tofetch.length > 0) {
        postMessage({type: "getTimes", data: tofetch});
        if(fetchingToast) {
            fetchingToast.toastElement.innerText = `Fetching ${tofetch.length} thumbnails..`;
        } else if(!isWatchingFullScreen()) {
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
}, 4000);

setInterval(function() {
    var w = getId();
    if(WATCHING !== w) {
        delete CACHE[w];
        WATCHING = w;
        if(w) {
            LOADED = false;
            console.log(`Now watching ${w}`);
            postMessage({type: "setWatching", data: WATCHING});
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
    if(WATCHING) {
        var v = getVideo();
        var a = getVideoTxt();
        if(a) {
            a.innerHTML = "";
            a.appendChild(vidToolTip.Build());
        }
    }
}, 500);
