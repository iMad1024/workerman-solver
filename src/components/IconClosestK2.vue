<template>
  <svg 
    viewBox="0 0 24 24" 
    :width="size" 
    :height="size" 
    class="inline-graph-icon .closest-k-2-icon v1"
    fill="none" 
    stroke="currentColor" 
    stroke-width="1.8" 
    stroke-linecap="round" 
    stroke-linejoin="round"
  >
    <!-- Center Query Node (The Origin) -->
    <circle class="center-node" cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />

    <!-- Expanding Metric Ball / Distance Boundary (r = 6.2, reaches (12, 12)) -->
    <circle class="range-ring" cx="12" cy="12" r="6.2" stroke-dasharray="2 2" />

    <!-- Node A (Inside / Closest: distance ~3.6) -->
    <circle class="node node-a" cx="10" cy="9" r="1.3" fill="currentColor" stroke="none" />

    <!-- Node B (Inside / 2nd closest: distance ~5.4) -->
    <circle class="node node-b" cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />

    <!-- Node C (Outside / Exceeds K: distance ~8.2, at (17.8, 6.2)) -->
    <circle class="node node-c" cx="17.8" cy="6.2" r="1.3" fill="currentColor" stroke="none" />

    <!-- Cross marker over Node C -->
    <g class="reject-cross">
      <line x1="16.2" y1="4.6" x2="19.4" y2="7.8" />
      <line x1="19.4" y1="4.6" x2="16.2" y2="7.8" />
    </g>
  </svg>
</template>

<script>
export default {
  name: 'ClosestK2Icon',
  props: {
    size: {
      type: [Number, String],
      default: 20
    }
  }
}
</script>

<style scoped>
.closest-k-2-icon {
  display: inline-block;
  vertical-align: -0.15em;
  overflow: visible;
}

/* Transform setup */
.range-ring {
  transform-box: fill-box;
  transform-origin: center center;
  stroke-width: 1.4;
  opacity: 0.35;
}

.reject-cross {
  stroke-width: 1.6;
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center center;
}

/* Hover sequence (3s total loop) */
:global(.closest-k-2-icon:hover:hover) .range-ring,
.closest-k-2-icon:hover .range-ring {
  animation: expandRadius 3s ease-out infinite;
}

:global(.closest-k-2-icon:hover) .node-a,
:global(.closest-k-2-icon:hover) .node-b,
.closest-k-2-icon:hover .node-a,
.closest-k-2-icon:hover .node-b {
  animation: highlightAccepted 3s ease-out infinite;
}

:global(.closest-k-2-icon:hover) .node-c,
.closest-k-2-icon:hover .node-c {
  animation: fadeRejected 3s ease-out infinite;
}

:global(.closest-k-2-icon:hover) .reject-cross,
.closest-k-2-icon:hover .reject-cross {
  animation: dropCross 3s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

/* Ring expands outward from query node */
@keyframes expandRadius {
  0%         { transform: scale(0.1); opacity: 0; }
  8%         { opacity: 0.8; }
  32%, 82%   { transform: scale(1); opacity: 0.8; }
  92%, 100%  { transform: scale(1); opacity: 0.35; }
}

/* Accepted nodes inside circle illuminate brightly */
@keyframes highlightAccepted {
  0%, 30%    { opacity: 0.5; }
  38%, 82%   { opacity: 1; transform: scale(1.2); }
  92%, 100%  { opacity: 0.5; transform: scale(1); }
}

/* Outside node dims once radius is established */
@keyframes fadeRejected {
  0%, 34%    { opacity: 0.7; }
  45%, 82%   { opacity: 0.25; }
  92%, 100%  { opacity: 0.7; }
}

/* Cross snaps on top of Node C */
@keyframes dropCross {
  0%, 36%    { opacity: 0; transform: scale(0.4); }
  44%        { opacity: 1; transform: scale(1.2); }
  48%, 82%   { opacity: 1; transform: scale(1); }
  92%, 100%  { opacity: 0; transform: scale(0.4); }
}
</style>