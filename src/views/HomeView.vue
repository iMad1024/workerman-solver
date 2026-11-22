<script>
import draggable from "vuedraggable";
import {useGameStore} from '../stores/game'
import {useUserStore} from '../stores/user'
import {useRoutingStore} from '../stores/routing'
import {useMarketStore} from '../stores/market'
import {useMapStore} from '../stores/map'
import Worker from '../components/Worker.vue'
import TownWorkers from '../components/TownWorkers.vue'
import Plantzone from '../components/Plantzone.vue'
import {formatFixed, randBetween, levelup} from '../util.js'
import ModalDialog from '../components/ModalDialog.vue'
import WorkerEdit from '../components/WorkerEdit.vue'
import WorkerSendSelection from '../components/WorkerSendSelection.vue'
import LodgingSelection from '../components/LodgingSelection.vue'
import HousesSelection from '../components/HousesSelection.vue'
import NodeMap from "../components/NodeMap.vue";
import MapSelectedInfo from "../components/MapSelectedInfo.vue";
import EmpireOverview from '../components/EmpireOverview.vue'
import FloatingResourceEdit from '../components/FloatingResourceEdit.vue'
import WorkerSelection from '../components/WorkerSelection.vue'
import SearchBar from '../components/SearchBar.vue'
import ItemIcon from '../components/lo/ItemIcon.vue'
import { ref, nextTick, reactive } from "vue";

import {useGraphStore} from '../stores/graph'
import GraphProcessingPanel from '../components/GraphProcessingPanel.vue';
import ExperimentPanel from '../components/ExperimentPanel.vue';
import { buildContractedDpTree } from '../utils/graphReduction';
import SteinerDpWorker from '../workers/steinerDp.worker.js?worker';


