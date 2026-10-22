// Trap test: Pac-Man sits in the one-cell dead end at (12,9) of the classic
// map and its only exit (12,8) is occupied by a ghost. The ghost must step
// in and catch him: leaving the exit lets Pac-Man escape, and staying in
// front of him forever is not a win for the ghosts.
//
// The test checks the value of the ghost actions, runs the randomized
// decision twenty times, and then follows the decision plan until Pac-Man
// is caught. It fails when a decision leaves the exit or the plan never
// catches him.
//
// Usage: node src/tests/strategy-trap.js [searchSteps] [trials]

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = path.resolve(__dirname, "../..");
const searchSteps = Number(process.argv[2] || 24);
const trials = Number(process.argv[3] || 20);
const rd = p => fs.readFileSync(path.join(main, "src", p), "utf8")
    .replace(/\r\n/g, "\n");

const ctx = vm.createContext({
    console,
    Math,
    JSON,
    Set,
    Map,
    structuredClone,
    searchSteps,
    trials
});
for (const f of [
    "config.js",
    "map-geometry.js",
    "model.js",
    "randomized-best-first-minimax.js",
    "strategy.js"
]) {
    vm.runInContext(rd(f), ctx, { filename: f });
}

const result = vm.runInContext(`
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

const DIRECTIONS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const rows = TILES.length;
const cols = TILES[0].length;
const wrap = (v, n) => ((v % n) + n) % n;
const canMove = (x, y, d) => TILES[wrap(y + d.y, rows)][wrap(x + d.x, cols)] !== "#";
const geometry = createGameMapGeometry();
const model = createGameModel();
const config = createGameConfig();

const currentMap = {
    id: "classic-trap",
    tiles: TILES.map(row => [...row]),
    edges: new Set(),
    playerStart: { x: 10, y: 10, direction: { x: 0, y: 0 } },
    ghostStarts: [
        { x: 9, y: 8, direction: { x: 1, y: 0 } },
        { x: 10, y: 8, direction: { x: -1, y: 0 } },
        { x: 11, y: 10, direction: { x: -1, y: 0 } }
    ]
};

const strategy = createGameStrategy({
    map: currentMap,
    geometry,
    model,
    config,
    rmfMinimax: createRandomizedBestFirstMinimax
});

function context() {
    const player = model.createPlayerState(
        { x: 12, y: 9, direction: { x: 0, y: -1 } },
        config.PACMAN_SPEED
    );
    const ghosts = [
        model.createGhostState({ x: 12, y: 8, direction: { x: 0, y: 1 } }, "#f00", config.GHOST_SPEED),
        model.createGhostState({ x: 9, y: 8, direction: { x: 1, y: 0 } }, "#0f0", config.GHOST_SPEED),
        model.createGhostState({ x: 11, y: 10, direction: { x: -1, y: 0 } }, "#00f", config.GHOST_SPEED)
    ];

    ghosts[0].needsDirection = true;
    ghosts[0].decisionAtCentre = true;

    return {
        player,
        ghosts,
        pellets: new Set(),
        lives: 3,
        time: 0,
        respawnState: {
            player: { x: 10, y: 10 },
            ghosts: currentMap.ghostStarts.map(start => ({
                x: start.x, y: start.y, direction: { ...start.direction }, speed: config.GHOST_SPEED
            })),
            houses: [{ x: 11, y: 8 }]
        },
        controlledGhostIndex: -1
    };
}

function countPacmanCells(searchState) {
    const domain = strategy.calculateDomain(
        searchState.player,
        searchState.ghosts,
        searchState.respawnState.houses,
        searchState.pellets,
        searchState.time,
        true
    );
    let owned = 0;
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (TILES[y][x] !== "#" && domain[y][x].owner === "pacman") {
                owned++;
            }
        }
    }
    return owned;
}

function outcome(direction) {
    const next = strategy.advanceSearchState(
        strategy.createCurrentGameSearchState(context(), [0], false),
        new Map([[0, direction]]),
        null
    );
    return {
        lives: next.lives,
        domain: countPacmanCells(next),
        value: strategy.evaluateSearchState(next)
    };
}

const base = context();
const baseState = strategy.createCurrentGameSearchState(base, [0], false);

console.log("Pac-Man trapped at (12,9); ghost at the only exit (12,8)");

for (const profile of strategy.getSearchGhostActionProfiles(baseState)) {
    const direction = profile[0][1];
    const option = outcome(direction);

    console.log("  ghost " + direction.x + "," + direction.y +
        " domain=" + option.domain +
        " lives=" + option.lives +
        " value=" + option.value.toFixed(1));
}

// Seeded RNG so the randomized search is reproducible.
let seed = 123456789;
Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
};

const choices = [];
let catches = 0;

for (let trial = 0; trial < trials; trial++) {
    const chosen = strategy.chooseGhostDirections(context(), [0], false, searchSteps).get(0);
    const option = outcome(chosen);

    choices.push(chosen.x + "," + chosen.y);

    if (option.lives < 3) catches++;
}

console.log("decisions that catch Pac-Man: " + catches + "/" + trials +
    " " + JSON.stringify([...new Set(choices)]));

// Follow the plan, rebuilt at every decision, like the worker does.
function readyGhosts(state) {
    const indices = [];
    for (let index = 0; index < state.readyGhosts.length; index++) {
        if (state.readyGhosts[index]) indices.push(index);
    }
    return indices;
}

function anchorPlan(state) {
    const job = strategy.createPolicyBufferJob(state, {
        readyGhostIndices: readyGhosts(state),
        readyPlayer: state.readyPlayer,
        horizonSeconds: 2,
        maxNodes: 128,
        transmittedHorizonSeconds: 1,
        transmittedMaxNodes: 64,
        searchSteps: searchSteps
    });

    let steps = 0;
    while (!job.complete && steps++ < 500) {
        strategy.stepPolicyBufferJob(job, 1);
    }

    return job;
}

let state = strategy.createCurrentGameSearchState(context(), [0], false);
let plans = 0;
let caught = false;

while (plans++ < 20 && state.lives === 3 && !state.terminal) {
    const job = anchorPlan(state);
    let node = job.plan[0];

    while (node) {
        if (node.actor === "ghost") {
            state = strategy.advanceSearchState(
                state,
                new Map(node.action ? node.action.ghostDirections : []),
                null
            );
        } else {
            state = strategy.advanceSearchState(
                state,
                new Map(),
                node.choices[0].direction
            );
        }

        node = node.child !== null ? job.plan[node.child] : null;
    }

    if (state.lives < 3) {
        caught = true;
        console.log("plan caught Pac-Man after " + plans + " plans, t=" + state.time.toFixed(2));
        break;
    }
}

if (!caught) {
    console.log("plan did NOT catch Pac-Man after " + plans + " plans, t=" + state.time.toFixed(2) +
        " pacman=" + JSON.stringify({ x: state.player.x, y: state.player.y }));
}

({ catches, trials, caught });
`, ctx);

if (!result.caught) {
    console.error(
        "FAIL: the ghost did not always go for the trapped Pac-Man (" +
        result.catches + "/" + result.trials + " catching decisions, caught=" +
        result.caught + ")"
    );
    process.exitCode = 1;
} else {
    console.log("trap test ok");
}
