function createGameConfig() {
    // TODO: remove configuration here that is not for the game rules. 
    return Object.freeze({
        CELL: 28,
        DOMAIN_ALPHA: 0.35,
        BASE_GHOST_COLORS: ["#e05252", "#e99b35", "#d66ad9"],
        FRIGHTENED_DURATION: 7,
        FRIGHTENED_BLINK_TIME: 2,
        FRIGHTENED_BLINK_FREQUENCY: 12,
        GHOST_COLLISION_DISTANCE: 0.55,
        PACMAN_SPEED: 3.5,
        // While Pac-Man is stopped, its start is only accepted at this
        // discrete cadence, not at the instant the key is pressed.
        STOP_DECISION_INTERVAL: 0.05,
        GHOST_SPEED: 2.25,
        FRIGHTENED_GHOST_SPEED: 1.5,
        EATEN_GHOST_SPEED: 4,
        WEIGHT_NORMAL: 1,
        WEIGHT_PELLET: 0.01,
        // Value of the pellets Pac-Man has already eaten, relative to the
        // pellets still on the board. Eating must outweigh keeping a pellet
        // inside his own domain.
        PELLET_PROGRESS_WEIGHT: 2,
        // Weight of the progress term in the strategic heuristic.
        SEARCH_HEURISTIC_K: 0.1,
        // Power pellets are worth more than normal pellets in the pellet
        // domain of both sides.
        POWER_PELLET_WEIGHT: 5,
        MAX_PELLET_SCORE_FRACTION: 0.25,
        TOTAL_PELLET_VALUE: 1000,
        TOTAL_NORMAL_VALUE: 1000,
        INITIAL_LIVES: 3,
        // A caught Pac-Man resets the board, so a lost life must be worth
        // more than any territory state or the ghosts prefer to keep him
        // locked in a tiny domain instead of eating him. The territory score
        // peaks at TOTAL_NORMAL_VALUE * 2 plus the pellet cap (2250), so
        // this stays above that bound.
        SEARCH_LIFE_PRIORITY: 5000,
        SEARCH_TERMINAL_VALUE: 1e6,
        SEARCH_MAX_EXTEND_DEPTH: 4096,
        // Lookahead extensions spent on the next decision of the plan.
        PLAN_ROOT_SEARCH_STEPS: 24,
        EPSILON: 1e-9,
        SEARCH_EPSILON: 1e-7,
        SEARCH_EXPANSIONS_PER_FRAME: 8,
        // Prior standard deviation for nodes without observations: wide
        // enough to explore, replaced by the calibrated deviation per bucket.
        BASE_STD: 80,
        CALIBRATION_MIN_STD: 0.5
    });
}
