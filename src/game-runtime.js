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
        map.updateMapSelector();
        rules.resetGame();
        map.updateCharacterChoices();

        requestAnimationFrame(gameLoop);
    }

    return {
        start
    };
}
