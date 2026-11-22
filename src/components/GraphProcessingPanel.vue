<template>
  <div 
    class="deck-hud-panel"
    :style="{ transform: `translate3d(${panelPos.x}px, ${panelPos.y}px, 0)` }"
    @mousedown.stop
  >
    <!-- Drag Handle Header -->
    <div class="hud-header" @mousedown="startDrag">
      <div class="hud-title">
        <span class="hud-drag-grip">⋮⋮</span>
        <span class="hud-indicator"></span>
        <span class="hud-label">Graph Processing</span>
      </div>

      <div class="hud-header-actions" @mousedown.stop>
        <!-- Continuous Mode Checkbox Button -->
        <button 
          type="button" 
          class="hud-action-btn continuous-toggle-btn" 
          :class="{ 'is-active': graphStore.isContinuousMode }"
          @click="graphStore.toggleContinuousMode()"
          title="Continuous Real-time Evaluation"
        >
          <IconContinuousLoop :size="14" :active="graphStore.isContinuousMode" />
        </button>

        <!-- Info Help Button -->
        <button 
          type="button" 
          class="hud-help-btn" 
          :class="{ 'is-open': showHelpModal }"
          @click="showHelpModal = !showHelpModal"
          title="Toggle Controls Guide"
        >
          ?
        </button>
      </div>
    </div>

    <!-- Help / Explanation Popover -->
    <div v-if="showHelpModal" class="hud-help-popover" @mousedown.stop>
      <div class="help-popover-header">
        <span class="help-title">Panel Controls & Icons</span>
        <button class="help-close-btn" @click="showHelpModal = false">✕</button>
      </div>
      <div class="help-popover-body">
        <div class="help-item">
          <div class="help-icon-preview"><DieIcon :size="16" /></div>
          <div class="help-desc">
            <strong>Plantzone Probability ($p$):</strong> Samples candidate plantzones independently with Bernoulli trial probability $p \in [0, 1]$.
          </div>
        </div>
        <div class="help-item">
          <div class="help-icon-preview"><DollarIcon :size="16" /></div>
          <div class="help-desc">
            <strong>Top-K Profit Nodes ($k$):</strong> Selects the $k$ highest daily-revenue plantzones across the entire map ($1 \le k \le {{ totalPlantzonesCount }}).
          </div>
        </div>
        <div class="help-item">
          <div class="help-icon-preview"><ClosestKIcon :size="16" /></div>
          <div class="help-desc">
            <strong>Closest-K Sources:</strong> Prunes potential town links to the $k$ closest source depots by network shortest-path CP distance.
          </div>
        </div>
        <div class="help-item">
          <div class="help-icon-preview"><RingsIcon :size="16" /></div>
          <div class="help-desc">
            <strong>Ring Frontier Expansion:</strong> Expands concentric topological ring frontiers outward from source hubs.
          </div>
        </div>
      </div>
    </div>

    <!-- ========================================== -->
    <!-- 3-Tab Navigation Bar                       -->
    <!-- ========================================== -->
    <div class="hud-tab-bar" @mousedown.stop>
      <button
        type="button"
        class="hud-tab-btn"
        :class="{ 'is-active': graphStore.activeTab === 'instance' }"
        @click="graphStore.setActiveTab('instance')"
      >
        INSTANCE
      </button>
      <button
        type="button"
        class="hud-tab-btn"
        :class="{ 'is-active': graphStore.activeTab === 'reduce' }"
        @click="graphStore.setActiveTab('reduce')"
      >
        REDUCE
      </button>
      <button
        type="button"
        class="hud-tab-btn"
        :class="{ 'is-active': graphStore.activeTab === 'solve' }"
        @click="graphStore.setActiveTab('solve')"
      >
        SOLVE
      </button>
    </div>

    <!-- ========================================== -->
    <!-- TAB 1: INSTANCE CONFIGURATION              -->
    <!-- ========================================== -->
    <div v-if="graphStore.activeTab === 'instance'">

      <!-- Instance Telemetry Summary Bar -->
      <div class="instance-stats-bar">
        <div class="stat-cell">
          <span class="stat-label">TOTAL CP</span>
          <span class="stat-val">{{ graphStore.instanceStats.totalCP }}</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">$M / DAY</span>
          <span class="stat-val sky-readout">{{ graphStore.instanceStats.totalSilver.toFixed(1) }}</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">MAX $M/D</span>
          <span class="stat-val">{{ graphStore.instanceStats.maxSilver.toFixed(1) }}</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">EFFICIENCY</span>
          <span class="stat-val" :style="efficiencyStyle">
            {{ graphStore.instanceStats.efficiencyPct.toFixed(1) }}%
          </span>
        </div>
      </div>

      <!-- Control Row 1: Plantzone Selection (Unified k slider) -->
      <div class="control-row">
        <div class="control-meta">
          <div class="meta-label-group">
            <span class="control-name">{{ pzControlLabel }}</span>
            <span 
              v-if="graphStore.pzMode && graphStore.pzMode !== 'none'" 
              class="value-readout target-readout"
            >
              n = {{ graphStore.liveTopKPzCount }}/{{ totalPlantzonesCount }}
            </span>
          </div>

          <div 
            class="neon-switch-capsule" 
            :class="[
              `active-${graphStore.pzMode || 'none'}`,
              { 'is-continuous': graphStore.isContinuousMode }
            ]"
          >
            <button 
              type="button"
              class="neon-switch-pad"
              :class="{ 'is-active': graphStore.pzMode === 'prob' }"
              @click="graphStore.togglePzMode('prob')"
              title="Random Permutation (First k)"
            >
              <PermuteIcon :size="18" />
            </button>

            <button 
              type="button"
              class="neon-switch-pad"
              :class="{ 'is-active': graphStore.pzMode === 'topk' }"
              @click="graphStore.togglePzMode('topk')"
              title="Top-K Highest Profit"
            >
              <DollarIcon :size="18" />
            </button>
          </div>
        </div>

        <div class="stepper-track-wrap" @mousedown.stop>
          <button 
            type="button"
            class="hud-glass-btn target-glass-btn micro-btn"
            :disabled="graphStore.topKPzCount <= 0"
            @mousedown="targetKPrevCtrl.start"
            @mouseup="targetKPrevCtrl.stop"
            @mouseleave="targetKPrevCtrl.stop"
            title="Decrease k (Hold to fast-rewind)"
          >
            <span class="nav-triangle">◀</span>
          </button>

          <div class="range-slider-container discrete-container">
            <input 
              type="range" 
              min="0" 
              :max="totalPlantzonesCount" 
              step="1" 
              :value="graphStore.liveTopKPzCount"
              @input="graphStore.setLiveTargetCount(Number($event.target.value), false)"
              @change="graphStore.setLiveTargetCount(Number($event.target.value), true)"
              class="custom-slider target-slider"
            />
            <!-- Visual background rail inset 5.5px on both ends so it docks flush at min & max -->
            <div class="slider-track-bg"></div>
            <!-- Synced fill: 0px at min, 100% of rail at max -->
            <div 
              class="slider-fill target-fill" 
              :style="{ width: `calc((100% - 11px) * ${targetProgress})` }"
            ></div>
            <!-- 1/5th, 2/5th, 3/5th, 4/5th, 5/5th percentile ticks -->
            <div class="slider-ticks" aria-hidden="true">
              <span class="tick-mark" style="left: 0%"></span>
              <span class="tick-mark" style="left: 20%"></span>
              <span class="tick-mark" style="left: 40%"></span>
              <span class="tick-mark" style="left: 60%"></span>
              <span class="tick-mark" style="left: 80%"></span>
              <span class="tick-mark" style="left: 100%"></span>
            </div>
          </div>

          <button 
            type="button"
            class="hud-glass-btn target-glass-btn micro-btn"
            :disabled="graphStore.topKPzCount >= totalPlantzonesCount"
            @mousedown="targetKNextCtrl.start"
            @mouseup="targetKNextCtrl.stop"
            @mouseleave="targetKNextCtrl.stop"
            title="Increase k (Hold to fast-forward)"
          >
            <span class="nav-triangle">▶</span>
          </button>
        </div>
      </div>

      <div class="hud-divider"></div>

      <!-- Control Row 2: Source Town Routing (Shared 1..30 scale) -->
      <div class="control-row">
        <div class="control-meta">
          <div class="meta-label-group">
            <span class="control-name">{{ sourceControlLabel }}</span>
            <span v-if="graphStore.sourceMode === 'rings'" class="value-readout sky-readout">
              r = {{ graphStore.liveStabilityThresholdR.toFixed(2) }}
            </span>
            <span v-if="graphStore.sourceMode === 'closest'" class="value-readout sky-readout">
              k = {{ graphStore.liveSourceScaleStep }}
            </span>
          </div>

          <div 
            class="neon-switch-capsule" 
            :class="[
              `active-${graphStore.sourceMode || 'none'}`,
              { 'is-continuous': graphStore.isContinuousMode }
            ]"
          >
            <button 
              type="button"
              class="neon-switch-pad"
              :class="{ 'is-active': graphStore.sourceMode === 'closest' }"
              @click="graphStore.toggleSourceMode('closest')"
              title="Closest-K Random Town"
            >
              <ClosestKIcon :size="18" />
            </button>

            <button 
              type="button"
              class="neon-switch-pad"
              :class="{ 'is-active': graphStore.sourceMode === 'rings' }"
              @click="graphStore.toggleSourceMode('rings')"
              title="Stable Matching (Threshold r > 1)"
            >
              <RingsIcon :size="18" />
            </button>
          </div>
        </div>

        <div class="stepper-track-wrap" @mousedown.stop>
          <button 
            type="button"
            class="hud-glass-btn micro-btn"
            :disabled="graphStore.sourceScaleStep <= 1"
            @mousedown="sourceStepPrevCtrl.start"
            @mouseup="sourceStepPrevCtrl.stop"
            @mouseleave="sourceStepPrevCtrl.stop"
            title="Decrease (Hold to fast-rewind)"
          >
            <span class="nav-triangle">◀</span>
          </button>

          <div class="range-slider-container discrete-container">
            <input 
              type="range" 
              min="1" 
              max="30" 
              step="1" 
              :value="graphStore.liveSourceScaleStep"
              @input="graphStore.setLiveSourceStep(Number($event.target.value), false)"
              @change="graphStore.setLiveSourceStep(Number($event.target.value), true)"
              class="custom-slider cyan-slider"
            />
            <div class="slider-track-bg"></div>
            <!-- Synced track fill -->
            <div 
              class="slider-fill cyan-fill" 
              :style="{ width: `calc((100% - 11px) * ${sourceProgress})` }"
            ></div>
            <!-- 1/5th, 2/5th, 3/5th, 4/5th, 5/5th percentile ticks -->
            <div class="slider-ticks" aria-hidden="true">
              <span class="tick-mark" style="left: 0%"></span>
              <span class="tick-mark" style="left: 20%"></span>
              <span class="tick-mark" style="left: 40%"></span>
              <span class="tick-mark" style="left: 60%"></span>
              <span class="tick-mark" style="left: 80%"></span>
              <span class="tick-mark" style="left: 100%"></span>
            </div>
          </div>

          <button 
            type="button"
            class="hud-glass-btn micro-btn"
            :disabled="graphStore.sourceScaleStep >= 30"
            @mousedown="sourceStepNextCtrl.start"
            @mouseup="sourceStepNextCtrl.stop"
            @mouseleave="sourceStepNextCtrl.stop"
            title="Increase (Hold to fast-forward)"
          >
            <span class="nav-triangle">▶</span>
          </button>
        </div>
      </div>

      <div class="hud-divider"></div>

      <!-- Control Row 3: Free Non-Plantzone Targets (Yellow Neon Theme) -->
      <div class="control-row">
        <div class="control-meta">
          <div class="meta-label-group">
            <span class="control-name">Free Targets</span>
            <span class="value-readout free-readout">
              m = {{ graphStore.liveFreeTargetCount }}/{{ totalFreeTargetsCount }}
            </span>
          </div>
        </div>

        <div class="stepper-track-wrap" @mousedown.stop>
          <button
            type="button"
            class="hud-glass-btn free-glass-btn micro-btn"
            :disabled="graphStore.liveFreeTargetCount <= 0"
            @mousedown="freeMPrevCtrl.start"
            @mouseup="freeMPrevCtrl.stop"
            @mouseleave="freeMPrevCtrl.stop"
            title="Decrease free targets m (Hold to fast-rewind)"
          >
            <span class="nav-triangle">◀</span>
          </button>

          <div class="range-slider-container discrete-container">
            <input
              type="range"
              min="0"
              :max="totalFreeTargetsCount"
              step="1"
              :value="graphStore.liveFreeTargetCount"
              @input="graphStore.setLiveFreeTargetCount(Number($event.target.value), false)"
              @change="graphStore.setLiveFreeTargetCount(Number($event.target.value), true)"
              class="custom-slider free-slider"
            />
            <div class="slider-track-bg"></div>
            <div
              class="slider-fill free-fill"
              :style="{ width: `calc((100% - 11px) * ${freeTargetProgress})` }"
            ></div>
            <div class="slider-ticks" aria-hidden="true">
              <span class="tick-mark" style="left: 0%"></span>
              <span class="tick-mark" style="left: 20%"></span>
              <span class="tick-mark" style="left: 40%"></span>
              <span class="tick-mark" style="left: 60%"></span>
              <span class="tick-mark" style="left: 80%"></span>
              <span class="tick-mark" style="left: 100%"></span>
            </div>
          </div>

          <button
            type="button"
            class="hud-glass-btn free-glass-btn micro-btn"
            :disabled="graphStore.liveFreeTargetCount >= totalFreeTargetsCount"
            @mousedown="freeMNextCtrl.start"
            @mouseup="freeMNextCtrl.stop"
            @mouseleave="freeMNextCtrl.stop"
            title="Increase free targets m (Hold to fast-forward)"
          >
            <span class="nav-triangle">▶</span>
          </button>
        </div>
      </div>

      <div class="hud-divider"></div>

      <!-- Seed & History Stepper Controls + JSON Upload -->
      <div class="seed-control" @mousedown.stop>
        <div class="seed-label-group">
          <span class="seed-tag">SEED</span>
          <span class="seed-counter">{{ graphStore.seedPositionLabel }}</span>
        </div>

        <input 
          type="text" 
          v-model="localSeed"
          @keydown.enter="onCommitSeed"
          class="seed-input hud-glass-box" 
          spellcheck="false"
          placeholder="ANY SEED"
        />

        <div class="seed-actions">
          <!-- Previous Seed -->
          <button 
            type="button" 
            class="hud-glass-btn seed-action-btn"
            :disabled="!graphStore.canGoPrevSeed"
            @mousedown="seedPrevCtrl.start"
            @mouseup="seedPrevCtrl.stop"
            @mouseleave="seedPrevCtrl.stop"
            title="Previous Seed (Hold to fast-rewind)"
          >
            <span class="nav-triangle">◀</span>
          </button>

          <!-- Next Seed -->
          <button 
            type="button" 
            class="hud-glass-btn seed-action-btn"
            :disabled="!graphStore.canGoNextSeed"
            @mousedown="seedNextCtrl.start"
            @mouseup="seedNextCtrl.stop"
            @mouseleave="seedNextCtrl.stop"
            title="Next Seed (Hold to fast-forward)"
          >
            <span class="nav-triangle">▶</span>
          </button>

          <!-- Refresh Button -->
          <button 
            type="button" 
            class="hud-glass-btn seed-action-btn"
            :class="{ 'is-spinning': isRefreshing, 'is-holding': isHoldingRefresh }"
            @mousedown="onRefreshPressStart"
            @mouseup="onRefreshPressEnd"
            @mouseleave="onRefreshPressCancel"
            title="Click: New seed | Hold 0.5s: Batch generate"
          >
            <svg class="refresh-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
          </button>

          <!-- Active Seed Checkbox -->
          <!-- <button 
            type="button" 
            class="hud-glass-btn seed-action-btn seed-check-btn"
            :class="{ 'is-active': graphStore.isSeedActive }"
            @click="onToggleCheck"
            :title="graphStore.isSeedActive ? 'Seed active' : 'Apply current seed'"
          >
            <svg class="check-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button> -->
          <!-- Active Seed Toggle (Die Icon) -->
          <button 
            type="button" 
            class="hud-glass-btn seed-action-btn seed-check-btn"
            :class="{ 
              'is-active': graphStore.isSeedActive,
              'is-continuous': graphStore.isContinuousMode 
            }"
            @click="onToggleCheck"
            :title="graphStore.isSeedActive ? 'Seed active' : 'Apply current seed'"
          >
            <DieIcon :size="15" />
          </button>

          <!-- Upload .json Assignment Button -->
          <button 
            type="button" 
            class="hud-glass-btn seed-action-btn json-upload-btn"
            :class="{ 'is-loaded': !!graphStore.uploadedFileName }"
            @click="triggerJsonUpload"
            :title="graphStore.uploadedFileName ? `Loaded: ${graphStore.uploadedFileName}` : 'Upload targets/sources (.json)'"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>

          <input 
            ref="jsonFileInput"
            type="file" 
            accept=".json,application/json" 
            class="hidden-file-input"
            @change="onJsonFileSelected"
          />
        </div>
      </div>

      <!-- Loaded JSON file indicator or parse error -->
      <div v-if="graphStore.uploadedFileName || jsonError" class="json-status-row">
        <span v-if="jsonError" class="json-error-text">{{ jsonError }}</span>
        <span v-else class="json-loaded-badge">JSON: <strong>{{ graphStore.uploadedFileName }}</strong></span>
      </div>

      <!-- Instance Source Switcher + Batch Seed Popover (Hold Refresh 0.5s) -->
      <transition name="popover-fade">
        <div v-if="showBatchInput" class="batch-seed-popover hud-glass-box">
          <div class="batch-row">
            <span class="batch-label">Instance:</span>
            <div class="source-switch-pills">
              <button
                type="button"
                class="hud-glass-btn source-pill-btn"
                :class="{ 'is-active': graphStore.instanceSource === 'seed' }"
                @click="graphStore.setInstanceSource('seed')"
                title="Use active random seed instance"
              >
                Random
              </button>
              <button
                type="button"
                class="hud-glass-btn source-pill-btn"
                :class="{ 'is-active': graphStore.instanceSource === 'custom' }"
                :disabled="!graphStore.customInstance"
                @click="graphStore.setInstanceSource('custom')"
                :title="graphStore.customInstance ? 'Use custom edited instance' : 'No custom instance yet (edit via Quick Select or bottom-left panel)'"
              >
                Custom
              </button>
              <button
                type="button"
                class="hud-glass-btn source-pill-btn"
                :class="{ 'is-active': graphStore.instanceSource === 'uploaded' }"
                :disabled="!graphStore.uploadedInstance"
                @click="graphStore.setInstanceSource('uploaded')"
                :title="graphStore.uploadedInstance ? `Use uploaded JSON (${graphStore.uploadedFileName})` : 'No uploaded JSON instance'"
              >
                Uploaded
              </button>
            </div>
            <button type="button" class="hud-glass-btn batch-close-btn" @click="showBatchInput = false">
              ✕
            </button>
          </div>

          <div class="batch-row">
            <span class="batch-label">Batch Count:</span>
            <input 
              ref="batchInputRef"
              type="number" 
              :value="batchCount"
              @input="onBatchInput"
              @blur="onBatchBlur"
              min="1" 
              max="1000"
              placeholder="50"
              class="batch-number-input hud-glass-box"
              @keydown.enter="submitBatchSeeds"
              @keydown.esc="showBatchInput = false"
            />
            <button type="button" class="hud-glass-btn batch-go-btn" @click="submitBatchSeeds">
              Generate
            </button>
          </div>
        </div>
      </transition>

      <div class="hud-divider"></div>

      <!-- Compact REDUCE Dropdown -->
      <div class="solve-subpanel compact-subpanel" @mousedown.stop>
        <div class="solve-collapse-header" @click="toggleCompactSection('reduce')">
          <div class="collapse-title-left">
            <span class="collapse-caret">{{ compactSections.reduce ? '▾' : '▸' }}</span>
            <span class="collapse-label">Reduce</span>
          </div>
          <span
            v-if="graphStore.reducedGraph.length"
            class="step-counter-box sky-readout compact-header-meta"
          >
            {{ activeStepIndex }} / {{ maxStepIndex }}
          </span>
        </div>

        <div v-if="compactSections.reduce" class="solve-subpanel-body">
          <div class="stepper-track-wrap reduce-transport-wrap" @mousedown.stop>
            <button
              type="button"
              class="hud-glass-btn micro-btn jump-btn"
              :disabled="activeStepIndex <= minStepIndex"
              @click="ensureCompactReduceMode(); jumpPrevStageRun()"
              title="Jump to start of stage"
            >
              <span class="nav-double-triangle">◀◀</span>
            </button>
            <button
              type="button"
              class="hud-glass-btn micro-btn"
              :disabled="activeStepIndex <= minStepIndex"
              @mousedown="ensureCompactReduceMode(); stepPrevCtrl.start($event)"
              @mouseup="stepPrevCtrl.stop()"
              @mouseleave="stepPrevCtrl.stop"
              title="Previous step"
            >
              <span class="nav-triangle">◀</span>
            </button>

            <div class="range-slider-container discrete-container">
              <input
                type="range"
                :min="minStepIndex"
                :max="maxStepIndex"
                step="1"
                :value="activeStepIndex"
                @input="onCompactReduceSliderInput(Number($event.target.value))"
                @change="onCompactReduceStep(Number($event.target.value))"
                class="custom-slider cyan-slider"
              />
              <div class="slider-track-bg"></div>
              <div
                class="slider-fill cyan-fill"
                :style="{ width: `calc((100% - 11px) * ${reduceProgress})` }"
              ></div>
              <div class="slider-ticks" aria-hidden="true">
                <span class="tick-mark" style="left: 0%"></span>
                <span class="tick-mark" style="left: 20%"></span>
                <span class="tick-mark" style="left: 40%"></span>
                <span class="tick-mark" style="left: 60%"></span>
                <span class="tick-mark" style="left: 80%"></span>
                <span class="tick-mark" style="left: 100%"></span>
              </div>
            </div>

            <button
              type="button"
              class="hud-glass-btn micro-btn"
              :disabled="activeStepIndex >= maxStepIndex"
              @mousedown="ensureCompactReduceMode(); stepNextCtrl.start($event)"
              @mouseup="stepNextCtrl.stop()"
              @mouseleave="stepNextCtrl.stop"
              title="Next step"
            >
              <span class="nav-triangle">▶</span>
            </button>
            <button
              type="button"
              class="hud-glass-btn micro-btn jump-btn"
              :disabled="activeStepIndex >= maxStepIndex"
              @click="ensureCompactReduceMode(); jumpNextStageRun()"
              title="Jump to end of stage"
            >
              <span class="nav-double-triangle">▶▶</span>
            </button>
          </div>

          <div class="reduce-meta-line">
            <span class="reduce-title-text">Reduction Step</span>
            <div class="reduce-right-cluster">
              <span class="step-counter-box sky-readout">
                {{ activeStepIndex }} / {{ maxStepIndex }}
              </span>
              <span class="op-stage-badge" :class="`op-${activeReduceStep.opType.toLowerCase()}`">
                {{ activeReduceStep.opType }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Compact SOLVE Dropdown -->
      <div class="solve-subpanel compact-subpanel" @mousedown.stop>
        <div class="solve-collapse-header" @click="toggleCompactSection('solve')">
          <div class="collapse-title-left">
            <span class="collapse-caret">{{ compactSections.solve ? '▾' : '▸' }}</span>
            <span class="collapse-label">Solve</span>
          </div>
          <div class="collapse-title-right">
            <span v-if="dpSandboxRunning" class="dp-prog-stage">
              {{ dpLiveProgress?.stage || 'RUN' }}
            </span>
            <template v-else-if="graphStore.dpSolution">
              <span v-if="graphStore.dpSolution.isExact" class="dp-exact-badge">EXACT</span>
              <span v-else class="dp-heur-badge">HEUR</span>
              <span class="mint-readout dp-header-cp">{{ graphStore.dpSolution.minCost }}</span>
            </template>
          </div>
        </div>

        <div v-if="compactSections.solve" class="solve-subpanel-body">
          <div class="compact-solve-bar">
            <select
              v-model="dpSolvePreset"
              class="hud-glass-select td-dp-cap-select compact-cap-select"
              title="Solve preset (Full ladder, 1K->Exact, Greedy->Exact, or beam cap)"
            >
              <option value="exact">EXACT</option>
              <option value="exact-1k">EXACT (1K)</option>
              <option value="exact-greedy">EXACT (GRD)</option>
              <option value="1024">1K</option>
              <option value="4096">4K</option>
              <option value="16384">16K</option>
            </select>

            <button
              type="button"
              class="hud-glass-btn td-dp-test-btn"
              :class="{ 'is-abort': dpSandboxRunning }"
              @click="dpSandboxRunning ? haltDpSandbox() : runCompactDpSolve()"
            >
              {{ dpSandboxRunning ? 'HALT' : 'Solve DP' }}
            </button>
          </div>

          <!-- Nested Collapsible Solution Panel (identical controls & per-stage timings) -->
          <div
            v-if="dpSandboxRunning || dpSandboxResult || graphStore.dpSolution"
            class="solve-subpanel solve-solution-panel compact-nested-solution"
          >
            <div class="solve-collapse-header" @click="toggleSolveSection('solution')">
              <div class="collapse-title-left">
                <span class="collapse-caret">{{ solveSections.solution ? '▾' : '▸' }}</span>
                <span class="collapse-label">Solution</span>
              </div>
              <div class="collapse-title-right">
                <span v-if="dpSandboxResult" class="dp-sb-time">
                  {{ formatStageMs(dpSandboxResult.totalElapsedMs) }}
                </span>
              </div>
            </div>

            <div v-if="solveSections.solution" class="solve-subpanel-body">
              <div v-if="dpSandboxRunning && dpLiveProgress" class="td-dp-progress-card">
                <div class="dp-prog-top">
                  <span class="dp-prog-stage">{{ dpLiveProgress.stage }}</span>
                  <span>
                    ({{ dpLiveProgress.bagsProcessed }}/{{ dpLiveProgress.totalBags }} bags)
                  </span>
                  <span class="dp-sb-time">{{ (dpLiveProgress.elapsedMs / 1000).toFixed(1) }}s</span>
                </div>
                <div class="dp-prog-bar-track">
                  <div
                    class="dp-prog-bar-fill"
                    :style="{ width: `${Math.min(100, (dpLiveProgress.bagsProcessed / Math.max(1, dpLiveProgress.totalBags)) * 100)}%` }"
                  ></div>
                </div>
                <div class="dp-prog-bottom">
                  <span>
                    Bag #{{ dpLiveProgress.currentBagId }}:
                    <strong class="sky-readout">{{ dpLiveProgress.currentBagStates.toLocaleString() }}</strong>
                  </span>
                  <span v-if="dpLiveProgress.upperBoundCost != null" class="mint-readout">
                    UB: {{ dpLiveProgress.upperBoundCost }}
                  </span>
                </div>
              </div>

              <div v-if="dpSandboxResult" class="td-dp-sandbox-bar">
                <div v-if="graphStore.dpSolution" class="dp-sb-sub-row">
                  <span class="dp-sb-cell">
                    CP: <strong class="mint-readout">{{ graphStore.dpSolution.minCost }}</strong>
                    ({{ displayedSolutionVertexCount }}v)
                  </span>

                  <div class="dp-view-seg">
                    <button
                      type="button"
                      class="hud-glass-btn dp-seg-btn"
                      :class="{ active: !graphStore.showSolutionView }"
                      @click="graphStore.setInstanceMapMode('instance')"
                      title="Hide solution overlay (return to Instance view)"
                    >
                      OFF
                    </button>
                    <button
                      type="button"
                      class="hud-glass-btn dp-seg-btn"
                      :class="{ active: graphStore.showSolutionView && graphStore.solutionGraphMode === 'reduced' }"
                      @click="graphStore.setInstanceMapMode('solve'); graphStore.setSolutionViewMode('reduced')"
                      title="Solution on Reduced Graph"
                    >
                      RED
                    </button>
                    <button
                      type="button"
                      class="hud-glass-btn dp-seg-btn"
                      :class="{ active: graphStore.showSolutionView && graphStore.solutionGraphMode === 'original' }"
                      @click="graphStore.setInstanceMapMode('solve'); graphStore.setSolutionViewMode('original')"
                      title="Unwrapped Solution on Original Graph"
                    >
                      ORIG
                    </button>
                  </div>
                </div>

                <div v-if="graphStore.dpSolutions?.length >= 1" class="dp-sb-solutions">
                  <span class="dp-bn-label">Stages:</span>
                  <button
                    v-for="(sol, sIdx) in graphStore.dpSolutions"
                    :key="`c-${sol.label}-${sIdx}`"
                    type="button"
                    class="hud-glass-btn dp-stage-sol-pill"
                    :class="{
                      active: graphStore.showSolutionView && graphStore.activeSolutionIndex === sIdx,
                      'is-exact-stage': sol.isExact
                    }"
                    @click="graphStore.setInstanceMapMode('solve'); graphStore.selectDpSolutionIndex(sIdx)"
                    :title="`${sol.label}${sol.isExact ? ' (EXACT)' : ''}: CP ${sol.minCost} (${sol.selectedVertices.length} nodes, ${sol.ms}ms)`"
                  >
                    {{ sol.label.replace('HEUR ', '') }}<span v-if="sol.isExact" class="dp-exact-check">✓</span>:
                    <strong>{{ sol.minCost }}</strong>
                    <span class="dp-stage-ms">{{ formatStageMs(sol.ms) }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ========================================== -->
    <!-- TAB 2: PREPROCESSING & STATISTICS          -->
    <!-- ========================================== -->
    <div v-else-if="graphStore.activeTab === 'reduce'">
      <!-- 1. 2-Row Graph Telemetry Card -->
      <div class="instance-stats-bar reduce-stats-grid">
        <div class="stat-cell">
          <span class="stat-label">NODES</span>
          <span class="stat-val">{{ activeReduceMeta.numNodes }}</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">EDGES</span>
          <span class="stat-val sky-readout">{{ activeReduceMeta.numEdges }}</span>
        </div>
        <div class="stat-cell" title="Targets / Town-Target Groups">
          <span class="stat-label">TT / GP</span>
          <span class="stat-val">
            <span class="target-readout">{{ activeReduceMeta.numTargets }}</span>
            <span class="stat-sub">/{{ activeReduceMeta.numGroups ?? 0 }}</span>
          </span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">
            {{ activeReduceMeta.treewidth != null ? 'TW / DIAM' : 'DIAMETER' }}
          </span>
          <span class="stat-val">
            <template v-if="activeReduceMeta.treewidth != null">
              <span class="mint-readout">{{ activeReduceMeta.treewidth }}</span>
              <span class="stat-sub">/{{ activeReduceMeta.diameter ?? '—' }}</span>
            </template>
            <template v-else>{{ activeReduceMeta.diameter ?? '—' }}</template>
          </span>
        </div>

        <div class="stats-grid-divider"></div>

        <!-- Degree Breakdown: Non-Terminal / Terminal (Target or Town) -->
        <div class="stat-cell" title="Degree 2: Non-Terminal / Terminal (Target or Town)">
          <span class="stat-label">DEG 2</span>
          <span class="stat-val deg-pair">
            <span class="deg-nonterm">{{ activeReduceMeta.nonTermDeg.d2 }}</span>
            <span class="deg-sep">/</span>
            <span class="deg-term">{{ activeReduceMeta.termDeg.d2 }}</span>
          </span>
        </div>
        <div class="stat-cell" title="Degree 3: Non-Terminal / Terminal (Target or Town)">
          <span class="stat-label">DEG 3</span>
          <span class="stat-val deg-pair">
            <span class="deg-nonterm">{{ activeReduceMeta.nonTermDeg.d3 }}</span>
            <span class="deg-sep">/</span>
            <span class="deg-term">{{ activeReduceMeta.termDeg.d3 }}</span>
          </span>
        </div>
        <div class="stat-cell" title="Degree 4: Non-Terminal / Terminal (Target or Town)">
          <span class="stat-label">DEG 4</span>
          <span class="stat-val deg-pair">
            <span class="deg-nonterm">{{ activeReduceMeta.nonTermDeg.d4 }}</span>
            <span class="deg-sep">/</span>
            <span class="deg-term">{{ activeReduceMeta.termDeg.d4 }}</span>
          </span>
        </div>
        <div class="stat-cell" title="Degree 5+: Non-Terminal / Terminal (Target or Town)">
          <span class="stat-label">DEG 5+</span>
          <span class="stat-val deg-pair">
            <span class="deg-nonterm">{{ activeReduceMeta.nonTermDeg.d5Plus }}</span>
            <span class="deg-sep">/</span>
            <span class="deg-term">{{ activeReduceMeta.termDeg.d5Plus }}</span>
          </span>
        </div>

        <div class="deg-legend-row">
          <span><i class="legend-dot nonterm-dot"></i>Non-Target</span>
          <span><i class="legend-dot term-dot"></i>Target / Town</span>
        </div>
      </div>

      <!-- 2. Slider Transport Bar (Directly below info card) -->
      <div class="control-row reduce-controls">
        <div class="stepper-track-wrap reduce-transport-wrap" @mousedown.stop>
          <!-- ◀◀ -->
          <button
            type="button"
            class="hud-glass-btn micro-btn jump-btn"
            :disabled="activeStepIndex <= minStepIndex"
            @click="jumpPrevStageRun(); focusReduceSlider()"
            title="Jump to start of stage"
          >
            <span class="nav-double-triangle">◀◀</span>
          </button>

          <!-- ◀ -->
          <button
            type="button"
            class="hud-glass-btn micro-btn"
            :disabled="activeStepIndex <= minStepIndex"
            @mousedown="focusReduceSlider(); stepPrevCtrl.start($event)"
            @mouseup="stepPrevCtrl.stop(); focusReduceSlider()"
            @mouseleave="stepPrevCtrl.stop"
            title="Previous step (Hold to fast-rewind)"
          >
            <span class="nav-triangle">◀</span>
          </button>

          <div class="range-slider-container discrete-container">
            <input
              ref="reduceSlider"
              type="range"
              :min="minStepIndex"
              :max="maxStepIndex"
              step="1"
              :value="activeStepIndex"
              @input="onReduceSliderInput(Number($event.target.value))"
              @change="updateStep(Number($event.target.value))"
              class="custom-slider cyan-slider"
            />
            <div class="slider-track-bg"></div>
            <div
              class="slider-fill cyan-fill"
              :style="{ width: `calc((100% - 11px) * ${reduceProgress})` }"
            ></div>
            <div class="slider-ticks" aria-hidden="true">
              <span class="tick-mark" style="left: 0%"></span>
              <span class="tick-mark" style="left: 20%"></span>
              <span class="tick-mark" style="left: 40%"></span>
              <span class="tick-mark" style="left: 60%"></span>
              <span class="tick-mark" style="left: 80%"></span>
              <span class="tick-mark" style="left: 100%"></span>
            </div>
          </div>

          <!-- ▶ -->
          <button
            type="button"
            class="hud-glass-btn micro-btn"
            :disabled="activeStepIndex >= maxStepIndex"
            @mousedown="focusReduceSlider(); stepNextCtrl.start($event)"
            @mouseup="stepNextCtrl.stop(); focusReduceSlider()"
            @mouseleave="stepNextCtrl.stop"
            title="Next step (Hold to fast-forward)"
          >
            <span class="nav-triangle">▶</span>
          </button>

          <!-- ▶▶ -->
          <button
            type="button"
            class="hud-glass-btn micro-btn jump-btn"
            :disabled="activeStepIndex >= maxStepIndex"
            @click="jumpNextStageRun(); focusReduceSlider()"
            title="Jump to end of stage"
          >
            <span class="nav-double-triangle">▶▶</span>
          </button>
        </div>

        <!-- 3. Header Row: "Reduction Step" (left) | "xxx / xxx" (right-aligned in fixed box) | Label (right) -->
        <div class="reduce-meta-line">
          <span class="reduce-title-text">Reduction Step</span>

          <div class="reduce-right-cluster">
            <span class="step-counter-box sky-readout">
              {{ activeStepIndex }} / {{ maxStepIndex }}
            </span>
            <span class="op-stage-badge" :class="`op-${activeReduceStep.opType.toLowerCase()}`">
              {{ activeReduceStep.opType }}
            </span>
          </div>
        </div>

        <!-- 4. Bottom Log Line -->
        <div class="step-op-pill">
          <span class="op-desc">{{ activeReduceStep.opDesc }}</span>
        </div>
      </div>
    </div>

    <!-- ========================================== -->
    <!-- TAB 3: SOLVING & TREE DECOMPOSITION        -->
    <!-- ========================================== -->
    <div v-else-if="graphStore.activeTab === 'solve'">
      <!-- Case 1: Intermediate step without precomputed Tree Decomposition -->
      <div v-if="!graphStore.treeDecomposition" class="solve-empty-card">
        <div class="solve-empty-title">
          Step {{ activeStepIndex }} ({{ activeReduceStep.opType }})
        </div>
        <div class="solve-empty-desc">
          Tree decomposition is precomputed for initial and final steps. Compute one for this intermediate graph ({{ activeReduceMeta.numNodes }} nodes, {{ activeReduceMeta.numEdges }} edges):
        </div>
        <button
          type="button"
          class="hud-glass-btn compute-td-btn"
          :disabled="activeReduceMeta.numNodes === 0"
          @click="graphStore.computeCurrentStepTreeDecomposition()"
        >
          Compute Tree Decomposition
        </button>
      </div>

      <!-- Case 2: Tree Decomposition Available -->
      <div v-else class="solve-body">
        <!-- 1. Compact Single-Row Tree Decomposition Telemetry -->
        <div class="instance-stats-bar solve-stats-row">
          <div class="stat-cell" title="Treewidth of the active tree decomposition">
            <span class="stat-label">TREEWIDTH</span>
            <span class="stat-val mint-readout">{{ graphStore.activeDecomposition.treewidth }}</span>
          </div>
          <div class="stat-cell" title="Total bags in the active tree decomposition">
            <span class="stat-label">#BAGS</span>
            <span class="stat-val">{{ tdStats.numNodes }}</span>
          </div>
          <div
            class="stat-cell"
            :title="`Bag counts — Max (${tdStats.maxBagSize}): ${tdStats.maxCount} | Max-1 (${Math.max(0, (tdStats.maxBagSize ?? 0) - 1)}): ${tdStats.maxMinus1Count} | Max-2 (${Math.max(0, (tdStats.maxBagSize ?? 0) - 2)}): ${tdStats.maxMinus2Count}`"
          >
            <span class="stat-label">#MAX/-1/-2</span>
            <span class="stat-val sky-readout solve-triple-val">
              {{ tdStats.maxCount }}<span class="stat-sub">/</span>{{ tdStats.maxMinus1Count }}<span class="stat-sub">/</span>{{ tdStats.maxMinus2Count }}
            </span>
          </div>
          <div class="stat-cell" title="Maximum crossing boundary groups over all bags">
            <span class="stat-label">MAX BND</span>
            <span class="stat-val warn-readout">{{ tdStats.maxBoundaryGroups ?? 0 }}</span>
          </div>
        </div>

        <!-- 2. Directional Tree Navigator (< ^ v >) + DP TEST -->
        <div class="td-nav-bar" @mousedown.stop>
          <div class="td-nav-meta">
            <span class="reduce-title-text">
              Bag #{{ activeTreeNode.origBagId ?? activeTreeNode.id }}
              <span class="stat-sub">(depth {{ activeTreeNode.depth }})</span>
            </span>
            <span class="step-counter-box sky-readout">
              step {{ activeStepIndex }} · {{ activeReduceStep.opType }}
            </span>
          </div>

          <div class="td-dpad-row">
            <div class="td-compact-dpad">
              <button
                type="button"
                class="hud-glass-btn td-dir-side-btn"
                :disabled="!canMovePrevSibling && !(activeTreeNode.children?.length)"
                @mousedown="heldTreeArrow = 'left'; treeChordUsed = false"
                @mouseup="if (!treeChordUsed) moveTreePrevSibling(); heldTreeArrow = null"
                @mouseleave="heldTreeArrow = null"
                title="Previous sibling (Hold + ▼ for left-most child)"
              >
                ◀
              </button>

              <div class="td-dir-vert-stack">
                <button
                  type="button"
                  class="hud-glass-btn td-dir-half-btn"
                  :disabled="activeTreeNode.parent == null"
                  @click="moveTreeParent"
                  title="Parent bag (Up Arrow)"
                >
                  ▲
                </button>
                <button
                  type="button"
                  class="hud-glass-btn td-dir-half-btn"
                  :disabled="!activeTreeNode.children?.length"
                  @click="handleTreeDownAction"
                  title="Child bag (Down Arrow · Hold ◀/▶ + ▼ for leftmost/rightmost child)"
                >
                  ▼
                </button>
              </div>

              <button
                type="button"
                class="hud-glass-btn td-dir-side-btn"
                :disabled="!canMoveNextSibling && !(activeTreeNode.children?.length)"
                @mousedown="heldTreeArrow = 'right'; treeChordUsed = false"
                @mouseup="if (!treeChordUsed) moveTreeNextSibling(); heldTreeArrow = null"
                @mouseleave="heldTreeArrow = null"
                title="Next sibling (Hold + ▼ for right-most child)"
              >
                ▶
              </button>

              <button
                type="button"
                class="hud-glass-btn td-root-btn"
                :disabled="activeTreeNode.id === graphStore.activeDecomposition.rootId"
                @click="selectTreeNode(graphStore.activeDecomposition.nodes[graphStore.activeDecomposition.rootId])"
                title="Jump to root bag"
              >
                ROOT
              </button>
            </div>

            <div class="td-dp-test-group">
              <select
                v-model="dpSolvePreset"
                class="hud-glass-select td-dp-cap-select compact-cap-select"
                title="Solve preset (Full ladder, 1K->Exact, Greedy->Exact, or beam cap)"
              >
                <option value="exact">EXACT</option>
                <option value="exact-1k">EXACT (1K)</option>
                <option value="exact-greedy">EXACT (GRD)</option>
                <option value="1024">1K</option>
                <option value="4096">4K</option>
                <option value="16384">16K</option>
              </select>

              <button
                type="button"
                class="hud-glass-btn td-dp-test-btn td-dp-icon-btn"
                :class="{ 'is-abort': dpSandboxRunning }"
                @click="dpSandboxRunning ? haltDpSandbox() : runDpSandboxForActiveNode()"
                :title="dpSandboxRunning ? 'Halt DP worker' : 'Solve / Optimize DP bottom-up to current bag'"
              >
                <!-- Running state: Stop / Halt square -->
                <svg
                  v-if="dpSandboxRunning"
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="currentColor"
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>

                <!-- Idle state: Steiner Tree / Route Optimize icon -->
                 <solveIcon v-else :size="18" :animate="graphStore.isContinuousMode" />
              </button>
            </div>
          </div>
        </div>

        <!-- 3a. Collapsible Subpanel: Solution -->
        <div
          v-if="dpSandboxRunning || dpSandboxResult || graphStore.dpSolution"
          class="solve-subpanel solve-solution-panel"
          @mousedown.stop
        >
          <div class="solve-collapse-header" @click="toggleSolveSection('solution')">
            <div class="collapse-title-left">
              <span class="collapse-caret">{{ solveSections.solution ? '▾' : '▸' }}</span>
              <span class="collapse-label">Solution</span>
              <span v-if="solutionBagId != null" class="stat-sub">(#{{ solutionBagId }})</span>
            </div>

            <div class="collapse-title-right">
              <span v-if="dpSandboxRunning" class="dp-prog-stage">
                {{ dpLiveProgress?.stage || 'RUN' }}
              </span>
              <template v-else-if="graphStore.dpSolution">
                <span
                  v-if="graphStore.dpSolution.isExact"
                  class="dp-exact-badge"
                  title="Provably optimal global Steiner Forest solution"
                >
                  EXACT
                </span>
                <span v-else class="dp-heur-badge" title="Heuristic upper bound (not yet certified exact)">
                  HEUR
                </span>
                <span class="mint-readout dp-header-cp">
                  {{ graphStore.dpSolution.minCost }}
                </span>
              </template>
            </div>
          </div>

          <div v-if="solveSections.solution" class="solve-subpanel-body">
            <!-- Collapse Diagnostic Pop-up -->
            <div
              v-if="dpSandboxResult?.collapseDebug && showDpDebugPopup"
              class="dp-debug-popup"
              @mousedown.stop
            >
              <div class="dp-debug-header">
                <span class="dp-debug-title">
                  ⚠ DP Collapse @ Bag #{{ dpSandboxResult.collapseDebug.bagId }} → #{{ dpSandboxResult.collapseDebug.parentBagId ?? 'ROOT' }}
                </span>
                <div class="dp-debug-actions">
                  <button type="button" class="hud-glass-btn dp-debug-btn" @click="copyDpDebugJson">
                    {{ dpDebugCopied ? 'COPIED' : 'COPY' }}
                  </button>
                  <button type="button" class="hud-glass-btn dp-debug-btn" @click="showDpDebugPopup = false">
                    ✕
                  </button>
                </div>
              </div>
              <pre class="dp-debug-pre">{{ JSON.stringify(dpSandboxResult.collapseDebug, null, 2) }}</pre>
            </div>

            <!-- Live DP Progress Strip -->
            <div v-if="dpSandboxRunning && dpLiveProgress" class="td-dp-progress-card">
              <div class="dp-prog-top">
                <span class="dp-prog-stage">{{ dpLiveProgress.stage }}</span>
                <span>
                  Depth <strong>{{ dpLiveProgress.depth }}</strong>
                  ({{ dpLiveProgress.bagsProcessed }}/{{ dpLiveProgress.totalBags }} bags)
                </span>
                <span class="dp-sb-time">{{ (dpLiveProgress.elapsedMs / 1000).toFixed(1) }}s</span>
              </div>
              <div class="dp-prog-bar-track">
                <div
                  class="dp-prog-bar-fill"
                  :style="{ width: `${Math.min(100, (dpLiveProgress.bagsProcessed / Math.max(1, dpLiveProgress.totalBags)) * 100)}%` }"
                ></div>
              </div>
              <div class="dp-prog-bottom">
                <span>
                  Bag #{{ dpLiveProgress.currentBagId }}:
                  <strong class="sky-readout">{{ dpLiveProgress.currentBagStates.toLocaleString() }}</strong>
                  (peak {{ dpLiveProgress.peakBagStates.toLocaleString() }})
                </span>
                <span v-if="dpLiveProgress.upperBoundCost != null" class="mint-readout">
                  UB: {{ dpLiveProgress.upperBoundCost }}
                </span>
              </div>
            </div>

            <!-- Completed DP Telemetry & View Switcher -->
            <div v-if="dpSandboxResult" class="td-dp-sandbox-bar">
              <div class="dp-sb-main-row">
                <span class="dp-sb-cell">
                  L: <strong>{{ dpSandboxResult.leftChildStats ? dpSandboxResult.leftChildStats.states : '—' }}</strong>
                </span>
                <span class="dp-sb-cell">
                  R: <strong>{{ dpSandboxResult.rightChildStats ? dpSandboxResult.rightChildStats.states : '—' }}</strong>
                </span>
                <span class="dp-sb-cell">
                  Bag: <strong class="warn-readout">{{ dpSandboxResult.bagMergeStats.preForgetStates }}</strong>→<strong class="mint-readout">{{ dpSandboxResult.bagMergeStats.postForgetStates }}</strong>
                </span>
                <span
                  class="dp-sb-time"
                  :title="dpSandboxResult.heuristicAdvice
                    ? `Total: ${dpSandboxResult.totalElapsedMs}ms (Best bound ${dpSandboxResult.heuristicAdvice.upperBoundCost} in ${dpSandboxResult.heuristicAdvice.ms}ms + Final pass in ${dpSandboxResult.bagMergeStats.ms}ms)`
                    : `Total elapsed time: ${dpSandboxResult.totalElapsedMs}ms`"
                >
                  {{ dpSandboxResult.totalElapsedMs }}ms
                </span>
              </div>

              <div v-if="graphStore.dpSolution" class="dp-sb-sub-row">
                <span
                  class="dp-sb-cell"
                  :title="graphStore.isOriginalSolutionView
                    ? `${graphStore.dpSolution.selectedVertices.length} reduced nodes unwrapped to ${displayedSolutionVertexCount} original nodes`
                    : `${graphStore.dpSolution.selectedVertices.length} selected nodes on current reduced graph`"
                >
                  CP: <strong class="mint-readout">{{ graphStore.dpSolution.minCost }}</strong>
                  ({{ displayedSolutionVertexCount }}v)
                </span>

                <!-- 3-Way View Mode: TD Separator | Reduced Graph Solution | Original Graph Solution -->
                <div class="dp-view-seg">
                  <button
                    type="button"
                    class="hud-glass-btn dp-seg-btn"
                    :class="{ active: !graphStore.showSolutionView }"
                    @click="graphStore.setSolutionViewMode('td')"
                    title="Tree Decomposition Separator View"
                  >
                    TD
                  </button>
                  <button
                    type="button"
                    class="hud-glass-btn dp-seg-btn"
                    :class="{ active: graphStore.showSolutionView && graphStore.solutionGraphMode === 'reduced' }"
                    @click="graphStore.setSolutionViewMode('reduced')"
                    title="Solution on Current Reduced Graph"
                  >
                    RED
                  </button>
                  <button
                    type="button"
                    class="hud-glass-btn dp-seg-btn"
                    :class="{ active: graphStore.showSolutionView && graphStore.solutionGraphMode === 'original' }"
                    @click="graphStore.setSolutionViewMode('original')"
                    title="Unwrapped Solution on Original Graph (Snapshot 0 / 1)"
                  >
                    ORIG
                  </button>
                </div>
              </div>

              <!-- Top Bottleneck Bags -->
              <div v-if="dpSandboxResult.bottleneckBags?.length" class="dp-sb-bottlenecks">
                <span class="dp-bn-label">Slowest:</span>
                <button
                  v-for="bn in dpSandboxResult.bottleneckBags.slice(0, 3)"
                  :key="`${bn.nodeId}-${bn.kind}`"
                  type="button"
                  class="hud-glass-btn dp-bn-pill"
                  @click="jumpToBottleneckBag(bn)"
                  :title="`Bag #${bn.bagId} (${bn.kind}, size ${bn.bagSize}) — ${bn.ms}ms, peak ${bn.peakStates} states`"
                >
                  #{{ bn.bagId }} <span>{{ bn.ms }}ms</span>
                </button>
              </div>

              <!-- Stored Stage Solutions (with ✓ EXACT indicator) -->
              <div v-if="graphStore.dpSolutions?.length >= 1" class="dp-sb-solutions">
                <span class="dp-bn-label">Stages:</span>
                <button
                  v-for="(sol, sIdx) in graphStore.dpSolutions"
                  :key="`${sol.label}-${sIdx}`"
                  type="button"
                  class="hud-glass-btn dp-stage-sol-pill"
                  :class="{
                    active: graphStore.showSolutionView && graphStore.activeSolutionIndex === sIdx,
                    'is-exact-stage': sol.isExact
                  }"
                  @click="graphStore.selectDpSolutionIndex(sIdx)"
                  :title="`${sol.label}${sol.isExact ? ' (EXACT)' : ''}: CP ${sol.minCost} (${sol.selectedVertices.length} nodes, ${sol.ms}ms)`"
                >
                  {{ sol.label.replace('HEUR ', '') }}<span v-if="sol.isExact" class="dp-exact-check">✓</span>: <strong>{{ sol.minCost }}</strong>
                  <span class="dp-stage-ms">{{ formatStageMs(sol.ms) }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 3b. Collapsible Subpanel: Interactive Tree Map -->
        <div class="solve-subpanel td-tree-map-card" @mousedown.stop>
          <div class="solve-collapse-header td-tree-map-header" @click="toggleSolveSection('tree')">
            <div class="collapse-title-left">
              <span class="collapse-caret">{{ solveSections.tree ? '▾' : '▸' }}</span>
              <span class="td-adj-tag td-tree-title">
                {{ graphStore.tdViewMode === 'join' ? 'Join Tree' : 'Min-Fill' }}
              </span>
            </div>
            <div class="td-mode-pills" @click.stop>
              <button
                type="button"
                class="hud-glass-btn td-mode-pill td-recenter-pill"
                @click="graphStore.resetSolveLegend()"
                title="Recenter G \ B Components legend"
              >
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                </svg>
              </button>
              <button
                type="button"
                class="hud-glass-btn td-mode-pill"
                :class="{ 'is-active': graphStore.tdViewMode === 'full' }"
                @click="graphStore.setTdViewMode('full')"
                title="Full Min-Fill Tree Decomposition"
              >
                FULL
              </button>
              <button
                type="button"
                class="hud-glass-btn td-mode-pill"
                :class="{ 'is-active': graphStore.tdViewMode === 'join' }"
                @click="graphStore.setTdViewMode('join')"
                title="Contracted Join/DP Tree (Forget/Introduce on edges)"
              >
                JOIN
              </button>
              <button
                type="button"
                class="hud-glass-btn td-mode-pill"
                @click="focusActiveTreeNode(4)"
                title="Zoom & center on active bag"
              >
                FOCUS
              </button>
              <button
                type="button"
                class="hud-glass-btn td-mode-pill"
                :disabled="treeZoomLevel <= 1.01"
                @click="resetTreeCam"
                title="Reset zoom to full tree"
              >
                1.0x
              </button>
            </div>
          </div>

          <div v-if="solveSections.tree" class="td-tree-svg-wrap">
            <span class="td-tree-zoom-badge">{{ treeZoomLevel.toFixed(1) }}x</span>
            <svg
              ref="treeSvg"
              :viewBox="treeViewBox"
              class="td-tree-svg"
              :class="{ 'is-panning': isPanningTree }"
              @wheel.prevent="onTreeWheel"
              @mousedown="startTreePan"
              @dblclick="focusActiveTreeNode(4)"
            >
              <g class="td-edges" :style="{ '--inv-z': fullTreeSvgData.invZ }">
                <line
                  v-for="e in fullTreeSvgData.edges"
                  :key="e.id"
                  :x1="e.x1"
                  :y1="e.y1"
                  :x2="e.x2"
                  :y2="e.y2"
                  :class="{ 'edge-path': e.isPath, 'edge-adj': e.isAdj }"
                />
              </g>
              <g class="td-nodes" :style="{ '--inv-z': fullTreeSvgData.invZ }">
                <g v-for="n in fullTreeSvgData.nodes" :key="n.id">
                  <circle
                    :cx="n.cx"
                    :cy="n.cy"
                    :r="n.r"
                    :style="!n.isActive && !n.isParent && !n.isChild ? { fill: n.heatColor } : null"
                    :class="{
                      'node-active': n.isActive,
                      'node-parent': n.isParent,
                      'node-child': n.isChild
                    }"
                    @click.stop="onTreeNodeClick(n.id)"
                  >
                    <title>Bag #{{ n.displayId }} · size {{ n.bagLen }} · depth {{ n.depth }}</title>
                  </circle>
                  <text
                    v-if="treeZoomLevel >= 2.2 && n.isAncestor"
                    :x="n.cx + n.r + 2 * fullTreeSvgData.invZ"
                    :y="n.cy + 2.2 * fullTreeSvgData.invZ"
                    :font-size="7.5 * fullTreeSvgData.invZ"
                    class="tree-zoom-label"
                    :class="{ 'is-active-label': n.isActive }"
                  >
                    #{{ n.displayId }}
                  </text>
                </g>
              </g>
            </svg>
          </div>
        </div>

        <!-- 3c. Collapsible Subpanel: Bag & Separator Info -->
        <div class="solve-subpanel td-bag-display" @mousedown.stop>
          <div class="solve-collapse-header td-bag-header" @click="toggleSolveSection('bagInfo')">
            <div class="collapse-title-left">
              <span class="collapse-caret">{{ solveSections.bagInfo ? '▾' : '▸' }}</span>
              <span>Bag Info ({{ activeTreeNode.bag.length }})</span>
            </div>
            <span class="stat-sub">
              {{ activeTreeNode.children?.length || 0 }}ch · {{ activeTreeNode.boundaryGroups?.length ?? 0 }} bnd
            </span>
          </div>

          <div v-if="solveSections.bagInfo" class="solve-subpanel-body td-bag-body">
            <div class="td-vertex-chips">
              <span
                v-for="item in graphStore.activeBagPartition"
                :key="item.key"
                class="td-v-chip"
                :class="`role-${item.role}`"
                :title="`${item.key} ${gameStore.uloc?.node?.[item.key] || ''} — ${separatorRoleLabel(item.role)}`"
              >
                {{ item.key }}
                <small v-if="gameStore.uloc?.node?.[item.key]">
                  {{ gameStore.uloc.node[item.key] }}
                </small>
              </span>
            </div>

            <div class="td-sep-legend">
              <span><i class="sep-dot role-shared-both"></i>Parent∩Child</span>
              <span><i class="sep-dot role-parent-sep"></i>Parent Sep</span>
              <span><i class="sep-dot role-child-sep"></i>Child Sep</span>
              <span><i class="sep-dot role-bag-only"></i>Local</span>
            </div>

            <div class="td-adj-links">
              <template v-if="graphStore.tdViewMode === 'join' && activeParentTransition">
                <div class="td-adj-row">
                  <span class="td-adj-tag">
                    ↑ To Parent #{{ graphStore.activeDecomposition.nodes[activeTreeNode.parent]?.origBagId ?? activeTreeNode.parent }}:
                  </span>
                  <span class="td-adj-list">
                    -{{ activeParentTransition.forget.length }} forget · +{{ activeParentTransition.introduce.length }} intro
                    ({{ activeParentTransition.chainOrigIds.length - 1 }} step{{ activeParentTransition.chainOrigIds.length > 2 ? 's' : '' }})
                  </span>
                </div>
              </template>

              <div v-if="activeTreeNode.parent != null" class="td-adj-row">
                <span class="td-adj-tag">
                  Parent #{{ graphStore.activeDecomposition.nodes[activeTreeNode.parent]?.origBagId ?? activeTreeNode.parent }}:
                </span>
                <span class="td-adj-list">
                  [{{ graphStore.activeDecomposition.nodes[activeTreeNode.parent].bag.join(', ') }}]
                </span>
              </div>

              <div v-if="activeTreeNode.children?.length" class="td-adj-row">
                <span class="td-adj-tag">Children:</span>
                <div class="td-child-pills">
                  <button
                    v-for="cid in activeTreeNode.children"
                    :key="cid"
                    type="button"
                    class="hud-glass-btn td-child-pill"
                    @click="selectTreeNode(graphStore.activeDecomposition.nodes[cid])"
                    :title="`Jump to child #${graphStore.activeDecomposition.nodes[cid]?.origBagId ?? cid}: [${graphStore.activeDecomposition.nodes[cid].bag.join(', ')}]`"
                  >
                    #{{ graphStore.activeDecomposition.nodes[cid]?.origBagId ?? cid }} ({{ graphStore.activeDecomposition.nodes[cid].bag.length }})
                  </button>
                </div>
              </div>

              <div class="td-group-summary">
                <div
                  class="td-group-line"
                  :title="formatTownGroupsTooltip('Internal Groups (Done)', activeTreeNode.internalGroups)"
                >
                  <span class="td-adj-tag">Internal group:</span>
                  <span class="td-group-count mint-readout">
                    {{ activeTreeNode.internalGroups?.length ?? 0 }}
                  </span>
                </div>

                <div
                  class="td-group-line"
                  :title="formatTownGroupsTooltip('External Groups (Not Encountered)', activeTreeNode.externalGroups)"
                >
                  <span class="td-adj-tag">External group:</span>
                  <span class="td-group-count">
                    {{ activeTreeNode.externalGroups?.length ?? 0 }}
                  </span>
                </div>

                <div
                  class="td-group-line"
                  :title="formatTownGroupsTooltip('Crossing Groups (Boundary)', activeTreeNode.boundaryGroups)"
                >
                  <span class="td-adj-tag">Crossing group:</span>
                  <span class="td-group-count warn-readout">
                    {{ activeTreeNode.boundaryGroups?.length ?? 0 }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>







<script>
import ClosestKIcon from './IconClosestK.vue';
import RingsIcon from './IconRings.vue';
import DieIcon from './IconDie.vue';
import PermuteIcon from './IconPermute.vue';
import DollarIcon from './IconDollar.vue';
import IconContinuousLoop from './IconContinuousLoop.vue';
import solveIcon from './IconSolve.vue';
import { useGameStore } from '../stores/game';
import { useUserStore } from '../stores/user';
import { useGraphStore, TREE_WORLD_W, TREE_WORLD_H } from '../stores/graph';
import { createHoldController } from '../utils/holdGestures';
import SteinerDpWorker from '../workers/steinerDp.worker.js?worker';


export default {
  name: 'GraphProcessingPanel',
  
  components: {
    ClosestKIcon,
    RingsIcon,
    DieIcon,
    DollarIcon,
    PermuteIcon,
    IconContinuousLoop,
    solveIcon,
  },
  props: {
    stepIndex: { type: Number, default: 0 },
    totalSteps: { type: Number, default: 0 },
    currentOpType: { type: String, default: 'INIT' },
    currentOpDesc: { type: String, default: 'Initial graph' },
  },
  emits: [
    'update:stepIndex',
  ],
  setup() {
    const gameStore = useGameStore();
    return { gameStore };
  },
  data() {
    return {
      panelPos: { x: 0, y: 0 },
      isDragging: false,
      dragStart: { mouseX: 0, mouseY: 0, posX: 0, posY: 0 },

      // Help Modal State
      showHelpModal: false,
      isRefreshing: false,      // Trigger for click confirmation spin

      isHoldingRefresh: false,
      refreshHoldTimer: null,
      showBatchInput: false,
      batchCount: null,

      // Hold controllers initialized in created()
      seedPrevCtrl: null,
      seedNextCtrl: null,
      stepPrevCtrl: null,
      stepNextCtrl: null,

      // New slider hold controllers
      targetKPrevCtrl: null,
      targetKNextCtrl: null,
      sourceStepPrevCtrl: null,
      sourceStepNextCtrl: null,
      freeMPrevCtrl: null,
      freeMNextCtrl: null,

      jsonError: null,

      reduceRafId: null,
      // Unified Tree SVG Viewport Camera (288 x 136 world space)
      treeCamAnimId: null,
      isPanningTree: false,
      treePanStart: { clientX: 0, clientY: 0, camX: 0, camY: 0 },
      treePanMoved: false,

      heldTreeArrow: null, // 'left' | 'right' | null
      treeChordUsed: false,

      showDpDebugPopup: true,
      dpDebugCopied: false,

      dpSolvePreset: 'exact', // 'exact' | 'exact-1k' | 'exact-greedy' | '1024' | '4096' | '16384'
      compactSections: {
        reduce: false,
        solve: false,
      },

      dpSandboxResult: null,
      dpSandboxRunning: false,
      dpLiveProgress: null,
      dpWorker: null,
      dpRunId: 0,

      solveSections: {
        solution: true,
        tree: true,
        bagInfo: true,
      },
    };
  },
  watch: {
    activeTreeNode(node) {
      if (this.dpSandboxRunning) {
        this.haltDpSandbox();
      }
      if (!node) return;
      if (this.treeZoomLevel <= 1.02) return;
      this.ensureTreeNodeInSafeZone(node, 0.18);
    },

    'graphStore.reduceStepIndex'() {
      this.haltDpSandbox();
      this.dpSandboxResult = null;
    },

    'graphStore.reducedGraph'() {
      this.haltDpSandbox();
      this.dpSandboxResult = null;
    },


    'graphStore.tdViewMode'() {
      this.$nextTick(() => {
        if (this.activeTreeNode && this.treeZoomLevel > 1.02) {
          this.ensureTreeNodeInSafeZone(this.activeTreeNode, 0.25);
        }
      });
    },
    'gameStore.allPzProfit': {
      immediate: true,
      handler(profit) {
        if (
          (this.graphStore.activeTab === 'reduce' || this.graphStore.activeTab === 'solve') &&
          profit &&
          Object.keys(profit).length > 0
        ) {
          this.graphStore.preprocessGraph();
        }
      },
    },
    'graphStore.activeTab': {
      immediate: true,
      handler(tab) {
        if ((tab === 'reduce' || tab === 'solve') && this.gameStore.ready) {
          this.graphStore.preprocessGraph();
          if (tab === 'solve') {
            this.graphStore.syncSolveDecomposition();
          }
        }
      },
    },
    'userStore.plantzoneIconSize'(newVal) {
      if (Number(newVal) === 0 && (this.graphStore.reduceStepIndex ?? 0) < 1) {
        this.graphStore.setReduceStep(1);
        this.$nextTick(() => {
          if (this.$refs.reduceSlider) {
            this.$refs.reduceSlider.value = String(this.activeStepIndex);
          }
        });
      }
    },
    'gameStore.ready': {
      immediate: true,
      handler(ready) {
        if (ready && this.graphStore.activeTab === 'reduce') {
          this.graphStore.preprocessGraph();
        }
      },
    },
    'graphStore.currentInstance'() {
      if ((this.graphStore.effectiveMapMode === 'reduce' || this.graphStore.effectiveMapMode === 'solve') && this.gameStore.ready) {
        this.graphStore.preprocessGraph();
        this.updateStep(Math.min(this.activeStepIndex, this.maxStepIndex));
      }
    },
    'gameStore.links': {
      immediate: true,
      handler(links) {
        if (this.graphStore.activeTab === 'reduce' && links && Object.keys(links).length > 0) {
          this.graphStore.preprocessGraph();
        }
      },
    },
  },
  computed: {
    solutionBagId() {
      return (
        this.graphStore.dpSolution?.bagId ??
        this.dpSandboxResult?.bagMergeStats?.origBagId ??
        null
      );
    },

    displayedSolutionVertexCount() {
      if (this.graphStore.isOriginalSolutionView) {
        return this.graphStore.dpSelectedVertexSet.size;
      }
      return this.graphStore.dpSolution?.selectedVertices?.length ?? 0;
    },

    townGroupStats() {
      const inst = this.graphStore.currentInstance;
      const assignments = inst?.assignments;
      const townToTargets = new Map();
      let assignmentCount = 0;

      if (Array.isArray(assignments)) {
        for (const item of assignments) {
          const targetId = item?.targetId;
          const sources = Array.isArray(item?.sourceId)
            ? item.sourceId
            : item?.sourceId != null
              ? [item.sourceId]
              : [];
          for (const townId of sources) {
            if (townId == null) continue;
            const tKey = Number(townId);
            if (!townToTargets.has(tKey)) townToTargets.set(tKey, new Set());
            if (targetId != null) townToTargets.get(tKey).add(Number(targetId));
            assignmentCount++;
          }
        }
      } else if (assignments && typeof assignments === 'object') {
        for (const [targetId, towns] of Object.entries(assignments)) {
          if (!Array.isArray(towns)) continue;
          for (const townId of towns) {
            if (townId == null) continue;
            const tKey = Number(townId);
            if (!townToTargets.has(tKey)) townToTargets.set(tKey, new Set());
            townToTargets.get(tKey).add(Number(targetId));
            assignmentCount++;
          }
        }
      }

      return {
        groupCount: townToTargets.size,
        assignmentCount,
        targetCount: Array.isArray(inst?.targets) ? inst.targets.length : 0,
      };
    },

    activeParentTransition() {
      const td = this.graphStore.activeDecomposition;
      const node = this.activeTreeNode;
      if (!td || !node || node.parent == null) return null;
      return td.nodes[node.parent]?.transitions?.[node.id] ?? null;
    },

    treeCam: {
      get() {
        return this.graphStore.treeCam;
      },
      set(val) {
        this.graphStore.treeCam = val;
      },
    },

    // In computed:
    treeZoomLevel() {
      return TREE_WORLD_W / Math.max(1, this.treeCam.w);
    },
    treeViewBox() {
      return `${this.treeCam.x.toFixed(2)} ${this.treeCam.y.toFixed(2)} ${this.treeCam.w.toFixed(2)} ${this.treeCam.h.toFixed(2)}`;
    },
    fullTreeSvgData() {
      const td = this.graphStore.activeDecomposition;
      const active = this.activeTreeNode;
      if (!td || !td.nodes?.length || !active) return { edges: [], nodes: [], invZ: 1 };
      // ... rest unchanged, using `n.origBagId ?? n.id` for displayLabel ...

      const padX = 12;
      const padY = 12;
      const w = TREE_WORLD_W - padX * 2;
      const h = TREE_WORLD_H - padY * 2;
      const maxSz = Math.max(1, td.stats?.maxBagSize ?? 1);
      const minSz = td.nodes.reduce((m, n) => Math.min(m, n.bag.length), maxSz);
      const szSpan = Math.max(1, maxSz - minSz);
      const z = this.treeZoomLevel;
      const invZ = 1 / Math.pow(z, 0.72);

      const ancestorSet = new Set();
      let curr = active;
      while (curr) {
        ancestorSet.add(curr.id);
        curr = curr.parent != null ? td.nodes[curr.parent] : null;
      }

      const childSet = new Set(active.children || []);
      const edges = [];

      const nodes = td.nodes.map((n) => {
        const cx = padX + (n.x ?? 0.5) * w;
        const cy = padY + (n.y ?? 0) * h;
        const isActive = n.id === active.id;
        const isParent = n.id === active.parent;
        const isChild = childSet.has(n.id);
        const isAncestor = ancestorSet.has(n.id);

        // Uniform green (142deg) -> yellow (52deg) -> crimson-red (354deg / -6deg)
        const t = maxSz === minSz ? 0.5 : (n.bag.length - minSz) / szSpan;
        const hue = (142 - t * 148 + 360) % 360;
        const heatColor = `hsl(${hue.toFixed(0)}, 85%, 56%)`;

        if (n.parent != null) {
          const p = td.nodes[n.parent];
          edges.push({
            id: `${p.id}-${n.id}`,
            x1: padX + (p.x ?? 0.5) * w,
            y1: padY + (p.y ?? 0) * h,
            x2: cx,
            y2: cy,
            isPath: isAncestor && ancestorSet.has(p.id),
            isAdj: isActive || isChild,
          });
        }

        const baseR = 1.7 + (n.bag.length / maxSz) * 1.6;
        const rawR = isActive ? 4.8 : (isParent || isChild ? 3.5 : baseR);

        return {
          id: n.id,
          displayId: n.origBagId ?? n.id,
          cx,
          cy,
          r: rawR * invZ,
          bagLen: n.bag.length,
          depth: n.depth,
          heatColor,
          isActive,
          isParent,
          isChild,
          isAncestor,
        };
      });

      return { edges, nodes, invZ };
    },
    
    tdStats() {
      return this.graphStore.activeDecomposition?.stats ?? {};
    },
    activeTreeNode() {
      return this.graphStore.activeTreeNode;
    },
    activeSiblingInfo() {
      const td = this.graphStore.activeDecomposition;
      const node = this.activeTreeNode;
      if (!td || !node || node.parent == null) {
        return { siblings: [], index: -1 };
      }
      const siblings = td.nodes[node.parent]?.children ?? [];
      return { siblings, index: siblings.indexOf(node.id) };
    },
    canMovePrevSibling() {
      return this.activeSiblingInfo.index > 0;
    },
    canMoveNextSibling() {
      const { siblings, index } = this.activeSiblingInfo;
      return index >= 0 && index < siblings.length - 1;
    },

    localSeed: {
      get() {
        return this.graphStore.draftSeed;
      },
      set(val) {
        this.graphStore.setDraftSeed(val);
      }
    },
    // If you access isSeedActive or other store props in template:
    graphStore() {
      return useGraphStore();
    },
    userStore() {
      return useUserStore();
    },
    totalPlantzonesCount() {
      return this.graphStore?.plantzoneSet.size || 'N/A';
    },
    targetProgress() {
      const max = Math.max(1, this.totalPlantzonesCount);
      const val = Math.max(0, Math.min(this.totalPlantzonesCount, this.graphStore.liveTopKPzCount));
      return val / max;
    },
    sourceProgress() {
      const val = Math.max(1, Math.min(30, this.graphStore.liveSourceScaleStep));
      return (val - 1) / 29;
    },
    totalFreeTargetsCount() {
      return this.graphStore?.freeTargetPool?.length || 0;
    },
    freeTargetProgress() {
      const max = Math.max(1, this.totalFreeTargetsCount);
      const val = Math.max(0, Math.min(this.totalFreeTargetsCount, this.graphStore.liveFreeTargetCount));
      return val / max;
    },
    pzControlLabel() {
      if (this.graphStore.pzMode === 'prob') return 'Random Plantzones';
      if (this.graphStore.pzMode === 'topk') return 'Top Profit Plantzones';
      return 'Plantzone Selection';
    },
    sourceControlLabel() {
      if (this.graphStore.sourceMode === 'closest') return 'Closest Town';
      if (this.graphStore.sourceMode === 'rings') return 'Stable Town';
      return 'Source Town Selection';
    },
    efficiencyStyle() {
      const pct = Math.max(0, Math.min(100, this.graphStore.instanceStats?.efficiencyPct ?? 0));

      // Easy-to-tune [percentage, hue] stops (sorted ascending by pct):
      // 158 = neon mint-emerald | 52 = sharp yellow | 356 (-4) = clear neon rose-red
      const stops = [
        [0,   -10], // 350deg: deep rose-red
        [70,   -4], // 356deg: clear rose-red by 70%
        [80,   52], //  52deg: sharp distinct yellow at 80%
        [100, 158], // 158deg: neon mint-emerald at 100%
      ];

      // Find the active segment and linearly interpolate hue
      let hue = stops[0][1];
      for (let i = 0; i < stops.length - 1; i++) {
        const [p0, h0] = stops[i];
        const [p1, h1] = stops[i + 1];
        if (pct >= p0 && pct <= p1) {
          const t = (pct - p0) / (p1 - p0);
          hue = h0 + t * (h1 - h0);
          break;
        }
      }

      const normalizedHue = (hue + 360) % 360;
      return {
        color: `hsl(${normalizedHue.toFixed(0)}, 92%, 65%)`,
        textShadow: `0 0 10px hsla(${normalizedHue.toFixed(0)}, 92%, 60%, 0.35)`,
      };
    },

    activeReduceStep() {
      return (
        this.graphStore.reducedGraph?.[this.activeStepIndex] ?? {
          opType: 'INIT',
          opDesc: 'No reduction steps logged yet',
          meta: {
            numNodes: 0,
            numEdges: 0,
            numTargets: 0,
            termDeg: { d2: 0, d3: 0, d4: 0, d5Plus: 0 },
            nonTermDeg: { d2: 0, d3: 0, d4: 0, d5Plus: 0 },
            diameter: 0,
            treewidth: null,
          },
        }
      );
    },
    activeReduceMeta() {
      return this.activeReduceStep.meta;
    },

    minStepIndex() {
      const len = this.graphStore.reducedGraph?.length ?? 0;
      return this.userStore.plantzoneIconSize === 0 && len > 1 ? 1 : 0;
    },
    maxStepIndex() {
      return Math.max(this.minStepIndex, (this.graphStore.reducedGraph?.length ?? 1) - 1);
    },
    activeStepIndex() {
      return Math.max(
        this.minStepIndex,
        Math.min(this.maxStepIndex, this.graphStore.reduceStepIndex ?? this.minStepIndex)
      );
    },
    reduceProgress() {
      const span = this.maxStepIndex - this.minStepIndex;
      return span > 0 ? (this.activeStepIndex - this.minStepIndex) / span : 0;
    },
  },
  methods: {
    formatStageMs(ms) {
      const n = Number(ms);
      if (!Number.isFinite(n)) return '';
      if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
      return `${Math.round(n)}ms`;
    },

    parseSolvePreset() {
      if (this.dpSolvePreset === 'exact') {
        return { maxStates: Infinity, ladderMode: 'full' };
      }
      if (this.dpSolvePreset === 'exact-1k') {
        return { maxStates: Infinity, ladderMode: '1k' };
      }
      if (this.dpSolvePreset === 'exact-greedy') {
        return { maxStates: Infinity, ladderMode: 'greedy' };
      }
      return { maxStates: Number(this.dpSolvePreset) || 1024, ladderMode: 'full' };
    },

    toggleCompactSection(key) {
      this.compactSections[key] = !this.compactSections[key];
      if (key === 'reduce') {
        if (this.compactSections.reduce) {
          this.ensureCompactReduceMode();
        } else if (this.graphStore.instanceMapMode === 'reduce') {
          this.graphStore.setInstanceMapMode('instance');
        }
      } else if (key === 'solve' && !this.compactSections.solve) {
        if (this.graphStore.instanceMapMode === 'solve') {
          this.graphStore.setInstanceMapMode('instance');
        }
      }
    },

    ensureCompactReduceMode() {
      if (this.gameStore.ready) {
        this.graphStore.preprocessGraph();
      }
      this.graphStore.setInstanceMapMode('reduce');
    },

    onCompactReduceSliderInput(val) {
      this.ensureCompactReduceMode();
      this.onReduceSliderInput(val);
    },

    onCompactReduceStep(val) {
      this.ensureCompactReduceMode();
      this.updateStep(val);
    },

    runCompactDpSolve() {
      if (!this.gameStore.ready) return;
      this.graphStore.setInstanceMapMode('solve');
      this.graphStore.preprocessGraph();
      // Ensure we solve on the final reduced step's root bag if no intermediate step was chosen
      if (!this.graphStore.treeDecomposition) {
        this.graphStore.setReduceStep(this.maxStepIndex);
      }
      this.graphStore.syncSolveDecomposition();
      const rootId = this.graphStore.contractedTreeDecomposition?.rootId ?? 0;
      this.runDpSandboxForActiveNode(rootId);
    },

    toggleSolveSection(key) {
      this.solveSections[key] = !this.solveSections[key];
    },

    jumpToBottleneckBag(bn) {
      const td = this.graphStore.activeDecomposition;
      if (!td || !td.nodes?.length) return;
      const target =
        this.graphStore.tdViewMode === 'join'
          ? td.nodes[bn.nodeId]
          : td.nodes.find((n) => (n.origBagId ?? n.id) === bn.bagId);
      if (target) {
        this.selectTreeNode(target, { hideSolution: true, openBagInfo: true, openTree: true });
        if (this.treeZoomLevel > 1.02) {
          this.ensureTreeNodeInSafeZone(target, 0.2);
        }
      }
    },

    async copyDpDebugJson() {
      const payload = this.dpSandboxResult?.collapseDebug;
      if (!payload) return;
      try {
        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
        this.dpDebugCopied = true;
        setTimeout(() => {
          this.dpDebugCopied = false;
        }, 1500);
      } catch {
        // Fallback if clipboard permission is restricted
      }
    },

    haltDpSandbox() {
      this.dpRunId++;
      if (this.dpWorker) {
        this.dpWorker.terminate();
        this.dpWorker = null;
      }
      this.dpSandboxRunning = false;
      this.dpLiveProgress = null;
    },

    runDpSandboxForActiveNode(overrideTargetNodeId = null) {
      this.showDpDebugPopup = true;
      this.solveSections.solution = true;
      const contracted = this.graphStore.contractedTreeDecomposition;
      const full = this.graphStore.treeDecomposition;
      const snap = this.graphStore.activeReduceSnapshot;
      const node = this.activeTreeNode;
      if (!contracted || !snap || (overrideTargetNodeId == null && !node)) return;

      // Terminate any in-flight worker before starting a new run
      this.haltDpSandbox();

      const { maxStates, ladderMode } = this.parseSolvePreset();
      const runId = ++this.dpRunId;

      const targetId =
        overrideTargetNodeId != null
          ? overrideTargetNodeId
          : this.graphStore.tdViewMode === 'join'
            ? node.id
            : contracted.nodes.find((n) => n.origBagId === node.id)?.id ?? 0;

      const targetOrigBagId =
        contracted.nodes[targetId]?.origBagId ?? node?.origBagId ?? node?.id ?? 0;

      this.dpSandboxRunning = true;
      this.dpLiveProgress = {
        stage: ladderMode === 'greedy' ? 'GREEDY' : (Number.isFinite(maxStates) ? 'BEAM' : 'HEUR 1K'),
        depth: '—',
        levelIndex: 0,
        totalLevels: 1,
        bagsProcessed: 0,
        totalBags: 1,
        currentBagId: targetOrigBagId,
        currentBagStates: 0,
        peakBagStates: 0,
        boundPrunedStates: 0,
        upperBoundCost: null,
        elapsedMs: 0,
      };

      const worker = new SteinerDpWorker();
      this.dpWorker = worker;

      worker.onmessage = (e) => {
        const msg = e.data;
        if (!msg || msg.runId !== this.dpRunId) return;

        if (msg.type === 'progress') {
          this.dpLiveProgress = msg.progress;
        } else if (msg.type === 'interim') {
          this.graphStore.setDpSolution(msg.interim);
        } else if (msg.type === 'done') {
          const res = msg.result;
          this.dpSandboxResult = res;
          if (res?.allSolutions?.length > 0) {
            this.graphStore.setDpSolutions(res.allSolutions);
          } else if (res?.selectedVertices?.length > 0) {
            this.graphStore.setDpSolution({
              selectedVertices: res.selectedVertices,
              minCost: res.bagMergeStats.minCost,
              isExact: res.isExact,
              bagId: res.bagMergeStats.origBagId,
              heuristicBound: res.heuristicAdvice?.upperBoundCost ?? null,
            });
          } else {
            this.graphStore.clearDpSolution();
          }
          this.haltDpSandbox();
        } else if (msg.type === 'error') {
          console.error('DP Worker error:', msg.error);
          this.haltDpSandbox();
        }
      };

      worker.onerror = (err) => {
        console.error('DP Worker crash:', err);
        this.haltDpSandbox();
      };

      worker.postMessage({
        runId,
        contractedTd: JSON.parse(JSON.stringify(contracted)),
        fullTd: full ? JSON.parse(JSON.stringify(full)) : null,
        snap: JSON.parse(JSON.stringify(snap)),
        targetNodeId: targetId,
        options: { maxStates, useHeuristicAdvice: true, ladderMode },
      });
    },

    formatTownGroupsTooltip(label, groups) {
      if (!groups || groups.length === 0) return `${label}: None`;
      const lines = groups.map((g) => {
        const townName = this.gameStore.uloc?.node?.[g.town] || `Town ${g.town}`;
        return `• #${g.town} ${townName} (${g.targets.length} target${g.targets.length > 1 ? 's' : ''}: [${g.targets.join(', ')}])`;
      });
      return `${label} (${groups.length}):\n${lines.join('\n')}`;
    },

    resetPanelPos() {
      this.panelPos = { x: 0, y: 0 };
    },

    startDrag(e) {
      if (e.button !== 0) return;
      if (e.target.closest('button, .sq-icon-btn, input, select, textarea, svg, [data-no-drag]')) {
        return;
      }

      this.isDragging = true;
      this.dragStart = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        posX: this.panelPos.x,
        posY: this.panelPos.y,
      };

      window.addEventListener('mousemove', this.onDrag);
      window.addEventListener('mouseup', this.stopDrag);
    },

    onDrag(e) {
      if (!this.isDragging) return;
      const rawX = this.dragStart.posX + (e.clientX - this.dragStart.mouseX);
      const rawY = this.dragStart.posY + (e.clientY - this.dragStart.mouseY);

      // Keep top edge at least 8px below top of viewport (default top is 52px, so minY = -44)
      this.panelPos = {
        x: rawX,
        y: Math.max(-44, rawY),
      };
    },

    stopDrag() {
      this.isDragging = false;
      window.removeEventListener('mousemove', this.onDrag);
      window.removeEventListener('mouseup', this.stopDrag);
    },

    clampPanelPos(x, y) {
      const panelEl = this.$el;
      const panelW = panelEl?.offsetWidth || 320;
      const panelH = panelEl?.offsetHeight || 200;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Default anchor is top: 52px, right: 16px
      const baseLeft = vw - 16 - panelW;
      const baseTop = 52;

      const minX = 8 - baseLeft;
      const maxX = vw - 8 - panelW - baseLeft;
      const minY = 8 - baseTop;
      const maxY = Math.max(minY, vh - 44 - baseTop);

      return {
        x: Math.max(minX, Math.min(maxX, x)),
        y: Math.max(minY, Math.min(maxY, y)),
      };
    },

    onWindowResize() {
      this.panelPos = this.clampPanelPos(this.panelPos.x, this.panelPos.y);
    },

    resetHeldTreeArrow() {
      this.heldTreeArrow = null;
      this.treeChordUsed = false;
    },

    handleTreeDownAction() {
      if (this.heldTreeArrow === 'left') {
        this.treeChordUsed = true;
        this.moveTreeLeftmostChild();
      } else if (this.heldTreeArrow === 'right') {
        this.treeChordUsed = true;
        this.moveTreeRightmostChild();
      } else {
        this.moveTreeDefaultChild();
      }
    },

    cancelTreeCamAnim() {
      if (this.treeCamAnimId) {
        cancelAnimationFrame(this.treeCamAnimId);
        this.treeCamAnimId = null;
      }
    },

    animateTreeCamTo(targetCam, durationMs = 160) {
      this.cancelTreeCamAnim();

      const startCam = { ...this.treeCam };
      const startTime = performance.now();

      const step = (now) => {
        const rawT = Math.min(1, (now - startTime) / durationMs);
        const t = 1 - Math.pow(1 - rawT, 3); // Ease-out cubic

        this.treeCam = {
          x: startCam.x + (targetCam.x - startCam.x) * t,
          y: startCam.y + (targetCam.y - startCam.y) * t,
          w: startCam.w + (targetCam.w - startCam.w) * t,
          h: startCam.h + (targetCam.h - startCam.h) * t,
        };

        if (rawT < 1) {
          this.treeCamAnimId = requestAnimationFrame(step);
        } else {
          this.treeCamAnimId = null;
        }
      };

      this.treeCamAnimId = requestAnimationFrame(step);
    },

    ensureTreeNodeInSafeZone(node, marginRatio = 0.18) {
      const padX = 12;
      const padY = 12;
      const cx = padX + (node.x ?? 0.5) * (TREE_WORLD_W - padX * 2);
      const cy = padY + (node.y ?? 0) * (TREE_WORLD_H - padY * 2);

      const { x, y, w, h } = this.treeCam;
      const marginX = w * marginRatio;
      const marginY = h * marginRatio;

      if (
        cx < x + marginX ||
        cx > x + w - marginX ||
        cy < y + marginY ||
        cy > y + h - marginY
      ) {
        const maxX = Math.max(0, TREE_WORLD_W - w);
        const maxY = Math.max(0, TREE_WORLD_H - h);

        this.animateTreeCamTo({
          x: Math.max(0, Math.min(maxX, cx - w / 2)),
          y: Math.max(0, Math.min(maxY, cy - h / 2)),
          w,
          h,
        });
      }
    },

    onTreeWheel(e) {
      this.cancelTreeCamAnim();
      const svg = this.$refs.treeSvg;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const rx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ry = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      const worldX = this.treeCam.x + rx * this.treeCam.w;
      const worldY = this.treeCam.y + ry * this.treeCam.h;

      const zoomFactor = e.deltaY < 0 ? 0.8 : 1.25;
      const nextW = Math.max(24, Math.min(TREE_WORLD_W, this.treeCam.w * zoomFactor));
      const nextH = (nextW / TREE_WORLD_W) * TREE_WORLD_H;

      const maxX = Math.max(0, TREE_WORLD_W - nextW);
      const maxY = Math.max(0, TREE_WORLD_H - nextH);
      const nextX = Math.max(0, Math.min(maxX, worldX - rx * nextW));
      const nextY = Math.max(0, Math.min(maxY, worldY - ry * nextH));

      this.treeCam = { x: nextX, y: nextY, w: nextW, h: nextH };
    },

    startTreePan(e) {
      if (e.button !== 0) return;
      this.cancelTreeCamAnim();
      this.isPanningTree = true;
      this.treePanMoved = false;
      this.treePanStart = {
        clientX: e.clientX,
        clientY: e.clientY,
        camX: this.treeCam.x,
        camY: this.treeCam.y,
      };
      window.addEventListener('pointermove', this.onTreePan);
      window.addEventListener('pointerup', this.stopTreePan);
    },

    onTreePan(e) {
      if (!this.isPanningTree) return;
      const svg = this.$refs.treeSvg;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dxPx = e.clientX - this.treePanStart.clientX;
      const dyPx = e.clientY - this.treePanStart.clientY;
      if (Math.abs(dxPx) > 2 || Math.abs(dyPx) > 2) {
        this.treePanMoved = true;
      }

      const dxWorld = (dxPx / rect.width) * this.treeCam.w;
      const dyWorld = (dyPx / rect.height) * this.treeCam.h;
      const maxX = Math.max(0, TREE_WORLD_W - this.treeCam.w);
      const maxY = Math.max(0, TREE_WORLD_H - this.treeCam.h);

      this.treeCam = {
        ...this.treeCam,
        x: Math.max(0, Math.min(maxX, this.treePanStart.camX - dxWorld)),
        y: Math.max(0, Math.min(maxY, this.treePanStart.camY - dyWorld)),
      };
    },

    stopTreePan() {
      this.isPanningTree = false;
      window.removeEventListener('pointermove', this.onTreePan);
      window.removeEventListener('pointerup', this.stopTreePan);
    },

    selectTreeNode(node, { hideSolution = true, openBagInfo = true, openTree = true } = {}) {
      if (!node) return;
      this.graphStore.activeBagId = node.id;
      if (hideSolution) {
        this.graphStore.setSolutionViewMode('td');
        this.solveSections.solution = false;
      }
      if (openBagInfo) {
        this.solveSections.bagInfo = true;
      }
      if (openTree) {
        this.solveSections.tree = true;
      }
    },

    onTreeNodeClick(nodeId) {
      if (this.treePanMoved) return;
      const td = this.graphStore.activeDecomposition;
      this.selectTreeNode(td?.nodes?.[nodeId]);
    },

    focusActiveTreeNode(zoom = 3.5) {
      const active = this.activeTreeNode;
      if (!active) return;
      const padX = 12;
      const padY = 12;
      const cx = padX + (active.x ?? 0.5) * (TREE_WORLD_W - padX * 2);
      const cy = padY + (active.y ?? 0) * (TREE_WORLD_H - padY * 2);

      const nextW = TREE_WORLD_W / zoom;
      const nextH = TREE_WORLD_H / zoom;
      const maxX = Math.max(0, TREE_WORLD_W - nextW);
      const maxY = Math.max(0, TREE_WORLD_H - nextH);

      this.treeCam = {
        x: Math.max(0, Math.min(maxX, cx - nextW / 2)),
        y: Math.max(0, Math.min(maxY, cy - nextH / 2)),
        w: nextW,
        h: nextH,
      };
    },

    resetTreeCam() {
      this.treeCam = { x: 0, y: 0, w: TREE_WORLD_W, h: TREE_WORLD_H };
    },

    moveTreeParent() {
      const td = this.graphStore.activeDecomposition;
      const pIdx = this.activeTreeNode?.parent;
      if (pIdx != null) this.selectTreeNode(td?.nodes?.[pIdx]);
    },
    moveTreeLeftmostChild() {
      const td = this.graphStore.activeDecomposition;
      const children = this.activeTreeNode?.children ?? [];
      if (children.length > 0) this.selectTreeNode(td?.nodes?.[children[0]]);
    },
    moveTreeRightmostChild() {
      const td = this.graphStore.activeDecomposition;
      const children = this.activeTreeNode?.children ?? [];
      if (children.length > 0) this.selectTreeNode(td?.nodes?.[children[children.length - 1]]);
    },
    moveTreeDefaultChild() {
      const td = this.graphStore.activeDecomposition;
      const children = this.activeTreeNode?.children ?? [];
      if (children.length === 0) return;
      const idx = children.length >= 2 ? 1 : 0;
      this.selectTreeNode(td?.nodes?.[children[idx]]);
    },
    moveTreePrevSibling() {
      const td = this.graphStore.activeDecomposition;
      const { siblings, index } = this.activeSiblingInfo;
      if (index > 0) this.selectTreeNode(td?.nodes?.[siblings[index - 1]]);
    },
    moveTreeNextSibling() {
      const td = this.graphStore.activeDecomposition;
      const { siblings, index } = this.activeSiblingInfo;
      if (index >= 0 && index < siblings.length - 1) {
        this.selectTreeNode(td?.nodes?.[siblings[index + 1]]);
      }
    },
    separatorRoleLabel(role) {
      if (role === 'shared-both') return 'Separator: Shared with Parent & Child';
      if (role === 'parent-sep') return 'Separator: Shared with Parent';
      if (role === 'child-sep') return 'Separator: Shared with Child (Forgotten here)';
      return 'Local to this bag';
    },

    focusReduceSlider() {
      this.$nextTick(() => {
        this.$refs.reduceSlider?.focus({ preventScroll: true });
      });
    },

    // Inside methods:
    onWindowKeyDown(e) {
      if (this.graphStore.activeTab === 'solve') {
        if (!this.graphStore.activeDecomposition) return;
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        e.stopImmediatePropagation();

        if (e.key === 'ArrowLeft') {
          if (!e.repeat) {
            this.heldTreeArrow = 'left';
            this.treeChordUsed = false;
          }
          return;
        }
        if (e.key === 'ArrowRight') {
          if (!e.repeat) {
            this.heldTreeArrow = 'right';
            this.treeChordUsed = false;
          }
          return;
        }
        if (e.key === 'ArrowUp') {
          this.moveTreeParent();
          return;
        }
        if (e.key === 'ArrowDown') {
          this.handleTreeDownAction();
          return;
        }
      }

      if (this.graphStore.activeTab !== 'reduce') return;

      const isLeft =
        e.key === 'ArrowLeft' || e.code === 'ArrowLeft' || e.code === 'Numpad4';
      const isRight =
        e.key === 'ArrowRight' || e.code === 'ArrowRight' || e.code === 'Numpad6';
      if (!isLeft && !isRight) return;

      const tag = e.target?.tagName;
      const type = e.target?.type;
      if (tag === 'TEXTAREA' || (tag === 'INPUT' && type !== 'range')) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      if (e.repeat) return;

      if (e.shiftKey) {
        if (isLeft) this.jumpPrevStageRun();
        else this.jumpNextStageRun();
        return;
      }

      if (isLeft) {
        this.stepPrevCtrl?.start();
      } else {
        this.stepNextCtrl?.start();
      }
    },

    onWindowKeyUp(e) {
      if (this.graphStore.activeTab === 'solve') {
        if (e.key === 'ArrowLeft' && this.heldTreeArrow === 'left') {
          const wasChord = this.treeChordUsed;
          this.heldTreeArrow = null;
          this.treeChordUsed = false;
          if (!wasChord) this.moveTreePrevSibling();
          return;
        }
        if (e.key === 'ArrowRight' && this.heldTreeArrow === 'right') {
          const wasChord = this.treeChordUsed;
          this.heldTreeArrow = null;
          this.treeChordUsed = false;
          if (!wasChord) this.moveTreeNextSibling();
          return;
        }
      }

      if (e.key === 'ArrowLeft') {
        this.stepPrevCtrl?.stop();
      } else if (e.key === 'ArrowRight') {
        this.stepNextCtrl?.stop();
      }
    },

    onReduceSliderInput(val) {
      if (this.reduceRafId) cancelAnimationFrame(this.reduceRafId);
      this.reduceRafId = requestAnimationFrame(() => {
        this.reduceRafId = null;
        this.updateStep(val);
      });
    },

    updateStep(val) {
      this.graphStore.setReduceStep(val);
      this.$emit('update:stepIndex', this.graphStore.reduceStepIndex);
    },
    adjustTargetK(delta) {
      const next = Math.max(0, Math.min(this.totalPlantzonesCount, this.graphStore.topKPzCount + delta));
      this.graphStore.topKPzCount = next;
    },
    adjustSourceStep(delta) {
      const next = Math.max(1, Math.min(30, this.graphStore.sourceScaleStep + delta));
      this.graphStore.sourceScaleStep = next;
    },

    onRerollClick() {
      if (this.isRefreshing) return;
      this.isRefreshing = true;
      this.graphStore.rerollSeed();

      setTimeout(() => {
        this.isRefreshing = false;
      }, 400);
    },

    onCommitSeed() {
      this.graphStore.commitDraftSeed();
    },
    onToggleCheck() {
      if (!this.graphStore.isSeedActive) {
        // Switch back to procedural seed mode
        this.graphStore.commitDraftSeed();
      } else if (this.graphStore.uploadedInstance) {
        // Fall back to untouched uploaded JSON if available
        this.graphStore.setInstanceSource('uploaded');
      } else if (this.graphStore.customInstance) {
        // Or fall back to custom sandbox instance
        this.graphStore.setInstanceSource('custom');
      }
    },
    
    triggerJsonUpload() {
      this.jsonError = null;
      if (this.$refs.jsonFileInput) {
        this.$refs.jsonFileInput.value = '';
        this.$refs.jsonFileInput.click();
      }
    },

    async onJsonFileSelected(event) {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        this.graphStore.loadInstanceFromJson(parsed, file.name);
        this.jsonError = null;
      } catch (err) {
        this.jsonError = err.message || 'Failed to parse JSON file.';
      }
    },

    // --- Long-press Refresh Button (1s threshold for batch input) ---
    onRefreshPressStart(e) {
      if (e.button !== 0) return;
      this.isHoldingRefresh = true;

      this.refreshHoldTimer = setTimeout(() => {
        this.isHoldingRefresh = false;
        this.refreshHoldTimer = null;
        this.showBatchInput = true;
        this.$nextTick(() => {
          this.$refs.batchInputRef?.focus();
          this.$refs.batchInputRef?.select();
        });
      }, 500); // half a second hold triggers batch input
    },

    onRefreshPressEnd() {
      // If released before 1s elapsed, treat as a normal single reroll click
      if (this.refreshHoldTimer) {
        clearTimeout(this.refreshHoldTimer);
        this.refreshHoldTimer = null;
        this.isHoldingRefresh = false;
        this.onRerollClick();
      }
    },

    onRefreshPressCancel() {
      clearTimeout(this.refreshHoldTimer);
      this.refreshHoldTimer = null;
      this.isHoldingRefresh = false;
    },

    onBatchInput(e) {
      const raw = e.target.value;

      // Allow clearing the input completely so placeholder="50" shows
      if (raw === '') {
        this.batchCount = null;
        return;
      }

      // Strip non-digit characters (prevents typing '-', '+', 'e', '.')
      const digitsOnly = raw.replace(/\D/g, '');
      if (digitsOnly === '') {
        this.batchCount = null;
        e.target.value = '';
        return;
      }

      let num = parseInt(digitsOnly, 10);

      // Immediately cap at 1,000 while typing
      if (num > 1000) {
        num = 1000;
      }

      this.batchCount = num;
      // Force the DOM input value to match the clamped number immediately
      e.target.value = String(num);
    },

    onBatchBlur() {
      // If the user typed '0' and clicked away, bump it up to minimum 1
      if (this.batchCount !== null && this.batchCount < 1) {
        this.batchCount = 1;
      }
    },

    submitBatchSeeds() {
      // Use 50 if the user left it blank (showing placeholder), otherwise clamp [1, 1000]
      const finalCount = this.batchCount === null 
        ? 50 
        : Math.max(1, Math.min(1000, this.batchCount));

      this.graphStore.generateBatchSeeds(finalCount);
      this.showBatchInput = false;
      this.batchCount = null; // Reset back to placeholder state for next open
    },

    jumpNextStageRun() {
      const steps = this.graphStore.reducedGraph;
      const maxIdx = Math.max(0, (steps?.length ?? 1) - 1);
      let idx = Math.max(0, Math.min(maxIdx, this.graphStore.reduceStepIndex ?? 0));
      if (!steps || idx >= maxIdx) return;

      const currType = steps[idx]?.opType;
      if (steps[idx + 1]?.opType !== currType) {
        idx += 1;
      }

      const targetType = steps[idx]?.opType;
      while (idx < maxIdx && steps[idx + 1]?.opType === targetType) {
        idx += 1;
      }
      this.graphStore.setReduceStep(idx);
    },

    jumpPrevStageRun() {
      const steps = this.graphStore.reducedGraph;
      const maxIdx = Math.max(0, (steps?.length ?? 1) - 1);
      let idx = Math.max(0, Math.min(maxIdx, this.graphStore.reduceStepIndex ?? 0));
      if (!steps || idx <= 0) return;

      const currType = steps[idx]?.opType;
      if (steps[idx - 1]?.opType !== currType) {
        idx -= 1;
      }

      const targetType = steps[idx]?.opType;
      while (idx > 0 && steps[idx - 1]?.opType === targetType) {
        idx -= 1;
      }
      this.graphStore.setReduceStep(idx);
    },
  },

  created() {
    // 1. Seed controllers: accelerate = true (1 -> 10 after 5s -> 100 after 10s)
    this.seedPrevCtrl = createHoldController({
      direction: -1,
      accelerate: true,
      intervalMs: 500,
      onStep: (delta) => this.graphStore.jumpSeed(delta)
    });

    this.seedNextCtrl = createHoldController({
      direction: 1,
      accelerate: true,
      intervalMs: 500,
      onStep: (delta) => this.graphStore.jumpSeed(delta)
    });

    this.stepPrevCtrl = createHoldController({
      direction: -1,
      accelerate: true, // Accelerates by 10x after holding
      intervalMs: 120,
      onStep: (delta) => {
        const next = Math.max(this.minStepIndex, this.activeStepIndex + delta);
        this.updateStep(next);
      },
    });

    this.stepNextCtrl = createHoldController({
      direction: 1,
      accelerate: true, // Accelerates by 10x after holding
      intervalMs: 120,
      onStep: (delta) => {
        const next = Math.min(this.maxStepIndex, this.activeStepIndex + delta);
        this.updateStep(next);
      },
    });

    // 3. Target K controllers (0 .. totalPlantzonesCount): accelerate = true
    this.targetKPrevCtrl = createHoldController({
      direction: -1,
      accelerate: true,
      intervalMs: 100,
      onStep: (delta) => {
        const next = Math.max(0, this.graphStore.liveTopKPzCount + delta);
        this.graphStore.setLiveTargetCount(next, false);
      },
    });

    this.targetKNextCtrl = createHoldController({
      direction: 1,
      accelerate: true,
      intervalMs: 100,
      onStep: (delta) => {
        const next = Math.min(this.totalPlantzonesCount, this.graphStore.liveTopKPzCount + delta);
        this.graphStore.setLiveTargetCount(next, false);
      },
    });

    this.sourceStepPrevCtrl = createHoldController({
      direction: -1,
      accelerate: true,
      intervalMs: 100,
      onStep: (delta) => {
        const next = Math.max(1, this.graphStore.liveSourceScaleStep + delta);
        this.graphStore.setLiveSourceStep(next, false);
      },
    });

    this.sourceStepNextCtrl = createHoldController({
      direction: 1,
      accelerate: true,
      intervalMs: 100,
      onStep: (delta) => {
        const next = Math.min(30, this.graphStore.liveSourceScaleStep + delta);
        this.graphStore.setLiveSourceStep(next, false);
      },
    });

    this.freeMPrevCtrl = createHoldController({
      direction: -1,
      accelerate: true,
      intervalMs: 100,
      onStep: (delta) => {
        const next = Math.max(0, this.graphStore.liveFreeTargetCount + delta);
        this.graphStore.setLiveFreeTargetCount(next, !this.graphStore.isContinuousMode);
      },
    });

    this.freeMNextCtrl = createHoldController({
      direction: 1,
      accelerate: true,
      intervalMs: 100,
      onStep: (delta) => {
        const next = Math.min(this.totalFreeTargetsCount, this.graphStore.liveFreeTargetCount + delta);
        this.graphStore.setLiveFreeTargetCount(next, !this.graphStore.isContinuousMode);
      },
    });
  },

  mounted() {
    window.addEventListener('blur', this.resetHeldTreeArrow);
    window.addEventListener('keydown', this.onWindowKeyDown, true);
    window.addEventListener('keyup', this.onWindowKeyUp, true);

    window.addEventListener('resize', this.onWindowResize);
  },

  beforeUnmount() {
    this.haltDpSandbox();
    this.stopDrag();

    // Clean up any active timers if panel closes mid-hold
    this.seedPrevCtrl?.stop();
    this.seedNextCtrl?.stop();
    this.stepPrevCtrl?.stop();
    this.stepNextCtrl?.stop();
    clearTimeout(this.refreshHoldTimer);

    this.targetKPrevCtrl?.stop();
    this.targetKNextCtrl?.stop();
    this.sourceStepPrevCtrl?.stop();
    this.sourceStepNextCtrl?.stop();
    this.freeMPrevCtrl?.stop();
    this.freeMNextCtrl?.stop();

    // Inside beforeUnmount():
    window.removeEventListener('keydown', this.onWindowKeyDown, true);
    window.removeEventListener('keyup', this.onWindowKeyUp, true);
    window.removeEventListener('blur', this.resetHeldTreeArrow);

    window.removeEventListener('resize', this.onWindowResize);

    this.cancelTreeCamAnim();
    this.stopTreePan();
  }
};
</script>

