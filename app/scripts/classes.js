
/**
 * Packets sent internally via chrome.runtime and ports.
 */ 
export class InternalPacket {
    /**
     * Gets an internal packet of the given type
     * @param {INTERNAL} type 
     * @param {*} data 
     */
    constructor(type, data) {
        this.type = type;
        this.data = data;
    }
}

/**
 * Internal packet to indicate state of video play
 */
export class StatePacket extends InternalPacket {
    /**
     * 
     * @param {boolean} playing Whether the video should play or be paused
     * @param {string} displayToolTip Text to display in video tooltip
     * @param {string} logMsg Text to log to console
     */
    constructor(playing, displayToolTip, logMsg) {
        super(INTERNAL.SET_STATE, {
            play: !!playing,
            display: displayToolTip,
            log: logMsg
        });
    }
    get play() {
        return this.data.play;
    }
    get display() {
        return this.data.display;
    }
    get log() {
        return this.data.log;
    }
}

/**
 * Represents an error sent to failure callback when a packet to the websocket fails to get a response.  
 */
export class NoResponsePacket extends InternalPacket {
    constructor(reason) {
        super(INTERNAL.NO_RESPONSE, {
            reason: reason
        });
    }
    /**
     * Whether the packet was generated because the WS was disconnected when 
     * we attempted to send our request.
     * 
     * @returns {boolean}
     */
    get wasInstant()  {
        return this.data.reason === "instant";
    }

    /**
     * Sets whether the packet was instantly failed.
     * 
     * @param {boolean} value True if the WS was disconnected when we attempted to send the packet
     */
    set wasInstant(value) {
        this.data.reason = value ? "instant" : "unknown"; 
    }
}

/**
 * Packets sent to or from websocket connection
 */
 export class WebSocketPacket {
    /**
     * Creates a packet to be sent over the websocket with provided information
     * @param {EXTERNAL} id 
     * @param {*} content 
     * @param {number} sequence 
     */
    constructor(id, content, sequence) {
        this.id = id;
        this.content = content;
        this.seq = sequence || 1;
    }
}

/**
 * An item stored in cache
 */
export class CacheItem {
    /**
     * 
     * @param {CACHE_KIND} kind 
     * @param {string} id 
     * @param {Date} cachedAt 
     */
    constructor(kind, id, cachedAt) {
        this._kind = kind;
        this.id = id;
        var type = typeof(cachedAt);
        if(type === "number") {
            this.cachedAt = new Date(cachedAt);
        } else if (type === Date.constructor.name) {
            this.cachedAt = cachedAt;
        } else {
            throw new Error("cachedAt must be number or Date, was " + typeof(cachedAt));
        }
        this.ttl = 300; // seconds to live in cache.
    }

    get Id() {
        return this.id;
    }

    get Kind() {
        return this._kind;
    }

    /**
     * Whether this cache item has expired
     * 
     * @type {boolean}
     */
    get IsExpired() {
        var expiresAt = new Date(this.cachedAt.getTime() + (this.ttl * 1000));
        return Date.now() > expiresAt;
    }

    Save() {
        return {
            _kind: this._kind,
            id: this.id,
            cachedAt: this.cachedAt.getTime()
        };
    }
}

export class YoutubeCacheItem extends CacheItem {
    constructor(id, cachedAt, vidTime) {
        super(CACHE_KIND.YOUTUBE, id, cachedAt);
        this.t = vidTime;
    }
    Save() {
        var d = super.Save();
        d.t = this.t;
        return d;
    }
}

export class RedditCacheItem extends CacheItem {
    constructor(id, cachedAt, visitedAt, count) {
        super(CACHE_KIND.REDDIT, id, cachedAt);
        this.count = count;
        this.ttl = 60 * 60; // seconds to live in cache
        this.visits = visitedAt;
    }

    get Visits() {
        return this.visits;
    }
    Save() {
        var d = super.Save();
        d.count = this.count;
        d.visits = this.visits;
        return d;
    }
}

export class TrackerCache {
    constructor() {
        this._cache = {};
        this.dirty = false;
    }

    /**
     * Places the cache item into the cache
     * @param {CacheItem} item 
     */
    Insert(item) {
        item.cachedAt = new Date();
        console.debug(`[CACHE] Inserted ${item.id} into cache at ${Date.now()}`);
        this._cache[item.id] = item;
        this.dirty = true;
    }
    /**
     * Places the cache item into the cache
     * @param {CacheItem} item 
     */
    Add(item) {
        this.Insert(item);
    }