export default {
  setup() {
    const gameStore = useGameStore()
    const userStore = useUserStore()
    const routingStore = useRoutingStore()
    const marketStore = useMarketStore()
    const mapStore = useMapStore()

    const graphStore = useGraphStore();

    /*userStore.$subscribe((mutation, state) => {
      const start = Date.now()
      localStorage.setItem('user', JSON.stringify(state))
      console.log('userStore subscription took', Date.now()-start, 'ms')
    })*/

    // Current active mode: 'og' or 'alt'
    const currentView = ref('og');

    // Alt view options and metrics
    const currentSeed = ref(1337);
    const treewidth = ref(null);
    const joinCount = ref(0);

    return {
      gameStore,
      userStore,
      routingStore,
      marketStore,
      mapStore,

      graphStore,
    };
  },
  
  components: {
    draggable,
    ItemIcon,
    Worker,
    TownWorkers,
    Plantzone,
    ModalDialog,
    WorkerEdit,
    WorkerSendSelection,
    LodgingSelection,
    HousesSelection,
    NodeMap,
    MapSelectedInfo,
    EmpireOverview,
    FloatingResourceEdit,
    WorkerSelection,
    SearchBar,
    GraphProcessingPanel,
    ExperimentPanel,
  },

  data: () => ({
    workerEditing: null,
    workerEditingInitial: null,
    workerEditingInitialProfit: 0,
    workerDialogVisible: false,
    sendDialogWorker: null,
    sendDialogVisible: false,
    lodgingDialogTown: "0",
    lodgingDialogData: null,
    lodgingDialogVisible: false,
    housesDialogTown: 0,
    housesDialogVisible: false,
    importDialogVisible: false,
    clickedNode: null,
    hoverInfo: null,
    resourceDialogWspd: 150,
    resourceDialogRgroup: 1,
    resourceDialogWkld: 400,
    resourceDialogVisible: false,
    panToPzk: null,
    panPaPos: null,
    selectWorkerDialogVisible: false,
    selectWorkerHouseKey: 0,

    importData: null,
    importSkipSections: {},

    prerelease_zerocost: true,
    prerelease_colorGoblins: false,
    showSearchBar: false,
    highlightNodes: new Set([]),

    
    pinnedInfo: null, // Stores { object, x, y } when clicked
    tooltipDragOffset: { x: 0, y: 0 },
    isDraggingTooltip: false,
    tooltipDragStart: { mouseX: 0, mouseY: 0, offsetX: 0, offsetY: 0 },

    showGraphPanel: true,

    routeRunning: false,
    routeWorker: null,
    routeRunId: 0,
  }),

  created() {
    console.log('addEventListener')
    window.addEventListener("keydown", this.onKeydown);
  },

  watch: {
    // Whenever the pinned node changes, reset drag offset so the card docks next to the new node
    'pinnedInfo.object.key'(newKey, oldKey) {
      if (newKey !== oldKey) {
        this.tooltipDragOffset = { x: 0, y: 0 };
      }
    },

    'graphStore.currentInstance': {
      immediate: true,
      deep: true,
      handler(inst) {
        this.haltQuickRoute();
        if (!inst) return;
        this.userStore.targetList = [...(inst.targets ?? [])].map(Number);

        const sourceMap = {};
        for (const { targetId, sourceId } of inst.assignments ?? []) {
          if (targetId != null && sourceId != null) {
            sourceMap[Number(targetId)] = Number(sourceId);
          }
        }
        this.userStore.sourceList = sourceMap;
      },
    },
  },

  computed: {
    isRouteActive() {
      return Boolean(
        this.graphStore.showSolutionView &&
        this.graphStore.dpSolution?.selectedVertices?.length
      );
    },

    hoveredNodeReductionInfo() {
      const key = Number(this.activeInfo?.object?.key);
      if (!key) return null;

      const isOrigSolView = Boolean(this.graphStore.isOriginalSolutionView);
      const snap = isOrigSolView ? null : this.graphStore.displayReduceSnapshot;
      const mode = this.graphStore.effectiveMapMode;
      const isReduceTab = !isOrigSolView && (mode === 'reduce' || mode === 'solve') && !!snap;

      // 1. Cluster members & total cluster CP
      const rawCluster = isReduceTab && Array.isArray(snap.nodeClusters?.[key])
        ? snap.nodeClusters[key].map(Number)
        : [key];

      // Put the representative node key first, then the remaining merged nodes
      const clusterMembers = [key, ...rawCluster.filter((id) => id !== key)];

      const clusterCP = isReduceTab && snap.nodeWeights?.[key] != null
        ? Number(snap.nodeWeights[key])
        : clusterMembers.reduce((sum, id) => sum + (Number(this.gameStore.nodes?.[id]?.CP) || 0), 0);

      // 2. Assigned Sources (original instance sources in ORIG view; snapshot sources otherwise)
      const activeSourceMap = isOrigSolView
        ? (this.userStore?.sourceList || {})
        : (this.graphStore.getActiveSource || {});
      const rawSources = activeSourceMap[key] ?? this.userStore?.sourceList?.[key];
      const sourceKeys = Array.isArray(rawSources)
        ? rawSources.map(Number)
        : (rawSources != null ? [Number(rawSources)] : []);

      const sources = sourceKeys.map((tnk) => ({
        key: tnk,
        name: this.gameStore.uloc?.node?.[tnk] || `Town ${tnk}`,
      }));

      const rawTargetSet = new Set(
        (this.graphStore.currentInstance?.targets ?? this.userStore?.targetList ?? []).map(Number)
      );

      // 3. Also resolve cluster member names for compact display
      const clusterDetails = clusterMembers.map((id) => ({
        key: id,
        name: this.gameStore.uloc?.node?.[id] || this.gameStore.nodes?.[id]?.name || `Node ${id}`,
        cp: Number(this.gameStore.nodes?.[id]?.CP) || 0,
        isTarget: rawTargetSet.has(id),
      }));

      return {
        isReduceTab,
        isMerged: clusterMembers.length > 1,
        clusterMembers,
        clusterDetails,
        clusterCP,
        sources,
        isTarget: this.graphStore.targetSet.has(key),
      };
    },

    activeSnapshot() {
      return this.reductionHistory[this.reductionStep] || null;
    },
    activeReductionGraph() {
      return this.activeSnapshot?.graph || null;
    },
    activeOperation() {
      return this.activeSnapshot?.operation || null;
    },

    // If a node is pinned/clicked, show that; otherwise fall back to hover
    activeInfo() {
      return this.pinnedInfo || this.hoverInfo;
    },

    activePlantzoneProfit() {
      const key = this.activeInfo?.object?.key;
      if (!key) return null;
      return this.gameStore?.allPzProfit?.[key] || null;
    },

    pzMaxStats() {
      const profit = this.activePlantzoneProfit;
      if (!profit) return null;

      // alt_towns[0] is the top-earning town
      const topTown = profit.alt_towns?.[0];
      const townKey = topTown?.tnk ?? profit.tnk;
      const townName = this.gameStore.uloc?.node?.[townKey] || 'Unknown Town';
      const incomeVal = Number(topTown?.priceDaily ?? profit.priceDaily ?? 0);

      return {
        townName,
        income: (incomeVal).toFixed(3) + ' $M/d',
        worker: this.gameStore.workerIcon(profit.alt_workers[0])
      };
    },

    pzCurrentStats() {
      const key = this.activeInfo?.object?.key;
      const profit = this.activePlantzoneProfit;
      if (!key || !profit) return { hasSource: false };

      const assignedTownKey = this.userStore?.sourceList?.[key];
      if (!assignedTownKey) return { hasSource: false };

      const townName = this.gameStore.uloc?.node?.[assignedTownKey] || 'Unknown Town';
      const matched = profit.alt_towns?.find(
        (item) => String(item?.tnk ?? '').trim() === String(assignedTownKey).trim()
      );
      const incomeVal = Number(matched?.priceDaily ?? 0);

      // Compute percentage relative to max
      const maxVal = typeof this.pzMaxStats?.incomeVal === 'number'
        ? this.pzMaxStats.incomeVal
        : parseFloat(this.pzMaxStats?.income ?? 0);

      let pctOfMax = 0;
      let pctColor = '#4ade80'; // Default emerald green (100%)

      if (maxVal > 0) {
        pctOfMax = Math.min(100, Math.round((incomeVal / maxVal) * 100));

        pctColor = pctOfMax >= 95 ? '#4ade80' : (pctOfMax >= 70 ? '#fbbf24' : '#f87171');
      }

      return {
        hasSource: true,
        townName,
        incomeVal,
        income: (incomeVal).toFixed(3) + ' $M/d',
        pctOfMax,
        pctColor
      };
    },


    tooltipOffset() {
      const targetKey = (this.pinnedInfo || this.hoverInfo)?.object?.key;
      const isPz = this.gameStore?.isPlantzone?.(targetKey);
      const baseSize = isPz 
        ? (this.userStore?.plantzoneIconSize || 16) 
        : (this.userStore?.otherIconSize || 16);
      
      // Halo radius is baseSize * 0.66 + extra padding (e.g. 12px margin)
      const clearance = Math.round(baseSize * 0.66 - 10);
      return { x: clearance, y: clearance };
    },
  },

  mounted() {
    
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.onKeydown);
  },

  methods: {
    formatFixed,
    randBetween,
    levelup,

    haltQuickRoute() {
      this.routeRunId++;
      if (this.routeWorker) {
        this.routeWorker.terminate();
        this.routeWorker = null;
      }
      this.routeRunning = false;
    },

    toggleQuickRoute() {
      // 1. If currently running, cancel the worker
      if (this.routeRunning) {
        this.haltQuickRoute();
        return;
      }

      // 2. If solution overlay is currently ON, turn it OFF
      if (this.isRouteActive) {
        this.graphStore.setSolutionViewMode('td');
        return;
      }

      // 3. If a full-root solution is already cached for the current instance, re-enable it on the original graph
      const finalIdx = Math.max(0, (this.graphStore.reducedGraph?.length ?? 1) - 1);
      if (
        this.graphStore.dpSolution?.selectedVertices?.length &&
        this.graphStore.dpSolution?.isFullRoute &&
        this.graphStore.dpSolution?.stepIndex === finalIdx
      ) {
        this.graphStore.setSolutionViewMode('original');
        return;
      }

      // 4. Otherwise run the full preprocessing + Exact DP (GRD) pipeline in a worker
      if (!this.gameStore.ready) return;
      if (
        (!this.gameStore.allPzProfit || Object.keys(this.gameStore.allPzProfit).length === 0) &&
        typeof this.gameStore.nearestTownProfit === 'function'
      ) {
        this.gameStore.nearestTownProfit();
      }

      this.graphStore.preprocessGraph();
      const steps = this.graphStore.reducedGraph;
      if (!steps?.length) return;

      const stepIdx = steps.length - 1;
      const finalSnap = steps[stepIdx];
      const fullTd = finalSnap?.decomposition;
      if (!finalSnap || !fullTd) return;

      if (!finalSnap.contractedDecomposition) {
        finalSnap.contractedDecomposition = buildContractedDpTree(fullTd, { binaryJoins: true });
      }
      const contractedTd = finalSnap.contractedDecomposition;
      const targetNodeId = contractedTd?.rootId ?? 0;

      const runId = ++this.routeRunId;
      this.routeRunning = true;

      const worker = new SteinerDpWorker();
      this.routeWorker = worker;

      worker.onmessage = (e) => {
        const msg = e.data;
        if (!msg || msg.runId !== this.routeRunId) return;

        if (msg.type === 'done') {
          const res = msg.result;
          this.haltQuickRoute();

          if (res?.allSolutions?.length > 0) {
            const tagged = res.allSolutions.map((s) => ({
              ...s,
              stepIndex: stepIdx,
              isFullRoute: true,
            }));
            this.graphStore.solutionGraphMode = 'original';
            this.graphStore.setDpSolutions(tagged);
          } else if (res?.selectedVertices?.length > 0) {
            this.graphStore.solutionGraphMode = 'original';
            this.graphStore.setDpSolution({
              selectedVertices: res.selectedVertices,
              minCost: res.bagMergeStats.minCost,
              isExact: res.isExact,
              bagId: res.bagMergeStats.origBagId,
              stepIndex: stepIdx,
              isFullRoute: true,
            });
          } else {
            this.graphStore.clearDpSolution();
          }
        } else if (msg.type === 'error') {
          console.error('[Route] DP Worker error:', msg.error);
          this.haltQuickRoute();
        }
      };

      worker.onerror = (err) => {
        console.error('[Route] DP Worker crash:', err);
        this.haltQuickRoute();
      };

      worker.postMessage({
        runId,
        contractedTd: JSON.parse(JSON.stringify(contractedTd)),
        fullTd: JSON.parse(JSON.stringify(fullTd)),
        snap: JSON.parse(JSON.stringify(finalSnap)),
        targetNodeId,
        options: {
          maxStates: Infinity,
          useHeuristicAdvice: true,
          ladderMode: 'greedy',
        },
      });
    },

    toggleGraphPanel() {
      if (!this.userStore.isAbstractView) return;
      if (this.showGraphPanel) {
        this.showGraphPanel = false;
      } else {
        this.$refs.graphProcessingPanel?.resetPanelPos();
        this.showGraphPanel = true;
      }
    },

    onKeydown(event) {
      if (event.ctrlKey && event.code === "KeyF") {
        event.preventDefault()
        this.showSearchBar = true
        nextTick(() => this.$refs.searchBar.focusInput())
      }
      if (event.key === "Escape") {
        if (this.showSearchBar) this.showSearchBar = false
        else this.handleSearchSelection(new Set([]))
      }
    },
    handleSearchSelection(pzkList) {
      //console.log("highlight", pzkList)
      this.highlightNodes = pzkList
      
      nextTick(() => {
        this.$refs.nodeMap.updateLayers()
        if (pzkList.size > 0) {
          let x1 = 1e99
          let y1 = 1e99
          let x2 = -1e99
          let y2 = -1e99
          pzkList.forEach(pzk => {
            x1 = Math.min(x1, this.gameStore.nodes[pzk].pos.x)
            y1 = Math.min(y1, this.gameStore.nodes[pzk].pos.z)
            x2 = Math.max(x2, this.gameStore.nodes[pzk].pos.x)
            y2 = Math.max(y2, this.gameStore.nodes[pzk].pos.z)
          })
          this.$refs.nodeMap.panToBbox(x1, x2, y1, y2)
        }
      })
      this.showSearchBar = false
    },

    hireWorker(tk) {
      const w = this.userStore.useDefaultWorker ? {...this.userStore.defaultWorker, tnk: this.gameStore.tk2tnk(tk)} : this.hireRandomArtGob(tk)
      console.log('w', w)
      this.userStore.userWorkers.push(w)
    },

    hireRandomArtGob(tk) {
      const label = this.userStore.newWorkerName(tk)
      const charkey = 7572
      let w = {
        tk,
        tnk: this.gameStore.tk2tnk(tk),
        charkey,
        label,
        level: 1,
        wspdSheet: this.gameStore.workerStatic[charkey].wspd / 1E6,
        mspdSheet: this.gameStore.workerStatic[charkey].mspd / 100,
        luckSheet: this.gameStore.workerStatic[charkey].luck / 1E4,
        skills: [],
        job: null,
      }

      w.skills.push(this.gameStore.randomSkill(w.skills))
      
      levelup(this.gameStore, w, 40)
      w.wspdSheet = Math.round(w.wspdSheet * 100) / 100
      w.mspdSheet = Math.round(w.mspdSheet * 100) / 100
      w.luckSheet = Math.round(w.luckSheet * 100) / 100

      return w
    },
    
    fireWorker(who) {
      this.userStore.userWorkers = this.userStore.userWorkers.filter(w => w != who)
    },

    sendWorker(worker) {
      const stats = this.gameStore.workerStatsOnPlantzone(worker)
      this.sendDialogWorker = worker
      this.sendDialogVisible = true
    },

    unsendWorker(worker) {
      worker.job = null
    },

    editWorker(w) {
      this.workerEditing = w
      this.workerEditingInitial = JSON.parse(JSON.stringify(w))
      this.workerEditingInitialProfit = w && w.job && typeof(w.job) == 'number' ? this.routingStore.pzJobs[this.workerEditing.job].profit.priceDaily : 0
      this.workerDialogVisible = true
    },

    hireAll() {
      for (const tk of Object.keys(this.gameStore.lodgingPerTown)) {
        const slotsHere = this.userStore.townFreeLodgingCount(tk)
        for (let i = 0; i < slotsHere; i++) {
          this.hireWorker(tk)
        }
      }
    },

    fireAll() {
      this.userStore.userWorkers = []
    },

    selectLodging(tk) {
      this.lodgingDialogTown = tk
      this.lodgingDialogData = this.gameStore.lodgingPerTown[tk]
      this.lodgingDialogVisible = true
    },

    selectHouses(tk) {
      this.housesDialogTown = tk
      this.housesDialogVisible = true
      console.log('housesDialogVisible')
    },

    selectWorker(hk) {
      this.selectWorkerHouseKey = hk
      this.selectWorkerDialogVisible = true
      console.log('selectWorkerDialogVisible')
    },

    fileImport(event) {
      if (!event) return
      const fileList = event.target[0].files
      if (fileList.length < 1) return
      const file = fileList[0]
      console.log('fileImport', file)
      const reader = new FileReader()
      reader.onload = this.fileParse
      reader.readAsText(file)
    },

    fileParse(event) {
      let str = event.target.result
      let json = JSON.parse(str)
      
      // Remove workers with unknown charkeys
      for (let i = json.userWorkers.length - 1; i >= 0; i--) {
        const charkey = json.userWorkers[i].charkey
        if (!(charkey in this.gameStore.workerStatic)) {
          console.log(`unknown charkey ${charkey} - discarded`)
          json.userWorkers.splice(i, 1)
        }
      }

      // migrate from old formats
      json.userWorkers.forEach(w => {
        // remove unused values
        delete w.tk
        const stat = this.gameStore.workerStatic[w.charkey]
        // convert sheetStats to lvlupStats
        if ('wspdLvlup' in w) {
          const wspdSheet = (stat.wspd + w.wspdLvlup)/1E6
          w.wspdSheet = Math.round(wspdSheet*100)/100
          delete w.wspdLvlup
        }
        if ('mspdLvlup' in w) {
          const mspdSheet = stat.mspd/100 * (1 + w.mspdLvlup/1E6)
          w.mspdSheet = Math.round(mspdSheet*100)/100
          delete w.mspdLvlup
        }
        if ('mspdBase' in w) {
          delete w.mspdBase
        }
        if ('luckLvlup' in w) {
          const luckSheet = (stat.luck + w.luckLvlup)/1E4
          w.luckSheet = Math.round(luckSheet*100)/100
          delete w.luckLvlup
        }
        // create missing workshop entries
        if (this.gameStore.jobIsWorkshop(w.job)) {
          if (!(w.job.hk in this.userStore.userWorkshops)) {
            this.userStore.userWorkshops[w.job.hk] = { ...this.userStore.defaultUserWorkshop }
            console.log(`userWorkshop #${w.job.hk} not set, using default`)
          }
        }
        // update from number format
        if (typeof(w.job) == 'number') {
          const pzk = w.job
          w.job = { kind: 'plantzone', pzk, storage: w.tnk }
        }
        // remove jobs at unknown pzk's
        if (this.gameStore.jobIsPz(w.job) && !(w.job.pzk in this.gameStore.plantzones)) {
          console.log(`removing plantzone job of worker ${w.label}: unknown pzk`, w.job)
          w.job = null
        }
        // update custom job format
        if (Array.isArray(w.job)) {
          w.job = { kind: 'custom', profit: w.job[1], cp: w.job[2], label: w.job[3]}
        }
      })
      
      console.log('import parsed')

      // "this.userStore = json" but better
      this.userStore.$patch(json)

      // handle file entries that are empty 
      if (json.lodgingTaken && Object.keys(json.lodgingTaken).length > 0) {
        console.log('overwriting lodgingTaken')
        this.userStore.lodgingTaken = json.lodgingTaken
      }
      else
        console.log('keeping lodgingTaken')
        
      if (json.lodgingP2W && Object.keys(json.lodgingP2W).length > 0) {
        console.log('overwriting lodgingP2W')
        this.userStore.lodgingP2W = json.lodgingP2W
      }
      else
        console.log('keeping lodgingP2W')
        
      console.log('import done')
      this.importDialogVisible = false
    },

    fileExport() {
      var a = document.createElement("a")
      let out = { 
        activateAncado: this.userStore.activateAncado,
        lodgingP2W: this.userStore.lodgingP2W,
        lodgingTaken: this.userStore.lodgingTaken,
        userWorkers: this.userStore.userWorkers,
        farmingEnable: this.userStore.farmingEnable,
        farmingProfit: this.userStore.farmingProfit,
        farmingBareProfit: this.userStore.farmingBareProfit,
        grindTakenList: this.userStore.grindTakenList,
      } 
      const str = JSON.stringify(out)
      var file = new Blob([str], {type: 'text/plain'});
      a.href = URL.createObjectURL(file);
      a.download = 'user.json';
      a.click();
    },

    log(s) {
      console.log(s)
    },

    showResourceDialog(pzk) {
      this.resourceDialogVisible = true
      this.resourceDialogRgroup = this.gameStore.plantzoneStatic[pzk].regiongroup
      this.resourceDialogWkld = this.gameStore.plantzones[pzk].peg.time
      this.resourceDialogWspd = this.userStore.workedPlantzones.has(String(pzk)) ? this.routingStore.pzJobs[pzk].worker.wspdSheet + this.gameStore.wspdBonus(this.routingStore.pzJobs[pzk].worker, 'farm') : 150
    },

    panToHash() {
      if (this.$route.hash) {
        this.panToPzk = this.$route.hash.replace("#node", "")
      }
    },

    panToPaPos(pos) {
      this.panPaPos = pos
    },

    setClickedNode(n) {
      this.clickedNode = n
    },



    // iMad's change
    ///////////////////////////////////////////////////////
    getNodeChildren(key) {
      const node = this.gameStore.nodes?.[key];
      return node?.children || [];
    },

    getChildStats(childKey) {
      const childId = Number(childKey);
      const profitData = this.gameStore.nearestTownProfit?.()[childId];

      if (!profitData || !profitData.alt_workers || profitData.alt_workers.length === 0) {
        return { isSpecialty: true };
      }

      // 1. Current selected town
      const selectedTown = this.userStore.sourceList[childId] || null;
      const townName = this.gameStore.uloc.node[selectedTown] || 'N/A';

      const matchedTown = profitData?.alt_towns?.find(
        (item) => Number(item.tnk) === selectedTown
      );

      const currentIncome = Number(matchedTown?.priceDaily ?? 0);
      const maxIncome = profitData.alt_workers[0].priceDaily;

      const pctOfMax = maxIncome > 0 
        ? Math.round((currentIncome / maxIncome) * 100) 
        : 100;

      const pctColor = pctOfMax >= 95 ? '#4ade80' : (pctOfMax >= 70 ? '#fbbf24' : '#f87171');

      return {
        isSpecialty: false,
        hasTown: townName !== 'N/A',
        townName: townName,
        currentIncome: currentIncome.toFixed(3),
        maxIncome: maxIncome,
        pctOfMax,
        pctColor,
        //workerIcon: this.gameStore.workerIcon?.(worker) || ''
      };
    },

    // Call this from Deck.gl's onClick layer/view callback
    handleNodeClick(info) {
      if (info && info.object) {
        // Toggle off if clicking the already pinned node, otherwise pin the new one
        if (this.pinnedInfo && this.pinnedInfo.object.key === info.object.key) {
          this.pinnedInfo = null;
        } else {
          this.pinnedInfo = {
            object: info.object,
            x: info.x,
            y: info.y
          };
        }
      } else {
        // Clicking empty canvas area unpins the tooltip
        this.pinnedInfo = null;
      }
    },

    handleNodeHover(info) {
      // Only track hover coordinates if nothing is currently pinned
      if (!this.pinnedInfo) {
        this.hoverInfo = info && info.object ? info : null;
      }
    },

    clearPinned() {
      this.pinnedInfo = null;
      this.hoverInfo = null;
    },


    handleNewSeed() {
      this.randomSeed = Math.random().toString(36).substring(2, 8).toUpperCase();
      // Trigger instance generation workflow here
    },

    startTooltipDrag(e) {
      if (e.button !== 0) return; // Left click only
      this.isDraggingTooltip = true;
      this.tooltipDragStart = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        offsetX: this.tooltipDragOffset.x,
        offsetY: this.tooltipDragOffset.y
      };

      window.addEventListener('mousemove', this.onTooltipDrag);
      window.addEventListener('mouseup', this.stopTooltipDrag);
    },

    onTooltipDrag(e) {
      if (!this.isDraggingTooltip) return;
      this.tooltipDragOffset = {
        x: this.tooltipDragStart.offsetX + (e.clientX - this.tooltipDragStart.mouseX),
        y: this.tooltipDragStart.offsetY + (e.clientY - this.tooltipDragStart.mouseY)
      };
    },

    stopTooltipDrag() {
      this.isDraggingTooltip = false;
      window.removeEventListener('mousemove', this.onTooltipDrag);
      window.removeEventListener('mouseup', this.stopTooltipDrag);
    }
  },

  beforeUnmount() {
    window.removeEventListener('mousemove', this.onTooltipDrag);
    window.removeEventListener('mouseup', this.stopTooltipDrag);
    this.haltQuickRoute();
  },

  mounted() {
    this.panToHash()
  },

}
</script>

