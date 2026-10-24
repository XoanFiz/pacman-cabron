// Seeded strategy benchmark.
//
// Plays complete games with the strategy in process (no worker and no real
// time), so the same seed always gives the same result and a change can be
// compared without the plumbing noise. The AI plays Pac-Man and the
// automated ghosts; the controlled ghost is idle, so the rules bounce it.
//
// Usage:
//   node src/tests/strategy/bench.js [--games N] [--walks W] [--seed S]
//        [--max-time T] [--weights file.json] [--jobs J] [--json]
//
// --walks is the search budget per decision (the worker spends a similar
// number of walks between two decisions). --weights overrides keys of
// config.strategy, for example {"SEARCH_VALUE_DANGER": 0.2}. --jobs plays
// the games on several threads (one worker per job).

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const {
    Worker,
    parentPort,
    workerData
} = require("worker_threads");

const main = path.resolve(__dirname, "../../..");
const rd = p => fs.readFileSync(path.join(main, "src", p), "utf8")
    .replace(/\r\n/g, "\n");

// ------------------------------------------------------------
// OPTIONS
// ------------------------------------------------------------

const options = {
    games: 10,
    walks: 6,
    seed: 12345,
    maxTime: 90,
    weights: null,
    jobs: 1,
    json: false
};

for (let index = 2; index < process.argv.length; index++) {
    const argument = process.argv[index];

    if (argument === "--json") {
        options.json = true;
    } else if (argument.startsWith("--games")) {
        options.games = Number(process.argv[++index]);
    } else if (argument.startsWith("--walks")) {
        options.walks = Number(process.argv[++index]);
    } else if (argument.startsWith("--seed")) {
        options.seed = Number(process.argv[++index]);
    } else if (argument.startsWith("--max-time")) {
        options.maxTime = Number(process.argv[++index]);
    } else if (argument.startsWith("--jobs")) {
        options.jobs = Math.max(1, Number(process.argv[++index]));
    } else if (argument.startsWith("--weights")) {
        const file = path.resolve(process.argv[++index]);
        options.weights = JSON.parse(fs.readFileSync(file, "utf8"));
    } else {
        console.error("unknown option " + argument);
        process.exit(1);
    }
}

// ------------------------------------------------------------
// GAME CONTEXT
// ------------------------------------------------------------

