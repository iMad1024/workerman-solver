<template>
  <svg 
    viewBox="0 0 24 24" 
    :width="size" 
    :height="size" 
    class="inline-graph-icon topk-dist-icon"
    fill="none" 
    stroke="currentColor" 
    stroke-width="1.6" 
    stroke-linecap="round" 
    stroke-linejoin="round"
  >
    <!-- Vertical Cutoff / Distance Threshold Line -->
    <line class="threshold-line" x1="14" y1="2.5" x2="14" y2="21.5" stroke-dasharray="2 2" opacity="0.6" />

    <!-- Left Baseline Rail -->
    <line x1="2.5" y1="2.5" x2="2.5" y2="21.5" stroke-width="1.8" />

    <!-- Bar 1: Shortest distance (Rank 1 - Selected) -->
    <!-- Final length = 6.5 (x: 2.5 to 9) -->
    <rect class="dist-bar bar-1" x="2.5" y="4" width="6.5" height="4.5" rx="1.2" />

    <!-- Bar 2: Medium distance (Rank 2 - Selected, near cutoff) -->
    <!-- Final length = 10.5 (x: 2.5 to 13) -->
    <rect class="dist-bar bar-2" x="2.5" y="10" width="10.5" height="4.5" rx="1.2" />

    <!-- Bar 3: Exceeds threshold (Rank 3 - Rejected / Outside K) -->
    <!-- Final length = 17.5 (x: 2.5 to 20) -->
    <rect class="dist-bar bar-3" x="2.5" y="16" width="17.5" height="4.5" rx="1.2" />
  </svg>
</template>

<script>
export default {
  name: 'topKDistanceIcon',
  props: {
    size: {
      type: [Number, String],
      default: 20
    }
  }
}
</script>

<style scoped>
.topk-dist-icon {
  display: inline-block;
  vertical-align: -0.15em;
  overflow: visible;
}

/* Base static state */
.dist-bar {
  transform-origin: 2.5px center;
  transition: fill 0.25s ease, opacity 0.25s ease;
}

/* In static state, the two chosen bars are softly filled, the outer bar is hollow */
.bar-1, .bar-2 {
  fill: currentColor;
  fill-opacity: 0.25;
}
.bar-3 {
  fill: none;
  opacity: 0.45;
}

/* Hover trigger (parent button or icon itself) */
:global(.topk-dist-icon:hover) .topk-dist-icon .bar-1,
.topk-dist-icon:hover .bar-1 {
  animation: barShoot1 1.4s cubic-bezier(0.34, 1.4, 0.64, 1) infinite;
}

:global(.topk-dist-icon:hover) .topk-dist-icon .bar-2,
.topk-dist-icon:hover .bar-2 {
  animation: barShoot2 1.4s cubic-bezier(0.34, 1.4, 0.64, 1) infinite;
}

:global(.topk-dist-icon:hover) .topk-dist-icon .bar-3,
.topk-dist-icon:hover .bar-3 {
  animation: barShoot3 1.4s cubic-bezier(0.34, 1.4, 0.64, 1) infinite;
}

/* Bar 1 (Shortest / Closest): Starts at 0, overshoots, settles, fills solid */
@keyframes barShoot1 {
  0% {
    transform: scaleX(0);
    fill-opacity: 0;
  }
  20%, 75% {
    transform: scaleX(1);
    fill-opacity: 0.85;
  }
  90%, 100% {
    transform: scaleX(1);
    fill-opacity: 0.25;
  }
}

/* Bar 2 (Medium / Closest): Slight delay, snaps to just before threshold */
@keyframes barShoot2 {
  0%, 12% {
    transform: scaleX(0);
    fill-opacity: 0;
  }
  32%, 75% {
    transform: scaleX(1);
    fill-opacity: 0.85;
  }
  90%, 100% {
    transform: scaleX(1);
    fill-opacity: 0.25;
  }
}

/* Bar 3 (Far / Exceeds Cutoff): Enters last, penetrates past line, remains hollow */
@keyframes barShoot3 {
  0%, 24% {
    transform: scaleX(0);
    opacity: 0;
  }
  44%, 75% {
    transform: scaleX(1);
    opacity: 0.45;
    fill: none;
  }
  90%, 100% {
    transform: scaleX(1);
    opacity: 0.45;
    fill: none;
  }
}
</style>