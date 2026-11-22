<template>
  <svg
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    class="inline-graph-icon permute-icon"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
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
      class="permute-hit-rect"
    />

    <!-- Top Curved Arrow: Slot 2 (9.5) -> Slot 4 (19.5) arching above (hidden during animation) -->
    <g class="arrow-top">
      <path d="M 9.8 9.2 C 11.4 4.2, 17.6 4.2, 19.1 8.8" />
      <polyline points="17.1 7.9 19.2 9.1 19.9 6.8" />
    </g>

    <!-- Bottom Curved Arrow: Slot 3 (14.5) -> Slot 1 (4.5) arching below (hidden during animation) -->
    <g class="arrow-bottom">
      <path d="M 14.2 14.8 C 12.6 19.8, 6.4 19.8, 4.9 15.2" />
      <polyline points="6.9 16.1 4.8 14.9 4.1 17.2" />
    </g>

    <!-- Four Permutation Nodes (Initial slots: x = 4.5, 9.5, 14.5, 19.5) -->
    <circle class="perm-dot dot-1" cx="4.5" cy="12" r="1.65" />
    <circle class="perm-dot dot-2" cx="9.5" cy="12" r="1.65" />
    <circle class="perm-dot dot-3" cx="14.5" cy="12" r="1.65" />
    <circle class="perm-dot dot-4" cx="19.5" cy="12" r="1.65" />
  </svg>
</template>

<script>
export default {
  name: 'PermuteIcon',
  props: {
    size: {
      type: [Number, String],
      default: 20,
    },
  },
};
</script>

<style>
/* ========================================================
   UNSCOPED BLOCK: Hover & Continuous Mode Animation Triggers
   ======================================================== */

/* 1. Normal Hover */
.neon-switch-pad:hover .permute-icon .dot-1,
.sq-icon-btn:hover .permute-icon .dot-1,
.permute-icon:hover .dot-1 {
  animation: permDot1 3.2s cubic-bezier(0.34, 1.35, 0.64, 1) infinite;
}

.neon-switch-pad:hover .permute-icon .dot-2,
.sq-icon-btn:hover .permute-icon .dot-2,
.permute-icon:hover .dot-2 {
  animation: permDot2 3.2s cubic-bezier(0.34, 1.35, 0.64, 1) infinite;
}

.neon-switch-pad:hover .permute-icon .dot-3,
.sq-icon-btn:hover .permute-icon .dot-3,
.permute-icon:hover .dot-3 {
  animation: permDot3 3.2s cubic-bezier(0.25, 0.9, 0.35, 1) infinite;
}

.neon-switch-pad:hover .permute-icon .dot-4,
.sq-icon-btn:hover .permute-icon .dot-4,
.permute-icon:hover .dot-4 {
  animation: permDot4 3.2s cubic-bezier(0.25, 0.9, 0.35, 1) infinite;
}

/* Hide arrows while hovering */
.neon-switch-pad:hover .permute-icon .arrow-top,
.neon-switch-pad:hover .permute-icon .arrow-bottom,
.sq-icon-btn:hover .permute-icon .arrow-top,
.sq-icon-btn:hover .permute-icon .arrow-bottom,
.permute-icon:hover .arrow-top,
.permute-icon:hover .arrow-bottom {
  opacity: 0;
}

/* 2. Continuous Mode */
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .permute-icon .dot-1 {
  animation: permDot1 3.2s cubic-bezier(0.34, 1.35, 0.64, 1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .permute-icon .dot-2 {
  animation: permDot2 3.2s cubic-bezier(0.34, 1.35, 0.64, 1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .permute-icon .dot-3 {
  animation: permDot3 3.2s cubic-bezier(0.25, 0.9, 0.35, 1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .permute-icon .dot-4 {
  animation: permDot4 3.2s cubic-bezier(0.25, 0.9, 0.35, 1) infinite;
}

/* Hide arrows in continuous mode */
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .permute-icon .arrow-top,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .permute-icon .arrow-bottom {
  opacity: 0;
}

/* 3. Pointer-events safety */
.neon-switch-pad .permute-icon,
.neon-switch-pad .permute-icon *,
.sq-icon-btn .permute-icon,
.sq-icon-btn .permute-icon * {
  pointer-events: none !important;
}

/* ========================================================
   KEYFRAMES (Step 1: 0-28%, Step 2: 34-62%, Hold/Pause: 62-100%)
   ======================================================== */

@keyframes permDot1 {
  0%, 4%     { transform: translate(0px, 0px); }
  26%, 34%   { transform: translate(5px, 0px); }
  58%, 74%   { transform: translate(10px, 0px); }
  80%, 100%  { transform: translate(0px, 0px); }
}

@keyframes permDot2 {
  0%, 4%     { transform: translate(0px, 0px); }
  26%, 34%   { transform: translate(5px, 0px); }
  58%, 74%   { transform: translate(10px, 0px); }
  80%, 100%  { transform: translate(0px, 0px); }
}

@keyframes permDot3 {
  0%, 4%     { transform: translate(0px, 0px) scale(1); }
  15%        { transform: translate(-5px, 5.8px) scale(1.12); }
  26%, 74%   { transform: translate(-10px, 0px) scale(1); }
  80%, 100%  { transform: translate(0px, 0px) scale(1); }
}

@keyframes permDot4 {
  0%, 34%    { transform: translate(0px, 0px) scale(1); }
  46%        { transform: translate(-5px, -5.8px) scale(1.12); }
  58%, 74%   { transform: translate(-10px, 0px) scale(1); }
  80%, 100%  { transform: translate(0px, 0px) scale(1); }
}
</style>

<style scoped>
.permute-icon {
  display: inline-block;
  vertical-align: -0.15em;
  overflow: visible;
  pointer-events: auto;
}

.permute-hit-rect {
  pointer-events: all;
}

.perm-dot {
  fill: currentColor;
  stroke: none;
  pointer-events: none;
  will-change: transform;
}

.arrow-top,
.arrow-bottom {
  opacity: 0.85;
  pointer-events: none;
  transition: opacity 0.18s ease;
  will-change: opacity;
}
</style>