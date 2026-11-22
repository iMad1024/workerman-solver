// src/utils/graphReduction.js

/**
 * Computes graph structural metrics + connected-component diameter.
 */
function computeGraphMetadata(adj, targets, townSet, assignments, { treewidth = null, computeDiameter = false } = {}) {
  const numNodes = adj.size;
  let edgeDoubleCount = 0;

  const termDeg = { d2: 0, d3: 0, d4: 0, d5Plus: 0 };
  const nonTermDeg = { d2: 0, d3: 0, d4: 0, d5Plus: 0 };
  const activeTownGroups = new Set();

  for (const t of targets) {
    for (const s of assignments.get(t) ?? []) {
      if (s != null) activeTownGroups.add(Number(s));
    }
  }

  for (const [u, neighbors] of adj.entries()) {
    const d = neighbors.size;
    edgeDoubleCount += d;

    const bucket = targets.has(u) || townSet.has(u) ? termDeg : nonTermDeg;
    if (d === 2) bucket.d2++;
    else if (d === 3) bucket.d3++;
    else if (d === 4) bucket.d4++;
    else if (d >= 5) bucket.d5Plus++;
  }

  let diameter = null;
  let components = null;

  if (computeDiameter) {
    diameter = 0;
    components = 0;
    const globalVisited = new Set();

    for (const startNode of adj.keys()) {
      if (!globalVisited.has(startNode)) {
        components++;
      }
      const dist = new Map([[startNode, 0]]);
      const queue = [startNode];
      let head = 0;

      while (head < queue.length) {
        const curr = queue[head++];
        globalVisited.add(curr);
        const dCurr = dist.get(curr);
        if (dCurr > diameter) diameter = dCurr;

        for (const nxt of adj.get(curr)) {
          if (!dist.has(nxt)) {
            dist.set(nxt, dCurr + 1);
            queue.push(nxt);
          }
        }
      }
    }
  }

  return {
    numNodes,
    numEdges: edgeDoubleCount / 2,
    numTargets: targets.size,
    numGroups: activeTownGroups.size,
    termDeg,
    nonTermDeg,
    diameter,
    components,
    treewidth,
  };
}



/**
 * Annotates every node in a rooted decomposition (full or contracted) with:
 *  - subtreeVertices: Set of vertices in B_u or any descendant bag
 *  - boundaryGroups: demand groups { target, sources, vertices } crossing V(T_u) and V \ V(T_u)
 *  - internalGroups: demand groups completely contained inside V(T_u) (with >=1 vertex below B_u)
 *  - newEdges: edges [a, b] inside B_u not already present in any child bag B_c
 */
export function annotateDpTreeMetadata(dpTree, { graph, targets, assignments }) {
  if (!dpTree || !dpTree.nodes?.length) return dpTree;

  const nodes = dpTree.nodes;
  const rootId = dpTree.rootId ?? 0;

  // Build town-centric demand groups: townId -> Set<targetId>
  const townToTargets = new Map();
  for (const rawT of targets || []) {
    const t = Number(rawT);
    for (const rawS of assignments?.[t] || []) {
      const s = Number(rawS);
      if (!townToTargets.has(s)) townToTargets.set(s, new Set());
      townToTargets.get(s).add(t);
    }
  }

  const demandGroups = [];
  for (const [townId, targetSet] of townToTargets.entries()) {
    const targetList = [...targetSet].sort((a, b) => a - b);
    const vertices = Array.from(new Set([townId, ...targetList]));
    demandGroups.push({
      id: demandGroups.length,
      town: townId,
      targets: targetList,
      vertices,
    });
  }

  // 1. Bottom-up pass: compute subtreeVertices V(T_u) and newEdges
  const subtreeVerts = new Array(nodes.length);

  const postOrder = (uId) => {
    const u = nodes[uId];
    const vSet = new Set(u.bag);
    const childBagSets = [];

    for (const cId of u.children || []) {
      postOrder(cId);
      for (const v of subtreeVerts[cId]) vSet.add(v);
      childBagSets.push(new Set(nodes[cId].bag));
    }
    subtreeVerts[uId] = vSet;

    const newEdges = [];
    const bag = u.bag;
    for (let i = 0; i < bag.length; i++) {
      const a = bag[i];
      const nbrSet = new Set(graph?.[a] || []);
      for (let j = i + 1; j < bag.length; j++) {
        const b = bag[j];
        if (!nbrSet.has(b)) continue;
        const coveredByChild = childBagSets.some((cs) => cs.has(a) && cs.has(b));
        if (!coveredByChild) newEdges.push([a, b]);
      }
    }
    u.newEdges = newEdges;
  };
  postOrder(rootId);

  // 2. Partition all town groups at every node into Internal / External / Crossing
  let maxBoundary = 0;
  let sumBoundary = 0;

  for (let uId = 0; uId < nodes.length; uId++) {
    const u = nodes[uId];
    const vSub = subtreeVerts[uId];
    const bagSet = new Set(u.bag);

    const boundaryGroups = [];
    const internalGroups = [];
    const externalGroups = [];

    for (const g of demandGroups) {
      let inSubCount = 0;
      let strictBelowCount = 0;

      for (const v of g.vertices) {
        if (vSub.has(v)) {
          inSubCount++;
          if (!bagSet.has(v)) strictBelowCount++;
        }
      }

      if (inSubCount === 0) {
        // Not encountered yet anywhere in V(T_u)
        externalGroups.push(g);
      } else if (inSubCount < g.vertices.length) {
        // Partially inside V(T_u) and partially outside -> crosses boundary
        boundaryGroups.push(g);
      } else if (strictBelowCount > 0) {
        // All vertices in V(T_u) and >=1 already below B_u -> resolved inside subtree
        internalGroups.push(g);
      } else {
        // All vertices sit right inside B_u itself (active at this bag, not yet below)
        boundaryGroups.push(g);
      }
    }

    u.boundaryGroups = boundaryGroups;
    u.internalGroups = internalGroups;
    u.externalGroups = externalGroups;

    if (boundaryGroups.length > maxBoundary) maxBoundary = boundaryGroups.length;
    sumBoundary += boundaryGroups.length;
  }

  dpTree.stats = {
    ...(dpTree.stats || {}),
    totalGroups: demandGroups.length,
    maxBoundaryGroups: maxBoundary,
    avgBoundaryGroups: Number((sumBoundary / Math.max(1, nodes.length)).toFixed(1)),
  };

  return dpTree;
}



