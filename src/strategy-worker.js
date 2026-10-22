/* global importScripts, self */

importScripts(
    "./calibration/protocol.js",
    "./strategy-protocol.js",
    "./config.js",
    "./map-geometry.js",
    "./model.js",
    "./randomized-best-first-minimax.js",
    "./strategy.js"
);

const config = createGameConfig();
const geometry = createGameMapGeometry();
const model = createGameModel();

// ============================================================
// STRATEGY BUFFER WORKER
// ============================================================
//
// Owns a search strategy and answers anchors with the decision plan it
// would take during the next second. The main thread never waits for it:
// it follows the plan cursor and falls back to a cheap decision when the
// plan has no node for the current event.
//
// Jobs are stepped in small slices so a new anchor can replace the running
// prediction without waiting for it to finish.

let strategy = null;
let strategySignature = null;
let currentJob = null;
let jobId = 0;

// The strategy is rebuilt when the map changes, including its id: two
// maps can share a layout but have different persisted graphs.
function computeStrategySignature(definition) {
    return JSON.stringify({
        id: definition.id,
        tiles: definition.tiles,
        edges: [...(definition.edges || [])].sort(),
        playerStart: definition.playerStart,
        ghostStarts: definition.ghostStarts
    });
}

function restoreMap(definition) {
    return {
        ...definition,
        edges: new Set(definition.edges || [])
    };
}

function ensureStrategy(definition) {
    const signature = computeStrategySignature(definition);

    if (strategy && signature === strategySignature) {
        return strategy;
    }

    strategySignature = signature;
    strategy = createGameStrategy({
        map: definition,
        geometry,
        model,
        config,
        rmfMinimax: createRandomizedBestFirstMinimax
    });

    return strategy;
}

// The plan is small: the main thread gets the whole tree so it can follow
// the branch that matches the player's decisions.
function postPlan(job, complete) {
    self.postMessage({
        type: STRATEGY_BUFFER_MESSAGE.plan,
        mapId: job.mapId,
        revision: job.revision,
        plan: job.plan.map(node => node || null),
        complete,
        stats: {
            nodes: job.nodeCount,
            queued: job.queue.length
        }
    });
}

function postError(anchor, error) {
    self.postMessage({
        type: STRATEGY_BUFFER_MESSAGE.error,
        mapId: anchor?.map?.id,
        revision: anchor?.revision,
        error: String(error),
        stack: error?.stack || ""
    });
}

function startJob(anchor) {
    try {
        const job = strategy.createPolicyBufferJob(anchor.searchContext, {
            readyGhostIndices: anchor.readyGhostIndices || [],
            readyPlayer: Boolean(anchor.readyPlayer),
            horizonSeconds: STRATEGY_PLAN_HORIZON_SECONDS,
            maxNodes: STRATEGY_PLAN_MAX_NODES
        });

        job.id = ++jobId;
        job.mapId = anchor.map.id;
        job.revision = anchor.revision;
        job.strategy = strategy;
        job.anchor = anchor;
        job.deepening = false;
        currentJob = job;

        postPlan(job, job.complete);
        scheduleStep(job.id);
    } catch (error) {
        postError(anchor, error);
    }
}

function scheduleStep(id) {
    setTimeout(() => {
        const job = currentJob;

        if (!job || job.id !== id || job.complete) {
            return;
        }

        try {
            const startedAt = Date.now();

            while (!job.complete && Date.now() - startedAt < 8) {
                job.strategy.stepPolicyBufferJob(job, 1);
            }

            postPlan(job, job.complete);
        } catch (error) {
            postError({ map: { id: job.mapId }, revision: job.revision }, error);
            job.complete = true;
            return;
        }

        if (!job.complete) {
            scheduleStep(job.id);
            return;
        }

        scheduleDeepening(job);
    }, 0);
}

// Between anchors the worker keeps extending the graph from the state the
// game reached, the same way the main thread used to do every frame.
function scheduleDeepening(job) {
    setTimeout(() => {
        if (currentJob !== job || !job.complete) {
            return;
        }

        try {
            if (!job.deepening) {
                job.strategy.advanceSearchFrom(
                    job.anchor.searchContext,
                    job.anchor.readyGhostIndices || [],
                    Boolean(job.anchor.readyPlayer)
                );
                job.deepening = true;
            }

            const startedAt = Date.now();

            while (Date.now() - startedAt < 4) {
                job.strategy.advanceSearch();
            }
        } catch (error) {
            postError(
                { map: { id: job.mapId }, revision: job.revision },
                error
            );

            return;
        }

        scheduleDeepening(job);
    }, 16);
}

self.onmessage = event => {
    const message = event.data;

    if (message?.type !== STRATEGY_BUFFER_MESSAGE.anchor) {
        return;
    }

    try {
        const definition = restoreMap(message.map);
        ensureStrategy(definition);
        startJob(message);
    } catch (error) {
        postError(message, error);
    }
};
