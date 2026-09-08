"""Codex cloud contract tests use source-evidenced current-turn payloads."""

import pytest

from one_conv.providers.base import ProviderUnavailable, SchemaChanged
from one_conv.providers.codex import CAPABILITIES, CodexProvider


class SessionStub:
    """Record HTTP requests without credentials or provider network access."""

    def __init__(self, payload):
        self.payload = payload
        self.requests = []

    def get(self, url, **kwargs):
        self.requests.append((url, kwargs))
        return ResponseStub(self.payload)


class ResponseStub:
    status_code = 200
    headers = {}

    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


@pytest.fixture
def task():
    return {
        "task": {"id": "task_123", "title": "Refactor cloud task client"},
        "current_user_turn": {"input_items": [{
            "type": "message", "role": "user",
            "content": [{"content_type": "text", "text": "First line"},
                        {"content_type": "text", "text": "Second line"}],
        }]},
        "current_assistant_turn": {"output_items": [{
            "type": "message",
            "content": [{"content_type": "text", "text": "Assistant response"}],
        }]},
    }


def test_lists_only_source_evidenced_current_tasks():
    session = SessionStub({"items": [], "cursor": None})
    CodexProvider(session, "account").list_conversations(cursor="next", limit=20)
    assert session.requests[0] == (
        "https://chatgpt.com/backend-api/wham/tasks/list",
        {"params": {"limit": 20, "task_filter": "current", "cursor": "next"},
         "timeout": 20, "allow_redirects": False},
    )


def test_next_cursor_is_preserved():
    provider = CodexProvider(SessionStub({"items": [], "cursor": "next"}), "account")
    assert provider.list_conversations().next_cursor == "next"


def test_validation_discloses_partial_coverage():
    provider = CodexProvider(SessionStub({"items": []}), "account")
    assert provider.validate_connection().capabilities == CAPABILITIES


@pytest.mark.parametrize("index,expected", [(0, "First line\n\nSecond line"), (1, "Assistant response")])
def test_reads_current_turn_text(task, index, expected):
    provider = CodexProvider(SessionStub(task), "account")
    assert provider.read_conversation("task_123").messages[index].text == expected


def test_preserves_provider_message_id(task):
    task["current_user_turn"]["input_items"][0]["id"] = "message-id"
    provider = CodexProvider(SessionStub(task), "account")
    assert provider.read_conversation("task_123").messages[0].id == "message-id"


def test_reads_worklog_fallback(task):
    task["current_assistant_turn"] = {"worklog": {"messages": [{
        "author": {"role": "assistant"}, "content": {"parts": ["Worklog answer"]},
    }]}}
    provider = CodexProvider(SessionStub(task), "account")
    assert provider.read_conversation("task_123").messages[-1].text == "Worklog answer"


def test_encodes_task_identifier(task):
    task["task"]["id"] = "task/a?b"
    session = SessionStub(task)
    CodexProvider(session, "account").read_conversation("task/a?b")
    assert session.requests[0][0].endswith("/tasks/task%2Fa%3Fb")


@pytest.mark.parametrize("payload", [{}, {"items": {}}, {"items": [{}]}, {"items": [], "cursor": 3}])
def test_rejects_unknown_list_shape(payload):
    with pytest.raises(SchemaChanged):
        CodexProvider(SessionStub(payload), "account").list_conversations()


def test_rejects_wrong_task_identity(task):
    with pytest.raises(SchemaChanged, match="identity mismatch"):
        CodexProvider(SessionStub(task), "account").read_conversation("other")


def test_missing_turn_fields_is_not_empty_history():
    payload = {"task": {"id": "task_123", "title": "Task"}}
    with pytest.raises(SchemaChanged, match="turns missing"):
        CodexProvider(SessionStub(payload), "account").read_conversation("task_123")


def test_full_history_is_explicitly_unavailable():
    with pytest.raises(ProviderUnavailable, match="full task history"):
        CodexProvider(SessionStub({}), "account").read_full_history("task_123")


@pytest.mark.parametrize("limit", [0, 101, True, "10"])
def test_rejects_invalid_page_limit(limit):
    with pytest.raises(ValueError):
        CodexProvider(SessionStub({}), "account").list_conversations(limit=limit)
