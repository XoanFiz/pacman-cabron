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
        await map.loadPersistedMaps();

        // Calibration is a property of each map definition. At startup
        // every map without a completed calibration is scheduled to be
        // calibrated in the background. The active map must be playable
        // immediately: `ensureMapCalibrated` reuses a completed reference
        // calibration when one exists (predefined maps are only a
        // fallback), otherwise it starts its own background calibration.
        map.ensureMapCalibrated(map.getCurrentMapDefinition());

        // Calibrate every other map definition in the background.
        void map.calibrateAllMaps();

        map.updateMapSelector();
        rules.resetGame();
        map.updateCharacterChoices();

        requestAnimationFrame(gameLoop);
    }

    return {
        start
    };
}
