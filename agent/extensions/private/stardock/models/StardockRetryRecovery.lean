import Std

/-
Source-linked finite abstraction of Stardock lifecycle guards (2026-10-04).
This is NOT a refinement proof of the TypeScript implementation.
Assumptions: graph identity/revision/contracts valid, dependencies satisfied,
no live worker after the modeled owner exit, and no external/manual state edit.
Historical predicates retain the original blockers. Current TypeScript tests
validate corrected guards using synthetic leases in isolated temporary roots.
-/
namespace StardockLifecycle

inductive NodeStatus where
  | ready | retryReady | running | leased | reconciling | needsReview
  | succeeded | abandoned | failed | detached
  deriving DecidableEq, Repr

-- stages/graph.ts readyExecutionNodeIds, with dependency/contract validity assumed.
def nodeReady (n : NodeStatus) : Bool :=
  n == .ready || n == .retryReady

-- run-ready.ts selectedNodes accepts a ready subset.
def runnableSubset (ns : List NodeStatus) : Bool := ns.any nodeReady

-- ownership.ts assertStageAcquirable checks ALL stage implementation nodes,
-- even when runReady selected only a subset for a retry.
def freshCustodyReady (ns : List NodeStatus) : Bool := ns.all nodeReady

def decided (n : NodeStatus) : Bool := n == .succeeded || n == .abandoned

def safeForRetry (ns : List NodeStatus) : Bool :=
  ns.all (fun n => nodeReady n || decided n)

-- Reviews have durably settled every lane. No node is leased/running/reconciling.
theorem mixed_review_is_safe : safeForRetry [.succeeded, .retryReady] = true := by decide

theorem mixed_review_has_work : runnableSubset [.succeeded, .retryReady] = true := by decide

theorem mixed_review_cannot_acquire : freshCustodyReady [.succeeded, .retryReady] = false := by decide

theorem acquisition_is_stricter_than_safe_retry :
    ∃ ns, safeForRetry ns = true ∧ runnableSubset ns = true ∧ freshCustodyReady ns = false := by
  exact ⟨[.succeeded, .retryReady], by decide, by decide, by decide⟩

-- Exhaustively enumerate two-lane decided/retry-ready review outcomes.
def reviewOutcomes : List NodeStatus := [.succeeded, .abandoned, .retryReady]
def rejectedSafeRetries : List (NodeStatus × NodeStatus) :=
  (reviewOutcomes.flatMap fun a => reviewOutcomes.map fun b => (a, b)).filter fun pair =>
    let ns := [pair.1, pair.2]
    safeForRetry ns && runnableSubset ns && !freshCustodyReady ns

#eval rejectedSafeRetries

theorem four_two_lane_counterexamples : rejectedSafeRetries.length = 4 := by decide

-- run-tool.ts recoverSettledRunningWave excludes active nodes, then accepts
-- needs_review/detached/failed/ready/retry_ready but rejects succeeded/abandoned.
def activeNode (n : NodeStatus) : Bool :=
  n == .leased || n == .running || n == .reconciling

def recoverableNode (n : NodeStatus) : Bool :=
  n == .needsReview || n == .detached || n == .failed || nodeReady n

def waveRecoverable (ns : List NodeStatus) : Bool :=
  !ns.any activeNode && ns.all recoverableNode

theorem settled_retry_has_no_active_lanes :
    ([.succeeded, .needsReview] : List NodeStatus).any activeNode = false := by decide

theorem completed_sibling_blocks_retry_recovery :
    waveRecoverable [.succeeded, .needsReview] = false := by decide

-- Historical proposed guard abstraction: ignore decided
-- siblings, require a nonempty runnable set and no active execution evidence.
def correctedCustodyReady (ns : List NodeStatus) : Bool :=
  safeForRetry ns && runnableSubset ns

def correctedWaveRecoverable (ns : List NodeStatus) : Bool :=
  !ns.any activeNode && ns.all (fun n => recoverableNode n || decided n)

theorem corrected_subset_guards_progress :
    correctedCustodyReady [.succeeded, .retryReady] = true ∧
    correctedWaveRecoverable [.succeeded, .needsReview] = true := by decide

-- Recovery model: precreateLane durably labels WorkerRun running before dispatch.
-- After owner exit, recovery requires clearing these flags, while applying
-- resource classification requires the old owner token or prior successful takeover.
structure RecoveryState where
  ownerPresent : Bool
  ownerDead : Bool
  localToken : Bool
  workerRunningFlag : Bool
  attemptActive : Bool
  stageTerminal : Bool
  dispatched : Bool
  deriving DecidableEq, Repr

