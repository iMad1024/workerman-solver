<template>
  <div class="exp-inline-card" @mousedown.stop>
    <!-- Collapsible Header -->
    <div class="exp-card-header" @click="isExpanded = !isExpanded">
      <div class="exp-header-left">
        <span class="exp-caret">{{ isExpanded ? '▾' : '▸' }}</span>
        <span class="exp-title">Experiment</span>
      </div>
      <div class="exp-header-right" @click.stop>
        <button
          v-if="isExpanded"
          type="button"
          class="exp-mini-btn"
          @click="syncFromGraphStore"
          title="Copy current Target/Source settings from Graph Processing panel"
        >
          Sync
        </button>
        <button
          v-if="rows.length > 0 || isRunning"
          type="button"
          class="exp-mini-btn exp-open-btn"
          :class="{ 'is-active': showPopup }"
          @click="togglePopup"
          :title="showPopup ? 'Hide results popup window' : 'Show results popup window at default position'"
        >
          <span class="exp-toggle-dot"></span>
          <span>{{ isRunning ? `${progress.index}/${progress.total}` : `View (${rows.length})` }}</span>
        </button>
      </div>
    </div>

    <!-- Compact Parameter Form -->
    <div v-if="isExpanded" class="exp-form">
      <div class="exp-row">
        <label class="exp-label">Batch</label>
        <input
          type="number"
          :value="config.batchSize"
          min="1"
          max="10000"
          step="1"
          class="exp-input"
          :disabled="isRunning"
          @input="onIntInput('batchSize', 1, 10000, $event)"
          @blur="onIntBlur('batchSize', 1, 10000, $event)"
        />
      </div>

      <div class="exp-row">
        <label class="exp-label">Target</label>
        <div class="exp-pair">
          <select v-model="config.targetMode" class="exp-select" :disabled="isRunning">
            <option value="random">Random</option>
            <option value="topk">Top-K</option>
          </select>
          <input
            type="number"
            :value="config.targetK"
            min="0"
            :max="maxPlantzones"
            step="1"
            class="exp-input exp-num-sm"
            :disabled="isRunning"
            :title="`Number of plantzone targets (0..${maxPlantzones})`"
            @input="onIntInput('targetK', 0, maxPlantzones, $event)"
            @blur="onIntBlur('targetK', 0, maxPlantzones, $event)"
          />
        </div>
      </div>

      <div class="exp-row">
        <label class="exp-label">Source</label>
        <div class="exp-pair">
          <select
            v-model="config.sourceMode"
            class="exp-select"
            :disabled="isRunning"
            @change="onSourceModeChange"
          >
            <option value="closest">Closest-K</option>
            <option value="stable">Stable (r)</option>
          </select>
          <input
            v-if="config.sourceMode === 'closest'"
            type="number"
            :value="config.sourceParam"
            min="1"
            max="30"
            step="1"
            class="exp-input exp-num-sm"
            :disabled="isRunning"
            title="k closest towns (1..30)"
            @input="onIntInput('sourceParam', 1, 30, $event)"
            @blur="onIntBlur('sourceParam', 1, 30, $event)"
          />
          <input
            v-else
            type="number"
            :value="config.sourceParam"
            min="1.00"
            max="1.58"
            step="0.02"
            class="exp-input exp-num-sm"
            :disabled="isRunning"
            title="Stability threshold r (1.00..1.58, step 0.02)"
            @input="onStableRInput($event)"
            @change="onStableRCommit($event)"
            @blur="onStableRCommit($event)"
          />
        </div>
      </div>

      <div class="exp-row">
        <label class="exp-label">Free (m)</label>
        <input
          type="number"
          :value="config.freeTargetCount"
          min="0"
          :max="maxFreeNodes"
          step="1"
          class="exp-input"
          :disabled="isRunning"
          :title="`Number of non-plantzone free targets (0..${maxFreeNodes})`"
          @input="onIntInput('freeTargetCount', 0, maxFreeNodes, $event)"
          @blur="onIntBlur('freeTargetCount', 0, maxFreeNodes, $event)"
        />
      </div>

      <div class="exp-actions">
        <button
          type="button"
          class="exp-run-btn"
          :class="{ 'is-stop': isRunning }"
          @click="isRunning ? stopExperiment() : startExperiment()"
        >
          {{ isRunning ? 'STOP' : 'RUN BATCH' }}
        </button>
      </div>
    </div>

    <!-- Wider Draggable Floating Results Window -->
    <Teleport to="body">
      <div
        v-if="showPopup"
        ref="popupEl"
        class="exp-popup-window"
        :style="popupStyle"
        @mousedown.stop
      >
        <div class="exp-popup-header" @mousedown="startPopupDrag">
          <div class="exp-popup-title-group">
            <span class="exp-drag-grip">⋮⋮</span>
            <span class="exp-popup-dot" :class="{ 'is-running': isRunning }"></span>
            <span class="exp-popup-title">Experiment Benchmark Results</span>
            <span v-if="isRunning" class="exp-popup-status">
              {{ progress.index }}/{{ progress.total }} · {{ progress.seed }} · {{ progress.phase }}
            </span>
          </div>

          <div class="exp-popup-actions" @mousedown.stop>
            <button
              type="button"
              class="exp-popup-btn exp-sheets-btn"
              :disabled="rows.length === 0"
              @click="copyForSheets($event)"
              title="Copy as TSV for direct paste into Google Sheets (Shift+Click to omit header row)"
            >
              {{ copiedSheets ? 'COPIED ✓' : 'COPY SHEET' }}
            </button>
            <button
              type="button"
              class="exp-popup-btn"
              :disabled="rows.length === 0"
              @click="copyCsv"
              title="Copy raw CSV with metadata columns"
            >
              {{ copied ? 'COPIED' : 'COPY CSV' }}
            </button>
            <button
              type="button"
              class="exp-popup-btn exp-save-btn"
              :disabled="rows.length === 0"
              @click="saveCsv"
              title="Download results as CSV file"
            >
              SAVE CSV
            </button>
            <button
              v-if="isRunning"
              type="button"
              class="exp-popup-btn exp-stop-pill"
              @click="stopExperiment"
            >
              STOP
            </button>
            <button
              type="button"
              class="exp-popup-btn exp-close-btn"
              @click="showPopup = false"
              title="Hide results window"
            >
              ✕
            </button>
          </div>
        </div>

        <!-- Live Progress Bar -->
        <div v-if="isRunning" class="exp-progress-track">
          <div
            class="exp-progress-fill"
            :style="{ width: `${Math.min(100, (rows.length / Math.max(1, runConfig.batchSize)) * 100)}%` }"
          ></div>
        </div>

        <!-- Fixed Metadata Top Block -->
        <div class="exp-meta-fixed">
          <pre class="exp-text-field">{{ reportParts.metaText }}</pre>
        </div>

        <!-- Scrollable Middle Table (Column Header Sticks to Top) -->
        <div class="exp-table-scroll">
          <pre class="exp-text-field exp-table-head">{{ reportParts.headerText }}</pre>
          <pre class="exp-text-field exp-table-body">{{ reportParts.rowsText }}</pre>
        </div>

        <!-- Fixed Bottom Summary Footer -->
        <div class="exp-summary-fixed">
          <pre class="exp-text-field exp-summary-text">{{ reportParts.summaryText }}</pre>
        </div>
        <!-- Resize Handles (Right Edge, Bottom Edge, Bottom-Right Corner) -->
        <div class="exp-resize-edge exp-resize-e" @mousedown="startPopupResize('e', $event)"></div>
        <div class="exp-resize-edge exp-resize-s" @mousedown="startPopupResize('s', $event)"></div>
        <div
          class="exp-resize-corner"
          @mousedown="startPopupResize('se', $event)"
          title="Drag to resize"
        ></div>
      </div>
    </Teleport>
  </div>
