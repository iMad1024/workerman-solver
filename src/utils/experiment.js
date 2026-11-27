// src/utils/experiment.js
import { runGraphReduction, buildContractedDpTree } from './graphReduction';
import SteinerDpWorker from '../workers/steinerDp.worker.js?worker';

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

function hashSeedToUint32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function generateRandomSeedHex() {
  return Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')
    .toUpperCase();
}

/**
 * Collects all valid non-plantzone, non-town road nodes (excluding cleanup kinds 10, 12, 13)
 * that can serve as unassigned ("free") targets.
 */
export function buildNonPlantzonePool({ links, nodes, baseTownSet }) {
  return Object.keys(links || {})
    .map(Number)
    .filter((u) => {
      if (!Number.isFinite(u) || baseTownSet.has(u)) return false;
      const node = nodes?.[String(u)];
      if (!node || node.is_plantzone) return false;
      if (node.CP === 0 && (node.kind === 10 || node.kind === 13)) return false;
      return true;
    })
    .sort((a, b) => a - b);
}


/**
 * Generates a deterministic instance matching graphStore.buildSeededInstance(),
 * plus `freeTargetCount` unassigned non-plantzone targets drawn by reusing `seed`.
 */
export function buildExperimentInstance({
  seed,
  targetMode,
  targetK,
  sourceMode,
  sourceParam,
  freeTargetCount,
  env,
}) {
  const {
    nodes,
    allPzProfit,
    plantzoneSet,
    baseTownSet,
    sortedPlantzonesByEfficiency,
    nonPlantzonePool,
  } = env;

  const seedUint = hashSeedToUint32(seed);
  const rng = mulberry32(seedUint);
  const totalPz = plantzoneSet.size;
  const kTargets = Math.max(0, Math.min(totalPz, Math.floor(Number(targetK) || 0)));

  let selectedTargets = [];
  if (kTargets > 0) {
    if (targetMode === 'topk') {
      selectedTargets = sortedPlantzonesByEfficiency.slice(0, kTargets);
    } else {
      const pool = [...plantzoneSet];
      const shuffleRng = mulberry32(seedUint);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(shuffleRng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      selectedTargets = pool.slice(0, kTargets);
    }
  }

  const townCount = baseTownSet.size;
  const targetMeta = selectedTargets.map((pz) => {
    const targetId = typeof pz === 'object' ? Number(pz.id) : Number(pz);
    const targetStr = String(targetId);
    const altTowns = Array.isArray(allPzProfit[targetStr]?.alt_towns)
      ? allPzProfit[targetStr].alt_towns
      : [];
    return { targetId, altTowns };
  });

  let assignments = [];

  if (sourceMode === 'closest' && townCount > 0) {
    const kSources = Math.max(1, Math.min(townCount || 30, Math.round(Number(sourceParam) || 1)));
    assignments = targetMeta.map(({ targetId, altTowns }) => {
      if (altTowns.length === 0) return { targetId, sourceId: null };
      const poolLen = Math.min(kSources, altTowns.length);
      const chosenEntry = altTowns[Math.floor(rng() * poolLen)];
      const sourceId = chosenEntry?.tnk != null ? Number(chosenEntry.tnk) : null;
      return { targetId, sourceId };
    });
  } else if (sourceMode === 'stable' || sourceMode === 'rings') {
    const rThreshold = Math.max(1.0, Number(sourceParam) || 1.0);
    const candidateTownSet = new Set(baseTownSet);
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
      return {
        targetId,
        sourceId: match && match.sourceId !== null ? match.sourceId : null,
      };
    });
  } else {
    assignments = targetMeta.map(({ targetId }) => ({ targetId, sourceId: null }));
  }

  // Re-use the same seed to permute non-plantzone road nodes and select the first m free targets
  const mFree = Math.max(0, Math.min(nonPlantzonePool.length, Math.floor(Number(freeTargetCount) || 0)));
  const targets = [...selectedTargets];
  if (mFree > 0) {
    const freePool = [...nonPlantzonePool];
    const freeRng = mulberry32(seedUint);
    for (let i = freePool.length - 1; i > 0; i--) {
      const j = Math.floor(freeRng() * (i + 1));
      [freePool[i], freePool[j]] = [freePool[j], freePool[i]];
    }
    const chosenFree = freePool.slice(0, mFree);
    const targetSet = new Set(targets.map(Number));
    for (const nodeId of chosenFree) {
      if (!targetSet.has(nodeId)) {
        targetSet.add(nodeId);
        targets.push(nodeId);
        assignments.push({ targetId: nodeId, sourceId: null });
      }
    }
  }

  return {
    sourceType: 'experiment',
    seed,
    targets,
    assignments,
  };
}

