# Mutatr Product Requirements Document (PRD)

Status: Draft v1  
Date: March 2, 2026  
Author: Codex (based on `mutatr.com` product positioning)

## 1. Product Summary

Mutatr is an autonomous experimentation agent for small teams and indie builders.  
It suggests A/B tests, implements variants, runs experiment flights, and delivers scorecards with recommended next actions.

Core promise from the landing page:
- Traditional A/B tools are built for enterprises.
- Mutatr brings enterprise-grade experimentation to small teams.
- It works autonomously.
- It can test against synthetic customer profiles when real traffic is low.
- It integrates with tools teams already use (Cursor, Zapier, n8n).

## 2. Problem Statement

Small teams know they should run experiments, but they rarely do because:
- They lack a dedicated growth/experimentation team.
- Designing, implementing, and analyzing tests is time-consuming.
- Low traffic makes statistical learning slow.
- Most tools are optimized for large organizations and complex setup.

Result: websites stay static, conversion opportunities are missed, and optimization velocity is low.

## 3. Target Users

Primary users:
- Indie founders
- Startup product builders
- Small PM/design/engineering teams
- Agencies managing small-to-mid traffic websites

Secondary users:
- Growth marketers at early-stage companies
- Product engineers who want automation over manual experiment operations

## 4. Jobs To Be Done

1. When I have a landing page/product flow, I want the system to propose high-impact tests so I don’t start from a blank slate.
2. When I approve a test idea, I want it implemented automatically so engineering effort is minimal.
3. When tests run, I want clear scorecards so I can make decisions quickly.
4. When my traffic is low, I want synthetic profiles to provide directional insight before live scale.
5. When a test wins, I want the system to suggest and launch next iterations automatically.

## 5. Product Goals

### Business Goals
- Make experimentation accessible to non-enterprise teams.
- Reduce time from idea to shipped experiment.
- Increase customer retention via continuous optimization loop.

### User Outcome Goals
- Decrease time to first experiment (TTFX) to < 1 day.
- Enable > 5 experiments/month for a typical small team.
- Improve conversion metrics through sustained test cadence.

## 6. Non-Goals (MVP)

- Full enterprise governance (advanced RBAC, legal workflows, etc.)
- Deep warehouse-native analytics platform replacement
- Multivariate experimentation at enterprise scale
- Native mobile-app SDKs (web-first MVP)

## 7. Core Product Capabilities

## 7.1 Agentic Experiment Suggestion

The system generates experiment ideas from:
- Website/page content
- Existing analytics context
- Prior experiment history
- Persona segments

Output:
- Hypothesis
- Variant description(s)
- Expected impact
- Confidence band
- Required implementation scope

## 7.2 Autonomous Variant Implementation

Mutatr can implement approved variants automatically via integration paths:
- Direct code editing workflow (e.g., Cursor-assisted workflow)
- Automation workflows (Zapier / n8n)
- CMS/API patch paths where possible

Controls:
- Human approval mode (default for MVP)
- Auto-ship mode with guardrails (optional)
- Rollback path for each variant

## 7.3 Flight Orchestration

A “flight” is a test run with explicit configuration:
- Control and variant definitions
- Audience targeting (including persona-level targeting)
- Traffic split
- Duration and stopping rules
- Primary and secondary metrics

## 7.4 Scorecards and Decision Engine

Each flight produces a scorecard containing:
- Uplift/impact by metric
- Statistical confidence (method selectable in system design)
- Segment-level performance
- Recommendation: Ship, Iterate, Stop, Needs more data

## 7.5 Persona-Aware Experimentation

Mutatr supports testing across customer personas (e.g., “Aldric the Elder”, “Finnegan the Young” style segments):
- Persona profiles with needs/interests/preferences
- Segment-specific winner detection
- Personalized variant recommendations by persona cluster

## 7.6 Synthetic Profile Engine (Low-Traffic Mode)

For low/no traffic sites, Mutatr runs pre-flight simulations:
- Generates synthetic customer profiles at scale
- Simulates likely behavior against variants
- Produces directional scorecards before live traffic

Important: MVP must clearly label synthetic outcomes as directional, not equivalent to production conversion lift.

## 8. User Experience Requirements

Primary UX flow:
1. Connect site and integrations.
2. Agent proposes top test opportunities.
3. User approves one or more tests.
4. Mutatr implements variants.
5. User launches flight.
6. Scorecards arrive with recommendations.
7. User ships winner or queues next iteration.

