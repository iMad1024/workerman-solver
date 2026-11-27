// src/utils/empireCutEngine.js

/**
 * Extracts the road graph + candidate plantzone-town pairs from plain gameStore snapshots.
 */
export function buildEmpireModelData(raw, options = {}) {
  const { links = {}, nodes = {}, plantzoneStatic = {}, allPzProfit = {}, uloc = {} } = raw;
  const topKTowns = Math.max(1, Math.floor(Number(options.topKTowns) || 5));
  const cpCap = Math.max(0, Number(options.cpCap) || 400);
  const lodgingMap = options.lodgingMap || {};

  // 1. Identify base towns (CP === 0 && kind 1 or 2)
  const baseTownSet = new Set();
  for (const [k, n] of Object.entries(nodes)) {
    if (n && Number(n.CP) === 0 && (n.kind === 1 || n.kind === 2)) {
      baseTownSet.add(Number(k));
    }
  }

  // 2. Build road graph (non-plantzone nodes, excluding 0-CP investment banks kind 10/13)
  const roadIds = [];
  for (const key of Object.keys(links)) {
    const id = Number(key);
    const n = nodes[key];
    if (!Number.isFinite(id) || !n) continue;
    if (n.is_plantzone) continue;
    if (Number(n.CP) === 0 && (n.kind === 10 || n.kind === 13)) continue;
    roadIds.push(id);
  }
  roadIds.sort((a, b) => a - b);

  const idToIdx = new Map();
  roadIds.forEach((id, i) => idToIdx.set(id, i));

  const n = roadIds.length;
  const adj = Array.from({ length: n }, () => []);
  const adjSet = Array.from({ length: n }, () => new Set());
  const roadCP = new Float64Array(n);
  const isTownIdx = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const id = roadIds[i];
    roadCP[i] = Math.max(0, Number(nodes[String(id)]?.CP) || 0);
    if (baseTownSet.has(id)) isTownIdx[i] = 1;

    const nbrs = links[String(id)] || links[id] || [];
    for (const rawNb of nbrs) {
      const nb = Number(rawNb);
      const j = idToIdx.get(nb);
      if (j !== undefined && j !== i && !adjSet[i].has(j)) {
        adjSet[i].add(j);
        adj[i].push(j);
      }
    }
  }

  // Tight valid Big-M for Hybrid A any-town flow: max non-town road nodes affordable in cpCap
  const nonTownCPs = [];
  let numFlowVars = 0;
  for (let i = 0; i < n; i++) {
    if (!isTownIdx[i]) nonTownCPs.push(roadCP[i]);
    for (let j = 0; j < adj[i].length; j++) {
      if (!isTownIdx[adj[i][j]]) numFlowVars++;
    }
  }
  nonTownCPs.sort((a, b) => a - b);
  let maxAffordableNonTown = 0;
  let accCP = 0;
  for (let i = 0; i < nonTownCPs.length; i++) {
    if (accCP + nonTownCPs[i] <= cpCap + 1e-9) {
      accCP += nonTownCPs[i];
      maxAffordableNonTown++;
    } else {
      break;
    }
  }
  const flowBigM = Math.max(1, maxAffordableNonTown);

  // 3. Precompute reachability from each town in road graph
  const towns = roadIds
    .filter((id) => baseTownSet.has(id))
    .map((id) => ({
      id,
      idx: idToIdx.get(id),
      name: uloc[id] || uloc[String(id)] || `Town #${id}`,
      lodging: Math.max(0, Math.floor(Number(lodgingMap[id] ?? 15))),
    }));

  const townReachable = new Map();
  for (const t of towns) {
    const vis = new Uint8Array(n);
    const q = [t.idx];
    vis[t.idx] = 1;
    let head = 0;
    while (head < q.length) {
      const u = q[head++];
      for (const v of adj[u]) {
        if (!vis[v]) {
          vis[v] = 1;
          q.push(v);
        }
      }
    }
    townReachable.set(t.id, vis);
  }

  const townById = new Map(towns.map((t) => [t.id, t]));

  // 4. Extract candidate (plantzone, town) pairs, per-parent q_u, and per-(parent, town) y_{u,t}
  const plantzones = [];
  const zVars = [];
  const yMap = new Map();
  const qMap = new Map();

  const pzKeys = Object.keys(allPzProfit)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  for (const pzId of pzKeys) {
    const pzNode = nodes[String(pzId)];
    if (!pzNode || !pzNode.is_plantzone) continue;
    if (pzNode.kind === 10 || pzNode.kind === 12 || pzNode.kind === 13) continue;

    const parentId = Number(plantzoneStatic[String(pzId)]?.parent);
    const parentIdx = idToIdx.get(parentId);
    if (parentIdx === undefined) continue;

    const pzCP = Math.max(0, Number(pzNode.CP) || 0);
    const altTowns = Array.isArray(allPzProfit[String(pzId)]?.alt_towns)
      ? allPzProfit[String(pzId)].alt_towns
      : [];

    const pzZIndices = [];
    let added = 0;
    for (const entry of altTowns) {
      if (added >= topKTowns) break;
      const tId = Number(entry?.tnk);
      const profit = Number(entry?.priceDaily) || 0;
      const townObj = townById.get(tId);
      if (!townObj || profit <= 0 || townObj.lodging <= 0) continue;

      const reach = townReachable.get(tId);
      if (!reach || !reach[parentIdx]) continue;

      const zIdx = zVars.length;
      const zName = `z_${pzId}_${tId}`;
      zVars.push({
        idx: zIdx,
        name: zName,
        pzId,
        parentId,
        parentIdx,
        townId: tId,
        townIdx: townObj.idx,
        profit,
        pzCP,
      });
      pzZIndices.push(zIdx);
      added++;

      if (parentIdx !== townObj.idx) {
        const yKey = `${parentIdx}_${townObj.idx}`;
        let yObj = yMap.get(yKey);
        if (!yObj) {
          yObj = {
            key: yKey,
            name: `y_${parentId}_${tId}`,
            parentId,
            parentIdx,
            townId: tId,
            townIdx: townObj.idx,
            isDirect: adjSet[parentIdx].has(townObj.idx),
            zIndices: [],
          };
          yMap.set(yKey, yObj);
        }
        yObj.zIndices.push(zIdx);
      }
    }

    if (pzZIndices.length > 0) {
      const pzIdx = plantzones.length;
      plantzones.push({
        idx: pzIdx,
        pzId,
        parentId,
        parentIdx,
        pzCP,
        zIndices: pzZIndices,
      });

      if (!isTownIdx[parentIdx]) {
        let qObj = qMap.get(parentIdx);
        if (!qObj) {
          qObj = {
            name: `q_${parentId}`,
            parentId,
            parentIdx,
            pzIndices: [],
            candTownIdxSet: new Set(),
          };
          qMap.set(parentIdx, qObj);
        }
        qObj.pzIndices.push(pzIdx);
        for (const zi of pzZIndices) {
          qObj.candTownIdxSet.add(zVars[zi].townIdx);
        }
      }
    }
  }

  const qVars = [...qMap.values()].map((qObj) => {
    const candTownIdxs = [...qObj.candTownIdxSet].sort((a, b) => a - b);
    const isDirectToAnyCandTown = candTownIdxs.some((ti) => adjSet[qObj.parentIdx].has(ti));
    return {
      name: qObj.name,
      parentId: qObj.parentId,
      parentIdx: qObj.parentIdx,
      pzIndices: qObj.pzIndices,
      candTownIdxs,
      candTownIdxSet: qObj.candTownIdxSet,
      isDirectToAnyCandTown,
    };
  });

  const qByParentIdx = new Map(qVars.map((q) => [q.parentIdx, q]));
  const yVars = [...yMap.values()];

  const nodeNames = { ALL: 'Cand. Towns' };
  for (const id of roadIds) {
    nodeNames[id] = uloc[id] || uloc[String(id)] || `#${id}`;
  }

  return {
    cpCap,
    topKTowns,
    roadIds,
    idToIdx,
    adj,
    adjSet,
    roadCP,
    isTownIdx,
    flowBigM,
    numFlowVars,
    towns,
    townById,
    plantzones,
    zVars,
    yVars,
    qVars,
    qByParentIdx,
    nodeNames,
    _dIntCache: new Map(),
    _corridorCache: new Map(),
  };
}

