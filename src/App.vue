<script setup>
import { RouterLink, RouterView } from "vue-router";
import {useGameStore} from './stores/game'
import {useUserStore} from './stores/user'
import {useMarketStore} from './stores/market'
import {useMapStore} from './stores/map'
import {useGraphStore} from './stores/graph'
</script>

<script>
export default {
  async beforeCreate() {
    const userStore = useUserStore()
    const u = localStorage.getItem('user')
    userStore.migrate(u)

    const mapStore = useMapStore()
    const p = localStorage.getItem('map')
    mapStore.$patch(JSON.parse(p))

    const gameStore = useGameStore()
    await gameStore.fetchData()  // is needed by Market to access craftables

    const marketStore = useMarketStore()
    const m = localStorage.getItem('market')
    if (m) {
      // always load local first in case api dies
      marketStore.$patch(JSON.parse(m))
    }
    const hour = 3600 * 1000
    if (marketStore.apiDatetime + hour < Date.now()) {
      // todo: handle failure
      marketStore.fetchData()
    }

    // In App.vue beforeCreate():
    const graphStore = useGraphStore()
    const savedGraph = localStorage.getItem('graph')
    if (savedGraph) {
      try {
        const parsed = JSON.parse(savedGraph)
        graphStore.$patch({
          ...parsed,
          liveTopKPzCount: parsed.topKPzCount ?? graphStore.topKPzCount,
          liveSourceScaleStep: parsed.sourceScaleStep ?? graphStore.sourceScaleStep,
        })
      } catch (e) {
        console.warn('Failed to parse saved graph settings:', e)
      }
    }

    graphStore.$subscribe((_mutation, state) => {
      const trimmedHistory = state.seedHistory.slice(-100)
      const offset = state.seedHistory.length - trimmedHistory.length
      const lightSettings = {
        activeTab: state.activeTab,
        pzMode: state.pzMode,
        sourceMode: state.sourceMode,
        topKPzCount: state.topKPzCount,
        sourceScaleStep: state.sourceScaleStep,
        isContinuousMode: state.isContinuousMode,
        seedHistory: trimmedHistory,
        seedIndex: Math.max(0, Math.min(trimmedHistory.length - 1, state.seedIndex - offset)),
        draftSeed: state.draftSeed,
      }
      localStorage.setItem('graph', JSON.stringify(lightSettings))
    })
  }
}
</script>

<template>
  <header>
    <div class="wrapper">
      <nav>
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/plantzones">Plantzones</RouterLink>
        <RouterLink to="/resources">Resources</RouterLink>
        <RouterLink to="/settings">Settings</RouterLink>
        <RouterLink to="/about">About</RouterLink>
      </nav>
    </div>
  </header>

  <RouterView />
</template>

<style scoped>
header {
  line-height: 1.5;
  max-height: 100vh;
}

.logo {
  display: block;
  margin: 0 auto 2rem;
}

nav {
  width: 100%;
  font-size: 12px;
  text-align: center;
  margin-bottom: 1rem;
}

nav a.router-link-exact-active {
  color: var(--color-text);
}

nav a.router-link-exact-active:hover {
  background-color: transparent;
}

nav a {
  display: inline-block;
  padding: 0 1rem;
  border-left: 1px solid var(--color-border);
}

nav a:first-of-type {
  border: 0;
}

@media (min-width: 91024px) {
  header {
    display: flex;
    place-items: center;
    padding-right: calc(var(--section-gap) / 2);
  }

  .logo {
    margin: 0 2rem 0 0;
  }

  header .wrapper {
    display: flex;
    place-items: flex-start;
    flex-wrap: wrap;
  }

  nav {
    text-align: left;
    margin-left: -1rem;
    font-size: 1rem;

    padding: 1rem 0;
    margin-top: 1rem;
  }
}
</style>
