<!-- src/components/icons/PetersenIcon.vue -->
<template>
  <svg 
    viewBox="-120 -120 240 240" 
    :width="size" 
    :height="size" 
    class="inline-graph-icon"
  >
  <!-- Pentagon outer cycle -->
    <polygon points="0,-100 95,-31 59,81 -59,81 -95,-31" fill="none"/>
    <!-- Pentagram inner diagonals -->
    <polygon points="0,-100 59,81 -95,-31 95,-31 -59,81" fill="none"/>
    <!-- 5 Vertices -->
    <circle cx="0" cy="-100" r="12"/><circle cx="95" cy="-31" r="12"/><circle cx="59" cy="81" r="12"/><circle cx="-59" cy="81" r="12"/><circle cx="-95" cy="-31" r="12"/>
  </svg>
</template>

<script>
export default {
  name: 'K5Icon',
  props: {
    size: { type: String, default: '1.2em' }
  }
};
</script>

<style scoped>
.inline-graph-icon {
  display: inline-block;
  vertical-align: -0.2em;
  stroke: currentColor;
  fill: currentColor;
  stroke-width: 8;
}
</style>