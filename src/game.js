

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const scoreElement = document.getElementById("score");
const livesElement = document.getElementById("lives");
const statusElement = document.getElementById("status");


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
    "#o..##........##..o#",
    "###.##.##.##.##.####",
    "#......#....#.......#",
    "#.####.#.##.#.####..#",
    "#..................#",
    "####################"
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
let deathTimer = 0;

let lastTime = 0;

let frightenedTimer = 0;

const FRIGHTENED_DURATION = 7; // seconds

let MAP;


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

//wrap(-1, 20)  // 19
//wrap(20, 20)  // 0
//wrap(21, 20)  // 1
function wrap(value, size) {
    return ((value % size) + size) % size;
}


// ============================================================
// START / RESTART
// ============================================================

function resetGame() {

    score = 0;
    lives = 3;

    resetLevel();

    updateUI();
}


function resetLevel() {

    pellets = 0;

    MAP = [...LEVEL_MAP];

    for (const row of MAP) {
        for (const cell of row) {
            if (cell === "." || cell === "o") {
                pellets++;
            }
        }
    }

    player = {
        x: 10,
        y: 10,

        // posición actual interpolada
        px: 10,
        py: 10,

        direction: { x: 0, y: 0 },
        nextDirection: { x: 0, y: 0 },

        progress: 0
    };


    ghosts = [
        {
            x: 9,
            y: 8,
            px: 9,
            py: 8,
            direction: { x: 1, y: 0 },
            frightened: false,
            eaten: false,
            progress: 0
        },

        {
            x: 10,
            y: 8,
            px: 10,
            py: 8,
            direction: { x: -1, y: 0 },
            frightened: false,
            eaten: false,
            progress: 0
        },

        {
            x: 11,
            y: 10,
            px: 11,
            py: 10,
            direction: { x: 0, y: -1 },
            frightened: false,
            eaten: false,
            progress: 0
        }
    ];

    running = false;
    deathTimer = 0;

    statusElement.textContent =
        "Press an arrow to start";

    frightenedTimer = 0;

}


// ============================================================
// PAC-MAN
// ============================================================

function updatePlayer(dt) {

    const speed = 7; // celas por segundo

    /*
     * A clave da corrección:
     *
     * O xogador sempre se move de centro a centro de cela.
     * Nunca comprobamos a parede mediante Math.round().
     *
     * Antes de iniciar o seguinte tramo comprobamos
     * explicitamente a cela de destino.
     */

    if (
        player.direction.x === 0 &&
        player.direction.y === 0
    ) {
        tryChangeDirection();
        return;
    }


    player.progress += speed * dt;


    while (player.progress >= 1) {

        player.progress -= 1;

        // We have reached the exact center of the next cell.
        player.x = wrap(
            player.x + player.direction.x,
            COLS
        );

        player.y = wrap(
            player.y + player.direction.y,
            ROWS
        );

        player.px = player.x;
        player.py = player.y;


        eatPellet();


        // Try to turn immediately at the intersection.
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


        // If we can't continue, we stop exactly 
        // in the center of the cell.
        if (
            !canMove(
                player.x,
                player.y,
                player.direction
            )
        ) {
            player.direction = { x: 0, y: 0 };
            break;
        }
    }


    player.px =
        player.x +
        player.direction.x * player.progress;

    player.py =
        player.y +
        player.direction.y * player.progress;
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

    const x = player.x;
    const y = player.y;

    if (x < 0 || x >= COLS || y < 0 || y >= ROWS)
        return;

    const cell = MAP[y][x];

    if (cell !== "." && cell !== "o")
        return;


    // We cannot modify MAP directly because it is a
    // string constant. We convert it locally.
    const row = MAP[y].split("");

    row[x] = " ";

    MAP[y] = row.join("");

    pellets--;

    if (cell === "o") {
        score += 50;
        activateFrightenedMode();
    }
    else
        score += 10;


    if (pellets === 0) {

        running = false;

        statusElement.textContent =
            "🎉 Gañaches!";
    }

    updateUI();
}

function activateFrightenedMode() {

    frightenedTimer = FRIGHTENED_DURATION;

    for (const ghost of ghosts) {

        if (ghost.eaten)
            continue;

        ghost.frightened = true;

        reverseGhostDirection(ghost);
    }
}

function reverseGhostDirection(ghost) {

    /*
     * Se o fantasma está no medio dun tramo,
     * cambiamos a cela de referencia ao extremo
     * oposto e invertimos progress.
     */
    if (ghost.progress > 0) {

        ghost.x += ghost.direction.x;
        ghost.y += ghost.direction.y;

        ghost.progress = 1 - ghost.progress;
    }

    ghost.direction.x *= -1;
    ghost.direction.y *= -1;
}


// ============================================================
// GHOSTS   
// ============================================================

