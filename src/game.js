const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const scoreElement = document.getElementById("score");
const livesElement = document.getElementById("lives");
const statusElement = document.getElementById("status");
const startScreenElement = document.getElementById("start-screen");
const editorToolbarElement = document.getElementById("map-editor-toolbar");
const editorBackButton = document.getElementById("editor-back");
const editorSaveButton = document.getElementById("editor-save");
const mapSelectElement = document.getElementById("map-select");
const newMapButton = document.getElementById("editor-new-map");
const pressedDirectionKeys = new Set();

const messages = window.PACMAN_TRANSLATIONS;
const contentLanguage = window.PACMAN_LOCALE;

function localizeContent() {
    document.documentElement.lang = contentLanguage;
    document.documentElement.dir =
        ["ar", "fa", "he", "ps", "ur"].includes(contentLanguage)
            ? "rtl"
            : "ltr";

    document
        .querySelectorAll("[data-i18n]")
        .forEach(element => {
            element.textContent = messages[element.dataset.i18n];
        });

    document
        .querySelectorAll("[data-i18n-aria-label]")
        .forEach(element => {
            element.setAttribute(
                "aria-label",
                messages[element.dataset.i18nAriaLabel]
            );
        });

    document
        .querySelectorAll("[data-dir]")
        .forEach(button => {
            button.setAttribute(
                "aria-label",
                messages.directions[button.dataset.dir]
            );
        });
}

function setStatus(messageKey) {
    statusElement.textContent = messages[messageKey];
}

function setMapEditorInstructions() {
    statusElement.textContent =
        `${messages.mapEditorInstructions} ${messages.mapEditorHouseInstructions}`;
}

localizeContent();

// ============================================================
// DEBUG
// ============================================================
let showVoronoi = false;

const DOMAIN_COLORS = {
    pacman: [255, 212, 59],
    ghost0: [224, 82, 82],
    ghost1: [233, 155, 53],
    ghost2: [214, 106, 217]
};

const DOMAIN_ALPHA = 0.35;

// ============================================================
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

let running = false;
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


// ============================================================
// GHOST AI
// ============================================================

const PACMAN_SPEED = 3.5;
const GHOST_SPEED = 2.25;
const EATEN_GHOST_SPEED = 4;

// Strategic weights.
// Equal for now; we can adjust them later.
const WEIGHT_NORMAL = 1;
const WEIGHT_PELLET = 1;
const WEIGHT_BLUE = 1;


// Total value reserved for all remaining pellets.
// The individual value is TOTAL / remaining pellets.
const TOTAL_PELLET_VALUE = 1000;
const INITIAL_LIVES = 3;
const SEARCH_LIFE_PRIORITY =
    ROWS * COLS +
    2 * TOTAL_PELLET_VALUE +
    1;

const EPSILON = 1e-9;
const SEARCH_EPSILON = 1e-7;


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

    return {
        id: "boundary-only",
        nameKey: "boundaryMap",
        tiles,
        edges,
        ghostHouses,
        playerStart: { ...DEFAULT_PLAYER_START },
        ghostStarts: DEFAULT_GHOST_STARTS.map(cloneMapPosition)
    };
}


