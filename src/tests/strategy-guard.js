// Guard test: Pac-Man is inside a ring corridor whose only exit leads to a
// bottom room. A ghost waits at the exit. If the ghost enters the ring and
// chases, Pac-Man can loop the other way and leave; the ghost must hold the
// exit instead of entering the circuit and moving away from it.
//
// Usage: node src/tests/strategy-guard.js [searchSteps] [trials]

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
    "##########",
    "#........#",
    "#.######.#",
    "#.#....#.#",
    "#.#....#.#",
    "#.#....#.#",
    "#.######.#",
    "#........#",
    "####.#####",
    "#........#",
    "##########"
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
    id: "ring",
    tiles: TILES.map(row => [...row]),
    edges: new Set(),
    playerStart: { x: 1, y: 1, direction: { x: 1, y: 0 } },
    ghostStarts: [
        { x: 4, y: 7, direction: { x: 0, y: 1 } },
        { x: 1, y: 9, direction: { x: 1, y: 0 } },
        { x: 8, y: 9, direction: { x: -1, y: 0 } }
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
        { x: 1, y: 1, direction: { x: 0, y: 1 } },
        config.PACMAN_SPEED
    );
    const ghosts = [
        model.createGhostState({ x: 4, y: 7, direction: { x: 0, y: 1 } }, "#f00", config.GHOST_SPEED),
        model.createGhostState({ x: 1, y: 9, direction: { x: 1, y: 0 } }, "#0f0", config.GHOST_SPEED),
        model.createGhostState({ x: 8, y: 9, direction: { x: -1, y: 0 } }, "#00f", config.GHOST_SPEED)
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
            player: { x: 1, y: 1 },
            ghosts: currentMap.ghostStarts.map(start => ({
                x: start.x, y: start.y, direction: { ...start.direction }, speed: config.GHOST_SPEED
            })),
            houses: []
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

const base = context();
const baseState = strategy.createCurrentGameSearchState(base, [0], false);

console.log("Pac-Man in the ring at (1,1); ghost at the only exit (4,7)");

for (const profile of strategy.getSearchGhostActionProfiles(baseState)) {
    const direction = profile[0][1];
    const next = strategy.advanceSearchState(
        strategy.createCurrentGameSearchState(base, [0], false),
        new Map(profile),
        null
    );
    console.log("  ghost " + direction.x + "," + direction.y +
        " domain=" + countPacmanCells(next) +
        " value=" + strategy.evaluateSearchState(next).toFixed(1));
}

// Seeded RNG so the randomized search is reproducible.
let seed = 123456789;
Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
};

const choices = [];
let holds = 0;

for (let trial = 0; trial < trials; trial++) {
    const chosen = strategy.chooseGhostDirections(context(), [0], false, searchSteps).get(0);
    choices.push(chosen.x + "," + chosen.y);
    // Guarding means going into the exit corridor (down), not along the ring.
    if (chosen.x === 0 && chosen.y === 1) holds++;
}

console.log("decisions holding the only exit: " + holds + "/" + trials +
    " " + JSON.stringify([...new Set(choices)]));

({ holds, trials });
`, ctx);

if (result.holds < result.trials) {
    console.error(
        "FAIL: the ghost left the only exit of the ring instead of holding it (" +
        result.holds + "/" + result.trials + " holding decisions)"
    );
    process.exitCode = 1;
} else {
    console.log("guard test ok");
}
