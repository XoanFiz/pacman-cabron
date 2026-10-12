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
            { length: ROWS },
            () => Array(COLS).fill(Infinity)
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
        owners: []
    };
}


// Computes a multi-source, time-dependent Voronoi partition of the
// map. Each character propagates its reachable territory according
// to movement speed, current movement progress, and collision rules.
// Equal-time arrivals preserve shared ownership, while contested
// cells stop further propagation. Eaten ghosts re-enter the search
// from their possible return-to-house positions.
function calculateDomain({
    respectCurrentMovement = true,
    includePacman = true
} = {}) {

    const domain =
        Array.from(
            { length: ROWS },
            () => Array.from(
                { length: COLS },
                createDomainCell
            )
        );


    let queue = new MinHeap();
    const processedStates = new Set();


    // --------------------------------------------------------
    // PAC-MAN
    // --------------------------------------------------------

    if (includePacman) {
        queue.push({
            x: player.x,
            y: player.y,
            time: gameTime,
            owner: "pacman",
            originX: player.x,
            originY: player.y,
            speed: PACMAN_SPEED,
            initialProgress: player.progress,
            initialDirection: player.direction,
            initialMove:
                respectCurrentMovement &&
                player.progress > 0 &&
                (player.direction.x !== 0 || player.direction.y !== 0) &&
                canMove(player.x, player.y, player.direction)
        });
    }


    // --------------------------------------------------------
    // GHOSTS
    // --------------------------------------------------------

    for (let i = 0; i < ghosts.length; i++) {

        const ghost = ghosts[i];
        const owner = `ghost${i}`;

        if (ghost.eaten) {
            const isMoving =
                ghost.progress > 0 &&
                (ghost.direction.x !== 0 || ghost.direction.y !== 0) &&
                canMove(ghost.x, ghost.y, ghost.direction);
            const nextX =
                wrap(ghost.x + ghost.direction.x, COLS);
            const nextY =
                wrap(ghost.y + ghost.direction.y, ROWS);

            for (const house of GHOST_HOUSES) {
                const distance =
                    isMoving
                        ? 1 - ghost.progress +
                        shortestDistance(nextX, nextY, house.x, house.y)
                        : shortestDistance(ghost.x, ghost.y, house.x, house.y);

                if (!Number.isFinite(distance)) {
                    continue;
                }

                queue.push({
                    x: house.x,
                    y: house.y,
                    time: gameTime + distance / EATEN_GHOST_SPEED,
                    owner,
                    originX: house.x,
                    originY: house.y,
                    speed: GHOST_SPEED,
                    initialProgress: 0,
                    initialDirection: { x: 0, y: 0 },
                    initialMove: false
                });
            }

            continue;
        }

        queue.push({
            x: ghost.x,
            y: ghost.y,
            time: gameTime,
            owner,
            originX: ghost.x,
            originY: ghost.y,
            speed: GHOST_SPEED,
            initialProgress: ghost.progress,
            initialDirection: ghost.direction,
            initialMove:
                respectCurrentMovement &&
                ghost.progress > 0 &&
                (ghost.direction.x !== 0 || ghost.direction.y !== 0) &&
                canMove(ghost.x, ghost.y, ghost.direction)
        });
    }


    // --------------------------------------------------------
    // MULTI-SOURCE TEMPORAL FLOOD
    // --------------------------------------------------------

    while (!queue.empty()) {

        const assessedDomainCell =
            queue.pop();


        const currentDomainCell =
            domain[
            assessedDomainCell.y
            ][
            assessedDomainCell.x
            ];

        if (assessedDomainCell.time > currentDomainCell.arrival) {
            // An owner may revisit its starting cell after the forced first move.
            if (
                (
                    assessedDomainCell.x !== assessedDomainCell.originX ||
                    assessedDomainCell.y !== assessedDomainCell.originY
                ) ||
                currentDomainCell.owners.length !== 1 ||
                currentDomainCell.owners[0] !== assessedDomainCell.owner
            ) {
                continue;
            }
        }

        if (assessedDomainCell.time < currentDomainCell.arrival) {
            currentDomainCell.arrival = assessedDomainCell.time;
            currentDomainCell.owners = [assessedDomainCell.owner];
            currentDomainCell.direction = assessedDomainCell.direction;
        } else if (
            assessedDomainCell.time === currentDomainCell.arrival &&
            !currentDomainCell.owners.includes(assessedDomainCell.owner)
        ) {
            currentDomainCell.owners.push(assessedDomainCell.owner);
        }

        const stateKey =
            `${assessedDomainCell.owner}:${assessedDomainCell.x},${assessedDomainCell.y}:${Number(assessedDomainCell.initialMove)}`;

        if (processedStates.has(stateKey)) {
            continue;
        }

        processedStates.add(stateKey);

        // Stop at a meeting point: a character must not propagate into
        // territory already reached by another character at the same time.
        if (currentDomainCell.owners.length > 1) {
            continue;
        }

        // Pacman stops expanding as soon as he reaches a power pill.
        if (
            assessedDomainCell.owner === "pacman" &&
            MAP[assessedDomainCell.y][assessedDomainCell.x] === "o"
        ) {
            continue;
        }


        /*
         * We spread the wave.
         */
        for (
            const next of
            graph[assessedDomainCell.y][assessedDomainCell.x]
        ) {

            if (
                assessedDomainCell.initialMove &&
                (
                    next.direction.x !== assessedDomainCell.initialDirection.x ||
                    next.direction.y !== assessedDomainCell.initialDirection.y
                )
            ) {
                continue;
            }

            const nextTime =
                assessedDomainCell.time +
                (
                    assessedDomainCell.initialMove
                        ? 1 - assessedDomainCell.initialProgress
                        : 1
                ) /
                assessedDomainCell.speed;


            const nextCell =
                domain[
                next.y
                ][
                next.x
                ];


            /*
             * We only want to propagate if we can
             * improve the time.
             */
            if (
                nextTime > nextCell.arrival &&
                (
                    next.x !== assessedDomainCell.originX ||
                    next.y !== assessedDomainCell.originY ||
                    nextCell.owners.length !== 1 ||
                    nextCell.owners[0] !== assessedDomainCell.owner
                )
            ) {
                continue;
            }


            queue.push({
                x: next.x,
                y: next.y,
                time: nextTime,
                owner: assessedDomainCell.owner,
                originX: assessedDomainCell.originX,
                originY: assessedDomainCell.originY,
                speed: assessedDomainCell.speed,
                direction: next.direction,
                initialMove: false
            });
        }
    }


    return domain;
}

