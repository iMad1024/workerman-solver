/**
 * Creates a press-and-hold controller with optional acceleration tiers.
 *
 * @param {Object} opts
 * @param {Function} opts.onStep - Callback receiving `(stepDelta)`
 * @param {number} opts.direction - `-1` or `+1`
 * @param {boolean} opts.accelerate - If true: 0-5s => 1x, 5-10s => 10x, 10s+ => 100x
 * @param {number} opts.intervalMs - Tick interval while holding (default 500ms)
 * @param {number} opts.holdDelayMs - Delay before continuous ticking starts (default 450ms)
 */
export function createHoldController({
  onStep,
  direction = 1,
  accelerate = false,
  intervalMs = 500,
  holdDelayMs = 450
}) {
  let delayTimer = null;
  let repeatTimer = null;
  let holdStartTime = 0;

  const stop = () => {
    clearTimeout(delayTimer);
    clearInterval(repeatTimer);
    delayTimer = null;
    repeatTimer = null;
  };

  const start = (e) => {
    if (e && e.button !== undefined && e.button !== 0) return; // Left click only
    stop();

    // Immediate single click step
    onStep(direction * 1);
    holdStartTime = Date.now();

    // Begin repeating after initial hold threshold
    delayTimer = setTimeout(() => {
      repeatTimer = setInterval(() => {
        let magnitude = 1;
        if (accelerate) {
          const elapsed = Date.now() - holdStartTime;
          if (elapsed >= 10000) {
            magnitude = 100;
          } else if (elapsed >= 5000) {
            magnitude = 10;
          }
        }
        onStep(direction * magnitude);
      }, intervalMs);
    }, holdDelayMs);
  };

  return { start, stop };
}