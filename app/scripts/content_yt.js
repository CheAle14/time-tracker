
function injectScript(src) {
    console.log("Injecting Script now");

    var s = document.createElement('script');
    s.src = chrome.runtime.getURL('scripts/inject_yt.js');
    s.onload = function() {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(s);

    if(document.getElementById("injectHolder")) return;
    const injectHolder = document.createElement("div");
    injectHolder.setAttribute("id", "injectHolder");
    document.body.appendChild(injectHolder);

    injectHolder.addEventListener("data", function(e) {
        console.log("Got data: ", e.detail);
        src.postMessage({type: "getTimes", data: e.detail});
        setTimeout(function() {
            var mf = src.setThumbnails();
            console.log("Inject found: ", mf);

            var mustF = [];
            for(let x of mf) {
                if(e.detail.includes(x)) {
                } else {
                    mustF.push(x);
                }
            }
            console.log("Inject must fetch additional: ", mustF);
            src.postMessage({type: "getTimes", data: mustF});

        }, 4000);
    })
}

(async () => {
    const src = chrome.runtime.getURL('scripts/youtube.js');
    const contentScript = await import(src);
    injectScript(contentScript);
  })();