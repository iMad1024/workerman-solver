<!-- src/components/icons/IconPetersen.vue -->
<template>
  <svg 
    viewBox="-120 -120 240 240" 
    :width="size" 
    :height="size" 
    class="inline-graph-icon"
  >
    <polygon points="0,-100 95,-31 59,81 -59,81 -95,-31" fill="none"/>
    <polygon points="0,-50 29,40 -48,-15 48,-15 -29,40" fill="none"/>
    <line x1="0" y1="-100" x2="0" y2="-50"/>
    <line x1="95" y1="-31" x2="48" y2="-15"/>
    <line x1="59" y1="81" x2="29" y2="40"/>
    <line x1="-59" y1="81" x2="-29" y2="40"/>
    <line x1="-95" y1="-31" x2="-48" y2="-15"/>
    <circle cx="0" cy="-100" r="10"/><circle cx="95" cy="-31" r="10"/>
    <circle cx="59" cy="81" r="10"/><circle cx="-59" cy="81" r="10"/><circle cx="-95" cy="-31" r="10"/>
    <circle cx="0" cy="-50" r="10"/><circle cx="48" cy="-15" r="10"/>
    <circle cx="29" cy="40" r="10"/><circle cx="-29" cy="40" r="10"/><circle cx="-48" cy="-15" r="10"/>
  </svg>
</template>

<script>
export default {
  name: 'PetersenIcon',
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