/**
 * Min-fill heuristic ordering & upper-bound treewidth on the final reduced graph.
 */
/**
 * Builds a rooted min-fill tree decomposition + tree statistics from an adjacency Map<number, Set<number>>.
 */
export function computeMinFillTreewidth(adj) {
  const g = new Map();
  for (const [u, nbrs] of adj.entries()) {
    g.set(u, new Set(nbrs));
  }

  let maxBagSize = 0;
  const eliminationOrder = [];
  const rawBags = [];

  while (g.size > 0) {
    let bestNode = null;
    let bestFill = Infinity;
    let bestDeg = Infinity;

    for (const [u, nbrs] of g.entries()) {
      const arr = [...nbrs];
      let fill = 0;
      for (let i = 0; i < arr.length; i++) {
        const nbrSetI = g.get(arr[i]);
        for (let j = i + 1; j < arr.length; j++) {
          if (!nbrSetI.has(arr[j])) fill++;
        }
      }
      if (fill < bestFill || (fill === bestFill && arr.length < bestDeg)) {
        bestFill = fill;
        bestDeg = arr.length;
        bestNode = u;
      }
    }

    const nbrs = [...g.get(bestNode)];
    const bag = [bestNode, ...nbrs].sort((a, b) => a - b);
    if (bag.length > maxBagSize) maxBagSize = bag.length;
    eliminationOrder.push(bestNode);
    rawBags.push({ eliminated: bestNode, bag });

    // Make neighbors a clique and eliminate bestNode
    for (let i = 0; i < nbrs.length; i++) {
      for (let j = i + 1; j < nbrs.length; j++) {
        g.get(nbrs[i]).add(nbrs[j]);
        g.get(nbrs[j]).add(nbrs[i]);
      }
    }
    for (const v of nbrs) {
      g.get(v).delete(bestNode);
    }
    g.delete(bestNode);
  }

  const n = rawBags.length;
  if (n === 0) {
    return {
      treewidth: 0,
      eliminationOrder: [],
      bags: [],
      rootId: null,
      nodes: [],
      stats: {
        numNodes: 0,
        height: 0,
        avgDepth: 0,
        numLeaves: 0,
        maxBagSize: 0,
        maxCount: 0,
        maxMinus1Count: 0,
        maxMinus2Count: 0,
        hasDuplicateBags: false,
      },
    };
  }

  // Map each vertex -> index in eliminationOrder when it was eliminated
  const elimIndex = new Map();
  eliminationOrder.forEach((v, idx) => elimIndex.set(v, idx));

  // Connect each bag i to parent j = min_{u in B_i \ {v_i}} elimIndex[u]
  // Last eliminated bag (n - 1) becomes the primary root; any disconnected component roots attach to it.
  const rootId = n - 1;
  const treeNodes = rawBags.map((entry, idx) => ({
    id: idx,
    eliminated: entry.eliminated,
    bag: entry.bag,
    parent: null,
    children: [],
    depth: 0,
  }));

  for (let i = 0; i < n - 1; i++) {
    const { eliminated, bag } = rawBags[i];
    let parentIdx = Infinity;
    for (const u of bag) {
      if (u === eliminated) continue;
      const idx = elimIndex.get(u);
      if (idx !== undefined && idx < parentIdx) {
        parentIdx = idx;
      }
    }
    if (!Number.isFinite(parentIdx)) {
      parentIdx = rootId; // Connect disconnected graph components under root
    }
    treeNodes[i].parent = parentIdx;
    treeNodes[parentIdx].children.push(i);
  }

  // Top-down BFS from rootId to compute depths & tree metrics
  let height = 0;
  let totalDepth = 0;
  let numLeaves = 0;
  let maxCount = 0;
  let maxMinus1Count = 0;
  let maxMinus2Count = 0;
  const seenSignatures = new Set();
  let hasDuplicateBags = false;

  const queue = [rootId];
  let head = 0;
  while (head < queue.length) {
    const currId = queue[head++];
    const node = treeNodes[currId];
    if (node.depth > height) height = node.depth;
    totalDepth += node.depth;

    if (node.children.length === 0) numLeaves++;

    const sz = node.bag.length;
    if (sz === maxBagSize) maxCount++;
    else if (sz === maxBagSize - 1) maxMinus1Count++;
    else if (sz === maxBagSize - 2) maxMinus2Count++;

    const sig = node.bag.join(',');
    if (seenSignatures.has(sig)) hasDuplicateBags = true;
    else seenSignatures.add(sig);

    for (const childId of node.children) {
      treeNodes[childId].depth = node.depth + 1;
      queue.push(childId);
    }
  }

  // Post-order leaf-centered tidy layout: x in [0, 1], y in [0, 1]
  let leafCursor = 0;
  const denomX = Math.max(1, numLeaves - 1);
  const denomY = Math.max(1, height);

  const assignLayout = (nodeId) => {
    const node = treeNodes[nodeId];
    node.y = node.depth / denomY;
    if (!node.children || node.children.length === 0) {
      node.x = numLeaves === 1 ? 0.5 : leafCursor / denomX;
      leafCursor++;
    } else {
      for (const cid of node.children) assignLayout(cid);
      const firstX = treeNodes[node.children[0]].x;
      const lastX = treeNodes[node.children[node.children.length - 1]].x;
      node.x = (firstX + lastX) * 0.5;
    }
  };
  assignLayout(rootId);

  return {
    treewidth: Math.max(0, maxBagSize - 1),
    eliminationOrder,
    bags: rawBags.map((b) => b.bag),
    rootId,
    nodes: treeNodes,
    stats: {
      numNodes: n,
      height,
      avgDepth: Number((totalDepth / n).toFixed(2)),
      numLeaves,
      maxBagSize,
      maxCount,
      maxMinus1Count,
      maxMinus2Count,
      hasDuplicateBags,
    },
  };
}

