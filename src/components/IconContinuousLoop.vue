<template>
  <svg 
    viewBox="0 0 24 24" 
    :width="size" 
    :height="size" 
    class="continuous-loop-svg"
    :class="{ 'is-spinning': active }"
    fill="none" 
  >
    <defs>
      <!-- Gradient precisely mapped along the single 270° sweep -->
      <linearGradient id="singleCometGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#38bdf8" stop-opacity="1" />
        <stop offset="35%" stop-color="#38bdf8" stop-opacity="0.65" />
        <stop offset="70%" stop-color="#38bdf8" stop-opacity="0.2" />
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0" />
      </linearGradient>
    </defs>

    <!-- Dormant faint boundary when unchecked -->
    <circle 
      class="dormant-ring" 
      cx="12" 
      cy="12" 
      r="8.5" 
      stroke="currentColor" 
      stroke-width="1.6" 
    />

    <!-- Active rotating comet rig: single unified track -->
    <g class="comet-track">
      <!-- 
        Single path sweeping from top (12, 3.5) counter-clockwise behind the head.
        Starts at head (12, 3.5), arches through Left (3.5, 12), Bottom (12, 20.5), to Right (20.5, 12).
      -->
      <path 
        class="comet-tail"
        d="M 12 3.5 A 8.5 8.5 0 1 0 20.5 12"
        stroke="url(#singleCometGrad)" 
        stroke-width="1.8" 
        stroke-linecap="round"
      />

      <!-- Bright lead node right at the start of the path -->
      <circle class="comet-head" cx="12" cy="3.5" r="1.3" fill="#ffffff" />
    </g>
  </svg>
</template>

<script>
export default {
  name: 'IconContinuousLoop',
  props: {
    size: {
      type: [Number, String],
      default: 14
    },
    active: {
      type: Boolean,
      default: false
    }
  }
}
</script>

<style scoped>
.continuous-loop-svg {
  display: block;
  overflow: visible;
  pointer-events: none;
}

.dormant-ring {
  opacity: 0.35;
  transition: opacity 0.2s ease;
}

.comet-track {
  transform-box: view-box;
  transform-origin: 12px 12px;
  opacity: 0.25;
  transition: opacity 0.25s ease;
}

/* When checked: Single head spins at uniform angular velocity */
.continuous-loop-svg.is-spinning .dormant-ring {
  opacity: 0;
}

.continuous-loop-svg.is-spinning .comet-track {
  opacity: 1;
  filter: drop-shadow(0 0 3px rgba(56, 189, 248, 0.85));
  /* 'linear' ensures perfectly uniform speed */
  animation: cometLeadSpin 1.4s linear infinite;
}

.continuous-loop-svg.is-spinning .comet-head {
  filter: drop-shadow(0 0 3px #ffffff);
}

@keyframes cometLeadSpin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
</style>