let workerRunSeq = 1;

function solveInIsolatedWorker(payload, { shouldAbort, registerWorker }) {
  return new Promise((resolve, reject) => {
    if (shouldAbort?.()) {
      resolve(null);
      return;
    }

    const worker = new SteinerDpWorker();
    const runId = ++workerRunSeq;
    let settled = false;

    const cleanup = () => {
      registerWorker?.(null);
      try {
        worker.terminate();
      } catch {}
    };

    registerWorker?.(worker, () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(null);
      }
    });

    worker.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.runId !== runId) return;
      if (msg.type === 'done') {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(msg.result);
        }
      } else if (msg.type === 'error') {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(msg.error || 'DP worker error'));
        }
      }
    };

    worker.onerror = (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    };

    worker.postMessage({
      runId,
      ...payload,
    });
  });
}

function calcGap(cost, optCp) {
  if (cost == null || optCp == null || !Number.isFinite(cost) || !Number.isFinite(optCp)) {
    return { cp: null, pct: null };
  }
  const cp = Number((cost - optCp).toFixed(2));
  const pct = optCp > 0 ? (cp / optCp) * 100 : (cp === 0 ? 0 : null);
  return { cp, pct };
}

export function formatGapDisplay(cp, pct, certifiedExact = true) {
  if (cp == null) return 'N/A';
  const sign = cp > 0 ? '+' : '';
  const pctStr = pct != null ? `${pct.toFixed(2)}%` : '—';
  return `${sign}${cp} (${pctStr})${certifiedExact ? '' : '*'}`;
}

export function formatMsDisplay(ms, oom = false) {
  if (ms == null || !Number.isFinite(ms)) return 'N/A';
  const val = `${Number(ms).toFixed(1)}ms`;
  return oom ? `OOM(${val})` : val;
}

/**
 * Computes the canonical partition of `snap.targets` into connected components
 * within the subgraph of `snap.graph` induced by `selectedVertices`.
 */
function computeTargetComponents(selectedVertices, snap) {
  if (!Array.isArray(selectedVertices) || !snap?.graph) return null;

  const targets = [...new Set((snap.targets || []).map(Number))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (targets.length === 0) {
    return { key: '', count: 0, components: [] };
  }

  const selSet = new Set(selectedVertices.map(Number));
  const graph = snap.graph;
  const visited = new Set();
  const compOf = new Map();
  let nextCompId = 0;

  for (const start of selSet) {
    if (visited.has(start)) continue;
    const cid = nextCompId++;
    const queue = [start];
    visited.add(start);
    compOf.set(start, cid);

    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const nbrs = graph[u] ?? graph[String(u)] ?? [];
      for (const rawV of nbrs) {
        const v = Number(rawV);
        if (selSet.has(v) && !visited.has(v)) {
          visited.add(v);
          compOf.set(v, cid);
          queue.push(v);
        }
      }
    }
  }

  const buckets = new Map();
  for (const t of targets) {
    const cid = compOf.has(t) ? compOf.get(t) : -(t + 1);
    if (!buckets.has(cid)) buckets.set(cid, []);
    buckets.get(cid).push(t);
  }

  const components = [...buckets.values()]
    .map((arr) => arr.sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0]);

  const key = components.map((c) => c.join(',')).join('|');
  return {
    key,
    count: components.length,
    components,
  };
}

function formatBoolCell(val) {
  if (val === true) return 'YES';
  if (val === false) return 'NO';
  return 'N/A';
}

function formatCompCounts(r) {
  const c1k = r.compCount1k ?? '-';
  const cPol = r.compCountPolish ?? '-';
  const cEx = r.compCountExact ?? '-';
  return `${c1k}/${cPol}/${cEx}`;
}

/**
 * Runs a full batch experiment sequentially inside isolated workers.
 */
