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
        LIVES_DISPLAY_MILLISECONDS,
        RESPAWN_INVINCIBILITY_SECONDS,
        PACMAN_SPEED,
        GHOST_SPEED,
        FRIGHTENED_DURATION,
        FRIGHTENED_GHOST_SPEED,
        EATEN_GHOST_SPEED,
        GHOST_COLLISION_DISTANCE,
        STOP_DECISION_INTERVAL
    } = config.rules;

    const {
        createPlayerState,
        createGhostState,
        moveCharacterToEvent
    } = model;

    const gameState = () => state.currentGameState;

    // `lives` is the counter the HUD and the search read; it belongs to
    // the Pac-Man the game follows, while every Pac-Man keeps its own.
    function syncFollowedLives() {
        const gs = gameState();

        gs.lives = gs.player ? gs.player.lives : INITIAL_LIVES;
    }

    // Wall clock in milliseconds. The rules run in a bare context in the
    // tests, where `performance` does not exist, so Date.now() is enough.
    function nowMilliseconds() {
        return typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();
    }

    // START / RESTART
    // ============================================================

    function resetGame() {
        const gs = gameState();
        gs.score = 0;
        gs.lives = INITIAL_LIVES;

        resetLevel();
        gs.gameWon = false;

        ui.updateUI();
        intelligence.anchorSearch?.();
    }

    // The character chosen on the start screen decides which Pac-Man the
    // human drives. The search models every one of them; the human only
    // decides the followed one and the companions ask the search.
    function getControlledPlayerIndex() {
        const match = /^pacman-(\d+)$/.exec(state.selectedCharacter || "");

        return match ? Number(match[1]) : 0;
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

        const playerStarts = map.currentMap.playerStarts ||
            [map.currentMap.playerStart];

        gs.players = playerStarts.map(start => {
            const player = createPlayerState(start, PACMAN_SPEED);

            player.lives = INITIAL_LIVES;
            player.color = start.color ||
                state.BASE_PACMAN_COLORS?.[0] ||
                "#ffd43b";

            return player;
        });

        gs.player = gs.players[getControlledPlayerIndex()] || gs.players[0];
        syncFollowedLives();
        gs.livesVisibleUntil =
            nowMilliseconds() + LIVES_DISPLAY_MILLISECONDS;

        const ghostStarts = map.currentMap.ghostStarts;

        gs.ghosts = ghostStarts.map((ghost, index) =>
            createGhostState(
                ghost,
                ghost.color || state.getGhostColor(index),
                GHOST_SPEED
            )
        );

        sanitizeGhostDirections(gs.ghosts);

        gs.running = false;
        gs.deathTimer = 0;

        map.graph = map.buildGraph(map.currentMap);

        state.setStatus(
            state.selectedCharacter.startsWith("pacman")
                ? "startPacman"
                : "startGhost"
        );
    }

    // A start direction pointing into a wall would move the ghost
    // through it, so it is replaced by a legal one.
    function sanitizeGhostDirections(ghosts) {
        for (const ghost of ghosts) {
            if (!map.canMove(ghost.x, ghost.y, ghost.direction)) {
                const possible = map.getPossibleDirections(ghost);

                ghost.direction = possible.length > 0
                    ? { ...possible[0] }
                    : { x: 0, y: 0 };
                ghost.nextDirection = { ...ghost.direction };
                ghost.facingDirection = { ...ghost.direction };
            }
        }
    }

    // ============================================================
    // PAC-MAN
    // ============================================================

    // Applies a decided direction to one Pac-Man. The caller clears the
    // readiness because the decision may still be a stop at a wall.
    function setPlayerDirection(player, direction) {
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

    function eatPelletAt(player) {
        const gs = gameState();
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
            ghost.facingDirection = { ...ghost.direction };
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

        if (direction.x !== 0 || direction.y !== 0) {
            ghost.facingDirection = { ...direction };
        }

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

        for (const character of [...gs.players, ...gs.ghosts]) {
            character.px =
                character.x + character.direction.x * character.progress;
            character.py =
                character.y + character.direction.y * character.progress;
        }
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
        const arrivedPlayers = [];
        const columns = map.getMapColumnCount(map.currentMap);
        const rows = map.getMapRowCount(map.currentMap);

        gs.time += elapsedTime;

        gs.players.forEach((player, index) => {
            if (player.lives <= 0) {
                return;
            }

            const arrived = moveCharacterToEvent(
                player,
                PACMAN_SPEED,
                elapsedTime,
                columns,
                rows
            );

            if (arrived) {
                player.ready = true;
                arrivedPlayers.push(index);
            }

            if (player.stopped && !player.ready) {
                player.stopTimer -= elapsedTime;

                if (player.stopTimer <= 0) {
                    player.ready = true;
                    player.stopTimer = STOP_DECISION_INTERVAL;
                }
            }
        });

        for (const ghost of gs.ghosts) {
            const arrived = moveCharacterToEvent(
                ghost,
                ghost.speed,
                elapsedTime,
                columns,
                rows
            );

            if (arrived) {
                ghost.needsDirection = true;
                ghost.decisionAtCentre = true;
            }

            updateGhostFrightenedTimer(ghost, elapsedTime);
            recoverGhostAtHouse(ghost, arrived);
        }

        return arrivedPlayers;
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

    function isPlayerInvincible(player) {
        return Number.isFinite(player.invincibleUntil) &&
            player.invincibleUntil > gameState().time;
    }

    function getTimeToNextEvent(gs) {
        let timeToNextEvent = Infinity;
        let collisionedGhostIndex = -1;
        let collisionedPlayerIndex = -1;

        const considerEvent = (time, ghostIndex = -1, playerIndex = -1) => {
            if (time < timeToNextEvent) {
                timeToNextEvent = time;
                collisionedGhostIndex = ghostIndex;
                collisionedPlayerIndex = playerIndex;
                return;
            }

            if (
                time === timeToNextEvent &&
                ghostIndex >= 0 &&
                collisionedGhostIndex < 0
            ) {
                collisionedGhostIndex = ghostIndex;
                collisionedPlayerIndex = playerIndex;
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

        for (const player of gs.players) {
            if (player.lives <= 0) {
                continue;
            }

            if (!player.ready) {
                considerArrival(player, PACMAN_SPEED);
            }

            // A stopped Pac-Man only gets a new chance to start at a
            // discrete interval, independent of how fast the ghosts move.
            if (
                player.stopped &&
                !player.ready &&
                Number.isFinite(player.stopTimer)
            ) {
                considerEvent(Math.max(0, player.stopTimer));
            }
        }

        for (let ghostIndex = 0; ghostIndex < gs.ghosts.length; ghostIndex++) {
            const ghost = gs.ghosts[ghostIndex];

            if (!ghost.needsDirection) {
                considerArrival(ghost, ghost.speed);
            }

            if (ghost.frightened) {
                considerEvent(ghost.frightenedTimer);
            }

            for (
                let playerIndex = 0;
                playerIndex < gs.players.length;
                playerIndex++
            ) {
                const player = gs.players[playerIndex];

                if (player.lives <= 0 || isPlayerInvincible(player)) {
                    continue;
                }

                const collisionTime = getCollisionTime(
                    player,
                    ghost,
                    player.direction.x * PACMAN_SPEED,
                    player.direction.y * PACMAN_SPEED
                );

                if (Number.isFinite(collisionTime)) {
                    considerEvent(collisionTime, ghostIndex, playerIndex);
                }
            }
        }

        return {
            timeToNextEvent,
            collisionedGhostIndex,
            collisionedPlayerIndex
        };
    }

    function eatGhost(ghost) {
        ghost.eaten = true;
        ghost.frightened = false;
        ghost.speed = EATEN_GHOST_SPEED;

        gameState().score += 200;

        ui.updateUI();
    }

    function anyPlayerAlive() {
        return gameState().players.some(player => player.lives > 0);
    }

    function getDeathMode() {
        const definition = map.getCurrentMapDefinition();

        return definition.deathMode === "respawn" ? "respawn" : "restart";
    }

    // A dead Pac-Man that still had lives is put back on its start cell.
    function respawnPlayer(player) {
        const gs = gameState();
        const definition = map.getCurrentMapDefinition();
        const playerStarts = definition.playerStarts ||
            [definition.playerStart];
        const start = playerStarts[gs.players.indexOf(player)] ||
            playerStarts[0];

        player.x = start.x;
        player.y = start.y;
        player.px = start.x;
        player.py = start.y;
        player.progress = 0;
        player.direction = { x: 0, y: 0 };
        player.nextDirection = { x: 0, y: 0 };
        player.ready = true;
        player.stopped = false;
        player.stopTimer = 0;
        player.invincibleUntil = gs.time + RESPAWN_INVINCIBILITY_SECONDS;
    }

    // When the Pac-Man the search follows runs out of lives there is still
    // a game to play, so the control passes to the next one that is alive.
    function transferControl() {
        const gs = gameState();

        if (gs.player && gs.player.lives > 0) {
            return;
        }

        const index = gs.players.findIndex(player => player.lives > 0);

        if (index < 0) {
            return;
        }

        gs.player = gs.players[index];

        if (state.selectedCharacter.startsWith("pacman")) {
            state.selectedCharacter = index === 0
                ? "pacman"
                : `pacman-${index}`;
        }

        syncFollowedLives();
    }

    function loseLife(playerIndex) {
        const gs = gameState();

        if (gs.deathTimer > 0) return;

        const player = gs.players[playerIndex] || gs.player;

        if (!player || player.lives <= 0) {
            return;
        }

        player.lives--;
        gs.livesVisibleUntil =
            nowMilliseconds() + LIVES_DISPLAY_MILLISECONDS;

        if (player.lives <= 0) {
            transferControl();
        }

        syncFollowedLives();

        if (!anyPlayerAlive()) {
            gs.running = false;
            gs.deathTimer = 0;
            state.setStatus("gameOver");
            ui.updateUI();
            return;
        }

        if (getDeathMode() === "respawn") {
            // The other Pac-Mans keep playing: only the one that was
            // caught pays, and it comes back untouchable for a moment.
            respawnPlayer(gs.players[playerIndex] || player);
            state.setStatus("lifeLost");
            ui.updateUI();
            return;
        }

        gs.running = false;
        gs.deathTimer = 1.0;

        // The ghosts keep their frightened/eaten state during the death
        // pause; resetPositions restores them when the round restarts.

        state.setStatus("lifeLost");
        ui.updateUI();
    }

    // ============================================================
    // PAC-MAN DECISIONS
    // ============================================================
    //
    // Every Pac-Man decides inside the event queue, so a companion's
    // arrivals and decisions share the timing of the other actors and the
    // search explores them exactly like the followed one. The human drives
    // only the Pac-Man the game follows; the rest ask the search.

    function getReadyPlayerIndices() {
        const gs = gameState();
        const indices = [];

        gs.players.forEach((player, index) => {
            if (player.ready && player.lives > 0) {
                indices.push(index);
            }
        });

        return indices;
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

    // The player keeps controlling the selected ghost while it is eaten so
    // it can be driven back to the house.
    function getControlledGhostIndex() {
        const ghost = getControlledGhost();

        if (!ghost) {
            return -1;
        }

        return gameState().ghosts.indexOf(ghost);
    }

    // The search breaks ties between the players and the ghosts with a
    // hash of the state key. Reusing it here keeps the live decision order
    // and the search predictions identical.
    function getFirstActor(readyPlayerIndices, readyGhostIndices) {
        const playerReady = readyPlayerIndices.length > 0;

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
            readyPlayerIndices
        );

        return searchState.firstActor;
    }

    // One Pac-Man consumes its decision. The human drives only the Pac-Man
    // the game follows; the companions ask the search, exactly like an
    // automated followed player. Returns true when the decision was
    // consumed: a blocked Pac-Man with no input stops and only gets a new
    // chance at the next decision slot.
    function decidePlayer(playerIndex, readyGhostIndices) {
        const gs = gameState();
        const player = gs.players[playerIndex] || gs.player;
        const human = state.selectedCharacter.startsWith("pacman") &&
            player === gs.player;
        let direction = null;

        if (human) {
            const desired = findPressedDirection(player.x, player.y);

            if (desired && map.canMove(player.x, player.y, desired)) {
                direction = desired;
            }
        } else {
            const readyPlayerIndices = getReadyPlayerIndices();
            const chosen = intelligence.choosePacmanDirection(
                intelligence.getCurrentSearchContext(),
                readyGhostIndices,
                readyPlayerIndices
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
            setPlayerDirection(player, direction);
            player.ready = false;
            player.stopped = false;
            player.stopTimer = 0;

            if (human) {
                intelligence.recordHumanDecision?.(
                    "player",
                    playerIndex,
                    direction
                );
            }

            return true;
        }

        if (
            (player.direction.x !== 0 || player.direction.y !== 0) &&
            map.canMove(player.x, player.y, player.direction)
        ) {
            player.ready = false;
            player.stopped = false;
            player.stopTimer = 0;

            if (human) {
                intelligence.recordHumanDecision?.(
                    "player",
                    playerIndex,
                    player.direction
                );
            }

            return true;
        }

        // Blocked at a centre with no input: it is not a pending decision
        // any more, so the buffer and the ghost queries see a stopped
        // player instead of a ready one waiting forever.
        setPlayerDirection(player, { x: 0, y: 0 });
        player.ready = false;
        player.stopped = true;
        player.stopTimer = STOP_DECISION_INTERVAL;

        if (human) {
            intelligence.recordHumanDecision?.(
                "player",
                playerIndex,
                { x: 0, y: 0 }
            );
        }

        return false;
    }

    function decideGhosts(readyGhostIndices) {
        const gs = gameState();
        const readyPlayerIndices = getReadyPlayerIndices();
        const controlledIndex = getControlledGhostIndex();
        const automatedIndices = readyGhostIndices.filter(
            index => index !== controlledIndex
        );

        const directions = automatedIndices.length > 0
            ? intelligence.chooseGhostDirections(
                intelligence.getCurrentSearchContext(),
                automatedIndices,
                readyPlayerIndices
            )
            : new Map();

        for (const index of readyGhostIndices) {
            const ghost = gs.ghosts[index];

            if (index === controlledIndex) {
                const possible = getImmediateGhostDirections(ghost);
                const desired = findPressedDirection(ghost.x, ghost.y);
                let chosen = { ...ghost.direction };

                if (
                    desired &&
                    possible.some(direction =>
                        direction.x === desired.x &&
                        direction.y === desired.y
                    )
                ) {
                    chosen = desired;
                } else if (
                    !isDecidingBetweenCells(ghost) &&
                    !map.canMove(ghost.x, ghost.y, ghost.direction)
                ) {
                    // The player reached a wall without choosing: bounce
                    // back, which reads as being driven instead of the
                    // ghost picking a turn by itself.
                    const reversed = {
                        x: -ghost.direction.x,
                        y: -ghost.direction.y
                    };

                    chosen = map.canMove(ghost.x, ghost.y, reversed)
                        ? reversed
                        : getLegalGhostFallback(ghost);
                }

                applyGhostDecision(ghost, chosen);
                intelligence.recordHumanDecision?.(
                    "ghost",
                    index,
                    chosen
                );
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
        const readyGhostIndices = getReadyGhostIndices();
        const readyPlayerIndices = getReadyPlayerIndices();

        if (
            readyGhostIndices.length === 0 &&
            readyPlayerIndices.length === 0
        ) {
            return false;
        }

        const firstActor = getFirstActor(
            readyPlayerIndices,
            readyGhostIndices
        );
        let resolved = false;

        if (firstActor === "player" && readyPlayerIndices.length > 0) {
            resolved = decidePlayer(
                readyPlayerIndices[0],
                readyGhostIndices
            );

            // The human may be blocked at a centre with nobody to drive
            // it. The other ready actors still decide in this event.
            if (!resolved) {
                if (readyGhostIndices.length > 0) {
                    decideGhosts(readyGhostIndices);
                    resolved = true;
                } else {
                    for (const index of readyPlayerIndices.slice(1)) {
                        if (decidePlayer(index, readyGhostIndices)) {
                            resolved = true;
                            break;
                        }
                    }
                }
            }
        } else if (readyGhostIndices.length > 0) {
            decideGhosts(readyGhostIndices);
            resolved = true;
        } else if (readyPlayerIndices.length > 0) {
            resolved = decidePlayer(
                readyPlayerIndices[0],
                readyGhostIndices
            );
        }

        updatePositions();

        if (
            gameState().running &&
            getReadyGhostIndices().length === 0 &&
            getReadyPlayerIndices().length === 0 &&
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

            if (gs.deathTimer <= 0 && anyPlayerAlive()) {
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
                collisionedGhostIndex,
                collisionedPlayerIndex
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

            const arrivedPlayers = advanceCharactersToEvent(elapsed);
            remaining -= elapsed;

            for (const playerIndex of arrivedPlayers) {
                eatPelletAt(gs.players[playerIndex]);

                if (!gs.running) {
                    break;
                }
            }

            if (!gs.running) {
                break;
            }

            if (collisionedGhostIndex >= 0 && collisionedPlayerIndex >= 0) {
                const ghost = gs.ghosts[collisionedGhostIndex];

                if (ghost.frightened) {
                    eatGhost(ghost);
                } else if (!ghost.eaten) {
                    loseLife(collisionedPlayerIndex);
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
        const playerStarts = mapDefinition.playerStarts ||
            [mapDefinition.playerStart];

        gs.players.forEach((player, index) => {
            const start = playerStarts[index] || playerStarts[0];

            player.x = start.x;
            player.y = start.y;
            player.px = start.x;
            player.py = start.y;
            player.progress = 0;
            player.direction = { x: 0, y: 0 };
            player.nextDirection = { x: 0, y: 0 };
            player.ready = true;
            player.stopped = false;
            player.stopTimer = 0;
            player.invincibleUntil = 0;
        });

        const controlled = gs.players[getControlledPlayerIndex()];
        gs.player = controlled && controlled.lives > 0
            ? controlled
            : gs.players.find(player => player.lives > 0) || gs.players[0];
        syncFollowedLives();

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

        sanitizeGhostDirections(gs.ghosts);
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

        // The controlled ghost turns its eyes as soon as the key is
        // pressed; the movement still waits for a cell centre.
        const controlled = getControlledGhost();
        const pressedDirection = map.DIRECTIONS[name];

        if (controlled && pressedDirection) {
            controlled.facingDirection = { ...pressedDirection };
        }

        if (!gs.running && gs.deathTimer <= 0 && anyPlayerAlive()) {
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