<style scoped>




.deck-hud-panel {
  /* Shared Glass Surface Variables */
  --hud-control-bg: rgba(255, 255, 255, 0.03);
  --hud-control-bg-hover: rgba(255, 255, 255, 0.07);
  --hud-control-border: rgba(255, 255, 255, 0.12);
  --hud-control-border-focus: rgba(56, 189, 248, 0.5);

  position: fixed;
  top: 52px;
  right: 16px;
  z-index: 1000000;
  pointer-events: auto;
  width: 320px;
  padding: 12px 16px;
  



  user-select: none;
  will-change: transform;

  
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: #cbd5e1;



    /* 1. Glass Transparency & Background Surface */
  background: rgba(18, 22, 28, 0.4);      /* Base surface: adjust 0.72 (alpha) for more/less see-through */

  /* 2. Glass Frost / Blur */
  backdrop-filter: blur(12px) saturate(180%); /* Tweak blur (12px to 28px); saturate enhances map colors beneath */
  -webkit-backdrop-filter: blur(20px) saturate(180%);

  /* 3. Perimeter Stroke / Edge Rim */
  border: 1px solid rgba(255, 255, 255, 0.08); /* Subtle specular glass edge */
  border-radius: 10px;

  /* 4. Ambient Drop Shadow */
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);   /* Top-rim inner light catch */

  transition: 
    border-color 0.22s ease, 
    box-shadow 0.22s ease, 
    background-color 0.22s ease;


  /* Target (Plantzone) Red-ish Palette — Tweak these two values to test colors! */
  --target-accent: #f43f5e;       /* Coral-crimson bar & triangle pointer (try #ef4444, #fb7185, #e11d48) */
  --target-text: #fda4af;         /* Soft rose readout text */
  --target-glow: rgba(244, 63, 94, 0.55);
}


