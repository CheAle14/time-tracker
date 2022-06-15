var port = chrome.runtime.connect();
var CONNECTED = true;
const STATUS = new StateInfo();
var PRIOR_STATE = null; // whether the video was playing when we disconnected
var CALLBACKS = {};
var FAILS = {};
var SEQUENCE = 1;
var BLACKLISTED_VIDEOS = {};
var THUMBNAIL_ELEMENTS = {};

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

const injectedScript ="(" +
  function() {
    console.log("Script Injected");


    const extractFromGridRenderer = (gridRenderer) => {
        console.log("Looking at ", gridRenderer);
        var ids = [];
        if(gridRenderer.videoId) {
            ids.push(gridRenderer.videoId);
        }
        const items = gridRenderer.items;
        if(items) {
            for(let item of items) {
                if(item.gridVideoRenderer) {
                ids.push(item.gridVideoRenderer.videoId);
                }
            }
        }
        return ids;
    };

    const extractFromVideoWithContextRenderer = (vidR) => {
        console.log("Looking at ", vidR);

        return [vidR.videoId];
    };

    const extractIds = (js) => {
        var ids = [];

        const actions = js.onResponseReceivedActions;
        if(!actions) return null;

        const appendAction = actions[0];
        if(!appendAction) return null;

        const continuationActions = appendAction.appendContinuationItemsAction;
        if(!continuationActions) return null;

        const continuationItems = continuationActions.continuationItems;
        console.log(continuationItems);
        for(let continueItem of continuationItems) {
            console.log("Section item: ", continueItem);

            if(continueItem.gridVideoRenderer) {
                var gridIds = extractFromGridRenderer(continueItem.gridVideoRenderer);
                console.log("For section grid, found: ", gridIds);
                ids = ids.concat(gridIds);
            }

            if(continueItem.richItemRenderer) {
                if(continueItem.richItemRenderer.content) {
                    if(continueItem.richItemRenderer.content.videoWithContextRenderer) {
                        ids = ids.concat(extractFromVideoWithContextRenderer(continueItem.richItemRenderer.content.videoWithContextRenderer));
                    }
                }
            }

            const sectionRenderer = continueItem.itemSectionRenderer;
            if(sectionRenderer) {
                const sectionContents = sectionRenderer.contents;
                for(let content of sectionContents) {
                    if(content.shelfRenderer) {
                        const gridRenderer = content.shelfRenderer.content.gridRenderer;
                        ids = ids.concat(extractFromGridRenderer(gridRenderer));
                    } else if(content.videoWithContextRenderer) {
                        ids = ids.concat(extractFromVideoWithContextRenderer(content.videoWithContextRenderer))
                    }
                }
            }
        }

        return ids;
    };

    // define monkey patch function
    const monkeyPatch = () => {
        // intercept requests to try and catch when a new batch of videos is requested
        const {fetch: origFetch} = window;
        window.fetch = async (...args) => {
            const orig = await (await origFetch(...args));
            const response = orig.clone();
            if(response.url.indexOf("youtubei/v1/browse") >= 0) {
                console.log("This is a browse request!");
                response
                  .json()
                  .then(js => {
                    console.log("Browse data: ", js);
                    var ids = extractIds(js);
                    const event = new CustomEvent("data", {detail: ids});
                    console.log("Ids fetched: ", ids);
                    if(ids) document.getElementById("injectHolder").dispatchEvent(event);

                  })
                  .catch(err => {
                      console.error("Browse error: ", err);
                  })
            }
            
            /* the original response can be resolved unmodified: */
            return orig;
        };
    };
    monkeyPatch();
  } + ")();";


function injectScript() {
    console.log("Injecting Script now");
    var script = document.createElement("script");
    script.textContent = injectedScript;
    (document.head || document.documentElement).appendChild(script);
    script.remove();

    if(document.getElementById("injectHolder")) return;
    const injectHolder = document.createElement("div");
    injectHolder.setAttribute("id", "injectHolder");
    document.body.appendChild(injectHolder);

    injectHolder.addEventListener("data", function(e) {
        console.log("Got data: ", e.detail);
        postMessage({type: "getTimes", data: e.detail});
        setTimeout(function() {
            var mf = setThumbnails();
            console.log("Inject found: ", mf);

            var mustF = [];
            for(let x of mf) {
                if(e.detail.includes(x)) {
                } else {
                    mustF.push(x);
                }
            }
            console.log("Inject must fetch additional: ", mustF);
            postMessage({type: "getTimes", data: mustF});

        }, 4000);
    })
}



