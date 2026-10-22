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

    function setPlayerDirection(direction) {
        const player = gameState().player;
        player.direction = { ...direction };

        if (direction.x !== 0 || direction.y !== 0) {
            player.facingDirection = { ...direction };
        }
    }

    // Held direction that is legal from this cell, most recent first.
    function findPressedDirection(x, y) {
        for (
            let index = state.pressedDirections.length - 1;
            index >= 0;
            index--
        ) {
            const direction = map.DIRECTIONS[state.pressedDirections[index]];

            if (direction && map.canMove(x, y, direction)) {
                return direction;
            }
        }

        return null;
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

    // Eating a power pellet is a decision event for every ghost that is
    // not on its way home. All of them, including the player-controlled
    // one, are resolved by resolveDecisions at the same event.
    function activateFrightenedMode() {
        for (const ghost of gameState().ghosts) {
            if (ghost.eaten) continue;

            ghost.frightened = true;
            ghost.frightenedTimer = FRIGHTENED_DURATION;
            ghost.speed = FRIGHTENED_GHOST_SPEED;

            // A ghost that arrived at a centre at this same event keeps its
            // centre decision, where every direction is legal.
            if (!ghost.needsDirection) {
                ghost.decisionAtCentre = false;
            }

            ghost.needsDirection = true;
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

    // Between cells a ghost cannot turn sideways: the only directions it
    // can take without leaving the corridor are continuing and reversing.
    // At a cell centre every legal direction is available.
    function isDecidingBetweenCells(ghost) {
        return ghost.progress > 0 && ghost.decisionAtCentre === false;
    }

    function getImmediateGhostDirections(ghost) {
        if (isDecidingBetweenCells(ghost)) {
            return [
                { ...ghost.direction },
                { x: -ghost.direction.x, y: -ghost.direction.y }
            ];
        }

        return map.getPossibleDirections(ghost);
    }

    // Applies a decision without teleporting the ghost. A reversal between
    // cells moves the ghost to the cell it was coming from and flips its
    // progress, which keeps its physical position unchanged.
    function getLegalGhostFallback(ghost) {
        const possible = map.getPossibleDirections(ghost);

        return possible.length > 0
            ? { ...possible[0] }
            : { x: 0, y: 0 };
    }

    function applyGhostDecision(ghost, direction) {
        const betweenCells = isDecidingBetweenCells(ghost);

        if (!direction) {
            // No decision: keep moving unless the ghost stands at a centre
            // with the current direction blocked by a wall.
            if (
                !betweenCells &&
                !map.canMove(ghost.x, ghost.y, ghost.direction)
            ) {
                ghost.direction = getLegalGhostFallback(ghost);
            }

            return;
        }

        const continues =
            direction.x === ghost.direction.x &&
            direction.y === ghost.direction.y;
        const reverses =
            direction.x === -ghost.direction.x &&
            direction.y === -ghost.direction.y;

        if (reverses && ghost.progress > 0) {
            reverseGhostDirection(ghost);
            return;
        }

        if (betweenCells && !continues) {
            return;
        }

        // A ghost must never be sent into a wall from a cell centre.
        if (
            !betweenCells &&
            (direction.x !== 0 || direction.y !== 0) &&
            !map.canMove(ghost.x, ghost.y, direction)
        ) {
            ghost.direction = getLegalGhostFallback(ghost);
            return;
        }

        ghost.direction = { ...direction };
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

    // ============================================================
    // EVENT SIMULATION
    // ============================================================
    //
    // The game advances to the next event (a cell arrival, a frightened
    // timer or a collision) instead of moving every character by the frame
    // time. A frame only decides how much time is consumed, so the state at
    // each decision is the same one the search simulates.

    function updatePositions() {
        const gs = gameState();

        for (const character of [gs.player, ...gs.ghosts]) {
            character.px =
                character.x + character.direction.x * character.progress;
            character.py =
                character.y + character.direction.y * character.progress;
        }
    }

    function moveCharacterToEvent(character, speed, elapsedTime) {
        if (character.direction.x === 0 && character.direction.y === 0) {
            return false;
        }

        character.progress += speed * elapsedTime;

        if (character.progress < 1 - SEARCH_EPSILON) {
            return false;
        }

        character.progress = Math.max(0, character.progress - 1);

        character.x = map.wrap(
            character.x + character.direction.x,
            map.getMapColumnCount(map.currentMap)
        );

        character.y = map.wrap(
            character.y + character.direction.y,
            map.getMapRowCount(map.currentMap)
        );

        return true;
    }

    function updateGhostFrightenedTimer(ghost, elapsedTime) {
        if (!ghost.frightened) return;

        ghost.frightenedTimer -= elapsedTime;

        if (ghost.frightenedTimer <= 0) {
            ghost.frightened = false;
            ghost.frightenedTimer = undefined;
            ghost.speed = GHOST_SPEED;
        }
    }

    function recoverGhostAtHouse(ghost, arrived) {
        if (!arrived || !ghost.eaten) return;

        const ghostHouses = map.buildGhostHouses(map.getCurrentMapDefinition());

        if (!ghostHouses.some(house =>
            ghost.x === house.x && ghost.y === house.y
        )) {
            return;
        }

        ghost.eaten = false;
        ghost.frightened = false;
        ghost.frightenedTimer = undefined;
        ghost.speed = GHOST_SPEED;
        ghost.needsDirection = true;
        ghost.decisionAtCentre = true;
    }

    function advanceCharactersToEvent(elapsedTime) {
        const gs = gameState();

        gs.time += elapsedTime;

        const playerArrived = moveCharacterToEvent(
            gs.player,
            PACMAN_SPEED,
            elapsedTime
        );

        if (playerArrived) {
            gs.player.ready = true;
        }

        for (const ghost of gs.ghosts) {
            const arrived = moveCharacterToEvent(
                ghost,
                ghost.speed,
                elapsedTime
            );

            if (arrived) {
                ghost.needsDirection = true;
                ghost.decisionAtCentre = true;
            }

            updateGhostFrightenedTimer(ghost, elapsedTime);
            recoverGhostAtHouse(ghost, arrived);
        }

        return playerArrived;
    }

    // Time at which the player and the ghost are close enough to collide,
    // or Infinity when they never will.
    function getCollisionTime(
        player,
        ghost,
        playerVelocityX,
        playerVelocityY
    ) {
        if (ghost.eaten) {
            return Infinity;
        }

        const relativeX =
            ghost.x +
            ghost.direction.x * ghost.progress -
            (player.x + player.direction.x * player.progress);

        const relativeY =
            ghost.y +
            ghost.direction.y * ghost.progress -
            (player.y + player.direction.y * player.progress);

        const ghostSpeed = ghost.speed;

        const relativeVelocityX =
            ghost.direction.x * ghostSpeed - playerVelocityX;

        const relativeVelocityY =
            ghost.direction.y * ghostSpeed - playerVelocityY;

        const relativeVelocitySquared =
            relativeVelocityX * relativeVelocityX +
            relativeVelocityY * relativeVelocityY;

        const distanceSquared =
            relativeX * relativeX +
            relativeY * relativeY;

        if (distanceSquared <= GHOST_COLLISION_DISTANCE ** 2) {
            return 0;
        }

        if (relativeVelocitySquared === 0) {
            return Infinity;
        }

        const linear =
            2 * (
                relativeX * relativeVelocityX +
                relativeY * relativeVelocityY
            );

        const discriminant =
            linear * linear -
            4 * relativeVelocitySquared *
            (distanceSquared - GHOST_COLLISION_DISTANCE ** 2);

        if (discriminant < 0) {
            return Infinity;
        }

        const collisionTime =
            (-linear - Math.sqrt(discriminant)) /
            (2 * relativeVelocitySquared);

        return collisionTime >= 0 ? collisionTime : Infinity;
    }

    function getTimeToNextEvent(gs) {
        let timeToNextEvent = Infinity;
        let collisionedGhostIndex = -1;

        const considerEvent = (time, ghostIndex = -1) => {
            if (time < timeToNextEvent) {
                timeToNextEvent = time;
                collisionedGhostIndex = ghostIndex;
                return;
            }

            if (
                time === timeToNextEvent &&
                ghostIndex >= 0 &&
                collisionedGhostIndex < 0
            ) {
                collisionedGhostIndex = ghostIndex;
            }
        };

        const considerArrival = (character, speed) => {
            if (character.direction.x === 0 && character.direction.y === 0) {
                return;
            }

            considerEvent(
                Math.max(0, 1 - character.progress) / speed
            );
        };

        if (!gs.player.ready) {
            considerArrival(gs.player, PACMAN_SPEED);
        }

        const playerVelocityX = gs.player.direction.x * PACMAN_SPEED;
        const playerVelocityY = gs.player.direction.y * PACMAN_SPEED;

        for (let index = 0; index < gs.ghosts.length; index++) {
            const ghost = gs.ghosts[index];

            if (!ghost.needsDirection) {
                considerArrival(ghost, ghost.speed);
            }

            if (ghost.frightened) {
                considerEvent(ghost.frightenedTimer);
            }

            const collisionTime = getCollisionTime(
                gs.player,
                ghost,
                playerVelocityX,
                playerVelocityY
            );

            if (Number.isFinite(collisionTime)) {
                considerEvent(collisionTime, index);
            }
        }

        return {
            timeToNextEvent,
            collisionedGhostIndex
        };
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

    function getReadyGhostIndices() {
        const indices = [];

        gameState().ghosts.forEach((ghost, index) => {
            if (ghost.needsDirection) {
                indices.push(index);
            }
        });

        return indices;
    }

    // The player controls the selected ghost only while it is not eaten.
    function getControlledGhostIndex() {
        const ghost = getControlledGhost();

        if (!ghost || ghost.eaten) {
            return -1;
        }

        return gameState().ghosts.indexOf(ghost);
    }

    // The search breaks ties between the player and the ghosts with a hash
    // of the state key. Reusing it here keeps the live decision order and
    // the search predictions identical.
    function getFirstActor(playerReady, readyGhostIndices) {
        if (playerReady && readyGhostIndices.length === 0) {
            return "player";
        }

        if (!playerReady && readyGhostIndices.length > 0) {
            return "ghosts";
        }

        if (!playerReady) {
            return null;
        }

        const searchState = intelligence.createCurrentGameSearchState(
            intelligence.getCurrentSearchContext(),
            readyGhostIndices,
            true
        );

        return searchState.firstActor;
    }

    // Returns true when the player consumed its decision. A player blocked
    // at a centre without input stays ready so a later key can start it.
    function decidePlayer(readyGhostIndices) {
        const gs = gameState();
        const player = gs.player;
        const automated = state.selectedCharacter !== "pacman";
        let direction = null;

        if (!automated) {
            const desired = findPressedDirection(player.x, player.y);

            if (desired && map.canMove(player.x, player.y, desired)) {
                direction = desired;
            }
        } else {
            const chosen = intelligence.choosePacmanDirection(
                intelligence.getCurrentSearchContext(),
                readyGhostIndices
            );

            if (
                chosen &&
                (chosen.x !== 0 || chosen.y !== 0) &&
                map.canMove(player.x, player.y, chosen)
            ) {
                direction = chosen;
            }

            // An automated Pac-Man must never stand still while the cell
            // still has a legal exit.
            if (!direction) {
                direction = map.getPossibleDirections(player)[0] || null;
            }
        }

        if (direction) {
            setPlayerDirection(direction);
            player.ready = false;

            return true;
        }

        if (
            (player.direction.x !== 0 || player.direction.y !== 0) &&
            map.canMove(player.x, player.y, player.direction)
        ) {
            player.ready = false;

            return true;
        }

        setPlayerDirection({ x: 0, y: 0 });
        player.ready = true;

        return false;
    }

    function decideGhosts(readyGhostIndices) {
        const gs = gameState();
        const playerReady = gs.player.ready === true;
        const controlledIndex = getControlledGhostIndex();
        const automatedIndices = readyGhostIndices.filter(
            index => index !== controlledIndex
        );

        const directions = automatedIndices.length > 0
            ? intelligence.chooseGhostDirections(
                intelligence.getCurrentSearchContext(),
                automatedIndices,
                playerReady
            )
            : new Map();

        for (const index of readyGhostIndices) {
            const ghost = gs.ghosts[index];

            if (index === controlledIndex) {
                const possible = getImmediateGhostDirections(ghost);
                const desired = findPressedDirection(ghost.x, ghost.y);
                const chosen = desired && possible.some(direction =>
                    direction.x === desired.x &&
                    direction.y === desired.y
                )
                    ? desired
                    : { ...ghost.direction };

                applyGhostDecision(ghost, chosen);
            } else {
                applyGhostDecision(ghost, directions.get(index));
            }

            ghost.needsDirection = false;
        }
    }

    // Resolves every actor that must decide at the current event. Actors
    // decide one at a time, in the same order the search uses, because a
    // joint event becomes a chain of single-actor decisions.
    function resolveDecisions() {
        const gs = gameState();
        const readyGhostIndices = getReadyGhostIndices();
        const playerReady = gs.player.ready === true;

        if (!playerReady && readyGhostIndices.length === 0) {
            return false;
        }

        const firstActor = getFirstActor(playerReady, readyGhostIndices);
        let resolved = false;

        if (firstActor === "player" && playerReady) {
            resolved = decidePlayer(readyGhostIndices);

            if (!resolved && readyGhostIndices.length > 0) {
                decideGhosts(readyGhostIndices);
                resolved = true;
            }
        } else if (readyGhostIndices.length > 0) {
            decideGhosts(readyGhostIndices);
            resolved = true;
        } else {
            resolved = decidePlayer(readyGhostIndices);
        }

        updatePositions();

        if (
            getReadyGhostIndices().length === 0 &&
            !gs.player.ready &&
            typeof intelligence.anchorSearch === "function"
        ) {
            intelligence.anchorSearch();
        }

        return resolved;
    }

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

        let remaining = Math.max(0, dt);
        let iterations = 0;

        while (remaining > 0 && gs.running) {
            if (++iterations > 10000) {
                console.warn("[rules] event loop guard reached");
                break;
            }

            if (resolveDecisions()) {
                continue;
            }

            const {
                timeToNextEvent,
                collisionedGhostIndex
            } = getTimeToNextEvent(gs);

            if (!Number.isFinite(timeToNextEvent)) {
                advanceCharactersToEvent(remaining);
                remaining = 0;
                break;
            }

            if (timeToNextEvent > remaining) {
                advanceCharactersToEvent(remaining);
                remaining = 0;
                break;
            }

            const elapsed = Math.max(0, timeToNextEvent);

            const playerArrived = advanceCharactersToEvent(elapsed);
            remaining -= elapsed;

            if (playerArrived) {
                eatPellet();

                if (!gs.running) {
                    break;
                }
            }

            if (collisionedGhostIndex >= 0) {
                const ghost = gs.ghosts[collisionedGhostIndex];

                if (ghost.frightened) {
                    eatGhost(ghost);
                } else if (!ghost.eaten) {
                    loseLife();
                    break;
                }
            }
        }

        updatePositions();
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
        player.ready = true;

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
            ghost.decisionAtCentre = true;
            ghost.eaten = false;
            ghost.frightened = false;
            ghost.frightenedTimer = undefined;
            ghost.speed = GHOST_SPEED;
        });
    }

    // A direction key went down: remember it as held and, if the game was
    // stopped, start it. Nothing is applied until a character reaches a
    // cell centre, where the held keys are read again.
    function pressDirection(name) {
        const gs = gameState();

        if (state.editorMode || gs.paused) {
            return;
        }

        const index = state.pressedDirections.indexOf(name);

        if (index >= 0) {
            state.pressedDirections.splice(index, 1);
        }

        state.pressedDirections.push(name);

        if (!gs.running && gs.deathTimer <= 0 && gs.lives > 0) {
            gs.running = true;

            state.statusElement.textContent = "";
            ui.updatePauseButton();
        }
    }

    function releaseDirection(name) {
        const index = state.pressedDirections.indexOf(name);

        if (index >= 0) {
            state.pressedDirections.splice(index, 1);
        }
    }

    function releaseAllDirections() {
        state.pressedDirections.length = 0;
    }

    return {
        resetGame,
        update,
        pressDirection,
        releaseDirection,
        releaseAllDirections
    };
}