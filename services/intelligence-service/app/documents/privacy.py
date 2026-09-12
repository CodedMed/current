"""Derive an optional payment fingerprint locally, without retaining identifiers."""
import hashlib
import re


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
