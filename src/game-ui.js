function createGameUi(context) {
    function updatePauseButton() {
        pauseButton.textContent = paused
            ? messages.resume || "Resume"
            : messages.pause || "Pause";
        pauseButton.setAttribute("aria-label", pauseButton.textContent);
        pauseButton.setAttribute("aria-pressed", String(paused));
        pauseButton.disabled = !running && !paused;
    }


    function updateUI() {

        scoreElement.textContent =
            currentGameState.score;

        livesElement.textContent =
            currentGameState.lives;

        updatePauseButton();
    }

    return {
        updatePauseButton,
        updateUI
    };
}