<template>
  
  <ModalDialog v-model:show="workerDialogVisible">
    <WorkerEdit 
      :workerEditing="workerEditing" 
      :workerInitial="workerEditingInitial" 
      :initialProfit="workerEditingInitialProfit" 
      v-model:show="workerDialogVisible"
    />
  </ModalDialog>
  
  <ModalDialog v-model:show="sendDialogVisible">
    <WorkerSendSelection :w="sendDialogWorker" v-model:show="sendDialogVisible"/>
  </ModalDialog>

  <ModalDialog v-model:show="lodgingDialogVisible">
    <LodgingSelection :tk="lodgingDialogTown" :o="lodgingDialogData" v-model:show="lodgingDialogVisible"/>
  </ModalDialog>

  <ModalDialog v-model:show="housesDialogVisible">
    <HousesSelection :tk="housesDialogTown" v-model:show="housesDialogVisible"/>
  </ModalDialog>

  <ModalDialog v-model:show="selectWorkerDialogVisible">
    <WorkerSelection :hk="selectWorkerHouseKey" v-model:show="selectWorkerDialogVisible"/>
  </ModalDialog>

  <ModalDialog v-model:show="importDialogVisible">
    <form @submit.prevent="fileImport($event)">
      <input type="file" accept=".json" @click="fileImport()" />
      <button>import</button><br/>
    </form>
  </ModalDialog>

  <ModalDialog v-model:show="resourceDialogVisible">
    <FloatingResourceEdit 
      :rgk="resourceDialogRgroup"
      :wspd="resourceDialogWspd"
      :workload="resourceDialogWkld"
      v-model:show="resourceDialogVisible"
    />
    <div style="width: 24em;">Test with workspeed:
      <input 
        type="range" 
        class="vmid"
        v-model.number="resourceDialogWspd" 
        min="40" 
        max="200" 
        step="0.01"
      />
      {{ resourceDialogWspd }}
    </div>
  </ModalDialog>

  <main>

    <div id="canvas-limiter">

      <NodeMap 
        ref="nodeMap"
        v-model:clickedObj="clickedNode" 
        v-model:hoverInfo="hoverInfo" 
        v-model:panToPzk="panToPzk"
        v-model:panPaPos="panPaPos"
        @panAnywhere="panPaPos = null"
        @update:pinnedInfo="pinnedInfo = $event"
        :highlightNodes="highlightNodes"
      />



      <GraphProcessingPanel
        ref="graphProcessingPanel"
        v-show="userStore.isAbstractView && userStore.isAltView && showGraphPanel"
      />

        
      <div class="topcenter" v-if="userStore.error">
        ERROR: {{ userStore.error }}
      </div>

      <div v-if="!userStore.isAltView">
        <div v-if="hoverInfo && hoverInfo.object" id="tooltip-OG" :style="{left:hoverInfo.x+'px', top:hoverInfo.y+'px'}">
          {{ hoverInfo.object.key }} {{ gameStore.uloc.node[hoverInfo.object.key] }} {{ hoverInfo.object.thisCpCost }}CP
          <span v-if="hoverInfo.object.key in this.gameStore.plantzones">
            <ItemIcon v-for="k in this.gameStore.plantzones[hoverInfo.object.key].itemkeys" :ik="Number(k)"/>
          </span>
          <span v-if="this.gameStore.townsConnectionRoots.has(hoverInfo.object.key)">
            <br/>[town {{ this.gameStore._tnk2tk[hoverInfo.object.key] }}]
          </span>
          <br/>
          <!--{{ hoverInfo.object.fromTownCpCost }}CP → {{this.gameStore.uloc.node[hoverInfo.object.fromTown] }}-->
        </div>
      </div>


      <!-- iMad's changes -->
      <!-- Non-plantzone tooltip -->
      <div v-if="userStore.isAltView && activeInfo?.object?.key && !gameStore.isPlantzone(activeInfo.object.key)">
        <!-- Tooltip reads pinnedInfo first, falls back to hoverInfo -->
        <div 
          v-if="(pinnedInfo || hoverInfo)?.object" 
          id="tooltip" 
          :class="{ 'is-pinned': !!pinnedInfo }"
          :style="{ 
            left: ((pinnedInfo ? pinnedInfo.x : hoverInfo.x) + tooltipOffset.x + (pinnedInfo ? tooltipDragOffset.x : 0)) + 'px', 
            top: ((pinnedInfo ? pinnedInfo.y : hoverInfo.y) + tooltipOffset.y + (pinnedInfo ? tooltipDragOffset.y : 0)) + 'px'
          }"
        >
          <div 
            class="tooltip-header"
            :class="{ 'is-draggable': !!pinnedInfo }"
             @mousedown.stop="pinnedInfo && startTooltipDrag($event)"
          >
            <div class="tooltip-title-group">
              <span v-if="pinnedInfo" class="drag-grip" title="Drag to reposition">⋮⋮</span>
              <span v-if="pinnedInfo" class="pin-indicator" title="Pinned">📌</span>
              <span class="tooltip-title">
                {{ activeInfo.object.key }} 
                {{ gameStore.uloc.node[activeInfo.object.key] }} 
                ({{ hoveredNodeReductionInfo?.clusterCP ?? activeInfo.object.thisCpCost ?? gameStore.nodes[activeInfo.object.key]?.CP ?? 1 }} CP)
              </span>
            </div>
            <span 
              class="tooltip-badge" 
              :class="(hoveredNodeReductionInfo?.isTarget ?? userStore.targetSet.has(Number(activeInfo.object.key))) ? 'badge-taken' : 'badge-free'"
            >
              {{ (hoveredNodeReductionInfo?.isTarget ?? userStore.targetSet.has(Number(activeInfo.object.key))) ? '● TAKEN' : '○ FREE' }}
            </span>

            <!-- Close / unpin button -->
            <button 
              v-if="pinnedInfo" 
              class="tooltip-close-btn" 
              @click.stop="pinnedInfo = null" 
              title="Unpin (Esc)"
            >
              ✕
            </button>
          </div>

          <!-- Cluster & Assigned Sources (Reduction / Instance telemetry) -->
          <div v-if="hoveredNodeReductionInfo && (hoveredNodeReductionInfo.isMerged || hoveredNodeReductionInfo.sources.length)" class="tooltip-reduction-box">
            <!-- Merged Cluster Members -->
            <div v-if="hoveredNodeReductionInfo.isMerged" class="reduction-info-row">
              <span class="reduction-label">Cluster ({{ hoveredNodeReductionInfo.clusterMembers.length }}):</span>
              <div class="reduction-chip-list">
                <span 
                  v-for="m in hoveredNodeReductionInfo.clusterDetails" 
                  :key="m.key" 
                  class="reduction-chip"
                  :class="m.isTarget ? 'target-cluster-chip' : 'cluster-chip'"
                  :title="`${m.key} ${m.name} (${m.cp} CP)${m.isTarget ? ' [Target]' : ''}`"
                >
                  {{ m.key }} <small>{{ m.name }} · {{ m.cp }}CP</small>
                </span>
              </div>
            </div>

            <!-- Assigned Source Towns (Key + Name) -->
            <div v-if="hoveredNodeReductionInfo.sources.length" class="reduction-info-row">
              <span class="reduction-label">Sources:</span>
              <div class="reduction-chip-list">
                <span 
                  v-for="src in hoveredNodeReductionInfo.sources" 
                  :key="src.key" 
                  class="reduction-chip source-chip"
                >
                  {{ src.key }} · {{ src.name }}
                </span>
              </div>
            </div>
          </div>

          <!-- Town indicator if root -->
          <div v-if="gameStore.townsConnectionRoots.has(activeInfo.object.key)" class="tooltip-town">
            [Town: {{ gameStore._tnk2tk[activeInfo.object.key] }}]
          </div>

          <!-- Parent Item Icons -->
          <div v-if="activeInfo.object.key in gameStore.plantzones" class="tooltip-icons">
            <ItemIcon 
              v-for="k in gameStore.plantzones[activeInfo.object.key].itemkeys" 
              :key="k" 
              :ik="Number(k)"
            />
          </div>

          <!-- Sub-nodes Breakdown -->
          <div v-if="getNodeChildren(activeInfo.object.key).length" class="tooltip-children">
            <div 
              v-for="child in gameStore.getSortedChildrenByProfit(activeInfo.object.key)" 
              :key="child" 
              class="tooltip-child-row"
            >
              <div class="child-main">
                <span 
                  class="child-status-dot" 
                  :class="{ active: userStore.targetSet.has(Number(child)) }"
                ></span>
                <span class="child-name">
                  {{ child }} - {{ gameStore.uloc.node[child] || gameStore.nodes[child]?.name || 'Sub-node' }} 
                  ({{ gameStore.nodes[child]?.CP ?? 1 }} CP)
                </span>
                <span v-if="child in gameStore.plantzones" class="child-icons">
                  <ItemIcon 
                    v-for="k in gameStore.plantzones[child].itemkeys" 
                    :key="k" 
                    :ik="Number(k)"
                  />
                </span>
              </div>

              <!-- Financial & Town Info -->
              <div class="child-sub" v-if="getChildStats(child)">
                <template v-if="!getChildStats(child).isSpecialty">
                  <span class="child-profit">
                    {{ getChildStats(child).workerIcon }} {{ getChildStats(child).townName }}:
                    <strong>{{ getChildStats(child).currentIncome }} / {{ getChildStats(child).maxIncome.toFixed(3) }} M$/d  </strong>
                  </span>
                  <span 
                    class="child-pct" 
                    :style="{ color: getChildStats(child).pctColor }"
                  >
                    ({{ getChildStats(child).pctOfMax }}%)
                  </span>
                </template>
                <template v-else>
                  <span class="child-specialty">Specialties</span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>




      <!-- Plantzone Node Tooltip -->
      <div v-if="userStore.isAltView && activeInfo?.object?.key && gameStore.isPlantzone(activeInfo.object.key)">
        <div 
          v-if="(pinnedInfo || hoverInfo)?.object" 
          id="pz-tooltip" 
          class="pz-tooltip-card"
          :class="{ 'is-pinned': !!pinnedInfo }"
          :style="{ 
            left: ((pinnedInfo ? pinnedInfo.x : hoverInfo.x) + tooltipOffset.x + (pinnedInfo ? tooltipDragOffset.x : 0)) + 'px', 
            top: ((pinnedInfo ? pinnedInfo.y : hoverInfo.y) + tooltipOffset.y + (pinnedInfo ? tooltipDragOffset.y : 0)) + 'px' 
          }"
        >
          <!-- Header / Title Bar with Integrated Icons -->
          <div 
            class="pz-tooltip-header"
            :class="{ 'is-draggable': !!pinnedInfo }"
            @mousedown.stop="pinnedInfo && startTooltipDrag($event)"
          >
            <div class="pz-title-group">
              <span v-if="pinnedInfo" class="drag-grip" title="Drag to reposition">⋮⋮</span>
              <span v-if="pinnedInfo" class="pin-indicator" title="Pinned">📌</span>
              <span class="pz-title">
                {{ activeInfo.object.key }} 
                {{ gameStore.uloc.node[activeInfo.object.key] }} 
                ({{ hoveredNodeReductionInfo?.clusterCP ?? activeInfo.object.thisCpCost ?? gameStore.nodes[activeInfo.object.key]?.CP ?? 1 }} CP)
              </span>
              <!-- Inline Item Icons with left spacing -->
              <span v-if="activeInfo.object.key in gameStore.plantzones" class="pz-item-icons">
                <ItemIcon 
                  v-for="k in gameStore.plantzones[activeInfo.object.key].itemkeys" 
                  :key="k" 
                  :ik="Number(k)"
                />
              </span>
            </div>

            <div class="pz-header-actions" @mousedown.stop>
              <span 
                class="pz-badge" 
                :class="userStore.targetSet.has(Number(activeInfo.object.key)) ? 'badge-taken' : 'badge-free'"
              >
                {{ userStore.targetSet.has(Number(activeInfo.object.key)) ? '● TAKEN' : '○ FREE' }}
              </span>

              <!-- Close / unpin button -->
              <button 
                v-if="pinnedInfo" 
                class="tooltip-close-btn" 
                @click.stop="pinnedInfo = null" 
                title="Unpin (Esc)"
              >
                ✕
              </button>
            </div>
          </div>

          <div class="pz-divider"></div>

          <!-- Animated Financial Section -->
          <div v-if="pzMaxStats" class="pz-stats-body">
            <!-- Max Income Line -->
            <div class="pz-stat-row">
              <span class="pz-stat-label">Max:</span>
              <span class="pz-income-val text-max-perfect">{{ pzMaxStats.income }}</span>

              <!-- Dynamic Flex Track spanning the middle gap -->
              <span class="pz-worker-track">
                <span class="pz-worker-sprite"> {{pzMaxStats.worker }} </span>
              </span>

              <span class="pz-town-name">{{ pzMaxStats.townName }}</span>
            </div>

            <!-- Current Income Line -->
            <div class="pz-stat-row">
              <span class="pz-stat-label">Current:</span>
              <template v-if="pzCurrentStats.hasSource">
                <!-- Left cluster: Profit + Percentage badge -->
                <div class="pz-profit-group">
                  <span 
                    class="pz-income-val"
                    :style="{ color: pzCurrentStats.pctColor }"
                  >
                    {{ pzCurrentStats.income }}
                  </span>
                  <span 
                    class="pz-child-pct" 
                    :style="{ color: pzCurrentStats.pctColor }"
                  >
                    ({{ pzCurrentStats.pctOfMax }}%)
                  </span>
                </div>

                <!-- Flexible spacer pushes the town to the right border -->
                <span class="pz-spacer"></span>

                <span class="pz-town-name">{{ pzCurrentStats.townName }}</span>
              </template>
              <template v-else>
                <span class="pz-na-label">N/A</span>
              </template>
            </div>

            <!-- Cluster & Source Keys (shown when merged or multiple sources exist) -->
            <div v-if="hoveredNodeReductionInfo && (hoveredNodeReductionInfo.isMerged || hoveredNodeReductionInfo.sources.length)" class="pz-reduction-meta">
              <div v-if="hoveredNodeReductionInfo.isMerged" class="reduction-info-row">
                <span class="pz-stat-label">Cluster:</span>
                <div class="reduction-chip-list">
                  <span 
                    v-for="m in hoveredNodeReductionInfo.clusterDetails" 
                    :key="m.key" 
                    class="reduction-chip"
                    :class="m.isTarget ? 'target-cluster-chip' : 'pz-chip'"
                  >
                    {{ m.key }} <small>{{ m.name }} · {{ m.cp }}CP</small>
                  </span>
                </div>
              </div>
              <div v-if="hoveredNodeReductionInfo.sources.length" class="reduction-info-row">
                <span class="pz-stat-label">Sources:</span>
                <div class="reduction-chip-list">
                  <span v-for="src in hoveredNodeReductionInfo.sources" :key="src.key" class="reduction-chip pz-source-chip">
                    {{ src.key }} · {{ src.name }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>





      <div id="topleft">
        <details>
          <summary>Empire</summary>
          <EmpireOverview
            @panToPaPos="panToPaPos"
          />
        </details>

      </div>

      <div id="leftside">
        <MapSelectedInfo 
          :clickedNode="clickedNode"
          :pinned-info="pinnedInfo"
          @selectLodging="selectLodging"
          @selectHouses="selectHouses"
          @hireWorker="hireWorker"
          @editWorker="editWorker"
          @sendWorker="sendWorker"
          @panToPaPos="panToPaPos"
          @showResourceDialog="showResourceDialog"
          @setClickedNode="setClickedNode"
          @selectWorker="selectWorker"
        />
      </div>

      <div id="rightside">

        <search-bar 
          ref="searchBar"
          :visible="showSearchBar" 
          @close="showSearchBar = false" 
          @select="handleSearchSelection"
        />

        <div id="totals">
          <details>
            <summary>Total workers: {{ userStore.countWorkers }}</summary>
            <p class="fsxs">
              nodes: {{ userStore.workedPlantzones.size }} <br/>

              <template v-if="userStore.workersFarmingCount">
                <template v-if="!userStore.farmingEnable">
                  <abbr title="CP not allocated for fences, enable Farming on Settings page" class="tooltip">⚠️</abbr>
                </template>
                <template v-else-if="userStore.workersFarmingCount && userStore.workersFarmingCount < 10">
                  <abbr title="not all fences being worked, for best results either send 10 workers or none at all" class="tooltip">⚠️</abbr>
                </template>
                farming:
                {{ userStore.workersFarmingCount }} <br/> 
              </template>

              <template v-if="userStore.workersWorkshopCount">
                workshops: {{ userStore.workersWorkshopCount }} <br/> 
              </template>

              <template v-if="userStore.workersCustomCount">
                custom: {{ userStore.workersCustomCount }} <br/> 
              </template>

              <template v-if="userStore.workersIdleCount">
                ⚠️ idle: {{ userStore.workersIdleCount }} 
              </template>
            </p>
          </details>

          <details>
            <summary>Total CP: {{ formatFixed(userStore.totalCP) }}</summary>
            <p class="fsxs">
              
              <draggable v-model="userStore.linkOrder" itemKey="id">
                <template #item="{ element, index }">
                  <div class="draggable">
                    {{ index+1 }}.
                    <template v-if="element.name == 'grind'">
                      invested for droprate: 
                      <abbr class="tooltip" :title="userStore.grindTakenDesc">
                        {{ routingStore.routing.autotakenGrindNodesCP }}
                      </abbr><br/>
                    </template>
                    <template v-else-if="element.name == 'worker'">
                      nodes: {{ routingStore.routing.autotakenWorkerNodesCP }} <br/>
                    </template>
                    <template v-else-if="element.name == 'wagon'">
                      wagon routes: 
                      <abbr class="tooltip" :title="[...userStore.wagonRoutes].reduce((acc, rt) => acc + `${gameStore.uloc.node[rt.origin]} - ${gameStore.uloc.node[rt.destination]}\n`, '')">
                        {{ routingStore.routing.autotakenWagonNodesCP }}
                      </abbr><br/>
                    </template>
                  </div>
                </template>
              </draggable>

              lodging/storage: {{ userStore.lodgage }} <br/>
                
              <template v-if="userStore.farmingEnable">
                farming: {{ userStore.farmingCP }} <br/>
              </template>

              <template v-if="userStore.workersWorkshopCount">
                workshops:
                {{ formatFixed(userStore.workshopTotalCP) }} <br/>
              </template>

              <template v-if="userStore.workersCustomCount">
                custom:
                {{ userStore.customTotalCP }} <br/>
              </template>

            </p>
            
          </details>

          <details>
            <summary>Total M$/day: {{ formatFixed(userStore.allJobsTotalDailyProfit, 2) }}</summary>
            <p class="fsxs">
              nodes: {{ formatFixed(userStore.pzJobsTotalDailyProfit, 2) }} <br/>
              <template v-if="userStore.workersFarmingCount">
                farming: {{ formatFixed(userStore.farmingTotalProfit, 2) }} <br/>
              </template>
              <template v-if="userStore.workersWorkshopCount">
                workshops: {{ formatFixed(userStore.workshopTotalProfit, 2) }} <br/> 
              </template>
              <template v-if="userStore.workersCustomCount">
                custom: {{ formatFixed(userStore.customTotalProfit, 2) }} <br/> 
              </template>
            </p>
          </details>

          <details>
            <summary>Total efficiency: {{ formatFixed(userStore.allJobsDailyProfitPerCp, 3) }}</summary>
            (M$/day/CP)
            <p class="fsxs">
              nodes: {{ formatFixed(userStore.pzJobsDailyProfitPerCp, 3) }} <br/> 
              <template v-if="userStore.farmingEnable">
                farming: {{ formatFixed(userStore.farmingJobsDailyProfitPerCp, 3) }} <br/> 
              </template>
              <template v-if="userStore.workersWorkshopCount">
                workshops: {{ formatFixed(userStore.workshopJobsDailyProfitPerCp, 3) }} <br/> 
              </template>
              <template v-if="userStore.workersCustomCount">
                custom: {{ formatFixed(userStore.customJobsDailyProfitPerCp, 3) }} <br/> 
              </template>
            </p>
          </details>

          <!-- ----------------------------------------------------------------------------------------
          iMad's changes -->
          <!-- The View Switcher -->
          <div class="view-toggle-wrapper">
            <button 
              type="button"
              class="pill-switch" 
              :class="{ 'is-alt': userStore.isAltView }" 
              @click="userStore.isAltView = !userStore.isAltView"
            >
              <!-- Sliding active indicator pill -->
              <div class="pill-thumb"></div>

              <!-- Labels -->
              <span class="label og">OG</span>
              <span class="label alt">Alt</span>
            </button>
          </div>

          <!-- ALT-ONLY CONTROL PANEL: Only visible when currentView === 'alt' -->
          <div v-show="userStore.isAltView" class="alt-control-panel">
            <label class="custom-chk">
              <input type="checkbox" v-model="userStore.isAbstractView" />
              <span class="chk-box">
                <svg viewBox="0 0 12 10">
                  <polyline points="1.5 6 4.5 9 10.5 1"></polyline>
                </svg>
              </span>
              <span class="chk-text">Abstract View</span>
            </label>

            <label class="mini-toggle">
              <input type="checkbox" v-model="userStore.isQuickSelect" />
              <span class="track">
                <span class="thumb"></span>
              </span>
              <span class="toggle-text">Quick Select</span>
            </label>




            <div class="map-hud-bar">
              <!-- Slider 1: Base Size -->
              <div class="hud-item">
                <div class="hud-meta">
                  <span class="hud-name">Plantzones</span>
                  <span class="hud-val">{{ !userStore.plantzoneIconSize ? 'hide' : userStore.plantzoneIconSize + 'px' }}</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  step="1"
                  :value="userStore.plantzoneIconSize"
                  @input="userStore.plantzoneIconSize = Number($event.target.value)"
                  class="hud-range"
                />
              </div>

              <div class="hud-divider"></div>

              <!-- Slider 2: Target Scale Multiplier -->
              <div class="hud-item">
                <div class="hud-meta">
                  <span class="hud-name">Others</span>
                  <span class="hud-val">{{ userStore.otherIconSize }}px</span>
                </div>
                <input 
                  type="range" 
                  min="1" 
                  max="100" 
                  step="1"
                  :value="userStore.otherIconSize"
                  @input="userStore.otherIconSize = Number($event.target.value)"
                  class="hud-range accent"
                />
              </div>



              <div class="expandable-color-pill" v-show="userStore.isAbstractView">
                <!-- Current active indicator / custom picker trigger -->
                <label class="active-orb" :style="{ backgroundColor: userStore.pzRingHexColor }">
                  <input type="color" v-model="userStore.pzRingHexColor" class="hidden-color-input" />
                </label>

                <!-- Slide-out swatches -->
                <div class="slide-swatches">
                  <button 
                    v-for="c in [
                      '#ffffff', /* White */
                      '#ef4444', /* Red */
                      '#f59e0b', /* Warm Amber / Orange-Yellow */
                      '#22c55e', /* Green */
                      '#3b82f6', /* Blue */
                      '#a855f7', /* Purple */
                      '#000000'  /* Black */
                    ]"
                    :key="c"
                    class="preset-dot"
                    :class="{ 'is-active': userStore.pzRingHexColor?.toLowerCase() === c.toLowerCase() }"
                    :style="{ backgroundColor: c }"
                    @click="userStore.pzRingHexColor = c"
                  />
                </div>
              </div>











            </div>




            


            



            <button
              type="button"
              class="chip-toggle recenter-chip-btn"
              :class="{ active: userStore.isAbstractView && showGraphPanel }"
              :disabled="!userStore.isAbstractView"
              @click="toggleGraphPanel"
              :title="!userStore.isAbstractView
                ? 'Enable Abstract View to use Graph Processing panel'
                : (showGraphPanel ? 'Hide Graph Processing panel' : 'Show Graph Processing panel at default position')"
            >
              <span class="chip-dot"></span>
              <span>Graph Panel</span>
            </button>

            <ExperimentPanel />

            <button
              type="button"
              class="chip-toggle route-chip-btn"
              :class="{ active: isRouteActive, 'is-running': routeRunning }"
              @click="toggleQuickRoute"
              :title="routeRunning
                ? 'Click to cancel routing'
                : (isRouteActive
                  ? 'Hide routed solution overlay'
                  : 'Run preprocessing + Exact DP and display solution on map')"
            >
              <span class="chip-dot"></span>
              <span>
                <template v-if="routeRunning">Routing...</template>
                <template v-else-if="isRouteActive && graphStore.dpSolution?.minCost != null">
                  Route ({{ graphStore.dpSolution.minCost }} CP)
                </template>
                <template v-else>Route</template>
              </span>
            </button>


            <!-- Row 1: Actions / Buttons
            <div class="control-row">
              <button @click="generateRandomSources">Random Sources</button>
              <button @click="generateRandomTargets">Random Targets</button>
              <button @click="solveAltInstance" class="btn-primary">Solve</button>
            </div> -->

            <!-- Row 2: Modes & Checkboxes -->
            <!-- <div class="control-row">
              <label class="checkbox-label">
                <input type="checkbox" v-model="altOptions.showBags" />
                Show Bags
              </label>
              <label class="checkbox-label">
                <input type="checkbox" v-model="altOptions.renderStepByStep" />
                Step-by-Step DP
              </label>
              <label class="checkbox-label">
                <input type="checkbox" v-model="altOptions.pruneDegree2" />
                Prune Degree-2
              </label>
            </div> -->

            <!-- Row 3: Live Info / Metrics -->
            <!-- <div class="control-row info-row">
              <span>Seed: <strong>{{ currentSeed }}</strong></span>
              <span>Treewidth: <strong>{{ treewidth || '-' }}</strong></span>
              <span>Join Nodes: <strong>{{ joinCount || 0 }}</strong></span>
            </div> -->
          </div>






          <!-- <input type="checkbox" id="wr_cb" v-model="userStore.wasmRouting">
            <label for="wr_cb"> wasm routing</label><br/> -->
          <!--<input type="checkbox" v-model="userStore.wasm.tryMoreFrontierRings">
          tryMoreFrontierRings<br/>
          <input 
            type="range"
            style="width:4em"
            v-model.number="userStore.wasm.maxRemovalAttempts" 
            min="0"
            max="1000"
          >maxRemovalAttempts={{ userStore.wasm.maxRemovalAttempts }}<br/>
          <input 
            type="range"
            style="width:4em"
            v-model.number="userStore.wasm.maxFrontierRings" 
            min="0"
            max="10"
          >maxFrontierRings={{ userStore.wasm.maxFrontierRings }}<br/>
          <input 
            type="range"
            style="width:4em"
            v-model.number="userStore.wasm.ringComboCutoff" 
            min="0"
            max="10"
          >ringComboCutoff={{ userStore.wasm.ringComboCutoff }}-->
        </div>

        <div style="clear:both;"></div>

        <div id="workerlist">
          <details>
            <summary>All towns/workers list</summary>

            show:
            <label class="switch mauto">
              <input type="checkbox" v-model="userStore.displayWorkerNames">
              <span class="slider"></span>
              wrkr names
            </label>
            <label class="switch mauto">
              <input type="checkbox" v-model="userStore.displayNodeParent">
              <span class="slider"></span>
              parent node
            </label>
            <label class="switch mauto">
              <input type="checkbox" v-model="userStore.displayWorkerStatsRank" :disabled="userStore.displayWorkerStatsForPz">
              <span class="slider"></span>
              stat ranks
            </label>
            <label class="switch mauto">
              <input type="checkbox" v-model="userStore.displayWorkerStatsForPz" :disabled="userStore.displayWorkerStatsRank">
              <span class="slider"></span>
              stats after skills
            </label>
            <label class="switch mauto">
              <input type="checkbox" v-model="userStore.displayProfitPerCp">
              <span class="slider"></span>
              efficiency
            </label>

            <button @click="importDialogVisible = true">import</button>
            <button @click="fileExport()">export</button>
            <button v-if="0" @click="hireAll()">hire all</button>
            <button @click="fireAll()">fire all</button>
            
            <table>
              <template v-for="(o, tk) in gameStore.lodgingPerTown">
                <TownWorkers
                  :o="o"
                  :tk="Number(tk)"
                  @selectLodging="selectLodging"
                  @selectHouses="selectHouses"
                  @hireWorker="hireWorker"
                  @editWorker="editWorker"
                  @sendWorker="sendWorker"
                  @panToPaPos="panToPaPos"
                />
              </template>

            </table>
          </details>
        </div>
      </div>

      
    </div>

  </main>