function cloneMapPosition(position) {
    return {
        x: position.x,
        y: position.y,
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
// PRIORITY QUEUE
// ============================================================

class MinHeap {

    constructor() {
        this.items = [];
    }


    get length() {
        return this.items.length;
    }


    empty() {
        return this.items.length === 0;
    }


    push(item) {

        this.items.push(item);

        let index =
            this.items.length - 1;


        while (index > 0) {

            const parent =
                Math.floor((index - 1) / 2);


            if (
                this.items[parent].time <=
                this.items[index].time
            ) {
                break;
            }


            [
                this.items[parent],
                this.items[index]
            ] = [
                    this.items[index],
                    this.items[parent]
                ];


            index = parent;
        }
    }


    pop() {

        if (this.items.length === 0)
            return null;


        const result =
            this.items[0];


        const last =
            this.items.pop();


        if (this.items.length > 0) {

            this.items[0] = last;

            let index = 0;


            while (true) {

                const left =
                    index * 2 + 1;

                const right =
                    index * 2 + 2;

                let smallest = index;


                if (
                    left < this.items.length &&
                    this.items[left].time <
                    this.items[smallest].time
                ) {
                    smallest = left;
                }


                if (
                    right < this.items.length &&
                    this.items[right].time <
                    this.items[smallest].time
                ) {
                    smallest = right;
                }


                if (smallest === index)
                    break;


                [
                    this.items[index],
                    this.items[smallest]
                ] = [
                        this.items[smallest],
                        this.items[index]
                    ];


                index = smallest;
            }
        }


        return result;
    }
}


// ============================================================
// SHORTEST PATH
// ============================================================

function shortestDistance(
    startX,
    startY,
    targetX,
    targetY
) {

    if (
        startX === targetX &&
        startY === targetY
    ) {
        return 0;
    }


    const distances =
        Array.from(
            { length: ROWS },
            () => Array(COLS).fill(Infinity)
        );


    const queue = new MinHeap();


    distances[startY][startX] = 0;


    queue.push({
        x: startX,
        y: startY,
        time: 0
    });


    while (!queue.empty()) {

        const current =
            queue.pop();


        if (
            current.time >
            distances[current.y][current.x]
        ) {
            continue;
        }


        if (
            current.x === targetX &&
            current.y === targetY
        ) {
            return current.time;
        }


        for (
            const next of
            graph[current.y][current.x]
        ) {

            const nextTime =
                current.time + 1;


            if (
                nextTime <
                distances[next.y][next.x]
            ) {

                distances[next.y][next.x] =
                    nextTime;


                queue.push({
                    x: next.x,
                    y: next.y,
                    time: nextTime
                });
            }
        }
    }


    return Infinity;
}


// ============================================================
// DOMAIN
// ============================================================

function createDomainCell() {

    return {
        arrival: Infinity,
        owners: []
    };
}

function checkAndUpdateImprovedDomain(assessedDomainCell, currentDomainCell) {
    // Check if power determines a successful domain even if it is later 
    if (assessedDomainCell.owner == "pacman" && !currentDomainCell.owners.filter((owner) => owner.startsWith("ghost")).length
        && (currentDomainCell.owners.length !== 1 || currentDomainCell.owners[0] !== "pacman")) {
        // Pacman overlaps earlier arrivals
        currentDomainCell.arrival =
            assessedDomainCell.time;

        currentDomainCell.owners = ["pacman"];
    } else if (assessedDomainCell.owner.startsWith("ghost") && currentDomainCell.owners.includes("pacman")
        && currentDomainCell.owners.includes("pacman")) {
        currentDomainCell.arrival =
            assessedDomainCell.time;

        currentDomainCell.owners = [assessedDomainCell.owner];
    } else {
        return false;
    }
    return true;
}


function calculateDomain() {

    const domain =
        Array.from(
            { length: ROWS },
            () => Array.from(
                { length: COLS },
                createDomainCell
            )
        );


    let queue = new MinHeap();


    // --------------------------------------------------------
    // PAC-MAN
    // --------------------------------------------------------

    queue.push({
        x: player.x,
        y: player.y,
        time: gameTime,
        owner: "pacman",
        speed: PACMAN_SPEED,
        initialProgress: player.progress,
        initialDirection: player.direction,
        initialMove: player.progress > 0
    });


    // --------------------------------------------------------
    // GHOSTS
    // --------------------------------------------------------

    for (let i = 0; i < ghosts.length; i++) {

        const ghost = ghosts[i];
        const owner = `ghost${i}`;

        queue.push({
            x: ghost.x,
            y: ghost.y,
            time: gameTime,
            owner,
            speed: ghost.eaten ? EATEN_GHOST_SPEED : GHOST_SPEED,
            initialProgress: ghost.progress,
            initialDirection: ghost.direction,
            initialMove: ghost.progress > 0
        });
    }


    // --------------------------------------------------------
    // MULTI-SOURCE TEMPORAL FLOOD
    // --------------------------------------------------------

    while (!queue.empty()) {

        const assessedDomainCell =
            queue.pop();


        const currentDomainCell =
            domain[
            assessedDomainCell.y
            ][
            assessedDomainCell.x
            ];

        if (assessedDomainCell.time > currentDomainCell.arrival) {
            // A slower arrival cannot claim or propagate through this cell.
            continue;
        }

        if (assessedDomainCell.time < currentDomainCell.arrival) {
            currentDomainCell.arrival = assessedDomainCell.time;
            currentDomainCell.owners = [assessedDomainCell.owner];
            currentDomainCell.direction = assessedDomainCell.direction;
        } else if (currentDomainCell.owners.includes(assessedDomainCell.owner)) {
            // Ignore duplicate equal-time paths from the same character.
            continue;
        } else {
            currentDomainCell.owners.push(assessedDomainCell.owner);
        }

        // Stop at a meeting point: a character must not propagate into
        // territory already reached by another character at the same time.
        if (currentDomainCell.owners.length > 1) {
            continue;
        }

        // Pacman stops expanding as soon as he reaches a power pill.
        if (
            assessedDomainCell.owner === "pacman" &&
            MAP[assessedDomainCell.y][assessedDomainCell.x] === "o"
        ) {
            continue;
        }


        /*
         * We spread the wave.
         */
        for (
            const next of
            graph[assessedDomainCell.y][assessedDomainCell.x]
        ) {

            if (
                assessedDomainCell.initialMove &&
                (
                    next.direction.x !== assessedDomainCell.initialDirection.x ||
                    next.direction.y !== assessedDomainCell.initialDirection.y
                )
            ) {
                continue;
            }

            const nextTime =
                assessedDomainCell.time +
                (
                    assessedDomainCell.initialMove
                        ? 1 - assessedDomainCell.initialProgress
                        : 1
                ) /
                assessedDomainCell.speed;


            const nextCell =
                domain[
                next.y
                ][
                next.x
                ];


            /*
             * We only want to propagate if we can
             * improve the time.
             */
            if (nextTime >
                nextCell.arrival) {
                continue;
            }


            queue.push({
                x: next.x,
                y: next.y,
                time: nextTime,
                owner: assessedDomainCell.owner,
                speed: assessedDomainCell.speed,
                direction: next.direction,
                initialMove: false
            });
        }
    }


    return domain;
}


function drawVoronoiDomains() {
    if (!showVoronoi) {
        return;
    }

    const domain = calculateDomain();

    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {

            if (MAP[y][x] === "#") {
                continue;
            }

            const owners = domain[y][x].owners;

            if (owners.length === 0) {
                continue;
            }

            // We normalize owners to their actual agents.
            const normalizedOwners = [
                ...new Set(
                    owners.map(owner => {
                        if (
                            owner === "powerPacman" ||
                            owner === "pacman"
                        ) {
                            return "pacman";
                        }

                        if (owner.startsWith("recoveredGhost")) {
                            return owner.replace(
                                "recoveredGhost",
                                "ghost"
                            );
                        }

                        return owner;
                    })
                )
            ];

            const colors = normalizedOwners
                .map(owner => DOMAIN_COLORS[owner])
                .filter(Boolean);

            if (colors.length === 0) {
                continue;
            }

            // The average of the colors allows identifying ties.
            const r = Math.round(
                colors.reduce((sum, c) => sum + c[0], 0)
                / colors.length
            );

            const g = Math.round(
                colors.reduce((sum, c) => sum + c[1], 0)
                / colors.length
            );

            const b = Math.round(
                colors.reduce((sum, c) => sum + c[2], 0)
                / colors.length
            );

            ctx.fillStyle =
                `rgba(${r}, ${g}, ${b}, ${DOMAIN_ALPHA})`;

            ctx.fillRect(
                x * CELL,
                y * CELL,
                CELL,
                CELL
            );
        }
    }
}


// ============================================================
// DOMAIN OWNERS
// ============================================================

function getGhostOwners(owners) {

    return owners.filter(
        owner =>
            owner.startsWith("ghost") || owner.startsWith("recoveredGhost")
    );
}


function getGhostIndex(owner) {

    return Number(
        owner.replace("recoveredGhost", "").replace("ghost", "")
    );
}


// ============================================================
// NORMAL + PELLET SCORE
// ============================================================

function calculateNormalAndPelletScore(
    domain
) {

    let normalScore = 0;
    let pelletScore = 0;


    const pelletValue =
        pellets > 0
            ? TOTAL_PELLET_VALUE / pellets
            : 0;


    for (let y = 0; y < ROWS; y++) {

        for (let x = 0; x < COLS; x++) {

            const cell =
                MAP[y][x];


            if (cell === "#")
                continue;


            const ghostOwners =
                getGhostOwners(
                    domain[y][x].owners
                );


            if (ghostOwners.length === 0)
                continue;


            let value;


            if (
                cell === "." ||
                cell === "o"
            ) {

                value =
                    pelletValue;

                pelletScore +=
                    value /
                    ghostOwners.length;
            }

            else {

                value = 1;

                normalScore +=
                    value /
                    ghostOwners.length;
            }
        }
    }


    return {
        normalScore,
        pelletScore
    };
}


// ============================================================
// BLUE PELLET DOMAIN
// ============================================================

function calculateBluePelletValues(
    domain
) {

    const values =
        ghosts.map(() => 0);


    const activeBlue =
        ghosts
            .map((ghost, index) => ({
                ghost,
                index
            }))
            .filter(({ ghost }) => ghost.frightened);


    if (activeBlue.length === 0)
        return values;


    /* 
    * The total value of the pellets is still being distributed 
    * among the remaining pellets. 
    */
    const pelletValue =
        pellets > 0
            ? TOTAL_PELLET_VALUE / pellets
            : 0;


    for (let y = 0; y < ROWS; y++) {

        for (let x = 0; x < COLS; x++) {

            const cell =
                MAP[y][x];


            if (
                cell !== "." &&
                cell !== "o"
            ) {
                continue;
            }


            /* 
            * Blue ghosts that dominate this square 
            * according to normal domain. 
            */
            const blueOwners =
                domain[y][x]
                    .owners
                    .filter(owner =>
                        owner.startsWith("ghost")
                    )
                    .filter(owner => {

                        const index =
                            getGhostIndex(
                                owner
                            );

                        return (
                            ghosts[index].frightened
                        );
                    });


            if (
                blueOwners.length === 0
            ) {
                continue;
            }


            /*
            * The pellet's value is distributed among the
            * tied blue ghosts. 
            */
            const share =
                pelletValue /
                blueOwners.length;


            for (
                const owner of blueOwners
            ) {

                const index =
                    getGhostIndex(
                        owner
                    );


                values[index] +=
                    share;
            }
        }
    }


    return values;
}


// ============================================================
// BLUE BALANCED SCORE
// ============================================================

function calculateBlueScore(
    domain
) {

    const values =
        calculateBluePelletValues(
            domain
        );


    const activeValues =
        values.filter(
        (value, index) =>
            ghosts[index].frightened
        );


    if (
        activeValues.length === 0
    ) {
        return 0;
    }


    const total =
        activeValues.reduce(
            (sum, value) =>
                sum + value,
            0
        );


    if (total === 0)
        return 0;


    const squares =
        activeValues.reduce(
            (sum, value) =>
                sum + value * value,
            0
        );


    /*
     * Jain Fairness Index.
     *
     * 1 = perfectly balanced distribution
     * 1/n = all value concentrated in one ghost
     */
    const fairness =
        total * total /
        (
            activeValues.length *
            squares
        );


    /* 
    * We want it to matter as much: 
    * 
    * - how much pellet territory there is 
    * - how balanced is the distribution 
    */
    return total * fairness;
}


// ============================================================
// TOTAL DOMAIN EVALUATION
// ============================================================

function evaluateDomain(
    domain
) {

    const normal =
        calculateNormalAndPelletScore(
            domain
        );


    const blue =
        calculateBlueScore(
            domain
        );


    const total =
        WEIGHT_NORMAL *
        normal.normalScore +

        WEIGHT_PELLET *
        normal.pelletScore +

        WEIGHT_BLUE *
        blue;


    return {
        normalScore:
            normal.normalScore,

        pelletScore:
            normal.pelletScore,

        blueScore:
            blue,

        total
    };
}


function cloneSearchCharacter(character) {
    return {
        ...character,
        direction: { ...character.direction },
        nextDirection: character.nextDirection
            ? { ...character.nextDirection }
            : undefined
    };
}


function createSearchState(readyGhostIndices, readyPlayer = false) {
    const readyGhostSet = new Set(readyGhostIndices);

    return {
        map: MAP.slice(),
        pellets,
        lives,
        time: gameTime,
        frightenedTimer,
        player: cloneSearchCharacter(player),
        ghosts: ghosts.map(cloneSearchCharacter),
        controlledGhostIndex: selectedCharacter.startsWith("ghost-")
            ? Number(selectedCharacter.slice("ghost-".length))
            : -1,
        terminal: false,
        readyPlayer,
        readyGhosts: ghosts.map((_, index) => readyGhostSet.has(index))
    };
}


function searchStateKey(state) {
    const characterKey = character => [
        character.x,
        character.y,
        character.direction.x,
        character.direction.y,
        Number(character.progress.toFixed(5)),
        Boolean(character.frightened),
        Boolean(character.eaten),
        character.nextDirection
            ? character.nextDirection.x
            : null,
        character.nextDirection
            ? character.nextDirection.y
            : null
    ].join(",");

    return JSON.stringify([
        state.map,
        state.pellets,
        state.lives,
        state.terminal,
        state.controlledGhostIndex,
        Number(state.frightenedTimer.toFixed(5)),
        characterKey(state.player),
        state.player.nextDirection.x,
        state.player.nextDirection.y,
        state.ghosts.map(characterKey),
        state.readyPlayer,
        state.readyGhosts
    ]);
}


function evaluateSearchState(state) {
    const previousState = {
        MAP,
        pellets,
        gameTime,
        frightenedTimer,
        player,
        ghosts
    };

    try {
        MAP = state.map.slice();
        pellets = state.pellets;
        gameTime = state.time;
        frightenedTimer = state.frightenedTimer;
        player = cloneSearchCharacter(state.player);
        ghosts = state.ghosts.map(cloneSearchCharacter);

        const domainValue =
            evaluateDomain(calculateDomain()).total;

        return (
            (INITIAL_LIVES - state.lives) *
            SEARCH_LIFE_PRIORITY
        ) + domainValue;
    } finally {
        MAP = previousState.MAP;
        pellets = previousState.pellets;
        gameTime = previousState.gameTime;
        frightenedTimer = previousState.frightenedTimer;
        player = previousState.player;
        ghosts = previousState.ghosts;
    }
}


function canMoveInSearchState(state, character, direction) {
    const x = wrap(character.x + direction.x, COLS);
    const y = wrap(character.y + direction.y, ROWS);

    return state.map[y][x] !== "#" &&
        !isBoundaryBlocked(character.x, character.y, direction);
}


function getSearchDirections(state, character, isGhost) {
    const possible = Object.values(DIRECTIONS)
        .filter(direction =>
            canMoveInSearchState(state, character, direction)
        );

    if (possible.length > 0) {
        return possible;
    }

    return isGhost && character.eaten
        ? [{ ...character.direction }]
        : [{ x: 0, y: 0 }];
}


function getSearchGhostDirections(state, index) {
    const ghost = state.ghosts[index];

    if (
        index === state.controlledGhostIndex &&
        !ghost.eaten
    ) {
        if (
            ghost.nextDirection &&
            canMoveInSearchState(state, ghost, ghost.nextDirection)
        ) {
            return [{ ...ghost.nextDirection }];
        }

        if (canMoveInSearchState(state, ghost, ghost.direction)) {
            return [{ ...ghost.direction }];
        }

        return [
            getSearchDirections(state, ghost, true)[0]
        ];
    }

    return getSearchDirections(state, ghost, true);
}


function reverseSearchGhost(ghost) {
    if (ghost.progress > 0) {
        ghost.x = wrap(ghost.x + ghost.direction.x, COLS);
        ghost.y = wrap(ghost.y + ghost.direction.y, ROWS);
        ghost.progress = 1 - ghost.progress;
    }

    ghost.direction.x *= -1;
    ghost.direction.y *= -1;
}


function advanceSearchState(state, ghostDirections, playerDirection) {
    const next = {
        ...state,
        map: state.map.slice(),
        player: cloneSearchCharacter(state.player),
        ghosts: state.ghosts.map(cloneSearchCharacter),
        readyPlayer: false,
        readyGhosts: state.readyGhosts.map(() => false)
    };

    if (playerDirection) {
        next.player.direction = { ...playerDirection };
    }

    for (const [index, direction] of ghostDirections) {
        next.ghosts[index].direction = { ...direction };
    }

    let nextEventTime = Infinity;

    const findNextEvent = (character, speed) => {
        if (character.direction.x === 0 && character.direction.y === 0) {
            return;
        }

        const timeToCenter =
            Math.max(0, 1 - character.progress) / speed;

        nextEventTime = Math.min(nextEventTime, timeToCenter);
    };

    findNextEvent(next.player, PACMAN_SPEED);

    if (next.frightenedTimer > 0) {
        nextEventTime = Math.min(
            nextEventTime,
            next.frightenedTimer
        );
    }

    const playerX =
        next.player.x +
        next.player.direction.x *
        next.player.progress;
    const playerY =
        next.player.y +
        next.player.direction.y *
        next.player.progress;
    const playerVelocityX =
        next.player.direction.x * PACMAN_SPEED;
    const playerVelocityY =
        next.player.direction.y * PACMAN_SPEED;

    for (const ghost of next.ghosts) {
        findNextEvent(
            ghost,
            ghost.eaten ? EATEN_GHOST_SPEED : GHOST_SPEED
        );

        if (ghost.eaten) {
            continue;
        }

        const relativeX =
            ghost.x +
            ghost.direction.x * ghost.progress -
            playerX;
        const relativeY =
            ghost.y +
            ghost.direction.y * ghost.progress -
            playerY;
        const relativeVelocityX =
            ghost.direction.x *
            (ghost.eaten ? EATEN_GHOST_SPEED : GHOST_SPEED) -
            playerVelocityX;
        const relativeVelocityY =
            ghost.direction.y *
            (ghost.eaten ? EATEN_GHOST_SPEED : GHOST_SPEED) -
            playerVelocityY;
        const velocitySquared =
            relativeVelocityX * relativeVelocityX +
            relativeVelocityY * relativeVelocityY;
        const distanceSquared =
            relativeX * relativeX +
            relativeY * relativeY;

        if (distanceSquared <= GHOST_COLLISION_DISTANCE ** 2) {
            nextEventTime = 0;
            continue;
        }

        if (velocitySquared === 0) {
            continue;
        }

        const linear =
            2 * (
                relativeX * relativeVelocityX +
                relativeY * relativeVelocityY
            );
        const discriminant =
            linear * linear -
            4 * velocitySquared *
            (distanceSquared - GHOST_COLLISION_DISTANCE ** 2);

        if (discriminant < 0) {
            continue;
        }

        const collisionTime =
            (-linear - Math.sqrt(discriminant)) /
            (2 * velocitySquared);

        if (collisionTime >= 0) {
            nextEventTime = Math.min(
                nextEventTime,
                collisionTime
            );
        }
    }

    if (!Number.isFinite(nextEventTime)) {
        return next;
    }

    next.time += nextEventTime;

    if (next.frightenedTimer > 0) {
        next.frightenedTimer -= nextEventTime;

        if (next.frightenedTimer <= 0) {
            next.frightenedTimer = 0;

            for (const ghost of next.ghosts) {
                if (!ghost.eaten) {
                    ghost.frightened = false;
                }
            }
        }
    }

    const moveToEvent = (character, speed) => {
        if (character.direction.x === 0 && character.direction.y === 0) {
            return false;
        }

        character.progress += speed * nextEventTime;

        if (character.progress < 1 - SEARCH_EPSILON) {
            return false;
        }

        character.progress = Math.max(0, character.progress - 1);
        character.x = wrap(character.x + character.direction.x, COLS);
        character.y = wrap(character.y + character.direction.y, ROWS);

        return true;
    };

    next.readyPlayer = moveToEvent(next.player, PACMAN_SPEED);

    for (let i = 0; i < next.ghosts.length; i++) {
        const ghost = next.ghosts[i];
        const arrived = moveToEvent(
            ghost,
            ghost.eaten ? EATEN_GHOST_SPEED : GHOST_SPEED
        );

        next.readyGhosts[i] = arrived;

        if (
            arrived &&
            ghost.eaten &&
            GHOST_HOUSES.some(house =>
                ghost.x === house.x && ghost.y === house.y
            )
        ) {
            ghost.eaten = false;
            ghost.frightened = false;
            next.readyGhosts[i] = true;
        }
    }

    if (next.readyPlayer) {
        const cell = next.map[next.player.y][next.player.x];

        if (cell === "." || cell === "o") {
            const row = next.map[next.player.y].split("");
            row[next.player.x] = " ";
            next.map[next.player.y] = row.join("");
            next.pellets--;

            if (cell === "o") {
                next.frightenedTimer = FRIGHTENED_DURATION;

                for (const ghost of next.ghosts) {
                    if (ghost.eaten) {
                        continue;
                    }

                    ghost.frightened = true;
                    reverseSearchGhost(ghost);
                }
            }
        }
    }

    const currentPlayerX =
        next.player.x +
        next.player.direction.x *
        next.player.progress;
    const currentPlayerY =
        next.player.y +
        next.player.direction.y *
        next.player.progress;

    for (const ghost of next.ghosts) {
        const dx =
            ghost.x +
            ghost.direction.x *
            ghost.progress -
            currentPlayerX;
        const dy =
            ghost.y +
            ghost.direction.y *
            ghost.progress -
            currentPlayerY;

        if (
            Math.sqrt(dx * dx + dy * dy) >
            GHOST_COLLISION_DISTANCE + SEARCH_EPSILON ||
            ghost.eaten
        ) {
            continue;
        }

        if (ghost.frightened) {
            ghost.eaten = true;
            ghost.frightened = false;
            continue;
        }

        next.lives--;
        next.terminal = true;
        next.frightenedTimer = 0;

        for (const remainingGhost of next.ghosts) {
            if (!remainingGhost.eaten) {
                remainingGhost.frightened = false;
            }
        }

        break;
    }

    return next;
}


function getSearchActionProfiles(state) {
    if (state.terminal) {
        return [];
    }

    const readyGhosts = state.readyGhosts
        .map((ready, index) => ready ? index : -1)
        .filter(index => index >= 0);

    const ghostProfiles = [];

    const addGhostProfiles = (position, directions) => {
        if (position === readyGhosts.length) {
            ghostProfiles.push(directions.slice());
            return;
        }

        const index = readyGhosts[position];

        for (const direction of getSearchGhostDirections(state, index)) {
            directions.push([index, { ...direction }]);
            addGhostProfiles(position + 1, directions);
            directions.pop();
        }
    };

    addGhostProfiles(0, []);

    const playerDirections = state.readyPlayer
        ? getSearchDirections(state, state.player, false)
        : [null];

    const profiles = [];

    for (const ghostDirections of ghostProfiles) {
        for (const playerDirection of playerDirections) {
            profiles.push({
                ghostDirections,
                playerDirection,
                nextState: advanceSearchState(
                    state,
                    ghostDirections,
                    playerDirection
                )
            });
        }
    }

    return profiles;
}


function createStrategicSearchNode(state, parent, parentEdge, depth, value) {
    const key = searchStateKey(state);
    const node = {
        key,
        state,
        parent,
        parentEdge,
        depth,
        staticValue: value,
        value,
        candidates: null,
        nextCandidate: 0,
        expanded: state.terminal,
        heapIndex: -1,
        readyGhosts: state.readyGhosts.some(Boolean),
        readyPlayer: state.readyPlayer
    };

    strategicSearch.nodes.set(key, node);

    if (!node.expanded) {
        pushStrategicSearchFrontier(node);
    }

    return node;
}


function prepareStrategicSearchNode(node) {
    if (node.candidates !== null) {
        return;
    }

    node.candidates = getSearchActionProfiles(node.state).map(profile => ({
        ...profile,
        processed: false,
        value: node.staticValue,
        child: null
    }));

    if (node.candidates.length === 0) {
        node.expanded = true;
    }
}


function getStrategicSearchNodeValue(node) {
    if (!node.candidates || node.candidates.length === 0) {
        return node.staticValue;
    }

    const hasGhostMove = node.readyGhosts;
    const hasPlayerMove = node.readyPlayer;
    const ghostGroups = new Map();

    for (const candidate of node.candidates) {
        const ghostKey = candidate.ghostDirections
            .map(([index, direction]) =>
                `${index}:${direction.x},${direction.y}`
            )
            .join("|");
        const value = candidate.processed
            ? candidate.value
            : node.staticValue;

        if (!ghostGroups.has(ghostKey)) {
            ghostGroups.set(ghostKey, []);
        }

        ghostGroups.get(ghostKey).push(value);
    }

    if (hasGhostMove && hasPlayerMove) {
        const worstResponses = Array.from(ghostGroups.values())
            .map(values => Math.min(...values));

        return Math.max(...worstResponses);
    }

    const values = Array.from(ghostGroups.values()).flat();

    if (hasGhostMove) {
        return Math.max(...values);
    }

    if (hasPlayerMove) {
        return Math.min(...values);
    }

    return node.staticValue;
}


function refreshStrategicSearchValues(node) {
    let current = node;

    while (current) {
        const nextValue = getStrategicSearchNodeValue(current);

        if (Math.abs(nextValue - current.value) <= EPSILON) {
            break;
        }

        current.value = nextValue;
        updateStrategicSearchFrontier(current);

        if (current.parent && current.parentEdge) {
            current.parentEdge.value = nextValue;
        }

        current = current.parent;
    }
}


function processStrategicSearchCandidate(node, candidate) {
    const childState = candidate.nextState;
    const childKey = searchStateKey(childState);
    const childValue = evaluateSearchState(childState);

    candidate.processed = true;
    candidate.value = childValue;

    const isAncestor = (() => {
        let ancestor = node;

        while (ancestor) {
            if (ancestor.key === childKey) {
                return true;
            }

            ancestor = ancestor.parent;
        }

        return false;
    })();

    if (!isAncestor && !strategicSearch.nodes.has(childKey)) {
        candidate.child = createStrategicSearchNode(
            childState,
            node,
            candidate,
            node.depth + 1,
            childValue
        );
    }

    refreshStrategicSearchValues(node);
}


function compareStrategicSearchNodes(a, b) {
    const aSign = a.readyGhosts ? 1 : -1;
    const bSign = b.readyGhosts ? 1 : -1;
    const aValue = a.value * aSign;
    const bValue = b.value * bSign;

    if (Math.abs(aValue - bValue) > EPSILON) {
        return bValue - aValue;
    }

    if (a.depth !== b.depth) {
        return a.depth - b.depth;
    }

    const aImprovement = a.parent
        ? (a.value - a.parent.staticValue) * (a.parent.readyGhosts ? 1 : -1)
        : 0;
    const bImprovement = b.parent
        ? (b.value - b.parent.staticValue) * (b.parent.readyGhosts ? 1 : -1)
        : 0;

    return bImprovement - aImprovement;
}


function swapStrategicSearchFrontier(a, b) {
    const frontier = strategicSearch.frontier;

    [frontier[a], frontier[b]] = [frontier[b], frontier[a]];
    frontier[a].heapIndex = a;
    frontier[b].heapIndex = b;
}


function pushStrategicSearchFrontier(node) {
    const frontier = strategicSearch.frontier;
    let index = frontier.length;

    frontier.push(node);
    node.heapIndex = index;

    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);

        if (compareStrategicSearchNodes(frontier[index], frontier[parent]) >= 0) {
            break;
        }

        swapStrategicSearchFrontier(index, parent);
        index = parent;
    }
}


