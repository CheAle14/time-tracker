'use strict';
import { StateInfo, DebugTimer, VideoToolTip, ConsistentToast, StatePacket, VideoToolTipFlavour, INTERNAL, EXTERNAL, HELPERS, getObjectLength, DeferredPromise, NoResponsePacket } from "./classes.js";
var port = null;
const STATUS = new StateInfo();
var PRIOR_STATE = null; // whether the video was playing when we disconnected
var CALLBACKS = {};
var FAILS = {};
var SEQUENCE = 1;
var BLOCKLISTED_VIDEOS = {};
var THUMBNAIL_ELEMENTS = {};
var THUMBNAIL_INTERVAL = null;

const ROOT = new DebugTimer(/*log*/ false);

const vidToolTip = new VideoToolTip();
var flavRemoveLoaded = []; // flavours to remove once loaded
var flavRemoveSave = []; // flavours to remove once saved

var fetchingToast = new ConsistentToast({
    duration: -1,
    close: true,
    gravity: "top", // `top` or `bottom`
    position: "right", // `left`, `center` or `right`
    backgroundColor: "linear-gradient(to right, #00b09b, #96c93d)",
    stopOnFocus: true, // Prevents dismissing of toast on hover
    onClick: function(){ fetchingToast.hideToast(); } // Callback after click
});
var watchingToast = new ConsistentToast({
    duration: -1,
    close: true,
    gravity: "top", // `top` or `bottom`
    position: "right", // `left`, `center` or `right`
    backgroundColor: "linear-gradient(to right, red, blue)",
    stopOnFocus: true, // Prevents dismissing of toast on hover
    onClick: function(){ watchingToast.hideToast(); } // Callback after click
});
var oldVideoState = null;
var errorToast = new ConsistentToast({
    duration: 2500,
    close: true,
    gravity: "top", // `top` or `bottom`
    position: "right", // `left`, `center` or `right`
    backgroundColor: "red",
    onclick: window.location.reload,
    stopOnFocus: true, // Prevents dismissing of toast on hover
});

function hasRecentTransmission() {
    console.log("Last transmission: ", lastMessageSent, " diff: ", Date.now() - lastMessageSent);
    return (Date.now() - lastMessageSent) > 60000;
}

// This is exported so the content_yt.js file can call it.

export async function postMessage(packet, timeout = null) {
    var prom = new DeferredPromise(timeout);
    packet.seq = SEQUENCE++;
    CALLBACKS[packet.seq] = prom;
    console.debug(`[PORT] >>`, packet);
    if(!port) {
        try {
            port = await connectToExtension();
        } catch(err) {
            console.error(err);
            STATUS.HALTED = true;
            var vid = getVideo();
            PRIOR_STATE = true;
            if(vid) {
                PRIOR_STATE = !vid.paused;
            }
            if(getVideo()) {
                pause("Port disconnected");
                vidToolTip.Error = new VideoToolTipFlavour("Disconnected", {color: "red"}, -1);
            }
            errorToast.setText("Disconnected from backend extension");
            return;
        }
    }
    lastMessageSent = Date.now();
    port.postMessage(packet);
    return prom.promise;
}

var reconnect_timer = null;
var reconnect_promise = null;
var lastMessageSent = Date.now();

async function connectToExtension() {
    reconnect_promise = new DeferredPromise();
    try {
        if(port) {
            console.log("Disconnecting from backend extension for a reconnect");
            port.disconnect();
            clearTimeout(reconnect_timer);
            reconnect_timer = null;
        }
        console.log("Connecting to backend");
        port = chrome.runtime.connect();
    
        port.onMessage.addListener(portOnMessage);
        port.onDisconnect.addListener(portOnDisconnect);
        reconnect_timer = setTimeout(() => {
            connectToExtension();
        }, 295e3);
    } catch(err) {
        reconnect_promise.reject(err);
    }
    return reconnect_promise.promise;
}