/**
 * Helper to compute a tree decomposition on demand for any intermediate snapshot `graph` object.
 */
export function buildTreeDecompositionFromGraph(graphObj) {
  const adj = new Map();
  for (const [rawU, nbrs] of Object.entries(graphObj || {})) {
    const u = Number(rawU);
    if (!adj.has(u)) adj.set(u, new Set());
    for (const rawV of nbrs || []) {
      const v = Number(rawV);
      if (u === v) continue;
      adj.get(u).add(v);
      if (!adj.has(v)) adj.set(v, new Set());
      adj.get(v).add(u);
    }
  }
  return computeMinFillTreewidth(adj);
}



/**
 * Contracts unary paths of a rooted tree decomposition into a Join-Skeleton Tree.
 * Keeps: root, leaves, and branching (join) nodes (plus optional binary-join split).
 * Every parent-child edge stores { forget: B_c \ B_p, separator: B_c ∩ B_p, introduce: B_p \ B_c }.
 */
export function buildContractedDpTree(td, { binaryJoins = true } = {}) {
  if (!td || !td.nodes?.length) return null;

  const origNodes = td.nodes;
  const rootId = td.rootId;

  // Step 1: Identify kept structural nodes (root, leaves, and nodes with >= 2 children)
  const isKept = (id) => {
    if (id === rootId) return true;
    const deg = origNodes[id].children?.length ?? 0;
    return deg === 0 || deg >= 2;
  };

  // Step 2: Build contracted nodes & trace chains between kept nodes
  const nodes = [];
  const origToContracted = new Map();

  function buildSubtree(origId, parentContractedId) {
    const orig = origNodes[origId];
    const myId = nodes.length;
    origToContracted.set(origId, myId);

    const node = {
      id: myId,
      origBagId: origId,
      bag: [...orig.bag],
      parent: parentContractedId,
      children: [],
      transitions: {}, // childContractedId -> { chainOrigIds, forget, separator, introduce }
      kind: (orig.children?.length ?? 0) === 0
        ? 'LEAF'
        : (orig.children.length >= 2 ? 'JOIN' : 'ROOT'),
      depth: parentContractedId == null ? 0 : nodes[parentContractedId].depth + 1,
    };
    nodes.push(node);

    // For each immediate child of origId, walk down until hitting the next kept node
    for (const firstStepId of orig.children || []) {
      const chainOrigIds = [origId];
      let currId = firstStepId;

      while (!isKept(currId)) {
        chainOrigIds.push(currId);
        currId = origNodes[currId].children[0];
      }
      chainOrigIds.push(currId); // ends at kept descendant `currId`

      const childContractedId = buildSubtree(currId, myId);
      node.children.push(childContractedId);

      // Compute exact transition deltas between B_child and B_parent
      const parentSet = new Set(orig.bag);
      const childBag = origNodes[currId].bag;
      const childSet = new Set(childBag);

      node.transitions[childContractedId] = {
        chainOrigIds, // Preserves the exact original bags along this edge for inspection!
        forget: childBag.filter((v) => !parentSet.has(v)),
        separator: childBag.filter((v) => parentSet.has(v)),
        introduce: orig.bag.filter((v) => !childSet.has(v)),
      };
    }

    return myId;
  }

  buildSubtree(rootId, null);

  // Optional Step 3: Split k-ary joins (k >= 3) into binary join chains with identical bags
  if (binaryJoins) {
    let i = 0;
    while (i < nodes.length) {
      const n = nodes[i];
      if (n.children.length > 2) {
        // Keep children[0] on `n`, group children[1..k-1] under a binary clone `cloneId`
        const rightChildren = n.children.slice(1);
        const cloneId = nodes.length;

        const clone = {
          id: cloneId,
          origBagId: n.origBagId,
          isClone: true,
          bag: [...n.bag],
          parent: n.id,
          children: rightChildren,
          transitions: {},
          kind: 'JOIN_CLONE',
          depth: n.depth + 1,
        };

        for (const rcId of rightChildren) {
          clone.transitions[rcId] = n.transitions[rcId];
          delete n.transitions[rcId];
          nodes[rcId].parent = cloneId;
        }

        nodes.push(clone);
        n.children = [n.children[0], cloneId];
        n.transitions[cloneId] = {
          chainOrigIds: [n.origBagId],
          forget: [],
          separator: [...n.bag],
          introduce: [],
        };
      }
      i++;
    }
  }

  // Step 4: Recompute depths after optional binary join splitting
  const recomputeDepths = (id, d) => {
    nodes[id].depth = d;
    for (const cid of nodes[id].children) {
      recomputeDepths(cid, d + 1);
    }
  };
  recomputeDepths(0, 0);

  // Step 5: Assign normalized (x, y) layout coordinates for the SVG tree map
  let maxDepth = 0;
  let leafCursor = 0;
  for (const n of nodes) {
    if (n.depth > maxDepth) maxDepth = n.depth;
  }

  const totalLeaves = Math.max(1, nodes.filter((n) => n.children.length === 0).length);
  const assignX = (id) => {
    const n = nodes[id];
    if (!n.children.length) {
      n.x = totalLeaves === 1 ? 0.5 : leafCursor / (totalLeaves - 1);
      leafCursor++;
    } else {
      for (const cid of n.children) assignX(cid);
      const firstX = nodes[n.children[0]].x;
      const lastX = nodes[n.children[n.children.length - 1]].x;
      n.x = (firstX + lastX) * 0.5;
    }
    n.y = maxDepth === 0 ? 0 : n.depth / maxDepth;
  };
  assignX(0);

  // Step 6: Compute telemetry stats matching full TD
  let maxBagSize = 0;
  let sumDepth = 0;
  let numLeaves = 0;
  const sigSet = new Set();
  let hasDuplicateBags = false;

  // for (const n of nodes) {
  //   if (n.bag.length > maxBagSize) maxBagSize = n.bag.length;
  //   sumDepth += n.depth;
  //   if (n.children.length === 0) numLeaves++;
  //   const sig = [...n.bag].sort((a, b) => a - b).join(',');
  //   if (sigSet.has(sig)) hasDuplicateBags = true;
  //   sigSet.add(sig);
  // }

  for (const n of nodes) {
    if (n.bag.length > maxBagSize) maxBagSize = n.bag.length;
    sumDepth += n.depth;
    if (n.children.length === 0) numLeaves++;
    if (!n.isClone) {
      const sig = [...n.bag].sort((a, b) => a - b).join(',');
      if (sigSet.has(sig)) hasDuplicateBags = true;
      sigSet.add(sig);
    }
  }

  let maxCount = 0;
  let maxMinus1Count = 0;
  let maxMinus2Count = 0;
  for (const n of nodes) {
    if (n.bag.length === maxBagSize) maxCount++;
    else if (maxBagSize > 1 && n.bag.length === maxBagSize - 1) maxMinus1Count++;
    else if (maxBagSize > 2 && n.bag.length === maxBagSize - 2) maxMinus2Count++;
  }

  return {
    rootId: 0,
    treewidth: td.treewidth,
    nodes,
    stats: {
      numNodes: nodes.length,
      height: maxDepth,
      avgDepth: (sumDepth / Math.max(1, nodes.length)).toFixed(1),
      numLeaves,
      maxBagSize,
      maxCount,
      maxMinus1Count,
      maxMinus2Count,
      hasDuplicateBags,
    },
  };

}


