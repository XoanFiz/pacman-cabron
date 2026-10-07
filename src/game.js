

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const scoreElement = document.getElementById("score");
const livesElement = document.getElementById("lives");
const statusElement = document.getElementById("status");


// ============================================================
// MAPA
// ============================================================

const MAP = [
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
    "#...........#.......#",
    "#.####.###.###.####.#",
    "#o..##........##..o#",
    "###.##.##.##.##.####",
    "#......#....#.......#",
    "#.####.#.##.#.####..#",
    "#..................#",
    "####################"
];

const CELL = 28;
const ROWS = MAP.length;
const COLS = 20;

canvas.width = COLS * CELL;
canvas.height = ROWS * CELL;


// ============================================================
// ESTADO
// ============================================================

let score;
let lives;
let pellets;

let player;

let ghosts;

let running = false;
let deathTimer = 0;

let lastTime = 0;


// ============================================================
// DIRECCIÓNS
// ============================================================

const DIRECTIONS = {
    up:    { x: 0,  y: -1 },
    down:  { x: 0,  y: 1  },
    left:  { x: -1, y: 0  },
    right: { x: 1,  y: 0  }
};


// ============================================================
// UTILIDADES DA GRELLA
// ============================================================

function isWall(x, y) {

    if (x < 0 || x >= COLS || y < 0 || y >= ROWS)
        return true;

    return MAP[y][x] === "#";
}


function canMove(x, y, direction) {

    return !isWall(
        x + direction.x,
        y + direction.y
    );
}


// ============================================================
// INICIO / REINICIO
// ============================================================

function resetGame() {

    score = 0;
    lives = 3;

    resetLevel();

    updateUI();
}


function resetLevel() {

    pellets = 0;

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
            direction: { x: 1, y: 0 }
        },

        {
            x: 10,
            y: 8,
            px: 10,
            py: 8,
            direction: { x: -1, y: 0 }
        },

        {
            x: 11,
            y: 10,
            px: 11,
            py: 10,
            direction: { x: 0, y: -1 }
        }
    ];

    running = false;
    deathTimer = 0;

    statusElement.textContent =
        "Preme unha frecha para comezar";
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

        // Chegamos exactamente ao centro da seguinte cela.
        player.x += player.direction.x;
        player.y += player.direction.y;

        player.px = player.x;
        player.py = player.y;


        eatPellet();


        // Intentar virar inmediatamente no cruzamento.
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


        // Se non podemos continuar, paramos exactamente
        // no centro da cela.
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
// PASTILLAS
// ============================================================

function eatPellet() {

    const x = player.x;
    const y = player.y;

    if (x < 0 || x >= COLS || y < 0 || y >= ROWS)
        return;

    const cell = MAP[y][x];

    if (cell !== "." && cell !== "o")
        return;


    // Non podemos modificar MAP directamente porque é unha
    // constante de strings. Convertémola localmente.
    const row = MAP[y].split("");

    row[x] = " ";

    MAP[y] = row.join("");

    pellets--;

    if (cell === "o")
        score += 50;
    else
        score += 10;


    if (pellets === 0) {

        running = false;

        statusElement.textContent =
            "🎉 Gañaches!";
    }

    updateUI();
}


// ============================================================
// FANTASMAS
// ============================================================

function updateGhost(ghost, dt) {

    const speed = 4.5;

    ghost.progress ??= 0;

    ghost.progress += speed * dt;


    while (ghost.progress >= 1) {

        ghost.progress -= 1;

        ghost.x += ghost.direction.x;
        ghost.y += ghost.direction.y;


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


        /*
         * Pequena IA:
         *
         * normalmente escolle a dirección que máis achega
         * ao xogador, pero ás veces escolle outra para evitar
         * que os fantasmas sexan completamente deterministas.
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
                        Math.random() * possible.length
                    )
                ]
            };
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
// COLISIÓNS
// ============================================================

function checkGhostCollisions() {

    for (const ghost of ghosts) {

        const dx = ghost.px - player.px;
        const dy = ghost.py - player.py;

        const distance =
            Math.sqrt(dx * dx + dy * dy);


        if (distance < 0.55) {

            loseLife();
            return;
        }
    }
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
// ACTUALIZACIÓN
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


    updatePlayer(dt);

    for (const ghost of ghosts)
        updateGhost(ghost, dt);

    checkGhostCollisions();
}


// ============================================================
// RESET DAS POSICIÓNS
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


    // paredes e pastillas

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


    ctx.fillStyle =
        colors[index % colors.length];


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


    // ollos

    ctx.fillStyle = "white";

    ctx.beginPath();

    ctx.arc(cx - 4, cy - 3, 3, 0, Math.PI * 2);
    ctx.arc(cx + 4, cy - 3, 3, 0, Math.PI * 2);

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
// CONTROIS
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