/**
 * Shortest-path internal-CP distance from `srcIdx` to every vertex `v`:
 * sum of `roadCP` strictly between `srcIdx` and `v` (excluding both endpoints).
 */
function getInternalDistances(model, srcIdx) {
  const cached = model._dIntCache.get(srcIdx);
  if (cached) return cached;

  const n = model.roadIds.length;
  const dist = new Float64Array(n);
  dist.fill(Infinity);
  const vis = new Uint8Array(n);

  dist[srcIdx] = 0;
  vis[srcIdx] = 1;

  // Compact binary min-heap on (distance, nodeIdx)
  const hDist = [];
  const hNode = [];
  const push = (d, u) => {
    let i = hNode.length;
    hDist.push(d);
    hNode.push(u);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hDist[p] <= d) break;
      hDist[i] = hDist[p];
      hNode[i] = hNode[p];
      i = p;
    }
    hDist[i] = d;
    hNode[i] = u;
  };
  const pop = () => {
    const topU = hNode[0];
    const lastD = hDist.pop();
    const lastU = hNode.pop();
    if (hNode.length > 0) {
      let i = 0;
      const len = hNode.length;
      while (true) {
        let l = (i << 1) + 1;
        if (l >= len) break;
        let r = l + 1;
        let c = r < len && hDist[r] < hDist[l] ? r : l;
        if (lastD <= hDist[c]) break;
        hDist[i] = hDist[c];
        hNode[i] = hNode[c];
        i = c;
      }
      hDist[i] = lastD;
      hNode[i] = lastU;
    }
    return topU;
  };

  for (const nb of model.adj[srcIdx]) {
    dist[nb] = 0;
    push(0, nb);
  }

  while (hNode.length > 0) {
    const u = pop();
    if (vis[u]) continue;
    vis[u] = 1;
    const step = dist[u] + model.roadCP[u];
    const nbrs = model.adj[u];
    for (let j = 0; j < nbrs.length; j++) {
      const v = nbrs[j];
      if (!vis[v] && step < dist[v]) {
        dist[v] = step;
        push(step, v);
      }
    }
  }

  model._dIntCache.set(srcIdx, dist);
  return dist;
}

/**
 * Builds & caches a pruned local corridor subgraph V_t for Hybrid B-lite per-town flow.
 * Includes every road node on a path between town t and any non-direct candidate parent u
 * within `detourCP` CP of the shortest internal-CP path (set detourCP >= 999 for full component).
 */
