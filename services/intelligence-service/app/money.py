"""Money on the wire.

Amounts stay :class:`~decimal.Decimal` inside the service so no arithmetic happens in binary
floating point, and serialize as JSON numbers to match the ledger service's contract.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from pydantic import PlainSerializer

Money = Annotated[
    Decimal,
    PlainSerializer(lambda value: float(value), return_type=float, when_used="json"),
]
