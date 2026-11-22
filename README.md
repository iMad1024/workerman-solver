https://imad1024.github.io/workerman-solver/

# BDO Node-Weighted Steiner Forest — Exact Client-Side Solver & Visualizer

A pure, single-threaded JavaScript exact solver and interactive visualizer for the Black Desert Online (BDO) node-routing problem (**Node-Weighted Steiner Forest** with both town-assigned and unassigned "free" targets).

The purpose of this project is simple: demonstrate—visually and empirically—that exact optimal routing on the BDO road graph is **not** a hard combinatorial optimization problem requiring native MIP solvers (HiGHS / SCIP-Jack), multi-hour fuzzers, or exotic preprocessing theories. Because the BDO road network is sparse, nearly planar, and has **treewidth 6–8** after elementary cleanup, textbook dynamic programming over a tree decomposition solves it **provably to optimality right inside a browser tab**.

## Why This Graph Is Structurally Easy

General Node-Weighted Steiner Forest is NP-hard, and generic MIP formulations often burn seconds or minutes fighting weak LP relaxations, fractional cycles, and symmetry.

Real road networks like BDO's look nothing like worst-case NP-hard instances:
* After standard textbook reductions (removing dead ends, contracting forced paths, pruning zero-demand regions), the remaining core graph has only a few hundred vertices and **treewidth ~6–8**.
* In parameterized complexity, bounded treewidth immediately places Steiner Forest in **FPT (Fixed-Parameter Tractable)**: exact dynamic programming scales linearly with graph size and depends exponentially only on the tiny separator width, not the number of nodes or targets.

## How the Algorithm Works

### 1. Elementary Graph Reduction (`REDUCE` Tab)
Standard, decades-old Steiner reductions (degree-1 pruning, forced chains, dead branches, terminal absorption) strip away the trivial outskirts of the map. Use the step slider in the **REDUCE** tab to watch how little of the graph is actually left once the obvious branches disappear.

### 2. Tree Decomposition & Vertex Separators (`SOLVE` Tab)
The reduced graph is decomposed into a tree of small overlapping vertex sets called **bags** (typically $\le 7$–$9$ vertices each).

Every bag acts as a **vertex separator (chokepoint)** between the subgraph already processed ("inside" the subtree below the bag) and the rest of the map ("outside"):
* No path can enter or leave the processed region without passing through the few vertices currently sitting in the bag.
* Therefore, the solver does **not** need to remember the exponentially many road layouts inside the region. At each bag, a state only needs to summarize the border:
  1. Which bag vertices are bought (`selMask`),
  2. Which bought bag vertices are already connected to each other inside the region (a partition),
  3. Which unfinished terminal groups (or free targets still looking for any town) are attached to each connected piece.
* Any two internal sub-solutions with the same border summary are completely interchangeable to the outside world—only the lowest-CP one is kept.

### 3. Exact DP with Primal-Dual Branch-and-Bound
To keep the table tiny even on dense multi-group instances, the solver pairs bottom-up tree-decomposition DP with standard combinatorial bounds:
1. **Fast Upper Bound (`GREEDY`):** Multi-ordering shortest-path heuristic + reverse-weight pruning (~10–20 ms, typically within 1–2% of optimal).
2. **Optional Beam + Exact $G=1$ Tree Polish (`1K` + `POLISH`):** Finds near-exact (usually optimal) town groupings and refines each component as an exact single-group Steiner tree.
3. **Exact DP (`EXACT`):** Runs bottom-up over the contracted tree decomposition using an admissible **node-weighted dual ascent (moat growth)** + **residual split-group lower bound** on the outside graph, strict-improvement pruning (`< UB`), and per-`selMask` dominance pruning.

## Performance (Single-Threaded Browser JS)

Even on deliberate stress tests (**50 random plantzones + stable-matching town assignments at $r=1.58$ + 8 unassigned free targets**), running single-threaded pure JavaScript inside a Web Worker:
* **Greedy:** ~10–20 ms (within ~0–2% of optimum)
* **Exact Certified Optimum (`EXACT (GRD)`):** typically **~0.8s – 3.5s** in-browser
* **Native C++ / Rust Equivalent:** Replacing JS objects/GC with flat inline structs yields roughly **~100–300 ms** single-threaded, or **< 100 ms** multi-threaded across `selMask` buckets.

## Interactive Features

* **`INSTANCE` Tab:** Deterministic seed-based generator supporting Random/Top-K plantzones, Closest-K / Stable-Matching town routing, and unassigned Free Targets. Every instance is 100% reproducible from its 6-character seed and slider settings.
* **`REDUCE` Tab:** Step-by-step playback of graph preprocessing directly on the map.
* **`SOLVE` Tab:** Interactive Join Tree inspector highlighting bag separators (`Parent Sep`, `Child Sep`, `Local`, `Parent∩Child`), per-bag bottleneck timings, and solution overlays (`TD`, `RED`, `ORIG`).
* **`Experiment` Panel:** Built-in batch benchmarking suite with Web Worker isolation, optimality gap tracking, connected-component grouping comparison (`1K` vs. `POLISH` vs. `EXACT`), and Google Sheets / CSV export.
* **One-Click `Route` Button:** Runs the full preprocessing + exact DP pipeline directly on the standard BDO icon map.

## Integrating Into an Existing BDO Map

All worker/empire management UI was intentionally omitted here to keep the routing core isolated and easy to inspect. The solver (`src/utils/steinerDpSolver.js` + `src/utils/graphReduction.js`) only takes:
* `graph` (adjacency list) and `nodeWeights` (CP costs)
* `targets` (active plantzone/free nodes), `assignments` (`target -> town`), and `towns`

It runs completely client-side inside a standard Web Worker—zero backend server, zero native binary dependencies, and exact CP-optimal routing out of the box.