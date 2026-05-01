------------------------ MODULE StardockRecursiveLifecycle ------------------------
EXTENDS Naturals, FiniteSets, TLC

(***************************************************************************)
(* A small executable model of the Stardock recursive-loop lifecycle.       *)
(*                                                                         *)
(* Source slice modeled:                                                    *)
(* - src/runtime/core-tools.ts: stardock_start and stardock_done             *)
(* - src/runtime/lifecycle.ts: complete/pause lifecycle transitions          *)
(* - src/runtime/prompts.ts: recursive onIterationDone attempt placeholder   *)
(* - src/outside-requests.ts: governor cadence/stagnation request creation   *)
(* - src/attempt-reports.ts: structured attempt report recording             *)
(* - src/briefs.ts: active brief lifecycle on stardock_done                  *)
(*                                                                         *)
(* This model intentionally abstracts away file contents, timestamps, UI,    *)
(* durable JSON serialization, exact prompt text, and non-recursive modes.   *)
(***************************************************************************)

CONSTANTS
    MaxIterations,
    GovernorIterations,
    OutsideHelpOnStagnation

ASSUME MaxIterations \in Nat \ {0}
ASSUME GovernorIterations \subseteq 1..MaxIterations
ASSUME OutsideHelpOnStagnation \in BOOLEAN

Iterations == 1..MaxIterations
Statuses == {"none", "active", "paused", "completed"}
AttemptStates == {"none", "pending", "reportedGood", "reportedBad", "reportedScaffold"}
BriefStates == {"none", "active", "draft", "completed"}
BriefActions == {"keep", "complete", "clear"}

VARIABLES
    status,          \* loop lifecycle status
    currentLoop,     \* runtime.ref.currentLoop is set
    iteration,       \* current Stardock iteration/attempt number
    pendingPrompt,   \* pi has a queued follow-up prompt
    taskReadable,    \* simplified result of reading state.taskFile after done
    attempts,        \* structured/pending attempt state by iteration
    governorReqs,    \* iterations with a governor review request
    failureReqs,     \* iterations with a stagnation/failure-analysis request
    scaffoldReqs,    \* iterations with a scaffold-drift mutation request
    brief            \* one abstract current/previous brief state

vars == << status, currentLoop, iteration, pendingPrompt, taskReadable,
          attempts, governorReqs, failureReqs, scaffoldReqs, brief >>

TypeOk ==
    /\ status \in Statuses
    /\ currentLoop \in BOOLEAN
    /\ iteration \in 0..(MaxIterations + 1)
    /\ pendingPrompt \in BOOLEAN
    /\ taskReadable \in BOOLEAN
    /\ attempts \in [Iterations -> AttemptStates]
    /\ governorReqs \subseteq Iterations
    /\ failureReqs \subseteq Iterations
    /\ scaffoldReqs \subseteq Iterations
    /\ brief \in BriefStates

Init ==
    /\ status = "none"
    /\ currentLoop = FALSE
    /\ iteration = 0
    /\ pendingPrompt = FALSE
    /\ taskReadable = TRUE
    /\ attempts = [i \in Iterations |-> "none"]
    /\ governorReqs = {}
    /\ failureReqs = {}
    /\ scaffoldReqs = {}
    /\ brief = "none"

Start ==
    /\ status = "none"
    /\ status' = "active"
    /\ currentLoop' = TRUE
    /\ iteration' = 1
    /\ pendingPrompt' = TRUE
    /\ taskReadable' = TRUE
    /\ attempts' = [i \in Iterations |-> "none"]
    /\ governorReqs' = {}
    /\ failureReqs' = {}
    /\ scaffoldReqs' = {}
    /\ brief' = brief

ConsumePrompt ==
    /\ status = "active"
    /\ pendingPrompt
    /\ pendingPrompt' = FALSE
    /\ UNCHANGED << status, currentLoop, iteration, taskReadable, attempts,
                    governorReqs, failureReqs, scaffoldReqs, brief >>