inductive Action where
  | inspect | classifyReadOnly | ordinaryMutation | takeover | relinquish
  | classifyApply | releaseLeases | finalizeCleanup
  deriving DecidableEq, Repr

def noActive (s : RecoveryState) : Bool := !s.workerRunningFlag && !s.attemptActive

def enabled (s : RecoveryState) : Action → Bool
  | .inspect => true
  | .classifyReadOnly => true
  | .ordinaryMutation => !s.ownerPresent || s.localToken
  | .takeover => s.ownerPresent && s.ownerDead && noActive s
  | .relinquish => s.ownerPresent && s.stageTerminal && noActive s
  | .classifyApply => noActive s && (!s.ownerPresent || s.localToken)
  | .releaseLeases => s.stageTerminal && noActive s && (!s.ownerPresent || s.localToken)
  | .finalizeCleanup => !s.ownerPresent && s.stageTerminal && noActive s

-- Atomic API abstraction: unavailable operations return a refusal, read-only
-- operations preserve state. Successful mutation summaries only encode fields
-- needed for this counterexample, not full worker/lease semantics.
def step (s : RecoveryState) (a : Action) : RecoveryState :=
  if enabled s a then
    match a with
    | .inspect | .classifyReadOnly => s
    | .ordinaryMutation | .classifyApply => { s with workerRunningFlag := false, attemptActive := false }
    | .takeover => { s with localToken := true, ownerDead := false }
    | .relinquish | .releaseLeases | .finalizeCleanup => { s with ownerPresent := false }
  else s

def initial : RecoveryState :=
  ⟨false, false, false, false, false, false, false⟩

inductive Event where
  | acquire | persistPreparedLane | ownerExit
  deriving DecidableEq, Repr

def eventStep (s : RecoveryState) : Event → RecoveryState
  | .acquire => { s with ownerPresent := true, localToken := true }
  | .persistPreparedLane => { s with workerRunningFlag := true, attemptActive := true }
  | .ownerExit => { s with ownerDead := true, localToken := false }

def orphan : RecoveryState :=
  ⟨true, true, false, true, true, false, false⟩

theorem orphan_reachable_before_dispatch :
    eventStep (eventStep (eventStep initial .acquire) .persistPreparedLane) .ownerExit = orphan := by decide

theorem orphan_has_no_actual_dispatch : orphan.dispatched = false := by decide

theorem orphan_all_api_actions_stutter (a : Action) : step orphan a = orphan := by
  cases a <;> decide

def execute (s : RecoveryState) : List Action → RecoveryState
  | [] => s
  | a :: rest => execute (step s a) rest

theorem orphan_no_finite_api_sequence_recovers (actions : List Action) :
    execute orphan actions = orphan := by
  induction actions with
  | nil => rfl
  | cons a rest ih =>
      simp only [execute, orphan_all_api_actions_stutter]
      exact ih

-- A recovery operation would need additional trustworthy inactivity evidence;
-- merely bypassing the running-worker guard is not a safe repair.
-- Never-dispatched is a fact here, but it is NOT persisted in current WorkerRun.
def settleWithWitness (s : RecoveryState) (verifiedNeverDispatched : Bool) : RecoveryState :=
  if s.ownerDead && verifiedNeverDispatched && !s.dispatched then
    { s with workerRunningFlag := false, attemptActive := false }
  else s

theorem verified_predispatch_settlement_enables_takeover :
    enabled (settleWithWitness orphan true) .takeover = true := by decide

theorem no_witness_keeps_guard : settleWithWitness orphan false = orphan := by decide

#print axioms acquisition_is_stricter_than_safe_retry
#print axioms completed_sibling_blocks_retry_recovery
#print axioms orphan_no_finite_api_sequence_recovers
end StardockLifecycle

/-
Post-repair abstraction, linked to acquisition-readiness.ts, unresolved-wave.ts,
worker-dispatch.ts and prepared-work-recovery.ts.
Identity/contracts/revision/mutex/lease checks are summarized by exactEvidence;
their real filesystem behavior is covered by TypeScript subprocess tests.
The original namespace retains the pre-fix counterexamples as regressions.
-/
namespace StardockRepair
open StardockLifecycle

inductive Decision where
  | running | accepted | integrated | abandoned
  deriving DecidableEq, Repr

structure Lane where
  decision : Decision
  status : NodeStatus
  deriving DecidableEq, Repr

def unresolved (lane : Lane) : Bool := lane.decision == .running