// Extracts ghost ownership identifiers from a cell's complete
// ownership set, including ghosts represented by recovered states.
function getGhostOwners(owners) {

    return owners.filter(
        owner =>
            owner.startsWith("ghost") || owner.startsWith("recoveredGhost")
    );
}

// Resolves a ghost ownership identifier to the corresponding index
// in the global ghosts array.
function getGhostIndex(owner) {

    return Number(
        owner.replace("recoveredGhost", "").replace("ghost", "")
    );
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
        wrap(character.x + character.direction.x, COLS);
    const nextY =
        wrap(character.y + character.direction.y, ROWS);

    return 1 - character.progress +
        shortestDistance(nextX, nextY, targetX, targetY);
}

// Estimates when a ghost could reach Pac-Man. Eaten ghosts must
// first return to a house and then resume normal-speed movement.
function getGhostArrivalTimeToPlayer(ghost) {
    if (!ghost.eaten) {
        return getRemainingDistanceToPosition(
            ghost,
            player.x,
            player.y
        ) / GHOST_SPEED;
    }

    let minimumArrivalTime = Infinity;

    for (const house of GHOST_HOUSES) {
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
function calculateNormalAndPelletScore(
    domain
) {

    let pelletScore = 0;

    let pacmanControlledSquares = 0;
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (
                MAP[y][x] !== "#" &&
                domain[y][x].owners.includes("pacman")
            ) {
                pacmanControlledSquares++;
            }
        }
    }

    const normalScore =
        TOTAL_NORMAL_VALUE /
        Math.max(1, pacmanControlledSquares);
    const nearestGhostArrivalTime =
        Math.min(
            ...ghosts.map(getGhostArrivalTimeToPlayer)
        );
    const normalArrivalMultiplier =
        Number.isFinite(nearestGhostArrivalTime)
            ? 1 + 1 / (1 + Math.max(0, nearestGhostArrivalTime))
            : 1;
    const proximityAdjustedNormalScore =
        normalScore * normalArrivalMultiplier;
    const pelletValue =
        pellets > 0
            ? TOTAL_PELLET_VALUE / pellets
            : 0;


    for (let y = 0; y < ROWS; y++) {

        for (let x = 0; x < COLS; x++) {

            const cell =
                MAP[y][x];


            if (
                cell !== "." &&
                cell !== "o"
            ) {
                continue;
            }


            const ghostOwners =
                getGhostOwners(
                    domain[y][x].owners
                );


            if (ghostOwners.length === 0)
                continue;

            const travelTime =
                Math.max(
                    0,
                    domain[y][x].arrival - gameTime
                );
            const distanceWeight =
                1 / (1 + travelTime);

            pelletScore +=
                pelletValue *
                distanceWeight /
                ghostOwners.length;
        }
    }


    return {
        normalScore: proximityAdjustedNormalScore,
        pelletScore
    };
}


