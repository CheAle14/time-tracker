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
        var x = url.getAttribute("hnc-thingId");
        if(!x) {
            x = getThingId(url.href);
            url.setAttribute("hnc-thingId", x);
        }
        return x;
    }
    url = url || window.location.href;
    var mtch = url.match(/comments\/([a-z0-9]{5,7})\//m);
    if(mtch) {
        var x = mtch[1];
        return x;
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
port.onDisconnect.addListener(function() {
    console.log("Disconnected from extension background, reloading page!");
    window.location.reload();
})

function find(arr, p) {
    for(var el of arr)
        if(p(el))
            return el;
    return null;
}

function getCount(anchor) {
    var text = anchor.innerText;
    var mtch = text.match(/[0-9]+/m);
    if(mtch) {
        console.log(mtch);
        return parseInt(mtch[0]);
    } else {
        console.warn("Could not find count from anchor ", anchor);
        return 0;
    }
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
        } else {
            anchor.style.color = "#009900";
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
    highlight(new Date(threadData.cachedAt));
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

function getThreadCommentLinks() {
    var done = {};
    var anchors = [];
    var id = Date.now();
    for(let className of ["full-comments", "search-comments"]) {
        for(let a of document.getElementsByClassName(className)) {
            anchors.push(a);
            a.setAttribute("hnc-discovered", `class:${id}`);
        }
    }
    for(let a of document.getElementsByClassName("bylink may-blank")) {
        if(a.innerText.indexOf("comment") !== -1 && getThingId(a)) {
            var existing = a.getAttribute("hnc-discovered");
            if(existing == null || !existing.endsWith("" + id)) {
                anchors.push(a);
                a.setAttribute("hnc-discovered", `rgx:${id}`);
            }
        }
    }
    return anchors;
}

function ourCount() {
    var anchor = find(getThreadCommentLinks(), (x) => getThingId(x) == ID);
    if(anchor) {
        console.log("For out count, found anchor: ", anchor);
        return getCount(anchor);
    }
    return 0;
}

function getInfos() {
    var elements = getThreadCommentLinks();
    var arr = [];
    /*if(ID) {  // Seems to be included in the above
        arr.push(ID);
    }*/
    for(var el of elements) {
        if(el.getAttribute("hnc-tracked")) {
            continue;
        }
        //console.log(`New comment anchor: `, el);
        el.setAttribute("hnc-tracked", "true");
        arr.push(getThingId(el));
    }
    if(arr.length === 0)
        return;
    postMessage(new InternalPacket(TYPE.GET_REDDIT_COUNT, arr), function(r) {
        //console.log("Callback", r);
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

// Listen for us commenting
var registered = new WeakSet();

setInterval(function() {
    var svBtns = document.getElementsByClassName("save");
    for(let btn of svBtns) {
        if(!registered.has(btn)) {
            registered.add(btn);
            btn.addEventListener("click", function(event) {
                var count = ourCount() + 1;
                console.log(`We just sent a comment! Setting known comment count to ${count}`);
                postMessage(new InternalPacket(TYPE.REDDIT_VISITED, {
                    id: ID,
                    count: count
                }));
            });
        }
    }
    for(let divContainer of document.getElementsByClassName("usertext-edit")) {
        if(divContainer && divContainer.style && divContainer.style.display !== "none") {
            if(!registered.has(divContainer)) {
                registered.add(divContainer);
                console.log("Found edit div: ", divContainer);
                var textarea = divContainer.getElementsByClassName("md")[0].childNodes[0];
                textarea.addEventListener("keypress", function(event) {
                    if(event.code === "BracketRight") {
                        var lastIndex = textarea.value.length - 1;
                        var leftBracket = -1;
                        for(var index = lastIndex; index >= 0; index--) {
                            var charAt = textarea.value[index];
                            if(charAt == "[") {
                                leftBracket = index;
                                break;
                            }
                        }
                        if(leftBracket === -1) 
                            return;
                        var outerText = textarea.value.substring(leftBracket, lastIndex + 1) + "]";
                        console.log("Full text: ", outerText);
                        var innerText = outerText.substr(1, outerText.length - 2);
                        console.log("Inner text: ", innerText);
                        if(innerText.startsWith("dis.gd/")) {
                            var uri = `](https://${innerText})`;
                            textarea.value += uri;
                            event.preventDefault();
                        }
                    }
                });
            }
        }
    }
    getInfos();
}, 500);