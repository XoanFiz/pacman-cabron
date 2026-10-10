const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const scoreElement = document.getElementById("score");
const livesElement = document.getElementById("lives");
const statusElement = document.getElementById("status");
const startScreenElement = document.getElementById("start-screen");

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


// ============================================================
// STATE
// ============================================================

let score;
let lives;
let pellets;

let player;
let ghosts;
let selectedCharacter = "pacman";

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


// ============================================================
// GHOST AI
// ============================================================

const PACMAN_SPEED = 3.5;
const GHOST_SPEED = 2.25;
const EATEN_GHOST_SPEED = 4;

const HOUSE = {
    x: 10,
    y: 8
};


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


function canMove(x, y, direction) {

    const next = getWrappedPosition(
        x + direction.x,
        y + direction.y
    );

    return !isWall(next.x, next.y);
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


                if (!isWall(next.x, next.y)) {

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

        if (ghost.eaten) {
            // Eaten ghosts only begin claiming territory after reaching the house.
            const distanceToHouse = shortestDistance(
                ghost.x,
                ghost.y,
                HOUSE.x,
                HOUSE.y
            );

            if (distanceToHouse === Infinity) {
                continue;
            }

            queue.push({
                x: HOUSE.x,
                y: HOUSE.y,
                time: gameTime + distanceToHouse / EATEN_GHOST_SPEED,
                owner,
                speed: GHOST_SPEED
            });
            continue;
        }

        queue.push({
            x: ghost.x,
            y: ghost.y,
            time: gameTime,
            owner,
            speed: GHOST_SPEED,
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
            .filter(({ ghost }) =>
                ghost.frightened &&
                !ghost.eaten
            );


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
                            ghosts[index].frightened &&
                            !ghosts[index].eaten
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
                ghosts[index].frightened &&
                !ghosts[index].eaten
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

    return state.map[y][x] !== "#";
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

    if (ghost.eaten) {
        return [
            getShortestPathDirection(
                ghost.x,
                ghost.y,
                HOUSE.x,
                HOUSE.y
            ) || { ...ghost.direction }
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
            ghost.x === HOUSE.x &&
            ghost.y === HOUSE.y
        ) {
            ghost.eaten = false;
            ghost.frightened = false;
            ghost.direction = { x: -1, y: 0 };
            next.readyGhosts[i] = false;
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

function getShortestPathDirection(startX, startY, targetX, targetY) {
    const start = getWrappedPosition(startX, startY);
    const target = getWrappedPosition(targetX, targetY);

    if (start.x === target.x && start.y === target.y) {
        return null;
    }

    const queue = [{
        x: start.x,
        y: start.y,
        firstDirection: null
    }];

    const visited = new Set();

    const key = (x, y) => `${x},${y}`;
    visited.add(key(start.x, start.y));

    const directions = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 }
    ];

    let index = 0;

    while (index < queue.length) {
        const current = queue[index++];

        for (const direction of directions) {
            const next = getWrappedPosition(
                current.x + direction.x,
                current.y + direction.y
            );

            if (isWall(next.x, next.y)) {
                continue;
            }

            const nextKey = key(next.x, next.y);

            if (visited.has(nextKey)) {
                continue;
            }

            const firstDirection =
                current.firstDirection ?? direction;

            if (next.x === target.x && next.y === target.y) {
                return firstDirection;
            }

            visited.add(nextKey);

            queue.push({
                x: next.x,
                y: next.y,
                firstDirection
            });
        }
    }

    return null;
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
    MAP =
        LEVEL_MAP.map(
            row =>
                row.slice(0, COLS)
        );


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


    player = {

        x: 10,
        y: 10,

        px: 10,
        py: 10,

        direction: {
            x: 0,
            y: 0
        },

        nextDirection: {
            x: 0,
            y: 0
        },

        progress: 0
    };


    ghosts = [

        {
            x: 9,
            y: 8,

            px: 9,
            py: 8,

            direction: {
                x: 1,
                y: 0
            },
            nextDirection: {
                x: 1,
                y: 0
            },

            frightened: false,
            eaten: false,
            progress: 0
        },


        {
            x: 10,
            y: 8,

            px: 10,
            py: 8,

            direction: {
                x: -1,
                y: 0
            },
            nextDirection: {
                x: -1,
                y: 0
            },

            frightened: false,
            eaten: false,
            progress: 0
        },


        {
            x: 11,
            y: 10,

            px: 11,
            py: 10,

            direction: {
                x: -1,
                y: 0
            },
            nextDirection: {
                x: -1,
                y: 0
            },

            frightened: false,
            eaten: false,
            progress: 0
        }
    ];


    running = false;
    deathTimer = 0;
    frightenedTimer = 0;


    buildGraph();


    statusElement.textContent =
        selectedCharacter === "pacman"
            ? "Press an arrow key to start as Pac-Man"
            : "Press an arrow key to start as a ghost";
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

            player.direction = {
                ...player.nextDirection
            };
        }


        if (
            !canMove(
                player.x,
                player.y,
                player.direction
            )
        ) {

            player.direction = {
                x: 0,
                y: 0
            };

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


function tryChangeDirection() {

    if (
        canMove(
            player.x,
            player.y,
            player.nextDirection
        )
    ) {

        player.direction = {
            ...player.nextDirection
        };
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
        statusElement.textContent =
            "🎉 You won!";
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


        // ====================================================
        // EATEN
        // ====================================================

        if (ghost.eaten) {

            const target = HOUSE;

            possibleDirections.sort(
                (a, b) => {

                    const nextAX =
                        wrap(
                            ghost.x + a.x,
                            COLS
                        );

                    const nextAY =
                        wrap(
                            ghost.y + a.y,
                            ROWS
                        );

                    const nextBX =
                        wrap(
                            ghost.x + b.x,
                            COLS
                        );

                    const nextBY =
                        wrap(
                            ghost.y + b.y,
                            ROWS
                        );


                    const da =
                        shortestDistance(
                            nextAX,
                            nextAY,
                            target.x,
                            target.y
                        );


                    const db =
                        shortestDistance(
                            nextBX,
                            nextBY,
                            target.x,
                            target.y
                        );


                    return da - db;
                }
            );


            ghost.direction = {
                ...possibleDirections[0]
            };


            if (
                ghost.x === HOUSE.x &&
                ghost.y === HOUSE.y
            ) {

                ghost.eaten = false;

                ghost.frightened = false;

                ghost.direction = {
                    x: -1,
                    y: 0
                };
            }


            continue;
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
                ghost.progress / GHOST_SPEED;
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


    statusElement.textContent =
        lives > 0
            ? "Pac-Man lost a life"
            : "Game over";


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


            statusElement.textContent =
                "Press an arrow key to continue";
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
        .filter(ghost => ghost.needsDirection && !ghost.eaten)
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

    player.x = 10;
    player.y = 10;

    player.px = 10;
    player.py = 10;

    player.progress = 0;


    player.direction = {
        x: 0,
        y: 0
    };


    player.nextDirection = {
        x: 0,
        y: 0
    };


    ghosts[0].x = 9;
    ghosts[0].y = 8;

    ghosts[0].px = 9;
    ghosts[0].py = 8;

    ghosts[0].progress = 0;
    ghosts[0].needsDirection = false;


    ghosts[1].x = 10;
    ghosts[1].y = 8;

    ghosts[1].px = 10;
    ghosts[1].py = 8;

    ghosts[1].progress = 0;
    ghosts[1].needsDirection = false;


    ghosts[2].x = 11;
    ghosts[2].y = 10;

    ghosts[2].px = 11;
    ghosts[2].py = 10;

    ghosts[2].progress = 0;
    ghosts[2].needsDirection = false;
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


function drawPlayer() {

    const cx =
        player.px * CELL +
        CELL / 2;


    const cy =
        player.py * CELL +
        CELL / 2;


    let angle = 0;


    if (
        player.direction.x === -1
    ) {
        angle = Math.PI;
    }


    if (
        player.direction.y === -1
    ) {
        angle = -Math.PI / 2;
    }


    if (
        player.direction.y === 1
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

function getControlledGhost() {
    if (!selectedCharacter.startsWith("ghost-")) {
        return null;
    }

    return ghosts[Number(selectedCharacter.slice("ghost-".length))] || null;
}


function setDirection(
    direction
) {

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


        setDirection(
            direction
        );
    }
);


document
    .querySelectorAll(
        "[data-dir]"
    )
    .forEach(button => {

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


document
    .getElementById("restart")
    .addEventListener(
        "click",
        () => {
            resetGame();
            startScreenElement.hidden = false;
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


resetGame();

requestAnimationFrame(
    gameLoop
);