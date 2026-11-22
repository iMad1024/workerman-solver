<script>
import {useGameStore} from '../stores/game'
import {useUserStore} from '../stores/user'
import {useGraphStore} from '../stores/graph'
import {useRoutingStore} from '../stores/routing'
import {useMarketStore} from '../stores/market'
import {useMapStore} from '../stores/map'
import {Deck, OrthographicView, LinearInterpolator, TransitionInterpolator} from '@deck.gl/core';
import {BitmapLayer, LineLayer, IconLayer} from '@deck.gl/layers';
import {TileLayer} from '@deck.gl/geo-layers';
import Heap from 'heap';
import {makeIconImg, formatFixed} from '../util.js'
import { isNumber } from 'jstat-esm/lib/core/helpers';
import { ScatterplotLayer } from '@deck.gl/layers';

function lerp(from, to, t) {
  return from + (to - from) * t;
}


/*class MyInterpolator extends TransitionInterpolator {
  constructor({speed = 100} = {}) {
    super({compare: ['x', 'y']});

    // units per second
    this.speed = speed;
  }

  getDuration(startViewState, endViewState) {
    console.log('startViewState', startViewState)
    const dx = Math.abs(startViewState.target[0] - endViewState.target[0]);
    const dy = Math.abs(startViewState.target[1] - endViewState.target[1]);
    return Math.sqrt(dx*dx, dy*dy) / this.speed * 1000;
  }

  initializeProps(startViewState, endViewState) {
    return {
      start: {x: startViewState.target[0], y: startViewState.target[1]},
      end: {x: endViewState.target[0], y: endViewState.target[1]}
    };
  }

  interpolateProps(start, end, t) {
    const x = lerp(start.x, end.x, t);
    const y = lerp(start.y, end.y, t);
    return {x, y};
  }
}*/

// =========================================================================
// SOLVE TAB VISUALIZATION TUNING PARAMETERS
// =========================================================================
const BAG_X_CONFIG = {
  //color: '#00f5d4',     // Bright neon cyan-mint (try '#facc15' gold or '#ff007f' magenta)
  color: '#facc15',
  sizePx: 22,           // Pixel width/height of the thick X icon
  strokeWidth: 34,      // SVG stroke width inside 128x128 icon box (24..40)
};

const BAG_EDGE_CUT_CONFIG = {
  enabled: true,
  cutRatio: 0.5,        // Fraction of edge cut from each bag vertex (0.5 = half way, 1.0 = full edge)
  mode: 'invisible',    // 'invisible' | 'black' | 'x-color' | 'dim'
  blackRgba: [10, 14, 20, 220],   // Used when mode === 'black'
  dimRgba: [255, 255, 255, 55],   // Used when mode === 'dim'
  xColorAlpha: 180,               // Alpha (0..255) when mode === 'x-color'
};

const COMPONENT_UNDERLINE_CONFIG = {
  widthPx: 11,          // Wide underline width in pixels (main white edge is 3px)
  alpha: 115,           // Semi-transparency 0..255 (~0.45 opacity)
  palette: [
    [56, 189, 248],     // Sky Blue
    [251, 191, 36],     // Amber Gold
    [168, 85, 247],     // Purple
    [52, 211, 153],     // Emerald
    [244, 63, 94],      // Rose
    [251, 146, 60],     // Orange
    [45, 212, 191],     // Teal
    [129, 140, 248],    // Indigo
    [163, 230, 53],     // Lime
    [232, 121, 249],    // Fuchsia
  ],
};

function makeThickXIconUrl(color = BAG_X_CONFIG.color, strokeWidth = BAG_X_CONFIG.strokeWidth) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <line x1="22" y1="22" x2="106" y2="106" stroke="#000000" stroke-width="${strokeWidth + 10}" stroke-linecap="round" opacity="0.75"/>
    <line x1="106" y1="22" x2="22" y2="106" stroke="#000000" stroke-width="${strokeWidth + 10}" stroke-linecap="round" opacity="0.75"/>
    <line x1="22" y1="22" x2="106" y2="106" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
    <line x1="106" y1="22" x2="22" y2="106" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Helper at top of NodeMap.vue <script>:
function loadLegendPos() {
  try {
    const raw = localStorage.getItem('solve_legend_pos');
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return parsed;
    }
  } catch {}
  return { x: 0, y: 0 };
}

