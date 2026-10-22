// Classic-map circuit: Pac-Man is inside the isolated right-hand loop whose
// only exit is the cell (12,16). A ghost at the door (13,16) must hold the
// exit instead of entering the loop; if it chases around the loop, Pac-Man
// comes out behind it through (12,16).
//
// Usage: node src/tests/strategy-circuit.js [searchSteps] [trials]

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = path.resolve(__dirname, "../..");
const searchSteps = Number(process.argv[2] || 24);
const trials = Number(process.argv[3] || 10);
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
    id: "classic",
    tiles: TILES.map(row => [...row]),
    edges: new Set(),
    playerStart: { x: 10, y: 10, direction: { x: 0, y: 0 } },
    ghostStarts: [
        { x: 13, y: 16, direction: { x: 1, y: 0 } },
        { x: 1, y: 1, direction: { x: 1, y: 0 } },
        { x: 10, y: 10, direction: { x: -1, y: 0 } }
    ]
};

const pellets = new Set();
for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
        if (TILES[y][x] === "." || TILES[y][x] === "o") pellets.add(x + "," + y);
    }
}

const strategy = createGameStrategy({
    map: currentMap,
    geometry,
    model,
    config,
    rmfMinimax: createRandomizedBestFirstMinimax
});

function context() {
    const ghosts = [
        model.createGhostState({ x: 13, y: 16, direction: { x: 1, y: 0 } }, "#f00", config.GHOST_SPEED),
        model.createGhostState({ x: 1, y: 1, direction: { x: 1, y: 0 } }, "#0f0", config.GHOST_SPEED),
        model.createGhostState({ x: 10, y: 10, direction: { x: -1, y: 0 } }, "#00f", config.GHOST_SPEED)
    ];
    ghosts[0].needsDirection = true;
    ghosts[0].decisionAtCentre = true;

    return {
        player: model.createPlayerState({ x: 18, y: 14, direction: { x: -1, y: 0 } }, config.PACMAN_SPEED),
        ghosts,
        pellets: new Set(pellets),
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

const base = context();
const baseState = strategy.createCurrentGameSearchState(base, [0], false);

console.log("Pac-Man at (18,14) in the right loop; ghost at the door (13,16); exit (12,16)");

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
    // Holding the exit from the door means stepping back into (12,16).
    if (chosen.x === -1 && chosen.y === 0) holds++;
}

console.log("decisions holding the exit: " + holds + "/" + trials +
    " " + JSON.stringify([...new Set(choices)]));

// Play both sides until Pac-Man escapes through (12,16) or the run ends.
let state = strategy.createCurrentGameSearchState(context(), [0], false);
let events = 0;
let escaped = false;

while (events++ < 300 && state.lives === 3 && !state.terminal) {
    if (state.firstActor === "ghosts") {
        const indices = state.readyGhosts
            .map((ready, index) => ready ? index : -1)
            .filter(index => index >= 0);
        const directions = strategy.chooseGhostDirections(
            state, indices, state.readyPlayer, searchSteps
        );
        state = strategy.advanceSearchState(state, directions, null);
    } else if (state.firstActor === "player") {
        const direction = strategy.choosePacmanDirection(state, [], searchSteps);
        state = strategy.advanceSearchState(state, new Map(), direction);
    } else {
        break;
    }

    // (12,16) is the exit; the main map is x < 12.
    if (state.player.y === 16 && state.player.x <= 11) {
        escaped = true;
        break;
    }
}

console.log("Pac-Man escaped: " + escaped + " after " + events + " events, t=" +
    state.time.toFixed(2) + " ghost0=" + JSON.stringify({
        x: state.ghosts[0].x,
        y: state.ghosts[0].y
    }));

({ holds, trials, escaped });
`, ctx);

if (result.holds < result.trials || result.escaped) {
    console.error(
        "FAIL: the ghost did not hold the only exit of the right loop (" +
        result.holds + "/" + result.trials + " holding decisions, escaped=" +
        result.escaped + ")"
    );
    process.exitCode = 1;
} else {
    console.log("circuit test ok");
}