/* Optional: Slightly deepen all control wells together when hovering the main panel */
.deck-hud-panel:hover {
  --hud-control-bg: rgba(12, 16, 22, 0.38);
  --hud-control-border: rgba(255, 255, 255, 0.16);

  background: rgba(18, 22, 28, 0.78);
  border-color: rgba(56, 189, 248, 0.35);    /* Electric cyan highlight */
  box-shadow: 
    0 14px 40px rgba(0, 0, 0, 0.7),
    0 0 24px rgba(56, 189, 248, 0.12),        /* Soft cyan perimeter bloom */
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

/* Header & Help button */
.hud-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: grab;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px transparent;
}

.hud-header:active {
  cursor: grabbing;
}

.hud-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hud-drag-grip {
  font-size: 13px;
  color: #475569;
  letter-spacing: -1.5px;
  line-height: 1;
}

.hud-indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #38bdf8;
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.7);
}

.hud-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: #93c5fd;
}



.hud-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hud-action-btn {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.05);
  color: #94a3b8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  outline: none;
}

.hud-action-btn:hover {
  background: rgba(56, 189, 248, 0.15);
  border-color: rgba(56, 189, 248, 0.5);
  color: #e0f2fe;
}

/* Active Continuous Mode Toggle Pill */
.continuous-toggle-btn.is-active {
  border-color: #38bdf8;
  background: rgba(56, 189, 248, 0.2);
  color: #ffffff;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
}