function updateStrategicSearchFrontier(node) {
    let index = node.heapIndex;

    if (index < 0) {
        return;
    }

    const frontier = strategicSearch.frontier;

    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);

        if (compareStrategicSearchNodes(frontier[index], frontier[parent]) >= 0) {
            break;
        }

        swapStrategicSearchFrontier(index, parent);
        index = parent;
    }

    while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;

        if (
            left < frontier.length &&
            compareStrategicSearchNodes(frontier[left], frontier[best]) < 0
        ) {
            best = left;
        }

        if (
            right < frontier.length &&
            compareStrategicSearchNodes(frontier[right], frontier[best]) < 0
        ) {
            best = right;
        }

        if (best === index) {
            break;
        }

        swapStrategicSearchFrontier(index, best);
        index = best;
    }
}


function popStrategicSearchFrontier() {
    const frontier = strategicSearch.frontier;

    if (frontier.length === 0) {
        return null;
    }

    const first = frontier[0];
    const last = frontier.pop();
    first.heapIndex = -1;

    if (frontier.length > 0) {
        frontier[0] = last;
        last.heapIndex = 0;
        updateStrategicSearchFrontier(last);
    }

    return first;
}


function removeStrategicSearchFrontier(node) {
    const index = node.heapIndex;

    if (index < 0) {
        return;
    }

    const frontier = strategicSearch.frontier;
    const last = frontier.pop();
    node.heapIndex = -1;

    if (index < frontier.length) {
        frontier[index] = last;
        last.heapIndex = index;
        updateStrategicSearchFrontier(last);
    }
}


