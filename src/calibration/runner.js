
// ============================================================
// RBFM CALIBRATION — generic engine
// ============================================================
//
// This file knows nothing about Pac-Man. Everything game-specific is
// injected through four adapters:
//
//   getStateKey(state)             -> stable string key for transpositions
//   getNodeType(state)             -> "min" | "max"
//   createSuccessorIterator(state) -> iterator of { state, value, duration, action }
//   evaluateState(state)           -> number
//
// The runner drives the same RBFM used by the game, measures the error
// between each node estimate and a bounded exact minimax (the reference
// value) and exposes per-bucket corrections: f (mean error) and g
// (variance) keyed by `${searchCount},${successors.length}`.
//
// Callers: src/calibration/worker.js (Pac-Man adapters) and any other
// game that instantiates createGameStrategy.
//
// Load order: expects protocol.js in the same context for the
// shared finishReason constants (target-samples / max-steps).

function createRbfmCalibration(map, seed = {}) {
    if (!map) {
        throw new Error(
            "createRbfmCalibration requires a map."
        );
    }

    const samples = new Map();

    // Seed from a previous run so calibration can resume instead of
    // starting from zero. Keys are `${searchCount},${childCount}` and the
    // values are the raw error samples recorded for that bucket.
    for (const [key, errors] of Object.entries(seed?.samples || {})) {
        const [s, d] = String(key).split(",").map(Number);

        if (
            !Number.isInteger(s) || s <= 0 ||
            !Number.isInteger(d) || d <= 0 ||
            !Array.isArray(errors)
        ) {
            continue;
        }

        const clean = errors.map(Number).filter(Number.isFinite);

        if (clean.length > 0) {
            samples.set(key, { s, d, errors: clean });
        }
    }
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

    function getBucketCount() {
        return samples.size;
    }

    function getSnapshot() {
        const snapshot = {};

        for (const [key, sample] of samples) {
            snapshot[key] = sample.errors.slice();
        }

        return snapshot;
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
        getBucketCount,
        getSnapshot,
        getObservations,
        getNodeStats,
        clear
    };
}

// Two-sided normal tail, erf-based (Numerical Recipes approximation).
function normalErfc(x) {
    const z = Math.abs(x);
    const t = 1 / (1 + 0.5 * z);
    const chain =
        1.00002368 +
        t * (0.37409196 +
        t * (0.09678418 +
        t * (-0.18628806 +
        t * (0.27886807 +
        t * (-1.13520398 +
        t * (1.48851587 +
        t * (-0.82215223 +
        t * 0.17087277)))))));
    const y = t * Math.exp(-z * z - 1.26551223 + t * chain);

    return x >= 0 ? y : 2 - y;
}

function twoSidedPValue(z) {
    return Math.min(1, Math.max(0, normalErfc(Math.abs(z) / Math.SQRT2)));
}

// Fisher's method: -2 * sum(ln p) follows a chi-square with 2n degrees of
// freedom, whose upper tail has this closed form for even degrees.
function combinePValues(pValues) {
    const n = pValues.length;

    if (n === 0) {
        return 1;
    }

    let statistic = 0;

    for (const pValue of pValues) {
        statistic += -2 * Math.log(Math.max(pValue, Number.MIN_VALUE));
    }

    const half = statistic / 2;
    let term = 1;
    let sum = 1;

    for (let k = 1; k < n; k++) {
        term *= half / k;
        sum += term;
    }

    return Math.min(1, Math.exp(-half) * sum);
}

// Rolling window of observed errors tested against the assumed calibration.
function createCalibrationDriftMonitor({
    windowSize = 50,
    confidence = 0.95
} = {}) {
    if (!Number.isInteger(windowSize) || windowSize <= 0) {
        throw new RangeError("windowSize must be a positive integer.");
    }

    if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) {
        throw new RangeError("confidence must be in (0, 1).");
    }

    const threshold = 1 - confidence;
    let pValues = [];

    function add({ error, mean, standardDeviation }) {
        if (
            !Number.isFinite(error) ||
            !Number.isFinite(mean) ||
            !Number.isFinite(standardDeviation) ||
            standardDeviation <= 0
        ) {
            return false;
        }

        pValues.push(twoSidedPValue((error - mean) / standardDeviation));

        if (pValues.length > windowSize) {
            pValues.shift();
        }

        return true;
    }

    function getStatus() {
        const pValue = combinePValues(pValues);

        return {
            samples: pValues.length,
            windowSize,
            pValue,
            drifted: pValues.length >= windowSize && pValue < threshold
        };
    }

    function reset() {
        pValues = [];
    }

    return { add, getStatus, reset };
}