.hud-action-btn,
.hud-help-btn {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.05);
  color: #94a3b8;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  outline: none;
}

.hud-help-btn:hover,
.hud-help-btn.is-open {
  background: rgba(56, 189, 248, 0.2);
  border-color: #38bdf8;
  color: #ffffff;
}

/* Help Popover */
.hud-help-popover {
  margin-bottom: 12px;
  padding: 10px 12px;
  background: #181c23;
  border: 1px solid #38bdf8;
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
  animation: fadeIn 0.15s ease-out;
}

.help-popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.help-title {
  font-size: 11px;
  font-weight: 700;
  color: #38bdf8;
  text-transform: uppercase;
}

.help-close-btn {
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.help-close-btn:hover {
  color: #cbd5e1;
}

.help-popover-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.help-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 11px;
  line-height: 1.35;
  color: #94a3b8;
}

.help-item strong {
  color: #e2e8f0;
}

.help-icon-preview {
  margin-top: 1px;
  flex-shrink: 0;
  color: #38bdf8;
}

/* Rows & Meta Layout */
.control-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.control-meta {
  gap: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.meta-label-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.control-name {
  display: inline-block;
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: #94a3b8;
  width: 122px;
  flex-shrink: 0;
  white-space: nowrap;
}

.value-readout {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  font-weight: 600;
  margin-left: 0;     /* Remove auto-push so both readouts start on the exact same vertical line */
  font-variant-numeric: tabular-nums;
  white-space: nowrap; /* Prevents "370" from wrapping below "k = 127 /" */
}

.neon-switch-capsule {
  flex-shrink: 0;       /* Guarantees both capsules keep identical width and never squish */
}

.cyan-readout { color: #38bdf8; }
.amber-readout { color: #f59e0b; }
.sky-readout { color: #60a5fa; }

/* Switch Toggle Cluster */
.switch-toggle-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.25);
  padding: 2px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.hud-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 10px 0;
}

/* =========================================================
   SLIDERS: INLINE [◀ BAR ▶], IDLE OPACITY & BORDERED PIN
   ========================================================= */
.stepper-track-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.micro-btn {
  width: 20px;
  height: 20px;
  flex-shrink: 0; /* Prevents buttons from wrapping onto separate lines */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.micro-btn .nav-triangle {
  font-size: 9px;
}

.range-slider-container {
  position: relative;
  flex: 1;
  width: auto; /* Overrides old width: 100% so bar sits cleanly between ◀ and ▶ */
  min-width: 0;
  height: 18px;
  display: flex;
  align-items: center;
}

.custom-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: transparent;
  outline: none;
  cursor: pointer;
  position: relative;
  z-index: 3;
  margin: 0;
}

/* Strip default browser track outline & background in WebKit & Firefox */
.custom-slider::-webkit-slider-runnable-track {
  background: transparent;
  border: none;
  box-shadow: none;
  height: 4px;
}

.custom-slider::-moz-range-track {
  background: transparent;
  border: none;
  box-shadow: none;
  height: 4px;
}

.custom-slider,
.custom-slider:hover,
.custom-slider:focus,
.custom-slider:active {
  -webkit-appearance: none !important;
  appearance: none !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
  padding: 0 !important;
  margin: 0 !important;
}

.slider-track-bg {
  position: absolute;
  left: 5.5px;
  right: 5.5px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.09);
  pointer-events: none;
  z-index: 1;
}

/* Semi-transparent when panel is idle; vivid when hovering the panel */
.slider-fill {
  position: absolute;
  left: 5.5px;
  height: 4px;
  border-radius: 2px;
  pointer-events: none;
  z-index: 2;
  opacity: 0.42;
  transition: opacity 0.22s ease, box-shadow 0.22s ease;
}

.deck-hud-panel:hover .slider-fill {
  opacity: 1;
}

.cyan-fill {
  background: #38bdf8;
  box-shadow: 0 0 6px rgba(56, 189, 248, 0.35);
}

.deck-hud-panel:hover .cyan-fill {
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.6);
}

