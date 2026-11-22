// src/workers/steinerDp.worker.js
import { evaluateContractedDpUpTo } from '../utils/steinerDpSolver';

self.onmessage = async (e) => {
  const { runId, contractedTd, fullTd, snap, targetNodeId, options } = e.data || {};
  if (!contractedTd || !snap) return;

  try {
    const result = await evaluateContractedDpUpTo(contractedTd, fullTd, snap, targetNodeId, {
      ...options,
      onProgress: (progress) => {
        self.postMessage({ type: 'progress', runId, progress });
      },
      onInterimSolution: (interim) => {
        self.postMessage({ type: 'interim', runId, interim });
      },
    });

    self.postMessage({ type: 'done', runId, result });
  } catch (err) {
    self.postMessage({
      type: 'error',
      runId,
      error: err?.message || String(err),
    });
  }
};