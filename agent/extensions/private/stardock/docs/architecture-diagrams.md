# Stardock architecture diagrams

These diagrams describe Stardock's target architecture and current private implementation direction. The private extension provides checklist and recursive loops, structured attempt reports, governor/outside request payloads, criterion ledgers, verification artifacts, iteration briefs, final reports, auditor reviews, advisory handoffs, breakout packages, worker reports, read-only policy recommendations, and local `.stardock/` state. Direct subagent execution and evolve mode remain planned design gates.

## High-level architecture

```mermaid
flowchart TB
  User[User / Parent Agent]

  subgraph Stardock[Private Stardock Extension]
    Controller[Loop Controller]
    State[(Durable Stardock State)]
    PromptBuilder[Prompt / Brief Builder]
    Governor[Governor]
    Auditor[Auditor / Oversight Reviewer]
  end

  subgraph Work[Bounded Work]
    Worker[Implementer / Main Agent]
    Explorer[Explorer Subagent]
    TestRunner[Test Runner Subagent]
    Researcher[Researcher Subagent]
  end

  subgraph Evidence[Evidence System]
    Criteria[Criterion Ledger]
    Artifacts[(Verification Artifacts)]
    Reports[Worker / Attempt Reports]
    FinalReport[Final Verification Report]
  end

  User -->|start / resume / answer| Controller
  Controller <--> State
  State <--> Criteria
  State <--> Reports
  State <--> Artifacts

  Controller --> PromptBuilder
  PromptBuilder -->|compact IterationBrief| Worker

  Governor -->|select next criteria + context| PromptBuilder
  Reports --> Governor
  Criteria --> Governor
  Artifacts --> Governor

  Auditor -. periodic / gated review .-> Governor
  Criteria --> Auditor
  Reports --> Auditor
  Artifacts --> Auditor

  Worker -->|attempt report| Reports
  Worker -->|validation evidence| Artifacts
  Worker -->|criterion status updates| Criteria

  Controller -->|outside request payload| Researcher
  Controller -->|explore payload| Explorer
  Controller -->|validation payload| TestRunner

  Explorer --> Reports
  TestRunner --> Artifacts
  Researcher --> Reports

  Governor -->|continue / pivot / measure / stop / ask user| Controller
  Auditor -->|blocker / warning / approval gate| Controller
  Controller --> FinalReport
```

## Core loop flow

```mermaid
flowchart TD
  A[Start Stardock Loop] --> B[Create / Load Durable State]
  B --> C{Mode}

  C -->|checklist| D[Use Task File Checklist]
  C -->|recursive| E[Use Objective + Attempt State]
  C -->|evolve future| F[Use Candidate Archive + Evaluator]

  D --> G[Build Iteration Brief]
  E --> H[Governor Selects Next Move]
  F --> H

  H --> I[Select Criteria + Required Context]
  I --> G

  G --> J[Queue Compact Prompt to Worker]
  J --> K[Worker Performs One Bounded Attempt]
  K --> L[Run / Describe Validation]
  L --> M[Record Attempt Report]
  M --> N[Update Criterion Ledger + Evidence Artifacts]

  N --> O{Done?}
  O -->|No| P{Drift / Blocked / Outside Help?}
  P -->|No| H
  P -->|Yes| Q[Create Outside / Governor / Auditor Request]
  Q --> R[Parent or Subagent Handles Request]
  R --> S[Record Answer / Decision / Findings]
  S --> H

  O -->|Yes| T[Final Verification Report]
  T --> U{Auditor Gate Needed?}
  U -->|No| V[Complete]
  U -->|Yes| W[Auditor Reviews Completion Evidence]
  W --> X{Approved?}
  X -->|Yes| V
  X -->|No| H
```

## Loop state machine

```mermaid
stateDiagram-v2
  [*] --> Idle

  Idle --> ActiveChecklist: stardock_start(mode=checklist)
  Idle --> ActiveRecursive: stardock_start(mode=recursive)
  Idle --> EvolveReserved: stardock_start(mode=evolve)

  EvolveReserved --> Idle: reject unsupported/reserved mode

  ActiveChecklist --> ActiveChecklist: stardock_done / next iteration
  ActiveRecursive --> ActiveRecursive: stardock_done / next bounded attempt

  ActiveChecklist --> Paused: /stardock stop
  ActiveRecursive --> Paused: /stardock stop
  Paused --> ActiveChecklist: /stardock resume checklist loop
  Paused --> ActiveRecursive: /stardock resume recursive loop

  ActiveRecursive --> PendingOutsideRequest: governor/research/stagnation trigger
  PendingOutsideRequest --> ActiveRecursive: outside answer recorded

  ActiveRecursive --> PendingAudit: periodic/pre-completion/automation gate
  PendingAudit --> ActiveRecursive: auditor warning handled
  PendingAudit --> Blocked: auditor blocker requires user/governor response
  Blocked --> ActiveRecursive: override or required action recorded

  ActiveChecklist --> FinalVerification: completion marker
  ActiveRecursive --> FinalVerification: completion marker or stop criteria met

  FinalVerification --> PendingAudit: unresolved/skipped criteria or high-risk completion
  FinalVerification --> Completed: all required evidence accepted
  PendingAudit --> Completed: auditor approves completion

  Completed --> Archived: /stardock archive
  Completed --> Idle: clean/cancel/nuke
```

