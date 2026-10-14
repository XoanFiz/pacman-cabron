
// ============================================================
// MAP DEFINITIONS
// ============================================================

function toTiles(rows) {
    return rows.map(row => Array.from(row));
}


function cloneMapPosition(position) {
    return {
        x: position.x,
        y: position.y,
        ...(position.color !== undefined && {
            color: position.color
        }),
        ...(position.direction && {
            direction: { ...position.direction }
        })
    };
}


function cloneMapDefinition(definition) {
    return {
        ...definition,
        tiles: definition.tiles.map(row => [...row]),
        edges: new Set(definition.edges),
        ghostHouses: definition.ghostHouses.map(cloneMapPosition),
        playerStart: cloneMapPosition(definition.playerStart),
        ghostStarts: definition.ghostStarts.map(cloneMapPosition)
    };
}


// ============================================================
// PREDEFINED MAPS
// ============================================================

const PREDEFINED_MAPS = [

    // --------------------------------------------------------
    // CLASSIC
    // --------------------------------------------------------

    {
        id: "classic",
        nameKey: "classicMap",

        tiles: toTiles([
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
        ]),

        edges: new Set(),

        ghostHouses: [
            { x: 10, y: 8 }
        ],

        playerStart: {
            x: 10,
            y: 10,
            direction: { x: 0, y: 0 }
        },

        ghostStarts: [
            { x: 9, y: 8, direction: { x: 1, y: 0 } },
            { x: 10, y: 8, direction: { x: -1, y: 0 } },
            { x: 11, y: 10, direction: { x: -1, y: 0 } }
        ]
    },


    // --------------------------------------------------------
    // BOUNDARY-ONLY
    // --------------------------------------------------------

    {
        id: "boundary-only",
        nameKey: "boundaryMap",

        tiles: toTiles([
            "....................",
            "....................",
            "....................",
            "....................",
            "....................",
            "....................",
            "....................",
            "....................",
            "......... H.........",
            "....................",
            "..........  ........",
            "....................",
            "....................",
            "....................",
            "....................",
            "....................",
            "....................",
            "...................."
        ]),

        edges: new Set([

            // Vertical boundaries.

            "v:1:1", "v:2:1", "v:3:1", "v:4:1",
            "v:5:1", "v:6:1", "v:7:1",
            "v:10:1", "v:11:1", "v:12:1", "v:13:1",
            "v:14:1", "v:15:1", "v:16:1", "v:17:1",
            "v:18:1", "v:19:1",

            "v:1:3", "v:2:3", "v:3:3",
            "v:6:3", "v:7:3", "v:8:3", "v:9:3",
            "v:10:3", "v:11:3", "v:12:3", "v:13:3",
            "v:14:3", "v:15:3", "v:16:3", "v:17:3",
            "v:18:3", "v:19:3",

            "v:0:5", "v:1:5", "v:2:5", "v:3:5",
            "v:5:5", "v:6:5", "v:7:5", "v:8:5",
            "v:9:5", "v:10:5", "v:11:5", "v:12:5",
            "v:13:5", "v:14:5", "v:15:5", "v:16:5",
            "v:17:5",

            "v:0:7", "v:1:7", "v:2:7", "v:3:7",
            "v:5:7", "v:6:7", "v:7:7", "v:8:7",
            "v:9:7", "v:10:7", "v:11:7", "v:12:7",
            "v:13:7", "v:16:7", "v:17:7", "v:18:7",

            "v:0:9", "v:1:9", "v:2:9", "v:3:9",
            "v:4:9", "v:5:9", "v:6:9", "v:7:9",
            "v:8:9", "v:9:9", "v:12:9", "v:13:9",
            "v:14:9", "v:15:9", "v:16:9", "v:17:9",
            "v:18:9",

            "v:0:11", "v:1:11", "v:2:11", "v:3:11",
            "v:4:11", "v:5:11", "v:8:11", "v:9:11",
            "v:10:11", "v:11:11", "v:12:11", "v:13:11",
            "v:14:11", "v:15:11", "v:16:11", "v:17:11",
            "v:18:11", "v:19:11",

            "v:0:13", "v:1:13", "v:5:13", "v:6:13",
            "v:7:13", "v:8:13", "v:9:13", "v:10:13",
            "v:11:13", "v:12:13", "v:13:13", "v:14:13",
            "v:15:13", "v:16:13", "v:17:13", "v:18:13",
            "v:19:13",

            "v:0:15", "v:1:15", "v:2:15", "v:3:15",
            "v:5:15", "v:6:15", "v:7:15", "v:8:15",
            "v:9:15", "v:10:15", "v:11:15", "v:12:15",
            "v:13:15", "v:14:15", "v:15:15",
            "v:18:15", "v:19:15",

            // Horizontal boundaries.

            "h:3:0", "h:3:1", "h:3:3", "h:3:4",
            "h:3:5", "h:3:6", "h:3:7", "h:3:8",
            "h:3:9", "h:3:10", "h:3:11", "h:3:12",
            "h:3:13", "h:3:14", "h:3:15",

            "h:7:0", "h:7:1", "h:7:2", "h:7:3",
            "h:7:7", "h:7:8", "h:7:9", "h:7:10",
            "h:7:11", "h:7:12", "h:7:14", "h:7:16",

            "h:11:0", "h:11:1", "h:11:2", "h:11:3",
            "h:11:4", "h:11:5", "h:11:6", "h:11:7",
            "h:11:10", "h:11:11", "h:11:12", "h:11:13",
            "h:11:14", "h:11:15", "h:11:16", "h:11:17",

            "h:15:1", "h:15:3", "h:15:5", "h:15:7",
            "h:15:8", "h:15:9", "h:15:11", "h:15:14",
            "h:15:16", "h:15:17"
        ]),

        ghostHouses: [
            { x: 10, y: 8 }
        ],

        playerStart: {
            x: 10,
            y: 10,
            direction: { x: 0, y: 0 }
        },

        ghostStarts: [
            { x: 9, y: 8, direction: { x: 1, y: 0 } },
            { x: 10, y: 8, direction: { x: -1, y: 0 } },
            { x: 11, y: 10, direction: { x: -1, y: 0 } }
        ]
    }
];


