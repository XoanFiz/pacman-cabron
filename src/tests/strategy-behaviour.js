// Headless behaviour report for the ghost strategy on the classic map.
//
// Plays an automated game (both sides use the search) and reports:
// - how many ghosts can take territory from Pac-Man per decision;
// - whether the joint ghost action is as good as the best single move;
// - how often a ghost's legal actions all score the same (no gradient, so
//   its choice is effectively random);
// - how often normal ghosts move away from Pac-Man, and how often they do
//   it while already pressing his frontier;
// - samples of cornered positions (small Pac-Man domain).
//
// Usage: node src/tests/strategy-behaviour.js [seconds] [searchSteps]

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = path.resolve(__dirname, "../..");
const seconds = Number(process.argv[2] || 45);
const searchSteps = Number(process.argv[3] || 24);
const rd = p => fs.readFileSync(path.join(main, "src", p), "utf8")
    .replace(/\r\n/g, "\n");

const ctx = vm.createContext({
    console,
    Math,
    JSON,
    Set,
    Map,
    structuredClone,
    seconds,
    searchSteps
});
for (const f of [
    "config.js",
    "map-geometry.js",
    "model.js",
    "randomized-best-first-minimax.js",
    "strategy.js",
    "rules.js"
]) {
    vm.runInContext(rd(f), ctx, { filename: f });
}

