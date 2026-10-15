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
    currentMap = cloneMapDefinition(
        getCurrentMapDefinition()
    );

    ghostHouses = currentMap.ghostHouses.map(cloneMapPosition);

    pellets = buildPellets();

    gameTime = 0;
    paused = false;

    strategicSearch.nodes.clear();
    strategicSearch.frontier = [];
    strategicSearch.root = null;

    const playerStart = currentMap.playerStart;

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

        progress: 0,
        speed: PACMAN_SPEED
    };


    const ghostStarts = currentMap.ghostStarts;

    ghosts = ghostStarts.map((ghost, index) => ({
        x: ghost.x,
        y: ghost.y,
        px: ghost.x,
        py: ghost.y,
        color: ghost.color || getGhostColor(index),
        direction: { ...ghost.direction },
        nextDirection: { ...ghost.direction },
        frightened: false,
        eaten: false,
        progress: 0,
        speed: GHOST_SPEED
    }));


    running = false;
    deathTimer = 0


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

    if (
        player.direction.x === 0 &&
        player.direction.y === 0
    ) {

        tryChangeDirection();

        return;
    }


    player.progress +=
        PACMAN_SPEED * dt;


    while (
        player.progress >= 1
    ) {

        player.progress -= 1;


        player.x =
            wrap(
                player.x +
                player.direction.x,
                getMapColumnCount(currentMap)
            );


        player.y =
            wrap(
                player.y +
                player.direction.y,
                getMapRowCount(currentMap)
            );


        player.px =
            player.x;

        player.py =
            player.y;


        eatPellet();

        if (selectedCharacter !== "pacman" && running) {
            player.nextDirection =
                chooseStrategicPacmanDirection(
                    getCurrentSearchContext()
                );
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
// PELLETS
// ============================================================

function eatPellet() {

    const x =
        player.x;

    const y =
        player.y;


    if (
        x < 0 ||
        x >= getMapColumnCount(currentMap) ||
        y < 0 ||
        y >= getMapRowCount(currentMap)
    ) {
        return;
    }


    const cell =
        currentMap.tiles[y][x];


    if (
        (cell !== "." &&
            cell !== "o") || !pellets.has(`${x},${y}`)
    ) {
        return;
    }

    pellets.delete(`${x},${y}`)


    if (cell === "o") {

        score += 50;

        activateFrightenedMode();

    }

    else {

        score += 10;
    }


    if (pellets.size === 0) {

        running = false;
        gameWon = true;
        setStatus("won");
    }


    updateUI();
}


function activateFrightenedMode() {
    for (const ghost of ghosts) {

        if (ghost.eaten)
            continue;


        ghost.frightened = true;
        ghost.frightenedTimer = FRIGHTENED_DURATION;
        ghost.speed = FRIGHTENED_GHOST_SPEED;

        // reverseGhostDirection(
        //     ghost
        // );
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
                getMapColumnCount(currentMap)
            );

        ghost.y =
            wrap(
                ghost.y,
                getMapRowCount(currentMap)
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

    ghost.progress ??= 0;


    ghost.progress +=
        ghost.speed * dt;


    while (
        ghost.progress >= 1
    ) {

        ghost.progress -= 1;


        ghost.x =
            wrap(
                ghost.x +
                ghost.direction.x,
                getMapColumnCount(currentMap)
            );


        ghost.y =
            wrap(
                ghost.y +
                ghost.direction.y,
                getMapRowCount(currentMap)
            );

        if (
            ghost.eaten &&
            ghostHouses.some(house =>
                ghost.x === house.x && ghost.y === house.y
            )
        ) {
            ghost.eaten = false;
            ghost.frightened = false;
            ghost.speed = GHOST_SPEED;
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
                ghost.progress / ghost.speed;
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

function checkGhostCollisions(ghosts, player) {

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
    ghost.speed = EATEN_GHOST_SPEED;

    score += 200;

    updateUI();
}


function loseLife() {

    if (deathTimer > 0)
        return;


    lives--;

    running = false;

    deathTimer = 1.0;

    for (const ghost of ghosts) {
        ghost.frightened = false;
        ghost.frightenedTimer = undefined;
        ghost.eaten = false;
        ghost.speed = GHOST_SPEED
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
        // Pause after death

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

    for (
        const ghost of ghosts
    ) {
        if (ghost.frightened) {
            ghost.frightenedTimer -= dt;
            if (ghost.frightenedTimer <= 0) {
                ghost.frightened = false;
                ghost.frightenedTimer = undefined;
                ghost.speed = GHOST_SPEED;
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
        const readyGhostIndices = group.ghosts.map(
            ghost => ghosts.indexOf(ghost)
        );

        const directions = chooseStrategicGhostDirections(
            getCurrentSearchContext(),
            readyGhostIndices
        );


        for (const ghost of group.ghosts) {
            const ghostIndex = ghosts.indexOf(ghost);
            ghost.direction = directions.get(ghostIndex);
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


    checkGhostCollisions(ghosts, player);
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
        ghost.speed = GHOST_SPEED;
    });
}


// ============================================================
function getCurrentSearchContext() {
    const mapDefinition = getCurrentMapDefinition();

    return {
        player: cloneSearchCharacter(player),
        ghosts: ghosts.map(cloneSearchCharacter),

        pellets: new Set(pellets),
        lives,
        time: gameTime,

        controlledGhostIndex: selectedCharacter.startsWith("ghost-")
            ? Number(selectedCharacter.slice("ghost-".length))
            : -1,

        respawnState: {
            player: {
                x: mapDefinition.playerStart.x,
                y: mapDefinition.playerStart.y
            },
            ghosts: mapDefinition.ghostStarts.map(start => ({
                x: start.x,
                y: start.y,
                direction: { ...start.direction },
                speed: GHOST_SPEED
            })),

            houses: mapDefinition.ghostHouses.map(cloneMapPosition)
        }
    };
}


function setDirection(
    direction
) {

    if (editorMode || paused) {
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
        updatePauseButton();

        if (controlledGhost) {
            if (canMove(controlledGhost.x, controlledGhost.y, direction)) {
                controlledGhost.direction = { ...direction };
            }

            player.nextDirection =
                chooseStrategicPacmanDirection(getCurrentSearchContext());
            tryChangeDirection();
        } else {
            tryChangeDirection();
        }
    }
}