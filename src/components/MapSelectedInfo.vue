<script>
import {useUserStore} from '../stores/user'
import {useRoutingStore} from '../stores/routing'
import {useGameStore} from '../stores/game'
import {useMarketStore} from '../stores/market'
import {useMapStore} from '../stores/map'
import {formatFixed} from '../util.js'
import Worker from '../components/Worker.vue'
import TownWorkers from './TownWorkers.vue'
import TownWorkshops from './TownWorkshops.vue'
import Plantzone from '../components/Plantzone.vue'
import ItemIcon from '../components/lo/ItemIcon.vue'
import TownSelection from '../components/TownSelection.vue';
import {useGraphStore} from '../stores/graph'

export default {
  setup() {
    const userStore = useUserStore()
    const routingStore = useRoutingStore()
    const gameStore = useGameStore()
    const marketStore = useMarketStore()
    const mapStore = useMapStore()

    mapStore.$subscribe((mutation, state) => {
      localStorage.setItem('map', JSON.stringify(state))
    })

    userStore.$subscribe((mutation, state) => {
      const start = Date.now()
      localStorage.setItem('user', JSON.stringify(state))
      console.log('userStore subscription took', Date.now()-start, 'ms')
    })

    const graphStore = useGraphStore();
    return { marketStore, userStore, routingStore, gameStore, mapStore, graphStore };
  },
  components: {
    Worker,
    TownWorkers,
    TownWorkshops,
    Plantzone,
    ItemIcon,
    TownSelection,
  },
  props: {
    clickedNode: Object,
    pinnedInfo: Object, // Add this prop
  },
  emits: [
    'selectLodging',
    'selectHouses',
    'hireWorker',
    'editWorker',
    'sendWorker',
    'panToPaPos',
    'showResourceDialog',
    'setClickedNode',
    'selectWorker',
  ],
  data: () => ({
    
  }),
  methods: {
    formatFixed,
    jobCashFlowPercent(job) {
      return job.profit.priceDaily / this.routingStore.currentNodesCashflow[this.clickedNode.key]
    },

    selectLodging(tk) {
      this.$emit('selectLodging', tk)
    },
    selectHouses(tk) {
      this.$emit('selectHouses', tk)
    },
    hireWorker(tk) {
      this.$emit('hireWorker', tk)
    },
    editWorker(w) {
      this.$emit('editWorker', w)
    },
    sendWorker(w) {
      this.$emit('sendWorker', w)
    },
    panToPaPos(e) {
      this.$emit('panToPaPos', e)
    },
    showResourceDialog(pzk) {
      this.$emit('showResourceDialog', pzk)
    },
    setClickedNode(n) {
      this.$emit('setClickedNode', n)
    },
    selectWorker(hk) {
      //console.log('selectWorker')
      this.$emit('selectWorker', hk)
    },

    isNodePinned(nodeId) {
      // If no tooltip is currently pinned, do not show any pin icon
      if (!this.pinnedInfo || !this.pinnedInfo.object) return false;

      // Check key, id, or direct value depending on how clickedNode is formatted
      const pinnedKey = this.pinnedInfo.object.key ?? this.pinnedInfo.object.id ?? this.pinnedInfo.object;
      return String(pinnedKey).trim() === String(nodeId).trim();
    },

    altTownOptions(pzk) {
      const nodeData = this.gameStore?.allPzProfit?.[pzk];
      if (!nodeData?.alt_towns || !Array.isArray(nodeData.alt_towns)) {
        return [];
      }

      return nodeData.alt_towns.map((item) => ({
        label: this.gameStore.uloc.node[item.tnk], // e.g. 'Heidel'
        key: item.tnk,
        value: item.priceDaily,
      }));
    },

    getNodeSelectedTown(child) {
      const id = Number(child);
      if (!this.graphStore.rawTargetSet.has(id)) return null;
      const entry = (this.graphStore.currentInstance?.assignments || []).find(
        (a) => Number(a?.targetId) === id
      );
      return entry?.sourceId != null ? Number(entry.sourceId) : null;
    },
  },

  computed: {
    //iMad's change
    //Sort the children in the parent info by daily per CP
    sortedChildren() {
      // Access stores and component state via `this`
      const key = this.userStore.isQuickSelect ? this.actualNode : this.clickedNode?.key;
      // const children = this.gameStore?.nodes?.[String(key)]?.children;
      // if (!children || !Array.isArray(children)) return [];

      // return [...children].sort((a, b) => {
      //   const profitA = this.gameStore.allPzProfit?.[a]?.dailyPerCp ?? -Infinity;
      //   const profitB = this.gameStore.allPzProfit?.[b]?.dailyPerCp ?? -Infinity;

      //   // Descending order: highest profit first
      //   return profitB - profitA;
      // });

      return this.gameStore.getSortedChildrenByProfit(key);
    },

    actualNode() {
      if (!this.userStore.isQuickSelect) return this.clickedNode.key;
      if (this.gameStore.plantzoneStatic[String(this.clickedNode.key)]) {
        const parent = this.gameStore.plantzoneStatic[String(this.clickedNode.key)].parent;
        if (parent && !this.graphStore.baseTownSet.has(Number(parent))) return parent;
      }
      return this.clickedNode.key;
    },

    activeNodeJobs_sorted() {
      const ret = this.userStore.currentNodesJobs[this.clickedNode.key]  // list of jobs (pz/ws)
      ret.sort((a,b) => this.jobCashFlowPercent(b) - this.jobCashFlowPercent(a))
      return ret
    },
    
  },

}
</script>