</template>

<style scoped>
main {
  display: flex;
  flex-direction: column;
  height: 96%;
  overflow: hidden;
}
summary {
  cursor: pointer;
}
#mappane {
  /*width: 60%;*/
  flex-grow: 1;
}
#canvas-limiter {
  height: 100%;
  width: 100%;
  /*display: flex;
  justify-content: space-between;*/
}
#tooltip-OG {
  z-index: 1;
  position: absolute;
  pointer-events: none;
  color: rgb(160, 167, 180);
  background-color: rgb(41, 50, 60);
  padding: 10px;
}
#topleft {
  position: absolute;
  top: 0;
  max-height: 40%;
  background-color: var(--color-background);
  padding: 0 5px 5px 0;
  overflow: auto;
}
#leftside {
  position: absolute;
  bottom: 0;
  max-height: 90%;
}

#mapObjDetail {
  overflow: auto;
  background-color: var(--color-background);
  padding: 5px 5px 0 0;
  z-index: 4;
}
#rightside {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  float: right;
  max-height: 100%;
}
#totals {
  padding: 5px;
  float: right;
  text-align: right;
  background-color: var(--color-background);
  z-index: 20;
}
#workerlist {
  padding: 0 5px 5px 5px;
  float: right;
  text-align: right;
  background-color: var(--color-background);
  
  overflow-y: auto;
  /*height: 100px;
  flex: 1 1 auto;*/
}
#textpane {
  display: flex;
  flex-direction: column;
  width: 29em;
}
.lim2em {
  display: inline-block;
  width: 2em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.w30em {
  width: 30em;
}
.tooltip-OG {
  cursor: help;
}
.draggable {
  cursor: grab;
}
.draggable:hover {
  background: var(--color-background-soft);
}
.topcenter {
  position: absolute;
  top: 0;
  background-color: var(--color-background);
  padding: 0 5px 5px 5px;
  left: 50%;
  transform: translate(-50%, 0);
  overflow: auto;
}








/* iMad's changes */
/* Switch Layout */
.view-toggle-wrapper {
  position: fixed;
  top: 10px;            /* or bottom: 16px; */
  right: 15px;         /* offset from the right edge */
  z-index: 99999;       /* ensures it floats above the map canvas */

  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  user-select: none;
}

.view-suffix {
  font-size: 14px;
  color: #9ca3af;
}

/* The clickable capsule track */
.pill-switch {
  position: relative;
  display: flex;
  align-items: center;
  width: 90px;
  height: 32px;
  background-color: #26272b;
  border-radius: 9999px;
  border: 1px solid #3b3c42;
  padding: 3px;
  cursor: pointer;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s ease;
}

.pill-switch:hover {
  border-color: #4b4d56;
}

/* The sliding blue highlight pill */
.pill-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(50% - 2px);
  height: calc(100% - 4px);
  background-color: #3b82f6;
  border-radius: 9999px;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 1;
}

