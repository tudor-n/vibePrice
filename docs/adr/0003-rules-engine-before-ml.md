# ADR 0003: Explainable rules engine before ML

**Status:** Accepted · 2026-07-04

## Context

Recommendations must convince non-technical owners ("presented logically" is a product
requirement). No per-hotel training data exists yet. ML forecasting is impressive but
opaque and would delay launch.

## Decision

v1 pricing is a pipeline of pure-function rule modules (seasonality, event impact,
competitor position, day-of-week, lead time), each contributing a signed percentage
adjustment with a human-readable reason. The full reasoning is persisted as
`recommendations.factors` JSONB (`shared/contracts/recommendation-factors.md`).

Owner accept/dismiss responses are stored from day one and become future training data.
ML enters later as a demand-index *input* to the same pipeline (`engine/forecast/`),
not as a replacement for explainability.

## Consequences

- (+) Trustworthy, debuggable prices; testable rule boundaries; faster launch.
- (−) Less adaptive than learned models; rule weights need manual tuning per market
  until ML lands.