// ============================================================
// BLUE PELLET DOMAIN
// ============================================================

// Distributes remaining pellet value among frightened ghosts that
// own each pellet's cell, preserving shared ownership when arrivals
// are tied.
function calculateBluePelletValues(
    domain
) {

    const values =
        ghosts.map(() => 0);


    const activeBlue =
        ghosts
            .map((ghost, index) => ({
                ghost,
                index
            }))
            .filter(({ ghost }) => ghost.frightened);


    if (activeBlue.length === 0)
        return values;


    /*
    * The total value of the pellets is still being distributed
    * among the remaining pellets.
    */
    const pelletValue =
        pellets > 0
            ? TOTAL_PELLET_VALUE / pellets
            : 0;


    for (let y = 0; y < ROWS; y++) {

        for (let x = 0; x < COLS; x++) {

            const cell =
                MAP[y][x];


            if (
                cell !== "." &&
                cell !== "o"
            ) {
                continue;
            }


            /*
            * Blue ghosts that dominate this square
            * according to normal domain.
            */
            const blueOwners =
                domain[y][x]
                    .owners
                    .filter(owner =>
                        owner.startsWith("ghost")
                    )
                    .filter(owner => {

                        const index =
                            getGhostIndex(
                                owner
                            );

                        return (
                            ghosts[index].frightened
                        );
                    });


            if (
                blueOwners.length === 0
            ) {
                continue;
            }


            /*
            * The pellet's value is distributed among the
            * tied blue ghosts.
            */
            const share =
                pelletValue /
                blueOwners.length;


            for (
                const owner of blueOwners
            ) {

                const index =
                    getGhostIndex(
                        owner
                    );


                values[index] +=
                    share;
            }
        }
    }


    return values;
}


// ============================================================
// BLUE BALANCED SCORE
// ============================================================

// Evaluates the strategic value of frightened-ghost territory by
// combining its total pellet value with the Jain Fairness Index.
// This rewards both territory acquisition and balanced distribution
// among the active frightened ghosts.
function calculateBlueScore(
    domain
) {

    const values =
        calculateBluePelletValues(
            domain
        );


    const activeValues =
        values.filter(
            (value, index) =>
                ghosts[index].frightened
        );


    if (
        activeValues.length === 0
    ) {
        return 0;
    }


    const total =
        activeValues.reduce(
            (sum, value) =>
                sum + value,
            0
        );


    if (total === 0)
        return 0;


    const squares =
        activeValues.reduce(
            (sum, value) =>
                sum + value * value,
            0
        );


    /*
     * Jain Fairness Index.
     *
     * 1 = perfectly balanced distribution
     * 1/n = all value concentrated in one ghost
     */
    const fairness =
        total * total /
        (
            activeValues.length *
            squares
        );


    /*
    * We want it to matter as much:
    *
    * - how much pellet territory there is
    * - how balanced is the distribution
    */
    return total * fairness;
}


