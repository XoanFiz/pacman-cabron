function createGameAiController(parameters = {}) {
    const {
        config,
        state,
        map,
        geometry,
        model,
        rmfMinimax,
        workerBridge = null
    } = parameters;

    const {
        GHOST_SPEED
    } = config;

    const {
        createWorldSnapshot
    } = model;

    // ============================================================
    // STRATEGY OWNERSHIP
    // ============================================================
    //
    // The controller owns the simulation strategy and the optional
    // strategy/worker bridge. The strategy snapshots the map on
    // creation, so it must be rebuilt whenever the active map changes.

    let strategy = null;
    let strategyMapSignature = null;

    function computeMapSignature() {
        const definition = map.getCurrentMapDefinition();

        return JSON.stringify({
            id: definition.id,
            tiles: definition.tiles,
            edges: [...definition.edges].sort(),
            playerStarts: map.getPlayerStarts(definition),
            deathMode: map.getDeathMode(definition),
            ghostStarts: definition.ghostStarts
        });
    }

    function ensureStrategy() {
        const signature = computeMapSignature();

        if (strategy && signature === strategyMapSignature) {
            return strategy;
        }

        const definition = map.getCurrentMapDefinition();

        strategyMapSignature = signature;
        strategy = createGameStrategy({
            map: definition,
            geometry,
            model,
            config,
            rmfMinimax,
            worker: workerBridge
        });

        return strategy;
    }

    // ============================================================
    // SEARCH CONTEXT
    // ============================================================

    // Sends the state the game actually reached to the worker so the next
    // buffer starts from it.
    function anchorSearch() {
        const gameState = state.currentGameState;
        const readyGhostIndices = [];

        gameState.ghosts.forEach((ghost, index) => {
            if (ghost.needsDirection) {
                readyGhostIndices.push(index);
            }
        });

        ensureStrategy().anchorSearchContext(
            getCurrentSearchContext(),
            readyGhostIndices,
            getReadyPlayerIndices(gameState)
        );
    }

    // Every Pac-Man that has to decide right now, in index order.
    function getReadyPlayerIndices(gameState) {
        const players = gameState.players || [];
        const indices = [];

        players.forEach((player, index) => {
            if (
                player.ready &&
                (player.lives === undefined || player.lives > 0)
            ) {
                indices.push(index);
            }
        });

        return indices;
    }

    function getStrategyBufferMetrics() {
        return workerBridge?.getMetrics?.() || null;
    }

    function getCurrentSearchContext() {
        const gameState = state.currentGameState;
        const mapDefinition = map.getCurrentMapDefinition();
        const playerStarts = map.getPlayerStarts(mapDefinition);
        const players = gameState.players && gameState.players.length > 0
            ? gameState.players
            : [gameState.player];
        const controlledPlayerIndex = Math.max(
            0,
            players.indexOf(gameState.player)
        );
        const controlledStart = playerStarts[controlledPlayerIndex] ||
            playerStarts[0];
        const totalLives = players.every(player =>
            Number.isFinite(player.lives)
        )
            ? players.reduce(
                (total, player) => total + Math.max(0, player.lives),
                0
            )
            : gameState.lives;

        const world = createWorldSnapshot({
            player: gameState.player,
            players,
            ghosts: gameState.ghosts,
            pellets: gameState.pellets,
            lives: totalLives,
            time: gameState.time
        });

        return {
            ...world,

            // The Pac-Man the game follows (the one the human drives) and
            // the start of every other one, so the search knows where each
            // comes back after a death.
            controlledPlayerIndex,

            controlledGhostIndex: state.selectedCharacter.startsWith("ghost-")
                ? Number(state.selectedCharacter.slice("ghost-".length))
                : -1,

            // The map decides what happens when a Pac-Man is caught:
            // reset the whole round or respawn only the caught one.
            deathMode: map.getDeathMode(mapDefinition),

            respawnState: {
                player: {
                    x: controlledStart.x,
                    y: controlledStart.y
                },

                players: players.map((player, index) => {
                    const start = playerStarts[index] || playerStarts[0];

                    return { x: start.x, y: start.y };
                }),

                ghosts: mapDefinition.ghostStarts.map(start => ({
                    x: start.x,
                    y: start.y,
                    direction: { ...start.direction },
                    speed: GHOST_SPEED
                })),

                houses: map.buildGhostHouses(mapDefinition)
            }
        };
    }

    // ============================================================
    // STRATEGY DELEGATION
    // ============================================================

    function chooseGhostDirections(
        searchContext,
        readyGhostIndices,
        readyPlayerIndices = []
    ) {
        return ensureStrategy().chooseGhostDirections(
            searchContext,
            readyGhostIndices,
            readyPlayerIndices
        );
    }

    function choosePacmanDirection(
        searchContext,
        readyGhostIndices = [],
        readyPlayerIndices = undefined
    ) {
        return ensureStrategy().choosePacmanDirection(
            searchContext,
            readyGhostIndices,
            readyPlayerIndices
        );
    }

    function advanceSearch() {
        // With a worker the search lives there; looking the strategy up
        // here would rebuild the map signature on every frame.
        if (workerBridge) {
            return;
        }

        ensureStrategy().advanceSearch();
    }

    function setCalibration(calibration) {
        ensureStrategy().setCalibration(calibration);
    }

    function recordHumanDecision(mode, index, direction) {
        workerBridge?.recordHuman?.(mode, index, direction);
    }

    function calculateDomain(...args) {
        return ensureStrategy().calculateDomain(...args);
    }

    function createCurrentGameSearchState(...args) {
        return ensureStrategy().createCurrentGameSearchState(...args);
    }

    function getNodetype(...args){
        return  ensureStrategy().getNodetype(...args);
    }

    return {
        getCurrentSearchContext,
        anchorSearch,
        getStrategyBufferMetrics,
        chooseGhostDirections,
        choosePacmanDirection,
        advanceSearch,
        calculateDomain,
        createCurrentGameSearchState,
        getNodetype,
        setCalibration,
        recordHumanDecision
    };
}
