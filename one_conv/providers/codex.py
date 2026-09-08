"""Read Codex cloud current-task snapshots through an injected account session.

Routes and current-turn fields follow openai/codex at revision
74d3a5bf1046f004ee33a200ee497dc7593a5687, backend-client/src/client.rs
and backend-client/tests/fixtures/task_details_with_diff.json.
These snapshots do not constitute complete historical conversations.
"""

from urllib.parse import quote

from .base import (
    Conversation,
    ConversationPage,
    ConversationSummary,
    JsonTransport,
    Message,
    ProviderAccount,
    ProviderUnavailable,
    SchemaChanged,
)


FINGERPRINT = "codex-cloud-current-turn-v1:74d3a5bf"
CAPABILITIES = ("list_current_tasks", "read_current_turn")
EVIDENCE_URL = (
    "https://github.com/openai/codex/blob/"
    "74d3a5bf1046f004ee33a200ee497dc7593a5687/"
    "codex-rs/backend-client/src/client.rs"
)


def _required_text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise SchemaChanged(f"{FINGERPRINT}: missing {field}")
    return value


def _object(value, field):
    if not isinstance(value, dict):
        raise SchemaChanged(f"{FINGERPRINT}: invalid {field}")
    return value


def _items(value, field):
    if not isinstance(value, list):
        raise SchemaChanged(f"{FINGERPRINT}: invalid {field}")
    return value


def _summary(value):
    item = _object(value, "task")
    return ConversationSummary(
        id=_required_text(item.get("id"), "task id"),
        title=_required_text(item.get("title"), "task title"),
        updated_at=item.get("updated_at"),
    )


def _turn_messages(turn, role, field):
    """Preserve provider item IDs and derive stable IDs only when absent."""
    if turn is None:
        return []
    turn = _object(turn, field)
    key = "input_items" if role == "user" else "output_items"
    items = _items(turn.get(key, []), key)
    messages = []
    for index, value in enumerate(items):
        item = _object(value, "turn item")
        if item.get("type") != "message":
            continue
        if item.get("role", role) != role:
            continue
        blocks = _items(item.get("content"), "message content")
        texts = []
        for value in blocks:
            block = _object(value, "content block")
            if block.get("content_type") == "text":
                text = block.get("text")
                if not isinstance(text, str):
                    raise SchemaChanged(f"{FINGERPRINT}: invalid text")
                texts.append(text)
        identity = item.get("id") or f"{turn.get('id') or field}:{index}"
        messages.append(Message(
            id=_required_text(identity, "message id"),
            role=role,
            text="\n\n".join(texts),
            timestamp=turn.get("created_at"),
            content_blocks=tuple(blocks),
        ))
    # Worklogs expose assistant text when the output item list is not populated.
    if role == "assistant" and not messages and turn.get("worklog") is not None:
        worklog = _object(turn["worklog"], "worklog")
        for index, value in enumerate(_items(worklog.get("messages"), "worklog messages")):
            item = _object(value, "worklog message")
            author = _object(item.get("author"), "worklog author")
            if author.get("role") != "assistant":
                continue
            content = _object(item.get("content"), "worklog content")
            texts = []
            for part in _items(content.get("parts"), "worklog parts"):
                if isinstance(part, str):
                    texts.append(part)
                elif isinstance(part, dict) and part.get("content_type") == "text":
                    texts.append(_required_text(part.get("text"), "worklog text"))
            messages.append(Message(
                id=_required_text(item.get("id") or f"{turn.get('id') or field}:worklog:{index}",
                                  "worklog id"),
                role="assistant", text="\n\n".join(texts),
                timestamp=turn.get("created_at"), content_blocks=(content,),
            ))
    return messages


class CodexProvider:
    """The session broker attests account identity; task reads verify access."""

    capabilities = CAPABILITIES
    coverage = "current_tasks_current_turn_only"

    def __init__(self, session, account_id, account_label=None):
        self.account_id = _required_text(account_id, "broker account id")
        self.account_label = account_label or account_id
        self.transport = JsonTransport(session, "https://chatgpt.com/backend-api", FINGERPRINT)

    def validate_connection(self):
        self.list_conversations(limit=1)
        return ProviderAccount(self.account_id, self.account_label, CAPABILITIES)

    def list_conversations(self, cursor=None, limit=50):
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("Limit must be between 1 and 100")
        params = {"limit": limit, "task_filter": "current"}
        if cursor is not None:
            params["cursor"] = _required_text(cursor, "cursor")
        payload = _object(self.transport.get("/wham/tasks/list", params), "task page")
        cursor = payload.get("cursor")
        if cursor is not None:
            _required_text(cursor, "next cursor")
        return ConversationPage(
            tuple(_summary(item) for item in _items(payload.get("items"), "tasks")), cursor
        )

    def read_conversation(self, conversation_id):
        remote_id = _required_text(conversation_id, "task id")
        payload = _object(
            self.transport.get(f"/wham/tasks/{quote(remote_id, safe='')}"), "task details"
        )
        summary = _summary(payload.get("task"))
        if summary.id != remote_id:
            raise SchemaChanged(f"{FINGERPRINT}: task identity mismatch")
        if not any(key in payload for key in ("current_user_turn", "current_assistant_turn")):
            raise SchemaChanged(f"{FINGERPRINT}: current turns missing")
        messages = _turn_messages(payload.get("current_user_turn"), "user", "current_user_turn")
        messages.extend(_turn_messages(
            payload.get("current_assistant_turn"), "assistant", "current_assistant_turn"
        ))
        return Conversation(summary.id, summary.title, tuple(messages))

    def read_full_history(self, conversation_id):
        raise ProviderUnavailable("Codex cloud full task history is not evidenced by this adapter")
