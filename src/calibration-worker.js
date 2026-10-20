/* global importScripts, self */

importScripts(
    "game-config.js",
    "game-map-geometry.js",
    "game-model.js",
    "game-strategy.js",
    "randomized-best-first-minimax.js",
    "calibration-runner.js"
);

const configuration = createGameConfig();
Object.assign(globalThis, configuration);
const mapGeometry = createGameMapGeometry();
Object.assign(globalThis, mapGeometry);

let currentMap;

globalThis.cloneCharacterState = createGameModel().cloneCharacterState;

globalThis.buildGraph = definition =>
    mapGeometry.buildGraph(definition, Object.values(DIRECTIONS));
function restoreMap(definition) {
    currentMap = {
        ...definition,
        edges: new Set(definition.edges || [])
    };
    globalThis.currentMap = currentMap;
    globalThis.graph = buildGraph(currentMap);
}
function restoreState(state) {
    return {
        ...state,
        pellets: new Set(state.pellets || []),
        readyGhosts: [...state.readyGhosts],
        player: {
            ...state.player,
            direction: { ...state.player.direction },
            nextDirection: state.player.nextDirection
                ? { ...state.player.nextDirection }
                : null
        },
        ghosts: state.ghosts.map(ghost => ({
            ...ghost,
            direction: { ...ghost.direction },
            nextDirection: ghost.nextDirection
                ? { ...ghost.nextDirection }
                : null
        })),
        respawnState: {
            player: { ...state.respawnState.player },
            ghosts: state.respawnState.ghosts.map(ghost => ({
                ...ghost,
                direction: { ...ghost.direction }
            })),
            houses: state.respawnState.houses.map(house => ({ ...house }))
        }
    };
}

function runCalibration(request) {
    restoreMap(request.map);
    const strategy = createGameStrategy({});
    const initialState = restoreState(request.initialState);
    const options = request.options;
    const getNodeType = state => state.firstActor === "player" ? "max" : "min";
    const createSuccessorIterator = function* (state) {
        for (const profile of strategy.getSearchActionProfiles(state)) {
            const nextState = strategy.advanceSearchState(
                state,
                profile.ghostDirections,
                profile.playerDirection
            );

            yield {
                state: nextState,
                value: strategy.evaluateSearchState(nextState),
                duration: nextState.time - state.time,
                action: profile
            };
        }
    };

    globalThis.getStateKey = strategy.buildStateKey;
    globalThis.getNodeType = getNodeType;
    globalThis.createSuccessorIterator = createSuccessorIterator;
    globalThis.evaluateSearchState = strategy.evaluateSearchState;

    const runner = createRbfmCalibrationRunner({
        map: currentMap,
        initialState,
        targetSamples: options.targetSamples,
        maxSteps: options.maxSteps,
        maxSamplesPerStep: options.maxSamplesPerStep,
        getStateKey: strategy.buildStateKey,
        getNodeType,
        createSuccessorIterator,
        evaluateState: strategy.evaluateSearchState,
        getReferenceValue: state => calculateReferenceValue(
            state,
            options.referenceHorizonSeconds
        )
    });

    function step() {
        let status;

        try {
            status = runner.step();
        } catch (error) {
            self.postMessage({ type: "error", error: String(error) });
            return;
        }

        self.postMessage({
            type: status.finished ? "complete" : "progress",
            status
        });

        if (!status.finished) {
            setTimeout(step, 0);
            return;
        }

        self.postMessage({
            type: "result",
            status,
            result: runner.getResult()
        });
    }

    step();
}

self.onmessage = event => {
    if (event.data?.type !== "start") return;

    try {
        runCalibration(event.data);
    } catch (error) {
        self.postMessage({ type: "error", error: String(error) });
    }
};