function createGameRules(context) {

    // START / RESTART
    // ============================================================

    function resetGame() {

        currentGameState.score = 0;
        currentGameState.lives = INITIAL_LIVES;

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
        currentGameState.pellets = mapData.pellets;

        currentGameState.time = 0;
        paused = false;

        // strategicSearch.nodes.clear();
        strategicSearch.frontier = [];
        strategicSearch.root = null;

        const playerStart = currentMap.playerStart;

        currentGameState.player = {
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

        currentGameState.ghosts = ghostStarts.map((ghost, index) => ({
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
            currentGameState.player.direction.x === 0 &&
            currentGameState.player.direction.y === 0
        ) {

            tryChangeDirection();

            return;
        }


        currentGameState.player.progress +=
            PACMAN_SPEED * dt;


        while (
            currentGameState.player.progress >= 1
        ) {

            currentGameState.player.progress -= 1;


            currentGameState.player.x =
                wrap(
                    currentGameState.player.x +
                    currentGameState.player.direction.x,
                    getMapColumnCount(currentMap)
                );


            currentGameState.player.y =
                wrap(
                    currentGameState.player.y +
                    currentGameState.player.direction.y,
                    getMapRowCount(currentMap)
                );


            currentGameState.player.px =
                currentGameState.player.x;

            currentGameState.player.py =
                currentGameState.player.y;


            eatPellet();

            if (selectedCharacter !== "pacman" && running) {
                currentGameState.player.nextDirection =
                    chooseStrategicPacmanDirection(
                        getCurrentSearchContext()
                    );
            }


            if (
                canMove(
                    currentGameState.player.x,
                    currentGameState.player.y,
                    currentGameState.player.nextDirection
                )
            ) {

                setPlayerDirection(currentGameState.player.nextDirection);
            }


            if (
                !canMove(
                    currentGameState.player.x,
                    currentGameState.player.y,
                    currentGameState.player.direction
                )
            ) {

                setPlayerDirection({ x: 0, y: 0 });
                currentGameState.player.progress = 0;

                break;
            }
        }


        currentGameState.player.px =
            currentGameState.player.x +
            currentGameState.player.direction.x *
            currentGameState.player.progress;


        currentGameState.player.py =
            currentGameState.player.y +
            currentGameState.player.direction.y *
            currentGameState.player.progress;
    }


    function setPlayerDirection(direction) {
        currentGameState.player.direction = { ...direction };

        if (direction.x !== 0 || direction.y !== 0) {
            currentGameState.player.facingDirection = { ...direction };
        }
    }


    function tryChangeDirection() {

        if (
            canMove(
                currentGameState.player.x,
                currentGameState.player.y,
                currentGameState.player.nextDirection
            )
        ) {

            setPlayerDirection(currentGameState.player.nextDirection);
        }
    }


    // ============================================================
    // PELLETS
    // ============================================================

    function eatPellet() {

        const x =
            currentGameState.player.x;

        const y =
            currentGameState.player.y;


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
                cell !== "o") || !currentGameState.pellets.has(`${x},${y}`)
        ) {
            return;
        }

        currentGameState.pellets.delete(`${x},${y}`)


        if (cell === "o") {

            currentGameState.score += 50;

            activateFrightenedMode();

        }

        else {

            currentGameState.score += 10;
        }


        if (currentGameState.pellets.size === 0) {

            running = false;
            gameWon = true;
            setStatus("won");
        }


        updateUI();
    }


    function activateFrightenedMode() {
        for (const ghost of currentGameState.ghosts) {

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

        const ghostHouses = buildGhostHouses(getCurrentMapDefinition())


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
                    currentGameState.time -
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
                    currentGameState.time -
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

        currentGameState.score += 200;

        updateUI();
    }


    function loseLife() {

        if (deathTimer > 0)
            return;


        currentGameState.lives--;

        running = false;

        deathTimer = 1.0;

        for (const ghost of currentGameState.ghosts) {
            ghost.frightened = false;
            ghost.frightenedTimer = undefined;
            ghost.eaten = false;
            ghost.speed = GHOST_SPEED
        }


        setStatus(
            currentGameState.lives > 0
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
                currentGameState.lives > 0
            ) {

                resetPositions();


                setStatus("continue");
            }


            return;
        }


        if (!running)
            return;

        currentGameState.time += dt;

        for (
            const ghost of currentGameState.ghosts
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
            const ghost of currentGameState.ghosts
        ) {

            updateGhost(
                ghost,
                dt
            );
        }

        const pendingGhosts = currentGameState.ghosts
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
                ghost => currentGameState.ghosts.indexOf(ghost)
            );

            const directions = chooseStrategicGhostDirections(
                getCurrentSearchContext(),
                readyGhostIndices
            );


            for (const ghost of group.ghosts) {
                const ghostIndex = currentGameState.ghosts.indexOf(ghost);
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


        checkGhostCollisions(currentGameState.ghosts, currentGameState.player);
    }


    // ============================================================
    // RESET POSITIONS
    // ============================================================

    function resetPositions() {

        const mapDefinition = getCurrentMapDefinition();
        const playerStart = mapDefinition.playerStart;

        currentGameState.player.x = playerStart.x;
        currentGameState.player.y = playerStart.y;

        currentGameState.player.px = playerStart.x;
        currentGameState.player.py = playerStart.y;

        currentGameState.player.progress = 0;


        currentGameState.player.direction = {
            x: 0,
            y: 0
        };


        currentGameState.player.nextDirection = {
            x: 0,
            y: 0
        };


        const ghostStarts = mapDefinition.ghostStarts;

        currentGameState.ghosts.forEach((ghost, index) => {
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
            player: cloneSearchCharacter(currentGameState.player),
            ghosts: currentGameState.ghosts.map(cloneSearchCharacter),

            pellets: new Set(currentGameState.pellets),
            lives,
            time: currentGameState.time,

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
            currentGameState.player.nextDirection = { ...direction };
        }

        if (
            !running &&
            deathTimer <= 0 &&
            currentGameState.lives > 0
        ) {

            running = true;

            statusElement.textContent = "";
            updatePauseButton();

            if (controlledGhost) {
                if (canMove(controlledGhost.x, controlledGhost.y, direction)) {
                    controlledGhost.direction = { ...direction };
                }

                currentGameState.nextDirection =
                    chooseStrategicPacmanDirection(getCurrentSearchContext());
                tryChangeDirection();
            } else {
                tryChangeDirection();
            }
        }
    }

    return {
        resetGame,
        update,
        setDirection
    }
}
