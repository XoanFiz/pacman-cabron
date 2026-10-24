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
            revision: 0,
            late: 0,
            lost: 0,
            missing: {}
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

        // The plan nodes carry the key of the state they represent, so the
        // bridge can find its node again after the worker rebuilds the view.
        function findPlanNode(nodes, key) {
            for (let index = 0; index < nodes.length; index++) {
                const node = nodes[index];

                if (node && node.key === key) {
                    return index;
                }
            }

            return -1;
        }

        let lastProblemLogAt = 0;

        // Every time the plan cannot answer, the console says why and the
        // reason is counted: the plan is empty or from the previous anchor
        // (not updated yet), the node has no action (not enough search
        // done), the cursor went past the last node (the plan ran out) or
        // the state does not match the node.
        function logProblem(reason, detail = {}) {
            metrics.missing[reason] = (metrics.missing[reason] || 0) + 1;

            const now = Date.now();

            if (now - lastProblemLogAt < 1000) {
                return;
            }

            lastProblemLogAt = now;
            console.log(
                "[plan] " + reason + " " + JSON.stringify(detail) +
                " totals=" + JSON.stringify(metrics.missing)
            );
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

            if (message.mapId !== activeMapId) {
                return;
            }

            const incoming = message.plan || [];

            if (message.revision === revision) {
                // The first message of a new anchor may still be empty;
                // keep the previous plan until the new root exists. A
                // complete message will not be followed by another one.
                if (!incoming[0]) {
                    if (!message.complete) {
                        logProblem("waiting-new-plan", {
                            revision: message.revision
                        });
                    }

                    return;
                }

                if (message.revision !== planRevision) {
                    planRevision = message.revision;
                    plan = incoming;
                    cursor = 0;
                } else {
                    // A refreshed view of the tree the game is already
                    // following: keep its node and take the newer
                    // exploration instead of moving the cursor to the root.
                    const node = currentNode();
                    const index = node === null
                        ? -1
                        : findPlanNode(incoming, node.key);

                    plan = incoming;
                    cursor = index >= 0 ? index : 0;
                }
            } else {
                // A plan of an anchor the game already left is still a view
                // of the same tree. It is usable when it contains the state
                // the game reached: the key finds the node again and the
                // newer exploration comes with it. Only a plan that cannot
                // be placed is lost.
                const node = currentNode();
                const index = node === null
                    ? -1
                    : findPlanNode(incoming, node.key);

                if (index < 0 && node !== null) {
                    // Only the first plan of an anchor is a plan the game
                    // was waiting for: a refresh is just extra work.
                    if (message.first) {
                        metrics.lost++;
                        logProblem("stale-plan-dropped", {
                            revision: message.revision,
                            current: revision,
                            latency: message.latency
                        });
                    }

                    return;
                }

                // Without a cursor (the previous plan ran out or was
                // discarded) there is nothing to keep: the plan is stored
                // and the next decision places it by its state key.
                planRevision = message.revision;
                plan = incoming;
                cursor = index >= 0 ? index : null;
                metrics.late++;
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
            getPlanAction(mode, key) {
                let node = currentNode();

                // The worker rebuilds the plan while it explores, so a node
                // id can move between posts and a fallback decision can
                // leave the cursor on a branch the game did not take. The
                // state key is the stable reference: it finds the node that
                // represents the state the game reached.
                if (key !== undefined && (!node || node.key !== key)) {
                    const index = findPlanNode(plan, key);

                    if (index >= 0) {
                        cursor = index;
                        node = plan[index];
                    }
                }

                let reason = null;

                if (!node) {
                    reason = plan.length === 0
                        ? (planRevision === revision
                            ? "empty-plan"
                            : "plan-not-updated")
                        : "plan-exhausted";
                } else if (node.actor !== mode) {
                    reason = "actor-mismatch";
                } else if (!node.action) {
                    reason = "no-action";
                } else if (key !== undefined && node.key !== key) {
                    reason = "key-mismatch";
                }

                if (reason !== null) {
                    metrics.misses++;
                    logProblem(reason, {
                        mode,
                        cursor,
                        nodes: plan.length,
                        stale: planRevision !== revision,
                        time: node ? Number(node.time.toFixed(3)) : null
                    });

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
                // Pac-Man stopped against a wall has no direction to record:
                // the plan keeps its node for the next decision instead of
                // being thrown away.
                if (direction && direction.x === 0 && direction.y === 0) {
                    return;
                }

                const node = currentNode();

                if (!node || node.actor !== mode || !node.choices) {
                    logProblem("human-node-missing", {
                        mode,
                        cursor,
                        nodes: plan.length,
                        stale: planRevision !== revision,
                        node: node ? {
                            id: node.id,
                            actor: node.actor,
                            choices: node.choices
                                ? node.choices.length
                                : null,
                            child: node.child,
                            time: Number(node.time.toFixed(3))
                        } : null
                    });

                    // The plan is a view of the tree and the view may be
                    // truncated: a miss on the human node does not mean the
                    // rest of the plan is useless. Keep it, the next lookup
                    // seeks by state key and the next anchor replaces it.
                    // Discarding it here emptied the buffer for the whole
                    // decision and the AI played the cheap fallback.
                    return;
                }

                const choice = node.choices.find(option =>
                    option.direction.x === direction.x &&
                    option.direction.y === direction.y
                );

                if (!choice) {
                    logProblem("human-choice-not-in-plan", {
                        mode,
                        direction,
                        time: Number(node.time.toFixed(3))
                    });

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