export function getTownCorridor(model, townId, detourCP = 6) {
  const cleanDetour = Math.max(0, Number(detourCP) || 0);
  const cacheKey = `${townId}|${cleanDetour}`;
  if (model._corridorCache.has(cacheKey)) {
    return model._corridorCache.get(cacheKey);
  }

  const townObj = model.townById.get(townId);
  if (!townObj || townObj.lodging <= 0) {
    model._corridorCache.set(cacheKey, null);
    return null;
  }

  const ndYByParent = new Map();
  for (const y of model.yVars) {
    if (y.townId === townId && !y.isDirect) {
      ndYByParent.set(y.parentIdx, y);
    }
  }
  if (ndYByParent.size === 0) {
    model._corridorCache.set(cacheKey, null);
    return null;
  }

  const n = model.roadIds.length;
  const tIdx = townObj.idx;
  const dFromT = getInternalDistances(model, tIdx);
  const inV = new Uint8Array(n);
  inV[tIdx] = 1;

  if (cleanDetour >= 999) {
    for (let w = 0; w < n; w++) {
      if (Number.isFinite(dFromT[w])) inV[w] = 1;
    }
  } else {
    for (const uIdx of ndYByParent.keys()) {
      inV[uIdx] = 1;
      const baseDist = dFromT[uIdx];
      if (!Number.isFinite(baseDist)) continue;
      const dFromU = getInternalDistances(model, uIdx);
      const limit = baseDist + cleanDetour + 1e-9;

      for (let w = 0; w < n; w++) {
        if (inV[w]) continue;
        if (dFromT[w] + model.roadCP[w] + dFromU[w] <= limit) {
          inV[w] = 1;
        }
      }
    }
  }

  // Iteratively prune non-terminal degree-1 leaves inside G[V_t]
  const deg = new Int32Array(n);
  const pruneQ = [];
  for (let u = 0; u < n; u++) {
    if (!inV[u]) continue;
    let d = 0;
    for (const v of model.adj[u]) {
      if (inV[v]) d++;
    }
    deg[u] = d;
    if (u !== tIdx && !ndYByParent.has(u) && d <= 1) {
      pruneQ.push(u);
    }
  }

  let ph = 0;
  while (ph < pruneQ.length) {
    const u = pruneQ[ph++];
    if (!inV[u] || u === tIdx || ndYByParent.has(u)) continue;
    inV[u] = 0;
    for (const v of model.adj[u]) {
      if (inV[v]) {
        deg[v]--;
        if (v !== tIdx && !ndYByParent.has(v) && deg[v] <= 1) {
          pruneQ.push(v);
        }
      }
    }
  }

  const verts = [];
  const adjInV = new Map();
  let arcCount = 0;
  for (let u = 0; u < n; u++) {
    if (!inV[u]) continue;
    verts.push(u);
    const nbrs = [];
    for (const v of model.adj[u]) {
      if (inV[v]) {
        nbrs.push(v);
        if (v !== tIdx) arcCount++;
      }
    }
    adjInV.set(u, nbrs);
  }

  const corridor = {
    townId,
    townIdx: tIdx,
    townName: townObj.name,
    bigM: Math.max(1, Math.min(townObj.lodging, ndYByParent.size)),
    ndYByParent,
    verts,
    adjInV,
    arcCount,
  };

  model._corridorCache.set(cacheKey, corridor);
  return corridor;
}

/**
 * Generates compact 1-hop neighborhood cuts on aggregate parent variables q_u.
 */
export function buildInitialOneHopCuts(model) {
  const cuts = [];
  let cutId = 0;
  for (const q of model.qVars) {
    if (q.isDirectToAnyCandTown) continue;
    const nbrs = model.adj[q.parentIdx];
    if (!nbrs || nbrs.length === 0) continue;
    const cutIdxs = [...nbrs].sort((a, b) => a - b);
    cuts.push({
      id: `init_${cutId++}`,
      round: 0,
      kind: 'INIT',
      rhsTerms: [q.name],
      yKey: `q_${q.parentIdx}`,
      yName: q.name,
      parentId: q.parentId,
      parentIdx: q.parentIdx,
      townId: 'ALL',
      townIdx: -1,
      cutIdxs,
      cutNodeIds: cutIdxs.map((i) => model.roadIds[i]),
      violation: null,
      signature: `${q.name}|${cutIdxs.join(',')}`,
    });
  }
  return cuts;
}

function wrapTerms(terms, termsPerLine = 6) {
  const lines = [];
  for (let i = 0; i < terms.length; i += termsPerLine) {
    const prefix = i === 0 ? '' : '  + ';
    lines.push(prefix + terms.slice(i, i + termsPerLine).join(' + '));
  }
  return lines.join('\n');
}

function wrapSignedTerms(posTerms, negTerms, termsPerLine = 6) {
  const signed = [
    ...posTerms.map((t, i) => ({ sign: i === 0 ? '' : '+ ', term: t })),
    ...negTerms.map((t) => ({ sign: '- ', term: t })),
  ];
  const lines = [];
  for (let i = 0; i < signed.length; i += termsPerLine) {
    const slice = signed.slice(i, i + termsPerLine);
    const prefix = i === 0 ? '' : '  ';
    lines.push(prefix + slice.map((item) => `${item.sign}${item.term}`).join(' '));
  }
  return lines.join('\n');
}

/**
 * Builds CPLEX LP string for HiGHS.
 * Supports Hybrid A (`useAnyTownFlow`) and Hybrid B-lite (`targetedTownIds` + `corridorDetourCP`) in MIP mode.
 */