/* Move thumb to the right when Alt is active */
.pill-switch.is-alt .pill-thumb {
  transform: translateX(100%);
}

/* Text labels */
.pill-switch .label {
  flex: 1;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: #6b7280;
  z-index: 2;
  pointer-events: none; /* Allows clicks right on the text to trigger the button */
  transition: color 0.2s ease;
}

/* Active text colors */
.pill-switch:not(.is-alt) .label.og {
  color: #ffffff;
}

.pill-switch.is-alt .label.alt {
  color: #ffffff;
}


  .slider-indicator {
    pointer-events: none; /* Allows clicks to pass through to the labels/inputs underneath */
  }

  .view-switch-wrapper {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    user-select: none;
  }

  .view-label {
    font-weight: 500;
    color: #888;
  }

  /* Segmented Slider Track */
  .segmented-control {
    position: relative;
    display: flex;
    background-color: #2a2a2e;
    border-radius: 20px;
    padding: 3px;
    width: 130px;
    height: 32px;
    box-sizing: border-box;
  }

  .segmented-control input[type="radio"] {
    display: none;
  }

  .segmented-control label {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 2;
    font-weight: 600;
    color: #aaa;
    transition: color 0.2s ease;
  }

  /* Sliding Indicator Pill */
  .slider-indicator {
    position: absolute;
    top: 3px;
    left: 3px;
    width: calc(50% - 3px);
    height: calc(100% - 6px);
    background-color: #3b82f6; /* Accent color */
    border-radius: 16px;
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 1;
  }

  /* Slider Pill Animations & Active Label Colors */
  #view-og:checked ~ .slider-indicator {
    transform: translateX(0);
  }

  #view-alt:checked ~ .slider-indicator {
    transform: translateX(100%);
  }

  #view-og:checked + label,
  #view-alt:checked + label {
    color: #ffffff;
  }



