/* global importScripts, self */

importScripts(
    "protocol.js",
    "../config.js",
    "../map-geometry.js",
    "../model.js",
    "../strategy/strategy.js",
    "../strategy/randomized-best-first-minimax.js",
    "runner.js"
);

// ============================================================
// CALIBRATION WORKER
// ============================================================
//
// Runs in a dedicated thread. The only channel with the main thread is
// postMessage; this worker's globals are private and never visible to the
// page. The message contract (types, options, status/result shapes) is
// declared in protocol.js.
//
// Responsibilities, in order:
//   1. restore the structured-cloned request (map definition + state),
//   2. build a game strategy,
//   3. expose the four calibration adapters (the only Pac-Man-specific
//      code in the calibration path),
//   4. drive the generic runner and report progress/complete/result/error.
//
// No calibration algorithm lives here.

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

// Translates the game strategy into the four adapters the generic runner
// understands. This is the only place where Pac-Man semantics leak into
// the calibration machinery (node type orientation lives here).
function createCalibrationAdapters(strategy) {
    function* createSuccessorIterator(state) {
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
    }

    return {
        getStateKey: state => strategy.buildStateKey(state),
        getNodeType: state => strategy.getNodeType(state),
        createSuccessorIterator,
        evaluateState: state => strategy.evaluateSearchState(state)
    };
}

async function runCalibration(request) {
    const currentMap = restoreMap(request.map);
    const strategy = createGameStrategy({
        map: currentMap,
        geometry,
        model,
        config,
        rmfMinimax: createRandomizedBestFirstMinimax
    });
    const options = normalizeCalibrationOptions(request.options);
    const resume = normalizeCalibrationResume(request.resume);
    const assumed = request.assumed || null;

    const startedAt = Date.now();
    const resumeCount = Object.values(resume.samples)
        .reduce((sum, errors) => sum + errors.length, 0);

    console.log(
        `[calibration worker] ${request.map.id}: start ` +
        `(target ${options.targetSamples}, max ${options.maxSteps} steps, ` +
        `resume ${resumeCount} sample(s), ` +
        `assumed ${assumed ? "yes" : "no"}).`
    );

    const runner = createRbfmCalibrationRunner({
        map: currentMap,
        initialState: restoreState(request.initialState),
        targetSamples: options.targetSamples,
        maxSteps: options.maxSteps,
        maxSamplesPerStep: options.maxSamplesPerStep,
        referenceHorizonSeconds: options.referenceHorizonSeconds,
        referenceMaxStates: options.referenceMaxStates,
        minimumStandardDeviation: config.CALIBRATION_MIN_STD,
        priorStandardDeviation: config.BASE_STD,
        assumedCalibration: assumed,
        seed: resume,
        ...createCalibrationAdapters(strategy)
    });

    let lastLoggedAt = Date.now();
    let lastCompleted = resumeCount;

    function reportProgress(status) {
        const now = Date.now();
        const newSample = status.completed !== lastCompleted;
        const heartbeat = now - lastLoggedAt > 2000;

        if (!newSample && !heartbeat) {
            return;
        }

        lastCompleted = status.completed;
        lastLoggedAt = now;

        console.log(
            `[calibration worker] ${request.map.id}: ` +
            `${Math.round(status.percent * 100)}%, ` +
            `${status.completed}/${status.targetSamples} samples, ` +
            `step ${status.steps}/${options.maxSteps}, ` +
            `${status.pending} pending, ${status.buckets} bucket(s), ` +
            `eta ${formatCalibrationEta(status.etaMs)} ` +
            `(${status.elapsedMs} ms).`
        );
    }

    function step() {
        let status;

        try {
            status = {
                ...runner.step(),
                elapsedMs: Date.now() - startedAt
            };
        } catch (error) {
            console.error(
                `[calibration worker] ${request.map.id}: failed.`,
                error
            );
            self.postMessage({ type: CALIBRATION_MESSAGE.error, error: String(error) });
            return;
        }

        status = {
            ...status,
            ...estimateCalibrationProgress({
                completed: status.completed,
                targetSamples: status.targetSamples,
                steps: status.steps,
                maxSteps: options.maxSteps,
                elapsedMs: status.elapsedMs,
                resumedSamples: resumeCount
            })
        };

        reportProgress(status);

        self.postMessage({
            type: status.finished
                ? CALIBRATION_MESSAGE.complete
                : CALIBRATION_MESSAGE.progress,
            status
        });

        if (!status.finished) {
            setTimeout(step, 0);
            return;
        }

        console.log(
            `[calibration worker] ${request.map.id}: ${status.finishReason} ` +
            `(${status.completed}/${status.targetSamples} samples, ` +
            `${status.steps} steps, ${status.buckets} bucket(s), ` +
            `${status.elapsedMs} ms).`
        );

        self.postMessage({
            type: CALIBRATION_MESSAGE.result,
            status,
            result: runner.getResult()
        });
    }

    step();
}

self.onmessage = event => {
    if (event.data?.type !== CALIBRATION_MESSAGE.start) return;

    runCalibration(event.data).catch(error => {
        self.postMessage({
            type: CALIBRATION_MESSAGE.error,
            error: String(error)
        });
    });
};
