
function createRbfmCalibration(map) {
    if (!map) {
        throw new Error(
            "createRbfmCalibration requires a map."
        );
    }

    const samples = new Map();
    const observations = [];
    const nodeStats = new Map();

    function getNodeStats(node) {
        let stats = nodeStats.get(node);

        if (!stats) {
            stats = {
                visits: 0,
                referenceValue: null,
                errors: []
            };

            nodeStats.set(node, stats);
        }

        return stats;
    }

    function record(node, referenceValue) {
        if (
            !Number.isFinite(node.value) ||
            !Number.isFinite(referenceValue)
        ) {
            return false;
        }

        const d = node.successors.length;
        const s = node.searchCount;

        if (d === 0 || s === 0) {
            return false;
        }

        const stats = getNodeStats(node);
        const error = referenceValue - node.value;

        stats.referenceValue = referenceValue;
        stats.errors.push(error);

        const key = `${s},${d}`;

        if (!samples.has(key)) {
            samples.set(key, {
                s,
                d,
                errors: []
            });
        }

        samples.get(key).errors.push(error);
        return true;
    }

    function onNodeVisit(node) {
        observations.push({
            nodeKey: node.key,
            node,
            value: node.value,
            childCount: node.successors.length,
            searchCount: node.searchCount
        });
    }

    function getTables() {
        const f = new Map();
        const g = new Map();

        for (const [key, sample] of samples) {
            const errors = sample.errors;
            const count = errors.length;

            if (count === 0) {
                continue;
            }

            const mean =
                errors.reduce((sum, error) => sum + error, 0)
                / count;

            const variance =
                errors.reduce(
                    (sum, error) => sum + (error - mean) ** 2,
                    0
                ) / count;

            f.set(key, mean);
            g.set(key, variance);
        }

        return { f, g };
    }

    function getSampleCount() {
        let count = 0;

        for (const sample of samples.values()) {
            count += sample.errors.length;
        }

        return count;
    }

    function getObservations() {
        return observations;
    }

    function clear() {
        observations.length = 0;
        samples.clear();
        nodeStats.clear();
    }

    return {
        map,
        record,
        onNodeVisit,
        getTables,
        getSampleCount,
        getObservations,
        getNodeStats,
        clear
    };
}

function* createRbfmSuccessorIterator(state) {
    for (const profile of getSearchActionProfiles(state)) {
        const nextState = profile.nextState;

        yield {
            state: nextState,
            value: evaluateSearchState(nextState),
            duration: nextState.time - state.time,
            action: {
                ghostDirections: profile.ghostDirections,
                playerDirection: profile.playerDirection
            }
        };
    }
}


function createRbfmCalibrationExperiment({
    calibration,
    search,
    getReferenceValue,
    maxSamplesPerStep = 1
}) {
    const pending = new Map();
    let completed = new WeakSet();

    let running = false;

    function collectObservations() {
        for (const observation of calibration.getObservations()) {
            const node = observation.node;

            if (completed.has(node) || pending.has(node)) {
                continue;
            }

            pending.set(node, {
                node,
                estimatedValue: observation.value,
                searchCount: observation.searchCount,
                childCount: observation.childCount
            });
        }
    }

    function step() {
        if (running) return 0;

        running = true;
        let processed = 0;

        try {
            collectObservations();

            while (
                processed < maxSamplesPerStep &&
                pending.size > 0
            ) {
                const [node, sample] = pending.entries().next().value;
                pending.delete(node);

                const referenceValue = getReferenceValue(
                    node.state,
                    {
                        node,
                        searchCount: sample.searchCount,
                        childCount: sample.childCount
                    }
                );

                if (!Number.isFinite(referenceValue)) {
                    continue;
                }

                const recorded = calibration.record(node, referenceValue);

                if (!recorded) {
                    continue;
                }

                completed.add(node);
                processed++;
            }
        } finally {
            running = false;
        }

        return processed;
    }

    function getStatus() {
        return {
            pending: pending.size,
            completed: calibration.getSampleCount()
        };
    }

    function clear() {
        pending.clear();
        completed = new WeakSet();
    }

    return {
        step,
        getStatus,
        clear
    };
}

///////////////////////////////////////////////////////
// game adapters
function getStateKey(state) {
    return buildStateKey(state);
}


function* createSuccessorIterator(state) {
    if (state.terminal) {
        return;
    }

    if (state.firstActor === "ghosts") {
        for (const ghostDirections of getSearchGhostActionProfiles(state)) {
            const nextState = advanceSearchState(
                state,
                ghostDirections,
                null
            );

            yield {
                state: nextState,
                value: evaluateSearchState(nextState),
                duration: nextState.time - state.time,
                action: {
                    ghostDirections,
                    playerDirection: null
                }
            };
        }

        return;
    }

    if (state.firstActor === "player") {
        for (const playerDirection of getSearchPlayerActionProfiles(state)) {
            if (!playerDirection) {
                continue;
            }

            const nextState = advanceSearchState(
                state,
                [],
                playerDirection
            );

            yield {
                state: nextState,
                value: evaluateSearchState(nextState),
                duration: nextState.time - state.time,
                action: {
                    ghostDirections: [],
                    playerDirection
                }
            };
        }
    }
}