export function serializeModelToLp(
  model,
  cuts,
  {
    asMip = false,
    useAnyTownFlow = false,
    targetedTownIds = [],
    corridorDetourCP = 6,
  } = {}
) {
  const out = [];
  out.push('Maximize');

  const objTerms = model.zVars.map((z) => `${z.profit.toFixed(6)} ${z.name}`);
  out.push(objTerms.length ? ` obj: ${wrapTerms(objTerms, 6)}` : ' obj: 0');

  out.push('Subject To');

  // 1. Global CP budget
  const cpTerms = [];
  for (let i = 0; i < model.roadIds.length; i++) {
    if (!model.isTownIdx[i] && model.roadCP[i] > 0) {
      cpTerms.push(`${model.roadCP[i]} x_${model.roadIds[i]}`);
    }
  }
  for (const z of model.zVars) {
    if (z.pzCP > 0) {
      cpTerms.push(`${z.pzCP} ${z.name}`);
    }
  }
  if (cpTerms.length > 0) {
    out.push(` cp_budget: ${wrapTerms(cpTerms, 6)} <= ${model.cpCap}`);
  }

  // 2. Plantzone worker exclusivity & aggregate parent linking
  for (const q of model.qVars) {
    out.push(` q2x_${q.parentId}: ${q.name} - x_${q.parentId} <= 0`);
  }

  for (const pz of model.plantzones) {
    const terms = pz.zIndices.map((zi) => model.zVars[zi].name);
    const qObj = model.qByParentIdx.get(pz.parentIdx);
    if (qObj) {
      out.push(` pz_${pz.pzId}: ${wrapSignedTerms(terms, [qObj.name], 6)} <= 0`);
    } else {
      out.push(` pz_${pz.pzId}: ${wrapTerms(terms, 6)} <= 1`);
    }
  }

  // 3. Per-town lodging limits
  const zByTown = new Map();
  for (const z of model.zVars) {
    if (!zByTown.has(z.townId)) zByTown.set(z.townId, []);
    zByTown.get(z.townId).push(z.name);
  }
  for (const t of model.towns) {
    const terms = zByTown.get(t.id);
    if (!terms || terms.length === 0) continue;
    out.push(` ldg_${t.id}: ${wrapTerms(terms, 6)} <= ${t.lodging}`);
  }

  // 4. Parent-town connectivity linking: z_{p,t} <= y_{u,t} <= q_u (or x_u)
  for (const y of model.yVars) {
    const qObj = model.qByParentIdx.get(y.parentIdx);
    if (qObj) {
      out.push(` y2q_${y.parentId}_${y.townId}: ${y.name} - ${qObj.name} <= 0`);
    } else {
      out.push(` y2x_${y.parentId}_${y.townId}: ${y.name} - x_${y.parentId} <= 0`);
    }
    for (const zi of y.zIndices) {
      const z = model.zVars[zi];
      out.push(` z2y_${z.pzId}_${z.townId}: ${z.name} - ${y.name} <= 0`);
    }
  }

  // 5a. Hybrid A: Single-commodity any-town flow (MIP only)
  if (asMip && useAnyTownFlow) {
    const M = model.flowBigM;
    for (let u = 0; u < model.roadIds.length; u++) {
      if (model.isTownIdx[u]) continue;
      const idU = model.roadIds[u];
      const nbrs = model.adj[u];
      if (!nbrs || nbrs.length === 0) {
        out.push(` fc_${idU}: x_${idU} = 0`);
        continue;
      }
      const inTerms = [];
      const outTerms = [];
      for (let j = 0; j < nbrs.length; j++) {
        const v = nbrs[j];
        const idV = model.roadIds[v];
        inTerms.push(`f_${idV}_${idU}`);
        if (!model.isTownIdx[v]) {
          outTerms.push(`f_${idU}_${idV}`);
        }
      }
      out.push(` fc_${idU}: ${wrapSignedTerms(inTerms, [...outTerms, `x_${idU}`], 6)} = 0`);
      out.push(` fcap_${idU}: ${wrapSignedTerms(inTerms, [`${M} x_${idU}`], 6)} <= 0`);
    }
  }

  // 5b. Hybrid B-lite: Local per-town flow ONLY for capped/targeted towns (MIP only)
  const activeCorridors = [];
  if (asMip && targetedTownIds && targetedTownIds.length > 0) {
    for (const tId of targetedTownIds) {
      const corr = getTownCorridor(model, tId, corridorDetourCP);
      if (!corr) continue;
      activeCorridors.push(corr);

      const { townIdx, bigM, ndYByParent, verts, adjInV } = corr;
      const tOutNbrs = adjInV.get(townIdx) || [];
      if (tOutNbrs.length > 0) {
        const outFromT = tOutNbrs.map((v) => `ft_${tId}_${tId}_${model.roadIds[v]}`);
        out.push(` ftout_${tId}: ${wrapTerms(outFromT, 6)} <= ${bigM}`);
      }

      for (let vi = 0; vi < verts.length; vi++) {
        const u = verts[vi];
        if (u === townIdx) continue;
        const idU = model.roadIds[u];
        const nbrs = adjInV.get(u) || [];
        const inTerms = [];
        const outTerms = [];
        for (let j = 0; j < nbrs.length; j++) {
          const v = nbrs[j];
          const idV = model.roadIds[v];
          inTerms.push(`ft_${tId}_${idV}_${idU}`);
          if (v !== townIdx) {
            outTerms.push(`ft_${tId}_${idU}_${idV}`);
          }
        }
        const yObj = ndYByParent.get(u);
        const negTerms = yObj ? [...outTerms, yObj.name] : outTerms;
        if (inTerms.length > 0 || negTerms.length > 0) {
          out.push(` ftc_${tId}_${idU}: ${wrapSignedTerms(inTerms, negTerms, 6)} = 0`);
        }
        if (!model.isTownIdx[u] && inTerms.length > 0) {
          out.push(` ftcap_${tId}_${idU}: ${wrapSignedTerms(inTerms, [`${bigM} x_${idU}`], 6)} <= 0`);
        }
      }
    }
  }

  // 6. Vertex separator cuts: sum_{w in S} x_w - sum_{r in rhsTerms} r >= 0
  for (let ci = 0; ci < cuts.length; ci++) {
    const c = cuts[ci];
    const posTerms = c.cutNodeIds.map((id) => `x_${id}`);
    const negTerms = c.rhsTerms && c.rhsTerms.length ? c.rhsTerms : [c.yName];
    out.push(` cut_${ci}: ${wrapSignedTerms(posTerms, negTerms, 6)} >= 0`);
  }

  // 7. Bounds
  out.push('Bounds');
  for (let i = 0; i < model.roadIds.length; i++) {
    const id = model.roadIds[i];
    if (model.isTownIdx[i]) {
      out.push(` 1 <= x_${id} <= 1`);
    } else {
      out.push(` 0 <= x_${id} <= 1`);
    }
  }
  for (const q of model.qVars) {
    out.push(` 0 <= ${q.name} <= 1`);
  }
  for (const z of model.zVars) {
    out.push(` 0 <= ${z.name} <= 1`);
  }
  for (const y of model.yVars) {
    out.push(` 0 <= ${y.name} <= 1`);
  }
  if (asMip && useAnyTownFlow) {
    const M = model.flowBigM;
    for (let u = 0; u < model.roadIds.length; u++) {
      const idU = model.roadIds[u];
      const nbrs = model.adj[u];
      for (let j = 0; j < nbrs.length; j++) {
        const v = nbrs[j];
        if (!model.isTownIdx[v]) {
          out.push(` 0 <= f_${idU}_${model.roadIds[v]} <= ${M}`);
        }
      }
    }
  }
  for (const corr of activeCorridors) {
    const { townId, townIdx, bigM, verts, adjInV } = corr;
    for (let vi = 0; vi < verts.length; vi++) {
      const u = verts[vi];
      const idU = model.roadIds[u];
      const nbrs = adjInV.get(u) || [];
      for (let j = 0; j < nbrs.length; j++) {
        const v = nbrs[j];
        if (v !== townIdx) {
          out.push(` 0 <= ft_${townId}_${idU}_${model.roadIds[v]} <= ${bigM}`);
        }
      }
    }
  }

  // 8. Binary section for MIP
  if (asMip) {
    out.push('Binary');
    const bins = [];
    for (let i = 0; i < model.roadIds.length; i++) {
      if (!model.isTownIdx[i]) bins.push(`x_${model.roadIds[i]}`);
    }
    for (const z of model.zVars) {
      bins.push(z.name);
    }
    for (let i = 0; i < bins.length; i += 10) {
      out.push(' ' + bins.slice(i, i + 10).join(' '));
    }
  }

  out.push('End');
  return out.join('\n');
}

