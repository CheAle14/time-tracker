function injFunc() {
    console.log("Script Injected");
    const extractFromGridRenderer = (gridRenderer) => {
        console.log("Looking at ", gridRenderer);
        var ids = [];
        if(gridRenderer.videoId) {
            ids.push(gridRenderer.videoId);
        }
        const items = gridRenderer.items;
        if(items) {
            for(let item of items) {
                if(item.gridVideoRenderer) {
                ids.push(item.gridVideoRenderer.videoId);
                }
            }
        }
        return ids;
    };

    const extractFromVideoWithContextRenderer = (vidR) => {
        console.log("Looking at ", vidR);

        return [vidR.videoId];
    };

    const extractIds = (js) => {
        var ids = [];

        const actions = js.onResponseReceivedActions;
        if(!actions) return null;

        const appendAction = actions[0];
        if(!appendAction) return null;

        const continuationActions = appendAction.appendContinuationItemsAction;
        if(!continuationActions) return null;

        const continuationItems = continuationActions.continuationItems;
        console.log(continuationItems);
        for(let continueItem of continuationItems) {
            console.log("Section item: ", continueItem);

            if(continueItem.gridVideoRenderer) {
                var gridIds = extractFromGridRenderer(continueItem.gridVideoRenderer);
                console.log("For section grid, found: ", gridIds);
                ids = ids.concat(gridIds);
            }

            if(continueItem.richItemRenderer) {
                if(continueItem.richItemRenderer.content) {
                    if(continueItem.richItemRenderer.content.videoWithContextRenderer) {
                        ids = ids.concat(extractFromVideoWithContextRenderer(continueItem.richItemRenderer.content.videoWithContextRenderer));
                    }
                }
            }

            const sectionRenderer = continueItem.itemSectionRenderer;
            if(sectionRenderer) {
                const sectionContents = sectionRenderer.contents;
                for(let content of sectionContents) {
                    if(content.shelfRenderer) {
                        const gridRenderer = content.shelfRenderer.content.gridRenderer;
                        ids = ids.concat(extractFromGridRenderer(gridRenderer));
                    } else if(content.videoWithContextRenderer) {
                        ids = ids.concat(extractFromVideoWithContextRenderer(content.videoWithContextRenderer))
                    }
                }
            }
        }

        return ids;
    };

    // define monkey patch function
    const monkeyPatch = () => {
        // intercept requests to try and catch when a new batch of videos is requested
        const {fetch: origFetch} = window;
        window.fetch = async (...args) => {
            const orig = await (await origFetch(...args));
            const response = orig.clone();
            if(response.url.indexOf("youtubei/v1/browse") >= 0) {
                console.log("This is a browse request!");
                response
                  .json()
                  .then(js => {
                    console.log("Browse data: ", js);
                    var ids = extractIds(js);
                    const event = new CustomEvent("data", {detail: ids});
                    console.log("Ids fetched: ", ids);
                    if(ids) document.getElementById("injectHolder").dispatchEvent(event);

                  })
                  .catch(err => {
                      console.error("Browse error: ", err);
                  })
            }
            
            /* the original response can be resolved unmodified: */
            return orig;
        };
    };
    monkeyPatch();
}
injFunc();