function updateGhost(ghost, dt) {

    const speed = ghost.eaten ? 8 : 4.5;

    ghost.progress ??= 0;

    ghost.progress += speed * dt;


    while (ghost.progress >= 1) {

        ghost.progress -= 1;

        ghost.x = wrap(
            ghost.x + ghost.direction.x,
            COLS
        );

        ghost.y = wrap(
            ghost.y + ghost.direction.y,
            ROWS
        );


        const possible = [
            DIRECTIONS.up,
            DIRECTIONS.down,
            DIRECTIONS.left,
            DIRECTIONS.right
        ].filter(dir =>
            canMove(ghost.x, ghost.y, dir)
        );


        if (possible.length === 0) {
            ghost.direction = { x: 0, y: 0 };
            break;
        }


        // ====================================================
        // FANTASMA COMIDO
        // ====================================================

        if (ghost.eaten) {

            // Volve cara á "casa" dos fantasmas.
            const target = {
                x: 10,
                y: 8
            };

            possible.sort((a, b) => {

                const da =
                    Math.abs(
                        ghost.x + a.x - target.x
                    ) +
                    Math.abs(
                        ghost.y + a.y - target.y
                    );

                const db =
                    Math.abs(
                        ghost.x + b.x - target.x
                    ) +
                    Math.abs(
                        ghost.y + b.y - target.y
                    );

                return da - db;
            });

            ghost.direction = {
                ...possible[0]
            };

            if (
                ghost.eaten &&
                ghost.x === 10 &&
                ghost.y === 8
            ) {
                ghost.eaten = false;

                ghost.frightened =
                    frightenedTimer > 0;

                ghost.direction = {
                    x: -1,
                    y: 0
                };
            }

        }


        // ====================================================
        // MODO VULNERABLE
        // ====================================================

        else if (ghost.frightened) {

            /*
             * Non persegue Pac-Man.
             *
             * Escolla unha dirección aleatoria.
             *
             * Evitamos na medida do posible dar a volta
             * inmediatamente outra vez.
             */

            const reverse = {
                x: -ghost.direction.x,
                y: -ghost.direction.y
            };

            let choices = possible.filter(dir =>
                dir.x !== reverse.x ||
                dir.y !== reverse.y
            );

            if (choices.length === 0)
                choices = possible;


            ghost.direction = {
                ...choices[
                Math.floor(
                    Math.random() * choices.length
                )
                ]
            };
        }


        // ====================================================
        // NORMAL BEHAVIOUR
        // ====================================================

        else {

            /*
             * Chase Pac-Man like before.
             */

            possible.sort((a, b) => {

                const da =
                    Math.abs(
                        ghost.x + a.x - player.x
                    ) +
                    Math.abs(
                        ghost.y + a.y - player.y
                    );

                const db =
                    Math.abs(
                        ghost.x + b.x - player.x
                    ) +
                    Math.abs(
                        ghost.y + b.y - player.y
                    );

                return da - db;
            });


            if (Math.random() < 0.75) {

                ghost.direction = {
                    ...possible[0]
                };

            }
            else {

                ghost.direction = {
                    ...possible[
                    Math.floor(
                        Math.random() *
                        possible.length
                    )
                    ]
                };
            }
        }
    }


    ghost.px =
        ghost.x +
        ghost.direction.x * ghost.progress;

    ghost.py =
        ghost.y +
        ghost.direction.y * ghost.progress;
}


// ============================================================
// COLLISIONS
// ============================================================