const GAME = `
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

const ROWS = TILES.length;
const COLUMNS = TILES[0].length;
const DIRECTIONS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
};
const wrap = (value, size) => ((value % size) + size) % size;

const GHOST_STARTS = [
    { x: 9, y: 8, direction: { x: 1, y: 0 } },
    { x: 10, y: 8, direction: { x: -1, y: 0 } },
    { x: 11, y: 10, direction: { x: -1, y: 0 } }
];

function seedRandom(seed) {
    let state = seed >>> 0;

    Math.random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function createMap() {
    const canMove = (x, y, direction) =>
        TILES[wrap(y + direction.y, ROWS)][wrap(x + direction.x, COLUMNS)] !== "#";
    const pellets = new Set();

    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLUMNS; x++) {
            if (TILES[y][x] === "." || TILES[y][x] === "o") {
                pellets.add(x + "," + y);
            }
        }
    }

    const definition = {
        id: "bench-classic",
        tiles: TILES.map(row => [...row]),
        edges: [],
        playerStart: { x: 10, y: 10, direction: { x: 0, y: 0 } },
        ghostStarts: GHOST_STARTS
    };

    return {
        DIRECTIONS,
        currentMap: definition,
        graph: {},
        strategicSearch: { frontier: [], root: null },
        getMapColumnCount: () => COLUMNS,
        getMapRowCount: () => ROWS,
        wrap,
        canMove,
        getPossibleDirections: character =>
            Object.values(DIRECTIONS).filter(direction =>
                canMove(character.x, character.y, direction)),
        buildGhostHouses: () => [{ x: 11, y: 8 }],
        getCurrentMapDefinition: () => ({
            ...definition,
            tiles: definition.tiles.map(row => [...row]),
            edges: []
        }),
        cloneMapDefinition: map => ({
            ...map,
            tiles: map.tiles.map(row => [...row]),
            edges: [...(map.edges || [])]
        }),
        buildMapData: () => ({ graph: {}, pellets: new Set(pellets) }),
        buildGraph: () => ({})
    };
}

function playGame(seed, walks, maxTime, overrides) {
    seedRandom(seed);

    const base = createGameConfig();
    const config = overrides
        ? {
            ...base,
            strategy: { ...base.strategy, ...overrides }
        }
        : base;
    const geometry = createGameMapGeometry();
    const model = createGameModel();
    const map = createMap();
    const state = {
        currentGameState: {},
        selectedCharacter: "ghost-0",
        pressedDirections: [],
        statusElement: { textContent: "" },
        setStatus: () => {},
        getGhostColor: index => ["#f00", "#0f0", "#00f"][index] || "#fff"
    };
    const strategy = createGameStrategy({
        map: map.getCurrentMapDefinition(),
        geometry,
        model,
        config,
        rmfMinimax: createRandomizedBestFirstMinimax
    });

    function searchContext() {
        const gs = state.currentGameState;

        return {
            player: gs.player,
            ghosts: gs.ghosts,
            pellets: gs.pellets,
            lives: gs.lives,
            time: gs.time,
            respawnState: {
                player: { x: 10, y: 10 },
                ghosts: GHOST_STARTS.map(start => ({
                    x: start.x,
                    y: start.y,
                    direction: { ...start.direction },
                    speed: config.rules.GHOST_SPEED
                })),
                houses: [{ x: 11, y: 8 }]
            },
            controlledGhostIndex: 0
        };
    }

    const counters = { pacman: 0, ghosts: 0 };

    const intelligence = {
        getCurrentSearchContext: searchContext,
        anchorSearch: () => {},
        recordHumanDecision: () => {},
        createCurrentGameSearchState: (context, indices, readyPlayer) =>
            strategy.createCurrentGameSearchState(
                context,
                indices,
                readyPlayer
            ),
        chooseGhostDirections(context, indices, readyPlayer) {
            counters.ghosts++;

            return strategy.chooseGhostDirections(
                context,
                indices,
                readyPlayer,
                walks
            );
        },
        choosePacmanDirection(context, indices) {
            counters.pacman++;

            return strategy.choosePacmanDirection(context, indices, walks);
        }
    };

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
    gs.lives = config.rules.INITIAL_LIVES;
    gs.time = 0;
    gs.score = 0;

    const initialPellets = gs.pellets.size;
    const maxSteps = Math.ceil(maxTime * 60) + 600;
    let steps = 0;
    const startedAt = Date.now();

    while (steps++ < maxSteps) {
        if (!gs.running && gs.deathTimer <= 0) {
            if (gs.lives <= 0 || gs.gameWon) {
                break;
            }

            // The game waits for a key press after a death.
            gs.running = true;
        }

        rules.update(1 / 60);

        if (gs.gameWon) {
            break;
        }

        if (gs.lives <= 0 && gs.deathTimer <= 0) {
            break;
        }

        if (gs.time >= maxTime) {
            break;
        }
    }

    const eaten = initialPellets - gs.pellets.size;

    return {
        seed,
        won: Boolean(gs.gameWon),
        lives: gs.lives,
        deaths: config.rules.INITIAL_LIVES - gs.lives,
        eaten,
        initialPellets,
        cleared: initialPellets > 0 ? eaten / initialPellets : 1,
        time: Number(gs.time.toFixed(2)),
        score: gs.score,
        pelletsPerSecond: gs.time > 0.05
            ? Number((eaten / gs.time).toFixed(3))
            : 0,
        decisions: counters.pacman + counters.ghosts,
        wall: Date.now() - startedAt
    };
}
`;

function createGameContext() {
    const ctx = vm.createContext({ console, Date });

    for (const file of [
        "config.js",
        "map-geometry.js",
        "model.js",
        "strategy/randomized-best-first-minimax.js",
        "strategy/strategy.js",
        "rules.js"
    ]) {
        vm.runInContext(rd(file), ctx, { filename: file });
    }

    vm.runInContext(GAME, ctx, { filename: "bench-game.js" });

    return ctx;
}

function runGames(seeds, walks, maxTime, weights) {
    const ctx = createGameContext();
    const games = [];
    const startedAt = Date.now();

    for (const seed of seeds) {
        games.push(ctx.playGame(seed, walks, maxTime, weights));
    }

    return { games, wall: Date.now() - startedAt };
}