vm.runInContext(`
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
        { x: 9, y: 8, direction: { x: 1, y: 0 } },
        { x: 10, y: 8, direction: { x: -1, y: 0 } },
        { x: 11, y: 10, direction: { x: -1, y: 0 } }
    ]
};

const HOUSES = [];
for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
        if (TILES[y][x] === "H") {
            HOUSES.push({ x, y });
        }
    }
}

const state = {
    currentGameState: {},
    // Any value other than "pacman" automates Pac-Man in decidePlayer.
    selectedCharacter: "ghost-99",
    pressedDirections: [],
    statusElement: { textContent: "" },
    setStatus: () => {},
    getGhostColor: i => ["#f00", "#0f0", "#00f"][i] || "#fff"
};

const strategy = createGameStrategy({
    map: currentMap,
    geometry,
    model,
    config,
    rmfMinimax: createRandomizedBestFirstMinimax
});

function context() {
    const gs = state.currentGameState;
    return {
        player: gs.player,
        ghosts: gs.ghosts,
        pellets: gs.pellets,
        lives: gs.lives,
        time: gs.time,
        respawnState: {
            player: { x: 10, y: 10 },
            ghosts: gs.ghosts.map(g => ({
                x: g.x, y: g.y, direction: { ...g.direction }, speed: config.GHOST_SPEED
            })),
            houses: HOUSES
        },
        controlledGhostIndex: -1
    };
}

function distance(from, to) {
    const seen = new Set([from.y * cols + from.x]);
    let frontier = [{ x: from.x, y: from.y }];
    let d = 0;

    while (frontier.length > 0) {
        if (frontier.some(cell => cell.x === to.x && cell.y === to.y)) {
            return d;
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
        d++;
    }

    return Infinity;
}

function countPacmanCells(domain) {
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

function domainOf(searchState) {
    return strategy.calculateDomain(
        searchState.player,
        searchState.ghosts,
        searchState.respawnState.houses,
        searchState.pellets,
        searchState.time,
        true
    );
}

function ghostPressure(domain) {
    const pressure = [0, 0, 0];

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const owner = domain[y][x].owner;

            if (!owner.startsWith("ghost")) continue;

            const index = Number(owner.slice("ghost".length));

            if (!(index in pressure)) continue;

            const touchesPacman = [
                { x: x + 1, y }, { x: x - 1, y },
                { x, y: y + 1 }, { x, y: y - 1 }
            ].some(cell =>
                TILES[wrap(cell.y, rows)][wrap(cell.x, cols)] !== "#" &&
                domain[wrap(cell.y, rows)][wrap(cell.x, cols)].owner === "pacman"
            );

            if (touchesPacman) pressure[index]++;
        }
    }

    return pressure;
}

function modeOf(ghost) {
    return ghost.eaten ? "eaten" : ghost.frightened ? "frightened" : "normal";
}

const stats = {
    pacmanDecisions: 0,
    calls: 0,
    modeDecisions: { normal: 0, frightened: 0, eaten: 0 },
    modeCloser: { normal: 0, frightened: 0, eaten: 0 },
    modeAway: { normal: 0, frightened: 0, eaten: 0 },
    baseSum: 0,
    jointSum: 0,
    reducedCalls: 0,
    jointIsBest: 0,
    effectiveHistogram: [0, 0, 0, 0],
    pressureHistogram: [0, 0, 0, 0],
    normalGhostsWithPressure: 0,
    normalMissedPressure: 0,
    normalBlind: 0,
    normalBlindAway: 0,
    spreadSum: 0,
    spreadCount: 0,
    minDomain: Infinity,
    maxDomain: 0,
    corneredSamples: []
};
let lastSampleAt = -1;

const intelligence = {
    getCurrentSearchContext: context,
    createCurrentGameSearchState: (...args) => strategy.createCurrentGameSearchState(...args),
    anchorSearch: () => {},
    recordHumanDecision: () => {},
    chooseGhostDirections: (searchContext, indices, readyPlayer) => {
        const directions = strategy.chooseGhostDirections(
            searchContext, indices, readyPlayer, searchSteps
        );

        const baseDomain = domainOf(
            strategy.createCurrentGameSearchState(searchContext, indices, false)
        );
        const base = countPacmanCells(baseDomain);
        const basePressure = ghostPressure(baseDomain);

        const joint = countPacmanCells(domainOf(strategy.advanceSearchState(
            strategy.createCurrentGameSearchState(searchContext, indices, false),
            directions,
            null
        )));

        let effective = 0;
        let bestIndividual = Infinity;

        for (const [index, direction] of directions) {
            const ghost = searchContext.ghosts[index];
            const mode = modeOf(ghost);
            const values = [];

            for (const profile of strategy.getSearchGhostActionProfiles(
                strategy.createCurrentGameSearchState(searchContext, [index], false)
            )) {
                const single = strategy.advanceSearchState(
                    strategy.createCurrentGameSearchState(searchContext, [index], false),
                    new Map(profile),
                    null
                );

                bestIndividual = Math.min(
                    bestIndividual,
                    countPacmanCells(domainOf(single))
                );
                values.push(strategy.evaluateSearchState(single));
            }

            const single = strategy.advanceSearchState(
                strategy.createCurrentGameSearchState(searchContext, indices, false),
                new Map([[index, direction]]),
                null
            );

            if (countPacmanCells(domainOf(single)) < base) {
                effective++;
            }

            const spread = values.length > 0
                ? Math.max(...values) - Math.min(...values)
                : 0;

            stats.spreadSum += spread;
            stats.spreadCount++;

            const distanceBefore = distance(ghost, searchContext.player);
            const distanceAfter = distance({
                x: wrap(ghost.x + direction.x, cols),
                y: wrap(ghost.y + direction.y, rows)
            }, searchContext.player);

            stats.modeDecisions[mode]++;

            if (distanceAfter < distanceBefore) {
                stats.modeCloser[mode]++;
            } else if (distanceAfter > distanceBefore) {
                stats.modeAway[mode]++;
            }

            if (mode === "normal") {
                if (spread < 1e-9) {
                    stats.normalBlind++;

                    if (distanceAfter > distanceBefore) {
                        stats.normalBlindAway++;
                    }
                }

                if (
                    (basePressure[index] || 0) > 0 &&
                    distanceAfter > distanceBefore
                ) {
                    stats.normalMissedPressure++;
                }
            }
        }

        stats.calls++;
        stats.baseSum += base;
        stats.jointSum += joint;

        if (joint < base) stats.reducedCalls++;
        if (joint <= bestIndividual) stats.jointIsBest++;

        stats.effectiveHistogram[Math.min(effective, 3)]++;

        return directions;
    },
    choosePacmanDirection: (searchContext, indices) => {
        stats.pacmanDecisions++;

        return strategy.choosePacmanDirection(searchContext, indices, searchSteps);
    }
};

const rules = createGameRules({
    config,
    state,
    map: {
        DIRECTIONS,
        currentMap,
        strategicSearch: { frontier: [], root: null },
        getMapColumnCount: () => cols,
        getMapRowCount: () => rows,
        wrap,
        canMove,
        getPossibleDirections: c => Object.values(DIRECTIONS).filter(d => canMove(c.x, c.y, d)),
        buildGhostHouses: () => HOUSES,
        buildMapData: () => ({
            graph: geometry.buildGraph(currentMap, Object.values(DIRECTIONS)),
            pellets: new Set(
                TILES.flatMap((row, y) => row
                    .map((tile, x) => tile === "." || tile === "o" ? x + "," + y : null)
                    .filter(Boolean))
            )
        }),
        buildGraph: definition => geometry.buildGraph(definition, Object.values(DIRECTIONS)),
        getCurrentMapDefinition: () => currentMap,
        cloneMapDefinition: d => structuredClone(d)
    },
    model,
    intelligence,
    ui: { updateUI: () => {}, updatePauseButton: () => {} }
});

rules.resetGame();
const gs = state.currentGameState;
gs.running = true;
gs.lives = 3;
gs.time = 0;

const dt = 1 / 60;
const totalFrames = Math.round(seconds / dt);

for (let frame = 0; frame < totalFrames; frame++) {
    if (!gs.running && gs.deathTimer <= 0 && gs.lives > 0) {
        gs.running = true;
    }

    rules.update(dt);

    if (gs.time - lastSampleAt < 0.25) continue;

    lastSampleAt = gs.time;

    const live = context();
    const domain = domainOf(strategy.createCurrentGameSearchState(live, [], false));
    const size = countPacmanCells(domain);
    const pressure = ghostPressure(domain);
    const pressing = pressure.filter(count => count > 0).length;

    stats.minDomain = Math.min(stats.minDomain, size);
    stats.maxDomain = Math.max(stats.maxDomain, size);
    stats.pressureHistogram[Math.min(pressing, 3)]++;

    for (let index = 0; index < gs.ghosts.length; index++) {
        if (modeOf(gs.ghosts[index]) === "normal" && pressure[index] > 0) {
            stats.normalGhostsWithPressure++;
        }
    }

    if (size <= 25 && stats.corneredSamples.length < 5) {
        stats.corneredSamples.push({
            time: Number(gs.time.toFixed(2)),
            domain: size,
            pacman: { x: gs.player.x, y: gs.player.y },
            ghosts: gs.ghosts.map((ghost, index) => ({
                x: ghost.x,
                y: ghost.y,
                mode: modeOf(ghost),
                distance: distance(ghost, gs.player),
                pressure: pressure[index]
            }))
        });
    }
}

const calls = Math.max(1, stats.calls);
const normal = Math.max(1, stats.modeDecisions.normal);

console.log(JSON.stringify({
    time: Number(gs.time.toFixed(2)),
    lives: gs.lives,
    pacmanDecisions: stats.pacmanDecisions,
    ghostCalls: stats.calls,
    normalGhostDecisions: stats.modeDecisions.normal,
    avgDomainBefore: Number((stats.baseSum / calls).toFixed(1)),
    avgDomainAfter: Number((stats.jointSum / calls).toFixed(1)),
    reducedCalls: Number((stats.reducedCalls / calls).toFixed(2)),
    jointIsBest: Number((stats.jointIsBest / calls).toFixed(2)),
    effectiveGhostsPerCall: stats.effectiveHistogram.map(
        count => Number((count / calls).toFixed(2))
    ),
    normalCloserRate: Number((stats.modeCloser.normal / normal).toFixed(2)),
    normalAwayRate: Number((stats.modeAway.normal / normal).toFixed(2)),
    normalBlindRate: Number((stats.normalBlind / normal).toFixed(2)),
    normalBlindAwayRate: Number((stats.normalBlindAway / normal).toFixed(2)),
    averageValueSpread: Number(
        (stats.spreadSum / Math.max(1, stats.spreadCount)).toFixed(1)
    ),
    normalMissedPressure: stats.normalMissedPressure,
    pressureGhosts: stats.pressureHistogram.map(
        count => Number((count / stats.pressureHistogram.reduce((a, b) => a + b, 0)).toFixed(2))
    ),
    normalGhostsWithPressure: Number(
        (stats.normalGhostsWithPressure /
            Math.max(1, stats.pressureHistogram.reduce((a, b) => a + b, 0))).toFixed(2)
    ),
    minDomain: stats.minDomain,
    maxDomain: stats.maxDomain,
    corneredSamples: stats.corneredSamples
}, null, 2));
`, ctx);
