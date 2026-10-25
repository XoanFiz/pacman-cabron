// The search models the map's death mode. In "restart" a catch sends every
// living Pac-Man and every ghost back to its start; in "respawn" only the
// caught Pac-Man comes back, untouchable for a moment, while the rest keeps
// playing. A respawned Pac-Man cannot be caught until the window closes,
// and its danger term is gone while it lasts.
//
// Usage: node src/tests/strategy/death-mode.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = path.resolve(__dirname, "../../..");
const rd = file => fs.readFileSync(path.join(main, "src", file), "utf8")
    .replace(/\r\n/g, "\n");

const ctx = vm.createContext({ console, Math, JSON, Set, Map });
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
const ROWS = [
    "#####",
    "#o..#",
    "#...#",
    "#...#",
    "#####"
];
const TILES = ROWS.map(row => Array.from(row));
const ROWS_COUNT = ROWS.length;
const COLUMNS = ROWS[0].length;
const geometry = createGameMapGeometry();
const DIRECTIONS = geometry.DIRECTIONS;
const config = createGameConfig();
const model = createGameModel();
const PACMAN_SPEED = config.rules.PACMAN_SPEED;
const GHOST_SPEED = config.rules.GHOST_SPEED;
const INVINCIBLE = config.rules.RESPAWN_INVINCIBILITY_SECONDS;

const currentMap = {
    id: "death-mode",
    tiles: TILES.map(row => [...row]),
    edges: new Set(),
    playerStarts: [
        { x: 1, y: 1, direction: { ...DIRECTIONS.right } },
        { x: 1, y: 3, direction: { ...DIRECTIONS.right } }
    ],
    ghostStarts: [
        { x: 2, y: 1, color: "#e05252", direction: { ...DIRECTIONS.right } }
    ]
};

