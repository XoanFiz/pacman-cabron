// The map editor must let the developer add and remove the characters
// that live in the map. A removed ghost frees its colour for the next
// one, a new Pac-Man takes the hue farthest from every character
// (including the colour the next ghost would take), and the last
// Pac-Man cannot be removed. Each map also chooses what happens when a
// Pac-Man is caught.
//
// The test loads the real src/editor.js and the real getGhostName and
// getPacmanName from src/map.js into a fake DOM and drives the editor
// through its own gestures: the edit button, the add buttons, the
// character chips and canvas taps.
//
// Usage: node src/tests/editor/characters.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = path.resolve(__dirname, "../../..");
const read = file => fs
    .readFileSync(path.join(main, "src", file), "utf8")
    .replace(/\r\n/g, "\n");

function check(label, condition, detail) {
    if (!condition) {
        throw new Error(
            "FAIL " + label +
            (detail === undefined ? "" : ": " + JSON.stringify(detail))
        );
    }
}

// ------------------------------------------------------------
// FAKE DOM
// ------------------------------------------------------------

class FakeClassList {
    constructor() {
        this.values = new Set();
    }

    add(value) {
        this.values.add(value);
    }

    remove(value) {
        this.values.delete(value);
    }

    contains(value) {
        return this.values.has(value);
    }
}

class FakeElement {
    constructor(tag = "div") {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.hidden = false;
        this.dataset = {};
        this.attributes = {};
        this.listeners = {};
        this.className = "";
        this.textContent = "";
        this.title = "";
        this.type = "";
        this.classList = new FakeClassList();
    }

    append(...nodes) {
        this.children.push(...nodes);
    }

    replaceChildren(...nodes) {
        this.children = [...nodes];
    }

    addEventListener(type, handler) {
        if (!this.listeners[type]) {
            this.listeners[type] = [];
        }

        this.listeners[type].push(handler);
    }

    dispatch(type, event = {}) {
        for (const handler of this.listeners[type] || []) {
            handler(event);
        }
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    getAttribute(name) {
        return this.attributes[name];
    }

    getBoundingClientRect() {
        return { left: 0, top: 0, width: 100, height: 100 };
    }

    setPointerCapture() {}
}

const document = {
    body: new FakeElement("body"),
    elements: new Map(),
    createElement: tag => new FakeElement(tag),
    createElementNS: (namespace, tag) => new FakeElement(tag),
    getElementById(id) {
        if (!this.elements.has(id)) {
            this.elements.set(id, new FakeElement("button"));
        }

        return this.elements.get(id);
    }
};

const window = {
    clearTimeout() {},
    setTimeout(handler) {
        handler();
        return 0;
    }
};

// ------------------------------------------------------------
// REAL getGhostName FROM map.js
// ------------------------------------------------------------

function extractFunction(source, name) {
    const start = source.indexOf("function " + name + "(");

    if (start < 0) {
        throw new Error("cannot find " + name);
    }

    let depth = 0;
    let index = source.indexOf("{", start);

    for (; index < source.length; index++) {
        if (source[index] === "{") {
            depth++;
        } else if (source[index] === "}") {
            depth--;

            if (depth === 0) {
                break;
            }
        }
    }

    return source.slice(start, index + 1);
}

const getGhostNameSource = extractFunction(read("map.js"), "getGhostName");
const getPacmanNameSource = extractFunction(read("map.js"), "getPacmanName");

// ------------------------------------------------------------
// GAME STUBS
// ------------------------------------------------------------

function cloneGhostStart(start) {
    return {
        x: start.x,
        y: start.y,
        color: start.color,
        direction: start.direction ? { ...start.direction } : undefined
    };
}

function cloneMapDefinition(definition) {
    const playerStart = definition.playerStart || {
        x: 1,
        y: 1,
        direction: { x: 0, y: 0 }
    };

    return {
        id: definition.id,
        nameKey: definition.nameKey,
        customNumber: definition.customNumber,
        tiles: definition.tiles.map(row => row.slice()),
        edges: new Set(definition.edges),
        playerStarts: (definition.playerStarts || [playerStart]).map(start => ({
            x: start.x,
            y: start.y,
            color: start.color,
            direction: { ...(start.direction || { x: 0, y: 0 }) }
        })),
        deathMode: definition.deathMode,
        ghostStarts: definition.ghostStarts.map(cloneGhostStart)
    };
}

const DIRECTIONS = {
    up: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }
};

