"""Trace reuse requires current, purpose-specific permission on eligible content."""

from dataclasses import replace

import pytest

from one_conv.contributions import Candidate, ContributionGrant, Purpose, eligibility


@pytest.fixture
def candidate():
    return Candidate("tenant", "account", "trace", "revision", "free",
                     personal_account=True, rights_cleared=True, screening_passed=True)


@pytest.fixture
def grant():
    return ContributionGrant("tenant", "account", "trace", "revision", Purpose.TRAINING,
                             "notice-v1", "oneconv", 100)


def test_explicit_training_permission_is_eligible(candidate, grant):
    assert eligibility(candidate, grant, purpose=Purpose.TRAINING, notice_version="notice-v1",
                       recipient_id="oneconv", now=101).eligible


@pytest.mark.parametrize("change", [
    {"plan": "paid"}, {"plan": "unknown"}, {"deleted": True},
    {"personal_account": False}, {"rights_cleared": False}, {"screening_passed": False},
    {"tenant_id": "other"}, {"account_id": "other"}, {"trace_id": "other"},
    {"revision": "changed"}, {"trace_id": ""},
])
def test_ineligible_candidate_is_excluded(candidate, grant, change):
    assert not eligibility(replace(candidate, **change), grant, purpose=Purpose.TRAINING,
                           notice_version="notice-v1", recipient_id="oneconv", now=101).eligible


@pytest.mark.parametrize("change", [
    {"revoked": True}, {"purpose": Purpose.LICENSING}, {"notice_version": "old"},
    {"recipient_id": "other-buyer"}, {"granted_at": 102}, {"granted_at": 0},
])
def test_mismatched_permission_is_excluded(candidate, grant, change):
    assert not eligibility(candidate, replace(grant, **change), purpose=Purpose.TRAINING,
                           notice_version="notice-v1", recipient_id="oneconv", now=101).eligible


def test_free_plan_alone_does_not_authorize_reuse(candidate):
    assert not eligibility(candidate, None, purpose=Purpose.TRAINING, notice_version="notice-v1",
                           recipient_id="oneconv", now=101).eligible


def test_training_permission_does_not_authorize_resale(candidate, grant):
    assert not eligibility(candidate, grant, purpose=Purpose.LICENSING, notice_version="notice-v1",
                           recipient_id="buyer", now=101).eligible


def test_explicit_buyer_permission_authorizes_licensing(candidate, grant):
    permission = replace(grant, purpose=Purpose.LICENSING, recipient_id="buyer")
    assert eligibility(candidate, permission, purpose=Purpose.LICENSING, notice_version="notice-v1",
                       recipient_id="buyer", now=101).eligible