export async function runBatchExperiment({
  config,
  env,
  onProgress,
  onRowComplete,
  shouldAbort,
  registerWorker,
}) {
  const batchSize = Math.max(1, Math.min(10000, Math.floor(Number(config.batchSize) || 1)));
  const rows = [];

  for (let i = 0; i < batchSize; i++) {
    if (shouldAbort?.()) break;

    const seed = generateRandomSeedHex();
    onProgress?.({
      index: i + 1,
      total: batchSize,
      seed,
      phase: 'REDUCE',
    });

    const instance = buildExperimentInstance({
      seed,
      targetMode: config.targetMode,
      targetK: config.targetK,
      sourceMode: config.sourceMode,
      sourceParam: config.sourceParam,
      freeTargetCount: config.freeTargetCount,
      env,
    });

    const tPre0 = performance.now();
    const { steps, decomposition } = runGraphReduction({
      links: env.links,
      nodes: env.nodes,
      plantzoneStatic: env.plantzoneStatic,
      townSet: env.baseTownSet,
      plantzoneSet: env.plantzoneSet,
      instance,
    });

    const finalSnap = steps[steps.length - 1];
    const fullTd = decomposition;
    const contractedTd = buildContractedDpTree(fullTd, { binaryJoins: true });
    const preprocMs = Number((performance.now() - tPre0).toFixed(1));
    const targetNodeId = contractedTd?.rootId ?? 0;

    const plainContracted = JSON.parse(JSON.stringify(contractedTd));
    const plainFull = fullTd ? JSON.parse(JSON.stringify(fullTd)) : null;
    const plainSnap = JSON.parse(JSON.stringify(finalSnap));

    // 1. Run EXACT (GRD)
    onProgress?.({
      index: i + 1,
      total: batchSize,
      seed,
      phase: 'EXACT (GRD)',
    });
    const resGrd = await solveInIsolatedWorker(
      {
        contractedTd: plainContracted,
        fullTd: plainFull,
        snap: plainSnap,
        targetNodeId,
        options: {
          maxStates: Infinity,
          useHeuristicAdvice: true,
          ladderMode: 'greedy',
        },
      },
      { shouldAbort, registerWorker }
    );
    if (!resGrd || shouldAbort?.()) break;

    // 2. Run EXACT (1K)
    onProgress?.({
      index: i + 1,
      total: batchSize,
      seed,
      phase: 'EXACT (1K)',
    });
    const res1k = await solveInIsolatedWorker(
      {
        contractedTd: plainContracted,
        fullTd: plainFull,
        snap: plainSnap,
        targetNodeId,
        options: {
          maxStates: Infinity,
          useHeuristicAdvice: true,
          ladderMode: '1k',
        },
      },
      { shouldAbort, registerWorker }
    );
    if (!res1k || shouldAbort?.()) break;

    // Extract metrics
    const exactGrdMs = Number(resGrd.totalElapsedMs ?? 0);
    const exactGrdOom = Boolean(resGrd.memoryLimitHit);
    const exactGrdIsExact = Boolean(resGrd.isExact && !exactGrdOom);
    const exactGrdCost = resGrd.bagMergeStats?.minCost ?? null;

    const exact1kMs = Number(res1k.totalElapsedMs ?? 0);
    const exact1kOom = Boolean(res1k.memoryLimitHit);
    const exact1kIsExact = Boolean(res1k.isExact && !exact1kOom);
    const exact1kCost = res1k.bagMergeStats?.minCost ?? null;

    const stGreedy = resGrd.heuristicStages?.find((s) => s.label === 'GREEDY');
    const greedyMs = stGreedy ? Number(stGreedy.ms) : 0;
    const greedyCost = stGreedy?.cost ?? exactGrdCost;

    const st1k = res1k.heuristicStages?.find((s) => s.label === 'HEUR 1K');
    const stPolish = res1k.heuristicStages?.find((s) => s.label === 'POLISH');
    const oneKPolishMs =
      st1k || stPolish
        ? Number(((Number(st1k?.ms) || 0) + (Number(stPolish?.ms) || 0)).toFixed(1))
        : 0;

    const oneKCandidates = [stPolish?.cost, st1k?.cost].filter(
      (v) => v != null && Number.isFinite(v)
    );
    const oneKPolishCost =
      oneKCandidates.length > 0 ? Math.min(...oneKCandidates) : exact1kCost;

    const exactCosts = [];
    if (exactGrdIsExact && exactGrdCost != null) exactCosts.push(exactGrdCost);
    if (exact1kIsExact && exact1kCost != null) exactCosts.push(exact1kCost);

    const certifiedExact = exactCosts.length > 0;
    const mismatch =
      exactCosts.length === 2 && Math.abs(exactCosts[0] - exactCosts[1]) > 1e-6;
    if (mismatch) {
      console.warn(
        `[Experiment] Optimal CP mismatch on seed ${seed}: GRD=${exactCosts[0]}, 1K=${exactCosts[1]}`
      );
    }

    let optimalCp = null;
    if (exactCosts.length > 0) {
      optimalCp = Math.min(...exactCosts);
    } else {
      const allCosts = [exactGrdCost, exact1kCost, oneKPolishCost, greedyCost].filter(
        (v) => v != null && Number.isFinite(v)
      );
      if (allCosts.length > 0) optimalCp = Math.min(...allCosts);
    }

    const greedyGap = calcGap(greedyCost, optimalCp);
    const oneKPolishGap = calcGap(oneKPolishCost, optimalCp);

    // Extract per-stage selected vertices and compare target connected components
    const sol1kEntry = res1k.allSolutions?.find(
      (s) => s.label === 'HEUR 1K' || s.label === '1K'
    );
    const solPolishEntry = res1k.allSolutions?.find((s) => s.label === 'POLISH');

    const sol1kVerts = sol1kEntry?.selectedVertices ?? st1k?.selectedVertices ?? null;
    // If POLISH kept 1K's solution without emitting a separate entry, fall back to 1K's vertices
    const solPolishVerts =
      solPolishEntry?.selectedVertices ?? stPolish?.selectedVertices ?? sol1kVerts;

    const solExact1kVerts = exact1kIsExact
      ? (res1k.allSolutions?.find((s) => s.isExact)?.selectedVertices ??
          res1k.selectedVertices ??
          null)
      : null;
    const solExactGrdVerts = exactGrdIsExact
      ? (resGrd.allSolutions?.find((s) => s.isExact)?.selectedVertices ??
          resGrd.selectedVertices ??
          null)
      : null;

    const comp1k = computeTargetComponents(sol1kVerts, finalSnap);
    const compPolish = computeTargetComponents(solPolishVerts, finalSnap);
    const compExact = computeTargetComponents(
      solExact1kVerts ?? solExactGrdVerts,
      finalSnap
    );
    const compExactAlt =
      solExact1kVerts && solExactGrdVerts
        ? computeTargetComponents(solExactGrdVerts, finalSnap)
        : null;

    const matchesExactComp = (comp) => {
      if (!comp || !compExact) return null;
      if (comp.key === compExact.key) return true;
      if (compExactAlt && comp.key === compExactAlt.key) return true;
      return false;
    };

    const grp1kEqPol =
      comp1k && compPolish ? comp1k.key === compPolish.key : null;
    const grp1kEqExact = matchesExactComp(comp1k);
    const grpPolEqExact = matchesExactComp(compPolish);

    const row = {
      index: i + 1,
      seed,
      exactGrdMs,
      exactGrdOom,
      exactGrdIsExact,
      exact1kMs,
      exact1kOom,
      exact1kIsExact,
      oneKPolishMs,
      greedyMs,
      preprocMs,
      optimalCp,
      certifiedExact,
      mismatch,
      greedyCost,
      greedyGapCp: greedyGap.cp,
      greedyGapPct: greedyGap.pct,
      oneKPolishCost,
      oneKPolishGapCp: oneKPolishGap.cp,
      oneKPolishGapPct: oneKPolishGap.pct,
      grp1kEqPol,
      grp1kEqExact,
      grpPolEqExact,
      compCount1k: comp1k?.count ?? null,
      compCountPolish: compPolish?.count ?? null,
      compCountExact: compExact?.count ?? null,
    };

    rows.push(row);
    onRowComplete?.(row, [...rows]);
  }

  return rows;
}