// ============================================================================
// NODE-SPLIT DINIC MAX-FLOW (EXACT MULTI-SINK FRACTIONAL VERTEX-CUT SEPARATOR)
// ============================================================================
function findMinVertexCutDinicMulti(n, adj, xVals, srcIdx, snkIdxs) {
  const INF = 1e9;
  const EPS = 1e-12;
  const CARD_TIE = 1e-7;

  const isSink = new Uint8Array(n);
  for (let i = 0; i < snkIdxs.length; i++) {
    const ti = snkIdxs[i];
    if (ti === srcIdx) return { flow: INF, exactCutWeight: INF, cutIdxs: [] };
    isSink[ti] = 1;
  }

  const srcNbrs = adj[srcIdx];
  for (let j = 0; j < srcNbrs.length; j++) {
    if (isSink[srcNbrs[j]]) return { flow: INF, exactCutWeight: INF, cutIdxs: [] };
  }

  const N = 2 * n + 1;
  const S = 2 * srcIdx + 1;
  const T = 2 * n;

  const head = new Int32Array(N).fill(-1);
  const to = [];
  const cap = [];
  const next = [];

  function addEdge(u, v, c) {
    to.push(v);
    cap.push(c);
    next.push(head[u]);
    head[u] = to.length - 1;

    to.push(u);
    cap.push(0);
    next.push(head[v]);
    head[v] = to.length - 1;
  }

  for (let w = 0; w < n; w++) {
    if (w === srcIdx) continue;
    if (isSink[w]) {
      addEdge(2 * w, T, INF);
    } else {
      addEdge(2 * w, 2 * w + 1, Math.max(0, xVals[w]) + CARD_TIE);
    }
  }

  for (let u = 0; u < n; u++) {
    if (isSink[u]) continue;
    const uOut = 2 * u + 1;
    const nbrs = adj[u];
    for (let j = 0; j < nbrs.length; j++) {
      const v = nbrs[j];
      if (v === srcIdx) continue;
      addEdge(uOut, 2 * v, INF);
    }
  }

  const level = new Int32Array(N);
  const it = new Int32Array(N);
  const q = new Int32Array(N);

  function bfs() {
    level.fill(-1);
    level[S] = 0;
    let qh = 0;
    let qt = 0;
    q[qt++] = S;
    while (qh < qt) {
      const u = q[qh++];
      for (let e = head[u]; e !== -1; e = next[e]) {
        if (cap[e] > EPS && level[to[e]] === -1) {
          level[to[e]] = level[u] + 1;
          if (to[e] === T) return true;
          q[qt++] = to[e];
        }
      }
    }
    return level[T] !== -1;
  }

  function dfs(u, pushed) {
    if (u === T || pushed <= EPS) return pushed;
    for (let e = it[u]; e !== -1; e = next[e]) {
      it[u] = e;
      const v = to[e];
      if (cap[e] > EPS && level[v] === level[u] + 1) {
        const tr = dfs(v, Math.min(pushed, cap[e]));
        if (tr > EPS) {
          cap[e] -= tr;
          cap[e ^ 1] += tr;
          return tr;
        }
      }
    }
    return 0;
  }

  let flow = 0;
  while (bfs()) {
    it.set(head);
    while (true) {
      const pushed = dfs(S, INF);
      if (pushed <= EPS) break;
      flow += pushed;
    }
  }

  const reach = new Uint8Array(N);
  let qh = 0;
  let qt = 0;
  reach[S] = 1;
  q[qt++] = S;
  while (qh < qt) {
    const u = q[qh++];
    for (let e = head[u]; e !== -1; e = next[e]) {
      const v = to[e];
      if (cap[e] > EPS && !reach[v]) {
        reach[v] = 1;
        q[qt++] = v;
      }
    }
  }

  const cutIdxs = [];
  let exactCutWeight = 0;
  for (let w = 0; w < n; w++) {
    if (w === srcIdx || isSink[w]) continue;
    if (reach[2 * w] && !reach[2 * w + 1]) {
      cutIdxs.push(w);
      exactCutWeight += Math.max(0, xVals[w]);
    }
  }

  return { flow, exactCutWeight, cutIdxs };
}

function bfsWithoutCut(n, adj, srcIdx, cutIdxs) {
  const blocked = new Uint8Array(n);
  for (let i = 0; i < cutIdxs.length; i++) blocked[cutIdxs[i]] = 1;
  const vis = new Uint8Array(n);
  const q = new Int32Array(n);
  if (blocked[srcIdx]) return vis;
  let h = 0;
  let t = 0;
  vis[srcIdx] = 1;
  q[t++] = srcIdx;
  while (h < t) {
    const u = q[h++];
    const nbrs = adj[u];
    for (let j = 0; j < nbrs.length; j++) {
      const v = nbrs[j];
      if (!blocked[v] && !vis[v]) {
        vis[v] = 1;
        q[t++] = v;
      }
    }
  }
  return vis;
}