const tiles = [
    ["#", "#", "#", "#", "#"],
    ["#", ".", " ", ".", "#"],
    ["#", ".", ".", ".", "#"],
    ["#", ".", ".", ".", "#"],
    ["#", "#", "#", "#", "#"]
];

const map = {
    DIRECTIONS,
    maps: [{
        id: "classic",
        nameKey: "classicMap",
        tiles,
        edges: new Set(),
        playerStarts: [{
            x: 1,
            y: 1,
            color: "#ffd43b",
            direction: { ...DIRECTIONS.up }
        }],
        deathMode: "restart",
        ghostStarts: [
            { x: 2, y: 3, color: "#e05252", direction: { ...DIRECTIONS.left } },
            { x: 1, y: 3, color: "#e99b35", direction: { ...DIRECTIONS.left } },
            { x: 3, y: 3, color: "#d66ad9", direction: { ...DIRECTIONS.left } }
        ]
    }],
    activeMapId: "classic",
    editorDraftMap: null,
    nextCustomMapNumber: 1,
    currentMap: null,
    graph: null,
    strategicSearch: { nodes: new Map(), frontier: [], root: null },
    characterChoicesUpdated: 0,
    cloneMapDefinition,
    getCurrentMapDefinition() {
        return map.editorDraftMap ||
            map.maps.find(definition => definition.id === map.activeMapId) ||
            map.maps[0];
    },
    getMapColumnCount(definition) {
        return definition.tiles[0].length;
    },
    getMapRowCount(definition) {
        return definition.tiles.length;
    },
    buildGhostHouses() {
        return [];
    },
    buildGraph(definition) {
        const rows = definition.tiles.length;
        const columns = definition.tiles[0].length;
        const graph = definition.tiles.map((row, y) => row.map((tile, x) => {
            if (tile === "#") {
                return [];
            }

            return [
                { x, y: y - 1 },
                { x, y: y + 1 },
                { x: x - 1, y },
                { x: x + 1, y }
            ].filter(next =>
                next.y >= 0 && next.y < rows &&
                next.x >= 0 && next.x < columns &&
                definition.tiles[next.y][next.x] !== "#"
            );
        }));

        return graph;
    },
    buildPellets() {
        return new Set();
    },
    getWrappedPosition(x, y) {
        const current = map.getCurrentMapDefinition();

        return {
            x: (x + map.getMapColumnCount(current)) % map.getMapColumnCount(current),
            y: (y + map.getMapRowCount(current)) % map.getMapRowCount(current)
        };
    },
    getBoundaryKey(x, y, direction) {
        return `${x},${y},${direction.x},${direction.y}`;
    },
    updateCharacterChoices() {
        map.characterChoicesUpdated++;
    },
    saveEditorMap() {
        map.activeMapId = map.editorDraftMap.id;
    },
    createGhostIcon(color, className) {
        const icon = new FakeElement("svg");

        icon.className = className;
        icon.dataset.color = color;

        return icon;
    },
    createPacmanIcon(color, className) {
        const icon = new FakeElement("svg");

        icon.className = className;
        icon.dataset.color = color;

        return icon;
    },
    getDeathMode(definition) {
        return definition.deathMode === "respawn" ? "respawn" : "restart";
    }
};

const gs = {
    players: [],
    player: null,
    ghosts: []
};

