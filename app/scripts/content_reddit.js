(async () => {
    const src = chrome.runtime.getURL('scripts/reddit.js');
    const contentScript = await import(src);
  })();