<template>
  <div
    class="highs-test-panel"
    :style="{ transform: `translate3d(${panelPos.x}px, ${panelPos.y}px, 0)` }"
    @mousedown.stop
  >
    <!-- Header -->
    <div class="ht-header" @mousedown="startDrag">
      <div class="ht-title-group">
        <span class="ht-grip">⋮⋮</span>
        <span class="ht-dot" :class="{ running: isRunning }"></span>
        <span class="ht-title">Empire HiGHS (WASM) Cut Testbed</span>
      </div>
      <button type="button" class="ht-icon-btn" @click="$emit('close')">✕</button>
    </div>

    <!-- Model Parameters -->
    <div class="ht-params-grid">
      <label class="ht-field">
        <span>CP Cap</span>
        <input v-model.number="cpCap" type="number" min="10" max="1000" step="10" />
      </label>
      <label class="ht-field">
        <span>Top-K/PZ</span>
        <input v-model.number="topKTowns" type="number" min="1" max="35" step="1" />
      </label>
      <label class="ht-field">
        <span>MIP Lim (s)</span>
        <input v-model.number="mipTimeLimit" type="number" min="1" max="600" step="5" />
      </label>
      <label class="ht-field">
        <span>MIP Gap (%)</span>
        <input v-model.number="mipGapPct" type="number" min="0" max="5" step="0.01" />
      </label>
      <label class="ht-field" title="Intermediate Phase 2 fast-harvest cap in seconds (0 = off)">
        <span>Fast Cap (s)</span>
        <input v-model.number="fastTimeLimit" type="number" min="0" max="120" step="5" />
      </label>
    </div>

    <!-- Flow & Corridor Controls -->
    <div class="ht-toggle-row">
      <label class="ht-inline-field" title="Auxiliary MIP flow formulation">
        <span>MIP Flow</span>
        <select v-model="flowMode">
          <option value="none">Cuts Only</option>
          <option value="any-town">Hybrid A (Any-Town)</option>
          <option value="capped">Hybrid B-lite (Capped)</option>
          <option value="both">Hybrid A + B-lite</option>
        </select>
      </label>

      <label
        v-if="flowMode === 'capped' || flowMode === 'both'"
        class="ht-inline-field ht-detour-field"
        title="Corridor detour CP slack around shortest paths (999 = full component)"
      >
        <span>Detour</span>
        <input v-model.number="corridorDetourCP" type="number" min="0" max="999" step="2" />
      </label>

      <label class="ht-checkbox" title="Seed 1-hop aggregate cuts on build">
        <input v-model="seedOneHopCuts" type="checkbox" />
        <span>1-hop</span>
      </label>

      <label
        v-if="flowMode === 'capped' || flowMode === 'both'"
        class="ht-checkbox"
        title="Auto-promote towns with cross-town MIP violations to B-lite local flow"
      >
        <input v-model="autoPromoteFlow" type="checkbox" />
        <span>Auto+t</span>
      </label>

      <button type="button" class="ht-btn ht-btn-primary" :disabled="isRunning" @click="initModel">
        Build / Reset
      </button>
      <button v-if="isRunning" type="button" class="ht-btn ht-btn-danger" @click="haltWorker">
        HALT
      </button>
    </div>

    <!-- Collapsible Per-Town Lodging Editor -->
    <div class="ht-section">
      <div class="ht-section-header" @click="showLodging = !showLodging">
        <span>{{ showLodging ? '▾' : '▸' }} Town Lodging Caps ({{ townList.length }} towns)</span>
        <div class="ht-preset-row" @click.stop>
          <button type="button" class="ht-mini-btn" @click="setAllLodging(5)">All 5</button>
          <button type="button" class="ht-mini-btn" @click="setAllLodging(10)">All 10</button>
          <button type="button" class="ht-mini-btn" @click="setAllLodging(20)">All 20</button>
          <button type="button" class="ht-mini-btn" @click="setAllLodging(99)">∞</button>
        </div>
      </div>

      <div v-if="showLodging" class="ht-lodging-grid">
        <label v-for="t in townList" :key="t.id" class="ht-lodging-item" :title="`#${t.id} ${t.name}`">
          <span class="ht-town-name">{{ t.name }}</span>
          <input
            v-model.number="lodgingMap[t.id]"
            type="number"
            min="0"
            max="200"
            step="1"
          />
        </label>
      </div>
    </div>

    <!-- Action Bar: LP Relaxation -> Cut Inspection -> MIP Branching -->
    <div class="ht-action-bar">
      <button type="button" class="ht-btn" :disabled="!overview || isRunning" @click="solveLp(false)">
        Solve LP (Inspect)
      </button>
      <button type="button" class="ht-btn" :disabled="!overview || isRunning" @click="solveLp(true)">
        +1 LP Cut Round
      </button>
      <button type="button" class="ht-btn ht-btn-cyan" :disabled="!overview || isRunning" @click="runPhase1">
        Phase 1 (LP Loop)
      </button>
      <button type="button" class="ht-btn" :disabled="!overview || isRunning" @click="solveMip(true)">
        Solve MIP (1 Pass)
      </button>
      <button type="button" class="ht-btn ht-btn-mint" :disabled="!overview || isRunning" @click="runPhase2">
        Phase 2 (MIP Loop)
      </button>
    </div>

    <div v-if="errorMsg" class="ht-error">{{ errorMsg }}</div>

    <!-- Telemetry Strip -->
    <div v-if="overview" class="ht-stats-strip">
      <div
        class="ht-stat"
        :title="overview.targetedTownNames?.length
          ? `B-lite targeted towns (${overview.targetedTownCount}): ${overview.targetedTownNames.join(', ')}`
          : `x=${overview.numRoadNodes}, z=${overview.numZVars}, y=${overview.numYVars}, flow=${overview.numFlowVars}`"
      >
        <span class="lbl">
          VARS (x/z/f<template v-if="overview.targetedTownCount">·{{ overview.targetedTownCount }}t</template>)
        </span>
        <span class="val">
          {{ overview.numRoadNodes }}/{{ overview.numZVars }}/{{ overview.numFlowVars }}
        </span>
      </div>
      <div class="ht-stat">
        <span class="lbl">CUTS (LP/INT)</span>
        <span class="val cyan">{{ lpCutCount }} / {{ intCutCount }}</span>
      </div>
      <div class="ht-stat">
        <span class="lbl">ROOT LP</span>
        <span class="val">{{ latestLpObj != null ? latestLpObj.toFixed(1) : '—' }}</span>
      </div>
      <div class="ht-stat">
        <span class="lbl">MIP / GAP</span>
        <span class="val mint">
          {{ latestMipObj != null ? latestMipObj.toFixed(1) : '—' }}
          <small v-if="lpMipGapPct != null">({{ lpMipGapPct.toFixed(2) }}%)</small>
        </span>
      </div>
    </div>

    <!-- Sub-tabs: Rounds/Branching Log | Cut Inspector | Solution/Towns -->
    <div class="ht-tabs">
      <button type="button" :class="{ active: subTab === 'log' }" @click="subTab = 'log'">
        Branching Log ({{ roundLog.length }})
      </button>
      <button type="button" :class="{ active: subTab === 'cuts' }" @click="subTab = 'cuts'">
        Cuts ({{ cuts.length }})
      </button>
      <button type="button" :class="{ active: subTab === 'usage' }" @click="subTab = 'usage'">
        Towns / Raw Log
      </button>
    </div>

    <!-- TAB A: Round & Branching Telemetry Table -->
    <div v-if="subTab === 'log'" class="ht-tab-body">
      <div class="ht-log-toolbar">
        <span class="ht-muted">
          MIP Nodes: <strong>{{ totalBbNodes }}</strong> · Time:
          <strong>{{ totalElapsedMs.toFixed(0) }}ms</strong>
          <template v-if="bestFeasibleObj != null">
            · Best Feas: <strong class="mint">{{ bestFeasibleObj.toFixed(2) }}</strong>
          </template>
        </span>
        <button type="button" class="ht-mini-btn" :disabled="!roundLog.length" @click="copyLogCsv">
          {{ csvCopied ? 'Copied' : 'Copy CSV' }}
        </button>
      </div>

      <div class="ht-table-wrap">
        <table class="ht-table">
          <thead>
            <tr>
              <th>Ph</th>
              <th>#</th>
              <th>ms</th>
              <th>Obj</th>
              <th>Cuts+</th>
              <th>Frac x/z</th>
              <th>Nodes</th>
              <th>Iters</th>
              <th>Gap%</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, idx) in roundLog"
              :key="idx"
              :class="{
                selected: selectedLogIdx === idx,
                'row-mip': r.phase === 'MIP',
                'row-opt': r.isCertifiedOpt,
                'row-feas': r.isFeasible && !r.isCertifiedOpt && !r.isTimedOut,
                'row-tl': r.isFeasible && r.isTimedOut
              }"
              @click="selectedLogIdx = idx"
            >
              <td class="col-ph" :title="r.status">
                <span class="pill" :class="`pill-${r.phase.toLowerCase()}`">{{ r.phase }}</span>
                <span v-if="r.isCertifiedOpt" class="pill pill-opt" title="Connected & Optimal within MIP Gap">OPT</span>
                <span v-else-if="r.isFeasible && r.isTimedOut" class="pill pill-warn" title="Connected incumbent, but HiGHS hit time limit">FEAS·TL</span>
                <span v-else-if="r.isFeasible" class="pill pill-feas" title="Connected integer empire (fast mode)">FEAS</span>
              </td>
              <td>{{ r.round }}</td>
              <td>{{ r.elapsedMs }}</td>
              <td>{{ r.objective != null ? r.objective.toFixed(1) : '—' }}</td>
              <td>{{ r.injected }}/{{ r.violatedFound }}</td>
              <td>{{ r.fracX }}/{{ r.fracZ }}</td>
              <td>{{ r.bbNodes ?? '—' }}</td>
              <td>{{ r.lpIters ?? '—' }}</td>
              <td>{{ r.mipGapPct != null ? r.mipGapPct.toFixed(2) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB B: Cut Inspector -->
    <div v-else-if="subTab === 'cuts'" class="ht-tab-body">
      <div class="ht-log-toolbar">
        <div class="ht-preset-row">
          <button type="button" class="ht-mini-btn" :class="{ active: cutFilter === 'ALL' }" @click="cutFilter = 'ALL'">
            All ({{ cuts.length }})
          </button>
          <button type="button" class="ht-mini-btn" :class="{ active: cutFilter === 'LP' }" @click="cutFilter = 'LP'">
            LP ({{ lpCutCount }})
          </button>
          <button type="button" class="ht-mini-btn" :class="{ active: cutFilter === 'INT' }" @click="cutFilter = 'INT'">
            INT ({{ intCutCount }})
          </button>
        </div>
        <span class="ht-muted">Showing {{ Math.min(filteredCuts.length, 150) }}</span>
      </div>

      <div class="ht-cut-list">
        <div v-for="c in filteredCuts.slice(0, 150)" :key="c.id" class="ht-cut-card">
          <div class="ht-cut-top">
            <span class="pill" :class="`pill-${c.kind.toLowerCase()}`">{{ c.kind }} r{{ c.round }}</span>
            <span>
              {{ nodeName(c.parentId) }} → {{ nodeName(c.townId) }}
            </span>
            <span class="ht-muted">
              |S|={{ c.cutNodeIds.length }}
              <template v-if="c.violation != null"> · viol {{ c.violation }}</template>
            </span>
          </div>
          <div class="ht-cut-expr">
            Σ({{ c.cutNodeIds.map((id) => `${id}:${nodeName(id)}`).join(', ') }}) ≥ {{ c.yName }}
          </div>
        </div>
      </div>
    </div>

    <!-- TAB C: Town Usage & Raw HiGHS Stdout for Selected Round -->
    <div v-else class="ht-tab-body">
      <div v-if="selectedRound?.summary" class="ht-usage-summary">
        <div>
          CP: <strong>{{ selectedRound.summary.totalCpSpent }}</strong> / {{ cpCap }}
          (Roads {{ selectedRound.summary.roadCpSpent }}, PZs {{ selectedRound.summary.pzCpSpent }}) ·
          PZs: <strong>{{ selectedRound.summary.assignedPzs }}</strong>
          <span v-if="selectedRound.isCertifiedOpt" class="pill pill-opt" style="margin-left: 6px">OPT</span>
          <span v-else-if="selectedRound.isFeasible && selectedRound.isTimedOut" class="pill pill-warn" style="margin-left: 6px">FEAS (TIMED OUT)</span>
          <span v-else-if="selectedRound.isFeasible" class="pill pill-feas" style="margin-left: 6px">CONNECTED</span>
        </div>
        <div class="ht-town-chips">
          <span v-for="t in selectedRound.summary.townUsage" :key="t.id" class="ht-town-chip">
            {{ t.name }}: {{ t.used.toFixed(1) }}/{{ t.lodging }} ({{ t.profit.toFixed(1) }}M)
          </span>
        </div>
      </div>

      <pre class="ht-raw-log">{{ (selectedRound?.rawLog || []).join('\n') || 'Select a round in Branching Log to inspect raw HiGHS stdout.' }}</pre>
    </div>
  </div>
</template>

<script>
import { useGameStore } from '../stores/game';
//import EmpireHighsWorker from '../workers/empireHighs.worker.js?worker';

export default {
  name: 'EmpireHighsTestPanel',
  emits: ['close'],
  setup() {
    const gameStore = useGameStore();
    return { gameStore };
  },
  data() {
    return {
      panelPos: { x: 0, y: 0 },
      isDragging: false,
      dragStart: { mx: 0, my: 0, px: 0, py: 0 },

      cpCap: 600,
      topKTowns: 5,
      mipTimeLimit: 30,
      mipGapPct: 0.01,
      fastTimeLimit: 15,
      seedOneHopCuts: true,
      flowMode: 'capped', // 'none' | 'any-town' | 'capped' | 'both'
      corridorDetourCP: 6,
      autoPromoteFlow: true,

      showLodging: false,
      lodgingMap: {},

      worker: null,
      reqCounter: 0,
      isRunning: false,
      errorMsg: '',

      overview: null,
      cuts: [],
      roundLog: [],
      selectedLogIdx: -1,
      subTab: 'log',
      cutFilter: 'ALL',
      csvCopied: false,
    };
  },
  computed: {
    townList() {
      const nodes = this.gameStore.nodes || {};
      const uloc = this.gameStore.uloc?.node || {};
      const list = [];
      for (const [k, n] of Object.entries(nodes)) {
        if (n && Number(n.CP) === 0 && (n.kind === 1 || n.kind === 2)) {
          const id = Number(k);
          list.push({ id, name: uloc[id] || uloc[k] || `Town #${id}` });
        }
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      return list;
    },
    lpCutCount() {
      return this.cuts.filter((c) => c.kind === 'LP').length;
    },
    intCutCount() {
      return this.cuts.filter((c) => c.kind === 'INT').length;
    },
    filteredCuts() {
      if (this.cutFilter === 'ALL') return this.cuts;
      return this.cuts.filter((c) => c.kind === this.cutFilter);
    },
    latestLpObj() {
      for (let i = this.roundLog.length - 1; i >= 0; i--) {
        if (this.roundLog[i].phase === 'LP' && this.roundLog[i].objective != null) {
          return this.roundLog[i].objective;
        }
      }
      return null;
    },
    latestMipObj() {
      for (let i = this.roundLog.length - 1; i >= 0; i--) {
        if (this.roundLog[i].phase === 'MIP' && this.roundLog[i].objective != null) {
          return this.roundLog[i].objective;
        }
      }
      return null;
    },
    bestFeasibleObj() {
      let best = null;
      for (const r of this.roundLog) {
        if (r.isFeasible && r.objective != null && (best == null || r.objective > best)) {
          best = r.objective;
        }
      }
      return best;
    },
    lpMipGapPct() {
      if (this.latestLpObj == null || this.latestMipObj == null || this.latestMipObj <= 0) return null;
      return ((this.latestLpObj - this.latestMipObj) / this.latestMipObj) * 100;
    },
    totalBbNodes() {
      return this.roundLog.reduce((s, r) => s + (r.bbNodes || 0), 0);
    },
    totalElapsedMs() {
      return this.roundLog.reduce((s, r) => s + (r.elapsedMs || 0), 0);
    },
    selectedRound() {
      return this.roundLog[this.selectedLogIdx] ?? this.roundLog[this.roundLog.length - 1] ?? null;
    },
  },
  watch: {
    townList: {
      immediate: true,
      handler(list) {
        for (const t of list) {
          if (this.lodgingMap[t.id] === undefined) {
            this.lodgingMap[t.id] = 10;
          }
        }
      },
    },
  },
  methods: {
    nodeName(id) {
      return this.overview?.nodeNames?.[id] || this.gameStore.uloc?.node?.[id] || `#${id}`;
    },
    setAllLodging(val) {
      for (const t of this.townList) this.lodgingMap[t.id] = val;
    },
    ensureWorker() {
      if (this.worker) return this.worker;
      const w = new EmpireHighsWorker();
      w.onmessage = (e) => {
        const msg = e.data;
        if (!msg || msg.reqId !== this.reqCounter) return;

        if (msg.overview) this.overview = msg.overview;
        if (msg.cuts) this.cuts = msg.cuts;

        if (msg.type === 'roundProgress' && msg.roundEntry) {
          this.roundLog.push(msg.roundEntry);
          this.selectedLogIdx = this.roundLog.length - 1;
        } else if (msg.type === 'done') {
          if (msg.roundEntry) {
            this.roundLog.push(msg.roundEntry);
            this.selectedLogIdx = this.roundLog.length - 1;
          }
          this.isRunning = false;
        } else if (msg.type === 'error') {
          this.errorMsg = msg.error;
          this.isRunning = false;
        }
      };
      w.onerror = (err) => {
        this.errorMsg = err?.message || 'Worker crashed';
        this.isRunning = false;
      };
      this.worker = w;
      return w;
    },
    haltWorker() {
      this.reqCounter++;
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      this.isRunning = false;
      this.overview = null;
    },
    sendCmd(cmd, payload = {}) {
      this.errorMsg = '';
      const w = this.ensureWorker();
      const reqId = ++this.reqCounter;
      this.isRunning = true;
      w.postMessage({ cmd, reqId, payload });
    },
    initModel() {
      if (!this.gameStore.ready) {
        this.errorMsg = 'gameStore not ready yet.';
        return;
      }
      this.roundLog = [];
      this.cuts = [];
      this.selectedLogIdx = -1;

      const raw = {
        links: JSON.parse(JSON.stringify(this.gameStore.links || {})),
        nodes: JSON.parse(JSON.stringify(this.gameStore.nodes || {})),
        plantzoneStatic: JSON.parse(JSON.stringify(this.gameStore.plantzoneStatic || {})),
        allPzProfit: JSON.parse(JSON.stringify(this.gameStore.allPzProfit || {})),
        uloc: JSON.parse(JSON.stringify(this.gameStore.uloc?.node || {})),
      };

      this.sendCmd('initModel', {
        raw,
        options: {
          cpCap: this.cpCap,
          topKTowns: this.topKTowns,
          seedOneHopCuts: this.seedOneHopCuts,
          flowMode: this.flowMode,
          corridorDetourCP: this.corridorDetourCP,
          autoPromoteFlow: this.autoPromoteFlow,
          lodgingMap: { ...this.lodgingMap },
        },
      });
    },
    solveLp(injectViolated) {
      this.sendCmd('solveLpStep', { injectViolated, cutEps: 1e-3 });
    },
    runPhase1() {
      this.sendCmd('runPhase1', { maxRounds: 25, cutEps: 1e-3 });
    },
    solveMip(injectViolated) {
      this.sendCmd('solveMipStep', {
        injectViolated,
        timeLimit: this.mipTimeLimit,
        mipRelGap: this.mipGapPct / 100,
        flowMode: this.flowMode,
        corridorDetourCP: this.corridorDetourCP,
        autoPromoteFlow: this.autoPromoteFlow,
      });
    },
    runPhase2() {
      this.sendCmd('runPhase2', {
        maxRounds: 25,
        timeLimit: this.mipTimeLimit,
        mipRelGap: this.mipGapPct / 100,
        harvestTimeLimit: this.fastTimeLimit,
        flowMode: this.flowMode,
        corridorDetourCP: this.corridorDetourCP,
        autoPromoteFlow: this.autoPromoteFlow,
      });
    },
    async copyLogCsv() {
      const hdr = 'phase,round,status,feasible,certified_opt,elapsed_ms,objective,cuts_before,violated,injected,frac_x,frac_z,bb_nodes,lp_iters,mip_gap_pct,presolve';
      const rows = this.roundLog.map((r) =>
        [
          r.phase, r.round, `"${r.status}"`, r.isFeasible ? 1 : 0, r.isCertifiedOpt ? 1 : 0,
          r.elapsedMs, r.objective ?? '', r.totalCutsBefore, r.violatedFound, r.injected,
          r.fracX, r.fracZ, r.bbNodes ?? '', r.lpIters ?? '', r.mipGapPct ?? '', r.presolve,
        ].join(',')
      );
      await navigator.clipboard.writeText([hdr, ...rows].join('\n'));
      this.csvCopied = true;
      setTimeout(() => (this.csvCopied = false), 1400);
    },
    startDrag(e) {
      if (e.button !== 0 || e.target.closest('button')) return;
      this.isDragging = true;
      this.dragStart = { mx: e.clientX, my: e.clientY, px: this.panelPos.x, py: this.panelPos.y };
      window.addEventListener('mousemove', this.onDrag);
      window.addEventListener('mouseup', this.stopDrag);
    },
    onDrag(e) {
      if (!this.isDragging) return;
      this.panelPos = {
        x: this.dragStart.px + (e.clientX - this.dragStart.mx),
        y: this.dragStart.py + (e.clientY - this.dragStart.my),
      };
    },
    stopDrag() {
      this.isDragging = false;
      window.removeEventListener('mousemove', this.onDrag);
      window.removeEventListener('mouseup', this.stopDrag);
    },
  },
  beforeUnmount() {
    this.stopDrag();
    if (this.worker) this.worker.terminate();
  },
};
</script>

<style scoped>
.highs-test-panel {
  position: fixed;
  top: 64px;
  left: 24px;
  z-index: 1000010;
  width: 560px;
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(13, 18, 26, 0.92);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(56, 189, 248, 0.35);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.72);
  color: #cbd5e1;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 11px;
}

.ht-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: grab;
  user-select: none;
}

.ht-title-group {
  display: flex;
  align-items: center;
  gap: 7px;
}

.ht-grip { color: #475569; letter-spacing: -1.5px; }
.ht-dot { width: 8px; height: 8px; border-radius: 50%; background: #38bdf8; }
.ht-dot.running { background: #facc15; box-shadow: 0 0 8px #facc15; }
.ht-title { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #93c5fd; }

.ht-icon-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #94a3b8;
  border-radius: 5px;
  width: 22px;
  height: 22px;
  cursor: pointer;
}

.ht-params-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}

.ht-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 9.5px;
  color: #94a3b8;
}

.ht-field input,
.ht-lodging-item input,
.ht-inline-field select,
.ht-inline-field input {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 4px;
  color: #f8fafc;
  font-family: ui-monospace, monospace;
  font-size: 10.5px;
  padding: 3px 5px;
  box-sizing: border-box;
}

.ht-field input { width: 100%; }
.ht-inline-field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #94a3b8;
}
.ht-inline-field select option { background: #0f172a; color: #f8fafc; }
.ht-detour-field input { width: 42px; text-align: right; }

.ht-toggle-row,
.ht-action-bar,
.ht-preset-row,
.ht-log-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ht-log-toolbar { justify-content: space-between; }

.ht-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #cbd5e1;
  font-size: 10px;
}

.ht-toggle-row .ht-btn-primary {
  margin-left: auto;
}

.ht-btn,
.ht-mini-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #cbd5e1;
  border-radius: 5px;
  padding: 4px 8px;
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
}

