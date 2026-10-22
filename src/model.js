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

    function createWorldSnapshot({ player, ghosts, pellets, lives, time }) {
        return {
            player: cloneCharacterState(player),
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
