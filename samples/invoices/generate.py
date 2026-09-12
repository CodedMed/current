"""Regenerate the sample invoices with dates relative to today.

The three PDFs are fixtures for the local document pipeline, and a fixture with a printed date
goes stale: extracted as-is, a due date from three months ago lands the obligation behind the
today marker on the dashboard. Run this before a demo so the dates read as current:

    services/intelligence-service/.venv/bin/python samples/invoices/generate.py

What the files encode, deliberately:

* The two normal invoices carry the same remit-to details, whose local fingerprint (the same
  derivation ``app.documents.privacy.payment_fingerprint`` applies to real uploads) is what the
  seeded Cloud Provider history uses. A real extraction of a normal invoice therefore does NOT
  trip "payment details changed" against the seed.
* The suspicious invoice is 30% higher, arrives off the monthly cadence, and remits to a
  different account — every rule the demo talks about, on one page.

Only PyMuPDF is needed. The account numbers are fictitious.
"""

from __future__ import annotations

import hashlib
from datetime import date, timedelta
from pathlib import Path

import fitz  # PyMuPDF

HERE = Path(__file__).resolve().parent
TODAY = date.today()

NORMAL_REMIT = {"account": "4417 2200 9831", "routing": "021000021"}
SUSPICIOUS_REMIT = {"account": "7702 5561 0043", "routing": "091000019"}


def fingerprint(remit: dict[str, str]) -> str:
    """Mirror of payment_fingerprint(): canonical 'account:…|routing:…' hashed with SHA-256."""
    fields = {k: v.replace(" ", "").replace("-", "").upper() for k, v in remit.items()}
    canonical = "|".join(f"{key}:{fields[key]}" for key in sorted(fields))
    return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()


def write_invoice(name: str, *, number: str, issued: date, due: date, lines: list[str],
                  amount: str, remit: dict[str, str], note: str | None = None) -> None:
    text = [
        "CLOUD PROVIDER INC",
        f"Invoice number: {number}",
        f"Invoice date: {issued.isoformat()}",
        f"Due date: {due.isoformat()}",
        *lines,
        f"Amount due: USD {amount}",
        "Remit to: Cloud Provider Inc",
        f"Account number: {remit['account']}",
        f"Routing number: {remit['routing']}",
    ]
    if note:
        text += ["", note]
    document = fitz.open()
    page = document.new_page()
    y = 72
    for line in text:
        page.insert_text((72, y), line, fontsize=11, fontname="helv")
        y += 18
    document.save(HERE / name)
    document.close()


def main() -> None:
    write_invoice(
        "normal_vendor_invoice_01.pdf",
        number="CP-2026-0041",
        issued=TODAY - timedelta(days=62), due=TODAY - timedelta(days=48),
        lines=["Managed compute and storage, monthly ....... 995.00"],
        amount="995.00", remit=NORMAL_REMIT,
    )
    write_invoice(
        "normal_vendor_invoice_02.pdf",
        number="CP-2026-0052",
        issued=TODAY - timedelta(days=32), due=TODAY - timedelta(days=18),
        lines=["Managed compute and storage, monthly ...... 1000.00"],
        amount="1000.00", remit=NORMAL_REMIT,
    )
    write_invoice(
        "suspicious_vendor_invoice.pdf",
        number="CP-2026-0061",
        issued=TODAY - timedelta(days=2), due=TODAY + timedelta(days=5),
        lines=[
            "Managed compute and storage, monthly ...... 1300.00",
            "Infrastructure surcharge (new) ................ included",
        ],
        amount="1300.00", remit=SUSPICIOUS_REMIT,
        note="NOTE: our banking details have changed. Please remit to the new account above.",
    )
    print(f"normal fingerprint     {fingerprint(NORMAL_REMIT)}")
    print(f"suspicious fingerprint {fingerprint(SUSPICIOUS_REMIT)}")
    print(f"wrote 3 invoices dated relative to {TODAY.isoformat()} in {HERE}")


if __name__ == "__main__":
    main()
