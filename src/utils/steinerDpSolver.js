// src/utils/steinerDpSolver.js

/**
 * Bottom-up Steiner Forest DP over `contractedTd` up to `targetNodeId`.
 *
 * Pipeline (root solves with heuristic advice enabled):
 *  0. Instant Exact Shortcut for G <= 1 groups (single-group Steiner Tree DP).
 *  1. GREEDY (< 5 ms): Multi-ordering shortest-path Steiner Forest + reverse-weight pruning.
 *  2. HEUR 1K: Fast multi-group beam DP to identify high-quality group partitioning.
 *  3. POLISH (Partition-Guided Exact G = 1 Tree Refinement):
 *     - Extracts connected terminal components from the best solution so far.
 *     - Solves each component PROVABLY EXACT as a G = 1 Steiner Tree (with all global
 *       mandatory terminals at weight 0 for free transit).
 *     - Automatically merges overlapping trees, then tests single-group splits and
 *       closest-pair merges using strict branch-and-bound exact G = 1 solves.
 *  4. HEUR 4K -> HEUR 16K -> EXACT:
 *     - Uses node-weighted dual ascent + residual split-group lower bounds on the outside
 *       graph `O` to prune suboptimal states early.
 *     - Uses strict-improvement pruning (`< upperBoundCost`) so an empty exact table
 *       certifies global optimality of the best bound found.
 *     - Enforces in-flight memory limits & per-`selMask` dominance cleanup.
 */

function popcount32(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Computes a fast feasible Steiner Forest upper bound directly on `adjSets` using
 * multi-ordering shortest-path group connection + reverse-weight Steiner vertex pruning.
 */
function computeFastSteinerUpperBound(
  adjSets,
  weights,
  groups,
  mandatorySet,
  freeTargetList = [],
  anyTownList = []
) {
  const t0 = performance.now();
  const allVerts = [...adjSets.keys()];
  if (allVerts.length === 0) {
    return { minCost: 0, selectedVertices: [], ms: 0 };
  }

  const vToIdx = new Map();
  for (let i = 0; i < allVerts.length; i++) vToIdx.set(allVerts[i], i);
  const n = allVerts.length;

  const adjIdx = new Array(n);
  const wArr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = allVerts[i];
    wArr[i] = Math.max(0, Number(weights[u]) || 0);
    const nbrs = adjSets.get(u);
    const list = [];
    if (nbrs) {
      for (const v of nbrs) {
        const vi = vToIdx.get(v);
        if (vi !== undefined) list.push(vi);
      }
    }
    adjIdx[i] = list;
  }

  const mandatoryMask = new Uint8Array(n);
  for (const v of mandatorySet) {
    const idx = vToIdx.get(v);
    if (idx !== undefined) mandatoryMask[idx] = 1;
  }

  const groupIdxLists = groups.map((g) =>
    g.map((v) => vToIdx.get(v)).filter((idx) => idx !== undefined)
  );

  const freeTargetIdxList = freeTargetList
    .map((v) => vToIdx.get(v))
    .filter((idx) => idx !== undefined);
  const anyTownIdxList = anyTownList
    .map((v) => vToIdx.get(v))
    .filter((idx) => idx !== undefined);
  const isAnyTownIdx = new Uint8Array(n);
  for (let i = 0; i < anyTownIdxList.length; i++) isAnyTownIdx[anyTownIdxList[i]] = 1;

  const compId = new Int32Array(n);
  const bfsQueue = new Int32Array(n);
  const dist = new Float64Array(n);
  const prevNode = new Int32Array(n);
  const visited = new Uint8Array(n);

  function labelChosenComponents(chosen) {
    compId.fill(-1);
    let nextComp = 0;
    for (let i = 0; i < n; i++) {
      if (!chosen[i] || compId[i] !== -1) continue;
      compId[i] = nextComp;
      let head = 0;
      let tail = 0;
      bfsQueue[tail++] = i;
      while (head < tail) {
        const u = bfsQueue[head++];
        const nbrs = adjIdx[u];
        for (let j = 0; j < nbrs.length; j++) {
          const v = nbrs[j];
          if (chosen[v] && compId[v] === -1) {
            compId[v] = nextComp;
            bfsQueue[tail++] = v;
          }
        }
      }
      nextComp++;
    }
  }

  function isFeasible(chosen) {
    labelChosenComponents(chosen);
    for (let g = 0; g < groupIdxLists.length; g++) {
      const terms = groupIdxLists[g];
      if (terms.length <= 1) continue;
      const c0 = compId[terms[0]];
      if (c0 === -1) return false;
      for (let i = 1; i < terms.length; i++) {
        if (compId[terms[i]] !== c0) return false;
      }
    }
    if (freeTargetIdxList.length > 0) {
      const townComps = new Set();
      for (let i = 0; i < anyTownIdxList.length; i++) {
        const ti = anyTownIdxList[i];
        if (chosen[ti] && compId[ti] !== -1) townComps.add(compId[ti]);
      }
      for (let i = 0; i < freeTargetIdxList.length; i++) {
        const fi = freeTargetIdxList[i];
        if (compId[fi] === -1 || !townComps.has(compId[fi])) return false;
      }
    }
    return true;
  }

  function buildForOrder(order) {
    const chosen = new Uint8Array(mandatoryMask);

    for (let oi = 0; oi < order.length; oi++) {
      const terms = groupIdxLists[order[oi]];
      if (!terms || terms.length <= 1) continue;

      let safety = terms.length + 2;
      while (safety-- > 0) {
        labelChosenComponents(chosen);

        const compToTerms = new Map();
        for (let i = 0; i < terms.length; i++) {
          const c = compId[terms[i]];
          let list = compToTerms.get(c);
          if (!list) {
            list = [];
            compToTerms.set(c, list);
          }
          list.push(terms[i]);
        }
        if (compToTerms.size <= 1) break;

        let srcComp = -1;
        let smallestSize = Infinity;
        for (const [c, list] of compToTerms.entries()) {
          if (list.length < smallestSize) {
            smallestSize = list.length;
            srcComp = c;
          }
        }

        const targetComps = new Set(compToTerms.keys());
        targetComps.delete(srcComp);

        dist.fill(Infinity);
        prevNode.fill(-1);
        visited.fill(0);

        for (let i = 0; i < n; i++) {
          if (chosen[i] && compId[i] === srcComp) {
            dist[i] = 0;
          }
        }

        let reached = -1;
        while (true) {
          let u = -1;
          let bestD = Infinity;
          for (let i = 0; i < n; i++) {
            if (!visited[i] && dist[i] < bestD) {
              bestD = dist[i];
              u = i;
            }
          }
          if (u === -1) break;
          visited[u] = 1;

          if (chosen[u] && targetComps.has(compId[u])) {
            reached = u;
            break;
          }

          const nbrs = adjIdx[u];
          for (let j = 0; j < nbrs.length; j++) {
            const v = nbrs[j];
            if (visited[v]) continue;
            const stepW = chosen[v] ? 0 : wArr[v];
            const alt = bestD + stepW;
            if (alt < dist[v]) {
              dist[v] = alt;
              prevNode[v] = u;
            }
          }
        }

        if (reached === -1) return null;

        let cur = reached;
        while (cur !== -1) {
          chosen[cur] = 1;
          cur = prevNode[cur];
        }
      }
    }

    // Connect any unassigned targets to the cheapest reachable town
    for (let fi = 0; fi < freeTargetIdxList.length; fi++) {
      const targetIdx = freeTargetIdxList[fi];
      labelChosenComponents(chosen);
      const myComp = compId[targetIdx];
      let alreadyHasTown = false;
      for (let ti = 0; ti < anyTownIdxList.length; ti++) {
        const idx = anyTownIdxList[ti];
        if (chosen[idx] && compId[idx] === myComp) {
          alreadyHasTown = true;
          break;
        }
      }
      if (alreadyHasTown) continue;

      dist.fill(Infinity);
      prevNode.fill(-1);
      visited.fill(0);
      for (let i = 0; i < n; i++) {
        if (chosen[i] && compId[i] === myComp) dist[i] = 0;
      }

      let reached = -1;
      while (true) {
        let u = -1;
        let bestD = Infinity;
        for (let i = 0; i < n; i++) {
          if (!visited[i] && dist[i] < bestD) {
            bestD = dist[i];
            u = i;
          }
        }
        if (u === -1) break;
        visited[u] = 1;

        if (isAnyTownIdx[u]) {
          reached = u;
          break;
        }

        const nbrs = adjIdx[u];
        for (let j = 0; j < nbrs.length; j++) {
          const v = nbrs[j];
          if (visited[v]) continue;
          const stepW = chosen[v] ? 0 : wArr[v];
          const alt = bestD + stepW;
          if (alt < dist[v]) {
            dist[v] = alt;
            prevNode[v] = u;
          }
        }
      }

      if (reached === -1) return null;
      let cur = reached;
      while (cur !== -1) {
        chosen[cur] = 1;
        cur = prevNode[cur];
      }
    }

    const steinerCandidates = [];
    for (let i = 0; i < n; i++) {
      if (chosen[i] && !mandatoryMask[i]) steinerCandidates.push(i);
    }
    steinerCandidates.sort((a, b) => wArr[b] - wArr[a]);

    for (let i = 0; i < steinerCandidates.length; i++) {
      const idx = steinerCandidates[i];
      chosen[idx] = 0;
      if (!isFeasible(chosen)) {
        chosen[idx] = 1;
      }
    }

    if (!isFeasible(chosen)) return null;

    let totalCost = 0;
    const selectedVertices = [];
    for (let i = 0; i < n; i++) {
      if (chosen[i]) {
        totalCost += wArr[i];
        selectedVertices.push(allVerts[i]);
      }
    }
    selectedVertices.sort((a, b) => a - b);
    return { minCost: totalCost, selectedVertices };
  }

  const m = groups.length;
  const base = Array.from({ length: m }, (_, i) => i);
  const orders = [
    [...base].sort((a, b) => groups[b].length - groups[a].length),
    [...base].sort((a, b) => groups[a].length - groups[b].length),
    [...base],
    [...base].reverse(),
  ];

  for (let seed = 1; seed <= 2; seed++) {
    const shuf = [...base];
    let s = (seed * 2654435761) >>> 0;
    for (let i = shuf.length - 1; i > 0; i--) {
      s = (Math.imul(s ^ (s >>> 15), 2246822519) + 3266489917) >>> 0;
      const j = s % (i + 1);
      const tmp = shuf[i];
      shuf[i] = shuf[j];
      shuf[j] = tmp;
    }
    orders.push(shuf);
  }

  let best = null;
  for (let i = 0; i < orders.length; i++) {
    const res = buildForOrder(orders[i]);
    if (res && (!best || res.minCost < best.minCost)) {
      best = res;
    }
  }

  if (!best) return null;
  return {
    minCost: best.minCost,
    selectedVertices: best.selectedVertices,
    ms: Number((performance.now() - t0).toFixed(1)),
  };
}

