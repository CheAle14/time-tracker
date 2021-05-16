console.log("Reddit content script loaded!");

var SEQUENCE = 1;
var CALLBACKS = {};
/**
 * Sends a message to the port
 * @param {InternalPacket} packet 
 * @param {function} callback 
 */
function postMessage(packet, callback) {
    if(callback) {
        packet.seq = SEQUENCE++;
        CALLBACKS[packet.seq] = callback;
    }
    console.debug(`[PORT] >>`, packet);
    port.postMessage(packet);
}

function getThingId(url) {
    if(typeof url !== "string") {
        url.cacheId = url.cacheId || getThingId(url.href);
        return url.cacheId;
    }
    url = url || window.location.href;
    var mtch = url.match(/comments\/([a-z0-9]{5,7})\//m);
    console.log(mtch);
    if(mtch) {
        return mtch[1];
    }
    return null;
}

const ID = getThingId(window.location.href);
const config = {
    'prefer_edited_time': 1,
    'use_color_gradient': 1,
    'color_newer': 'hsl(210, 100%, 65%)',
    'color_older': 'hsl(210, 100%, 90%)',
    'apply_on': 'text',
    'comment_style': 'background-color: %color !important;\npadding: 0 5px;',

    'history': { },
    'history_expiration': 7, /* in days */
};
var port = chrome.runtime.connect();
console.log("Connected to port");
port.onMessage.addListener(function(message, sender, response) {
    console.debug("[PORT] <<", message);



    if(message.res !== undefined) {
        var cb = CALLBACKS[message.res]
        delete CALLBACKS[message.res]
        console.log(`[PORT] Invoking callback handler for ${message.res}`);
        cb(message);
    }
});

function find(arr, p) {
    for(var el of arr)
        if(p(el))
            return el;
    return null;
}

function getCount(anchor) {
    var text = anchor.innerText;
    var split = text.split(" ");
    return split.length === 1 ? 0 : parseInt(split[0]);
}

function handleInfo(anchors, data) {
    for(var anchor of anchors) {
        var id = getThingId(anchor);
        var obj = data[id];
        if(!obj) {
            continue;
        }
        var currentCount = getCount(anchor);
        if(currentCount > obj.count) {
            var newSpan = document.createElement("span");
            newSpan.innerText = ` (${currentCount - obj.count} new)`;
            newSpan.classList.add("newComments");
            newSpan.style.color = "rgb(255, 69, 0)"
            anchor.appendChild(newSpan);
        }
    }

    if(!ID) {
        return;
    }
    if(document.getElementById("noresults")) {
        return;
    }
    var threadData = data[ID];
    if(!threadData) {
        return;
    }
    highlight(new Date(threadData.when));
}

function highlight(since) {
    let comments = document.getElementsByClassName('comment'),
			username
		;


    if (document.body.classList.contains('loggedin')) {
        username = document.getElementsByClassName('user')[0].firstElementChild.textContent;
    }

    for (let comment of comments) {
        /* skip removed or deleted comments */
        if (comment.classList.contains('deleted') || comment.classList.contains('spam')) {
            continue;
        }

        /* skip our own comments */
        let author = comment.getElementsByClassName('author')[0].textContent;
        if (username && username == author) {
            continue;
        }

        /* select original or edited comment time */
        let times = comment.getElementsByClassName('tagline')[0].getElementsByTagName('time'),
            time  = Date.parse(times[times.length - 1].getAttribute('datetime'))
        ;


        /* add styles */
        if (time > since) {
            comment.classList.add('hnc_new');
            let elements = {
                'comment': comment,
                'text': comment.getElementsByClassName('usertext-body')[0].firstElementChild,
                'time': comment.getElementsByClassName('live-timestamp')[0],
            };
            elements["time"].setAttribute('style', generate_comment_style(time, since));
        }
    }
}

function generate_comment_style(comment_time, since) {
    let style = config.comment_style;

    style = style.replace(/\s+/g, ' ');
    style = style.replace(/%color/g, this.get_color(Date.now() - comment_time, Date.now() - since));

    return style;
}


function get_color(comment_age, highlighting_since) {

    if (comment_age > highlighting_since - 1) {
        return config.color_older;
    }

    let time_diff = 1 - comment_age / highlighting_since,
        color_newer   = tinycolor(config.color_newer).toHsl(),
        color_older   = tinycolor(config.color_older).toHsl()
    ;

    let color_final = tinycolor({
        h: color_older.h + (color_newer.h - color_older.h) * time_diff,
        s: color_older.s + (color_newer.s - color_older.s) * time_diff,
        l: color_older.l + (color_newer.l - color_older.l) * time_diff,
    });

    return color_final.toHslString();
}

function getInfos() {
    var elements = document.getElementsByClassName("comments");
    var arr = [];
    /*if(ID) {  // Seems to be included in the above
        arr.push(ID);
    }*/
    for(var el of elements) {
        arr.push(getThingId(el));
    }
    postMessage(new InternalPacket(TYPE.GET_REDDIT_COUNT, arr), function(r) {
        console.log("Callback", r);
        if(ID) {
            var anchor = find(elements, (x) => getThingId(x) == ID);
            postMessage(new InternalPacket(TYPE.REDDIT_VISITED, {
                id: ID,
                count: getCount(anchor)
            }));
        }
        handleInfo(elements, r.data);
    })
}

getInfos();