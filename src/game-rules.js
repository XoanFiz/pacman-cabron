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
    paused = false;
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
        color: start.color,
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
            player.progress = 0;

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
