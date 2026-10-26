// Measures how many live decisions the transmitted plan answers. It plays
// a two-Pac-Man game with the real rules, the real AI controller and the
// real strategy worker (a worker_thread running src/strategy/worker.js)
// and prints the plan hits, the misses and why they missed. Use it to
// measure a change of the plan pipeline instead of guessing: the interesting
// numbers are hits vs misses and the keys of metrics.missing.
//
// Usage, from the repository root:
//   node develop/plan-latency.js [restart|respawn] [direction] [seconds]
const { Worker } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = process.cwd();
let rngSeed = 123456789;
Math.random = () => {
    rngSeed = (Math.imul(rngSeed, 1664525) + 1013904223) >>> 0;
    return rngSeed / 4294967296;
};
const rd = f => fs.readFileSync(path.join(root, "src", f), "utf8")
    .replace(/\r\n/g, "\n");

for (const file of [
    "config.js",
    "map-geometry.js",
    "model.js",
    "strategy/randomized-best-first-minimax.js",
    "strategy/strategy.js",
    "strategy/protocol.js",
    "calibration/protocol.js",
    "ai-controller.js",
    "rules.js"
]) {
    vm.runInThisContext(rd(file), { filename: file });
}

const TILES = [
    "####################",
    "#........##........#",
    "#.####.#.##.#.####.#",
    "#o####.#.##.#.####o#",
    "#..................#",
    "#.####.###.#######.#",
    "#......#...#.......#",
    "######.#.###.#.######",
    "     #.#...H.#.#     ",
    "######.#.###.#.######",
    "............#.......#",
    "#.####.###.###.####.#",
    "#o..##........##..o.",
    "###.##.##.##.##.####",
    "#......#....#.......#",
    "#.####.#.##.#.####..#",
    "#..................#",
    "####################"
].map(row => Array.from(row));

const rows = TILES.length;
const columns = TILES[0].length;
const geometry = createGameMapGeometry();
const DIRECTIONS = geometry.DIRECTIONS;
const config = createGameConfig();
const model = createGameModel();

const playerStarts = [
    { x: 10, y: 4, direction: { ...DIRECTIONS.left }, color: "#ffd43b" },
    { x: 1, y: 1, direction: { ...DIRECTIONS.right }, color: "#3ad1ff" }
];
const ghostStarts = [
    { x: 12, y: 4, direction: { ...DIRECTIONS.left }, color: "#e05252" },
    { x: 10, y: 10, direction: { ...DIRECTIONS.left }, color: "#52e08a" },
    { x: 18, y: 1, direction: { ...DIRECTIONS.left }, color: "#52a0e0" }
];

const pellets = () => new Set(TILES.flatMap((row, y) => row.map(
    (tile, x) => tile === "." || tile === "o" ? x + "," + y : null
).filter(Boolean)));

const definition = {
    id: "live-diag",
    tiles: TILES.map(row => [...row]),
    edges: new Set(),
    playerStarts,
    ghostStarts,
    deathMode: "restart"
};

const map = {
    DIRECTIONS,
    currentMap: definition,
    graph: null,
    strategicSearch: { frontier: [], root: null },
    getMapColumnCount: () => columns,
    getMapRowCount: () => rows,
    wrap: (value, size) => ((value % size) + size) % size,
    canMove: (x, y, direction) =>
        TILES[(((y + direction.y) % rows) + rows) % rows]
            [(((x + direction.x) % columns) + columns) % columns] !== "#",
    getPossibleDirections: character => Object.values(DIRECTIONS).filter(direction =>
        TILES[((character.y + direction.y + rows) % rows)]
            [(character.x + direction.x + columns) % columns] !== "#"),
    buildGhostHouses: () => [{ x: 11, y: 8 }],
    getPlayerStarts: def => def.playerStarts,
    getDeathMode: def => def.deathMode === "respawn" ? "respawn" : "restart",
    buildMapData: () => ({
        graph: geometry.buildGraph(definition, Object.values(DIRECTIONS)),
        pellets: pellets()
    }),
    buildGraph: def => geometry.buildGraph(def, Object.values(DIRECTIONS)),
    getCurrentMapDefinition: () => definition,
    cloneMapDefinition: def => structuredClone(def)
};

const state = {
    currentGameState: {},
    selectedCharacter: "pacman",
    pressedDirections: ["left"],
    statusElement: { textContent: "" },
    BASE_PACMAN_COLORS: ["#ffd43b"],
    setStatus: () => {},
    getGhostColor: index => ["#e05252", "#52e08a", "#52a0e0"][index] || "#fff"
};

// ============================================================
// PLAN BRIDGE (main.js logic, adapted)
// ============================================================

let revision = 0;
let plan = [];
let cursor = null;
let planRevision = -1;
let activeMapId = null;
const metrics = { hits: 0, misses: 0, plans: 0, nodes: 0, lost: 0, late: 0, records: 0, missing: {} };

function logProblem(reason, detail = {}) {
    metrics.missing[reason] = (metrics.missing[reason] || 0) + 1;
    if (process.env.DIAG_LOG) {
        console.log("[plan] " + reason + " " + JSON.stringify(detail));
    }
}