## Data flow: plan to criteria to evidence to completion

```mermaid
flowchart LR
  Plan[Canonical Plan / Task File]
  Ledger[Criterion Ledger]
  Brief[Iteration Brief]
  Work[Bounded Worker Attempt]
  Report[Worker Report]
  Evidence[(Verification Artifacts)]
  Governor[Governor Decision]
  Auditor[Auditor Review]
  Final[Final Verification Report]

  Plan -->|distill requirements| Ledger
  Ledger -->|selected criterion IDs| Brief
  Plan -->|selected context only| Brief

  Brief --> Work
  Work --> Report
  Work --> Evidence

  Report -->|status / failures / risks| Ledger
  Evidence -->|test, smoke, curl, browser, benchmark| Ledger

  Ledger --> Governor
  Report --> Governor
  Evidence --> Governor

  Governor -->|next move| Brief
  Governor -->|completion candidate| Final

  Final --> Auditor
  Ledger --> Auditor
  Report --> Auditor
  Evidence --> Auditor

  Auditor -->|approved| Final
  Auditor -->|blocker / revisit criteria| Governor
```

## Governor and auditor split

```mermaid
flowchart TB
  Objective[Original Objective + Non-goals]
  Criteria[Criterion Ledger]
  Reports[Recent Worker Reports]
  Artifacts[Evidence Artifacts]
  Budget[Iteration / Failure Budget]

  Governor[Governor]
  Auditor[Auditor]

  Decision[Governor Decision]
  Brief[Next Iteration Brief]
  Gate[Gate / Blocker / User Question]
  User[User]

  Objective --> Governor
  Criteria --> Governor
  Reports --> Governor
  Artifacts --> Governor
  Budget --> Governor

  Governor --> Decision
  Decision --> Brief

  Objective --> Auditor
  Criteria --> Auditor
  Reports --> Auditor
  Artifacts --> Auditor
  Budget --> Auditor
  Decision --> Auditor

  Auditor -->|aligned| Brief
  Auditor -->|minor concerns| Decision
  Auditor -->|blocker| Gate
  Gate -->|governor complies| Brief
  Gate -->|governor rejects with rationale| Brief
  Gate -->|needs value/scope call| User
```

## Subagent role flow

```mermaid
flowchart TD
  Governor[Governor Chooses Need]

  Governor -->|need codebase map| Explorer[Explorer Subagent]
  Governor -->|need noisy validation| TestRunner[Test Runner Subagent]
  Governor -->|need ideas / prior art| Researcher[Researcher Subagent]
  Governor -->|need bounded change later| Implementer[Implementer Subagent]

  Explorer --> ExplorerReport[File / Symbol Map<br/>Relevant Tests<br/>Validation Commands<br/>Risk Notes]
  TestRunner --> TestReport[Compact Failure Summary<br/>Full Logs as Artifacts]
  Researcher --> ResearchReport[Ideas<br/>Examples<br/>Failure Analysis]
  Implementer --> WorkerReport[Changed Files<br/>Criteria Evaluated<br/>Evidence<br/>Risks]

  ExplorerReport --> State[(Stardock State)]
  TestReport --> State
  ResearchReport --> State
  WorkerReport --> State

  State --> Governor

  Auditor[Auditor] -. reviews gates .-> Governor
  Auditor -. before editing subagents .-> Implementer
```

## Evidence and artifact model

```mermaid
flowchart LR
  Criterion[Criterion]
  Red[Red Evidence]
  Green[Green Evidence]
  Test[Test Command]
  Smoke[Smoke / curl Check]
  Browser[Browser / Screenshot]
  Bench[Benchmark]
  Walkthrough[Walkthrough / Explanation]
  Journal[(Evidence Journal)]
  Final[Final Verification Report]

  Criterion --> Red
  Criterion --> Green

  Test --> Journal
  Smoke --> Journal
  Browser --> Journal
  Bench --> Journal
  Walkthrough --> Journal

  Journal -->|artifact refs + summaries| Criterion
  Journal -->|selected artifacts| Final

  Red --> Final
  Green --> Final
```

## Planned evolution phases

```mermaid
flowchart TD
  A[Private Stardock Shell<br/>Done] --> B[Criterion Ledger]
  B --> C[Verification Artifacts]
  C --> D[Context Packet Routing]
  D --> E[Auditor Oversight]
  E --> F[Worker Reports + Selective Review]
  F --> G[Breakout + Final Verification]
  G --> H[Compound Learning + Cognitive Debt Gates]
  H --> I[Advisory Subagents]
  I --> J[Editing Subagents<br/>Gated]
  J --> K[Evolve Mode<br/>Gated]
```

## Summary flow

```text
Plan
  ↓
Criterion Ledger
  ↓
Governor selects next criteria/context
  ↓
Worker gets compact brief
  ↓
Worker produces report + evidence
  ↓
Governor decides next move
  ↓
Auditor occasionally checks governor/gates
  ↓
Final verification or breakout
```
