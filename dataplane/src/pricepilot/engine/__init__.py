"""Explainable rules-based pricing engine.

Pure rule functions (``rules/``) each contribute a signed percentage adjustment
with a human-readable reason; ``pipeline.compute`` combines them into a price;
``explainer.build_factors_payload`` renders the reasoning JSON defined in
``shared/contracts/recommendation-factors.md``.
"""

# "2": competitor_position factor carries band_low/band_high
# (shared/contracts/recommendation-factors.md changelog).
ENGINE_VERSION = "2"