function findPlanNode(nodes, key) {
    for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        if (node && node.key === key) return index;
    }
    return -1;
}

function currentNode() {
    return cursor === null ? null : plan[cursor] || null;
}

const bridge = {
    anchor({ map: anchorMap, searchContext, readyGhostIndices, readyPlayerIndices }) {
        if (anchorMap.id !== activeMapId) {
            activeMapId = anchorMap.id;
            plan = [];
            cursor = null;
            planRevision = -1;
            revision = 0;
        }
        revision++;
        worker.postMessage({
            type: STRATEGY_BUFFER_MESSAGE.anchor,
            revision,
            map: anchorMap,
            searchContext,
            readyGhostIndices,
            readyPlayerIndices
        });
    },
    getPlanAction(mode, key) {
        let node = currentNode();
        let placed = true;

        if (key !== undefined && (!node || node.key !== key)) {
            const index = findPlanNode(plan, key);
            if (index >= 0) {
                cursor = index;
                node = plan[index];
            } else {
                placed = false;
            }
        }

        let reason = null;

        if (!node) {
            reason = plan.length === 0
                ? (planRevision === revision ? "empty-plan" : "plan-not-updated")
                : "plan-exhausted";
        } else if (!placed) {
            reason = "key-not-found";
        } else if (node.actor !== mode) {
            reason = "actor-mismatch";
        } else if (!node.action) {
            reason = "no-action";
        } else if (key !== undefined && node.key !== key) {
            reason = "key-mismatch";
        }

        if (reason !== null) {
            metrics.misses++;
            logProblem(reason, {
                mode,
                cursor,
                nodes: plan.length,
                stale: planRevision !== revision,
                time: node ? Number(node.time.toFixed(3)) : null
            });
            return null;
        }

        if (!node.choices) {
            cursor = node.child ?? null;
        }
        metrics.hits++;
        return node.action;
    },
    recordHuman(mode, index, direction) {
        if (direction && direction.x === 0 && direction.y === 0) return;

        const node = currentNode();

        if (!node || node.actor !== mode || !node.choices) {
            logProblem("human-node-missing", { mode, cursor, nodes: plan.length });
            return;
        }

        const choice = node.choices.find(option =>
            option.direction.x === direction.x &&
            option.direction.y === direction.y
        );

        if (!choice) {
            logProblem("human-choice-not-in-plan", { mode, direction });
            return;
        }

        cursor = choice.child ?? null;
        metrics.records++;
    }
};

function onPlanMessage(message) {
    if (message?.type === STRATEGY_BUFFER_MESSAGE.error) {
        console.warn("worker error:", message.error);
        return;
    }
    if (message?.type !== STRATEGY_BUFFER_MESSAGE.plan) return;
    if (message.mapId !== activeMapId) return;

    const incoming = message.plan || [];

    if (message.revision === revision) {
        if (!incoming[0]) {
            if (!message.complete) logProblem("waiting-new-plan", { revision: message.revision });
            return;
        }
        if (message.revision !== planRevision) {
            planRevision = message.revision;
            plan = incoming;
            cursor = 0;
        } else {
            const node = currentNode();
            const index = node === null ? -1 : findPlanNode(incoming, node.key);
            plan = incoming;
            cursor = index >= 0 ? index : 0;
        }
    } else {
        const node = currentNode();
        const index = node === null ? -1 : findPlanNode(incoming, node.key);

        if (!incoming[0] || message.revision <= planRevision) {
            metrics.lost++;
            return;
        }

        planRevision = message.revision;
        plan = incoming;
        cursor = index >= 0 ? index : null;
        metrics.late++;
    }

    metrics.plans++;
    metrics.nodes = plan.filter(Boolean).length;
}

const worker = new Worker(path.join(__dirname, "plan-latency-worker.js"), {
    workerData: { root, seed: 42 }
});
worker.on("message", onPlanMessage);
worker.on("error", error => console.error("worker failed:", error));

const intelligence = createGameAiController({
    config,
    state,
    map,
    geometry,
    model,
    rmfMinimax: createRandomizedBestFirstMinimax,
    workerBridge: bridge
});

const rules = createGameRules({
    config,
    state,
    map,
    model,
    intelligence,
    ui: { updateUI: () => {}, updatePauseButton: () => {} }
});

rules.resetGame();
const gs = state.currentGameState;
gs.running = true;
gs.time = 0;

const mode = process.argv[2] || "restart";
definition.deathMode = mode;
state.pressedDirections = process.argv[3] ? [process.argv[3]] : ["left"];

let updates = 0;
const timer = setInterval(() => {
    updates++;
    if (updates > 60 * Number(process.argv[4] || 40)) {
        clearInterval(timer);
        setTimeout(finish, 300);
        return;
    }
    if (!gs.running && gs.deathTimer <= 0) {
        gs.running = true;
    }
    rules.update(1 / 60);
}, 16);

function finish() {
    console.log(JSON.stringify({
        mode,
        gameTime: Number(gs.time.toFixed(1)),
        metrics,
        lives: gs.players.map(player => player.lives),
        pellets: gs.pellets.size
    }, null, 2));
    worker.terminate();
    process.exit(0);
}