export default {
  setup() {
    // this is not early enough
    const gameStore = useGameStore()
    const userStore = useUserStore()
    const routingStore = useRoutingStore()
    const marketStore = useMarketStore()
    const mapStore = useMapStore()

    const graphStore = useGraphStore();

    userStore.$subscribe((mutation, state) => {
      const start = Date.now()
      localStorage.setItem('user', JSON.stringify(state))
      console.log('userStore subscription took', Date.now()-start, 'ms')
    })

    mapStore.$subscribe((mutation, state) => {
      localStorage.setItem('map', JSON.stringify(state))
    })

    return { 
      gameStore, 
      userStore, 
      routingStore, 
      marketStore, 
      mapStore,

      graphStore
    }
  },

  props: {
    clickedObj: Object,
    hoverInfo: Object,
    panToPzk: String,
    panPaPos: Object,
    panBbox: Object,
    highlightNodes: Set,
  },

  emits: [
    'update:hoverInfo',
    'update:clickedObj',
    'update:panToPzk',
    'update:panPaPos',
    'panAnywhere',
  ],

  data: () => ({
    deck: null,
    tileLayer: null,
    iconData: [],
    iconPositions: {},
    iconLayer: null,
    highlightedIconLayer: null,
    lineData: [],
    lineLayer: null,
    clickedObject: null,
    pzkSelectedTown: {},
    initialViewState: {
      target: [0, 0],
      zoom: -8,
      minZoom: -12,
      maxZoom: -5,
      //transitionDuration: 1000,
      //transitionInterpolator: new MyInterpolator(1000)
    },
    mapStateSavedTimestamp: 0,
    hiddenNodesCount: 0,


    // iMad's changes
    ///////////////////////////////////////////////
    altIconLayer: null,
    altBgIconLayer: null,
    altLineLayer: null,
    altSolLineLayer: null,
    altHaloLayer: null,
    solveComponentLineLayer: null,
    solveBagXLayer: null,

    legendPos: loadLegendPos(),
    isDraggingLegend: false,
    legendDragStart: { mouseX: 0, mouseY: 0, posX: 0, posY: 0 },
    bagXColor: BAG_X_CONFIG.color,

    hoveredNodeKey: null,
    selectedNodeKey: null,

    
  }),

  created() {
    
  },

  async mounted() {
    function until(conditionFunction) {
      const poll = resolve => {
        if (conditionFunction()) resolve();
        else setTimeout(_ => poll(resolve), 100);
      }
      return new Promise(poll);
    }

    console.log('NodeMap mounted, sleeping')
    await until(_ => this.gameStore.ready == true && this.iconsCalc)
    console.log('resuming')

    // Precompute heavy plantzone profits once before deck & layers initialize
    if (typeof this.gameStore.nearestTownProfit === 'function') {
      this.gameStore.nearestTownProfit();
    }

    this.iconData = await (await fetch(`data/deck_icons.json`)).json()
    this.iconPositions = await (await fetch(`data/deck_icon_positions.json`)).json()
    this.lineData = await (await fetch(`data/deck_links.json`)).json()
    
    if (this.panToPzk in this.gameStore.nodes) {
      console.log('panning to node', this.panToPzk)
      const p = this.gameStore.nodes[this.panToPzk].pos
      this.mapStore.target = [p.x, -p.z]
      this.mapStore.zoom = -7
      //this.panToPzk = null
    }
    
    this.initialViewState.target = [...this.mapStore.target]
    this.initialViewState.zoom = this.mapStore.zoom
    this.deck = this.initializeDeck()

    // Register event handlers once
    this.deck.setProps({
      onViewStateChange: ({ viewState }) => {
        // 1. Maintain camera and sync back to mapStore for refresh persistence
        this.deck.setProps({ viewState });
        if (this.onMoveEvent) {
          this.onMoveEvent({ viewState });
        }

        // Only project the pinned tooltip if one is active
        if (this.pinnedInfo?.coordinate && this.deck) {
          const viewport = this.deck.getViewports()[0];
          if (viewport) {
            const [screenX, screenY] = viewport.project(this.pinnedInfo.coordinate);

            const dx = this.pinnedInfo.deltaX ?? 0;
            const dy = this.pinnedInfo.deltaY ?? 0;
            
            this.pinnedInfo = {
              ...this.pinnedInfo,
              x: screenX + dx,
              y: screenY + dy
            };
            this.$emit('update:pinnedInfo', this.pinnedInfo);
          }
        }
      },

      // Deck root click: handles unpinning when clicking empty canvas
      onClick: (info) => {
        if (!info.object) {
          this.selectedNodeKey = null;
          this.hoveredNodeKey = null;
          this.pinnedInfo = null;

          this.$emit('update:pinnedInfo', null);
          this.$emit('update:hoverInfo', null);

          this.refreshHalo();
        }
      }
    });

    //this.updateDeck()

    window.addEventListener('resize', this.onWindowResizeLegend);
  },

  beforeUnmount() {
    window.removeEventListener('resize', this.onWindowResizeLegend);
    this.stopLegendDrag();
  },

  watch: {
    //iMad's changes
    ////////////////////////////////////////
    freeTargetSet() {
      this.updateLayers();
    },
    'graphStore.legendResetTick'() {
      this.resetLegendPos();
    },
    'graphStore.solutionGraphMode'() {
      this.updateLayers();
    },
    hoveredTownTargetKeys() {
      this.refreshHalo();
    },
    'graphStore.dpSolution'() {
      this.updateLayers();
    },
    'graphStore.showSolutionView'() {
      this.updateLayers();
    },
    'graphStore.displayReduceSnapshot'() {
      this.updateLayers();
    },
    'graphStore.dpSelectedVertexSet'() {
      this.updateLayers();
    },
    'graphStore.tdViewMode'() {
      this.updateLayers();
    },
    'graphStore.activeBagId'() {
      this.updateLayers();
    },
    'graphStore.treeDecomposition'() {
      this.updateLayers();
    },
    // Watch the property inside userStore directly:
    'graphStore.activeTab'() {
      this.updateLayers();
    },
    'graphStore.instanceMapMode'() {
      this.updateLayers();
    },
    'graphStore.customInstance'() {
      this.updateLayers();
    },
    'graphStore.instanceSource'() {
      this.updateLayers();
    },
    'graphStore.reduceStepIndex'() {
      this.updateLayers();
    },
    'graphStore.reducedGraph'() {
      this.updateLayers();
    },
    'graphStore.topKPzCount'(newValue) {
      this.updateLayers();
    },
    'graphStore.freeTargetCount'() {
      this.updateLayers();
    },

    'userStore.pzRingHexColor'(newColor) {
      if (!this.deck) return;

      // Rebuild both regular and highlighted icon layers
      this.updateLayers();
    },
    activeHaloKey() {
        this.refreshHalo();
    },
    hoveredSourceTownKeys() {
      this.refreshHalo();
    },
    // Re-run your layer builder whenever the halo target changes
    // activeHaloKey() {
    //   this.updateLayers();
    // },
    'userStore.isAltView'(newValue) {
      this.updateLayers();
    },
    'userStore.isParentHide'(newValue) {
      this.updateLayers();
    },
    'userStore.isAbstractView'(newValue) {
      this.updateLayers();
    },
    'userStore.isSolutionView'(newValue) {
      this.updateLayers();
    },
    'userStore.showMode'(newValue) {
      this.updateLayers();
    },
    'userStore.targetList'(newValue) {
      this.updateLayers()
    },
    'userStore.plantzoneIconSize'(newValue) {
      this.updateLayers()
    },
    'userStore.otherIconSize'(newValue) {
      this.updateLayers()
    },
    /////////////////////////////////////////////////////////////////
    'routingStore.routing.autotakenNodes'(newValue) {
      this.updateLayers()
    },
    'userStore.mapHideInactive'(newValue) {
      this.updateLayers()
    },
    'linesCalc'(newValue) {
      this.updateLayers()
    },
    'highlightNodes'(newValue) {
      //this.updateLayers()  // done via HomeView.$refs.nodeMap.updateLayers()
    },
    'panPaPos'(newValue) {
      //console.log('panPaPos changed', newValue)
      if (newValue) {
        if (this.deck) this.panTo(newValue.x, newValue.z, -7)
      }
    },
  },

  computed: {
    scores() {
      const ts = Date.now()

      const costs = this.gameStore.nodes
      const links = this.gameStore.links

      const start = 0
      links[start] = this.gameStore.townsWithLodging

      let unvisited = new Heap((a, b) => pathCosts[a] - pathCosts[b])
      unvisited.push(start)
      let pathCosts = {[start]: 0}
      let needTakes = {[start]: []}
      
      var current
      while (unvisited.size()) {
        current = unvisited.pop()
        links[current].forEach(neighbor => {
          if (!(neighbor in costs)) {
            return
          }
          const newDistance = pathCosts[current] + costs[neighbor].CP
          if (neighbor in pathCosts) {
            // already met before, already in heap
            if (newDistance < pathCosts[neighbor]) {
              pathCosts[neighbor] = newDistance
              needTakes[neighbor] = [...needTakes[current], neighbor]
            }
          }
          else {
            unvisited.push(neighbor)
            pathCosts[neighbor] = newDistance
            needTakes[neighbor] = [...needTakes[current], neighbor]
          }
        })
      }

      console.log('scoreAll took', Date.now()-ts, 'ms')
      return { needTakes, pathCosts }
    },

    iconsCalc() {
      const ret = []
      this.hiddenNodesCount = 0
      if (!this.iconData) return ret
      // Explicitly reference mapHideInactive to ensure reactivity
      //const { mapHideInactive, autotakenNodes } = this.userStore;
      const highlighteds = []
      this.iconData.forEach(([key, kind]) => {
        if (key in this.gameStore.nodes) {
          const taken = this.routingStore.routing.autotakenNodes.has(key)
          if (this.userStore.mapHideInactive && !taken) {
            this.hiddenNodesCount += 1
            //return
          }
          // by search
          const isHighlighted = this.highlightNodes && this.highlightNodes.has(key)
          const newIcon = {
            key,
            kind,
            pos: this.iconPositions[key],
            taken,
            isHighlighted,
            thisCpCost: this.gameStore.ready ? this.gameStore.nodes[key].CP : 0,
            // not displayed:
            //fromTown: this.scores.needTakes[key][0],
            //fromTownCpCost: this.scores.pathCosts[key],
            //fromTownPath: this.scores.needTakes[key],
          }

          ret.push({
            ...newIcon, 
            hidden: (this.userStore.mapHideInactive && !newIcon.taken) || isHighlighted
          })
          highlighteds.push({
            ...newIcon, 
            hidden: !isHighlighted
          })
        }
      })

      console.log('iconsCalc', this.hiddenNodesCount, 'hidden')
      return { normal: ret, highlighted: highlighteds}
    },

    linesCalc() {
      const colorInactive = [172,172,172,255]
      const colorWorker =   [255,179,  0,255]
      const colorGrind =    [255,109,  0,255]
      const colorWagon =    [255, 49,  0,255]
      
      let ret = []
      this.lineData.forEach(([a, b]) => {
        let color = colorInactive
        const key = `${a}-${b}`
        if (key in this.routingStore.routing.linkColors) {
          if (this.routingStore.routing.linkColors[key] == 'grind') {
            color = colorGrind
          }
          else if (this.routingStore.routing.linkColors[key] == 'worker') {
            color = colorWorker
          }
          else if (this.routingStore.routing.linkColors[key] == 'wagon') {
            color = colorWagon
          }
        }

        ret.push({
          start: this.iconPositions[a],
          end: this.iconPositions[b],
          color
        })
      })

      const colorSpreadPlantzone = [64,255,0,255]
      const colorSpreadWorkshop = [34,222,168,255]

      if (this.clickedObject) {
        if (this.clickedObject.key in this.routingStore.pzJobs) {
          const job = this.routingStore.pzJobs[this.clickedObject.key]
          let prev = undefined
          for (const nk of job.usedPath) {
            if (prev)
              ret.push({
                start: this.iconPositions[prev],
                end: this.iconPositions[nk],
                color: colorSpreadPlantzone,
              })
            prev = nk
          }
        }
        if (this.gameStore.isLodgingTown(this.clickedObject.key)) {
          const tk = this.gameStore.tnk2tk(this.clickedObject.key)
          this.userStore.townWorkers(tk).forEach(w => {
            if (this.gameStore.jobIsPz(w.job)) {
              const job = this.routingStore.pzJobs[w.job.pzk]

              let prev = undefined
              for (const nk of job.usedPath) {
                if (prev)
                  ret.push({
                    start: this.iconPositions[prev],
                    end: this.iconPositions[nk],
                    color: colorSpreadPlantzone,
                  })
                prev = nk
              }
            }
            if (this.gameStore.jobIsWorkshop(w.job)) {
              // multiple workers can meet this criteria but we only need one
              const job = this.routingStore.wsJobs.find(j => 
                j.worker.tnk == this.clickedObject.key &&
                j.hk == w.job.hk
              )
              
              let prev = undefined
              for (const nk of job.usedPath) {
                if (prev)
                  ret.push({
                    start: this.iconPositions[prev],
                    end: this.iconPositions[nk],
                    color: colorSpreadWorkshop,
                  })
                prev = nk
              }
            }
          })
        }
      }
      //console.log('linesCalc', ret)
      return ret
    },


    activeHaloKey() {
      return this.selectedNodeKey || this.hoveredNodeKey;
    },


    // Set of town node keys that need the blue highlight halo
    hoveredSourceTownKeys() {
      const activeKey = this.activeHaloKey;
      if (!activeKey) return new Set();

      const townKeys = new Set();
      const sourceList = this.graphStore?.getActiveSource || {};
      const snap = this.graphStore?.displayReduceSnapshot;

      const addSourcesForNode = (nodeKey) => {
        const raw = sourceList[nodeKey] ?? sourceList[String(nodeKey)];
        if (Array.isArray(raw)) {
          for (const t of raw) {
            if (t != null) townKeys.add(String(t));
          }
        } else if (raw != null) {
          townKeys.add(String(raw));
        }
      };

      // 1. Direct lookup (covers plantzones on INSTANCE tab AND merged target/parent nodes on REDUCE/SOLVE)
      addSourcesForNode(activeKey);

      // 2. If activeKey is a parent node on INSTANCE tab, also collect its children's assigned towns
      if (
        this.graphStore?.parentSet?.has(Number(activeKey)) ||
        this.graphStore?.parentSet?.has(String(activeKey))
      ) {
        const childKeys = this.gameStore?.nodes?.[activeKey]?.children || [];
        for (const childKey of childKeys) {
          addSourcesForNode(childKey);
        }
      }

      // 3. If on REDUCE/SOLVE tab and activeKey is a merged cluster, include any cluster members' sources
      if (snap?.nodeClusters?.[activeKey]) {
        for (const memberId of snap.nodeClusters[activeKey]) {
          addSourcesForNode(memberId);
        }
      }

      return townKeys;
    },


    // Set of target node keys assigned to `activeHaloKey` when `activeHaloKey` is a town
    hoveredTownTargetKeys() {
      const activeKey = this.activeHaloKey;
      if (!activeKey) return new Set();

      const townSet = this.graphStore?.townSet;
      const numActive = Number(activeKey);
      const hasSnap = Boolean(this.graphStore?.displayReduceSnapshot);
      const isTown =
        townSet?.has(numActive) ||
        townSet?.has(String(activeKey)) ||
        (!hasSnap && (
          Boolean(this.gameStore?.isLodgingTown?.(activeKey)) ||
          Boolean(this.gameStore?.isLodgingTown?.(numActive))
        ));

      if (!isTown) return new Set();

      const targetKeys = new Set();
      const sourceList = this.graphStore?.getActiveSource;
      const snap = this.graphStore?.displayReduceSnapshot;

      const hasTown = (raw) => {
        if (Array.isArray(raw)) {
          return raw.some((t) => t != null && (String(t) === String(activeKey) || Number(t) === numActive));
        }
        return raw != null && (String(raw) === String(activeKey) || Number(raw) === numActive);
      };

      const addTarget = (tKey) => {
        if (tKey == null) return;
        const resolved = this.resolveDisplayHaloKey(tKey);
        targetKeys.add(String(resolved));
      };

      if (Array.isArray(sourceList)) {
        for (const entry of sourceList) {
          if (entry?.targetId != null && hasTown(entry.sourceId)) {
            addTarget(entry.targetId);
          }
        }
      } else if (sourceList && typeof sourceList === 'object') {
        for (const [tKey, rawTowns] of Object.entries(sourceList)) {
          if (hasTown(rawTowns)) {
            addTarget(tKey);
          }
        }
      }

      // If on REDUCE/SOLVE tab and a merged cluster contains any of these targets, include the cluster key too
      if (snap?.nodeClusters) {
        for (const [clusterKey, members] of Object.entries(snap.nodeClusters)) {
          if (Array.isArray(members) && members.some((m) => targetKeys.has(String(m)))) {
            targetKeys.add(String(clusterKey));
          }
        }
      }

      return targetKeys;
    },


    activeGraphEdges() {
      //const links = this.activeGraphLinks; // Adjust if activeGraphLinks is a getter/ref
      //const links = this.userStore.getActiveGraphLinks;
      const links = this.graphStore.getActiveGraphLinks;
      const edges = [];
      const seen = new Set();

      for (const [nodeKey, neighbors] of Object.entries(links)) {
        if (!neighbors) continue;
        
        for (const neighbor of neighbors) {
          // Normalize to strings for comparison, but keep numbers if your renderer needs them
          const a = String(nodeKey);
          const b = String(neighbor);

          // Create a unique sorted signature for this undirected edge (e.g. "1-43" vs "43-1")
          const edgeKey = a < b ? `${a}-${b}` : `${b}-${a}`;

          if (!seen.has(edgeKey)) {
            seen.add(edgeKey);
            
            // Push as numbers (or keep as strings `[a, b]` if your node IDs are string-based)
            edges.push([Number(a), Number(b)]);
          }
        }
      }

      return edges;
    },



    altIconsCalc() {
      const ret = []
      this.iconData.forEach(([key, kind]) => {
        //if (key in this.gameStore.nodes && key in this.userStore.getActiveGraphLinks) {
        if (key in this.gameStore.nodes && key in this.graphStore.getActiveGraphLinks) {
          const newIcon = {
            key,
            kind,
            pos: this.iconPositions[key],
            thisCpCost: this.gameStore.ready ? this.gameStore.nodes[key].CP : 0,
          }
          ret.push({...newIcon})
        }
      })
      return ret;
    },



    altLinesCalc() {
      const colorInactive = [172, 172, 172, 255];
      const baseAbstractColor = [255, 255, 255, 255];
      const ret = [];
      const filteredEdges = this.activeGraphEdges;

      // Solution View: background white edges only (black solution edges render in altSolLineLayer above white nodes)
      if (this.isSolutionViewActive) {
        const selSet = this.dpSelectedSet;
        const bgColor = this.userStore.isAbstractView ? baseAbstractColor : colorInactive;
        for (const [a, b] of filteredEdges) {
          if (selSet.has(a) && selSet.has(b)) continue;
          const start = this.iconPositions[a];
          const end = this.iconPositions[b];
          if (start && end) {
            ret.push({ start, end, color: bgColor });
          }
        }
        return ret;
      }

      const isSolveCutActive =
        BAG_EDGE_CUT_CONFIG.enabled &&
        this.userStore?.isAbstractView &&
        this.graphStore?.activeTab === 'solve' &&
        !!this.graphStore?.activeTreeNode;

      if (!isSolveCutActive) {
        filteredEdges.forEach(([a, b]) => {
          ret.push({
            start: this.iconPositions[a],
            end: this.iconPositions[b],
            color: this.userStore.isAbstractView ? baseAbstractColor : colorInactive,
          });
        });
        return ret;
      }

      // Resolve the style for the cut half-edge attached to bag vertices
      let cutColor = [0, 0, 0, 0]; // 'invisible'
      if (BAG_EDGE_CUT_CONFIG.mode === 'black') {
        cutColor = BAG_EDGE_CUT_CONFIG.blackRgba;
      } else if (BAG_EDGE_CUT_CONFIG.mode === 'x-color') {
        cutColor = this.hexToRgba(BAG_X_CONFIG.color, BAG_EDGE_CUT_CONFIG.xColorAlpha);
      } else if (BAG_EDGE_CUT_CONFIG.mode === 'dim') {
        cutColor = BAG_EDGE_CUT_CONFIG.dimRgba;
      }

      const bagSet = new Set((this.graphStore.activeTreeNode.bag || []).map(Number));
      const t = Math.max(0, Math.min(1, BAG_EDGE_CUT_CONFIG.cutRatio));

      for (const [a, b] of filteredEdges) {
        const posA = this.iconPositions[a];
        const posB = this.iconPositions[b];
        if (!posA || !posB) continue;

        const aInBag = bagSet.has(a);
        const bInBag = bagSet.has(b);

        if (!aInBag && !bInBag) {
          // Pure component edge: full white line
          ret.push({ start: posA, end: posB, color: baseAbstractColor });
        } else if (aInBag && bInBag) {
          // Internal bag edge: both ends are in B_t
          if (cutColor[3] > 0) {
            ret.push({ start: posA, end: posB, color: cutColor });
          }
        } else {
          // Boundary edge: `bagPos` is in B_t, `freePos` is outside B_t
          const bagPos = aInBag ? posA : posB;
          const freePos = aInBag ? posB : posA;

          const cutPos = [
            bagPos[0] + (freePos[0] - bagPos[0]) * t,
            bagPos[1] + (freePos[1] - bagPos[1]) * t,
          ];

          // 1. Cut portion from bag vertex -> cutPos
          if (cutColor[3] > 0 && t > 0) {
            ret.push({ start: bagPos, end: cutPos, color: cutColor });
          }
          // 2. Remaining portion from cutPos -> non-bag vertex
          if (t < 1) {
            ret.push({ start: cutPos, end: freePos, color: baseAbstractColor });
          }
        }
      }

      return ret;
    },

    altSolLinesCalc() {
      if (!this.isSolutionViewActive) return [];
      const colorAbstractSol = [0, 0, 0, 255];
      // Swap to colorWorker ([255, 179, 0, 255]) if you prefer brighter yellow
      const colorGrind = [255, 109, 0, 255];
      const solColor = this.userStore.isAbstractView ? colorAbstractSol : colorGrind;
      const selSet = this.dpSelectedSet;
      const ret = [];

      for (const [a, b] of this.activeGraphEdges) {
        if (!selSet.has(a) || !selSet.has(b)) continue;
        const start = this.iconPositions[a];
        const end = this.iconPositions[b];
        if (start && end) {
          ret.push({ start, end, color: solColor });
        }
      }
      return ret;
    },

    solveBagPartitionData() {
      if (
        !this.userStore?.isAltView ||
        this.graphStore?.activeTab !== 'solve' ||
        !this.graphStore?.activeTreeNode ||
        this.isSolutionViewActive
      ) {
        return { bagNodes: [], componentEdges: [], componentCount: 0, components: [] };
      }

      const bagKeys = this.graphStore.activeTreeNode.bag || [];
      const bagSet = new Set(bagKeys.map(Number));
      const links = this.graphStore.getActiveGraphLinks || {};
      const targetSet = this.graphStore.targetSet || new Set();

      // 1. Collect positions for vertices in the active bag B_t
      const bagNodes = [];
      for (const k of bagSet) {
        const pos = this.iconPositions?.[k];
        if (pos) bagNodes.push({ key: k, pos });
      }

      // 2. BFS on G \ B_t to find connected components & per-component stats
      const nodeToComp = new Map();
      const compMeta = [];
      let compIdx = 0;

      for (const rawU of Object.keys(links)) {
        const u = Number(rawU);
        if (bagSet.has(u) || nodeToComp.has(u)) continue;

        const queue = [u];
        nodeToComp.set(u, compIdx);
        let head = 0;
        let targetCount = 0;

        while (head < queue.length) {
          const curr = queue[head++];
          if (targetSet.has(curr)) targetCount++;

          for (const rawV of links[curr] || []) {
            const v = Number(rawV);
            if (!bagSet.has(v) && !nodeToComp.has(v)) {
              nodeToComp.set(v, compIdx);
              queue.push(v);
            }
          }
        }

        const rgb = COMPONENT_UNDERLINE_CONFIG.palette[compIdx % COMPONENT_UNDERLINE_CONFIG.palette.length];
        compMeta.push({
          id: compIdx,
          rgb,
          cssColor: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
          nodeCount: queue.length,
          edgeCount: 0,
          targetCount,
        });
        compIdx++;
      }

      // 3. Build colored underline segments:
      //    - Full edge if both endpoints are in G \ B_t (same component)
      //    - Half-way stub from non-bag endpoint if the other endpoint is in B_t
      const { palette, alpha } = COMPONENT_UNDERLINE_CONFIG;
      const componentEdges = [];

      for (const [a, b] of this.activeGraphEdges) {
        const aInBag = bagSet.has(a);
        const bInBag = bagSet.has(b);

        if (aInBag && bInBag) continue; // Both inside active bag

        const posA = this.iconPositions[a];
        const posB = this.iconPositions[b];
        if (!posA || !posB) continue;

        if (!aInBag && !bInBag) {
          // Internal component edge
          const cId = nodeToComp.get(a);
          if (cId === undefined) continue;

          compMeta[cId].edgeCount++;
          const rgb = palette[cId % palette.length];
          componentEdges.push({
            start: posA,
            end: posB,
            componentId: cId,
            color: [rgb[0], rgb[1], rgb[2], alpha],
          });
        } else {
          // Boundary edge between non-bag vertex `u` and bag vertex `v`:
          // Draw half-way from `u` toward `v` so isolated/boundary vertices show component color
          const u = aInBag ? b : a;
          const startPos = aInBag ? posB : posA;
          const bagPos = aInBag ? posA : posB;

          const cId = nodeToComp.get(u);
          if (cId === undefined) continue;

          const midPos = [
            (startPos[0] + bagPos[0]) * 0.5,
            (startPos[1] + bagPos[1]) * 0.5,
          ];
          const rgb = palette[cId % palette.length];
          componentEdges.push({
            start: startPos,
            end: midPos,
            componentId: cId,
            color: [rgb[0], rgb[1], rgb[2], alpha],
          });
        }
      }

      return {
        bagNodes,
        componentEdges,
        componentCount: compIdx,
        components: compMeta,
      };
    },

    isSolutionViewActive() {
      return this.graphStore.isSolutionOverlayActive;
    },

    dpSelectedSet() {
      return this.graphStore.dpSelectedVertexSet;
    },

    assignedTargetSet() {
      const sourceList = this.graphStore?.getActiveSource;
      const snap = this.graphStore?.displayReduceSnapshot;
      const assigned = new Set();

      const hasValidSource = (raw) => {
        if (Array.isArray(raw)) return raw.some((t) => t != null);
        return raw != null;
      };

      if (Array.isArray(sourceList)) {
        for (const entry of sourceList) {
          if (entry?.targetId != null && hasValidSource(entry.sourceId)) {
            assigned.add(Number(entry.targetId));
          }
        }
      } else if (sourceList && typeof sourceList === 'object') {
        for (const [tKey, rawTowns] of Object.entries(sourceList)) {
          if (hasValidSource(rawTowns)) {
            assigned.add(Number(tKey));
          }
        }
      }

      if (snap?.nodeClusters) {
        for (const [clusterKey, members] of Object.entries(snap.nodeClusters)) {
          if (Array.isArray(members) && members.some((m) => assigned.has(Number(m)))) {
            assigned.add(Number(clusterKey));
          }
        }
      }

      return assigned;
    },

    absorbedAssignedTargetSet() {
      const set = new Set();
      if (Number(this.userStore?.plantzoneIconSize) !== 0) return set;

      const targetSet = this.graphStore?.targetSet;
      const townSet = this.graphStore?.townSet;
      const assigned = this.assignedTargetSet;
      if (!targetSet) return set;

      const isTarget = (id) => targetSet.has(id) || targetSet.has(String(id));
      const isTown = (id) => townSet?.has(id) || townSet?.has(String(id));

      // 1. Child plantzone -> parent lookup
      for (const t of assigned) {
        const parent = this.gameStore?.plantzoneStatic?.[String(t)]?.parent;
        if (parent != null) {
          const p = Number(parent);
          if (!isTown(p) && (isTarget(t) || isTarget(p))) {
            set.add(p);
          }
        }
      }

      // 2. Fallback: parent -> children lookup
      const parentSet = this.graphStore?.parentSet;
      if (parentSet) {
        for (const rawP of parentSet) {
          const p = Number(rawP);
          if (isTown(p)) continue;
          const children =
            this.gameStore?.nodes?.[p]?.children ||
            this.gameStore?.nodes?.[String(p)]?.children ||
            [];
          if (children.some((c) => assigned.has(Number(c)) && (isTarget(Number(c)) || isTarget(p)))) {
            set.add(p);
          }
        }
      }

      return set;
    },

    freeTargetSet() {
      const targetSet = this.graphStore?.targetSet;
      const townSet = this.graphStore?.townSet;
      const assigned = this.assignedTargetSet;
      const absorbedAssigned = this.absorbedAssignedTargetSet;
      const set = new Set();
      if (!targetSet) return set;

      for (const rawT of targetSet) {
        const t = Number(rawT);
        if (townSet?.has(t) || townSet?.has(String(t))) continue;
        if (!assigned.has(t) && !absorbedAssigned.has(t)) {
          set.add(t);
        }
      }
      return set;
    },
  },



  methods: {
    makeAltBgIconsLayer() {
      if (!this.userStore.isAbstractView || !this.isSolutionViewActive) {
        return new ScatterplotLayer({ id: 'alt-bg-icon-layer', data: [] });
      }

      const activeTargetSet = this.graphStore.targetSet;
      const townSet = this.graphStore.townSet;
      const activeNodes = this.graphStore.activeNodeSet;
      const selSet = this.dpSelectedSet;

      const absorbedAssignedSet = this.absorbedAssignedTargetSet;

      const bgIcons = this.altIconsCalc.filter((d) => {
        const key = Number(d.key);
        return !(
          townSet?.has(key) ||
          townSet?.has(d.key) ||
          activeTargetSet?.has(key) ||
          activeTargetSet?.has(d.key) ||
          absorbedAssignedSet?.has(key) ||
          selSet?.has(key)
        );
      });

      return new ScatterplotLayer({
        id: 'alt-bg-icon-layer',
        data: bgIcons,
        getPosition: d => d.pos,
        radiusUnits: 'pixels',
        radiusMinPixels: 0,
        radiusMaxPixels: Number.MAX_SAFE_INTEGER,
        getRadius: d => {
          if (activeNodes && !activeNodes.has(Number(d.key))) return 0;
          if (this.gameStore.isPlantzone(String(d.key))) {
            return this.userStore.plantzoneIconSize / 3.3;
          }
          return this.userStore.otherIconSize / 3.3;
        },
        getFillColor: () => [255, 255, 255, 255],
        getLineColor: () => [255, 255, 255, 255],
        lineWidthMinPixels: 2,
        stroked: true,
        filled: true,
        pickable: true,
        parameters: { depthTest: false },
        modelMatrix: [
          1,  0, 0, 0,
          0, -1, 0, 0,
          0,  0, 1, 0,
          0,  0, 0, 1,
        ],
        onClick: this.handleNodeClick,
        onHover: this.handleNodeHover,
      });
    },

    makeAltSolLineLayer() {
      return new LineLayer({
        id: 'alt-sol-line-layer',
        data: this.altSolLinesCalc,
        getSourcePosition: d => d.start,
        getTargetPosition: d => d.end,
        getColor: d => d.color,
        widthMinPixels: this.userStore.isAbstractView ? 3 : 2,
        parameters: { depthTest: false },
        updateTriggers: {
          widthMinPixels: [this.userStore.isAbstractView],
          getColor: [
            this.userStore.isAbstractView,
            this.graphStore.dpSolution,
            this.graphStore.showSolutionView,
            this.graphStore.solutionGraphMode,
            this.graphStore.dpSelectedVertexSet,
          ],
        },
        modelMatrix: [
          1,  0, 0, 0,
          0, -1, 0, 0,
          0,  0, 1, 0,
          0,  0, 0, 1,
        ],
      });
    },

    resolveDisplayHaloKey(key) {
      if (key == null) return key;
      if (Number(this.userStore?.plantzoneIconSize) !== 0) return key;

      const strKey = String(key);
      const numKey = Number(key);
      const townSet = this.graphStore?.townSet;
      const hasSnap = Boolean(this.graphStore?.displayReduceSnapshot);
      const isTown =
        townSet?.has(numKey) ||
        townSet?.has(strKey) ||
        (!hasSnap && (
          Boolean(this.gameStore?.isLodgingTown?.(key)) ||
          Boolean(this.gameStore?.isLodgingTown?.(numKey))
        ));

      if (isTown) return key;

      const parent = this.gameStore?.plantzoneStatic?.[strKey]?.parent;
      return parent != null ? parent : key;
    },

    startLegendDrag(e) {
      if (e.button !== 0) return;
      this.isDraggingLegend = true;
      this.legendDragStart = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        posX: this.legendPos.x,
        posY: this.legendPos.y,
      };
      window.addEventListener('pointermove', this.onLegendDrag);
      window.addEventListener('pointerup', this.stopLegendDrag);
      window.addEventListener('pointercancel', this.stopLegendDrag);
    },

    clampLegendPos(x, y) {
      const el = this.$refs.solveLegend;
      const w = el?.offsetWidth || 180;
      const h = el?.offsetHeight || 160;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Anchored at bottom: 18px, left: 16px
      const minX = -8;
      const maxX = Math.max(minX, vw - w - 24);
      const maxY = 10;
      const minY = Math.min(maxY, 26 + h - vh);

      return {
        x: Math.max(minX, Math.min(maxX, x)),
        y: Math.max(minY, Math.min(maxY, y)),
      };
    },

    onLegendDrag(e) {
      if (!this.isDraggingLegend) return;
      const rawX = this.legendDragStart.posX + (e.clientX - this.legendDragStart.mouseX);
      const rawY = this.legendDragStart.posY + (e.clientY - this.legendDragStart.mouseY);
      this.legendPos = this.clampLegendPos(rawX, rawY);
    },

    resetLegendPos() {
      this.legendPos = { x: 0, y: 0 };
      try {
        localStorage.setItem('solve_legend_pos', JSON.stringify(this.legendPos));
      } catch {}
    },

    onWindowResizeLegend() {
      if (!this.$refs.solveLegend) return;
      this.legendPos = this.clampLegendPos(this.legendPos.x, this.legendPos.y);
    },

    stopLegendDrag() {
      if (!this.isDraggingLegend) return;
      this.isDraggingLegend = false;
      window.removeEventListener('pointermove', this.onLegendDrag);
      window.removeEventListener('pointerup', this.stopLegendDrag);
      window.removeEventListener('pointercancel', this.stopLegendDrag);
      try {
        localStorage.setItem('solve_legend_pos', JSON.stringify(this.legendPos));
      } catch {}
    },

    makeSolveComponentLineLayer() {
      const { componentEdges } = this.solveBagPartitionData;
      return new LineLayer({
        id: 'solve-component-underline-layer',
        data: componentEdges,
        getSourcePosition: (d) => d.start,
        getTargetPosition: (d) => d.end,
        getColor: (d) => d.color,
        widthMinPixels: COMPONENT_UNDERLINE_CONFIG.widthPx,
        widthMaxPixels: COMPONENT_UNDERLINE_CONFIG.widthPx,
        capRounded: true,
        jointRounded: true,
        pickable: false,
        modelMatrix: [
          1,  0, 0, 0,
          0, -1, 0, 0,
          0,  0, 1, 0,
          0,  0, 0, 1,
        ],
      });
    },

    makeSolveBagXLayer() {
      const { bagNodes } = this.solveBagPartitionData;
      const xIconUrl = makeThickXIconUrl(BAG_X_CONFIG.color, BAG_X_CONFIG.strokeWidth);

      return new IconLayer({
        id: 'solve-bag-x-layer',
        data: bagNodes,
        getPosition: (d) => d.pos,
        getIcon: () => ({
          url: xIconUrl,
          width: 128,
          height: 128,
          anchorX: 64,
          anchorY: 64,
        }),
        getSize: () => BAG_X_CONFIG.sizePx,
        sizeUnits: 'pixels',
        pickable: false,
        modelMatrix: [
          1,  0, 0, 0,
          0, -1, 0, 0,
          0,  0, 1, 0,
          0,  0, 0, 1,
        ],
      });
    },

    refreshHalo() {
      if (!this.deck) return;
      this.altHaloLayer = this.makeHaloLayer();

      const isAlt = this.userStore?.isAltView;

      // In initializeDeck(), updateLayers(), updateDeck(), and refreshHalo():
      this.solveComponentLineLayer = this.makeSolveComponentLineLayer();
      this.solveBagXLayer = this.makeSolveBagXLayer();

      const layers = [
        this.tileLayer,
        isAlt ? this.solveComponentLineLayer : null,
        isAlt ? this.altLineLayer : this.lineLayer,
        isAlt ? this.altBgIconLayer : null,
        isAlt ? this.altSolLineLayer : null,
        isAlt ? this.altHaloLayer : null,
        isAlt ? this.altIconLayer : this.iconLayer,
        isAlt ? this.solveBagXLayer : null,
        isAlt ? null : this.highlightedIconLayer,
      ].filter(Boolean);

      this.deck.setProps({
        layers: layers,
      });
    },

    hexToRgba(hex, alpha = 255) {
      const cleanHex = hex.replace('#', '');
      const bigint = parseInt(cleanHex, 16);
      return [
        (bigint >> 16) & 255,
        (bigint >> 8) & 255,
        bigint & 255,
        alpha
      ];
    },


    handleNodeHover(info) {
      const newKey = info?.object ? info.object.key : null;

      if (this.hoveredNodeKey !== newKey && !this.selectedNodeKey) {
        this.hoveredNodeKey = newKey;
        this.refreshHalo(); // Only updates the halo layer; preserves existing icons!
      }

      this.$emit('update:hoverInfo', info);
    },

    handleNodeClick(info, event) {
      const node = info?.object;
      if (!node) return;

      // 1. Quick select target toggle
      if (this.userStore.isQuickSelect) {
        this.graphStore.modifyTarget(node.key)
      }

      // 2. Original emit/sync
      this.clickedObject = node
      this.$emit('update:clickedObj', node)

      // 3. Selection / Tooltip Pinning
      if (this.selectedNodeKey === node.key) {
        this.selectedNodeKey = null;
        this.pinnedInfo = null;
        this.$emit('update:pinnedInfo', null);
      } else {
        this.selectedNodeKey = node.key;

        const rawPos = this.iconPositions 
          ? this.iconPositions[node.key] 
          : [this.gameStore.nodes[node.key]?.x, this.gameStore.nodes[node.key]?.y];

        const mapPos = [rawPos[0], -rawPos[1]];

        const viewport = this.deck?.getViewports()[0];
        const [projectedX, projectedY] = (viewport && mapPos) 
          ? viewport.project(mapPos) 
          : [info.x, info.y];

        this.pinnedInfo = {
          object: node,
          coordinate: mapPos,
          deltaX: info.x - projectedX,
          deltaY: info.y - projectedY,
          x: info.x,
          y: info.y
        };

        this.$emit('update:pinnedInfo', this.pinnedInfo);
      }
      // Re-render ONLY the halo and trigger Deck.gl to refresh target colors
      this.refreshHalo();
    },



    makeHaloLayer() {
      const targetKey = this.activeHaloKey;
      if (!targetKey) {
        return new ScatterplotLayer({
          id: 'node-halo-layer',
          data: []
        });
      }

      const getPos = (key) => {
        if (this.iconPositions && this.iconPositions[key]) {
          return this.iconPositions[key];
        }
        const node = this.gameStore?.nodes?.[key];
        return node ? [node.x, node.y] : null;
      };

      const displayTargetKey = this.resolveDisplayHaloKey(targetKey);
      const rawPos = getPos(displayTargetKey);
      if (!rawPos || rawPos[0] === undefined || rawPos[1] === undefined) {
        return new ScatterplotLayer({
          id: 'node-halo-layer',
          data: []
        });
      }

      const townSet = this.graphStore?.townSet;
      const numTargetKey = Number(targetKey);
      const hasSnap = Boolean(this.graphStore?.displayReduceSnapshot);
      const isHoveredTown =
        townSet?.has(numTargetKey) ||
        townSet?.has(String(targetKey)) ||
        (!hasSnap && (
          Boolean(this.gameStore?.isLodgingTown?.(targetKey)) ||
          Boolean(this.gameStore?.isLodgingTown?.(numTargetKey))
        ));

      const isPlantzone = Boolean(this.gameStore.isPlantzone(targetKey));
      const getNodeRadius = (key, isTargetNode) => {
        const isPz = Boolean(this.gameStore.isPlantzone(key));
        const baseSize = isPz
          ? (this.userStore.plantzoneIconSize || 16)
          : (this.userStore.otherIconSize || 16);
        return baseSize * (isTargetNode ? 0.72 : 0.66);
      };

      const haloItems = [];
      const townKeys = this.hoveredSourceTownKeys || new Set();
      const assignedTargetKeys = this.hoveredTownTargetKeys || new Set();

      if (isHoveredTown) {
        // Town hovered/selected -> blue halo on the town, yellow/amber halos on all targets assigned to it
        haloItems.push({
          key: targetKey,
          pos: rawPos,
          isTown: true,
          radius: getNodeRadius(targetKey, false),
        });

        for (const tKey of assignedTargetKeys) {
          if (String(tKey) === String(targetKey)) continue;
          const tPos = getPos(tKey);
          if (tPos && tPos[0] !== undefined && tPos[1] !== undefined) {
            haloItems.push({
              key: tKey,
              pos: tPos,
              isTown: false,
              radius: getNodeRadius(tKey, true),
            });
          }
        }
      } else {
        // Target/node hovered/selected -> yellow/amber halo on active node, blue halos on its assigned towns
        haloItems.push({
          key: targetKey,
          pos: rawPos,
          isTown: false,
          radius: getNodeRadius(targetKey, true),
        });

        for (const townKey of townKeys) {
          if (String(townKey) === String(targetKey)) continue;
          const townPos = getPos(townKey);
          if (townPos && townPos[0] !== undefined && townPos[1] !== undefined) {
            haloItems.push({
              key: townKey,
              pos: townPos,
              isTown: true,
              radius: getNodeRadius(townKey, false),
            });
          }
        }
      }

      const AMBER_FILL = [250, 204, 21, 75];
      const AMBER_LINE = [250, 204, 21, 235];
      const BLUE_FILL = [56, 189, 248, 65];
      const BLUE_LINE = [56, 189, 248, 225];

      const triggerKey = [
        targetKey,
        Array.from(townKeys).sort().join(','),
        Array.from(assignedTargetKeys).sort().join(','),
      ].join('|');

      return new ScatterplotLayer({
        id: 'node-halo-test-layer',
        data: haloItems,
        getPosition: d => d.pos,

        modelMatrix: [
          1,  0, 0, 0,
          0, -1, 0, 0,
          0,  0, 1, 0,
          0,  0, 0, 1
        ],

        radiusUnits: 'pixels',
        getRadius: d => d.radius,
        stroked: true,
        filled: true,
        getFillColor: d => (d.isTown ? BLUE_FILL : AMBER_FILL),
        getLineColor: d => (d.isTown ? BLUE_LINE : AMBER_LINE),
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        pickable: false,

        updateTriggers: {
          data: [triggerKey],
          getPosition: [triggerKey],
          getRadius: [
            triggerKey,
            isPlantzone,
            this.userStore.plantzoneIconSize,
            this.userStore.otherIconSize
          ],
          getFillColor: [triggerKey],
          getLineColor: [triggerKey]
        }
      });
    },






    makeAltIconsLayer() {
      const activeTargetSet = this.graphStore.targetSet;
      const freeTargetSet = this.freeTargetSet;
      const absorbedAssignedSet = this.absorbedAssignedTargetSet;
      const townSet = this.graphStore.townSet;
      const parentSet = this.graphStore.parentSet;
      const icon = this.altIconsCalc;
      const plantzoneIconSize = this.userStore.plantzoneIconSize;
      const activeNodes = this.graphStore.activeNodeSet;

      const isSolView = this.isSolutionViewActive;
      const selSet = isSolView ? this.dpSelectedSet : null;
      

      // Draw order (bottom -> top): unselected/normal (0) < green Steiner (1) < red target (2) < blue town (3)
      const getDrawPriority = (d) => {
        const key = Number(d.key);
        if (townSet?.has(key) || townSet?.has(d.key)) return 3;
        if (
          absorbedAssignedSet?.has(key) ||
          activeTargetSet?.has(key) ||
          activeTargetSet?.has(d.key)
        ) return 2;
        if (isSolView && selSet?.has(key)) return 1;
        return 0;
      };

      const sortedAllIcons = [...icon].sort(
        (a, b) => getDrawPriority(a) - getDrawPriority(b)
      );
      const filteredIcons = isSolView
        ? icon.filter((d) => getDrawPriority(d) > 0)
        : icon;
      const sortedIcons = [...filteredIcons].sort(
        (a, b) => getDrawPriority(a) - getDrawPriority(b)
      );

      // Shared modelMatrix
      const modelMatrix = [
        1,  0, 0, 0,
        0, -1, 0, 0,
        0,  0, 1, 0,
        0,  0, 0, 1
      ];

      if (!this.userStore.isAbstractView) {
        return new IconLayer({
          id: 'alt-icon-layer',
          data: sortedAllIcons,
          getPosition: d => d.pos,
          getColor: d => [66, 66, 66, 255],
          getIcon: function(d) {
            const key = Number(d.key);
            const isTown = townSet?.has(key) || townSet?.has(d.key);
            const isTarget = activeTargetSet?.has(key) || activeTargetSet?.has(d.key);
            const isInSolution = isSolView && selSet?.has(key);
            const isParent = parentSet?.has(key) || parentSet?.has(d.key);

            let folder = '';

            // 1. Highlight condition overrides everything else
            if (isParent && !isTown && plantzoneIconSize < 5) {
              folder = 'highlighted/';
            }
            // 2. Non-gray iff it is a target, town, or selected solution node
            if (!isTarget && !isTown && !isInSolution) {
              folder += 'gray/';
            }

            return {
              url: `data/icons/node/${folder}${d.kind}.png`,
              width: 256,
              height: 256,
              anchorX: 128,
              anchorY: 128,
            };
          },
          getSize: d => {
            let baseSize = this.userStore.otherIconSize;
            if (this.gameStore.isPlantzone(d.key)) {
              baseSize = this.userStore.plantzoneIconSize;
            }
            const key = Number(d.key);
            const isTown = townSet?.has(key) || townSet?.has(d.key);
            const isTarget = activeTargetSet?.has(key) || activeTargetSet?.has(d.key);

            const factor = (isTarget && !isTown) ? 1.3 : 1;
            return baseSize * factor;
          },
          updateTriggers: {
            getSize: [
              this.userStore.isParentHide, this.mapStore.zoom,
              this.userStore.mapIconSize, this.graphStore.targetSet, this.graphStore.townSet,
              this.userStore.targetList, this.userStore.plantzoneIconSize, this.userStore.otherIconSize,
              this.graphStore.showSolutionView, this.graphStore.dpSelectedVertexSet,
            ],
            getIcon: [
              this.graphStore.targetSet, this.graphStore.townSet,
              this.userStore.targetList, this.userStore.plantzoneIconSize,
              this.graphStore.dpSolution, this.graphStore.showSolutionView,
              this.graphStore.solutionGraphMode, this.graphStore.dpSelectedVertexSet,
            ],
          },
          transitions: {
            getColor: 400,
          },
          parameters: { depthTest: false },
          modelMatrix,
          autoHighlight: true,
          pickable: true,
          onClick: this.handleNodeClick,
          onHover: this.handleNodeHover,
        });
      } else {
        return new ScatterplotLayer({
          id: 'alt-scatter-icon-layer',
          data: sortedIcons,
          getPosition: d => d.pos,
          radiusUnits: 'pixels',
          radiusMinPixels: 0,
          radiusMaxPixels: Number.MAX_SAFE_INTEGER,
          getRadius: d => {
            if (activeNodes && !activeNodes.has(Number(d.key))) return 0;

            if (this.gameStore.isPlantzone(String(d.key))) {
              return this.userStore.plantzoneIconSize/3.3; 
            }
              return this.userStore.otherIconSize/3.3;
          },
          // Color code based on Solution View vs. standard Abstract View
          getFillColor: d => {
            const key = Number(d.key);
            const isTown = townSet?.has(key) || townSet?.has(d.key);
            const isAbsorbedAssigned = absorbedAssignedSet?.has(key);
            const isFreeTarget = !isAbsorbedAssigned && freeTargetSet?.has(key);
            const isTarget = isAbsorbedAssigned || activeTargetSet?.has(key) || activeTargetSet?.has(d.key);

            if (this.isSolutionViewActive) {
              if (isTown) return [60, 60, 255, 255]; // Keep towns blue
              if (isFreeTarget) return [245, 158, 11, 255]; // Free targets -> amber / yellow-orange
              if (isTarget) return [255, 69, 58, 255]; // Assigned targets -> red
              if (this.dpSelectedSet.has(key)) return [34, 197, 94, 255]; // Selected Steiner nodes -> green
              return [255, 255, 255, 255]; // Unselected nodes -> complete white
            }
            if (isTown) return [60, 60, 255, 255]; // Blue for towns
            if (isFreeTarget) return [245, 158, 11, 255]; // Amber / yellow-orange for free targets
            if (isTarget) return [255, 69, 58, 255]; // Vivid red for assigned targets
            return [0, 0, 0, 255]; // Black for normal nodes
          },
          getLineColor: d => {
            const nodeKey = d.key;
            const numKey = Number(nodeKey);

            if (this.isSolutionViewActive) {
              const isTown = townSet?.has(numKey) || townSet?.has(nodeKey);
              const isTarget =
                absorbedAssignedSet?.has(numKey) ||
                activeTargetSet?.has(numKey) ||
                activeTargetSet?.has(nodeKey);
              if (isTown || isTarget || this.dpSelectedSet.has(numKey)) {
                return [0, 0, 0, 255];
              }
              return [255, 255, 255, 255];
            }

            const isPzSizeActive = (this.userStore?.plantzoneIconSize ?? 0) > 0;
            const CUSTOM_COLOR = this.hexToRgba(this.userStore.pzRingHexColor);
            const DEFAULT_WHITE = [255, 255, 255, 255];

            if (isPzSizeActive) {
              if (this.gameStore?.isPlantzone?.(nodeKey)) {
                return CUSTOM_COLOR;
              }
            } else {
              if (this.gameStore?.parentSet?.has(Number(nodeKey)) || this.gameStore?.parentSet?.has(String(nodeKey))) {
                return CUSTOM_COLOR;
              }
            }
            return DEFAULT_WHITE;
          },
          updateTriggers: {
            getFillColor: [
              this.graphStore.currentInstance,
              this.graphStore.activeTab,
              this.graphStore.reduceStepIndex,
              this.graphStore.targetSet,
              this.freeTargetSet,
              this.absorbedAssignedTargetSet,
              this.userStore.plantzoneIconSize,
              this.graphStore.dpSolution,
              this.graphStore.showSolutionView,
              this.userStore.targetSet?.size,
              this.userStore.targetList,
              this.graphStore.townSet,
              this.graphStore.solutionGraphMode,
            ],
            getRadius: [
              this.userStore.isParentHide,
              this.mapStore.zoom,
              this.userStore.mapIconSize,
              this.userStore.targetSet,
              this.graphStore.activeNodeSet,
              this.userStore.plantzoneIconSize,
              this.userStore.otherIconSize,
              this.graphStore.solutionGraphMode,
            ],
            getLineColor: [
              this.userStore?.plantzoneIconSize,
              this.gameStore?.parentSet?.size,
              this.userStore?.pzRingHexColor,
              this.graphStore.dpSolution,
              this.graphStore.showSolutionView,
              this.graphStore.townSet,
              this.graphStore.solutionGraphMode,
            ],
          },
          lineWidthMinPixels: 2,
          stroked: true,
          filled: true,
          pickable: true,
          modelMatrix,
          onClick: this.handleNodeClick,
          onHover: this.handleNodeHover,
          parameters: { depthTest: false },
        });
      }
    },

    makeAltLineLayer() {
      return new LineLayer({
        id: 'alt-line-layer',
        data: this.altLinesCalc,
        getSourcePosition: d => d.start,
        getTargetPosition: d => d.end,
        getColor: d => d.color,
        widthMinPixels: this.userStore.isAbstractView ? 3 : 1,
        updateTriggers: {
          widthMinPixels: [this.userStore.isAbstractView],
          getColor: [
            this.userStore.isAbstractView,
            this.userStore.isSolutionView,
            this.graphStore.activeTab,
            this.graphStore.activeBagId,
            this.graphStore.dpSolution,
            this.graphStore.showSolutionView,
            this.graphStore.solutionGraphMode,
          ],
        },
        modelMatrix: [
          1, 0, 0, 0,
          0, -1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1
        ],
      })
    },









    makeIconImg,
    formatFixed,

    onMoveEvent(e) {
      const now = Date.now()
      if (now - this.mapStateSavedTimestamp > 100) {
        this.mapStore.target = [...e.viewState.target]
        this.mapStore.zoom = e.viewState.zoom
        this.mapStateSavedTimestamp = now
      }
      // can't modify property in a component
      //this.panPaPos = null
      this.$emit('panAnywhere')
    },

    makeIconsLayer() {
      // https://deck.gl/docs/api-reference/core/layer#updatetriggers
      return new IconLayer({
        data: this.iconsCalc.normal,
        onClick: (info, event) => this.objectClicked(info.object),
        onHover: info => this.$emit('update:hoverInfo', info),
        getPosition: d => d.pos,
        getColor: d => [66, 66, 66, d.hidden ? 0 : 255],  // r, g, b have no effect, only alpha does
        getIcon: function(d) {
          return {
            url: 'data/icons/node/' + (d.isHighlighted ? 'highlighted/' : '') + (d.taken ? '' : 'gray/') + `${d.kind}.png`,
            width: 256,
            height: 256,
            anchorX: 128,
            anchorY: 128,
          }
        },
        updateTriggers: {
          //getColor: this.userStore.mapHideInactive  // doesn't work, using watch() instead
        },
        transitions: {
          getColor: 400,
        },
        modelMatrix: [
          1, 0, 0, 0,
          0, -1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1
        ],
        getSize: d => this.userStore.mapIconSize * (d.isHighlighted ? 1.66 : 1),
        autoHighlight: true,
        pickable: true,
      })
    },

    // separate layers are to get nice transitions on show/hide
    makeHighlightedIconsLayer() {
      return new IconLayer({
        id: 'highlighted',
        data: this.iconsCalc.highlighted,
        onClick: (info, event) => this.objectClicked(info.object),
        onHover: info => this.$emit('update:hoverInfo', info),
        getPosition: d => d.pos,
        getColor: d => [66, 66, 66, d.hidden ? 0 : 255],
        getIcon: function(d) {
          return {
            url: 'data/icons/node/' + (d.isHighlighted ? 'highlighted/' : '') + (d.taken ? '' : 'gray/') + `${d.kind}.png`,
            width: 256,
            height: 256,
            anchorX: 128,
            anchorY: 128,
          }
        },
        updateTriggers: {
          //getColor: this.userStore.mapHideInactive  // doesn't work, using watch() instead
        },
        transitions: {
          getColor: 800,
        },
        modelMatrix: [
          1, 0, 0, 0,
          0, -1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1
        ],
        getSize: d => this.userStore.mapIconSize * (d.isHighlighted ? 1.66 : 1),
        autoHighlight: true,
        pickable: true,
      })
    },

    makeLineLayer() {
      return new LineLayer({
        data: this.linesCalc,
        getSourcePosition: d => d.start,
        getTargetPosition: d => d.end,
        getColor: d => d.color,
        modelMatrix: [
          1, 0, 0, 0,
          0, -1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1
        ],
      })
    },

    initializeDeck() {
      console.log('initializeDeck', this.initialViewState, this.mapStore.target)

      this.tileLayer = new TileLayer({
        data: 'https://shrddr.github.io/maptiles/{z}/{x}_{y}.webp',
        minZoom: 0,
        maxZoom: 7,
        tileSize: 256 * 12800,
        zoomOffset: 14,
        extent: [
          (-67 * 2) * 12800,
          (-71 * 2) * 12800,
          (58 * 2) * 12800,
          (35 * 2) * 12800
        ],
        renderSubLayers: props => {
          const {
            bbox: {left, bottom, right, top}
          } = props.tile;

          return new BitmapLayer(props, {
            data: null,
            image: props.data,
            bounds: [left, bottom, right, top]
          });
        }
      })

      this.lineLayer = this.makeLineLayer()
      this.iconLayer = this.makeIconsLayer()
      this.highlightedIconLayer = this.makeHighlightedIconsLayer()
      this.altIconLayer = this.makeAltIconsLayer();
      this.altLineLayer = this.makeAltLineLayer();
      this.altHaloLayer = this.makeHaloLayer();
      this.altBgIconLayer = this.makeAltBgIconsLayer();
      this.altSolLineLayer = this.makeAltSolLineLayer();
      
      // In initializeDeck(), updateLayers(), updateDeck(), and refreshHalo():
      this.solveComponentLineLayer = this.makeSolveComponentLineLayer();
      this.solveBagXLayer = this.makeSolveBagXLayer();

      const isAlt = this.userStore?.isAltView;

      const initialLayers = [
        this.tileLayer,
        isAlt ? this.solveComponentLineLayer : null,
        isAlt ? this.altLineLayer : this.lineLayer,
        isAlt ? this.altBgIconLayer : null,
        isAlt ? this.altSolLineLayer : null,
        isAlt ? this.altHaloLayer : null,
        isAlt ? this.altIconLayer : this.iconLayer,
        isAlt ? this.solveBagXLayer : null,
        isAlt ? null : this.highlightedIconLayer,
      ].filter(Boolean);

      
      return new Deck({
        canvas: 'deck-canvas',
        mapbox: false,
        //getTooltip: ({object}) => object && `#${object.key} ${this.gameStore.nodeName(object.key)} \n this node ${object.thisCpCost}CP \n from town ${object.fromTownCpCost}CP \n path ${object.fromTownPath}`,
        //getTooltip: this.objectTooltip,
        onViewStateChange: this.onMoveEvent,  // saves to mapStore

        initialViewState: this.initialViewState,
        
        layers: initialLayers,

        controller: {doubleClickZoom: false},

        // Set getCursor to null! This completely disables Deck.gl's cursor manipulation
        getCursor: () => null,

        views: [
          new OrthographicView({
            controller: true,
          }),
        ]
      });

    },

    updateLayers() {
      if (!this.deck) return;

      const isAlt = this.userStore.isAltView;

      this.lineLayer = this.makeLineLayer();
      this.highlightedIconLayer = this.makeHighlightedIconsLayer();
      this.iconLayer = this.makeIconsLayer();
      this.altIconLayer = this.makeAltIconsLayer();
      this.altLineLayer = this.makeAltLineLayer();
      this.altHaloLayer = this.makeHaloLayer();
      this.altBgIconLayer = this.makeAltBgIconsLayer();
      this.altSolLineLayer = this.makeAltSolLineLayer();

      // In initializeDeck(), updateLayers(), updateDeck(), and refreshHalo():
      this.solveComponentLineLayer = this.makeSolveComponentLineLayer();
      this.solveBagXLayer = this.makeSolveBagXLayer();

      const layers = [
        this.tileLayer,
        isAlt ? this.solveComponentLineLayer : null,
        isAlt ? this.altLineLayer : this.lineLayer,
        isAlt ? this.altBgIconLayer : null,
        isAlt ? this.altSolLineLayer : null,
        isAlt ? this.altHaloLayer : null,
        isAlt ? this.altIconLayer : this.iconLayer,
        isAlt ? this.solveBagXLayer : null,
        isAlt ? null : this.highlightedIconLayer,
      ].filter(Boolean);

      // ONLY supply layers here — no callback re-registrations
      this.deck.setProps({
        layers: layers,
      });
    },

    updateDeck() {
      if (!this.deck)
        return
      console.log('updateDeck')
      const isAlt = this.userStore.isAltView;
      this.lineLayer = this.makeLineLayer()
      
      this.highlightedIconLayer = this.makeHighlightedIconsLayer()
      this.iconLayer = this.makeIconsLayer();
      this.altIconLayer = this.makeAltIconsLayer();
      this.altLineLayer = this.makeAltLineLayer();
      this.altHaloLayer = this.makeHaloLayer();
      this.altBgIconLayer = this.makeAltBgIconsLayer();
      this.altSolLineLayer = this.makeAltSolLineLayer();

      // In initializeDeck(), updateLayers(), updateDeck(), and refreshHalo():
      this.solveComponentLineLayer = this.makeSolveComponentLineLayer();
      this.solveBagXLayer = this.makeSolveBagXLayer();

      const layers = [
        this.tileLayer,
        isAlt ? this.solveComponentLineLayer : null,
        isAlt ? this.altLineLayer : this.lineLayer,
        isAlt ? this.altBgIconLayer : null,
        isAlt ? this.altSolLineLayer : null,
        isAlt ? this.altHaloLayer : null,
        isAlt ? this.altIconLayer : this.iconLayer,
        isAlt ? this.solveBagXLayer : null,
        isAlt ? null : this.highlightedIconLayer,
      ].filter(Boolean);

      this.deck.setProps({
        layers: layers,
        initialViewState: this.initialViewState,
      })
    },

    objectClicked(obj) {
      //console.log('this.clickedObject', this.clickedObject, 'this.clickedObj', this.clickedObj)
      this.clickedObject = obj
      this.$emit('update:clickedObj', obj)
      //this.updateDeck()
      
      //console.log('highlightLines', this.highlightLines)
      
      //console.log('Clicked:', obj)
      /*console.log(this.initialViewState)
      this.initialViewState.target = obj.pos
      console.log(this.initialViewState)
      this.updateDeck()*/
    },

    move(x) {
      this.initialViewState.target = [x, 0]
      console.log('trying to move to', x)
      console.log(this.deck.viewState)
    },

    panToBbox(x1, x2, y1, y2) {
      //console.log('panToBbox', x1, x2, y1, y2, this.deck.viewManager)
      const x = (x1 + x2) / 2
      const y = (y1 + y2) / 2
      const gameWidth = x2 - x1
      const gameHeight = y2 - y1
      if (gameWidth == 0 && gameHeight == 0) {
        this.panTo(x, y, -9)
        return
      }

      let zoom = 6  // start close up and zoom out until fits into view
      for (; zoom >= 0; zoom--) {
        const factor = 2**(zoom-14)
        const pixWidth = gameWidth * factor
        const pixHeight = gameHeight * factor
        //console.log(pixWidth.toFixed(0), 'x', pixHeight.toFixed(0), 'at zoom', zoom)
        if (pixWidth < this.deck.viewManager.width && pixHeight < this.deck.viewManager.height) break
      }
      //console.log('panToBbox', dx, dy, '->', x, y, zoom)
      this.panTo(x, y, zoom-14)
    },

    panTo(x, y, zoom) {
      // zoom 7 is 2 nodes
      // zoom 8 is 10 nodes
      // ...
      // zoom 14 is whole map
      const ivsCopy = {...this.initialViewState}
      ivsCopy.target = [x, -y]
      ivsCopy.zoom = zoom
      ivsCopy.transitionDuration = 100
      ivsCopy.transitionInterpolator = new LinearInterpolator({transitionProps: ['target', 'zoom']})
      this.deck.setProps({
        initialViewState: ivsCopy,
      })
    },

  },
}
</script>


