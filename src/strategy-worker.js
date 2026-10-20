/* global importScripts, self */

importScripts(
    "./game-config.js",
    "./game-map-geometry.js",
    "./game-model.js",
    "./randomized-best-first-minimax.js",
    "./game-strategy.js"
);

const config = createGameConfig();
const geometry = createGameMapGeometry();
const model = createGameModel();

let strategy = null;
let strategyMapSignature = null;

function mapSignature(definition) {
    return JSON.stringify({
        id: definition.id,
        tiles: definition.tiles,
        edges: [...(definition.edges || [])].sort(),
        playerStart: definition.playerStart,
        ghostStarts: definition.ghostStarts
    });
}

function restoreMap(map) {
    return {
        ...map,
        edges: new Set(map.edges || [])
    };
}

function getStrategy(map) {
    const definition = restoreMap(map);
    const signature = mapSignature(definition);

    if (!strategy || signature !== strategyMapSignature) {
        strategyMapSignature = signature;
        strategy = createGameStrategy({
            map: definition,
            geometry,
            model,
            config,
            rmfMinimax: createRandomizedBestFirstMinimax
        });
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