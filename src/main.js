(() => {
    const scripts = [
        "locales.js", "config.js", "strategy-version.js", "strategy-protocol.js", "bindings.js", "model.js", "state.js", "map-storage.js", "map-geometry.js", "randomized-best-first-minimax.js", "calibration/protocol.js", "map.js",
        "strategy.js", "ai-controller.js", "rules.js", "renderer.js",
        "ui.js", "editor.js", "input.js", "runtime.js"
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
        const buffer = new Map();
        const metrics = {
            hits: 0,
            misses: 0,
            buffers: 0,
            entries: 0,
            complete: false,
            revision: 0
        };
        let revision = 0;
        let receivedRevision = 0;
        let activeMapId = null;

        worker.onmessage = event => {
            const message = event.data;

            if (message?.type === STRATEGY_BUFFER_MESSAGE.error) {
                console.warn("Strategy worker failed.", message.error);
                return;
            }

            if (message?.type !== STRATEGY_BUFFER_MESSAGE.buffer) {
                return;
            }

            if (message.mapId !== activeMapId || message.revision !== revision) {
                return;
            }

            if (message.revision !== receivedRevision) {
                receivedRevision = message.revision;
                buffer.clear();
            }

            for (const entry of message.entries || []) {
                buffer.set(entry.key, entry);
            }

            metrics.buffers++;
            metrics.entries = buffer.size;
            metrics.complete = Boolean(message.complete);
            metrics.revision = revision;
        };

        return {
            anchor({ map, searchContext, readyGhostIndices, readyPlayer }) {
                if (map.id !== activeMapId) {
                    activeMapId = map.id;
                    buffer.clear();
                    revision = 0;
                }

                revision++;

                worker.postMessage({
                    type: STRATEGY_BUFFER_MESSAGE.anchor,
                    revision,
                    map,
                    searchContext,
                    readyGhostIndices,
                    readyPlayer
                });
            },
            getAction(mode, stateKey) {
                const entry = buffer.get(stateKey);

                if (entry) {
                    metrics.hits++;
                } else {
                    metrics.misses++;
                }

                const lookups = metrics.hits + metrics.misses;

                if (lookups % 120 === 0) {
                    console.info(
                        `[strategy buffer] hits ${metrics.hits}` +
                        ` misses ${metrics.misses}` +
                        ` entries ${metrics.entries}`
                    );
                }

                return entry || null;
            },
            getMetrics() {
                return { ...metrics };
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
            createCurrentGameSearchState: intelligence.createCurrentGameSearchState,
            setCalibration: intelligence.setCalibration,
            getStrategyValues: intelligence.getStrategyValues
        });

        runtime.start();

        window.addEventListener("pagehide", () => {
            intelligence.persistStrategyGraph();
        });


        window.PACMAN_GAME = { config, state, map, intelligence, rules, ui, renderer, editor, runtime };
    }

    loadScript(0);
})();