</template>

<script>
import { useGameStore } from '../stores/game';
import { useGraphStore } from '../stores/graph';
import {
  buildNonPlantzonePool,
  runBatchExperiment,
  formatExperimentReportParts,
  formatExperimentCsv,
  formatExperimentTsv,
} from '../utils/experiment';

export default {
  name: 'ExperimentPanel',
  setup() {
    const gameStore = useGameStore();
    const graphStore = useGraphStore();
    return { gameStore, graphStore };
  },
  data() {
    return {
      isExpanded: false,
      showPopup: false,
      isRunning: false,
      abortFlag: false,
      activeWorkerAbort: null,
      copied: false,
      copiedSheets: false,

      config: {
        batchSize: 10,
        targetMode: 'random',
        targetK: 50,
        sourceMode: 'closest',
        sourceParam: 5,
        freeTargetCount: 0,
      },
      // Snapshot of config actually used for the current/latest run
      runConfig: {
        batchSize: 10,
        targetMode: 'random',
        targetK: 50,
        sourceMode: 'closest',
        sourceParam: 5,
        freeTargetCount: 0,
      },

      progress: {
        index: 0,
        total: 0,
        seed: '',
        phase: '',
      },
      rows: [],

      popupPos: { x: 0, y: 0 },
      isDraggingPopup: false,
      popupDragStart: { mouseX: 0, mouseY: 0, posX: 0, posY: 0 },

      popupSize: { w: null, h: null },
      isResizingPopup: false,
      resizeDir: null,
      popupResizeStart: { mouseX: 0, mouseY: 0, w: 0, h: 0 },
    };
  },
  computed: {
    popupStyle() {
      const style = {
        transform: `translate3d(${this.popupPos.x}px, ${this.popupPos.y}px, 0)`,
      };
      if (this.popupSize.w != null) style.width = `${this.popupSize.w}px`;
      if (this.popupSize.h != null) style.height = `${this.popupSize.h}px`;
      return style;
    },

    maxPlantzones() {
      return this.graphStore.plantzoneSet?.size || 370;
    },
    maxFreeNodes() {
      return this.graphStore.freeTargetPool?.length || 0;
    },
    reportParts() {
      return formatExperimentReportParts(this.runConfig, this.rows);
    },
  },
  methods: {
    togglePopup() {
      if (this.showPopup) {
        this.showPopup = false;
      } else {
        this.popupPos = { x: 0, y: 0 };
        this.popupSize = { w: null, h: null };
        this.showPopup = true;
      }
    },

    startPopupResize(dir, e) {
      if (e.button !== 0) return;
      e.preventDefault();
      const el = this.$refs.popupEl;
      if (!el) return;
      const rect = el.getBoundingClientRect();

      this.isResizingPopup = true;
      this.resizeDir = dir;
      this.popupResizeStart = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        w: rect.width,
        h: rect.height,
      };

      window.addEventListener('mousemove', this.onPopupResize);
      window.addEventListener('mouseup', this.stopPopupResize);
    },

    onPopupResize(e) {
      if (!this.isResizingPopup) return;
      const dx = e.clientX - this.popupResizeStart.mouseX;
      const dy = e.clientY - this.popupResizeStart.mouseY;

      const maxW = Math.max(520, window.innerWidth - 24);
      const maxH = Math.max(300, window.innerHeight - 24);

      if (this.resizeDir.includes('e')) {
        this.popupSize.w = Math.max(520, Math.min(maxW, Math.round(this.popupResizeStart.w + dx)));
      }
      if (this.resizeDir.includes('s')) {
        this.popupSize.h = Math.max(300, Math.min(maxH, Math.round(this.popupResizeStart.h + dy)));
      }
    },

    stopPopupResize() {
      this.isResizingPopup = false;
      this.resizeDir = null;
      window.removeEventListener('mousemove', this.onPopupResize);
      window.removeEventListener('mouseup', this.stopPopupResize);
    },

    snapStableR(val) {
      const num = Number(val);
      if (!Number.isFinite(num)) return 1.0;
      const clamped = Math.max(1.0, Math.min(1.58, num));
      const stepIdx = Math.round((clamped - 1.0) / 0.02);
      return Number((1.0 + stepIdx * 0.02).toFixed(2));
    },

    onIntInput(field, min, max, e) {
      const raw = e.target.value;
      if (raw === '') {
        this.config[field] = '';
        return;
      }
      const digitsOnly = raw.replace(/\D/g, '');
      if (digitsOnly === '') {
        this.config[field] = '';
        e.target.value = '';
        return;
      }
      let num = parseInt(digitsOnly, 10);
      if (num > max) num = max;
      this.config[field] = num;
      e.target.value = String(num);
    },

    onIntBlur(field, min, max, e) {
      const parsed = parseInt(String(this.config[field]), 10);
      const clamped = Number.isFinite(parsed)
        ? Math.max(min, Math.min(max, parsed))
        : min;
      this.config[field] = clamped;
      if (e?.target) e.target.value = String(clamped);
    },

    onStableRInput(e) {
      const raw = e.target.value;
      if (raw === '') {
        this.config.sourceParam = '';
        return;
      }
      const num = parseFloat(raw);
      if (!Number.isFinite(num)) return;

      if (num > 1.58) {
        this.config.sourceParam = 1.58;
        e.target.value = '1.58';
        return;
      }
      this.config.sourceParam = num;
    },

    onStableRCommit(e) {
      const snapped = this.snapStableR(this.config.sourceParam);
      this.config.sourceParam = snapped;
      if (e?.target) e.target.value = snapped.toFixed(2);
    },

    onSourceModeChange() {
      if (this.config.sourceMode === 'stable') {
        const val = Number(this.config.sourceParam);
        this.config.sourceParam =
          !Number.isFinite(val) || val < 1.0 || val > 1.58
            ? 1.08
            : this.snapStableR(val);
      } else {
        this.config.sourceParam = Math.max(
          1,
          Math.min(30, Math.round(Number(this.config.sourceParam) || 5))
        );
      }
    },
    
    syncFromGraphStore() {
      this.config.targetMode = this.graphStore.pzMode === 'topk' ? 'topk' : 'random';
      this.config.targetK = Number(this.graphStore.topKPzCount) || 0;
      this.config.sourceMode = this.graphStore.sourceMode === 'rings' ? 'stable' : 'closest';
      this.config.sourceParam =
        this.config.sourceMode === 'stable'
          ? this.snapStableR(this.graphStore.stabilityThresholdR)
          : Math.max(1, Math.min(30, Math.round(Number(this.graphStore.sourceScaleStep) || 5)));
      this.config.freeTargetCount = Number(this.graphStore.freeTargetCount) || 0;
    },

    stopExperiment() {
      this.abortFlag = true;
      if (typeof this.activeWorkerAbort === 'function') {
        this.activeWorkerAbort();
        this.activeWorkerAbort = null;
      }
      this.isRunning = false;
    },

    async startExperiment() {
      if (!this.gameStore.ready) return;

      if (
        (!this.gameStore.allPzProfit || Object.keys(this.gameStore.allPzProfit).length === 0) &&
        typeof this.gameStore.nearestTownProfit === 'function'
      ) {
        this.gameStore.nearestTownProfit();
      }

      this.stopExperiment();
      this.abortFlag = false;
      this.isRunning = true;
      this.rows = [];
      //this.showPopup = true;

      if (!this.showPopup) this.popupPos = { x: 0, y: 0 };
      this.showPopup = true;

      const clampedConfig = {
        batchSize: Math.max(1, Math.min(10000, Math.floor(Number(this.config.batchSize) || 1))),
        targetMode: this.config.targetMode === 'topk' ? 'topk' : 'random',
        targetK: Math.max(0, Math.min(this.maxPlantzones, Math.floor(Number(this.config.targetK) || 0))),
        sourceMode: this.config.sourceMode === 'stable' ? 'stable' : 'closest',
        sourceParam:
          this.config.sourceMode === 'stable'
            ? this.snapStableR(this.config.sourceParam)
            : Math.max(1, Math.min(30, Math.round(Number(this.config.sourceParam) || 1))),
        freeTargetCount: Math.max(
          0,
          Math.min(this.maxFreeNodes, Math.floor(Number(this.config.freeTargetCount) || 0))
        ),
      };
      this.config = { ...clampedConfig };
      this.runConfig = { ...clampedConfig };

      const plantzoneSet = this.graphStore.plantzoneSet;
      const baseTownSet = this.graphStore.baseTownSet;
      const nonPlantzonePool = buildNonPlantzonePool({
        links: this.gameStore.links,
        nodes: this.gameStore.nodes,
        plantzoneSet,
        baseTownSet,
      });

      const env = {
        links: this.gameStore.links,
        nodes: this.gameStore.nodes,
        plantzoneStatic: this.gameStore.plantzoneStatic,
        allPzProfit: this.gameStore.allPzProfit || {},
        plantzoneSet,
        baseTownSet,
        sortedPlantzonesByEfficiency: this.graphStore.sortedPlantzonesByEfficiency,
        nonPlantzonePool,
      };

      try {
        await runBatchExperiment({
          config: this.runConfig,
          env,
          shouldAbort: () => this.abortFlag,
          registerWorker: (_worker, abortFn) => {
            this.activeWorkerAbort = abortFn || null;
          },
          onProgress: (p) => {
            this.progress = p;
          },
          onRowComplete: (_row, allRows) => {
            this.rows = allRows;
          },
        });
      } catch (err) {
        console.error('[ExperimentPanel] Batch run failed:', err);
      } finally {
        this.activeWorkerAbort = null;
        this.isRunning = false;
      }
    },

    async writeToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    },

    async copyForSheets(event) {
      if (!this.rows.length) return;
      const includeHeader = !event?.shiftKey;
      const tsv = formatExperimentTsv(this.runConfig, this.rows, { includeHeader });
      await this.writeToClipboard(tsv);
      this.copiedSheets = true;
      setTimeout(() => {
        this.copiedSheets = false;
      }, 1500);
    },

    async copyCsv() {
      if (!this.rows.length) return;
      const csv = formatExperimentCsv(this.runConfig, this.rows);
      await this.writeToClipboard(csv);
      this.copied = true;
      setTimeout(() => {
        this.copied = false;
      }, 1500);
    },

    saveCsv() {
      if (!this.rows.length) return;
      const csv = formatExperimentCsv(this.runConfig, this.rows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const sp =
        this.runConfig.sourceMode === 'stable'
          ? Number(this.runConfig.sourceParam).toFixed(2)
          : Math.round(Number(this.runConfig.sourceParam) || 1);
      a.href = url;
      a.download = `steiner_exp_${this.runConfig.targetMode}_k${this.runConfig.targetK}_${this.runConfig.sourceMode}_${sp}_f${this.runConfig.freeTargetCount}_n${this.rows.length}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },

    startPopupDrag(e) {
      if (e.button !== 0) return;
      if (e.target.closest('button')) return;
      this.isDraggingPopup = true;
      this.popupDragStart = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        posX: this.popupPos.x,
        posY: this.popupPos.y,
      };
      window.addEventListener('mousemove', this.onPopupDrag);
      window.addEventListener('mouseup', this.stopPopupDrag);
    },

    onPopupDrag(e) {
      if (!this.isDraggingPopup) return;
      this.popupPos = {
        x: this.popupDragStart.posX + (e.clientX - this.popupDragStart.mouseX),
        y: this.popupDragStart.posY + (e.clientY - this.popupDragStart.mouseY),
      };
    },

    stopPopupDrag() {
      this.isDraggingPopup = false;
      window.removeEventListener('mousemove', this.onPopupDrag);
      window.removeEventListener('mouseup', this.stopPopupDrag);
    },
  },
  beforeUnmount() {
    this.stopExperiment();
    this.stopPopupDrag();
    this.stopPopupResize();
  },
};
</script>

<style scoped>
.exp-inline-card {
  width: 100%;
  box-sizing: border-box;
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(15, 20, 28, 0.72);
  border: 1px solid #333338;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #cbd5e1;
  user-select: none;
}

.exp-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  cursor: pointer;
}

.exp-header-left,
.exp-header-right {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.exp-caret {
  font-size: 10px;
  color: #38bdf8;
  width: 10px;
  text-align: center;
}

.exp-title {
  font-size: 11.5px;
  font-weight: 600;
  color: #cbd5e1;
}

.exp-mini-btn {
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.05);
  color: #94a3b8;
  font-size: 9.5px;
  font-weight: 600;
  cursor: pointer;
}

.exp-mini-btn:hover {
  border-color: rgba(56, 189, 248, 0.55);
  color: #e0f2fe;
}

.exp-open-btn {
  color: #7dd3fc;
  border-color: rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.12);
}

.exp-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.exp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.exp-label {
  font-size: 10.5px;
  color: #94a3b8;
  white-space: nowrap;
}

.exp-pair {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.exp-input,
.exp-select {
  height: 22px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(10, 14, 20, 0.75);
  color: #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  box-sizing: border-box;
  outline: none;
}

.exp-input {
  width: 64px;
}

.exp-num-sm {
  width: 52px;
}

.exp-select {
  font-family: inherit;
  font-size: 10.5px;
}

.exp-input:focus,
.exp-select:focus {
  border-color: #38bdf8;
}

.exp-actions {
  display: flex;
  margin-top: 2px;
}

.exp-run-btn {
  width: 100%;
  height: 24px;
  border-radius: 5px;
  border: 1px solid rgba(52, 211, 153, 0.5);
  background: rgba(52, 211, 153, 0.14);
  color: #6ee7b7;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.exp-run-btn:hover {
  background: rgba(52, 211, 153, 0.24);
}

.exp-run-btn.is-stop {
  border-color: rgba(244, 63, 94, 0.6);
  background: rgba(244, 63, 94, 0.18);
  color: #fda4af;
}
</style>

<style>
.exp-popup-window {
  --exp-popup-width: 1220px; /* <--- Adjust popup width here (e.g. 1040px..1300px) */
  position: fixed;
  top: 64px;
  width: var(--exp-popup-width);
  left: max(2vw, calc(50% - var(--exp-popup-width) / 2));
  max-width: 96vw;
  max-height: 92vh;
  height: 78vh;
  z-index: 1000005;
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  background: rgba(15, 20, 28, 0.94);
  backdrop-filter: blur(16px) saturate(170%);
  -webkit-backdrop-filter: blur(16px) saturate(170%);
  border: 1px solid rgba(56, 189, 248, 0.32);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.72);
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  will-change: transform;
  overflow: hidden;
}

.exp-meta-fixed {
  flex-shrink: 0;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(10, 14, 21, 0.55);
}

.exp-table-scroll {
  flex: 1;
  min-height: 160px;
  overflow: auto;
  position: relative;
}

.exp-table-head {
  position: sticky;
  top: 0;
  z-index: 2;
  width: max-content;
  min-width: 100%;
  box-sizing: border-box;
  padding: 6px 12px 2px 12px;
  background: #101620;
  color: #93c5fd;
}

.exp-table-body {
  width: max-content;
  min-width: 100%;
  box-sizing: border-box;
  padding: 2px 12px 10px 12px;
}

.exp-summary-fixed {
  flex-shrink: 0;
  padding: 7px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(10, 14, 21, 0.78);
  overflow-x: auto;
}

.exp-summary-text {
  color: #7dd3fc;
}

.exp-popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  cursor: grab;
  user-select: none;
}

.exp-popup-header:active {
  cursor: grabbing;
}

.exp-popup-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.exp-drag-grip {
  font-size: 13px;
  color: #475569;
  letter-spacing: -1.5px;
}

.exp-popup-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.7);
}

.exp-popup-dot.is-running {
  background: #38bdf8;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.9);
}

.exp-popup-title {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #93c5fd;
  white-space: nowrap;
}

.exp-popup-status {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  color: #7dd3fc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.exp-popup-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.exp-popup-btn {
  height: 24px;
  padding: 0 9px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.05);
  color: #cbd5e1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}

.exp-popup-btn:hover:not(:disabled) {
  border-color: rgba(56, 189, 248, 0.6);
  background: rgba(56, 189, 248, 0.16);
  color: #f0f9ff;
}

.exp-popup-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.exp-save-btn {
  border-color: rgba(52, 211, 153, 0.45);
  color: #6ee7b7;
}

.exp-stop-pill {
  border-color: rgba(244, 63, 94, 0.55);
  background: rgba(244, 63, 94, 0.18);
  color: #fda4af;
}

.exp-close-btn {
  width: 24px;
  padding: 0;
}

.exp-progress-track {
  height: 3px;
  background: rgba(255, 255, 255, 0.07);
  overflow: hidden;
}

.exp-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #38bdf8, #34d399);
  transition: width 0.15s ease;
}

.exp-text-field {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: #e2e8f0;
  white-space: pre;
  user-select: text;
}

.exp-open-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #94a3b8;
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  transition: all 0.15s ease;
}

.exp-toggle-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #475569;
  transition: background-color 0.15s ease, box-shadow 0.15s ease;
}

.exp-open-btn.is-active {
  color: #e0f2fe;
  border-color: rgba(56, 189, 248, 0.6);
  background: rgba(56, 189, 248, 0.18);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.25);
}

.exp-open-btn.is-active .exp-toggle-dot {
  background: #38bdf8;
  box-shadow: 0 0 5px rgba(56, 189, 248, 0.85);
}

.exp-sheets-btn {
  border-color: rgba(56, 189, 248, 0.5);
  background: rgba(56, 189, 248, 0.12);
  color: #7dd3fc;
}

.exp-resize-edge {
  position: absolute;
  z-index: 10;
}

.exp-resize-e {
  top: 0;
  right: 0;
  width: 6px;
  height: calc(100% - 14px);
  cursor: ew-resize;
}

.exp-resize-s {
  left: 0;
  bottom: 0;
  width: calc(100% - 14px);
  height: 6px;
  cursor: ns-resize;
}

.exp-resize-corner {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  z-index: 11;
  cursor: nwse-resize;
  /* Subtle diagonal grip lines matching the dark HUD */
  background: linear-gradient(
    135deg,
    transparent 45%,
    rgba(148, 163, 184, 0.45) 45%,
    rgba(148, 163, 184, 0.45) 54%,
    transparent 54%,
    transparent 68%,
    rgba(148, 163, 184, 0.45) 68%,
    rgba(148, 163, 184, 0.45) 77%,
    transparent 77%
  );
  opacity: 0.65;
  transition: opacity 0.15s ease;
}

.exp-resize-corner:hover {
  opacity: 1;
  background: linear-gradient(
    135deg,
    transparent 45%,
    rgba(56, 189, 248, 0.85) 45%,
    rgba(56, 189, 248, 0.85) 54%,
    transparent 54%,
    transparent 68%,
    rgba(56, 189, 248, 0.85) 68%,
    rgba(56, 189, 248, 0.85) 77%,
    transparent 77%
  );
}


.exp-table-scroll {
  flex: 1;
  min-height: 160px;
  overflow: auto;
  position: relative;
  padding-right: 4px;
}

.exp-resize-e {
  top: 0;
  right: 0;
  width: 3px;
  height: calc(100% - 16px);
  cursor: ew-resize;
}

.exp-resize-s {
  left: 0;
  bottom: 0;
  width: calc(100% - 16px);
  height: 3px;
  cursor: ns-resize;
}


</style>