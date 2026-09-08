"""Validate Claude session selection without accessing browser stores or secrets."""

import pytest

from one_conv.browser_auth import claude_accounts
from one_conv.cloud_cli import browser_provider
from one_conv.providers.base import SchemaChanged


class StubSession:
    """Serve synthetic membership metadata through the real transport boundary."""

    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        response = type("Response", (), {"status_code": self.status, "headers": {}})()
        response.json = lambda: self.payload
        return response


@pytest.fixture
def memberships():
    return [{"uuid": "personal-org", "name": "Personal"}, {"uuid": "work-org", "name": "Work"}]


def test_discovers_separate_organization_accounts(memberships):
    session = StubSession(memberships)
    accounts = list(claude_accounts(lambda: [("profile", {"sessionKey": "synthetic"})], session_factory=lambda _: session))
    assert [account["organization_id"] for account in accounts] == ["personal-org", "work-org"]


def test_does_not_invent_email(memberships):
    session = StubSession(memberships)
    account = next(claude_accounts(lambda: [("profile", {"sessionKey": "synthetic"})], session_factory=lambda _: session))
    assert account["email"] is None


def test_uses_authenticated_organizations_route(memberships):
    session = StubSession(memberships)
    list(claude_accounts(lambda: [("profile", {"sessionKey": "synthetic"})], session_factory=lambda _: session))
    assert session.calls[0][0] == "https://claude.ai/api/organizations"


def test_keeps_shared_organization_users_separate(memberships):
    session = StubSession(memberships)
    accounts = list(claude_accounts(lambda: [("one", {"sessionKey": "synthetic"}), ("two", {"sessionKey": "synthetic2"})],
                                   session_factory=lambda _: session))
    assert len({account["account_id"] for account in accounts}) == 4


def test_expired_browser_session_yields_no_account():
    session = StubSession({}, status=401)
    assert list(claude_accounts(lambda: [("profile", {"sessionKey": "synthetic"})], session_factory=lambda _: session)) == []


@pytest.mark.parametrize("payload", [{"error": "invalid"}, [{"uuid": "org"}], [None]])
def test_malformed_identity_fails_closed(payload):
    session = StubSession(payload)
    with pytest.raises(SchemaChanged):
        list(claude_accounts(lambda: [("profile", {"sessionKey": "synthetic"})], session_factory=lambda _: session))


def test_missing_session_skips_network():
    def factory(cookies):
        raise AssertionError("Missing session cannot authorize a request")
    assert list(claude_accounts(lambda: [("profile", {})], session_factory=factory)) == []


def test_rejects_cookie_header_injection():
    with pytest.raises(SchemaChanged):
        list(claude_accounts(lambda: [("profile", {"sessionKey": "synthetic\r\nheader"})]))


def test_cloud_selector_builds_claude_provider(memberships):
    session = StubSession(memberships)
    accounts = lambda: claude_accounts(lambda: [("profile", {"sessionKey": "synthetic"})], session_factory=lambda _: session)
    assert browser_provider("claude-chat", "Work", accounts).organization_id == "work-org"


def test_scopes_validated_identity_to_selected_profile(memberships):
    session = StubSession(memberships)
    accounts = lambda: claude_accounts(lambda: [("profile", {"sessionKey": "synthetic"})], session_factory=lambda _: session)
    provider = browser_provider("claude-chat", "Work", accounts)
    assert provider.validate_connection().id == next(a for a in accounts() if a["organization_label"] == "Work")["account_id"]
