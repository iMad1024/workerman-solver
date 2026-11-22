<template>
  <svg 
    viewBox="0 0 24 24" 
    :width="size" 
    :height="size" 
    class="inline-graph-icon sand-bar-dollar-icon"
    fill="none" 
    stroke="currentColor" 
    stroke-width="1.8" 
    stroke-linecap="round" 
    stroke-linejoin="round"
  >
    <!-- Central Sand Stream -->
    <g class="sand-stream">
      <circle class="grain grain-1" cx="12" cy="1.5" r="0.8" fill="currentColor" stroke="none" />
      <circle class="grain grain-2" cx="12" cy="4.5" r="0.7" fill="currentColor" stroke="none" />
      <circle class="grain grain-3" cx="12" cy="7.5" r="0.75" fill="currentColor" stroke="none" />
    </g>

    <!-- 9 Solid Sand Bars (Anchored at Y=21.5, Width=2.1) -->
    <g class="bar-bed">
      <rect class="sand-col col-1" x="2.55" y="2.5" width="2.1" height="19" rx="0.5" fill="currentColor" stroke="none" />
      <rect class="sand-col col-2" x="4.65" y="2.5" width="2.1" height="19" rx="0.5" fill="currentColor" stroke="none" />
      <rect class="sand-col col-3" x="6.75" y="2.5" width="2.1" height="19" rx="0.5" fill="currentColor" stroke="none" />
      <rect class="sand-col col-4" x="8.85" y="2.5" width="2.1" height="19" rx="0.5" fill="currentColor" stroke="none" />
      <rect class="sand-col col-5" x="10.95" y="2.5" width="2.1" height="19" rx="0.5" fill="currentColor" stroke="none" />
      <rect class="sand-col col-6" x="13.05" y="2.5" width="2.1" height="19" rx="0.5" fill="currentColor" stroke="none" />
      <rect class="sand-col col-7" x="15.15" y="2.5" width="2.1" height="19" rx="0.5" fill="currentColor" stroke="none" />
      <rect class="sand-col col-8" x="17.25" y="2.5" width="2.1" height="19" rx="0.5" fill="currentColor" stroke="none" />
      <rect class="sand-col col-9" x="19.35" y="2.5" width="2.1" height="19" rx="0.5" fill="currentColor" stroke="none" />
    </g>

    <!-- Hollow Etched Dollar Sign (Centered at Y=12) -->
    <g class="cutout-dollar">
      <path 
        d="M 14.5 7.2 
           H 10.5 
           C 9.0 7.2 8.0 8.1 8.0 9.4 
           C 8.0 10.7 9.2 11.4 11.2 11.8 
           L 12.8 12.2 
           C 14.8 12.6 16.0 13.3 16.0 14.6 
           C 16.0 15.9 15.0 16.8 13.5 16.8 
           H 9.2" 
        stroke-width="1.8"
      />
      <line x1="12" y1="4.6" x2="12" y2="7.2" stroke-width="1.8" />
      <line x1="12" y1="16.8" x2="12" y2="19.4" stroke-width="1.8" />
    </g>
  </svg>
</template>

<script>
export default {
  name: 'dollar2Icon',
  props: {
    size: {
      type: [Number, String],
      default: 20
    }
  }
}
</script>

<style scoped>
.sand-bar-dollar-icon {
  display: inline-block;
  vertical-align: -0.15em;
  overflow: visible;
}

