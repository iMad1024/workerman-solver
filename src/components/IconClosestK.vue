<template>
  <svg 
    viewBox="0 0 24 24" 
    :width="size" 
    :height="size" 
    class="closest-k-svg"
    fill="none" 
    stroke="currentColor" 
    stroke-width="1.8" 
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

    <!-- Solid Expanding Horizon Circle (Radius 6.2) -->
    <circle class="range-ring" cx="12" cy="12" r="6.2" />

    <!-- Staggered Radial Candidate Nodes -->
    <!-- Point 1 (Inside: d ≈ 3.1) -->
    <circle class="pop-node node-1" cx="11.2" cy="9.1" r="1.3" />

    <!-- Point 2 (Inside: d ≈ 4.4) -->
    <circle class="pop-node node-2" cx="15.2" cy="14.2" r="1.3" />

    <!-- Point 3 (Outside Cutoff: d ≈ 9.6) -->
    <circle class="pop-node node-3" cx="5.2" cy="5.2" r="1.3" />

    <!-- Rejection Cross centered at (5.2, 5.2) -->
    <g class="reject-cross">
      <line x1="3.1" y1="3.1" x2="7.3" y2="7.3" />
      <line x1="7.3" y1="3.1" x2="3.1" y2="7.3" />
    </g>
  </svg>
</template>

<script>
export default {
  name: 'ClosestKIcon',
  props: {
    size: {
      type: [Number, String],
      default: 20
    }
  }
}
</script>

<style>
/* Unscoped animation triggers: active on hover AND under continuous mode */

/* 1. Normal Hover: On the neon switch pad, square button, or standalone */
.neon-switch-pad:hover .closest-k-svg .range-ring,
.sq-icon-btn:hover .closest-k-svg .range-ring,
.closest-k-svg:hover .range-ring {
  animation: ckRingBloom 3.2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}

.neon-switch-pad:hover .closest-k-svg .node-1,
.sq-icon-btn:hover .closest-k-svg .node-1,
.closest-k-svg:hover .node-1 {
  animation: ckPopNode1 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

.neon-switch-pad:hover .closest-k-svg .node-2,
.sq-icon-btn:hover .closest-k-svg .node-2,
.closest-k-svg:hover .node-2 {
  animation: ckPopNode2 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

.neon-switch-pad:hover .closest-k-svg .node-3,
.sq-icon-btn:hover .closest-k-svg .node-3,
.closest-k-svg:hover .node-3 {
  animation: ckPopNode3 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

.neon-switch-pad:hover .closest-k-svg .reject-cross,
.sq-icon-btn:hover .closest-k-svg .reject-cross,
.closest-k-svg:hover .reject-cross {
  animation: ckStampCross 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

/* 2. Continuous Mode: Active pad animates continuously without hovering */
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .closest-k-svg .range-ring {
  animation: ckRingBloom 3.2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .closest-k-svg .node-1 {
  animation: ckPopNode1 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .closest-k-svg .node-2 {
  animation: ckPopNode2 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .closest-k-svg .node-3 {
  animation: ckPopNode3 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .closest-k-svg .reject-cross {
  animation: ckStampCross 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

/* 3. Guard: delegate all pointer hits to button / pad wrappers */
.neon-switch-pad .closest-k-svg,
.neon-switch-pad .closest-k-svg *,
.sq-icon-btn .closest-k-svg,
.sq-icon-btn .closest-k-svg * {
  pointer-events: none !important;
}

@keyframes ckRingBloom {
  0%         { transform: scale(0.2); opacity: 0; }
  18%, 85%   { transform: scale(1); opacity: 1; }
  94%, 100%  { transform: scale(1); opacity: 0.5; }
}

@keyframes ckPopNode1 {
  0%, 22%    { opacity: 0; transform: scale(0.3); }
  28%, 85%   { opacity: 1; transform: scale(1); }
  94%, 100%  { opacity: 0; transform: scale(0.3); }
}

@keyframes ckPopNode2 {
  0%, 32%    { opacity: 0; transform: scale(0.3); }
  38%, 85%   { opacity: 1; transform: scale(1); }
  94%, 100%  { opacity: 0; transform: scale(0.3); }
}

@keyframes ckPopNode3 {
  0%, 42%    { opacity: 0; transform: scale(0.3); }
  48%, 85%   { opacity: 0.45; transform: scale(1); }
  94%, 100%  { opacity: 0; transform: scale(0.3); }
}

@keyframes ckStampCross {
  0%, 52%    { opacity: 0; transform: scale(0.3); }
  58%        { opacity: 1; transform: scale(1.15); }
  62%, 85%   { opacity: 1; transform: scale(1); }
  94%, 100%  { opacity: 0; transform: scale(0.3); }
}
</style>

<style scoped>
.closest-k-svg {
  display: inline-block;
  vertical-align: -0.15em;
  overflow: visible;
  pointer-events: auto;
}

.hit-rect {
  pointer-events: all;
}

/* --- Resting / Idle State (Fully Formed Graphic) --- */
.range-ring {
  transform-box: view-box;
  transform-origin: 12px 12px;
  opacity: 1;
}

.pop-node {
  transform-box: view-box;
  fill: currentColor;
  stroke: none;
  opacity: 1;
}

.node-3 {
  opacity: 0.35;
  transform-origin: 5.2px 5.2px;
}

.node-1 { transform-origin: 11.2px 9.1px; }
.node-2 { transform-origin: 15.2px 14.2px; }

.reject-cross {
  transform-box: view-box;
  stroke: currentColor;
  stroke-width: 1.8;
  opacity: 1;
  transform-origin: 5.2px 5.2px;
}
</style>