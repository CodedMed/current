"""Derive optional fingerprints locally, without retaining identifiers."""
import hashlib
import re


def invoice_number_hash(number: str | None) -> str | None:
    """Stable identity for an invoice reference, so a re-issued or re-uploaded invoice can be
    recognised as a duplicate without the number itself ever being stored or transmitted.

    Canonicalised to upper-case alphanumerics first ("CP-2026-0061", "cp 2026 0061" and
    "CP2026-0061" are the same invoice)."""
    if not number:
        return None
    canonical = re.sub(r"[^A-Z0-9]", "", number.upper())
    if len(canonical) < 3:
        return None
    return "sha256:" + hashlib.sha256(f"invoice-number|{canonical}".encode()).hexdigest()


def payment_fingerprint(text: str) -> str | None:
    fields = {}
    for label, value in re.findall(
        r"(?im)^\s*(account|routing|iban)(?:\s+(?:number|no\.?))?\s*[:#]\s*([A-Z0-9][A-Z0-9 -]{3,40})\s*$",
        text,
    ):
        fields[label.lower()] = re.sub(r"[ -]", "", value).upper()
    if not fields:
        return None
    canonical = "|".join(f"{key}:{fields[key]}" for key in sorted(fields))
    return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()
