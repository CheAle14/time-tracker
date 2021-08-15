
/**
 * Packets sent internally via chrome.runtime and ports.
 */ 
class InternalPacket {
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
class StatePacket extends InternalPacket {
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
class NoResponsePacket extends InternalPacket {
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
 class WebSocketPacket {
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
class CacheItem {
    /**
     * 
     * @param {CACHE_KIND} kind 
     * @param {string} id 
     * @param {Date} cachedAt 
     */
    constructor(kind, id, cachedAt) {
        this._kind = kind;
        this.id = id;
        this.cachedAt = cachedAt;
        this.ttl = 15; // seconds to live in cache.
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
        return expiresAt > Date.now();
    }
}

class YoutubeCacheItem extends CacheItem {
    constructor(id, cachedAt, vidTime) {
        super(CACHE_KIND.YOUTUBE, id, cachedAt);
        this.t = vidTime;
    }
}

class RedditCacheItem extends CacheItem {
    constructor(id, cachedAt, count) {
        super(CACHE_KIND.REDDIT, id, cachedAt);
        this.count = count;
        this.ttl = 60 * 60; // seconds to live in cache
    }
}

class TrackerCache {
    constructor() {
        this._cache = {};
    }

    /**
     * Places the cache item into the cache
     * @param {CacheItem} item 
     */
    Insert(item) {
        this._cache[item.Id] = item;
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
                console.debug(`Found in cache, but ttl expired. `, x);
                delete this._cache[id];
                return null;
            }
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
        this._cache = {};
    }
}

class WebSocketQueue {
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
                    a.push(item);
                }
            }
        }
        if(changed.times) {
            a.push(new WebSocketPacket(EXTERNAL.SET_TIMES, setTimes));
        }
        if(changed.threads) {
            for(let key in visitThread) {
                a.push(new WebSocketPacket(EXTERNAL.VISITED_THREAD, {
                    id: key,
                    count: visitThread[key]
                }));
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

const CACHE_KIND = {
    YOUTUBE: "video",
    REDDIT: "reddit"
}


/**
 * Types for packets sent internally, between background and content scripts.
 */
const INTERNAL = {
    SET_STATE: "setState",
    GET_LATEST: "getLatest",
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
const EXTERNAL = {
    UPDATE_IGNORED_VIDEOS: "UpdateIgnored",
    VISITED_THREAD: "VisitedThread",
    GET_THREADS: "GetThreads",
    GET_TIMES: "GetTimes",
    GET_LATEST: "GetLatest",
    SET_TIMES: "SetTimes",
    GET_VERSION: "GetVersion"
}


const HELPERS = {
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
    }
}

class VideoToolTipFlavour {
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

class VideoToolTip {
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

class ConsistentToast {
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