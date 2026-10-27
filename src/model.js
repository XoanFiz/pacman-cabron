function createGameModel() {
    const wrap = (value, size) => ((value % size) + size) % size;

    function createPlayerState(start, speed) {
        return {
            x: start.x, y: start.y, px: start.x, py: start.y,
            direction: { ...start.direction },
            facingDirection: start.direction.x || start.direction.y
                ? { ...start.direction } : { x: 1, y: 0 },
            nextDirection: { x: 0, y: 0 }, progress: 0, speed,
            ready: true, stopped: false, stopTimer: 0
        };
    }

    function createGhostState(start, color, speed) {
        return {
            x: start.x, y: start.y, px: start.x, py: start.y, color,
            direction: { ...start.direction },
            facingDirection: start.direction.x || start.direction.y
                ? { ...start.direction } : { x: 1, y: 0 },
            nextDirection: { ...start.direction },
            frightened: false, eaten: false, progress: 0, speed,
            needsDirection: false, decisionAtCentre: true
        };
    }

    function createWorldState({ player, ghosts, pellets = new Set(), lives, time = 0 }) {
        return { player, ghosts, pellets, lives, time };
    }

    function cloneCharacterState(character) {
        return {
            ...character,
            direction: { ...character.direction },
            nextDirection: character.nextDirection
                ? { ...character.nextDirection }
                : undefined
        };
    }

    // `players` carries every Pac-Man on the map. `player` stays as the
    // followed one (the one the game drives) and is still passed alone by
    // callers that only have one.
    function createWorldSnapshot({ player, players, ghosts, pellets, lives, time }) {
        const sourcePlayers = players && players.length > 0
            ? players
            : [player];
        const worldPlayers = sourcePlayers.map(cloneCharacterState);
        const followedIndex = player === undefined
            ? 0
            : Math.max(0, sourcePlayers.indexOf(player));

        return {
            player: worldPlayers[followedIndex],
            players: worldPlayers,
            ghosts: ghosts.map(cloneCharacterState),
            pellets: new Set(pellets),
            lives,
            time
        };
    }

    // The step every character takes between two events: progress grows
    // with the speed, and reaching the next cell centre moves the character
    // to the neighbouring cell, wrapping around the map.
    //
    // The live rules and the search share this step on purpose: the search
    // predicts the game with it, so a second copy that drifted at the
    // epsilon or at the wrap would make the prediction wrong. The epsilon
    // is the one the strategy uses to decide that a centre was reached.
    function moveCharacterToEvent(
        character,
        speed,
        elapsedTime,
        columns,
        rows,
        epsilon = 1e-7
    ) {
        if (character.direction.x === 0 && character.direction.y === 0) {
            return false;
        }

        character.progress += speed * elapsedTime;

        if (character.progress < 1 - epsilon) {
            return false;
        }

        character.progress = Math.max(0, character.progress - 1);

        character.x = wrap(character.x + character.direction.x, columns);
        character.y = wrap(character.y + character.direction.y, rows);

        return true;
    }

    return {
        createPlayerState, createGhostState, createWorldState,
        cloneCharacterState, createWorldSnapshot, moveCharacterToEvent
    };
}