    /**
     * Gets and returns the cached item from cache
     * @param {string} id 
     * @returns {CacheItem} The cached item, or null
     */
    Fetch(id) {
        var x = this._cache[id];
        if(x) {
            if(x.IsExpired) {
                console.debug(`[CACHE] Found ${id}, but ttl has expired`, x);
                delete this._cache[id];
                return null;
            }
            var hasBeenInCache = Date.now() - x.cachedAt.getTime();
            console.debug(`[CACHE] Found ${id} in cache, ttl remaining: ${x.ttl - (hasBeenInCache/1000)}s`, x);
        } else {
            console.debug(`[CACHE] Could not find ${id} in cache`);
        }
        return x;
    }
    /**
     * Gets and returns the cached item from cache
     * @param {string} id 
     * @returns {CacheItem} The cached item, or null
     */
    Get(id) {
        return this.Fetch(id);
    }

    Clear() {
        console.debug("[CACHE] Cleared cache.");
        this._cache = {};
    }

    Save() {
        var sv = [];
        for(let key in this._cache) {
            var item = this._cache[key];
            if(!item.IsExpired) {
                sv.push(item.Save());
            }
        }
        this.dirty = false;
        return sv;
    }

    Load(data) {
        console.log("Loading cache: ", data);
        for(var obj of data) {
            if(obj._kind === CACHE_KIND.YOUTUBE) {
                this.Add(new YoutubeCacheItem(obj.id, obj.cachedAt, obj.t));
            } else {
                this.Add(new RedditCacheItem(obj.id, obj.cachedAt, obj.visits, obj.count))
            }
        }
    }
}

export class WebSocketQueue {
    constructor() {
        this._queue = [];
        this._waiting = 0;
        this._last = 0;
        this._saved = false;
        this._retries = 0;
    }

    /**
     * Queues a packet to be sent along the websocket
     * @param {WebSocketPacket} packet 
     */
    Enqueue(packet) {
        this._saved = false;
        this._queue.push(packet);
    }

    Reset() {
        this._waiting = 0;
        this._last = 0;
        this._saved = false;
        this._retries = 0;
    } 

    /**
     * Gets an array of packets to persist
     */
    Perist() {
        var a = [];
        var changed = {
            times: false,
            threads: false
        }
        var setTimes = {};
        var visitThread = {};
        var sequence = 1;
        for(let item of this._queue) {
            if([EXTERNAL.GET_LATEST,
                EXTERNAL.GET_THREADS,
                EXTERNAL.GET_VERSION,
                EXTERNAL.GET_TIMES].includes(item.id)) {
                    continue;
            } else {
                if(item.id === EXTERNAL.SET_TIMES) {
                    changed.times = true;
                    for(let key in item.content) {
                        setTimes[key] = item.content[key];
                    }
                } else if(item.id === EXTERNAL.VISITED_THREAD) {
                    changed.threads = true;
                    visitThread[item.content.id] = item.content.count;
                } else {
                    if(item.seq > sequence)
                        sequence = item.seq + 1;
                    a.push(item);
                }
            }
        }
        if(changed.times) {
            a.push(new WebSocketPacket(EXTERNAL.SET_TIMES, setTimes, sequence++));
        }
        if(changed.threads) {
            for(let key in visitThread) {
                a.push(new WebSocketPacket(EXTERNAL.VISITED_THREAD, {
                    id: key,
                    count: visitThread[key]
                }, sequence++));
            }
        }
        console.warn(`Purging internal queue of ${this.Length() - a.length} transitive packets`);
        this._queue = a;
        if(this.Get(this._waiting)) {
        } else {
            console.log("Packet we were waiting on has been purged, resetting queue...");
            this.Reset();
        }
        return a;
    }

    Get(seq) {
        for(var i = 0; i < this._queue.length; i++) {
            if(this._queue[i].seq === seq) {
                return this._queue[i];
            }
        }
        return null;
    }

    Waiting() {
        if(this._waiting) {
            var x = {
                packet: this.Get(this._waiting),
                firstSent: this._last,
                retries: this._retries
            }
        }
        return x;
    }

