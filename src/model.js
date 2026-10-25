function createGameModel() {
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

    return {
        createPlayerState, createGhostState, createWorldState,
        cloneCharacterState, createWorldSnapshot
    };
}
