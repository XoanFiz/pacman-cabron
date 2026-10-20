(() => {
    const scripts = [
        "locales.js", "game-config.js", "game-bindings.js", "game-model.js", "game-state.js", "game-map-storage.js", "game-map-geometry.js", "randomized-best-first-minimax.js", "calibration-runner.js", "game-map.js",
        "game-strategy.js", "game-ai-controller.js", "game-rules.js", "game-renderer.js",
        "game-ui.js", "game-editor.js", "game-input.js", "game-runtime.js"
    ];

    const loadScript = index => {
        if (index === scripts.length) {
            initializeGame();
            return;
        }
        const script = document.createElement("script");
        script.src = "./src/" + scripts[index];
        script.onload = () => loadScript(index + 1);
        script.onerror = () => {
            document.getElementById("status").textContent =
                "Unable to load game resources. Please reload the page.";
        };
        document.body.append(script);
    };

    function initializeGame() {
        const context = {
            ...createGameConfig(),
            running: false, paused: false, gameWon: false, deathTimer: 0,
            selectedCharacter: "pacman", editorMode: false, editorGesture: null,
            editorToastTimer: 0, addingGhost: false, currentTime: 0
        };
        const { publish } = createGameBindings(context);

        publish(createGameModel(context));
        publish(createGameState(context));
        publish(createGameMap(context));
        publish(createGameStrategy(context));
        publish(createGameAiController(context));
        context.chooseStrategicGhostDirections = context.chooseGhostDirections;
        context.chooseStrategicPacmanDirection = context.choosePacmanDirection;
        context.advanceStrategicSearch = context.advanceSearch;
        context.gameIntelligence = context;
        publish(createGameRules(context));
        publish(createGameRenderer(context));
        publish(createGameUi(context));
        publish(createGameEditor(context));
        publish(createGameInput(context));
        publish(createGameRuntime(context));
        context.start();
        window.PACMAN_GAME = context;
    }

    loadScript(0);
})();
