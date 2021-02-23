/**
 * Internal packet to indicate state of video play
 */
class StatePacket {
    /**
     * 
     * @param {boolean} playing Whether the video should play or be paused
     * @param {string} displayToolTip Text to display in video tooltip
     * @param {string} logMsg Text to log to console
     */
    constructor(playing, displayToolTip, logMsg) {
        this.type = "setState";
        this.data = {
            play: !!playing,
            display: displayToolTip,
            log: logMsg
        }
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