<template>
  
  <canvas id="deck-canvas" ref="canvas"></canvas>
  <div id="hack">{{ iconsCalc.length }} icons</div>

  <div class="topcenter" v-if="userStore.mapHideInactive">
    {{ hiddenNodesCount }} inactive nodes hidden (<a href="#" @click="userStore.mapHideInactive = false">show</a>)
  </div>

  <!-- Solve Tab: Draggable Bag Separator & Connected Components Table -->
  <div
    v-if="userStore.isAltView && graphStore.activeTab === 'solve' && graphStore.activeTreeNode && !isSolutionViewActive"
    ref="solveLegend"
    class="solve-comp-legend"
    :style="{ transform: `translate3d(${legendPos.x}px, ${legendPos.y}px, 0)` }"
    @mousedown.stop
  >
    <!-- Draggable Header -->
    <div class="legend-header" @mousedown="startLegendDrag">
      <div class="legend-title-group">
        <span class="legend-grip">⋮⋮</span>
        <span class="legend-title">
          G \ B<sub>{{ graphStore.activeTreeNode.origBagId ?? graphStore.activeTreeNode.id }}</sub> Components
        </span>
      </div>
      <span class="legend-count-pill">
        {{ solveBagPartitionData.componentCount }}
      </span>
    </div>

    <!-- Active Bag X indicator -->
    <div class="legend-bag-row">
      <span class="legend-x-glyph" :style="{ color: bagXColor }">✕</span>
      <span>Active Bag (|B| = {{ solveBagPartitionData.bagNodes.length }})</span>
    </div>

    <div class="legend-divider"></div>

    <div v-if="solveBagPartitionData.components.length === 0" class="legend-empty">
      No vertices outside bag
    </div>

    <!-- Borderless Aligned Table -->
    <div v-else class="legend-table">
      <div class="legend-table-head">
        <span></span>
        <span></span>
        <span class="col-num">|V|</span>
        <span class="col-num">|E|</span>
        <span class="col-num" title="Target vertices in component">|T|</span>
      </div>

      <div class="legend-list">
        <div
          v-for="comp in solveBagPartitionData.components"
          :key="comp.id"
          class="legend-grid-row"
        >
          <span
            class="legend-swatch"
            :style="{
              backgroundColor: comp.cssColor,
              boxShadow: `0 0 6px ${comp.cssColor}`
            }"
          ></span>
          <span class="legend-comp-name">C{{ comp.id + 1 }}</span>
          <span class="col-num">{{ comp.nodeCount }}</span>
          <span class="col-num">{{ comp.edgeCount }}</span>
          <span
            class="col-num"
            :class="comp.targetCount > 0 ? 'legend-target-val' : 'legend-zero-val'"
          >
            {{ comp.targetCount > 0 ? comp.targetCount : '—' }}
          </span>
        </div>
      </div>
    </div>
  </div>

  <!--<button @click="move(10000)">10000</button>
  <button @click="move(-10000)">-10000</button>-->