const state = {
    messages: {
        addGhost: "Add ghost",
        cancelAddGhost: "Cancel adding ghosts",
        addGhostInstructions: "Add ghost instructions",
        addPacman: "Add Pac-Man",
        cancelAddPacman: "Cancel adding Pac-Mans",
        addPacmanInstructions: "Add Pac-Man instructions",
        pacman: "Pac-Man",
        pacmanNumber: "Pac-Man {number}",
        pacmanRequiredError: "At least one Pac-Man must remain",
        deathMode: "On death",
        deathModeRestart: "Reset positions",
        deathModeRespawn: "Respawn, invincible",
        redGhost: "Red ghost",
        orangeGhost: "Orange ghost",
        pinkGhost: "Pink ghost",
        ghostNumber: "Ghost {number}",
        mapEditorInstructions: "Editor instructions"
    },
    BASE_GHOST_COLORS: ["#e05252", "#e99b35", "#d66ad9"],
    BASE_PACMAN_COLORS: ["#ffd43b"],
    getGhostColor(index) {
        return state.BASE_GHOST_COLORS[index] || "#abcdef";
    },
    getMostDistinctGhostColor(existingColors) {
        const palette = ["#e99b35", "#010203", "#ffd43b"];
        const used = existingColors.map(color => String(color).toLowerCase());

        return palette.find(color => !used.includes(color)) || "#abcdef";
    },
    currentGameState: gs,
    canvas: new FakeElement("canvas"),
    editorGhostListElement: new FakeElement("div"),
    editorPacmanListElement: new FakeElement("div"),
    addGhostButton: new FakeElement("button"),
    addPacmanButton: new FakeElement("button"),
    deathModeButton: new FakeElement("button"),
    newMapButton: new FakeElement("button"),
    editorBackButton: new FakeElement("button"),
    editorSaveButton: new FakeElement("button"),
    mapSelectElement: new FakeElement("select"),
    startScreenElement: new FakeElement("div"),
    editorToolbarElement: new FakeElement("div"),
    editorToastElement: new FakeElement("div"),
    editorMode: false,
    editorGesture: null,
    addingGhost: false,
    addingPacman: false,
    selectedCharacter: "pacman",
    showEditorToast(key) {
        state.lastToast = key;
    },
    setMapEditorInstructions() {
        state.instructionsUpdates = (state.instructionsUpdates || 0) + 1;
    }
};

const rules = {
    resetGame() {
        map.currentMap = map.cloneMapDefinition(map.getCurrentMapDefinition());
        map.graph = map.buildGraph(map.currentMap);
        map.strategicSearch.frontier = [];
        map.strategicSearch.root = null;
        gs.players = map.currentMap.playerStarts.map(start => ({
            x: start.x,
            y: start.y,
            px: start.x,
            py: start.y,
            progress: 0,
            direction: { ...start.direction },
            facingDirection: { ...start.direction },
            nextDirection: { x: 0, y: 0 },
            lives: 3,
            color: start.color
        }));
        gs.player = gs.players[0];
        gs.ghosts = map.currentMap.ghostStarts.map((start, index) => ({
            x: start.x,
            y: start.y,
            px: start.x,
            py: start.y,
            progress: 0,
            frightened: false,
            eaten: false,
            color: start.color || state.getGhostColor(index),
            direction: { ...(start.direction || DIRECTIONS.left) },
            nextDirection: { ...(start.direction || DIRECTIONS.left) }
        }));
    }
};

// ------------------------------------------------------------
// LOAD THE REAL EDITOR
// ------------------------------------------------------------

const context = vm.createContext({
    console,
    document,
    window,
    map,
    state,
    rules,
    __map: map,
    __state: state,
    __rules: rules
});

vm.runInContext(read("editor.js"), context, { filename: "editor.js" });
vm.runInContext(getGhostNameSource, context, { filename: "map.js#getGhostName" });
vm.runInContext(getPacmanNameSource, context, { filename: "map.js#getPacmanName" });
vm.runInContext(
    "map.getGhostName = getGhostName; map.getPacmanName = getPacmanName;",
    context
);

