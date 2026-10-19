// START / RESTART
// ============================================================

function resetGame() {

    gameState.score = 0;
    gameState.lives = INITIAL_LIVES;

    resetLevel();
    gameWon = false;

    updateUI();
}


function resetLevel() {
    currentMap = cloneMapDefinition(
        getCurrentMapDefinition()
    );
    const mapData = buildMapData(currentMap);

    graph = mapData.graph;
    gameState.pellets = mapData.pellets;

    gameState.time = 0;
    paused = false;

    // strategicSearch.nodes.clear();
    strategicSearch.frontier = [];
    strategicSearch.root = null;

    const playerStart = currentMap.playerStart;

    gameState.player = {
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

    gameState.ghosts = ghostStarts.map((ghost, index) => ({
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


    graph = buildGraph(currentMap);

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
        gameState.player.direction.x === 0 &&
        gameState.player.direction.y === 0
    ) {

        tryChangeDirection();

        return;
    }


    gameState.player.progress +=
        PACMAN_SPEED * dt;


    while (
        gameState.player.progress >= 1
    ) {

        gameState.player.progress -= 1;


        gameState.player.x =
            wrap(
                gameState.player.x +
                gameState.player.direction.x,
                getMapColumnCount(currentMap)
            );


        gameState.player.y =
            wrap(
                gameState.player.y +
                gameState.player.direction.y,
                getMapRowCount(currentMap)
            );


        gameState.player.px =
            gameState.player.x;

        gameState.player.py =
            gameState.player.y;


        eatPellet();

        if (selectedCharacter !== "pacman" && running) {
            gameState.player.nextDirection =
                chooseStrategicPacmanDirection(
                    getCurrentSearchContext()
                );
        }


        if (
            canMove(
                gameState.player.x,
                gameState.player.y,
                gameState.player.nextDirection
            )
        ) {

            setPlayerDirection(gameState.player.nextDirection);
        }


        if (
            !canMove(
                gameState.player.x,
                gameState.player.y,
                gameState.player.direction
            )
        ) {

            setPlayerDirection({ x: 0, y: 0 });
            gameState.player.progress = 0;

            break;
        }
    }


    gameState.player.px =
        gameState.player.x +
        gameState.player.direction.x *
        gameState.player.progress;


    gameState.player.py =
        gameState.player.y +
        gameState.player.direction.y *
        gameState.player.progress;
}


function setPlayerDirection(direction) {
    gameState.player.direction = { ...direction };

    if (direction.x !== 0 || direction.y !== 0) {
        gameState.player.facingDirection = { ...direction };
    }
}


function tryChangeDirection() {

    if (
        canMove(
            gameState.player.x,
            gameState.player.y,
            gameState.player.nextDirection
        )
    ) {

        setPlayerDirection(gameState.player.nextDirection);
    }
}


// ============================================================
// PELLETS
// ============================================================

function eatPellet() {

    const x =
        gameState.player.x;

    const y =
        gameState.player.y;


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
            cell !== "o") || !gameState.pellets.has(`${x},${y}`)
    ) {
        return;
    }

    gameState.pellets.delete(`${x},${y}`)


    if (cell === "o") {

        gameState.score += 50;

        activateFrightenedMode();

    }

    else {

        gameState.score += 10;
    }


    if (gameState.pellets.size === 0) {

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
                gameState.time -
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
                gameState.time -
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

    gameState.score += 200;

    updateUI();
}


function loseLife() {

    if (deathTimer > 0)
        return;


    gameState.lives--;

    running = false;

    deathTimer = 1.0;

    for (const ghost of ghosts) {
        ghost.frightened = false;
        ghost.frightenedTimer = undefined;
        ghost.eaten = false;
        ghost.speed = GHOST_SPEED
    }


    setStatus(
        gameState.lives > 0
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
            gameState.lives > 0
        ) {

            resetPositions();


            setStatus("continue");
        }


        return;
    }


    if (!running)
        return;

    gameState.time += dt;

    for (
        const ghost of gameState.ghosts
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
        const ghost of gameState.ghosts
    ) {

        updateGhost(
            ghost,
            dt
        );
    }

    const pendingGhosts = gameState.ghosts
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
            ghost => gameState.ghosts.indexOf(ghost)
        );

        const directions = chooseStrategicGhostDirections(
            getCurrentSearchContext(),
            readyGhostIndices
        );


        for (const ghost of group.ghosts) {
            const ghostIndex = gameState.ghosts.indexOf(ghost);
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


    checkGhostCollisions(gameState.ghosts, gameState.player);
}


// ============================================================
// RESET POSITIONS
// ============================================================

function resetPositions() {

    const mapDefinition = getCurrentMapDefinition();
    const playerStart = mapDefinition.playerStart;

    gameState.player.x = playerStart.x;
    gameState.player.y = playerStart.y;

    gameState.player.px = playerStart.x;
    gameState.player.py = playerStart.y;

    gameState.player.progress = 0;


    gameState.player.direction = {
        x: 0,
        y: 0
    };


    gameState.player.nextDirection = {
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
        player: cloneSearchCharacter(gameState.player),
        ghosts: gameState.ghosts.map(cloneSearchCharacter),

        pellets: new Set(gameState.pellets),
        lives,
        time: gameState.time,

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

            houses: buildGhostHouses(mapDefinition)
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
        gameState.player.nextDirection = { ...direction };
    }

    if (
        !running &&
        deathTimer <= 0 &&
        gameState.lives > 0
    ) {

        running = true;

        statusElement.textContent = "";
        updatePauseButton();

        if (controlledGhost) {
            if (canMove(controlledGhost.x, controlledGhost.y, direction)) {
                controlledGhost.direction = { ...direction };
            }

            gameState.nextDirection =
                chooseStrategicPacmanDirection(getCurrentSearchContext());
            tryChangeDirection();
        } else {
            tryChangeDirection();
        }
    }
}