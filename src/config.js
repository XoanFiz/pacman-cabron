// Presentation of the game: sizes, colours and animation timings.
function createPresentationConfig() {
    return Object.freeze({
        CELL: 28,
        DOMAIN_ALPHA: 0.35,
        BASE_GHOST_COLORS: ["#e05252", "#e99b35", "#d66ad9"],
        FRIGHTENED_BLINK_TIME: 2,
        FRIGHTENED_BLINK_FREQUENCY: 12
    });
}

// Game rules: movement, timers, lives and collisions.
function createGameRuleConfig() {
    return Object.freeze({
        FRIGHTENED_DURATION: 7,
        GHOST_COLLISION_DISTANCE: 0.55,
        PACMAN_SPEED: 3.5,
        // While Pac-Man is stopped, its start is only accepted at this
        // discrete cadence, not at the instant the key is pressed.
        STOP_DECISION_INTERVAL: 0.05,
        GHOST_SPEED: 2.25,
        FRIGHTENED_GHOST_SPEED: 1.5,
        EATEN_GHOST_SPEED: 4,
        INITIAL_LIVES: 3
    });
}

// Search, heuristic and calibration. None of this changes the game rules.
function createStrategyConfig() {
    return Object.freeze({
        WEIGHT_NORMAL: 1,
        WEIGHT_PELLET: 0.01,
        // Value of the pellets Pac-Man has already eaten, relative to the
        // pellets still on the board. Eating must outweigh keeping a pellet
        // inside his own domain.
        PELLET_PROGRESS_WEIGHT: 2,
        // Strategic value weights. Every term of the heuristic is a
        // fraction in [0, 1], so these are the only trade-off: a lost life
        // costs SEARCH_VALUE_LIVES / initialLives and the whole level
        // costs SEARCH_VALUE_PROGRESS. The seeded benchmark
        // (src/tests/strategy/bench.js) chose the progress weight: with 0.3
        // Pac-Man cleared 51% of the level and with 1 it clears 59%.
        SEARCH_VALUE_LIVES: 0.9,
        SEARCH_VALUE_CONTROL: 0.25,
        SEARCH_VALUE_DANGER: 0.15,
        SEARCH_VALUE_PROGRESS: 1,
        SEARCH_VALUE_PREY: 0.15,
        // How many cells away a ghost stops counting as danger or prey.
        SEARCH_VALUE_DANGER_RADIUS: 4,
        // Power pellets are worth more than normal pellets in the pellet
        // domain of both sides.
        POWER_PELLET_WEIGHT: 5,
        MAX_PELLET_SCORE_FRACTION: 0.25,
        TOTAL_PELLET_VALUE: 1000,
        TOTAL_NORMAL_VALUE: 1000,
        // A caught Pac-Man resets the board, so a lost life must be worth
        // more than any territory state or the ghosts prefer to keep him
        // locked in a tiny domain instead of eating him.
        SEARCH_LIFE_PRIORITY: 5000,
        SEARCH_TERMINAL_VALUE: 1e6,
        SEARCH_MAX_EXTEND_DEPTH: 4096,
        // Lookahead extensions spent on the next decision of the plan.
        PLAN_ROOT_SEARCH_STEPS: 24,
        EPSILON: 1e-9,
        SEARCH_EPSILON: 1e-7,
        SEARCH_EXPANSIONS_PER_FRAME: 8,
        // Prior mean offset for nodes without observations.
        BASE_MEAN: 0,
        // Prior standard deviation for nodes without observations: wide
        // enough to explore, replaced by the calibrated deviation per bucket.
        BASE_STD: 80,
        // Floor for the calibrated standard deviation.
        CALIBRATION_MIN_STD: 0.5
    });
}

function createGameConfig() {
    const presentation = createPresentationConfig();
    const rules = createGameRuleConfig();
    const strategy = createStrategyConfig();

    // The flat merge keeps every module that receives a single config
    // working; new code can use config.presentation, config.rules or
    // config.strategy.
    return Object.freeze({
        ...presentation,
        ...rules,
        ...strategy,
        presentation,
        rules,
        strategy
    });
}
