// The controlled ghost must turn its eyes as soon as a direction key is
// pressed, even though the movement only changes at a cell centre.
//
// Usage: node src/tests/rules/ghost-eyes.js

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
const TILES = ["#####", "#o..#", "#...#", "#...#", "#####"].map(row => Array.from(row));
const geometry = createGameMapGeometry();
const DIRECTIONS = geometry.DIRECTIONS;
const wrap = (value, size) => ((value % size) + size) % size;
const canMove = (x, y, direction) =>
    TILES[wrap(y + direction.y, 5)][wrap(x + direction.x, 5)] !== "#";

const currentMap = {
    id: "eyes",
    tiles: TILES.map(row => [...row]),
    edges: new Set(),
    playerStart: { x: 1, y: 1, direction: DIRECTIONS.right },
    ghostStarts: [
        { x: 1, y: 3, direction: DIRECTIONS.up },
        { x: 3, y: 3, direction: DIRECTIONS.up }
    ]
};

const map = {
    DIRECTIONS,
    currentMap,
    strategicSearch: { frontier: [], root: null },
    getMapColumnCount: () => 5,
    getMapRowCount: () => 5,
    wrap,
    canMove,
    getPossibleDirections: character =>
        Object.values(DIRECTIONS).filter(direction =>
            canMove(character.x, character.y, direction)
        ),
    buildGhostHouses: () => [],
    buildMapData: () => ({
        graph: geometry.buildGraph(currentMap, Object.values(DIRECTIONS)),
        pellets: new Set(["1,1", "2,1", "3,1"])
    }),
    buildGraph: definition =>
        geometry.buildGraph(definition, Object.values(DIRECTIONS)),
    getCurrentMapDefinition: () => currentMap,
    cloneMapDefinition: definition => structuredClone(definition)
};

const state = {
    currentGameState: {},
    selectedCharacter: "ghost-0",
    pressedDirections: [],
    statusElement: { textContent: "" },
    setStatus: () => {},
    getGhostColor: index => index === 0 ? "#f00" : "#0f0"
};

const intelligence = {
    getCurrentSearchContext: () => ({}),
    anchorSearch: () => {},
    recordHumanDecision: () => {},
    createCurrentGameSearchState: () => ({ firstActor: "ghosts" }),
    chooseGhostDirections: () => new Map(),
    choosePacmanDirection: () => ({ ...DIRECTIONS.right })
};

const rules = createGameRules({
    config: createGameConfig(),
    state,
    map,
    model: createGameModel(),
    intelligence,
    ui: { updateUI: () => {}, updatePauseButton: () => {} }
});

rules.resetGame();
const gs = state.currentGameState;
const ghost = gs.ghosts[0];

function check(label, actual, expected) {
    if (!actual) {
        throw new Error("FAIL " + label + ": missing direction");
    }

    if (actual.x !== expected.x || actual.y !== expected.y) {
        throw new Error(
            "FAIL " + label + ": expected " + expected.x + "," + expected.y +
            " got " + actual.x + "," + actual.y
        );
    }
}

if (ghost.direction.x !== 0 || ghost.direction.y !== -1) {
    throw new Error("the ghost should start moving up");
}

rules.pressDirection("right");

if (ghost.facingDirection.x !== 1 || ghost.facingDirection.y !== 0) {
    throw new Error("the eyes did not turn on the key press");
}

if (ghost.direction.x !== 0 || ghost.direction.y !== -1) {
    throw new Error("the ghost must not turn before a cell centre");
}

for (let frame = 0; frame < 120 && ghost.direction.x !== 1; frame++) {
    rules.update(1 / 60);
}

if (ghost.direction.x !== 1 || ghost.direction.y !== 0) {
    throw new Error("the controlled ghost did not turn right at the centre");
}

console.log("ghost control ok");
`, ctx);
