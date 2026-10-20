function createGameAiController(context) {
    // ============================================================
    function getCurrentSearchContext() {
        const mapDefinition = getCurrentMapDefinition();

        const world = createWorldSnapshot({
            player: currentGameState.player,
            ghosts: currentGameState.ghosts,
            pellets: currentGameState.pellets,
            lives: currentGameState.lives,
            time: currentGameState.time
        });

        return {
            ...world,

            controlledGhostIndex: selectedCharacter.startsWith("ghost-")
                ? Number(selectedCharacter.slice("ghost-".length))
                : -1,

            respawnState: {
                player: {
                    x: mapDefinition.playerStart.x,
                    y: mapDefinition.playerStart.y
                },
                ghosts: mapDefinition.ghostStarts.map(start => ({
                    x: start.x,
                    y: start.y,
                    direction: { ...start.direction },
                    speed: GHOST_SPEED
                })),

                houses: buildGhostHouses(mapDefinition)
            }
        };
    }

    return {
        getCurrentSearchContext
    };
}
