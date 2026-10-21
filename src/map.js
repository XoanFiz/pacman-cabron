function createGameMap(parameters = {}) {
    const {
        config,
        state,
        geometry,
        model,
        mapStorage
    } = parameters;

    const {
        CELL
    } = config;

    const DIRECTIONS = geometry.DIRECTIONS;

    // Late-bound runtime dependencies (wired by main.js once created).
    const runtime = {
        resetGame: () => undefined,
        getCurrentSearchContext: () => null,
        createCurrentGameSearchState: () => null,
        setCalibration: () => undefined,
        getStrategyGraph: () => null
    };

    function bindRuntime({ resetGame, getCurrentSearchContext, createCurrentGameSearchState, setCalibration, getStrategyGraph }) {
        if (resetGame) runtime.resetGame = resetGame;
        if (getCurrentSearchContext) runtime.getCurrentSearchContext = getCurrentSearchContext;
        if (createCurrentGameSearchState) runtime.createCurrentGameSearchState = createCurrentGameSearchState;
        if (setCalibration) runtime.setCalibration = setCalibration;
        if (getStrategyGraph) runtime.getStrategyGraph = getStrategyGraph;
    }

    // ============================================================
    // MAP DEFINITIONS
    // ============================================================

    function toTiles(rows) {
        return rows.map(row => Array.from(row));
    }

    function cloneMapPosition(position) {
        return {
            x: position.x,
            y: position.y,
            ...(position.color !== undefined && {
                color: position.color
            }),
            ...(position.direction && {
                direction: { ...position.direction }
            })
        };
    }

    function cloneCalibration(calibration) {
        if (calibration === undefined) {
            return undefined;
        }

        return {
            ...calibration,
            parameters: calibration.parameters
                ? { ...calibration.parameters }
                : undefined,
            f: calibration.f ? { ...calibration.f } : {},
            g: calibration.g ? { ...calibration.g } : {},
            samples: calibration.samples
                ? Object.fromEntries(
                    Object.entries(calibration.samples).map(
                        ([key, errors]) => [key, [...errors]]
                    )
                )
                : undefined
        };
    }

    function cloneMapDefinition(definition,
        { includeCalibration = false } = {}) {
        return {
            ...definition,
            tiles: definition.tiles.map(row => [...row]),
            edges: new Set(definition.edges),
            playerStart: cloneMapPosition(definition.playerStart),
            ghostStarts: definition.ghostStarts.map(cloneMapPosition),

            ...(includeCalibration && definition.calibration !== undefined
                ? { calibration: cloneCalibration(definition.calibration) }
                : { calibration: undefined })
        };
    }

    const PREDEFINED_MAPS = [

        // --------------------------------------------------------
        // CLASSIC
        // --------------------------------------------------------

        {
            id: "classic",
            nameKey: "classicMap",

            tiles: toTiles([
                "####################",
                "#........##........#",
                "#.####.#.##.#.####.#",
                "#o####.#.##.#.####o#",
                "#..................#",
                "#.####.###.#######.#",
                "#......#...#.......#",
                "######.#.###.#.######",
                "     #.#...H.#.#     ",
                "######.#.###.#.######",
                "............#.......#",
                "#.####.###.###.####.#",
                "#o..##........##..o.",
                "###.##.##.##.##.####",
                "#......#....#.......#",
                "#.####.#.##.#.####..#",
                "#..................#",
                "####################"
            ]),

            edges: new Set(),

            playerStart: {
                x: 10,
                y: 10,
                direction: { x: 0, y: 0 }
            },

            ghostStarts: [
                { x: 9, y: 8, direction: { x: 1, y: 0 } },
                { x: 10, y: 8, direction: { x: -1, y: 0 } },
                { x: 11, y: 10, direction: { x: -1, y: 0 } }
            ]
        },


        // --------------------------------------------------------
        // BOUNDARY-ONLY
        // --------------------------------------------------------

        {
            id: "boundary-only",
            nameKey: "boundaryMap",

            tiles: toTiles([
                "....................",
                "....................",
                "....................",
                "....................",
                "....................",
                "....................",
                "....................",
                "....................",
                "......... H.........",
                "....................",
                "..........  ........",
                "....................",
                "....................",
                "....................",
                "....................",
                "....................",
                "....................",
                "...o................"
            ]),

            edges: new Set([

                // Vertical boundaries.

                "v:1:1", "v:2:1", "v:3:1", "v:4:1",
                "v:5:1", "v:6:1", "v:7:1",
                "v:10:1", "v:11:1", "v:12:1", "v:13:1",
                "v:14:1", "v:15:1", "v:16:1", "v:17:1",
                "v:18:1", "v:19:1",

                "v:1:3", "v:2:3", "v:3:3",
                "v:6:3", "v:7:3", "v:8:3", "v:9:3",
                "v:10:3", "v:11:3", "v:12:3", "v:13:3",
                "v:14:3", "v:15:3", "v:16:3", "v:17:3",
                "v:18:3", "v:19:3",

                "v:0:5", "v:1:5", "v:2:5", "v:3:5",
                "v:5:5", "v:6:5", "v:7:5", "v:8:5",
                "v:9:5", "v:10:5", "v:11:5", "v:12:5",
                "v:13:5", "v:14:5", "v:15:5", "v:16:5",
                "v:17:5",

                "v:0:7", "v:1:7", "v:2:7", "v:3:7",
                "v:5:7", "v:6:7", "v:7:7", "v:8:7",
                "v:9:7", "v:10:7", "v:11:7", "v:12:7",
                "v:13:7", "v:16:7", "v:17:7", "v:18:7",

                "v:0:9", "v:1:9", "v:2:9", "v:3:9",
                "v:4:9", "v:5:9", "v:6:9", "v:7:9",
                "v:8:9", "v:9:9", "v:12:9", "v:13:9",
                "v:14:9", "v:15:9", "v:16:9", "v:17:9",
                "v:18:9",

                "v:0:11", "v:1:11", "v:2:11", "v:3:11",
                "v:4:11", "v:5:11", "v:8:11", "v:9:11",
                "v:10:11", "v:11:11", "v:12:11", "v:13:11",
                "v:14:11", "v:15:11", "v:16:11", "v:17:11",
                "v:18:11", "v:19:11",

                "v:0:13", "v:1:13", "v:5:13", "v:6:13",
                "v:7:13", "v:8:13", "v:9:13", "v:10:13",
                "v:11:13", "v:12:13", "v:13:13", "v:14:13",
                "v:15:13", "v:16:13", "v:17:13", "v:18:13",
                "v:19:13",

                "v:0:15", "v:1:15", "v:2:15", "v:3:15",
                "v:5:15", "v:6:15", "v:7:15", "v:8:15",
                "v:9:15", "v:10:15", "v:11:15", "v:12:15",
                "v:13:15", "v:14:15", "v:15:15",
                "v:18:15", "v:19:15",

                // Horizontal boundaries.

                "h:3:0", "h:3:1", "h:3:3", "h:3:4",
                "h:3:5", "h:3:6", "h:3:7", "h:3:8",
                "h:3:9", "h:3:10", "h:3:11", "h:3:12",
                "h:3:13", "h:3:14", "h:3:15",

                "h:7:0", "h:7:1", "h:7:2", "h:7:3",
                "h:7:7", "h:7:8", "h:7:9", "h:7:10",
                "h:7:11", "h:7:12", "h:7:14", "h:7:16",

                "h:11:0", "h:11:1", "h:11:2", "h:11:3",
                "h:11:4", "h:11:5", "h:11:6", "h:11:7",
                "h:11:10", "h:11:11", "h:11:12", "h:11:13",
                "h:11:14", "h:11:15", "h:11:16", "h:11:17",

                "h:15:1", "h:15:3", "h:15:5", "h:15:7",
                "h:15:8", "h:15:9", "h:15:11", "h:15:14",
                "h:15:16", "h:15:17"
            ]),

            playerStart: {
                x: 10,
                y: 10,
                direction: { x: 0, y: 0 }
            },

            ghostStarts: [
                { x: 9, y: 8, direction: { x: 1, y: 0 } },
                { x: 10, y: 8, direction: { x: -1, y: 0 } },
                { x: 11, y: 10, direction: { x: -1, y: 0 } }
            ]
        }
    ];;

    // ============================================================
    // MAP STATE
    // ============================================================

    const map = {
        maps: PREDEFINED_MAPS.map(cloneMapDefinition),
        activeMapId: "classic",
        editorDraftMap: null,
        nextCustomMapNumber: 1,
        currentMap: null,
        graph: null,
        mapStorageReady: false,

        strategicSearch: {
            nodes: new Map(),
            frontier: [],
            root: null
        }
    };

    map.currentMap = cloneMapDefinition(map.maps[0], {
        includeCalibration: true
    });

    state.canvas.width = geometry.getMapColumnCount(map.maps[0]) * CELL;
    state.canvas.height = geometry.getMapRowCount(map.maps[0]) * CELL;

    // ============================================================
    // PERSISTENCE
    // ============================================================

    async function loadPersistedMaps() {
        try {
            const persisted = await mapStorage.load();

            if (!persisted) {
                map.mapStorageReady = true;
                return;
            }

            const definitionsById = new Map(
                PREDEFINED_MAPS.map(definition => [
                    definition.id,
                    cloneMapDefinition(definition)
                ])
            );

            for (const persistedDefinition of persisted.maps || []) {
                if (!persistedDefinition?.id || !persistedDefinition.tiles) {
                    continue;
                }

                definitionsById.set(
                    persistedDefinition.id,
                    cloneMapDefinition(persistedDefinition, {
                        includeCalibration: true
                    })
                );
            }

            map.maps = Array.from(definitionsById.values());

            if (map.maps.some(definition => definition.id === persisted.activeMapId)) {
                map.activeMapId = persisted.activeMapId;
            }

            const customNumbers = map.maps
                .map(definition => definition.customNumber)
                .filter(Number.isFinite);
            const nextAvailableNumber = customNumbers.length > 0
                ? Math.max(...customNumbers) + 1
                : 1;

            map.nextCustomMapNumber = Math.max(
                nextAvailableNumber,
                Number(persisted.nextCustomMapNumber) || 1
            );
            map.currentMap = cloneMapDefinition(
                map.maps.find(definition => definition.id === map.activeMapId) || map.maps[0],
                { includeCalibration: true }
            );
        } catch (error) {
            console.warn("Unable to load saved maps from IndexedDB.", error);
        } finally {
            map.mapStorageReady = true;
        }
    }

    let mapPersistenceQueue = Promise.resolve();

    function persistMaps() {
        mapPersistenceQueue = mapPersistenceQueue
            .catch(() => undefined)
            .then(() => mapStorage.save(map.maps, {
                activeMapId: map.activeMapId,
                nextCustomMapNumber: map.nextCustomMapNumber
            }))
            .catch(error => {
                console.warn("Unable to save maps in IndexedDB.", error);
                return false;
            });

        return mapPersistenceQueue;
    }

    // ============================================================
    // MAP UTILITIES
    // ============================================================

    function getCurrentMapDefinition() {
        return map.editorDraftMap ||
            map.maps.find(definition => definition.id === map.activeMapId) ||
            map.maps[0];
    }

    function getMapLabel(definition) {
        return definition.nameKey
            ? state.messages[definition.nameKey]
            : `${state.messages.customMap} ${definition.customNumber}`;
    }

    function getMapRowCount(definition = map.currentMap) {
        return geometry.getMapRowCount(definition);
    }

    function getMapColumnCount(definition = map.currentMap) {
        return geometry.getMapColumnCount(definition);
    }

    function wrap(value, size) {
        return geometry.wrap(value, size);
    }

    function getWrappedPosition(x, y, definition = map.currentMap) {
        return {
            x: wrap(x, getMapColumnCount(definition)),
            y: wrap(y, getMapRowCount(definition))
        };
    }

    function getPossibleDirections(character) {
        return [
            DIRECTIONS.up,
            DIRECTIONS.down,
            DIRECTIONS.left,
            DIRECTIONS.right
        ].filter(direction =>
            canMove(
                character.x,
                character.y,
                direction
            )
        );
    }

    function getBoundaryKey(x, y, direction, definition = map.currentMap) {
        return geometry.getBoundaryKey(x, y, direction, definition);
    }

    function isWall(x, y, definition = map.currentMap) {
        return geometry.isWall(x, y, definition);
    }

    function isBoundaryBlocked(x, y, direction, definition = map.currentMap) {
        return geometry.isBoundaryBlocked(x, y, direction, definition);
    }

    function canMove(x, y, direction, definition = map.currentMap) {
        return geometry.canMove(x, y, direction, definition);
    }

    // ============================================================
    // MAP CONTENT
    // ============================================================

    function buildPellets(definition = map.currentMap) {
        const result = new Set();

        definition.tiles.forEach((row, y) => {
            row.forEach((tile, x) => {
                if (tile === "." || tile === "o") {
                    result.add(`${x},${y}`);
                }
            });
        });

        return result;
    }

    function buildGhostHouses(definition = map.currentMap) {
        const ghostHouses = [];

        for (let y = 0; y < getMapRowCount(definition); y++) {
            for (let x = 0; x < getMapColumnCount(definition); x++) {
                if (definition.tiles[y][x] === "H") {
                    ghostHouses.push({ x, y });
                }
            }
        }

        return ghostHouses;
    }

    function buildMapData(definition) {
        return {
            graph: buildGraph(definition),
            pellets: buildPellets(definition),
            calibration: cloneCalibration(definition.calibration)
        };
    }

    // ============================================================
    // MAP SELECTOR
    // ============================================================

    function updateMapSelector() {
        state.mapSelectElement.replaceChildren();

        for (const definition of map.maps) {
            const option = document.createElement("option");

            option.value = definition.id;
            option.textContent = getMapLabel(definition);

            state.mapSelectElement.append(option);
        }

        state.mapSelectElement.value = map.activeMapId;
    }

    // ============================================================
    // CHARACTER ICONS
    // ============================================================

    function createGhostIcon(color, className) {
        const svg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg"
        );

        svg.setAttribute("viewBox", "0 0 48 48");
        svg.setAttribute("aria-hidden", "true");
        svg.classList.add(className);

        const path = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path"
        );

        path.setAttribute(
            "d",
            "M5 43V23a19 19 0 0 1 38 0v20l-7-5-7 5-7-5-7 5-5-5Z"
        );

        path.setAttribute("fill", color);
        svg.append(path);

        for (const x of [18, 31]) {
            const eye = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "ellipse"
            );

            eye.setAttribute("cx", String(x));
            eye.setAttribute("cy", "23");
            eye.setAttribute("rx", "5");
            eye.setAttribute("ry", "7");
            eye.setAttribute("fill", "white");

            svg.append(eye);
        }

        for (const x of [20, 33]) {
            const pupil = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "circle"
            );

            pupil.setAttribute("cx", String(x));
            pupil.setAttribute("cy", "24");
            pupil.setAttribute("r", "2.5");
            pupil.setAttribute("fill", "#111827");

            svg.append(pupil);
        }

        return svg;
    }

    function getGhostName(index, ghostStarts = map.currentMap.ghostStarts) {
        const standardNames = [
            "redGhost",
            "orangeGhost",
            "pinkGhost"
        ];

        if (index < standardNames.length) {
            return state.messages[standardNames[index]];
        }

        return state.messages.ghostNumber.replace(
            "{number}",
            String(index + 1)
        );
    }

    function selectCharacter(button) {
        state.selectedCharacter = button.dataset.character;
        runtime.resetGame();
        state.startScreenElement.hidden = true;
    }

    function updateCharacterChoices() {
        const ghostStarts = getCurrentMapDefinition().ghostStarts;

        state.ghostCharacterChoicesElement.replaceChildren();

        for (let index = 0; index < ghostStarts.length; index++) {
            const name = getGhostName(index, ghostStarts);
            const button = document.createElement("button");

            button.className = "character-choice";
            button.dataset.character = `ghost-${index}`;
            button.setAttribute("aria-label", name);

            const icon = createGhostIcon(
                ghostStarts[index].color || state.getGhostColor(index),
                "character-figure"
            );

            const label = document.createElement("span");
            label.textContent = name;

            button.append(icon, label);

            button.addEventListener(
                "click",
                () => selectCharacter(button)
            );

            state.ghostCharacterChoicesElement.append(button);
        }
    }

    // ============================================================
    // MAP EDITOR / CALIBRATION
    // ============================================================
    //
    // Calibration runs in a Worker, i.e. in another thread with its own
    // global scope. The message contract lives in calibration/protocol.js;
    // this file is the main-thread side and must use its constants.

    function getMapSignature(definition) {
        return JSON.stringify({
            tiles: definition.tiles,
            edges: [...definition.edges].sort(),
            playerStart: definition.playerStart,
            ghostStarts: definition.ghostStarts
        });
    }

    function createPendingCalibration(definition) {
        return {
            status: "pending",
            version: CALIBRATION_VERSION,
            mapSignature: getMapSignature(definition),
            sampleCount: 0,
            targetSamples: CALIBRATION_DEFAULT_OPTIONS.targetSamples,
            parameters: { ...CALIBRATION_DEFAULT_OPTIONS }
        };
    }

    function isCalibrationVersionCurrent(calibration) {
        return calibration?.version === CALIBRATION_VERSION;
    }

    function isCalibrationCompleted(definition) {
        return definition?.calibration?.status === "completed" &&
            isCalibrationVersionCurrent(definition.calibration);
    }

    function hasCalibrationSamples(definition) {
        const calibration = definition?.calibration;

        return isCalibrationVersionCurrent(calibration) &&
            Boolean(calibration.samples) &&
            Object.keys(calibration.samples).length > 0;
    }

    function hasUsableCalibration(definition) {
        const calibration = definition?.calibration;

        return isCalibrationVersionCurrent(calibration) &&
            Number(calibration.sampleCount) > 0 &&
            Object.keys(calibration.f || {}).length > 0;
    }

    function getCalibrationResume(definition) {
        const calibration = definition?.calibration;

        if (
            !isCalibrationVersionCurrent(calibration) ||
            calibration.status === "completed"
        ) {
            return { samples: {} };
        }

        return {
            samples: calibration.samples && typeof calibration.samples === "object"
                ? calibration.samples
                : {}
        };
    }

    function notifyCalibration(definition) {
        if (definition.id !== map.activeMapId) {
            return;
        }

        runtime.setCalibration(definition.calibration);
    }

    // ============================================================
    // CALIBRATION
    // ============================================================
    //
    // Calibration is a property of a MAP DEFINITION, not of the active
    // map or the live game state. Every helper below works from a
    // `definition` alone so that maps can be calibrated in the
    // background (at startup and right after saving) without touching
    // `map.currentMap`, `map.activeMapId`, the canvas or the running
    // game. The initial search state is rebuilt purely from the
    // definition (players/ghosts/pellets/houses) instead of reading
    // pseudo-global runtime state.
    //
    // The RBFM engine relies on score distributions. Without
    // calibration every node distribution has standardDeviation 0,
    // which makes child selection deterministic and can drive the
    // recursive `extend` into an unbounded descent. Calibrating every
    // map (predefined or custom) keeps the search well behaved.
    //
    // Predefined maps are only a FALLBACK reference: when the game
    // starts and a map has no calibration of its own, the completed
    // calibration of the first available map is reused so the game
    // never runs completely uncalibrated.

    // Builds the initial search state for a definition, with no
    // dependency on the active map or the live game state.
    function createCalibrationInitialState(definition) {
        const player = model.createPlayerState(
            definition.playerStart,
            config.PACMAN_SPEED
        );

        const ghosts = definition.ghostStarts.map((start, index) =>
            model.createGhostState(
                start,
                start.color || state.getGhostColor(index),
                config.GHOST_SPEED
            )
        );

        const searchContext = {
            player,
            ghosts,
            pellets: buildPellets(definition),
            lives: config.INITIAL_LIVES,
            time: 0,
            controlledGhostIndex: -1,
            respawnState: {
                player: {
                    x: definition.playerStart.x,
                    y: definition.playerStart.y
                },
                ghosts: definition.ghostStarts.map(start => ({
                    x: start.x,
                    y: start.y,
                    direction: { ...start.direction },
                    speed: config.GHOST_SPEED
                })),
                houses: buildGhostHouses(definition)
            }
        };

        const readyGhostIndices = ghosts.map((_, index) => index);

        // Reuse the strategy's canonical state adapter so the worker
        // receives exactly the same shape the game would produce.
        return runtime.createCurrentGameSearchState(
            searchContext,
            readyGhostIndices,
            true
        );
    }

    // Calibrates a single definition in the background. Returns a
    // promise that resolves with the final calibration object (never
    // rejects). `onProgress` receives the worker progress status.
    function calibrateMap(definition, {
        onProgress,
        useGraph = true,
        fresh = false,
        allowDriftRetry = true
    } = {}) {
        if (calibrationInFlight.has(definition.id)) {
            return calibrationInFlight.get(definition.id);
        }

        const calibrationPromise = new Promise(resolve => {
            if (typeof Worker !== "function") {
                definition.calibration = {
                    ...definition.calibration,
                    status: "error",
                    error: "Web Worker is unavailable."
                };
                console.warn(
                    `[calibration] ${definition.id}: Web Worker unavailable.`
                );
                void persistMaps();
                resolve(definition.calibration);
                return;
            }

            let initialState;

            try {
                initialState = createCalibrationInitialState(definition);
            } catch (error) {
                definition.calibration = {
                    ...definition.calibration,
                    status: "error",
                    error: String(error)
                };
                console.warn(
                    `[calibration] ${definition.id}: unable to build initial state.`,
                    error
                );
                void persistMaps();
                resolve(definition.calibration);
                return;
            }

            const worker = new Worker("./src/calibration/worker.js");
            const resume = fresh
                ? { samples: {} }
                : getCalibrationResume(definition);
            const resumeCount = Object.values(resume.samples)
                .reduce((sum, errors) => sum + errors.length, 0);
            const strategyGraph = useGraph &&
                typeof runtime.getStrategyGraph === "function"
                ? runtime.getStrategyGraph(definition.id)
                : null;
            const assumedCalibration = !fresh && definition.calibration?.f
                ? {
                    f: { ...definition.calibration.f },
                    g: { ...(definition.calibration.g || {}) }
                }
                : null;
            let lastHeartbeatAt = Date.now();

            definition.calibration = {
                ...definition.calibration,
                version: CALIBRATION_VERSION,
                status: "running",
                parameters: {
                    ...definition.calibration?.parameters,
                    referenceHorizonSeconds:
                        CALIBRATION_DEFAULT_OPTIONS.referenceHorizonSeconds
                }
            };

            console.log(
                `[calibration] ${definition.id}: started ` +
                `(target ${CALIBRATION_DEFAULT_OPTIONS.targetSamples} samples, ` +
                `max ${CALIBRATION_DEFAULT_OPTIONS.maxSteps} steps, ` +
                `resuming ${resumeCount} sample(s), ` +
                `graph ${strategyGraph ? strategyGraph.nodes.length : 0} node(s), ` +
                `assumed ${assumedCalibration ? "yes" : "no"}).`
            );

            let settled = false;

            const finish = calibration => {
                if (settled) return;
                settled = true;
                worker.terminate();
                definition.calibration = calibration;
                void persistMaps();
                notifyCalibration(definition);
                calibrationInFlight.delete(definition.id);
                resolve(calibration);
            };

            const finishWithError = error => {
                console.warn(
                    `[calibration] ${definition.id}: failed.`,
                    error
                );
                finish({
                    ...definition.calibration,
                    status: "error",
                    error: String(error)
                });
            };

            worker.onerror = event => {
                finishWithError(
                    event.error || event.message || "Worker error."
                );
            };

            worker.onmessage = event => {
                const message = event.data;

                if (message.type === CALIBRATION_MESSAGE.progress) {
                    const status = message.status;
                    const previousSampleCount =
                        definition.calibration.sampleCount;

                    definition.calibration = {
                        ...definition.calibration,
                        version: CALIBRATION_VERSION,
                        status: "running",
                        sampleCount: status.completed,
                        steps: status.steps,
                        samples: status.samples,
                        progress: status
                    };

                    // Persist and hand the partial tables to the game only
                    // when a new sample lands, not on every step.
                    if (status.completed !== previousSampleCount) {
                        void persistMaps();
                        notifyCalibration(definition);
                        console.log(
                            `[calibration] ${definition.id}: ` +
                            `${status.completed}/${status.targetSamples} samples ` +
                            `(${Math.round((status.percent || 0) * 100)}%, ` +
                            `eta ${formatCalibrationEta(status.etaMs)}), ` +
                            `step ${status.steps}, ${status.buckets} bucket(s).`
                        );
                    } else if (Date.now() - lastHeartbeatAt > 2000) {
                        lastHeartbeatAt = Date.now();
                        console.log(
                            `[calibration] ${definition.id}: ` +
                            `step ${status.steps}, ${status.pending} pending, ` +
                            `${status.completed}/${status.targetSamples} samples ` +
                            `(${Math.round((status.percent || 0) * 100)}%, ` +
                            `eta ${formatCalibrationEta(status.etaMs)}), ` +
                            `${status.buckets} bucket(s).`
                        );
                    }

                    if (typeof onProgress === "function") {
                        onProgress(status);
                    }
                    return;
                }

                if (message.type === CALIBRATION_MESSAGE.error) {
                    finishWithError(message.error);
                    return;
                }

                if (message.type !== CALIBRATION_MESSAGE.result) return;

                const result = message.result;
                const finishReason = message.status.finishReason;
                const completed =
                    finishReason === CALIBRATION_FINISH_REASON.targetSamples;
                const drifted =
                    finishReason === CALIBRATION_FINISH_REASON.drift;

                console.log(
                    `[calibration] ${definition.id}: ` +
                    `${completed ? "completed" : drifted ? "drifted" : "incomplete"} ` +
                    `(${message.status.completed}/${CALIBRATION_DEFAULT_OPTIONS.targetSamples} samples, ` +
                    `reason: ${finishReason}, ` +
                    `${message.status.buckets} bucket(s), ` +
                    `${message.status.elapsedMs} ms).`
                );

                finish({
                    status: completed ? "completed" : drifted ? "drift" : "incomplete",
                    version: CALIBRATION_VERSION,
                    mapSignature: getMapSignature(definition),
                    completedAt: Date.now(),
                    ...result,
                    parameters: {
                        ...result.parameters,
                        referenceHorizonSeconds:
                            CALIBRATION_DEFAULT_OPTIONS.referenceHorizonSeconds
                    }
                });

                if (drifted && allowDriftRetry) {
                    console.warn(
                        `[calibration] ${definition.id}: drift detected ` +
                        `(p=${message.status.drift?.pValue}); recalibrating ` +
                        "from an unexplored graph."
                    );
                    void calibrateMap(definition, {
                        useGraph: false,
                        fresh: true,
                        allowDriftRetry: false
                    });
                }
            };

            worker.postMessage({
                type: CALIBRATION_MESSAGE.start,
                map: definition,
                initialState,
                options: { ...CALIBRATION_DEFAULT_OPTIONS },
                resume,
                strategyGraph,
                assumed: assumedCalibration
            });
        });

        calibrationInFlight.set(definition.id, calibrationPromise);
        calibrationPromise.finally(() => {
            calibrationInFlight.delete(definition.id);
        });

        return calibrationPromise;
    }

    // Definitions known to the game, deduplicated by id (map.maps already
    // contains the predefined ones after loading, but not before).
    function getAllDefinitions() {
        const byId = new Map();

        for (const definition of PREDEFINED_MAPS) {
            byId.set(definition.id, definition);
        }

        for (const definition of map.maps) {
            byId.set(definition.id, definition);
        }

        return Array.from(byId.values());
    }

    // Returns the calibration used as a playable fallback: a completed one
    // if any exists, otherwise the most advanced partial calibration.
    function findReferenceCalibration() {
        const definitions = getAllDefinitions();
        const completed = definitions.find(isCalibrationCompleted);

        if (completed) {
            return { sourceId: completed.id, calibration: completed.calibration };
        }

        let best = null;

        for (const definition of definitions) {
            const calibration = definition.calibration;
            const sampleCount = Number(calibration?.sampleCount) || 0;

            if (sampleCount <= 0 || !isCalibrationVersionCurrent(calibration)) {
                continue;
            }

            if (!best || sampleCount > best.sampleCount) {
                best = { sourceId: definition.id, calibration, sampleCount };
            }
        }

        return best
            ? { sourceId: best.sourceId, calibration: best.calibration }
            : null;
    }

    // Inheritance of a reference calibration: keeps the same f/g tables
    // but records provenance so it is clear it was borrowed.
    function inheritCalibration(definition, reference) {
        const completed = reference.calibration?.status === "completed";

        definition.calibration = {
            ...cloneCalibration(reference.calibration),
            // Borrowed tables are a fallback, not this map's evidence: keep
            // them out of the resume seed so this map still measures itself.
            samples: undefined,
            status: completed ? "completed" : "incomplete",
            inheritedFrom: reference.sourceId,
            mapSignature: getMapSignature(definition),
            ...(completed ? { completedAt: Date.now() } : {})
        };
    }

    let calibrationQueue = Promise.resolve();

    // One calibration per definition at a time: startup schedules the
    // active map and then every pending map, and both paths may reach the
    // same definition.
    const calibrationInFlight = new Map();

    // Ensures a single definition ends up with a completed calibration:
    // if it already has one, resolves immediately; otherwise it is
    // calibrated in the background (or inherits the reference fallback
    // when `useReference` is set and a reference exists).
    function ensureMapCalibrated(definition) {
        calibrationQueue = calibrationQueue
            .catch(() => undefined)
            .then(async () => {
                if (isCalibrationCompleted(definition)) {
                    return definition.calibration;
                }

                // A map with its own samples resumes its calibration; a map
                // that already has usable tables (own or inherited) gets its
                // real calibration in the background.
                if (
                    hasCalibrationSamples(definition) ||
                    hasUsableCalibration(definition)
                ) {
                    return calibrateMap(definition);
                }

                const reference = findReferenceCalibration();

                if (reference) {
                    inheritCalibration(definition, reference);
                    console.log(
                        `[calibration] ${definition.id}: reused calibration ` +
                        `from "${reference.sourceId}".`
                    );
                    void persistMaps();
                    notifyCalibration(definition);
                    return definition.calibration;
                }

                return calibrateMap(definition);
            });

        return calibrationQueue;
    }

    // Calibrates every known map that is not calibrated yet. Runs in
    // the background; the first map that gets a real calibration
    // becomes the reference borrowed by the rest.
    function calibrateAllMaps() {
        const pending = getAllDefinitions()
            .filter(definition => !isCalibrationCompleted(definition));

        if (pending.length === 0) {
            console.log(
                "[calibration] every map already has a completed calibration."
            );
            return calibrationQueue;
        }

        console.log(
            `[calibration] ${pending.length} map(s) without calibration; ` +
            "calibrating in the background."
        );

        let chain = calibrationQueue;

        for (const definition of pending) {
            chain = chain.then(() => ensureMapCalibrated(definition));
        }

        calibrationQueue = chain;
        return chain;
    }

    function saveEditorMap() {
        const savedMap = cloneMapDefinition(map.editorDraftMap, {
            includeCalibration: true
        });
        savedMap.calibration = createPendingCalibration(savedMap);

        const existingIndex = map.maps.findIndex(
            definition => definition.id === savedMap.id
        );

        if (existingIndex < 0) {
            map.maps.push(savedMap);
        } else {
            map.maps[existingIndex] = savedMap;
        }

        map.activeMapId = savedMap.id;

        updateMapSelector();
        void persistMaps();

        // Calibrate the freshly saved definition in the background,
        // independently of the active map.
        void calibrateMap(savedMap);
    }

    // ============================================================
    // GRAPH
    // ============================================================

    async function loadStrategyGraph(mapId) {
        const record = await mapStorage.loadStrategyGraph(mapId);

        if (!record?.graph) {
            return null;
        }

        const definition = map.maps.find(item => item.id === mapId) ||
            getCurrentMapDefinition();

        // A graph is only reusable for the same map definition and the same
        // search convention that produced it.
        if (
            record.mapSignature !== getMapSignature(definition) ||
            record.calibrationVersion !== CALIBRATION_VERSION
        ) {
            return null;
        }

        return record.graph;
    }

    function saveStrategyGraph(mapId, graph) {
        const definition = map.maps.find(item => item.id === mapId) ||
            getCurrentMapDefinition();

        return mapStorage.saveStrategyGraph(mapId, graph, {
            mapSignature: getMapSignature(definition),
            calibrationVersion: CALIBRATION_VERSION
        });
    }

    function buildGraph(definition = map.currentMap) {
        return geometry.buildGraph(
            definition,
            Object.values(DIRECTIONS)
        );
    }

    return {
        get maps() { return map.maps; },
        get activeMapId() { return map.activeMapId; },
        set activeMapId(value) { map.activeMapId = value; },
        get editorDraftMap() { return map.editorDraftMap; },
        set editorDraftMap(value) { map.editorDraftMap = value; },
        get nextCustomMapNumber() { return map.nextCustomMapNumber; },
        set nextCustomMapNumber(value) { map.nextCustomMapNumber = value; },
        get currentMap() { return map.currentMap; },
        set currentMap(value) { map.currentMap = value; },
        get graph() { return map.graph; },
        set graph(value) { map.graph = value; },
        get mapStorageReady() { return map.mapStorageReady; },
        strategicSearch: map.strategicSearch,

        bindRuntime,
        cloneMapDefinition,
        DIRECTIONS,
        createGhostIcon,
        getGhostName,
        getCurrentMapDefinition,
        getMapRowCount,
        getMapColumnCount,
        wrap,
        getWrappedPosition,
        getPossibleDirections,
        getBoundaryKey,
        isWall,
        isBoundaryBlocked,
        buildPellets,
        buildGhostHouses,
        buildMapData,
        loadPersistedMaps,
        updateMapSelector,
        selectCharacter,
        updateCharacterChoices,
        saveEditorMap,
        calibrateMap,
        ensureMapCalibrated,
        calibrateAllMaps,
        findReferenceCalibration,
        loadStrategyGraph,
        saveStrategyGraph,
        buildGraph,
        canMove
    };
}