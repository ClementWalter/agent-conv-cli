"""ChatGPT web chats normalize into the same Turn shape as every other source."""

from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import sys
from pathlib import Path

import pytest

loader = importlib.machinery.SourceFileLoader("agent_conv", str(Path(__file__).parent.parent / "bin" / "agent-conv"))
spec = importlib.util.spec_from_loader("agent_conv", loader)
ac = importlib.util.module_from_spec(spec)
sys.modules["agent_conv"] = ac
loader.exec_module(ac)


@pytest.fixture
def conversation(tmp_path: Path) -> Path:
    """A two-exchange conversation whose second answer was regenerated: the
    abandoned branch hangs off the same parent as the kept one."""
    path = tmp_path / "conv.json"
    path.write_text(json.dumps({
        "conversation_id": "conv-1",
        "title": "Vélo électrique",
        "create_time": 1786016706.0,
        "update_time": 1788764539.0,
        "current_node": "n4",
        "mapping": {
            "root": {"id": "root", "message": None, "parent": None, "children": ["n1"]},
            "n1": {"id": "n1", "parent": "root", "children": ["n2"], "message": {
                "author": {"role": "user"}, "create_time": 1786016706.0,
                "content": {"content_type": "text", "parts": ["Quelle différence ?"]}}},
            "n2": {"id": "n2", "parent": "n1", "children": ["n3", "n4"], "message": {
                "author": {"role": "assistant"}, "create_time": 1786016710.0,
                "content": {"content_type": "text", "parts": ["La différence est énorme."]}}},
            "n3": {"id": "n3", "parent": "n2", "children": [], "message": {
                "author": {"role": "assistant"}, "create_time": 1786016720.0,
                "content": {"content_type": "text", "parts": ["Réponse abandonnée."]}}},
            "n4": {"id": "n4", "parent": "n2", "children": [], "message": {
                "author": {"role": "assistant"}, "create_time": 1786016730.0,
                "content": {"content_type": "text", "parts": ["Réponse conservée."]}}},
        },
    }), encoding="utf-8")
    return path


def test_active_branch_drops_the_regenerated_answer(conversation: Path) -> None:
    texts = [b["text"] for t in ac._chatgpt_iter_turns(conversation) for b in t.blocks]
    assert "Réponse abandonnée." not in texts


def test_active_branch_keeps_the_current_answer(conversation: Path) -> None:
    texts = [b["text"] for t in ac._chatgpt_iter_turns(conversation) for b in t.blocks]
    assert "Réponse conservée." in texts


def test_roles_alternate_user_then_assistant(conversation: Path) -> None:
    assert [t.role for t in ac._chatgpt_iter_turns(conversation)] == ["user", "assistant", "assistant"]


def test_turn_timestamp_is_iso_utc(conversation: Path) -> None:
    assert ac._chatgpt_iter_turns(conversation)[0].ts == "2026-08-06T11:45:06+00:00"


def test_system_messages_are_hidden(tmp_path: Path) -> None:
    path = tmp_path / "sys.json"
    path.write_text(json.dumps({
        "current_node": "n1",
        "mapping": {"n1": {"id": "n1", "parent": None, "children": [], "message": {
            "author": {"role": "system"}, "create_time": 1.0,
            "content": {"content_type": "text", "parts": ["hidden context"]}}}},
    }))
    assert ac._chatgpt_iter_turns(path) == []


def test_inline_render_directives_are_stripped() -> None:
    raw = "Avant\ue200image_group\ue202{\"query\":[\"a\"]}\ue201Après"
    assert ac._chatgpt_clean(raw) == "AvantAprès"


def test_plain_prose_survives_cleaning() -> None:
    assert ac._chatgpt_clean("Texte **gras** normal") == "Texte **gras** normal"


