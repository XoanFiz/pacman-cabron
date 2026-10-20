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

    function createStrategyWorkerBridge() {
        if (typeof Worker !== "function") {
            return null;
        }

        const worker = new Worker("./src/strategy-worker.js");
        const latestWorkerActions = {
            ghost: null,
            player: null
        };
        let requestId = 0;

        worker.onmessage = event => {
            const message = event.data;

            if (message.type === "result") {
                latestWorkerActions[message.playerDirection
                    ? "player"
                    : "ghost"] = message;
            } else if (message.type === "error") {
                console.warn("Strategy worker failed.", message.error);
            }
        };

        return {
            requestAction({ mode, map, searchContext, readyGhostIndices, readyPlayer }) {
                worker.postMessage({
                    type: "request",
                    requestId: ++requestId,
                    mode,
                    map,
                    searchContext,
                    readyGhostIndices,
                    readyPlayer
                });
            },
            getAction(mode) {
                return latestWorkerActions[mode];
            }
        };
    }

    function initializeGame() {
        const config = createGameConfig();
        const geometry = createGameMapGeometry();
        const model = createGameModel();

        const state = createGameState({ config });
        const map = createGameMap({
            config,
            state,
            geometry,
            model,
            mapStorage: createGameMapStorage()
        });

        const intelligence = createGameAiController({
            config,
            state,
            map,
            geometry,
            model,
            rmfMinimax: createRandomizedBestFirstMinimax,
            workerBridge: createStrategyWorkerBridge()
        });

        const ui = createGameUi({ state });
        const rules = createGameRules({
            config,
            state,
            map,
            model,
            intelligence,
            ui
        });
        const renderer = createGameRenderer({
            config,
            state,
            map,
            strategy: intelligence
        });
        const editor = createGameEditor({ state, map, rules });
        createGameInput({ state, map, rules, ui, editor });
        const runtime = createGameRuntime({
            state,
            map,
            rules,
            intelligence,
            renderer
        });

        map.bindRuntime({
            resetGame: rules.resetGame,
            getCurrentSearchContext: intelligence.getCurrentSearchContext,
            createCurrentGameSearchState: intelligence.createCurrentGameSearchState
        });

        runtime.start();
        window.PACMAN_GAME = { config, state, map, intelligence, rules, ui, renderer, editor, runtime };
    }

    loadScript(0);
})();