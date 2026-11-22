<template>
  <svg 
    viewBox="0 0 24 24" 
    :width="size" 
    :height="size" 
    class="rings-svg"
    fill="none" 
    stroke="currentColor" 
    stroke-width="1.8" 
    stroke-linecap="round" 
    stroke-linejoin="round"
  >
    <rect 
      x="0" 
      y="0" 
      width="24" 
      height="24" 
      fill="transparent" 
      stroke="none" 
      class="hit-rect"
    />

    <g class="rings-rig">
      <!-- Right Ring (Plain Band) -->
      <g class="right-ring-mover">
        <circle cx="15" cy="14" r="5" />
      </g>

      <!-- Left Ring Rig -->
      <g class="left-ring-mover">
        <g transform="translate(9, 14)">
          <circle cx="0" cy="0" r="5" />
          <g class="gem-rocker">
            <polygon 
              class="gem-shape-solid"
              points="-1.6,-10.2 1.6,-10.2 2.8,-7.2 0,-4.8 -2.8,-7.2" 
              fill="currentColor"
              stroke="currentColor"
              stroke-width="0.8"
              stroke-linejoin="round"
            />
          </g>
        </g>
      </g>
    </g>
  </svg>
</template>

<script>
export default {
  name: 'RingsIcon',
  props: {
    size: {
      type: [Number, String],
      default: 20
    }
  }
}
</script>

<style>
/* Unscoped block: hover triggers, continuous mode, and keyframes */

/* 1. Normal Hover: On the neon switch pad, square button, or standalone */
.neon-switch-pad:hover .rings-svg .left-ring-mover,
.sq-icon-btn:hover .rings-svg .left-ring-mover,
.rings-svg:hover .left-ring-mover {
  animation: rngLeftImpact 3.2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}

.neon-switch-pad:hover .rings-svg .right-ring-mover,
.sq-icon-btn:hover .rings-svg .right-ring-mover,
.rings-svg:hover .right-ring-mover {
  animation: rngRightImpact 3.2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}

.neon-switch-pad:hover .rings-svg .gem-rocker,
.sq-icon-btn:hover .rings-svg .gem-rocker,
.rings-svg:hover .gem-rocker {
  animation: rngDiamondSwing 3.2s ease-in-out infinite;
}

/* 2. Continuous Mode: Active pad animates continuously without hover */
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .rings-svg .left-ring-mover {
  animation: rngLeftImpact 3.2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .rings-svg .right-ring-mover {
  animation: rngRightImpact 3.2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .rings-svg .gem-rocker {
  animation: rngDiamondSwing 3.2s ease-in-out infinite;
}

/* 3. Guard: delegate all pointer hits to button / pad wrappers */
.neon-switch-pad .rings-svg,
.neon-switch-pad .rings-svg *,
.sq-icon-btn .rings-svg,
.sq-icon-btn .rings-svg * {
  pointer-events: none !important;
}

/* Keyframes */
@keyframes rngLeftImpact {
  0%         { transform: translateX(0); }
  6%         { transform: translateX(-3px); }
  12%        { transform: translateX(0.5px); }
  15%, 100%  { transform: translateX(0); }
}

@keyframes rngRightImpact {
  0%         { transform: translateX(0); }
  6%         { transform: translateX(3px); }
  12%        { transform: translateX(-0.5px); }
  15%, 100%  { transform: translateX(0); }
}

@keyframes rngDiamondSwing {
  0%         { transform: rotate(0deg); }
  6%         { transform: rotate(-25deg); }
  12%        { transform: rotate(-35deg); }
  17%        { transform: rotate(38deg); }
  22%        { transform: rotate(-20deg); }
  26%        { transform: rotate(12deg); }
  30%        { transform: rotate(-4deg); }
  34%, 100%  { transform: rotate(0deg); }
}
</style>

<style scoped>
.rings-svg {
  display: inline-block;
  vertical-align: -0.15em;
  overflow: visible;
  pointer-events: auto;
}

.hit-rect {
  pointer-events: all;
}

.rings-rig {
  pointer-events: none;
}

.left-ring-mover,
.right-ring-mover,
.gem-rocker {
  transform-box: view-box;
  will-change: transform;
}

.gem-rocker {
  transform-origin: 0 0;
  transform: rotate(0deg);
}

.gem-shape-solid {
  fill: currentColor;
}
</style>