@pytest.mark.parametrize(
    ("content", "expected_type"),
    [
        ({"content_type": "text", "parts": ["hi"]}, "text"),
        ({"content_type": "multimodal_text", "parts": [{"content_type": "audio_transcription", "text": "hi"}]}, "text"),
        ({"content_type": "code", "language": "python", "text": "search('x')"}, "tool_use"),
        ({"content_type": "execution_output", "text": "result"}, "tool_result"),
        ({"content_type": "thoughts", "thoughts": [{"summary": "Recherche", "content": ""}]}, "thinking"),
        ({"content_type": "reasoning_recap", "content": "A réfléchi"}, "thinking"),
    ],
)
def test_content_type_maps_to_block_type(content: dict, expected_type: str) -> None:
    assert ac._chatgpt_blocks(content)[0]["type"] == expected_type


def test_unknown_content_type_yields_no_block() -> None:
    assert ac._chatgpt_blocks({"content_type": "tether_quote", "text": "x"}) == []


def test_audio_transcription_text_is_extracted() -> None:
    content = {"content_type": "multimodal_text",
               "parts": [{"content_type": "audio_transcription", "text": " Les pneus larges"}]}
    assert ac._chatgpt_blocks(content)[0]["text"] == " Les pneus larges"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (1788764539.5, 1788764539.5),
        ("2026-09-07T07:02:16.821661Z", 1788764536.821661),
        (None, 0.0),
        ("", 0.0),
        ("not-a-date", 0.0),
    ],
)
def test_epoch_normalizes_both_time_encodings(value, expected) -> None:
    assert ac._chatgpt_epoch(value) == pytest.approx(expected)


def test_a_conversation_cycle_cannot_hang_the_walk(tmp_path: Path) -> None:
    """The parent chain is walked with a guard, so a malformed cycle terminates."""
    path = tmp_path / "cycle.json"
    path.write_text(json.dumps({
        "current_node": "a",
        "mapping": {
            "a": {"id": "a", "parent": "b", "children": [], "message": {
                "author": {"role": "user"}, "create_time": 1.0,
                "content": {"content_type": "text", "parts": ["x"]}}},
            "b": {"id": "b", "parent": "a", "children": [], "message": {
                "author": {"role": "user"}, "create_time": 2.0,
                "content": {"content_type": "text", "parts": ["y"]}}},
        },
    }))
    assert len(ac._chatgpt_iter_turns(path)) <= 3


class _StubResponse:
    """Stands in for a curl_cffi response — only status_code is consulted."""

    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


class _StubSession:
    """Replays a fixed sequence of status codes, recording each call."""

    def __init__(self, statuses: list[int]) -> None:
        self.statuses = list(statuses)
        self.calls = 0

    def get(self, url: str, timeout: int = 0) -> _StubResponse:
        self.calls += 1
        return _StubResponse(self.statuses.pop(0) if self.statuses else 429)


@pytest.fixture(autouse=True)
def no_real_sleeping(monkeypatch: pytest.MonkeyPatch) -> None:
    """Backoff pauses are real seconds; tests assert on control flow, not waiting."""
    monkeypatch.setattr(ac.time, "sleep", lambda _s: None)


def test_a_conversation_that_answers_immediately_is_returned() -> None:
    session = _StubSession([200])
    assert ac._chatgpt_get_conversation(session, "c1").status_code == 200


def test_rate_limiting_is_retried_until_it_clears() -> None:
    session = _StubSession([429, 429, 200])
    assert ac._chatgpt_get_conversation(session, "c1").status_code == 200


def test_a_cleared_rate_limit_costs_only_the_needed_attempts() -> None:
    session = _StubSession([429, 429, 200])
    ac._chatgpt_get_conversation(session, "c1")
    assert session.calls == 3


def test_a_never_clearing_quota_gives_up() -> None:
    assert ac._chatgpt_get_conversation(_StubSession([429] * 10), "c1") is None


def test_giving_up_is_bounded_by_the_backoff_schedule() -> None:
    session = _StubSession([429] * 10)
    ac._chatgpt_get_conversation(session, "c1")
    assert session.calls == len(ac._CHATGPT_BACKOFF) + 1


def test_a_deleted_conversation_is_not_retried() -> None:
    """404 is a permanent answer, so it must not burn the backoff schedule."""
    session = _StubSession([404, 200])
    ac._chatgpt_get_conversation(session, "c1")
    assert session.calls == 1