.alt-control-panel {
  margin-top: 12px;
  padding: 12px 16px;
  background: #1e1e24;
  border: 1px solid #333;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.control-row button {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid #444;
  background: #2a2a32;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.control-row button:hover {
  background: #383844;
}

.control-row button.btn-primary {
  background: #2563eb;
  border-color: #3b82f6;
}

.control-row button.btn-primary:hover {
  background: #1d4ed8;
}

.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #ddd;
  cursor: pointer;
  user-select: none;
}

.info-row {
  font-size: 12px;
  color: #999;
  border-top: 1px solid #2a2a30;
  padding-top: 8px;
  gap: 20px;
}

.info-row strong {
  color: #38bdf8;
}






.custom-chk {
  position: fixed;
  top: 14px;            /* or bottom: 16px; */
  right: 120px;         /* offset from the right edge */
  z-index: 99999;       /* ensures it floats above the map canvas */

  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
  color: #cbd5e1;
}

.custom-chk input {
  display: none;
}

.chk-box {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: #18181b;
  border: 1px solid #3f3f46;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.chk-box svg {
  width: 10px;
  height: 10px;
  fill: none;
  stroke: #ffffff;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 16;
  stroke-dashoffset: 16;
  transition: stroke-dashoffset 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.custom-chk:hover .chk-box {
  border-color: #52525b;
}

.custom-chk input:checked + .chk-box {
  background: #2563eb;
  border-color: #3b82f6;
}

.custom-chk input:checked + .chk-box svg {
  stroke-dashoffset: 0;
}



.mini-toggle {
  position: fixed;
  top: 14px;
  right: 240px;
  z-index: 99999;

  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
  color: #cbd5e1;
}

.mini-toggle input {
  display: none;
}

.mini-toggle .track {
  width: 28px;
  height: 16px;
  background-color: #27272a;
  border: 1px solid #3f3f46;
  border-radius: 9999px;
  position: relative;
  transition: background-color 0.2s ease, border-color 0.2s ease;
  flex-shrink: 0;
}

.mini-toggle .thumb {
  width: 12px;
  height: 12px;
  background-color: #a1a1aa;
  border-radius: 50%;
  position: absolute;
  top: 1.5px;
  left: 2px;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s ease;
}

.mini-toggle:hover .track {
  border-color: #52525b;
}

.mini-toggle input:checked + .track {
  background-color: #2563eb;
  border-color: #3b82f6;
}

.mini-toggle input:checked + .track .thumb {
  transform: translateX(11px);
  background-color: #ffffff;
}



.chip-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: #1e1e24;
  border: 1px solid #333338;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  font-weight: 500;
  color: #94a3b8;
  transition: all 0.15s ease;
}

