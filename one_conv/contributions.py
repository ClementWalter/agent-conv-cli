"""Fail-closed eligibility decisions for separately authorized trace reuse."""

from dataclasses import dataclass
from enum import Enum


class Purpose(str, Enum):
    TRAINING = "oneconv_training"
    LICENSING = "third_party_training_license"


@dataclass(frozen=True)
class ContributionGrant:
    """Bind affirmative permission to a trace revision and an exact disclosed use."""

    tenant_id: str
    account_id: str
    trace_id: str
    revision: str
    purpose: Purpose
    notice_version: str
    recipient_id: str
    granted_at: int
    revoked: bool = False


@dataclass(frozen=True)
class Candidate:
    """Trusted service metadata accompanies content without including it in decisions."""

    tenant_id: str
    account_id: str
    trace_id: str
    revision: str
    plan: str
    personal_account: bool = False
    rights_cleared: bool = False
    screening_passed: bool = False
    deleted: bool = False


@dataclass(frozen=True)
class Decision:
    eligible: bool
    reason: str


def eligibility(candidate: Candidate, grant: ContributionGrant | None, *,
                purpose: Purpose, notice_version: str, recipient_id: str,
                now: int) -> Decision:
    """Recheck current billing, permissions and screening at each reuse boundary."""
    if candidate.deleted:
        return Decision(False, "deleted")
    # Unknown plans cannot accidentally enter a contribution pipeline.
    if candidate.plan != "free":
        return Decision(False, "plan_excluded")
    if not candidate.personal_account:
        return Decision(False, "work_account_excluded")
    if not candidate.rights_cleared or not candidate.screening_passed:
        return Decision(False, "review_incomplete")
    if grant is None or grant.revoked:
        return Decision(False, "no_active_permission")
    scope = (candidate.tenant_id, candidate.account_id, candidate.trace_id, candidate.revision)
    if not all(scope) or scope != (grant.tenant_id, grant.account_id, grant.trace_id, grant.revision):
        return Decision(False, "scope_mismatch")
    if not isinstance(purpose, Purpose) or grant.purpose != purpose:
        return Decision(False, "purpose_mismatch")
    if not notice_version or grant.notice_version != notice_version:
        return Decision(False, "notice_mismatch")
    if not recipient_id or grant.recipient_id != recipient_id:
        return Decision(False, "recipient_mismatch")
    if grant.granted_at <= 0 or grant.granted_at > now:
        return Decision(False, "invalid_permission_time")
    return Decision(True, "explicit_permission")