const editor = vm.runInContext(
    "createGameEditor({ state: __state, map: __map, rules: __rules })",
    context,
    { filename: "editor.js#create" }
);

function chipNames() {
    return state.editorGhostListElement.children.map(
        chip => chip.children[1].textContent
    );
}

function addButtonColor() {
    return state.addGhostButton.children[0].dataset.color;
}

function tapCanvas(x, y) {
    const event = {
        clientX: (x + 0.5) * 20,
        clientY: (y + 0.5) * 20,
        pointerId: 1,
        preventDefault() {}
    };

    state.canvas.dispatch("pointerdown", event);
    state.canvas.dispatch("pointerup", event);
}

function addGhostAt(x, y) {
    if (!state.addingGhost) {
        state.addGhostButton.dispatch("click");
    }

    tapCanvas(x, y);
}

function pacmanChips() {
    return state.editorPacmanListElement.children;
}

function pacmanNames() {
    return pacmanChips().map(chip => chip.children[1].textContent);
}

function addPacmanButtonColor() {
    return state.addPacmanButton.children[0].dataset.color;
}

function addPacmanAt(x, y) {
    if (!state.addingPacman) {
        state.addPacmanButton.dispatch("click");
    }

    tapCanvas(x, y);
}

// ------------------------------------------------------------
// SCENARIO
// ------------------------------------------------------------

// Colors and names before any edit.
check("editor starts closed", editor !== null);
document.getElementById("edit-map").dispatch("click");
check("editor mode on", state.editorMode === true);
check("three ghosts from the map", gs.ghosts.length === 3, gs.ghosts.length);
check("three removal chips", state.editorGhostListElement.children.length === 3);
check("chip names", JSON.stringify(chipNames()) === JSON.stringify([
    "Red ghost",
    "Orange ghost",
    "Pink ghost"
]), chipNames());
check("chips visible", state.editorGhostListElement.hidden === false);
check("add button previews a distinct color", addButtonColor() === "#010203", addButtonColor());

// Remove the orange ghost: red and pink survive with their own names.
state.editorGhostListElement.children[1].dispatch("click");
check("orange ghost removed", gs.ghosts.length === 2, gs.ghosts.length);
check("ghost colors kept", JSON.stringify(gs.ghosts.map(ghost => ghost.color)) ===
    JSON.stringify(["#e05252", "#d66ad9"]), gs.ghosts.map(ghost => ghost.color));
check("draft ghost starts sync", map.editorDraftMap.ghostStarts.length === 2,
    map.editorDraftMap.ghostStarts.length);
check("names follow colors", JSON.stringify(chipNames()) === JSON.stringify([
    "Red ghost",
    "Pink ghost"
]), chipNames());
check("freed color is recovered", addButtonColor() === "#e99b35", addButtonColor());

// Adding a ghost takes the freed orange back.
addGhostAt(2, 1);
check("ghost added", gs.ghosts.length === 3, gs.ghosts.length);
check("added ghost reuses the freed color",
    gs.ghosts[2].color === "#e99b35", gs.ghosts[2].color);
check("added ghost position", gs.ghosts[2].x === 2 && gs.ghosts[2].y === 1,
    { x: gs.ghosts[2].x, y: gs.ghosts[2].y });
check("chip names restored", JSON.stringify(chipNames()) === JSON.stringify([
    "Red ghost",
    "Pink ghost",
    "Orange ghost"
]), chipNames());