// ============================================================
// MAP STATE
// ============================================================

let maps = PREDEFINED_MAPS.map(cloneMapDefinition);

let activeMapId = "classic";
let editorDraftMap = null;
let nextCustomMapNumber = 1;

let map = maps.find(definition => definition.id === activeMapId);

canvas.width = getMapColumnCount(map) * CELL;
canvas.height = getMapRowCount(map) * CELL;


// ============================================================
// GHOST AI
// ============================================================

const PACMAN_SPEED = 3.5;
const GHOST_SPEED = 2.25;
const FRIGHTENED_GHOST_SPEED = 1.5;
const EATEN_GHOST_SPEED = 4;

const WEIGHT_NORMAL = 1;
const WEIGHT_PELLET = 0.01;
const WEIGHT_BLUE = 0;
const MAX_PELLET_SCORE_FRACTION = 0.25;

const TOTAL_PELLET_VALUE = 1000;
const TOTAL_NORMAL_VALUE = 1000;

const INITIAL_LIVES = 3;

const SEARCH_LIFE_PRIORITY =
    TOTAL_NORMAL_VALUE +
    2 * TOTAL_PELLET_VALUE +
    1;

const EPSILON = 1e-9;
const SEARCH_EPSILON = 1e-7;
const SEARCH_EXPANSIONS_PER_FRAME = 8;


// Static graph of the active map.
let graph = null;

const strategicSearch = {
    nodes: new Map(),
    frontier: [],
    root: null
};


// ============================================================
// DIRECTIONS
// ============================================================

const DIRECTIONS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
};


// ============================================================
// MAP UTILITIES
// ============================================================

function getCurrentMapDefinition() {
    return editorDraftMap ||
        maps.find(definition => definition.id === activeMapId) ||
        maps[0];
}