/**
 * Vertex-weighted Dijkstra from `start` to `goal` in `adj \ {forbiddenNode}`,
 * counting internal vertex weights ONLY (excluding `start` and `goal`).
 */
function shortestInternalVertexPathCost(adj, weights, targets, townSet, start, goal, forbiddenNode) {
  if (start === goal) return 0;
  if (adj.get(start)?.has(goal)) return 0; // Direct edge has 0 internal vertex cost

  const dist = new Map([[start, 0]]);
  const visited = new Set([forbiddenNode]);

  while (true) {
    let u = null;
    let bestD = Infinity;
    for (const [node, d] of dist.entries()) {
      if (!visited.has(node) && d < bestD) {
        bestD = d;
        u = node;
      }
    }
    if (u === null || u === goal) break;
    visited.add(u);

    for (const v of adj.get(u) || []) {
      if (visited.has(v)) continue;
      // Targets and towns are mandatory in every feasible solution -> 0 marginal cost
      const isMandatory = v === goal || targets.has(v) || townSet.has(v);
      const stepCost = isMandatory ? 0 : (Number(weights.get(v)) || 0);
      const alt = bestD + stepCost;
      if (alt < (dist.get(v) ?? Infinity)) {
        dist.set(v, alt);
      }
    }
  }

  return dist.get(goal) ?? Infinity;
}