.sand-stream {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.sand-col {
  transform-box: fill-box;
  transform-origin: bottom center;
}

/* Resting State: Bell curve mound */
.col-1, .col-9 { transform: scaleY(0.12); }
.col-2, .col-8 { transform: scaleY(0.22); }
.col-3, .col-7 { transform: scaleY(0.38); }
.col-4, .col-6 { transform: scaleY(0.58); }
.col-5         { transform: scaleY(0.72); }

/* Hollow Dollar */
.cutout-dollar {
  opacity: 0;
  stroke: var(--panel-bg-color, #18181b);
  transform-box: fill-box;
  transform-origin: center center;
  transform: scale(0.7);
  transition: opacity 0.25s ease;
}

:global(.sand-bar-dollar-icon:hover) .sand-stream,
.sand-bar-dollar-icon:hover .sand-stream {
  opacity: 1;
}

:global(.sand-bar-dollar-icon:hover) .grain-1,
.sand-bar-dollar-icon:hover .grain-1 {
  animation: dropGrains 0.6s linear infinite;
}

:global(.sand-bar-dollar-icon:hover) .grain-2,
.sand-bar-dollar-icon:hover .grain-2 {
  animation: dropGrains 0.6s linear 0.2s infinite;
}

:global(.sand-bar-dollar-icon:hover) .grain-3,
.sand-bar-dollar-icon:hover .grain-3 {
  animation: dropGrains 0.6s linear 0.4s infinite;
}

:global(.sand-bar-dollar-icon:hover) .col-5,
.sand-bar-dollar-icon:hover .col-5 {
  animation: fillCol5 2.6s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}

:global(.sand-bar-dollar-icon:hover) .col-4,
:global(.sand-bar-dollar-icon:hover) .col-6,
.sand-bar-dollar-icon:hover .col-4,
.sand-bar-dollar-icon:hover .col-6 {
  animation: fillCol46 2.6s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}

:global(.sand-bar-dollar-icon:hover) .col-3,
:global(.sand-bar-dollar-icon:hover) .col-7,
.sand-bar-dollar-icon:hover .col-3,
.sand-bar-dollar-icon:hover .col-7 {
  animation: fillCol37 2.6s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}

:global(.sand-bar-dollar-icon:hover) .col-2,
:global(.sand-bar-dollar-icon:hover) .col-8,
.sand-bar-dollar-icon:hover .col-2,
.sand-bar-dollar-icon:hover .col-8 {
  animation: fillCol28 2.6s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}

:global(.sand-bar-dollar-icon:hover) .col-1,
:global(.sand-bar-dollar-icon:hover) .col-9,
.sand-bar-dollar-icon:hover .col-1,
.sand-bar-dollar-icon:hover .col-9 {
  animation: fillCol19 2.6s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}

:global(.sand-bar-dollar-icon:hover) .cutout-dollar,
.sand-bar-dollar-icon:hover .cutout-dollar {
  animation: dollarReveal 2.6s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

@keyframes dropGrains {
  0%   { transform: translateY(-3px); opacity: 0; }
  30%  { opacity: 1; }
  80%  { opacity: 1; }
  100% { transform: translateY(9px); opacity: 0; }
}

@keyframes fillCol5 {
  0%        { transform: scaleY(0.72); }
  28%, 85%  { transform: scaleY(1); }
  95%, 100% { transform: scaleY(0.72); }
}

@keyframes fillCol46 {
  0%        { transform: scaleY(0.58); }
  34%, 85%  { transform: scaleY(1); }
  95%, 100% { transform: scaleY(0.58); }
}

@keyframes fillCol37 {
  0%        { transform: scaleY(0.38); }
  38%, 85%  { transform: scaleY(1); }
  95%, 100% { transform: scaleY(0.38); }
}

@keyframes fillCol28 {
  0%        { transform: scaleY(0.22); }
  42%, 85%  { transform: scaleY(1); }
  95%, 100% { transform: scaleY(0.22); }
}

@keyframes fillCol19 {
  0%        { transform: scaleY(0.12); }
  46%, 85%  { transform: scaleY(1); }
  95%, 100% { transform: scaleY(0.12); }
}

@keyframes dollarReveal {
  0%, 46%   { opacity: 0; transform: scale(0.65); }
  52%       { opacity: 1; transform: scale(1.05); }
  56%, 84%  { opacity: 1; transform: scale(1); }
  92%, 100% { opacity: 0; transform: scale(0.65); }
}
</style>