-- Matches explicit selected-node readiness plus the stage-wide active-work guard.
def acquireSubset (selected allNodes : List NodeStatus) (workerRunning : Bool) : Bool :=
  !selected.isEmpty && selected.all nodeReady && !allNodes.any activeNode && !workerRunning

def recoverSubset (lanes : List Lane) : Bool :=
  let selected := lanes.filter unresolved
  !selected.isEmpty && !(selected.map Lane.status).any activeNode &&
    (selected.map Lane.status).all recoverableNode

theorem mixed_retry_progress :
    acquireSubset [.retryReady] [.succeeded, .retryReady] false = true := by decide

theorem interrupted_retry_progress :
    recoverSubset [⟨.accepted, .succeeded⟩, ⟨.running, .needsReview⟩] = true := by decide

theorem abandoned_sibling_progress :
    recoverSubset [⟨.abandoned, .abandoned⟩, ⟨.running, .needsReview⟩] = true := by decide

theorem integrated_sibling_progress :
    recoverSubset [⟨.integrated, .succeeded⟩, ⟨.running, .needsReview⟩] = true := by decide

theorem selected_active_retry_refused :
    acquireSubset [.running] [.succeeded, .running] false = false := by decide

theorem omitted_active_lane_refused :
    acquireSubset [.retryReady] [.running, .retryReady] false = false := by decide

inductive DispatchEvidence where
  | unknown | prepared | committed
  deriving DecidableEq, Repr

structure State where
  ownerDead : Bool
  exactEvidence : Bool
  workerRunning : Bool
  attemptActive : Bool
  dispatch : DispatchEvidence
  actuallyLaunched : Bool
  leaseHeld : Bool
  localToken : Bool
  deriving DecidableEq, Repr

def idle (s : State) : Bool := !s.workerRunning && !s.attemptActive

def witness (s : State) : Bool :=
  s.dispatch == .prepared && s.workerRunning && s.attemptActive && s.exactEvidence

def takeoverAllowed (s : State) : Bool :=
  s.ownerDead && s.exactEvidence && (idle s || witness s)

-- Atomic owner replacement/settlement; lease state is deliberately not changed.
def takeover (s : State) : State :=
  if takeoverAllowed s then
    { s with ownerDead := false, localToken := true, workerRunning := false, attemptActive := false }
  else s

def preparedOrphan : State := ⟨true, true, true, true, .prepared, false, true, false⟩

theorem prepared_orphan_progress :
    takeoverAllowed preparedOrphan = true ∧ (takeover preparedOrphan).localToken = true ∧
    idle (takeover preparedOrphan) = true := by decide

theorem live_owner_refused (s : State) (h : s.ownerDead = false) :
    takeoverAllowed s = false := by simp [takeoverAllowed, h]

theorem unverifiable_identity_refused (s : State) (h : s.exactEvidence = false) :
    takeoverAllowed s = false := by simp [takeoverAllowed, h]

theorem unknown_running_worker_refused (s : State)
    (hd : s.dispatch = .unknown) (hw : s.workerRunning = true) :
    takeoverAllowed s = false := by simp [takeoverAllowed, idle, witness, hd, hw]

theorem committed_running_worker_refused (s : State)
    (hd : s.dispatch = .committed) (hw : s.workerRunning = true) :
    takeoverAllowed s = false := by simp [takeoverAllowed, idle, witness, hd, hw]

theorem takeover_preserves_lease (s : State) : (takeover s).leaseHeld = s.leaseHeld := by
  unfold takeover
  split <;> rfl

def launchInvariant (s : State) : Prop := s.actuallyLaunched = true → s.dispatch = .committed

-- Dispatch side effect is reachable only after the durable committed write.
def invoke (s : State) : State :=
  if s.dispatch == .committed then { s with actuallyLaunched := true } else s

theorem invocation_preserves_dispatch_proof (s : State) (h : launchInvariant s) :
    launchInvariant (invoke s) := by
  unfold invoke
  split
  · rename_i committed
    simp_all [launchInvariant]
  · exact h

theorem reachable_prepared_witness_implies_no_launch (s : State)
    (h : launchInvariant s) (hp : s.dispatch = .prepared) :
    s.actuallyLaunched = false := by
  cases hl : s.actuallyLaunched
  · rfl
  · have hc := h hl
    simp [hp] at hc

#print axioms live_owner_refused
#print axioms unknown_running_worker_refused
#print axioms committed_running_worker_refused
#print axioms takeover_preserves_lease
#print axioms reachable_prepared_witness_implies_no_launch
end StardockRepair