/**
 * Serializes the current working graph state into an immutable snapshot step.
 */
function createStepSnapshot({
  stepIndex,
  opType,
  opDesc,
  details,
  adj,
  weights,
  clusters,
  targets,
  townSet,
  assignments,
  treewidth = null,
  computeDiameter = false,
}) {
  const graph = {};
  for (const [u, nbrs] of adj.entries()) {
    graph[u] = [...nbrs].sort((a, b) => a - b);
  }

  const nodeWeights = Object.fromEntries(weights.entries());
  const nodeClusters = {};
  for (const [u, set] of clusters.entries()) {
    nodeClusters[u] = [...set].sort((a, b) => a - b);
  }

  const targetList = [...targets].sort((a, b) => a - b);
  const assignmentMap = {};
  for (const [t, townSetObj] of assignments.entries()) {
    assignmentMap[t] = [...townSetObj].sort((a, b) => a - b);
  }

  return {
    stepIndex,
    opType,
    opDesc,
    details,
    graph,
    nodeWeights,
    nodeClusters,
    targets: targetList,
    towns: [...townSet].sort((a, b) => a - b),
    assignments: assignmentMap,
    meta: computeGraphMetadata(adj, targets, townSet, assignments, {
      treewidth,
      computeDiameter,
    }),
  };
}

/**
 * Executes the full staged reduction pipeline and returns { steps, decomposition }.
 */
