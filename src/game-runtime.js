function createGameRuntime(context) {
    // ============================================================
    // GAME LOOP
    // ============================================================

    function gameLoop(time) {

        const dt =
            Math.min(
                (time - currentTime) / 1000,
                0.05
            );


        currentTime = time;


        update(dt);

        if (running) {
            gameIntelligence.advanceStrategicSearch();
        }

        draw();


        requestAnimationFrame(
            gameLoop
        );
    }


    async function start() {
        await loadPersistedMaps();
        updateMapSelector();
        resetGame();
        updateCharacterChoices();

        requestAnimationFrame(
            gameLoop
        );
    }

    return {
        start
    }
}