function advanceStrategicSearch() {
    const node = popStrategicSearchFrontier();

    if (!node || node.expanded) {
        return;
    }

    prepareStrategicSearchNode(node);

    if (!node.expanded) {
        const candidate = node.candidates[node.nextCandidate++];
        processStrategicSearchCandidate(node, candidate);

        if (node.nextCandidate >= node.candidates.length) {
            node.expanded = true;
        } else {
            pushStrategicSearchFrontier(node);
        }
    }
}


function getStrategicGhostDirection(node, ghostIndex, fallback) {
    prepareStrategicSearchNode(node);

    if (!node.candidates || node.candidates.length === 0) {
        return { ...fallback };
    }

    const groups = new Map();

    for (const candidate of node.candidates) {
        const ghostKey = candidate.ghostDirections
            .map(([index, direction]) =>
                `${index}:${direction.x},${direction.y}`
            )
            .join("|");

        if (!groups.has(ghostKey)) {
            groups.set(ghostKey, {
                value: Infinity,
                directions: candidate.ghostDirections
            });
        }

        const group = groups.get(ghostKey);
        const candidateValue = candidate.processed
            ? candidate.value
            : node.staticValue;

        group.value = Math.min(group.value, candidateValue);
    }

    let best = null;

    for (const group of groups.values()) {
        if (
            !best ||
            group.value > best.value
        ) {
            best = group;
        }
    }

    const selected = best &&
        best.directions.find(([index]) => index === ghostIndex);

    return selected
        ? { ...selected[1] }
        : { ...fallback };
}