function postMessage(packet, callback, failure) {
    if(callback) {
        packet.seq = SEQUENCE++;
        CALLBACKS[packet.seq] = callback;
    }
    if(failure) {
        if(!packet.seq)
            packet.seq = SEQUENCE++;
        FAILS[packet.seq] = failure;
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
    if(message.type === "blacklists") {
        BLACKLISTED_VIDEOS = message.data;
    } else if(message.type === "gotTimes") {
        for(let a in message.data) {
            CACHE[a] = message.data[a];
        }
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
    }
    if(message.res) {
        var cb = CALLBACKS[message.res]
        if(cb) {
            delete CALLBACKS[message.res]
            console.log(`[PORT] Invoking callback handler for ${message.res}`);
            cb(message);
        }

        var fl = FAILS[message.res];
        if(fl) {
            delete FAILS[message.res];
            console.log(`[PORT] Invoking error handler for ${message.res}`);
            if(message.type === INTERNAL.NO_RESPONSE) {
                message = new NoResponsePacket(message.data.reason);
            }
            fl(message);
        }
    }
    if(CONNECTED === false) {
        // we were disconnected, but now we're back!
        // this logic doesn't seem to work
        // being disconnected also means we can't call chrome.runtime.connect()
        // so i'm reloading the page instead.
        CONNECTED = true;
        STATUS.HALTED = false;
        console.log("Reconnected!");
        errorToast.hideToast();
        if(PRIOR_STATE === true) {
            console.log("Was previously playing, so attempting to play..");
            play();
        } else if(PRIOR_STATE === false) {
            pause("Reconnected, previously paused, re-pausing");
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
        STATUS.HALTED = true;
        CONNECTED = false;
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

    } else {
        reconnects = reconnects + 1;
        errorToast.setText(`Reconnecting to backend, ${reconnects} attempts`);
    }
    /*setTimeout(function() {
        //connectToExtension();
        window.location.reload();
    }, 1000);*/
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
    var startIndex = url.indexOf("?v=");
    if(startIndex === -1)
        return null;
    var id = url.substring(startIndex + 3);

    var index = id.indexOf("&");
    if(index !== -1) {
        id = id.substring(0, index);
    }
    index = id.indexOf("#");
    if(index !== -1) {
        id = id.substring(0, index);
    }
    return id;
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

const THUMBNAIL_NODE = IS_MOBILE ? "YTM-THUMBNAIL-OVERLAY-TIME-STATUS-RENDERER" : "SPAN";
function* getThumbnails() {
    var elements = null;
    if(IS_MOBILE) {
        elements = document.getElementsByTagName("ytm-thumbnail-overlay-time-status-renderer");
    } else {
        elements = document.getElementsByClassName("style-scope ytd-thumbnail-overlay-time-status-renderer");
    }
    for(let e of elements) {
        if(e.tagName === THUMBNAIL_NODE)
            yield e;
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
        doc = document.getElementsByTagName("ytm-playlist")[0];
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
    var anchor = element.parentElement.parentElement.parentElement;
    var id = getId(anchor.href);
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
    rtn = "undefined";
    if(id in CACHE) {
        var time = CACHE[id];
        var perc = time / vidLength;
        if(perc >= 0.9) {
            ROOT.time("in-0.9");
            element.innerText = `✔️ ${HELPERS.ToTime(vidLength)}`;
            element.style.color = "green";
            element.style.backgroundColor = "white";
            ROOT.timeEnd("in-0.9");
        } else if(perc > 0) {
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
            THUMBNAIL_ELEMENTS[id] = element;
            rtn = "fetch";
            ROOT.timeEnd("not-fetch");
        }
    }
    ROOT.pop();
    return rtn;
}

var thumbnailBatch = 0;
function setThumbnails() {
    //console.log(CACHE);
    var mustFetch = []
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
            mustFetch.push(data.id);
        } else if(rtn === "fetching") {
            thoseWaiting += 1;
        }
        
        ROOT.pop();
        var accTimeSpent = window.performance.now() - timeStart;
        console.debug(`setThumbnails - After ${done} total time now ${accTimeSpent}ms`);
    }
    console.log(`setThumbnails looked at ${done}; taking ${window.performance.now() - timeStart}ms. Must fetch: ${mustFetch.length}, waiting: ${thoseWaiting}`);
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

function setTimes(ids) {
    thumbnailBatch = 0;
    //var mustFetch = setThumbnails();

    for(let id in ids) {
        const elem = THUMBNAIL_ELEMENTS[id];
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
        console.log("Video play stopped; ", CONNECTED, STATUS);
        if(STATUS.HALTED)
            return;
        if(STATUS.SYNC == false)
            return;
        if(CONNECTED)
            saveTime();
        clearInterval(videoSync);
        vidToolTip.Paused = true;
    };
    vid.onplay = function() {
        console.log("Video play started; ", CONNECTED, STATUS);
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
        if(CONNECTED === false) {
            pause("Played, but not CONNECTED");
            console.error("Cannot play video: not syncing");
            return;
        }
        setInterval(videoSync, 5000);
        vidToolTip.Paused = false;
        vidToolTip.Ended = false;
        flavRemoveSave.push(vidToolTip.AddFlavour(new VideoToolTipFlavour("Sync started", {color: "green"}, -1)));
    };
    vid.onended = function() {
        console.log("Video play ended; ", CONNECTED, STATUS);
        if(STATUS.HALTED)
            return;
        if(STATUS.SYNC == false)
            return;
        saveTime();
        clearInterval(videoSync);
        vidToolTip.Ended = true;
    }
    vid.setAttribute("mlapi-events", "true")
}

function boot() {
    WATCHING = getId();
    thumbnailBatch = 0;
    if(WATCHING) {
        var length = getVideoLength();
        var playlist = isInPlaylist();
        console.log(`Loaded watching ${WATCHING} of duration `, length, "; playlist: ", playlist);

        if(WATCHING in BLACKLISTED_VIDEOS) {
            console.log("Video blacklisted, ignoring");
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
            console.log("Video nominal, pausing")
            pause(`Boot, length ${typeof length} ${length}; playlist: ${playlist}`);
            if(IS_MOBILE === false)
                addVideoListeners();
            postMessage({type: "setWatching", data: WATCHING}, null, function(err) {
                console.error("Could not set watching ", err);
                vidToolTip.AddFlavour(new VideoToolTipFlavour("Failed to fetch video time " + err.data.reason, {color: "red"}, -1));
                CACHE[WATCHING] = 0;
                setTimes([WATCHING]);
            });
            watchingToast.setText("Fetching video saved time..");
            flavRemoveLoaded.push(vidToolTip.AddFlavour(new VideoToolTipFlavour("Fetching..", {color: "blue"}, 5000)));
            STATUS.SYNC = true;
            STATUS.FETCH = true;
        }
    }
}

function saveTime() {
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
    navigateToPort = {};
    var time = getVideo().currentTime;
    navigateToPort[WATCHING] = time;
    CACHE[WATCHING] = time;
    postMessage({type: "setTime", data: navigateToPort});
    setQueryTime(time);
}

function videoSync() {
    if(getVideo().paused || STATUS.HALTED)
        return;
    if(STATUS.LOADED == false)
        return;
    saveTime();
    if(isWatchingFullScreen()) {
        clearToasts();
        return;
    }
}

function clearToasts() {
    fetchingToast.hideToast();
    watchingToast.hideToast();
}

function checkThumbnails() {
    const ROOT = new DebugTimer();
    ROOT.push("checkThumbnails");
    ROOT.time("thumbnails");
    var tofetch = setThumbnails();
    ROOT.timeEnd("thumbnails")
    if(tofetch.length > 0) {
        ROOT.time("send");
        postMessage({type: "getTimes", data: tofetch});
        if(!isWatchingFullScreen()) {
            fetchingToast.setText(`Fetching ${tofetch.length} thumbnails..`);
        }
        ROOT.timeEnd("send");
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
        setTimeout(checkThumbnails, 1500);
    }
    var w = getId(currentUrl.href);
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
