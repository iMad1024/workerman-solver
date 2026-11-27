import { defineStore } from 'pinia';
import { useGameStore } from './game';
import { useUserStore } from './user';
import { 
  runGraphReduction, 
  buildTreeDecompositionFromGraph, 
  buildContractedDpTree,
  annotateDpTreeMetadata,
 } from '../utils/graphReduction';
import { markRaw } from 'vue';

// Module-level caches (non-reactive, outside Pinia state)
let pendingSyncRaf = null;
let cachedShuffleSeed = null;
let cachedShuffledPool = null;
let cachedFreeShuffleSeed = null;
let cachedFreeShuffledPool = null;
let lastReducedSignature = null;
let lastReducedProfitRef = null;


export const TREE_WORLD_W = 288;
export const TREE_WORLD_H = 320;


// Fast, deterministic 32-bit PRNG (Mulberry32)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Helper inside actions or module scope in stores/graph.js
function getMinReduceStep(stepsLength) {
  const userStore = useUserStore();
  if (userStore.plantzoneIconSize === 0 && stepsLength > 1) {
    return 1;
  }
  return 0;
}

function loadGraphStorage() {
  try {
    const raw = localStorage.getItem('graph');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}


export const useGraphStore = defineStore('graph', {
  state: () => {
    const saved = loadGraphStorage();
    const initialHistory =
      Array.isArray(saved.seedHistory) && saved.seedHistory.length > 0
        ? saved.seedHistory
        : ['7F3A9C'];
    const initialSeedIdx = Math.max(
      0,
      Math.min(initialHistory.length - 1, saved.seedIndex ?? 0)
    );
    const initialTargetK = saved.topKPzCount ?? 50;
    const initialSourceStep = saved.sourceScaleStep ?? 5;
    const initialFreeM = saved.freeTargetCount ?? 0;

    return {
      // Active HUD tab ('instance' | 'reduce' | 'solve')
      activeTab: saved.activeTab ?? 'instance',
      // Map override used by compact Reduce/Solve dropdowns on the INSTANCE tab
      instanceMapMode: 'instance', // 'instance' | 'reduce' | 'solve'

      // Explicit source selector: 'seed' | 'custom' | 'uploaded'
      instanceSource: 'seed',

      // Seed & Custom File State
      seedHistory: initialHistory,
      seedIndex: initialSeedIdx,
      draftSeed: saved.draftSeed ?? initialHistory[initialSeedIdx] ?? '7F3A9C',

      // Explicit Instances
      customInstance: null,
      uploadedInstance: null,
      uploadedFileName: null,

      // Row 1: Both 'prob' & 'topk' use topKPzCount
      pzMode: saved.pzMode !== undefined ? saved.pzMode : 'prob',
      topKPzCount: initialTargetK,
      liveTopKPzCount: initialTargetK,

      // Row 2: Shared 1..30 scale
      sourceMode: saved.sourceMode !== undefined ? saved.sourceMode : 'closest',
      sourceScaleStep: initialSourceStep,
      liveSourceScaleStep: initialSourceStep,

      // Row 3: Non-plantzone free targets (0..freeTargetPool.length)
      freeTargetCount: initialFreeM,
      liveFreeTargetCount: initialFreeM,

      topKSources: 5,
      isContinuousMode: saved.isContinuousMode ?? true,

      // Graph preprocessing data
      numGraphs: 0,
      reducedGraph: [],
      reduceStepIndex: 0,

      // Users' choice
      targetList: [],
      sourceList: {},
      townList: [],

      // Instance generation
      pSelectPz: 0,
      kProfitPz: 0,
      kNearestTown: 0,
      distCutoff: 1,

      // Solver related
      treeDecomposition: null,
      contractedTreeDecomposition: null,
      tdViewMode: 'join', // 'full' (Min-Fill TD) | 'join' (Contracted Join/DP Tree)
      activeBagId: null,
      treeCam: { x: 0, y: 0, w: TREE_WORLD_W, h: TREE_WORLD_H },
      niceTree: [],
      DPTable: [],
      solvedNodeValues: [],

      dpSolution: null,
      showSolutionView: false, // toggles Solution Overlay vs. usual TD Bag/Component view
      solutionGraphMode: 'reduced', // 'reduced' | 'original'
      dpSolutions: [],
      activeSolutionIndex: 0,

      legendResetTick: 0,
      hoveredMapEntity: null, // null | { type: 'node', key: number } | { type: 'edge', a: number, b: number }
    };
  },

  getters: {
    freeTargetPool() {
      const gameStore = useGameStore();
      const links = gameStore.links || {};
      const nodes = gameStore.nodes || {};
      const townSet = this.baseTownSet;
      const pool = [];

      for (const key of Object.keys(links)) {
        const id = Number(key);
        if (!Number.isFinite(id) || townSet.has(id)) continue;
        const node = nodes[key];
        if (!node || node.is_plantzone) continue;
        if (node.CP === 0 && (node.kind === 10 || node.kind === 13)) continue;
        pool.push(id);
      }

      pool.sort((a, b) => a - b);
      return pool;
    },
    
    activeDecomposition(state) {
      if (state.tdViewMode === 'join' && state.contractedTreeDecomposition) {
        return state.contractedTreeDecomposition;
      }
      return state.treeDecomposition;
    },

    // Getter:
    activeTreeNode(state) {
      const td = this.activeDecomposition;
      if (!td || !td.nodes?.length) return null;
      const id = Number(state.activeBagId ?? td.rootId);
      return td.nodes[id] ?? td.nodes[td.rootId] ?? null;
    },

    // Classifies every vertex in the active bag by its separator relationship with parent & children
    activeBagPartition() {
      const td = this.activeDecomposition;
      const node = this.activeTreeNode;
      if (!td || !node) return [];

      const parentSet = new Set(
        node.parent != null ? (td.nodes[node.parent]?.bag ?? []) : []
      );
      const childSet = new Set();
      for (const cid of node.children || []) {
        for (const v of td.nodes[cid]?.bag ?? []) {
          childSet.add(v);
        }
      }

      return node.bag.map((v) => {
        const inParent = parentSet.has(v);
        const inChild = childSet.has(v);
        let role = 'bag-only';
        if (inParent && inChild) role = 'shared-both';
        else if (inParent) role = 'parent-sep';
        else if (inChild) role = 'child-sep';

        return { key: v, inParent, inChild, role };
      });
    },

    activeSeed(state) {
      return state.seedHistory[state.seedIndex] ?? '';
    },
    isSeedActive(state) {
      return state.instanceSource === 'seed';
    },
    canGoPrevSeed(state) {
      return state.seedIndex > 0;
    },
    canGoNextSeed(state) {
      return state.seedIndex < state.seedHistory.length - 1;
    },
    // Visual indicator text (e.g., "50/100")
    seedPositionLabel(state) {
      return `${state.seedIndex + 1}/${state.seedHistory.length}`;
    },
    liveStabilityThresholdR(state) {
      return Number((1.0 + (state.liveSourceScaleStep - 1) * 0.02).toFixed(2));
    },

    stabilityThresholdR(state) {
      return Number((1.0 + (state.sourceScaleStep - 1) * 0.02).toFixed(2));
    },

    // Snapshot 0 (with plantzones) when plantzoneIconSize > 0, else Snapshot 1 (CLEANUP)
    originalBaseSnapshot(state) {
      if (!state.reducedGraph?.length) return null;
      const userStore = useUserStore();
      if (Number(userStore.plantzoneIconSize) > 0) {
        return state.reducedGraph[0] ?? null;
      }
      return state.reducedGraph[1] ?? state.reducedGraph[0] ?? null;
    },

    effectiveMapMode(state) {
      if (state.activeTab === 'reduce') return 'reduce';
      if (state.activeTab === 'solve') return 'solve';
      return state.instanceMapMode || 'instance';
    },

    activeReduceSnapshot(state) {
      const mode = this.effectiveMapMode;
      if ((mode !== 'reduce' && mode !== 'solve') || !state.reducedGraph?.length) {
        return null;
      }
      const min = getMinReduceStep(state.reducedGraph.length);
      const max = Math.max(min, state.reducedGraph.length - 1);
      const idx = Math.max(min, Math.min(max, state.reduceStepIndex ?? min));
      return state.reducedGraph[idx] ?? null;
    },

    isSolutionOverlayActive(state) {
      return Boolean(
        state.showSolutionView &&
        state.dpSolution?.selectedVertices?.length
      );
    },

    isOriginalSolutionView(state) {
      return Boolean(
        this.isSolutionOverlayActive &&
        state.solutionGraphMode === 'original' &&
        this.originalBaseSnapshot
      );
    },

    // Exact targets in the raw instance (without plantzone->parent expansion)
    rawTargetSet() {
      return new Set((this.currentInstance?.targets ?? []).map(Number));
    },

    // Snapshot currently rendered by NodeMap (original base snapshot in ORIG view, otherwise active step)
    displayReduceSnapshot() {
      if (this.isOriginalSolutionView) {
        return this.originalBaseSnapshot;
      }
      return this.activeReduceSnapshot;
    },

    // Selected vertices for the active solution, unwrapped via `nodeClusters` in ORIG view
    dpSelectedVertexSet(state) {
      const rawVerts = state.dpSolution?.selectedVertices || [];
      if (!rawVerts.length) return new Set();

      if (!this.isOriginalSolutionView) {
        return new Set(rawVerts.map(Number));
      }

      const activeSnap =
        state.dpSolution?.stepIndex != null
          ? state.reducedGraph?.[state.dpSolution.stepIndex]
          : (this.activeReduceSnapshot ?? state.reducedGraph?.[state.reducedGraph.length - 1]);
      const origSnap = this.originalBaseSnapshot;
      const clusters = activeSnap?.nodeClusters || {};
      const origGraph = origSnap?.graph || {};
      const unwrapped = new Set();

      const hasInOrig = (id) =>
        origGraph[id] !== undefined || origGraph[String(id)] !== undefined;

      const addCluster = (u) => {
        const members = clusters[u] ?? clusters[String(u)];
        if (Array.isArray(members) && members.length > 0) {
          for (const m of members) {
            const numM = Number(m);
            if (hasInOrig(numM)) unwrapped.add(numM);
          }
        } else {
          const numU = Number(u);
          if (hasInOrig(numU)) unwrapped.add(numU);
        }
      };

      for (const u of rawVerts) {
        addCluster(u);
      }

      const fullTd = activeSnap?.decomposition ?? state.treeDecomposition;
      const rootOrigId = fullTd?.rootId;
      const isFullRoot =
        state.dpSolution?.bagId == null ||
        rootOrigId == null ||
        Number(state.dpSolution.bagId) === Number(rootOrigId);

      if (isFullRoot && Array.isArray(activeSnap?.towns)) {
        for (const townId of activeSnap.towns) {
          const members = clusters[townId] ?? clusters[String(townId)];
          if (Array.isArray(members) && members.length > 1) {
            addCluster(townId);
          }
        }
      }

      return unwrapped;
    },

    // Single unified getter for NodeMap.vue, Reduction, and Solver
    currentInstance(state) {
      if (state.instanceSource === 'uploaded' && state.uploadedInstance) {
        return state.uploadedInstance;
      }
      if (state.instanceSource === 'custom' && state.customInstance) {
        return state.customInstance;
      }
      // Reconstruct deterministically from activeSeed + parameters
      return this.buildSeededInstance();
    },

    // Optional set of surviving node keys (null on 'instance' tab = show all standard map nodes)
    activeNodeSet() {
      const snap = this.displayReduceSnapshot;
      if (!snap) return null;
      return new Set(Object.keys(snap.graph).map(Number));
    },

    getActiveGraphLinks() {
      const snap = this.displayReduceSnapshot;
      if (snap) {
        return snap.graph;
      }

      const tmpLinks = {};
      const gameStore = useGameStore();
      const userStore = useUserStore();

      if (userStore.plantzoneIconSize === 0) {
        for (const [key, neighbhor] of Object.entries(gameStore.links)) {
          if (gameStore.nodes[key]?.is_plantzone) continue;
          if (gameStore.nodes[key].CP === 0 && (gameStore.nodes[key].kind === 10 || gameStore.nodes[key].kind === 13)) continue;
          tmpLinks[key] = neighbhor.filter(
            (d) =>
              !gameStore.nodes[d].is_plantzone &&
              (gameStore.nodes[d].CP > 0 || (gameStore.nodes[d].kind !== 10 && gameStore.nodes[d].kind !== 13))
          );
        }
        return tmpLinks;
      }
      return gameStore.links;
    },

    getActiveTarget() {
      const snap = this.displayReduceSnapshot;
      if (snap) {
        return snap.targets;
      }
      return this.currentInstance.targets;
    },

    getActiveSource() {
      const snap = this.displayReduceSnapshot;
      if (snap) {
        return snap.assignments;
      }
      const assignments = this.currentInstance?.assignments ?? [];
      return Object.fromEntries(assignments.map(({ targetId, sourceId }) => [targetId, sourceId]));
    },

    targetSet() {
      const snap = this.displayReduceSnapshot;
      if (snap) {
        return new Set(snap.targets);
      }

      const userStore = useUserStore();
      const gameStore = useGameStore();
      const targets = this.currentInstance?.targets ?? [];
      if (userStore.plantzoneIconSize > 0) return new Set(targets);

      const tmp = new Set();
      for (const pzk of targets) {
        tmp.add(pzk);
        const parent = gameStore.plantzoneStatic[String(pzk)]?.parent;
        if (parent != null) tmp.add(parent);
      }
      return tmp;
    },

    parentSet() {
      const gameStore = useGameStore();
      const parent = new Set();
      if (!gameStore.ready || !gameStore.nodes) return parent;

      for (const [key, node] of Object.entries(gameStore.plantzoneStatic)) {
        if (node.parent) {
          parent.add(node.parent);
        }
      }
      return parent;
    },

    plantzoneSet() {
      const tmpSet = new Set();
      const gameStore = useGameStore();
      for (const [key, node] of Object.entries(gameStore.nodes)) {
        const kind = gameStore?.nodes[key]?.kind;
        if (kind === 10 || kind === 12 || kind === 13) continue;
        if (gameStore.nodes[key]?.is_plantzone) tmpSet.add(node.key);
      }
      return tmpSet;
    },

    baseTownSet() {
      const tmpSet = new Set();
      const gameStore = useGameStore();
      for (const [key, node] of Object.entries(gameStore.nodes || {})) {
        if (node.CP === 0 && (node.kind === 1 || node.kind === 2)) tmpSet.add(Number(key));
      }
      return tmpSet;
    },

    townSet() {
      const snap = this.displayReduceSnapshot;
      if (snap && Array.isArray(snap.towns)) {
        return new Set(snap.towns.map(Number));
      }
      return this.baseTownSet;
    },

    // Inside graphStore getters:
    sortedPlantzonesByEfficiency() {
      const gameStore = useGameStore();
      const allPzProfit = gameStore.allPzProfit || {};

      const getEfficiency = (pzk) => {
        const price = allPzProfit[pzk]?.alt_towns?.[0]?.priceDaily ?? 0;
        const cp = gameStore.nodes?.[pzk]?.CP;
        return cp > 0 ? price / cp : 0;
      };

      return Object.keys(allPzProfit)
        .map((pzk) => Number(pzk))
        .sort((a, b) => getEfficiency(b) - getEfficiency(a) || a - b);
    },

    instanceStats() {
      return this.currentInstance?.stats ?? {
        totalCP: 0,
        totalSilver: 0,
        maxSilver: 0,
        efficiencyPct: 0,
      };
    },
  },

  actions: {
    resetSolveLegend() {
      this.legendResetTick++;
    },

    setDpSolutions(solutionsList) {
      this.dpSolutions = Array.isArray(solutionsList) ? solutionsList : [];
      if (this.dpSolutions.length > 0) {
        // Default to the lowest-cost solution (usually the last stage)
        let bestIdx = 0;
        for (let i = 1; i < this.dpSolutions.length; i++) {
          if (this.dpSolutions[i].minCost <= this.dpSolutions[bestIdx].minCost) {
            bestIdx = i;
          }
        }
        this.selectDpSolutionIndex(bestIdx);
      } else {
        this.clearDpSolution();
      }
    },
    selectDpSolutionIndex(idx) {
      const sol = this.dpSolutions[idx];
      if (!sol) return;
      this.activeSolutionIndex = idx;
      this.dpSolution = sol;
      this.showSolutionView = true;
    },

    setDpSolution(payload) {
      this.dpSolution = payload;
      if (payload?.selectedVertices?.length) {
        this.showSolutionView = true;
      }
    },
    
    clearDpSolution() {
      this.dpSolution = null;
      this.showSolutionView = false;
      this.solutionGraphMode = 'reduced';
      this.dpSolutions = [];
      this.activeSolutionIndex = 0;
    },

    setSolutionViewMode(mode) {
      if (mode === 'td') {
        this.showSolutionView = false;
        return;
      }
      if (!this.dpSolution) return;
      if (mode === 'reduced' || mode === 'original') {
        this.solutionGraphMode = mode;
        this.showSolutionView = true;
      }
    },

    toggleSolutionView() {
      if (!this.dpSolution) return;
      this.showSolutionView = !this.showSolutionView;
    },
    
    setTdViewMode(mode) {
      if (mode !== 'full' && mode !== 'join') return;
      if (this.tdViewMode === mode) return;

      const prevNode = this.activeTreeNode;
      const currOrigId = Number(
        prevNode?.origBagId ?? prevNode?.id ?? this.treeDecomposition?.rootId ?? 0
      );

      this.tdViewMode = mode;
      const nextTd = this.activeDecomposition;
      if (!nextTd || !nextTd.nodes?.length) return;

      if (mode === 'full') {
        this.activeBagId = nextTd.nodes[currOrigId] ? currOrigId : nextTd.rootId;
      } else {
        // Switching full -> join: snap up to nearest kept ancestor and store its join-tree `id`
        const fullNodes = this.treeDecomposition?.nodes || [];
        const joinNodes = nextTd.nodes;
        let probeId = currOrigId;

        while (probeId != null) {
          const hit =
            joinNodes.find((n) => Number(n.origBagId) === probeId && !n.isClone) ||
            joinNodes.find((n) => Number(n.origBagId) === probeId);
          if (hit) {
            this.activeBagId = hit.id;
            return;
          }
          const parentId = fullNodes[probeId]?.parent;
          probeId = parentId != null ? Number(parentId) : null;
        }
        this.activeBagId = nextTd.rootId;
      }
    },

    // Syncs `treeDecomposition` from the active snapshot if precomputed, otherwise clears it until user clicks Compute
    syncSolveDecomposition() {
      const snap = this.activeReduceSnapshot;
      if (!snap) {
        this.treeDecomposition = null;
        this.contractedTreeDecomposition = null;
        this.activeBagId = null;
        return;
      }
      if (snap.decomposition) {
        const isSameDecomposition = this.treeDecomposition === snap.decomposition;
        if (snap.decomposition.stats?.totalGroups === undefined) {
          annotateDpTreeMetadata(snap.decomposition, snap);
        }
        this.treeDecomposition = markRaw(snap.decomposition);

        if (!snap.contractedDecomposition) {
          const contracted = buildContractedDpTree(snap.decomposition, { binaryJoins: true });
          snap.contractedDecomposition = annotateDpTreeMetadata(contracted, snap);
        }
        this.contractedTreeDecomposition = markRaw(snap.contractedDecomposition);

        const activeTd = this.activeDecomposition;
        const maxId = (activeTd?.nodes?.length ?? 1) - 1;
        if (!isSameDecomposition || this.activeBagId == null || this.activeBagId > maxId) {
          this.activeBagId = activeTd?.rootId ?? 0;
          this.treeCam = { x: 0, y: 0, w: TREE_WORLD_W, h: TREE_WORLD_H };
        }

        // const maxOrigId = (snap.decomposition.nodes?.length ?? 1) - 1;
        // if (!isSameDecomposition || this.activeBagId == null || this.activeBagId > maxOrigId) {
        //   this.activeBagId = snap.decomposition.rootId;
        //   this.treeCam = { x: 0, y: 0, w: TREE_WORLD_W, h: TREE_WORLD_H };
        // }
      } else {
        this.treeDecomposition = null;
        this.contractedTreeDecomposition = null;
        this.activeBagId = null;
      }
    },

    // On-demand button action for intermediate reduction steps
    computeCurrentStepTreeDecomposition() {
      const snap = this.activeReduceSnapshot;
      if (!snap || !snap.graph) return;
      const td = annotateDpTreeMetadata(buildTreeDecompositionFromGraph(snap.graph), snap);
      const contracted = annotateDpTreeMetadata(
        buildContractedDpTree(td, { binaryJoins: true }),
        snap
      );
      snap.decomposition = td;
      snap.contractedDecomposition = contracted;
      this.treeDecomposition = markRaw(td);
      this.contractedTreeDecomposition = markRaw(contracted);
      //this.activeBagId = td.rootId;
      this.activeBagId = this.activeDecomposition?.rootId ?? 0;
      this.treeCam = { x: 0, y: 0, w: TREE_WORLD_W, h: TREE_WORLD_H };
    },

    setReduceStep(idx) {
      const min = getMinReduceStep(this.reducedGraph.length);
      const max = Math.max(min, this.reducedGraph.length - 1);
      this.reduceStepIndex = Math.max(min, Math.min(max, Number(idx) || 0));
      this.syncSolveDecomposition();
      this.clearDpSolution();
    },



    // Updates live slider readout immediately; commits to graph either via rAF (continuous) or on release
    setLiveTargetCount(val, isFinal = false) {
      if (this.showSolutionView || this.dpSolution) this.clearDpSolution();
      this.instanceMapMode = 'instance';
      this.liveTopKPzCount = val;
      if (isFinal) {
        if (pendingSyncRaf) {
          cancelAnimationFrame(pendingSyncRaf);
          pendingSyncRaf = null;
        }
        this.topKPzCount = val;
        this.sourceScaleStep = this.liveSourceScaleStep;
        this.freeTargetCount = this.liveFreeTargetCount;
        return;
      }
      if (this.isContinuousMode) {
        this.scheduleSync();
      }
    },

    setLiveSourceStep(val, isFinal = false) {
      if (this.showSolutionView || this.dpSolution) this.clearDpSolution();
      this.instanceMapMode = 'instance';
      this.liveSourceScaleStep = val;
      if (isFinal) {
        if (pendingSyncRaf) {
          cancelAnimationFrame(pendingSyncRaf);
          pendingSyncRaf = null;
        }
        this.sourceScaleStep = val;
        this.topKPzCount = this.liveTopKPzCount;
        this.freeTargetCount = this.liveFreeTargetCount;
        return;
      }
      if (this.isContinuousMode) {
        this.scheduleSync();
      }
    },

    setLiveFreeTargetCount(val, isFinal = false) {
      this.instanceMapMode = 'instance';
      if (this.showSolutionView || this.dpSolution) this.clearDpSolution();
      const maxFree = this.freeTargetPool.length;
      const clamped = Math.max(0, Math.min(maxFree, Math.floor(Number(val) || 0)));
      this.liveFreeTargetCount = clamped;
      if (isFinal) {
        if (pendingSyncRaf) {
          cancelAnimationFrame(pendingSyncRaf);
          pendingSyncRaf = null;
        }
        this.freeTargetCount = clamped;
        this.topKPzCount = this.liveTopKPzCount;
        this.sourceScaleStep = this.liveSourceScaleStep;
        return;
      }
      if (this.isContinuousMode) {
        this.scheduleSync();
      }
    },

    scheduleSync() {
      if (pendingSyncRaf) return;
      pendingSyncRaf = requestAnimationFrame(() => {
        pendingSyncRaf = null;
        this.topKPzCount = this.liveTopKPzCount;
        this.sourceScaleStep = this.liveSourceScaleStep;
        this.freeTargetCount = this.liveFreeTargetCount;
      });
    },

    setInstanceMapMode(mode) {
      if (mode !== 'instance' && mode !== 'reduce' && mode !== 'solve') return;
      this.instanceMapMode = mode;
      if (mode !== 'solve') {
        this.showSolutionView = false;
      }
    },

    setActiveTab(tab) {
      this.activeTab = tab;
      if (tab !== 'instance') {
        this.instanceMapMode = 'instance';
      }
      if (tab === 'reduce') {
        this.showSolutionView = false;
      }
    },

    setInstanceSource(source) {
      if (source === 'custom' && !this.customInstance) return;
      if (source === 'uploaded' && !this.uploadedInstance) return;
      this.instanceSource = source;
      this.instanceMapMode = 'instance';
      this.clearDpSolution();
    },

    computeInstanceStats(targets, assignments) {
      const gameStore = useGameStore();
      const nodes = gameStore.nodes || {};
      const allPzProfit = gameStore.allPzProfit || {};
      const assignMap = new Map();
      for (const a of assignments || []) {
        if (a?.targetId != null && a?.sourceId != null) {
          assignMap.set(Number(a.targetId), Number(a.sourceId));
        }
      }

      let totalCP = 0;
      let totalSilver = 0;
      let maxSilver = 0;

      for (const rawT of targets || []) {
        const t = Number(rawT);
        const tStr = String(t);
        totalCP += Number(nodes[tStr]?.CP) || 0;

        const altTowns = Array.isArray(allPzProfit[tStr]?.alt_towns)
          ? allPzProfit[tStr].alt_towns
          : [];
        if (altTowns.length > 0) {
          maxSilver += Number(altTowns[0]?.priceDaily) || 0;
          const src = assignMap.get(t);
          if (src != null) {
            const matched = altTowns.find((e) => Number(e?.tnk) === src);
            if (matched) totalSilver += Number(matched.priceDaily) || 0;
          }
        }
      }

      const efficiencyPct = maxSilver > 0 ? (totalSilver / maxSilver) * 100 : 0;
      return { totalCP, totalSilver, maxSilver, efficiencyPct };
    },

    ensureCustomInstance() {
      if (this.instanceSource !== 'custom' || !this.customInstance) {
        const base = this.currentInstance;
        const targets = [...new Set((base?.targets ?? []).map(Number))];
        const assignments = (base?.assignments ?? []).map((a) => ({
          targetId: Number(a.targetId),
          sourceId: a.sourceId != null ? Number(a.sourceId) : null,
        }));
        this.customInstance = {
          sourceType: 'custom',
          seed: base?.seed ?? this.activeSeed,
          targets,
          assignments,
          stats: this.computeInstanceStats(targets, assignments),
        };
        this.instanceSource = 'custom';
      }
      return this.customInstance;
    },

    modifyTarget(pzk) {
      const gameStore = useGameStore();
      const userStore = useUserStore();
      const id = Number(pzk);
      if (!Number.isFinite(id) || this.baseTownSet.has(id)) return;

      const base = this.ensureCustomInstance();
      const targetSet = new Set(base.targets.map(Number));
      const assignMap = new Map();
      for (const a of base.assignments || []) {
        if (a?.targetId != null) {
          assignMap.set(Number(a.targetId), a.sourceId != null ? Number(a.sourceId) : null);
        }
      }

      const children = (gameStore.nodes?.[String(id)]?.children || []).map(Number);
      const selectedChildren = children.filter((c) => targetSet.has(c));

      if (targetSet.has(id)) {
        targetSet.delete(id);
        assignMap.delete(id);
        // When unchecking a parent node, also clear any selected child plantzones
        for (const c of selectedChildren) {
          targetSet.delete(c);
          assignMap.delete(c);
        }
      } else if (Number(userStore.plantzoneIconSize) === 0 && selectedChildren.length > 0) {
        // Clicking a red parent while plantzones are hidden toggles its child targets off
        for (const c of selectedChildren) {
          targetSet.delete(c);
          assignMap.delete(c);
        }
      } else {
        targetSet.add(id);
        if (!assignMap.has(id)) assignMap.set(id, null);
      }

      const targets = [...targetSet];
      const assignments = targets.map((t) => ({
        targetId: t,
        sourceId: assignMap.has(t) ? assignMap.get(t) : null,
      }));

      this.customInstance = {
        ...base,
        sourceType: 'custom',
        targets,
        assignments,
        stats: this.computeInstanceStats(targets, assignments),
      };
      this.instanceSource = 'custom';
      this.instanceMapMode = 'instance';
      this.clearDpSolution();
    },

    setNodeTown(child, townKey) {
      const id = Number(child);
      if (!Number.isFinite(id) || this.baseTownSet.has(id)) return;

      const base = this.ensureCustomInstance();
      const targetSet = new Set(base.targets.map(Number));
      const assignMap = new Map();
      for (const a of base.assignments || []) {
        if (a?.targetId != null) {
          assignMap.set(Number(a.targetId), a.sourceId != null ? Number(a.sourceId) : null);
        }
      }

      targetSet.add(id);
      assignMap.set(id, townKey != null && townKey !== '' ? Number(townKey) : null);

      const targets = [...targetSet];
      const assignments = targets.map((t) => ({
        targetId: t,
        sourceId: assignMap.has(t) ? assignMap.get(t) : null,
      }));

      this.customInstance = {
        ...base,
        sourceType: 'custom',
        targets,
        assignments,
        stats: this.computeInstanceStats(targets, assignments),
      };
      this.instanceSource = 'custom';
      this.instanceMapMode = 'instance';
      this.clearDpSolution();
    },

    // Copy either uploaded or current seeded instance into customInstance for editing
    forkToCustomInstance() {
      const base = this.currentInstance;
      this.customInstance = JSON.parse(JSON.stringify(base));
      this.instanceSource = 'custom';
    },

    togglePzMode(mode) {
      if (this.showSolutionView || this.dpSolution) this.clearDpSolution();
      this.pzMode = this.pzMode === mode ? null : mode;
      this.instanceMapMode = 'instance';
    },

    toggleSourceMode(mode) {
      if (this.showSolutionView || this.dpSolution) this.clearDpSolution();
      this.sourceMode = this.sourceMode === mode ? null : mode;
      this.instanceMapMode = 'instance';
    },

    toggleContinuousMode() {
      this.isContinuousMode = !this.isContinuousMode;
      // When turning continuous mode ON, immediately sync any pending slider positions
      if (this.isContinuousMode) {
        this.topKPzCount = this.liveTopKPzCount;
        this.sourceScaleStep = this.liveSourceScaleStep;
        this.freeTargetCount = this.liveFreeTargetCount;
      }
    },

    // 1. User types in the field -> updates draft and detaches active seed lock
    setDraftSeed(val) {
      this.draftSeed = val;
      if (this.instanceSource === 'seed') {
        this.instanceSource = this.uploadedInstance ? 'uploaded' : 'custom';
      }
    },

    // 2. Refresh button -> pushes new random hex seed to history
    rerollSeed() {
      if (this.showSolutionView || this.dpSolution) this.clearDpSolution();
      const nextHex = Math.floor(Math.random() * 0xffffff)
        .toString(16)
        .padStart(6, '0')
        .toUpperCase();

      this.seedHistory = this.seedHistory.slice(0, this.seedIndex + 1);
      this.seedHistory.push(nextHex);
      this.seedIndex = this.seedHistory.length - 1;

      this.draftSeed = nextHex;
      this.instanceSource = 'seed';
      this.instanceMapMode = 'instance';
    },

    // 3. Checkmark button or Enter key -> commits typed seed to history & applies it
    commitDraftSeed() {
      if (this.showSolutionView || this.dpSolution) this.clearDpSolution();
      const trimmed = (this.draftSeed || '').trim();
      if (!trimmed) return;

      if (trimmed !== this.activeSeed) {
        this.seedHistory = this.seedHistory.slice(0, this.seedIndex + 1);
        this.seedHistory.push(trimmed);
        this.seedIndex = this.seedHistory.length - 1;
      }

      this.draftSeed = trimmed;
      this.instanceSource = 'seed';
      this.instanceMapMode = 'instance';
    },

    // 4. Previous / Next navigation
    prevSeed() {
      if (this.showSolutionView || this.dpSolution) this.clearDpSolution();
      if (!this.canGoPrevSeed) return;
      this.seedIndex--;
      this.draftSeed = this.activeSeed;
      this.instanceSource = 'seed';
      this.instanceMapMode = 'instance';
    },

    nextSeed() {
      if (this.showSolutionView || this.dpSolution) this.clearDpSolution();
      if (!this.canGoNextSeed) return;
      this.seedIndex++;
      this.draftSeed = this.activeSeed;
      this.instanceSource = 'seed';
      this.instanceMapMode = 'instance';
    },

    // Multi-step jump (clamped to [0, length - 1])
    jumpSeed(delta) {
      if (this.showSolutionView || this.dpSolution) this.clearDpSolution();
      if (!this.seedHistory.length) return;
      const target = Math.max(
        0,
        Math.min(this.seedHistory.length - 1, this.seedIndex + delta)
      );
      if (target === this.seedIndex) return;

      this.seedIndex = target;
      this.draftSeed = this.activeSeed;
      this.instanceSource = 'seed';
      this.instanceMapMode = 'instance';
    },

    // Batch generation: appends N new random seeds and jumps to the first newly generated one
    generateBatchSeeds(count) {
      if (this.showSolutionView || this.dpSolution) this.clearDpSolution();
      const n = Math.max(1, Math.min(1000, Math.floor(Number(count) || 0)));
      if (n <= 0) return;

      this.seedHistory = this.seedHistory.slice(0, this.seedIndex + 1);
      const firstNewIndex = this.seedHistory.length;

      for (let i = 0; i < n; i++) {
        const hex = Math.floor(Math.random() * 0xffffff)
          .toString(16)
          .padStart(6, '0')
          .toUpperCase();
        this.seedHistory.push(hex);
      }

      this.seedIndex = firstNewIndex;
      this.draftSeed = this.activeSeed;
      this.instanceSource = 'seed';
      this.instanceMapMode = 'instance';
    },

    // String-to-32-bit hash (FNV-1a) so any string seed works deterministically
    hashSeedToUint32(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return h >>> 0;
    },


    buildSeededInstance() {
      const gameStore = useGameStore();
      const seedUint = this.hashSeedToUint32(this.activeSeed);
      const rng = mulberry32(seedUint);
      const nodes = gameStore.nodes || {};

      const hasPzSelection = Boolean(this.pzMode) && this.topKPzCount > 0;
      const freePoolAll = this.freeTargetPool;
      const mFree = Math.max(
        0,
        Math.min(freePoolAll.length, Math.floor(Number(this.freeTargetCount) || 0))
      );

      if (!hasPzSelection && mFree === 0) {
        return {
          sourceType: 'seed',
          seed: this.activeSeed,
          targets: [],
          assignments: [],
          stats: {
            totalCP: 0,
            totalSilver: 0,
            maxSilver: 0,
            efficiencyPct: 0,
          },
        };
      }

      const totalPz = this.plantzoneSet.size;
      const kTargets = hasPzSelection ? Math.max(0, Math.min(totalPz, this.topKPzCount)) : 0;
      let selectedTargets = [];

      // 1. Plantzone Target Generation (cached Fisher-Yates permutation per seed)
      if (kTargets > 0) {
        if (this.pzMode === 'topk') {
          selectedTargets = this.sortedPlantzonesByEfficiency.slice(0, kTargets);
        } else {
          if (
            cachedShuffleSeed !== this.activeSeed ||
            !cachedShuffledPool ||
            cachedShuffledPool.length !== totalPz
          ) {
            const pool = [...this.plantzoneSet];
            const shuffleRng = mulberry32(seedUint);
            for (let i = pool.length - 1; i > 0; i--) {
              const j = Math.floor(shuffleRng() * (i + 1));
              [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            cachedShuffleSeed = this.activeSeed;
            cachedShuffledPool = pool;
          }
          selectedTargets = cachedShuffledPool.slice(0, kTargets);
        }
      }

      // 2. Source Town Assignment & Telemetry Accumulation
      const allPzProfit = gameStore.allPzProfit || {};
      const townCount = this.baseTownSet.size;
      const kSources = Math.max(1, Math.min(townCount || 30, this.sourceScaleStep));
      const rThreshold = this.stabilityThresholdR;

      let totalCP = 0;
      let totalSilver = 0;
      let maxSilver = 0;

      const targetMeta = selectedTargets.map((pz) => {
        const targetId = typeof pz === 'object' ? Number(pz.id) : Number(pz);
        const targetStr = String(targetId);
        totalCP += Number(nodes[targetStr]?.CP) || 0;

        const altTowns = Array.isArray(allPzProfit[targetStr]?.alt_towns)
          ? allPzProfit[targetStr].alt_towns
          : [];
        const bestSilver = altTowns.length > 0 ? Number(altTowns[0]?.priceDaily) || 0 : 0;
        maxSilver += bestSilver;

        return { targetId, targetStr, altTowns };
      });

      let assignments = [];

      if (this.sourceMode === 'closest' && townCount > 0) {
        assignments = targetMeta.map(({ targetId, altTowns }) => {
          if (altTowns.length === 0) return { targetId, sourceId: null };

          const poolLen = Math.min(kSources, altTowns.length);
          const chosenEntry = altTowns[Math.floor(rng() * poolLen)];
          const sourceId = chosenEntry?.tnk != null ? Number(chosenEntry.tnk) : null;

          if (sourceId != null) {
            totalSilver += Number(chosenEntry.priceDaily) || 0;
          }
          return { targetId, sourceId };
        });
      } else if (this.sourceMode === 'rings') {
        const candidateTownSet = new Set(this.baseTownSet);
        for (const { altTowns } of targetMeta) {
          for (const entry of altTowns) {
            if (entry?.tnk != null && (Number(entry?.priceDaily) || 0) > 0) {
              candidateTownSet.add(Number(entry.tnk));
            }
          }
        }

        const townOrder = [...candidateTownSet];
        for (let i = townOrder.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [townOrder[i], townOrder[j]] = [townOrder[j], townOrder[i]];
        }

        const townPrefs = new Map();
        for (const townId of townOrder) townPrefs.set(townId, []);

        const currentMatch = new Map();
        for (const { targetId, altTowns } of targetMeta) {
          currentMatch.set(targetId, { sourceId: null, profit: 0 });
          for (const entry of altTowns) {
            const tnk = Number(entry?.tnk);
            const profit = Number(entry?.priceDaily) || 0;
            if (profit > 0 && townPrefs.has(tnk)) {
              townPrefs.get(tnk).push({ targetId, profit });
            }
          }
        }

        for (const list of townPrefs.values()) {
          list.sort((a, b) => b.profit - a.profit || a.targetId - b.targetId);
        }

        const nextProposalIdx = new Map(townOrder.map((t) => [t, 0]));
        let hasPendingProposals = true;
        while (hasPendingProposals) {
          hasPendingProposals = false;
          for (const townId of townOrder) {
            const prefs = townPrefs.get(townId);
            const idx = nextProposalIdx.get(townId);
            if (!prefs || idx >= prefs.length) continue;

            hasPendingProposals = true;
            const { targetId, profit } = prefs[idx];
            nextProposalIdx.set(townId, idx + 1);

            const incumbent = currentMatch.get(targetId);
            if (incumbent.sourceId === null) {
              currentMatch.set(targetId, { sourceId: townId, profit });
            } else if (incumbent.sourceId !== townId && profit > rThreshold * incumbent.profit) {
              currentMatch.set(targetId, { sourceId: townId, profit });
            }
          }
        }

        assignments = targetMeta.map(({ targetId }) => {
          const match = currentMatch.get(targetId);
          if (match && match.sourceId !== null) {
            totalSilver += match.profit;
            return { targetId, sourceId: match.sourceId, stabilityR: rThreshold };
          }
          return { targetId, sourceId: null, stabilityR: rThreshold };
        });
      } else {
        assignments = targetMeta.map(({ targetId }) => ({ targetId, sourceId: null }));
      }

      // 3. Free Non-Plantzone Targets (cached Fisher-Yates permutation using the same seed)
      const targets = [...selectedTargets];
      if (mFree > 0) {
        if (
          cachedFreeShuffleSeed !== this.activeSeed ||
          !cachedFreeShuffledPool ||
          cachedFreeShuffledPool.length !== freePoolAll.length
        ) {
          const pool = [...freePoolAll];
          const freeRng = mulberry32(seedUint);
          for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(freeRng() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          cachedFreeShuffleSeed = this.activeSeed;
          cachedFreeShuffledPool = pool;
        }

        const chosenFree = cachedFreeShuffledPool.slice(0, mFree);
        const targetSet = new Set(targets.map(Number));
        for (const nodeId of chosenFree) {
          if (!targetSet.has(nodeId)) {
            targetSet.add(nodeId);
            targets.push(nodeId);
            assignments.push({ targetId: nodeId, sourceId: null });
            totalCP += Number(nodes[String(nodeId)]?.CP) || 0;
          }
        }
      }

      const efficiencyPct = maxSilver > 0 ? (totalSilver / maxSilver) * 100 : 0;
      return {
        sourceType: 'seed',
        seed: this.activeSeed,
        targets,
        assignments,
        stats: { totalCP, totalSilver, maxSilver, efficiencyPct },
      };
    },


    // Parses and loads a legacy/external targets <-> sources JSON assignment
    loadInstanceFromJson(parsed, fileName = 'custom.json') {
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid JSON root structure.');
      }

      const hasValidPayload =
        Array.isArray(parsed.targets) ||
        Array.isArray(parsed.sources) ||
        Array.isArray(parsed.pairs) ||
        Array.isArray(parsed.terminals);

      if (!hasValidPayload) {
        throw new Error('JSON must contain targets, sources, pairs, or terminals.');
      }

      const cloned = JSON.parse(JSON.stringify(parsed));
      if (!cloned.stats && Array.isArray(cloned.targets)) {
        cloned.stats = this.computeInstanceStats(cloned.targets, cloned.assignments || []);
      }
      this.uploadedInstance = cloned;
      this.uploadedFileName = fileName;
      this.instanceSource = 'uploaded';
      this.instanceMapMode = 'instance';
      this.clearDpSolution();
    },


    // Inside actions of useGraphStore:
    preprocessGraph(force = false) {
      const gameStore = useGameStore();
      const linkCount = Object.keys(gameStore.links || {}).length;
      const profitCount = Object.keys(gameStore.allPzProfit || {}).length;
      const needsProfit = this.instanceSource === 'seed' && this.pzMode && this.topKPzCount > 0;

      if (!gameStore.ready || linkCount === 0 || (needsProfit && profitCount === 0)) {
        return;
      }

      const inst = this.currentInstance;
      const customSig =
        this.instanceSource === 'seed'
          ? ''
          : JSON.stringify({
              t: inst?.targets ?? [],
              a: inst?.assignments ?? [],
            });

      const sig =
        this.instanceSource === 'seed'
          ? `seed:${this.activeSeed}:${this.pzMode}:${this.topKPzCount}:${this.sourceMode}:${this.sourceScaleStep}:${this.freeTargetCount}`
          : `${this.instanceSource}:${this.uploadedFileName || ''}:${customSig}`;

      if (
        !force &&
        sig === lastReducedSignature &&
        lastReducedProfitRef === gameStore.allPzProfit &&
        this.reducedGraph.length > 0
      ) {
        return;
      }

      const { steps, decomposition } = runGraphReduction({
        links: gameStore.links,
        nodes: gameStore.nodes,
        plantzoneStatic: gameStore.plantzoneStatic,
        townSet: this.baseTownSet,
        plantzoneSet: this.plantzoneSet,
        instance: inst,
      });

      this.reducedGraph = markRaw(steps);
      this.numGraphs = steps.length;
      this.reduceStepIndex = Math.max(0, steps.length - 1);
      this.syncSolveDecomposition();
      lastReducedSignature = sig;
      lastReducedProfitRef = gameStore.allPzProfit;

      this.clearDpSolution();
    },


    clearInstance() {
      this.targetList = [];
      this.sourceList = {};
      this.townList = [];

      this.numGraphs = 0;
      this.reducedGraph = [];

      this.treeDecomposition = [];
      this.niceTree = [];
      this.DPTable = [];
      this.solvedNodeValues = [];

      this.reducedGraph = markRaw([]);
      lastReducedSignature = null;
    },

    
  },
});