/**
 * Separates violated fractional vertex cuts in 3 tiers (q_u, lifted subset, per-town y_{u,t}).
 */
export function separateFractionalCuts(
  model,
  solutionCols,
  existingSigSet,
  round,
  eps = 1e-3,
  maxCutsPerRound = 160
) {
  const n = model.roadIds.length;
  const xVals = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xVals[i] = model.isTownIdx[i]
      ? 1
      : Number(solutionCols[`x_${model.roadIds[i]}`]?.Primal) || 0;
  }

  const found = [];

  // Tier 1: Aggregate parent q_u cuts
  const qCands = [];
  for (const qObj of model.qVars) {
    if (qObj.isDirectToAnyCandTown) continue;
    const qVal = Number(solutionCols[qObj.name]?.Primal) || 0;
    if (qVal > eps) qCands.push({ qObj, qVal });
  }
  qCands.sort((a, b) => b.qVal - a.qVal);

  const qCutFoundParents = new Set();
  for (const { qObj, qVal } of qCands) {
    const { exactCutWeight, cutIdxs } = findMinVertexCutDinicMulti(
      n,
      model.adj,
      xVals,
      qObj.parentIdx,
      qObj.candTownIdxs
    );
    const violation = qVal - exactCutWeight;
    if (cutIdxs.length > 0 && violation > eps) {
      cutIdxs.sort((a, b) => a - b);
      const signature = `${qObj.name}|${cutIdxs.join(',')}`;
      if (!existingSigSet.has(signature)) {
        qCutFoundParents.add(qObj.parentIdx);
        found.push({
          round,
          kind: 'LP',
          rhsTerms: [qObj.name],
          yKey: `q_${qObj.parentIdx}`,
          yName: qObj.name,
          parentId: qObj.parentId,
          parentIdx: qObj.parentIdx,
          townId: 'ALL',
          townIdx: -1,
          cutIdxs,
          cutNodeIds: cutIdxs.map((i) => model.roadIds[i]),
          violation: Number(violation.toFixed(4)),
          signature,
          priority: 2,
        });
      }
    }
  }

  // Tier 2: Lifted subset cuts on fractional multi-town plantzone splits
  for (const pz of model.plantzones) {
    if (qCutFoundParents.has(pz.parentIdx)) continue;
    const activeTownIdxs = [];
    let sumZ = 0;
    let touchesDirectTown = false;

    for (const zi of pz.zIndices) {
      const z = model.zVars[zi];
      const val = Number(solutionCols[z.name]?.Primal) || 0;
      if (val > 1e-4) {
        sumZ += val;
        if (z.townIdx === pz.parentIdx || model.adjSet[pz.parentIdx].has(z.townIdx)) {
          touchesDirectTown = true;
          break;
        }
        activeTownIdxs.push(z.townIdx);
      }
    }

    if (touchesDirectTown || activeTownIdxs.length < 2 || sumZ <= eps) continue;

    const { exactCutWeight, cutIdxs } = findMinVertexCutDinicMulti(
      n,
      model.adj,
      xVals,
      pz.parentIdx,
      activeTownIdxs
    );
    const violation = sumZ - exactCutWeight;
    if (cutIdxs.length > 0 && violation > eps) {
      cutIdxs.sort((a, b) => a - b);
      const vis = bfsWithoutCut(n, model.adj, pz.parentIdx, cutIdxs);

      const qObj = model.qByParentIdx.get(pz.parentIdx);
      const separatesAllCand =
        qObj && qObj.candTownIdxs.every((ti) => !vis[ti]);

      if (separatesAllCand) {
        const qVal = Number(solutionCols[qObj.name]?.Primal) || 0;
        const signature = `${qObj.name}|${cutIdxs.join(',')}`;
        if (!existingSigSet.has(signature)) {
          found.push({
            round,
            kind: 'LP',
            rhsTerms: [qObj.name],
            yKey: `q_${qObj.parentIdx}`,
            yName: qObj.name,
            parentId: qObj.parentId,
            parentIdx: qObj.parentIdx,
            townId: 'ALL',
            townIdx: -1,
            cutIdxs,
            cutNodeIds: cutIdxs.map((i) => model.roadIds[i]),
            violation: Number(Math.max(violation, qVal - exactCutWeight).toFixed(4)),
            signature,
            priority: 2,
          });
        }
      } else {
        const liftedZNames = [];
        let liftedSum = 0;
        for (const zi of pz.zIndices) {
          const z = model.zVars[zi];
          if (!vis[z.townIdx]) {
            liftedZNames.push(z.name);
            liftedSum += Number(solutionCols[z.name]?.Primal) || 0;
          }
        }
        liftedZNames.sort();
        const liftedViol = liftedSum - exactCutWeight;
        const signature = `sub_${liftedZNames.join('+')}|${cutIdxs.join(',')}`;
        if (liftedZNames.length >= 2 && liftedViol > eps && !existingSigSet.has(signature)) {
          found.push({
            round,
            kind: 'LP',
            rhsTerms: liftedZNames,
            yKey: `sub_${pz.pzId}`,
            yName: liftedZNames.join(' + '),
            parentId: pz.parentId,
            parentIdx: pz.parentIdx,
            townId: 'ALL',
            townIdx: -1,
            cutIdxs,
            cutNodeIds: cutIdxs.map((i) => model.roadIds[i]),
            violation: Number(liftedViol.toFixed(4)),
            signature,
            priority: 1,
          });
        }
      }
    }
  }

  // Tier 3: Per-(parent, town) singleton cuts
  const yCands = [];
  for (const y of model.yVars) {
    if (y.isDirect) continue;
    const yVal = Number(solutionCols[y.name]?.Primal) || 0;
    if (yVal > eps) yCands.push({ y, yVal });
  }
  yCands.sort((a, b) => b.yVal - a.yVal);

  for (const { y, yVal } of yCands) {
    const { exactCutWeight, cutIdxs } = findMinVertexCutDinicMulti(
      n,
      model.adj,
      xVals,
      y.parentIdx,
      [y.townIdx]
    );
    const violation = yVal - exactCutWeight;
    if (cutIdxs.length > 0 && violation > eps) {
      cutIdxs.sort((a, b) => a - b);
      const signature = `${y.key}|${cutIdxs.join(',')}`;
      if (!existingSigSet.has(signature)) {
        found.push({
          round,
          kind: 'LP',
          rhsTerms: [y.name],
          yKey: y.key,
          yName: y.name,
          parentId: y.parentId,
          parentIdx: y.parentIdx,
          townId: y.townId,
          townIdx: y.townIdx,
          cutIdxs,
          cutNodeIds: cutIdxs.map((i) => model.roadIds[i]),
          violation: Number(violation.toFixed(4)),
          signature,
          priority: 0,
        });
      }
    }
  }

  found.sort((a, b) => b.priority - a.priority || b.violation - a.violation);
  const selected = [];
  for (const c of found) {
    if (existingSigSet.has(c.signature)) continue;
    existingSigSet.add(c.signature);
    c.id = `lp_r${round}_${selected.length}`;
    delete c.priority;
    selected.push(c);
    if (selected.length >= maxCutsPerRound) break;
  }

  return selected;
}