.target-fill {
  background: var(--target-accent);
  box-shadow: 0 0 6px rgba(244, 63, 94, 0.35);
}

.deck-hud-panel:hover .target-fill {
  box-shadow: 0 0 8px var(--target-glow);
}

.target-readout {
  color: var(--target-text);
}

/* 1/5th, 2/5th, 3/5th, 4/5th, 5/5th Quintile Marks */
.slider-ticks {
  position: absolute;
  left: 5.5px;
  right: 5.5px;
  top: 50%;
  height: 10px;
  transform: translateY(-50%);
  pointer-events: none;
  z-index: 1;
}

.tick-mark {
  position: absolute;
  top: 6px;
  width: 1px;
  height: 4px;
  background: rgba(148, 163, 184, 0.38);
  transform: translateX(-50%);
}

/* Crisp SVG Downward Triangle Pin with Deeper Border Line (Cyan) */
.custom-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 11px;
  height: 11px;
  border: none;
  background-color: transparent;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 11'%3E%3Cpolygon points='1,1 11,1 6,10' fill='%2338bdf8' stroke='%230369a1' stroke-width='1.4' stroke-linejoin='round'/%3E%3C/svg%3E");
  transform: translateY(-5px);
  cursor: grab;
  opacity: 0.72;
  transition: transform 0.14s ease, filter 0.15s ease, opacity 0.22s ease;
}

