// MAP
// ============================================================

const LEVEL_MAP = [
    "####################",
    "#........##........#",
    "#.####.#.##.#.####.#",
    "#o####.#.##.#.####o#",
    "#..................#",
    "#.####.###.#######.#",
    "#......#...#.......#",
    "######.#.###.#.######",
    "     #.#.....#.#     ",
    "######.#.###.#.######",
    "............#.......#",
    "#.####.###.###.####.#",
    "#o..##........##..o.",
    "###.##.##.##.##.####",
    "#......#....#.......#",
    "#.####.#.##.#.####..#",
    "#..................#",
    "####################"


    // "####################",
    // "#        ##        #",
    // "# #### # ## # #### #",
    // "# #### # ## # #### #",
    // "#                  #",
    // "# #### ### ####### #",
    // "#      #   #       #",
    // "###### # ### # ######",
    // "     # #     # #     ",
    // "###### # ### # ######",
    // "            #       #",
    // "# #### ### ### #### #",
    // "#   ##        ##    ",
    // "### ## ## ## ## ####",
    // "#      #  . #       #",
    // "# #### # ## # ####  #",
    // "#                  #",
    // "####################"

    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
    // "....................",
];

const CELL = 28;
const ROWS = LEVEL_MAP.length;
const COLS = 20;

canvas.width = COLS * CELL;
canvas.height = ROWS * CELL;

const DEFAULT_PLAYER_START = {
    x: 10,
    y: 10,
    direction: { x: 0, y: 0 }
};

const DEFAULT_GHOST_STARTS = [
    { x: 9, y: 8, direction: { x: 1, y: 0 } },
    { x: 10, y: 8, direction: { x: -1, y: 0 } },
    { x: 11, y: 10, direction: { x: -1, y: 0 } }
];


// ============================================================
// STATE
// ============================================================

let score;
let lives;
let pellets;

let player;
let ghosts;
let selectedCharacter = "pacman";
let maps;
let activeMapId = "classic";
let editorDraftMap = null;
let nextCustomMapNumber = 1;
let editorMode = false;
let editorGesture = null;
let editorToastTimer = 0;
let addingGhost = false;

let running = false;
let paused = false;
let gameWon = false;
let deathTimer = 0;
let currentTime = 0;
let gameTime = 0;

let frightenedTimer = 0;

const FRIGHTENED_DURATION = 7;
const FRIGHTENED_BLINK_TIME = 2;
const FRIGHTENED_BLINK_FREQUENCY = 12;
const GHOST_COLLISION_DISTANCE = 0.55;

let MAP;
let MAP_EDGES = new Set();
let GHOST_HOUSES = [];

const PACMAN_SPEED = 3.5;
const GHOST_SPEED = 2.25;
const EATEN_GHOST_SPEED = 4;

// ============================================================
// GHOST AI
// ============================================================

// Keep pellet coverage as a small secondary signal to Pac-Man's territory.
const WEIGHT_NORMAL = 1;
const WEIGHT_PELLET = 0.01;
const WEIGHT_BLUE = 0;
const MAX_PELLET_SCORE_FRACTION = 0.25;


// Total value reserved for all remaining pellets.
// The individual value is TOTAL / remaining pellets.
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


// Static graph of the map.
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

const DEFAULT_GHOST_HOUSES = [{ x: 11, y: 8 }];


function createBoundaryOnlyMap() {
    const ghostHouses = DEFAULT_GHOST_HOUSES.map(cloneMapPosition);
    const occupied = [
        DEFAULT_PLAYER_START,
        ...DEFAULT_GHOST_STARTS,
        ...ghostHouses
    ];
    const tiles = Array.from({ length: ROWS }, (_, y) =>
        Array.from({ length: COLS }, (_, x) =>
            occupied.some(position => position.x === x && position.y === y)
                ? " "
                : "."
        ).join("")
    );
    const edges = [];

    for (let y = 1; y < ROWS - 1; y += 2) {
        const gap = (y * 7) % (COLS - 2) + 1;

        for (let x = 0; x < COLS; x++) {
            if (x !== gap && x !== gap + 1) {
                edges.push(`v:${x}:${y}`);
            }
        }
    }

    for (let x = 3; x < COLS - 1; x += 4) {
        const gap = (x * 5) % (ROWS - 2) + 1;

        for (let y = 0; y < ROWS; y++) {
            if (y !== gap && y !== gap + 1) {
                edges.push(`h:${x}:${y}`);
            }
        }
    }

    const connectedEdges = connectBoundaryMap(tiles, edges);

    return {
        id: "boundary-only",
        nameKey: "boundaryMap",
        tiles,
        edges: connectedEdges,
        ghostHouses,
        playerStart: { ...DEFAULT_PLAYER_START },
        ghostStarts: DEFAULT_GHOST_STARTS.map(cloneMapPosition)
    };
}


