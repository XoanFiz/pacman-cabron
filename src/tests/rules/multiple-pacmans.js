// A map can hold several Pac-Mans. Only the one the game follows is in
// the search; the others walk to the nearest pellet, eat, can be caught,
// and each one keeps its own lives. The map decides what happens on a
// death: reset the positions or respawn the one that was caught.
//
// Usage: node src/tests/rules/multiple-pacmans.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = path.resolve(__dirname, "../../..");
const rd = file => fs.readFileSync(path.join(main, "src", file), "utf8")
    .replace(/\r\n/g, "\n");

const ctx = vm.createContext({ console, Math, JSON, Set, Map, structuredClone });
for (const file of ["config.js", "map-geometry.js", "model.js", "rules.js"]) {
    vm.runInContext(rd(file), ctx, { filename: file });
}

vm.runInContext(`
const ROWS = [
    "#######",
    "#.....#",
    "#.....#",
    "#.....#",
    "#######"
];
const TILES = ROWS.map(row => Array.from(row));
const COLUMNS = ROWS[0].length;
const LINES = ROWS.length;
const geometry = createGameMapGeometry();
const DIRECTIONS = geometry.DIRECTIONS;
const wrap = (value, size) => ((value % size) + size) % size;
const canMove = (x, y, direction) =>
    TILES[wrap(y + direction.y, LINES)][wrap(x + direction.x, COLUMNS)] !== "#";

const currentMap = {
    id: "multiple-pacmans",
    tiles: TILES.map(row => [...row]),
    edges: new Set(),
    playerStarts: [
        { x: 1, y: 1, color: "#ffd43b", direction: { ...DIRECTIONS.right } },
        { x: 1, y: 3, color: "#3ad1ff", direction: { ...DIRECTIONS.right } }
    ],
    deathMode: "restart",
    ghostStarts: [
        { x: 5, y: 3, color: "#e05252", direction: { ...DIRECTIONS.up } }
    ]
};

const pellets = () => new Set(
    TILES.flatMap((row, y) => row.map((tile, x) =>
        tile === "#" ? null : x + "," + y
    ).filter(Boolean))
);

const map = {
    DIRECTIONS,
    currentMap,
    graph: null,
    strategicSearch: { frontier: [], root: null },
    getMapColumnCount: () => COLUMNS,
    getMapRowCount: () => LINES,
    wrap,
    canMove,
    getPossibleDirections: character =>
        Object.values(DIRECTIONS).filter(direction =>
            canMove(character.x, character.y, direction)
        ),
    buildGhostHouses: () => [],
    buildMapData: () => ({
        graph: geometry.buildGraph(currentMap, Object.values(DIRECTIONS)),
        pellets: pellets()
    }),
    buildGraph: definition =>
        geometry.buildGraph(definition, Object.values(DIRECTIONS)),
    getCurrentMapDefinition: () => currentMap,
    cloneMapDefinition: definition => structuredClone(definition)
};

const statuses = [];
const state = {
    currentGameState: {},
    selectedCharacter: "ghost-0",
    pressedDirections: [],
    statusElement: { textContent: "" },
    BASE_PACMAN_COLORS: ["#ffd43b"],
    setStatus: status => statuses.push(status),
    getGhostColor: () => "#e05252"
};

const intelligence = {
    getCurrentSearchContext: () => ({}),
    anchorSearch: () => {},
    recordHumanDecision: () => {},
    createCurrentGameSearchState: () => ({ firstActor: "ghosts" }),
    chooseGhostDirections: () => new Map(),
    choosePacmanDirection: () => ({ ...DIRECTIONS.right })
};

const config = createGameConfig();
const rules = createGameRules({
    config,
    state,
    map,
    model: createGameModel(),
    intelligence,
    ui: { updateUI: () => {}, updatePauseButton: () => {} }
});

function expect(label, condition, detail) {
    if (!condition) {
        throw new Error(
            "FAIL: " + label +
            (detail === undefined ? "" : " -> " + JSON.stringify(detail))
        );
    }
}

function start(deathMode = "restart") {
    currentMap.deathMode = deathMode;
    rules.resetGame();

    const gs = state.currentGameState;

    gs.running = true;

    return gs;
}

function putGhostOn(gs, player) {
    const ghost = gs.ghosts[0];

    ghost.x = player.x;
    ghost.y = player.y;
    ghost.px = player.x;
    ghost.py = player.y;
    ghost.progress = 0;
}

// ------------------------------------------------------------
// COMPANIONS MOVE AND EAT
// ------------------------------------------------------------

let gs = start("restart");
const companion = gs.players[1];
const startX = companion.x;
const pelletsBefore = gs.pellets.size;

for (let frame = 0; frame < 40; frame++) {
    rules.update(1 / 60);
}

expect("there must be two Pac-Mans", gs.players.length === 2, gs.players.length);
expect("the game follows the first Pac-Man", gs.player === gs.players[0]);
expect("the companion must move",
    companion.x !== startX || companion.progress > 0,
    { x: companion.x, progress: companion.progress });
expect("the companion must eat pellets",
    gs.pellets.size < pelletsBefore,
    { before: pelletsBefore, after: gs.pellets.size });

// ------------------------------------------------------------
// RESTART MODE: THE DEATH PAUSE RESETS EVERY POSITION
// ------------------------------------------------------------

gs = start("restart");
putGhostOn(gs, gs.players[1]);

rules.update(1 / 60);

expect("the companion must lose a life",
    gs.players[1].lives === 2, gs.players[1].lives);
expect("the game must stop for the death pause", gs.running === false);
expect("the death pause must run", gs.deathTimer > 0, gs.deathTimer);
expect("the status must report the lost life",
    statuses[statuses.length - 1] === "lifeLost",
    statuses[statuses.length - 1]);

for (let frame = 0; frame < 80; frame++) {
    rules.update(1 / 60);
}

expect("the death pause must end", gs.deathTimer <= 0, gs.deathTimer);
expect("the positions must reset",
    gs.players[1].x === 1 && gs.players[1].y === 3,
    { x: gs.players[1].x, y: gs.players[1].y });

// ------------------------------------------------------------
// RESPAWN MODE: ONLY THE CAUGHT ONE COMES BACK, UNTOUCHABLE
// ------------------------------------------------------------

gs = start("respawn");
putGhostOn(gs, gs.players[1]);

rules.update(1 / 60);

expect("a life must be lost", gs.players[1].lives === 2, gs.players[1].lives);
expect("the game must keep running", gs.running === true);
expect("the caught Pac-Man must come back at its start",
    gs.players[1].x === 1 && gs.players[1].y === 3,
    { x: gs.players[1].x, y: gs.players[1].y });
expect("the caught Pac-Man must be invincible for a while",
    gs.players[1].invincibleUntil > gs.time,
    { until: gs.players[1].invincibleUntil, time: gs.time });

putGhostOn(gs, gs.players[1]);
rules.update(1 / 60);

expect("an invincible Pac-Man cannot lose another life",
    gs.players[1].lives === 2, gs.players[1].lives);

// ------------------------------------------------------------
// THE CONTROL PASSES TO A LIVING PAC-MAN
// ------------------------------------------------------------

state.selectedCharacter = "pacman";
gs = start("respawn");
gs.players[0].lives = 1;
putGhostOn(gs, gs.players[0]);

rules.update(1 / 60);

expect("the followed Pac-Man must be out",
    gs.players[0].lives === 0, gs.players[0].lives);
expect("the control must pass to the living one",
    gs.player === gs.players[1]);
expect("the choice must follow the control",
    state.selectedCharacter === "pacman-1", state.selectedCharacter);
expect("the lives of the followed Pac-Man are shown",
    gs.lives === gs.players[1].lives, gs.lives);

// ------------------------------------------------------------
// THE GAME ENDS WHEN NOBODY IS ALIVE
// ------------------------------------------------------------

gs = start("respawn");
gs.players.forEach(player => { player.lives = 1; });
putGhostOn(gs, gs.players[1]);
rules.update(1 / 60);

expect("the companion must be out", gs.players[1].lives === 0, gs.players[1].lives);
expect("the game must go on with the followed Pac-Man", gs.running === true);

putGhostOn(gs, gs.players[0]);
rules.update(1 / 60);

expect("everybody must be out",
    gs.players.every(player => player.lives === 0));
expect("the game must be over", gs.running === false);
expect("the status must report the game over",
    statuses[statuses.length - 1] === "gameOver",
    statuses[statuses.length - 1]);

console.log("multiple Pac-Mans ok");
`, ctx);