.ht-mini-btn { padding: 2px 6px; font-size: 9.5px; }
.ht-mini-btn.active { border-color: #38bdf8; color: #e0f2fe; background: rgba(56, 189, 248, 0.18); }

.ht-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.ht-btn-primary { border-color: rgba(56, 189, 248, 0.55); color: #bae6fd; }
.ht-btn-cyan { border-color: rgba(56, 189, 248, 0.65); background: rgba(56, 189, 248, 0.14); color: #e0f2fe; }
.ht-btn-mint { border-color: rgba(52, 211, 153, 0.65); background: rgba(52, 211, 153, 0.14); color: #a7f3d0; }
.ht-btn-danger { border-color: rgba(244, 63, 94, 0.65); background: rgba(244, 63, 94, 0.18); color: #fecdd3; }

.ht-section {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.02);
}

.ht-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  font-weight: 600;
  color: #93c5fd;
}

.ht-lodging-grid {
  margin-top: 6px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
  max-height: 145px;
  overflow-y: auto;
}

.ht-lodging-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  font-size: 10px;
}

.ht-town-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 96px;
}

.ht-lodging-item input { width: 42px; text-align: right; }

.ht-stats-strip {
  display: grid;
  grid-template-columns: 1.3fr 1fr 0.85fr 1fr;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-family: ui-monospace, monospace;
}

.ht-stat { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.ht-stat .lbl { font-size: 9px; color: #64748b; }
.ht-stat .val { font-size: 11px; font-weight: 700; color: #f8fafc; white-space: nowrap; }
.ht-stat .val.cyan { color: #38bdf8; }
.ht-stat .val.mint, .mint { color: #34d399; }

.ht-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.ht-tabs button {
  padding: 4px 0;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: #94a3b8;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}

.ht-tabs button.active {
  background: rgba(56, 189, 248, 0.16);
  border-color: rgba(56, 189, 248, 0.5);
  color: #e0f2fe;
}

.ht-tab-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow: hidden;
}

.ht-table-wrap,
.ht-cut-list {
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 6px;
}

.ht-table {
  width: 100%;
  border-collapse: collapse;
  font-family: ui-monospace, monospace;
  font-size: 10px;
}

.ht-table th,
.ht-table td {
  padding: 4px 5px;
  text-align: right;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.ht-table th { color: #64748b; position: sticky; top: 0; background: #0f1621; }
.ht-table tbody tr { cursor: pointer; }
.ht-table tbody tr.selected { background: rgba(56, 189, 248, 0.16); }
.ht-table tbody tr.row-mip { color: #a7f3d0; }
.ht-table tbody tr.row-opt { background: rgba(16, 185, 129, 0.2); }
.ht-table tbody tr.row-feas { background: rgba(56, 189, 248, 0.12); }
.ht-table tbody tr.row-tl { background: rgba(245, 158, 11, 0.12); }

.col-ph {
  text-align: left !important;
  white-space: nowrap;
}

.pill {
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
}
.pill-lp { background: rgba(56, 189, 248, 0.2); color: #7dd3fc; }
.pill-mip, .pill-int { background: rgba(52, 211, 153, 0.2); color: #6ee7b7; }
.pill-init { background: rgba(148, 163, 184, 0.2); color: #cbd5e1; }
.pill-opt {
  margin-left: 3px;
  background: rgba(16, 185, 129, 0.35);
  border: 1px solid rgba(52, 211, 153, 0.8);
  color: #ecfdf5;
}
.pill-feas {
  margin-left: 3px;
  background: rgba(56, 189, 248, 0.24);
  border: 1px solid rgba(56, 189, 248, 0.65);
  color: #e0f2fe;
}
.pill-warn {
  margin-left: 3px;
  background: rgba(245, 158, 11, 0.26);
  border: 1px solid rgba(251, 191, 36, 0.7);
  color: #fef3c7;
}

.ht-cut-list { display: flex; flex-direction: column; gap: 4px; padding: 5px; }
.ht-cut-card {
  padding: 4px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
  font-family: ui-monospace, monospace;
  font-size: 9.5px;
}
.ht-cut-top { display: flex; justify-content: space-between; gap: 6px; margin-bottom: 2px; }
.ht-cut-expr { color: #93c5fd; word-break: break-word; }

.ht-usage-summary {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 10.5px;
}
.ht-town-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.ht-town-chip {
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(52, 211, 153, 0.12);
  border: 1px solid rgba(52, 211, 153, 0.35);
  color: #a7f3d0;
  font-family: ui-monospace, monospace;
  font-size: 9.5px;
}

.ht-raw-log {
  margin: 0;
  max-height: 170px;
  overflow: auto;
  padding: 6px;
  border-radius: 5px;
  background: rgba(2, 6, 23, 0.85);
  font-family: ui-monospace, monospace;
  font-size: 9px;
  color: #94a3b8;
  white-space: pre-wrap;
}

.ht-error { color: #fda4af; font-size: 10.5px; }
.ht-muted { color: #64748b; font-size: 10px; }
</style>