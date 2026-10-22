(() => {
    const scripts = [
        "locales.js", "config.js", "strategy-protocol.js", "bindings.js", "model.js", "state.js", "map-storage.js", "map-geometry.js", "randomized-best-first-minimax.js", "calibration/protocol.js", "map.js",
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
        let missDiagnostics = 0;

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

            // Entries from a previous revision are still valid decisions
            // for their state keys, so they are kept while the new buffer
            // is being computed. The size bound keeps that from growing.
            receivedRevision = message.revision;

            for (const entry of message.entries || []) {
                buffer.set(entry.key, entry);
            }

            while (buffer.size > 256) {
                buffer.delete(buffer.keys().next().value);
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

                    return entry;
                }

                metrics.misses++;

                console.warn(
                    `[strategy buffer] miss ${mode}: ` +
                    `entries ${buffer.size}, ` +
                    `revision ${revision}/${receivedRevision}, ` +
                    `complete ${metrics.complete}`
                );

                if (missDiagnostics < 3) {
                    missDiagnostics++;

                    try {
                        const live = JSON.parse(stateKey);
                        let best = null;
                        let bestScore = -1;

                        for (const key of buffer.keys()) {
                            try {
                                const other = JSON.parse(key);
                                let score = 0;

                                if (JSON.stringify(live[0]) === JSON.stringify(other[0])) score += 8;
                                if (live[1] === other[1]) score += 1;
                                if (live[2] === other[2]) score += 1;
                                if (live[3] === other[3]) score += 1;
                                if (live[4] === other[4]) score += 2;
                                if (JSON.stringify(live[5]) === JSON.stringify(other[5])) score += 4;
                                if (live[6] === other[6]) score += 1;
                                if (JSON.stringify(live[7]) === JSON.stringify(other[7])) score += 1;

                                if (score > bestScore) {
                                    bestScore = score;
                                    best = other;
                                }
                            } catch (error) {
                                continue;
                            }
                        }

                        console.warn(
                            "[buffer] live state",
                            JSON.stringify({
                                lives: live[1],
                                controlled: live[3],
                                player: live[4],
                                ghosts: live[5],
                                readyPlayer: live[6],
                                readyGhosts: live[7]
                            })
                        );

                        if (best) {
                            console.warn(
                                "[buffer] nearest state",
                                JSON.stringify({
                                    lives: best[1],
                                    controlled: best[3],
                                    player: best[4],
                                    ghosts: best[5],
                                    readyPlayer: best[6],
                                    readyGhosts: best[7],
                                    pelletsEqual: JSON.stringify(live[0]) === JSON.stringify(best[0])
                                })
                            );
                        }
                    } catch (error) {
                        console.warn("Unable to describe the buffer miss.", error);
                    }
                }

                return null;
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