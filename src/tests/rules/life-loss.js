// When Pac-Man loses a life the ghosts must stay in the state they had at
// the collision: a frightened ghost is still frightened and an eaten ghost
// is still eaten during the death pause. They are only restored when the
// round restarts, after the death timer elapses.
//
// Usage: node src/tests/rules/life-loss.js

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
    "#o...o#",
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
    id: "life-loss",
    tiles: TILES.map(row => [...row]),
    edges: new Set(),
    playerStart: { x: 1, y: 1, direction: { ...DIRECTIONS.right } },
    ghostStarts: [
        // The two witnesses stay out of Pac-Man's row.
        { x: 3, y: 3, direction: { ...DIRECTIONS.left } },
        { x: 5, y: 3, direction: { ...DIRECTIONS.left } },
        // The killer walks the row Pac-Man crosses.
        { x: 5, y: 1, direction: { ...DIRECTIONS.left } }
    ]
};

const map = {
    DIRECTIONS,
    currentMap,
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
        pellets: new Set([
            "1,1", "2,1", "3,1", "4,1", "5,1",
            "1,2", "2,2", "3,2", "4,2", "5,2",
            "1,3", "2,3", "3,3", "4,3", "5,3"
        ])
    }),
    buildGraph: definition =>
        geometry.buildGraph(definition, Object.values(DIRECTIONS)),
    getCurrentMapDefinition: () => currentMap,
    cloneMapDefinition: definition => structuredClone(definition)
};

const statuses = [];
const state = {
    currentGameState: {},
    selectedCharacter: "pacman",
    pressedDirections: [],
    statusElement: { textContent: "" },
    setStatus: status => statuses.push(status),
    getGhostColor: index => ["#f00", "#0f0", "#00f"][index]
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

function expect(label, condition) {
    if (!condition) {
        throw new Error("FAIL: " + label);
    }
}

rules.resetGame();

const gs = state.currentGameState;
const [frightened, eaten] = gs.ghosts;

// Build the state the collision has to preserve: one ghost is frightened,
// one is on its way home. Only the transition is under test here, so the
// states are set directly instead of being eaten into place.
frightened.frightened = true;
frightened.frightenedTimer = 5;
frightened.speed = config.rules.FRIGHTENED_GHOST_SPEED;
eaten.eaten = true;
eaten.speed = config.rules.EATEN_GHOST_SPEED;

const livesBefore = gs.lives;

rules.pressDirection("right");

for (let frame = 0; frame < 180 && gs.deathTimer <= 0; frame++) {
    rules.update(1 / 60);
}

expect("Pac-Man was not caught", gs.deathTimer > 0);
expect("the life was not lost", gs.lives === livesBefore - 1);
expect(
    "the status did not report the lost life",
    statuses[statuses.length - 1] === "lifeLost"
);

const pausedTimer = frightened.frightenedTimer;
const paused = {
    ghostX: frightened.px,
    ghostY: frightened.py,
    playerX: gs.player.px,
    playerY: gs.player.py
};

expect(
    "the frightened ghost lost its state when the life was lost",
    frightened.frightened === true
);
expect(
    "the eaten ghost lost its state when the life was lost",
    eaten.eaten === true
);

// The death pause must not move the characters nor expire the frightened
// timer: the player sees the state it was caught in until the restart.
for (let frame = 0; frame < 30; frame++) {
    rules.update(1 / 60);
}

expect(
    "the frightened state expired during the death pause",
    frightened.frightened === true
);
expect(
    "the frightened timer ran during the death pause",
    frightened.frightenedTimer === pausedTimer
);
expect(
    "the eaten ghost was restored during the death pause",
    eaten.eaten === true
);
expect(
    "a ghost moved during the death pause",
    frightened.px === paused.ghostX && frightened.py === paused.ghostY
);
expect(
    "Pac-Man moved during the death pause",
    gs.player.px === paused.playerX && gs.player.py === paused.playerY
);
expect(
    "the round was restarted before the death pause ended",
    !statuses.includes("continue")
);

// After the death timer the round restarts and the ghosts are restored.
for (let frame = 0; frame < 120 && gs.deathTimer > 0; frame++) {
    rules.update(1 / 60);
}

expect("the death pause did not end", gs.deathTimer <= 0);
expect(
    "the frightened state survived the restart",
    frightened.frightened === false
);
expect(
    "the frightened timer survived the restart",
    frightened.frightenedTimer === undefined
);
expect("the eaten state survived the restart", eaten.eaten === false);
expect(
    "the ghosts were not moved back to their starts",
    frightened.x === 3 && frightened.y === 3
);
expect(
    "Pac-Man was not moved back to its start",
    gs.player.x === 1 && gs.player.y === 1
);
expect(
    "the death pause did not report the restart",
    statuses[statuses.length - 1] === "continue"
);

console.log("life loss ok");
`, ctx);
