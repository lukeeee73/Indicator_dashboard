"""Shared time-series calculations for the offline analytics scripts.

Model cutoffs, polarity, weights and release lags belong to their callers. These
helpers only standardize parsing, sampling and the existing numerical operations.
"""

from __future__ import annotations

import pandas as pd


def points_to_series(points: list[dict]) -> pd.Series:
    """Parse dated values without filling gaps or removing missing observations.

    Required columns remain strict, including for an empty list. Callers that
    accept absent series handle that case before parsing.
    """
    df = pd.DataFrame(points)
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date")["value"].astype(float).sort_index()


def monthly_last(series: pd.Series) -> pd.Series:
    """Last non-missing observation in each month, omitting empty months."""
    return series.resample("ME").last().dropna()


def midpoint_percentile(sample: pd.Series, value: float, *,
                        dropna: bool = True) -> float | None:
    """Midpoint rank on a 0..100 scale, preserving the caller's denominator.

    Current statistics omit missing observations. The reference trajectory
    historically counts them in its denominator, so it passes ``dropna=False``.
    """
    if dropna:
        sample = sample.dropna()
    n = len(sample)
    if n == 0 or pd.isna(value):
        return None
    values = sample.values
    below = float((values < value).sum())
    equal = float((values == value).sum())
    return (below + 0.5 * equal) / n * 100.0


def smooth_scores(scores: pd.Series | pd.DataFrame, span: int) -> pd.Series | pd.DataFrame:
    """Apply the models' adjusted EWMA and round only the smoothed scores."""
    return scores.ewm(span=span, min_periods=1).mean().round(1)
