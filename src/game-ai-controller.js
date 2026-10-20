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
    // strategy-worker bridge. The strategy snapshots the map on
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

        strategyMapSignature = signature;
        strategy = createGameStrategy({
            map: map.getCurrentMapDefinition(),
            graph: map.graph ?? undefined,
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
        ensureStrategy().advanceSearch();
    }

    function calculateDomain(...args) {
        return ensureStrategy().calculateDomain(...args);
    }

    function createCurrentGameSearchState(...args) {
        return ensureStrategy().createCurrentGameSearchState(...args);
    }

    return {
        getCurrentSearchContext,
        chooseGhostDirections,
        choosePacmanDirection,
        advanceSearch,
        calculateDomain,
        createCurrentGameSearchState
    };
}