function createRbfmCalibrationRunner({
    map,
    initialState,
    targetSamples = 256,
    maxSteps = 10000,
    maxSamplesPerStep = 1,
    getReferenceValue = state => calculateReferenceValue(state),
    getStateKey: stateKey = getStateKey,
    getNodeType,
    createSuccessorIterator: successorIterator = createSuccessorIterator,
    evaluateState = evaluateSearchState
} = {}) {

    function calculateReferenceValue(
        initialState,
        getNodeType,
        horizonSeconds = 10
    ) {
        if (
            !Number.isFinite(horizonSeconds) ||
            horizonSeconds < 0
        ) {
            throw new TypeError(
                "horizonSeconds must be a finite non-negative number."
            );
        }

        const deadline = initialState.time + horizonSeconds;
        const memo = new Map();
        const active = new Set();

        function minimax(state) {
            if (
                state.terminal ||
                state.time >= deadline
            ) {
                return evaluateSearchState(state);
            }

            const key = `${getStateKey(state)}|${state.time}`;

            if (memo.has(key)) {
                return memo.get(key);
            }

            // Prevent infinite recursion if a zero-duration cycle exists.
            if (active.has(key)) {
                return evaluateSearchState(state);
            }

            active.add(key);

            try {
                const isMaxNode = getNodeType(state) === "max";
                let bestValue = isMaxNode ? -Infinity : Infinity;
                let hasSuccessor = false;

                for (const transition of createSuccessorIterator(state)) {
                    hasSuccessor = true;

                    const value = minimax(transition.state);

                    if (isMaxNode) {
                        bestValue = Math.max(bestValue, value);
                    } else {
                        bestValue = Math.min(bestValue, value);
                    }
                }

                const value = hasSuccessor
                    ? bestValue
                    : evaluateSearchState(state);

                memo.set(key, value);

                return value;
            } finally {
                active.delete(key);
            }
        }

        return minimax(initialState);
    }

    if (!map) {
        throw new TypeError("createRbfmCalibrationRunner requires a map.");
    }

    if (!initialState || typeof initialState !== "object") {
        throw new TypeError(
            "createRbfmCalibrationRunner requires an initial state."
        );
    }

    if (!Number.isInteger(targetSamples) || targetSamples <= 0) {
        throw new RangeError("targetSamples must be a positive integer.");
    }

    if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
        throw new RangeError("maxSteps must be a positive integer.");
    }

    if (!Number.isInteger(maxSamplesPerStep) || maxSamplesPerStep <= 0) {
        throw new RangeError(
            "maxSamplesPerStep must be a positive integer."
        );
    }

    const calibration = createRbfmCalibration(map);
    const search = createRandomizedBestFirstMinimax({
        getStateKey: stateKey,
        getNodeType,
        createSuccessorIterator: successorIterator,
        onNodeVisit: calibration.onNodeVisit
    });
    const experiment = createRbfmCalibrationExperiment({
        calibration,
        search,
        getReferenceValue,
        maxSamplesPerStep
    });

    let steps = 0;
    let finished = false;
    let finishReason = null;

    function refreshNodeDistributions() {
        const tables = calibration.getTables();

        for (const node of search.nodes.values()) {
            const key = `${node.searchCount},${node.successors.length}`;
            const correction = tables.f.get(key) || 0;
            const variance = tables.g.get(key) || 0;

            node.distribution = {
                mean: node.value + correction,
                standardDeviation: Math.sqrt(Math.max(0, variance))
            };
        }
    }

    search.setRoot(
        initialState,
        evaluateState(initialState),
        initialState.time
    );
    refreshNodeDistributions();

    function updateCompletion() {
        const status = experiment.getStatus();

        if (status.completed >= targetSamples) {
            finished = true;
            finishReason = "target-samples";
        } else if (steps >= maxSteps) {
            finished = true;
            finishReason = "max-steps";
        }

        return status;
    }

    function step() {
        if (finished) {
            return getStatus();
        }

        refreshNodeDistributions();
        search.rootDecision(initialState.time + steps);
        experiment.step();
        refreshNodeDistributions();
        steps++;
        updateCompletion();

        return getStatus();
    }

    function runToCompletion(stepLimit = maxSteps) {
        if (!Number.isInteger(stepLimit) || stepLimit <= 0) {
            throw new RangeError("stepLimit must be a positive integer.");
        }

        const limit = Math.min(stepLimit, maxSteps);

        while (!finished && steps < limit) {
            step();
        }

        updateCompletion();
        return getStatus();
    }

    function getStatus() {
        const experimentStatus = experiment.getStatus();

        return {
            steps,
            pending: experimentStatus.pending,
            completed: experimentStatus.completed,
            targetSamples,
            finished,
            finishReason
        };
    }

    function getResult() {
        const tables = calibration.getTables();
        const status = getStatus();

        return {
            mapId: map.id || null,
            sampleCount: status.completed,
            targetSamples,
            parameters: {
                targetSamples,
                maxSteps,
                maxSamplesPerStep
            },
            completed: status.finished && status.finishReason === "target-samples",
            finishReason: status.finishReason,
            f: Object.fromEntries(tables.f),
            g: Object.fromEntries(tables.g)
        };
    }

    function reset() {
        calibration.clear();
        experiment.clear();
        search.nodes.clear();
        search.root = null;
        steps = 0;
        finished = false;
        finishReason = null;
        search.setRoot(
            initialState,
            evaluateState(initialState),
            initialState.time
        );
        refreshNodeDistributions();
    }

    return {
        calibration,
        search,
        step,
        runToCompletion,
        getStatus,
        getResult,
        reset
    };
}