function getBoundaryMapReachableCells(tiles, edges) {
    const startY = tiles.findIndex(row =>
        Array.from(row).some(cell => cell !== "#")
    );

    if (startY < 0) {
        return [];
    }

    const startX = Array.from(tiles[startY]).findIndex(cell => cell !== "#");
    const queue = [{ x: startX, y: startY }];
    const reached = new Set([`${startX},${startY}`]);

    for (let index = 0; index < queue.length; index++) {
        const current = queue[index];

        for (const direction of Object.values(DIRECTIONS)) {
            const next = getWrappedPosition(
                current.x + direction.x,
                current.y + direction.y
            );
            const nextKey = `${next.x},${next.y}`;

            if (
                tiles[next.y][next.x] === "#" ||
                edges.has(getBoundaryKey(current.x, current.y, direction)) ||
                reached.has(nextKey)
            ) {
                continue;
            }

            reached.add(nextKey);
            queue.push(next);
        }
    }

    return queue;
}


function connectBoundaryMap(tiles, edges) {
    const connectedEdges = new Set(edges);
    const openCellCount = tiles.reduce(
        (total, row) => total + Array.from(row).filter(cell => cell !== "#").length,
        0
    );

    while (true) {
        const reachable = getBoundaryMapReachableCells(tiles, connectedEdges);

        if (reachable.length === openCellCount) {
            return Array.from(connectedEdges);
        }

        const reachableKeys = new Set(
            reachable.map(position => `${position.x},${position.y}`)
        );
        let openedBoundary = false;

        for (const current of reachable) {
            for (const direction of Object.values(DIRECTIONS)) {
                const next = getWrappedPosition(
                    current.x + direction.x,
                    current.y + direction.y
                );

                if (
                    tiles[next.y][next.x] === "#" ||
                    reachableKeys.has(`${next.x},${next.y}`)
                ) {
                    continue;
                }

                const edgeKey = getBoundaryKey(
                    current.x,
                    current.y,
                    direction
                );

                if (connectedEdges.delete(edgeKey)) {
                    openedBoundary = true;
                    break;
                }
            }

            if (openedBoundary) {
                break;
            }
        }

        if (!openedBoundary) {
            throw new Error("Unable to connect all open cells in the boundary map.");
        }
    }
}


function cloneMapPosition(position) {
    return {
        x: position.x,
        y: position.y,
        color: position.color,
        direction: position.direction
            ? { ...position.direction }
            : undefined
    };
}


function clearMapTiles(tiles, positions) {
    const clearedTiles = tiles.map(row => row.slice());

    for (const position of positions) {
        const row = clearedTiles[position.y];
        clearedTiles[position.y] =
            row.slice(0, position.x) +
            " " +
            row.slice(position.x + 1);
    }

    return clearedTiles;
}


function cloneMapDefinition(map) {
    return {
        ...map,
        tiles: map.tiles.slice(),
        edges: map.edges.slice(),
        ghostHouses: map.ghostHouses.map(cloneMapPosition),
        playerStart: cloneMapPosition(map.playerStart),
        ghostStarts: map.ghostStarts.map(cloneMapPosition)
    };
}


const PREDEFINED_MAPS = [
    {
        id: "classic",
        nameKey: "classicMap",
        tiles: clearMapTiles(LEVEL_MAP, DEFAULT_GHOST_HOUSES),
        edges: [],
        ghostHouses: DEFAULT_GHOST_HOUSES.map(cloneMapPosition),
        playerStart: DEFAULT_PLAYER_START,
        ghostStarts: DEFAULT_GHOST_STARTS
    },
    createBoundaryOnlyMap()
];

maps = PREDEFINED_MAPS.map(cloneMapDefinition);


function getCurrentMapDefinition() {
    return editorDraftMap ||
        maps.find(map => map.id === activeMapId) ||
        maps[0];
}


