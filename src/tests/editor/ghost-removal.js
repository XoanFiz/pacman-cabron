// The map editor must let the developer remove ghosts and recover the
// colour they free, so the next added ghost takes it back instead of a
// new distinct hue. Ghost names must follow the colour, not the
// position, because ghosts keep their colour when another one goes.
//
// The test loads the real src/editor.js and the real getGhostName from
// src/map.js into a fake DOM and drives the editor through its own user
// gestures: the edit button, the ghost chips and canvas taps.
//
// Usage: node src/tests/editor/ghost-removal.js

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
    return {
        id: definition.id,
        nameKey: definition.nameKey,
        customNumber: definition.customNumber,
        tiles: definition.tiles.map(row => row.slice()),
        edges: new Set(definition.edges),
        playerStart: {
            x: definition.playerStart.x,
            y: definition.playerStart.y,
            direction: { ...definition.playerStart.direction }
        },
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
        playerStart: { x: 1, y: 1, direction: { ...DIRECTIONS.up } },
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
    }
};

const gs = {
    player: null,
    ghosts: []
};

const state = {
    messages: {
        addGhost: "Add ghost",
        cancelAddGhost: "Cancel adding ghosts",
        addGhostInstructions: "Add ghost instructions",
        redGhost: "Red ghost",
        orangeGhost: "Orange ghost",
        pinkGhost: "Pink ghost",
        ghostNumber: "Ghost {number}",
        mapEditorInstructions: "Editor instructions"
    },
    BASE_GHOST_COLORS: ["#e05252", "#e99b35", "#d66ad9"],
    getGhostColor(index) {
        return state.BASE_GHOST_COLORS[index] || "#abcdef";
    },
    getMostDistinctGhostColor() {
        return "#010203";
    },
    currentGameState: gs,
    canvas: new FakeElement("canvas"),
    editorGhostListElement: new FakeElement("div"),
    addGhostButton: new FakeElement("button"),
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
        gs.player = {
            x: map.currentMap.playerStart.x,
            y: map.currentMap.playerStart.y,
            px: map.currentMap.playerStart.x,
            py: map.currentMap.playerStart.y,
            progress: 0,
            direction: { ...map.currentMap.playerStart.direction },
            facingDirection: { ...map.currentMap.playerStart.direction }
        };
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
vm.runInContext("map.getGhostName = getGhostName;", context);

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

// Leaving the editor hides the list.
state.editorSaveButton.dispatch("click");
check("editor mode off", state.editorMode === false);
check("list hidden after leaving", state.editorGhostListElement.hidden === true);

console.log("editor ghost removal ok");
