importScripts(
    "./game-config.js",
    "./game-map-geometry.js",
    "./game-model.js",
    "./randomized-best-first-minimax.js",
    "./game-strategy.js"
);

globalThis.__PACMAN_STRATEGY_WORKER__ = true;
Object.assign(globalThis, createGameConfig(), createGameMapGeometry());

globalThis.cloneCharacterState = createGameModel().cloneCharacterState;

let strategy = null;
let activeMapId = null;

function restoreMap(map) {
    const definition = {
        ...map,
        edges: new Set(map.edges || [])
    };

    globalThis.currentMap = definition;
    activeMapId = definition.id;
}

function getStrategy(map) {
    if (!strategy || activeMapId !== map.id) {
        restoreMap(map);
        strategy = createGameStrategy({});
    } else {
        restoreMap(map);
    }

    return strategy;
}

self.onmessage = event => {
    const message = event.data;

    if (message?.type !== "request") {
        return;
    }

    try {
        const currentStrategy = getStrategy(message.map);
        const searchContext = message.searchContext;
        let action;

        currentStrategy.advanceSearch();

        if (message.mode === "ghost") {
            const directions = currentStrategy.chooseGhostDirections(
                searchContext,
                message.readyGhostIndices || [],
                Boolean(message.readyPlayer)
            );
            action = {
                ghostDirections: [...directions.entries()]
            };
        } else {
            action = {
                playerDirection: currentStrategy.choosePacmanDirection(
                    searchContext,
                    message.readyGhostIndices || []
                )
            };
        }

        const state = currentStrategy.createCurrentGameSearchState(
            searchContext,
            message.readyGhostIndices || [],
            message.mode !== "ghost"
        );

        self.postMessage({
            type: "result",
            requestId: message.requestId,
            mapId: message.map.id,
            stateKey: currentStrategy.buildStateKey(state),
            ...action
        });
    } catch (error) {
        self.postMessage({
            type: "error",
            requestId: message.requestId,
            error: String(error),
            stack: error?.stack || ""
        });
    }
};