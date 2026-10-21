function createGameUi(parameters = {}) {
    const {
        state
    } = parameters;

    const gameState = () => state.currentGameState;

    function updatePauseButton() {
        const gs = gameState();
        const pauseButton = state.pauseButton;

        pauseButton.textContent = gs.paused
            ? state.messages.resume || "Resume"
            : state.messages.pause || "Pause";
        pauseButton.setAttribute("aria-label", pauseButton.textContent);
        pauseButton.setAttribute("aria-pressed", String(gs.paused));
        pauseButton.disabled = !gs.running && !gs.paused;
    }

    function updateUI() {
        const gs = gameState();

        state.scoreElement.textContent = gs.score;
        state.livesElement.textContent = gs.lives;

        updatePauseButton();
    }

    return {
        updatePauseButton,
        updateUI
    };
}