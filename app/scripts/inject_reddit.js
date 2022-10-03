 function getClassInParent(element, className) {
    if(element) {
        if(element.className.indexOf(className) > -1)
            return element;
        else
            return getClassInParent(element.parentElement, className);
    }
    return null;
 }



function handleParentComment(element) {
    const thisThing = getClassInParent(element, "thing");
    var isChild = (thisThing.parentElement.className === "child") || (thisThing.parentElement.parentElement.className === "child");
    if(isChild) {
        const parentThing = getClassInParent(thisThing.parentElement, "thing");
        console.log("Scrolling..", parentThing);
        parentThing.scrollIntoView(true);
    }

}


function overrideToggleComment(element){
    console.log(window.event);
    window.old_togglecomment(element);
    if(element.innerText === "[+]" && _shifted) {
        console.log("Parent!", "'" + element.innerText + "'");
        handleParentComment(element);
    }
}
var _shifted = false;
function init() {
    console.log("Overriding");
    window.old_togglecomment = window.togglecomment;
    window.togglecomment = overrideToggleComment;
    console.log("Overrode!", window.old_togglecomment);
    document.addEventListener("keydown", (ev) => {
        _shifted = ev.shiftKey;
    })
    document.addEventListener("keyup", (ev) => {
        _shifted = ev.shiftKey;
    })
}

init();