/**
 * Purges strictly slack LP/INIT cuts using the current LP primal solution.
 */
export function pruneSlackCuts(model, cuts, sigSet, solutionCols, slackTol = 0.02) {
  if (!solutionCols) return { keptCuts: cuts, removedCount: 0 };

  const keptCuts = [];
  let removedCount = 0;

  for (const c of cuts) {
    if (c.kind === 'INT') {
      keptCuts.push(c);
      continue;
    }

    let lhs = 0;
    for (let i = 0; i < c.cutNodeIds.length; i++) {
      const id = c.cutNodeIds[i];
      const idx = model.idToIdx.get(id);
      lhs += idx !== undefined && model.isTownIdx[idx]
        ? 1
        : Number(solutionCols[`x_${id}`]?.Primal) || 0;
    }

    let rhs = 0;
    const rhsTerms = c.rhsTerms && c.rhsTerms.length ? c.rhsTerms : [c.yName];
    for (let i = 0; i < rhsTerms.length; i++) {
      rhs += Number(solutionCols[rhsTerms[i]]?.Primal) || 0;
    }

    if (lhs - rhs <= slackTol) {
      keptCuts.push(c);
    } else {
      removedCount++;
    }
  }

  if (removedCount > 0) {
    sigSet.clear();
    for (const c of keptCuts) sigSet.add(c.signature);
  }

  return { keptCuts, removedCount };
}

/**
 * Separates vertex-disjoint multi-layer minimal vertex cuts (up to 3 layers) from an integer MIP solution.
 */
export function separateIntegerCuts(model, solutionCols, existingSigSet, round, maxLayers = 3) {
  const n = model.roadIds.length;
  const active = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (model.isTownIdx[i]) {
      active[i] = 1;
    } else {
      active[i] = (Number(solutionCols[`x_${model.roadIds[i]}`]?.Primal) || 0) > 0.5 ? 1 : 0;
    }
  }

  const requiredByTown = new Map();
  for (const y of model.yVars) {
    if (y.isDirect) continue;
    let isAssigned = false;
    for (const zi of y.zIndices) {
      if ((Number(solutionCols[model.zVars[zi].name]?.Primal) || 0) > 0.5) {
        isAssigned = true;
        break;
      }
    }
    if (!isAssigned) continue;
    if (!requiredByTown.has(y.townIdx)) requiredByTown.set(y.townIdx, []);
    requiredByTown.get(y.townIdx).push(y);
  }

  const newCuts = [];
  const q = new Int32Array(n);

  function bfsActive(startIdx) {
    const vis = new Uint8Array(n);
    if (!active[startIdx]) return vis;
    let h = 0;
    let t = 0;
    vis[startIdx] = 1;
    q[t++] = startIdx;
    while (h < t) {
      const u = q[h++];
      for (const v of model.adj[u]) {
        if (active[v] && !vis[v]) {
          vis[v] = 1;
          q[t++] = v;
        }
      }
    }
    return vis;
  }

  function absorbActiveFrom(baseComp, seedNodes) {
    const nextComp = new Uint8Array(baseComp);
    let h = 0;
    let t = 0;
    for (let i = 0; i < seedNodes.length; i++) {
      const s = seedNodes[i];
      if (!nextComp[s]) {
        nextComp[s] = 1;
        q[t++] = s;
      }
    }
    while (h < t) {
      const u = q[h++];
      for (const v of model.adj[u]) {
        if (active[v] && !nextComp[v]) {
          nextComp[v] = 1;
          q[t++] = v;
        }
      }
    }
    return nextComp;
  }

  function minimalSeparatorMulti(compStart, targetIdxs) {
    const blocked = new Uint8Array(n);
    const bnd = [];
    for (let u = 0; u < n; u++) {
      if (!compStart[u]) continue;
      for (const v of model.adj[u]) {
        if (!compStart[v] && !blocked[v]) {
          blocked[v] = 1;
          bnd.push(v);
        }
      }
    }

    const reachT = new Uint8Array(n);
    let h = 0;
    let t = 0;
    for (let i = 0; i < targetIdxs.length; i++) {
      const ti = targetIdxs[i];
      if (!blocked[ti] && !compStart[ti] && !reachT[ti]) {
        reachT[ti] = 1;
        q[t++] = ti;
      }
    }
    while (h < t) {
      const u = q[h++];
      for (const v of model.adj[u]) {
        if (!blocked[v] && !reachT[v]) {
          reachT[v] = 1;
          q[t++] = v;
        }
      }
    }

    const minimal = [];
    for (const w of bnd) {
      for (const nb of model.adj[w]) {
        if (reachT[nb]) {
          minimal.push(w);
          break;
        }
      }
    }
    minimal.sort((a, b) => a - b);
    return minimal;
  }

  for (const [townIdx, yList] of requiredByTown.entries()) {
    const compT = bfsActive(townIdx);

    for (const y of yList) {
      if (compT[y.parentIdx]) continue; // Already connected

      const compU = bfsActive(y.parentIdx);
      const qObj = model.qByParentIdx.get(y.parentIdx);
      const useQCut = Boolean(qObj && !qObj.candTownIdxs.some((ti) => compU[ti] === 1));
      const targets = useQCut ? qObj.candTownIdxs : [townIdx];

      let curComp = compU;
      for (let layer = 0; layer < maxLayers; layer++) {
        const cut = minimalSeparatorMulti(curComp, targets);
        if (cut.length === 0) break;
        if (layer > 0 && cut.length > 8) break;

        const sigPrefix = useQCut ? qObj.name : y.key;
        const sig = `${sigPrefix}|${cut.join(',')}`;
        if (!existingSigSet.has(sig)) {
          existingSigSet.add(sig);
          newCuts.push({
            id: `int_r${round}_L${layer}_${newCuts.length}`,
            round,
            kind: 'INT',
            rhsTerms: [useQCut ? qObj.name : y.name],
            yKey: useQCut ? `q_${qObj.parentIdx}` : y.key,
            yName: useQCut ? qObj.name : y.name,
            parentId: y.parentId,
            parentIdx: y.parentIdx,
            townId: useQCut ? 'ALL' : y.townId,
            townIdx: useQCut ? -1 : y.townIdx,
            cutIdxs: cut,
            cutNodeIds: cut.map((i) => model.roadIds[i]),
            violation: 1.0,
            signature: sig,
          });
        }

        if (layer + 1 >= maxLayers || cut.length > 8) break;
        curComp = absorbActiveFrom(curComp, cut);
        if (targets.some((ti) => curComp[ti] === 1)) break;
      }
    }
  }

  return newCuts;
}