</template>

<style scoped>
#hack {
  position: absolute;
  left: -9999px;
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

#deck-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}


.solve-comp-legend {
  position: fixed;
  bottom: 18px;
  left: 16px;
  z-index: 1000001;
  padding: 9px 12px;
  border-radius: 9px;
  background: rgba(16, 20, 27, 0.72);
  backdrop-filter: blur(12px) saturate(170%);
  -webkit-backdrop-filter: blur(12px) saturate(170%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  color: #cbd5e1;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 11px;
  user-select: none;
  pointer-events: auto;
  will-change: transform;
}

.legend-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
  cursor: grab;
}

.legend-header:active {
  cursor: grabbing;
}

.legend-title-group {
  display: flex;
  align-items: center;
  gap: 5px;
}

.legend-grip {
  font-size: 12px;
  color: #475569;
  letter-spacing: -1.5px;
  line-height: 1;
}

.legend-title {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #93c5fd;
}

.legend-count-pill {
  padding: 1px 6px;
  border-radius: 999px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  font-weight: 700;
  background: rgba(56, 189, 248, 0.16);
  border: 1px solid rgba(56, 189, 248, 0.45);
  color: #e0f2fe;
}

.legend-bag-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10.5px;
  color: #e2e8f0;
  margin-bottom: 6px;
}

.legend-x-glyph {
  font-weight: 900;
  font-size: 12px;
  line-height: 1;
  width: 14px;
  text-align: center;
}

.legend-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin-bottom: 5px;
}

.legend-table-head,
.legend-grid-row {
  display: grid;
  grid-template-columns: 16px 28px 36px 36px 32px;
  align-items: center;
  column-gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
}

.legend-table-head {
  font-size: 9.5px;
  font-weight: 700;
  color: #64748b;
  padding-bottom: 3px;
}

.legend-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 185px;
  overflow-y: auto;
}

.legend-grid-row {
  font-size: 10.5px;
  color: #cbd5e1;
}

.col-num {
  text-align: right;
}

.legend-swatch {
  width: 14px;
  height: 4px;
  border-radius: 2px;
}

.legend-comp-name {
  font-weight: 700;
  color: #f1f5f9;
}

.legend-target-val {
  color: #fda4af;
  font-weight: 600;
}

.legend-zero-val {
  color: #475569;
}

.legend-empty {
  font-size: 10px;
  color: #64748b;
  font-style: italic;
}
</style>
