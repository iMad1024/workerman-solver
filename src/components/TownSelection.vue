<template>
  <div class="segmented-hybrid-bar">
    <!-- Primary Direct Buttons -->
    <button
      v-for="item in visibleOptions"
      :key="item.key"
      type="button"
      class="pill-btn"
      :class="{ active: modelValue === Number(item.key) }"
      @click="selectOption(Number(item.key))"
    >
      {{ item.label }} / {{ Number(item.value).toFixed(2) }}
    </button>

    <!-- 4th Overflow Button (Others) -->
    <details
      v-if="overflowOptions.length > 0"
      ref="overflowDropdown"
      class="dropdown-wrapper"
    >
      <summary
        class="dropdown-trigger"
        :class="{ 'selected-active': isOverflowActive }"
      >
        <span class="selected-text">{{ activeOverflowLabel || placeholder }}</span>
        <svg class="chevron" viewBox="0 0 24 24">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </summary>

      <!-- Floating Menu -->
      <div class="dropdown-menu" :class="{ 'drop-up': dropUp }">
        <div
          v-for="item in overflowOptions"
          :key="Number(item.key)"
          class="dropdown-item"
          :class="{ active: modelValue === Number(item.key) }"
          @click="selectOption(Number(item.key))"
        >
          <span>{{ item.label }} / {{ Number(item.value).toFixed(2) }}</span>
          <span v-if="modelValue === Number(item.key)" class="checkmark">✓</span>
        </div>
      </div>
    </details>
  </div>
</template>

<script>
export default {
  name: 'TownSelection',
  props: {
    options: {
      type: Array,
      required: true,
      default: () => [],
    },
    modelValue: {
      type: [String, Number],
      default: null,
    },
    visibleCount: {
      type: Number,
      default: 3,
    },
    placeholder: {
      type: String,
      default: 'Others',
    },
    dropUp: {
        type: Boolean,
        default: false,
    },
  },
  emits: ['update:modelValue', 'change'],
  computed: {
    visibleOptions() {
      if (!Array.isArray(this.options)) return [];
      return this.options.slice(0, this.visibleCount);
    },
    overflowOptions() {
      if (!Array.isArray(this.options)) return [];
      return this.options.slice(this.visibleCount);
    },
    isOverflowActive() {
      return this.overflowOptions.some((opt) => Number(opt.key) === this.modelValue);
    },
    activeOverflowLabel() {
      const match = this.overflowOptions.find((opt) => Number(opt.key) === this.modelValue);
      return match ? match.label + ' / ' + Number(match.value).toFixed(2) : null;
    },
  },
  methods: {
    selectOption(val) {
      this.$emit('update:modelValue', val);
      this.$emit('change', val);
      if (this.$refs.overflowDropdown) {
        this.$refs.overflowDropdown.removeAttribute('open');
      }
    },
  },
};
</script>

<style scoped>
.segmented-hybrid-bar {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  white-space: nowrap;
  background: #121215;
  border: 1px solid #27272a;
  border-radius: 6px;
  padding: 3px;
  gap: 4px;
  font-family: inherit;
  font-size: 13px;
  box-sizing: border-box;
}

.pill-btn {
  background: transparent;
  border: 1px solid transparent;
  color: #71717a;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.pill-btn:hover {
  background-color: #22222a;
  border-color: #4b4b58;
  color: #ffffff;
}

.pill-btn.active {
  background-color: rgba(37, 99, 235, 0.15);
  border: 1px solid #3b82f6;
  color: #93c5fd;
}

.dropdown-wrapper {
  position: relative;
  display: inline-block;
  min-width: 130px;
  font-size: 13px;
  font-family: inherit;
  user-select: none;
  text-align: left;
}

.dropdown-trigger {
  list-style: none;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background-color: transparent;
  border: 1px solid #33333a;
  border-radius: 6px;
  color: #71717a;
  cursor: pointer;
  transition: all 0.15s ease;
  box-sizing: border-box;
}

.dropdown-trigger::-webkit-details-marker {
  display: none;
}

.dropdown-trigger:hover {
  background-color: #22222a;
  border-color: #4b4b58;
  color: #ffffff;
}

.dropdown-trigger:hover .chevron {
  stroke: #ffffff;
}

.dropdown-wrapper[open] .dropdown-trigger {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.dropdown-trigger.selected-active {
  border-color: #3b82f6;
  background-color: rgba(37, 99, 235, 0.15);
  color: #93c5fd;
}

.dropdown-trigger.selected-active .chevron {
  stroke: #93c5fd;
}

.selected-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chevron {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: #71717a;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.dropdown-wrapper[open] .chevron {
  transform: rotate(180deg);
  stroke: #60a5fa;
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 5px);
  right: 0;
  width: 100%;
  min-width: 140px;
  max-height: 220px;
  overflow-y: auto;
  background: #141418;
  border: 1px solid #2d2d35;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
  padding: 4px;
  z-index: 100;
  box-sizing: border-box;
}

.dropdown-menu::-webkit-scrollbar {
  width: 5px;
}

.dropdown-menu::-webkit-scrollbar-thumb {
  background: #33333f;
  border-radius: 3px;
}

.dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 4px;
  color: #94a3b8;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.dropdown-item:hover {
  background-color: #24242e;
  color: #f1f5f9;
}

.dropdown-item.active {
  background-color: rgba(37, 99, 235, 0.18);
  color: #93c5fd;
  font-weight: 500;
}

.checkmark {
  font-size: 11px;
  color: #60a5fa;
}



.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  z-index: 1000;
}

.dropdown-menu.drop-up {
  top: auto;
  bottom: calc(100% + 4px);
}


</style>