"""Provider transport failures never masquerade as an empty conversation archive."""

from types import SimpleNamespace

import pytest

from one_conv.providers.base import (AuthenticationRequired, JsonTransport, ProviderUnavailable,
                                     RateLimited, SchemaChanged, retry_response)
from one_conv.providers.chatgpt import ChatGPTProvider


class StubSession:
    def __init__(self, statuses, payload=None, headers=None):
        self.statuses = iter(statuses)
        self.payload = {} if payload is None else payload
        self.headers = headers or {}
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return SimpleNamespace(status_code=next(self.statuses), headers=self.headers,
                               json=lambda: self.payload)


@pytest.mark.parametrize("status", [401, 403])
def test_authentication_errors_are_typed(status):
    with pytest.raises(AuthenticationRequired):
        JsonTransport(StubSession([status]), "https://example.com", "fixture").get("/read")


def test_rate_limit_honors_retry_after():
    delays = []
    JsonTransport(StubSession([429, 200], headers={"Retry-After": "2"}), "https://example.com",
                  "fixture", sleep=delays.append).get("/read")
    assert delays == [2.0]


def test_long_rate_limit_is_returned_without_sleep():
    with pytest.raises(RateLimited) as error:
        JsonTransport(StubSession([429], headers={"Retry-After": "120"}), "https://example.com",
                      "fixture").get("/read")
    assert error.value.retry_after == 120


def test_retry_count_is_bounded():
    session = StubSession([503, 503, 503])
    with pytest.raises(ProviderUnavailable):
        JsonTransport(session, "https://example.com", "fixture", sleep=lambda _: None).get("/read")
    assert len(session.calls) == 3


def test_redirect_is_not_followed():
    session = StubSession([302])
    with pytest.raises(ProviderUnavailable):
        JsonTransport(session, "https://example.com", "fixture").get("/read")
    assert session.calls[0][1]["allow_redirects"] is False


@pytest.mark.parametrize("path", ["https://attacker.example", "//attacker.example", "/\\attacker"])
def test_external_paths_are_rejected(path):
    with pytest.raises(ValueError):
        JsonTransport(StubSession([]), "https://example.com", "fixture").get(path)


@pytest.mark.parametrize("payload", [[], {}, {"items": None}, {"items": [{}]}])
def test_chatgpt_schema_drift_is_visible(payload):
    with pytest.raises(SchemaChanged):
        ChatGPTProvider(StubSession([200], payload)).list_conversations()


def test_chatgpt_empty_live_page_advances_to_archive():
    assert ChatGPTProvider(StubSession([200], {"items": []})).list_conversations().next_cursor == "1:0"


def test_chatgpt_empty_archive_finishes():
    assert ChatGPTProvider(StubSession([200], {"items": []})).list_conversations("1:0").next_cursor is None


def test_chatgpt_preserves_message_branches():
    message = {"author": {"role": "assistant"}, "content": {"parts": ["answer"]}}
    payload = {"mapping": {"a": {"message": None}, "b": {"parent": "a", "message": message},
                           "c": {"parent": "a", "message": message}}, "current_node": "c"}
    result = ChatGPTProvider(StubSession([200], payload)).read_conversation("conversation")
    assert tuple((item.id, item.parent_id) for item in result.messages) == (("a", None), ("b", "a"), ("c", "a"))


def test_chatgpt_structural_leaf_keeps_parent_link():
    payload = {"mapping": {"root": {"message": {"author": {"role": "user"}, "content": {"parts": ["hello"]}}},
                           "leaf": {"parent": "root", "message": None}}, "current_node": "leaf"}
    result = ChatGPTProvider(StubSession([200], payload)).read_conversation("conversation")
    assert result.messages[1].parent_id == "root"


def test_chatgpt_search_preserves_snippet():
    payload = {"items": [{"conversation_id": "c", "payload": {"snippet": "found"}}]}
    assert ChatGPTProvider(StubSession([200], payload)).search_conversations("query")[0]["payload"]["snippet"] == "found"


def test_chatgpt_search_rejects_empty_object():
    with pytest.raises(SchemaChanged):
        ChatGPTProvider(StubSession([200], {})).search_conversations("query")


def test_chatgpt_search_rejects_repeated_cursor():
    payload = {"items": [{"conversation_id": "c"}], "cursor": "same"}
    with pytest.raises(SchemaChanged):
        ChatGPTProvider(StubSession([200, 200], payload)).search_conversations("query")


def test_compatibility_retry_returns_original_response():
    response = SimpleNamespace(status_code=200)
    assert retry_response(lambda: response) is response


def test_compatibility_retry_keeps_not_found_response():
    response = SimpleNamespace(status_code=404)
    assert retry_response(lambda: response) is response


def test_compatibility_retry_exhaustion_is_explicit():
    response = SimpleNamespace(status_code=429)
    assert retry_response(lambda: response, sleep=lambda _: None) is None


def test_compatibility_retry_honors_server_delay():
    responses = iter([SimpleNamespace(status_code=429, headers={"Retry-After": "10"}),
                      SimpleNamespace(status_code=200)])
    delays = []
    retry_response(lambda: next(responses), sleep=delays.append)
    assert delays == [10]


def test_chatgpt_account_identity():
    payload = {"accessToken": "fixture-token", "account": {"id": "account"}, "user": {"email": "user@example.test"}}
    assert ChatGPTProvider(StubSession([200], payload)).validate_connection().id == "account"


def test_chatgpt_missing_account_is_not_connected():
    with pytest.raises(SchemaChanged):
        ChatGPTProvider(StubSession([200], {"accessToken": "fixture-token", "user": {}})).validate_connection()


def test_chatgpt_cookie_session_authorizes_api_requests():
    session = StubSession([200], {"accessToken": "fixture-token", "account": {"id": "account"}})
    ChatGPTProvider(session).validate_connection()
    assert session.headers == {"Authorization": "Bearer fixture-token", "ChatGPT-Account-ID": "account"}


def test_chatgpt_expired_cookie_session_requires_login():
    with pytest.raises(AuthenticationRequired):
        ChatGPTProvider(StubSession([200], {})).validate_connection()


@pytest.mark.parametrize("delay", ["nan", "inf", "-inf"])
def test_nonfinite_retry_after_uses_bounded_fallback(delay):
    delays = []
    JsonTransport(StubSession([429, 200], headers={"Retry-After": delay}), "https://example.com",
                  "fixture", sleep=delays.append).get("/read")
    assert delays == [1]


@pytest.mark.parametrize("payload", [None, [], {"mapping": []}, {"mapping": {}, "current_node": "missing"}])
def test_chatgpt_invalid_graph_fails(payload):
    with pytest.raises(SchemaChanged):
        ChatGPTProvider(StubSession([200], payload)).read_conversation("conversation")


def test_chatgpt_rich_content_is_retained():
    content = {"content_type": "multimodal_text", "parts": [{"asset_pointer": "asset"}]}
    payload = {"mapping": {"node": {"message": {"author": {"role": "user"}, "content": content}}}}
    result = ChatGPTProvider(StubSession([200], payload)).read_conversation("conversation")
    assert result.messages[0].content_blocks == (content,)
