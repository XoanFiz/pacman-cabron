/* global importScripts, self */

importScripts(
    "./calibration/protocol.js",
    "./strategy-protocol.js",
    "./strategy-version.js",
    "./config.js",
    "./map-geometry.js",
    "./model.js",
    "./map-storage.js",
    "./randomized-best-first-minimax.js",
    "./strategy.js"
);

const config = createGameConfig();
const geometry = createGameMapGeometry();
const model = createGameModel();
const mapStorage = createGameMapStorage();

// ============================================================
// STRATEGY BUFFER WORKER
// ============================================================
//
// Owns a search strategy and answers anchors with the decisions it would
// take during the next second. The main thread never waits for it: it
// consumes the entries by state key and falls back to its own search when
// one is missing.
//
// Jobs are stepped in small slices so a new anchor can replace the running
// prediction without waiting for it to finish.

let strategy = null;
let strategySignature = null;
let strategyMapId = null;
let strategyMapSignature = null;
let graphReady = Promise.resolve();
let pendingAnchor = null;
let currentJob = null;
let jobId = 0;
let graphDirty = false;
let lastAnchorAt = 0;
let lastSaveAt = 0;

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

// The stored map signature never includes the id (map.js writes it that
// way), so it is kept separate.
function mapSignature(definition) {
    return JSON.stringify({
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

async function loadPersistedGraph(definition) {
    try {
        const record = await mapStorage.loadStrategyGraph(definition.id);

        if (
            strategy &&
            strategyMapId === definition.id &&
            record?.graph &&
            record.mapSignature === mapSignature(definition) &&
            record.strategyVersion === STRATEGY_VERSION
        ) {
            strategy.importGraph(record.graph);
        }
    } catch (error) {
        console.warn(
            "[strategy worker] unable to load the strategy graph.",
            error
        );
    }
}

// The worker is the owner of the explored graph and of its value table,
// so it is also the one that writes both. The main thread only persists
// as a no-worker fallback.
function persistStrategyData(expectedMapId = null) {
    if (!strategy || !strategyMapId || !strategyMapSignature) {
        return Promise.resolve(false);
    }

    if (expectedMapId && expectedMapId !== strategyMapId) {
        return Promise.resolve(false);
    }

    try {
        const startedAt = Date.now();
        const graph = strategy.exportGraph();
        const values = strategy.exportValueTable();
        const metadata = {
            mapSignature: strategyMapSignature,
            strategyVersion: STRATEGY_VERSION
        };

        graphDirty = false;
        lastSaveAt = Date.now();

        return Promise.all([
            mapStorage.saveStrategyGraph(
                strategyMapId,
                graph,
                metadata
            ),
            mapStorage.saveStrategyValues(
                strategyMapId,
                values,
                metadata
            )
        ]).then(() => {
            console.log(
                `[strategy worker] saved ${graph.nodes.length} nodes ` +
                `in ${Date.now() - startedAt}ms`
            );

            return true;
        }).catch(error => {
            graphDirty = true;
            console.warn(
                "[strategy worker] unable to save the strategy data.",
                error
            );

            return false;
        });
    } catch (error) {
        console.warn(
            "[strategy worker] unable to export the strategy data.",
            error
        );

        return Promise.resolve(false);
    }
}

function ensureStrategy(definition) {
    const signature = computeStrategySignature(definition);

    if (strategy && signature === strategySignature) {
        return strategy;
    }

    // The previous map's tree is saved before it is discarded.
    if (strategy) {
        void persistStrategyData();
    }

    strategySignature = signature;
    strategyMapId = definition.id;
    strategyMapSignature = mapSignature(definition);
    strategy = createGameStrategy({
        map: definition,
        geometry,
        model,
        config,
        rmfMinimax: createRandomizedBestFirstMinimax
    });
    graphDirty = false;
    graphReady = loadPersistedGraph(definition);

    return strategy;
}

// Exporting a large graph is expensive, so the periodic save waits until
// no anchor has arrived for a few seconds: the start screen, a pause or a
// menu. A five minute ceiling still bounds what a crash can lose.
setInterval(() => {
    if (!graphDirty) {
        return;
    }

    const idle = Date.now() - lastAnchorAt > 3000;
    const overdue = Date.now() - lastSaveAt > 300000;

    if (idle || overdue) {
        void persistStrategyData();
    }
}, STRATEGY_GRAPH_SAVE_INTERVAL_MS);

// Only the entries added since the previous message are sent; the main
// thread clears its buffer when the revision changes and merges after.
function postBuffer(job, complete) {
    const entries = [...job.entries.values()];
    const fresh = entries.slice(job.posted);

    job.posted = entries.length;

    self.postMessage({
        type: STRATEGY_BUFFER_MESSAGE.buffer,
        mapId: job.mapId,
        revision: job.revision,
        entries: fresh,
        complete,
        stats: {
            entries: entries.length,
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
            horizonSeconds: STRATEGY_BUFFER_HORIZON_SECONDS,
            maxEntries: STRATEGY_BUFFER_MAX_ENTRIES
        });

        job.id = ++jobId;
        job.mapId = anchor.map.id;
        job.revision = anchor.revision;
        job.strategy = strategy;
        job.anchor = anchor;
        job.posted = 0;
        job.deepening = false;
        graphDirty = true;
        currentJob = job;

        postBuffer(job, job.complete);
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

            postBuffer(job, job.complete);
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

            graphDirty = true;
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

    if (message?.type === STRATEGY_BUFFER_MESSAGE.persist) {
        void persistStrategyData(message.mapId || null).then(saved => {
            if (message.requestId === undefined) {
                return;
            }

            self.postMessage({
                type: STRATEGY_BUFFER_MESSAGE.persisted,
                requestId: message.requestId,
                saved
            });
        });

        return;
    }

    if (message?.type !== STRATEGY_BUFFER_MESSAGE.anchor) {
        return;
    }

    try {
        lastAnchorAt = Date.now();

        const definition = restoreMap(message.map);
        ensureStrategy(definition);

        pendingAnchor = message;

        const ready = graphReady;

        void ready.then(() => {
            if (pendingAnchor !== message) {
                return;
            }

            startJob(message);
        });
    } catch (error) {
        postError(message, error);
    }
};
