
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
            return;
        }

        const d = node.successors.length;
        const s = node.searchCount;

        if (d === 0 || s === 0) {
            return;
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
    const completed = new WeakSet();

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

                calibration.record(node, referenceValue);
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
        // WeakSet does not support clearing; a new instance is created
        // if the experiment needs to be completely reset.
    }

    return {
        step,
        getStatus,
        clear
    };
}



const calibration = createRbfmCalibration(getCurrentMapDefinition());

const search = createUnboundedBestFirstMinimax({
    getStateKey,
    getNodeType,
    createSuccessorIterator,
    onNodeVisit: calibration.onNodeVisit
});

const experiment = createRbfmCalibrationExperiment({
    calibration,
    search,
    getReferenceValue: calculateReferenceValue,
    maxSamplesPerStep: 1
});