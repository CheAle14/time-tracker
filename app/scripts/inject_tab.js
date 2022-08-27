console.log("Injected into tab!");

chrome.runtime.sendMessage({
    type: "setToken",
    data: document.body.innerText
}, (resp) => {
    if(resp) {
        window.close();
    } else {
        console.error("Failed to set token?");
    }
});