export function runGraphReduction({ links, nodes, plantzoneStatic, townSet, plantzoneSet, instance }) {
  const adj = new Map();
  const weights = new Map();
  const clusters = new Map();
  const targets = new Set((instance?.targets ?? []).map(Number));
  const assignments = new Map();
  const activeTownSet = new Set([...(townSet || [])].map(Number));

  for (const { targetId, sourceId } of instance?.assignments ?? []) {
    const t = Number(targetId);
    if (!assignments.has(t)) assignments.set(t, new Set());
    if (sourceId != null) assignments.get(t).add(Number(sourceId));
  }

  // 0. Build normalized numeric graph (Step 0: Full Graph)
  for (const [rawKey, rawNbrs] of Object.entries(links || {})) {
    const u = Number(rawKey);
    if (!adj.has(u)) adj.set(u, new Set());
    weights.set(u, Number(nodes?.[rawKey]?.CP) || 0);
    clusters.set(u, new Set([u]));

    for (const rawV of rawNbrs || []) {
      const v = Number(rawV);
      if (u === v) continue;
      adj.get(u).add(v);
      if (!adj.has(v)) {
        adj.set(v, new Set());
        weights.set(v, Number(nodes?.[String(v)]?.CP) || 0);
        clusters.set(v, new Set([v]));
      }
      adj.get(v).add(u);
    }
  }

  const steps = [];
  const initDecomp = computeMinFillTreewidth(adj);
  steps.push(
    createStepSnapshot({
      stepIndex: 0,
      opType: 'INIT',
      opDesc: 'Full road network & raw instance',
      details: {},
      adj,
      weights,
      clusters,
      targets,
      townSet: activeTownSet,
      assignments,
      treewidth: initDecomp.treewidth,
      computeDiameter: true,
    })
  );

  // Helper to remove node `u` cleanly from `adj`, `weights`, `clusters`, `targets`, `assignments`
  const deleteNode = (u) => {
    const nbrs = adj.get(u);
    if (nbrs) {
      for (const v of nbrs) adj.get(v)?.delete(u);
    }
    adj.delete(u);
    weights.delete(u);
    clusters.delete(u);
    targets.delete(u);
    assignments.delete(u);
  };

  // Helper to merge `src` into `dst` (retaining `dst` key)
  const mergeNodesInto = (dst, src) => {
    weights.set(dst, (Number(weights.get(dst)) || 0) + (Number(weights.get(src)) || 0));

    const dstCluster = clusters.get(dst);
    for (const orig of clusters.get(src) ?? []) dstCluster.add(orig);

    if (targets.has(src)) {
      targets.add(dst);
      if (!assignments.has(dst)) assignments.set(dst, new Set());
      for (const town of assignments.get(src) ?? []) assignments.get(dst).add(town);
    }

    // If a target folded into its own town, that self-requirement is already satisfied
    if (activeTownSet.has(dst) && assignments.has(dst)) {
      assignments.get(dst).delete(dst);
      if (assignments.get(dst).size === 0) {
        targets.delete(dst);
        assignments.delete(dst);
      }
    }

    let parallelEdgesRemoved = 0;
    const dstNbrs = adj.get(dst);
    for (const w of adj.get(src) ?? []) {
      if (w === dst) {
        parallelEdgesRemoved++; // The edge (dst, src) itself
        continue;
      }
      if (dstNbrs.has(w)) {
        parallelEdgesRemoved++; // Parallel edge already existed between dst and w
      } else {
        dstNbrs.add(w);
        adj.get(w).add(dst);
      }
    }

    deleteNode(src);
    return parallelEdgesRemoved;
  };

  // =========================================================================
  // STAGE 0: Bulk Cleanup (Plantzones & kind 10, 12, 13 -> fold into parent)
  // =========================================================================
  let foldedTargets = 0;
  let prunedLeaves = 0;
  const cleanupCandidates = [...adj.keys()].filter((u) => {
    const kind = nodes?.[String(u)]?.kind;
    return kind === 10 || kind === 12 || kind === 13 || plantzoneSet.has(u);
  });

  for (const u of cleanupCandidates) {
    if (!adj.has(u)) continue;
    const rawParent = plantzoneStatic?.[String(u)]?.parent;
    const parent = rawParent != null ? Number(rawParent) : null;

    if (targets.has(u) && parent != null && adj.has(parent)) {
      mergeNodesInto(parent, u);
      foldedTargets++;
    } else {
      deleteNode(u);
      prunedLeaves++;
    }
  }

  const cleanupDecomp = computeMinFillTreewidth(adj);
  steps.push(
    createStepSnapshot({
      stepIndex: steps.length,
      opType: 'CLEANUP',
      opDesc: `Folded ${foldedTargets} target plantzones into parents, pruned ${prunedLeaves} non-target nodes`,
      details: { foldedTargets, prunedLeaves },
      adj,
      weights,
      clusters,
      targets,
      townSet: activeTownSet,
      assignments,
      treewidth: cleanupDecomp.treewidth,
      computeDiameter: true,
    })
  );

  // =========================================================================
  // STAGES 1–4: Iterative Single-Step Reductions (Every single step logged)
  // =========================================================================
  let modified = true;
  while (modified) {
    modified = false;

    // -----------------------------------------------------------------------
    // RULE 1: Degree-1 Prune (non-town)
    // -----------------------------------------------------------------------
    for (const u of [...adj.keys()]) {
      if (activeTownSet.has(u)) continue;
      const nbrs = adj.get(u);
      if (!nbrs || nbrs.size !== 1) continue;

      const [neighbor] = nbrs;
      const wasTarget = targets.has(u);

      if (!wasTarget) {
        deleteNode(u);
        steps.push(
          createStepSnapshot({
            stepIndex: steps.length,
            opType: 'DEG1_PRUNE',
            opDesc: `Pruned non-target leaf ${u}`,
            details: { removedNode: u, neighbor, wasTarget: false },
            adj,
            weights,
            clusters,
            targets,
            townSet: activeTownSet,
            assignments,
          })
        );
      } else {
        mergeNodesInto(neighbor, u);
        steps.push(
          createStepSnapshot({
            stepIndex: steps.length,
            opType: 'DEG1_PRUNE',
            opDesc: `Folded target leaf ${u} into neighbor ${neighbor}`,
            details: { removedNode: u, mergedInto: neighbor, wasTarget: true },
            adj,
            weights,
            clusters,
            targets,
            townSet: activeTownSet,
            assignments,
          })
        );
      }

      modified = true;
      break;
    }
    if (modified) continue;

    // -----------------------------------------------------------------------
    // RULE 2: Adjacent Degree-2 Non-Target Contraction (both non-town)
    // -----------------------------------------------------------------------
    for (const u of [...adj.keys()]) {
      if (activeTownSet.has(u) || targets.has(u)) continue;
      const nbrs = adj.get(u);
      if (!nbrs || nbrs.size !== 2) continue;

      const partner = [...nbrs].find(
        (v) => !activeTownSet.has(v) && !targets.has(v) && adj.get(v)?.size === 2
      );
      if (partner === undefined) continue;

      const parallelEdgesRemoved = mergeNodesInto(u, partner);
      steps.push(
        createStepSnapshot({
          stepIndex: steps.length,
          opType: 'DEG2_CONTRACT',
          opDesc: `Contracted degree-2 non-target ${partner} into ${u}`,
          details: { keptNode: u, removedNode: partner, parallelEdgesRemoved },
          adj,
          weights,
          clusters,
          targets,
          townSet: activeTownSet,
          assignments,
        })
      );

      modified = true;
      break;
    }
    if (modified) continue;

    // -----------------------------------------------------------------------
    // RULE 3: Adjacent Target Merge (both non-town)
    // -----------------------------------------------------------------------
    for (const u of [...targets]) {
      if (!adj.has(u) || activeTownSet.has(u)) continue;
      const partner = [...adj.get(u)].find((v) => targets.has(v) && !activeTownSet.has(v));
      if (partner === undefined) continue;

      const parallelEdgesRemoved = mergeNodesInto(u, partner);
      steps.push(
        createStepSnapshot({
          stepIndex: steps.length,
          opType: 'TARGET_MERGE',
          opDesc: `Merged target ${partner} into ${u} (${parallelEdgesRemoved} parallel edges removed)`,
          details: { keptNode: u, removedNode: partner, parallelEdgesRemoved },
          adj,
          weights,
          clusters,
          targets,
          townSet: activeTownSet,
          assignments,
        })
      );

      modified = true;
      break;
    }
    if (modified) continue;

    // -----------------------------------------------------------------------
    // RULE 4: Redundant Degree-2 Non-Target Removal (both non-town)
    // -----------------------------------------------------------------------
    for (const u of [...adj.keys()]) {
      if (activeTownSet.has(u) || targets.has(u)) continue;
      const nbrs = adj.get(u);
      if (!nbrs || nbrs.size !== 2) continue;

      const [v, w] = [...nbrs];
      const uCost = Number(weights.get(u)) || 0;
      const altCost = shortestInternalVertexPathCost(adj, weights, targets, activeTownSet, v, w, u);

      if (altCost <= uCost) {
        deleteNode(u);
        steps.push(
          createStepSnapshot({
            stepIndex: steps.length,
            opType: 'REDUNDANT_NODE',
            opDesc: `Removed redundant degree-2 node ${u} (cost ${uCost} >= alt path ${altCost})`,
            details: { removedNode: u, endpoints: [v, w], nodeCost: uCost, altPathCost: altCost },
            adj,
            weights,
            clusters,
            targets,
            townSet: activeTownSet,
            assignments,
          })
        );

        modified = true;
        break;
      }
    }

    if (modified) continue;

    // -----------------------------------------------------------------------
    // RULE 5: Town Co-Occurrence Redirection & Demotion
    // -----------------------------------------------------------------------
    const activeTowns = [...activeTownSet].filter((s) => adj.has(s));
    if (activeTowns.length > 1) {
      const townAdj = new Map();
      for (const s of activeTowns) townAdj.set(s, new Set());

      const addTownEdge = (a, b) => {
        if (a === b || !townAdj.has(a) || !townAdj.has(b)) return;
        townAdj.get(a).add(b);
        townAdj.get(b).add(a);
      };

      for (const t of targets) {
        const tTowns = [...(assignments.get(t) ?? [])].filter((s) => townAdj.has(s));
        // Co-occurring towns sharing target t
        for (let i = 0; i < tTowns.length; i++) {
          for (let j = i + 1; j < tTowns.length; j++) {
            addTownEdge(tTowns[i], tTowns[j]);
          }
        }
        // If town t is itself a target (e.g. folded via DEG1_PRUNE), link t with its source towns
        if (townAdj.has(t)) {
          for (const s of tTowns) addTownEdge(t, s);
        }
      }

      const visited = new Set();
      const compRepMap = new Map();
      const demotedTowns = new Set();
      let multiTownGroups = 0;

      for (const startTown of activeTowns) {
        if (visited.has(startTown)) continue;

        const comp = [];
        const queue = [startTown];
        visited.add(startTown);
        let head = 0;

        while (head < queue.length) {
          const curr = queue[head++];
          comp.push(curr);
          for (const nxt of townAdj.get(curr) || []) {
            if (!visited.has(nxt)) {
              visited.add(nxt);
              queue.push(nxt);
            }
          }
        }

        if (comp.length <= 1) continue;
        multiTownGroups++;

        // Pick representative A = highest degree in the CURRENT reduced graph `adj`
        let repA = comp[0];
        let bestDeg = adj.get(repA)?.size ?? 0;
        for (let i = 1; i < comp.length; i++) {
          const cand = comp[i];
          const deg = adj.get(cand)?.size ?? 0;
          if (deg > bestDeg || (deg === bestDeg && cand > repA)) {
            repA = cand;
            bestDeg = deg;
          }
        }

        for (const member of comp) {
          compRepMap.set(member, repA);
          if (member !== repA) {
            demotedTowns.add(member);
          }
        }
      }

      if (demotedTowns.size > 0) {
        // Demote B, C, ... from activeTownSet -> targets assigned to repA
        for (const bTown of demotedTowns) {
          const repA = compRepMap.get(bTown);
          activeTownSet.delete(bTown);
          targets.add(bTown);
          assignments.set(bTown, new Set([repA]));
        }

        // Redirect all targets touching any component to that component's repA
        let redirectedTargets = 0;
        for (const t of [...targets]) {
          const curSet = assignments.get(t);
          if (!curSet) continue;

          const nextSet = new Set();
          let touched = false;
          for (const s of curSet) {
            const rep = compRepMap.get(s);
            if (rep != null) {
              nextSet.add(rep);
              if (rep !== s) touched = true;
            } else {
              nextSet.add(s);
            }
          }

          // Strip self-reference if t is an active town
          if (activeTownSet.has(t)) {
            nextSet.delete(t);
            if (nextSet.size === 0) {
              targets.delete(t);
              assignments.delete(t);
              continue;
            }
          }

          if (touched || nextSet.size !== curSet.size) {
            assignments.set(t, nextSet);
            redirectedTargets++;
          }
        }

        steps.push(
          createStepSnapshot({
            stepIndex: steps.length,
            opType: 'TOWN_REDIRECT',
            opDesc: `Merged ${multiTownGroups} town group(s), demoted ${demotedTowns.size} town(s), redirected ${redirectedTargets} target(s)`,
            details: {
              multiTownGroups,
              demotedTowns: [...demotedTowns],
              redirectedTargets,
            },
            adj,
            weights,
            clusters,
            targets,
            townSet: activeTownSet,
            assignments,
          })
        );

        modified = true;
      }
    }
  }

  const decomposition = computeMinFillTreewidth(adj);
  if (steps.length > 0) {
  const finalMeta = computeGraphMetadata(adj, targets, activeTownSet, assignments, {
      treewidth: decomposition.treewidth,
      computeDiameter: true,
  });
  steps[steps.length - 1].meta = finalMeta;
  }

  // On Step 0:
  steps[0].decomposition = initDecomp;

  // On Step 1:
  steps[1].decomposition = cleanupDecomp;

  // On Final Step:
  if (steps.length > 0) {
    steps[steps.length - 1].meta = computeGraphMetadata(adj, targets, activeTownSet, assignments, {
      treewidth: decomposition.treewidth,
      computeDiameter: true,
    });
    steps[steps.length - 1].decomposition = decomposition;
  }

  return { steps, decomposition };
}