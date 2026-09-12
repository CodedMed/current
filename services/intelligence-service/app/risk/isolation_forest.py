"""Isolation Forest anomaly scoring.

The forest is fitted on the vendor's own history and the raw score is converted into a relative
anomaly percentile. The raw score is not a fraud probability and must never be presented as one;
with less history the rules score stands alone.

Needs the ``ml`` extra (scikit-learn).
"""

from __future__ import annotations

MODEL_VERSION = "invoice-risk-v1"
RULES_WEIGHT = 0.60
ML_WEIGHT = 0.40

MINIMUM_REFERENCE_INVOICES = 2
_RANDOM_STATE = 7
_TREES = 200


def anomaly_percentile(features: dict[str, float], history_features: list[dict[str, float]]) -> float:
    """Share of the vendor's own history that looks more ordinary than this invoice."""
    if len(history_features) < MINIMUM_REFERENCE_INVOICES:
        return 0.0

    # Imported lazily so the rules-only path still works when the ml extra is not installed.
    import numpy as np
    from sklearn.ensemble import IsolationForest

    columns = sorted(features)
    reference = np.array(
        [[row.get(column, 0.0) for column in columns] for row in history_features], dtype=float
    )
    target = np.array([[features[column] for column in columns]], dtype=float)

    forest = IsolationForest(n_estimators=_TREES, random_state=_RANDOM_STATE)
    forest.fit(reference)

    # score_samples is higher for points the forest considers normal, so counting the reference
    # invoices that score above this one turns the raw value into a percentile.
    reference_scores = forest.score_samples(reference)
    target_score = forest.score_samples(target)[0]
    return float(np.mean(reference_scores > target_score))
