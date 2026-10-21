function createGameRuntime(parameters = {}) {
    const {
        state,
        map,
        rules,
        intelligence,
        renderer
    } = parameters;

    // ============================================================
    // GAME LOOP
    // ============================================================

    function gameLoop(time) {
        const dt = Math.min((time - state.currentTime) / 1000, 0.05);

        state.currentTime = time;

        rules.update(dt);

        if (state.currentGameState.running) {
            intelligence.advanceSearch();
        }

        renderer.draw();

        requestAnimationFrame(gameLoop);
    }

    async function start() {
        const startedAt = Date.now();
        const mark = label => {
            console.log(
                `[startup] ${label}: ${Date.now() - startedAt}ms`
            );
        };

        await map.loadPersistedMaps();
        mark("maps");

        if (typeof intelligence.loadPersistedStrategyGraph === "function") {
            await intelligence.loadPersistedStrategyGraph();
            mark("strategy graph");
        }

        // Calibration is a property of each map definition. At startup
        // every map without a completed calibration is scheduled to be
        // calibrated in the background. The active map must be playable
        // immediately: `ensureMapCalibrated` reuses a completed reference
        // calibration when one exists (predefined maps are only a
        // fallback), otherwise it starts its own background calibration.
        console.log(
            "[calibration] startup: " +
            map.maps
                .map(definition =>
                    `${definition.id}:${definition.calibration?.status || "none"}` +
                    `(${definition.calibration?.sampleCount || 0})`
                )
                .join(", ")
        );

        map.ensureMapCalibrated(map.getCurrentMapDefinition());
        mark("calibration queued");

        // Only the active map is calibrated here; every other map is
        // calibrated when it becomes active.

        map.updateMapSelector();
        rules.resetGame();
        map.updateCharacterChoices();
        mark("playable");

        requestAnimationFrame(gameLoop);
    }

    return {
        start
    };
}
