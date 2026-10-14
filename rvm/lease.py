"""Session lease protocol v2 (B01b): signed reward caps.

Shared contract fixture: tests/fixtures/contracts/machine-lease.v2.json
(asserted here by tests/test_rvm_lease_contract.py and on the backend by
tests/contracts/machine-lease-contract.test.ts; signer: lib/machine-lease.ts).

Canonical form: the compact UTF-8 JSON array
    [2, id, machineCode, sessionId, userRef, issuedAt, expiresAt,
     reservationId, policyVersion, ceilingRupiah, maxItems]
serialised with ``json.dumps(..., separators=(",", ":"), ensure_ascii=False)``,
which is byte-identical to Node's ``JSON.stringify`` for the integer/string/
null values the fields are restricted to. The signature is HMAC-SHA256 over
those bytes with the machine secret.

``policyVersion`` is the hex SHA-256 of the admission snapshot's canonical
form ``[1, mode, multiplierBps, [[wasteTypeId, unit, rewardPerUnit,
maxRewardRupiah] ...sorted by wasteTypeId]]``; the snapshot travels with the
lease (``policy``) and is accepted only when it hashes to the signed version,
so the per-item caps the machine enforces locally cannot be lowered or
raised without breaking the signature.

A lease without ``version: 2`` (the pre-B01b v1 contract) is refused: a cap
that is not signed is never given a permissive fallback.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import math
from typing import Any

LEASE_PROTOCOL_VERSION = 2
LEASE_PROTOCOL_HEADER = "x-reloop-lease-protocol"
POLICY_VERSION = 1

LEASE_V2_FIELDS = (
    "id", "machineCode", "sessionId", "userRef", "issuedAt", "expiresAt",
    "reservationId", "policyVersion", "ceilingRupiah", "maxItems",
)

# Bound block reasons (rvm/controller.py); never interlock reasons.
SESSION_CEILING_REACHED = "SESSION_CEILING_REACHED"
SESSION_MAX_ITEMS_REACHED = "SESSION_MAX_ITEMS_REACHED"
BPS = 10_000


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _str(value: Any) -> bool:
    return isinstance(value, str) and value != ""


def _utf8(value: Any) -> bool:
    """A string the canonical form can encode (a lone surrogate cannot be)."""
    if not isinstance(value, str):
        return False
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


HEX64 = frozenset("0123456789abcdef")


def _hex64(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(c in HEX64 for c in value)


def lease_field_error(lease: dict[str, Any]) -> str | None:
    """Why the v2 fields are not well-typed, or None."""
    for key in LEASE_V2_FIELDS:
        if key not in lease:
            return f"LEASE_FIELDS: {key} missing"
    if not (_str(lease["id"]) and _str(lease["machineCode"]) and _str(lease["sessionId"])):
        return "LEASE_FIELDS: id/machineCode/sessionId must be non-empty strings"
    if not (lease["userRef"] is None or _str(lease["userRef"])):
        return "LEASE_FIELDS: userRef must be a string or null"
    for key in ("id", "machineCode", "sessionId", "userRef", "reservationId", "policyVersion"):
        value = lease[key]
        if isinstance(value, str) and not _utf8(value):
            return f"LEASE_MALFORMED: {key} is not valid UTF-8"
    for key in ("issuedAt", "expiresAt"):
        if not _is_int(lease[key]) or lease[key] <= 0:
            return f"LEASE_FIELDS: {key} must be a positive integer"
    if not (lease["reservationId"] is None or _str(lease["reservationId"])):
        return "LEASE_FIELDS: reservationId must be a string or null"
    if not _hex64(lease["policyVersion"]):
        return "LEASE_FIELDS: policyVersion must be a sha256 hex"
    ceiling = lease["ceilingRupiah"]
    if not (ceiling is None or (_is_int(ceiling) and ceiling >= 0)):
        return "LEASE_FIELDS: ceilingRupiah must be a non-negative integer or null"
    max_items = lease["maxItems"]
    if not (max_items is None or (_is_int(max_items) and max_items >= 1)):
        return "LEASE_FIELDS: maxItems must be a positive integer or null"
    return None


def canonical_lease_v2(lease: dict[str, Any]) -> bytes:
    error = lease_field_error(lease)
    if error:
        raise ValueError(error)
    return _canonical_bytes([LEASE_PROTOCOL_VERSION, *(lease[key] for key in LEASE_V2_FIELDS)])


def _hmac_hex(secret: str, canonical: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()


def sign_lease_v2(secret: str, fields: dict[str, Any]) -> dict[str, Any]:
    """Signs the given fields (the simulator and tests; the server signs in Node)."""
    lease = {key: fields[key] for key in LEASE_V2_FIELDS}
    lease["signature"] = _hmac_hex(secret, canonical_lease_v2(lease))
    return {"version": LEASE_PROTOCOL_VERSION, **lease}


# --------------------------------------------------------------------------- #
# policy snapshot
# --------------------------------------------------------------------------- #
def policy_error(policy: Any) -> str | None:
    if not isinstance(policy, dict):
        return "LEASE_POLICY_MALFORMED: not an object"
    if policy.get("version") != POLICY_VERSION:
        return "LEASE_POLICY_MALFORMED: version"
    if policy.get("mode") not in {"MONEY_REWARD", "COMPLIANCE_ONLY"}:
        return "LEASE_POLICY_MALFORMED: mode"
    bps = policy.get("multiplierBps")
    if not _is_int(bps) or bps <= 0:
        return "LEASE_POLICY_MALFORMED: multiplierBps"
    types = policy.get("wasteTypes")
    if not isinstance(types, list):
        return "LEASE_POLICY_MALFORMED: wasteTypes"
    seen: set[str] = set()
    for entry in types:
        if not isinstance(entry, dict) or not _str(entry.get("id")) or not _utf8(entry["id"]) or entry["id"] in seen:
            return "LEASE_POLICY_MALFORMED: wasteTypes[].id"
        seen.add(entry["id"])
        if entry.get("unit") not in {"ITEM", "KG"}:
            return "LEASE_POLICY_MALFORMED: wasteTypes[].unit"
        if not _is_int(entry.get("rewardPerUnit")) or entry["rewardPerUnit"] < 0:
            return "LEASE_POLICY_MALFORMED: wasteTypes[].rewardPerUnit"
        cap = entry.get("maxRewardRupiah")
        if not (cap is None or (_is_int(cap) and cap >= 0)):
            return "LEASE_POLICY_MALFORMED: wasteTypes[].maxRewardRupiah"
    return None


def canonical_policy(policy: dict[str, Any]) -> bytes:
    error = policy_error(policy)
    if error:
        raise ValueError(error)
    rows = sorted(policy["wasteTypes"], key=lambda entry: entry["id"])
    return _canonical_bytes([
        POLICY_VERSION, policy["mode"], policy["multiplierBps"],
        [[entry["id"], entry["unit"], entry["rewardPerUnit"], entry["maxRewardRupiah"]] for entry in rows],
    ])


def policy_version(policy: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_policy(policy)).hexdigest()


def verify_lease_v2(secret: str, lease: Any, machine_code: str) -> str | None:
    """The refusal reason, or None when the lease is a valid v2 lease for this
    machine with a snapshot that hashes to its signed policyVersion."""
    # C4: malformed input is refused with a reason; this function never raises.
    try:
        if not isinstance(lease, dict):
            return "LEASE_MALFORMED"
        if lease.get("version") != LEASE_PROTOCOL_VERSION or isinstance(lease.get("version"), bool):
            return "LEASE_VERSION"
        error = lease_field_error(lease)
        if error:
            return error
        if lease["machineCode"] != machine_code:
            return "LEASE_MACHINE_MISMATCH"
        signature = lease.get("signature")
        if not _hex64(signature):
            return "LEASE_SIGNATURE_FORMAT"
        try:
            canonical = canonical_lease_v2(lease)
        except (ValueError, TypeError, UnicodeEncodeError):
            return "LEASE_MALFORMED"
        if not hmac.compare_digest(_hmac_hex(secret, canonical), signature):
            return "LEASE_SIGNATURE"
        policy = lease.get("policy")
        if policy is None:
            return "LEASE_POLICY_MISSING"
        error = policy_error(policy)
        if error:
            return error
        try:
            if policy_version(policy) != lease["policyVersion"]:
                return "LEASE_POLICY_MISMATCH"
        except (ValueError, TypeError, UnicodeEncodeError):
            return "LEASE_POLICY_MALFORMED"
        return None
    except Exception as exc:  # noqa: BLE001 - defensive: a lease must never crash the controller
        return f"LEASE_MALFORMED: {type(exc).__name__}"


# --------------------------------------------------------------------------- #
# local bound
# --------------------------------------------------------------------------- #
def item_caps(policy: dict[str, Any] | None, max_item_weight_grams: float) -> dict[str, int]:
    """The most the server can pay for one item of each type under the
    snapshot. A KG type without a server-side maximum weight is bounded by this
    machine's own maximum item weight (heavier items are rejected before the
    acceptance point), rounded up."""
    if not policy or policy_error(policy):
        return {}
    multiplier = policy["multiplierBps"] / BPS
    caps: dict[str, int] = {}
    for entry in policy["wasteTypes"]:
        cap = entry["maxRewardRupiah"]
        if cap is None:
            if entry["unit"] == "KG":
                cap = math.ceil(max(0.0, max_item_weight_grams) / 1000.0 * entry["rewardPerUnit"] * multiplier)
            else:
                cap = math.ceil(entry["rewardPerUnit"] * multiplier)
        caps[entry["id"]] = int(cap)
    return caps


def item_cap(caps: dict[str, int], waste_type_id: str | None, ceiling: int | None) -> int:
    """Cap of the next item: the selected type's, else the most expensive
    type's (nothing selected), else (no snapshot types at all) one more than
    the ceiling, so an un-priceable item is never accepted against a money
    bound."""
    if waste_type_id is not None and waste_type_id in caps:
        return caps[waste_type_id]
    if caps:
        return max(caps.values())
    return (ceiling + 1) if ceiling is not None else 0


def bound_state(
    *,
    ceiling: int | None,
    max_items: int | None,
    policy: dict[str, Any] | None,
    consumed_rupiah: int,
    consumed_items: int,
    max_item_weight_grams: float,
) -> dict[str, Any] | None:
    """The session bound as the kiosk shows it, or None when the lease carries
    no bound. ``exhausted`` means no further item can be accepted: the item
    bound is used up, or not even the cheapest type fits under the ceiling."""
    if ceiling is None and max_items is None:
        return None
    caps = item_caps(policy, max_item_weight_grams)
    cheapest = min(caps.values()) if caps else None
    remaining_rupiah = None if ceiling is None else max(0, ceiling - consumed_rupiah)
    remaining_items = None if max_items is None else max(0, max_items - consumed_items)
    reason: str | None = None
    if max_items is not None and consumed_items >= max_items:
        reason = SESSION_MAX_ITEMS_REACHED
    elif ceiling is not None and (cheapest is None or consumed_rupiah + cheapest > ceiling):
        reason = SESSION_CEILING_REACHED
    return {
        "ceilingRupiah": ceiling,
        "maxItems": max_items,
        "consumedRupiah": consumed_rupiah,
        "consumedItems": consumed_items,
        "remainingRupiah": remaining_rupiah,
        "remainingItems": remaining_items,
        "exhausted": reason is not None,
        "reason": reason,
    }


def item_block_reason(
    *,
    ceiling: int | None,
    max_items: int | None,
    policy: dict[str, Any] | None,
    consumed_rupiah: int,
    consumed_items: int,
    waste_type_id: str | None,
    max_item_weight_grams: float,
) -> str | None:
    """Why one more item of ``waste_type_id`` must not be accepted now, or None."""
    if max_items is not None and consumed_items >= max_items:
        return SESSION_MAX_ITEMS_REACHED
    if ceiling is not None:
        cap = item_cap(item_caps(policy, max_item_weight_grams), waste_type_id, ceiling)
        if consumed_rupiah + cap > ceiling:
            return SESSION_CEILING_REACHED
    return None
