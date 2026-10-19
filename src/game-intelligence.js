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
            { length: getMapRowCount(currentMap) },
            () => Array(getMapColumnCount(currentMap)).fill(Infinity)
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
        const direction = assessedDomainFact.initialDirection;

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


    function pushBlueDomainSeeds(queue, ghost, owner, time) {
        queue.push({
            x: ghost.x,
            y: ghost.y,
            time,
            frightenedTimer: ghost.frightenedTimer,
            owner,
            domainType: "blue",
            originX: ghost.x,
            originY: ghost.y,
            speed: EATEN_GHOST_SPEED,
            initialProgress: ghost.progress,
            initialDirection: ghost.direction
        });
    }

    const propagateFromGhostHouses = (ghostHouses, ghost, ghostIndex, time = 0) => {
        const isMoving =
            ghost.progress > 0 &&
            (ghost.direction.x !== 0 || ghost.direction.y !== 0) &&
            canMove(ghost.x, ghost.y, ghost.direction);
        const nextX =
            wrap(ghost.x + ghost.direction.x, getMapColumnCount(currentMap));
        const nextY =
            wrap(ghost.y + ghost.direction.y, getMapRowCount(currentMap));

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
        const nextTime =
            assessedDomainStatus.time +
            (
                1 - assessedDomainStatus.initialProgress
            ) / assessedDomainStatus.speed;


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
            { length: getMapRowCount(currentMap) },
            () => Array.from(
                { length: getMapColumnCount(currentMap) },
                createDomainCell
            )
        );

    const processedDomainMessages = new Set();


    // --------------------------------------------------------
    // PAC-MAN
    // --------------------------------------------------------

    if (includePacman) {
        queue.push({
            x: player.x,
            y: player.y,
            time: time,
            owner: "pacman",
            domainType: "normal",
            originX: player.x,
            originY: player.y,
            speed: PACMAN_SPEED,
            initialProgress: player.progress,
            initialDirection: player.direction
        });
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
                queue.push({
                    x: ghost.x,
                    y: ghost.y,
                    time,
                    owner,
                    domainType: "normal",
                    originX: ghost.x,
                    originY: ghost.y,
                    speed: GHOST_SPEED,
                    initialProgress: ghost.progress,
                    initialDirection: ghost.direction
                });
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
                currentMap.tiles[assessedDomainFact.y][assessedDomainFact.x] === "o" &&
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

// Extracts ghost ownership identifiers from a cell's complete
// ownership set, including ghosts represented by recovered states.
// function getGhostOwners(owners) {

//     return owners.filter(
//         owner =>
//             owner.startsWith("ghost") || owner.startsWith("recoveredGhost")
//     );
// }

// Resolves a ghost ownership identifier to the corresponding index
// in the global ghosts array.
// function getGhostIndex(owner) {

//     return Number(
//         owner.replace("recoveredGhost", "").replace("ghost", "")
//     );
// }

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
        canMove(character.x, character.y, character.direction);

    if (!isMoving) {
        return shortestDistance(
            character.x,
            character.y,
            targetX,
            targetY
        );
    }

    const nextX =
        wrap(character.x + character.direction.x, getMapColumnCount(currentMap));
    const nextY =
        wrap(character.y + character.direction.y, getMapRowCount(currentMap));

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
    for (let y = 0; y < getMapRowCount(currentMap); y++) {
        for (let x = 0; x < getMapColumnCount(currentMap); x++) {
            if (
                currentMap.tiles[y][x] !== "#" &&
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
    const pelletCount = pellets.length;
    const pelletValue =
        pelletCount > 0
            ? TOTAL_PELLET_VALUE / pelletCount
            : 0;


    for (let y = 0; y < getMapRowCount(currentMap); y++) {

        for (let x = 0; x < getMapColumnCount(currentMap); x++) {

            const cell =
                currentMap.tiles[y][x];


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


            if (ghostOwner === "")
                continue;

            const travelTime =
                Math.max(
                    0,
                    domain[y][x].arrival - time
                );
            const distanceWeight =
                1 / (1 + travelTime);

            pelletScore +=
                pelletValue *
                distanceWeight;
        }
    }


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
    return {
        ...character,
        direction: { ...character.direction },
        nextDirection: character.nextDirection
            ? { ...character.nextDirection }
            : undefined
    };
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
    const characterKey = character => [
        character.x,
        character.y,
        character.direction.x,
        character.direction.y,
        Number(character.progress.toFixed(5)),
        Boolean(character.frightened),
        Number.isFinite(character.frightenedTimer)
            ? Number(character.frightenedTimer.toFixed(5))
            : null,
        Boolean(character.eaten),
        character.nextDirection
            ? character.nextDirection.x
            : null,
        character.nextDirection
            ? character.nextDirection.y
            : null
    ].join(",");

    // I do not include time in the key: the domain evaluation uses the arrival time relative to the state's timestamp, 
    // and the remaining fear time is already represented within each ghost. This allows for the sharing of equivalent 
    // states reached at different absolute times.
    return JSON.stringify([
        [...state.pellets].sort(),
        state.lives,
        state.terminal,
        state.controlledGhostIndex,
        characterKey(state.player),
        state.ghosts.map(characterKey),
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

// Evaluates a hypothetical state using the domain objective and
// penalizes lost lives. Temporarily installs the simulated state into
// the existing evaluator, then restores the live game state even
// if evaluation fails.
function evaluateSearchState(state) {
    const lifePenalty =
        (INITIAL_LIVES - state.lives) *
        SEARCH_LIFE_PRIORITY;

    if (state.terminal) {
        return lifePenalty;
    }

    const domain = calculateDomain(state.player, state.ghosts, state.respawnState.houses, state.pellets, state.time, true);

    const domainValue = evaluateDomain(
        state,
        domain
    ).total;

    return lifePenalty + domainValue;
}

// Checks movement legality against the simulated map and the game's
// boundary restrictions, independently of the live game state.
function canMoveInSearchState(state, character, direction) {
    const x = wrap(character.x + direction.x, getMapColumnCount(currentMap));
    const y = wrap(character.y + direction.y, getMapRowCount(currentMap));

    return currentMap.tiles[y][x] !== "#" &&
        !isBoundaryBlocked(character.x, character.y, direction);
}

// Generates legal movement choices, with a fallback for characters
// that have no available move. Eaten ghosts may continue their current
// direction when temporarily unable to select a new one.
function getSearchDirections(state, character, isGhost) {
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
function getSearchGhostDirections(state, index) {
    const ghost = state.ghosts[index];

    if (
        index === state.controlledGhostIndex &&
        !ghost.eaten
    ) {
        if (
            ghost.nextDirection &&
            canMoveInSearchState(state, ghost, ghost.nextDirection)
        ) {
            return [{ ...ghost.nextDirection }];
        }

        if (canMoveInSearchState(state, ghost, ghost.direction)) {
            return [{ ...ghost.direction }];
        }

        return [
            getSearchDirections(state, ghost, true)[0]
        ];
    }

    return getSearchDirections(state, ghost, true);
}

// Reverses a ghost's movement without teleporting it to a cell center.
// If it is between cells, the position and progress are transformed
// together to preserve its physical location.
function reverseSearchGhost(ghost) {
    if (ghost.progress > 0) {
        ghost.x = wrap(ghost.x + ghost.direction.x, getMapColumnCount(currentMap));
        ghost.y = wrap(ghost.y + ghost.direction.y, getMapRowCount(currentMap));
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
        getMapColumnCount(currentMap)
    );

    character.y = wrap(
        character.y + character.direction.y,
        getMapRowCount(currentMap)
    );

    return true;
}

function collectSearchPellet(state) {
    if (!state.readyPlayer) {
        return;
    }

    const cell = currentMap.tiles[state.player.y][state.player.x];
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

function applySearchActions(state, ghostDirections, playerDirection) {
    const next = {
        ...state,
        pellets: new Set(state.pellets),
        player: cloneSearchCharacter(state.player),
        ghosts: state.ghosts.map(cloneSearchCharacter),
        readyPlayer: false,
        readyGhosts: state.readyGhosts.map(() => false)
    };

    if (playerDirection) {
        next.player.direction = { ...playerDirection };
    }

    for (const [index, direction] of ghostDirections) {
        next.ghosts[index].direction = { ...direction };
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

    for (
        let ghostIndex = 0; ghostIndex < state.ghosts.length; ghostIndex++) {
        const ghost = state.ghosts[ghostIndex];

        const arrived = moveSearchCharacterToEvent(
            ghost,
            ghost.speed,
            elapsedTime
        );

        state.readyGhosts[ghostIndex] = arrived;

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



function getSearchGhostActionProfiles(state) {
    const readyGhosts = state.readyGhosts
        .map((ready, index) => ready ? index : -1)
        .filter(index => index >= 0);

    const profiles = [];

    const addProfiles = (position, directions) => {
        if (position === readyGhosts.length) {
            profiles.push(directions.slice());
            return;
        }

        const index = readyGhosts[position];

        for (const direction of getSearchGhostDirections(state, index)) {
            directions.push([index, { ...direction }]);
            addProfiles(position + 1, directions);
            directions.pop();
        }
    };

    addProfiles(0, []);

    return profiles;
}

function getSearchPlayerActionProfiles(state) {
    if (!state.readyPlayer) {
        return [null];
    }

    return getSearchDirections(state, state.player, false);
}


// Enumerates the joint actions available at the current event.
// Only characters whose readiness flags are set choose new directions;
// all other characters continue their existing movement.
function getSearchActionProfiles(state) {
    if (state.terminal) {
        return [];
    }

    const ghostProfiles = getSearchGhostActionProfiles(state);

    const playerDirections = getSearchPlayerActionProfiles(state);

    const profiles = [];

    for (const ghostDirections of ghostProfiles) {
        for (const playerDirection of playerDirections) {
            profiles.push({
                ghostDirections,
                playerDirection,
                nextState: advanceSearchState(
                    state,
                    ghostDirections,
                    playerDirection
                )
            });
        }
    }

    return profiles;
}

function getStrategicDecisionProfiles(state) {
    if (state.terminal) {
        return [];
    }

    const firstActor = getDeterministicTurnOrder(state);

    const ghostProfiles = getSearchGhostActionProfiles(state);
    const playerDirections = getSearchPlayerActionProfiles(state);

    const profiles = [];

    if (firstActor === "ghosts") {
        for (const ghostDirections of ghostProfiles) {
            for (const playerDirection of playerDirections) {
                profiles.push({
                    firstActor,
                    ghostDirections,
                    playerDirection,
                    nextState: advanceSearchState(
                        state,
                        ghostDirections,
                        playerDirection
                    )
                });
            }
        }
    } else if (firstActor === "player") {
        for (const playerDirection of playerDirections) {
            for (const ghostDirections of ghostProfiles) {
                profiles.push({
                    firstActor,
                    ghostDirections,
                    playerDirection,
                    nextState: advanceSearchState(
                        state,
                        ghostDirections,
                        playerDirection
                    )
                });
            }
        }
    }

    return profiles;
}

// Creates a node in the shared strategic search graph. Identical
// states can reuse an existing node, while incoming edges allow value
// changes to propagate back to every parent that depends on the node.
function createStrategicSearchNode(
    state,
    value,
    discoveryDepth = 0
) {
    const key = buildStateKey(state);

    const node = {
        key,
        state,

        // Immutable baseline for this canonical state.
        staticValue: value,

        // Revisable strategic estimate.
        value,

        // Generated transitions and reverse graph dependencies.
        candidates: null,
        incomingEdges: [],

        // Mutable search progress, separate from state identity.
        exploration: {
            phase: state.terminal
                ? "complete"
                : "unprepared",

            nextCandidate: 0,
            expanded: state.terminal,

            // Scheduling hint only; not a canonical depth.
            discoveryDepth,

            // Temporary compatibility with the indexed frontier.
            heapIndex: -1
        }
    };

    strategicSearch.nodes.set(key, node);

    if (!node.exploration.expanded) {
        pushStrategicSearchFrontier(node);
    }

    return node;
}

// Lazily generates the node's possible joint actions, postponing
// branching work until the search actually reaches that node.
function prepareStrategicSearchNode(node) {
    if (node.candidates !== null) {
        return;
    }

    node.candidates = getSearchActionProfiles(node.state).map(profile => ({
        ...profile,

        // Transition lifecycle.
        evaluated: false,
        connected: false,
        cycleBlocked: false,

        // Retained for compatibility with existing consumers.
        processed: false,

        // Meaningful only until a child is connected.
        value: node.staticValue,

        // Canonical successor, when connected.
        child: null
    }));

    node.exploration.phase =
        node.candidates.length === 0
            ? "complete"
            : "prepared";

    node.exploration.expanded =
        node.candidates.length === 0;
}

function evaluateStrategicSearchCandidate(
    candidateTransition
) {
    if (candidateTransition.evaluated) {
        return candidateTransition.value;
    }

    const childState = candidateTransition.nextState;

    candidateTransition.value =
        evaluateSearchState(childState);

    candidateTransition.evaluated = true;
    candidateTransition.processed = true;

    return candidateTransition.value;
}

// Produces a stable identifier for a joint ghost action.
function getStrategicGhostActionKey(candidate) {
    return candidate.ghostDirections
        .map(([index, direction]) =>
            `${index}:${direction.x},${direction.y}`
        )
        .join("|");
}

// Returns the best currently available estimate for a candidate
// transition, whether or not its successor has been expanded.
function getStrategicCandidateValue(node, candidate) {
    if (candidate.child) {
        return candidate.child.value;
    }

    if (candidate.evaluated) {
        return candidate.value;
    }

    return node.staticValue;
}

// Aggregates action values according to the decision-maker at the
// current event. Ghosts maximize their outcome; Pac-Man minimizes it.
// When both sides can act, the value follows a maximin interpretation:
// the ghosts choose a move and Pac-Man chooses the best response.
function getStrategicSearchNodeValue(node) {
    if (!node.candidates || node.candidates.length === 0) {
        return node.staticValue;
    }

    const hasGhostMove = node.state.readyGhosts.some(Boolean);
    const hasPlayerMove = node.state.readyPlayer;
    const ghostGroups = new Map();

    for (const candidate of node.candidates) {
        const ghostKey = getStrategicGhostActionKey(candidate)
        const value = getStrategicCandidateValue(node, candidate)

        if (!ghostGroups.has(ghostKey)) {
            ghostGroups.set(ghostKey, []);
        }

        ghostGroups.get(ghostKey).push(value);
    }

    if (hasGhostMove && hasPlayerMove) {
        const worstResponses = Array.from(
            ghostGroups.values(),
            values => Math.min(...values)
        );

        return Math.max(...worstResponses);
    }

    const values = Array.from(ghostGroups.values()).flat();

    if (hasGhostMove) {
        return Math.max(...values);
    }

    if (hasPlayerMove) {
        return Math.min(...values);
    }

    return node.staticValue;
}

// Propagates changed values through the reverse dependency graph.
// Shared states may affect multiple ancestors, so updates continue
// until no reachable parent value changes beyond the tolerance.
function refreshStrategicSearchValues(node) {
    const pending = [node];
    const queued = new Set(pending);

    while (pending.length > 0) {
        const current = pending.pop();
        queued.delete(current);

        const nextValue =
            getStrategicSearchNodeValue(current);

        if (
            Math.abs(nextValue - current.value) <= EPSILON
        ) {
            continue;
        }

        current.value = nextValue;

        // The frontier is still used in this iteration.
        updateStrategicSearchFrontier(current);

        for (const edge of current.incomingEdges) {
            const parent = edge.parent;

            if (!queued.has(parent)) {
                pending.push(parent);
                queued.add(parent);
            }
        }
    }
}

// Detects whether adding a search-graph edge would create a cycle,
// allowing repeated states to be shared without introducing cyclic
// dependencies into the graph.
function hasStrategicSearchPath(start, target) {
    const pending = [start];
    const visited = new Set();

    while (pending.length > 0) {
        const node = pending.pop();

        if (node === target) {
            return true;
        }

        if (visited.has(node)) {
            continue;
        }

        visited.add(node);

        for (const candidate of node.candidates || []) {
            if (candidate.connected && candidate.child) {
                pending.push(candidate.child);
            }
        }
    }

    return false;
}

// Evaluates one candidate transition and connects its resulting state
// to the shared graph when doing so does not introduce an ancestor
// cycle. Repeated states reuse their existing values and dependencies.
function processStrategicSearchCandidate(
    node,
    candidateTransition
) {
    evaluateStrategicSearchCandidate(
        candidateTransition
    );

    connectStrategicSearchCandidate(
        node,
        candidateTransition
    );

    refreshStrategicSearchValues(node);
}

function connectStrategicSearchCandidate(
    node,
    candidateTransition
) {
    if (candidateTransition.connected) {
        return candidateTransition.child;
    }

    if (!candidateTransition.evaluated) {
        throw new Error(
            "Cannot connect an unevaluated strategic candidate."
        );
    }

    const childState = candidateTransition.nextState;
    const childKey = buildStateKey(childState);

    // A self-loop or an edge closing a graph cycle is not connected.
    if (childKey === node.key) {
        candidateTransition.cycleBlocked = true;
        return null;
    }

    let child = strategicSearch.nodes.get(childKey);

    if (child && hasStrategicSearchPath(child, node)) {
        candidateTransition.cycleBlocked = true;
        return null;
    }

    if (!child) {
        child = createStrategicSearchNode(
            childState,
            candidateTransition.value,
            node.exploration.discoveryDepth + 1
        );
    }

    candidateTransition.child = child;
    candidateTransition.connected = true;

    // Register this dependency exactly once.
    const alreadyRegistered = child.incomingEdges.some(
        edge =>
            edge.parent === node &&
            edge.candidate === candidateTransition
    );

    if (!alreadyRegistered) {
        child.incomingEdges.push({
            parent: node,
            candidate: candidateTransition
        });
    }

    return child;
}

// Defines frontier priority from the current decision-maker's
// perspective, preferring strategically promising nodes while using
// depth and improvement over the parent as tie-breakers.
function compareStrategicSearchNodes(a, b) {
    const aHasGhostMove =
        a.state.readyGhosts.some(Boolean);

    const bHasGhostMove =
        b.state.readyGhosts.some(Boolean);

    const aSign = aHasGhostMove ? 1 : -1;
    const bSign = bHasGhostMove ? 1 : -1;

    const aValue = a.value * aSign;
    const bValue = b.value * bSign;

    if (Math.abs(aValue - bValue) > EPSILON) {
        return bValue - aValue;
    }

    return (
        a.exploration.discoveryDepth -
        b.exploration.discoveryDepth
    );
}

// Swaps two frontier entries while keeping each node's stored heap
// index synchronized with its actual position.
function swapStrategicSearchFrontier(a, b) {
    const frontier = strategicSearch.frontier;

    [frontier[a], frontier[b]] = [frontier[b], frontier[a]];
    frontier[a].exploration.heapIndex = a;
    frontier[b].exploration.heapIndex = b;
}

// Inserts a node into the indexed priority queue used to schedule
// further search expansions.
function pushStrategicSearchFrontier(node) {
    const exploration = node.exploration;

    if (exploration.heapIndex >= 0) {
        updateStrategicSearchFrontier(node);
        return;
    }

    const frontier = strategicSearch.frontier;
    let index = frontier.length;

    frontier.push(node);
    exploration.heapIndex = index;

    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);

        if (
            compareStrategicSearchNodes(
                frontier[index],
                frontier[parent]
            ) >= 0
        ) {
            break;
        }

        swapStrategicSearchFrontier(index, parent);
        index = parent;
    }
}


// Restores heap order after a node's strategic value changes.
// Because values can propagate through the graph, frontier priorities
// must be updated without inserting duplicate entries.
function updateStrategicSearchFrontier(node) {
    let index = node.exploration.heapIndex;

    if (index < 0) {
        return;
    }

    const frontier = strategicSearch.frontier;

    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);

        if (compareStrategicSearchNodes(frontier[index], frontier[parent]) >= 0) {
            break;
        }

        swapStrategicSearchFrontier(index, parent);
        index = parent;
    }

    while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;

        if (
            left < frontier.length &&
            compareStrategicSearchNodes(frontier[left], frontier[best]) < 0
        ) {
            best = left;
        }

        if (
            right < frontier.length &&
            compareStrategicSearchNodes(frontier[right], frontier[best]) < 0
        ) {
            best = right;
        }

        if (best === index) {
            break;
        }

        swapStrategicSearchFrontier(index, best);
        index = best;
    }
}

// Removes and returns the highest-priority node, maintaining the
// indexed heap required for efficient subsequent updates and removals.
function popStrategicSearchFrontier() {
    const frontier = strategicSearch.frontier;

    if (frontier.length === 0) {
        return null;
    }

    const first = frontier[0];
    const last = frontier.pop();
    first.exploration.heapIndex = -1;

    if (frontier.length > 0) {
        frontier[0] = last;
        last.exploration.heapIndex = 0;
        updateStrategicSearchFrontier(last);
    }

    return first;
}

// Removes a specific node from the frontier in logarithmic time,
// using its stored heap index rather than searching the queue.
function removeStrategicSearchFrontier(node) {
    const index = node.exploration.heapIndex;

    if (index < 0) {
        return;
    }

    const frontier = strategicSearch.frontier;
    const last = frontier.pop();

    node.exploration.heapIndex = -1;

    if (index < frontier.length) {
        frontier[index] = last;
        last.exploration.heapIndex = index;

        updateStrategicSearchFrontier(last);
    }
}


// Performs a bounded amount of search work per frame, allowing the
// strategic graph to expand incrementally without monopolizing the
// game loop. Each expansion processes one candidate transition.
function advanceStrategicSearch() {
    let expansions = 0;

    while (expansions < SEARCH_EXPANSIONS_PER_FRAME) {
        const node = popStrategicSearchFrontier();

        if (!node) {
            break;
        }

        const exploration = node.exploration;

        if (exploration.expanded) {
            continue;
        }

        prepareStrategicSearchNode(node);

        if (exploration.expanded) {
            continue;
        }

        if (
            exploration.nextCandidate >=
            node.candidates.length
        ) {
            exploration.expanded = true;
            exploration.phase = "complete";
            continue;
        }

        const candidate =
            node.candidates[exploration.nextCandidate];

        processStrategicSearchCandidate(node, candidate);

        exploration.nextCandidate++;
        expansions++;

        if (
            exploration.nextCandidate >=
            node.candidates.length
        ) {
            exploration.expanded = true;
            exploration.phase = "complete";
        } else {
            pushStrategicSearchFrontier(node);
        }
    }
}

// Selects the ghost's direction from the best available joint ghost
// action, evaluating each action against Pac-Man's worst response (best for him but worst for the ghosts).
// Unresolved candidates use their parent's static evaluation until further search expansions provide more accurate values.
function getStrategicGhostDirection(node, ghostIndex, fallback) {
    prepareStrategicSearchNode(node);

    if (!node.candidates || node.candidates.length === 0) {
        return { ...fallback };
    }

    const groups = new Map();

    for (const candidate of node.candidates) {
        const ghostKey = candidate.ghostDirections
            .map(([index, direction]) =>
                `${index}:${direction.x},${direction.y}`
            )
            .join("|");

        if (!groups.has(ghostKey)) {
            groups.set(ghostKey, {
                value: Infinity,
                directions: candidate.ghostDirections
            });
        }

        const group = groups.get(ghostKey);
        const candidateValue = getStrategicCandidateValue(node, candidate)

        group.value = Math.min(group.value, candidateValue);
    }

    let best = null;

    for (const group of groups.values()) {
        if (
            !best ||
            group.value > best.value
        ) {
            best = group;
        }
    }

    const selected = best &&
        best.directions.find(([index]) => index === ghostIndex);

    return selected
        ? { ...selected[1] }
        : { ...fallback };
}

// Retrieves or initializes the search node corresponding to the
// current decision state. The root's immediate candidates are
// evaluated before it is returned for action selection.
function getOrSetStrategicSearchRoot(
    searchContext,
    readyGhostIndices = [],
    readyPlayer = false
) {
    const provisionalState = createCurrentGameSearchState(
        searchContext,
        readyGhostIndices,
        readyPlayer
    );

    const stateKey = buildStateKey(provisionalState);

    let root = strategicSearch.nodes.get(stateKey);

    if (!root) {
        root = createStrategicSearchNode(
            provisionalState,
            evaluateSearchState(provisionalState),
            0
        );
    }

    strategicSearch.root = root;

    prepareStrategicSearchNode(root);

    // Temporary legacy policy: process all root actions immediately.
    // The next iteration will move root work into the shared budget.
    while (
        root.exploration.nextCandidate <
        root.candidates.length
    ) {
        const candidate =
            root.candidates[root.exploration.nextCandidate];

        processStrategicSearchCandidate(root, candidate);

        root.exploration.nextCandidate++;
    }

    root.exploration.expanded = true;
    root.exploration.phase = "complete";

    removeStrategicSearchFrontier(root);

    return root;
}


// Chooses coordinated directions for the ghosts that are ready to
// move, treating their simultaneous decisions as a joint action.
function chooseStrategicGhostDirections(
    searchContext,
    readyGhostIndices
) {
    const root = getOrSetStrategicSearchRoot(
        searchContext,
        readyGhostIndices
    );

    return new Map(
        readyGhostIndices.map(index => [
            index,
            getStrategicGhostDirection(
                root,
                index,
                searchContext.ghosts[index].direction
            )
        ])
    );
}

// Chooses Pac-Man's move by minimizing the worst outcome across
// the ghost responses represented in the root's candidate actions.
function chooseStrategicPacmanDirection(searchContext) {
    const root = getOrSetStrategicSearchRoot(
        searchContext,
        [],
        true
    );

    const actionValues = new Map();

    for (const candidate of root.candidates) {
        const direction = candidate.playerDirection;
        const key = `${direction.x},${direction.y}`;

        const ghostKey = candidate.ghostDirections
            .map(([index, ghostDirection]) =>
                `${index}:${ghostDirection.x},${ghostDirection.y}`
            )
            .join("|");

        if (!actionValues.has(key)) {
            actionValues.set(key, {
                direction,
                ghostResponses: new Map()
            });
        }

        const action = actionValues.get(key);

        const value = getStrategicCandidateValue(
            root,
            candidate
        );

        action.ghostResponses.set(
            ghostKey,
            Math.max(
                action.ghostResponses.get(ghostKey) ?? -Infinity,
                value
            )
        );
    }

    let bestDirection = null;
    let bestValue = Infinity;

    for (const action of actionValues.values()) {
        const worstGhostResponse = Math.max(
            ...action.ghostResponses.values()
        );

        if (worstGhostResponse < bestValue) {
            bestValue = worstGhostResponse;
            bestDirection = action.direction;
        }
    }

    return bestDirection
        ? { ...bestDirection }
        : { ...root.state.player.direction };
}
