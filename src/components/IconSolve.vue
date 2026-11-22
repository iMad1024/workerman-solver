<template>
  <svg
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    class="solve-icon-svg"
    :class="{ 'is-animating': animate }"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <!-- Hit plate for standalone/inline usage -->
    <rect
      x="0"
      y="0"
      width="24"
      height="24"
      fill="transparent"
      stroke="none"
      class="hit-rect"
    />

    <!-- Routed Edges (drawn from X -> direct dot, then hub dot -> child dots) -->
    <!-- Edge 1: Direct X1 (4.8, 18) -> D1 (11.6, 18) -->
    <path class="solve-edge edge-1" d="M 5.4 18 L 11.6 18" pathLength="1" />
    <!-- Edge 2: Via D1 (11.6, 18) -> D2 (6.0, 7.2) -->
    <path class="solve-edge edge-2" d="M 11.6 18 L 6.0 7.2" pathLength="1" />
    <!-- Edge 3: Via D1 (11.6, 18) -> D3 (19.0, 17.2) -->
    <path class="solve-edge edge-3" d="M 11.6 18 L 19.0 17.2" pathLength="1" />
    <!-- Edge 4: Direct X2 (19.2, 5.8) -> D4 (12.4, 5.8) -->
    <path class="solve-edge edge-4" d="M 18.6 5.8 L 12.4 5.8" pathLength="1" />

    <!-- Source Cross 1 (Bottom-Left) -->
    <g class="solve-cross cross-1">
      <line x1="3.1" y1="16.3" x2="6.5" y2="19.7" />
      <line x1="6.5" y1="16.3" x2="3.1" y2="19.7" />
    </g>

    <!-- Source Cross 2 (Top-Right) -->
    <g class="solve-cross cross-2">
      <line x1="17.5" y1="4.1" x2="20.9" y2="7.5" />
      <line x1="20.9" y1="4.1" x2="17.5" y2="7.5" />
    </g>

    <!-- Candidate & Target Dots -->
    <!-- D1: Direct hub from X1 -->
    <circle class="solve-dot dot-1" cx="11.6" cy="18.0" r="1.45" />
    <!-- D2: Connected through D1 -->
    <circle class="solve-dot dot-2" cx="6.0" cy="7.2" r="1.45" />
    <!-- D3: Connected through D1 -->
    <circle class="solve-dot dot-3" cx="19.0" cy="17.2" r="1.45" />
    <!-- D4: Direct target from X2 -->
    <circle class="solve-dot dot-4" cx="12.4" cy="5.8" r="1.45" />
    <!-- D5: Unselected Steiner candidate (stays dim) -->
    <circle class="solve-dot dot-idle" cx="16.6" cy="11.5" r="1.25" />
  </svg>
</template>

<script>
export default {
  name: 'solveIcon',
  props: {
    size: {
      type: [Number, String],
      default: 20
    },
    animate: {
      type: Boolean,
      default: false
    }
  }
}
</script>

<style>
/* Unscoped animation triggers: hover on any button/pad wrapper, standalone hover, or explicit animate/continuous state */
.hud-glass-btn:hover:not(:disabled) .solve-icon-svg .edge-1,
.td-dp-test-btn:hover:not(:disabled) .solve-icon-svg .edge-1,
.neon-switch-pad:hover .solve-icon-svg .edge-1,
.sq-icon-btn:hover .solve-icon-svg .edge-1,
.solve-icon-svg:hover .edge-1,
.solve-icon-svg.is-animating .edge-1,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .solve-icon-svg .edge-1 {
  animation: svDrawEdge1 3.6s cubic-bezier(0.3, 0.9, 0.4, 1) infinite;
}

.hud-glass-btn:hover:not(:disabled) .solve-icon-svg .edge-4,
.td-dp-test-btn:hover:not(:disabled) .solve-icon-svg .edge-4,
.neon-switch-pad:hover .solve-icon-svg .edge-4,
.sq-icon-btn:hover .solve-icon-svg .edge-4,
.solve-icon-svg:hover .edge-4,
.solve-icon-svg.is-animating .edge-4,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .solve-icon-svg .edge-4 {
  animation: svDrawEdge4 3.6s cubic-bezier(0.3, 0.9, 0.4, 1) infinite;
}

