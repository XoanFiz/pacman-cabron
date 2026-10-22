// Classic-map circuit, realistic situations: Pac-Man is inside the isolated
// right loop whose only exit is (12,16), with the door at (13,16). The test
// plays several positions, directions and readiness states and checks that
// the ghost keeps the exit covered and that Pac-Man never escapes. A single
// snapshot only showed a simultaneous decision; this covers the dynamics.
//
// Usage: node src/tests/strategy/circuit.js [searchSteps] [events]

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = path.resolve(__dirname, "../../..");
const searchSteps = Number(process.argv[2] || 24);
const maxEvents = Number(process.argv[3] || 300);
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
    maxEvents
});
for (const f of [
    "config.js",
    "map-geometry.js",
    "model.js",
    "strategy/randomized-best-first-minimax.js",
    "strategy/strategy.js"
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

const DIRECTIONS = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
};
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

// Keeping either (12,16) or (13,16) occupied keeps Pac-Man inside the loop.
const GUARD_CELLS = ["12,16", "13,16"];

const scenarios = [
    { name: "p18,14 left / g13,16", pacman: { x: 18, y: 14, direction: DIRECTIONS.left }, ghost: { x: 13, y: 16, direction: DIRECTIONS.right }, ghostReady: true, playerReady: false },
    { name: "p18,14 left / g14,16", pacman: { x: 18, y: 14, direction: DIRECTIONS.left }, ghost: { x: 14, y: 16, direction: DIRECTIONS.left }, ghostReady: true, playerReady: false },
    { name: "p18,14 left / g12,16", pacman: { x: 18, y: 14, direction: DIRECTIONS.left }, ghost: { x: 12, y: 16, direction: DIRECTIONS.right }, ghostReady: true, playerReady: false },
    { name: "p16,16 right / g13,16", pacman: { x: 16, y: 16, direction: DIRECTIONS.right }, ghost: { x: 13, y: 16, direction: DIRECTIONS.right }, ghostReady: true, playerReady: false },
    { name: "p15,13 down / g13,16", pacman: { x: 15, y: 13, direction: DIRECTIONS.down }, ghost: { x: 13, y: 16, direction: DIRECTIONS.up }, ghostReady: true, playerReady: false },
    { name: "p19,15 left / g13,16", pacman: { x: 19, y: 15, direction: DIRECTIONS.left }, ghost: { x: 13, y: 16, direction: DIRECTIONS.right }, ghostReady: true, playerReady: false },
    { name: "p13,15 up / g13,16", pacman: { x: 13, y: 15, direction: DIRECTIONS.up }, ghost: { x: 13, y: 16, direction: DIRECTIONS.up }, ghostReady: true, playerReady: false },
    { name: "p18,14 left / g13,16 (both ready)", pacman: { x: 18, y: 14, direction: DIRECTIONS.left }, ghost: { x: 13, y: 16, direction: DIRECTIONS.right }, ghostReady: true, playerReady: true },
    { name: "p14,14 right / g13,16 (player ready)", pacman: { x: 14, y: 14, direction: DIRECTIONS.right }, ghost: { x: 13, y: 16, direction: DIRECTIONS.up }, ghostReady: true, playerReady: true }
];

function makeContext(scenario) {
    const ghosts = [
        model.createGhostState(scenario.ghost, "#f00", config.GHOST_SPEED),
        model.createGhostState({ x: 1, y: 1, direction: DIRECTIONS.right }, "#0f0", config.GHOST_SPEED),
        model.createGhostState({ x: 10, y: 10, direction: DIRECTIONS.left }, "#00f", config.GHOST_SPEED)
    ];

    if (scenario.ghostReady) {
        ghosts[0].needsDirection = true;
        ghosts[0].decisionAtCentre = true;
    }

    const player = model.createPlayerState(scenario.pacman, config.PACMAN_SPEED);

    if (!scenario.playerReady) {
        player.ready = false;
    }

    return {
        player,
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

// Seeded RNG so the randomized search is reproducible.
let seed = 123456789;
Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
};

function run(scenario) {
    const start = makeContext(scenario);
    const ready = scenario.ghostReady ? [0] : [];
    let state = strategy.createCurrentGameSearchState(start, ready, scenario.playerReady);
    let events = 0;
    let escaped = false;
    let caught = false;
    let covered = 0;
    let decisions = 0;
    const first = [];

    while (events++ < maxEvents && state.lives === 3 && !state.terminal) {
        if (state.firstActor === "ghosts") {
            const indices = state.readyGhosts
                .map((isReady, index) => isReady ? index : -1)
                .filter(index => index >= 0);
            const directions = strategy.chooseGhostDirections(
                state, indices, state.readyPlayer, searchSteps
            );

            if (indices.includes(0)) {
                const direction = directions.get(0);
                const next = {
                    x: state.ghosts[0].x + direction.x,
                    y: state.ghosts[0].y + direction.y
                };

                decisions++;
                if (GUARD_CELLS.includes(next.x + "," + next.y)) covered++;
                if (first.length < 3) first.push(direction.x + "," + direction.y);
            }

            state = strategy.advanceSearchState(state, directions, null);
        } else if (state.firstActor === "player") {
            const direction = strategy.choosePacmanDirection(state, [], searchSteps);
            state = strategy.advanceSearchState(state, new Map(), direction);
        } else {
            break;
        }

        if (state.lives < 3) {
            caught = true;
            break;
        }

        if (state.player.y === 16 && state.player.x <= 11) {
            escaped = true;
            break;
        }
    }

    return {
        name: scenario.name,
        escaped,
        caught,
        events,
        decisions,
        covered,
        first,
        ghost0: state.ghosts[0].x + "," + state.ghosts[0].y,
        pacman: state.player.x + "," + state.player.y
    };
}

const results = scenarios.map(run);
let escapes = 0;
let totalDecisions = 0;
let totalCovered = 0;

for (const item of results) {
    escapes += item.escaped ? 1 : 0;
    totalDecisions += item.decisions;
    totalCovered += item.covered;
    console.log(
        (item.escaped ? "ESCAPED " : item.caught ? "caught  " : "held    ") +
        item.name +
        " | events=" + item.events +
        " ghost0=" + item.ghost0 +
        " pacman=" + item.pacman +
        " | cover " + item.covered + "/" + item.decisions +
        " first=" + JSON.stringify(item.first)
    );
}

// Failure classification: the reversing state is Pac-Man reaching the exit
// ((12,16) and the main map). If it is missing from the search tree the
// failure is exploration; if it is there but the chosen action does not
// follow it, the failure is valuation.
function diagnose(item, extensions) {
    const scenario = scenarios.find(entry => entry.name === item.name);
    const start = makeContext(scenario);
    const state = strategy.createCurrentGameSearchState(
        start,
        scenario.ghostReady ? [0] : [],
        scenario.playerReady
    );
    const search = createRandomizedBestFirstMinimax({
        getNodeType: nodeState =>
            nodeState.firstActor === "player" ? "min" : "max",
        createSuccessorIterator: nodeState => {
            const profiles = strategy.getSearchActionProfiles(nodeState);
            let index = 0;
            return {
                next: () => {
                    if (index >= profiles.length) {
                        return { done: true, value: undefined };
                    }
                    const profile = profiles[index++];
                    const nextState = strategy.advanceSearchState(
                        nodeState,
                        profile.ghostDirections,
                        profile.playerDirection
                    );
                    return {
                        done: false,
                        value: {
                            state: nextState,
                            value: strategy.evaluateSearchState(nextState),
                            duration: nextState.time - nodeState.time,
                            action: {
                                ghostDirections: profile.ghostDirections,
                                playerDirection: profile.playerDirection
                            }
                        }
                    };
                }
            };
        },
        getDistribution: node => ({
            mean: node.value,
            standardDeviation: config.BASE_STD
        }),
        maxExtendDepth: config.SEARCH_MAX_EXTEND_DEPTH
    });
    const root = search.setRoot(
        state,
        strategy.evaluateSearchState(state),
        state.time
    );

    for (let step = 0; step < extensions; step++) {
        search.rootDecision(state.time);
    }

    const best = search.getBestChild(root);
    let escapeFound = false;
    let escapeDepth = Infinity;
    let chosenLineEscape = false;
    const stack = [{ node: root, depth: 0, onChosenLine: true }];

    while (stack.length > 0) {
        const pathItem = stack.pop();
        const node = pathItem.node;
        const isEscape = pathItem.depth > 0 &&
            node.state.player.y === 16 &&
            node.state.player.x <= 11;

        if (isEscape) {
            escapeFound = true;
            escapeDepth = Math.min(escapeDepth, pathItem.depth);
            if (pathItem.onChosenLine) chosenLineEscape = true;
        }

        for (const edge of node.successors) {
            stack.push({
                node: edge.child,
                depth: pathItem.depth + 1,
                onChosenLine: pathItem.depth === 0
                    ? edge === best
                    : pathItem.onChosenLine
            });
        }
    }

    return { escapeFound, escapeDepth, chosenLineEscape };
}

for (const item of results.filter(entry => entry.escaped).slice(0, 2)) {
    const diagnosis = diagnose(item, 400);

    console.log(
        "diagnose " + item.name +
        ": escapeNode=" + diagnosis.escapeFound +
        " depth=" + diagnosis.escapeDepth +
        " chosenLineEscape=" + diagnosis.chosenLineEscape +
        " -> " + (diagnosis.escapeFound
            ? "VALUATION (node exists)"
            : "EXPLORATION (node missing)")
    );
}

({
    scenarios: results.length,
    escapes,
    coverRate: Number((totalCovered / Math.max(1, totalDecisions)).toFixed(2))
});
`, ctx);

console.log("scenarios=" + result.scenarios +
    " escapes=" + result.escapes +
    " coverRate=" + result.coverRate);

if (result.escapes > 0) {
    console.error(
        "FAIL: Pac-Man escaped the classic right loop in " +
        result.escapes + "/" + result.scenarios + " realistic situations"
    );
    process.exitCode = 1;
} else {
    console.log("circuit battery ok");
}