    /**
     * Gets the time, in ms, after which we should retry the given packet type
     * @param {number} packetId 
     */
    RetryAfter(packetId) {
        if(typeof packetId === "object") {
            if(packetId.firstSent) {
                return this.RetryAfter(packetId.packet);
            } 
            return this.RetryAfter(packetId.id);
        }

        if(packetId === EXTERNAL.GET_THREADS 
            || packetId === EXTERNAL.GET_TIMES
            || packetId === EXTERNAL.GET_LATEST)
            return 10000;
        return 5000;
    }

    /**
     * Gets the first packet in the queue
     */
    Next() {
        if(this._waiting === 0 && this._queue.length > 0) {
            var p = this._queue[0];
            this._waiting = p.seq;
            this._last = Date.now();
            this._retries = 0;
            return p;
        }
        return null;
    }

    Remove(seq) {
        for(var i = 0; i < this._queue.length; i++) {
            if(this._queue[i].seq === seq) {
                this._queue.splice(i, 1);
                this._saved = false;
                return true;
            }
        }
        return false;
    }

    MarkDone(seq) {
        this._waiting = 0;
        this._last = null;
        this._retries = 0;
        return this.Remove(seq);
    }

    Length() {
        return this._queue.length;
    }
}

export const CACHE_KIND = {
    YOUTUBE: "video",
    REDDIT: "reddit"
}


/**
 * Types for packets sent internally, between background and content scripts.
 */
export const INTERNAL = {
    SET_STATE: "setState",
    GET_LATEST: "getLatest",
    GET_TIMES: "getTimes",
    GOT_TIMES: "gotTimes",
    SEND_LATEST: "sendLatest",
    NAVIGATE_ID: "navigateId",
    UPDATE: "update",
    GET_REDDIT_COUNT: "getRedditCount",
    SEND_REDDIT_COUNT: "sendRedditCount",
    REDDIT_VISITED: "redditVisited",
    IGNORED_VIDEO: "ignoredVideo",
    NO_RESPONSE: "noResponse"
}

/**
 * Ids for packets sent from background to websocket.
 */
export const EXTERNAL = {
    UPDATE_IGNORED_VIDEOS: "UpdateIgnored",
    VISITED_THREAD: "VisitedThread",
    GET_THREADS: "GetThreads",
    GET_TIMES: "GetTimes",
    GET_LATEST: "GetLatest",
    SET_TIMES: "SetTimes",
    GET_VERSION: "GetVersion"
}

export function pad(n, width, z) {
    z = z || '0';
    n = n + '';
    return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}


