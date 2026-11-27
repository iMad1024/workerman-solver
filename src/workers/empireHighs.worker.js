// src/workers/empireHighs.worker.js
import highsLoader from 'highs';
import {
  buildEmpireModelData,
  buildInitialOneHopCuts,
  getTownCorridor,
  serializeModelToLp,
  separateFractionalCuts,
  pruneSlackCuts,
  separateIntegerCuts,
  summarizeSolution,
  parseHighsLog,
} from '../utils/empireCutEngine.js';

let highsInstance = null;
let logSink = null;

// Stateful session inside worker
let activeModel = null;
let activeCuts = [];
let cutSigSet = new Set();
let flowMode = 'capped'; // 'none' | 'any-town' | 'capped' | 'both'
let corridorDetourCP = 6;
let autoPromoteFlow = true;
let lpCappedTownIds = new Set();
let targetedFlowTownIds = new Set();

let lpRoundCounter = 0;
let mipRoundCounter = 0;
let lastLpCols = null;
let slackPurgedForLpRound = -1;

async function ensureHighs() {
  if (highsInstance) return highsInstance;
  highsInstance = await highsLoader({
    locateFile: (file) => `${import.meta.env.BASE_URL}${file}`,
    print: (text) => {
      if (logSink) logSink.push(String(text));
    },
    printErr: (text) => {
      if (logSink) logSink.push(`[ERR] ${text}`);
    },
  });
  return highsInstance;
}

function getEffectiveFlowConfig(asMip) {
  const useAnyTownFlow = asMip && (flowMode === 'any-town' || flowMode === 'both');
  const useCappedFlow = asMip && (flowMode === 'capped' || flowMode === 'both');
  const targetedList = useCappedFlow ? [...targetedFlowTownIds].sort((a, b) => a - b) : [];
  return { useAnyTownFlow, useCappedFlow, targetedList };
}

function updateCappedTownsFromLpSummary(summary) {
  if (!summary?.townUsage) return;
  lpCappedTownIds.clear();
  targetedFlowTownIds.clear();
  for (const t of summary.townUsage) {
    if (t.lodging > 0 && (t.used >= t.lodging * 0.85 || t.lodging - t.used <= 1.0)) {
      lpCappedTownIds.add(t.id);
      targetedFlowTownIds.add(t.id);
    }
  }
}

function solveCurrent(asMip, solverOpts = {}) {
  const { useAnyTownFlow, targetedList } = getEffectiveFlowConfig(asMip);
  const lpText = serializeModelToLp(activeModel, activeCuts, {
    asMip,
    useAnyTownFlow,
    targetedTownIds: targetedList,
    corridorDetourCP,
  });
  const lines = [];
  logSink = lines;

  const t0 = performance.now();
  const options = {
    output_flag: true,
    log_to_console: true,
  };
  if (asMip) {
    if (solverOpts.timeLimit > 0) options.time_limit = Number(solverOpts.timeLimit);
    if (solverOpts.mipRelGap >= 0) options.mip_rel_gap = Number(solverOpts.mipRelGap);
  }

  let res;
  try {
    res = highsInstance.solve(lpText, options);
  } catch (err) {
    highsInstance = null;
    throw err;
  } finally {
    logSink = null;
  }

  const elapsedMs = Number((performance.now() - t0).toFixed(1));
  const parsedLog = parseHighsLog(lines);
  const summary = res?.Columns ? summarizeSolution(activeModel, res.Columns) : null;

  return {
    res,
    elapsedMs,
    parsedLog,
    summary,
    rawLog: lines,
    lpBytes: lpText.length,
  };
}