// ============================================================
// TOTAL DOMAIN EVALUATION
// ============================================================


// Combines the territory, ordinary-pellet, and frightened-ghost
// evaluations into a single objective, with a cap on the contribution
// of ordinary pellets relative to normal territory.
function evaluateDomain(
    domain
) {

    const normal =
        calculateNormalAndPelletScore(
            domain
        );


    const blue =
        calculateBlueScore(
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

        weightedPelletScore +

        WEIGHT_BLUE *
        blue;


    return {
        normalScore:
            normal.normalScore,

        pelletScore:
            normal.pelletScore,

        blueScore:
            blue,

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
function createSearchState(readyGhostIndices, readyPlayer = false) {
    const readyGhostSet = new Set(readyGhostIndices);

    return {
        map: MAP.slice(),
        pellets,
        lives,
        time: gameTime,
        frightenedTimer,
        player: cloneSearchCharacter(player),
        ghosts: ghosts.map(cloneSearchCharacter),
        controlledGhostIndex: selectedCharacter.startsWith("ghost-")
            ? Number(selectedCharacter.slice("ghost-".length))
            : -1,
        terminal: false,
        readyPlayer,
        readyGhosts: ghosts.map((_, index) => readyGhostSet.has(index))
    };
}


// Produces a canonical key for state deduplication. It includes
// movement progress and decision readiness, distinguishing states
// whose future transitions may differ despite sharing cell positions.
function searchStateKey(state) {
    const characterKey = character => [
        character.x,
        character.y,
        character.direction.x,
        character.direction.y,
        Number(character.progress.toFixed(5)),
        Boolean(character.frightened),
        Boolean(character.eaten),
        character.nextDirection
            ? character.nextDirection.x
            : null,
        character.nextDirection
            ? character.nextDirection.y
            : null
    ].join(",");

    return JSON.stringify([
        state.map,
        state.pellets,
        state.lives,
        state.terminal,
        state.controlledGhostIndex,
        Number(state.frightenedTimer.toFixed(5)),
        characterKey(state.player),
        state.player.nextDirection.x,
        state.player.nextDirection.y,
        state.ghosts.map(characterKey),
        state.readyPlayer,
        state.readyGhosts
    ]);
}

// Evaluates a hypothetical state using the domain objective and
// penalizes lost lives. Temporarily installs the simulated state into
// the existing evaluator, then restores the live game state even
// if evaluation fails.
function evaluateSearchState(state) {
    const previousState = {
        MAP,
        pellets,
        gameTime,
        frightenedTimer,
        player,
        ghosts
    };

    try {
        MAP = state.map.slice();
        pellets = state.pellets;
        gameTime = state.time;
        frightenedTimer = state.frightenedTimer;
        player = cloneSearchCharacter(state.player);
        ghosts = state.ghosts.map(cloneSearchCharacter);

        const domainValue =
            evaluateDomain(
                calculateDomain({
                    includePacman: !state.terminal
                })
            ).total;

        return (
            (INITIAL_LIVES - state.lives) *
            SEARCH_LIFE_PRIORITY
        ) + domainValue;
    } finally {
        MAP = previousState.MAP;
        pellets = previousState.pellets;
        gameTime = previousState.gameTime;
        frightenedTimer = previousState.frightenedTimer;
        player = previousState.player;
        ghosts = previousState.ghosts;
    }
}

// Checks movement legality against the simulated map and the game's
// boundary restrictions, independently of the live game state.
function canMoveInSearchState(state, character, direction) {
    const x = wrap(character.x + direction.x, COLS);
    const y = wrap(character.y + direction.y, ROWS);

    return state.map[y][x] !== "#" &&
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
        ghost.x = wrap(ghost.x + ghost.direction.x, COLS);
        ghost.y = wrap(ghost.y + ghost.direction.y, ROWS);
        ghost.progress = 1 - ghost.progress;
    }

    ghost.direction.x *= -1;
    ghost.direction.y *= -1;
}

// Advances the simulation to the next relevant event rather than by
// a fixed time step. Events include cell arrivals, frightened-mode
// expiration, pellet collection, and continuous player-ghost collision.
// Returns a new state without modifying the input state.
function advanceSearchState(state, ghostDirections, playerDirection) {
    const next = {
        ...state,
        map: state.map.slice(),
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

    let nextEventTime = Infinity;

    const findNextEvent = (character, speed) => {
        if (character.direction.x === 0 && character.direction.y === 0) {
            return;
        }

        const timeToCenter =
            Math.max(0, 1 - character.progress) / speed;

        nextEventTime = Math.min(nextEventTime, timeToCenter);
    };

    findNextEvent(next.player, PACMAN_SPEED);

    if (next.frightenedTimer > 0) {
        nextEventTime = Math.min(
            nextEventTime,
            next.frightenedTimer
        );
    }

    const playerX =
        next.player.x +
        next.player.direction.x *
        next.player.progress;
    const playerY =
        next.player.y +
        next.player.direction.y *
        next.player.progress;
    const playerVelocityX =
        next.player.direction.x * PACMAN_SPEED;
    const playerVelocityY =
        next.player.direction.y * PACMAN_SPEED;

    for (const ghost of next.ghosts) {
        findNextEvent(
            ghost,
            ghost.eaten ? EATEN_GHOST_SPEED : GHOST_SPEED
        );

        if (ghost.eaten) {
            continue;
        }

        const relativeX =
            ghost.x +
            ghost.direction.x * ghost.progress -
            playerX;
        const relativeY =
            ghost.y +
            ghost.direction.y * ghost.progress -
            playerY;
        const relativeVelocityX =
            ghost.direction.x *
            (ghost.eaten ? EATEN_GHOST_SPEED : GHOST_SPEED) -
            playerVelocityX;
        const relativeVelocityY =
            ghost.direction.y *
            (ghost.eaten ? EATEN_GHOST_SPEED : GHOST_SPEED) -
            playerVelocityY;
        const velocitySquared =
            relativeVelocityX * relativeVelocityX +
            relativeVelocityY * relativeVelocityY;
        const distanceSquared =
            relativeX * relativeX +
            relativeY * relativeY;

        if (distanceSquared <= GHOST_COLLISION_DISTANCE ** 2) {
            nextEventTime = 0;
            continue;
        }

        if (velocitySquared === 0) {
            continue;
        }

        const linear =
            2 * (
                relativeX * relativeVelocityX +
                relativeY * relativeVelocityY
            );
        const discriminant =
            linear * linear -
            4 * velocitySquared *
            (distanceSquared - GHOST_COLLISION_DISTANCE ** 2);

        if (discriminant < 0) {
            continue;
        }

        const collisionTime =
            (-linear - Math.sqrt(discriminant)) /
            (2 * velocitySquared);

        if (collisionTime >= 0) {
            nextEventTime = Math.min(
                nextEventTime,
                collisionTime
            );
        }
    }

    if (!Number.isFinite(nextEventTime)) {
        return next;
    }

    next.time += nextEventTime;

    if (next.frightenedTimer > 0) {
        next.frightenedTimer -= nextEventTime;

        if (next.frightenedTimer <= 0) {
            next.frightenedTimer = 0;

            for (const ghost of next.ghosts) {
                if (!ghost.eaten) {
                    ghost.frightened = false;
                }
            }
        }
    }

    const moveToEvent = (character, speed) => {
        if (character.direction.x === 0 && character.direction.y === 0) {
            return false;
        }

        character.progress += speed * nextEventTime;

        if (character.progress < 1 - SEARCH_EPSILON) {
            return false;
        }

        character.progress = Math.max(0, character.progress - 1);
        character.x = wrap(character.x + character.direction.x, COLS);
        character.y = wrap(character.y + character.direction.y, ROWS);

        return true;
    };

    next.readyPlayer = moveToEvent(next.player, PACMAN_SPEED);

    for (let i = 0; i < next.ghosts.length; i++) {
        const ghost = next.ghosts[i];
        const arrived = moveToEvent(
            ghost,
            ghost.eaten ? EATEN_GHOST_SPEED : GHOST_SPEED
        );

        next.readyGhosts[i] = arrived;

        if (
            arrived &&
            ghost.eaten &&
            GHOST_HOUSES.some(house =>
                ghost.x === house.x && ghost.y === house.y
            )
        ) {
            ghost.eaten = false;
            ghost.frightened = false;
            next.readyGhosts[i] = true;
        }
    }

    if (next.readyPlayer) {
        const cell = next.map[next.player.y][next.player.x];

        if (cell === "." || cell === "o") {
            const row = next.map[next.player.y].split("");
            row[next.player.x] = " ";
            next.map[next.player.y] = row.join("");
            next.pellets--;

            if (cell === "o") {
                next.frightenedTimer = FRIGHTENED_DURATION;

                for (const ghost of next.ghosts) {
                    if (ghost.eaten) {
                        continue;
                    }

                    ghost.frightened = true;
                    reverseSearchGhost(ghost);
                }
            }
        }
    }

    const currentPlayerX =
        next.player.x +
        next.player.direction.x *
        next.player.progress;
    const currentPlayerY =
        next.player.y +
        next.player.direction.y *
        next.player.progress;

    for (const ghost of next.ghosts) {
        const dx =
            ghost.x +
            ghost.direction.x *
            ghost.progress -
            currentPlayerX;
        const dy =
            ghost.y +
            ghost.direction.y *
            ghost.progress -
            currentPlayerY;

        if (
            Math.sqrt(dx * dx + dy * dy) >
            GHOST_COLLISION_DISTANCE + SEARCH_EPSILON ||
            ghost.eaten
        ) {
            continue;
        }

        if (ghost.frightened) {
            ghost.eaten = true;
            ghost.frightened = false;
            continue;
        }

        next.lives--;
        next.terminal = true;
        next.frightenedTimer = 0;

        for (const remainingGhost of next.ghosts) {
            if (!remainingGhost.eaten) {
                remainingGhost.frightened = false;
            }
        }

        break;
    }

    return next;
}


// Enumerates the joint actions available at the current event.
// Only characters whose readiness flags are set choose new directions;
// all other characters continue their existing movement.
function getSearchActionProfiles(state) {
    if (state.terminal) {
        return [];
    }

    const readyGhosts = state.readyGhosts
        .map((ready, index) => ready ? index : -1)
        .filter(index => index >= 0);

    const ghostProfiles = [];

    const addGhostProfiles = (position, directions) => {
        if (position === readyGhosts.length) {
            ghostProfiles.push(directions.slice());
            return;
        }

        const index = readyGhosts[position];

        for (const direction of getSearchGhostDirections(state, index)) {
            directions.push([index, { ...direction }]);
            addGhostProfiles(position + 1, directions);
            directions.pop();
        }
    };

    addGhostProfiles(0, []);

    const playerDirections = state.readyPlayer
        ? getSearchDirections(state, state.player, false)
        : [null];

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

// Creates a node in the shared strategic search graph. Identical
// states can reuse an existing node, while incoming edges allow value
// changes to propagate back to every parent that depends on the node.
function createStrategicSearchNode(state, parent, parentEdge, depth, value) {
    const key = searchStateKey(state);
    const node = {
        key,
        state,
        parent,
        parentEdge,
        depth,
        staticValue: value,
        value,
        candidates: null,
        nextCandidate: 0,
        incomingEdges: [],
        expanded: state.terminal,
        heapIndex: -1,
        readyGhosts: state.readyGhosts.some(Boolean),
        readyPlayer: state.readyPlayer
    };

    if (parent && parentEdge) {
        node.incomingEdges.push({
            parent,
            candidate: parentEdge
        });
    }

    strategicSearch.nodes.set(key, node);

    if (!node.expanded) {
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
        processed: false,
        value: node.staticValue,
        child: null
    }));

    if (node.candidates.length === 0) {
        node.expanded = true;
    }
}

// Aggregates action values according to the decision-maker at the
// current event. Ghosts maximize their outcome; Pac-Man minimizes it.
// When both sides can act, the value follows a maximin interpretation:
// the ghosts choose a move and Pac-Man chooses the best response.
function getStrategicSearchNodeValue(node) {
    if (!node.candidates || node.candidates.length === 0) {
        return node.staticValue;
    }

    const hasGhostMove = node.readyGhosts;
    const hasPlayerMove = node.readyPlayer;
    const ghostGroups = new Map();

    for (const candidate of node.candidates) {
        const ghostKey = candidate.ghostDirections
            .map(([index, direction]) =>
                `${index}:${direction.x},${direction.y}`
            )
            .join("|");
        const value = candidate.child
            ? candidate.child.value
            : candidate.processed
                ? candidate.value
                : node.staticValue;

        if (!ghostGroups.has(ghostKey)) {
            ghostGroups.set(ghostKey, []);
        }

        ghostGroups.get(ghostKey).push(value);
    }

    if (hasGhostMove && hasPlayerMove) {
        const worstResponses = Array.from(ghostGroups.values())
            .map(values => Math.min(...values));

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
        const nextValue = getStrategicSearchNodeValue(current);

        if (Math.abs(nextValue - current.value) <= EPSILON) {
            continue;
        }

        current.value = nextValue;
        updateStrategicSearchFrontier(current);

        for (const edge of current.incomingEdges) {
            edge.candidate.value = nextValue;

            if (!queued.has(edge.parent)) {
                pending.push(edge.parent);
                queued.add(edge.parent);
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
            if (candidate.child) {
                pending.push(candidate.child);
            }
        }
    }

    return false;
}

// Evaluates one candidate transition and connects its resulting state
// to the shared graph when doing so does not introduce an ancestor
// cycle. Repeated states reuse their existing values and dependencies.
function processStrategicSearchCandidate(node, candidate) {
    const childState = candidate.nextState;
    const childKey = searchStateKey(childState);
    const childValue = evaluateSearchState(childState);

    candidate.processed = true;
    candidate.value = childValue;

    const isAncestor = (() => {
        let ancestor = node;

        while (ancestor) {
            if (ancestor.key === childKey) {
                return true;
            }

            ancestor = ancestor.parent;
        }

        return false;
    })();

    if (!isAncestor) {
        let child = strategicSearch.nodes.get(childKey);

        if (!child) {
            child = createStrategicSearchNode(
                childState,
                node,
                candidate,
                node.depth + 1,
                childValue
            );
            candidate.child = child;
        } else if (child !== node && !hasStrategicSearchPath(child, node)) {
            candidate.child = child;
            child.incomingEdges.push({
                parent: node,
                candidate
            });
            candidate.value = child.value;
        }
    }

    refreshStrategicSearchValues(node);
}

// Defines frontier priority from the current decision-maker's
// perspective, preferring strategically promising nodes while using
// depth and improvement over the parent as tie-breakers.
function compareStrategicSearchNodes(a, b) {
    const aSign = a.readyGhosts ? 1 : -1;
    const bSign = b.readyGhosts ? 1 : -1;
    const aValue = a.value * aSign;
    const bValue = b.value * bSign;

    if (Math.abs(aValue - bValue) > EPSILON) {
        return bValue - aValue;
    }

    if (a.depth !== b.depth) {
        return a.depth - b.depth;
    }

    const aImprovement = a.parent
        ? (a.value - a.parent.staticValue) * (a.parent.readyGhosts ? 1 : -1)
        : 0;
    const bImprovement = b.parent
        ? (b.value - b.parent.staticValue) * (b.parent.readyGhosts ? 1 : -1)
        : 0;

    return bImprovement - aImprovement;
}

// Swaps two frontier entries while keeping each node's stored heap
// index synchronized with its actual position.
function swapStrategicSearchFrontier(a, b) {
    const frontier = strategicSearch.frontier;

    [frontier[a], frontier[b]] = [frontier[b], frontier[a]];
    frontier[a].heapIndex = a;
    frontier[b].heapIndex = b;
}

// Inserts a node into the indexed priority queue used to schedule
// further search expansions.
function pushStrategicSearchFrontier(node) {
    const frontier = strategicSearch.frontier;
    let index = frontier.length;

    frontier.push(node);
    node.heapIndex = index;

    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);

        if (compareStrategicSearchNodes(frontier[index], frontier[parent]) >= 0) {
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
    let index = node.heapIndex;

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
    first.heapIndex = -1;

    if (frontier.length > 0) {
        frontier[0] = last;
        last.heapIndex = 0;
        updateStrategicSearchFrontier(last);
    }

    return first;
}

// Removes a specific node from the frontier in logarithmic time,
// using its stored heap index rather than searching the queue.
function removeStrategicSearchFrontier(node) {
    const index = node.heapIndex;

    if (index < 0) {
        return;
    }

    const frontier = strategicSearch.frontier;
    const last = frontier.pop();
    node.heapIndex = -1;

    if (index < frontier.length) {
        frontier[index] = last;
        last.heapIndex = index;
        updateStrategicSearchFrontier(last);
    }
}


// Performs a bounded amount of search work per frame, allowing the
// strategic graph to expand incrementally without monopolizing the
// game loop. Each expansion processes one candidate transition.
function advanceStrategicSearch() {
    for (
        let expansion = 0;
        expansion < SEARCH_EXPANSIONS_PER_FRAME;
        expansion++
    ) {
        const node = popStrategicSearchFrontier();

        if (!node) {
            return;
        }

        if (node.expanded) {
            continue;
        }

        prepareStrategicSearchNode(node);

        if (!node.expanded) {
            const candidate = node.candidates[node.nextCandidate++];
            processStrategicSearchCandidate(node, candidate);

            if (node.nextCandidate >= node.candidates.length) {
                node.expanded = true;
            } else {
                pushStrategicSearchFrontier(node);
            }
        }
    }
}

// Selects the ghost's direction from the best available joint ghost
// action, evaluating each action against Pac-Man's worst response.
// Unresolved candidates use their parent's static evaluation until
// further search expansions provide more accurate values.
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
        const candidateValue = candidate.child
            ? candidate.child.value
            : candidate.processed
                ? candidate.value
                : node.staticValue;

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
function getStrategicSearchRoot(readyGhosts, readyPlayer = false) {
    const readyGhostIndices = readyGhosts.map(ghost => ghosts.indexOf(ghost));
    const state = createSearchState(readyGhostIndices, readyPlayer);
    const key = searchStateKey(state);
    let root = strategicSearch.nodes.get(key);

    if (!root) {
        root = createStrategicSearchNode(
            state,
            null,
            null,
            0,
            evaluateSearchState(state)
        );
    }

    prepareStrategicSearchNode(root);

    while (root.nextCandidate < root.candidates.length) {
        const candidate = root.candidates[root.nextCandidate++];
        processStrategicSearchCandidate(root, candidate);
    }

    root.expanded = true;
    removeStrategicSearchFrontier(root);

    strategicSearch.root = root;

    return root;
}


// Chooses coordinated directions for the ghosts that are ready to
// move, treating their simultaneous decisions as a joint action.
function chooseStrategicGhostDirections(readyGhosts) {
    const root = getStrategicSearchRoot(readyGhosts);

    return new Map(
        readyGhosts.map(ghost => {
            const index = ghosts.indexOf(ghost);

            return [
                ghost,
                getStrategicGhostDirection(
                    root,
                    index,
                    ghost.direction
                )
            ];
        })
    );
}

// Chooses Pac-Man's move by minimizing the worst outcome across
// the ghost responses represented in the root's candidate actions.
function chooseStrategicPacmanDirection() {
    const root = getStrategicSearchRoot([], true);
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
        const value = candidate.processed
            ? candidate.value
            : root.staticValue;

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
        : { ...player.direction };
}


// ============================================================
// GHOST MOVE EVALUATION
// ============================================================

// Returns the legal directions available to a character at its
// current position, using the live game's movement constraints.
function getPossibleDirections(
    character
) {

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

// ============================================================