function getStrategicSearchRoot(readyGhosts, readyPlayer = false) {
    const readyGhostIndices = readyGhosts.map(ghost => ghosts.indexOf(ghost));
    const state = createSearchState(readyGhostIndices, readyPlayer);
    const key = searchStateKey(state);
    let root = strategicSearch.nodes.get(key);

    if (!root) {
        root = createStrategicSearchNode(
            state,
            null,
            null,
            0,
            evaluateSearchState(state)
        );
        prepareStrategicSearchNode(root);

        for (const candidate of root.candidates) {
            processStrategicSearchCandidate(root, candidate);
        }

        root.expanded = true;
        removeStrategicSearchFrontier(root);
    }

    prepareStrategicSearchNode(root);
    strategicSearch.root = root;

    return root;
}


function chooseStrategicGhostDirections(readyGhosts) {
    const root = getStrategicSearchRoot(readyGhosts);

    return new Map(
        readyGhosts.map(ghost => {
            const index = ghosts.indexOf(ghost);

            return [
                ghost,
                getStrategicGhostDirection(
                    root,
                    index,
                    ghost.direction
                )
            ];
        })
    );
}


function chooseStrategicPacmanDirection() {
    const root = getStrategicSearchRoot([], true);
    const actionValues = new Map();

    for (const candidate of root.candidates) {
        const direction = candidate.playerDirection;
        const key = `${direction.x},${direction.y}`;
        const ghostKey = candidate.ghostDirections
            .map(([index, ghostDirection]) =>
                `${index}:${ghostDirection.x},${ghostDirection.y}`
            )
            .join("|");

        if (!actionValues.has(key)) {
            actionValues.set(key, {
                direction,
                ghostResponses: new Map()
            });
        }

        const action = actionValues.get(key);
        const value = candidate.processed
            ? candidate.value
            : root.staticValue;

        action.ghostResponses.set(
            ghostKey,
            Math.max(
                action.ghostResponses.get(ghostKey) ?? -Infinity,
                value
            )
        );
    }

    let bestDirection = null;
    let bestValue = Infinity;

    for (const action of actionValues.values()) {
        const worstGhostResponse = Math.max(
            ...action.ghostResponses.values()
        );

        if (worstGhostResponse < bestValue) {
            bestValue = worstGhostResponse;
            bestDirection = action.direction;
        }
    }

    return bestDirection
        ? { ...bestDirection }
        : { ...player.direction };
}


// ============================================================
// GHOST MOVE EVALUATION
// ============================================================

function getPossibleDirections(
    character
) {

    return [
        DIRECTIONS.up,
        DIRECTIONS.down,
        DIRECTIONS.left,
        DIRECTIONS.right
    ].filter(direction =>
        canMove(
            character.x,
            character.y,
            direction
        )
    );
}

// ============================================================
// START / RESTART
// ============================================================

function resetGame() {

    score = 0;
    lives = INITIAL_LIVES;

    resetLevel();
    gameWon = false;

    updateUI();
}


function resetLevel() {

    pellets = 0;
    gameTime = 0;
    strategicSearch.nodes.clear();
    strategicSearch.frontier = [];
    strategicSearch.root = null;


    /*
     * Normalize each row to COLS.
     */
    const mapDefinition = getCurrentMapDefinition();

    MAP =
        mapDefinition.tiles.map(
            row =>
                row.slice(0, COLS)
        );
    MAP_EDGES = new Set(mapDefinition.edges);
    GHOST_HOUSES = mapDefinition.ghostHouses.map(cloneMapPosition);


    for (const row of MAP) {

        for (const cell of row) {

            if (
                cell === "." ||
                cell === "o"
            ) {
                pellets++;
            }
        }
    }


    const playerStart = mapDefinition.playerStart;

    player = {
        x: playerStart.x,
        y: playerStart.y,
        px: playerStart.x,
        py: playerStart.y,
        direction: { ...playerStart.direction },
        facingDirection: playerStart.direction.x || playerStart.direction.y
            ? { ...playerStart.direction }
            : { ...DIRECTIONS.right },

        nextDirection: {
            x: 0,
            y: 0
        },

        progress: 0
    };


    const ghostStarts = mapDefinition.ghostStarts;

    ghosts = ghostStarts.map(start => ({
        x: start.x,
        y: start.y,
        px: start.x,
        py: start.y,
        direction: { ...start.direction },
        nextDirection: { ...start.direction },
        frightened: false,
        eaten: false,
        progress: 0
    }));


    running = false;
    deathTimer = 0;
    frightenedTimer = 0;


    buildGraph();


    setStatus(
        selectedCharacter === "pacman"
            ? "startPacman"
            : "startGhost"
    );
}


// ============================================================
// PAC-MAN
// ============================================================

function updatePlayer(dt) {

    const speed =
        PACMAN_SPEED;


    if (
        player.direction.x === 0 &&
        player.direction.y === 0
    ) {

        tryChangeDirection();

        return;
    }


    player.progress +=
        speed * dt;


    while (
        player.progress >= 1
    ) {

        player.progress -= 1;


        player.x =
            wrap(
                player.x +
                player.direction.x,
                COLS
            );


        player.y =
            wrap(
                player.y +
                player.direction.y,
                ROWS
            );


        player.px =
            player.x;

        player.py =
            player.y;


        eatPellet();

        if (selectedCharacter !== "pacman" && running) {
            player.nextDirection =
                chooseStrategicPacmanDirection();
        }


        if (
            canMove(
                player.x,
                player.y,
                player.nextDirection
            )
        ) {

            setPlayerDirection(player.nextDirection);
        }


        if (
            !canMove(
                player.x,
                player.y,
                player.direction
            )
        ) {

            setPlayerDirection({ x: 0, y: 0 });

            break;
        }
    }


    player.px =
        player.x +
        player.direction.x *
        player.progress;


    player.py =
        player.y +
        player.direction.y *
        player.progress;
}


function setPlayerDirection(direction) {
    player.direction = { ...direction };

    if (direction.x !== 0 || direction.y !== 0) {
        player.facingDirection = { ...direction };
    }
}


function tryChangeDirection() {

    if (
        canMove(
            player.x,
            player.y,
            player.nextDirection
        )
    ) {

        setPlayerDirection(player.nextDirection);
    }
}


// ============================================================
// PILLS
// ============================================================

function eatPellet() {

    const x =
        player.x;

    const y =
        player.y;


    if (
        x < 0 ||
        x >= COLS ||
        y < 0 ||
        y >= ROWS
    ) {
        return;
    }


    const cell =
        MAP[y][x];


    if (
        cell !== "." &&
        cell !== "o"
    ) {
        return;
    }


    const row =
        MAP[y].split("");


    row[x] = " ";


    MAP[y] =
        row.join("");


    pellets--;


    if (cell === "o") {

        score += 50;

        activateFrightenedMode();

    }

    else {

        score += 10;
    }


    if (pellets === 0) {

        running = false;
        gameWon = true;
        setStatus("won");
    }


    updateUI();
}


function activateFrightenedMode() {

    frightenedTimer =
        FRIGHTENED_DURATION;


    for (const ghost of ghosts) {

        if (ghost.eaten)
            continue;


        ghost.frightened = true;


        reverseGhostDirection(
            ghost
        );
    }
}


function reverseGhostDirection(
    ghost
) {

    if (ghost.progress > 0) {

        ghost.x +=
            ghost.direction.x;

        ghost.y +=
            ghost.direction.y;


        ghost.x =
            wrap(
                ghost.x,
                COLS
            );

        ghost.y =
            wrap(
                ghost.y,
                ROWS
            );


        ghost.progress =
            1 -
            ghost.progress;
    }


    ghost.direction.x *= -1;
    ghost.direction.y *= -1;
}


// ============================================================
// GHOSTS
// ============================================================