function getMapLabel(map) {
    return map.nameKey
        ? messages[map.nameKey]
        : `${messages.customMap} ${map.customNumber}`;
}


function updateMapSelector() {
    mapSelectElement.replaceChildren();

    for (const map of maps) {
        const option = document.createElement("option");
        option.value = map.id;
        option.textContent = getMapLabel(map);
        mapSelectElement.append(option);
    }

    mapSelectElement.value = activeMapId;
}

function createGhostIcon(color, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 48 48");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add(className);

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M5 43V23a19 19 0 0 1 38 0v20l-7-5-7 5-7-5-7 5-5-5Z");
    path.setAttribute("fill", color);
    svg.append(path);

    for (const x of [18, 31]) {
        const eye = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
        eye.setAttribute("cx", String(x));
        eye.setAttribute("cy", "23");
        eye.setAttribute("rx", "5");
        eye.setAttribute("ry", "7");
        eye.setAttribute("fill", "white");
        svg.append(eye);
    }

    for (const x of [20, 33]) {
        const pupil = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        pupil.setAttribute("cx", String(x));
        pupil.setAttribute("cy", "24");
        pupil.setAttribute("r", "2.5");
        pupil.setAttribute("fill", "#111827");
        svg.append(pupil);
    }

    return svg;
}


function getGhostName(index, ghostStarts) {
    const standardNames = ["redGhost", "orangeGhost", "pinkGhost"];

    if (index < standardNames.length) {
        return messages[standardNames[index]];
    }

    return messages.ghostNumber.replace("{number}", String(index + 1));
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
        button.addEventListener("click", () => selectCharacter(button));
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
    addGhostButton.setAttribute("aria-pressed", String(addingGhost));
    addGhostButton.setAttribute(
        "aria-label",
        addingGhost
            ? messages.cancelAddGhost
            : messages.addGhost
    );
    addGhostButton.title = messages.addGhostInstructions;
}


function saveEditorMap() {
    const savedMap = cloneMapDefinition(editorDraftMap);
    const existingIndex = maps.findIndex(map => map.id === savedMap.id);

    if (existingIndex < 0) {
        maps.push(savedMap);
    } else {
        maps[existingIndex] = savedMap;
    }

    activeMapId = savedMap.id;
    updateMapSelector();
}


// ============================================================
// GRID UTILITIES
// ============================================================

function isWall(x, y) {

    if (x < 0 || x >= COLS || y < 0 || y >= ROWS)
        return true;

    return MAP[y][x] === "#";
}


function wrap(value, size) {
    return ((value % size) + size) % size;
}


function getWrappedPosition(x, y) {

    return {
        x: wrap(x, COLS),
        y: wrap(y, ROWS)
    };
}


function getBoundaryKey(x, y, direction) {
    const position = getWrappedPosition(x, y);

    if (direction.x === 1) {
        return `h:${position.x}:${position.y}`;
    }

    if (direction.x === -1) {
        return `h:${wrap(position.x - 1, COLS)}:${position.y}`;
    }

    if (direction.y === 1) {
        return `v:${position.x}:${position.y}`;
    }

    return `v:${position.x}:${wrap(position.y - 1, ROWS)}`;
}


function isBoundaryBlocked(x, y, direction) {
    return MAP_EDGES.has(getBoundaryKey(x, y, direction));
}


function canMove(x, y, direction) {

    const next = getWrappedPosition(
        x + direction.x,
        y + direction.y
    );

    return !isWall(next.x, next.y) &&
        !isBoundaryBlocked(x, y, direction);
}


// ============================================================
// GRAPH
// ============================================================

function buildGraph() {

    graph = Array.from(
        { length: ROWS },
        () => Array.from(
            { length: COLS },
            () => []
        )
    );


    for (let y = 0; y < ROWS; y++) {

        for (let x = 0; x < COLS; x++) {

            if (isWall(x, y))
                continue;


            for (const direction of Object.values(DIRECTIONS)) {

                const next =
                    getWrappedPosition(
                        x + direction.x,
                        y + direction.y
                    );


                if (
                    !isWall(next.x, next.y) &&
                    !isBoundaryBlocked(x, y, direction)
                ) {

                    graph[y][x].push({
                        x: next.x,
                        y: next.y,
                        direction
                    });
                }
            }
        }
    }
}


// ============================================================