// Selected character index follows the remaining ghost.
state.selectedCharacter = "ghost-2";
state.editorGhostListElement.children[0].dispatch("click");
check("selection shifts down", state.selectedCharacter === "ghost-1", state.selectedCharacter);
state.editorGhostListElement.children[0].dispatch("click");
check("selection follows the remaining ghosts", state.selectedCharacter === "ghost-0", state.selectedCharacter);
check("removed selection becomes pacman", state.selectedCharacter === "ghost-0", state.selectedCharacter);
state.editorGhostListElement.children[0].dispatch("click");
check("all ghosts removable", gs.ghosts.length === 0, gs.ghosts.length);
check("selection falls back to pacman", state.selectedCharacter === "pacman", state.selectedCharacter);
check("empty list hidden", state.editorGhostListElement.hidden === true);
check("empty list cleared", state.editorGhostListElement.children.length === 0);
check("add button back to base color", addButtonColor() === "#e05252", addButtonColor());

// A ghostless map can be edited again from scratch.
addGhostAt(3, 1);
check("ghost added to an empty map", gs.ghosts.length === 1, gs.ghosts.length);
check("first ghost is red", gs.ghosts[0].color === "#e05252", gs.ghosts[0].color);
check("list visible again", state.editorGhostListElement.hidden === false);

// Pac-Mans: one chip, its own colour and name, and a colour that avoids
// both the other characters and the colour the next ghost would take.
check("one Pac-Man from the map", gs.players.length === 1, gs.players.length);
check("Pac-Man chip", pacmanChips().length === 1, pacmanChips().length);
check("Pac-Man name",
    JSON.stringify(pacmanNames()) === JSON.stringify(["Pac-Man"]),
    pacmanNames());
check("Pac-Man keeps its colour", gs.players[0].color === "#ffd43b",
    gs.players[0].color);

addPacmanAt(2, 2);
check("Pac-Man added", gs.players.length === 2, gs.players.length);
check("Pac-Man position",
    gs.players[1].x === 2 && gs.players[1].y === 2,
    { x: gs.players[1].x, y: gs.players[1].y });
check("Pac-Man gets a different colour",
    gs.players[1].color !== "#ffd43b", gs.players[1].color);
check("Pac-Man avoids the next ghost colour",
    gs.players[1].color !== addButtonColor(),
    { pacman: gs.players[1].color, ghost: addButtonColor() });
check("second Pac-Man name",
    JSON.stringify(pacmanNames()) ===
    JSON.stringify(["Pac-Man", "Pac-Man 2"]),
    pacmanNames());
check("draft keeps every Pac-Man start",
    map.editorDraftMap.playerStarts.length === 2,
    map.editorDraftMap.playerStarts.length);
check("draft keeps the colours",
    JSON.stringify(map.editorDraftMap.playerStarts.map(start => start.color)) ===
    JSON.stringify(gs.players.map(player => player.color)),
    map.editorDraftMap.playerStarts.map(start => start.color));

// The last Pac-Man cannot be removed.
pacmanChips()[1].dispatch("click");
check("Pac-Man removed", gs.players.length === 1, gs.players.length);
pacmanChips()[0].dispatch("click");
check("the last Pac-Man stays", gs.players.length === 1, gs.players.length);
check("the last Pac-Man complains",
    state.lastToast === "pacmanRequiredError", state.lastToast);

// Death mode is a choice of the map.
check("death mode starts as restart",
    map.editorDraftMap.deathMode === "restart", map.editorDraftMap.deathMode);
check("death mode button text",
    state.deathModeButton.textContent === "On death: Reset positions",
    state.deathModeButton.textContent);
state.deathModeButton.dispatch("click");
check("death mode becomes respawn",
    map.editorDraftMap.deathMode === "respawn", map.editorDraftMap.deathMode);
check("death mode button pressed",
    state.deathModeButton.getAttribute("aria-pressed") === "true");
state.deathModeButton.dispatch("click");
check("death mode back to restart",
    map.editorDraftMap.deathMode === "restart", map.editorDraftMap.deathMode);

// Leaving the editor hides the chips.
state.editorSaveButton.dispatch("click");
check("editor mode off", state.editorMode === false);
check("list hidden after leaving", state.editorGhostListElement.hidden === true);
check("Pac-Man list hidden after leaving",
    state.editorPacmanListElement.hidden === true);

console.log("editor character chips ok");