<template>
  <div id="mapObjDetail" v-if="clickedNode">
    <!-- && (gameStore.tnk2tk(clickedNode.key) in gameStore.lodgingPerTown || clickedNode.key in gameStore.plantzoneDrops) -->          
    <div class="rolldown" @click="setClickedNode(null)">
      <div>˅</div>
    </div>

    <div id="clickedTownInfo" v-if="gameStore.isLodgingTown(clickedNode.key)" class="vscrollable">

      <div class="vscroll40">
        <table class="stickyhead">
          <TownWorkers
            :o="gameStore.lodgingPerTown[gameStore.tnk2tk(clickedNode.key)]"
            :tk="gameStore.tnk2tk(clickedNode.key)"
            @selectLodging="selectLodging"
            @selectHouses="selectHouses"
            @hireWorker="hireWorker"
            @editWorker="editWorker"
            @sendWorker="sendWorker"
            @panToPaPos="panToPaPos"
          />

        </table>
      </div>
      
      <TownWorkshops v-if="userStore.userWorkshops"
        :tk="gameStore.tnk2tk(clickedNode.key)"
        @selectWorker="selectWorker"
        @editWorker="editWorker"
      />
      
    </div>
    <div id="clickedTownInfo" v-else-if="gameStore.configurableTownsSet.has(clickedNode.key)" class="vscrollable">
      <button @click="this.$emit('selectHouses', gameStore.tnk2tk(clickedNode.key))" :class="{ 'unresolved': gameStore.ready && userStore.townsInfra[gameStore.tnk2tk(clickedNode.key)].success == false }">
        config
      </button>
    </div>


    <!-- ---------------------------------------------------------------------------------------- -->
    <!-- iMad's change -->
    <!-- Under OG view, same as before -->
    <div v-show="!userStore.isAltView" class="og-node-info">
      <div id="clickedNodeName" v-if="gameStore.isConnectionNode(clickedNode.key)">
        <p>
          {{ gameStore.uloc.node[clickedNode.key] }}
          <template v-if="routingStore.routing.autotakenGrindNodes.has(clickedNode.key)">
            <s>{{ clickedNode.thisCpCost }}CP</s> <abbr class="tooltip" title="used for grind node">ℹ</abbr>
          </template>
          <template v-else>
            {{ clickedNode.thisCpCost }}CP
          </template>
        </p>

        <p class="fsxs" v-if="clickedNode.key in userStore.currentNodesJobs">
          shared by active nodejobs:
          <p v-for="job in activeNodeJobs_sorted">
            {{ formatFixed(jobCashFlowPercent(job) * 100) }}% -
            <span 
              v-if="this.gameStore.jobIsPz(job.worker.job)"
              @click="$emit('panToPaPos', this.gameStore.nodes[job.pzk].pos)" 
              class="clickable"
            >
              {{ gameStore.plantzoneName(job.pzk) }} 
            </span>
            <span v-else>
              {{ gameStore.uloc.char[job.worker.job.hk] }}
              {{ userStore.userWorkshops[job.worker.job.hk].label }}
            </span>
            @
            {{ formatFixed(job.profit.priceDaily, 2) }} M$/day
          </p>
        </p>

        <input type="checkbox" @change="userStore.modifyGrindTakens($event, clickedNode.key)" :checked="userStore.grindTakenSet.has(clickedNode.key)">
        grind node (invested for droprate)
      </div>

      <div id="clickedPlantzoneInfo" v-if="gameStore.isPlantzone(clickedNode.key)">
        <template v-if="userStore.grindTakenSet.has(clickedNode.key)">
          <input type="checkbox" @change="userStore.modifyGrindTakens($event, clickedNode.key)" :checked="userStore.grindTakenSet.has(clickedNode.key)">
          grind node (invested for droprate)
        </template>
        
        <Plantzone
          :pzk="clickedNode.key"
          @showResourceDialog="showResourceDialog"
          @editWorker="editWorker"
        />
      </div>
    </div>



    <!-- Show compact parent node info at bottom left with children info and selected/unselected status -->
    <div v-show="userStore.isAltView" class="alt-node-info">
      <div id="clickedNodeName" v-if="gameStore.isConnectionNode(actualNode)">
        <!-- Parent Row -->
        <div class="my-line">
          <div class="node-prefix" :class="{ 'is-pinned': isNodePinned(actualNode) }">
            <span class="prefix-pin">{{ isNodePinned(actualNode) ? '📌' : '' }}</span>
            <span class="prefix-key">{{ actualNode }}</span>
          </div>

          <label class="chip-toggle" :class="{ active: graphStore.targetSet.has(actualNode) }">
            <input 
              type="checkbox" 
              :checked="graphStore.targetSet.has(actualNode)" 
              @change="graphStore.modifyTarget(actualNode)" 
            />
            <span class="chip-dot"></span>
            <span>({{ gameStore.nodes[String(actualNode)].CP }} CP) {{ gameStore.uloc.node[String(actualNode)] }}</span>
          </label>
        </div>

        <!-- Children Rows -->
        <div v-for="child in sortedChildren" :key="child" class="my-line">
          <!-- Fixed-width prefix: Pin Icon + 4-Digit Key -->
          <div class="node-prefix" :class="{ 'is-pinned': isNodePinned(child) }">
            <span class="prefix-pin">{{ isNodePinned(child) ? '📌' : '' }}</span>
            <span class="prefix-key">{{ child }}</span>
          </div>

          <label class="chip-toggle" :class="{ active: graphStore.targetSet.has(Number(child)) }">
            <input 
              type="checkbox" 
              :checked="graphStore.targetSet.has(Number(child))" 
              @change="graphStore.modifyTarget(Number(child))" 
            />
            <span class="chip-dot"></span>
            <span>
              ({{ gameStore.nodes[child]?.CP }} CP) 
              {{ 
                gameStore.nearestTownProfit()[child]?.dailyPerCp != null
                  ? `${gameStore.workerIcon(gameStore.nearestTownProfit()[child].alt_workers[0])} 
                  ${Number(gameStore.nearestTownProfit()[child].alt_workers[0].priceDaily).toFixed(3)} M$/day` 
                  : '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0Specialties' 
              }}
            </span>
          </label>

          <!-- Bound directly to userStore -->
          <TownSelection
            :model-value="getNodeSelectedTown(child)"
            @update:model-value="val => graphStore.setNodeTown(child, val)"
            :options="altTownOptions(child)"
            :visible-count="3"
            placeholder="Others"
            drop-up
          />
          <span v-if="child in gameStore.plantzones">
            <ItemIcon v-for="k in gameStore.plantzones[child].itemkeys" :ik="Number(k)"/>
          </span>
        </div>
      </div>

      <div id="clickedPlantzoneInfo" v-if="gameStore.isPlantzone(clickedNode.key) && !userStore.isQuickSelect">
        <template v-if="userStore.grindTakenSet.has(clickedNode.key)">
          <input type="checkbox" @change="userStore.modifyGrindTakens($event, clickedNode.key)" :checked="userStore.grindTakenSet.has(clickedNode.key)">
          grind node (invested for droprate)
        </template>
        
        <Plantzone
          :pzk="clickedNode.key"
          @showResourceDialog="showResourceDialog"
          @editWorker="editWorker"
        />
      </div>
    </div>

  
  </div>