function updateGhost(
    ghost,
    dt
) {

    const speed =
        ghost.eaten
            ? EATEN_GHOST_SPEED
            : GHOST_SPEED;


    ghost.progress ??= 0;


    ghost.progress +=
        speed * dt;


    while (
        ghost.progress >= 1
    ) {

        ghost.progress -= 1;


        ghost.x =
            wrap(
                ghost.x +
                ghost.direction.x,
                COLS
            );


        ghost.y =
            wrap(
                ghost.y +
                ghost.direction.y,
                ROWS
            );

        if (
            ghost.eaten &&
            GHOST_HOUSES.some(house =>
                ghost.x === house.x && ghost.y === house.y
            )
        ) {
            ghost.eaten = false;
            ghost.frightened = false;
        }

        const possibleDirections =
            getPossibleDirections(
                ghost
            );


        if (
            possibleDirections.length === 0
        ) {

            ghost.direction = {
                x: 0,
                y: 0
            };

            break;
        }

        if (ghost.eaten) {
            ghost.needsDirection = true;
            ghost.pendingDecisionTime =
                gameTime -
                ghost.progress / EATEN_GHOST_SPEED;
            break;
        }


        // ====================================================
        // NORMAL / BLUE
        // ====================================================

        if (getControlledGhost() === ghost) {
            const desiredDirection = ghost.nextDirection;

            if (
                desiredDirection &&
                canMove(ghost.x, ghost.y, desiredDirection)
            ) {
                ghost.direction = { ...desiredDirection };
            } else if (!canMove(ghost.x, ghost.y, ghost.direction)) {
                ghost.direction = { ...possibleDirections[0] };
            }

            ghost.needsDirection = false;
        } else {
            ghost.needsDirection = true;
            ghost.pendingDecisionTime =
                gameTime -
                ghost.progress / speed;
        }

        break;
    }


    ghost.px =
        ghost.x +
        ghost.direction.x *
        ghost.progress;


    ghost.py =
        ghost.y +
        ghost.direction.y *
        ghost.progress;
}


// ============================================================
// COLLISIONS
// ============================================================

function checkGhostCollisions() {

    for (
        const ghost of ghosts
    ) {

        const dx =
            ghost.px -
            player.px;


        const dy =
            ghost.py -
            player.py;


        const distance =
            Math.sqrt(
                dx * dx +
                dy * dy
            );


        if (distance >= GHOST_COLLISION_DISTANCE) {
            continue;
        }


        if (ghost.eaten)
            continue;


        if (ghost.frightened) {

            eatGhost(
                ghost
            );

            continue;
        }


        loseLife();

        return;
    }
}


function eatGhost(ghost) {

    ghost.eaten = true;
    ghost.frightened = false;

    score += 200;

    updateUI();
}


function loseLife() {

    if (deathTimer > 0)
        return;


    lives--;

    running = false;

    deathTimer = 1.0;
    frightenedTimer = 0;

    for (const ghost of ghosts) {
        if (!ghost.eaten) {
            ghost.frightened = false;
        }
    }


    setStatus(
        lives > 0
            ? "lifeLost"
            : "gameOver"
    );


    updateUI();
}


// ============================================================
// UPDATE
// ============================================================

function update(dt) {

    if (deathTimer > 0) {

        deathTimer -= dt;


        if (
            deathTimer <= 0 &&
            lives > 0
        ) {

            resetPositions();


            setStatus("continue");
        }


        return;
    }


    if (!running)
        return;

    gameTime += dt;


    if (frightenedTimer > 0) {

        frightenedTimer -= dt;


        if (
            frightenedTimer <= 0
        ) {

            frightenedTimer = 0;


            for (
                const ghost of ghosts
            ) {

                if (!ghost.eaten)
                    ghost.frightened = false;
            }
        }
    }


    updatePlayer(dt);


    for (
        const ghost of ghosts
    ) {

        updateGhost(
            ghost,
            dt
        );
    }

    const pendingGhosts = ghosts
        .filter(ghost => ghost.needsDirection)
        .sort((a, b) =>
            a.pendingDecisionTime - b.pendingDecisionTime
        );
    const decisionGroups = [];

    for (const ghost of pendingGhosts) {
        const lastGroup = decisionGroups[decisionGroups.length - 1];

        if (
            lastGroup &&
            Math.abs(
                ghost.pendingDecisionTime -
                lastGroup.time
            ) <= SEARCH_EPSILON
        ) {
            lastGroup.ghosts.push(ghost);
        } else {
            decisionGroups.push({
                time: ghost.pendingDecisionTime,
                ghosts: [ghost]
            });
        }
    }

    for (const group of decisionGroups) {
        const directions =
            chooseStrategicGhostDirections(group.ghosts);

        for (const ghost of group.ghosts) {
            ghost.direction = directions.get(ghost);
            ghost.needsDirection = false;
            ghost.px =
                ghost.x +
                ghost.direction.x *
                ghost.progress;
            ghost.py =
                ghost.y +
                ghost.direction.y *
                ghost.progress;
        }
    }


    checkGhostCollisions();
}


// ============================================================
// RESET POSITIONS
// ============================================================

function resetPositions() {

    const mapDefinition = getCurrentMapDefinition();
    const playerStart = mapDefinition.playerStart;

    player.x = playerStart.x;
    player.y = playerStart.y;

    player.px = playerStart.x;
    player.py = playerStart.y;

    player.progress = 0;


    player.direction = {
        x: 0,
        y: 0
    };


    player.nextDirection = {
        x: 0,
        y: 0
    };


    const ghostStarts = mapDefinition.ghostStarts;

    ghosts.forEach((ghost, index) => {
        const start = ghostStarts[index];

        ghost.x = start.x;
        ghost.y = start.y;
        ghost.px = start.x;
        ghost.py = start.y;
        ghost.direction = { ...start.direction };
        ghost.nextDirection = { ...start.direction };
        ghost.progress = 0;
        ghost.needsDirection = false;
        ghost.eaten = false;
        ghost.frightened = false;
    });
}


// ============================================================
// RENDER
// ============================================================

function draw() {

    ctx.fillStyle =
        "#090b12";


    ctx.fillRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    drawVoronoiDomains();


    for (
        let y = 0;
        y < ROWS;
        y++
    ) {

        for (
            let x = 0;
            x < COLS;
            x++
        ) {

            const cell =
                MAP[y][x];


            const px =
                x * CELL;

            const py =
                y * CELL;


            if (cell === "#") {

                ctx.fillStyle =
                    "#3156a3";


                ctx.fillRect(
                    px + 2,
                    py + 2,
                    CELL - 4,
                    CELL - 4
                );
            }


            if (
                cell === "." ||
                cell === "o"
            ) {

                ctx.fillStyle =
                    "#f4e7b5";


                ctx.beginPath();


                ctx.arc(
                    px + CELL / 2,
                    py + CELL / 2,
                    cell === "o"
                        ? 5
                        : 2.5,
                    0,
                    Math.PI * 2
                );


                ctx.fill();
            }
        }
    }

    if (editorMode) {
        drawMapEditorGrid();
    }

    drawBoundaryWalls();
    drawGhostHouses();

    drawPlayer();

    for (
        let i = 0;
        i < ghosts.length;
        i++
    ) {

        drawGhost(
            ghosts[i],
            i
        );
    }
}


function drawBoundaryWalls() {
    ctx.fillStyle = editorMode ? "#9dbdff" : "#3156a3";

    for (const edgeKey of MAP_EDGES) {
        const [orientation, rawX, rawY] = edgeKey.split(":");
        const x = Number(rawX);
        const y = Number(rawY);
        const thickness = editorMode ? 5 : 4;

        if (orientation === "h") {
            const edgeX = (x + 1) * CELL - thickness / 2;
            const edgeY = y * CELL;
            ctx.fillRect(edgeX, edgeY, thickness, CELL);

            if (x === COLS - 1) {
                ctx.fillRect(-thickness / 2, edgeY, thickness, CELL);
            }
        } else {
            const edgeX = x * CELL;
            const edgeY = (y + 1) * CELL - thickness / 2;
            ctx.fillRect(edgeX, edgeY, CELL, thickness);

            if (y === ROWS - 1) {
                ctx.fillRect(edgeX, -thickness / 2, CELL, thickness);
            }
        }
    }
}


function drawGhostHouses() {
    for (const house of GHOST_HOUSES) {
        const centerX = house.x * CELL + CELL / 2;
        const centerY = house.y * CELL + CELL / 2;

        ctx.fillStyle = "#8b5cf6";
        ctx.strokeStyle = "#e9d5ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(centerX - 9, centerY - 1);
        ctx.lineTo(centerX, centerY - 9);
        ctx.lineTo(centerX + 9, centerY - 1);
        ctx.lineTo(centerX + 7, centerY - 1);
        ctx.lineTo(centerX + 7, centerY + 8);
        ctx.lineTo(centerX - 7, centerY + 8);
        ctx.lineTo(centerX - 7, centerY - 1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#090b12";
        ctx.fillRect(centerX - 2, centerY + 2, 4, 6);
    }
}


function drawMapEditorGrid() {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 1;

    for (let x = 0; x <= COLS; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CELL + 0.5, 0);
        ctx.lineTo(x * CELL + 0.5, ROWS * CELL);
        ctx.stroke();
    }

    for (let y = 0; y <= ROWS; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CELL + 0.5);
        ctx.lineTo(COLS * CELL, y * CELL + 0.5);
        ctx.stroke();
    }
}