function portOnMessage(message, sender, response) {
    console.debug("[PORT] <<", message);
    if(reconnect_promise) {
        reconnect_promise.resolve(port);
    }
    if(message.res) {
        var prom = CALLBACKS[message.res];
        if(prom) {
            console.log("Handling promise for ", message.res);
            delete CALLBACKS[message.res];
            if(message.error)
                prom.reject(message);
            else
                prom.resolve(message);
            return;
        } else {
            console.warn("Unknown response:", message);
        }
    }
    if(message.type === "blocklist") {
        BLOCKLISTED_VIDEOS = message.data;
    } else if(message.type === "gotTimes") {
        setTimes(message.data);
    } else if (message.type === "error") {
        console.error(message.data);
        errorToast.setText(message.data);
    } else if(message.type === "savedTime" && STATUS.HALTED == false) {
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
        if(state.play) {
            STATUS.HALTED = false;
            try {
                if(oldVideoState)
                    play();
            } catch {}
            vidToolTip.Style = {};
            vidToolTip.Error = null;
            vidToolTip.AddFlavour(new VideoToolTipFlavour(state.display, {color: "blue"}, 10000));
        } else {
            oldVideoState = !getVideo().paused;
            STATUS.HALTED = true;
            try {
                pause("setState play=false");
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
        STATUS.IGNORE();
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
        fetchingToast.hideToast();
        watchingToast.hideToast();
        play();
    } else if(message.type === "alert") {
        alert(message.data);
    } else if(message.type === INTERNAL.CHECK_FOR_VIDEOS) {
        checkThumnailsSoonTimeout = setTimeout(checkThumbnails, 4000);
    }
};

var checkThumnailsSoonTimeout = null;

async function portOnDisconnect() {
    console.log("Disconnected from backend extension");
    port = null;
    if(!reconnect_promise.isResolved) {
        reconnect_promise.reject();
    }
    if(hasRecentTransmission()) {
        console.log("Attempting immediate reconnect due to recent transmission.");
        var recon = setInterval(async () => {
            try {
                port = await connectToExtension();
                clearInterval(recon);
            } catch(err) {
                console.error(err);
            }
        }, 1000);
    }
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



function pad(value, length) {
    var s = value.toString();
    var diff = length - s.length;
    if(diff > 0) {
        return "0".repeat(diff) + s;
    }
    return s;
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

const THUMBNAIL_NODE = "YTM-THUMBNAIL-OVERLAY-TIME-STATUS-RENDERER";
function getThumbnails() {
    if(IS_MOBILE) {
        var elements = document.getElementsByTagName("ytm-thumbnail-overlay-time-status-renderer");
        var arr = [];
        for(var el of elements) {
            if(el.tagName === THUMBNAIL_NODE) 
                arr.push(el);
        }
        return arr;
    } else {
        var elements = document.getElementsByTagName("ytd-thumbnail-overlay-time-status-renderer");
        var arr = [];
        for(var el of elements) {
            arr.push(el.querySelector("span#text"));
        }
        return arr;
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

function isInPlaylist() {
    if(IS_MOBILE) {
        var doc = document.getElementsByTagName("ytm-playlist")[0];
        return !!doc;
    } else {
        const urlSearchParams = new URLSearchParams(window.location.search);
        if(urlSearchParams.get("list") === null) return false;
        var playlistTitle = document.getElementsByClassName("title style-scope ytd-playlist-panel-renderer complex-string")[0];
        if(playlistTitle === null || playlistTitle === undefined) return null;
        const title = playlistTitle.getAttribute("title");
        if(title === null || title === undefined || title === "") return null;
        return title;
    }
}

function isAd() {
    var vid = getVideo();
    if(!vid) return null;
    var parent = vid.parentElement.parentElement;
    if(!parent) return null;
    return parent.className.indexOf("ad-showing") >= 0;
}
function skipAd() {
    var arr = document.getElementsByClassName("ytp-ad-skip-button");
    if(arr && arr.length > 0) {
        var x = arr[0];
        if(x) x.click();
    }
}

function getChannelName() {
    var cont = document.getElementById("above-the-fold");
    console.log("CHANNEL: ", cont);
    if(cont) {
        return cont.getElementsByTagName("ytd-channel-name")[0];
    } else {
        return null;
    }
}
function getChannelBadges() {
    if(IS_MOBILE) return [];
    var cont = getChannelName();
    if(cont == null) return null;
    console.log("CHANNEL NAME: ", cont);
    var badgesCont = cont.getElementsByTagName("ytd-badge-supported-renderer")[0];
    var a = [];
    if(badgesCont) {
        if(badgesCont.children) {
            for(let child of badgesCont.children) {
                if(!child.classList.contains("badge")) continue;
                console.log(child);
                var lbl = child.getAttribute("aria-label");
                if(lbl) 
                    a.push(lbl);
            }
        } else {
            return null;
        }
    } else {
        return null;
    }
    console.log("BADGES: ", a);
    return a;
}

function hasMusicBadge(badges) {
    for(let badge of badges) {
        if(badge.indexOf("Artist") >= 0) return true;
    }
    return false;
}

function getVideoLength() {
    var vid = getVideo();
    if(vid) {
        if(vid.duration > 0) {
            return vid.duration;
        }
    }
    return null;
}

const hoursRegex = /(\d+) hours?/;
const minsRegex = /(\d+) minutes?/;
const secsRegex = /(\d+) seconds?/
function parseLabel(ariaText) {
    var times = ariaText.split(",");
    var hours = ariaText.match(hoursRegex) || 0;
    if(hours) {
        hours = parseInt(hours[1]);
    }
    var mins = ariaText.match(minsRegex) || 0;
    if(mins) {
        mins = parseInt(mins[1]);
    }
    var seconds = ariaText.match(secsRegex) || 0;
    if(seconds) {
        seconds = parseInt(seconds[1]);
    }
    return (hours * 3600) + (mins * 60) + seconds;
}

function setElementThumbnail(element, data) {
    if(element.getAttribute("aria-hidden")) {
        console.log("Element is hidden: ", element);
        ROOT.timeEnd();
        return "hidden";
    }
    var anchor = null;
    while(anchor === null || anchor.tagName !== "A") {
        anchor = (anchor || element).parentElement;
    }
    if(anchor.href.indexOf("/shorts/") >= 0) return "shorts";
    var id = HELPERS.GetVideoId(anchor.href);
    data.id = id;
    if(!id) {
        console.log("Could not get ID:", element);
        ROOT.timeEnd();
        return "no id";
    }
    // TODO: use aria-label to get the duration, element.innerText can take 1ms to do - not very performant!
    ROOT.time("parse");
    var vidLength = null;
    try {
        if(element.hasAttribute("aria-label")) {
            vidLength = parseLabel(element.getAttribute("aria-label"));
        } else {
            vidLength = parseToSeconds(element.innerText);
            element.setAttribute("aria-label", `${vidLength} seconds`);
        }
    } catch(err) {
        console.error(element, err);
        ROOT.timeEnd("parse");
        return "parse error";
    }
    ROOT.timeEnd("parse");
    /*console.time(timer + "::live");
    if(element.innerText.includes("LIVE")) { 
        console.timeEnd(timer);
        console.timeEnd(timer + "::live");
        continue;
    }*/
    //console.timeEnd(timer + "::live");
    ROOT.time("existing");
    var existingId = anchor.getAttribute("mlapi-id");
    if(existingId && existingId !== id) {
        console.log(`Element has different ID than initially thought: `, existingId, id, anchor);
        for (var att, j = 0, atts = anchor.attributes, n = atts.length; j < n; j++){
            att = atts[j];
            if(att.nodeName.startsWith("mlapi-")) {
                console.log("Removing ", att.nodeName, "=", att.nodeValue);
                anchor.removeAttribute(att.nodeName);
            }
        }
    }
    ROOT.timeEnd("existing");
    var state = element.getAttribute("mlapi-state") || "unfetched";
    if(state === "fetched") {
        return "fetched";
        /*var doneAt = parseInt(element.getAttribute("mlapi-done"));
        var diff = Date.now() - doneAt;
        if(diff < 30000) {
            //console.timeEnd(timer);
            continue;
        }
        delete CACHE[id];
        state = "redoing";
        element.setAttribute("mlapi-state", "redoing");*/
    }
    //console.time(timer + "::rest");
    //var vidLength = element.getAttribute("mlapi-vid-length");
    //if(!vidLength) {
    //    vidLength = parseToSeconds(element.innerText);
    //    element.setAttribute("mlapi-vid-length", parseToSeconds(vidLength));
    //}dd
    ROOT.push("set");
    var rtn = "undefined";
    if(id in CACHE) {
        var time = CACHE[id];
        var perc = time / vidLength;
        const watchstate = getVideoWatchedStage(perc, vidLength - time);
        if(watchstate === "watched") {
            ROOT.time("in-watched");
            element.innerText = `✔️ ${HELPERS.ToTime(vidLength)}`;
            element.style.color = "green";
            element.style.backgroundColor = "white";
            ROOT.timeEnd("in-watched");
        } else if(watchstate === "nearly-watched") {
            ROOT.time("in-nearly-watched");
            element.innerText = `⌛ ${HELPERS.ToTime(vidLength - time)}`;
            element.style.color = "orange";
            element.style.backgroundColor = "blue";
            ROOT.timeEnd("in-nearly-watched");
        } else if(watchstate === "started") {
            ROOT.time("in-0");
            var remaining = vidLength - time;
            element.innerText = HELPERS.ToTime(remaining);
            element.style.color = "orange";
            element.style.backgroundColor = "blue";
            ROOT.timeEnd("in-0");
        } else {
            ROOT.time("in-else");
            element.innerText = HELPERS.ToTime(vidLength);
            element.style.color = null;
            element.style.backgroundColor = null;
            ROOT.timeEnd("in-else");
        }
        ROOT.time("in-attrs");
        CACHE[id] = time;
        element.setAttribute("mlapi-state", "fetched")
        element.setAttribute("mlapi-done", Date.now());
        element.setAttribute("mlapi-id", id);
        ROOT.timeEnd("in-attrs");
        rtn = "updated";
    } else {
        storeThumbnailElement(id, element);
        if(state.startsWith("fetching")) {
            ROOT.time("not-exist");
            var test = state.endsWith("1");
            var prefix = test ? "🔃" : "🔄";
            element.innerText = `${prefix} ${HELPERS.ToTime(vidLength)}`;
            //element.style.border = test ? "1px solid orange" : "1px solid red";
            element.setAttribute("mlapi-state", test ? "fetching" : "fetching1");
            ROOT.timeEnd("not-exist");
            rtn = "fetching";
        } else {
            ROOT.time("not-fetch");
            element.setAttribute("mlapi-state", "fetching");
            element.style.border = "1px red";
            element.innerText = `🔄 ${HELPERS.ToTime(vidLength)}`;
            delete CACHE[id];
            rtn = "fetch";
            ROOT.timeEnd("not-fetch");
        }
    }
    ROOT.pop();
    return rtn;
}

var thumbnailBatch = 0;
// This is exported so the content_yt.js file can call it.
export function setThumbnails() {
    //console.log(CACHE);
    var mustFetch = new Set();
    var thumbNails = getThumbnails();
    const timeStart = window.performance.now();
    var done = 0;
    var thoseWaiting = 0;
    for(let element of thumbNails) {
        //if(i <= thumbnailBatch)  {
        //    continue;
        //}
        /*const elemVisible = !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length );
        if(!elemVisible) {
            continue;
        }*/
        done += 1;
        ROOT.push(`setInterval::${done}`);

        var data = {};
        var rtn = setElementThumbnail(element, data);
        if(rtn === "fetch") {
            mustFetch.add(data.id);
        } else if(rtn === "fetching") {
            thoseWaiting += 1;
        }
        
        ROOT.pop();
        var accTimeSpent = window.performance.now() - timeStart;
        //console.debug(`setThumbnails - After ${done} total time now ${accTimeSpent}ms`);
    }
    console.debug(`setThumbnails looked at ${done}; taking ${window.performance.now() - timeStart}ms. Must fetch: ${mustFetch.size}, waiting: ${thoseWaiting}`);
    return [...mustFetch];
}

export async function handleGetTimes(tofetch) {
    if(tofetch.length === 0) {
        console.log("Not fetching nothing.");
        return;
    }
    console.log("Fetching:", tofetch);
    var result = await postMessage({type: "getTimes", data: tofetch});
    console.log("Data back: ", result);
    setTimeout(function() {
        setTimes(result.data)
    }, 500);
}

function getVideoWatchedStage(percentageWatched, timeRemainSeconds) {
    if((percentageWatched >= 0.95 && timeRemainSeconds < 180) || timeRemainSeconds < 10) {
        return "watched";
    } else if(percentageWatched >= 0.9) {
        return "nearly-watched";
    } else if(percentageWatched > 0) {
        return "started";
    }
    return "not-seen";
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
        const watchstate = getVideoWatchedStage(perc, videoTime - cache);
        if(watchstate === "watched") {
            console.log("Setting video time correct to 0, as rewatching.");
            cache = 0;
        }
    } else {
        pause("setCurrentTimeCorrect retry"); // make sure it is paused
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
        if(getVideo().paused && PRIOR_STATE !== false)
            play();
        PRIOR_STATE = null;
    }

}

/**
 * Gets the time, in seconds, that is specified in the `?t=` query param.  
 * Null if there isn't any.
 */
function getQueryTime() {
    const urlSearchParams = new URLSearchParams(window.location.search);
    var time = urlSearchParams.get("t");
    if(!time) {
        return null;
    }
    let re = /(?<hour>\d+h)?(?<minute>\d+m)?(?<second>\d+s?)/; // matches (1h)(2m)(30s) and 3690s?

    var result = time.match(re);
    console.log(result);

    var hr = result.groups.hour ?? "0h";
    var mn = result.groups.minute ?? "0m";
    var sc = result.groups.second ?? "0s";

    var hours = parseInt(hr.substring(0, hr.length - 1));
    var minutes = parseInt(mn.substring(0, mn.length - 1));
    var seconds = parseInt(sc.substring(0, sc.length - 1));

    console.log(hours, minutes, seconds);
    return (hours * 3600) + (minutes * 60) + seconds;
}

function setQueryTime(seconds) {
    //const searchParams = new URLSearchParams(window.location.search);
    //searchParams.set("t", queryV);
    var url = new URL(window.location.href);
    url.searchParams.set("t", `${Math.floor(seconds)}s`);
    //url.search = searchParams.toString();
    history.replaceState(null, '', url);
}

function checkWatchingData() {
    if(WATCHING !== null && STATUS.FETCH && STATUS.LOADED == false) {
        var data = CACHE[WATCHING];
        if(data !== null && data !== undefined) {
            var query = getQueryTime();
            if(query) {
                try {
                    vidToolTip.AddFlavour(new VideoToolTipFlavour(`Loaded ${data}`, {color: "white"}, 20000));
                } catch(error) {
                    console.error(error);
                }
                data = query;
                CACHE[WATCHING] = query;
            }
            console.log(`Setting video currentTime to ${data}`);
            STATUS.LOADED = true;
            try {
                var time = HELPERS.ToTime(data);
                var whereFrom = !!query ? "Param" : "Loaded"
                vidToolTip.AddFlavour(new VideoToolTipFlavour(`${whereFrom} ${time}`, {color: "orange"}, 20000));
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
            fetchingToast.hideToast();
            watchingToast.hideToast();
        }
    }
}

function isDivThumbnail(div) {
    return div.tagName === "DIV" && div.id === "content"
}
function isYtdGridThumbnail(el) {
    return el.tagName === "YTD-THUMBNAIL";
}

function storeThumbnailElement(id, element) {
    var div = null;
    while(div === null || (!isDivThumbnail(div) && !isYtdGridThumbnail(div))) {
        div = (div || element).parentElement;
    }
    THUMBNAIL_ELEMENTS[id] = div;
    return div;
}

function getThumbnailElement(id) {
    var elem = THUMBNAIL_ELEMENTS[id];
    if(elem === null || elem === undefined) return elem;
    return elem.querySelector("span#text");
}

function setTimes(data) {
    thumbnailBatch = 0;
    //var mustFetch = setThumbnails();

    for(let id in data) {
        const time = data[id];
        CACHE[id] = time;
        const elem = getThumbnailElement(id);
        if(elem) {
            setElementThumbnail(elem, {});
            delete THUMBNAIL_ELEMENTS[id];
        } else {
            if(id !== WATCHING) {
                console.warn("Could not find element for ", id);
            }
        }
    }

    var rem = getObjectLength(THUMBNAIL_ELEMENTS);
    console.log("Remaining thumbnails to fetch: ", rem);
    if(fetchingToast) {
        if(rem > 0) {
            fetchingToast.setText(`Waiting for ${rem} thumbnails`);
        } else {
            fetchingToast.hideToast();
        }
    }


    checkWatchingData()

    /*if(mustFetch.length > 0) {
        postMessage({type: "getTimes", data: mustFetch});
        if(fetchingToast.showing) {
            fetchingToast.setText(`Fetching ${mustFetch.length} more thumbnails`);
        }
    }*/
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

function pause(reason) {
    console.log("Pausing video: ", reason);
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
        console.log("Video play stopped; ", STATUS);
        if(STATUS.HALTED)
            return;
        if(STATUS.SYNC == false)
            return;
        saveTime();
        clearInterval(syncInterval);
        syncInterval = null;
        vidToolTip.Paused = true;
    };
    vid.onplay = function() {
        console.log("Video play started; ", STATUS);
        if(STATUS.HALTED) {
            pause("Played, but HALTED");
            getVideo().currentTime = CACHE[WATCHING] || 0;
            return;
        }
        if(STATUS.SYNC == false) {
            return;
        }
        if(STATUS.LOADED == false) {
            pause("Played, but not LOADED");
            return;
        }
        /*if(LOADED === false) {
            pause("Played, but not LOADED");
            getVideo().currentTime = CACHE[WATCHING] || 0;
            return;
        }*/
        if(syncInterval) {
            clearInterval(syncInterval);
        }
        syncInterval = setInterval(videoSync, 15000);
        vidToolTip.Paused = false;
        vidToolTip.Ended = false;
        flavRemoveSave.push(vidToolTip.AddFlavour(new VideoToolTipFlavour("Sync started", {color: "green"}, -1)));
    };
    vid.onended = function() {
        console.log("Video play ended; ", STATUS);
        if(STATUS.HALTED)
            return;
        if(STATUS.SYNC == false)
            return;
        saveTime();
        clearInterval(syncInterval);
        syncInterval = null;
        vidToolTip.Ended = true;
    }
    vid.setAttribute("mlapi-events", "true")
}

async function setWatching(isAd) {
    try {
        var results = await postMessage({type: INTERNAL.SET_WATCHING, data: WATCHING});
        for(let k in results.data) {
            CACHE[k] = results.data[k];
        }
        setTimes(results.data);
    } catch(err) {
        console.error("Could not set watching ", err);
        vidToolTip.AddFlavour(new VideoToolTipFlavour(`Failed to fetch video time ${isAd ? "ad":""}: ${err.data.reason}`, {color: "red"}, -1));
        CACHE[WATCHING] = 0;
        var d = {};
        d[WATCHING] = 0;
        setTimes(d);
    }
}

async function boot() {
    WATCHING = HELPERS.GetVideoId(window.location.href);
    thumbnailBatch = 0;
    if(WATCHING) {
        var length = getVideoLength();
        var playlist = isInPlaylist();
        console.log(`Loaded watching ${WATCHING} of duration `, length, "; playlist: ", playlist, "; badges: ", STATUS.BADGES);

        if(WATCHING in BLOCKLISTED_VIDEOS) {
            console.log("Video blacklisted, ignoring");
            STATUS.IGNORE();
            return;
        }

        if(STATUS.BADGES === null) {
            STATUS.BADGES = getChannelBadges();
        }



        var ad = isAd();
        if(ad === true) {
            console.log("Video is an advertisement, attempting to skip and rechecking; fetching time in background");
            if(STATUS.AD) {
                // we've already sent one message, so just try and skip
                skipAd();
            } else {
                // sent one message on the first pass
                await setWatching(true);
            }
            STATUS.AD = true;
            setTimeout(boot, 100);
            return;
        }

        if(STATUS.BADGES === null) {
            setTimeout(boot, 250);
            return;
        }
        
        if(hasMusicBadge(STATUS.BADGES)) {
            console.log("Video is a music video, ignoring.");
            STATUS.IGNORE();
            return;
        }

        if(playlist === null || playlist === undefined){
            setTimeout(boot, 100);
            return;
        }
        if(length === null || length === undefined) {
            setTimeout(boot, 100);
            return;
        }
        if(!IS_MOBILE && typeof(playlist) === "string") {
            playlist = playlist.indexOf("Songs") >= 0;
        }

        if(length !== null && length < 60) {
            console.log("Video is of short duration, not handling.")
            flavRemoveLoaded.push(vidToolTip.AddFlavour(new VideoToolTipFlavour("Not handling", {color: "blue"}, 5000)));
            STATUS.IGNORE();
        } else if (length < (60 * 5) && playlist) {
            console.log("Video is in a playlist, not fetching but still should set data.")
            flavRemoveLoaded.push(vidToolTip.AddFlavour(new VideoToolTipFlavour("Not fetching", {color: "blue"}, 5000)));
            STATUS.SYNC = true;
            STATUS.LOADED = true;
        } else {
            console.log("Video nominal, pausing");
            pause(`Boot, adv: ${STATUS.AD} length ${length}; pl: ${playlist}`);
            if(IS_MOBILE === false)
                addVideoListeners();
            if(!STATUS.AD) {
                await setWatching(false);
                watchingToast.setText("Fetching video saved time..");
                flavRemoveLoaded.push(vidToolTip.AddFlavour(new VideoToolTipFlavour("Fetching..", {color: "blue"}, 5000)));
            }
            STATUS.SYNC = true;
            STATUS.FETCH = true;
            checkWatchingData();
        }
        if(STATUS.AD) {
            STATUS.AD = false;
            console.log("Advertisement has finished, setting flag to false.");
        }
    }
}

async function saveTime() {
    if(STATUS.HALTED) {
        pause("Save time, but HALTED");
        //pause();
        getVideo().currentTime = CACHE[WATCHING] || 0;
    }
    if(STATUS.SYNC == false) {
        return;
    }
    if(STATUS.LOADED == false) {
        console.log("Not saving time: not loaded");
        return;
    }
    var time = getVideo().currentTime;
    if(time < 10) {
        console.log("Not saving time: too close to start");
        return;
    }
    var sv = {};
    sv[WATCHING] = time;
    CACHE[WATCHING] = time;
    await postMessage({type: "setTime", data: sv});
    setQueryTime(time);
}

var syncInterval = null;
function videoSync() {
    if(getVideo().paused || STATUS.HALTED)
        return;
    if(STATUS.LOADED == false)
        return;
    saveTime();
    if(isWatchingFullScreen()) {
        clearToasts();
        clearInterval(THUMBNAIL_INTERVAL);
        THUMBNAIL_INTERVAL = null;
        return;
    }
}

function clearToasts() {
    fetchingToast.hideToast();
    watchingToast.hideToast();
}

async function checkThumbnails() {
    if(checkThumnailsSoonTimeout) {
        clearTimeout(checkThumnailsSoonTimeout);
    }
    const ROOT = new DebugTimer();
    ROOT.push("checkThumbnails");
    ROOT.time("thumbnails");
    var tofetch = setThumbnails();
    ROOT.timeEnd("thumbnails")
    if(tofetch.length > 0) {
        ROOT.time("send");
        if(!isWatchingFullScreen()) {
            fetchingToast.setText(`Fetching ${tofetch.length} thumbnails..`);
        }
        ROOT.timeEnd("send");
        await handleGetTimes(tofetch);
    } else if(fetchingToast.showing) {
        fetchingToast.hideToast();
    }
    ROOT.pop();
}

var lastUrl = null;
setInterval(function() {
    var currentUrl = window.location;
    if(currentUrl.pathname !== lastUrl) {
        thumbnailBatch = 0;
        lastUrl = currentUrl.pathname;
        console.log("New URL; clearing thumbnail batch");
        injectScript();
        if(THUMBNAIL_INTERVAL) {
            clearInterval(THUMBNAIL_INTERVAL);
        }
        setTimeout(checkThumbnails, 1500);
        if(!IS_MOBILE) {
            THUMBNAIL_INTERVAL = setInterval(checkThumbnails, 15000);
        }
    }
    var w = HELPERS.GetVideoId(currentUrl.href);
    if(WATCHING !== w) {
        delete CACHE[w];
        WATCHING = w;
        if(w) {
            STATUS.reset();
            console.log(`Now watching ${w}`);
            vidToolTip.ClearFlavours();
            boot();
        } else {
            console.log(`Stopped watching video`);
        }
    }
    if(IS_MOBILE && WATCHING) {
        if(getVideo().getAttribute("mlapi-events") != "true")
            addVideoListeners();
        if(STATUS.HALTED) {
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
