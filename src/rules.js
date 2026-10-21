function createGameRules(parameters = {}) {
    const {
        config,
        state,
        map,
        model,
        intelligence,
        ui
    } = parameters;

    const {
        INITIAL_LIVES,
        PACMAN_SPEED,
        GHOST_SPEED,
        FRIGHTENED_DURATION,
        FRIGHTENED_GHOST_SPEED,
        EATEN_GHOST_SPEED,
        GHOST_COLLISION_DISTANCE,
        SEARCH_EPSILON
    } = config;

    const {
        createPlayerState,
        createGhostState
    } = model;

    const gameState = () => state.currentGameState;

    // START / RESTART
    // ============================================================

    function resetGame() {
        const gs = gameState();
        gs.score = 0;
        gs.lives = INITIAL_LIVES;

        resetLevel();
        gs.gameWon = false;

        ui.updateUI();
    }

    function resetLevel() {
        const gs = gameState();

        state.inputDirection = { x: 0, y: 0 };

        map.currentMap = map.cloneMapDefinition(
            map.getCurrentMapDefinition()
        );
        const mapData = map.buildMapData(map.currentMap);

        map.graph = mapData.graph;
        gs.pellets = mapData.pellets;

        gs.time = 0;
        gs.paused = false;

        map.strategicSearch.frontier = [];
        map.strategicSearch.root = null;

        const playerStart = map.currentMap.playerStart;

        gs.player = createPlayerState(
            playerStart,
            PACMAN_SPEED
        );

        const ghostStarts = map.currentMap.ghostStarts;

        gs.ghosts = ghostStarts.map((ghost, index) =>
            createGhostState(
                ghost,
                ghost.color || state.getGhostColor(index),
                GHOST_SPEED
            )
        );

        gs.running = false;
        gs.deathTimer = 0;

        map.graph = map.buildGraph(map.currentMap);

        state.setStatus(
            state.selectedCharacter === "pacman"
                ? "startPacman"
                : "startGhost"
        );
    }

    // ============================================================
    // PAC-MAN
    // ============================================================

    function updatePlayer(dt) {
        const gs = gameState();
        const player = gs.player;

        if (player.direction.x === 0 && player.direction.y === 0) {
            tryChangeDirection();
            return;
        }

        player.progress += PACMAN_SPEED * dt;

        while (player.progress >= 1) {
            player.progress -= 1;

            player.x = map.wrap(
                player.x + player.direction.x,
                map.getMapColumnCount(map.currentMap)
            );

            player.y = map.wrap(
                player.y + player.direction.y,
                map.getMapRowCount(map.currentMap)
            );

            player.px = player.x;
            player.py = player.y;

            eatPellet();

            if (state.selectedCharacter !== "pacman" && gs.running) {
                player.nextDirection =
                    intelligence.choosePacmanDirection(
                        intelligence.getCurrentSearchContext()
                    );
            }

            const desiredDirection = state.selectedCharacter === "pacman"
                ? state.inputDirection
                : player.nextDirection;

            if (map.canMove(player.x, player.y, desiredDirection)) {
                setPlayerDirection(desiredDirection);
            }

            if (!map.canMove(player.x, player.y, player.direction)) {
                setPlayerDirection({ x: 0, y: 0 });
                player.progress = 0;
                break;
            }
        }

        player.px =
            player.x + player.direction.x * player.progress;

        player.py =
            player.y + player.direction.y * player.progress;
    }

    function setPlayerDirection(direction) {
        const player = gameState().player;
        player.direction = { ...direction };

        if (direction.x !== 0 || direction.y !== 0) {
            player.facingDirection = { ...direction };
        }
    }

    function tryChangeDirection() {
        const gs = gameState();
        const player = gs.player;
        const desiredDirection = state.selectedCharacter === "pacman"
            ? state.inputDirection
            : player.nextDirection;

        if (map.canMove(player.x, player.y, desiredDirection)) {
            setPlayerDirection(desiredDirection);
        }
    }

    // ============================================================
    // PELLETS
    // ============================================================

    function eatPellet() {
        const gs = gameState();
        const player = gs.player;
        const x = player.x;
        const y = player.y;

        if (
            x < 0 ||
            x >= map.getMapColumnCount(map.currentMap) ||
            y < 0 ||
            y >= map.getMapRowCount(map.currentMap)
        ) {
            return;
        }

        const cell = map.currentMap.tiles[y][x];

        if (
            (cell !== "." && cell !== "o") ||
            !gs.pellets.has(`${x},${y}`)
        ) {
            return;
        }

        gs.pellets.delete(`${x},${y}`);

        if (cell === "o") {
            gs.score += 50;
            activateFrightenedMode();
        } else {
            gs.score += 10;
        }

        if (gs.pellets.size === 0) {
            gs.running = false;
            gs.gameWon = true;
            state.setStatus("won");
        }

        ui.updateUI();
    }

    function activateFrightenedMode() {
        for (const ghost of gameState().ghosts) {
            if (ghost.eaten) continue;

            ghost.frightened = true;
            ghost.frightenedTimer = FRIGHTENED_DURATION;
            ghost.speed = FRIGHTENED_GHOST_SPEED;
        }
    }

    function reverseGhostDirection(ghost) {
        if (ghost.progress > 0) {
            ghost.x += ghost.direction.x;
            ghost.y += ghost.direction.y;

            ghost.x = map.wrap(ghost.x, map.getMapColumnCount(map.currentMap));
            ghost.y = map.wrap(ghost.y, map.getMapRowCount(map.currentMap));

            ghost.progress = 1 - ghost.progress;
        }

        ghost.direction.x *= -1;
        ghost.direction.y *= -1;
    }

    // ============================================================
    // GHOSTS
    // ============================================================

    function getControlledGhost() {
        if (!state.selectedCharacter.startsWith("ghost-")) {
            return null;
        }

        return gameState().ghosts[
            Number(state.selectedCharacter.slice("ghost-".length))
        ] || null;
    }

    function updateGhost(ghost, dt) {
        const gs = gameState();

        ghost.progress ??= 0;
        ghost.progress += ghost.speed * dt;

        const ghostHouses = map.buildGhostHouses(map.getCurrentMapDefinition());

        while (ghost.progress >= 1) {
            ghost.progress -= 1;

            ghost.x = map.wrap(
                ghost.x + ghost.direction.x,
                map.getMapColumnCount(map.currentMap)
            );

            ghost.y = map.wrap(
                ghost.y + ghost.direction.y,
                map.getMapRowCount(map.currentMap)
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

            const possibleDirections = map.getPossibleDirections(ghost);

            if (possibleDirections.length === 0) {
                ghost.direction = { x: 0, y: 0 };
                break;
            }

            if (ghost.eaten) {
                ghost.needsDirection = true;
                ghost.pendingDecisionTime =
                    gs.time - ghost.progress / EATEN_GHOST_SPEED;
                break;
            }

            if (getControlledGhost() === ghost) {
                const desiredDirection = state.inputDirection;

                if (
                    desiredDirection &&
                    map.canMove(ghost.x, ghost.y, desiredDirection)
                ) {
                    ghost.direction = { ...desiredDirection };
                } else if (!map.canMove(ghost.x, ghost.y, ghost.direction)) {
                    ghost.direction = { ...possibleDirections[0] };
                }

                ghost.needsDirection = false;
            } else {
                ghost.needsDirection = true;
                ghost.pendingDecisionTime =
                    gs.time - ghost.progress / ghost.speed;
            }

            break;
        }

        ghost.px = ghost.x + ghost.direction.x * ghost.progress;
        ghost.py = ghost.y + ghost.direction.y * ghost.progress;
    }

    // ============================================================
    // COLLISIONS
    // ============================================================

    function checkGhostCollisions(ghosts, player) {
        for (const ghost of ghosts) {
            const dx = ghost.px - player.px;
            const dy = ghost.py - player.py;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance >= GHOST_COLLISION_DISTANCE) {
                continue;
            }

            if (ghost.eaten) continue;

            if (ghost.frightened) {
                eatGhost(ghost);
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

        gameState().score += 200;

        ui.updateUI();
    }

    function loseLife() {
        const gs = gameState();

        if (gs.deathTimer > 0) return;

        gs.lives--;
        gs.running = false;
        gs.deathTimer = 1.0;

        for (const ghost of gs.ghosts) {
            ghost.frightened = false;
            ghost.frightenedTimer = undefined;
            ghost.eaten = false;
            ghost.speed = GHOST_SPEED;
        }

        state.setStatus(
            gs.lives > 0 ? "lifeLost" : "gameOver"
        );

        ui.updateUI();
    }

    // ============================================================
    // UPDATE
    // ============================================================

    function update(dt) {
        const gs = gameState();

        if (gs.deathTimer > 0) {
            gs.deathTimer -= dt;

            if (gs.deathTimer <= 0 && gs.lives > 0) {
                resetPositions();
                state.setStatus("continue");
            }

            return;
        }

        if (!gs.running) return;

        gs.time += dt;

        for (const ghost of gs.ghosts) {
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

        for (const ghost of gs.ghosts) {
            updateGhost(ghost, dt);
        }

        const pendingGhosts = gs.ghosts
            .filter(ghost => ghost.needsDirection)
            .sort((a, b) => a.pendingDecisionTime - b.pendingDecisionTime);
        const decisionGroups = [];

        for (const ghost of pendingGhosts) {
            const lastGroup = decisionGroups[decisionGroups.length - 1];

            if (
                lastGroup &&
                Math.abs(ghost.pendingDecisionTime - lastGroup.time) <= SEARCH_EPSILON
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
                ghost => gs.ghosts.indexOf(ghost)
            );

            const directions = intelligence.chooseGhostDirections(
                intelligence.getCurrentSearchContext(),
                readyGhostIndices
            );

            for (const ghost of group.ghosts) {
                const ghostIndex = gs.ghosts.indexOf(ghost);
                ghost.direction = directions.get(ghostIndex);
                ghost.needsDirection = false;
                ghost.px = ghost.x + ghost.direction.x * ghost.progress;
                ghost.py = ghost.y + ghost.direction.y * ghost.progress;
            }
        }

        checkGhostCollisions(gs.ghosts, gs.player);
    }

    // ============================================================
    // RESET POSITIONS
    // ============================================================

    function resetPositions() {
        const gs = gameState();
        const mapDefinition = map.getCurrentMapDefinition();
        const playerStart = mapDefinition.playerStart;
        const player = gs.player;

        player.x = playerStart.x;
        player.y = playerStart.y;
        player.px = playerStart.x;
        player.py = playerStart.y;
        player.progress = 0;
        player.direction = { x: 0, y: 0 };
        player.nextDirection = { x: 0, y: 0 };
        state.inputDirection = { x: 0, y: 0 };

        const ghostStarts = mapDefinition.ghostStarts;

        gs.ghosts.forEach((ghost, index) => {
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

    function setDirection(direction) {
        const gs = gameState();

        if (state.editorMode || gs.paused) {
            return;
        }

        // Latch the input; it is read when the character reaches a centre.
        state.inputDirection = { ...direction };

        const controlledGhost = getControlledGhost();

        if (!gs.running && gs.deathTimer <= 0 && gs.lives > 0) {
            gs.running = true;

            state.statusElement.textContent = "";
            ui.updatePauseButton();

            if (controlledGhost) {
                if (map.canMove(controlledGhost.x, controlledGhost.y, direction)) {
                    controlledGhost.direction = { ...direction };
                }

                gs.player.nextDirection =
                    intelligence.choosePacmanDirection(
                        intelligence.getCurrentSearchContext()
                    );
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
    };
}