</template>

<style scoped>

.rolldown {
  cursor: pointer;
  text-align: center;
  height: 0.8em;
  margin-bottom: 0px;
}
.rolldown div {
  top: -0.4em;
}
.rolldown:hover {
  background-color: var(--color-background-soft);
}
.tooltip {
  cursor: help;
}
button.unresolved {
  border-color: rgba(255, 0, 0, 0.7);
}
.vscroll40 {
    max-height: 40vh;  /* percents of viewport height */
    overflow-y: auto;   /* Show scrollbar only when needed */
}



/* Base chip container (ALWAYS visible, both active and inactive) */
.chip-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 10px;
  background-color: #1e1e24;       /* Dark card background */
  border: 1px solid #3b3c42;        /* Visible gray border when inactive */
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  font-family: inherit;
  font-size: 13px;
  color: #9ca3af;                  /* Muted text color when inactive */
  transition: all 0.15s ease;
  box-sizing: border-box;
}

/* Hide the native checkbox input */
.chip-toggle input[type="checkbox"] {
  display: none;
}

/* The indicator dot (always present) */
.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #52525b;       /* Muted gray dot when inactive */
  flex-shrink: 0;
  transition: background-color 0.2s ease, box-shadow 0.2s ease;
}

/* Hover state for inactive */
.chip-toggle:hover {
  border-color: #52525e;
  color: #d1d5db;
}

/* ACTIVE STATE (When userStore.isChildrenHide is true) */
.chip-toggle.active {
  background-color: rgba(37, 99, 235, 0.15); /* Translucent blue fill */
  border-color: #3b82f6;                      /* Blue border */
  color: #93c5fd;                              /* Light blue text */
}

.chip-toggle.active .chip-dot {
  background-color: #3b82f6;                  /* Bright blue dot */
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.6);
}

#mapObjDetail {
  overflow: visible !important;
}



.my-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 1px;
}

/* Remove margin on the very last row so it doesn't push down the container floor */
.my-line:last-child {
  margin-bottom: 0;
}

/* Fixed container holding [Pin] + [4-digit Key] */
.node-prefix {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  width: 48px;          /* Wide enough for emoji pin + 4 digits */
  min-width: 48px;
  gap: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  color: #94a3b8;       /* Subtle muted tone */
}

/* When pinned, make the key pop slightly */
.node-prefix.is-pinned {
  color: #f1f5f9;
  font-weight: 600;
}

.prefix-pin {
  display: inline-block;
  width: 16px;
  font-size: 12px;
  text-align: center;
}

.prefix-key {
  letter-spacing: -0.2px;
}


</style>