function drawPlayer() {

    const cx =
        player.px * CELL +
        CELL / 2;


    const cy =
        player.py * CELL +
        CELL / 2;


    const facingDirection = player.facingDirection || player.direction;
    let angle = 0;


    if (
        facingDirection.x === -1
    ) {
        angle = Math.PI;
    }


    if (
        facingDirection.y === -1
    ) {
        angle = -Math.PI / 2;
    }


    if (
        facingDirection.y === 1
    ) {
        angle = Math.PI / 2;
    }


    const mouth =
        0.20 +
        Math.abs(
            Math.sin(
                performance.now() / 90
            )
        ) * 0.20;


    ctx.fillStyle =
        "#ffd43b";


    ctx.beginPath();


    ctx.moveTo(
        cx,
        cy
    );


    ctx.arc(
        cx,
        cy,
        11,
        angle + mouth,
        angle +
        Math.PI * 2 -
        mouth
    );


    ctx.closePath();

    ctx.fill();
}


function drawGhost(
    ghost,
    index
) {

    const cx =
        ghost.px * CELL +
        CELL / 2;


    const cy =
        ghost.py * CELL +
        CELL / 2;


    const colors = [
        "#e05252",
        "#e99b35",
        "#d66ad9"
    ];


    if (ghost.eaten) {

        drawGhostEyes(
            ghost,
            cx,
            cy
        );

        return;
    }


    if (ghost.frightened) {

        const blinking =
            frightenedTimer <= FRIGHTENED_BLINK_TIME &&
            Math.floor(gameTime * FRIGHTENED_BLINK_FREQUENCY) % 2 === 0;

        ctx.fillStyle = blinking
            ? colors[index % colors.length]
            : "#3159d6";

    }

    else {

        ctx.fillStyle =
            colors[
            index %
            colors.length
            ];
    }


    ctx.beginPath();


    ctx.arc(
        cx,
        cy - 2,
        10,
        Math.PI,
        0
    );


    ctx.lineTo(
        cx + 10,
        cy + 10
    );


    ctx.lineTo(
        cx + 5,
        cy + 6
    );


    ctx.lineTo(
        cx,
        cy + 10
    );


    ctx.lineTo(
        cx - 5,
        cy + 6
    );


    ctx.lineTo(
        cx - 10,
        cy + 10
    );


    ctx.closePath();

    ctx.fill();


    drawGhostEyes(
        ghost,
        cx,
        cy
    );
}


function drawGhostEyes(
    ghost,
    cx,
    cy
) {

    ctx.fillStyle =
        "white";


    ctx.beginPath();


    ctx.arc(
        cx - 4,
        cy - 3,
        3,
        0,
        Math.PI * 2
    );


    ctx.arc(
        cx + 4,
        cy - 3,
        3,
        0,
        Math.PI * 2
    );


    ctx.fill();


    ctx.fillStyle =
        "#263b78";


    ctx.beginPath();


    ctx.arc(
        cx - 4 +
        ghost.direction.x,
        cy - 3 +
        ghost.direction.y,
        1.5,
        0,
        Math.PI * 2
    );


    ctx.arc(
        cx + 4 +
        ghost.direction.x,
        cy - 3 +
        ghost.direction.y,
        1.5,
        0,
        Math.PI * 2
    );


    ctx.fill();
}


// ============================================================
// CONTROLS
// ============================================================

const EDITOR_DIRECTIONS = [
    DIRECTIONS.right,
    DIRECTIONS.down,
    DIRECTIONS.left,
    DIRECTIONS.up
];


function enterMapEditor() {
    editorDraftMap = cloneMapDefinition(
        maps.find(map => map.id === activeMapId) || maps[0]
    );
    editorMode = true;
    editorGesture = null;
    resetGame();
    document.body.classList.add("map-editor-active");
    editorToolbarElement.hidden = false;
    startScreenElement.hidden = true;
    setMapEditorInstructions();
}


function createNewMap() {
    const sourceMap = editorDraftMap || getCurrentMapDefinition();

    editorDraftMap = cloneMapDefinition(sourceMap);
    editorDraftMap.id = `custom-${nextCustomMapNumber}`;
    editorDraftMap.nameKey = null;
    editorDraftMap.customNumber = nextCustomMapNumber++;
    resetGame();
    setMapEditorInstructions();
}


function leaveMapEditor(saveChanges) {
    if (saveChanges) {
        editorDraftMap.tiles = MAP.map(row => row.slice());
        editorDraftMap.edges = Array.from(MAP_EDGES);
        editorDraftMap.playerStart = {
            x: player.x,
            y: player.y,
            direction: { ...player.facingDirection }
        };
        editorDraftMap.ghostStarts = ghosts.map(ghost => ({
            x: ghost.x,
            y: ghost.y,
            direction: { ...ghost.direction }
        }));
        editorDraftMap.ghostHouses = GHOST_HOUSES.map(cloneMapPosition);
        saveEditorMap();
    }

    editorDraftMap = null;
    editorMode = false;
    editorGesture = null;
    document.body.classList.remove("map-editor-active");
    editorToolbarElement.hidden = true;
    resetGame();
    startScreenElement.hidden = false;
}


function getEditorPosition(event) {
    const bounds = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - bounds.left) * COLS / bounds.width);
    const y = Math.floor((event.clientY - bounds.top) * ROWS / bounds.height);

    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) {
        return null;
    }

    return { x, y };
}


function getEditorBoundary(event) {
    const bounds = canvas.getBoundingClientRect();
    const gridX = (event.clientX - bounds.left) * COLS / bounds.width;
    const gridY = (event.clientY - bounds.top) * ROWS / bounds.height;
    const verticalLine = Math.round(gridX);
    const horizontalLine = Math.round(gridY);
    const verticalDistance = Math.abs(gridX - verticalLine);
    const horizontalDistance = Math.abs(gridY - horizontalLine);
    const edgeTolerance = 0.22;

    if (
        Math.min(verticalDistance, horizontalDistance) > edgeTolerance
    ) {
        return null;
    }

    if (verticalDistance <= horizontalDistance) {
        const y = Math.floor(gridY);
        const x = wrap(verticalLine - 1, COLS);
        const direction = DIRECTIONS.right;

        return {
            key: getBoundaryKey(x, y, direction),
            x,
            y,
            direction
        };
    }

    const x = Math.floor(gridX);
    const y = wrap(horizontalLine - 1, ROWS);
    const direction = DIRECTIONS.down;

    return {
        key: getBoundaryKey(x, y, direction),
        x,
        y,
        direction
    };
}


function toggleEditorBoundary(boundary) {
    const next = getWrappedPosition(
        boundary.x + boundary.direction.x,
        boundary.y + boundary.direction.y
    );

    if (
        isWall(boundary.x, boundary.y) ||
        isWall(next.x, next.y)
    ) {
        return;
    }

    if (MAP_EDGES.has(boundary.key)) {
        MAP_EDGES.delete(boundary.key);
    } else {
        MAP_EDGES.add(boundary.key);
    }

    buildGraph();
}


function getEditorEntity(position) {
    if (player.x === position.x && player.y === position.y) {
        return { type: "player", entity: player };
    }

    const ghostIndex = ghosts.findIndex(ghost =>
        ghost.x === position.x && ghost.y === position.y
    );

    return ghostIndex < 0
        ? null
        : { type: "ghost", index: ghostIndex, entity: ghosts[ghostIndex] };
}


function getEditorGhostHouse(position) {
    return GHOST_HOUSES.findIndex(house =>
        house.x === position.x && house.y === position.y
    );
}


function rotateEditorEntity(entity, type) {
    const currentIndex = EDITOR_DIRECTIONS.findIndex(direction =>
        direction.x === entity.direction.x &&
        direction.y === entity.direction.y
    );
    const direction = EDITOR_DIRECTIONS[(currentIndex + 1) % EDITOR_DIRECTIONS.length];

    entity.direction = { ...direction };
    entity.nextDirection = { ...direction };

    if (type === "player") {
        entity.facingDirection = { ...direction };
    }
}