const pellets = new Set();
for (let y = 0; y < ROWS_COUNT; y++) {
    for (let x = 0; x < COLUMNS; x++) {
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

const starts = [
    { x: 1, y: 1 },
    { x: 1, y: 3 }
];

// The followed Pac-Man waits at (2,3) without moving; the companion waits
// at (3,1) and the ghost walks from (2,1) into it.
function context(deathMode = "restart") {
    const player = model.createPlayerState(
        { x: 2, y: 3, direction: { x: 0, y: 0 } },
        PACMAN_SPEED
    );
    player.lives = 3;
    player.ready = false;

    const companion = model.createPlayerState(
        { x: 3, y: 1, direction: { x: 0, y: 0 } },
        PACMAN_SPEED
    );
    companion.lives = 3;
    companion.ready = false;

    const ghost = model.createGhostState(
        { x: 2, y: 1, direction: { ...DIRECTIONS.right } },
        "#e05252",
        GHOST_SPEED
    );
    ghost.needsDirection = true;

    return {
        player,
        players: [player, companion],
        ghosts: [ghost],
        pellets: new Set(pellets),
        lives: 6,
        time: 0,
        controlledPlayerIndex: 0,
        controlledGhostIndex: -1,
        deathMode,
        respawnState: {
            player: { ...starts[0] },
            players: starts.map(start => ({ ...start })),
            ghosts: [{
                x: 2,
                y: 1,
                direction: { ...DIRECTIONS.right },
                speed: GHOST_SPEED
            }],
            houses: []
        }
    };
}

function catchCompanion(deathMode) {
    const state = strategy.createCurrentGameSearchState(
        context(deathMode),
        [0],
        []
    );

    return {
        state,
        next: strategy.advanceSearchState(
            state,
            new Map([[0, { ...DIRECTIONS.right }]]),
            null
        )
    };
}

let failures = 0;
function check(label, condition, detail) {
    if (!condition) {
        failures++;
        console.error("FAIL " + label +
            (detail === undefined ? "" : " -> " + JSON.stringify(detail)));
    }
}

// ------------------------------------------------------------
// THE STATE KNOWS THE DEATH MODE
// ------------------------------------------------------------

check("the default death mode is restart",
    strategy.createCurrentGameSearchState(context(), [], []).deathMode ===
    "restart");
check("a respawn map keeps its mode",
    strategy.createCurrentGameSearchState(context("respawn"), [], [])
        .deathMode === "respawn");

// ------------------------------------------------------------
// RESTART: EVERY POSITION GOES BACK TO ITS START
// ------------------------------------------------------------

const restart = catchCompanion("restart");

check("the caught companion loses a life",
    restart.next.players[1].lives === 2, restart.next.players[1].lives);
check("restart resets every Pac-Man",
    restart.next.players[0].x === 1 &&
    restart.next.players[0].y === 1 &&
    restart.next.players[1].x === 1 &&
    restart.next.players[1].y === 3,
    restart.next.players.map(player => ({ x: player.x, y: player.y })));
check("restart resets the ghost",
    restart.next.ghosts[0].x === 2 &&
    restart.next.ghosts[0].y === 1 &&
    restart.next.ghosts[0].progress === 0,
    restart.next.ghosts[0]);
check("restart leaves no untouchable window",
    restart.next.players[1].invincibleTimer === undefined ||
    restart.next.players[1].invincibleTimer === 0,
    restart.next.players[1].invincibleTimer);

// A restart also clears a window a Pac-Man already had.
const restartWithWindow = context("restart");
restartWithWindow.players[0].invincibleUntil = 5;
const restartWindowState = strategy.createCurrentGameSearchState(
    restartWithWindow,
    [0],
    []
);

check("the live window is in the state before the catch",
    restartWindowState.players[0].invincibleTimer === 5,
    restartWindowState.players[0].invincibleTimer);

const restartWindow = strategy.advanceSearchState(
    restartWindowState,
    new Map([[0, { ...DIRECTIONS.right }]]),
    null
);

check("restart clears the untouchable window",
    !(restartWindow.players[0].invincibleTimer > 0) &&
    !(restartWindow.players[1].invincibleTimer > 0),
    restartWindow.players.map(player => player.invincibleTimer));

// ------------------------------------------------------------
// RESPAWN: ONLY THE CAUGHT ONE MOVES
// ------------------------------------------------------------

const respawn = catchCompanion("respawn");

check("the caught companion loses a life",
    respawn.next.players[1].lives === 2, respawn.next.players[1].lives);
check("the caught companion comes back at its start",
    respawn.next.players[1].x === 1 &&
    respawn.next.players[1].y === 3 &&
    respawn.next.players[1].progress === 0,
    respawn.next.players[1]);
check("the caught companion is untouchable",
    respawn.next.players[1].invincibleTimer === INVINCIBLE,
    respawn.next.players[1].invincibleTimer);
check("the caught companion has to decide again",
    respawn.next.readyPlayers[1] === true,
    respawn.next.readyPlayers);
check("the other Pac-Man keeps its place",
    respawn.next.players[0].x === 2 &&
    respawn.next.players[0].y === 3,
    { x: respawn.next.players[0].x, y: respawn.next.players[0].y });
check("the other Pac-Man is not untouchable",
    !(respawn.next.players[0].invincibleTimer > 0),
    respawn.next.players[0].invincibleTimer);
check("the ghost keeps playing",
    respawn.next.ghosts[0].x === 2 &&
    respawn.next.ghosts[0].progress > 0,
    {
        x: respawn.next.ghosts[0].x,
        progress: respawn.next.ghosts[0].progress
    });

// ------------------------------------------------------------
// AN UNTOUCHABLE PAC-MAN CANNOT BE CAUGHT
// ------------------------------------------------------------

const guardedContext = context("respawn");
guardedContext.players[1].invincibleUntil = 2;
const guardedState = strategy.createCurrentGameSearchState(
    guardedContext,
    [0],
    []
);

check("the live invincibility becomes a relative timer",
    guardedState.players[1].invincibleTimer === 2,
    guardedState.players[1].invincibleTimer);

const guarded = strategy.advanceSearchState(
    guardedState,
    new Map([[0, { ...DIRECTIONS.right }]]),
    null
);

check("the untouchable one keeps its lives",
    guarded.players[1].lives === 3, guarded.players[1].lives);
check("nobody loses a life",
    guarded.lives === 6, guarded.lives);
check("the window ticks down",
    guarded.players[1].invincibleTimer < 2 &&
    guarded.players[1].invincibleTimer > 0,
    guarded.players[1].invincibleTimer);

const expiringContext = context("respawn");
expiringContext.players[1].invincibleUntil = 0.1;
const expiringState = strategy.createCurrentGameSearchState(
    expiringContext,
    [0],
    []
);
const expired = strategy.advanceSearchState(
    expiringState,
    new Map([[0, { ...DIRECTIONS.right }]]),
    null
);

check("the untouchable window ends with an event",
    expired.players[1].invincibleTimer === 0,
    expired.players[1].invincibleTimer);
check("the expiry happens before the ghost reaches it",
    Math.abs(expired.time - 0.1) < 1e-6, expired.time);

// ------------------------------------------------------------
// THE KEY AND THE HEURISTIC SEE THE UNTOUCHABLE WINDOW
// ------------------------------------------------------------

const vulnerable = strategy.createCurrentGameSearchState(
    context("respawn"),
    [],
    []
);
const protectedState = strategy.createCurrentGameSearchState(
    (() => {
        const value = context("respawn");
        value.players[1].invincibleUntil = 2;

        return value;
    })(),
    [],
    []
);

check("the untouchable window changes the key",
    strategy.buildStateKey(vulnerable) !== strategy.buildStateKey(
        protectedState
    ));

// Same positions, same pellets: only the danger of the followed Pac-Man,
// which stands next to the ghost, changes.
const closeContext = context("restart");
closeContext.players[0].x = 1;
closeContext.players[0].y = 1;
closeContext.players[1].x = 3;
closeContext.players[1].y = 3;

const normalClose = strategy.createCurrentGameSearchState(
    closeContext,
    [],
    []
);
const protectedCloseContext = context("restart");
protectedCloseContext.players[0].x = 1;
protectedCloseContext.players[0].y = 1;
protectedCloseContext.players[0].invincibleUntil = 5;
protectedCloseContext.players[1].x = 3;
protectedCloseContext.players[1].y = 3;
const protectedClose = strategy.createCurrentGameSearchState(
    protectedCloseContext,
    [],
    []
);

check("an untouchable Pac-Man is no danger",
    strategy.evaluateSearchState(protectedClose) <
    strategy.evaluateSearchState(normalClose),
    {
        normal: strategy.evaluateSearchState(normalClose),
        protected: strategy.evaluateSearchState(protectedClose)
    });

({ failures });
`, ctx);

if (result.failures > 0) {
    process.exit(1);
}

console.log("death mode in the search ok");
