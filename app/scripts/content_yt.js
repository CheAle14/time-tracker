
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

    injectHolder.addEventListener("data", async function(e) {
        console.log("Got data: ", e.detail);
        await src.handleGetTimes(e.detail);
        setTimeout(async function() {
            var mf = src.setThumbnails();
            console.log("Inject found: ", mf);

            var mustF = [];
            for(let x of mf) {
                if(e.detail.includes(x)) {
                } else {
                    mustF.push(x);
                }
            }
            await src.handleGetTimes(mustF);
        }, 4000);
    })
}

(async () => {
    const src = chrome.runtime.getURL('scripts/youtube.js');
    const contentScript = await import(src);
    injectScript(contentScript);
  })();