/**
 * Summarizes fractionality, CP spent, and town worker usage from HiGHS Columns.
 */
export function summarizeSolution(model, cols) {
  let fracX = 0;
  let fracZ = 0;
  let boughtRoads = 0;
  let roadCpSpent = 0;
  let pzCpSpent = 0;
  let totalProfit = 0;
  let assignedPzs = 0;

  const townUsage = new Map(model.towns.map((t) => [t.id, { ...t, used: 0, profit: 0 }]));

  for (let i = 0; i < model.roadIds.length; i++) {
    if (model.isTownIdx[i]) continue;
    const val = Number(cols[`x_${model.roadIds[i]}`]?.Primal) || 0;
    if (val > 1e-4 && val < 1 - 1e-4) fracX++;
    if (val > 0.5) boughtRoads++;
    roadCpSpent += val * model.roadCP[i];
  }

  for (const z of model.zVars) {
    const val = Number(cols[z.name]?.Primal) || 0;
    if (val > 1e-4 && val < 1 - 1e-4) fracZ++;
    if (val > 0.5) assignedPzs++;
    pzCpSpent += val * z.pzCP;
    totalProfit += val * z.profit;
    if (val > 1e-4) {
      const tu = townUsage.get(z.townId);
      if (tu) {
        tu.used += val;
        tu.profit += val * z.profit;
      }
    }
  }

  return {
    fracX,
    fracZ,
    boughtRoads,
    assignedPzs,
    roadCpSpent: Number(roadCpSpent.toFixed(2)),
    pzCpSpent: Number(pzCpSpent.toFixed(2)),
    totalCpSpent: Number((roadCpSpent + pzCpSpent).toFixed(2)),
    totalProfit: Number(totalProfit.toFixed(3)),
    townUsage: [...townUsage.values()].filter((t) => t.used > 0.01).sort((a, b) => b.profit - a.profit),
  };
}

/**
 * Parses HiGHS stdout lines to extract presolve size, B&B nodes, LP iterations, and MIP gap.
 */
export function parseHighsLog(lines) {
  let presolveRows = null;
  let presolveCols = null;
  let presolveNonzeros = null;
  let bbNodes = null;
  let lpIters = null;
  let mipGapPct = null;
  let bestBound = null;

  for (const raw of lines) {
    const line = String(raw || '');

    const mPres =
      line.match(/^\s*(\d+)\s+rows,\s*(\d+)\s+cols,\s*(\d+)\s+nonzeros/i) ||
      line.match(/Presolve\s*:\s*(\d+)\s+rows.*?(\d+)\s+cols/i) ||
      line.match(/Reduced (?:LP|MIP) has (\d+) rows,\s*(\d+) columns?,\s*(\d+) nonzeros?/i);
    if (mPres) {
      presolveRows = Number(mPres[1]);
      presolveCols = Number(mPres[2]);
      if (mPres[3]) presolveNonzeros = Number(mPres[3]);
    }

    const mNodes = line.match(/^\s*(?:MIP\s+)?Nodes\s*[:=]?\s*(\d+)/i);
    if (mNodes) bbNodes = Number(mNodes[1]);

    const mIter = line.match(/^\s*(?:LP|Simplex)\s+iterations\s*[:=]?\s*(\d+)/i);
    if (mIter) lpIters = Number(mIter[1]);

    const mGap = line.match(/Gap\s*[:=]?\s*([\d.]+)%/i);
    if (mGap) mipGapPct = Number(mGap[1]);

    const mTable = line.match(
      /^\s*(?:[A-Za-z*]\s+)?(\d+)\s+(\d+)\s+\d+\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?|inf|-inf)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?|inf|-inf)\s+([\d.]+)%\s+(\d+)/i
    );
    if (mTable) {
      bbNodes = Number(mTable[1]);
      const bnd = Number(mTable[3]);
      if (Number.isFinite(bnd)) bestBound = bnd;
      mipGapPct = Number(mTable[5]);
      lpIters = Number(mTable[6]);
    }
  }

  return {
    presolveRows,
    presolveCols,
    presolveNonzeros,
    bbNodes,
    lpIters,
    mipGapPct,
    bestBound,
  };
}