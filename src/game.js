const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const scoreElement = document.getElementById("score");
const livesElement = document.getElementById("lives");
const statusElement = document.getElementById("status");

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

let running = false;
let gameWon = false;
let deathTimer = 0;
let lastTime = 0;

let frightenedTimer = 0;

const FRIGHTENED_DURATION = 7;

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


// Pesos estratéxicos.
// De momento iguais; poderemos axustalos despois.
const WEIGHT_NORMAL = 1;
const WEIGHT_PELLET = 1;
const WEIGHT_BLUE = 1;


// Valor total reservado para todos os pellets restantes.
// O valor individual é TOTAL / pellets restantes.
const TOTAL_PELLET_VALUE = 1000;

const EPSILON = 1e-9;


// Grafo estático do mapa.
let graph = null;


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
                        y: next.y
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
        time: 0,
        owner: "pacman",
        speed: PACMAN_SPEED
    });


    // --------------------------------------------------------
    // GHOSTS
    // --------------------------------------------------------

    for (let i = 0; i < ghosts.length; i++) {

        const ghost = ghosts[i];

        let x = ghost.x;
        let y = ghost.y;
        let speed = GHOST_SPEED;
        let owner = `ghost${i}`;

        if (ghost.eaten) {

            speed = EATEN_GHOST_SPEED;
            owner = `eatenGhost${i}`;

            if (ghost.x !== HOUSE.x && ghost.y !== HOUSE.y) {
                speed = GHOST_SPEED;
                owner = `ghost${i}`
            }
        }


        queue.push({
            x,
            y,
            time: 0,
            owner,
            speed
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


        // Check if power determines a successful domain even if it is later 
        if (!checkAndUpdateImprovedDomain(assessedDomainCell,
            currentDomainCell)
        ) {
            // No power difference 
            if (
                assessedDomainCell.time >
                currentDomainCell.arrival + EPSILON
            ) {
                // This arrival is worse by any meaning. No meaningful power difference and later time. Don't propagate
                continue;
            } else if (
                assessedDomainCell.time <
                currentDomainCell.arrival - EPSILON
            ) /* First arrival */ {

                currentDomainCell.arrival =
                    assessedDomainCell.time;

                currentDomainCell.owners = [
                    assessedDomainCell.owner
                ];
            } else if (
                Math.abs(
                    assessedDomainCell.time -
                    currentDomainCell.arrival
                ) <= EPSILON
            ) /* Draw */ {
                if (
                    !currentDomainCell.owners.includes(
                        assessedDomainCell.owner
                    )
                ) {

                    currentDomainCell.owners.push(
                        assessedDomainCell.owner
                    );
                }
            }
        }

        // A pill can set a prioritary domain for Pacman
        if (MAP[assessedDomainCell.y][assessedDomainCell.x] == "o" && !currentDomainCell.eatenPillTime) {
            if (assessedDomainCell.owner == "pacman") {

                assessedDomainCell.eatenPillTime = assessedDomainCell.time;
                currentDomainCell.arrival =
                    assessedDomainCell.time;

                const newQueue = new MinHeap();

                for (const domainCell of queue.items) {
                    if (domainCell.owner.startsWith("ghost")) {
                        newQueue.items.push({
                            ...domainCell,
                            owner: domainCell.owner = `blue${String(domainCell.owner).charAt(0).toUpperCase() + String(domainCell.owner).slice(1)}`,
                            time: assessedDomainCell.time,
                        });
                    } else {
                        newQueue.items.push(domainCell);
                    }
                }

                queue = newQueue;
            }
        }


        /*
         * We spread the wave.
         */
        for (
            const next of
            graph[assessedDomainCell.y][assessedDomainCell.x]
        ) {

            const nextTime =
                assessedDomainCell.time +
                1 / assessedDomainCell.speed;


            const nextCell =
                domain[
                next.y
                ][
                next.x
                ];


            /*
             * We only want to propagate if we can
             * improve the domain.
             */
            if (!checkAndUpdateImprovedDomain({
                ...assessedDomainCell,
                time: nextTime
            }, nextCell)) {
                // No power difference 

                if (nextTime >
                    nextCell.arrival +
                    EPSILON) {
                    continue;
                }
            }

            queue.push({
                x: next.x,
                y: next.y,
                time: nextTime,
                owner: assessedDomainCell.owner,
                speed: assessedDomainCell.speed
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
     * 1 = reparto perfecto
     * 1/n = todo concentrado nunha soa fantasma
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


// ============================================================
// GHOST MOVE EVALUATION
// ============================================================

function getPossibleGhostDirections(
    ghost
) {

    return [
        DIRECTIONS.up,
        DIRECTIONS.down,
        DIRECTIONS.left,
        DIRECTIONS.right
    ].filter(direction =>
        canMove(
            ghost.x,
            ghost.y,
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

function chooseNormalGhostDirection(ghost) {
    const possible =
        getPossibleGhostDirections(
            ghost
        );


    if (possible.length === 0) {

        return {
            x: 0,
            y: 0
        };
    }


    let bestDirection =
        possible[0];

    let bestScore =
        -Infinity;


    for (
        const direction of possible
    ) {

        /*
         * Facemos unha copia da fantasma
         * na seguinte casilla.
         */
        const testGhost = {
            ...ghost,

            x: wrap(
                ghost.x +
                direction.x,
                COLS
            ),

            y: wrap(
                ghost.y +
                direction.y,
                ROWS
            ),

            direction: {
                ...direction
            },

            progress: 0
        };


        /* 
        * We have temporarily replace the ghost. 
        */
        const oldGhosts =
            ghosts;


        ghosts =
            ghosts.map(
                current =>
                    current === ghost
                        ? testGhost
                        : current
            );


        const domain =
            calculateDomain();


        const evaluation =
            evaluateDomain(
                domain
            );


        ghosts =
            oldGhosts;


        if (
            evaluation.total >
            bestScore
        ) {

            bestScore =
                evaluation.total;

            bestDirection =
                direction;
        }
    }


    return {
        ...bestDirection
    };
}


function chooseGhostDirection(
    ghost
) {

    // Ghost eaten:
    // mandatory return home via the shortest route.
    if (ghost.eaten) {
        const direction = getShortestPathDirection(
            ghost.x,
            ghost.y,
            10,
            8
        );

        if (direction) {
            return direction;
        }

        return ghost.direction;
    }

    // This is the current behavior 
    // of the uneaten ghosts.
    return chooseNormalGhostDirection(ghost);
}


// ============================================================
// START / RESTART
// ============================================================

function resetGame() {

    score = 0;
    lives = 3;

    resetLevel();
    gameWon = false;

    updateUI();
}


function resetLevel() {

    pellets = 0;


    /*
     * Normalizamos as filas a COLS.
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
        "Press an arrow to start";
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
            getPossibleGhostDirections(
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

        ghost.direction =
            chooseGhostDirection(
                ghost
            );
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


        if (
            distance >= 0.55
        ) {
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


    statusElement.textContent =
        lives > 0
            ? "You lost a life"
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
                "Preme unha frecha para continuar";
        }


        return;
    }


    if (!running)
        return;


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


    ghosts[1].x = 10;
    ghosts[1].y = 8;

    ghosts[1].px = 10;
    ghosts[1].py = 8;

    ghosts[1].progress = 0;


    ghosts[2].x = 11;
    ghosts[2].y = 10;

    ghosts[2].px = 11;
    ghosts[2].py = 10;

    ghosts[2].progress = 0;
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

        ctx.fillStyle =
            "#3159d6";

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

function setDirection(
    direction
) {

    player.nextDirection = {
        ...direction
    };


    if (
        !running &&
        deathTimer <= 0 &&
        lives > 0
    ) {

        running = true;

        statusElement.textContent = "";

        tryChangeDirection();
    }
}


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
            (time - lastTime) / 1000,
            0.05
        );


    lastTime = time;


    update(dt);

    draw();


    requestAnimationFrame(
        gameLoop
    );
}


resetGame();

requestAnimationFrame(
    gameLoop
);