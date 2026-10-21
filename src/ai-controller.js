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
    let strategyMapId = null;

    let pendingGraph = null;
    let pendingGraphMapId = null;

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

        if (strategy) {
            persistStrategyGraph();
        }

        const definition = map.getCurrentMapDefinition();

        strategyMapSignature = signature;
        strategyMapId = definition.id;
        strategy = createGameStrategy({
            map: definition,
            graph: map.graph ?? undefined,
            geometry,
            model,
            config,
            rmfMinimax,
            worker: workerBridge
        });

        if (pendingGraph && pendingGraphMapId === strategyMapId) {
            strategy.importGraph(pendingGraph);
            pendingGraph = null;
            pendingGraphMapId = null;
        } else if (!workerOwnsStrategyData()) {
            void importPersistedStrategyGraph(strategy, strategyMapId);
        }

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
        // With a worker the main strategy is only a fallback; looking it up
        // here would rebuild the map signature on every frame.
        if (workerBridge?.ownsStrategyData) {
            return;
        }

        ensureStrategy().advanceSearch();
    }

    function setCalibration(calibration) {
        ensureStrategy().setCalibration(calibration);
    }

    // With a strategy worker the graph belongs to it: reading and importing
    // the record here only duplicates a large tree on the main thread and
    // blocks startup.
    function workerOwnsStrategyData() {
        return workerBridge?.ownsStrategyData === true;
    }

    async function loadPersistedStrategyGraph() {
        if (workerOwnsStrategyData()) {
            pendingGraph = null;
            pendingGraphMapId = null;
            return;
        }

        try {
            pendingGraph = await map.loadStrategyGraph(
                map.getCurrentMapDefinition().id
            );
            pendingGraphMapId = map.getCurrentMapDefinition().id;
        } catch (error) {
            console.warn("Unable to load the strategy graph.", error);
        }
    }

    async function importPersistedStrategyGraph(target, mapId) {
        if (workerOwnsStrategyData()) {
            return;
        }

        try {
            const graph = await map.loadStrategyGraph(mapId);

            if (graph && strategy === target && strategyMapId === mapId) {
                target.importGraph(graph);
            }
        } catch (error) {
            console.warn("Unable to load the strategy graph.", error);
        }
    }

    // The worker owns the value table. Without a worker the local strategy
    // still provides it for the calibration request.
    function persistStrategyValues(mapId) {
        if (workerBridge?.persistData) {
            return workerBridge.persistData(mapId);
        }

        if (!strategy || !strategyMapId || strategyMapId !== mapId) {
            return Promise.resolve(false);
        }

        try {
            return Promise.resolve(
                map.saveStrategyValues(
                    strategyMapId,
                    strategy.exportValueTable()
                )
            ).catch(error => {
                console.warn("Unable to save the strategy values.", error);
                return false;
            });
        } catch (error) {
            console.warn("Unable to export the strategy values.", error);
            return Promise.resolve(false);
        }
    }

    function persistStrategyGraph() {
        // The worker owns the explored graph and saves it periodically.
        // The local save stays only as a fallback when there is no worker.
        if (workerBridge?.persist) {
            workerBridge.persist();
            return;
        }

        if (!strategy || !strategyMapId) {
            return;
        }

        try {
            void map.saveStrategyGraph(strategyMapId, strategy.exportGraph())
                .catch(error => {
                    console.warn("Unable to save the strategy graph.", error);
                });
        } catch (error) {
            console.warn("Unable to save the strategy graph.", error);
        }
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
        loadPersistedStrategyGraph,
        persistStrategyGraph,
        persistStrategyValues
    };
}