.hud-glass-btn:hover:not(:disabled) .solve-icon-svg .edge-2,
.td-dp-test-btn:hover:not(:disabled) .solve-icon-svg .edge-2,
.neon-switch-pad:hover .solve-icon-svg .edge-2,
.sq-icon-btn:hover .solve-icon-svg .edge-2,
.solve-icon-svg:hover .edge-2,
.solve-icon-svg.is-animating .edge-2,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .solve-icon-svg .edge-2 {
  animation: svDrawEdge2 3.6s cubic-bezier(0.3, 0.9, 0.4, 1) infinite;
}

.hud-glass-btn:hover:not(:disabled) .solve-icon-svg .edge-3,
.td-dp-test-btn:hover:not(:disabled) .solve-icon-svg .edge-3,
.neon-switch-pad:hover .solve-icon-svg .edge-3,
.sq-icon-btn:hover .solve-icon-svg .edge-3,
.solve-icon-svg:hover .edge-3,
.solve-icon-svg.is-animating .edge-3,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .solve-icon-svg .edge-3 {
  animation: svDrawEdge3 3.6s cubic-bezier(0.3, 0.9, 0.4, 1) infinite;
}

.hud-glass-btn:hover:not(:disabled) .solve-icon-svg .dot-1,
.td-dp-test-btn:hover:not(:disabled) .solve-icon-svg .dot-1,
.neon-switch-pad:hover .solve-icon-svg .dot-1,
.sq-icon-btn:hover .solve-icon-svg .dot-1,
.solve-icon-svg:hover .dot-1,
.solve-icon-svg.is-animating .dot-1,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .solve-icon-svg .dot-1 {
  animation: svLightDot1 3.6s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

.hud-glass-btn:hover:not(:disabled) .solve-icon-svg .dot-4,
.td-dp-test-btn:hover:not(:disabled) .solve-icon-svg .dot-4,
.neon-switch-pad:hover .solve-icon-svg .dot-4,
.sq-icon-btn:hover .solve-icon-svg .dot-4,
.solve-icon-svg:hover .dot-4,
.solve-icon-svg.is-animating .dot-4,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .solve-icon-svg .dot-4 {
  animation: svLightDot4 3.6s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

.hud-glass-btn:hover:not(:disabled) .solve-icon-svg .dot-2,
.td-dp-test-btn:hover:not(:disabled) .solve-icon-svg .dot-2,
.neon-switch-pad:hover .solve-icon-svg .dot-2,
.sq-icon-btn:hover .solve-icon-svg .dot-2,
.solve-icon-svg:hover .dot-2,
.solve-icon-svg.is-animating .dot-2,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .solve-icon-svg .dot-2 {
  animation: svLightDot2 3.6s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

.hud-glass-btn:hover:not(:disabled) .solve-icon-svg .dot-3,
.td-dp-test-btn:hover:not(:disabled) .solve-icon-svg .dot-3,
.neon-switch-pad:hover .solve-icon-svg .dot-3,
.sq-icon-btn:hover .solve-icon-svg .dot-3,
.solve-icon-svg:hover .dot-3,
.solve-icon-svg.is-animating .dot-3,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .solve-icon-svg .dot-3 {
  animation: svLightDot3 3.6s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

.hud-glass-btn:hover:not(:disabled) .solve-icon-svg .cross-1,
.td-dp-test-btn:hover:not(:disabled) .solve-icon-svg .cross-1,
.neon-switch-pad:hover .solve-icon-svg .cross-1,
.sq-icon-btn:hover .solve-icon-svg .cross-1,
.solve-icon-svg:hover .cross-1,
.solve-icon-svg.is-animating .cross-1,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .solve-icon-svg .cross-1 {
  animation: svPulseCross1 3.6s ease-out infinite;
}

.hud-glass-btn:hover:not(:disabled) .solve-icon-svg .cross-2,
.td-dp-test-btn:hover:not(:disabled) .solve-icon-svg .cross-2,
.neon-switch-pad:hover .solve-icon-svg .cross-2,
.sq-icon-btn:hover .solve-icon-svg .cross-2,
.solve-icon-svg:hover .cross-2,
.solve-icon-svg.is-animating .cross-2,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .solve-icon-svg .cross-2 {
  animation: svPulseCross2 3.6s ease-out infinite;
}

/* Delegate pointer hits to parent button / pad wrappers */
.hud-glass-btn .solve-icon-svg,
.hud-glass-btn .solve-icon-svg *,
.neon-switch-pad .solve-icon-svg,
.neon-switch-pad .solve-icon-svg *,
.sq-icon-btn .solve-icon-svg,
.sq-icon-btn .solve-icon-svg * {
  pointer-events: none !important;
}

/* --- Edge Draw Keyframes (staggered: direct from X, then relay via D1) --- */
@keyframes svDrawEdge1 {
  0%, 10%   { stroke-dashoffset: 1.05; opacity: 0; }
  11%       { stroke-dashoffset: 1.05; opacity: 0.95; }
  26%, 86%  { stroke-dashoffset: 0;    opacity: 0.95; }
  95%, 100% { stroke-dashoffset: 0;    opacity: 0; }
}

@keyframes svDrawEdge4 {
  0%, 22%   { stroke-dashoffset: 1.05; opacity: 0; }
  23%       { stroke-dashoffset: 1.05; opacity: 0.95; }
  38%, 86%  { stroke-dashoffset: 0;    opacity: 0.95; }
  95%, 100% { stroke-dashoffset: 0;    opacity: 0; }
}

@keyframes svDrawEdge2 {
  0%, 34%   { stroke-dashoffset: 1.05; opacity: 0; }
  35%       { stroke-dashoffset: 1.05; opacity: 0.95; }
  52%, 86%  { stroke-dashoffset: 0;    opacity: 0.95; }
  95%, 100% { stroke-dashoffset: 0;    opacity: 0; }
}

@keyframes svDrawEdge3 {
  0%, 46%   { stroke-dashoffset: 1.05; opacity: 0; }
  47%       { stroke-dashoffset: 1.05; opacity: 0.95; }
  62%, 86%  { stroke-dashoffset: 0;    opacity: 0.95; }
  95%, 100% { stroke-dashoffset: 0;    opacity: 0; }
}

/* --- Dot Activation Pop when Incoming Edge Reaches It --- */
@keyframes svLightDot1 {
  0%, 22%   { opacity: 0.35; transform: scale(0.82); }
  27%       { opacity: 1;    transform: scale(1.38); }
  33%, 86%  { opacity: 1;    transform: scale(1); }
  95%, 100% { opacity: 0.35; transform: scale(0.82); }
}

@keyframes svLightDot4 {
  0%, 34%   { opacity: 0.35; transform: scale(0.82); }
  39%       { opacity: 1;    transform: scale(1.38); }
  45%, 86%  { opacity: 1;    transform: scale(1); }
  95%, 100% { opacity: 0.35; transform: scale(0.82); }
}

@keyframes svLightDot2 {
  0%, 48%   { opacity: 0.35; transform: scale(0.82); }
  53%       { opacity: 1;    transform: scale(1.38); }
  59%, 86%  { opacity: 1;    transform: scale(1); }
  95%, 100% { opacity: 0.35; transform: scale(0.82); }
}

@keyframes svLightDot3 {
  0%, 58%   { opacity: 0.35; transform: scale(0.82); }
  63%       { opacity: 1;    transform: scale(1.38); }
  69%, 86%  { opacity: 1;    transform: scale(1); }
  95%, 100% { opacity: 0.35; transform: scale(0.82); }
}

/* --- Subtle Launch Pulse on Crosses --- */
@keyframes svPulseCross1 {
  0%, 8%    { transform: scale(1); }
  13%       { transform: scale(1.18); }
  20%, 100% { transform: scale(1); }
}

@keyframes svPulseCross2 {
  0%, 20%   { transform: scale(1); }
  25%       { transform: scale(1.18); }
  32%, 100% { transform: scale(1); }
}
</style>

<style scoped>
.solve-icon-svg {
  display: inline-block;
  vertical-align: -0.15em;
  overflow: visible;
  pointer-events: auto;
}

.hit-rect {
  pointer-events: all;
}

/* --- Resting / Idle State (Fully Formed Graphic) --- */
.solve-edge {
  stroke: currentColor;
  stroke-width: 1.55;
  stroke-dasharray: 1.05;
  stroke-dashoffset: 0;
  opacity: 0.9;
}

.solve-cross {
  transform-box: view-box;
  stroke: currentColor;
  stroke-width: 1.85;
  opacity: 1;
}

.cross-1 { transform-origin: 4.8px 18.0px; }
.cross-2 { transform-origin: 19.2px 5.8px; }

.solve-dot {
  transform-box: view-box;
  fill: currentColor;
  stroke: none;
  opacity: 1;
}

.dot-1    { transform-origin: 11.6px 18.0px; }
.dot-2    { transform-origin: 6.0px 7.2px; }
.dot-3    { transform-origin: 19.0px 17.2px; }
.dot-4    { transform-origin: 12.4px 5.8px; }
.dot-idle { transform-origin: 16.6px 11.5px; opacity: 0.3; }
</style>