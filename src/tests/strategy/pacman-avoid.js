// Pac-Man charging into a ghost: at (10,4) he can go left (away) or right
// (into the ghost at (12,4)). The test reports whether the search explores
// the death and still charges (VALUATION) or never sees it (EXPLORATION).
//
// Usage: node src/tests/strategy/pacman-avoid.js [searchSteps] [extensions]

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = path.resolve(__dirname, "../../..");
const searchSteps = Number(process.argv[2] || 24);
const extensions = Number(process.argv[3] || 200);
const rd = file => fs.readFileSync(path.join(main, "src", file), "utf8")
    .replace(/\r\n/g, "\n");

const ctx = vm.createContext({
    console,
    Math,
    JSON,
    Set,
    Map,
    structuredClone,
    searchSteps,
    extensions
});
for (const file of [
    "config.js",
    "map-geometry.js",
    "model.js",
    "strategy/randomized-best-first-minimax.js",
    "strategy/strategy.js"
]) {
    vm.runInContext(rd(file), ctx, { filename: file });
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
const wrap = (value, size) => ((value % size) + size) % size;
const canMove = (x, y, direction) =>
    TILES[wrap(y + direction.y, rows)][wrap(x + direction.x, cols)] !== "#";
const geometry = createGameMapGeometry();
const model = createGameModel();
const config = createGameConfig();

const currentMap = {
    id: "classic",
    tiles: TILES.map(row => [...row]),
    edges: new Set(),
    playerStart: { x: 10, y: 4, direction: DIRECTIONS.left },
    ghostStarts: [
        { x: 12, y: 4, direction: DIRECTIONS.left },
        { x: 1, y: 1, direction: DIRECTIONS.right },
        { x: 10, y: 10, direction: DIRECTIONS.left }
    ]
};

const pellets = new Set();
for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
        if (TILES[y][x] === "." || TILES[y][x] === "o") {
            pellets.add(x + "," + y);
        }
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
    return {
        player: model.createPlayerState(
            { x: 10, y: 4, direction: DIRECTIONS.left },
            config.rules.PACMAN_SPEED
        ),
        ghosts: [
            model.createGhostState({ x: 12, y: 4, direction: DIRECTIONS.left }, "#f00", config.rules.GHOST_SPEED),
            model.createGhostState({ x: 1, y: 1, direction: DIRECTIONS.right }, "#0f0", config.rules.GHOST_SPEED),
            model.createGhostState({ x: 10, y: 10, direction: DIRECTIONS.left }, "#00f", config.rules.GHOST_SPEED)
        ],
        pellets: new Set(pellets),
        lives: 3,
        time: 0,
        respawnState: {
            player: { x: 10, y: 10 },
            ghosts: currentMap.ghostStarts.map(start => ({
                x: start.x, y: start.y,
                direction: { ...start.direction },
                speed: config.rules.GHOST_SPEED
            })),
            houses: [{ x: 11, y: 8 }]
        },
        controlledGhostIndex: -1
    };
}

function distance(from, to) {
    const seen = new Set([from.y * cols + from.x]);
    let frontier = [{ x: from.x, y: from.y }];
    let distance = 0;

    while (frontier.length > 0) {
        if (frontier.some(cell => cell.x === to.x && cell.y === to.y)) {
            return distance;
        }

        const next = [];

        for (const cell of frontier) {
            for (const direction of Object.values(DIRECTIONS)) {
                if (!canMove(cell.x, cell.y, direction)) continue;
                const x = wrap(cell.x + direction.x, cols);
                const y = wrap(cell.y + direction.y, rows);
                const key = y * cols + x;
                if (seen.has(key)) continue;
                seen.add(key);
                next.push({ x, y });
            }
        }

        frontier = next;
        distance++;
    }

    return Infinity;
}

const base = context();
const baseState = strategy.createCurrentGameSearchState(base, [], true);
const ghost = base.ghosts[0];

console.log("Pac-Man at (10,4); ghost at (12,4); distance " +
    distance(base.player, ghost));

for (const direction of strategy.getSearchPlayerActionProfiles(baseState)) {
    const next = strategy.advanceSearchState(
        strategy.createCurrentGameSearchState(base, [], true),
        new Map(),
        direction
    );
    console.log("  " + direction.x + "," + direction.y +
        " value=" + strategy.evaluateSearchState(next).toFixed(1) +
        " lives=" + next.lives +
        " pacman=" + next.player.x + "," + next.player.y);
}

let seed = 123456789;
Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
};

const chosen = strategy.choosePacmanDirection(context(), [], searchSteps);
const distanceAfter = distance({
    x: wrap(base.player.x + chosen.x, cols),
    y: wrap(base.player.y + chosen.y, rows)
}, ghost);
const charging = distanceAfter < distance(base.player, ghost);

console.log("chosen=" + JSON.stringify(chosen) +
    " charging=" + charging +
    " distanceBefore=" + distance(base.player, ghost) +
    " distanceAfter=" + distanceAfter);

function createSearch() {
    return createRandomizedBestFirstMinimax({
        getNodeType: state => state.firstActor === "player" ? "min" : "max",
        createSuccessorIterator: state => {
            const profiles = strategy.getSearchActionProfiles(state);
            let index = 0;
            return {
                next: () => {
                    if (index >= profiles.length) {
                        return { done: true, value: undefined };
                    }
                    const profile = profiles[index++];
                    const nextState = strategy.advanceSearchState(
                        state,
                        profile.ghostDirections,
                        profile.playerDirection
                    );
                    return {
                        done: false,
                        value: {
                            state: nextState,
                            value: strategy.evaluateSearchState(nextState),
                            duration: nextState.time - state.time,
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
            standardDeviation: config.strategy.BASE_STD
        }),
        maxExtendDepth: config.strategy.SEARCH_MAX_EXTEND_DEPTH
    });
}

const search = createSearch();
const root = search.setRoot(
    baseState,
    strategy.evaluateSearchState(baseState),
    baseState.time
);

for (let step = 0; step < extensions; step++) {
    search.rootDecision(baseState.time);
}

const best = search.getBestChild(root);
let deathFound = false;
let chosenLineDeath = false;
const stack = [{ node: root, depth: 0, onChosenLine: true }];

while (stack.length > 0) {
    const item = stack.pop();
    const node = item.node;

    if (item.depth > 0 && node.state.lives < 3) {
        deathFound = true;
        if (item.onChosenLine) chosenLineDeath = true;
    }

    for (const edge of node.successors) {
        stack.push({
            node: edge.child,
            depth: item.depth + 1,
            onChosenLine: item.depth === 0
                ? edge === best
                : item.onChosenLine
        });
    }
}

console.log("diagnose pacman: deathNode=" + deathFound +
    " chosenLineDeath=" + chosenLineDeath +
    " -> " + (!charging
        ? "OK (Pac-Man avoids the ghost)"
        : deathFound
            ? "VALUATION (death explored, still chosen)"
            : "EXPLORATION (death node missing)")
);

({ charging, deathFound, chosenLineDeath });
`, ctx);

if (result.charging) {
    console.error("FAIL: Pac-Man charged into the ghost");
    process.exitCode = 1;
} else {
    console.log("pacman avoid ok");
}