export async function evaluateContractedDpUpTo(
  contractedTd,
  fullTd,
  snap,
  targetNodeId,
  options = {}
) {
  if (!contractedTd || !contractedTd.nodes?.length || !snap) return null;

  const ladderMode = options.ladderMode || 'full'; // 'full' | '1k' | 'greedy'

  const requestedMaxStates =
    options.maxStates != null &&
    Number.isFinite(Number(options.maxStates)) &&
    Number(options.maxStates) > 0
      ? Math.floor(Number(options.maxStates))
      : Infinity;

  const exactMemoryLimit =
    options.exactMemoryLimit != null && Number.isFinite(Number(options.exactMemoryLimit))
      ? Math.floor(Number(options.exactMemoryLimit))
      : 220000;

  const useHeuristicAdvice = options.useHeuristicAdvice !== false;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const shouldAbort = typeof options.shouldAbort === 'function' ? options.shouldAbort : () => false;

  const nodes = contractedTd.nodes;
  const fullNodes = fullTd?.nodes || [];
  const graph = snap.graph || {};
  const weights = snap.nodeWeights || {};
  const rootId = contractedTd.rootId ?? 0;

  // Adjacency sets
  const adjSets = new Map();
  for (const [uStr, nbrs] of Object.entries(graph)) {
    const u = Number(uStr);
    if (!Number.isFinite(u)) continue;
    adjSets.set(u, new Set((nbrs || []).map(Number).filter(Number.isFinite)));
  }

  // Build pairwise-disjoint terminal groups via connected components of the target <-> town demand graph
  const rawTargets = [...new Set((snap.targets || []).map(Number).filter((v) => adjSets.has(v)))].sort(
    (a, b) => a - b
  );

  const anyTownSet = new Set(
    (snap.towns || []).map(Number).filter((v) => Number.isFinite(v) && adjSets.has(v))
  );
  const freeTargetSet = new Set();

  const demandAdj = new Map();
  const mandatorySet = new Set();

  for (const t of rawTargets) {
    mandatorySet.add(t);
    if (!demandAdj.has(t)) demandAdj.set(t, new Set());
    const rawList = snap.assignments?.[t] ?? snap.assignments?.[String(t)] ?? [];
    const srcs = (Array.isArray(rawList) ? rawList : rawList != null ? [rawList] : [])
      .map(Number)
      .filter((s) => Number.isFinite(s) && adjSets.has(s));

    if (srcs.length === 0) {
      if (!anyTownSet.has(t)) freeTargetSet.add(t);
    }

    for (const s of srcs) {
      mandatorySet.add(s);
      if (!demandAdj.has(s)) demandAdj.set(s, new Set());
      if (s !== t) {
        demandAdj.get(t).add(s);
        demandAdj.get(s).add(t);
      }
    }
  }

  const disjointGroups = [];
  const dVisited = new Set();
  const sortedDemandVerts = [...demandAdj.keys()].sort((a, b) => a - b);

  for (const startV of sortedDemandVerts) {
    if (dVisited.has(startV)) continue;
    const comp = [];
    const q = [startV];
    dVisited.add(startV);
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      comp.push(cur);
      for (const nxt of demandAdj.get(cur) || []) {
        if (!dVisited.has(nxt)) {
          dVisited.add(nxt);
          q.push(nxt);
        }
      }
    }
    if (comp.length >= 2) {
      comp.sort((a, b) => a - b);
      disjointGroups.push(comp);
    }
  }

  const numGroups = disjointGroups.length;
  if (numGroups > 64) {
    throw new Error(`steinerDpSolver supports up to 64 disjoint terminal groups (got ${numGroups}).`);
  }
  const hasHi = numGroups > 32;
  const hasFreeTargets = freeTargetSet.size > 0;

  let globalMandatoryCost = 0;
  for (const v of mandatorySet) {
    globalMandatoryCost += Math.max(0, Number(weights[v]) || 0);
  }

  // Map each terminal vertex -> its unique group bit (at most 1 group per vertex)
  const vertexGroupLo = new Map();
  const vertexGroupHi = new Map();
  const vertexGroupIdx = new Map();

  for (let g = 0; g < numGroups; g++) {
    const lo = g < 32 ? 1 << g : 0;
    const hi = g >= 32 ? 1 << (g - 32) : 0;
    for (const v of disjointGroups[g]) {
      vertexGroupIdx.set(v, g);
      if (lo !== 0) vertexGroupLo.set(v, lo);
      if (hi !== 0) vertexGroupHi.set(v, hi);
    }
  }

  // Average positive vertex weight for beam-search penalty on split groups
  let weightSum = 0;
  let weightCount = 0;
  for (const w of Object.values(weights)) {
    const val = Number(w);
    if (val > 0) {
      weightSum += val;
      weightCount++;
    }
  }
  const avgNodeWeight = weightCount > 0 ? weightSum / weightCount : 100;

  // Precompute subNodeSets[uId] and exact subtreeVerts[uId] (including internal chain bags)
  const subNodeSets = new Array(nodes.length);
  const subtreeVerts = new Array(nodes.length);

  const buildSubtreeInfo = (uId) => {
    const nSet = new Set([uId]);
    const vSet = new Set(nodes[uId].bag);
    for (const cId of nodes[uId].children || []) {
      buildSubtreeInfo(cId);
      for (const x of subNodeSets[cId]) nSet.add(x);
      for (const v of subtreeVerts[cId]) vSet.add(v);
      const chainOrigIds = nodes[uId].transitions?.[cId]?.chainOrigIds || [];
      for (let i = 0; i < chainOrigIds.length; i++) {
        const fb = fullNodes[chainOrigIds[i]]?.bag;
        if (fb) {
          for (let j = 0; j < fb.length; j++) vSet.add(fb[j]);
        }
      }
    }
    subNodeSets[uId] = nSet;
    subtreeVerts[uId] = vSet;
  };
  buildSubtreeInfo(rootId);

  const allGraphVerts = subtreeVerts[rootId];
  const targetScopeVerts = subtreeVerts[targetNodeId] || allGraphVerts;

  function buildOutsideTracker(seenVerts) {
    let outAnyTownCount = 0;
    let outGroupLo = 0;
    let outGroupHi = 0;
    let outMandatoryCost = 0;
    const outGroupCounts = new Int32Array(numGroups);

    for (const v of allGraphVerts) {
      if (seenVerts.has(v)) continue;
      if (hasFreeTargets && anyTownSet.has(v)) outAnyTownCount++;

      const g = vertexGroupIdx.get(v);
      if (g !== undefined) {
        outGroupCounts[g]++;
        if (g < 32) outGroupLo |= 1 << g;
        else outGroupHi |= 1 << (g - 32);
      }

      if (mandatorySet.has(v) && targetScopeVerts.has(v)) {
        const w = Math.max(0, Number(weights[v]) || 0);
        if (w > 0) outMandatoryCost += w;
      }
    }

    return {
      outGroupLo,
      outGroupHi,
      outGroupCounts,
      outMandatoryCost,
      outAnyTownCount,
    };
  }

  function advanceOutsideTracker(tracker, v) {
    const g = vertexGroupIdx.get(v);
    if (g !== undefined) {
      if (--tracker.outGroupCounts[g] <= 0) {
        tracker.outGroupCounts[g] = 0;
        if (g < 32) tracker.outGroupLo &= ~(1 << g);
        else tracker.outGroupHi &= ~(1 << (g - 32));
      }
    }

    if (mandatorySet.has(v) && targetScopeVerts.has(v)) {
      const w = Math.max(0, Number(weights[v]) || 0);
      if (w > 0) tracker.outMandatoryCost -= w;
    }

    if (hasFreeTargets && anyTownSet.has(v)) {
      tracker.outAnyTownCount = Math.max(0, tracker.outAnyTownCount - 1);
    }
  }

  /**
   * Builds a strictly admissible dual-ascent + residual split-group lower-bound oracle
   * on the strictly outside subgraph `O = allGraphVerts \ seenVerts` separated by `bag`.
   *
   * - `getDualForSelMask(selMask)` contracts selected bag vertices into one zero-cost
   *   super-vertex `u*` and runs node-weighted primal-dual moat growth over `O ∪ {u*}`.
   *   Returns `{ dualLB, resW, resPairDist }` (with `dualLB = Infinity` if infeasible).
   * - `computeExtraSplitLB(...)` adds a non-overlapping lower bound using residual weights
   *   `resW` whenever a group is split across >= 2 distinct bag components.
   */
  function createOutsideDualContext(seenVerts, bag, tracker) {
    const k = bag.length;
    const outVerts = [];
    const outIdxOf = new Map();

    for (const v of allGraphVerts) {
      if (!seenVerts.has(v)) {
        outIdxOf.set(v, outVerts.length);
        outVerts.push(v);
      }
    }
    const m = outVerts.length;

    let hasActiveOutsideGroup = false;
    let activeGrpLo = 0;
    let activeGrpHi = 0;
    let inGrpLo = 0;
    let inGrpHi = 0;

    for (let g = 0; g < numGroups; g++) {
      const outCnt = tracker.outGroupCounts[g];
      if (outCnt <= 0) continue;
      const inCnt = disjointGroups[g].length - outCnt;
      if (outCnt >= 2 || (outCnt >= 1 && inCnt >= 1)) {
        hasActiveOutsideGroup = true;
        if (g < 32) {
          activeGrpLo |= 1 << g;
          if (inCnt > 0) inGrpLo |= 1 << g;
        } else {
          activeGrpHi |= 1 << (g - 32);
          if (inCnt > 0) inGrpHi |= 1 << (g - 32);
        }
      }
    }

    const outAdj = new Array(m);
    const outIsMand = new Uint8Array(m);
    const outWeight = new Float64Array(m);
    const outGrpLo = new Int32Array(m);
    const outGrpHi = new Int32Array(m);

    for (let i = 0; i < m; i++) {
      const u = outVerts[i];
      outIsMand[i] = mandatorySet.has(u) ? 1 : 0;
      outWeight[i] = outIsMand[i] ? 0 : Math.max(0, Number(weights[u]) || 0);
      outGrpLo[i] = (vertexGroupLo.get(u) || 0) & activeGrpLo;
      outGrpHi[i] = hasHi ? (vertexGroupHi.get(u) || 0) & activeGrpHi : 0;

      const list = [];
      for (const v of adjSets.get(u) || []) {
        const vi = outIdxOf.get(v);
        if (vi !== undefined) list.push(vi);
      }
      outAdj[i] = list;
    }

    const bagToOutNbrs = new Array(k);
    const bagDirectAdj = new Uint8Array(k * k);
    for (let bi = 0; bi < k; bi++) {
      const u = bag[bi];
      const uNbrs = adjSets.get(u);
      const list = [];
      if (uNbrs) {
        for (const v of uNbrs) {
          const vi = outIdxOf.get(v);
          if (vi !== undefined) list.push(vi);
        }
        for (let bj = 0; bj < k; bj++) {
          if (bi !== bj && uNbrs.has(bag[bj])) {
            bagDirectAdj[bi * k + bj] = 1;
          }
        }
      }
      bagToOutNbrs[bi] = list;
    }

    // Scratch arrays reused across `selMask` queries on this bag
    const totalN = m + 1; // index `m` = contracted super-vertex u*
    const dParent = new Int32Array(totalN);
    const dGrpLo = new Int32Array(totalN);
    const dGrpHi = new Int32Array(totalN);
    const free = new Uint8Array(totalN);
    const isUStarNbr = new Uint8Array(m);
    const isActiveRoot = new Uint8Array(totalN);
    const rootHead = new Int32Array(totalN);
    const nextInComp = new Int32Array(totalN);
    const degActive = new Int32Array(m);
    const vStamp = new Int32Array(m);
    const dDist = new Float64Array(m);
    const dVis = new Uint8Array(m);

    function dFind(x) {
      let r = x;
      while (dParent[r] !== r) r = dParent[r];
      while (dParent[x] !== r) {
        const nxt = dParent[x];
        dParent[x] = r;
        x = nxt;
      }
      return r;
    }

    function dUnion(a, b) {
      const ra = dFind(a);
      const rb = dFind(b);
      if (ra !== rb) {
        dParent[ra] = rb;
        dGrpLo[rb] |= dGrpLo[ra];
        if (hasHi) dGrpHi[rb] |= dGrpHi[ra];
      }
    }

    const selCache = new Map();

    function getDualForSelMask(selMask) {
      const cached = selCache.get(selMask);
      if (cached !== undefined) return cached;

      if (m === 0) {
        const entry = {
          dualLB: hasActiveOutsideGroup ? Infinity : 0,
          resW: null,
          resPairDist: null,
        };
        selCache.set(selMask, entry);
        return entry;
      }

      const resW = new Float64Array(m);
      if (!hasActiveOutsideGroup) {
        for (let i = 0; i < m; i++) resW[i] = outWeight[i];
        const entry = { dualLB: 0, resW, resPairDist: null };
        selCache.set(selMask, entry);
        return entry;
      }

      isUStarNbr.fill(0);
      const uStarNbrList = [];
      for (let bi = 0; bi < k; bi++) {
        if ((selMask & (1 << bi)) === 0) continue;
        const nbrs = bagToOutNbrs[bi];
        for (let j = 0; j < nbrs.length; j++) {
          const oi = nbrs[j];
          if (isUStarNbr[oi] === 0) {
            isUStarNbr[oi] = 1;
            uStarNbrList.push(oi);
          }
        }
      }

      free[m] = 1;
      dParent[m] = m;
      dGrpLo[m] = inGrpLo;
      dGrpHi[m] = inGrpHi;

      for (let i = 0; i < m; i++) {
        dParent[i] = i;
        dGrpLo[i] = outGrpLo[i];
        dGrpHi[i] = outGrpHi[i];
        if (outIsMand[i] || outWeight[i] <= 0) {
          free[i] = 1;
          resW[i] = 0;
        } else {
          free[i] = 0;
          resW[i] = outWeight[i];
        }
      }

      for (let i = 0; i < m; i++) {
        if (!free[i]) continue;
        if (isUStarNbr[i]) dUnion(i, m);
        const nbrs = outAdj[i];
        for (let j = 0; j < nbrs.length; j++) {
          const nb = nbrs[j];
          if (nb > i && free[nb]) dUnion(i, nb);
        }
      }

      let dualLB = 0;
      let stamp = 0;
      vStamp.fill(0);

      let iterGuard = m + 2;
      while (iterGuard-- > 0) {
        let seenOnceLo = 0;
        let seenMultiLo = 0;
        let seenOnceHi = 0;
        let seenMultiHi = 0;

        for (let i = 0; i < totalN; i++) {
          if (!free[i] || dParent[i] !== i) continue;
          const gLo = dGrpLo[i];
          seenMultiLo |= seenOnceLo & gLo;
          seenOnceLo |= gLo;
          if (hasHi) {
            const gHi = dGrpHi[i];
            seenMultiHi |= seenOnceHi & gHi;
            seenOnceHi |= gHi;
          }
        }

        if (seenMultiLo === 0 && seenMultiHi === 0) break;

        isActiveRoot.fill(0);
        rootHead.fill(-1);
        let activeCount = 0;

        for (let i = 0; i < totalN; i++) {
          if (!free[i]) continue;
          const r = dFind(i);
          if (i === r) {
            const act =
              (dGrpLo[r] & seenMultiLo) !== 0 || (hasHi && (dGrpHi[r] & seenMultiHi) !== 0);
            if (act) {
              isActiveRoot[r] = 1;
              activeCount++;
            }
          }
          nextInComp[i] = rootHead[r];
          rootHead[r] = i;
        }

        degActive.fill(0);
        const touchedSteiner = [];

        for (let r = 0; r < totalN; r++) {
          if (!isActiveRoot[r]) continue;
          stamp++;
          let bndCount = 0;

          for (let u = rootHead[r]; u !== -1; u = nextInComp[u]) {
            const nbrs = u === m ? uStarNbrList : outAdj[u];
            for (let j = 0; j < nbrs.length; j++) {
              const v = nbrs[j];
              if (free[v]) continue;
              if (vStamp[v] !== stamp) {
                vStamp[v] = stamp;
                if (degActive[v] === 0) touchedSteiner.push(v);
                degActive[v]++;
                bndCount++;
              }
            }
          }

          if (bndCount === 0) {
            // Active group cut off with empty boundary -> provably infeasible for this selMask
            const infEntry = { dualLB: Infinity, resW: null, resPairDist: null };
            selCache.set(selMask, infEntry);
            return infEntry;
          }
        }

        let minRatio = Infinity;
        for (let ti = 0; ti < touchedSteiner.length; ti++) {
          const v = touchedSteiner[ti];
          const ratio = resW[v] / degActive[v];
          if (ratio < minRatio) minRatio = ratio;
        }

        if (!Number.isFinite(minRatio)) break;
        dualLB += activeCount * minRatio;

        for (let ti = 0; ti < touchedSteiner.length; ti++) {
          const v = touchedSteiner[ti];
          resW[v] -= degActive[v] * minRatio;
          if (resW[v] <= 1e-9) {
            resW[v] = 0;
            free[v] = 1;
            if (isUStarNbr[v]) dUnion(v, m);
            const nbrs = outAdj[v];
            for (let j = 0; j < nbrs.length; j++) {
              const nb = nbrs[j];
              if (free[nb]) dUnion(v, nb);
            }
          }
        }
      }

      const safeDualLB = dualLB > 1e-7 ? dualLB - 1e-7 : 0;
      const entry = { dualLB: safeDualLB, resW, resPairDist: null };
      selCache.set(selMask, entry);
      return entry;
    }

    function getResPairDist(selMask, dualEntry) {
      if (dualEntry.resPairDist !== null) return dualEntry.resPairDist;
      const resW = dualEntry.resW;
      const distMat = new Float64Array(k * k);
      distMat.fill(Infinity);

      if (m === 0 || !resW) {
        for (let bi = 0; bi < k; bi++) {
          distMat[bi * k + bi] = 0;
          for (let bj = 0; bj < k; bj++) {
            if (bagDirectAdj[bi * k + bj]) distMat[bi * k + bj] = 0;
          }
        }
        dualEntry.resPairDist = distMat;
        return distMat;
      }

      for (let bi = 0; bi < k; bi++) {
        if ((selMask & (1 << bi)) === 0) continue;
        distMat[bi * k + bi] = 0;

        dDist.fill(Infinity);
        dVis.fill(0);
        const startNbrs = bagToOutNbrs[bi];
        for (let j = 0; j < startNbrs.length; j++) {
          const oi = startNbrs[j];
          const w0 = resW[oi];
          if (w0 < dDist[oi]) dDist[oi] = w0;
        }

        while (true) {
          let u = -1;
          let bestD = Infinity;
          for (let i = 0; i < m; i++) {
            if (!dVis[i] && dDist[i] < bestD) {
              bestD = dDist[i];
              u = i;
            }
          }
          if (u === -1) break;
          dVis[u] = 1;
          const nbrs = outAdj[u];
          for (let j = 0; j < nbrs.length; j++) {
            const v = nbrs[j];
            if (dVis[v]) continue;
            const alt = bestD + resW[v];
            if (alt < dDist[v]) dDist[v] = alt;
          }
        }

        for (let bj = 0; bj < k; bj++) {
          if (bi === bj || (selMask & (1 << bj)) === 0) continue;
          if (bagDirectAdj[bi * k + bj]) {
            distMat[bi * k + bj] = 0;
            continue;
          }
          let minD = Infinity;
          const endNbrs = bagToOutNbrs[bj];
          for (let j = 0; j < endNbrs.length; j++) {
            const d = dDist[endNbrs[j]];
            if (d < minD) minD = d;
          }
          distMat[bi * k + bj] = minD;
        }
      }

      dualEntry.resPairDist = distMat;
      return distMat;
    }

    function computeExtraSplitLB(selMask, dualEntry, compCodes, numComps, compGroupsLo, compGroupsHi) {
      if (numComps <= 1 || !Number.isFinite(dualEntry.dualLB)) return 0;

      let seenOnceLo = 0;
      let seenMultiLo = 0;
      let seenOnceHi = 0;
      let seenMultiHi = 0;
      for (let c = 1; c <= numComps; c++) {
        const gLo = compGroupsLo[c];
        seenMultiLo |= seenOnceLo & gLo;
        seenOnceLo |= gLo;
        if (hasHi) {
          const gHi = compGroupsHi[c];
          seenMultiHi |= seenOnceHi & gHi;
          seenOnceHi |= gHi;
        }
      }
      if (seenMultiLo === 0 && seenMultiHi === 0) return 0;

      const distMat = getResPairDist(selMask, dualEntry);
      let maxLeave = 0;

      for (let c = 1; c <= numComps; c++) {
        const isSplit =
          (compGroupsLo[c] & seenMultiLo) !== 0 ||
          (hasHi && (compGroupsHi[c] & seenMultiHi) !== 0);
        if (!isSplit) continue;

        let minExit = Infinity;
        for (let i = 0; i < k; i++) {
          if (compCodes[i] !== c) continue;
          const rowOff = i * k;
          for (let j = 0; j < k; j++) {
            const cj = compCodes[j];
            if (cj > 0 && cj !== c) {
              const d = distMat[rowOff + j];
              if (d < minExit) minExit = d;
            }
          }
        }
        if (minExit > maxLeave) maxLeave = minExit;
        if (!Number.isFinite(maxLeave)) return Infinity;
      }

      return maxLeave > 1e-7 ? maxLeave - 1e-7 : 0;
    }

    return {
      getDualForSelMask,
      computeExtraSplitLB,
    };
  }

  // Group target subtree nodes by depth (bottom-up: deepest -> shallowest)
  const targetSubtreeIds = [...subNodeSets[targetNodeId]];
  let maxDepth = 0;
  let minDepth = Infinity;
  const nodesByDepth = new Map();
  for (const id of targetSubtreeIds) {
    const d = nodes[id]?.depth ?? 0;
    if (d > maxDepth) maxDepth = d;
    if (d < minDepth) minDepth = d;
    if (!nodesByDepth.has(d)) nodesByDepth.set(d, []);
    nodesByDepth.get(d).push(id);
  }
  const sortedDepths = [...nodesByDepth.keys()].sort((a, b) => b - a);

  // Full-root bottom-up depth order (used by exact G = 1 tree solver)
  const rootSubtreeIds = [...subNodeSets[rootId]];
  const rootNodesByDepth = new Map();
  for (const id of rootSubtreeIds) {
    const d = nodes[id]?.depth ?? 0;
    if (!rootNodesByDepth.has(d)) rootNodesByDepth.set(d, []);
    rootNodesByDepth.get(d).push(id);
  }
  const rootSortedDepths = [...rootNodesByDepth.keys()].sort((a, b) => b - a);

  function extractSolutionVertices(bp) {
    const selected = new Set();
    const visited = new Set();
    const stack = [bp];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur || visited.has(cur)) continue;
      visited.add(cur);
      if (cur.v !== undefined) selected.add(cur.v);
      if (cur.prev) stack.push(cur.prev);
      if (cur.left) stack.push(cur.left);
      if (cur.right) stack.push(cur.right);
    }
    return [...selected].sort((a, b) => a - b);
  }

  function bagsIdentical(bagA, bagB) {
    if (bagA.length !== bagB.length) return false;
    for (let i = 0; i < bagA.length; i++) {
      if (bagA[i] !== bagB[i]) return false;
    }
    return true;
  }

  function computePartKey(compCodes, k) {
    if (k <= 13) {
      let key = 0;
      for (let i = 0; i < k; i++) key = key * 16 + compCodes[i];
      return key;
    }
    let s = '';
    for (let i = 0; i < k; i++) {
      if (i > 0) s += ',';
      s += compCodes[i];
    }
    return s;
  }

  // =========================================================================
  // EXACT SINGLE-GROUP (G = 1) STEINER TREE SOLVER
  // =========================================================================
  const allVertList = [...adjSets.keys()];
  const vToDense = new Map();
  for (let i = 0; i < allVertList.length; i++) vToDense.set(allVertList[i], i);
  const numV = allVertList.length;
  const denseAdj = new Array(numV);
  const denseTreeW = new Float64Array(numV);
  for (let i = 0; i < numV; i++) {
    const u = allVertList[i];
    denseTreeW[i] = mandatorySet.has(u) ? 0 : Math.max(0, Number(weights[u]) || 0);
    const list = [];
    for (const v of adjSets.get(u) || []) {
      const vi = vToDense.get(v);
      if (vi !== undefined) list.push(vi);
    }
    denseAdj[i] = list;
  }

  function computeSingleTreeGreedy(kSet) {
    const chosen = new Uint8Array(numV);
    const kIdxList = [];
    for (const v of kSet) {
      const idx = vToDense.get(v);
      if (idx !== undefined) {
        chosen[idx] = 1;
        kIdxList.push(idx);
      }
    }

    const compId = new Int32Array(numV);
    const bfsQ = new Int32Array(numV);
    const dist = new Float64Array(numV);
    const prev = new Int32Array(numV);
    const vis = new Uint8Array(numV);

    function labelChosen() {
      compId.fill(-1);
      let nc = 0;
      for (let i = 0; i < numV; i++) {
        if (!chosen[i] || compId[i] !== -1) continue;
        compId[i] = nc;
        let h = 0;
        let t = 0;
        bfsQ[t++] = i;
        while (h < t) {
          const u = bfsQ[h++];
          const nbrs = denseAdj[u];
          for (let j = 0; j < nbrs.length; j++) {
            const v = nbrs[j];
            if (chosen[v] && compId[v] === -1) {
              compId[v] = nc;
              bfsQ[t++] = v;
            }
          }
        }
        nc++;
      }
    }

    function kConnected() {
      labelChosen();
      if (kIdxList.length <= 1) return true;
      const c0 = compId[kIdxList[0]];
      if (c0 === -1) return false;
      for (let i = 1; i < kIdxList.length; i++) {
        if (compId[kIdxList[i]] !== c0) return false;
      }
      return true;
    }

    let safety = kIdxList.length + 2;
    while (safety-- > 0) {
      labelChosen();
      const compToK = new Map();
      for (let i = 0; i < kIdxList.length; i++) {
        const c = compId[kIdxList[i]];
        let list = compToK.get(c);
        if (!list) {
          list = [];
          compToK.set(c, list);
        }
        list.push(kIdxList[i]);
      }
      if (compToK.size <= 1) break;

      let srcComp = -1;
      let minSz = Infinity;
      for (const [c, list] of compToK.entries()) {
        if (list.length < minSz) {
          minSz = list.length;
          srcComp = c;
        }
      }
      const targetComps = new Set(compToK.keys());
      targetComps.delete(srcComp);

      dist.fill(Infinity);
      prev.fill(-1);
      vis.fill(0);
      for (let i = 0; i < numV; i++) {
        if (chosen[i] && compId[i] === srcComp) dist[i] = 0;
      }

      let reached = -1;
      while (true) {
        let u = -1;
        let bestD = Infinity;
        for (let i = 0; i < numV; i++) {
          if (!vis[i] && dist[i] < bestD) {
            bestD = dist[i];
            u = i;
          }
        }
        if (u === -1) break;
        vis[u] = 1;
        if (chosen[u] && targetComps.has(compId[u])) {
          reached = u;
          break;
        }
        const nbrs = denseAdj[u];
        for (let j = 0; j < nbrs.length; j++) {
          const v = nbrs[j];
          if (vis[v]) continue;
          const stepW = chosen[v] ? 0 : denseTreeW[v];
          const alt = bestD + stepW;
          if (alt < dist[v]) {
            dist[v] = alt;
            prev[v] = u;
          }
        }
      }

      if (reached === -1) return null;
      let cur = reached;
      while (cur !== -1) {
        chosen[cur] = 1;
        cur = prev[cur];
      }
    }

    const extras = [];
    for (let i = 0; i < numV; i++) {
      if (chosen[i] && !kSet.has(allVertList[i])) extras.push(i);
    }
    extras.sort((a, b) => denseTreeW[b] - denseTreeW[a]);
    for (let i = 0; i < extras.length; i++) {
      const idx = extras[i];
      chosen[idx] = 0;
      if (!kConnected()) chosen[idx] = 1;
    }

    if (!kConnected()) return null;

    let steinerCost = 0;
    const vertices = new Set();
    const steinerVerts = new Set();
    for (let i = 0; i < numV; i++) {
      if (chosen[i]) {
        const v = allVertList[i];
        vertices.add(v);
        if (!mandatorySet.has(v)) {
          steinerVerts.add(v);
          steinerCost += denseTreeW[i];
        }
      }
    }
    return { vertices, steinerVerts, steinerCost };
  }

  function solveSingleTreeExact(
    kVerts,
    steinerUpperBound = Infinity,
    strictImprovement = false,
    treeMaxStates = 60000
  ) {
    const t0 = performance.now();
    const kSet = new Set(kVerts);
    if (kSet.size <= 1) {
      return {
        vertices: kSet,
        steinerVerts: new Set(),
        steinerCost: 0,
        exact: true,
        ms: 0,
      };
    }

    const greedy = computeSingleTreeGreedy(kSet);
    if (!greedy) return null;

    if (greedy.steinerCost <= 1e-9) {
      if (strictImprovement && greedy.steinerCost >= steinerUpperBound - 1e-6) {
        return null;
      }
      return {
        ...greedy,
        exact: true,
        ms: Number((performance.now() - t0).toFixed(1)),
      };
    }

    const greedyBeatsBound = greedy.steinerCost < steinerUpperBound - 1e-6;
    const pruneLimit = greedyBeatsBound
      ? greedy.steinerCost
      : strictImprovement
        ? steinerUpperBound
        : steinerUpperBound + 1e-4;

    const MAX_BAG = 32;
    const tCompCodes = new Uint8Array(MAX_BAG);
    const tRemap = new Int32Array(MAX_BAG);
    const tSeenComp = new Uint8Array(MAX_BAG);
    const tUfParent = new Int32Array(MAX_BAG);
    const tUfHasK = new Uint8Array(MAX_BAG);
    const tLRep = new Int32Array(MAX_BAG);
    const tRRep = new Int32Array(MAX_BAG);

    let hitCap = false;

    function tUfFind(x) {
      let r = x;
      while (tUfParent[r] !== r) r = tUfParent[r];
      while (tUfParent[x] !== r) {
        const nxt = tUfParent[x];
        tUfParent[x] = r;
        x = nxt;
      }
      return r;
    }

    function tUfUnion(a, b) {
      const ra = tUfFind(a);
      const rb = tUfFind(b);
      if (ra !== rb) {
        tUfParent[ra] = rb;
        tUfHasK[rb] |= tUfHasK[ra];
      }
    }

    function tCount(table) {
      let c = 0;
      for (const b of table.values()) c += b.size;
      return c;
    }

    function* tIter(table) {
      for (const b of table.values()) {
        for (const st of b.values()) yield st;
      }
    }

    function tInsert(table, k, selMask, numComps, hasKMask, done, cost, bpFactory) {
      if (cost >= pruneLimit - 1e-6) return false;
      const partKey = done ? -1 : computePartKey(tCompCodes, k);
      const tailKey = done ? -1 : hasKMask;

      let bucket = table.get(partKey);
      if (bucket) {
        const prev = bucket.get(tailKey);
        if (prev && cost >= prev.cost) return false;
      } else {
        bucket = new Map();
        table.set(partKey, bucket);
      }

      const compCodes = new Uint8Array(k);
      if (!done) {
        for (let i = 0; i < k; i++) compCodes[i] = tCompCodes[i];
      }

      bucket.set(tailKey, {
        cost,
        selMask: done ? 0 : selMask,
        numComps: done ? 0 : numComps,
        hasKMask: done ? 0 : hasKMask,
        done: done ? 1 : 0,
        compCodes,
        bp: bpFactory(),
      });
      return true;
    }

    function tCountOutK(seenSet) {
      let out = 0;
      for (const kv of kSet) {
        if (!seenSet.has(kv)) out++;
      }
      return out;
    }

    function tForget(prevTable, prevBag, sepBag, outKCount, isFinalRoot = false) {
      const kNext = sepBag.length;
      const keepIdx = new Int32Array(kNext);
      const prevIdxMap = new Map();
      for (let i = 0; i < prevBag.length; i++) prevIdxMap.set(prevBag[i], i);
      for (let i = 0; i < kNext; i++) keepIdx[i] = prevIdxMap.get(sepBag[i]);

      const outMap = new Map();

      for (const st of tIter(prevTable)) {
        if (st.cost >= pruneLimit - 1e-6) continue;

        if (st.done === 1) {
          tInsert(outMap, kNext, 0, 0, 0, 1, st.cost, () => st.bp);
          continue;
        }

        const oldNc = st.numComps;
        tRemap.fill(0, 0, oldNc + 1);
        let nextCanon = 1;
        let nextSelMask = 0;
        let nextHasKMask = 0;

        for (let i = 0; i < kNext; i++) {
          const oldC = st.compCodes[keepIdx[i]];
          if (oldC > 0) {
            nextSelMask |= 1 << i;
            let nc = tRemap[oldC];
            if (nc === 0) {
              nc = nextCanon++;
              tRemap[oldC] = nc;
              if ((st.hasKMask & (1 << oldC)) !== 0) {
                nextHasKMask |= 1 << nc;
              }
            }
            tCompCodes[i] = nc;
          } else {
            tCompCodes[i] = 0;
          }
        }

        let droppedK = 0;
        let droppedNonK = 0;
        for (let oldC = 1; oldC <= oldNc; oldC++) {
          if (tRemap[oldC] === 0) {
            if ((st.hasKMask & (1 << oldC)) !== 0) droppedK++;
            else droppedNonK++;
          }
        }

        if (droppedNonK > 0) continue;

        if (droppedK > 0) {
          if (droppedK === 1 && outKCount === 0 && nextHasKMask === 0 && nextSelMask === 0) {
            tInsert(outMap, kNext, 0, 0, 0, 1, st.cost, () => st.bp);
          }
          continue;
        }

        if (isFinalRoot) continue;

        tInsert(outMap, kNext, nextSelMask, nextCanon - 1, nextHasKMask, 0, st.cost, () => st.bp);
      }

      if (tCount(outMap) > treeMaxStates) hitCap = true;
      return outMap;
    }

    function tIntroduce(prevTable, prevBag, v, seenAfterV) {
      const kPrev = prevBag.length;
      const kNext = kPrev + 1;
      const vInK = kSet.has(v);
      const vWeight = mandatorySet.has(v) ? 0 : Math.max(0, Number(weights[v]) || 0);

      const nbrs = adjSets.get(v);
      const nbrIdx = [];
      let hasFutureNbr = false;
      if (nbrs) {
        for (let i = 0; i < kPrev; i++) {
          if (nbrs.has(prevBag[i])) nbrIdx.push(i);
        }
        for (const w of nbrs) {
          if (!seenAfterV.has(w)) {
            hasFutureNbr = true;
            break;
          }
        }
      }
      const numNbrs = nbrIdx.length;
      const isDeadEnd = !vInK && !hasFutureNbr;

      const outMap = new Map();

      for (const st of tIter(prevTable)) {
        if (st.cost >= pruneLimit - 1e-6) continue;

        if (st.done === 1) {
          if (!vInK) {
            tInsert(outMap, kNext, 0, 0, 0, 1, st.cost, () => st.bp);
          }
          continue;
        }

        const oldNc = st.numComps;

        if (!vInK) {
          for (let i = 0; i < kPrev; i++) tCompCodes[i] = st.compCodes[i];
          tCompCodes[kPrev] = 0;
          tInsert(outMap, kNext, st.selMask, oldNc, st.hasKMask, 0, st.cost, () => st.bp);
        }

        const selCost = st.cost + vWeight;
        if (selCost >= pruneLimit - 1e-6) continue;

        tSeenComp.fill(0, 0, oldNc + 1);
        let touched = 0;
        let minC = 0;
        for (let ni = 0; ni < numNbrs; ni++) {
          const c = st.compCodes[nbrIdx[ni]];
          if (c > 0 && tSeenComp[c] === 0) {
            tSeenComp[c] = 1;
            touched++;
            if (minC === 0 || c < minC) minC = c;
          }
        }

        if (isDeadEnd && touched < 2) continue;

        const nextSelMask = st.selMask | (1 << kPrev);
        let newNc = 0;
        let nextHasKMask = 0;

        if (touched === 0) {
          newNc = oldNc + 1;
          for (let i = 0; i < kPrev; i++) tCompCodes[i] = st.compCodes[i];
          tCompCodes[kPrev] = newNc;
          nextHasKMask = st.hasKMask | (vInK ? 1 << newNc : 0);
        } else if (touched === 1) {
          newNc = oldNc;
          for (let i = 0; i < kPrev; i++) tCompCodes[i] = st.compCodes[i];
          tCompCodes[kPrev] = minC;
          nextHasKMask = st.hasKMask | (vInK ? 1 << minC : 0);
        } else {
          let mergedHasK = vInK ? 1 : 0;
          for (let c = 1; c <= oldNc; c++) {
            if (tSeenComp[c] && (st.hasKMask & (1 << c)) !== 0) {
              mergedHasK = 1;
              break;
            }
          }
          tRemap.fill(0, 0, oldNc + 1);
          let nextCanon = 1;
          for (let c = 1; c <= oldNc; c++) {
            if (tSeenComp[c]) {
              if (c === minC) {
                const nc = nextCanon++;
                tRemap[c] = nc;
                if (mergedHasK) nextHasKMask |= 1 << nc;
              } else {
                tRemap[c] = tRemap[minC];
              }
            } else {
              const nc = nextCanon++;
              tRemap[c] = nc;
              if ((st.hasKMask & (1 << c)) !== 0) nextHasKMask |= 1 << nc;
            }
          }
          newNc = nextCanon - 1;
          for (let i = 0; i < kPrev; i++) {
            const oldC = st.compCodes[i];
            tCompCodes[i] = oldC > 0 ? tRemap[oldC] : 0;
          }
          tCompCodes[kPrev] = tRemap[minC];
        }

        tInsert(outMap, kNext, nextSelMask, newNc, nextHasKMask, 0, selCost, () => ({
          v,
          prev: st.bp,
        }));
      }

      if (tCount(outMap) > treeMaxStates) hitCap = true;
      return outMap;
    }

    function tReorder(table, workBag, targetBag) {
      if (bagsIdentical(workBag, targetBag)) return table;
      const k = targetBag.length;
      const idxOf = new Map();
      for (let i = 0; i < workBag.length; i++) idxOf.set(workBag[i], i);
      const perm = new Int32Array(k);
      for (let i = 0; i < k; i++) perm[i] = idxOf.get(targetBag[i]);

      const outMap = new Map();
      for (const st of tIter(table)) {
        if (st.done === 1) {
          tInsert(outMap, k, 0, 0, 0, 1, st.cost, () => st.bp);
          continue;
        }
        tRemap.fill(0, 0, st.numComps + 1);
        let nextCanon = 1;
        let newSelMask = 0;
        let newHasKMask = 0;

        for (let i = 0; i < k; i++) {
          const oldC = st.compCodes[perm[i]];
          if (oldC > 0) {
            newSelMask |= 1 << i;
            let nc = tRemap[oldC];
            if (nc === 0) {
              nc = nextCanon++;
              tRemap[oldC] = nc;
              if ((st.hasKMask & (1 << oldC)) !== 0) newHasKMask |= 1 << nc;
            }
            tCompCodes[i] = nc;
          } else {
            tCompCodes[i] = 0;
          }
        }
        tInsert(outMap, k, newSelMask, nextCanon - 1, newHasKMask, 0, st.cost, () => st.bp);
      }
      return outMap;
    }

    function tStepTransition(currTable, currBag, nextBag, currSeen, outKBox) {
      if (bagsIdentical(currBag, nextBag)) return currTable;
      const currSet = new Set(currBag);
      const nextSet = new Set(nextBag);

      const sepBag = [];
      for (let i = 0; i < currBag.length; i++) {
        if (nextSet.has(currBag[i])) sepBag.push(currBag[i]);
      }
      const introVerts = [];
      for (let i = 0; i < nextBag.length; i++) {
        if (!currSet.has(nextBag[i])) introVerts.push(nextBag[i]);
      }

      let workTable = currTable;
      let workBag = currBag;

      if (sepBag.length < currBag.length) {
        workTable = tForget(workTable, workBag, sepBag, outKBox.count, false);
        workBag = sepBag;
        if (workTable.size === 0 || hitCap) return workTable;
      }

      if (introVerts.length > 1) {
        introVerts.sort((a, b) => {
          const ka = kSet.has(a) ? 0 : 1;
          const kb = kSet.has(b) ? 0 : 1;
          if (ka !== kb) return ka - kb;
          const wa = mandatorySet.has(a) ? 0 : Math.max(0, Number(weights[a]) || 0);
          const wb = mandatorySet.has(b) ? 0 : Math.max(0, Number(weights[b]) || 0);
          return wb - wa;
        });
      }

      for (let i = 0; i < introVerts.length; i++) {
        const v = introVerts[i];
        currSeen.add(v);
        if (kSet.has(v)) outKBox.count--;
        workTable = tIntroduce(workTable, workBag, v, currSeen);
        workBag = [...workBag, v];
        if (workTable.size === 0 || hitCap) return workTable;
      }

      return tReorder(workTable, workBag, nextBag);
    }

    function tJoin(leftTable, rightTable, bag) {
      const k = bag.length;

      const rightBySel = new Map();
      for (const r of tIter(rightTable)) {
        let arr = rightBySel.get(r.selMask);
        if (!arr) {
          arr = [];
          rightBySel.set(r.selMask, arr);
        }
        arr.push(r);
      }

      const leftBySel = new Map();
      for (const l of tIter(leftTable)) {
        if (!rightBySel.has(l.selMask)) continue;
        let arr = leftBySel.get(l.selMask);
        if (!arr) {
          arr = [];
          leftBySel.set(l.selMask, arr);
        }
        arr.push(l);
      }

      const joinedMap = new Map();

      for (const [selMask, lBucket] of leftBySel.entries()) {
        const rBucket = rightBySel.get(selMask);
        if (lBucket.length > 1) lBucket.sort((a, b) => a.cost - b.cost);
        if (rBucket.length > 1) rBucket.sort((a, b) => a.cost - b.cost);

        let overlapCost = 0;
        for (let i = 0; i < k; i++) {
          if (selMask & (1 << i)) {
            const v = bag[i];
            if (!mandatorySet.has(v)) overlapCost += Math.max(0, Number(weights[v]) || 0);
          }
        }

        const minR = rBucket[0].cost;

        for (let li = 0; li < lBucket.length; li++) {
          const lEntry = lBucket[li];
          if (lEntry.cost - overlapCost + minR >= pruneLimit - 1e-6) break;

          for (let ri = 0; ri < rBucket.length; ri++) {
            const rEntry = rBucket[ri];
            const cost = lEntry.cost + rEntry.cost - overlapCost;
            if (cost >= pruneLimit - 1e-6) break;

            if (lEntry.done === 1 || rEntry.done === 1) {
              if (selMask === 0 && lEntry.done !== rEntry.done) {
                const winBp = lEntry.done === 1 ? lEntry.bp : rEntry.bp;
                tInsert(joinedMap, k, 0, 0, 0, 1, cost, () => winBp);
              }
              continue;
            }

            if (lEntry.numComps <= 1 && rEntry.numComps <= 1) {
              const nc = lEntry.numComps;
              for (let i = 0; i < k; i++) tCompCodes[i] = lEntry.compCodes[i];
              const hk = nc === 1 ? (lEntry.hasKMask | rEntry.hasKMask) & 2 : 0;
              tInsert(joinedMap, k, selMask, nc, hk, 0, cost, () => ({
                left: lEntry.bp,
                right: rEntry.bp,
              }));
              continue;
            }

            for (let i = 0; i < k; i++) {
              tUfParent[i] = i;
              tUfHasK[i] = 0;
            }
            tLRep.fill(-1, 0, lEntry.numComps + 1);
            tRRep.fill(-1, 0, rEntry.numComps + 1);

            for (let i = 0; i < k; i++) {
              const lc = lEntry.compCodes[i];
              if (lc > 0) {
                if (tLRep[lc] === -1) {
                  tLRep[lc] = i;
                  const r = tUfFind(i);
                  tUfHasK[r] |= (lEntry.hasKMask >>> lc) & 1;
                } else {
                  tUfUnion(i, tLRep[lc]);
                }
              }
              const rc = rEntry.compCodes[i];
              if (rc > 0) {
                if (tRRep[rc] === -1) {
                  tRRep[rc] = i;
                  const r = tUfFind(i);
                  tUfHasK[r] |= (rEntry.hasKMask >>> rc) & 1;
                } else {
                  tUfUnion(i, tRRep[rc]);
                }
              }
            }

            tRemap.fill(0, 0, k + 1);
            let nextCanon = 1;
            let nextHasKMask = 0;
            for (let i = 0; i < k; i++) {
              if (selMask & (1 << i)) {
                const r = tUfFind(i);
                let c = tRemap[r];
                if (c === 0) {
                  c = nextCanon++;
                  tRemap[r] = c;
                  if (tUfHasK[r]) nextHasKMask |= 1 << c;
                }
                tCompCodes[i] = c;
              } else {
                tCompCodes[i] = 0;
              }
            }

            tInsert(joinedMap, k, selMask, nextCanon - 1, nextHasKMask, 0, cost, () => ({
              left: lEntry.bp,
              right: rEntry.bp,
            }));
          }
        }
      }

      if (tCount(joinedMap) > treeMaxStates) hitCap = true;
      return joinedMap;
    }

    const tBagCache = new Map();

    function tLiftChild(cId, parentId) {
      const pNode = nodes[parentId];
      let currTable = tBagCache.get(cId);
      let currBag = nodes[cId].bag;
      const currSeen = new Set(subtreeVerts[cId]);
      const outKBox = { count: tCountOutK(currSeen) };

      const chainOrigIds = pNode.transitions?.[cId]?.chainOrigIds || [];
      if (chainOrigIds.length > 2 && fullNodes.length > 0) {
        for (let idx = chainOrigIds.length - 2; idx >= 1; idx--) {
          const midBag = fullNodes[chainOrigIds[idx]]?.bag;
          if (!midBag) continue;
          currTable = tStepTransition(currTable, currBag, midBag, currSeen, outKBox);
          currBag = midBag;
          if (currTable.size === 0 || hitCap) return currTable;
        }
      }

      return currTable.size > 0 && !hitCap
        ? tStepTransition(currTable, currBag, pNode.bag, currSeen, outKBox)
        : currTable;
    }

    const emptyTreeInit = new Map([
      [
        0,
        new Map([
          [
            0,
            {
              cost: 0,
              selMask: 0,
              numComps: 0,
              hasKMask: 0,
              done: 0,
              compCodes: new Uint8Array(0),
              bp: null,
            },
          ],
        ]),
      ],
    ]);

    for (let li = 0; li < rootSortedDepths.length && !hitCap; li++) {
      const levelIds = rootNodesByDepth.get(rootSortedDepths[li]) || [];
      for (let bi = 0; bi < levelIds.length && !hitCap; bi++) {
        if (shouldAbort()) return null;
        const uId = levelIds[bi];
        const u = nodes[uId];

        if (!u.children || u.children.length === 0) {
          const currSeen = new Set();
          const outKBox = { count: kSet.size };
          const leafT = tStepTransition(emptyTreeInit, [], u.bag, currSeen, outKBox);
          tBagCache.set(uId, leafT);
        } else {
          let merged = null;
          for (let ci = 0; ci < u.children.length && !hitCap; ci++) {
            const cId = u.children[ci];
            const lifted = tLiftChild(cId, uId);
            tBagCache.delete(cId);
            if (ci === 0) {
              merged = lifted;
            } else {
              merged = tJoin(merged, lifted, u.bag);
            }
          }
          tBagCache.set(uId, merged || new Map());
        }
      }
    }

    const ms = Number((performance.now() - t0).toFixed(1));

    if (!hitCap) {
      const rootTable = tBagCache.get(rootId) || new Map();
      const finalTable = tForget(rootTable, nodes[rootId].bag, [], 0, true);
      let best = null;
      for (const st of tIter(finalTable)) {
        if (st.done === 1 && (!best || st.cost < best.cost)) {
          best = st;
        }
      }

      if (best) {
        const verts = new Set(extractSolutionVertices(best.bp));
        const steinerVerts = new Set();
        let steinerCost = 0;
        for (const v of verts) {
          if (!mandatorySet.has(v)) {
            steinerVerts.add(v);
            steinerCost += Math.max(0, Number(weights[v]) || 0);
          }
        }
        return { vertices: verts, steinerVerts, steinerCost, exact: true, hitCap: false, ms };
      }

      if (greedyBeatsBound || (!strictImprovement && greedy.steinerCost <= steinerUpperBound + 1e-6)) {
        return { ...greedy, exact: true, hitCap: false, ms };
      }
      // Proven that no tree beats steinerUpperBound (and greedy is worse than steinerUpperBound)
      return { vertices: null, steinerVerts: null, steinerCost: Infinity, exact: true, hitCap: false, ms };
    }

    if (strictImprovement && !greedyBeatsBound) {
      return { vertices: null, steinerVerts: null, steinerCost: Infinity, exact: false, hitCap: true, ms };
    }
    return { ...greedy, exact: false, hitCap: true, ms };
  }

  // =========================================================================
  // PARTITION-GUIDED EXACT G = 1 TREE POLISH (Overlap Merge + Merge/Split)
  // =========================================================================
  function runPartitionGuidedTreePolish(seedVertices, timeBudgetMs = 1500) {
    const tStart = performance.now();
    if (numGroups === 0 && !hasFreeTargets) {
      const verts = [...mandatorySet].sort((a, b) => a - b);
      return {
        minCost: globalMandatoryCost,
        selectedVertices: verts,
        isExact: true,
        ms: 0,
        exactTreeSolves: 0,
        mergesAccepted: 0,
        splitsAccepted: 0,
      };
    }

    const seedSet = new Set(seedVertices);
    const vComp = new Map();
    let compCounter = 0;
    for (const v of seedSet) {
      if (vComp.has(v)) continue;
      const q = [v];
      vComp.set(v, compCounter);
      let head = 0;
      while (head < q.length) {
        const cur = q[head++];
        for (const nxt of adjSets.get(cur) || []) {
          if (seedSet.has(nxt) && !vComp.has(nxt)) {
            vComp.set(nxt, compCounter);
            q.push(nxt);
          }
        }
      }
      compCounter++;
    }

    const compToGroups = new Map();

    const polishGroups = disjointGroups.map((g) => [...g]);
    if (hasFreeTargets) {
      for (const ft of freeTargetSet) {
        const c = vComp.get(ft);
        // Find an existing polishGroup in the same seed component, or anchor to a town in that component
        let attached = false;
        if (c !== undefined) {
          for (let g = 0; g < polishGroups.length; g++) {
            if (vComp.get(polishGroups[g][0]) === c) {
              polishGroups[g].push(ft);
              attached = true;
              break;
            }
          }
          if (!attached) {
            for (const tw of anyTownSet) {
              if (vComp.get(tw) === c) {
                polishGroups.push([ft, tw]);
                attached = true;
                break;
              }
            }
          }
        }
        if (!attached) return null;
      }
    }
    const polishNumGroups = polishGroups.length;

    for (let g = 0; g < polishNumGroups; g++) {
      const c = vComp.get(polishGroups[g][0]);
      const key = c !== undefined ? c : `iso_${g}`;
      let list = compToGroups.get(key);
      if (!list) {
        list = [];
        compToGroups.set(key, list);
      }
      list.push(g);
    }

    const partition = [...compToGroups.values()].map((arr) => arr.sort((a, b) => a - b));

    const exactTreeCache = new Map();
    const rejectedBoundCache = new Map();
    let exactTreeSolves = 0;
    let mergesAccepted = 0;
    let splitsAccepted = 0;

    function groupKey(gList) {
      return gList.join(',');
    }

    function collectKVerts(gList) {
      const verts = [];
      for (let i = 0; i < gList.length; i++) {
        const gVerts = polishGroups[gList[i]];
        for (let j = 0; j < gVerts.length; j++) verts.push(gVerts[j]);
      }
      return verts;
    }

    function getTree(gList, upperBound = Infinity, strictImprovement = false) {
      const key = groupKey(gList);
      if (exactTreeCache.has(key)) {
        const cached = exactTreeCache.get(key);
        if (strictImprovement && cached.steinerCost >= upperBound - 1e-6) return null;
        return cached;
      }
      if (strictImprovement) {
        const prevRej = rejectedBoundCache.get(key);
        if (prevRej !== undefined && upperBound <= prevRej + 1e-6) return null;
      }

      exactTreeSolves++;
      const res = solveSingleTreeExact(collectKVerts(gList), upperBound, strictImprovement);
      if (!res) return null;

      if (res.vertices) {
        if (res.exact) exactTreeCache.set(key, res);
        if (strictImprovement && res.steinerCost >= upperBound - 1e-6) return null;
        return res;
      }

      // Only cache rejection bound if DP completed without hitting state cap
      if (strictImprovement && !res.hitCap) {
        const prevRej = rejectedBoundCache.get(key) ?? -Infinity;
        if (upperBound > prevRej) rejectedBoundCache.set(key, upperBound);
      }
      return null;
    }

    function treesShareVertex(tA, tB) {
      const [small, large] =
        tA.vertices.size <= tB.vertices.size
          ? [tA.vertices, tB.vertices]
          : [tB.vertices, tA.vertices];
      for (const v of small) {
        if (large.has(v)) return true;
      }
      return false;
    }

    function unionSteinerCostOf(tA, tB) {
      let cost = tA.steinerCost;
      for (const v of tB.steinerVerts) {
        if (!tA.steinerVerts.has(v)) {
          cost += Math.max(0, Number(weights[v]) || 0);
        }
      }
      return cost;
    }

    function makeUnionTree(tA, tB) {
      const vertices = new Set(tA.vertices);
      for (const v of tB.vertices) vertices.add(v);
      const steinerVerts = new Set(tA.steinerVerts);
      for (const v of tB.steinerVerts) steinerVerts.add(v);
      let steinerCost = 0;
      for (const v of steinerVerts) steinerCost += Math.max(0, Number(weights[v]) || 0);
      return { vertices, steinerVerts, steinerCost, exact: Boolean(tA.exact && tB.exact) };
    }

    function computeGlobalSteinerCost(trees) {
      const seen = new Set();
      let cost = 0;
      for (let i = 0; i < trees.length; i++) {
        if (!trees[i]) continue;
        for (const v of trees[i].steinerVerts) {
          if (!seen.has(v)) {
            seen.add(v);
            cost += Math.max(0, Number(weights[v]) || 0);
          }
        }
      }
      return cost;
    }

    function solveAndMergeOverlaps(part) {
      const curPart = part.map((arr) => [...arr].sort((a, b) => a - b));
      const curTrees = curPart.map((gList) => getTree(gList, Infinity, false));

      let mergedAny = true;
      while (mergedAny && !shouldAbort()) {
        mergedAny = false;
        for (let i = 0; i < curPart.length && !mergedAny; i++) {
          for (let j = i + 1; j < curPart.length && !mergedAny; j++) {
            if (!curTrees[i] || !curTrees[j]) continue;
            if (treesShareVertex(curTrees[i], curTrees[j])) {
              const combined = [...curPart[i], ...curPart[j]].sort((a, b) => a - b);
              const unionTree = makeUnionTree(curTrees[i], curTrees[j]);
              const tBetter = getTree(combined, unionTree.steinerCost, true);

              // Only adopt re-routed tree if global union cost does not worsen (guards 3-way overlaps)
              let chosenTree = unionTree;
              if (tBetter) {
                const beforeGlobal = computeGlobalSteinerCost(curTrees);
                const trialTrees = curTrees.slice();
                trialTrees.splice(j, 1);
                trialTrees[i] = tBetter;
                if (computeGlobalSteinerCost(trialTrees) <= beforeGlobal + 1e-6) {
                  chosenTree = tBetter;
                }
              }

              curPart.splice(j, 1);
              curTrees.splice(j, 1);
              curPart[i] = combined;
              curTrees[i] = chosenTree;
              mergesAccepted++;
              mergedAny = true;
            }
          }
        }
      }
      return { part: curPart, trees: curTrees };
    }

    function computeTreePairDistances(trees) {
      const m = trees.length;
      const dist = new Float64Array(numV);
      const vis = new Uint8Array(numV);
      const pairs = [];

      for (let i = 0; i < m; i++) {
        dist.fill(Infinity);
        vis.fill(0);
        for (const v of trees[i].vertices) {
          const idx = vToDense.get(v);
          if (idx !== undefined) dist[idx] = 0;
        }
        while (true) {
          let u = -1;
          let bestD = Infinity;
          for (let idx = 0; idx < numV; idx++) {
            if (!vis[idx] && dist[idx] < bestD) {
              bestD = dist[idx];
              u = idx;
            }
          }
          if (u === -1) break;
          vis[u] = 1;
          const nbrs = denseAdj[u];
          for (let j = 0; j < nbrs.length; j++) {
            const v = nbrs[j];
            if (vis[v]) continue;
            const alt = bestD + denseTreeW[v];
            if (alt < dist[v]) dist[v] = alt;
          }
        }

        for (let j = i + 1; j < m; j++) {
          let minD = Infinity;
          for (const v of trees[j].vertices) {
            const idx = vToDense.get(v);
            if (idx !== undefined && dist[idx] < minD) minD = dist[idx];
          }
          pairs.push({ i, j, d: minD });
        }
      }

      pairs.sort((a, b) => a.d - b.d);
      return pairs;
    }

    let state = solveAndMergeOverlaps(partition);
    let stateGlobalCost = computeGlobalSteinerCost(state.trees);

    let improved = true;
    while (improved && !shouldAbort() && performance.now() - tStart < timeBudgetMs) {
      improved = false;

      for (let i = 0; i < state.part.length && !improved; i++) {
        if (performance.now() - tStart >= timeBudgetMs || shouldAbort()) break;
        const comp = state.part[i];
        if (comp.length < 2) continue;
        const curCost = state.trees[i].steinerCost;

        for (let gi = 0; gi < comp.length; gi++) {
          if (performance.now() - tStart >= timeBudgetMs || shouldAbort()) break;
          const single = [comp[gi]];
          const rest = comp.filter((_, idx) => idx !== gi);

          const tA = getTree(single, curCost, true);
          if (!tA) continue;
          const remBound = curCost - tA.steinerCost;
          if (remBound <= 1e-6 && tA.steinerCost >= curCost - 1e-6) continue;

          const tB = getTree(rest, curCost, true);
          if (!tB) continue;

          const splitCost = unionSteinerCostOf(tA, tB);
          if (splitCost < curCost - 1e-6) {
            const nextPart = state.part.slice();
            nextPart.splice(i, 1, single, rest);
            const nextState = solveAndMergeOverlaps(nextPart);
            const nextGlobal = computeGlobalSteinerCost(nextState.trees);
            if (nextGlobal < stateGlobalCost - 1e-6) {
              state = nextState;
              stateGlobalCost = nextGlobal;
              splitsAccepted++;
              improved = true;
              break;
            }
          }
        }
      }
      if (improved) continue;

      if (state.part.length >= 2) {
        const candidatePairs = computeTreePairDistances(state.trees);
        const maxPairsToTry = Math.min(candidatePairs.length, 28);

        for (let pi = 0; pi < maxPairsToTry; pi++) {
          if (performance.now() - tStart >= timeBudgetMs || shouldAbort()) break;
          const { i, j } = candidatePairs[pi];
          const combined = [...state.part[i], ...state.part[j]].sort((a, b) => a - b);
          const combinedUb = state.trees[i].steinerCost + state.trees[j].steinerCost;

          const tMerged = getTree(combined, combinedUb, true);
          if (tMerged && tMerged.steinerCost < combinedUb - 1e-6) {
            const nextPart = state.part.slice();
            nextPart.splice(j, 1);
            nextPart[i] = combined;
            const nextState = solveAndMergeOverlaps(nextPart);
            const nextGlobal = computeGlobalSteinerCost(nextState.trees);
            if (nextGlobal < stateGlobalCost - 1e-6) {
              state = nextState;
              stateGlobalCost = nextGlobal;
              mergesAccepted++;
              improved = true;
              break;
            }
          }
        }
      }
    }

    const finalVerts = new Set(mandatorySet);
    for (let i = 0; i < state.trees.length; i++) {
      if (!state.trees[i]) continue;
      for (const v of state.trees[i].vertices) finalVerts.add(v);
    }

    let finalCost = 0;
    for (const v of finalVerts) {
      finalCost += Math.max(0, Number(weights[v]) || 0);
    }

    const sortedVerts = [...finalVerts].sort((a, b) => a - b);
    const isExactSingleGroup =
      !hasFreeTargets && numGroups === 1 && state.trees.length === 1 && Boolean(state.trees[0]?.exact);

    return {
      minCost: finalCost,
      selectedVertices: sortedVerts,
      isExact: isExactSingleGroup,
      partition: state.part,
      ms: Number((performance.now() - tStart).toFixed(1)),
      exactTreeSolves,
      mergesAccepted,
      splitsAccepted,
    };
  }

  const globalStartMs = performance.now();
  const compBitWidth = numGroups + (hasFreeTargets ? 3 : 1);
  const compStride = !hasHi && compBitWidth <= 30 ? Math.pow(2, compBitWidth) : 0;

  // =========================================================================
  // Instant Exact Shortcut when G <= 1 on a full root solve
  // =========================================================================
  const isFullRootSolve = nodes[targetNodeId]?.parent == null;
  if (isFullRootSolve && numGroups <= 1 && !hasFreeTargets) {
    const t0 = performance.now();
    let finalVerts;
    let finalCost;
    let isExact = true;

    if (numGroups === 0) {
      finalVerts = [...mandatorySet].sort((a, b) => a - b);
      finalCost = globalMandatoryCost;
    } else {
      const exactTree = solveSingleTreeExact(disjointGroups[0], Infinity, false, 120000);
      const merged = new Set(mandatorySet);
      if (exactTree) {
        for (const v of exactTree.vertices) merged.add(v);
        isExact = exactTree.exact;
      }
      finalVerts = [...merged].sort((a, b) => a - b);
      finalCost = 0;
      for (const v of finalVerts) finalCost += Math.max(0, Number(weights[v]) || 0);
    }

    const elapsed = Number((performance.now() - t0).toFixed(1));
    const origBagId = nodes[targetNodeId]?.origBagId ?? targetNodeId;
    const label = isExact ? 'EXACT' : 'POLISH';

    return {
      leftChildStats: null,
      rightChildStats: null,
      collapseDebug: null,
      memoryLimitHit: false,
      beamPrunedEvents: 0,
      joinPairCappedEvents: 0,
      boundPrunedStates: 0,
      dualPrunedStates: 0,
      peakBagStates: 0,
      totalStatesGenerated: 0,
      totalJoinPairsChecked: 0,
      maxStatesUsed: requestedMaxStates,
      isExact,
      selectedVertices: finalVerts,
      passElapsedMs: elapsed,
      totalElapsedMs: elapsed,
      bagMergeStats: {
        nodeId: targetNodeId,
        origBagId,
        preForgetStates: 1,
        postForgetStates: 1,
        minCost: finalCost,
        ms: elapsed,
      },
      bottleneckBags: [],
      heuristicAdvice: null,
      heuristicStages: [],
      allSolutions: [
        {
          label,
          minCost: finalCost,
          selectedVertices: finalVerts,
          isExact,
          ms: elapsed,
          bagId: origBagId,
        },
      ],
    };
  }

  // =========================================================================
  // Multi-Group Bottom-Up DP Pass (with Dual Ascent + Residual Split Pruning)
  // =========================================================================
  async function runDpPass(
    maxStates,
    upperBoundCost = Infinity,
    stageLabel = 'EXACT',
    strictImprovement = false
  ) {
    const passStartMs = performance.now();
    const hasBound = Number.isFinite(upperBoundCost);
    const isExactPass = !Number.isFinite(maxStates);
    const useDualBounds = hasBound && isFullRootSolve;
    const pruneCutoff = strictImprovement ? upperBoundCost - 1e-6 : upperBoundCost + 1e-5;

    const MAX_BAG = 32;
    const scratchCompCodes = new Uint8Array(MAX_BAG);
    const scratchCanonGroupsLo = new Int32Array(MAX_BAG);
    const scratchCanonGroupsHi = new Int32Array(MAX_BAG);
    const scratchRemap = new Int32Array(MAX_BAG);
    const scratchSeenComp = new Uint8Array(MAX_BAG);
    const ufParent = new Int32Array(MAX_BAG);
    const ufGroupsLo = new Int32Array(MAX_BAG);
    const ufGroupsHi = new Int32Array(MAX_BAG);
    const ufHasTerm = new Uint8Array(MAX_BAG);
    const ufHasTown = new Uint8Array(MAX_BAG);
    const ufNeedsAny = new Uint8Array(MAX_BAG);
    const lRep = new Int32Array(MAX_BAG);
    const rRep = new Int32Array(MAX_BAG);

    const bagTimings = new Map();
    function recordBagTime(uId, deltaMs, statesCount, kind) {
      const u = nodes[uId];
      const origId = u?.origBagId ?? uId;
      const prev = bagTimings.get(origId);
      if (!prev) {
        bagTimings.set(origId, {
          bagId: origId,
          nodeId: uId,
          bagSize: u?.bag?.length ?? 0,
          ms: deltaMs,
          peakStates: statesCount,
          kind,
        });
      } else {
        prev.ms += deltaMs;
        if (statesCount > prev.peakStates) prev.peakStates = statesCount;
      }
    }

    function ufFind(x) {
      let r = x;
      while (ufParent[r] !== r) r = ufParent[r];
      while (ufParent[x] !== r) {
        const nxt = ufParent[x];
        ufParent[x] = r;
        x = nxt;
      }
      return r;
    }

    function ufUnion(a, b) {
      const ra = ufFind(a);
      const rb = ufFind(b);
      if (ra !== rb) {
        ufParent[ra] = rb;
        ufGroupsLo[rb] |= ufGroupsLo[ra];
        if (hasHi) ufGroupsHi[rb] |= ufGroupsHi[ra];
        ufHasTerm[rb] |= ufHasTerm[ra];
        if (hasFreeTargets) {
          ufHasTown[rb] |= ufHasTown[ra];
          ufNeedsAny[rb] = (ufNeedsAny[rb] | ufNeedsAny[ra]) & ~ufHasTown[rb];
        }
      }
    }

    let beamPrunedEvents = 0;
    let joinPairCappedEvents = 0;
    let boundPrunedStates = 0;
    let dualPrunedStates = 0;
    let totalStatesGenerated = 0;
    let totalJoinPairsChecked = 0;
    let peakBagStates = 0;
    let memoryLimitHit = false;
    let memoryHitBagId = null;

    function computeTailKey(numComps, hasTermMask, hasAnyTownMask = 0, needsAnyTownMask = 0) {
      if (numComps === 0) return 0;
      if (compStride > 0 && numComps * compBitWidth <= 52) {
        let key = 0;
        if (hasFreeTargets) {
          for (let c = 1; c <= numComps; c++) {
            const flags =
              ((hasTermMask >>> c) & 1) |
              (((hasAnyTownMask >>> c) & 1) << 1) |
              (((needsAnyTownMask >>> c) & 1) << 2);
            key = key * compStride + (scratchCanonGroupsLo[c] * 8 + flags);
          }
        } else {
          for (let c = 1; c <= numComps; c++) {
            const termBit = (hasTermMask >>> c) & 1;
            key = key * compStride + (scratchCanonGroupsLo[c] * 2 + termBit);
          }
        }
        return key;
      }
      let s = (hasTermMask >>> 1).toString(36);
      if (hasFreeTargets) {
        s += ':' + (hasAnyTownMask >>> 1).toString(36) + ':' + (needsAnyTownMask >>> 1).toString(36);
      }
      for (let c = 1; c <= numComps; c++) {
        s += '|' + (scratchCanonGroupsLo[c] >>> 0).toString(36);
        if (hasHi) s += '.' + (scratchCanonGroupsHi[c] >>> 0).toString(36);
      }
      return s;
    }

    function tryInsertFromScratch(
      tableMap,
      tableSizeBox,
      k,
      selMask,
      numComps,
      hasTermMask,
      cost,
      totalGroupsLo,
      totalGroupsHi,
      bpFactory,
      hasAnyTownMask = 0,
      needsAnyTownMask = 0
    ) {
      const partKey = computePartKey(scratchCompCodes, k);
      const tailKey = computeTailKey(numComps, hasTermMask, hasAnyTownMask, needsAnyTownMask);

      let bucket = tableMap.get(partKey);
      let isNew = false;
      if (bucket) {
        const prev = bucket.get(tailKey);
        if (prev) {
          if (cost >= prev.cost) return false;
        } else {
          isNew = true;
        }
      } else {
        bucket = new Map();
        tableMap.set(partKey, bucket);
        isNew = true;
      }

      if (isNew && isExactPass && tableSizeBox.count >= exactMemoryLimit) {
        memoryLimitHit = true;
        if (tableSizeBox.count > peakBagStates) peakBagStates = tableSizeBox.count;
        return false;
      }

      const compCodes = new Uint8Array(k);
      for (let i = 0; i < k; i++) compCodes[i] = scratchCompCodes[i];

      const compGroupsLo = new Int32Array(numComps + 1);
      let sumPop = 0;
      for (let c = 1; c <= numComps; c++) {
        const gLo = scratchCanonGroupsLo[c];
        compGroupsLo[c] = gLo;
        sumPop += popcount32(gLo);
      }

      let compGroupsHi = null;
      if (hasHi) {
        compGroupsHi = new Int32Array(numComps + 1);
        for (let c = 1; c <= numComps; c++) {
          const gHi = scratchCanonGroupsHi[c];
          compGroupsHi[c] = gHi;
          sumPop += popcount32(gHi);
        }
      }

      const unionPop = popcount32(totalGroupsLo) + (hasHi ? popcount32(totalGroupsHi) : 0);
      const excessSplits = sumPop - unionPop + (hasFreeTargets ? popcount32(needsAnyTownMask) : 0);

      bucket.set(tailKey, {
        cost,
        selMask,
        numComps,
        hasTermMask,
        hasAnyTownMask,
        needsAnyTownMask,
        compCodes,
        compGroupsLo,
        compGroupsHi,
        totalGroupsLo,
        totalGroupsHi,
        excessSplits,
        bp: bpFactory(),
      });
      if (isNew) tableSizeBox.count++;
      totalStatesGenerated++;
      return true;
    }

    function countStates(tableMap) {
      let total = 0;
      for (const bucket of tableMap.values()) total += bucket.size;
      return total;
    }

    function* iterateStates(tableMap) {
      for (const bucket of tableMap.values()) {
        for (const st of bucket.values()) yield st;
      }
    }

    const bagSnapshotsByNode = {};
    const bagSnapshotsByOrig = {};

    function sampleBagTable(tableMap, bag, kind, maxSamples = 5) {
      const totalStates = countStates(tableMap);
      const partitionCount = tableMap.size;
      const top = [];

      for (const [partKey, bucket] of tableMap.entries()) {
        for (const [tailKey, st] of bucket.entries()) {
          if (top.length < maxSamples || st.cost < top[top.length - 1].cost) {
            top.push({ cost: st.cost, partKey, tailKey, st });
            top.sort((a, b) => a.cost - b.cost);
            if (top.length > maxSamples) top.pop();
          }
        }
      }

      const samples = top.map(({ cost, partKey, tailKey, st }) => {
        const comps = [];
        for (let c = 1; c <= st.numComps; c++) {
          const verts = [];
          for (let i = 0; i < bag.length; i++) {
            if (st.compCodes[i] === c) verts.push(bag[i]);
          }
          const groups = [];
          const gLo = st.compGroupsLo[c];
          if (gLo !== 0) {
            for (let g = 0; g < Math.min(32, numGroups); g++) {
              if ((gLo & (1 << g)) !== 0) groups.push(g);
            }
          }
          if (hasHi && st.compGroupsHi) {
            const gHi = st.compGroupsHi[c];
            if (gHi !== 0) {
              for (let g = 32; g < numGroups; g++) {
                if ((gHi & (1 << (g - 32))) !== 0) groups.push(g);
              }
            }
          }
          comps.push({
            id: c,
            verts,
            groups,
            hasTerm: Boolean((st.hasTermMask >>> c) & 1),
            hasTown: hasFreeTargets && Boolean((st.hasAnyTownMask >>> c) & 1),
            needsTown: hasFreeTargets && Boolean((st.needsAnyTownMask >>> c) & 1),
          });
        }

        return {
          cost,
          compCodes: Array.from(st.compCodes),
          partKey: typeof partKey === 'number' ? `0x${partKey.toString(16)}` : partKey,
          partIsInt: typeof partKey === 'number',
          tailKey: typeof tailKey === 'number' ? String(tailKey) : tailKey,
          tailIsInt: typeof tailKey === 'number',
          comps,
        };
      });

      return {
        stage: stageLabel,
        kind,
        bag: [...bag],
        totalStates,
        partitionCount,
        samples,
      };
    }

    function pruneBucketDominance(bucket) {
      const bSize = bucket.size;
      if (bSize <= 1) return 0;

      const entries = [...bucket.entries()];
      entries.sort((a, b) => a[1].cost - b[1].cost);
      const dominated = new Uint8Array(bSize);

      const outerLimit = bSize <= 512 ? bSize : 128;

      for (let i = 0; i < outerLimit; i++) {
        if (dominated[i]) continue;
        const stA = entries[i][1];
        const nc = stA.numComps;
        const tGrpALo = stA.totalGroupsLo;
        const tGrpAHi = stA.totalGroupsHi;
        const termA = stA.hasTermMask;

        for (let j = i + 1; j < bSize; j++) {
          if (dominated[j]) continue;
          const stB = entries[j][1];

          if ((stB.hasTermMask & ~termA) !== 0) continue;
          if (hasFreeTargets) {
            if ((stB.hasAnyTownMask & ~stA.hasAnyTownMask) !== 0) continue;
            if ((stA.needsAnyTownMask & ~stB.needsAnyTownMask) !== 0) continue;
          }
          if ((tGrpALo & ~stB.totalGroupsLo) !== 0) continue;
          if (hasHi && (tGrpAHi & ~stB.totalGroupsHi) !== 0) continue;

          let aDomB = true;
          for (let c = 1; c <= nc; c++) {
            if ((stA.compGroupsLo[c] & ~stB.compGroupsLo[c]) !== 0) {
              aDomB = false;
              break;
            }
            if (hasHi && (stA.compGroupsHi[c] & ~stB.compGroupsHi[c]) !== 0) {
              aDomB = false;
              break;
            }
          }
          if (aDomB) dominated[j] = 1;
        }
      }

      let removed = 0;
      for (let i = 0; i < bSize; i++) {
        if (dominated[i]) {
          bucket.delete(entries[i][0]);
          removed++;
        }
      }
      return removed;
    }

    function pruneTable(tableMap, applyBeam = true) {
      for (const [partKey, bucket] of tableMap.entries()) {
        pruneBucketDominance(bucket);
        if (bucket.size === 0) tableMap.delete(partKey);
      }

      const total = countStates(tableMap);

      if (isExactPass) {
        if (total > exactMemoryLimit) {
          memoryLimitHit = true;
        }
        return tableMap;
      }

      if (!applyBeam || total <= maxStates) return tableMap;

      beamPrunedEvents++;
      const splitPenalty = Math.max(avgNodeWeight * 1.5, 2);
      const bySel = new Map();

      for (const [partKey, bucket] of tableMap.entries()) {
        for (const [tailKey, st] of bucket.entries()) {
          const item = {
            partKey,
            tailKey,
            st,
            score: st.cost + st.excessSplits * splitPenalty,
            picked: false,
          };
          let list = bySel.get(st.selMask);
          if (!list) {
            list = [];
            bySel.set(st.selMask, list);
          }
          list.push(item);
        }
      }

      const numSels = bySel.size;
      const minPerSel = Math.max(4, Math.floor(maxStates / Math.max(1, numSels * 2)));
      const maxPerSel = Math.max(minPerSel, Math.floor(maxStates / Math.min(4, Math.max(1, numSels))));

      const trimmed = new Map();
      const selCounts = new Map();
      const overflow = [];
      let kept = 0;

      const addItem = (item) => {
        item.picked = true;
        selCounts.set(item.st.selMask, (selCounts.get(item.st.selMask) || 0) + 1);
        let bucket = trimmed.get(item.partKey);
        if (!bucket) {
          bucket = new Map();
          trimmed.set(item.partKey, bucket);
        }
        bucket.set(item.tailKey, item.st);
        kept++;
      };

      for (const list of bySel.values()) {
        list.sort((a, b) => a.score - b.score || a.st.cost - b.st.cost);
        const take = Math.min(minPerSel, list.length);
        for (let i = 0; i < take && kept < maxStates; i++) {
          addItem(list[i]);
        }
        for (let i = take; i < list.length; i++) {
          overflow.push(list[i]);
        }
      }

      if (kept < maxStates && overflow.length > 0) {
        overflow.sort((a, b) => a.score - b.score || a.st.cost - b.st.cost);
        for (let i = 0; i < overflow.length && kept < maxStates; i++) {
          const item = overflow[i];
          if ((selCounts.get(item.st.selMask) || 0) >= maxPerSel) continue;
          addItem(item);
        }
        for (let i = 0; i < overflow.length && kept < maxStates; i++) {
          if (!overflow[i].picked) addItem(overflow[i]);
        }
      }

      return trimmed;
    }

    function forgetVertices(
      prevTable,
      prevBag,
      sepBag,
      currSeen,
      tracker,
      isFinalRoot = false,
      debugStats = null
    ) {
      const kNext = sepBag.length;
      const keepIdx = new Int32Array(kNext);
      const prevIdxMap = new Map();
      for (let i = 0; i < prevBag.length; i++) prevIdxMap.set(prevBag[i], i);
      for (let i = 0; i < kNext; i++) keepIdx[i] = prevIdxMap.get(sepBag[i]);

      const lbCost = tracker.outMandatoryCost;
      const dualCtx =
        useDualBounds && !isFinalRoot && prevTable.size > 0
          ? createOutsideDualContext(currSeen, sepBag, tracker)
          : null;

      const outputMap = new Map();
      const sizeBox = { count: 0 };

      for (const st of iterateStates(prevTable)) {
        if (memoryLimitHit) break;
        if (hasBound && st.cost + lbCost >= pruneCutoff) {
          boundPrunedStates++;
          continue;
        }

        const oldNumComps = st.numComps;
        scratchRemap.fill(0, 0, oldNumComps + 1);
        let nextCanon = 1;
        let nextSelMask = 0;
        let nextHasTermMask = 0;
        let nextHasTownMask = 0;
        let nextNeedsAnyMask = 0;
        let allGroupsLo = 0;
        let allGroupsHi = 0;

        for (let i = 0; i < kNext; i++) {
          const oldC = st.compCodes[keepIdx[i]];
          if (oldC > 0) {
            nextSelMask |= 1 << i;
            let newC = scratchRemap[oldC];
            if (newC === 0) {
              newC = nextCanon++;
              scratchRemap[oldC] = newC;
              const gLo = st.compGroupsLo[oldC];
              scratchCanonGroupsLo[newC] = gLo;
              allGroupsLo |= gLo;
              if (hasHi) {
                const gHi = st.compGroupsHi[oldC];
                scratchCanonGroupsHi[newC] = gHi;
                allGroupsHi |= gHi;
              }
              if ((st.hasTermMask & (1 << oldC)) !== 0) {
                nextHasTermMask |= 1 << newC;
              }
              if (hasFreeTargets) {
                if ((st.hasAnyTownMask & (1 << oldC)) !== 0) nextHasTownMask |= 1 << newC;
                if ((st.needsAnyTownMask & (1 << oldC)) !== 0) nextNeedsAnyMask |= 1 << newC;
              }
            }
            scratchCompCodes[i] = newC;
          } else {
            scratchCompCodes[i] = 0;
          }
        }

        let feasible = true;
        for (let oldC = 1; oldC <= oldNumComps; oldC++) {
          if (scratchRemap[oldC] === 0) {
            if (st.compGroupsLo[oldC] !== 0 || (hasHi && st.compGroupsHi[oldC] !== 0)) {
              if (debugStats) debugStats.orphaned++;
              feasible = false;
              break;
            }
            if (hasFreeTargets && (st.needsAnyTownMask & (1 << oldC)) !== 0) {
              if (debugStats) debugStats.orphaned++;
              feasible = false;
              break;
            }
            if ((st.hasTermMask & (1 << oldC)) === 0) {
              if (debugStats) debugStats.deadComp = (debugStats.deadComp || 0) + 1;
              feasible = false;
              break;
            }
          }
        }
        if (!feasible) continue;

        if (isFinalRoot && (allGroupsLo !== 0 || (hasHi && allGroupsHi !== 0) || (hasFreeTargets && nextNeedsAnyMask !== 0))) {
          if (debugStats) debugStats.rootUnsat++;
          continue;
        }

        if (hasFreeTargets && nextNeedsAnyMask !== 0 && tracker.outAnyTownCount === 0 && nextHasTownMask === 0) {
          continue;
        }

        const nextNumComps = nextCanon - 1;
        if (dualCtx) {
          const dualEntry = dualCtx.getDualForSelMask(nextSelMask);
          if (st.cost + lbCost + dualEntry.dualLB >= pruneCutoff) {
            boundPrunedStates++;
            dualPrunedStates++;
            continue;
          }
          if (nextNumComps >= 2) {
            const extraLB = dualCtx.computeExtraSplitLB(
              nextSelMask,
              dualEntry,
              scratchCompCodes,
              nextNumComps,
              scratchCanonGroupsLo,
              scratchCanonGroupsHi
            );
            if (st.cost + lbCost + dualEntry.dualLB + extraLB >= pruneCutoff) {
              boundPrunedStates++;
              dualPrunedStates++;
              continue;
            }
          }
        }

        if (debugStats) debugStats.survived++;
        tryInsertFromScratch(
          outputMap,
          sizeBox,
          kNext,
          nextSelMask,
          nextNumComps,
          nextHasTermMask,
          st.cost,
          allGroupsLo,
          allGroupsHi,
          () => st.bp,
          nextHasTownMask,
          nextNeedsAnyMask
        );
      }

      return pruneTable(outputMap, true);
    }

    function introduceOneVertex(
      prevTable,
      prevBag,
      v,
      currSeenAfterV,
      trackerAfterV,
      debugStats = null
    ) {
      const vIsAnyTown = hasFreeTargets && anyTownSet.has(v);
      const vIsFreeTarget = hasFreeTargets && freeTargetSet.has(v);
      const kPrev = prevBag.length;
      const kNext = kPrev + 1;
      const nextBag = useDualBounds ? [...prevBag, v] : null;
      const vWeight = Math.max(0, Number(weights[v]) || 0);
      const vMandatory = mandatorySet.has(v);
      const vGroupLo = vertexGroupLo.get(v) || 0;
      const vGroupHi = hasHi ? vertexGroupHi.get(v) || 0 : 0;

      const nbrs = adjSets.get(v);
      const nbrBagIndices = [];
      let vHasFutureNeighbor = false;
      if (nbrs) {
        for (let i = 0; i < kPrev; i++) {
          if (nbrs.has(prevBag[i])) nbrBagIndices.push(i);
        }
        for (const w of nbrs) {
          if (!currSeenAfterV.has(w)) {
            vHasFutureNeighbor = true;
            break;
          }
        }
      }
      const numNbrs = nbrBagIndices.length;
      const isPureSteinerDeadEnd = !vMandatory && !vIsAnyTown && !vHasFutureNeighbor && vWeight >= 0;

      const outGroupLo = trackerAfterV.outGroupLo;
      const outGroupHi = trackerAfterV.outGroupHi;
      const lbCost = trackerAfterV.outMandatoryCost;
      const dualCtx =
        useDualBounds && prevTable.size > 0
          ? createOutsideDualContext(currSeenAfterV, nextBag, trackerAfterV)
          : null;

      const outputMap = new Map();
      const sizeBox = { count: 0 };

      for (const st of iterateStates(prevTable)) {
        if (memoryLimitHit) break;
        const oldNumComps = st.numComps;

        // ----- Branch 0: `v` NOT selected -----
        if (!vMandatory) {
          const branch0TownReachable = !(
            hasFreeTargets &&
            st.needsAnyTownMask !== 0 &&
            trackerAfterV.outAnyTownCount === 0 &&
            st.hasAnyTownMask === 0
          );

          if (branch0TownReachable) {
            let pruned0 = hasBound && st.cost + lbCost >= pruneCutoff;
            if (!pruned0 && dualCtx) {
              const dualEntry0 = dualCtx.getDualForSelMask(st.selMask);
              if (st.cost + lbCost + dualEntry0.dualLB >= pruneCutoff) {
                pruned0 = true;
                dualPrunedStates++;
              } else if (oldNumComps >= 2 && st.excessSplits > 0) {
                for (let i = 0; i < kPrev; i++) scratchCompCodes[i] = st.compCodes[i];
                scratchCompCodes[kPrev] = 0;
                const extra0 = dualCtx.computeExtraSplitLB(
                  st.selMask,
                  dualEntry0,
                  scratchCompCodes,
                  oldNumComps,
                  st.compGroupsLo,
                  st.compGroupsHi
                );
                if (st.cost + lbCost + dualEntry0.dualLB + extra0 >= pruneCutoff) {
                  pruned0 = true;
                  dualPrunedStates++;
                }
              }
            }

            if (pruned0) {
              boundPrunedStates++;
            } else {
              for (let i = 0; i < kPrev; i++) scratchCompCodes[i] = st.compCodes[i];
              scratchCompCodes[kPrev] = 0;
              for (let c = 1; c <= oldNumComps; c++) {
                scratchCanonGroupsLo[c] = st.compGroupsLo[c];
                if (hasHi) scratchCanonGroupsHi[c] = st.compGroupsHi[c];
              }
              if (debugStats) debugStats.survived++;
              tryInsertFromScratch(
                outputMap,
                sizeBox,
                kNext,
                st.selMask,
                oldNumComps,
                st.hasTermMask,
                st.cost,
                st.totalGroupsLo,
                st.totalGroupsHi,
                () => st.bp,
                st.hasAnyTownMask,
                st.needsAnyTownMask
              );
              if (memoryLimitHit) break;
            }
          }
        }

        // ----- Branch 1: `v` SELECTED -----
        const selCost = st.cost + vWeight;
        const nextSelMask = st.selMask | (1 << kPrev);
        if (hasBound && selCost + lbCost >= pruneCutoff) {
          boundPrunedStates++;
          continue;
        }

        let dualEntry1 = null;
        if (dualCtx) {
          dualEntry1 = dualCtx.getDualForSelMask(nextSelMask);
          if (selCost + lbCost + dualEntry1.dualLB >= pruneCutoff) {
            boundPrunedStates++;
            dualPrunedStates++;
            continue;
          }
        }

        scratchSeenComp.fill(0, 0, oldNumComps + 1);
        let touchedCount = 0;
        let minTouchedC = 0;
        for (let ni = 0; ni < numNbrs; ni++) {
          const c = st.compCodes[nbrBagIndices[ni]];
          if (c > 0 && scratchSeenComp[c] === 0) {
            scratchSeenComp[c] = 1;
            touchedCount++;
            if (minTouchedC === 0 || c < minTouchedC) minTouchedC = c;
          }
        }

        if (isPureSteinerDeadEnd && touchedCount < 2) {
          if (debugStats) debugStats.deadComp = (debugStats.deadComp || 0) + 1;
          continue;
        }

        let newNumComps = 0;
        let nextHasTermMask = 0;
        let nextHasTownMask = 0;
        let nextNeedsAnyMask = 0;

        if (touchedCount === 0) {
          newNumComps = oldNumComps + 1;
          for (let i = 0; i < kPrev; i++) scratchCompCodes[i] = st.compCodes[i];
          scratchCompCodes[kPrev] = newNumComps;
          for (let c = 1; c <= oldNumComps; c++) {
            scratchCanonGroupsLo[c] = st.compGroupsLo[c];
            if (hasHi) scratchCanonGroupsHi[c] = st.compGroupsHi[c];
          }
          scratchCanonGroupsLo[newNumComps] = vGroupLo;
          if (hasHi) scratchCanonGroupsHi[newNumComps] = vGroupHi;
          nextHasTermMask = st.hasTermMask | (vMandatory ? 1 << newNumComps : 0);
          if (hasFreeTargets) {
            nextHasTownMask = st.hasAnyTownMask | (vIsAnyTown ? 1 << newNumComps : 0);
            nextNeedsAnyMask =
              st.needsAnyTownMask | (vIsFreeTarget && !vIsAnyTown ? 1 << newNumComps : 0);
          }
        } else if (touchedCount === 1) {
          newNumComps = oldNumComps;
          for (let i = 0; i < kPrev; i++) scratchCompCodes[i] = st.compCodes[i];
          scratchCompCodes[kPrev] = minTouchedC;
          for (let c = 1; c <= oldNumComps; c++) {
            let gLo = st.compGroupsLo[c];
            let gHi = hasHi ? st.compGroupsHi[c] : 0;
            if (c === minTouchedC) {
              gLo |= vGroupLo;
              if (hasHi) gHi |= vGroupHi;
            }
            scratchCanonGroupsLo[c] = gLo;
            if (hasHi) scratchCanonGroupsHi[c] = gHi;
          }
          nextHasTermMask = st.hasTermMask | (vMandatory ? 1 << minTouchedC : 0);
          if (hasFreeTargets) {
            const bit = 1 << minTouchedC;
            const compHasTown = (st.hasAnyTownMask & bit) !== 0 || vIsAnyTown;
            const compNeedsAny = !compHasTown && ((st.needsAnyTownMask & bit) !== 0 || vIsFreeTarget);
            nextHasTownMask = compHasTown ? (st.hasAnyTownMask | bit) : st.hasAnyTownMask;
            nextNeedsAnyMask = compNeedsAny ? (st.needsAnyTownMask | bit) : (st.needsAnyTownMask & ~bit);
          }
        } else {
          let mergedLo = vGroupLo;
          let mergedHi = vGroupHi;
          let mergedHasTerm = vMandatory ? 1 : 0;
          let mergedHasTown = vIsAnyTown ? 1 : 0;
          let mergedNeedsAny = vIsFreeTarget ? 1 : 0;

          for (let c = 1; c <= oldNumComps; c++) {
            if (scratchSeenComp[c]) {
              mergedLo |= st.compGroupsLo[c];
              if (hasHi) mergedHi |= st.compGroupsHi[c];
              if ((st.hasTermMask & (1 << c)) !== 0) mergedHasTerm = 1;
              if (hasFreeTargets) {
                if ((st.hasAnyTownMask & (1 << c)) !== 0) mergedHasTown = 1;
                if ((st.needsAnyTownMask & (1 << c)) !== 0) mergedNeedsAny = 1;
              }
            }
          }
          if (mergedHasTown) mergedNeedsAny = 0;

          scratchRemap.fill(0, 0, oldNumComps + 1);
          let nextCanon = 1;
          for (let c = 1; c <= oldNumComps; c++) {
            if (scratchSeenComp[c]) {
              if (c === minTouchedC) {
                const nc = nextCanon++;
                scratchRemap[c] = nc;
                scratchCanonGroupsLo[nc] = mergedLo;
                if (hasHi) scratchCanonGroupsHi[nc] = mergedHi;
                if (mergedHasTerm) nextHasTermMask |= 1 << nc;
                if (hasFreeTargets) {
                  if (mergedHasTown) nextHasTownMask |= 1 << nc;
                  else if (mergedNeedsAny) nextNeedsAnyMask |= 1 << nc;
                }
              } else {
                scratchRemap[c] = scratchRemap[minTouchedC];
              }
            } else {
              const nc = nextCanon++;
              scratchRemap[c] = nc;
              scratchCanonGroupsLo[nc] = st.compGroupsLo[c];
              if (hasHi) scratchCanonGroupsHi[nc] = st.compGroupsHi[c];
              if ((st.hasTermMask & (1 << c)) !== 0) nextHasTermMask |= 1 << nc;
              if (hasFreeTargets) {
                if ((st.hasAnyTownMask & (1 << c)) !== 0) nextHasTownMask |= 1 << nc;
                if ((st.needsAnyTownMask & (1 << c)) !== 0) nextNeedsAnyMask |= 1 << nc;
              }
            }
          }
          newNumComps = nextCanon - 1;
          for (let i = 0; i < kPrev; i++) {
            const oldC = st.compCodes[i];
            scratchCompCodes[i] = oldC > 0 ? scratchRemap[oldC] : 0;
          }
          scratchCompCodes[kPrev] = scratchRemap[minTouchedC];
        }

        if (
          hasFreeTargets &&
          nextNeedsAnyMask !== 0 &&
          trackerAfterV.outAnyTownCount === 0 &&
          nextHasTownMask === 0
        ) {
          continue;
        }

        let seenOnceLo = 0;
        let seenMultiLo = 0;
        let seenOnceHi = 0;
        let seenMultiHi = 0;
        for (let c = 1; c <= newNumComps; c++) {
          const gLo = scratchCanonGroupsLo[c];
          seenMultiLo |= seenOnceLo & gLo;
          seenOnceLo |= gLo;
          if (hasHi) {
            const gHi = scratchCanonGroupsHi[c];
            seenMultiHi |= seenOnceHi & gHi;
            seenOnceHi |= gHi;
          }
        }

        const activeMaskLo = outGroupLo | seenMultiLo;
        const activeMaskHi = hasHi ? outGroupHi | seenMultiHi : 0;
        let totalGroupsLo = 0;
        let totalGroupsHi = 0;
        for (let c = 1; c <= newNumComps; c++) {
          scratchCanonGroupsLo[c] &= activeMaskLo;
          totalGroupsLo |= scratchCanonGroupsLo[c];
          if (hasHi) {
            scratchCanonGroupsHi[c] &= activeMaskHi;
            totalGroupsHi |= scratchCanonGroupsHi[c];
          }
        }

        if (dualEntry1 && newNumComps >= 2 && (seenMultiLo !== 0 || seenMultiHi !== 0)) {
          const extra1 = dualCtx.computeExtraSplitLB(
            nextSelMask,
            dualEntry1,
            scratchCompCodes,
            newNumComps,
            scratchCanonGroupsLo,
            scratchCanonGroupsHi
          );
          if (selCost + lbCost + dualEntry1.dualLB + extra1 >= pruneCutoff) {
            boundPrunedStates++;
            dualPrunedStates++;
            continue;
          }
        }

        if (debugStats) debugStats.survived++;
        tryInsertFromScratch(
          outputMap,
          sizeBox,
          kNext,
          nextSelMask,
          newNumComps,
          nextHasTermMask,
          selCost,
          totalGroupsLo,
          totalGroupsHi,
          () => ({ v, prev: st.bp }),
          nextHasTownMask,
          nextNeedsAnyMask
        );
      }

      return pruneTable(outputMap, true);
    }

    function reorderBag(tableMap, workBag, targetBag) {
      if (bagsIdentical(workBag, targetBag)) return tableMap;
      const k = targetBag.length;
      const idxOf = new Map();
      for (let i = 0; i < workBag.length; i++) idxOf.set(workBag[i], i);
      const perm = new Int32Array(k);
      for (let i = 0; i < k; i++) perm[i] = idxOf.get(targetBag[i]);

      const outputMap = new Map();
      const sizeBox = { count: 0 };
      for (const st of iterateStates(tableMap)) {
        if (memoryLimitHit) break;
        scratchRemap.fill(0, 0, st.numComps + 1);
        let nextCanon = 1;
        let newSelMask = 0;
        let newHasTermMask = 0;
        let newHasTownMask = 0;
        let newNeedsAnyMask = 0;

        for (let i = 0; i < k; i++) {
          const oldC = st.compCodes[perm[i]];
          if (oldC > 0) {
            newSelMask |= 1 << i;
            let nc = scratchRemap[oldC];
            if (nc === 0) {
              nc = nextCanon++;
              scratchRemap[oldC] = nc;
              scratchCanonGroupsLo[nc] = st.compGroupsLo[oldC];
              if (hasHi) scratchCanonGroupsHi[nc] = st.compGroupsHi[oldC];
              if ((st.hasTermMask & (1 << oldC)) !== 0) newHasTermMask |= 1 << nc;
              if (hasFreeTargets) {
                if ((st.hasAnyTownMask & (1 << oldC)) !== 0) newHasTownMask |= 1 << nc;
                if ((st.needsAnyTownMask & (1 << oldC)) !== 0) newNeedsAnyMask |= 1 << nc;
              }
            }
            scratchCompCodes[i] = nc;
          } else {
            scratchCompCodes[i] = 0;
          }
        }

        tryInsertFromScratch(
          outputMap,
          sizeBox,
          k,
          newSelMask,
          nextCanon - 1,
          newHasTermMask,
          st.cost,
          st.totalGroupsLo,
          st.totalGroupsHi,
          () => st.bp,
          newHasTownMask,
          newNeedsAnyMask
        );
      }

      return outputMap;
    }

    function joinSameBag(leftTable, rightTable, bag, mergedSeen, tracker) {
      const k = bag.length;
      const outGroupLo = tracker.outGroupLo;
      const outGroupHi = tracker.outGroupHi;
      const lbCost = tracker.outMandatoryCost;

      const rightBySel = new Map();
      for (const rEntry of iterateStates(rightTable)) {
        let bucket = rightBySel.get(rEntry.selMask);
        if (!bucket) {
          bucket = [];
          rightBySel.set(rEntry.selMask, bucket);
        }
        bucket.push(rEntry);
      }

      const leftBySel = new Map();
      for (const lEntry of iterateStates(leftTable)) {
        if (!rightBySel.has(lEntry.selMask)) continue;
        let bucket = leftBySel.get(lEntry.selMask);
        if (!bucket) {
          bucket = [];
          leftBySel.set(lEntry.selMask, bucket);
        }
        bucket.push(lEntry);
      }

      const sharedCount = leftBySel.size;
      if (sharedCount === 0) return new Map();

      const dualCtx = useDualBounds
        ? createOutsideDualContext(mergedSeen, bag, tracker)
        : null;

      const joinedMap = new Map();
      const sizeBox = { count: 0 };
      const splitPenalty = Math.max(avgNodeWeight * 1.5, 2);

      const totalBagPairBudget = isExactPass ? Infinity : Math.max(120000, maxStates * 32);
      const maxPairsPerSel = isExactPass
        ? Infinity
        : Math.max(4096, Math.floor(totalBagPairBudget / sharedCount));

      for (const [selMask, leftBucket] of leftBySel.entries()) {
        if (memoryLimitHit) break;
        const rightBucket = rightBySel.get(selMask);

        const dualEntry = dualCtx ? dualCtx.getDualForSelMask(selMask) : null;
        const selDualLB = dualEntry ? dualEntry.dualLB : 0;
        if (dualEntry && !Number.isFinite(selDualLB)) {
          boundPrunedStates += leftBucket.length * rightBucket.length;
          dualPrunedStates += leftBucket.length * rightBucket.length;
          continue;
        }

        let effectiveLeft = leftBucket;
        let effectiveRight = rightBucket;

        if (effectiveLeft.length * effectiveRight.length > maxPairsPerSel) {
          joinPairCappedEvents++;
          const cap = Math.max(48, Math.floor(Math.sqrt(maxPairsPerSel)));
          if (effectiveLeft.length > cap) {
            effectiveLeft = [...effectiveLeft]
              .sort(
                (a, b) =>
                  a.cost + a.excessSplits * splitPenalty - (b.cost + b.excessSplits * splitPenalty)
              )
              .slice(0, cap);
          }
          if (effectiveRight.length > cap) {
            effectiveRight = [...effectiveRight]
              .sort(
                (a, b) =>
                  a.cost + a.excessSplits * splitPenalty - (b.cost + b.excessSplits * splitPenalty)
              )
              .slice(0, cap);
          }
        }

        if (effectiveLeft.length > 1) effectiveLeft.sort((a, b) => a.cost - b.cost);
        if (effectiveRight.length > 1) effectiveRight.sort((a, b) => a.cost - b.cost);

        let overlapCost = 0;
        for (let i = 0; i < k; i++) {
          if (selMask & (1 << i)) overlapCost += Math.max(0, Number(weights[bag[i]]) || 0);
        }

        const minRightCost = effectiveRight[0].cost;
        const selBaseLB = lbCost + selDualLB;

        const selTouchedPartKeys = new Set();

        for (let li = 0; li < effectiveLeft.length && !memoryLimitHit; li++) {
          const lEntry = effectiveLeft[li];
          const baseLeftCost = lEntry.cost - overlapCost + selBaseLB;

          if (hasBound && baseLeftCost + minRightCost >= pruneCutoff) {
            const skipped = (effectiveLeft.length - li) * effectiveRight.length;
            boundPrunedStates += skipped;
            if (selDualLB > 0) dualPrunedStates += skipped;
            break;
          }

          for (let ri = 0; ri < effectiveRight.length && !memoryLimitHit; ri++) {
            const rEntry = effectiveRight[ri];
            if (hasBound && baseLeftCost + rEntry.cost >= pruneCutoff) {
              const skipped = effectiveRight.length - ri;
              boundPrunedStates += skipped;
              if (selDualLB > 0) dualPrunedStates += skipped;
              break;
            }

            totalJoinPairsChecked++;
            const cost = lEntry.cost + rEntry.cost - overlapCost;

            if (lEntry.numComps <= 1 && rEntry.numComps <= 1) {
              const numComps = lEntry.numComps;
              for (let i = 0; i < k; i++) scratchCompCodes[i] = lEntry.compCodes[i];
              let nextHasTermMask = 0;
              let nextHasTownMask = 0;
              let nextNeedsAnyMask = 0;
              let totalGroupsLo = 0;
              let totalGroupsHi = 0;
              if (numComps === 1) {
                const gLo = (lEntry.compGroupsLo[1] | rEntry.compGroupsLo[1]) & outGroupLo;
                scratchCanonGroupsLo[1] = gLo;
                totalGroupsLo = gLo;
                if (hasHi) {
                  const gHi = (lEntry.compGroupsHi[1] | rEntry.compGroupsHi[1]) & outGroupHi;
                  scratchCanonGroupsHi[1] = gHi;
                  totalGroupsHi = gHi;
                }
                nextHasTermMask = (lEntry.hasTermMask | rEntry.hasTermMask) & 2;
                if (hasFreeTargets) {
                  nextHasTownMask = (lEntry.hasAnyTownMask | rEntry.hasAnyTownMask) & 2;
                  nextNeedsAnyMask = nextHasTownMask
                    ? 0
                    : (lEntry.needsAnyTownMask | rEntry.needsAnyTownMask) & 2;
                }
              }

              if (
                hasFreeTargets &&
                nextNeedsAnyMask !== 0 &&
                tracker.outAnyTownCount === 0 &&
                nextHasTownMask === 0
              ) {
                continue;
              }

              if (
                tryInsertFromScratch(
                  joinedMap,
                  sizeBox,
                  k,
                  selMask,
                  numComps,
                  nextHasTermMask,
                  cost,
                  totalGroupsLo,
                  totalGroupsHi,
                  () => ({ left: lEntry.bp, right: rEntry.bp }),
                  nextHasTownMask,
                  nextNeedsAnyMask
                )
              ) {
                selTouchedPartKeys.add(computePartKey(scratchCompCodes, k));
              }
              continue;
            }

            for (let i = 0; i < k; i++) {
              ufParent[i] = i;
              ufGroupsLo[i] = 0;
              if (hasHi) ufGroupsHi[i] = 0;
              ufHasTerm[i] = 0;
              if (hasFreeTargets) {
                ufHasTown[i] = 0;
                ufNeedsAny[i] = 0;
              }
            }

            lRep.fill(-1, 0, lEntry.numComps + 1);
            rRep.fill(-1, 0, rEntry.numComps + 1);

            for (let i = 0; i < k; i++) {
              const lc = lEntry.compCodes[i];
              if (lc > 0) {
                if (lRep[lc] === -1) {
                  lRep[lc] = i;
                  const r = ufFind(i);
                  ufGroupsLo[r] |= lEntry.compGroupsLo[lc];
                  if (hasHi) ufGroupsHi[r] |= lEntry.compGroupsHi[lc];
                  ufHasTerm[r] |= (lEntry.hasTermMask >>> lc) & 1;
                  if (hasFreeTargets) {
                    ufHasTown[r] |= (lEntry.hasAnyTownMask >>> lc) & 1;
                    ufNeedsAny[r] =
                      (ufNeedsAny[r] | ((lEntry.needsAnyTownMask >>> lc) & 1)) & ~ufHasTown[r];
                  }
                } else {
                  ufUnion(i, lRep[lc]);
                }
              }

              const rc = rEntry.compCodes[i];
              if (rc > 0) {
                if (rRep[rc] === -1) {
                  rRep[rc] = i;
                  const r = ufFind(i);
                  ufGroupsLo[r] |= rEntry.compGroupsLo[rc];
                  if (hasHi) ufGroupsHi[r] |= rEntry.compGroupsHi[rc];
                  ufHasTerm[r] |= (rEntry.hasTermMask >>> rc) & 1;
                  if (hasFreeTargets) {
                    ufHasTown[r] |= (rEntry.hasAnyTownMask >>> rc) & 1;
                    ufNeedsAny[r] =
                      (ufNeedsAny[r] | ((rEntry.needsAnyTownMask >>> rc) & 1)) & ~ufHasTown[r];
                  }
                } else {
                  ufUnion(i, rRep[rc]);
                }
              }
            }

            scratchRemap.fill(0, 0, k + 1);
            let nextCanon = 1;
            let nextHasTermMask = 0;
            let nextHasTownMask = 0;
            let nextNeedsAnyMask = 0;
            let seenOnceLo = 0;
            let seenMultiLo = 0;
            let seenOnceHi = 0;
            let seenMultiHi = 0;

            for (let i = 0; i < k; i++) {
              if (selMask & (1 << i)) {
                const r = ufFind(i);
                let c = scratchRemap[r];
                if (c === 0) {
                  c = nextCanon++;
                  scratchRemap[r] = c;
                  const gLo = ufGroupsLo[r];
                  scratchCanonGroupsLo[c] = gLo;
                  seenMultiLo |= seenOnceLo & gLo;
                  seenOnceLo |= gLo;
                  if (hasHi) {
                    const gHi = ufGroupsHi[r];
                    scratchCanonGroupsHi[c] = gHi;
                    seenMultiHi |= seenOnceHi & gHi;
                    seenOnceHi |= gHi;
                  }
                  if (ufHasTerm[r]) nextHasTermMask |= 1 << c;
                  if (hasFreeTargets) {
                    if (ufHasTown[r]) nextHasTownMask |= 1 << c;
                    else if (ufNeedsAny[r]) nextNeedsAnyMask |= 1 << c;
                  }
                }
                scratchCompCodes[i] = c;
              } else {
                scratchCompCodes[i] = 0;
              }
            }

            if (
              hasFreeTargets &&
              nextNeedsAnyMask !== 0 &&
              tracker.outAnyTownCount === 0 &&
              nextHasTownMask === 0
            ) {
              continue;
            }

            const numComps = nextCanon - 1;
            const activeMaskLo = outGroupLo | seenMultiLo;
            const activeMaskHi = hasHi ? outGroupHi | seenMultiHi : 0;
            let totalGroupsLo = 0;
            let totalGroupsHi = 0;
            for (let c = 1; c <= numComps; c++) {
              scratchCanonGroupsLo[c] &= activeMaskLo;
              totalGroupsLo |= scratchCanonGroupsLo[c];
              if (hasHi) {
                scratchCanonGroupsHi[c] &= activeMaskHi;
                totalGroupsHi |= scratchCanonGroupsHi[c];
              }
            }

            if (dualEntry && numComps >= 2 && (seenMultiLo !== 0 || seenMultiHi !== 0)) {
              const extraLB = dualCtx.computeExtraSplitLB(
                selMask,
                dualEntry,
                scratchCompCodes,
                numComps,
                scratchCanonGroupsLo,
                scratchCanonGroupsHi
              );
              if (cost + selBaseLB + extraLB >= pruneCutoff) {
                boundPrunedStates++;
                dualPrunedStates++;
                continue;
              }
            }

            if (
              tryInsertFromScratch(
                joinedMap,
                sizeBox,
                k,
                selMask,
                numComps,
                nextHasTermMask,
                cost,
                totalGroupsLo,
                totalGroupsHi,
                () => ({ left: lEntry.bp, right: rEntry.bp }),
                nextHasTownMask,
                nextNeedsAnyMask
              )
            ) {
              selTouchedPartKeys.add(computePartKey(scratchCompCodes, k));
            }
          }
        }

        // Immediate per-selMask dominance cleanup keeps exact memory footprint tight
        for (const pk of selTouchedPartKeys) {
          const b = joinedMap.get(pk);
          if (!b) continue;
          const removed = pruneBucketDominance(b);
          sizeBox.count -= removed;
          if (b.size === 0) joinedMap.delete(pk);
        }
      }

      return pruneTable(joinedMap, true);
    }

    function stepBagTransition(currTable, currBag, nextBag, currSeen, tracker, debugStats = null) {
      if (bagsIdentical(currBag, nextBag)) return currTable;

      const currSet = new Set(currBag);
      const nextSet = new Set(nextBag);

      const sepBag = [];
      for (let i = 0; i < currBag.length; i++) {
        if (nextSet.has(currBag[i])) sepBag.push(currBag[i]);
      }

      const introVerts = [];
      for (let i = 0; i < nextBag.length; i++) {
        if (!currSet.has(nextBag[i])) introVerts.push(nextBag[i]);
      }

      let workTable = currTable;
      let workBag = currBag;

      if (sepBag.length < currBag.length) {
        workTable = forgetVertices(workTable, workBag, sepBag, currSeen, tracker, false, debugStats);
        workBag = sepBag;
        if (workTable.size === 0 || memoryLimitHit) return workTable;
      }

      if (introVerts.length > 1) {
        introVerts.sort((a, b) => {
          const ma = mandatorySet.has(a) ? 0 : 1;
          const mb = mandatorySet.has(b) ? 0 : 1;
          if (ma !== mb) return ma - mb;
          return (Number(weights[b]) || 0) - (Number(weights[a]) || 0);
        });
      }

      for (let i = 0; i < introVerts.length; i++) {
        const v = introVerts[i];
        currSeen.add(v);
        advanceOutsideTracker(tracker, v);
        workTable = introduceOneVertex(workTable, workBag, v, currSeen, tracker, debugStats);
        workBag = [...workBag, v];
        if (workTable.size === 0 || memoryLimitHit) return workTable;
      }

      return reorderBag(workTable, workBag, nextBag);
    }

    let firstSubtreeCollapse = null;
    const fullBagCache = new Map();
    const childStateCounts = new Map();
    const liftedEdgeCache = new Map();
    const liftedSeenCache = new Map();

    function liftChildToParent(cId, parentId, hopTrace = null) {
      const cacheKey = `${cId}->${parentId}`;
      if (!hopTrace && liftedEdgeCache.has(cacheKey)) {
        return liftedEdgeCache.get(cacheKey);
      }

      const pNode = nodes[parentId];
      const rawChildTable = fullBagCache.get(cId);
      const tLift0 = performance.now();

      const currSeen = new Set(subtreeVerts[cId]);
      const tracker = buildOutsideTracker(currSeen);

      let currTable = rawChildTable;
      let currBag = nodes[cId].bag;
      const trans = pNode.transitions?.[cId];
      const chainOrigIds = trans?.chainOrigIds || [];

      if (chainOrigIds.length > 2 && fullNodes.length > 0) {
        for (let idx = chainOrigIds.length - 2; idx >= 1; idx--) {
          const midOrigId = chainOrigIds[idx];
          const midBag = fullNodes[midOrigId]?.bag;
          if (!midBag) continue;

          const st = hopTrace
            ? {
                step: `${nodes[cId].origBagId} -> mid#${midOrigId}`,
                fromBag: [...currBag],
                toBag: [...midBag],
                inStates: countStates(currTable),
                deadComp: 0,
                orphaned: 0,
                rootUnsat: 0,
                survived: 0,
              }
            : null;

          currTable = stepBagTransition(currTable, currBag, midBag, currSeen, tracker, st);
          if (memoryLimitHit && memoryHitBagId == null) memoryHitBagId = midOrigId;
          if (st) {
            st.outStates = countStates(currTable);
            hopTrace.push(st);
          }
          currBag = midBag;
          if (!hopTrace) {
            bagSnapshotsByOrig[midOrigId] = sampleBagTable(currTable, midBag, 'CHAIN', 5);
          }
          if (currTable.size === 0 || memoryLimitHit) break;
        }
      }

      const finalStats = hopTrace
        ? {
            step: `-> parent#${pNode.origBagId}`,
            fromBag: [...currBag],
            toBag: [...pNode.bag],
            inStates: countStates(currTable),
            deadComp: 0,
            orphaned: 0,
            rootUnsat: 0,
            survived: 0,
          }
        : null;

      const lifted =
        currTable.size > 0 && !memoryLimitHit
          ? stepBagTransition(currTable, currBag, pNode.bag, currSeen, tracker, finalStats)
          : currTable;

      if (memoryLimitHit && memoryHitBagId == null) memoryHitBagId = pNode.origBagId ?? parentId;

      if (finalStats) {
        finalStats.outStates = countStates(lifted);
        hopTrace.push(finalStats);
      }

      const liftedCount = countStates(lifted);
      if (liftedCount > peakBagStates) peakBagStates = liftedCount;

      recordBagTime(
        cId,
        performance.now() - tLift0,
        Math.max(countStates(rawChildTable), liftedCount),
        'LIFT'
      );

      if (!hopTrace) {
        liftedEdgeCache.set(cacheKey, lifted);
        liftedSeenCache.set(cacheKey, currSeen);
      }
      return lifted;
    }

    function solveNodeSync(uId) {
      if (fullBagCache.has(uId)) return fullBagCache.get(uId);

      const u = nodes[uId];
      const emptyInit = new Map([
        [
          0,
          new Map([
            [
              0,
              {
                cost: 0,
                selMask: 0,
                numComps: 0,
                hasTermMask: 0,
                compCodes: new Uint8Array(0),
                compGroupsLo: new Int32Array(1),
                compGroupsHi: hasHi ? new Int32Array(1) : null,
                totalGroupsLo: 0,
                totalGroupsHi: 0,
                excessSplits: 0,
                bp: null,
                hasAnyTownMask: 0,
                needsAnyTownMask: 0
              },
            ],
          ]),
        ],
      ]);

      if (!u.children || u.children.length === 0) {
        const tLeaf0 = performance.now();
        const currSeen = new Set();
        const tracker = buildOutsideTracker(currSeen);
        const leafTable = stepBagTransition(emptyInit, [], u.bag, currSeen, tracker, null);
        if (memoryLimitHit && memoryHitBagId == null) memoryHitBagId = u.origBagId ?? uId;
        const leafCount = countStates(leafTable);
        if (leafCount > peakBagStates) peakBagStates = leafCount;
        recordBagTime(uId, performance.now() - tLeaf0, leafCount, 'LEAF');
        fullBagCache.set(uId, leafTable);
        childStateCounts.set(uId, leafCount);

        const leafSnap = sampleBagTable(leafTable, u.bag, 'LEAF', 5);
        bagSnapshotsByNode[uId] = leafSnap;
        bagSnapshotsByOrig[u.origBagId ?? uId] = leafSnap;

        return leafTable;
      }

      let anyChildEmpty = false;
      const childBagTables = u.children.map((cId) => {
        const rawChildTable = fullBagCache.get(cId) ?? solveNodeSync(cId);
        const rawCount = countStates(rawChildTable);
        childStateCounts.set(cId, rawCount);
        if (rawCount === 0) anyChildEmpty = true;

        const lifted = memoryLimitHit ? new Map() : liftChildToParent(cId, uId, null);
        const liftedCount = countStates(lifted);

        if (
          !strictImprovement &&
          !memoryLimitHit &&
          !firstSubtreeCollapse &&
          rawCount > 0 &&
          liftedCount === 0
        ) {
          const debugTrace = [];
          liftChildToParent(cId, uId, debugTrace);
          firstSubtreeCollapse = {
            where: 'CHILD_LIFT',
            childBagId: nodes[cId].origBagId,
            parentBagId: u.origBagId,
            childBag: [...nodes[cId].bag],
            parentBag: [...u.bag],
            liftTrace: debugTrace,
          };
        }

        if (cId !== targetNodeId) {
          fullBagCache.delete(cId);
        }

        return lifted;
      });

      const tJoin0 = performance.now();
      let merged = childBagTables[0];
      const mergedSeen = new Set(liftedSeenCache.get(`${u.children[0]}->${uId}`) || u.bag);

      for (let i = 1; i < childBagTables.length && !memoryLimitHit; i++) {
        const cSeen = liftedSeenCache.get(`${u.children[i]}->${uId}`);
        if (cSeen) {
          for (const v of cSeen) mergedSeen.add(v);
        }
        const tracker = buildOutsideTracker(mergedSeen);
        merged = joinSameBag(merged, childBagTables[i], u.bag, mergedSeen, tracker);
        if (memoryLimitHit && memoryHitBagId == null) memoryHitBagId = u.origBagId ?? uId;
      }

      const mergedCount = countStates(merged);
      if (mergedCount > peakBagStates) peakBagStates = mergedCount;
      recordBagTime(uId, performance.now() - tJoin0, mergedCount, 'JOIN');

      if (
        !strictImprovement &&
        !memoryLimitHit &&
        !firstSubtreeCollapse &&
        !anyChildEmpty &&
        childBagTables.every((t) => countStates(t) > 0) &&
        mergedCount === 0
      ) {
        const lSels = new Set();
        for (const st of iterateStates(childBagTables[0])) lSels.add(st.selMask);
        const rSels = new Set();
        for (const st of iterateStates(childBagTables[1])) rSels.add(st.selMask);
        const sharedSels = [...lSels].filter((s) => rSels.has(s));

        firstSubtreeCollapse = {
          where: 'JOIN_MERGE',
          bagId: u.origBagId,
          bag: [...u.bag],
          leftStates: countStates(childBagTables[0]),
          rightStates: countStates(childBagTables[1]),
          leftDistinctSelMasks: lSels.size,
          rightDistinctSelMasks: rSels.size,
          sharedSelMasksCount: sharedSels.length,
        };
      }

      for (const cId of u.children) {
        const key = `${cId}->${uId}`;
        liftedEdgeCache.delete(key);
        liftedSeenCache.delete(key);
      }

      fullBagCache.set(uId, merged);
      childStateCounts.set(uId, mergedCount);

      const joinSnap = sampleBagTable(merged, u.bag, 'JOIN', 5);
      bagSnapshotsByNode[uId] = joinSnap;
      bagSnapshotsByOrig[u.origBagId ?? uId] = joinSnap;

      return merged;
    }

    let bagsProcessed = 0;
    const totalBags = targetSubtreeIds.length;
    let lastReportMs = performance.now();

    for (let li = 0; li < sortedDepths.length && !memoryLimitHit; li++) {
      const depth = sortedDepths[li];
      const levelIds = nodesByDepth.get(depth) || [];

      for (let bi = 0; bi < levelIds.length && !memoryLimitHit; bi++) {
        if (shouldAbort()) return null;
        const uId = levelIds[bi];
        solveNodeSync(uId);
        bagsProcessed++;

        const now = performance.now();
        if (onProgress && (now - lastReportMs >= 60 || bagsProcessed === totalBags)) {
          onProgress({
            stage: stageLabel,
            depth,
            minDepth,
            maxDepth,
            levelIndex: li + 1,
            totalLevels: sortedDepths.length,
            bagsProcessed,
            totalBags,
            currentBagId: nodes[uId]?.origBagId ?? uId,
            currentBagStates: childStateCounts.get(uId) ?? 0,
            peakBagStates,
            totalStatesGenerated,
            totalJoinPairsChecked,
            boundPrunedStates,
            dualPrunedStates,
            upperBoundCost: Number.isFinite(upperBoundCost) ? upperBoundCost : null,
            elapsedMs: Number((now - globalStartMs).toFixed(0)),
          });
          lastReportMs = now;
        }
      }
    }

    const targetNode = nodes[targetNodeId];
    if (!targetNode) return null;

    let leftChildStats = null;
    let rightChildStats = null;

    if (targetNode.children?.length >= 1) {
      const lId = targetNode.children[0];
      leftChildStats = {
        nodeId: lId,
        origBagId: nodes[lId]?.origBagId ?? lId,
        states: childStateCounts.get(lId) ?? 0,
        ms: Number((bagTimings.get(nodes[lId]?.origBagId ?? lId)?.ms ?? 0).toFixed(1)),
      };
    }

    if (targetNode.children?.length >= 2) {
      const rId = targetNode.children[1];
      rightChildStats = {
        nodeId: rId,
        origBagId: nodes[rId]?.origBagId ?? rId,
        states: childStateCounts.get(rId) ?? 0,
        ms: Number((bagTimings.get(nodes[rId]?.origBagId ?? rId)?.ms ?? 0).toFixed(1)),
      };
    }

    const fullBagTable = fullBagCache.get(targetNodeId) || new Map();
    const hopTrace = [];
    let postTable = new Map();

    if (!memoryLimitHit && fullBagTable.size > 0) {
      if (targetNode.parent != null) {
        postTable = liftChildToParent(targetNodeId, targetNode.parent, hopTrace);
      } else {
        const rootTracker = buildOutsideTracker(subtreeVerts[targetNodeId]);
        postTable = forgetVertices(
          fullBagTable,
          targetNode.bag,
          [],
          subtreeVerts[targetNodeId],
          rootTracker,
          true,
          null
        );
      }
    }

    const preCount = countStates(fullBagTable);
    const postCount = countStates(postTable);

    const sourceTable = targetNode.parent == null && postCount > 0 ? postTable : fullBagTable;
    let bestEntry = null;
    for (const entry of iterateStates(sourceTable)) {
      if (!bestEntry || entry.cost < bestEntry.cost) {
        bestEntry = entry;
      }
    }

    const selectedVertices = bestEntry ? extractSolutionVertices(bestEntry.bp) : [];

    let collapseDebug = null;
    if (memoryLimitHit) {
      collapseDebug = {
        where: 'EXACT_MEMORY_GUARD',
        bagId: memoryHitBagId ?? targetNode.origBagId ?? targetNodeId,
        peakBagStates,
        exactMemoryLimit,
        dualPrunedStates,
        boundPrunedStates,
        note: 'Exact DP exceeded memory safety limit; returning best heuristic/polished bound found.',
      };
    } else if (!strictImprovement && preCount > 0 && postCount === 0) {
      const pNode = targetNode.parent != null ? nodes[targetNode.parent] : null;
      const trans = pNode ? pNode.transitions?.[targetNodeId] : null;

      collapseDebug = {
        where: 'POST_LIFT',
        bagId: targetNode.origBagId ?? targetNodeId,
        bag: [...targetNode.bag],
        parentBagId: pNode ? (pNode.origBagId ?? targetNode.parent) : null,
        parentBag: pNode ? [...pNode.bag] : [],
        chainBags: (trans?.chainOrigIds || []).map((id) => ({
          id,
          bag: fullNodes[id]?.bag || [],
        })),
        forget: trans?.forget ? [...trans.forget] : [],
        introduce: trans?.introduce ? [...trans.introduce] : [],
        hopTrace,
      };
    }

    collapseDebug = collapseDebug || firstSubtreeCollapse;
    const bottleneckBags = [...bagTimings.values()]
      .map((b) => ({ ...b, ms: Number(b.ms.toFixed(1)) }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5);

    const provablyExact =
      !memoryLimitHit &&
      (isExactPass || (beamPrunedEvents === 0 && joinPairCappedEvents === 0));

    return {
      leftChildStats,
      rightChildStats,
      collapseDebug,
      memoryLimitHit,
      beamPrunedEvents,
      joinPairCappedEvents,
      boundPrunedStates,
      dualPrunedStates,
      peakBagStates,
      totalStatesGenerated,
      totalJoinPairsChecked,
      maxStatesUsed: maxStates,
      isExact: provablyExact,
      selectedVertices,
      passElapsedMs: Number((performance.now() - passStartMs).toFixed(1)),
      bagMergeStats: {
        nodeId: targetNodeId,
        origBagId: targetNode.origBagId ?? targetNodeId,
        preForgetStates: preCount,
        postForgetStates: postCount,
        minCost: bestEntry ? bestEntry.cost : null,
        ms: Number((performance.now() - passStartMs).toFixed(1)),
      },
      bottleneckBags,
      bagSnapshots: {
        stage: stageLabel,
        byNode: bagSnapshotsByNode,
        byOrig: bagSnapshotsByOrig,
      },
    };
  }

  // =========================================================================
  // CASCADING SCHEDULE:
  // GREEDY -> HEUR 1K -> POLISH (Exact G=1 Trees) -> HEUR 4K -> HEUR 16K -> FINAL
  // =========================================================================
  const heuristicStages = [];
  let upperBoundCost = Infinity;
  let bestHeuristicSolution = null;
  let earlyExactResult = null;
  let ranPolish = false;
  let lastLadderSnapshots = null;

  const targetOrigBagId = nodes[targetNodeId]?.origBagId ?? targetNodeId;

  function maybeRunTreePolish() {
    if (ranPolish || !bestHeuristicSolution?.selectedVertices?.length || shouldAbort()) return;
    ranPolish = true;

    if (onProgress) {
      onProgress({
        stage: 'POLISH',
        depth: 0,
        minDepth,
        maxDepth,
        levelIndex: 1,
        totalLevels: 1,
        bagsProcessed: 0,
        totalBags: 1,
        currentBagId: targetOrigBagId,
        currentBagStates: 0,
        peakBagStates: 0,
        totalStatesGenerated: 0,
        totalJoinPairsChecked: 0,
        boundPrunedStates: 0,
        dualPrunedStates: 0,
        upperBoundCost: Number.isFinite(upperBoundCost) ? upperBoundCost : null,
        elapsedMs: Number((performance.now() - globalStartMs).toFixed(0)),
      });
    }

    const polished = runPartitionGuidedTreePolish(bestHeuristicSolution.selectedVertices, 1500);
    if (!polished || !polished.selectedVertices?.length) return;
    
    const improvedBound = polished.minCost < upperBoundCost;
    const stageCost = improvedBound ? polished.minCost : upperBoundCost;
    const stageVerts = improvedBound
      ? polished.selectedVertices
      : bestHeuristicSolution.selectedVertices;

    heuristicStages.push({
      label: 'POLISH',
      cap: 0,
      cost: stageCost,
      ms: polished.ms,
      peakBagStates: 0,
      selectedVertices: stageVerts,
      meta: {
        groups: polished.partition?.length ?? 0,
        solves: polished.exactTreeSolves,
        merges: polished.mergesAccepted,
        splits: polished.splitsAccepted,
      },
    });

    if (improvedBound) {
      upperBoundCost = polished.minCost;
      bestHeuristicSolution = {
        upperBoundCost: polished.minCost,
        selectedVertices: polished.selectedVertices,
        stage: 'POLISH',
        ms: polished.ms,
      };

      if (typeof options.onInterimSolution === 'function') {
        options.onInterimSolution({
          selectedVertices: polished.selectedVertices,
          minCost: polished.minCost,
          isExact: polished.isExact,
          stage: 'POLISH',
          bagId: targetOrigBagId,
        });
      }
    }
  }

  if (useHeuristicAdvice && isFullRootSolve) {
    // Stage 0: Instant graph-based Steiner Forest upper bound
    const greedy = computeFastSteinerUpperBound(adjSets, weights, disjointGroups, mandatorySet, [...freeTargetSet], [...anyTownSet]);
    if (greedy && greedy.selectedVertices.length > 0) {
      upperBoundCost = greedy.minCost;
      bestHeuristicSolution = {
        upperBoundCost: greedy.minCost,
        selectedVertices: greedy.selectedVertices,
        stage: 'GREEDY',
        ms: greedy.ms,
      };
      heuristicStages.push({
        label: 'GREEDY',
        cap: 0,
        cost: greedy.minCost,
        ms: greedy.ms,
        peakBagStates: 0,
        selectedVertices: greedy.selectedVertices,
      });

      if (typeof options.onInterimSolution === 'function') {
        options.onInterimSolution({
          selectedVertices: greedy.selectedVertices,
          minCost: greedy.minCost,
          isExact: false,
          stage: 'GREEDY',
          bagId: targetOrigBagId,
        });
      }
    }

    const fullLadder =
      ladderMode === 'greedy'
        ? []
        : ladderMode === '1k'
          ? [{ cap: 1024, label: 'HEUR 1K' }]
          : [
              { cap: 1024, label: 'HEUR 1K' },
              { cap: 4096, label: 'HEUR 4K' },
              { cap: 16384, label: 'HEUR 16K' },
            ];
    const ladder = fullLadder.filter((step) => step.cap < requestedMaxStates);

    for (const step of ladder) {
      if (shouldAbort()) return null;
      const strict = bestHeuristicSolution != null;
      const res = await runDpPass(step.cap, upperBoundCost, step.label, strict);
      if (!res) return null;
      if (res.bagSnapshots) {
        if (!lastLadderSnapshots) {
          lastLadderSnapshots = {
            stage: res.bagSnapshots.stage,
            byNode: { ...res.bagSnapshots.byNode },
            byOrig: { ...res.bagSnapshots.byOrig },
          };
        } else {
          for (const [k, snapEntry] of Object.entries(res.bagSnapshots.byNode || {})) {
            if (snapEntry.totalStates > 0 || !lastLadderSnapshots.byNode[k]) {
              lastLadderSnapshots.byNode[k] = snapEntry;
            }
          }
          for (const [k, snapEntry] of Object.entries(res.bagSnapshots.byOrig || {})) {
            if (snapEntry.totalStates > 0 || !lastLadderSnapshots.byOrig[k]) {
              lastLadderSnapshots.byOrig[k] = snapEntry;
            }
          }
          lastLadderSnapshots.stage = res.bagSnapshots.stage;
        }
      }

      let foundCost = res.bagMergeStats.minCost;
      let validAtTarget = res.bagMergeStats.postForgetStates > 0 && foundCost != null;
      let stageVerts = validAtTarget ? res.selectedVertices : [];

      if (!validAtTarget && bestHeuristicSolution && res.boundPrunedStates > 0) {
        foundCost = bestHeuristicSolution.upperBoundCost;
        stageVerts = bestHeuristicSolution.selectedVertices;
        validAtTarget = true;
      }

      heuristicStages.push({
        label: step.label,
        cap: step.cap,
        cost: validAtTarget ? foundCost : null,
        ms: res.passElapsedMs,
        peakBagStates: res.peakBagStates,
        selectedVertices: stageVerts,
      });

      if (validAtTarget && foundCost < upperBoundCost) {
        upperBoundCost = foundCost;
        bestHeuristicSolution = {
          upperBoundCost: foundCost,
          selectedVertices: stageVerts,
          stage: step.label,
          ms: res.passElapsedMs,
        };

        if (typeof options.onInterimSolution === 'function') {
          options.onInterimSolution({
            selectedVertices: stageVerts,
            minCost: foundCost,
            isExact: res.isExact,
            stage: step.label,
            bagId: res.bagMergeStats.origBagId,
          });
        }
      }

      // If zero beam prunings & zero join caps occurred, optimality is ALREADY certified
      if (res.isExact && (validAtTarget || (strict && bestHeuristicSolution))) {
        if (!validAtTarget && bestHeuristicSolution) {
          res.selectedVertices = bestHeuristicSolution.selectedVertices;
          res.bagMergeStats.minCost = bestHeuristicSolution.upperBoundCost;
        }
        earlyExactResult = res;
        break;
      }

      if (step.cap === 1024) {
        maybeRunTreePolish();
      }
    }
  }

  if (shouldAbort()) return null;

  const finalLabel = earlyExactResult
    ? 'EXACT'
    : Number.isFinite(requestedMaxStates)
      ? `BEAM ${requestedMaxStates >= 1024 ? `${Math.round(requestedMaxStates / 1024)}K` : requestedMaxStates}`
      : 'EXACT';

  const finalStrict = isFullRootSolve && bestHeuristicSolution != null;
  const finalResult =
    earlyExactResult ??
    (await runDpPass(
      requestedMaxStates,
      isFullRootSolve ? upperBoundCost : Infinity,
      finalLabel,
      finalStrict
    ));

  if (!finalResult) return null;

  if (useHeuristicAdvice && isFullRootSolve && !ranPolish) {
    if (
      finalResult.bagMergeStats.postForgetStates > 0 &&
      finalResult.bagMergeStats.minCost != null &&
      finalResult.bagMergeStats.minCost < upperBoundCost
    ) {
      upperBoundCost = finalResult.bagMergeStats.minCost;
      bestHeuristicSolution = {
        upperBoundCost: finalResult.bagMergeStats.minCost,
        selectedVertices: finalResult.selectedVertices,
        stage: finalLabel,
        ms: finalResult.passElapsedMs,
      };
    }
    if (!earlyExactResult && !finalResult.isExact && ladderMode !== 'greedy') {
      maybeRunTreePolish();
    }
  }

  // If strict-bound final pass finished cleanly with 0 states, `bestHeuristicSolution` is certified optimal
  const certifiedOptimalByStrictPruning =
    finalStrict &&
    !finalResult.memoryLimitHit &&
    finalResult.isExact &&
    finalResult.bagMergeStats.postForgetStates === 0 &&
    bestHeuristicSolution != null;

  if (
    bestHeuristicSolution &&
    (finalResult.memoryLimitHit ||
      finalResult.bagMergeStats.postForgetStates === 0 ||
      finalResult.bagMergeStats.minCost == null ||
      bestHeuristicSolution.upperBoundCost < finalResult.bagMergeStats.minCost)
  ) {
    finalResult.selectedVertices = bestHeuristicSolution.selectedVertices;
    finalResult.bagMergeStats.minCost = bestHeuristicSolution.upperBoundCost;
    if (finalResult.memoryLimitHit) {
      finalResult.isExact = false;
    } else if (certifiedOptimalByStrictPruning) {
      finalResult.isExact = true;
    }
  }

  if (finalResult.selectedVertices?.length > 0 && !finalResult.memoryLimitHit) {
    finalResult.collapseDebug = null;
  }

  finalResult.heuristicAdvice = bestHeuristicSolution;
  finalResult.heuristicStages = heuristicStages;
  finalResult.totalElapsedMs = Number((performance.now() - globalStartMs).toFixed(1));

  const allSolutions = [];
  for (const st of heuristicStages) {
    if (st.cost != null && st.selectedVertices?.length > 0) {
      allSolutions.push({
        label: st.label,
        minCost: st.cost,
        selectedVertices: st.selectedVertices,
        isExact: false,
        ms: st.ms,
        bagId: finalResult.bagMergeStats.origBagId,
      });
    }
  }
  if (
    !earlyExactResult &&
    !finalResult.memoryLimitHit &&
    finalResult.bagMergeStats.minCost != null &&
    finalResult.selectedVertices?.length > 0
  ) {
    allSolutions.push({
      label: finalLabel,
      minCost: finalResult.bagMergeStats.minCost,
      selectedVertices: finalResult.selectedVertices,
      isExact: finalResult.isExact,
      ms: finalResult.passElapsedMs,
      bagId: finalResult.bagMergeStats.origBagId,
    });
  } else if (earlyExactResult && allSolutions.length > 0) {
    allSolutions[allSolutions.length - 1].isExact = true;
  }

  finalResult.allSolutions = allSolutions;

  const mergeSnapMaps = (primary = {}, fallback = {}) => {
    const out = {};
    const keys = new Set([...Object.keys(fallback), ...Object.keys(primary)]);
    for (const k of keys) {
      const p = primary[k];
      const f = fallback[k];
      if (p && p.totalStates > 0) {
        out[k] = p;
      } else if (p && f && f.totalStates > 0) {
        out[k] = {
          ...f,
          prunedAtStage: p.stage,
          prunedStageStates: p.totalStates,
        };
      } else if (p || f) {
        out[k] = p || f;
      }
    }
    return out;
  };

  if (finalResult.bagSnapshots || lastLadderSnapshots) {
    finalResult.bagSnapshots = {
      stage: finalResult.bagSnapshots?.stage ?? lastLadderSnapshots?.stage ?? finalLabel,
      numGroups,
      hasFreeTargets,
      byNode: mergeSnapMaps(finalResult.bagSnapshots?.byNode, lastLadderSnapshots?.byNode),
      byOrig: mergeSnapMaps(finalResult.bagSnapshots?.byOrig, lastLadderSnapshots?.byOrig),
    };
  }

  return finalResult;
}