function modelOverview() {
  if (!activeModel) return null;
  const useAnyTown = flowMode === 'any-town' || flowMode === 'both';
  const useCapped = flowMode === 'capped' || flowMode === 'both';

  let targetedArcCount = 0;
  const targetedNames = [];
  if (useCapped) {
    for (const tId of targetedFlowTownIds) {
      const corr = getTownCorridor(activeModel, tId, corridorDetourCP);
      if (corr) {
        targetedArcCount += corr.arcCount;
        targetedNames.push(`${corr.townName}(M=${corr.bigM},${corr.verts.length}v)`);
      }
    }
  }

  const numFlowVars = (useAnyTown ? activeModel.numFlowVars : 0) + targetedArcCount;

  return {
    cpCap: activeModel.cpCap,
    topKTowns: activeModel.topKTowns,
    numRoadNodes: activeModel.roadIds.length,
    numTowns: activeModel.towns.length,
    numPlantzones: activeModel.plantzones.length,
    numZVars: activeModel.zVars.length,
    numYVars: activeModel.yVars.length,
    numQVars: activeModel.qVars.length,
    flowMode,
    corridorDetourCP,
    numFlowVars,
    flowBigM: activeModel.flowBigM,
    targetedTownCount: targetedNames.length,
    targetedTownNames: targetedNames,
    numCuts: activeCuts.length,
    nodeNames: activeModel.nodeNames,
  };
}

function maybePurgeSlackCuts(slackTol = 0.02) {
  if (!lastLpCols || slackPurgedForLpRound === lpRoundCounter) return 0;
  const { keptCuts, removedCount } = pruneSlackCuts(
    activeModel,
    activeCuts,
    cutSigSet,
    lastLpCols,
    slackTol
  );
  activeCuts = keptCuts;
  slackPurgedForLpRound = lpRoundCounter;
  return removedCount;
}