SetTaskUnreadable ==
    /\ status = "active"
    /\ taskReadable
    /\ taskReadable' = FALSE
    /\ UNCHANGED << status, currentLoop, iteration, pendingPrompt, attempts,
                    governorReqs, failureReqs, scaffoldReqs, brief >>

SetTaskReadable ==
    /\ status = "active"
    /\ ~taskReadable
    /\ taskReadable' = TRUE
    /\ UNCHANGED << status, currentLoop, iteration, pendingPrompt, attempts,
                    governorReqs, failureReqs, scaffoldReqs, brief >>

ActivateBrief ==
    /\ status = "active"
    /\ brief # "active"
    /\ brief' = "active"
    /\ UNCHANGED << status, currentLoop, iteration, pendingPrompt, taskReadable,
                    attempts, governorReqs, failureReqs, scaffoldReqs >>

ManualGovernorRequest ==
    /\ status = "active"
    /\ iteration \in Iterations
    /\ iteration \notin governorReqs
    /\ governorReqs' = governorReqs \cup {iteration}
    /\ UNCHANGED << status, currentLoop, iteration, pendingPrompt, taskReadable,
                    attempts, failureReqs, scaffoldReqs, brief >>

ReportAttemptGood(i) ==
    /\ status = "active"
    /\ i \in Iterations
    /\ i <= iteration
    /\ attempts' = [attempts EXCEPT ![i] = "reportedGood"]
    /\ UNCHANGED << status, currentLoop, iteration, pendingPrompt, taskReadable,
                    governorReqs, failureReqs, scaffoldReqs, brief >>

ReportAttemptBad(i) ==
    /\ status = "active"
    /\ i \in Iterations
    /\ i <= iteration
    /\ attempts' = [attempts EXCEPT ![i] = "reportedBad"]
    /\ UNCHANGED << status, currentLoop, iteration, pendingPrompt, taskReadable,
                    governorReqs, failureReqs, scaffoldReqs, brief >>

ReportAttemptScaffold(i) ==
    /\ status = "active"
    /\ i \in Iterations
    /\ i <= iteration
    /\ attempts' = [attempts EXCEPT ![i] = "reportedScaffold"]
    /\ UNCHANGED << status, currentLoop, iteration, pendingPrompt, taskReadable,
                    governorReqs, failureReqs, scaffoldReqs, brief >>

ApplyBriefLifecycle(action) ==
    IF action = "complete" /\ brief = "active" THEN "completed"
    ELSE IF action = "clear" /\ brief = "active" THEN "draft"
    ELSE brief

StagnationReqsFor(attempts1) ==
    IF OutsideHelpOnStagnation
       /\ iteration >= 2
       /\ attempts1[iteration] = "reportedBad"
       /\ attempts1[iteration - 1] = "reportedBad"
    THEN failureReqs \cup {iteration}
    ELSE failureReqs

ScaffoldReqsFor(attempts1) ==
    IF OutsideHelpOnStagnation
       /\ iteration >= 3
       /\ attempts1[iteration] = "reportedScaffold"
       /\ attempts1[iteration - 1] = "reportedScaffold"
       /\ attempts1[iteration - 2] = "reportedScaffold"
    THEN scaffoldReqs \cup {iteration}
    ELSE scaffoldReqs

