<template>
  <svg 
    viewBox="0 0 24 24" 
    :width="size" 
    :height="size" 
    class="inline-graph-icon flip-coin-icon"
    fill="none" 
    stroke="currentColor" 
    stroke-width="1.8" 
    stroke-linecap="round" 
    stroke-linejoin="round"
  >
    <!-- Stationary hit surface preventing edge-on hover drops -->
    <rect 
      x="0" 
      y="0" 
      width="24" 
      height="24" 
      fill="transparent" 
      stroke="none" 
      class="coin-hit-rect"
    />

    <g class="coin-rig">
      <!-- Outer Rim (Center: 12, 12; Radius: 9.5) -->
      <circle cx="12" cy="12" r="9.5" />

      <!-- Centered Dollar 'S' (Top: 7.0, Middle: 12.0, Bottom: 17.0) -->
      <path 
        d="M 14.5 7.0 
           H 10.5 
           C 9.2 7.0 8.2 8.0 8.2 9.4 
           C 8.2 10.8 9.2 11.5 11.0 11.9 
           L 13.0 12.3 
           C 14.8 12.7 15.8 13.5 15.8 14.9 
           C 15.8 16.3 14.8 17.0 13.5 17.0 
           H 9.5" 
      />

      <!-- Vertical Spine (Symmetric: Y 4.5 -> 7.0 and Y 17.0 -> 19.5) -->
      <line x1="12" y1="4.5" x2="12" y2="7.0" />
      <line x1="12" y1="17.0" x2="12" y2="19.5" />
    </g>
  </svg>
</template>

<script>
export default {
  name: 'DollarIcon',
  props: {
    size: {
      type: [Number, String],
      default: 20
    }
  }
}
</script>

<style>
/* Unscoped animation triggers: works for neon switch, button wrapper & standalone */

/* 1. Normal Hover: On the neon switch pad, square button, or standalone */
.neon-switch-pad:hover .flip-coin-icon .coin-rig,
.sq-icon-btn:hover .flip-coin-icon .coin-rig,
.flip-coin-icon:hover .coin-rig {
  animation: flipCoinContinuous 2.6s linear infinite;
}

/* 2. Continuous Mode: Active pad spins continuously without hovering */
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .flip-coin-icon .coin-rig {
  animation: flipCoinContinuous 2.6s linear infinite;
}

/* 3. Guard: delegate all pointer hits to parent switch/button wrappers */
.neon-switch-pad .flip-coin-icon,
.neon-switch-pad .flip-coin-icon *,
.sq-icon-btn .flip-coin-icon,
.sq-icon-btn .flip-coin-icon * {
  pointer-events: none !important;
}

@keyframes flipCoinContinuous {
  from {
    transform: rotateY(0deg);
  }
  to {
    transform: rotateY(360deg);
  }
}
</style>

<style scoped>
.flip-coin-icon {
  display: inline-block;
  vertical-align: -0.15em;
  overflow: visible;
  perspective: 400px;
  pointer-events: auto;
}

.coin-hit-rect {
  pointer-events: all;
}

.coin-rig {
  transform-box: view-box;
  transform-origin: 12px 12px;
  pointer-events: none;
  will-change: transform;
}
</style>