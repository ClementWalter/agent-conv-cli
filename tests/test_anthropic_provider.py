"""Private Claude payload contracts fail closed when upstream shapes change."""

from copy import deepcopy

import pytest

from one_conv.providers.anthropic import AnthropicProvider, CAPABILITIES
from one_conv.providers.base import AuthenticationRequired, SchemaChanged


class StubTransport:
    """Capture requests without requiring provider credentials or network access."""

    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def get(self, path, params=None):
        self.calls.append((path, params))
        return deepcopy(self.payload)


@pytest.fixture
def transcript():
    return {
        "uuid": "chat-1", "name": "A decision", "current_leaf_message_uuid": "m2",
        "chat_messages": [
            {"uuid": "m1", "sender": "human", "parent_message_uuid": None,
             "content": [{"type": "text", "text": "Question"}]},
            {"uuid": "m2", "sender": "assistant", "parent_message_uuid": "m1",
             "content": [{"type": "text", "text": "Answer"},
                         {"type": "tool_use", "name": "search", "input": {"q": "topic"}}]},
        ],
    }


def test_preserves_parent(transcript):
    provider = AnthropicProvider(None, "org", transport=StubTransport(transcript))
    assert provider.read_conversation("chat-1").messages[1].parent_id == "m1"


def test_preserves_tool_blocks(transcript):
    provider = AnthropicProvider(None, "org", transport=StubTransport(transcript))
    assert provider.read_conversation("chat-1").messages[1].content_blocks[1]["name"] == "search"


def test_retains_active_leaf(transcript):
    provider = AnthropicProvider(None, "org", transport=StubTransport(transcript))
    assert provider.read_conversation("chat-1").active_leaf_id == "m2"


def test_nontext_tool_content_is_searchable(transcript):
    provider = AnthropicProvider(None, "org", transport=StubTransport(transcript))
    assert "topic" in provider.read_conversation("chat-1").messages[1].text


def test_unknown_content_fails_closed(transcript):
    transcript["chat_messages"][0]["content"] = [{"type": "future_schema", "value": "important"}]
    provider = AnthropicProvider(None, "org", transport=StubTransport(transcript))
    with pytest.raises(SchemaChanged):
        provider.read_conversation("chat-1")


def test_attachment_extracted_text_is_retained(transcript):
    transcript["chat_messages"][0]["attachments"] = [{"file_name": "note.txt", "extracted_content": "decision evidence"}]
    provider = AnthropicProvider(None, "org", transport=StubTransport(transcript))
    assert "decision evidence" in provider.read_conversation("chat-1").messages[0].text


def test_attachment_metadata_is_preserved(transcript):
    transcript["chat_messages"][0]["files"] = [{"file_name": "photo.png", "file_uuid": "asset1"}]
    provider = AnthropicProvider(None, "org", transport=StubTransport(transcript))
    assert provider.read_conversation("chat-1").messages[0].content_blocks[-1]["metadata"]["file_uuid"] == "asset1"


def test_read_requests_full_tree(transcript):
    transport = StubTransport(transcript)
    AnthropicProvider(None, "org", transport=transport).read_conversation("chat-1")
    assert transport.calls == [("/api/organizations/org/chat_conversations/chat-1",
                               {"tree": "true", "rendering_mode": "messages", "render_all_tools": "true"})]


@pytest.mark.parametrize("field,value", [("uuid", "another"), ("chat_messages", {}),
                                        ("current_leaf_message_uuid", "missing")])
def test_rejects_invalid_transcript(transcript, field, value):
    transcript[field] = value
    provider = AnthropicProvider(None, "org", transport=StubTransport(transcript))
    with pytest.raises(SchemaChanged):
        provider.read_conversation("chat-1")


@pytest.mark.parametrize("field,value", [("uuid", None), ("sender", "unknown"),
                                        ("content", "text"), ("parent_message_uuid", [])])
def test_rejects_invalid_message(transcript, field, value):
    transcript["chat_messages"][0][field] = value
    provider = AnthropicProvider(None, "org", transport=StubTransport(transcript))
    with pytest.raises(SchemaChanged):
        provider.read_conversation("chat-1")


def test_rejects_duplicate_ids(transcript):
    transcript["chat_messages"][1]["uuid"] = "m1"
    provider = AnthropicProvider(None, "org", transport=StubTransport(transcript))
    with pytest.raises(SchemaChanged):
        provider.read_conversation("chat-1")


def test_selects_explicit_organization():
    transport = StubTransport([{"uuid": "other", "name": "Other"}, {"uuid": "org", "name": "Mine"}])
    assert AnthropicProvider(None, "org", transport=transport).validate_connection().label == "Mine"


def test_denies_unavailable_organization():
    provider = AnthropicProvider(None, "org", transport=StubTransport([]))
    with pytest.raises(AuthenticationRequired):
        provider.validate_connection()


def test_cowork_capability_is_not_claimed():
    assert CAPABILITIES == ("claude_chat:list", "claude_chat:read")


@pytest.mark.parametrize("payload", [{"error": "challenge"}, None, "html"])
def test_rejects_non_array_listing(payload):
    provider = AnthropicProvider(None, "org", transport=StubTransport(payload))
    with pytest.raises(SchemaChanged):
        provider.list_conversations()


def test_paginates_snapshot_without_omission():
    provider = AnthropicProvider(None, "org", transport=StubTransport([
        {"uuid": "one", "name": "First"}, {"uuid": "two", "name": "Second"},
    ]))
    first = provider.list_conversations(limit=1)
    assert provider.list_conversations(first.next_cursor, limit=1).items[0].id == "two"


def test_rejects_changed_listing_cursor():
    transport = StubTransport([{"uuid": "one", "name": "First"}, {"uuid": "two", "name": "Second"}])
    provider = AnthropicProvider(None, "org", transport=transport)
    first = provider.list_conversations(limit=1)
    transport.payload.append({"uuid": "three", "name": "Third"})
    with pytest.raises(SchemaChanged):
        provider.list_conversations(first.next_cursor)


def test_organization_path_is_encoded():
    transport = StubTransport([])
    AnthropicProvider(None, "../org", transport=transport).list_conversations()
    assert transport.calls[0][0] == "/api/organizations/..%2Forg/chat_conversations"


def test_session_transport_to_normalized_conversation(transcript):
    class Response:
        status_code = 200
        headers = {}

        def json(self):
            return transcript

    class Session:
        def get(self, url, **kwargs):
            if url != "https://claude.ai/api/organizations/org/chat_conversations/chat-1":
                raise ValueError("Unexpected provider route")
            return Response()

    assert AnthropicProvider(Session(), "org").read_conversation("chat-1").messages[0].text == "Question"