Done(action) ==
    /\ status = "active"
    /\ ~pendingPrompt
    /\ iteration \in Iterations
    /\ action \in BriefActions
    /\ LET attempts1 == IF attempts[iteration] = "none"
                         THEN [attempts EXCEPT ![iteration] = "pending"]
                         ELSE attempts
           governor1 == IF iteration \in GovernorIterations
                         THEN governorReqs \cup {iteration}
                         ELSE governorReqs
           failure1 == StagnationReqsFor(attempts1)
           scaffold1 == ScaffoldReqsFor(attempts1)
           brief1 == ApplyBriefLifecycle(action)
           nextIter == iteration + 1
           brief2 == IF (nextIter > MaxIterations \/ ~taskReadable) /\ brief1 = "active"
                     THEN "draft"
                     ELSE brief1
       IN
       /\ attempts' = attempts1
       /\ governorReqs' = governor1
       /\ failureReqs' = failure1
       /\ scaffoldReqs' = scaffold1
       /\ brief' = brief2
       /\ taskReadable' = taskReadable
       /\ iteration' = nextIter
       /\ IF nextIter > MaxIterations THEN
              /\ status' = "completed"
              /\ currentLoop' = FALSE
              /\ pendingPrompt' = FALSE
          ELSE IF taskReadable THEN
              /\ status' = "active"
              /\ currentLoop' = TRUE
              /\ pendingPrompt' = TRUE
          ELSE
              /\ status' = "paused"
              /\ currentLoop' = FALSE
              /\ pendingPrompt' = FALSE

CompletionMarker ==
    /\ status = "active"
    /\ status' = "completed"
    /\ currentLoop' = FALSE
    /\ pendingPrompt' = FALSE
    /\ iteration' = iteration
    /\ brief' = IF brief = "active" THEN "completed" ELSE brief
    /\ UNCHANGED << taskReadable, attempts, governorReqs, failureReqs,
                    scaffoldReqs >>

StopOrPause ==
    /\ status = "active"
    /\ status' \in {"paused", "completed"}
    /\ currentLoop' = FALSE
    /\ pendingPrompt' = FALSE
    /\ iteration' = iteration
    /\ brief' = IF brief = "active" THEN "draft" ELSE brief
    /\ UNCHANGED << taskReadable, attempts, governorReqs, failureReqs,
                    scaffoldReqs >>

Next ==
    \/ Start
    \/ ConsumePrompt
    \/ SetTaskUnreadable
    \/ SetTaskReadable
    \/ ActivateBrief
    \/ ManualGovernorRequest
    \/ \E i \in Iterations : ReportAttemptGood(i)
    \/ \E i \in Iterations : ReportAttemptBad(i)
    \/ \E i \in Iterations : ReportAttemptScaffold(i)
    \/ \E action \in BriefActions : Done(action)
    \/ CompletionMarker
    \/ StopOrPause

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* Safety properties checked by TLC.                                        *)
(***************************************************************************)

RuntimeRefMatchesLifecycle ==
    (status = "active") <=> currentLoop

NoQueuedPromptUnlessActive ==
    pendingPrompt => status = "active"

CompletedOrPausedCannotHaveQueuedPrompt ==
    status \in {"paused", "completed"} => ~pendingPrompt /\ ~currentLoop

ActiveIterationInRange ==
    status = "active" => iteration \in Iterations

AttemptReportsAreNotFuture ==
    \A i \in Iterations : attempts[i] # "none" => i <= iteration

PendingAttemptOnlyAfterDoneAdvanced ==
    \A i \in Iterations : attempts[i] = "pending" => i < iteration

RequestsOnlyForReachedIterations ==
    \A i \in governorReqs \cup failureReqs \cup scaffoldReqs : i <= iteration

OutsideRequestsDoNotOutliveRange ==
    /\ governorReqs \subseteq Iterations
    /\ failureReqs \subseteq Iterations
    /\ scaffoldReqs \subseteq Iterations

ActiveBriefOnlyWhileLoopCanAdvance ==
    brief = "active" => status = "active"

Safety ==
    /\ TypeOk
    /\ RuntimeRefMatchesLifecycle
    /\ NoQueuedPromptUnlessActive
    /\ CompletedOrPausedCannotHaveQueuedPrompt
    /\ ActiveIterationInRange
    /\ AttemptReportsAreNotFuture
    /\ PendingAttemptOnlyAfterDoneAdvanced
    /\ RequestsOnlyForReachedIterations
    /\ OutsideRequestsDoNotOutliveRange
    /\ ActiveBriefOnlyWhileLoopCanAdvance

=============================================================================