function moveEditorEntity(gesture, position) {
    const { x, y } = position;

    if (
        MAP[y][x] === "#" ||
        getEditorGhostHouse(position) >= 0
    ) {
        return false;
    }

    if (
        gesture.type !== "player" &&
        player.x === x && player.y === y
    ) {
        return false;
    }

    if (ghosts.some((ghost, index) =>
        ghost.x === x &&
        ghost.y === y &&
        !(gesture.type === "ghost" && index === gesture.index)
    )) {
        return false;
    }

    const entity = gesture.entity;
    entity.x = x;
    entity.y = y;
    entity.px = x;
    entity.py = y;
    entity.progress = 0;

    if (gesture.type === "player") {
        entity.nextDirection = { ...entity.direction };
    } else {
        entity.needsDirection = false;
    }

    return true;
}


function cycleEditorTile(position) {
    const houseIndex = getEditorGhostHouse(position);
    const cycle = [".", "o", " ", "house", "#"];
    const currentTile = houseIndex >= 0
        ? "house"
        : MAP[position.y][position.x];
    const currentIndex = cycle.indexOf(currentTile);
    const nextTile = cycle[(currentIndex + 1) % cycle.length];

    if (
        houseIndex >= 0 &&
        nextTile !== "house" &&
        GHOST_HOUSES.length <= 1
    ) {
        return;
    }

    if (houseIndex >= 0) {
        GHOST_HOUSES.splice(houseIndex, 1);
    }

    if (nextTile === "house") {
        GHOST_HOUSES.push({ x: position.x, y: position.y });
    } else {
        const tile = nextTile;
        const row = MAP[position.y];

        MAP[position.y] =
            row.slice(0, position.x) +
            tile +
            row.slice(position.x + 1);

        if (nextTile === "#") {
            for (const direction of Object.values(DIRECTIONS)) {
                MAP_EDGES.delete(
                    getBoundaryKey(position.x, position.y, direction)
                );
            }
        }
    }

    pellets = MAP.reduce((total, row) =>
        total + Array.from(row).filter(cell => cell === "." || cell === "o").length,
    0);
    buildGraph();
}


canvas.addEventListener("pointerdown", event => {
    if (!editorMode) {
        return;
    }

    const position = getEditorPosition(event);
    if (!position) {
        return;
    }

    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const boundary = getEditorBoundary(event);
    const selected = getEditorEntity(position);

    editorGesture = boundary
        ? { type: "boundary", edge: boundary, start: position, moved: false }
        : selected
            ? { ...selected, start: position, moved: false }
            : { type: "tile", start: position, moved: false };
});


canvas.addEventListener("pointermove", event => {
    if (
        !editorMode ||
        !editorGesture ||
        (editorGesture.type !== "player" && editorGesture.type !== "ghost")
    ) {
        return;
    }

    const position = getEditorPosition(event);
    if (!position) {
        return;
    }

    if (position.x !== editorGesture.start.x || position.y !== editorGesture.start.y) {
        editorGesture.moved = moveEditorEntity(editorGesture, position) || editorGesture.moved;
    }
});


canvas.addEventListener("pointerup", event => {
    if (!editorMode || !editorGesture) {
        return;
    }

    const gesture = editorGesture;
    editorGesture = null;

    if (gesture.type === "boundary") {
        const boundary = getEditorBoundary(event);

        if (boundary && boundary.key === gesture.edge.key) {
            toggleEditorBoundary(boundary);
        }
        return;
    }

    const position = getEditorPosition(event);

    if (!position) {
        return;
    }

    if (gesture.type === "tile") {
        if (position.x === gesture.start.x && position.y === gesture.start.y) {
            cycleEditorTile(position);
        }
        return;
    }

    if (!gesture.moved && position.x === gesture.start.x && position.y === gesture.start.y) {
        rotateEditorEntity(gesture.entity, gesture.type);
    } else if (!gesture.moved) {
        moveEditorEntity(gesture, position);
    }
});


canvas.addEventListener("pointercancel", () => {
    editorGesture = null;
});


document.getElementById("edit-map").addEventListener("click", enterMapEditor);
newMapButton.addEventListener("click", createNewMap);
editorBackButton.addEventListener("click", () => leaveMapEditor(false));
editorSaveButton.addEventListener("click", () => leaveMapEditor(true));
mapSelectElement.addEventListener("change", () => {
    activeMapId = mapSelectElement.value;
    resetGame();
});


function getControlledGhost() {
    if (!selectedCharacter.startsWith("ghost-")) {
        return null;
    }

    return ghosts[Number(selectedCharacter.slice("ghost-".length))] || null;
}


function updatePressedDirectionButtons() {
    const keys = {
        ArrowUp: "up",
        w: "up",
        ArrowDown: "down",
        s: "down",
        ArrowLeft: "left",
        a: "left",
        ArrowRight: "right",
        d: "right"
    };
    const pressedDirections = new Set(
        Array.from(pressedDirectionKeys, key => keys[key])
    );

    document.querySelectorAll("[data-dir]").forEach(button => {
        button.classList.toggle(
            "is-key-pressed",
            pressedDirections.has(button.dataset.dir)
        );
    });
}


function setDirection(
    direction
) {

    if (editorMode) {
        return;
    }

    const controlledGhost = getControlledGhost();

    if (controlledGhost) {
        controlledGhost.nextDirection = { ...direction };
    } else {
        player.nextDirection = { ...direction };
    }

    if (
        !running &&
        deathTimer <= 0 &&
        lives > 0
    ) {

        running = true;

        statusElement.textContent = "";

        if (controlledGhost) {
            if (canMove(controlledGhost.x, controlledGhost.y, direction)) {
                controlledGhost.direction = { ...direction };
            }

            player.nextDirection =
                chooseStrategicPacmanDirection();
            tryChangeDirection();
        } else {
            tryChangeDirection();
        }
    }
}


document
    .querySelectorAll("[data-character]")
    .forEach(button => {
        button.addEventListener("click", () => {
            selectedCharacter = button.dataset.character;
            resetGame();
            startScreenElement.hidden = true;
        });
    });


document.addEventListener(
    "keydown",
    event => {
        if (editorMode) {
            if (event.key === "Escape") {
                leaveMapEditor(false);
            }
            return;
        }

        if (gameWon) {
            return;
        }

        if (event.key.toLowerCase() === "v") {
            showVoronoi = !showVoronoi;
            return;
        }

        if (!startScreenElement.hidden) {
            return;
        }

        const keys = {

            ArrowUp:
                DIRECTIONS.up,

            w:
                DIRECTIONS.up,


            ArrowDown:
                DIRECTIONS.down,

            s:
                DIRECTIONS.down,


            ArrowLeft:
                DIRECTIONS.left,

            a:
                DIRECTIONS.left,


            ArrowRight:
                DIRECTIONS.right,

            d:
                DIRECTIONS.right
        };


        const direction =
            keys[event.key] ||
            keys[
            event.key.toLowerCase()
            ];


        if (!direction)
            return;


        event.preventDefault();

        pressedDirectionKeys.add(event.key.length === 1
            ? event.key.toLowerCase()
            : event.key);
        updatePressedDirectionButtons();

        setDirection(
            direction
        );
    }
);


document.addEventListener("keyup", event => {
    const key = event.key.length === 1
        ? event.key.toLowerCase()
        : event.key;

    if (pressedDirectionKeys.delete(key)) {
        updatePressedDirectionButtons();
    }
});


window.addEventListener("blur", () => {
    pressedDirectionKeys.clear();
    updatePressedDirectionButtons();
});


document
    .querySelectorAll(
        "[data-dir]"
    )
    .forEach(button => {

        button.addEventListener("pointerdown", () => {
            button.classList.add("is-pointer-pressed");
        });

        button.addEventListener(
            "click",
            () => {

                setDirection(
                    DIRECTIONS[
                    button.dataset.dir
                    ]
                );
            }
        );
    });


document.addEventListener("pointerup", () => {
    document.querySelectorAll(".is-pointer-pressed").forEach(button => {
        button.classList.remove("is-pointer-pressed");
    });
});


document.addEventListener("pointercancel", () => {
    document.querySelectorAll(".is-pointer-pressed").forEach(button => {
        button.classList.remove("is-pointer-pressed");
    });
});


document
    .getElementById("restart")
    .addEventListener(
        "click",
        () => {
            if (editorMode) {
                leaveMapEditor(false);
            } else {
                resetGame();
                startScreenElement.hidden = false;
            }
        }
    );


// ============================================================
// UI
// ============================================================

function updateUI() {

    scoreElement.textContent =
        score;

    livesElement.textContent =
        lives;
}


// ============================================================
// GAME LOOP
// ============================================================

function gameLoop(time) {

    const dt =
        Math.min(
            (time - currentTime) / 1000,
            0.05
        );


    currentTime = time;


    update(dt);

    if (running) {
        advanceStrategicSearch();
    }

    draw();


    requestAnimationFrame(
        gameLoop
    );
}


updateMapSelector();
resetGame();

requestAnimationFrame(
    gameLoop
);
