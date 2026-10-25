/* global importScripts, self */

importScripts(
    "../calibration/protocol.js",
    "./protocol.js",
    "../config.js",
    "../map-geometry.js",
    "../model.js",
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
        playerStarts: definition.playerStarts,
        deathMode: definition.deathMode,
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

// The plan is small: the main thread gets the whole tree it needs to follow
// the branch that matches the player's decisions. The worker keeps a longer
// plan internally so the search has a temporal cushion.
function postPlan(job, complete, first = false) {
    const plan = job.strategy.getTransmittedPlan(job);
    const postedAt = Date.now();
    const message = {
        type: STRATEGY_BUFFER_MESSAGE.plan,
        mapId: job.mapId,
        revision: job.revision,
        first,
        plan,
        complete,
        stats: {
            nodes: plan.filter(Boolean).length,
            queued: 0
        }
    };

    job.postedAt = postedAt;

    // How long the game waited for the first plan of this anchor: when it
    // is longer than the decision interval the plan arrives too late.
    if (first) {
        message.latency = postedAt - job.anchor.receivedAt;
    }

    self.postMessage(message);
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
            readyPlayerIndices: anchor.readyPlayerIndices || [],
            horizonSeconds: STRATEGY_PLAN_INTERNAL_HORIZON_SECONDS,
            transmittedHorizonSeconds: STRATEGY_PLAN_HORIZON_SECONDS
        });

        job.id = ++jobId;
        job.mapId = anchor.map.id;
        job.revision = anchor.revision;
        job.strategy = strategy;
        job.anchor = anchor;
        job.deepening = false;
        job.postedAt = 0;
        job.startedAt = Date.now();
        // A terminal origin has no plan to transmit: say it once and stop
        // instead of posting an empty plan on every slice.
        job.complete = job.root === null;
        currentJob = job;

        postPlan(job, job.complete, true);
        scheduleStep(job.id);
    } catch (error) {
        postError(anchor, error);

        if (currentJob) {
            scheduleStep(currentJob.id);
        }
    }
}

// The internal plan is one transmitted plan longer than the view. Between
// anchors the worker keeps expanding it along the branches the next plan
// will follow, so the next plan is a read of the tree instead of an
// expansion that would arrive after the decision it answers.
const CUSHION_SLICE_MILLISECONDS = 8;

// Building the plan view costs more than a walk slice. Posting it on every
// slice would keep the worker inside a view when the next anchor arrives,
// and that anchor (the one the game is waiting for) would queue behind it.
// The main thread consumes a plan per decision, so an interval is enough.
const PLAN_POST_INTERVAL_MILLISECONDS = 50;

// The game waits for the plan of the anchor it just sent, so an arriving
// anchor drops the walk slice that is still queued: it would only add
// latency to the answer the game is waiting for.
let stepTimer = null;

function stopStep() {
    if (stepTimer !== null) {
        clearTimeout(stepTimer);
        stepTimer = null;
    }
}

function scheduleStep(id) {
    stepTimer = setTimeout(() => {
        stepTimer = null;

        const job = currentJob;

        if (!job || job.id !== id || job.complete) {
            return;
        }

        try {
            job.strategy.stepPolicyBufferJob(job, 1);
            job.strategy.expandPolicyBufferCushion(
                job,
                CUSHION_SLICE_MILLISECONDS
            );

            if (
                Date.now() - job.postedAt >=
                PLAN_POST_INTERVAL_MILLISECONDS
            ) {
                postPlan(job, job.complete);
            }
        } catch (error) {
            postError({ map: { id: job.mapId }, revision: job.revision }, error);
            job.complete = true;
            return;
        }

        scheduleStep(job.id);
    }, 0);
}

// The main thread signals the root again after every decision, so the
// worker may receive several anchors while it is still building a plan.
// Only the latest one matters: the intermediate ones describe roots the
// game has already left behind.
let pendingAnchor = null;
let anchorScheduled = false;

function queueAnchor(anchor) {
    pendingAnchor = anchor;

    if (anchorScheduled) {
        return;
    }

    // The game is waiting for this anchor: drop the walk slice still queued.
    stopStep();
    anchorScheduled = true;
    setTimeout(buildPendingAnchor, 0);
}

function buildPendingAnchor() {
    anchorScheduled = false;

    const anchor = pendingAnchor;

    pendingAnchor = null;

    if (!anchor) {
        return;
    }

    try {
        ensureStrategy(restoreMap(anchor.map));
        startJob(anchor);
    } catch (error) {
        postError(anchor, error);

        if (currentJob) {
            scheduleStep(currentJob.id);
        }
    }
}

self.onmessage = event => {
    const message = event.data;

    if (message?.type !== STRATEGY_BUFFER_MESSAGE.anchor) {
        return;
    }

    message.receivedAt = Date.now();
    queueAnchor(message);
};