function getMapLabel(definition) {
    return definition.nameKey
        ? messages[definition.nameKey]
        : `${messages.customMap} ${definition.customNumber}`;
}


function getMapRowCount(definition = map) {
    return definition.tiles.length;
}


function getMapColumnCount(definition = map) {
    return definition.tiles[0]?.length ?? 0;
}


function wrap(value, size) {
    return ((value % size) + size) % size;
}


function getWrappedPosition(x, y, definition = map) {
    return {
        x: wrap(x, getMapColumnCount(definition)),
        y: wrap(y, getMapRowCount(definition))
    };
}


// Boundary keys are bidirectional and also wrap around the edges of the map. For example, a boundary between (0, 0) and (1, 0) is 
// represented as "h:0:0", while a boundary between (19, 0) and (0, 0) is represented as "h:19:0". Similarly, a boundary between (0, 0) 
// and (0, 1) is represented as "v:0:0", while a boundary between (0, 17) and (0, 0) is represented as "v:0:17".
function getBoundaryKey(x, y, direction, definition = map) {
    const position = getWrappedPosition(x, y, definition);

    if (direction.x === 1) {
        return `h:${position.x}:${position.y}`;
    }

    if (direction.x === -1) {
        return `h:${wrap(position.x - 1, getMapColumnCount(definition))}:${position.y}`;
    }

    if (direction.y === 1) {
        return `v:${position.x}:${position.y}`;
    }

    return `v:${position.x}:${wrap(position.y - 1, getMapRowCount(definition))}`;
}


function isWall(x, y, definition = map) {
    if (
        x < 0 ||
        x >= getMapColumnCount(definition) ||
        y < 0 ||
        y >= getMapRowCount(definition)
    ) {
        return true;
    }

    return definition.tiles[y][x] === "#";
}


function isBoundaryBlocked(x, y, direction, definition = map) {
    return definition.edges.has(
        getBoundaryKey(x, y, direction, definition)
    );
}


function canMove(x, y, direction, definition = map) {
    const next = getWrappedPosition(
        x + direction.x,
        y + direction.y,
        definition
    );

    return !isWall(next.x, next.y, definition) &&
        !isBoundaryBlocked(x, y, direction, definition);
}


// ============================================================
// MAP CONTENT
// ============================================================

function buildPellets(definition = map) {
    const result = new Set();

    for (let y = 0; y < getMapRowCount(definition); y++) {
        for (let x = 0; x < getMapColumnCount(definition); x++) {
            const tile = definition.tiles[y][x];

            if (tile === "." || tile === "o") {
                result.add(`${x},${y}`);
            }
        }
    }

    if (definition === map) {
        pellets = result;
    }

    return result;
}


function buildGhostHouses(definition = map) {
    const ghostHouses = [];

    for (let y = 0; y < getMapRowCount(definition); y++) {
        for (let x = 0; x < getMapColumnCount(definition); x++) {
            if (definition.tiles[y][x] === "H") {
                ghostHouses.push({ x, y });
            }
        }
    }

    return ghostHouses;
}


// ============================================================
// MAP SELECTOR
// ============================================================

function updateMapSelector() {
    mapSelectElement.replaceChildren();

    for (const definition of maps) {
        const option = document.createElement("option");

        option.value = definition.id;
        option.textContent = getMapLabel(definition);

        mapSelectElement.append(option);
    }

    mapSelectElement.value = activeMapId;
}


// ============================================================
// CHARACTER ICONS
// ============================================================

function createGhostIcon(color, className) {
    const svg = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg"
    );

    svg.setAttribute("viewBox", "0 0 48 48");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add(className);

    const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
    );

    path.setAttribute(
        "d",
        "M5 43V23a19 19 0 0 1 38 0v20l-7-5-7 5-7-5-7 5-5-5Z"
    );

    path.setAttribute("fill", color);
    svg.append(path);

    for (const x of [18, 31]) {
        const eye = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "ellipse"
        );

        eye.setAttribute("cx", String(x));
        eye.setAttribute("cy", "23");
        eye.setAttribute("rx", "5");
        eye.setAttribute("ry", "7");
        eye.setAttribute("fill", "white");

        svg.append(eye);
    }

    for (const x of [20, 33]) {
        const pupil = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle"
        );

        pupil.setAttribute("cx", String(x));
        pupil.setAttribute("cy", "24");
        pupil.setAttribute("r", "2.5");
        pupil.setAttribute("fill", "#111827");

        svg.append(pupil);
    }

    return svg;
}