.chip-toggle input {
  display: none;
}

.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #475569;
  transition: background-color 0.2s ease;
}

.chip-toggle:hover {
  background: #27272f;
  border-color: #475569;
}

.chip-toggle.active {
  background: rgba(37, 99, 235, 0.15);
  border-color: #3b82f6;
  color: #93c5fd;
}

.chip-toggle.active .chip-dot {
  background: #3b82f6;
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.6);
}


.chip-toggle:hover:not(:disabled) {
  background: #27272f;
  border-color: #475569;
}

.chip-toggle:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.recenter-chip-btn:hover:not(:disabled) .chip-dot {
  background: #38bdf8;
  box-shadow: 0 0 6px rgba(56, 189, 248, 0.7);
}








.map-hud-bar {
  position: fixed;
  top: 12px;
  left: 20px;
  z-index: 99999;
  
  display: flex;
  align-items: center;
  gap: 12px;
  
  /* Seamless blend with sidebar */
  background: transparent;
  border: none;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  padding: 0;
  pointer-events: auto;
  user-select: none;
}

.hud-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 82px;
}

.hud-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 10px;
  line-height: 1.2;
}

.hud-name {
  color: #94a3b8;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.hud-val {
  color: #38bdf8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  font-size: 10px;
}

/* Hide the vertical separator */
.hud-divider {
  display: none;
}

/* Slim Track */
.hud-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.18);
  outline: none;
  cursor: pointer;
  margin: 3px 0 1px 0;
}

/* Drag Knobs */
.hud-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #38bdf8;
  border: 1.5px solid #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  cursor: grab;
  transition: transform 0.1s ease;
}

.hud-range::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.hud-range::-moz-range-thumb {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #38bdf8;
  border: 1.5px solid #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  cursor: grab;
}

/* Scale slider styling */
.hud-range.accent::-webkit-slider-thumb {
  background: #f59e0b;
}

.hud-range.accent::-moz-range-thumb {
  background: #f59e0b;
}

.hud-item:last-child .hud-val {
  color: #f59e0b;
}




#tooltip {
  position: absolute;
  pointer-events: none;
  z-index: 999999;
  background: rgba(15, 23, 42, 0.94);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: #f1f5f9;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 8px 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 11px;
  line-height: 1.4;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  min-width: 220px;
  transform: translate(12px, 12px); /* Offset slightly from cursor */
}

.tooltip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  font-size: 12px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  gap: 8px;
}

.tooltip-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.badge-taken {
  color: #4ade80;
  background: rgba(34, 197, 94, 0.18);
  border: 1px solid rgba(74, 222, 128, 0.6);
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.25);
}

.badge-free {
  color: #94a3b8;
}

.tooltip-town {
  color: #60a5fa;
  font-weight: 600;
  margin-top: 2px;
}

