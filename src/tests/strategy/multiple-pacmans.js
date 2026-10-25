// Every Pac-Man takes part in the search: the state carries the whole
// list, each ready one decides in its own node, the key tells companions
// apart, the heuristic and the domain join their territory, and a
// companion can be caught like the followed Pac-Man.
//
// Usage: node src/tests/strategy/multiple-pacmans.js

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

const currentMap = {
    id: "multiple-pacmans",
    tiles: TILES.map(row => [...row]),
    edges: new Set(),
    playerStarts: [
        { x: 1, y: 1, direction: { ...DIRECTIONS.right } },
        { x: 3, y: 1, direction: { ...DIRECTIONS.right } }
    ],
    deathMode: "restart",
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

// Two Pac-Mans in the same maze: the followed one at (1,1), a companion
// at (3,3), and a ghost at (2,1) waiting for a direction.
function context(overrides = {}) {
    const player = model.createPlayerState(
        { x: 1, y: 1, direction: { ...DIRECTIONS.right } },
        PACMAN_SPEED
    );
    player.lives = 3;

    const companion = model.createPlayerState(
        { x: 3, y: 3, direction: { x: 0, y: 0 } },
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
        },
        ...overrides
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
// THE STATE CARRIES EVERY PAC-MAN
// ------------------------------------------------------------

const state = strategy.createCurrentGameSearchState(context(), [], [0, 1]);

check("two Pac-Mans in the state", state.players.length === 2,
    state.players.length);
check("the followed one is the alias", state.player === state.players[0]);
check("both decide", state.readyPlayers[0] && state.readyPlayers[1],
    state.readyPlayers);
check("the first one acts first",
    state.firstActor === "player" && state.decidingPlayerIndex === 0,
    { firstActor: state.firstActor, index: state.decidingPlayerIndex });

// ------------------------------------------------------------
// ONE DECISION PER ACTOR
// ------------------------------------------------------------

const afterFirst = strategy.advanceSearchState(
    state,
    new Map(),
    { ...DIRECTIONS.right }
);

check("the first Pac-Man consumed its decision",
    afterFirst.readyPlayers[0] === false, afterFirst.readyPlayers);
check("the companion is still waiting for one",
    afterFirst.readyPlayers[1] === true, afterFirst.readyPlayers);
check("the companion is the next actor",
    afterFirst.firstActor === "player" &&
    afterFirst.decidingPlayerIndex === 1,
    {
        firstActor: afterFirst.firstActor,
        index: afterFirst.decidingPlayerIndex
    });

const afterSecond = strategy.advanceSearchState(
    afterFirst,
    new Map(),
    { ...DIRECTIONS.left }
);

check("the companion moved its direction",
    afterSecond.players[1].direction.x === -1 &&
    afterSecond.players[1].direction.y === 0,
    afterSecond.players[1].direction);
check("the followed Pac-Man decides again when it arrives",
    afterSecond.readyPlayers[0] === true &&
    afterSecond.firstActor === "player" &&
    afterSecond.decidingPlayerIndex === 0,
    {
        ready: afterSecond.readyPlayers,
        firstActor: afterSecond.firstActor,
        index: afterSecond.decidingPlayerIndex
    });

// ------------------------------------------------------------
// THE KEY TELLS THE COMPANIONS APART
// ------------------------------------------------------------

const movedContext = context();
movedContext.players[1].x = 3;
movedContext.players[1].y = 2;
movedContext.player = movedContext.players[0];

const baseKey = strategy.buildStateKey(
    strategy.createCurrentGameSearchState(context(), [], [0, 1])
);
const movedKey = strategy.buildStateKey(
    strategy.createCurrentGameSearchState(movedContext, [], [0, 1])
);

check("a moved companion changes the key", baseKey !== movedKey,
    { baseKey, movedKey });

// ------------------------------------------------------------
// THE JOINT HEURISTIC AND THE JOINT DOMAIN
// ------------------------------------------------------------

const jointDomain = strategy.calculateDomain(
    state.players,
    state.ghosts,
    state.respawnState.houses,
    state.pellets,
    state.time,
    true
);

check("the companion owns the cell below it",
    jointDomain[2][3].owner === "pacman",
    jointDomain[2][3]);

const aloneContext = context();
const aloneState = strategy.createCurrentGameSearchState(
    {
        ...aloneContext,
        players: [aloneContext.players[0]],
        lives: 3
    },
    [],
    [0]
);
const aloneDomain = strategy.calculateDomain(
    aloneState.players,
    aloneState.ghosts,
    aloneState.respawnState.houses,
    aloneState.pellets,
    aloneState.time,
    true
);

check("without the companion that cell is not Pac-Man's",
    aloneDomain[2][3].owner !== "pacman",
    aloneDomain[2][3]);

// The value must see the companion: same ghost and same last pellet, but
// one companion starts on the pellet and the other far from it.
const valuable = context();
valuable.pellets = new Set(["3,3"]);
const valuableState = strategy.createCurrentGameSearchState(
    valuable,
    [],
    [0, 1]
);
const valuableValue = strategy.evaluateSearchState(valuableState);

const worthless = context();
worthless.players[1].x = 1;
worthless.players[1].y = 3;
worthless.pellets = new Set(["3,3"]);
const worthlessState = strategy.createCurrentGameSearchState(
    worthless,
    [],
    [0, 1]
);
const worthlessValue = strategy.evaluateSearchState(worthlessState);

check("a companion near the last pellet is worth more",
    valuableValue < worthlessValue,
    { valuable: valuableValue, worthless: worthlessValue });

// ------------------------------------------------------------
// THE LIVE ENTRY POINT ASKS FOR THE COMPANION'S DIRECTION
// ------------------------------------------------------------

const companionOnly = context();
const companionOnlyState = strategy.createCurrentGameSearchState(
    companionOnly,
    [],
    [1]
);
const companionProfiles = strategy.getSearchActionProfiles(
    companionOnlyState
);

check("the companion's profiles carry its index",
    companionProfiles.length > 0 &&
    companionProfiles.every(profile => profile.playerIndex === 1),
    companionProfiles.map(profile => profile.playerIndex));

const companionDirection = strategy.choosePacmanDirection(
    companionOnly,
    [],
    [1],
    6
);
const companionNext = {
    x: geometry.wrap(3 + companionDirection.x, COLUMNS),
    y: geometry.wrap(3 + companionDirection.y, ROWS_COUNT)
};

check("the companion gets a legal direction from the search",
    TILES[companionNext.y][companionNext.x] !== "#",
    { direction: companionDirection, next: companionNext });

// ------------------------------------------------------------
// THE PLAN HAS A NODE FOR THE COMPANION
// ------------------------------------------------------------

const job = strategy.createPolicyBufferJob(context(), {
    readyGhostIndices: [],
    readyPlayerIndices: [0, 1],
    horizonSeconds: 2,
    transmittedHorizonSeconds: 1
});

for (let step = 0; step < 20; step++) {
    strategy.stepPolicyBufferJob(job, 1);
}

const plan = strategy.getTransmittedPlan(job).filter(Boolean);
const humanNode = plan.find(node =>
    node.actor === "player" &&
    node.playerIndex === 0 &&
    Array.isArray(node.choices) &&
    node.choices.length > 0
);
const companionNode = plan.find(node =>
    node.actor === "player" &&
    node.playerIndex === 1 &&
    node.action &&
    node.action.playerDirection
);

check("the plan carries the followed Pac-Man with its choices",
    Boolean(humanNode), plan.length);
check("the plan carries the companion's own action",
    Boolean(companionNode), plan.length);

// ------------------------------------------------------------
// A COMPANION CAN BE CAUGHT
// ------------------------------------------------------------

let caughtContext = context();
caughtContext.players[0].ready = false;
caughtContext.players[1].x = 3;
caughtContext.players[1].y = 1;
const caughtState = strategy.createCurrentGameSearchState(
    caughtContext,
    [0],
    []
);

check("the ghost decides first",
    caughtState.firstActor === "ghosts",
    caughtState.firstActor);

const caught = strategy.advanceSearchState(
    caughtState,
    new Map([[0, { ...DIRECTIONS.right }]]),
    null
);

check("the companion loses a life",
    caught.players[1].lives === 2, caught.players[1].lives);
check("the followed Pac-Man keeps its lives",
    caught.players[0].lives === 3, caught.players[0].lives);
check("the pool goes down", caught.lives === 5, caught.lives);
check("the companion respawns at its own start",
    caught.players[1].x === 1 && caught.players[1].y === 3,
    { x: caught.players[1].x, y: caught.players[1].y });

// ------------------------------------------------------------
// THE GAME IS OVER WHEN THE LAST PAC-MAN RUNS OUT
// ------------------------------------------------------------

const lastContext = context();
lastContext.players[0].lives = 1;
lastContext.players[0].ready = false;
lastContext.players[1].lives = 0;
lastContext.lives = 1;
// The ghost walks into the only living Pac-Man.
lastContext.ghosts[0].direction = { ...DIRECTIONS.left };
lastContext.ghosts[0].needsDirection = true;
lastContext.respawnState.ghosts[0].direction = { ...DIRECTIONS.left };

const lastState = strategy.createCurrentGameSearchState(
    lastContext,
    [0],
    []
);
const last = strategy.advanceSearchState(
    lastState,
    new Map([[0, { ...DIRECTIONS.left }]]),
    null
);

check("a Pac-Man without lives does not decide",
    lastState.readyPlayers[1] === false, lastState.readyPlayers);
check("the last life ends the game",
    last.terminal === true && last.lives === 0,
    { terminal: last.terminal, lives: last.lives });

({ failures });
`, ctx);

if (result.failures > 0) {
    process.exit(1);
}

console.log("multiple Pac-Mans in the search ok");