function gameSeeds(seed, games) {
    return Array.from(
        { length: games },
        (_, index) => (seed + index * 7919) >>> 0
    );
}

// ------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------

function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) /
        Math.max(1, values.length);
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function spread(values) {
    const average = mean(values);

    return Math.sqrt(mean(values.map(value =>
        (value - average) * (value - average))));
}

function summarize(games) {
    return {
        games: games.length,
        wins: games.filter(game => game.won).length,
        deaths: Number(mean(games.map(game => game.deaths)).toFixed(2)),
        deathsMedian: median(games.map(game => game.deaths)),
        cleared: Number(mean(games.map(game => game.cleared)).toFixed(3)),
        clearedMedian: Number(
            median(games.map(game => game.cleared)).toFixed(3)
        ),
        clearedSpread: Number(
            spread(games.map(game => game.cleared)).toFixed(3)
        ),
        eaten: Number(mean(games.map(game => game.eaten)).toFixed(1)),
        time: Number(mean(games.map(game => game.time)).toFixed(1)),
        pelletsPerSecond: Number(
            mean(games.map(game => game.pelletsPerSecond)).toFixed(3)
        ),
        decisions: Math.round(mean(games.map(game => game.decisions)))
    };
}

function report(result) {
    if (options.json) {
        console.log(JSON.stringify(result));

        return;
    }

    console.log("seed " + options.seed + "  games " + result.summary.games +
        "  walks " + options.walks + "  maxTime " + options.maxTime + "s" +
        (options.weights
            ? "  weights " + JSON.stringify(options.weights)
            : ""));
    console.log("");

    for (const game of result.games) {
        console.log(
            "  seed " + String(game.seed).padStart(10) +
            "  " + (game.won ? "WON " : "    ") +
            "  deaths " + game.deaths +
            "  cleared " + game.cleared.toFixed(2) +
            "  eaten " + String(game.eaten).padStart(3) +
            "  time " + String(game.time).padStart(6) +
            "s  score " + String(game.score).padStart(5)
        );
    }

    console.log("");
    console.log(JSON.stringify(result.summary, null, 2));
    console.log("");
    console.log("wall " + (result.wall / 1000).toFixed(1) + "s");
}

// ------------------------------------------------------------
// RUN
// ------------------------------------------------------------

const seeds = gameSeeds(options.seed, options.games);

if (workerData) {
    // A job of the parallel run: the main thread sends its own seeds.
    const { games, wall } = runGames(
        workerData.seeds,
        workerData.walks,
        workerData.maxTime,
        workerData.weights
    );

    parentPort.postMessage({ games, wall });
} else if (options.jobs > 1 && seeds.length > 1) {
    const jobs = Math.min(options.jobs, os.cpus().length, seeds.length);
    const chunks = Array.from({ length: jobs }, () => []);

    seeds.forEach((seed, index) => {
        chunks[index % jobs].push(seed);
    });

    const startedAt = Date.now();
    let pending = jobs;
    const collected = [];

    for (const chunk of chunks) {
        const worker = new Worker(__filename, {
            workerData: {
                seeds: chunk,
                walks: options.walks,
                maxTime: options.maxTime,
                weights: options.weights
            }
        });

        worker.on("message", message => {
            collected.push(...message.games);

            if (--pending === 0) {
                const ordered = collected.sort((a, b) => a.seed - b.seed);

                report({
                    options: {
                        games: options.games,
                        walks: options.walks,
                        seed: options.seed,
                        maxTime: options.maxTime,
                        weights: options.weights
                    },
                    summary: summarize(ordered),
                    games: ordered,
                    wall: Date.now() - startedAt
                });
            }
        });

        worker.on("error", error => {
            console.error("worker failed", error);
            process.exit(1);
        });
    }
} else {
    const { games, wall } = runGames(
        seeds,
        options.walks,
        options.maxTime,
        options.weights
    );

    report({
        options: {
            games: options.games,
            walks: options.walks,
            seed: options.seed,
            maxTime: options.maxTime,
            weights: options.weights
        },
        summary: summarize(games),
        games,
        wall
    });
}
