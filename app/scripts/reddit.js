console.log("Reddit content script loaded!");
import { StateInfo, DebugTimer, VideoToolTip, ConsistentToast, StatePacket, VideoToolTipFlavour, INTERNAL, EXTERNAL, HELPERS, getObjectLength, InternalPacket } from "./classes.js";

var SEQUENCE = 1;
var CALLBACKS = {};
var ERRORS = {};

var HIGHLIGHT_SINCE = null;

/**
 * Sends a message to the port
 * @param {InternalPacket} packet The packet to send
 * @param {function} callback Function called on success
 * @param {function} onfail Function called on failure
 */
function postMessage(packet, callback, onfail) {
    if(callback) {
        packet.seq = SEQUENCE++;
        CALLBACKS[packet.seq] = callback;
    }
    if(onfail) {
        if(!packet.seq)
            packet.seq = SEQUENCE++;
        ERRORS[packet.seq] = onfail;
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

var port = null;
function connectToExtension() {
    if(port) {
        console.log("Port already exists, attempting a disconnect");
        try {
            port.disconnect();
        } finally {
            port = null;
        }
    }
    try {
        port = chrome.runtime.connect();
    } catch(err) {
        console.log("Failed to connect to port background!");
        console.error(err);
        showError("Failed to connect to background.");
        return;
    }
    console.log("Connected to port");
    port.onMessage.addListener(portOnMessage);
    port.onDisconnect.addListener(function() {
        console.log("Disconnected from extension background, attempting to reconnect..");
        setTimeout(connectToExtension, 1000);
    })
}
connectToExtension();

var errorToast = null;
function portOnMessage(message, sender, response) {
    console.debug("[PORT] <<", message);

    if(message.res !== undefined) {
        var cb = CALLBACKS[message.res]
        delete CALLBACKS[message.res]
        delete ERRORS[message.res];
        console.log(`[PORT] Invoking callback handler for ${message.res}`);
        cb(message);
    }
    if(message.fail !== undefined) {
        var cb = ERRORS[message.fail];
        delete ERRORS[message.fail];
        cb(message);
    }
    if(message.type === "error") {
        showError(message.data);
    }
}

function showError(text) {
    if(errorToast) {
        errorToast.toastElement.innerText = text;
    } else {
        errorToast = Toastify({
            text: text,
            duration: -1,
            close: true,
            gravity: "top", // `top` or `bottom`
            position: "right", // `left`, `center` or `right`
            backgroundColor: "red",
            stopOnFocus: true, // Prevents dismissing of toast on hover
        })
        errorToast.showToast();
    }
}


function find(arr, p) {
    for(var el of arr)
        if(p(el))
            return el;
    return null;
}

function getCount(anchor) {
    if(!anchor)
        return 0;
    var text = anchor.innerText;
    var mtch = text.match(/[0-9]+/m);
    if(mtch) {
        console.log(mtch);
        return parseInt(mtch[0]);
    } else {
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
        if(obj.count === -1) {
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
    if(threadData.count === -1) {
        return;
    }
    console.log(`Adding selection for `, threadData);
    const urlSearchParams = new URLSearchParams(window.location.search);
    var snc = urlSearchParams.get("hnc_since");
    if(snc) {
        HIGHLIGHT_SINCE = parseInt(snc);
        console.log("Setting highlight since from query:", HIGHLIGHT_SINCE)
    } else {
        HIGHLIGHT_SINCE = threadData.visits[threadData.visits.length - 1]
    }

    addTimeSelectionBox(threadData.visits);
    setHighlighting();
}

function setHighlighting() {
    update_highlighting({target: {value: HIGHLIGHT_SINCE}})
}

/* original authored by TheBrain, at http://stackoverflow.com/a/12475270 */
function time_ago(time, precision) {
	if (precision == undefined) {
		precision = 2;
	}

	switch (typeof time) {
		case 'number': break;
		case 'string': time = +new Date(time); break;
		case 'object': if (time.constructor === Date) time = time.getTime(); break;
		default: time = +new Date();
	}

	let time_formats = [
		[         60,  'seconds',                   1], // 60
		[        120, '1 minute', '1 minute from now'], // 60*2
		[       3600,  'minutes',                  60], // 60*60,               60
		[       7200,   '1 hour',   '1 hour from now'], // 60*60*2
		[      86400,    'hours',                3600], // 60*60*24,            60*60
		[     172800,    '1 day',          'Tomorrow'], // 60*60*24*2
		[     604800,     'days',               86400], // 60*60*24*7,          60*60*24
		[    1209600,   '1 week',         'Next week'], // 60*60*24*7*4*2
		[    2419200,    'weeks',              604800], // 60*60*24*7*4,        60*60*24*7
		[    4838400,  '1 month',        'Next month'], // 60*60*24*7*4*2
		[   29030400,   'months',             2419200], // 60*60*24*7*4*12,     60*60*24*7*4
		[   58060800,   '1 year',         'Next year'], // 60*60*24*7*4*12*2
		[ 2903040000,    'years',            29030400], // 60*60*24*7*4*12*100, 60*60*24*7*4*12
	];
	let seconds = (+new Date() - time) / 1000;

	if (seconds < 2) {
		return 'just now';
	}

	let durations = [ ];

	while (1) {
		let i = 0,
			format;

		while (format = time_formats[i++]) {
			if (seconds < format[0]) {
				if (typeof format[2] == 'string') {
					durations.push(format[1]);
					break;
				}
				else {
					durations.push(Math.floor(seconds / format[2]) + ' ' + format[1]);
					break;
				}
			}
		}

		if (i > time_formats.length) {
			return 'a very long time ago';
		}

		if (typeof time_formats[i - 1][2] == 'string') {
			seconds -= time_formats[i][2];
		}
		else {
			seconds -= Math.floor(seconds / time_formats[i - 1][2]) * time_formats[i - 1][2];
		}

		if (precision > i && durations.length > 1) {
			durations.pop();
			break;
		}

		if (seconds == 0) {
			break;
		}
	}

	let result;

	result = durations.slice(-2).join(' and ') + ' ago';
	durations  = durations.slice(0, -2);

	if (durations.length) {
		durations.push(result);
		result = durations.join(', ');
	}

	return result;
}

function addTimeSelectionBox(times) {
    var sitetable = document.getElementById(`siteTable_t3_${ID}`);
    let commentarea = document.getElementsByClassName('commentarea')[0]

    var selectionBox = document.createElement("span");
    selectionBox.classList.add("rounded", "blue-accent", "comment-visits-box");

    var titleBox = document.createElement("span");
    titleBox.classList.add("title");
    selectionBox.appendChild(titleBox);

    titleBox.innerHTML = "Highlight comments posted since previous visit: ";

    var selectElem = document.createElement("select");
    selectElem.id = "mlapi-visits";

    var setSelected = false;
    for(var time of times) {
        var opt = document.createElement("option");
        opt.value = time;
        opt.textContent = time_ago(time);
        selectElem.appendChild(opt);
        if(time === HIGHLIGHT_SINCE) {
            setSelected = true;
            opt.setAttribute("selected", "")
        }
        
    }
    if(!setSelected) {
        selectElem.children[selectElem.children.length - 1].setAttribute("selected", "")
    }

    titleBox.appendChild(selectElem);

    selectElem.addEventListener("change", update_highlighting);

    commentarea.insertBefore(selectionBox, sitetable);
}

function update_highlighting(event) {
    //console.log("HNC-UpdateHighlighting", event);
    reset_highlighting();
    highlight(parseInt(event.target.value));
}

function reset_highlighting() {
    //console.log("Resetting highlighting");
    let comments = document.getElementsByClassName('hnc_new');
    for (let i = comments.length; i > 0; i--) {
        let comment = comments[i - 1];
        comment.classList.remove('hnc_new');

        let elements = {
            'comment': comment,
            'text': comment.getElementsByClassName('usertext-body')[0].firstElementChild,
            'time': comment.getElementsByTagName('time')[0],
        };

        for (let element in elements) {
            elements[element].removeAttribute('style');
        }
    }
}

function highlight(since) {
    let comments = document.getElementsByClassName('comment'),
			username
		;

    HIGHLIGHT_SINCE = since;
    //console.log(`Highlighting since ${since}, ${time_ago(since)}`);

    if (document.body.classList.contains('loggedin')) {
        username = document.getElementsByClassName('user')[0].firstElementChild.textContent;
    }

    /* Ensure changing sort-by doesn't mess with highlighting */
    var menuArea = document.getElementsByClassName("menuarea")[0];
    var dropdown = menuArea.getElementsByClassName("drop-choices")[0];
    var links = dropdown.getElementsByTagName("a");
    for(let anchor of links) {
        var url = new URL(anchor.href);
        url.searchParams.set("hnc_since", `${since}`);
        anchor.href = url;
    }

    /* Ensure the 'show 500' button does not mess with highlighting */
    var panetitle = document.getElementsByClassName("panestack-title")[0];
    if(panetitle) {
        var showAnchor = panetitle.getElementsByTagName("a")[0];
        if(showAnchor) {
            var aUrl = new URL(showAnchor.href);
            aUrl.searchParams.set("hnc_since", `${since}`);

            /* Ensure 'show 500' button maintains sort-by setting */
            var pageParams = new URL(window.location.href).searchParams;
            var sorted = pageParams.get("sort");
            if(sorted) {
                aUrl.searchParams.set("sort", sorted);
            }

            showAnchor.href = aUrl;
        }
    }


    for (let comment of comments) {
        /* skip removed or deleted comments */
        if (comment.classList.contains('deleted') || comment.classList.contains('spam')) {
            continue;
        }

        /* Ensure links maintain since */
        var permalink = comment.getElementsByClassName("bylink")[0];
        if(permalink) {
            var url = new URL(permalink.href);
            url.searchParams.set("hnc_since", `${since}`);
            permalink.href = url;
        }

        var deepthreadspan = comment.getElementsByClassName("deepthread")[0];
        if(deepthreadspan) {
            var deepthread = deepthreadspan.getElementsByTagName("a")[0];
            var url = new URL(deepthread.href);
            url.searchParams.set("hnc_since", `${since}`);
            deepthread.href = url;
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
                'time': comment.getElementsByTagName("time")[0] ?? comment.getElementsByClassName('live-timestamp')[0] ?? comment.getElementsByClassName("edited-timestamp")[0],
            };
            //console.log("HNC-Update:", elements);
            elements["time"].setAttribute('style', generate_comment_style(time, since));
        }
    }
}

function generate_comment_style(comment_time, since) {
    let style = config.comment_style;

    style = style.replace(/\s+/g, ' ');
    style = style.replace(/%color/g, get_color(Date.now() - comment_time, Date.now() - since));

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

function isThreadBylink(anchor) {
    // whether its the link under the thread
    if(!anchor)
        return false;
    if(anchor.innerText.indexOf("comment") >= 0)
        return true;
    if(anchor.innerText.indexOf("message") >= 0)
        return true;
    return false;
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
        if(isThreadBylink(a) && getThingId(a)) {
            var existing = a.getAttribute("hnc-discovered");
            if(existing == null || !existing.endsWith("" + id)) {
                anchors.push(a);
                a.setAttribute("hnc-discovered", `rgx:${id}`);
            }
        }
    }
    return anchors;
}

function ourAnchor() {
    return find(getThreadCommentLinks(), (x) => getThingId(x) == ID);
}

function ourCount() {
    var anchor = ourAnchor();
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
    var resPages = document.getElementsByClassName("NERPageMarker");
    var el = null;
    if(resPages.length > 0) {
        var latestPage = resPages[resPages.length - 1];
        var span = document.createElement("span");

        var gearIcon = latestPage.children[1];
        latestPage.insertBefore(span, gearIcon);        


        span.classList.add("loader-container");
        el = span;



        var loader = document.createElement("div");
        loader.classList.add("loader");
        span.appendChild(loader);

    }
    var addDone = function(sucess) {
        var done = document.createElement("img");
        done.src = sucess ? "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Symbol_confirmed.svg/180px-Symbol_confirmed.svg.png" : "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Symbol_unrelated.svg/180px-Symbol_unrelated.svg.png";
        done.classList.add("loader-done")

        el.style.width = "16px";
        el.style.height = "16px"
        el.innerHTML = "";
        el.appendChild(done);
    }
    postMessage(new InternalPacket(INTERNAL.GET_REDDIT_COUNT, arr), function(r) {
        //console.log("Callback", r);
        sendVisited(elements);
        handleInfo(elements, r.data);

        console.log("Loading element: ", el);
        if(el) {
            addDone(true);
        }
    }, function() {
        console.log("Failed to get reddit count, attempting to send thread visit if relevant");
        sendVisited(elements); // since packet will be persisted anyway
        showError("Failed to fetch thread information");
        if(el) {
            addDone(false);
        }
    })
}

function sendVisited(elements) {
    HIGHLIGHT_SINCE = null;
    if(ID) {
        var anchor = find(elements, (x) => getThingId(x) == ID);
        postMessage(new InternalPacket(INTERNAL.REDDIT_VISITED, {
            id: ID,
            count: getCount(anchor)
        }));
    }
}

getInfos();

// Listen for us commenting
var registered = new WeakSet();
const DOMAIN_REGEX = /^(?<domain>\S+)\.(?<tld>gd|com|org|net|gg|dev)/

const loopInterval = setInterval(function() {
    var svBtns = document.getElementsByClassName("save");
    for(let btn of svBtns) {
        if(!registered.has(btn)) {
            registered.add(btn);
            btn.addEventListener("click", function(event) {
                if(ID) {
                    var anchor = ourAnchor();
                    if(anchor) {
                        var count = getCount(anchor) + 1;
                        console.log(`We just sent a comment! Setting known comment count to ${count}`);
                        anchor.innerText = `${count} comments`;
                        postMessage(new InternalPacket(INTERNAL.REDDIT_VISITED, {
                            id: ID,
                            count: count
                        }));
                    } else {
                        console.warn("Sent a comment, but don't know where the anchor is");
                    }
            } else {
                    console.warn("Sent a comment, but don't know on which post")
                }
            });
        }
    }
    for(let spanContainer of document.getElementsByClassName("usertext-edit")) {
        if(spanContainer && spanContainer.style && spanContainer.style.display !== "none") {
            if(!registered.has(spanContainer)) {
                registered.add(spanContainer);
                console.log("Found edit span: ", spanContainer);
                var textarea = spanContainer.getElementsByClassName("md")[0].childNodes[0];
                textarea.addEventListener("input", function(event) {
                    if(event.data === "]") {
                        var lastIndex = textarea.selectionStart;
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
                        var outerText = textarea.value.substring(leftBracket, lastIndex + 1);
                        console.log("Full text: ", outerText);
                        var innerText = outerText.substring(1, outerText.length - 1);
                        console.log("Inner text: ", innerText);
                        var mtch = innerText.match(DOMAIN_REGEX);
                        console.log("Match: ", mtch);
                        if(mtch) {
                            var uri = null;
                            if(innerText.startsWith("http"))
                                uri = `(${innerText})`;
                            else
                                uri = `(https://${innerText})`;
                            textarea.value += uri;
                            event.preventDefault();
                        }
                    }
                });
            }
        }
    }
    if(HIGHLIGHT_SINCE) {
        setHighlighting();
    }
    getInfos();
}, 500);