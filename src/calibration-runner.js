
function createRbfmCalibration() {
    const samples = new Map();
    const observations = [];

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

        const key = `${s},${d}`;
        const error = referenceValue - node.value;

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
    }

    return {
        record,
        onNodeVisit,
        getTables,
        getSampleCount,
        getObservations,
        clear
    };
}


const calibration = createRbfmCalibration();

const search = createUnboundedBestFirstMinimax({
    getStateKey,
    getNodeType,
    createSuccessorIterator,
    onNodeVisit: calibration.onNodeVisit
});

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