self.onmessage = async (e) => {
  const { cmd, reqId, payload } = e.data || {};
  try {
    await ensureHighs();

    if (cmd === 'initModel') {
      activeModel = buildEmpireModelData(payload.raw, payload.options);
      flowMode = payload.options?.flowMode || 'capped';
      corridorDetourCP = Math.max(0, Number(payload.options?.corridorDetourCP ?? 6));
      autoPromoteFlow = payload.options?.autoPromoteFlow !== false;

      activeCuts = payload.options?.seedOneHopCuts ? buildInitialOneHopCuts(activeModel) : [];
      cutSigSet = new Set(activeCuts.map((c) => c.signature));
      lpCappedTownIds = new Set();
      targetedFlowTownIds = new Set();
      lpRoundCounter = 0;
      mipRoundCounter = 0;
      lastLpCols = null;
      slackPurgedForLpRound = -1;

      self.postMessage({
        type: 'done',
        cmd,
        reqId,
        overview: modelOverview(),
        cuts: activeCuts,
      });
      return;
    }

    if (!activeModel) {
      throw new Error('Model not initialized. Build model first.');
    }

    if (cmd === 'solveLpStep') {
      const { injectViolated = false, cutEps = 1e-3 } = payload || {};
      const { res, elapsedMs, parsedLog, summary, rawLog, lpBytes } = solveCurrent(false);

      if (res?.Columns && res?.Status === 'Optimal') {
        lastLpCols = res.Columns;
        updateCappedTownsFromLpSummary(summary);
      }

      const tempSig = injectViolated ? cutSigSet : new Set(cutSigSet);
      const nextRound = lpRoundCounter + 1;
      const foundCuts = res?.Columns
        ? separateFractionalCuts(activeModel, res.Columns, tempSig, nextRound, cutEps, 160)
        : [];

      if (injectViolated && foundCuts.length > 0) {
        lpRoundCounter = nextRound;
        activeCuts.push(...foundCuts);
      }

      self.postMessage({
        type: 'done',
        cmd,
        reqId,
        overview: modelOverview(),
        cuts: activeCuts,
        roundEntry: {
          phase: 'LP',
          round: lpRoundCounter,
          status: res?.Status || 'Unknown',
          objective: res?.ObjectiveValue ?? null,
          elapsedMs,
          totalCutsBefore: activeCuts.length - (injectViolated ? foundCuts.length : 0),
          violatedFound: foundCuts.length,
          injected: injectViolated ? foundCuts.length : 0,
          isFeasible: false,
          isCertifiedOpt: false,
          fracX: summary?.fracX ?? 0,
          fracZ: summary?.fracZ ?? 0,
          bbNodes: null,
          lpIters: parsedLog.lpIters,
          mipGapPct: null,
          presolve:
            parsedLog.presolveRows != null
              ? `${parsedLog.presolveRows}r × ${parsedLog.presolveCols}c`
              : '—',
          lpKb: Math.round(lpBytes / 1024),
          summary,
          rawLog,
        },
        pendingCuts: injectViolated ? [] : foundCuts,
      });
      return;
    }

    if (cmd === 'runPhase1') {
      const { maxRounds = 25, cutEps = 1e-3 } = payload || {};
      let roundsDone = 0;

      for (let step = 0; step < maxRounds; step++) {
        const cutsBefore = activeCuts.length;
        const { res, elapsedMs, parsedLog, summary, rawLog, lpBytes } = solveCurrent(false);

        if (res?.Columns && res?.Status === 'Optimal') {
          lastLpCols = res.Columns;
          updateCappedTownsFromLpSummary(summary);
        }

        const nextRound = lpRoundCounter + 1;
        const foundCuts = res?.Columns
          ? separateFractionalCuts(activeModel, res.Columns, cutSigSet, nextRound, cutEps, 160)
          : [];

        if (foundCuts.length > 0) {
          lpRoundCounter = nextRound;
          activeCuts.push(...foundCuts);
        }

        roundsDone++;
        const isFinalLpRound = foundCuts.length === 0 || step === maxRounds - 1 || res?.Status !== 'Optimal';
        let prunedInfo = '';
        if (isFinalLpRound && lastLpCols) {
          const removed = maybePurgeSlackCuts(0.02);
          if (removed > 0) {
            prunedInfo = ` [purged ${removed} slack -> ${activeCuts.length}; ${targetedFlowTownIds.size} capped towns]`;
            rawLog.push(
              `\n--- Phase 1 Done: purged ${removed} slack cuts (${activeCuts.length} kept); ${targetedFlowTownIds.size} capped towns flagged for B-lite ---`
            );
          }
        }

        const entry = {
          phase: 'LP',
          round: lpRoundCounter,
          status: `${res?.Status || 'Unknown'}${prunedInfo}`,
          objective: res?.ObjectiveValue ?? null,
          elapsedMs,
          totalCutsBefore: cutsBefore,
          violatedFound: foundCuts.length,
          injected: foundCuts.length,
          isFeasible: false,
          isCertifiedOpt: false,
          fracX: summary?.fracX ?? 0,
          fracZ: summary?.fracZ ?? 0,
          bbNodes: null,
          lpIters: parsedLog.lpIters,
          mipGapPct: null,
          presolve:
            parsedLog.presolveRows != null
              ? `${parsedLog.presolveRows}r × ${parsedLog.presolveCols}c`
              : '—',
          lpKb: Math.round(lpBytes / 1024),
          summary,
          rawLog,
        };

        self.postMessage({
          type: 'roundProgress',
          cmd,
          reqId,
          roundEntry: entry,
          overview: modelOverview(),
          cuts: activeCuts,
        });

        if (isFinalLpRound) break;
      }

      self.postMessage({
        type: 'done',
        cmd,
        reqId,
        overview: modelOverview(),
        cuts: activeCuts,
        roundsCount: roundsDone,
      });
      return;
    }

    if (cmd === 'solveMipStep' || cmd === 'runPhase2') {
      // Allow switching flow config without re-running Phase 1
      if (payload?.flowMode) flowMode = payload.flowMode;
      if (payload?.corridorDetourCP != null) {
        corridorDetourCP = Math.max(0, Number(payload.corridorDetourCP));
      }
      if (payload?.autoPromoteFlow != null) {
        autoPromoteFlow = Boolean(payload.autoPromoteFlow);
      }

      maybePurgeSlackCuts(0.02);

      const isSingle = cmd === 'solveMipStep';
      const maxRounds = isSingle ? 1 : Math.max(25, payload?.maxRounds || 25);
      const injectViolated = !isSingle || Boolean(payload?.injectViolated);

      const targetTimeLimit = Number(payload?.timeLimit ?? 30);
      const targetRelGap = Number(payload?.mipRelGap ?? 0.0001);
      const fastCap = Number(payload?.harvestTimeLimit ?? 15);

      const useFastHarvest = !isSingle && fastCap > 0;
      const harvestTimeLimit = Math.min(targetTimeLimit, fastCap);
      const harvestRelGap = Math.max(targetRelGap, 0.015);
      let exactMode =
        !useFastHarvest ||
        (targetRelGap >= harvestRelGap && targetTimeLimit <= harvestTimeLimit);

      for (let step = 0; step < maxRounds; step++) {
        const cutsBefore = activeCuts.length;
        const solverOpts = exactMode
          ? { timeLimit: targetTimeLimit, mipRelGap: targetRelGap }
          : { timeLimit: harvestTimeLimit, mipRelGap: harvestRelGap };

        const { res, elapsedMs, parsedLog, summary, rawLog, lpBytes } = solveCurrent(true, solverOpts);
        const statusStr = res?.Status || 'Unknown';
        const isSolverOptimal = statusStr === 'Optimal';
        const hasIncumbent = Boolean(res?.Columns && Number.isFinite(res?.ObjectiveValue));

        const tempSig = injectViolated ? cutSigSet : new Set(cutSigSet);
        const nextRound = mipRoundCounter + 1;
        const foundCuts = hasIncumbent
          ? separateIntegerCuts(activeModel, res.Columns, tempSig, nextRound, 3)
          : [];

        mipRoundCounter = nextRound;
        if (injectViolated && foundCuts.length > 0) {
          activeCuts.push(...foundCuts);
        }

        // Auto-promote towns with cross-town spillover mismatches into Hybrid B-lite
        const promotedNames = [];
        if (
          autoPromoteFlow &&
          (flowMode === 'capped' || flowMode === 'both') &&
          foundCuts.length > 0
        ) {
          for (const c of foundCuts) {
            if (c.townId !== 'ALL' && Number.isFinite(Number(c.townId))) {
              const tId = Number(c.townId);
              if (!targetedFlowTownIds.has(tId)) {
                targetedFlowTownIds.add(tId);
                promotedNames.push(activeModel.nodeNames[tId] || `#${tId}`);
              }
            }
          }
          if (promotedNames.length > 0) {
            rawLog.push(`\n--- Auto-promoted to B-lite flow: ${promotedNames.join(', ')} ---`);
          }
        }

        const isFeasible = hasIncumbent && foundCuts.length === 0;
        const isCertifiedOpt = isFeasible && isSolverOptimal && exactMode;
        const modeTag = exactMode ? 'exact' : 'fast';
        const flowTag =
          flowMode === 'none'
            ? ''
            : flowMode === 'any-town'
              ? '+A'
              : flowMode === 'capped'
                ? `+B(${targetedFlowTownIds.size}t)`
                : `+AB(${targetedFlowTownIds.size}t)`;
        const promoTag = promotedNames.length ? ` [+${promotedNames.length}t]` : '';

        const entry = {
          phase: 'MIP',
          round: nextRound,
          status: `${statusStr} (${modeTag}${flowTag})${promoTag}`,
          objective: hasIncumbent ? res.ObjectiveValue : null,
          elapsedMs,
          totalCutsBefore: cutsBefore,
          violatedFound: foundCuts.length,
          injected: injectViolated ? foundCuts.length : 0,
          isFeasible,
          isCertifiedOpt,
          isTimedOut: !isSolverOptimal,
          fracX: summary?.fracX ?? 0,
          fracZ: summary?.fracZ ?? 0,
          bbNodes: parsedLog.bbNodes,
          lpIters: parsedLog.lpIters,
          mipGapPct: parsedLog.mipGapPct,
          bestBound: parsedLog.bestBound,
          presolve:
            parsedLog.presolveRows != null
              ? `${parsedLog.presolveRows}r × ${parsedLog.presolveCols}c`
              : '—',
          lpKb: Math.round(lpBytes / 1024),
          summary,
          rawLog,
        };

        self.postMessage({
          type: 'roundProgress',
          cmd,
          reqId,
          roundEntry: entry,
          overview: modelOverview(),
          cuts: activeCuts,
        });

        if (isSingle) break;

        if (!hasIncumbent) {
          if (!exactMode) {
            exactMode = true;
            continue;
          }
          break;
        }

        if (isFeasible) {
          // If found in fast mode, always switch to exact mode for full-budget polish.
          if (!exactMode) {
            exactMode = true;
            continue;
          }
          // In exact mode: certified optimal OR timed out with 0 cuts to add (retrying identical model won't help).
          break;
        }
      }

      self.postMessage({
        type: 'done',
        cmd,
        reqId,
        overview: modelOverview(),
        cuts: activeCuts,
      });
      return;
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      cmd,
      reqId,
      error: err?.message || String(err),
    });
  }
};