function getGhostName(index, ghostStarts = map.ghostStarts) {
    const standardNames = [
        "redGhost",
        "orangeGhost",
        "pinkGhost"
    ];

    if (index < standardNames.length) {
        return messages[standardNames[index]];
    }

    return messages.ghostNumber.replace(
        "{number}",
        String(index + 1)
    );
}


function selectCharacter(button) {
    selectedCharacter = button.dataset.character;
    resetGame();
    startScreenElement.hidden = true;
}


function updateCharacterChoices() {
    const ghostStarts = getCurrentMapDefinition().ghostStarts;

    ghostCharacterChoicesElement.replaceChildren();

    for (let index = 0; index < ghostStarts.length; index++) {
        const name = getGhostName(index, ghostStarts);
        const button = document.createElement("button");

        button.className = "character-choice";
        button.dataset.character = `ghost-${index}`;
        button.setAttribute("aria-label", name);

        const icon = createGhostIcon(
            ghostStarts[index].color || getGhostColor(index),
            "character-figure"
        );

        const label = document.createElement("span");
        label.textContent = name;

        button.append(icon, label);

        button.addEventListener(
            "click",
            () => selectCharacter(button)
        );

        ghostCharacterChoicesElement.append(button);
    }
}


function updateAddGhostButton() {
    const existingColors = ghosts.map((ghost, index) =>
        ghost.color || getGhostColor(index)
    );

    const color = existingColors.length < BASE_GHOST_COLORS.length
        ? BASE_GHOST_COLORS[existingColors.length]
        : getMostDistinctGhostColor(existingColors);

    const label = document.createElement("span");
    label.textContent = messages.addGhost;

    addGhostButton.replaceChildren(
        createGhostIcon(color, "ghost-choice-icon"),
        label
    );

    addGhostButton.setAttribute(
        "aria-pressed",
        String(addingGhost)
    );

    addGhostButton.setAttribute(
        "aria-label",
        addingGhost
            ? messages.cancelAddGhost
            : messages.addGhost
    );

    addGhostButton.title = messages.addGhostInstructions;
}


// ============================================================
// MAP EDITOR
// ============================================================

function saveEditorMap() {
    const savedMap = cloneMapDefinition(editorDraftMap);

    const existingIndex = maps.findIndex(
        definition => definition.id === savedMap.id
    );

    if (existingIndex < 0) {
        maps.push(savedMap);
    } else {
        maps[existingIndex] = savedMap;
    }

    activeMapId = savedMap.id;

    updateMapSelector();
}


// ============================================================
// GRAPH
// ============================================================

// Graph is bidirectional
function buildGraph(definition = map) {
    const rowCount = getMapRowCount(definition);
    const colCount = getMapColumnCount(definition);

    const result = Array.from(
        { length: rowCount },
        () => Array.from({ length: colCount }, () => [])
    );

    for (let y = 0; y < rowCount; y++) {
        for (let x = 0; x < colCount; x++) {
            if (isWall(x, y, definition)) {
                continue;
            }

            for (const direction of Object.values(DIRECTIONS)) {
                const next = getWrappedPosition(
                    x + direction.x,
                    y + direction.y,
                    definition
                );

                if (
                    isWall(next.x, next.y, definition) ||
                    isBoundaryBlocked(
                        x,
                        y,
                        direction,
                        definition
                    )
                ) {
                    continue;
                }

                result[y][x].push({
                    x: next.x,
                    y: next.y,
                    direction
                });
            }
        }
    }

    if (definition === map) {
        graph = result;
    }

    return result;
}