function checkGhostCollisions() {

    for (const ghost of ghosts) {

        const dx = ghost.px - player.px;
        const dy = ghost.py - player.py;

        const distance =
            Math.sqrt(dx * dx + dy * dy);


        if (distance >= 0.55)
            continue;


        // Xa está comido: non pode facer nada.
        if (ghost.eaten)
            continue;


        // Fantasma vulnerable: Pac-Man come o fantasma.
        if (ghost.frightened) {

            eatGhost(ghost);
            continue;
        }


        // Fantasma normal: Pac-Man perde unha vida.
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
            ? "Perdiches unha vida"
            : "Fin da partida";

    updateUI();
}


// ============================================================
// UPDATE
// ============================================================

function update(dt) {

    if (deathTimer > 0) {

        deathTimer -= dt;

        if (deathTimer <= 0 && lives > 0) {
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

        if (frightenedTimer <= 0) {

            frightenedTimer = 0;

            for (const ghost of ghosts) {

                if (!ghost.eaten)
                    ghost.frightened = false;
            }
        }
    }

    updatePlayer(dt);

    for (const ghost of ghosts)
        updateGhost(ghost, dt);

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

    player.direction = { x: 0, y: 0 };
    player.nextDirection = { x: 0, y: 0 };


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

    ctx.fillStyle = "#090b12";
    ctx.fillRect(
        0,
        0,
        canvas.width,
        canvas.height
    );


    // walls and pills

    for (let y = 0; y < ROWS; y++) {

        for (let x = 0; x < COLS; x++) {

            const cell = MAP[y][x];

            const px = x * CELL;
            const py = y * CELL;


            if (cell === "#") {

                ctx.fillStyle = "#3156a3";

                ctx.fillRect(
                    px + 2,
                    py + 2,
                    CELL - 4,
                    CELL - 4
                );
            }


            if (cell === "." || cell === "o") {

                ctx.fillStyle = "#f4e7b5";

                ctx.beginPath();

                ctx.arc(
                    px + CELL / 2,
                    py + CELL / 2,
                    cell === "o" ? 5 : 2.5,
                    0,
                    Math.PI * 2
                );

                ctx.fill();
            }
        }
    }


    drawPlayer();

    for (let i = 0; i < ghosts.length; i++)
        drawGhost(ghosts[i], i);
}


function drawPlayer() {

    const cx =
        player.px * CELL +
        CELL / 2;

    const cy =
        player.py * CELL +
        CELL / 2;


    let angle = 0;

    if (player.direction.x === -1)
        angle = Math.PI;

    if (player.direction.y === -1)
        angle = -Math.PI / 2;

    if (player.direction.y === 1)
        angle = Math.PI / 2;


    const mouth =
        0.20 +
        Math.abs(
            Math.sin(performance.now() / 90)
        ) * 0.20;


    ctx.fillStyle = "#ffd43b";

    ctx.beginPath();

    ctx.moveTo(cx, cy);

    ctx.arc(
        cx,
        cy,
        11,
        angle + mouth,
        angle + Math.PI * 2 - mouth
    );

    ctx.closePath();

    ctx.fill();
}


function drawGhost(ghost, index) {

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


    // ========================================================
    // FANTASMA COMIDO: só ollos
    // ========================================================

    if (ghost.eaten) {

        drawGhostEyes(ghost, cx, cy);

        return;
    }


    // ========================================================
    // BODY
    // ========================================================

    if (ghost.frightened) {

        ctx.fillStyle = "#3159d6";

    }
    else {

        ctx.fillStyle =
            colors[index % colors.length];
    }


    ctx.beginPath();

    ctx.arc(
        cx,
        cy - 2,
        10,
        Math.PI,
        0
    );

    ctx.lineTo(cx + 10, cy + 10);
    ctx.lineTo(cx + 5, cy + 6);
    ctx.lineTo(cx, cy + 10);
    ctx.lineTo(cx - 5, cy + 6);
    ctx.lineTo(cx - 10, cy + 10);

    ctx.closePath();
    ctx.fill();


    // ========================================================
    // EYES
    // ========================================================

    drawGhostEyes(ghost, cx, cy);
}

function drawGhostEyes(ghost, cx, cy) {

    ctx.fillStyle = "white";

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


    ctx.fillStyle = "#263b78";

    ctx.beginPath();

    ctx.arc(
        cx - 4 + ghost.direction.x,
        cy - 3 + ghost.direction.y,
        1.5,
        0,
        Math.PI * 2
    );

    ctx.arc(
        cx + 4 + ghost.direction.x,
        cy - 3 + ghost.direction.y,
        1.5,
        0,
        Math.PI * 2
    );

    ctx.fill();
}


// ============================================================
// CONTROLS
// ============================================================

function setDirection(direction) {

    player.nextDirection = {
        ...direction
    };


    if (!running && deathTimer <= 0 && lives > 0) {

        running = true;

        statusElement.textContent = "";

        tryChangeDirection();
    }
}


document.addEventListener("keydown", event => {

    const keys = {
        ArrowUp: DIRECTIONS.up,
        w: DIRECTIONS.up,

        ArrowDown: DIRECTIONS.down,
        s: DIRECTIONS.down,

        ArrowLeft: DIRECTIONS.left,
        a: DIRECTIONS.left,

        ArrowRight: DIRECTIONS.right,
        d: DIRECTIONS.right
    };


    const direction =
        keys[event.key] ||
        keys[event.key.toLowerCase()];


    if (!direction)
        return;


    event.preventDefault();

    setDirection(direction);
});


document
    .querySelectorAll("[data-dir]")
    .forEach(button => {

        button.addEventListener("click", () => {

            setDirection(
                DIRECTIONS[
                button.dataset.dir
                ]
            );
        });
    });


document
    .getElementById("restart")
    .addEventListener("click", () => {

        resetGame();
    });


// ============================================================
// UI
// ============================================================

function updateUI() {

    scoreElement.textContent = score;
    livesElement.textContent = lives;
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

    requestAnimationFrame(gameLoop);
}


resetGame();

requestAnimationFrame(gameLoop);

