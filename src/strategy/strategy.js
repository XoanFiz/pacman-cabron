// ============================================================
// GAME STRATEGY
// ============================================================
//
// Pure simulation module shared by the main thread, the strategy
// worker and the calibration worker.
//
// It receives every game dependency through an explicit context and
// never reads global variables:
//
//   createGameStrategy({
//       map,        // active map definition (tiles, edges, calibration, id)
//       graph,      // optional movement graph; derived from map if absent
//       geometry,   // { DIRECTIONS, wrap, getMapRowCount, getMapColumnCount,
//                   //   canMove, isBoundaryBlocked, buildGraph }
//       model,      // { cloneCharacterState }
//       config,     // speed / weighting constants (PACMAN_SPEED, ...)
//       worker      // optional { requestAction } bridge (main thread only)
//   })
//
// The search tree (rbfmSearch) and the root pointer are this module's
// own state. Callers only use the exposed choose*/advance* functions.

function createGameStrategy(parameters = {}) {

    const {
        geometry,
        model,
        config,
        rmfMinimax,
        worker = null
    } = parameters;

    if (typeof rmfMinimax !== "function") {
        throw new TypeError(
            "createGameStrategy requires an rmfMinimax factory."
        );
    }

    // Defensive snapshot of the map so later mutations of the live
    // `currentMap` (editor, reset, etc.) cannot corrupt the simulation.
    const sourceMap = parameters.map;
    const map = {
        ...sourceMap,
        tiles: sourceMap.tiles.map(row => [...row]),
        edges: new Set(sourceMap.edges),
        calibration: sourceMap.calibration
            ? { ...sourceMap.calibration }
            : undefined
    };

    // Snapshot of the movement graph so callers cannot mutate it later.
    const sourceGraph = parameters.graph ??
        geometry.buildGraph(map, Object.values(geometry.DIRECTIONS));
    const graph = sourceGraph.map(row =>
        row.map(cell =>
            cell.map(edge => ({
                x: edge.x,
                y: edge.y,
                direction: { ...edge.direction }
            }))
        )
    );

    const {
        DIRECTIONS,
        wrap,
        getMapRowCount,
        getMapColumnCount,
        canMove,
        isBoundaryBlocked
    } = geometry;

    // Bind geometry helpers to this strategy's map snapshot so internal
    // callers can omit the map argument (the strategy is pure for map).
    const getMapRowCountForMap = () => getMapRowCount(map);
    const getMapColumnCountForMap = () => getMapColumnCount(map);
    const canMoveForMap = (x, y, direction) => canMove(x, y, direction, map);
    const isBoundaryBlockedForMap = (x, y, direction) =>
        isBoundaryBlocked(x, y, direction, map);

    const {
        cloneCharacterState
    } = model;

    // Static counts of the map, used by Pac-Man's own score.
    let openCellCount = 0;
    let initialNormalPelletCount = 0;
    let initialPowerPelletCount = 0;

    for (let y = 0; y < getMapRowCountForMap(); y++) {
        for (let x = 0; x < getMapColumnCountForMap(); x++) {
            if (map.tiles[y][x] === "#") {
                continue;
            }

            openCellCount++;

            if (map.tiles[y][x] === ".") {
                initialNormalPelletCount++;
            } else if (map.tiles[y][x] === "o") {
                initialPowerPelletCount++;
            }
        }
    }

    const {
        PACMAN_SPEED,
        GHOST_SPEED,
        FRIGHTENED_GHOST_SPEED,
        EATEN_GHOST_SPEED,
        FRIGHTENED_DURATION,
        GHOST_COLLISION_DISTANCE,
        INITIAL_LIVES
    } = config.rules;

    const {
        SEARCH_EPSILON,
        WEIGHT_NORMAL,
        WEIGHT_PELLET,
        MAX_PELLET_SCORE_FRACTION,
        TOTAL_PELLET_VALUE,
        TOTAL_NORMAL_VALUE,
        SEARCH_LIFE_PRIORITY,
        SEARCH_TERMINAL_VALUE
    } = config.strategy;

    // PRIORITY QUEUE
    // ============================================================

    // Maintains a min-priority queue ordered by arrival time.
    // Used by the temporal domain expansion to process the earliest
    // reachable states first.
    class MinHeap {

        constructor() {
            this.items = [];
        }


        get length() {
            return this.items.length;
        }


        empty() {
            return this.items.length === 0;
        }


        push(item) {

            this.items.push(item);

            let index =
                this.items.length - 1;


            while (index > 0) {

                const parent =
                    Math.floor((index - 1) / 2);


                if (
                    this.items[parent].time <=
                    this.items[index].time
                ) {
                    break;
                }


                [
                    this.items[parent],
                    this.items[index]
                ] = [
                        this.items[index],
                        this.items[parent]
                    ];


                index = parent;
            }
        }


        pop() {

            if (this.items.length === 0)
                return null;


            const result =
                this.items[0];


            const last =
                this.items.pop();


            if (this.items.length > 0) {

                this.items[0] = last;

                let index = 0;


                while (true) {

                    const left =
                        index * 2 + 1;

                    const right =
                        index * 2 + 2;

                    let smallest = index;


                    if (
                        left < this.items.length &&
                        this.items[left].time <
                        this.items[smallest].time
                    ) {
                        smallest = left;
                    }


                    if (
                        right < this.items.length &&
                        this.items[right].time <
                        this.items[smallest].time
                    ) {
                        smallest = right;
                    }


                    if (smallest === index)
                        break;


                    [
                        this.items[index],
                        this.items[smallest]
                    ] = [
                            this.items[smallest],
                            this.items[index]
                        ];


                    index = smallest;
                }
            }


            return result;
        }
    }

    // The objective is written as ghost advantage (Pac-Man's shrinking
    // territory, ghost proximity, ghost-owned pellets and lost lives raise
    // it), so Pac-Man minimizes it and the ghosts maximize it.
    function getNodeType(state) {
        return state.firstActor === "player"
            ? "min"
            : "max";
    }


    // ============================================================
    // SHORTEST PATH
    // ============================================================

    // Returns the minimum travel distance between two cells using
    // the map's movement graph. Unreachable targets return Infinity.
    function shortestDistance(
        startX,
        startY,
        targetX,
        targetY
    ) {

        if (
            startX === targetX &&
            startY === targetY
        ) {
            return 0;
        }


        const distances =
            Array.from(
                { length: getMapRowCountForMap() },
                () => Array(getMapColumnCountForMap()).fill(Infinity)
            );


        const queue = new MinHeap();


        distances[startY][startX] = 0;


        queue.push({
            x: startX,
            y: startY,
            time: 0
        });


        while (!queue.empty()) {

            const current =
                queue.pop();


            if (
                current.time >
                distances[current.y][current.x]
            ) {
                continue;
            }


            if (
                current.x === targetX &&
                current.y === targetY
            ) {
                return current.time;
            }


            for (
                const next of
                graph[current.y][current.x]
            ) {

                const nextTime =
                    current.time + 1;


                if (
                    nextTime <
                    distances[next.y][next.x]
                ) {

                    distances[next.y][next.x] =
                        nextTime;


                    queue.push({
                        x: next.x,
                        y: next.y,
                        time: nextTime
                    });
                }
            }
        }


        return Infinity;
    }


    // ============================================================
    // DOMAIN
    // ============================================================

    // Creates the initial representation of a cell before any
    // character's arrival time or ownership has been established.
    function createDomainCell() {

        return {
            arrival: Infinity,
            owner: "",
            blue: []
        };
    }


    // Computes a multi-source, time-dependent Voronoi partition of the
    // map. Each character propagates its reachable territory according
    // to movement speed, current movement progress, and collision rules.
    // Equal-time arrivals preserve shared ownership, while contested
    // cells stop further propagation. Eaten ghosts re-enter the search
    // from their possible return-to-house positions.
    function calculateDomain(
        player,
        ghosts,
        ghostHouses,
        pellets,
        time = 0,
        includePacman = true,
    ) {

        let queue = new MinHeap();

        const isDuplicated = (assessedDomainFact) => {
            const direction = assessedDomainFact.direction;

            const factKey = [
                assessedDomainFact.owner,
                assessedDomainFact.domainType ?? "normal",
                assessedDomainFact.x,
                assessedDomainFact.y,
                assessedDomainFact.initialProgress,
                direction?.x ?? null,
                direction?.y ?? null,
                assessedDomainFact.frightenedTimer ?? null
            ].join(":");

            if (processedDomainMessages.has(factKey)) {
                return true
            }

            processedDomainMessages.add(factKey);
            return false;
        };


        // Seeds the domain from one character. A character between cells is
        // committed to its destination cell: the first seed is that cell with
        // the remaining travel time, and the origin cell is only marked as
        // occupied. A character at a cell centre can still choose any
        // direction, so it seeds the centre itself.
        function pushCharacterDomainSeed(
            character,
            speed,
            owner,
            domainType = "normal",
            extra = {}
        ) {
            const moving =
                character.progress > 0 &&
                (character.direction.x !== 0 ||
                    character.direction.y !== 0) &&
                canMoveForMap(
                    character.x,
                    character.y,
                    character.direction
                );

            if (!moving) {
                queue.push({
                    x: character.x,
                    y: character.y,
                    time,
                    owner,
                    domainType,
                    originX: character.x,
                    originY: character.y,
                    speed,
                    initialProgress: 0,
                    initialDirection: { x: 0, y: 0 },
                    ...extra
                });

                return;
            }

            const nextX = wrap(
                character.x + character.direction.x,
                getMapColumnCountForMap()
            );
            const nextY = wrap(
                character.y + character.direction.y,
                getMapRowCountForMap()
            );

            // Only the destination is seeded. The origin is reached back
            // from it, so the wave never assumes the origin is occupied.
            queue.push({
                x: nextX,
                y: nextY,
                time: time + (1 - character.progress) / speed,
                owner,
                domainType,
                originX: nextX,
                originY: nextY,
                speed,
                initialProgress: 0,
                initialDirection: { x: 0, y: 0 },
                direction: { ...character.direction },
                ...extra
            });
        }

        function pushBlueDomainSeeds(queue, ghost, owner, time) {
            pushCharacterDomainSeed(
                ghost,
                EATEN_GHOST_SPEED,
                owner,
                "blue",
                { frightenedTimer: ghost.frightenedTimer }
            );
        }

        const propagateFromGhostHouses = (ghostHouses, ghost, ghostIndex, time = 0) => {
            const isMoving =
                ghost.progress > 0 &&
                (ghost.direction.x !== 0 || ghost.direction.y !== 0) &&
                canMoveForMap(ghost.x, ghost.y, ghost.direction);
            const nextX =
                wrap(ghost.x + ghost.direction.x, getMapColumnCountForMap());
            const nextY =
                wrap(ghost.y + ghost.direction.y, getMapRowCountForMap());

            for (const house of ghostHouses) {
                const distance =
                    isMoving
                        ? 1 - ghost.progress +
                        shortestDistance(nextX, nextY, house.x, house.y)
                        : shortestDistance(ghost.x, ghost.y, house.x, house.y);

                if (!Number.isFinite(distance)) {
                    continue;
                }

                const speed = ghost.eaten ? EATEN_GHOST_SPEED : FRIGHTENED_GHOST_SPEED

                queue.push({
                    x: house.x,
                    y: house.y,
                    time: time + distance / speed,
                    owner: `ghost${ghostIndex}`,
                    domainType: "normal",
                    originX: house.x,
                    originY: house.y,
                    speed,
                    initialProgress: 0,
                    initialDirection: { x: 0, y: 0 }
                });
            }
        }

        const calculateNextTimeAndCell = (assessedDomainStatus, domain, next) => {
            const speed = assessedDomainStatus.speed;
            const progress = assessedDomainStatus.initialProgress;
            const direction = assessedDomainStatus.direction;
            const nextDirection = next.direction;

            // Always check the direction the wave comes from. A character
            // at a cell centre may continue or turn without extra time; the
            // seed is already at the destination centre.
            const sameDirection =
                direction &&
                nextDirection &&
                direction.x === nextDirection.x &&
                direction.y === nextDirection.y;

            const stepTime = progress > 0
                ? (
                    sameDirection
                        ? (1 - progress) / speed
                        : (1 - progress) / speed + 1 / speed
                )
                : 1 / speed;

            const nextTime = assessedDomainStatus.time + stepTime;


            const nextCell =
                domain[
                next.y
                ][
                next.x
                ];

            return {
                nextTime, nextCell
            }
        }

        const spreadTheWave = (assessedDomainStatus, isBetter) => {
            for (
                const next of

                graph[assessedDomainStatus.y][assessedDomainStatus.x]
            ) {

                const result = calculateNextTimeAndCell(assessedDomainStatus, domain, next);
                const { nextTime, nextCell } = { nextTime: result.nextTime, nextCell: result.nextCell };


                if (!isBetter(nextTime, nextCell)
                ) {
                    continue;
                }

                let nextFrightenedTimer = undefined;
                let nextDomainType = "normal";

                if (assessedDomainStatus.frightenedTimer !== undefined) {
                    nextFrightenedTimer =
                        assessedDomainStatus.frightenedTimer -
                        (nextTime - assessedDomainStatus.time);

                    nextDomainType = "frightened";

                    if (nextFrightenedTimer <= 0) {
                        nextFrightenedTimer = 0;
                        nextDomainType = "normal";
                    }
                }


                queue.push({
                    x: next.x,
                    y: next.y,
                    time: nextTime,
                    owner: assessedDomainStatus.owner,
                    domainType: nextDomainType,
                    frightenedTimer: nextFrightenedTimer,
                    originX: assessedDomainStatus.originX,
                    originY: assessedDomainStatus.originY,
                    speed: assessedDomainStatus.speed,
                    direction: next.direction,
                    initialProgress: 0,
                    initialDirection: { x: 0, y: 0 }
                });
            }
        }

        const domain =
            Array.from(
                { length: getMapRowCountForMap() },
                () => Array.from(
                    { length: getMapColumnCountForMap() },
                    createDomainCell
                )
            );

        const processedDomainMessages = new Set();


        // --------------------------------------------------------
        // PAC-MAN
        // --------------------------------------------------------

        if (includePacman) {
            pushCharacterDomainSeed(
                player,
                PACMAN_SPEED,
                "pacman"
            );
        }


        // --------------------------------------------------------
        // GHOSTS
        // --------------------------------------------------------

        for (let i = 0; i < ghosts.length; i++) {

            const ghost = ghosts[i];
            const owner = `ghost${i}`;

            if (ghost.eaten) {
                propagateFromGhostHouses(ghostHouses, ghost, i, time)
            } else {
                if (ghost.frightened) {
                    // Blue territory: starts at the ghost's current position. 
                    pushBlueDomainSeeds(queue, ghost, owner, time);

                    // Normal territory: propagates from the ghost's house. 
                    propagateFromGhostHouses(ghostHouses, ghost, i, time)
                }

                else {
                    // Normal ghost
                    pushCharacterDomainSeed(
                        ghost,
                        GHOST_SPEED,
                        owner
                    );
                }
            }
        }


        // --------------------------------------------------------
        // MULTI-SOURCE TEMPORAL FLOOD
        // --------------------------------------------------------

        while (!queue.empty()) {

            const assessedDomainFact =
                queue.pop();


            const currentDomainCell =
                domain[
                assessedDomainFact.y
                ][
                assessedDomainFact.x
                ];

            if (assessedDomainFact.domainType !== "blue") {
                // Normal domain
                if (assessedDomainFact.time > currentDomainCell.arrival) {
                    continue;
                }

                if (assessedDomainFact.time < currentDomainCell.arrival) {
                    currentDomainCell.arrival = assessedDomainFact.time;
                    currentDomainCell.owner = assessedDomainFact.owner;
                    currentDomainCell.direction = assessedDomainFact.direction;

                    if (assessedDomainFact.owner == "pacman") {
                        currentDomainCell.blue = [];
                    }
                }

                // An origin marker only keeps the cell occupied.
                if (assessedDomainFact.noSpread) {
                    continue;
                }

                // Begin prepare for propagation
                if (isDuplicated(assessedDomainFact)) {
                    continue;
                }

                // Stop at a meeting point: a character must not propagate into
                // territory already reached by another character at the same time.
                if (!currentDomainCell.owner || currentDomainCell.owner === "") {
                    continue;
                }

                // Pacman stops expanding as soon as he reaches a power pill.
                if (
                    assessedDomainFact.owner === "pacman" &&
                    map.tiles[assessedDomainFact.y][assessedDomainFact.x] === "o" &&
                    (pellets.has(`${assessedDomainFact.x},${assessedDomainFact.y}`))) {
                    continue;
                }
                // End prepare for propagation

                spreadTheWave(assessedDomainFact, (nextTime, nextCell) => nextTime < nextCell.arrival);
            } else {
                // Blue domain
                let blueDomainUnit = currentDomainCell.blue.filter(unit => unit.owner == assessedDomainFact.owner)[0];
                if (!blueDomainUnit) {
                    blueDomainUnit = {};
                    blueDomainUnit.owner = assessedDomainFact.owner;
                    blueDomainUnit.arrival = assessedDomainFact.time;
                    blueDomainUnit.frightenedTimer = assessedDomainFact.frightenedTimer;
                    currentDomainCell.blue.push(blueDomainUnit);
                } else {
                    if (assessedDomainFact.time > blueDomainUnit.arrival) {
                        blueDomainUnit.arrival = assessedDomainFact.time;
                        blueDomainUnit.frightenedTimer = assessedDomainFact.frightenedTimer;
                    }
                }

                if (assessedDomainFact.noSpread) {
                    continue;
                }

                // Begin prepare for propagation
                if (isDuplicated(assessedDomainFact)) {
                    continue;
                }

                // End prepare for propagation

                // Propagation
                spreadTheWave(assessedDomainFact, (nextTime, nextCell) => {
                    (nextTime > nextCell.arrival) && (nextCell.blue.filter(unit => unit.owner == assessedDomainFact.owner)[0]?.arrival ?? Infinity) > nextTime
                });
            }

        }

        return domain;
    }


    // Calculates the remaining grid distance while accounting for an
    // already-started movement segment, so arrival estimates remain
    // continuous across cell boundaries.
    function getRemainingDistanceToPosition(
        character,
        targetX,
        targetY
    ) {
        const isMoving =
            character.progress > 0 &&
            (character.direction.x !== 0 || character.direction.y !== 0) &&
            canMoveForMap(character.x, character.y, character.direction);

        if (!isMoving) {
            return shortestDistance(
                character.x,
                character.y,
                targetX,
                targetY
            );
        }

        const nextX =
            wrap(character.x + character.direction.x, getMapColumnCountForMap());
        const nextY =
            wrap(character.y + character.direction.y, getMapRowCountForMap());

        return 1 - character.progress +
            shortestDistance(nextX, nextY, targetX, targetY);
    }

    // Estimates when a ghost could reach Pac-Man. Eaten ghosts must
    // first return to a house and then resume normal-speed movement.
    function getGhostArrivalTimeToPlayer(ghost, player, houses) {
        if (!ghost.eaten) {
            const speed = ghost.frightened
                ? FRIGHTENED_GHOST_SPEED
                : GHOST_SPEED;

            return getRemainingDistanceToPosition(
                ghost,
                player.x,
                player.y
            ) / speed;
        }

        let minimumArrivalTime = Infinity;

        for (const house of houses) {
            const returnDistance =
                getRemainingDistanceToPosition(
                    ghost,
                    house.x,
                    house.y
                );
            const distanceFromHouse =
                shortestDistance(
                    house.x,
                    house.y,
                    player.x,
                    player.y
                );
            const arrivalTime =
                returnDistance / EATEN_GHOST_SPEED +
                distanceFromHouse / GHOST_SPEED;

            minimumArrivalTime =
                Math.min(minimumArrivalTime, arrivalTime);
        }

        return minimumArrivalTime;
    }


    // ============================================================
    // NORMAL + PELLET SCORE
    // ============================================================

    // Evaluates ordinary territory and remaining pellets from a domain
    // partition. Territory value is normalized by Pac-Man's controlled
    // area, while pellet value is discounted by travel time and shared
    // among ghosts that reach a pellet at the same earliest time.
    function calculateNormalAndPelletScore({ pellets, ghosts, player, time, respawnState },
        domain
    ) {

        let pelletScore = 0;

        let pacmanControlledSquares = 0;
        for (let y = 0; y < getMapRowCountForMap(); y++) {
            for (let x = 0; x < getMapColumnCountForMap(); x++) {
                if (
                    map.tiles[y][x] !== "#" &&
                    domain[y][x].owner === "pacman"
                ) {
                    pacmanControlledSquares++;
                }
            }
        }

        const normalScore =
            TOTAL_NORMAL_VALUE /
            Math.max(1, pacmanControlledSquares);
        const nearestGhostArrivalTime = Math.min(
            ...ghosts.map(ghost =>
                getGhostArrivalTimeToPlayer(
                    ghost,
                    player,
                    respawnState.houses
                )
            )
        );
        const normalArrivalMultiplier =
            Number.isFinite(nearestGhostArrivalTime)
                ? 1 + 1 / (1 + Math.max(0, nearestGhostArrivalTime))
                : 1;
        const proximityAdjustedNormalScore =
            normalScore * normalArrivalMultiplier;
        const pelletCount = pellets.size;
        const pelletValue =
            pelletCount > 0
                ? TOTAL_PELLET_VALUE / pelletCount
                : 0;

        let pacmanPelletValue = 0;


        for (let y = 0; y < getMapRowCountForMap(); y++) {

            for (let x = 0; x < getMapColumnCountForMap(); x++) {

                const cell =
                    map.tiles[y][x];


                if (
                    cell !== "." &&
                    cell !== "o"
                ) {
                    continue;
                }

                if (!pellets.has(`${x},${y}`)) {
                    continue;
                }

                // const ghostOwners =
                //     getGhostOwners(
                //         domain[y][x].owners
                //     );
                const ghostOwner = domain[y][x].owner;


                // Only cells the ghosts control count: those are the
                // ones they can deny to Pac-Man.
                const travelTime =
                    Math.max(
                        0,
                        domain[y][x].arrival - time
                    );
                const distanceWeight =
                    1 / (1 + travelTime);
                const isGhostOwner = ghostOwner.startsWith("ghost");
                const pelletWeight =
                    cell === "o"
                        ? config.strategy.POWER_PELLET_WEIGHT
                        : 1;

                if (ghostOwner === "pacman") {
                    pacmanPelletValue +=
                        pelletValue *
                        pelletWeight *
                        distanceWeight;
                    continue;
                }

                if (!isGhostOwner)
                    continue;

                pelletScore +=
                    pelletValue *
                    pelletWeight *
                    distanceWeight;
            }
        }

        // The ghosts' pellet value is a division against the pellet value
        // Pac-Man still controls: the less he has, the more they gain.
        pelletScore =
            TOTAL_PELLET_VALUE /
            Math.max(1, pacmanPelletValue);


        return {
            normalScore: proximityAdjustedNormalScore,
            pelletScore
        };
    }


    // ============================================================
    // TOTAL DOMAIN EVALUATION
    // ============================================================


    // Combines the territory, ordinary-pellet, and frightened-ghost
    // evaluations into a single objective, with a cap on the contribution
    // of ordinary pellets relative to normal territory.
    function evaluateDomain({ pellets, ghosts, player, time, respawnState },
        domain
    ) {

        const normal =
            calculateNormalAndPelletScore({ pellets, ghosts, player, time, respawnState },
                domain
            );

        const weightedPelletScore =
            Math.min(
                WEIGHT_PELLET *
                normal.pelletScore,
                WEIGHT_NORMAL *
                normal.normalScore *
                MAX_PELLET_SCORE_FRACTION
            );

        const total =
            WEIGHT_NORMAL *
            normal.normalScore +

            weightedPelletScore;


        return {
            normalScore:
                normal.normalScore,

            pelletScore:
                normal.pelletScore,

            total
        };
    }

    // Creates an isolated character snapshot for hypothetical search
    // branches, preventing simulated movement from mutating live state.
    function cloneSearchCharacter(character) {
        return cloneCharacterState(character);
    }

    // Captures the game configuration needed to simulate future events.
    // Readiness flags identify which characters must choose a new direction
    // at the current decision point.
    function createCurrentGameSearchState(
        searchContext,
        readyGhostIndices,
        readyPlayer = false
    ) {
        const readyGhostSet = new Set(readyGhostIndices);

        const state = {
            pellets: new Set(searchContext.pellets),
            lives: searchContext.lives,
            time: searchContext.time,

            player: cloneSearchCharacter(searchContext.player),
            ghosts: searchContext.ghosts.map(cloneSearchCharacter),

            respawnState: {
                player: { ...searchContext.respawnState.player },

                ghosts: searchContext.respawnState.ghosts.map(start => ({
                    ...start,
                    direction: { ...start.direction }
                })),

                houses: searchContext.respawnState.houses.map(
                    house => ({ ...house })
                )
            },

            controlledGhostIndex: searchContext.controlledGhostIndex,

            terminal: false,
            readyPlayer,

            readyGhosts: searchContext.ghosts.map(
                (_, index) => readyGhostSet.has(index)
            ),
        }

        state.firstActor = getDeterministicTurnOrder(state)
        return state;
    }


    // Produces a canonical key for state deduplication. It includes
    // movement progress and decision readiness, distinguishing states
    // whose future transitions may differ despite sharing cell positions.
    function buildStateKey(state) {
        // A character that is ready to choose at a cell centre is about to
        // replace its direction, so the current one does not affect its
        // transitions and is left out of the key. If it is ready while still
        // between cells (a power pellet makes ghosts decide there), the
        // direction is kept because the position depends on it.
        const characterKey = (character, ready) => {
            // A character that is about to choose at a cell centre replaces
            // its direction, so the current one does not affect it. Between
            // cells the position and the continue option still depend on it,
            // so it is kept for those decisions.
            const decidesAtCentre =
                ready && character.decisionAtCentre !== false;
            const nextDirection = decidesAtCentre
                ? null
                : character.nextDirection;

            return [
                character.x,
                character.y,
                decidesAtCentre ? null : character.direction.x,
                decidesAtCentre ? null : character.direction.y,
                Number(character.progress.toFixed(5)),
                Boolean(character.frightened),
                Number.isFinite(character.frightenedTimer)
                    ? Number(character.frightenedTimer.toFixed(5))
                    : null,
                Boolean(character.eaten),
                nextDirection ? nextDirection.x : null,
                nextDirection ? nextDirection.y : null,
                ready ? Boolean(character.decisionAtCentre !== false) : null
            ].join(",");
        };

        // I do not include time in the key: the domain evaluation uses the arrival time relative to the state's timestamp, 
        // and the remaining fear time is already represented within each ghost. This allows for the sharing of equivalent 
        // states reached at different absolute times.
        return JSON.stringify([
            [...state.pellets].sort(),
            state.lives,
            state.terminal,
            state.controlledGhostIndex,
            characterKey(state.player, state.readyPlayer),
            state.ghosts.map((ghost, index) =>
                characterKey(ghost, state.readyGhosts[index])
            ),
            state.readyPlayer,
            state.readyGhosts
        ]);
    }

    function getDeterministicTurnOrder(state) {
        const hasGhostMove = state.readyGhosts.some(Boolean);
        const hasPlayerMove = state.readyPlayer;

        if (hasGhostMove && !hasPlayerMove) {
            return "ghosts";
        }

        if (hasPlayerMove && !hasGhostMove) {
            return "player";
        }

        if (!hasGhostMove && !hasPlayerMove) {
            return null;
        }

        const key = buildStateKey(state);
        let hash = 0;

        for (let i = 0; i < key.length; i++) {
            hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
        }

        return (hash >>> 0) % 2 === 0
            ? "ghosts"
            : "player";
    }

    // Pac-Man's own score: his territory, the pellets inside his domain
    // (power pellets count more), the lives he still has and the pellets he
    // has already eaten. The ghosts maximize their advantage and Pac-Man
    // minimizes it, so this score is subtracted from the domain value.
    function evaluatePacmanScore(state, domain) {
        let territory = 0;
        let pelletDomain = 0;
        let remainingNormal = 0;
        let remainingPower = 0;
        const powerWeight = config.strategy.POWER_PELLET_WEIGHT;
        const pelletValue = state.pellets.size > 0
            ? TOTAL_PELLET_VALUE / state.pellets.size
            : 0;

        for (let y = 0; y < getMapRowCountForMap(); y++) {
            for (let x = 0; x < getMapColumnCountForMap(); x++) {
                const tile = map.tiles[y][x];

                if (tile === "#") {
                    continue;
                }

                const cell = domain[y][x];

                if (cell.owner === "pacman") {
                    territory++;
                }

                if (tile !== "." && tile !== "o") {
                    continue;
                }

                if (!state.pellets.has(`${x},${y}`)) {
                    continue;
                }

                if (tile === "o") {
                    remainingPower++;
                } else {
                    remainingNormal++;
                }

                if (cell.owner === "pacman") {
                    const travelTime = Math.max(
                        0,
                        cell.arrival - state.time
                    );

                    pelletDomain +=
                        pelletValue *
                        (tile === "o" ? powerWeight : 1) /
                        (1 + travelTime);
                }
            }
        }

        const initialWeighted =
            initialNormalPelletCount +
            powerWeight * initialPowerPelletCount;
        const remainingWeighted =
            remainingNormal +
            powerWeight * remainingPower;
        const eatenProgress = initialWeighted > 0
            ? Math.max(0, initialWeighted - remainingWeighted) /
            initialWeighted
            : 0;

        return {
            total:
                WEIGHT_NORMAL *
                TOTAL_NORMAL_VALUE *
                territory /
                Math.max(1, openCellCount) +
                WEIGHT_PELLET * pelletDomain +
                config.strategy.PELLET_PROGRESS_WEIGHT *
                TOTAL_PELLET_VALUE *
                eatenProgress +
                state.lives * SEARCH_LIFE_PRIORITY
        };
    }

    // Strategic heuristic:
    //   ((1 + Dg * Pg * Wg) / (1 + Dp * Pp * Wp)
    //       - k * (1 + totalPellets * totalLives)
    //           / (1 + remainingPellets * remainingLives))
    //   / remainingPellets
    // D/P/W are the normal cells, pellets and power pellets inside each
    // side's domain. Ghosts maximize it and Pac-Man minimizes it.
    function evaluateHeuristic(state, domain) {
        let ghostsNormal = 0;
        let ghostsPellets = 0;
        let ghostsPower = 0;
        let pacmanNormal = 0;
        let pacmanPellets = 0;
        let pacmanPower = 0;

        for (let y = 0; y < getMapRowCountForMap(); y++) {
            for (let x = 0; x < getMapColumnCountForMap(); x++) {
                const tile = map.tiles[y][x];

                if (tile === "#") {
                    continue;
                }

                const owner = domain[y][x].owner;

                if (!owner) {
                    continue;
                }

                const isPacman = owner === "pacman";
                const isGhost = owner.startsWith("ghost");

                if (!isPacman && !isGhost) {
                    continue;
                }

                const hasPellet =
                    (tile === "." || tile === "o") &&
                    state.pellets.has(`${x},${y}`);

                if (hasPellet && tile === "o") {
                    if (isPacman) pacmanPower++;
                    else ghostsPower++;
                } else if (hasPellet) {
                    if (isPacman) pacmanPellets++;
                    else ghostsPellets++;
                } else if (isPacman) {
                    pacmanNormal++;
                } else {
                    ghostsNormal++;
                }
            }
        }

        const remainingPellets = state.pellets.size;
        const remainingLives = state.lives;
        const totalPellets =
            initialNormalPelletCount + initialPowerPelletCount;
        const ghostProduct = ghostsNormal * ghostsPellets * ghostsPower;
        const pacmanProduct = pacmanNormal * pacmanPellets * pacmanPower;
        // Remaining and total lives are inverted: losing lives must help
        // the ghosts, while eating pellets must help Pac-Man.
        const progress =
            (1 + totalPellets * remainingLives) /
            (1 + remainingPellets * INITIAL_LIVES);

        return (
            (1 + ghostProduct) /
            (1 + pacmanProduct) -
            config.strategy.SEARCH_HEURISTIC_K * progress
        ) / Math.max(1, remainingPellets);
    }

    // Evaluates a hypothetical state with the strategic heuristic.
    function evaluateSearchState(state) {
        if (state.terminal) {
            // Pac-Man is out: the best outcome for the ghosts.
            return SEARCH_TERMINAL_VALUE;
        }

        const domain = calculateDomain(
            state.player,
            state.ghosts,
            state.respawnState.houses,
            state.pellets,
            state.time,
            true
        );

        return evaluateHeuristic(state, domain);
    }

    // Checks movement legality against the simulated map and the game's
    // boundary restrictions, independently of the live game state.
    function canMoveInSearchState(state, character, direction) {
        const x = wrap(character.x + direction.x, getMapColumnCountForMap());
        const y = wrap(character.y + direction.y, getMapRowCountForMap());

        return map.tiles[y][x] !== "#" &&
            !isBoundaryBlockedForMap(character.x, character.y, direction);
    }

    // Generates legal movement choices, with a fallback for characters
    // that have no available move. Eaten ghosts may continue their current
    function getSearchDirections(state, character, isGhost, map) {
        const possible = Object.values(DIRECTIONS)
            .filter(direction =>
                canMoveInSearchState(state, character, direction)
            );

        if (possible.length > 0) {
            return possible;
        }

        return isGhost && character.eaten
            ? [{ ...character.direction }]
            : [{ x: 0, y: 0 }];
    }

    // Applies the actual control constraints of a player-directed ghost:
    // queued direction first, current direction second, and a legal
    // fallback only when neither can be continued.
    // The human-controlled ghost is moved by the player: its next
    // direction is not known before it reaches a cell centre, so the
    // search treats it like any other ghost.
    function isSearchDecidingBetweenCells(ghost) {
        return ghost.progress > 0 && ghost.decisionAtCentre === false;
    }

    function getSearchGhostDirections(state, index) {
        const ghost = state.ghosts[index];

        // A ghost that decides between cells, as happens when Pac-Man eats
        // a power pellet, can only continue along its corridor or turn
        // back. Sideways turns are not physically possible there.
        if (isSearchDecidingBetweenCells(ghost)) {
            return [
                { ...ghost.direction },
                { x: -ghost.direction.x, y: -ghost.direction.y }
            ];
        }

        return getSearchDirections(state, ghost, true);
    }

    // Reverses a ghost's movement without teleporting it to a cell center.
    // If it is between cells, the position and progress are transformed
    // together to preserve its physical location.
    function reverseSearchGhost(ghost) {
        if (ghost.progress > 0) {
            ghost.x = wrap(ghost.x + ghost.direction.x, getMapColumnCountForMap());
            ghost.y = wrap(ghost.y + ghost.direction.y, getMapRowCountForMap());
            ghost.progress = 1 - ghost.progress;
        }

        ghost.direction.x *= -1;
        ghost.direction.y *= -1;
    }

    function finalizeSearchState(state) {
        state.firstActor = getDeterministicTurnOrder(state);
        return state;
    }

    // This funcion needs to be used upon every character individually
    function moveSearchCharacterToEvent(character, speed, elapsedTime) {
        if (character.direction.x === 0 && character.direction.y === 0) {
            return false;
        }

        character.progress += speed * elapsedTime;

        if (character.progress < 1 - SEARCH_EPSILON) {
            return false;
        }

        character.progress = Math.max(0, character.progress - 1);

        character.x = wrap(
            character.x + character.direction.x,
            getMapColumnCountForMap()
        );

        character.y = wrap(
            character.y + character.direction.y,
            getMapRowCountForMap()
        );

        return true;
    }

    function collectSearchPellet(state) {
        if (!state.readyPlayer) {
            return;
        }

        const cell = map.tiles[state.player.y][state.player.x];
        const key = `${state.player.x},${state.player.y}`;

        if (
            (cell !== "." && cell !== "o") ||
            !state.pellets.has(key)
        ) {
            return;
        }

        state.pellets.delete(key);

        if (cell !== "o") {
            return;
        }

        for (let ghostIndex = 0; ghostIndex < state.ghosts.length; ghostIndex++) {
            const ghost = state.ghosts[ghostIndex];

            if (ghost.eaten) {
                continue;
            }

            setSearchGhostState(ghost, "frightened");

            // A ghost that arrived at a cell centre at this same event
            // keeps its centre decision, where every direction is legal.
            if (!state.readyGhosts[ghostIndex]) {
                ghost.decisionAtCentre = false;
            }

            state.readyGhosts[ghostIndex] = true;
        }
    }

    function resolveSearchCollision(state, next, ghostIndex) {
        if (ghostIndex < 0) {
            return false;
        }

        const ghost = next.ghosts[ghostIndex];

        if (ghost.frightened) {
            setSearchGhostState(ghost, "eaten");

            return false;
        }

        next.lives--;

        if (next.lives <= 0) {
            next.terminal = true;
            next.readyPlayer = false;
            next.readyGhosts = next.ghosts.map(() => false);

            return true;
        }

        const playerStart = state.respawnState.player;

        next.player.x = playerStart.x;
        next.player.y = playerStart.y;
        next.player.px = playerStart.x;
        next.player.py = playerStart.y;
        next.player.progress = 0;
        next.player.direction = { x: 0, y: 0 };
        next.player.nextDirection = { x: 0, y: 0 };

        next.ghosts = state.ghosts.map((ghost, index) => {
            const start = state.respawnState.ghosts[index];

            const restoredGhost = {
                ...cloneSearchCharacter(ghost),
                x: start.x,
                y: start.y,
                px: start.x,
                py: start.y,
                direction: { ...start.direction },
                nextDirection: { ...start.direction },
                progress: 0,
                needsDirection: false,
                decisionAtCentre: true,
                eaten: false,
                frightened: false,
                frightenedTimer: undefined,
                speed: start.speed
            };

            setSearchGhostState(restoredGhost, "normal");

            return restoredGhost;
        });

        next.readyPlayer = state.controlledGhostIndex === -1;

        next.readyGhosts = next.ghosts.map(
            (_, index) => index === state.controlledGhostIndex
        );

        return false;
    }

    function getSearchCollisionTime(
        player,
        ghost,
        playerVelocityX,
        playerVelocityY
    ) {
        if (ghost.eaten) {
            return Infinity;
        }

        const relativeX =
            ghost.x +
            ghost.direction.x * ghost.progress -
            (player.x + player.direction.x * player.progress);

        const relativeY =
            ghost.y +
            ghost.direction.y * ghost.progress -
            (player.y + player.direction.y * player.progress);

        const ghostSpeed = ghost.speed;

        const relativeVelocityX =
            ghost.direction.x * ghostSpeed - playerVelocityX;

        const relativeVelocityY =
            ghost.direction.y * ghostSpeed - playerVelocityY;

        const relativeVelocitySquared =
            relativeVelocityX * relativeVelocityX +
            relativeVelocityY * relativeVelocityY;

        const distanceSquared =
            relativeX * relativeX +
            relativeY * relativeY;

        if (distanceSquared <= GHOST_COLLISION_DISTANCE ** 2) {
            return 0;
        }

        if (relativeVelocitySquared === 0) {
            return Infinity;
        }

        const linear =
            2 * (
                relativeX * relativeVelocityX +
                relativeY * relativeVelocityY
            );

        const discriminant =
            linear * linear -
            4 * relativeVelocitySquared *
            (distanceSquared - GHOST_COLLISION_DISTANCE ** 2);

        if (discriminant < 0) {
            return Infinity;
        }

        const collisionTime =
            (-linear - Math.sqrt(discriminant)) /
            (2 * relativeVelocitySquared);

        return collisionTime >= 0 ? collisionTime : Infinity;
    }



    function getSearchNextEvent(state) {
        let timeToNextEvent = Infinity;
        let collisionedGhostIndex = -1;

        const considerEvent = (time, ghostIndex = -1) => {
            if (time < timeToNextEvent) {
                timeToNextEvent = time;
                collisionedGhostIndex = ghostIndex;
                return;
            }

            if (
                time === timeToNextEvent &&
                ghostIndex >= 0 &&
                collisionedGhostIndex < 0
            ) {
                collisionedGhostIndex = ghostIndex;
            }
        };

        const considerArrival = (character, speed) => {
            if (character.direction.x === 0 && character.direction.y === 0) {
                return;
            }

            const timeToCenter =
                Math.max(0, 1 - character.progress) / speed;

            considerEvent(timeToCenter);
        };

        considerArrival(state.player, PACMAN_SPEED);

        if (
            state.player.stopped &&
            !state.readyPlayer &&
            Number.isFinite(state.player.stopTimer)
        ) {
            considerEvent(Math.max(0, state.player.stopTimer));
        }

        const playerVelocityX =
            state.player.direction.x * PACMAN_SPEED;

        const playerVelocityY =
            state.player.direction.y * PACMAN_SPEED;

        for (let index = 0; index < state.ghosts.length; index++) {
            const ghost = state.ghosts[index];

            if (ghost.frightened) {
                considerEvent(ghost.frightenedTimer);
            }

            considerArrival(ghost, ghost.speed);

            const collisionTime = getSearchCollisionTime(
                state.player,
                ghost,
                playerVelocityX,
                playerVelocityY
            );

            if (Number.isFinite(collisionTime)) {
                considerEvent(collisionTime, index);
            }
        }

        return {
            timeToNextEvent,
            collisionedGhostIndex
        };
    }

    /*
    setSearchGhostState(ghost, "frightened");
    setSearchGhostState(ghost, "eaten");
    setSearchGhostState(ghost, "normal");
    */
    function setSearchGhostState(ghost, state) {
        switch (state) {
            case "normal":
                ghost.eaten = false;
                ghost.frightened = false;
                ghost.frightenedTimer = undefined;
                ghost.speed = GHOST_SPEED;
                break;

            case "frightened":
                if (ghost.eaten) return;

                ghost.eaten = false;
                ghost.frightened = true;
                ghost.frightenedTimer = FRIGHTENED_DURATION;
                ghost.speed = FRIGHTENED_GHOST_SPEED;
                break;

            case "eaten":
                ghost.eaten = true;
                ghost.frightened = false;
                ghost.frightenedTimer = undefined;
                ghost.speed = EATEN_GHOST_SPEED;
                break;

            default:
                throw new Error(`Unknown search ghost state: ${state}`);
        }
    }

    // Applies the current actor's decision without advancing simulation time.
    function applySearchActions(state, ghostDirections, playerDirection) {
        const next = {
            ...state,
            pellets: new Set(state.pellets),
            player: cloneSearchCharacter(state.player),
            ghosts: state.ghosts.map(cloneSearchCharacter),
            readyPlayer: state.readyPlayer,
            readyGhosts: [...state.readyGhosts]
        };

        if (state.firstActor === "ghosts") {
            if (playerDirection !== null) {
                throw new Error(
                    "Pac-Man cannot act before the ghosts in this state."
                );
            }

            for (const [index, direction] of ghostDirections) {
                if (!state.readyGhosts[index]) {
                    throw new Error(
                        `Ghost ${index} is not ready to act.`
                    );
                }

                const ghost = next.ghosts[index];
                const previous = state.ghosts[index];
                const continues =
                    direction.x === ghost.direction.x &&
                    direction.y === ghost.direction.y;
                const reverses =
                    direction.x === -ghost.direction.x &&
                    direction.y === -ghost.direction.y;

                if (reverses && previous.progress > 0) {
                    reverseSearchGhost(ghost);
                } else if (
                    !isSearchDecidingBetweenCells(previous) ||
                    continues
                ) {
                    ghost.direction = { ...direction };
                }

                next.readyGhosts[index] = false;
            }
        } else if (state.firstActor === "player") {
            if (ghostDirections.length > 0) {
                throw new Error(
                    "Ghosts cannot act before Pac-Man in this state."
                );
            }

            if (!state.readyPlayer || !playerDirection) {
                throw new Error(
                    "Pac-Man must provide an action in this state."
                );
            }

            next.player.direction = { ...playerDirection };
            next.readyPlayer = false;

            if (playerDirection.x === 0 && playerDirection.y === 0) {
                next.player.stopped = true;
                next.player.stopTimer =
                    config.rules.STOP_DECISION_INTERVAL;
            } else {
                next.player.stopped = false;
                next.player.stopTimer = 0;
            }
        } else {
            throw new Error("No valid actor is available to decide.");
        }

        return next;
    }

    function advanceSearchCharactersToEvent(state, elapsedTime) {
        state.time += elapsedTime;

        state.readyPlayer = moveSearchCharacterToEvent(
            state.player,
            PACMAN_SPEED,
            elapsedTime
        );

        if (state.player.stopped && !state.readyPlayer) {
            state.player.stopTimer -= elapsedTime;

            if (state.player.stopTimer <= 0) {
                state.readyPlayer = true;
                state.player.stopTimer =
                    config.rules.STOP_DECISION_INTERVAL;
            }
        }

        for (
            let ghostIndex = 0; ghostIndex < state.ghosts.length; ghostIndex++) {
            const ghost = state.ghosts[ghostIndex];

            const arrived = moveSearchCharacterToEvent(
                ghost,
                ghost.speed,
                elapsedTime
            );

            state.readyGhosts[ghostIndex] = arrived;

            if (arrived) {
                ghost.decisionAtCentre = true;
            }

            updateSearchGhostFrightenedTimer(ghost, elapsedTime);

            recoverSearchGhostAtHouse(state, ghostIndex, arrived);
        }
    }


    function resolveSearchEvent(
        previousState,
        nextState,
        collisionedGhostIndex
    ) {
        if (nextState.readyPlayer) {
            collectSearchPellet(nextState);
        }

        resolveSearchCollision(
            previousState,
            nextState,
            collisionedGhostIndex
        );

        return nextState;
    }

    // Advances a frightened ghost's timer and restores its normal state
    // when the frightened period expires.
    function updateSearchGhostFrightenedTimer(ghost, elapsedTime) {
        if (!ghost.frightened) return;

        ghost.frightenedTimer -= elapsedTime;

        if (ghost.frightenedTimer <= 0) {
            setSearchGhostState(ghost, "normal");
        }
    }

    // Restores an eaten ghost when it reaches one of its respawn houses.
    function recoverSearchGhostAtHouse(state, ghostIndex, arrived) {
        if (!arrived) return;

        const ghost = state.ghosts[ghostIndex];

        if (!ghost.eaten) return;

        const reachedHouse = state.respawnState.houses.some(house =>
            ghost.x === house.x && ghost.y === house.y
        );

        if (!reachedHouse) return;

        setSearchGhostState(ghost, "normal");
        state.readyGhosts[ghostIndex] = true;
    }



    // Advances the simulation to the next relevant event rather than by
    // a fixed time step. Events include cell arrivals, frightened-mode
    // expiration, pellet collection, and continuous player-ghost collision.
    // Returns a new state without modifying the input state.
    function advanceSearchState(state, ghostDirections, playerDirection) {
        const next = applySearchActions(
            state,
            ghostDirections,
            playerDirection
        );

        if (next.readyPlayer || next.readyGhosts.some(Boolean)) {
            return finalizeSearchState(next);
        }

        const {
            timeToNextEvent,
            collisionedGhostIndex
        } = getSearchNextEvent(next);

        if (!Number.isFinite(timeToNextEvent)) {
            return finalizeSearchState(next);
        }


        // Next update the next state with timeToNextEvent calculated

        // Movement to the new state is done progressively. Changes in order here might have some collateral effect but should not usually.
        // Many conditions are checked here but it will be usual that only one, the originator of the event, has to do things. 
        // For example, frightened timer reaching 0 can be thought to have to be above the code checking that a power pill was eaten, so that the ghost enters frightened mode in 
        // the new state. But since only the first event is the originator of the state (the first thing to happen), only the check to see if frightened timer reaches 0 for a 
        // ghost will happen, and the pill will be reached in another subsequent state.

        advanceSearchCharactersToEvent(
            next,
            timeToNextEvent
        );

        resolveSearchEvent(
            state,
            next,
            collisionedGhostIndex
        );

        return finalizeSearchState(next);
    }


    // Enumerates joint actions for all ghosts currently ready to decide.
    function getSearchGhostActionProfiles(state) {
        const readyGhostIndices = [];

        for (let i = 0; i < state.ghosts.length; i++) {
            if (state.readyGhosts[i]) {
                readyGhostIndices.push(i);
            }
        }

        if (readyGhostIndices.length === 0) {
            return [];
        }

        let profiles = [[]];

        for (const ghostIndex of readyGhostIndices) {
            // const ghost = state.ghosts[ghostIndex];
            const directions = getSearchGhostDirections(state, ghostIndex);

            const nextProfiles = [];

            for (const profile of profiles) {
                for (const direction of directions) {
                    nextProfiles.push([
                        ...profile,
                        [ghostIndex, direction]
                    ]);
                }
            }

            profiles = nextProfiles;
        }

        return profiles;
    }

    function getSearchPlayerActionProfiles(state) {
        if (!state.readyPlayer) {
            return [];
        }

        const directions = getSearchDirections(
            state,
            state.player,
            false
        );

        // A stopped player may wait for the next decision slot instead of
        // starting now, so waiting is an explicit action.
        if (
            state.player.stopped &&
            !directions.some(direction =>
                direction.x === 0 && direction.y === 0
            )
        ) {
            directions.push({ x: 0, y: 0 });
        }

        return directions;
    }


    // Enumerates the joint actions available at the current event.
    // Only characters whose readiness flags are set choose new directions;
    // all other characters continue their existing movement.
    function getSearchActionProfiles(state) {
        if (state.terminal) return [];

        if (state.firstActor === "ghosts") {
            return getSearchGhostActionProfiles(state).map(
                ghostDirections => ({
                    ghostDirections,
                    playerDirection: null,
                    child: null
                })
            );
        }

        if (state.firstActor === "player") {
            return getSearchPlayerActionProfiles(state)
                .filter(Boolean)
                .map(playerDirection => ({
                    ghostDirections: [],
                    playerDirection,
                    child: null
                }));
        }

        return [];
    }

    // The game and calibration use the same RBFM engine. This adapter only
    // translates game states into generic RBFM transitions and exposes the
    // actions selected by the root edges.
    // Any calibration with samples is usable, completed or not: partial
    // tables are better than deterministic guesses. Buckets without data
    // fall back to the average observed deviation, and every deviation is
    // floored so the search never becomes fully deterministic.
    function getCalibrationDistribution(node) {
        const calibration = map?.calibration;

        if (
            !calibration ||
            calibration.version !== CALIBRATION_VERSION ||
            Object.keys(calibration.f || {}).length === 0
        ) {
            // No calibration at all: keep the prior deviation instead of
            // collapsing to a deterministic walk.
            return {
                mean: node.value + config.strategy.BASE_MEAN,
                standardDeviation: config.strategy.BASE_STD
            };
        }

        const key = `${node.searchCount},${node.successors.length}`;
        const correction = Number(calibration.f?.[key]);
        const variance = Number(calibration.g?.[key]);

        return {
            mean: node.value +
                config.strategy.BASE_MEAN +
                (Number.isFinite(correction) ? correction : 0),
            standardDeviation: Number.isFinite(variance)
                ? Math.max(
                    config.strategy.CALIBRATION_MIN_STD,
                    Math.sqrt(Math.max(0, variance))
                )
                : config.strategy.BASE_STD
        };
    }

    // The calibration is updated while the game runs (the worker reports
    // partial tables). The strategy snapshots the map, so the tables have
    // to be pushed into that snapshot and the node distributions rebuilt.
    function setCalibration(calibration) {
        map.calibration = calibration
            ? {
                ...calibration,
                f: { ...(calibration.f || {}) },
                g: { ...(calibration.g || {}) }
            }
            : undefined;

    }

    function* createGameRbfmSuccessors(state) {
        for (const profile of getSearchActionProfiles(state)) {
            const nextState = advanceSearchState(
                state,
                profile.ghostDirections,
                profile.playerDirection
            );

            yield {
                state: nextState,
                value: evaluateSearchState(nextState),
                duration: nextState.time - state.time,
                action: {
                    ghostDirections: profile.ghostDirections,
                    playerDirection: profile.playerDirection
                }
            };
        }
    }

    // Optional bridge to the strategy Web Worker. The main thread injects
    // `worker` (see game-ai-controller); inside workers it stays null and
    // the search runs locally on the simulation context.
    // The anchor makes the worker re-predict from the state the game just
    // reached, after a decision.
    function requestWorkerAction(mode, searchContext, indices, readyPlayer) {
        worker?.anchor?.({
            mode,
            map,
            searchContext,
            readyGhostIndices: indices,
            readyPlayer
        });
    }

    function anchorSearchContext(
        searchContext,
        readyGhostIndices = [],
        readyPlayer = false
    ) {
        requestWorkerAction(
            "ghost",
            searchContext,
            readyGhostIndices,
            readyPlayer
        );
    }

    // The walk is bounded; when the bound is hit the search keeps the
    // static value, and this warning makes it visible in the console.
    let lastWalkLimitWarningAt = 0;

    function warnWalkLimit(info) {
        const now = Date.now();

        if (now - lastWalkLimitWarningAt < 2000) {
            return;
        }

        lastWalkLimitWarningAt = now;
        console.warn("[rbfm] walk limit reached", info);
    }

    const rbfmSearch = rmfMinimax({
        getNodeType: getNodeType,
        createSuccessorIterator: createGameRbfmSuccessors,
        onWalkLimit: warnWalkLimit,
        getDistribution: getCalibrationDistribution,
        maxExtendDepth: config.strategy.SEARCH_MAX_EXTEND_DEPTH
    });

    function setSearchRootFromState(state) {
        return rbfmSearch.setRoot(
            state,
            evaluateSearchState(state),
            state.time
        );
    }

    function getOrSetSearchRoot(
        searchContext,
        readyGhostIndices = [],
        readyPlayer = false
    ) {
        return setSearchRootFromState(
            createCurrentGameSearchState(
                searchContext,
                readyGhostIndices,
                readyPlayer
            )
        );
    }

    function ensureExpanded(node) {
        if (!node.expansionComplete) {
            rbfmSearch.expandNode(node, node.state.time);
            }
    }

    function getBestAction(node) {
        ensureExpanded(node);
        return rbfmSearch.getBestChild(node)?.action;
    }

    // Advances the shared RBFM exploration without blocking the game loop
    // with a second search implementation. `planEndTime` is the game time
    // where the plan ends: the walk stays random inside it and starts the
    // improve/worsen alternation when it leaves it.
    function advanceSearch(planEndTime = null) {
        if (!rbfmSearch.root) {
            return;
        }

        rbfmSearch.rootDecision(
            rbfmSearch.root.state.time,
            planEndTime
        );
    }

    // ============================================================
    // POLICY BUFFER
    // ============================================================
    //
    // The worker walks the event tree of the next second and stores the
    // direction every AI-controlled character would choose at each
    // decision state. Only the human-controlled character branches, so
    // any legal line the player takes is already covered.

    function getReadySearchGhostIndices(state) {
        const indices = [];

        for (let index = 0; index < state.readyGhosts.length; index++) {
            if (state.readyGhosts[index]) {
                indices.push(index);
            }
        }

        return indices;
    }

    function getHumanGhostDirections(state, ghostIndex) {
        const directions = new Map();

        for (const profile of getSearchGhostActionProfiles(state)) {
            for (const [index, direction] of profile) {
                if (index === ghostIndex) {
                    directions.set(
                        `${direction.x},${direction.y}`,
                        { ...direction }
                    );
                }
            }
        }

        return [...directions.values()];
    }

    // Advances a state without any ready actor to the next decision event.
    function advanceSearchToNextEvent(state) {
        const next = {
            ...state,
            pellets: new Set(state.pellets),
            player: cloneSearchCharacter(state.player),
            ghosts: state.ghosts.map(cloneSearchCharacter),
            readyPlayer: state.readyPlayer,
            readyGhosts: [...state.readyGhosts]
        };

        const { timeToNextEvent, collisionedGhostIndex } =
            getSearchNextEvent(next);

        if (!Number.isFinite(timeToNextEvent)) {
            return finalizeSearchState(next);
        }

        advanceSearchCharactersToEvent(next, timeToNextEvent);
        resolveSearchEvent(state, next, collisionedGhostIndex);

        return finalizeSearchState(next);
    }

    function createPolicyBufferJob(searchContext, options = {}) {
        const origin = createCurrentGameSearchState(
            searchContext,
            options.readyGhostIndices || [],
            Boolean(options.readyPlayer)
        );

        const originTime = origin.time;
        let root = origin;
        let guard = 0;

        while (
            !root.terminal &&
            !root.readyPlayer &&
            !root.readyGhosts.some(Boolean) &&
            guard++ < 64
        ) {
            root = advanceSearchToNextEvent(root);
        }

        const horizonSeconds = Number.isFinite(options.horizonSeconds)
            ? options.horizonSeconds
            : 1;
        const maxNodes = Number.isInteger(options.maxNodes)
            ? options.maxNodes
            : 64;

        return {
            root,
            originTime,
            // The worker builds a longer plan than the slice it sends: the
            // extra game time is the cushion the search walks randomly
            // before it starts the improve/worsen alternation.
            horizonSeconds,
            maxNodes,
            transmittedHorizonSeconds: Number.isFinite(
                options.transmittedHorizonSeconds
            )
                ? options.transmittedHorizonSeconds
                : horizonSeconds,
            transmittedMaxNodes: Number.isInteger(
                options.transmittedMaxNodes
            )
                ? options.transmittedMaxNodes
                : maxNodes,
            planEndTime: originTime + horizonSeconds,
            searchSteps: Number.isInteger(options.searchSteps)
                ? options.searchSteps
                : 0,
            humanGhostIndex: root.controlledGhostIndex,
            plan: [],
            nodeCount: 0,
            queue: [{
                id: 0,
                state: root,
                parent: -1,
                choice: null
            }],
            nextId: 1,
            visited: new Set([buildStateKey(root)]),
            complete: false
        };
    }

    function enqueuePlanState(job, state, parent, choice) {
        if (state.terminal) {
            return null;
        }

        const key = buildStateKey(state);

        if (job.visited.has(key)) {
            return null;
        }

        job.visited.add(key);

        const id = job.nextId++;

        job.queue.push({ id, state, parent, choice });

        return id;
    }

    function createPlanNode(job, item, actor) {
        const node = {
            id: item.id,
            parent: item.parent,
            choice: item.choice,
            actor,
            action: null,
            choices: null,
            child: null,
            time: item.state.time - job.originTime
        };

        job.plan[node.id] = node;
        job.nodeCount++;

        return node;
    }

    // Builds the plan slice that goes to the main thread: only the first
    // part of the internal plan (the transmitted game-time horizon) and a
    // bounded node count. Links to nodes outside the slice are cut so the
    // cursor stops cleanly instead of jumping to a missing node.
    function getTransmittedPlan(job) {
        const horizon = job.transmittedHorizonSeconds;
        const maxNodes = job.transmittedMaxNodes;

        const transmitted = Array.from(
            { length: job.plan.length },
            (_, id) => {
                const node = job.plan[id];

                if (!node || id >= maxNodes || node.time > horizon + 1e-9) {
                    return null;
                }

                return {
                    id: node.id,
                    parent: node.parent,
                    choice: node.choice,
                    actor: node.actor,
                    action: node.action,
                    choices: null,
                    child: null,
                    time: node.time
                };
            }
        );

        for (const node of transmitted) {
            if (node === null) {
                continue;
            }

            const source = job.plan[node.id];

            if (
                Number.isInteger(source.child) &&
                transmitted[source.child]
            ) {
                node.child = source.child;
            }

            if (source.choices !== null) {
                node.choices = source.choices.map(choice => ({
                    direction: { ...choice.direction },
                    child: transmitted[choice.child]
                        ? choice.child
                        : null
                }));
            }
        }

        return transmitted;
    }

    function stepGhostDecision(job, state, item) {
        const readyGhostIndices = getReadySearchGhostIndices(state);
        const humanIndex = readyGhostIndices.includes(job.humanGhostIndex) &&
            !state.ghosts[job.humanGhostIndex].eaten
            ? job.humanGhostIndex
            : -1;
        const automatedIndices = readyGhostIndices.filter(
            index => index !== humanIndex
        );
        const queryState = automatedIndices.length > 0
            ? createCurrentGameSearchState(
                state,
                automatedIndices,
                state.readyPlayer
            )
            : null;
        const searchSteps =
            Math.abs(state.time - job.root.time) <= 1e-9
                ? job.searchSteps
                : 0;
        const directions = queryState
            ? chooseGhostDirections(
                queryState,
                automatedIndices,
                state.readyPlayer,
                searchSteps,
                job.planEndTime
            )
            : null;
        const node = createPlanNode(job, item, "ghost");

        if (directions) {
            node.action = {
                ghostDirections: [...directions.entries()].map(
                    ([index, direction]) => [index, { ...direction }]
                )
            };
        }

        if (humanIndex < 0) {
            node.child = enqueuePlanState(
                job,
                advanceSearchState(state, directions || new Map(), null),
                node.id,
                null
            );

            return;
        }

        node.choices = [];

        for (const direction of getHumanGhostDirections(state, humanIndex)) {
            const jointDirections = new Map(directions || []);
            jointDirections.set(humanIndex, { ...direction });

            const child = enqueuePlanState(
                job,
                advanceSearchState(state, jointDirections, null),
                node.id,
                {
                    mode: "ghost",
                    index: humanIndex,
                    direction: { ...direction }
                }
            );

            if (child !== null) {
                node.choices.push({
                    direction: { ...direction },
                    child
                });
            }
        }
    }

    function stepPlayerDecision(job, state, item) {
        const readyGhostIndices = getReadySearchGhostIndices(state);
        const node = createPlanNode(job, item, "player");

        if (job.humanGhostIndex < 0) {
            node.choices = [];

            for (const direction of getSearchPlayerActionProfiles(state)) {
                const child = enqueuePlanState(
                    job,
                    advanceSearchState(state, [], direction),
                    node.id,
                    {
                        mode: "player",
                        index: -1,
                        direction: { ...direction }
                    }
                );

                if (child !== null) {
                    node.choices.push({
                        direction: { ...direction },
                        child
                    });
                }
            }

            return;
        }

        const searchSteps =
            Math.abs(state.time - job.root.time) <= 1e-9
                ? job.searchSteps
                : 0;
        const direction = choosePacmanDirection(
            state,
            readyGhostIndices,
            searchSteps,
            job.planEndTime
        );

        node.action = { playerDirection: { ...direction } };
        node.child = enqueuePlanState(
            job,
            advanceSearchState(state, [], direction),
            node.id,
            null
        );
    }

    function stepPolicyBufferJob(job, maxStates = 1) {
        for (let step = 0; step < maxStates; step++) {
            if (job.complete) {
                break;
            }

            if (job.queue.length === 0) {
                job.complete = true;
                break;
            }

            if (job.nodeCount >= job.maxNodes) {
                job.complete = true;
                break;
            }

            const item = job.queue.shift();
            const state = item.state;

            if (state.time - job.originTime > job.horizonSeconds) {
                continue;
            }

            if (state.terminal) {
                continue;
            }

            const readyGhostIndices = getReadySearchGhostIndices(state);

            if (readyGhostIndices.length === 0 && !state.readyPlayer) {
                continue;
            }

            if (state.firstActor === "ghosts") {
                stepGhostDecision(job, state, item);
            } else if (state.firstActor === "player") {
                stepPlayerDecision(job, state, item);
            }
        }

        return job;
    }

    function getFallbackGhostDirections(searchContext, indices) {
        return new Map(indices.map(index => [
            index,
            { ...searchContext.ghosts[index].direction }
        ]));
    }

    // Instant fallback used when the buffer misses and a worker owns the
    // search: continue if possible, otherwise take the first legal move.
    // It must never start a search on the main thread.
    function getCheapGhostDirections(state, indices) {
        const directions = new Map();

        for (const index of indices) {
            const ghost = state.ghosts[index];
            const legal = getSearchDirections(state, ghost, true);
            const continues = legal.find(direction =>
                direction.x === ghost.direction.x &&
                direction.y === ghost.direction.y
            );
            const first = legal.find(direction =>
                direction.x !== 0 || direction.y !== 0
            );

            directions.set(
                index,
                continues
                    ? { ...continues }
                    : first
                        ? { ...first }
                        : { x: 0, y: 0 }
            );
        }

        return directions;
    }

    function getCheapPlayerDirection(state) {
        const player = state.player;
        const legal = getSearchDirections(state, player, false);
        const continues = legal.find(direction =>
            direction.x === player.direction.x &&
            direction.y === player.direction.y
        );
        const first = legal.find(direction =>
            direction.x !== 0 || direction.y !== 0
        );

        return continues
            ? { ...continues }
            : first
                ? { ...first }
                : { ...player.direction };
    }

    function chooseGhostDirections(
        searchContext,
        readyGhostIndices,
        readyPlayer = false,
        searchSteps = 0,
        planEndTime = null
    ) {
        const planned = worker?.getPlanAction?.("ghost");

        if (planned?.ghostDirections) {
            return new Map(planned.ghostDirections.map(([index, direction]) => [
                index,
                { ...direction }
            ]));
        }

        const state = createCurrentGameSearchState(
            searchContext,
            readyGhostIndices,
            readyPlayer
        );

        // The worker owns the search: never run it on the main thread.
        if (worker) {
            return getCheapGhostDirections(state, readyGhostIndices);
        }

        const root = setSearchRootFromState(state);

        for (let step = 0; step < searchSteps; step++) {
            advanceSearch(planEndTime);
        }

        const rootAction = getBestAction(root);

        if (!rootAction) {
            return getFallbackGhostDirections(searchContext, readyGhostIndices);
        }

        let action = rootAction;

        if (root.state.firstActor === "player") {
            const child = rbfmSearch.getBestChild(root)?.child;
            action = child ? getBestAction(child) : null;
        }

        if (!action?.ghostDirections) {
            return getFallbackGhostDirections(searchContext, readyGhostIndices);
        }

        return new Map(action.ghostDirections.map(([index, direction]) => [
            index,
            { ...direction }
        ]));
    }

    function choosePacmanDirection(
        searchContext,
        readyGhostIndices = [],
        searchSteps = 0,
        planEndTime = null
    ) {
        const planned = worker?.getPlanAction?.("player");

        if (planned?.playerDirection) {
            return { ...planned.playerDirection };
        }

        const state = createCurrentGameSearchState(
            searchContext,
            readyGhostIndices,
            true
        );

        if (worker) {
            return getCheapPlayerDirection(state);
        }

        const root = setSearchRootFromState(state);

        for (let step = 0; step < searchSteps; step++) {
            advanceSearch(planEndTime);
        }

        const rootEdge = rbfmSearch.getBestChild(root);
        let action = rootEdge?.action;

        if (root.state.firstActor === "ghosts" && rootEdge) {
            action = getBestAction(rootEdge.child);
        }

        if (action?.playerDirection) {
            return { ...action.playerDirection };
        }

        // Never leave Pac-Man standing when the state still has a move:
        // the search fallback used to return direction { x: 0, y: 0 }.
        const fallback = getSearchDirections(
            state,
            state.player,
            false
        )[0];

        return fallback && (fallback.x !== 0 || fallback.y !== 0)
            ? { ...fallback }
            : { ...searchContext.player.direction };
    }
    return {
        calculateDomain,
        cloneSearchCharacter,
        createCurrentGameSearchState,
        buildStateKey,
        evaluateSearchState,
        advanceSearchState,
        getSearchGhostActionProfiles,
        getSearchPlayerActionProfiles,
        getSearchActionProfiles,
        advanceSearch,
        chooseGhostDirections,
        choosePacmanDirection,
        createPolicyBufferJob,
        stepPolicyBufferJob,
        getTransmittedPlan,
        anchorSearchContext,
        getNodeType,
        setCalibration
    }
}