.deck-hud-panel:hover .custom-slider::-webkit-slider-thumb {
  opacity: 1;
}

.custom-slider:hover::-webkit-slider-thumb {
  transform: translateY(-6px) scale(1.16);
  filter: drop-shadow(0 0 4px rgba(56, 189, 248, 0.85));
}

.custom-slider:active::-webkit-slider-thumb {
  cursor: grabbing;
  transform: translateY(-6px) scale(1.22);
}

/* Crisp SVG Downward Triangle Pin with Deeper Crimson Border Line (Target) */
.target-slider::-webkit-slider-thumb {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 11'%3E%3Cpolygon points='1,1 11,1 6,10' fill='%23f43f5e' stroke='%239f1239' stroke-width='1.4' stroke-linejoin='round'/%3E%3C/svg%3E");
}

.target-slider:hover::-webkit-slider-thumb {
  transform: translateY(-6px) scale(1.16);
  filter: drop-shadow(0 0 4px rgba(244, 63, 94, 0.85));
}

/* Firefox Thumb Parity */
.custom-slider::-moz-range-thumb {
  width: 11px;
  height: 11px;
  border: none;
  background-color: transparent;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 11'%3E%3Cpolygon points='1,1 11,1 6,10' fill='%2338bdf8' stroke='%230369a1' stroke-width='1.4' stroke-linejoin='round'/%3E%3C/svg%3E");
  transform: translateY(-5px);
  cursor: grab;
}

.target-slider::-moz-range-thumb {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 11'%3E%3Cpolygon points='1,1 11,1 6,10' fill='%23f43f5e' stroke='%239f1239' stroke-width='1.4' stroke-linejoin='round'/%3E%3C/svg%3E");
}

