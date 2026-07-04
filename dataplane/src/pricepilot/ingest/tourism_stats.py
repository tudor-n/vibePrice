"""INS (Romanian National Institute of Statistics) tourism statistics ingestion.

Will pull monthly arrivals/overnight-stays series for a county/city from the
INS Tempo Online API (http://statistici.insse.ro:8077/tempo-online/) and write
them into ``demand_signals`` (source="ins", metric e.g. "overnight_stays").
The engine uses them as ``avg_occupancy_by_month`` seasonality evidence.

Not implemented in v1 scaffolding.
"""

from datetime import date
from decimal import Decimal


def fetch_monthly_overnight_stays(county: str, start: date, end: date) -> dict[date, Decimal]:
    """Fetch monthly overnight-stay counts for a county from INS Tempo."""
    raise NotImplementedError(
        "INS Tempo ingestion is not implemented yet; will query the Tempo Online "
        "API and persist rows into demand_signals."
    )
