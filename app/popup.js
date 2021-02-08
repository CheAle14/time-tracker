var text = document.getElementById("text");
var inp = document.getElementById("tokenI");
var btn = document.getElementById("buttonI");
btn.onclick = submit;
btn.disabled = true;
var port = chrome.runtime.connect();
port.onMessage.addListener(function(message, sender, response) {
    console.log(message);
    if(message.type === "sendInfo") {
        text.innerText = "Set token below";
        if(message.data.token) {
            text.innerText = text.innerText.replace("Set", "Update");
            inp.value = message.data.token;
        }
        if(message.data.name) {
            text.innerText = "Logged in as " + message.data.name;
        }
        btn.disabled = false;
    }
});
function submit() {
    console.log("Sending!")
    port.postMessage({type: "setToken", data: inp.value});
}