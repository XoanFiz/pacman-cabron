/* global importScripts, self */

importScripts(
    "game-config.js",
    "game-map-geometry.js",
    "game-model.js",
    "game-strategy.js",
    "randomized-best-first-minimax.js",
    "calibration-runner.js"
);

const config = createGameConfig();
const geometry = createGameMapGeometry();
const model = createGameModel();

function restoreMap(definition) {
    return {
        ...definition,
        edges: new Set(definition.edges || [])
    };
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
    const currentMap = restoreMap(request.map);
    const strategy = createGameStrategy({
        map: currentMap,
        geometry,
        model,
        config,
        rmfMinimax: createRandomizedBestFirstMinimax
    });

    // The calibration runner resolves several of its own adapter helpers
    // (used inside calculateReferenceValue) from the global scope.
    globalThis.buildStateKey = strategy.buildStateKey;
    globalThis.evaluateSearchState = strategy.evaluateSearchState;
    globalThis.advanceSearchState = strategy.advanceSearchState;
    globalThis.getSearchGhostActionProfiles = strategy.getSearchGhostActionProfiles;
    globalThis.getSearchPlayerActionProfiles = strategy.getSearchPlayerActionProfiles;

    const initialState = restoreState(request.initialState);
    const options = request.options;
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

    const runner = createRbfmCalibrationRunner({
        map: currentMap,
        initialState,
        targetSamples: options.targetSamples,
        maxSteps: options.maxSteps,
        maxSamplesPerStep: options.maxSamplesPerStep,
        getStateKey: strategy.buildStateKey,
        getNodeType: strategy.getNodeType,
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