export const HELPERS = {
    /**
     * Returns the formatted representation of the time in seconds (eg, hh:mm:ss or mm:ss if below an hour)
     * @param {number} diff Time in seconds
     */
    ToTime: function (diff) {
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
    },
    GetVideoId(url) {
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
}

export class VideoToolTipFlavour {
    constructor(text, style, duration) {
        this.text = text;
        this.style = style;
        if(!this.style.marginLeft)
            this.style.marginLeft = "3px";
        this.expires = duration === -1 ? false : Date.now() + duration;
        console.debug(`Created flavour of ${duration}ms, with: `, text, this.style);
    }
    IsExpired() {
        if(this.expires === false)
            return false;
        return Date.now() > this.expires;
    }
    ToElement() {
        var elem = document.createElement("span");
        elem.innerText = this.text;
        for(let key in this.style)
            elem.style[key] = this.style[key];
        return elem;
    }
}

export class VideoToolTip {
    defaultStyle() {
        return {};
    }
    
    constructor() {
        this._savedTime = null;
        this._paused = false;
        this._ended = false;
        this._style = this.defaultStyle();

        this._flavours = {
            error: null,
            extra: []
        }

        this._dirty = false;
        this._sequence = 0;
    }

    iter() {
        return this._sequence++;
    }
    
    /**
     * Gets the current saved time, formatted.
     * @returns {string}
     */
    get SavedTime()  {
        return this._savedTime;
    }
    /**
     * Sets the current saved time, either as a formatted string or number.
     * @param {string|number} value The time, either as a number in seconds or formatted hh?:mm:ss
     */
    set SavedTime(value) {
        if(typeof value === "string")
            this._savedTime = value;
        else if(typeof value === "number")
            this._savedTime = HELPERS.ToTime(value);
        else throw new TypeError(`Value invalid type of '${typeof value}'`);

        this._dirty = true;
    }

    /**
     * Whether the video is currently paused
     * @returns {boolean}
     */
    get Paused() {
        return this._paused;
    }
    /**
     * Sets a value as to whether the video is paused
     * @param {boolean} value
     */
    set Paused(value) {
        if(typeof value !== "boolean")
            throw new TypeError(`Value invalid type of '${typeof value}'`);
        this._paused = value;
        this._dirty = true;
    }

    /** 
     * Gets a value as to whether the video has ended playback 
     * @returns {boolean}
     */
    get Ended() {
        return this._ended;
    }
    /**
     * Sets a value as to whether the video has completed
     * 
     * @param {boolean} value
     */
    set Ended(value) {
        if(typeof value !== "boolean")
            throw new TypeError(`Value invalid type of '${typeof value}'`);
        this._ended = value;
        this._dirty = true;
    }

    /**
     * Gets the error value
     * @returns {VideoToolTipFlavour}
     */
    get Error() {
        return this._flavours.error;
    }

    /**
     * Sets the error value
     * @param {VideoToolTipFlavour} value
     * @returns {undefined}
     */
    set Error(value) {
        if(typeof value !== "object")
            throw new TypeError(`Value invalid type of '${typeof value}'`);
        this._flavours.error = value;
        this._dirty = true;
    }

    AddFlavour(flavour) {
        var id = this.iter();
        flavour.id = id;
        this._flavours.extra.push(flavour);
        this._dirty = true;
        return id;
    }
    RemoveFlavour(id) {
        var i = 0;
        while( i < this._flavours.extra.length) {
            var x = this._flavours.extra[i];
            if(x.id === id || x.IsExpired()) {
                this._flavours.extra.splice(i, 1);
                console.debug(`Removing flavour ${id}`);
                return true;
            } else {
                i++;
            }
        }
        return false;
    }
    /**
     * Removes all current flavours
     */
    ClearFlavours() {
        var i = 0;
        while( i < this._flavours.extra.length) {
            this._flavours.extra.splice(i, 1);
            i++;
        }
    }

    /**
     * Gets the overall style to be applied to the element
     */
    get Style() {
        return this._style;
    }
    set Style(value) {
        this._style = value;
        this._dirty = true;
    }

    /**
     * @returns {Element}
     */
    Build() {
        var span = document.createElement("span");
        for(let key in this._style)
            span.style[key] = this._style[key];
        span.innerText = this._savedTime;
        if(this._ended)
            span.innerText += " (E)";
        else if (this._paused)
            span.innerText += " (P)";
        if(this._flavours.error) {
            if(!this._flavours.error.IsExpired()) {
                span.appendChild(this._flavours.error.ToElement());
            }
        }
        var i = 0;
        while( i < this._flavours.extra.length) {
            var x = this._flavours.extra[i];
            if(x.IsExpired()) {
                this._flavours.extra.splice(i, 1);
            } else {
                i++;
                span.appendChild(x.ToElement());
            }
        }
        if(this._dirty) {
            this._dirty = false;
            console.log(`New tooltip: `, span);
        }
        return span;
    }
}

export class ConsistentToast {
    constructor(config) {
        this.config = config;
        this.toast = null;
    }
    setText(text) {
        if(this.toast) {
            this.toast.toastElement.innerText = text;
        } else {
            this.config.text = text;
            this.toast = Toastify(this.config);
            this.toast.showToast();
        }
    }
    hideToast() {
        if(this.toast) {
            this.toast.hideToast();
            this.toast = null;
        }
    }
    get showing() {
        return !!this.toast;
    }
}

export class StateInfo {
    constructor() {
        this.reset();
    }

    reset() {
        this._fetch = false;
        this._sync = false;
        this._playlist = false;
        this._halted = false;
        this._loaded = false;
        this._ad = false;
        this._badges = null;
    }
    
    /**
     * @returns {boolean} Whether we should fetch this video's start time
     */
    get FETCH() {
        return this._fetch;
    }
    set FETCH(value) {
        this._fetch = !!value;
    }

    /**
     * @returns {boolean} Whether we're waiting for an advertisement to finish playing
     */
    get AD() {
        return this._ad;
    }
    set AD(value) {
        this._ad = !!value;
    }

    /**
     * @returns {boolean} Whether we should update the current saved time for this video
     */
    get SYNC() {
        return this._sync;
    }   
    set SYNC(value) {
        this._sync = value;
    }

    /**
     * @returns {boolean} Whether the video is in a playlist
     */
    get PLAYLIST() {
        return this._playlist;
    }
    set PLAYLIST(v) {
        this._playlist = v;
    }

    /**
     * @returns {boolean} Whether the video is forcefully stopped from playing
     */
    get HALTED() {
        return this._halted;
    }
    set HALTED(v) {
        this._halted = v;
    }

    get LOADED() {
        return this._loaded;
    }
    set LOADED(v) {
        this._loaded = v;
    }

    get BADGES() {
        return this._badges;
    }
    set BADGES(v) {
        this._badges = v;
    }

    /**
     * Marks FETCH and SYNC as `false`
     */
    IGNORE() {
        this._sync = false;
        this._fetch = false;
        this._loaded = true;
    }

}

export class BatchUpdater {
    constructor(period) {
        this.lastUpdate = null;
        this.oldestUpdate = null;
        this.data = null;
        this.length = 0;
        this.period = period * 1000;
    }
    diff() {
        return Date.now() - this.lastUpdate;
    }
    canSend() {
        return this.length > 0 && this.diff() > this.period;
    }
    clear() {
        this.length = 0;
        this.oldestUpdate = null;
    }
    _update(amount) {
        this.length += amount;
        this.lastUpdate = Date.now();
        if(!this.oldestUpdate) {
            this.oldestUpdate = this.lastUpdate;
        }
    }
}
export class BatchGetUpdater extends BatchUpdater {
    constructor(period) {
        super(period);
        this.data = [];
    }
    push(id) {
        this.data.push(id);
        this._update(1);
    } 
    fetch(amount) {
        var q = this.data.splice(0, amount);
        this.length -= q.length;
        return q;
    }
    contains(id) {
        return id in this.data;
    }
    clear() {
        super.clear();
        this.data = [];
    }
}
export class BatchSetUpdater extends BatchUpdater {
    constructor(period) {
        super(period);
        this.data = {};
    }
    diff() {
        var d1 = super.diff();
        var d2 = Date.now() - this.oldestUpdate;
        return Math.max(d1, d2);
    }
    update(id, value) {
        const existing = this.data[id];
        this.data[id] = value;
        if(existing) {
            // already there, so no new item
            this._update(0);
        } else {
            // not there, so its new
            this._update(1);
        }
    }
    clear() {
        super.clear();
        this.data = {};
    }
    fetch() {
        var q = this.data;
        this.clear();
        return q;
    }
}

export class DebugTimer {
    /**
     * 
     * @param {Boolean} log 
     */
    constructor(log) {
        this.prefixes = []
        this.log = log;
        this.timers = {};
    }
    push(pfx) {
        this.prefixes.push(pfx);
        this.time();
    }
    pop() {
        var x = this.timeEnd();
        this.prefixes.pop();
        return x;
    }
    prefix() {
        return this.prefixes.join("::");
    }
    time(pfx) {
        var v = this.prefix();
        if(pfx) v += "::" + pfx;
        this.timers[v] = window.performance.now();
        if(this.log)
            console.time(v);
    }
    timeEnd(pfx) {
        var v = this.prefix();
        if(pfx) v += "::" + pfx;
        var diff = -1;
        if(v in this.timers) {
            diff = window.performance.now() - this.timers[v];
            delete this.timers[v];
        }
        if(this.log)
            console.timeEnd(v);
        return diff;
    }
}

export class DeferredPromise {
    constructor(timeout) {
        this.isResolved = false;
        this.isRejected = false;
        this.promise = new Promise((resolve, reject)=> {
            this.reject = (reason) => {
                this.isRejected = true;
                console.log("Rejecting deferred promise ", reason);
                reject(reason);
            };
            this.resolve = (reason) => {
                console.log("Resolving deferring promise ", reason);
                this.isResolved = true;
                clearTimeout(this.tm);
                resolve(reason);
            };
            if(timeout) {
                this.tm = setTimeout(() => {
                    if(!this.isResolved)
                        this.reject("Timed out");
                }, timeout)
            }
        })
    }
}

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

export var getObjectLength =
    Object.keys ? ObjectLength_Modern : ObjectLength_Legacy;