.tooltip-icons {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.tooltip-children {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.tooltip-child-row {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.child-main {
  display: flex;
  align-items: center;
  gap: 6px;
}

.child-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #64748b;
  flex-shrink: 0;
}

.child-status-dot.active {
  background: #4ade80;
  box-shadow: 0 0 6px #4ade80;
}

.child-name {
  font-weight: 600;
  color: #e2e8f0;
}

.child-icons {
  display: inline-flex;
  gap: 2px;
  margin-left: 2px;
}

.child-sub {
  display: flex;
  justify-content: space-between;
  padding-left: 12px;
  font-size: 10px;
  color: #94a3b8;
}

.child-profit strong {
  color: #38bdf8;
}

.child-pct {
  font-weight: 700;
}

.child-specialty {
  font-style: italic;
  color: #cbd5e1;
}




#tooltip {
  position: absolute;
  pointer-events: none; /* Mouse passes through when simply hovering */
  z-index: 999999;
  background: rgba(15, 23, 42, 0.94);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: #f1f5f9;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 8px 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 11px;
  line-height: 1.4;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  min-width: 220px;
  transform: translate(12px, 12px);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

/* When pinned: activate mouse clicks & highlight edge */
#tooltip.is-pinned {
  pointer-events: auto;
  border-color: #38bdf8;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(56, 189, 248, 0.4);
}

.tooltip-title-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pin-indicator {
  font-size: 11px;
  line-height: 1;
}

.tooltip-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tooltip-close-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;
  transition: color 0.1s ease;
}

.tooltip-close-btn:hover {
  color: #f8fafc;
}


.tooltip-header.is-draggable {
  cursor: grab;
  user-select: none;
}

.tooltip-header.is-draggable:active {
  cursor: grabbing;
}

.tooltip-title-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.drag-grip {
  font-size: 13px;
  color: #64748b;
  line-height: 1;
  letter-spacing: -1.5px;
}

.tooltip-close-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  line-height: 1;
  border-radius: 4px;
  transition: color 0.15s ease, background 0.15s ease;
}

.tooltip-close-btn:hover {
  color: #f8fafc;
  background: rgba(255, 255, 255, 0.1);
}


























/* Card Container — Soft Warm Burgundy / Wine */
.pz-tooltip-card {
  position: absolute;
  pointer-events: none; /* Ignored while purely hovering */
  z-index: 1000;
  background: rgba(34, 14, 18, 0.94);
  border: 1.5px solid #882d3d;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.65), 0 0 16px rgba(225, 29, 72, 0.18);
  border-radius: 8px;
  padding: 10px 14px;
  min-width: 320px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #ffe4e6;
  backdrop-filter: blur(6px);
  transform: none !important;
}

.pz-tooltip-card.is-pinned {
  border-color: #fb7185;
  box-shadow: 0 0 22px rgba(244, 63, 94, 0.45);
  pointer-events: auto; /* Clickable and draggable once pinned */
}

/* Header */
.pz-tooltip-card .pz-tooltip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pz-tooltip-card .pz-title-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}

.pz-tooltip-card .pz-title {
  font-size: 14px;
  font-weight: 700;
  color: #fff1f2;
  white-space: nowrap;
}

.pz-tooltip-card .pz-item-icons {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
}

/* Badges */
.pz-tooltip-card .pz-badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 2px 7px;
  border-radius: 4px;
  white-space: nowrap;
}

.pz-tooltip-card .badge-free {
  color: #bfa0a6;
}

.pz-tooltip-card .badge-taken {
  color: #4ade80; /* Bright mint green */
  background: rgba(34, 197, 94, 0.18);
  border: 1px solid rgba(74, 222, 128, 0.6);
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.25); /* Subtle glow for contrast against burgundy */
}

/* Soft Rose Divider */
.pz-divider {
  height: 1px;
  background: linear-gradient(90deg, #9f1239 0%, rgba(159, 18, 57, 0.15) 100%);
  margin: 8px 0 10px 0;
}

/* Financial Stats Rows */
.pz-tooltip-card .pz-stats-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.pz-tooltip-card .pz-stat-row {
  display: flex;
  align-items: center;
  width: 100%;
  white-space: nowrap;
  line-height: 1.3;
}

.pz-tooltip-card .pz-stat-label {
  color: #fda4af; /* Soft rose */
  font-weight: 600;
  min-width: 58px;
}

.pz-tooltip-card .pz-income-val {
  color: #fb7185; /* Vibrant warm coral-rose */
  font-weight: 700;
}

.pz-tooltip-card .pz-income-val.text-active {
  color: #4ade80; /* Preserved green for active allocation */
}

/* Right-aligned Town Name */
.pz-tooltip-card .pz-town-name {
  color: #fecdd3; /* Pale rose blush */
  font-weight: 500;
  text-align: right;
  margin-left: auto;
}

.pz-tooltip-card .pz-spacer {
  flex: 1;
}

.pz-tooltip-card .pz-na-label {
  color: #885e65;
  font-style: italic;
}

/* Track & Sprite Movement */
.pz-tooltip-card .pz-worker-track {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 32px;
  height: 18px;
  margin: 0 10px;
  position: relative;
  overflow: visible;
}

.pz-tooltip-card .pz-worker-sprite {
  position: absolute;
  top: 50%;
  transform-origin: center center;
  font-size: 14px;
  line-height: 1;
  will-change: left, transform;
  animation: uniformWorkerPatrol 4s linear infinite;
}

@keyframes uniformWorkerPatrol {
  0% {
    left: 0%;
    transform: translateY(-50%) scaleX(1);
  }
  48% {
    left: calc(100% - 18px);
    transform: translateY(-50%) scaleX(1);
  }
  50% {
    left: calc(100% - 18px);
    transform: translateY(-50%) scaleX(-1);
  }
  98% {
    left: 0%;
    transform: translateY(-50%) scaleX(-1);
  }
  100% {
    left: 0%;
    transform: translateY(-50%) scaleX(1);
  }
}

.pz-tooltip-header.is-draggable {
  cursor: grab;
  user-select: none;
}

.pz-tooltip-header.is-draggable:active {
  cursor: grabbing;
}

.pz-title-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pz-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}


.pz-town-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}



/* Ensure row behaves as a strict flex container */
.pz-stat-row {
  display: flex;
  align-items: center;
  width: 100%;
}

/* Fixes the text collision by bundling profit and % on the left with a clean gap */
.pz-profit-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* Forces everything after it (the town name) to stick to the right edge */
.pz-spacer {
  flex: 1 1 auto;
}

/* Right-align the town */
.pz-town-name {
  margin-left: auto;
  text-align: right;
  white-space: nowrap;
}

/* 100% Efficiency green for Max income */
.text-max-perfect {
  color: #4ade80 !important;
  font-weight: 600;
}

.pz-child-pct {
  font-weight: 700;
  font-size: 12.5px;
  letter-spacing: 0.2px;
}









.color-swatch-btn {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid #ffffff;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  position: relative;
  display: inline-block;
}

.hidden-color-input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
  pointer-events: none;
}

.preset-palette {
  display: flex;
  gap: 4px;
}

.preset-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.6);
  padding: 0;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.preset-dot:hover {
  transform: scale(1.2);
}



.expandable-color-pill {
  position: fixed;
  top: 8px;
  left: 210px;
  z-index: 100;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 4px;
  border-radius: 9999px;
  backdrop-filter: blur(8px);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  max-width: 32px; /* Collapsed */
}

/* Expanded width to fit all 7 circles comfortably */
.expandable-color-pill:hover {
  max-width: 250px;
  padding: 4px 10px 4px 4px;
  gap: 8px;
}

.active-orb {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid #ffffff;
  cursor: pointer;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.5);
  position: relative;
}

.slide-swatches {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.2s ease 0.05s;
}

.expandable-color-pill:hover .slide-swatches {
  opacity: 1;
}

.preset-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  /* Inset border ensures dark swatches (like #000000) stay distinct */
  border: 1px solid rgba(255, 255, 255, 0.35);
  padding: 0;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
  flex-shrink: 0;
}

.preset-dot:hover {
  transform: scale(1.2);
}

.preset-dot.is-active {
  border-color: #ffffff;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.8);
  transform: scale(1.15);
}

.hidden-color-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}



.home-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}



.tooltip-reduction-box {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 6px;
  padding-top: 5px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.pz-reduction-meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid rgba(244, 63, 94, 0.25);
}

.reduction-info-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.reduction-label {
  font-size: 10px;
  font-weight: 600;
  color: #94a3b8;
  white-space: nowrap;
  padding-top: 2px;
}

.reduction-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-width: 260px;
}

.reduction-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.35;
}

.reduction-chip small {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-weight: 500;
  opacity: 0.85;
}

.cluster-chip {
  background: rgba(56, 189, 248, 0.14);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #bae6fd;
}

.source-chip {
  background: rgba(52, 211, 153, 0.14);
  border: 1px solid rgba(52, 211, 153, 0.38);
  color: #a7f3d0;
}

.pz-chip {
  background: rgba(244, 63, 94, 0.16);
  border: 1px solid rgba(244, 63, 94, 0.38);
  color: #fecdd3;
}

.pz-source-chip {
  background: rgba(251, 191, 36, 0.15);
  border: 1px solid rgba(251, 191, 36, 0.38);
  color: #fde68a;
}


.target-cluster-chip {
  background: rgba(244, 63, 94, 0.22);
  border: 1px solid rgba(251, 113, 133, 0.65);
  color: #fecdd3;
  box-shadow: 0 0 6px rgba(244, 63, 94, 0.2);
}


.recenter-chip-btn:active {
  background: rgba(37, 99, 235, 0.2);
  border-color: #3b82f6;
  color: #93c5fd;
}

.recenter-chip-btn:hover .chip-dot {
  background: #38bdf8;
  box-shadow: 0 0 6px rgba(56, 189, 248, 0.7);
}

.route-chip-btn {
  width: 100%;
  justify-content: flex-start;
  box-sizing: border-box;
}

.route-chip-btn.is-running {
  background: rgba(245, 158, 11, 0.16);
  border-color: #f59e0b;
  color: #fde68a;
}

.route-chip-btn.is-running .chip-dot {
  background: #fbbf24;
  box-shadow: 0 0 6px rgba(251, 191, 36, 0.8);
}

</style>