/* Reddish Glass Stepper Buttons for Target Row */
.target-glass-btn:hover:not(:disabled) {
  background: rgba(244, 63, 94, 0.12);
  border-color: rgba(244, 63, 94, 0.55);
  color: #fecdd3;
  filter: drop-shadow(0 0 5px var(--target-glow));
}




.seed-control {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.seed-tag {
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
}

.seed-input {
  background: var(--hud-control-bg);
  border: 1px solid var(--hud-control-border);
  border-radius: 4px;
  color: #e2e8f0;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  padding: 2px 6px;
  width: 80px;
  outline: none;
  transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.seed-input:hover {
  background: var(--hud-control-bg-hover);
}

.seed-input:focus {
  background: rgba(15, 20, 28, 0.65);
  border-color: var(--hud-control-border-focus);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.25);
}

.seed-reroll-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
}




/* Stepper & Micro Buttons (<, >, -, +) */
.step-btn {
  background: var(--hud-control-bg);
  border: 1px solid var(--hud-control-border);
  color: #cbd5e1;
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 11px;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.step-btn:hover:not(:disabled) {
  background: var(--hud-control-bg-hover);
  border-color: rgba(255, 255, 255, 0.25);
}



.step-badge {
  font-family: ui-monospace, monospace;
  font-size: 11px;
}

.step-num { color: #60a5fa; font-weight: 700; }
.step-total { color: #64748b; }

.step-op-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 10px;
}

.op-type {
  font-weight: 700;
  color: #38bdf8;
}

.op-desc {
  color: #94a3b8;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}




/* =========================================================
   NEON BEAM SWITCH: SEAMLESS TRACK & EXPANDING GLOW RIM
   ========================================================= */
.neon-switch-capsule {
  position: relative;
  display: inline-flex;
  align-items: center;

  /* Matches main panel transparency instead of blocking it */
  background: var(--hud-control-bg);
  border: 1.2px solid var(--hud-control-border);
  border-radius: 8px;
  padding: 2px;
  overflow: visible; /* Allows the neon edge bloom to radiate outward */
  transition: 
    background-color 0.22s ease,
    border-color 0.25s cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* 1. Inner Surface Radial Wash */
.neon-switch-capsule::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 7px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease, background 0.3s ease;
}

/* 2. Razor-Sharp Vivid Neon Boundary Rim */
.neon-switch-capsule::after {
  content: '';
  position: absolute;
  inset: -1.2px;             /* Aligns precisely with the border track */
  border-radius: 8px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* ---------------------------------------------------------
   STATE 1: LEFT ICON SELECTED (e.g., 'prob' / 'closest')
   --------------------------------------------------------- */
.neon-switch-capsule.active-prob,
.neon-switch-capsule.active-closest {
  /* Change from rgba(56, 189, 248, 0.6) to a deep charcoal or subtle border */
  border-color: rgba(255, 255, 255, 0.05); /* <-- Darkens the inactive rim */

  /* Outward ambient aura radiating from the left corner */
  box-shadow: 
    -4px 0 16px rgba(56, 189, 248, 0.35),
    inset 0 0 12px rgba(56, 189, 248, 0.15);
}

.neon-switch-capsule.active-prob::before,
.neon-switch-capsule.active-closest::before {
  opacity: 1;
  background: radial-gradient(
    circle at 25% 50%, 
    rgba(56, 189, 248, 0.28) 0%, 
    rgba(56, 189, 248, 0.05) 55%, 
    transparent 100%
  );
}

/* Focused neon stroke blooming strongly on the left side */
.neon-switch-capsule.active-prob::after,
.neon-switch-capsule.active-closest::after {
  opacity: 1;
  border: 1.2px solid transparent;
  background: linear-gradient(
    90deg, 
    #38bdf8 0%, 
    rgba(56, 189, 248, 0.8) 35%, 
    transparent 70% /* <-- Changed from 80% to 50% so the right half stays pitch dark */
  ) border-box;
  -webkit-mask: 
    linear-gradient(#fff 0 0) padding-box, 
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: destination-out;
  mask-composite: exclude;
  filter: drop-shadow(0 0 4px #38bdf8);
}

/* ---------------------------------------------------------
   STATE 2: RIGHT ICON SELECTED (e.g., 'topk' / 'rings')
   --------------------------------------------------------- */
.neon-switch-capsule.active-topk,
.neon-switch-capsule.active-rings {
  /* Change from rgba(56, 189, 248, 0.6) to a deep charcoal or subtle border */
  border-color: rgba(255, 255, 255, 0.05); /* <-- Darkens the inactive rim */

  /* Outward ambient aura radiating from the right corner */
  box-shadow: 
    4px 0 16px rgba(56, 189, 248, 0.35),
    inset 0 0 12px rgba(56, 189, 248, 0.15);
}

.neon-switch-capsule.active-topk::before,
.neon-switch-capsule.active-rings::before {
  opacity: 1;
  background: radial-gradient(
    circle at 75% 50%, 
    rgba(56, 189, 248, 0.28) 0%, 
    rgba(56, 189, 248, 0.05) 55%, 
    transparent 100%
  );
}

/* Focused neon stroke blooming strongly on the right side */
.neon-switch-capsule.active-topk::after,
.neon-switch-capsule.active-rings::after {
  opacity: 1;
  border: 1.2px solid transparent;
  background: linear-gradient(
    270deg, 
    #38bdf8 0%, 
    rgba(56, 189, 248, 0.8) 35%, 
    transparent 80%
  ) border-box;
  -webkit-mask: 
    linear-gradient(#fff 0 0) padding-box, 
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: destination-out;
  mask-composite: exclude;
  filter: drop-shadow(0 0 4px #38bdf8);
}

/* ---------------------------------------------------------
   TOUCH PADS & ICON GLOW INTENSITY
   --------------------------------------------------------- */
.neon-switch-pad {
  position: relative;
  z-index: 2;
  width: 34px;
  height: 28px;
  border: none;
  background: transparent;
  color: #64748b;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  outline: none;
  border-radius: 6px;
  transition: color 0.18s ease, filter 0.18s ease;
}

.neon-switch-pad * {
  pointer-events: none !important;
}

/* Idle Hover: Soft pre-illumination */
.neon-switch-pad:hover {
  color: #e0f2fe;
  filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.75));
}

/* Selected: High-intensity phosphor glow matching the edge */
.neon-switch-pad.is-active {
  color: #ffffff;
  filter: 
    drop-shadow(0 0 2px #ffffff)
    drop-shadow(0 0 6px #38bdf8)
    drop-shadow(0 0 14px rgba(56, 189, 248, 0.9));
}






/* =========================================================
   CONTINUOUS MODE: ACTIVE ICON ANIMATION TRIGGERS
   ========================================================= */

/* 1. Die Icon: Continuous Rolling & Face Cycling */
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .die-body {
  animation: dieJiggle 0.4s ease-in-out infinite alternate;
}
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-c {
  animation: dieCycleCenter 1.2s steps(1) infinite;
}
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-tl,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-br {
  animation: dieCycleDiag1 1.2s steps(1) infinite;
}
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-tr,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-bl {
  animation: dieCycleDiag2 1.2s steps(1) infinite;
}
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-ml,
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .die-icon .pip-mr {
  animation: dieCycleSides 1.2s steps(1) infinite;
}

/* 2. Dollar Icon: Continuous Coin Spin */
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .flip-coin-icon .coin-rig {
  animation: flipCoinContinuous 2.6s linear infinite;
}

/* 3. ClosestK Icon: Continuous Horizon Bloom & Pruning */
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .closest-k-svg .range-ring {
  animation: ckRingBloom 3.2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .closest-k-svg .node-1 {
  animation: ckPopNode1 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .closest-k-svg .node-2 {
  animation: ckPopNode2 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .closest-k-svg .node-3 {
  animation: ckPopNode3 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .closest-k-svg .reject-cross {
  animation: ckStampCross 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

/* 4. Rings Icon: Continuous Ring Clashing & Diamond Oscillation */
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .rings-svg .left-ring-mover {
  animation: rngLeftImpact 3.2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .rings-svg .right-ring-mover {
  animation: rngRightImpact 3.2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active .rings-svg .gem-rocker {
  animation: rngDiamondSwing 3.2s ease-in-out infinite;
}

/* 1. Die Icon: Continuous Rolling & Face Cycling */
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active :deep(.die-icon .die-body),
.seed-check-btn.is-active.is-continuous :deep(.die-icon .die-body) {
  animation: dieJiggle 0.4s ease-in-out infinite alternate;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active :deep(.die-icon .pip-c),
.seed-check-btn.is-active.is-continuous :deep(.die-icon .pip-c) {
  animation: dieCycleCenter 1.2s steps(1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active :deep(.die-icon .pip-tl),
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active :deep(.die-icon .pip-br),
.seed-check-btn.is-active.is-continuous :deep(.die-icon .pip-tl),
.seed-check-btn.is-active.is-continuous :deep(.die-icon .pip-br) {
  animation: dieCycleDiag1 1.2s steps(1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active :deep(.die-icon .pip-tr),
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active :deep(.die-icon .pip-bl),
.seed-check-btn.is-active.is-continuous :deep(.die-icon .pip-tr),
.seed-check-btn.is-active.is-continuous :deep(.die-icon .pip-bl) {
  animation: dieCycleDiag2 1.2s steps(1) infinite;
}

.neon-switch-capsule.is-continuous .neon-switch-pad.is-active :deep(.die-icon .pip-ml),
.neon-switch-capsule.is-continuous .neon-switch-pad.is-active :deep(.die-icon .pip-mr),
.seed-check-btn.is-active.is-continuous :deep(.die-icon .pip-ml),
.seed-check-btn.is-active.is-continuous :deep(.die-icon .pip-mr) {
  animation: dieCycleSides 1.2s steps(1) infinite;
}













/* Reusable class for any future inputs/boxes you add to the panel */
.hud-glass-box {
  background: var(--hud-control-bg);
  border: 1px solid var(--hud-control-border);
  border-radius: 6px;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}



/* =========================================================
   REUSABLE GLASS UTILITY CLASSES (FOR FUTURE BOXES/BUTTONS)
   ========================================================= */
.hud-glass-box {
  background: var(--hud-control-bg);
  border: 1px solid var(--hud-control-border);
  color: #cbd5e1;
  border-radius: 5px;
  outline: none;
  box-sizing: border-box;
  transition: 
    background-color 0.2s ease, 
    border-color 0.2s ease, 
    box-shadow 0.2s ease, 
    color 0.2s ease;
}

.hud-glass-box:hover {
  background: var(--hud-control-bg-hover);
  border-color: rgba(255, 255, 255, 0.22);
}

.hud-glass-box:focus {
  background: rgba(14, 18, 24, 0.65);
  border-color: var(--hud-control-border-focus);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.25);
}

/* Glass button utility matching neon scheme */
.hud-glass-btn {
  background: var(--hud-control-bg);
  border: 1px solid var(--hud-control-border);
  color: #64748b;
  border-radius: 5px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  outline: none;
  box-sizing: border-box;
  user-select: none;
  transition: 
    background-color 0.18s ease, 
    border-color 0.2s ease, 
    color 0.18s ease, 
    box-shadow 0.2s ease,
    filter 0.18s ease;
}

.hud-glass-btn:hover {
  background: var(--hud-control-bg-hover);
  border-color: rgba(56, 189, 248, 0.5);
  color: #bae6fd;
  filter: drop-shadow(0 0 5px rgba(56, 189, 248, 0.7));
}

.hud-glass-btn * {
  pointer-events: none !important;
}

.hud-glass-btn:hover:not(:disabled) {
  background: var(--hud-control-bg-hover);
  border-color: rgba(56, 189, 248, 0.5);
  color: #bae6fd;
  filter: drop-shadow(0 0 5px rgba(56, 189, 248, 0.7));
}

.nav-triangle {
  font-size: 13px; /* Adjust to 10px–11px if using ◀ / ▶ */
  line-height: 1;
  display: block;
}

.hud-glass-btn:disabled {
  opacity: 1; /* Keep container visible instead of fading the entire element */
  background: rgba(10, 14, 20, 0.25);
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(148, 163, 184, 0.16); /* Faint slate glyph so it's vaguely there */
  cursor: not-allowed;
  filter: none;
  box-shadow: none;
}

/* =========================================================
   SEED CONTROL ROW & ACTIONS
   ========================================================= */
.seed-control {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.seed-tag {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #64748b;
}

.seed-input {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  padding: 3px 7px;
  width: 86px;
  height: 24px;
}

.seed-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto; /* Pushes the 5-button group flush right */
}

.seed-action-btn {
  width: 24px;
  height: 24px;
}

/* Click Confirmation Animation for Refresh Icon */
.seed-action-btn.is-spinning .refresh-icon,
.seed-action-btn.is-spinning .refresh-glyph {
  animation: spinFullOnce 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Ensure the icon rotates exactly around its visual center */
.refresh-icon,
.refresh-glyph {
  display: block;
  transform-origin: center center;
  transform-box: fill-box;
}

.refresh-glyph {
  font-size: 15px;
  line-height: 1;
}

@keyframes spinFullOnce {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Checkbox Checked State: Glows neon cyan */
.seed-check-btn .check-icon {
  opacity: 0;
  transform: scale(0.5);
  transition: opacity 0.15s ease, transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.seed-check-btn.is-active {
  background: rgba(56, 189, 248, 0.15);
  border-color: #38bdf8;
  color: #ffffff;
  box-shadow: 
    0 0 10px rgba(56, 189, 248, 0.4),
    inset 0 0 6px rgba(56, 189, 248, 0.25);
  filter: drop-shadow(0 0 3px #38bdf8);
}

.seed-check-btn.is-active .check-icon {
  opacity: 1;
  transform: scale(1);
}




.seed-section {
  position: relative;
  margin-bottom: 10px;
}

.seed-label-group {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
  min-width: 44px;
}

.seed-counter {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
  font-weight: 600;
  color: #38bdf8;
  letter-spacing: 0.2px;
}

/* Subtle charging glow while holding Refresh for 1s */
.seed-action-btn.is-holding {
  border-color: #38bdf8;
  box-shadow: inset 0 0 10px rgba(56, 189, 248, 0.45);
  transition: box-shadow 1s linear, border-color 1s linear;
}

/* Batch Generation Popover */
.batch-seed-popover {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 5px 8px;
  background: rgba(14, 19, 27, 0.85);
  border-color: rgba(56, 189, 248, 0.4);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
}

.batch-label {
  font-size: 10.5px;
  color: #94a3b8;
  white-space: nowrap;
}

.batch-number-input {
  width: 58px;
  height: 22px;
  padding: 2px 6px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: #f8fafc;
}

.batch-go-btn {
  height: 22px;
  padding: 0 8px;
  font-size: 10.5px;
  font-weight: 600;
  color: #38bdf8;
  border-color: rgba(56, 189, 248, 0.45);
}

.batch-close-btn {
  width: 22px;
  height: 22px;
  font-size: 10px;
  margin-left: auto;
}

.popover-fade-enter-active,
.popover-fade-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.popover-fade-enter-from,
.popover-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}




/* =========================================================
   3-TAB SWITCHER BAR
   ========================================================= */
.hud-tab-bar {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 3px;
  margin-bottom: 12px;
  background: var(--hud-control-bg);
  border: 1px solid var(--hud-control-border);
  border-radius: 7px;
}

.hud-tab-btn {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px;
  color: #64748b;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
  padding: 5px 0;
  cursor: pointer;
  outline: none;
  transition: all 0.2s ease;
}

.hud-tab-btn:hover:not(.is-active) {
  color: #cbd5e1;
  background: rgba(255, 255, 255, 0.04);
}

.hud-tab-btn.is-active {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.45);
  color: #f0f9ff;
  box-shadow: 
    0 0 10px rgba(56, 189, 248, 0.25),
    inset 0 0 6px rgba(56, 189, 248, 0.15);
}

/* =========================================================
   JSON UPLOAD BUTTON & HIDDEN NATIVE INPUT
   ========================================================= */
.hidden-file-input {
  display: none !important;
}

/* Slightly tighter input & gap so all 5 action buttons fit cleanly inside 350px */
.seed-control {
  gap: 6px;
}

.seed-input {
  width: 68px;
  padding: 3px 6px;
}

.seed-actions {
  gap: 4px;
}

.json-upload-btn.is-loaded {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.55);
  color: #38bdf8;
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.35);
}

.json-status-row {
  margin-top: 4px;
  margin-bottom: 4px;
  font-size: 10px;
  line-height: 1.2;
}

.json-loaded-badge {
  color: #38bdf8;
}

.json-error-text {
  color: #f87171;
}


.instance-stats-bar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 7px 10px;
  margin-bottom: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-variant-numeric: tabular-nums;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.instance-stats-bar:hover {
  background: rgba(15, 23, 42, 0.42);
  border-color: rgba(56, 189, 248, 0.28);
}

.stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stat-label {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.52);
  text-transform: uppercase;
}

.stat-val {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.92);
  transition: color 0.2s ease, text-shadow 0.2s ease;
}



/* 2-Row Telemetry Grid for Reduce Tab */
.reduce-stats-grid {
  row-gap: 7px;
  padding: 8px 10px;
}

.stats-grid-divider {
  grid-column: 1 / -1;
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 1px 0;
}

.deg-val {
  font-size: 12px;
  color: #cbd5e1;
}

.mint-readout {
  color: #34d399;
  text-shadow: 0 0 8px rgba(52, 211, 153, 0.4);
}

.stat-sub {
  font-size: 10.5px;
  font-weight: 500;
  color: #64748b;
}

/* Stage Label Pill */
.op-stage-badge {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: 5px;
  background: rgba(56, 189, 248, 0.14);
  border: 1px solid rgba(56, 189, 248, 0.4);
  color: #7dd3fc;
  white-space: nowrap;
}

.op-stage-badge.op-target_merge {
  background: rgba(244, 63, 94, 0.14);
  border-color: rgba(244, 63, 94, 0.42);
  color: #fda4af;
}

.op-stage-badge.op-redundant_node {
  background: rgba(245, 158, 11, 0.14);
  border-color: rgba(245, 158, 11, 0.42);
  color: #fcd34d;
}

.op-stage-badge.op-cleanup {
  background: rgba(52, 211, 153, 0.14);
  border-color: rgba(52, 211, 153, 0.42);
  color: #6ee7b7;
}

/* Transport Bar with 4 Micro Buttons ([◀◀] [◀] slider [▶] [▶▶]) */
.reduce-transport-wrap {
  gap: 4px;
}

.jump-btn {
  width: 22px;
}

.nav-double-triangle {
  font-size: 7.5px;
  line-height: 1;
  letter-spacing: -2.2px;
  display: block;
  transform: translateX(-0.5px);
}



.deg-pair {
  font-size: 11.5px;
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
}

.deg-nonterm {
  color: #e2e8f0;
  font-weight: 700;
}

.deg-sep {
  color: #475569;
  font-weight: 400;
  font-size: 10px;
}

.deg-term {
  color: #38bdf8;
  font-weight: 700;
}

.deg-legend-row {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  font-size: 9px;
  color: #64748b;
  margin-top: -2px;
}

.legend-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: middle;
}

.nonterm-dot {
  background: #e2e8f0;
}

.term-dot {
  background: #38bdf8;
}



.reduce-controls {
  gap: 8px;
}

.reduce-meta-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
}

.reduce-title-text {
  font-size: 12.5px;
  font-weight: 500;
  color: #94a3b8;
  white-space: nowrap;
  flex-shrink: 0;
}

.reduce-right-cluster {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

/* Invisible box filling the gap up to the fixed-width badge, right-aligned */
.step-counter-box {
  flex: 1;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Fixed width sized for the longest stage label ("REDUNDANT_NODE") so its left edge never shifts */
.op-stage-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 114px;
  flex-shrink: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 2px 0;
  border-radius: 5px;
  background: rgba(56, 189, 248, 0.14);
  border: 1px solid rgba(56, 189, 248, 0.4);
  color: #7dd3fc;
  white-space: nowrap;
}


.solve-empty-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.solve-empty-title {
  font-size: 12px;
  font-weight: 700;
  color: #e2e8f0;
}

.solve-empty-desc {
  font-size: 11px;
  line-height: 1.4;
  color: #94a3b8;
}

.compute-td-btn {
  height: 28px;
  font-size: 11px;
  font-weight: 600;
  color: #38bdf8;
  border-color: rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.12);
}

.warn-readout {
  color: #fbbf24;
}

.td-nav-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.td-nav-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.td-dpad-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.td-dir-btn {
  flex: 1;
  height: 26px;
  font-size: 11px;
  color: #e2e8f0;
}

.td-root-btn {
  height: 26px;
  padding: 0 9px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #7dd3fc;
}

.td-bag-display {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(10, 14, 22, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.td-bag-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10.5px;
  font-weight: 600;
  color: #94a3b8;
}

.td-vertex-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 110px;
  overflow-y: auto;
}

.td-v-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  font-weight: 700;
}

.td-v-chip small {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-weight: 500;
  opacity: 0.85;
}

/* Separator Color Coding */
.td-v-chip.role-shared-both {
  background: rgba(168, 85, 247, 0.2);
  border: 1px solid rgba(192, 132, 252, 0.55);
  color: #e9d5ff;
}

.td-v-chip.role-parent-sep {
  background: rgba(56, 189, 248, 0.18);
  border: 1px solid rgba(56, 189, 248, 0.5);
  color: #bae6fd;
}

.td-v-chip.role-child-sep {
  background: rgba(245, 158, 11, 0.18);
  border: 1px solid rgba(251, 191, 36, 0.5);
  color: #fde68a;
}

.td-v-chip.role-bag-only {
  background: rgba(52, 211, 153, 0.15);
  border: 1px solid rgba(52, 211, 153, 0.42);
  color: #a7f3d0;
}

.td-sep-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 9px;
  color: #64748b;
  padding-top: 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.sep-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 3px;
  vertical-align: middle;
}

.sep-dot.role-shared-both { background: #c084fc; }
.sep-dot.role-parent-sep  { background: #38bdf8; }
.sep-dot.role-child-sep   { background: #fbbf24; }
.sep-dot.role-bag-only    { background: #34d399; }

.td-adj-links {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10px;
  color: #94a3b8;
}

.td-adj-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.td-adj-tag {
  font-weight: 600;
  color: #64748b;
}

.td-adj-list {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #cbd5e1;
}

.td-child-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.td-child-pill {
  height: 18px;
  padding: 0 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
  color: #fde68a;
}


.td-tree-map-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 8px;
  margin-bottom: 8px;
  border-radius: 8px;
  background: rgba(8, 12, 18, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.td-tree-map-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
}

.td-mode-pills {
  display: inline-flex;
  gap: 4px;
}

.td-mode-pill {
  height: 17px;
  padding: 0 6px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.td-mode-pill.is-active {
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(56, 189, 248, 0.55);
  color: #e0f2fe;
}

.td-tree-svg {
  width: 100%;
  height: 136px;
  display: block;
  overflow: visible;
}

.td-edges line {
  stroke: rgba(148, 163, 184, 0.2);
  stroke-width: 0.9;
}

.td-edges line.edge-path {
  stroke: rgba(56, 189, 248, 0.65);
  stroke-width: 1.4;
}

.td-edges line.edge-adj {
  stroke: rgba(251, 191, 36, 0.75);
  stroke-width: 1.5;
}

.td-nodes circle {
  fill: #475569;
  cursor: pointer;
  transition: r 0.12s ease, fill 0.12s ease;
}

.td-nodes circle:hover {
  fill: #e0f2fe;
}

.td-nodes circle.node-ancestor {
  fill: #38bdf8;
}

.td-nodes circle.node-parent {
  fill: #38bdf8;
  stroke: #ffffff;
  stroke-width: 1;
}

.td-nodes circle.node-child {
  fill: #fbbf24;
}

.td-nodes circle.node-active {
  fill: #ffffff;
  stroke: #38bdf8;
  stroke-width: 2;
  filter: drop-shadow(0 0 4px #38bdf8);
}

.local-node-group {
  cursor: pointer;
}

.local-node-group rect {
  fill: rgba(15, 23, 42, 0.9);
  stroke: rgba(148, 163, 184, 0.35);
  stroke-width: 1;
}

.local-node-group rect.box-active {
  fill: rgba(56, 189, 248, 0.25);
  stroke: #38bdf8;
  stroke-width: 1.5;
}

.local-node-group rect.box-parent {
  stroke: #38bdf8;
}

.local-node-group rect.box-child {
  stroke: #fbbf24;
}

.local-node-label {
  fill: #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 8.5px;
  font-weight: 700;
  pointer-events: none;
}



.td-tree-svg {
  width: 100%;
  height: 148px;
  display: block;
  overflow: hidden;
  cursor: grab;
  border-radius: 5px;
  background: rgba(4, 7, 12, 0.35);
}

.td-tree-svg.is-panning {
  cursor: grabbing;
}

.td-edges line {
  stroke: rgba(148, 163, 184, 0.22);
  stroke-width: calc(0.9px * var(--inv-z, 1));
}

.td-edges line.edge-path {
  stroke: rgba(56, 189, 248, 0.68);
  stroke-width: calc(1.4px * var(--inv-z, 1));
}

.td-edges line.edge-adj {
  stroke: rgba(251, 191, 36, 0.78);
  stroke-width: calc(1.5px * var(--inv-z, 1));
}

.td-nodes circle.node-active {
  fill: #ffffff;
  stroke: #38bdf8;
  stroke-width: calc(1.8px * var(--inv-z, 1));
  filter: drop-shadow(0 0 4px #38bdf8);
}

.tree-zoom-label {
  fill: #cbd5e1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  pointer-events: none;
  user-select: none;
}


.tree-zoom-label {
  fill: #7dd3fc;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  paint-order: stroke;
  stroke: rgba(8, 12, 18, 0.92);
  stroke-width: calc(2.6px * var(--inv-z, 1));
  stroke-linejoin: round;
  pointer-events: none;
  user-select: none;
}

.tree-zoom-label.is-active-label {
  fill: #ffffff;
}

.td-nodes circle.node-ancestor {
  fill: #38bdf8;
}


.td-tree-svg {
  width: 100%;
  height: 185px;
  display: block;
  overflow: hidden;
  cursor: grab;
  border-radius: 5px;
  background: rgba(4, 7, 12, 0.35);
}

.td-nodes circle.node-child {
  fill: #fbbf24;
  stroke: #ffffff;
  stroke-width: calc(0.9px * var(--inv-z, 1));
}

.td-bnd-pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
  background: rgba(244, 63, 94, 0.14);
  border: 1px solid rgba(244, 63, 94, 0.38);
  color: #fecdd3;
}


.td-dpad-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.td-compact-dpad {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.td-dir-side-btn {
  width: 28px;
  height: 30px;
  font-size: 10px;
  color: #e2e8f0;
}

.td-dir-vert-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.td-dir-half-btn {
  width: 28px;
  height: 14px;
  font-size: 8px;
  line-height: 1;
  color: #e2e8f0;
}

.td-root-btn {
  height: 30px;
  padding: 0 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #7dd3fc;
}

.td-dp-test-btn {
  height: 30px;
  padding: 0 9px;
  margin-left: auto;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.45);
  background: rgba(52, 211, 153, 0.1);
}

.td-dp-sandbox-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 5px;
  background: rgba(15, 23, 42, 0.65);
  border: 1px solid rgba(52, 211, 153, 0.3);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  color: #94a3b8;
}

.dp-sb-cell strong {
  color: #f8fafc;
}

.dp-sb-time {
  color: #64748b;
  font-size: 9.5px;
}


.dp-debug-popup {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 8px;
  border-radius: 6px;
  background: rgba(15, 10, 18, 0.96);
  border: 1px solid rgba(244, 63, 94, 0.55);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.65);
  z-index: 20;
}

.dp-debug-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.dp-debug-title {
  font-size: 10.5px;
  font-weight: 700;
  color: #fda4af;
}

.dp-debug-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dp-debug-btn {
  height: 20px;
  padding: 0 6px;
  font-size: 9.5px;
  font-weight: 700;
  color: #fecdd3;
}

.dp-debug-pre {
  margin: 0;
  max-height: 180px;
  overflow: auto;
  padding: 6px;
  border-radius: 4px;
  background: rgba(2, 6, 23, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
  line-height: 1.35;
  color: #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
}


.td-dp-test-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.td-dp-cap-select {
  height: 30px;
  padding: 0 6px;
  border-radius: 5px;
  background: rgba(15, 23, 42, 0.75);
  border: 1px solid rgba(52, 211, 153, 0.35);
  color: #a7f3d0;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}

.dp-sol-toggle-btn {
  height: 22px;
  padding: 0 7px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.35);
}

.dp-sol-toggle-btn.active {
  background: rgba(34, 197, 94, 0.22);
  border-color: rgba(34, 197, 94, 0.65);
  color: #86efac;
}


.td-dp-sandbox-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 5px 8px;
  border-radius: 5px;
  background: rgba(15, 23, 42, 0.65);
  border: 1px solid rgba(52, 211, 153, 0.3);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  color: #94a3b8;
}

.dp-sb-main-row,
.dp-sb-sub-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.dp-sb-bottlenecks {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: 3px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.dp-bn-label {
  font-size: 9.5px;
  color: #64748b;
}

.dp-bn-pill {
  height: 18px;
  padding: 0 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
  color: #fde68a;
  border-color: rgba(251, 191, 36, 0.35);
  gap: 3px;
}

.dp-bn-pill span {
  color: #fca5a5;
}

.td-dp-test-btn.is-abort {
  color: #fda4af;
  border-color: rgba(244, 63, 94, 0.55);
  background: rgba(244, 63, 94, 0.16);
}

.td-dp-progress-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 5px;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(56, 189, 248, 0.4);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: #cbd5e1;
}

.dp-prog-top,
.dp-prog-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.dp-prog-stage {
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(56, 189, 248, 0.18);
  border: 1px solid rgba(56, 189, 248, 0.45);
  color: #7dd3fc;
  font-weight: 700;
  font-size: 9px;
}

.dp-prog-bar-track {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.dp-prog-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #38bdf8, #34d399);
  transition: width 0.08s linear;
}


.dp-sb-solutions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: 3px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.dp-stage-sol-pill {
  height: 18px;
  padding: 0 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
  color: #cbd5e1;
  border-color: rgba(148, 163, 184, 0.35);
  gap: 3px;
}

.dp-stage-sol-pill strong {
  color: #34d399;
}

.dp-stage-sol-pill.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: rgba(56, 189, 248, 0.65);
  color: #f0f9ff;
}

.op-stage-badge.op-town_redirect {
  background: rgba(168, 85, 247, 0.16);
  border-color: rgba(192, 132, 252, 0.48);
  color: #d8b4fe;
}

.solve-stats-row {
  padding: 6px 8px;
  margin-bottom: 8px;
}

.solve-triple-val {
  font-size: 12px;
  white-space: nowrap;
}

.solve-subpanel {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 8px;
  margin-bottom: 7px;
  border-radius: 8px;
  background: rgba(8, 12, 18, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.solve-solution-panel {
  border-color: rgba(52, 211, 153, 0.28);
}

.solve-collapse-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  cursor: pointer;
  font-size: 10.5px;
  font-weight: 600;
  color: #94a3b8;
  user-select: none;
}

.solve-collapse-header:hover {
  color: #e2e8f0;
}

.collapse-title-left,
.collapse-title-right {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.collapse-caret {
  font-size: 10px;
  width: 10px;
  color: #38bdf8;
  text-align: center;
  flex-shrink: 0;
}

.collapse-label {
  color: #cbd5e1;
  font-weight: 600;
}

.solve-subpanel-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dp-header-cp {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  font-weight: 700;
}

.dp-exact-badge {
  padding: 1px 5px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.05em;
  background: rgba(16, 185, 129, 0.22);
  border: 1px solid rgba(52, 211, 153, 0.65);
  color: #6ee7b7;
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.28);
}

.dp-heur-badge {
  padding: 1px 5px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: rgba(245, 158, 11, 0.16);
  border: 1px solid rgba(251, 191, 36, 0.45);
  color: #fcd34d;
}

.dp-view-seg {
  display: inline-flex;
  gap: 3px;
}

.dp-seg-btn {
  height: 20px;
  padding: 0 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #94a3b8;
}

.dp-seg-btn.active {
  background: rgba(34, 197, 94, 0.22);
  border-color: rgba(34, 197, 94, 0.65);
  color: #86efac;
}

.dp-stage-sol-pill.is-exact-stage {
  border-color: rgba(52, 211, 153, 0.55);
}

.dp-exact-check {
  color: #34d399;
  font-weight: 800;
  margin-left: 1px;
}

.td-tree-title {
  white-space: nowrap;
}

.td-tree-svg-wrap {
  position: relative;
  width: 100%;
}

.td-tree-zoom-badge {
  position: absolute;
  top: 5px;
  right: 6px;
  z-index: 2;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(10, 15, 24, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
  font-weight: 700;
  color: #7dd3fc;
  pointer-events: none;
  user-select: none;
}


.batch-seed-popover {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding: 6px 8px;
}

.batch-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.source-switch-pills {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.source-pill-btn {
  height: 22px;
  padding: 0 7px;
  font-size: 10px;
  font-weight: 600;
  color: #94a3b8;
}

.source-pill-btn.is-active {
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(56, 189, 248, 0.6);
  color: #e0f2fe;
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.25);
}

.compact-subpanel {
  margin-bottom: 6px;
}

.compact-header-meta {
  font-size: 10.5px;
}

.compact-solve-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.compact-cap-select {
  flex: 1;
}

.compact-nested-solution {
  margin-bottom: 0;
  background: rgba(6, 10, 16, 0.45);
}

.dp-stage-ms {
  color: #64748b;
  font-size: 8.5px;
  margin-left: 2px;
}

/* =========================================================
   UNIFIED IDLE TRANSPARENCY -> HOVER DEEPENING
   ========================================================= */
.deck-hud-panel {
  --hud-subpanel-bg: rgba(255, 255, 255, 0.02);
  --hud-subpanel-nested-bg: rgba(255, 255, 255, 0.015);
  --hud-subpanel-border: rgba(255, 255, 255, 0.08);
  --hud-svg-bg: rgba(255, 255, 255, 0.02);
}

.deck-hud-panel:hover {
  --hud-subpanel-bg: rgba(10, 15, 24, 0.52);
  --hud-subpanel-nested-bg: rgba(8, 12, 20, 0.55);
  --hud-subpanel-border: rgba(255, 255, 255, 0.13);
  --hud-svg-bg: rgba(4, 7, 12, 0.42);
}

.batch-seed-popover,
.solve-subpanel,
.td-tree-map-card,
.td-bag-display {
  background: var(--hud-subpanel-bg);
  border-color: var(--hud-subpanel-border);
  box-shadow: none;
  transition: background-color 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
}

.batch-seed-popover {
  border-color: rgba(56, 189, 248, 0.25);
}

.deck-hud-panel:hover .batch-seed-popover {
  border-color: rgba(56, 189, 248, 0.42);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}

.compact-nested-solution,
.td-dp-sandbox-bar,
.td-dp-progress-card {
  background: var(--hud-subpanel-nested-bg);
  border-color: var(--hud-subpanel-border);
  transition: background-color 0.22s ease, border-color 0.22s ease;
}

.solve-solution-panel {
  border-color: rgba(52, 211, 153, 0.2);
}

.deck-hud-panel:hover .solve-solution-panel {
  border-color: rgba(52, 211, 153, 0.35);
}

.td-tree-svg {
  background: var(--hud-svg-bg);
  transition: background-color 0.22s ease;
}

.td-dp-cap-select {
  background: var(--hud-control-bg);
  border-color: rgba(52, 211, 153, 0.28);
  transition: background-color 0.22s ease, border-color 0.22s ease;
}

.deck-hud-panel:hover .td-dp-cap-select {
  border-color: rgba(52, 211, 153, 0.45);
}

/* Keep native dropdown menu items dark and readable when opened */
.td-dp-cap-select option {
  background: #0f172a;
  color: #e2e8f0;
}

.hud-glass-btn:disabled {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.06);
}

.td-recenter-pill {
  width: 20px;
  padding: 0;
  color: #94a3b8;
}

/* =========================================================
   FREE TARGET SLIDER: NEON YELLOW THEME
   ========================================================= */
.deck-hud-panel {
  --free-accent: #facc15;
  --free-text: #fde047;
  --free-glow: rgba(250, 204, 21, 0.55);
}

.free-readout {
  color: var(--free-text);
}

.free-fill {
  background: var(--free-accent);
  box-shadow: 0 0 6px rgba(250, 204, 21, 0.35);
}

.deck-hud-panel:hover .free-fill {
  box-shadow: 0 0 8px var(--free-glow);
}

.free-slider::-webkit-slider-thumb {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 11'%3E%3Cpolygon points='1,1 11,1 6,10' fill='%23facc15' stroke='%23a16207' stroke-width='1.4' stroke-linejoin='round'/%3E%3C/svg%3E");
}

.free-slider:hover::-webkit-slider-thumb {
  transform: translateY(-6px) scale(1.16);
  filter: drop-shadow(0 0 4px rgba(250, 204, 21, 0.85));
}

.free-slider::-moz-range-thumb {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 11'%3E%3Cpolygon points='1,1 11,1 6,10' fill='%23facc15' stroke='%23a16207' stroke-width='1.4' stroke-linejoin='round'/%3E%3C/svg%3E");
}

.free-glass-btn:hover:not(:disabled) {
  background: rgba(250, 204, 21, 0.12);
  border-color: rgba(250, 204, 21, 0.55);
  color: #fef08a;
  filter: drop-shadow(0 0 5px var(--free-glow));
}

/* Compact SOLVE toolbar sizing */
.td-dpad-row {
  gap: 5px;
}

.td-compact-dpad {
  gap: 3px;
  flex-shrink: 0;
}

.td-dir-side-btn {
  width: 20px;
  height: 30px;
  font-size: 9px;
}

.td-dir-half-btn {
  width: 22px;
  height: 14px;
  font-size: 7.5px;
}

.td-root-btn {
  height: 30px;
  padding: 0 6px;
  font-size: 9px;
  letter-spacing: 0.04em;
}

.td-dp-test-group {
  flex: 1;
  min-width: 0;
  gap: 4px;
}

.td-dp-test-group .td-dp-cap-select {
  flex: 1;
  min-width: 0;
  padding: 0 4px;
}

.td-dp-icon-btn {
  width: 30px;
  height: 30px;
  padding: 0;
  margin-left: 0;
  flex-shrink: 0;
}

</style>