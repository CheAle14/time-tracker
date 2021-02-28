
/**
 * Packets sent internally via chrome.runtime and ports.
 */ 
class InternalPacket {
    constructor(type, data) {
        this.type = type;
        this.data = data;
    }
}

/**
 * Packets sent to or from websocket connection
 */
class WebSocketPacket {
    constructor(id, content, sequence) {
        this.id = id;
        this.content = content;
        this.seq = sequence || 0;
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
        super("setState", {
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
 * Internal Packet Types 
 */
const TYPE = {
    SET_STATE: "setState",
    GET_LATEST: "getLatest",
    SEND_LATEST: "sendLatest",
    NAVIGATE_ID: "navigateId",
    UPDATE: "update"
}