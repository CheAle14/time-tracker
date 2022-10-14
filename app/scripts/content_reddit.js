(async () => {
    var s = document.createElement('script');
    s.src = chrome.runtime.getURL('scripts/inject_reddit.js');
    s.onload = function() {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(s);

    const src = chrome.runtime.getURL('scripts/reddit.js');
    const contentScript = await import(src);
})();