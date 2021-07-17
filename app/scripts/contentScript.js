console.warn("Content script loaded!")
var port = chrome.runtime.connect();
var CONNECTED = true;
var LOADED = false;
var HALTED = false;
var IGNORED = false;
var PRIOR_STATE = null; // whether the video was playing when we disconnected
var CALLBACKS = {};
var SEQUENCE = 0;

const vidToolTip = new VideoToolTip();
var flavRemoveLoaded = []; // flavours to remove once loaded
var flavRemoveSave = []; // flavours to remove once saved

var fetchingToast = null;
var watchingToast = null;
var oldVideoState = null;
var disconnectToast = null;

function postMessage(packet, callback) {
    if(callback) {
        packet.seq = SEQUENCE++;
        CALLBACKS[packet.seq] = callback;
    }
    console.debug(`[PORT] >>`, packet);
    port.postMessage(packet);
}

function connectToExtension() {
    port = chrome.runtime.connect();

    port.onMessage.addListener(portOnMessage);
    port.onDisconnect.addListener(portOnDisconnect);
}

function portOnMessage(message, sender, response) {
    console.debug("[PORT] <<", message);
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
    } else if(message.type === INTERNAL.UPDATE) {
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
    } else if(message.type === INTERNAL.IGNORED_VIDEO) {
        console.log("This video has been ignored, so we shall play");
        IGNORED = true;
        LOADED = true;
        try {
            vidToolTip.AddFlavour(new VideoToolTipFlavour(`Video blacklisted from sync`, {color: "orange"}, 20000));
            while(flavRemoveLoaded.length > 0) {
                var id = flavRemoveLoaded[0];
                vidToolTip.RemoveFlavour(id);
                flavRemoveLoaded.splice(0, 1);
            }
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
        play();
    } else if(message.type === "alert") {
        alert(message.data);
    }
    if(message.res) {
        var cb = CALLBACKS[message.res]
        delete CALLBACKS[message.res]
        console.log(`[PORT] Invoking callback handler for ${message.res}`);
        cb(message);
    }
    if(CONNECTED === false) {
        // we were disconnected, but now we're back!
        // this logic doesn't seem to work
        // being disconnected also means we can't call chrome.runtime.connect()
        // so i'm reloading the page instead.
        CONNECTED = true;
        HALTED = false;
        console.log("Reconnected!");
        disconnectToast.hideToast();
        if(PRIOR_STATE === true) {
            console.log("Was previously playing, so attempting to play..");
            play();
        } else if(PRIOR_STATE === false) {
            console.log("Was previously paused, so making sure we're paused");
            pause();
        } else {
            console.log("There was no prior state??")
        }
    }
};

var reconnects = 0;
function portOnDisconnect() {
    if(CONNECTED) {
        console.warn("Disconnected from backend extension");
        reconnects = 0;
        HALTED = true;
        CONNECTED = false;
        var vid = getVideo();
        PRIOR_STATE = true;
        if(vid) {
            PRIOR_STATE = !vid.paused;
        }
        if(getVideo()) {
            pause();
            vidToolTip.Error = new VideoToolTipFlavour("Disconnected", {color: "red"}, -1);
        }
        disconnectToast = Toastify({
            text: "Disconnected from backend server; reloading...",
            duration: -1,
            close: true,
            gravity: "top", // `top` or `bottom`
            position: "right", // `left`, `center` or `right`
            backgroundColor: "red",
            stopOnFocus: true, // Prevents dismissing of toast on hover
        });
        disconnectToast.showToast();

    } else {
        reconnects = reconnects + 1;
        disconnectToast.toastElement.innerText = `Reconnecting (${reconnects} attempts)`;
    }
    setTimeout(function() {
        //connectToExtension();
        window.location.reload();
    }, 1000);
}

connectToExtension();

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

function getVideoLength() {
    var vid = getVideo();
    if(vid)
        return vid.duration;
    return null;
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
    var videoTime = getVideoLength();
    if(videoTime) {
        var perc = cache / videoTime;
        console.log("Perc: ", perc);
        if(perc >= 0.975) {
            console.log("Setting video time correct to 0, as rewatching.");
            cache = 0;
        }
    } else {
        pause(); // make sure it is paused
        setTimeout(function() {
            setCurrentTimeCorrect();
        }, 500);
        return;
    }
    var diff = Math.abs(time - cache);
    console.log(`Difference is ${diff}s, wanting to set to ${cache}`)
    if(diff > 1.5) {
        console.log("Setting current time as it is beyond cache");
        getVideo().currentTime = cache;
        setTimeout(function() {
            console.log("Checking timestamp");
            setCurrentTimeCorrect();
        }, 500);
    } else {
        console.log("Satisfactory...");
        LOADED = true;
        if(getVideo().paused && PRIOR_STATE !== false)
            play();
        PRIOR_STATE = null;
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
    if(IGNORED)
        return;
    var vid = getVideo();
    vid.onpause = function() {
        if(LOADED === false)
            return false;
        if(HALTED)
            return;
        if(IGNORED)
            return;
        console.log("Video play stopped.");
        if(CONNECTED)
            saveTime();
        clearInterval(videoSync);
        vidToolTip.Paused = true;
    };
    vid.onplay = function() {
        if(IGNORED)
            return;
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
        if(IGNORED)
            return;
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
    if(IGNORED)
        return;
    if(HALTED) {
        pause();
        pause();
        getVideo().currentTime = CACHE[WATCHING] || 0;
    }
    navigateToPort = {};
    var time = getVideo().currentTime;
    navigateToPort[WATCHING] = time;
    CACHE[WATCHING] = time;
    postMessage({type: "setTime", data: navigateToPort});
}

function videoSync() {
    if(IGNORED)
        return;
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
            /*fetchingToast = Toastify({
                text: `Fetching ${tofetch.length} thumbnails..`,
                duration: -1,
                close: true,
                gravity: "top", // `top` or `bottom`
                position: "right", // `left`, `center` or `right`
                backgroundColor: "linear-gradient(to right, #00b09b, #96c93d)",
                stopOnFocus: true, // Prevents dismissing of toast on hover
                onClick: function(){} // Callback after click
            }).showToast();*/
            // TODO: add settings page to toggle this behaviour and other things
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
            IGNORED = false;
            console.log(`Now watching ${w}`);
            vidToolTip.ClearFlavours();
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