Experience principles:
- Fast setup
- Opinionated defaults
- Clear confidence language
- One-screen understanding of “what to do next”

## 9. Functional Requirements (MVP)

FR-1: User can create a workspace and connect at least one website/project.  
FR-2: User can connect at least one automation/development integration (Cursor, Zapier, or n8n path).  
FR-3: System generates ranked experiment suggestions with hypothesis + expected impact.  
FR-4: User can approve/reject/edit suggestions.  
FR-5: System can create control + variant definitions and track revision history.  
FR-6: System can trigger implementation workflow for approved variants.  
FR-7: User can configure and launch an experiment flight.  
FR-8: System can ingest experiment events and compute scorecards.  
FR-9: System can provide decision recommendation (ship/iterate/stop).  
FR-10: User can enable synthetic profile simulation for low-traffic tests.  
FR-11: Scorecards must distinguish synthetic vs live results.  
FR-12: System logs all agent actions and user approvals for traceability.  
FR-13: User can rollback a live variant to control state.

## 10. Non-Functional Requirements

- Reliability: 99.5%+ availability target for core dashboard/orchestration APIs.
- Security: encrypted data in transit and at rest.
- Auditability: immutable action log for agent actions and approvals.
- Performance:
  - suggestion generation p95 < 60s for standard page context
  - scorecard render p95 < 5s
- Privacy: configurable handling of PII and synthetic data boundaries.

## 11. Data & Metrics

### Product KPIs
- Time to first launched experiment
- Experiments launched per workspace per month
- Percent of experiments with actionable decision
- Recommendation acceptance rate
- Variant implementation success rate

### Experimentation KPIs (customer-facing)
- Conversion rate uplift
- CTR uplift
- Activation funnel improvement
- Segment-level uplift variance

### Synthetic Engine KPIs
- Correlation between synthetic predictions and later live outcomes
- Calibration error by persona/segment

## 12. Guardrails and Trust

- Default “human approval required” before implementation and launch.
- Mandatory confidence + uncertainty language in all scorecards.
- Clear warning when sample size is insufficient.
- Hard stop if tracking integrity checks fail.
- Easy one-click rollback to control.

## 13. Integrations (MVP)

Required initial integration surfaces:
- Cursor workflow support for code-edit implementation
- Zapier connector for automation actions
- n8n connector for workflow-based orchestration

Integration outcomes:
- Trigger implementation jobs
- Push status updates back to Mutatr
- Receive completion/failure signals for scorecards and logs

## 14. Assumptions

- Customers can provide enough page/content context for useful suggestions.
- Early adopters accept synthetic profile outputs as directional.
- Most small teams prefer automated implementation with approval gates.
- Initial integration depth can be shallow (trigger + status) and still provide value.

## 15. Risks and Mitigations

Risk: Incorrect recommendations reduce trust.  
Mitigation: Confidence transparency, conservative default recommendations, fast rollback.

Risk: Synthetic outputs diverge from real-world behavior.  
Mitigation: Explicit labeling, calibration tracking, hybrid synthetic+live strategy.

Risk: Integration brittleness across customer stacks.  
Mitigation: Start with narrow integration contracts and strong observability.

Risk: Autonomous edits cause regressions.  
Mitigation: Diff previews, approval flow, automated checks, rollback-first design.

## 16. MVP Release Plan

Phase 1: Foundations
- Workspace/project setup
- Suggestion generation
- Manual approval workflow

Phase 2: Agent Execution
- Autonomous variant implementation via integrations
- Flight setup and launch

Phase 3: Decision Loop
- Scorecards and recommendations
- Synthetic profile simulations
- Iteration queue (next-best test suggestions)

## 17. Open Questions

1. Which statistical decision framework is default in MVP (frequentist vs Bayesian)?
2. What minimum event schema is required from customers to run scorecards?
3. Which implementation targets are in-scope first (static site, React app, CMS)?
4. Should auto-ship mode be available in MVP or post-MVP?
5. What is the billing unit (experiments, traffic, workspaces, or agent actions)?

## 18. MVP Definition of Done

MVP is complete when a small team can:
1. Connect a project and one integration.
2. Receive at least 3 usable experiment suggestions.
3. Approve and implement at least 1 variant autonomously.
4. Run a live or synthetic-backed flight.
5. Receive a scorecard with a clear ship/iterate/stop recommendation.
6. Rollback safely if needed.

