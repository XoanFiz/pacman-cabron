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
            playerStart: definition.playerStart,
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
            Boolean(gameState.player.ready)
        );
    }

    function getStrategyBufferMetrics() {
        return workerBridge?.getMetrics?.() || null;
    }

    function getCurrentSearchContext() {
        const gameState = state.currentGameState;
        const mapDefinition = map.getCurrentMapDefinition();

        const world = createWorldSnapshot({
            player: gameState.player,
            ghosts: gameState.ghosts,
            pellets: gameState.pellets,
            lives: gameState.lives,
            time: gameState.time
        });

        return {
            ...world,

            controlledGhostIndex: state.selectedCharacter.startsWith("ghost-")
                ? Number(state.selectedCharacter.slice("ghost-".length))
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

                houses: map.buildGhostHouses(mapDefinition)
            }
        };
    }

    // ============================================================
    // STRATEGY DELEGATION
    // ============================================================

    function chooseGhostDirections(searchContext, readyGhostIndices, readyPlayer = false) {
        return ensureStrategy().chooseGhostDirections(
            searchContext,
            readyGhostIndices,
            readyPlayer
        );
    }

    function choosePacmanDirection(searchContext, readyGhostIndices = []) {
        return ensureStrategy().choosePacmanDirection(
            searchContext,
            readyGhostIndices
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