function formatSourceParam(config) {
  if (config.sourceMode === 'stable' || config.sourceMode === 'rings') {
    return Number(config.sourceParam).toFixed(2);
  }
  return String(Math.round(Number(config.sourceParam) || 1));
}

/**
 * Returns separate formatted text blocks so the popup can pin metadata,
 * column headers, and summary while scrolling only the middle rows.
 */
export function formatExperimentReportParts(config, rows) {
  const targetModeLabel = config.targetMode === 'topk' ? 'topk' : 'random';
  const isStable = config.sourceMode === 'stable' || config.sourceMode === 'rings';
  const sourceModeLabel = isStable ? 'stable' : 'closest';
  const sourceParamStr = formatSourceParam(config);

  const metaText = [
    `Batch Size       : ${config.batchSize} (completed: ${rows.length})`,
    `Target Mode      : ${targetModeLabel} | k = ${config.targetK}`,
    `Source Mode      : ${sourceModeLabel} | ${isStable ? 'r' : 'k'} = ${sourceParamStr}`,
    `# of Free Target : ${config.freeTargetCount}`,
  ].join('\n');

  const headers = [
    '#',
    'Seed',
    'Exact Time (GRD)',
    'Exact Time (1k)',
    '1k + polish Time',
    'Greedy Time',
    'Preproc Time',
    'Optimal CP',
    'Greedy vs Opt',
    '1k + polish vs Opt',
    '1k=Pol',
    '1k=Ex',
    'Pol=Ex',
    '#Comp(1k/P/Ex)',
  ];

  const bodyRows = rows.map((r) => [
    String(r.index),
    r.seed,
    formatMsDisplay(r.exactGrdMs, r.exactGrdOom),
    formatMsDisplay(r.exact1kMs, r.exact1kOom),
    formatMsDisplay(r.oneKPolishMs, false),
    formatMsDisplay(r.greedyMs, false),
    formatMsDisplay(r.preprocMs, false),
    r.optimalCp != null
      ? `${r.optimalCp}${r.certifiedExact ? '' : '*'}${r.mismatch ? '⚠' : ''}`
      : 'N/A',
    formatGapDisplay(r.greedyGapCp, r.greedyGapPct, r.certifiedExact),
    formatGapDisplay(r.oneKPolishGapCp, r.oneKPolishGapPct, r.certifiedExact),
    formatBoolCell(r.grp1kEqPol),
    formatBoolCell(r.grp1kEqExact),
    formatBoolCell(r.grpPolEqExact),
    formatCompCounts(r),
  ]);

  // Keep column 0 wide enough for large batches (min 6 chars, e.g. up to 999999)
  const minIndexWidth = Math.max(6, String(config.batchSize || 1).length);
  const minColWidths = [minIndexWidth, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  const colWidths = headers.map((h, ci) =>
    Math.max(h.length, minColWidths[ci] || 0, ...bodyRows.map((row) => row[ci].length))
  );

  const padRow = (cols) =>
    cols
      .map((val, ci) => (ci === 1 ? val.padEnd(colWidths[ci]) : val.padStart(colWidths[ci])))
      .join(' | ');

  const headerLine = padRow(headers);
  const sepLine = colWidths.map((w) => '-'.repeat(w)).join('-+-');
  const headerText = `${headerLine}\n${sepLine}`;
  const rowsText = bodyRows.length > 0 ? bodyRows.map(padRow).join('\n') : '(no results yet)';

  let summaryText = '';
  if (rows.length > 0) {
    const avg = (arr) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const grdOk = rows.filter((r) => !r.exactGrdOom);
    const oneKOk = rows.filter((r) => !r.exact1kOom);
    const greedyZero = rows.filter((r) => r.greedyGapCp === 0).length;
    const polishZero = rows.filter((r) => r.oneKPolishGapCp === 0).length;
    const exactGrpRows = rows.filter((r) => r.grp1kEqExact !== null);
    const grp1kMatch = exactGrpRows.filter((r) => r.grp1kEqExact === true).length;
    const grpPolMatch = exactGrpRows.filter((r) => r.grpPolEqExact === true).length;
    const grpPolChanged = rows.filter((r) => r.grp1kEqPol === false).length;

    summaryText =
      `Summary (${rows.length}): ` +
      `Avg GRD=${avg(grdOk.map((r) => r.exactGrdMs)).toFixed(1)}ms (${grdOk.length}/${rows.length} exact) | ` +
      `Avg 1K-Exact=${avg(oneKOk.map((r) => r.exact1kMs)).toFixed(1)}ms (${oneKOk.length}/${rows.length} exact) | ` +
      `Avg 1K+Pol=${avg(rows.map((r) => r.oneKPolishMs)).toFixed(1)}ms | ` +
      `Avg Preproc=${avg(rows.map((r) => r.preprocMs || 0)).toFixed(1)}ms | ` +
      `Greedy 0-gap=${greedyZero}/${rows.length} | ` +
      `1K+Pol 0-gap=${polishZero}/${rows.length}` +
      ` | Grp 1K=Ex=${grp1kMatch}/${exactGrpRows.length}` +
      ` | Pol=Ex=${grpPolMatch}/${exactGrpRows.length}` +
      ` | 1K≠Pol=${grpPolChanged}/${rows.length}`;
  } else {
    summaryText = 'Summary (0): Waiting for first completed instance...';
  }

  return { metaText, headerText, rowsText, summaryText };
}

export function formatExperimentTextTable(config, rows) {
  const { metaText, headerText, rowsText, summaryText } = formatExperimentReportParts(config, rows);
  return `${metaText}\n\n${headerText}\n${rowsText}\n\n${summaryText}`;
}

function formatGapForSheets(cp, pct, certifiedExact = true) {
  if (cp == null) return 'N/A';
  const pctStr = pct != null ? `${pct.toFixed(2)}%` : '—';
  // Omit leading '+' so Google Sheets does not treat the cell as a formula (#ERROR!)
  return `${cp} (${pctStr})${certifiedExact ? '' : '*'}`;
}

function buildExperimentExportTable(config, rows, { forSheets = false } = {}) {
  const sourceParamStr = formatSourceParam(config);
  const targetModeLabel = config.targetMode === 'topk' ? 'topk' : 'random';
  const sourceModeLabel =
    config.sourceMode === 'stable' || config.sourceMode === 'rings' ? 'stable' : 'closest';
  const headers = [
    'seed',
    'target mode',
    'target parameter',
    'source mode',
    'source parameter',
    '# of free target',
    'Exact time (GRD)',
    'Exact time (1k)',
    '1k + polish Time',
    'Greedy Time',
    'Preproc Time',
    'Optimal CP',
    'Greedy vs Opt',
    '1k + polish vs Opt',
    '1k=Pol',
    '1k=Ex',
    'Pol=Ex',
    '#Comp(1k/P/Ex)',
  ];

  const gapFmt = forSheets ? formatGapForSheets : formatGapDisplay;

  const dataRows = rows.map((r) => [
    forSheets ? `'${r.seed}` : r.seed,
    targetModeLabel,
    config.targetK,
    sourceModeLabel,
    sourceParamStr,
    config.freeTargetCount,
    r.exactGrdOom ? `OOM(${r.exactGrdMs.toFixed(1)}ms)` : r.exactGrdMs.toFixed(1),
    r.exact1kOom ? `OOM(${r.exact1kMs.toFixed(1)}ms)` : r.exact1kMs.toFixed(1),
    r.oneKPolishMs.toFixed(1),
    r.greedyMs.toFixed(1),
    (r.preprocMs ?? 0).toFixed(1),
    r.optimalCp != null ? `${r.optimalCp}${r.certifiedExact ? '' : '*'}` : '',
    gapFmt(r.greedyGapCp, r.greedyGapPct, r.certifiedExact),
    gapFmt(r.oneKPolishGapCp, r.oneKPolishGapPct, r.certifiedExact),
    formatBoolCell(r.grp1kEqPol),
    formatBoolCell(r.grp1kEqExact),
    formatBoolCell(r.grpPolEqExact),
    forSheets ? `'${formatCompCounts(r)}` : formatCompCounts(r),
  ]);

  return { headers, dataRows };
}

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function tsvEscape(val) {
  if (val == null) return '';
  return String(val).replace(/[\t\r\n]+/g, ' ');
}

export function formatExperimentCsv(config, rows) {
  const { headers, dataRows } = buildExperimentExportTable(config, rows, { forSheets: false });
  return [
    headers.map(csvEscape).join(','),
    ...dataRows.map((row) => row.map(csvEscape).join(',')),
  ].join('\n');
}

/**
 * Formats Tab-Separated Values (TSV) for direct paste into Google Sheets / Excel.
 * Clicking any target cell (e.g. B10) and pressing Ctrl+V fills the table with B10 as top-left.
 */
export function formatExperimentTsv(config, rows, { includeHeader = true } = {}) {
  const { headers, dataRows } = buildExperimentExportTable(config, rows, { forSheets: true });
  const lines = [];
  if (includeHeader) {
    lines.push(headers.map(tsvEscape).join('\t'));
  }
  for (const row of dataRows) {
    lines.push(row.map(tsvEscape).join('\t'));
  }
  return lines.join('\n');
}