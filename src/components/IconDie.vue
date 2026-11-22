<template>
  <svg 
    viewBox="0 0 24 24" 
    :width="size" 
    :height="size" 
    class="inline-graph-icon die-icon"
    fill="none" 
    stroke="currentColor" 
    stroke-width="1.8" 
    stroke-linecap="round" 
    stroke-linejoin="round"
  >
    <!-- Stationary full 24x24 hit plate -->
    <rect 
      x="0" 
      y="0" 
      width="24" 
      height="24" 
      fill="transparent" 
      stroke="none" 
      class="die-hit-rect"
    />

    <!-- Moving body group: isolated transform layer -->
    <g class="die-body">
      <!-- Rounded Die Outer Boundary -->
      <rect x="2.5" y="2.5" width="19" height="19" rx="3.5" />

      <!-- Center Dot (1, 3, 5) -->
      <circle class="pip pip-c" cx="12" cy="12" r="1.3" />

      <!-- Top-Left & Bottom-Right (2, 3, 4, 5, 6) -->
      <circle class="pip pip-tl" cx="7.2" cy="7.2" r="1.3" />
      <circle class="pip pip-br" cx="16.8" cy="16.8" r="1.3" />

      <!-- Top-Right & Bottom-Left (4, 5, 6) -->
      <circle class="pip pip-tr" cx="16.8" cy="7.2" r="1.3" />
      <circle class="pip pip-bl" cx="7.2" cy="16.8" r="1.3" />

      <!-- Mid-Left & Mid-Right (6) -->
      <circle class="pip pip-ml" cx="7.2" cy="12" r="1.3" />
      <circle class="pip pip-mr" cx="16.8" cy="12" r="1.3" />
    </g>
  </svg>
</template>

<script>
export default {
  name: 'DieIcon',
  props: {
    size: {
      type: [Number, String],
      default: 20
    }
  }
}
</script>

<style>
/* ========================================================
   UNSCOPED BLOCK: Direct CSS matching without Vue scoping bugs
   ======================================================== */

/* 1. Normal Hover: Hovering the pad or the standalone icon */
.neon-switch-pad:hover .die-icon .die-body,
.sq-icon-btn:hover .die-icon .die-body,
.die-icon:hover .die-body {
  animation: dieJiggle 0.4s ease-in-out infinite alternate;
}

.neon-switch-pad:hover .die-icon .pip-c,
.sq-icon-btn:hover .die-icon .pip-c,
.die-icon:hover .pip-c {
  animation: dieCycleCenter 1.2s steps(1) infinite;
}

.neon-switch-pad:hover .die-icon .pip-tl,
.neon-switch-pad:hover .die-icon .pip-br,
.sq-icon-btn:hover .die-icon .pip-tl,
.sq-icon-btn:hover .die-icon .pip-br,
.die-icon:hover .pip-tl,
.die-icon:hover .pip-br {
  animation: dieCycleDiag1 1.2s steps(1) infinite;
}

.neon-switch-pad:hover .die-icon .pip-tr,
.neon-switch-pad:hover .die-icon .pip-bl,
.sq-icon-btn:hover .die-icon .pip-tr,
.sq-icon-btn:hover .die-icon .pip-bl,
.die-icon:hover .pip-tr,
.die-icon:hover .pip-bl {
  animation: dieCycleDiag2 1.2s steps(1) infinite;
}

.neon-switch-pad:hover .die-icon .pip-ml,
.neon-switch-pad:hover .die-icon .pip-mr,
.sq-icon-btn:hover .die-icon .pip-ml,
.sq-icon-btn:hover .die-icon .pip-mr,
.die-icon:hover .pip-ml,
.die-icon:hover .pip-mr {
  animation: dieCycleSides 1.2s steps(1) infinite;
}

/* 2. Continuous Mode: Active pad animates continuously without hover */
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .die-body {
  animation: dieJiggle 0.4s ease-in-out infinite alternate;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-c {
  animation: dieCycleCenter 1.2s steps(1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-tl,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-br {
  animation: dieCycleDiag1 1.2s steps(1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-tr,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-bl {
  animation: dieCycleDiag2 1.2s steps(1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-ml,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-mr {
  animation: dieCycleSides 1.2s steps(1) infinite;
}

/* 3. Pointer-events safety */
.neon-switch-pad .die-icon,
.neon-switch-pad .die-icon *,
.sq-icon-btn .die-icon,
.sq-icon-btn .die-icon * {
  pointer-events: none !important;
}

/* Keyframes */
@keyframes dieJiggle {
  0%   { transform: rotate(-7deg); }
  100% { transform: rotate(7deg); }
}

@keyframes dieCycleCenter {
  0%, 16.6%     { opacity: 1; }
  16.7%, 33.3%  { opacity: 0; }
  33.4%, 50.0%  { opacity: 1; }
  50.1%, 66.6%  { opacity: 0; }
  66.7%, 83.3%  { opacity: 1; }
  83.4%, 100%   { opacity: 0; }
}

@keyframes dieCycleDiag1 {
  0%, 16.6%     { opacity: 0; }
  16.7%, 100%   { opacity: 1; }
}

@keyframes dieCycleDiag2 {
  0%, 50.0%     { opacity: 0; }
  50.1%, 100%   { opacity: 1; }
}

@keyframes dieCycleSides {
  0%, 83.3%     { opacity: 0; }
  83.4%, 100%   { opacity: 1; }
}
</style>

<style scoped>
.die-icon {
  display: inline-block;
  vertical-align: -0.15em;
  overflow: visible;
  pointer-events: auto;
}

.die-hit-rect {
  pointer-events: all;
}

.die-body {
  transform-box: view-box;
  transform-origin: 12px 12px;
  pointer-events: none;
  will-change: transform;
}

.pip {
  fill: currentColor;
  stroke: none;
  pointer-events: none;
}

.pip-ml,
.pip-mr {
  opacity: 0;
}

.pip-c,
.pip-tl,
.pip-tr,
.pip-bl,
.pip-br {
  opacity: 1;
}
</style>