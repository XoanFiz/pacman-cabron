(() => {
    const scripts = [
        "locales.js", "config.js", "strategy/protocol.js", "bindings.js", "model.js", "state.js", "map-storage.js", "map-geometry.js", "strategy/randomized-best-first-minimax.js", "calibration/protocol.js", "map.js",
        "strategy/strategy.js", "ai-controller.js", "rules.js", "renderer.js",
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

        const worker = new Worker("./src/strategy/worker.js");
        const metrics = {
            hits: 0,
            misses: 0,
            plans: 0,
            records: 0,
            nodes: 0,
            complete: false,
            revision: 0
        };
        let revision = 0;
        let activeMapId = null;
        let plan = [];
        let cursor = null;
        let planRevision = -1;

        function invalidatePlan() {
            plan = [];
            cursor = null;
        }

        function currentNode() {
            return cursor === null ? null : plan[cursor] || null;
        }

        worker.onmessage = event => {
            const message = event.data;

            if (message?.type === STRATEGY_BUFFER_MESSAGE.error) {
                console.warn("Strategy worker failed.", message.error);
                return;
            }

            if (message?.type !== STRATEGY_BUFFER_MESSAGE.plan) {
                return;
            }

            if (message.mapId !== activeMapId || message.revision !== revision) {
                return;
            }

            if (message.revision !== planRevision) {
                // The first message of a new anchor may still be empty;
                // keep the previous plan until the new root exists.
                if (!message.plan || !message.plan[0]) {
                    return;
                }

                planRevision = message.revision;
                plan = message.plan;
                cursor = 0;
            } else {
                plan = message.plan || [];

                if (cursor === null && plan[0]) {
                    cursor = 0;
                }
            }

            metrics.plans++;
            metrics.nodes = plan.filter(Boolean).length;
            metrics.complete = Boolean(message.complete);
            metrics.revision = revision;
        };

        return {
            anchor({ map, searchContext, readyGhostIndices, readyPlayer }) {
                if (map.id !== activeMapId) {
                    activeMapId = map.id;
                    invalidatePlan();
                    planRevision = -1;
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
            getPlanAction(mode) {
                const node = currentNode();

                if (!node || node.actor !== mode || !node.action) {
                    metrics.misses++;

                    return null;
                }

                // A node with human choices keeps the cursor until the
                // player's decision is recorded.
                if (!node.choices) {
                    cursor = node.child ?? null;
                }

                metrics.hits++;

                return node.action;
            },
            recordHuman(mode, index, direction) {
                const node = currentNode();

                if (!node || node.actor !== mode || !node.choices) {
                    invalidatePlan();

                    return;
                }

                const choice = node.choices.find(option =>
                    option.direction.x === direction.x &&
                    option.direction.y === direction.y
                );

                if (!choice) {
                    invalidatePlan();

                    return;
                }

                cursor = choice.child ?? null;
                metrics.records++;
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
            setCalibration: intelligence.setCalibration
        });

        runtime.start();


        window.PACMAN_GAME = { config, state, map, intelligence, rules, ui, renderer, editor, runtime };
    }

    loadScript(0);
})();