function createRbfmCalibrationExperiment({
    calibration,
    getReferenceValue,
    onSample = null,
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

                if (typeof onSample === "function") {
                    onSample({
                        error: referenceValue - node.value,
                        searchCount: node.searchCount,
                        childCount: node.successors.length
                    });
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

function createReferenceValue({
    getStateKey,
    getNodeType,
    createSuccessorIterator,
    evaluateState,
    lookupStateValue = null,
    maxStates = Infinity
} = {}) {
    if (
        typeof getStateKey !== "function" ||
        typeof getNodeType !== "function" ||
        typeof createSuccessorIterator !== "function" ||
        typeof evaluateState !== "function"
    ) {
        throw new TypeError(
            "createReferenceValue requires getStateKey, getNodeType, createSuccessorIterator and evaluateState."
        );
    }

    if (!(maxStates === Infinity || (Number.isInteger(maxStates) && maxStates > 0))) {
        throw new RangeError(
            "maxStates must be a positive integer or Infinity."
        );
    }

    if (
        lookupStateValue !== null &&
        typeof lookupStateValue !== "function"
    ) {
        throw new TypeError(
            "lookupStateValue must be a function or null."
        );
    }

    // Bounded exact minimax: leaves are evaluated with the injected
    // evaluateState and the horizon is measured in the state's own time
    // units. This is the reference the calibration compares against.
    return function calculateReferenceValue(
        initialState,
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
        let visited = 0;

        function minimax(state) {
            if (
                state.terminal ||
                state.time >= deadline
            ) {
                return evaluateState(state);
            }

            const stateKey = getStateKey(state);
            const key = `${stateKey}|${state.time}`;

            if (memo.has(key)) {
                return memo.get(key);
            }

            // Prevent infinite recursion if a zero-duration cycle exists.
            if (active.has(key)) {
                return evaluateState(state);
            }

            // Reuse values already explored by the game graph: they are a
            // deeper estimate than this bounded horizon can afford.
            if (lookupStateValue !== null) {
                const known = lookupStateValue(state, stateKey);

                if (Number.isFinite(known)) {
                    return known;
                }
            }

            if (visited >= maxStates) {
                return evaluateState(state);
            }

            visited++;

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
                    : evaluateState(state);

                memo.set(key, value);

                return value;
            } finally {
                active.delete(key);
            }
        }

        return minimax(initialState);
    };
}

function createRbfmCalibrationRunner({
    map,
    initialState,
    targetSamples = 256,
    maxSteps = 10000,
    maxSamplesPerStep = 1,
    referenceHorizonSeconds = 10,
    referenceMaxStates = Infinity,
    minimumStandardDeviation = 0,
    priorStandardDeviation = 0,
    lookupStateValue = null,
    assumedCalibration = null,
    driftWindowSize = 50,
    driftConfidence = 0.95,
    getReferenceValue = null,
    seed = null,
    getStateKey,
    getNodeType,
    createSuccessorIterator,
    evaluateState
} = {}) {
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

    if (
        typeof getStateKey !== "function" ||
        typeof getNodeType !== "function" ||
        typeof createSuccessorIterator !== "function" ||
        typeof evaluateState !== "function"
    ) {
        throw new TypeError(
            "createRbfmCalibrationRunner requires the adapters getStateKey, getNodeType, createSuccessorIterator and evaluateState."
        );
    }

    if (
        !Number.isFinite(referenceHorizonSeconds) ||
        referenceHorizonSeconds < 0
    ) {
        throw new RangeError(
            "referenceHorizonSeconds must be a finite non-negative number."
        );
    }

    if (
        !Number.isFinite(minimumStandardDeviation) ||
        minimumStandardDeviation < 0
    ) {
        throw new RangeError(
            "minimumStandardDeviation must be a finite non-negative number."
        );
    }

    if (
        !Number.isFinite(priorStandardDeviation) ||
        priorStandardDeviation < 0
    ) {
        throw new RangeError(
            "priorStandardDeviation must be a finite non-negative number."
        );
    }

    if (
        assumedCalibration !== null &&
        typeof assumedCalibration !== "object"
    ) {
        throw new TypeError(
            "assumedCalibration must be an object or null."
        );
    }

    const calculateReferenceValue = createReferenceValue({
        getStateKey,
        getNodeType,
        createSuccessorIterator,
        evaluateState,
        lookupStateValue,
        maxStates: referenceMaxStates
    });
    const referenceValueFor = typeof getReferenceValue === "function"
        ? getReferenceValue
        : state => calculateReferenceValue(state, referenceHorizonSeconds);

    const driftMonitor = createCalibrationDriftMonitor({
        windowSize: driftWindowSize,
        confidence: driftConfidence
    });

    function recordDriftSample({ error, searchCount, childCount }) {
        if (!assumedCalibration) {
            return;
        }

        const key = `${searchCount},${childCount}`;
        const mean = Number(assumedCalibration.f?.[key]);
        const variance = Number(assumedCalibration.g?.[key]);

        if (!Number.isFinite(mean) || !Number.isFinite(variance)) {
            return;
        }

        driftMonitor.add({
            error,
            mean,
            standardDeviation: Math.sqrt(Math.max(0, variance))
        });
    }

    const calibration = createRbfmCalibration(map, seed || {});
    const search = createRandomizedBestFirstMinimax({
        getStateKey,
        getNodeType,
        createSuccessorIterator,
        onNodeVisit: calibration.onNodeVisit
    });
    const experiment = createRbfmCalibrationExperiment({
        calibration,
        getReferenceValue: referenceValueFor,
        onSample: recordDriftSample,
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
                standardDeviation: tables.g.has(key)
                    ? Math.max(
                        minimumStandardDeviation,
                        Math.sqrt(Math.max(0, variance))
                    )
                    : priorStandardDeviation
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

        if (driftMonitor.getStatus().drifted) {
            finished = true;
            finishReason = CALIBRATION_FINISH_REASON.drift;
        } else if (status.completed >= targetSamples) {
            finished = true;
            finishReason = CALIBRATION_FINISH_REASON.targetSamples;
        } else if (steps >= maxSteps) {
            finished = true;
            finishReason = CALIBRATION_FINISH_REASON.maxSteps;
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
            finishReason,
            buckets: calibration.getBucketCount(),
            samples: calibration.getSnapshot(),
            drift: driftMonitor.getStatus()
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
                maxSamplesPerStep,
                referenceHorizonSeconds,
                referenceMaxStates
            },
            completed: status.finished &&
                status.finishReason === CALIBRATION_FINISH_REASON.targetSamples,
            finishReason: status.finishReason,
            f: Object.fromEntries(tables.f),
            g: Object.fromEntries(tables.g),
            samples: status.samples,
            drift: status.drift
        };
    }

    function reset() {
        calibration.clear();
        experiment.clear();
        driftMonitor.reset();
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
