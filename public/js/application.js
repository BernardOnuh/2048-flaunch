// Wait till the browser is ready to render the game (avoids glitches)
window.requestAnimationFrame(function () {
  // Store the manager globally so the Game Mode module (src/play.ts) can hook its scoring
  // seam — the per-swipe batched score delta — without importing the classic scripts.
  window.__gm_manager = new GameManager(4, KeyboardInputManager, HTMLActuator, LocalStorageManager);
});
