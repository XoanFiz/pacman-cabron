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

    const propagateFromGhostHouse = (ghostHouses, ghost, ghostIndex, time = 0) => {
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
            propagateFromGhostHouse(ghostHouses, ghost, i, time)
        } else {
            if (ghost.frightened) {
                // Blue territory: starts at the ghost's current position. 
                pushBlueDomainSeeds(queue, ghost, owner, time);

                // Normal territory: propagates from the ghost's house. 
                propagateFromGhostHouse(ghostHouses, ghost, i, time)
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

    return {
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
        )
    };
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

// Advances the simulation to the next relevant event rather than by
// a fixed time step. Events include cell arrivals, frightened-mode
// expiration, pellet collection, and continuous player-ghost collision.
// Returns a new state without modifying the input state.
function advanceSearchState(state, ghostDirections, playerDirection) {
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

    let timeToNextEvent = Infinity;

    const computeCentreArrivalCandidate = (character, speed) => {
        if (character.direction.x === 0 && character.direction.y === 0) {
            return;
        }

        const timeToCenter =
            Math.max(0, 1 - character.progress) / speed;

        timeToNextEvent = Math.min(timeToNextEvent, timeToCenter);
    };

    // Pac-man
    computeCentreArrivalCandidate(next.player, PACMAN_SPEED);

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


    let collisionedGhostIndex = -1;
    // Ghosts 
    for (let ghostIndex = 0; ghostIndex < next.ghosts.length; ghostIndex++) {
        const ghost = next.ghosts[ghostIndex];
        if (ghost.frightened) {
            // Frightened expirancy
            timeToNextEvent = Math.min(
                timeToNextEvent,
                ghost.frightenedTimer
            );
        }

        computeCentreArrivalCandidate(
            ghost,
            ghost.eaten ? EATEN_GHOST_SPEED : GHOST_SPEED
        );

        if (ghost.eaten) {
            continue;
        }

        // Begin considering a current collision
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
        const relativeVelocitySquared =
            relativeVelocityX * relativeVelocityX +
            relativeVelocityY * relativeVelocityY;
        const distanceSquared =
            relativeX * relativeX +
            relativeY * relativeY;

        if (distanceSquared <= GHOST_COLLISION_DISTANCE ** 2) {
            timeToNextEvent = 0;
            collisionedGhostIndex = ghostIndex;
            continue;
        }
        // End considering a current collision

        // Begin considering a future collision
        if (relativeVelocitySquared === 0) {
            collisionedGhostIndex = ghostIndex;
            continue;
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
            collisionedGhostIndex = ghostIndex;
            continue;
        }

        const collisionTime =
            (-linear - Math.sqrt(discriminant)) /
            (2 * relativeVelocitySquared);

        if (collisionTime >= 0) {
            timeToNextEvent = Math.min(
                timeToNextEvent,
                collisionTime
            );
            if (timeToNextEvent == timeToNextEvent) {
                collisionedGhostIndex = ghostIndex;
            }
        }
        // End considering a future collision
    }

    if (!Number.isFinite(timeToNextEvent)) {
        return next;
    }


    next.time += timeToNextEvent;

    // Update the next state with timeToNextEvent calculated

    // This funcion need to be used upon every character individually
    const moveToEvent = (character, speed) => {
        if (character.direction.x === 0 && character.direction.y === 0) {
            return false;
        }

        character.progress += speed * timeToNextEvent;

        if (character.progress < 1 - SEARCH_EPSILON) {
            return false;
        }

        character.progress = Math.max(0, character.progress - 1);
        character.x = wrap(character.x + character.direction.x, getMapColumnCount(currentMap));
        character.y = wrap(character.y + character.direction.y, getMapRowCount(currentMap));

        return true;
    };

    // Movement to the new state is done progressively. Changes in order here might have some collateral effect but should not usually.
    // Many conditions are checked here but it will be usual that only one, the originator of the event, has to do things. 
    // For example, frightened timer reaching 0 can be thought to have to be above the code checking that a power pill was eaten, so that the ghost enters frightened mode in 
    // the new state. But since only the first event is the originator of the state (the first thing to happen), only the check to see if frightened timer reaches 0 for a 
    // ghost will happen, and the pill will be reached in another subsequent state.

    next.readyPlayer = moveToEvent(next.player, PACMAN_SPEED);

    for (let ghostIndex = 0; ghostIndex < next.ghosts.length; ghostIndex++) {
        const ghost = next.ghosts[ghostIndex];

        const ghostSpeed = ghost.eaten
            ? EATEN_GHOST_SPEED
            : ghost.frightened
                ? FRIGHTENED_GHOST_SPEED
                : GHOST_SPEED;

        const arrived = moveToEvent(ghost, ghostSpeed);

        next.readyGhosts[ghostIndex] = arrived;

        if (ghost.frightened) {
            ghost.frightenedTimer -= timeToNextEvent;

            if (ghost.frightenedTimer <= 0) {
                ghost.frightened = false;
                ghost.frightenedTimer = undefined;
            }
        }
        if (arrived) {
            if (ghost.eaten) {
                if (state.respawnState.houses.some(house =>
                    ghost.x === house.x && ghost.y === house.y
                )
                ) {
                    ghost.eaten = false;
                    ghost.frightened = false;
                    next.readyGhosts[ghostIndex] = true;
                }
            }
        }
    }

    if (next.readyPlayer) {
        const cell = currentMap.tiles[next.player.y][next.player.x];

        if ((cell === "." || cell === "o") && next.pellets.has(`${next.player.x},${next.player.y}`)) {
            next.pellets.delete(`${next.player.x},${next.player.y}`);

            if (cell === "o") {
                for (let ghostIndex = 0; ghostIndex < next.ghosts.length; ghostIndex++) {
                    const ghost = next.ghosts[ghostIndex];
                    if (ghost.eaten) {
                        continue;
                    }

                    ghost.frightened = true;
                    ghost.frightenedTimer = FRIGHTENED_GHOST_SPEED;
                    // reverseSearchGhost(ghost);
                    next.readyGhosts[ghostIndex] = true;
                }
            }
        }
    }

    if (collisionedGhostIndex >= 0) {
        const collisionedGhost =
            next.ghosts[collisionedGhostIndex];

        if (collisionedGhost.frightened) {
            collisionedGhost.eaten = true;
            collisionedGhost.frightened = false;
            collisionedGhost.frightenedTimer = undefined;
        } else {
            next.lives--;

            if (next.lives <= 0) {
                next.terminal = true;
                next.readyPlayer = false;
                next.readyGhosts = next.ghosts.map(() => false);

                return next;
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

                return {
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
            });

            next.readyPlayer =
                state.controlledGhostIndex === -1;

            next.readyGhosts = next.ghosts.map(
                (_, index) =>
                    index === state.controlledGhostIndex
            );
        }
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
    const key = buildStateKey(state);
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
function processStrategicSearchCandidate(node, candidateTransition) {
    const childState = candidateTransition.nextState;
    const childKey = buildStateKey(childState);
    const childValue = evaluateSearchState(childState);

    candidateTransition.processed = true;
    candidateTransition.value = childValue;

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
                candidateTransition,
                node.depth + 1,
                childValue
            );
            candidateTransition.child = child;
        } else if (child !== node && !hasStrategicSearchPath(child, node)) {
            candidateTransition.child = child;
            child.incomingEdges.push({
                parent: node,
                candidate: candidateTransition
            });
            candidateTransition.value = child.value;
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
            null,
            null,
            0,
            evaluateSearchState(provisionalState)
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

        const value = candidate.child
            ? candidate.child.value
            : candidate.processed
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
        : { ...root.state.player.direction };
}
