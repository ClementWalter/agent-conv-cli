"""ChatGPT web routes and graph parsing isolated from session acquisition and storage."""

from urllib.parse import quote

from .base import (AuthenticationRequired, Conversation, ConversationPage, ConversationSummary,
                   JsonTransport, Message, ProviderAccount, SchemaChanged)


FINGERPRINT = "chatgpt-web-2026-09-08-v1"
ORIGIN = "https://chatgpt.com"
LIST_PATH = "/backend-api/conversations"
SEARCH_PATH = "/backend-api/conversations/search"


def conversation_path(conversation_id):
    """Keep remote identifiers within the evidenced conversation route."""
    if not isinstance(conversation_id, str) or not conversation_id:
        raise ValueError("Conversation ID is required")
    return "/backend-api/conversation/" + quote(conversation_id, safe="")


def validate_chatgpt_document(doc):
    """Reject schema drift before a successful HTTP response enters a cache."""
    if not isinstance(doc, dict) or not isinstance(doc.get("mapping"), dict):
        raise SchemaChanged(f"{FINGERPRINT}: missing conversation graph")
    return doc


class ChatGPTProvider:
    """Read the evidenced ChatGPT web API using a caller-authorized session."""

    def __init__(self, session, transport=None):
        self.session = session
        self.transport = transport or JsonTransport(session, ORIGIN, FINGERPRINT)

    def validate_connection(self):
        doc = self.transport.get("/api/auth/session")
        if not isinstance(doc, dict):
            raise SchemaChanged(f"{FINGERPRINT}: invalid authentication response")
        token = doc.get("accessToken")
        if token is None or token == "":
            raise AuthenticationRequired(f"{FINGERPRINT}: sign-in session expired")
        if not isinstance(token, str):
            raise SchemaChanged(f"{FINGERPRINT}: invalid authentication token")
        account = doc.get("account") if isinstance(doc, dict) else None
        if not isinstance(account, dict) or not isinstance(account.get("id"), str) or not account["id"]:
            raise SchemaChanged(f"{FINGERPRINT}: missing account identity")
        user = doc.get("user") or {}
        if not isinstance(user, dict):
            raise SchemaChanged(f"{FINGERPRINT}: invalid user")
        # Web cookies authorize a short-lived API token; storage remains the caller's responsibility.
        self.session.headers.update({"Authorization": f"Bearer {token}",
                                     "ChatGPT-Account-ID": account["id"]})
        return ProviderAccount(account["id"], user.get("email") or account["id"], ("list", "read", "search"))

    def list_conversations(self, cursor=None, limit=50):
        if not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("Limit must be between 1 and 100")
        try:
            archived, offset = (cursor or "0:0").split(":")
            if archived not in ("0", "1") or int(offset) < 0:
                raise ValueError
            offset = int(offset)
        except (ValueError, AttributeError):
            raise ValueError("Invalid ChatGPT cursor") from None
        doc = self.transport.get(LIST_PATH, params={
            "offset": offset, "limit": limit, "order": "updated",
            "is_archived": "true" if archived == "1" else "false"})
        if not isinstance(doc, dict) or not isinstance(doc.get("items"), list):
            raise SchemaChanged(f"{FINGERPRINT}: missing conversation items")
        items = []
        for item in doc["items"]:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
                raise SchemaChanged(f"{FINGERPRINT}: missing conversation identity")
            title = item.get("title") or "Untitled"
            if not isinstance(title, str):
                raise SchemaChanged(f"{FINGERPRINT}: invalid conversation title")
            items.append(ConversationSummary(item["id"], title, item.get("update_time"),
                                             "https://chatgpt.com/c/" + quote(item["id"], safe="")))
        # Archived conversations are a second listing, not absent history.
        next_cursor = f"{archived}:{offset + len(items)}" if len(items) == limit else (
            "1:0" if archived == "0" else None)
        return ConversationPage(tuple(items), next_cursor)

    def search_conversations(self, query, limit=50):
        """Return provider search hits with bounded pagination and preserved snippets."""
        if not isinstance(query, str) or not query.strip():
            raise ValueError("Search query is required")
        if not isinstance(limit, int) or not 1 <= limit <= 10000:
            raise ValueError("Search limit must be between 1 and 10000")
        hits = []
        cursor = None
        cursors = set()
        while len(hits) < limit:
            params = {"query": query}
            if cursor is not None:
                params["cursor"] = cursor
            doc = self.transport.get(SEARCH_PATH, params=params)
            if not isinstance(doc, dict) or not isinstance(doc.get("items"), list):
                raise SchemaChanged(f"{FINGERPRINT}: missing search items")
            for item in doc["items"]:
                if not isinstance(item, dict) or not isinstance(item.get("conversation_id"), str):
                    raise SchemaChanged(f"{FINGERPRINT}: missing search identity")
            hits.extend(doc["items"])
            cursor = doc.get("cursor")
            if cursor is None or not doc["items"]:
                break
            if not isinstance(cursor, str) or not cursor or cursor in cursors:
                raise SchemaChanged(f"{FINGERPRINT}: invalid search cursor")
            cursors.add(cursor)
        return hits[:limit]

    def read_document(self, conversation_id):
        """Expose validated provider-native content for compatibility cache consumers."""
        return validate_chatgpt_document(self.transport.get(conversation_path(conversation_id)))

    def read_conversation(self, conversation_id):
        doc = self.read_document(conversation_id)
        mapping = doc["mapping"]
        active = doc.get("current_node")
        if active is not None and (not isinstance(active, str) or active not in mapping):
            raise SchemaChanged(f"{FINGERPRINT}: invalid active branch")
        messages = []
        for node_id, node in mapping.items():
            if not isinstance(node, dict):
                raise SchemaChanged(f"{FINGERPRINT}: invalid graph node")
            parent = node.get("parent")
            if parent is not None and (not isinstance(parent, str) or parent not in mapping):
                raise SchemaChanged(f"{FINGERPRINT}: invalid parent identity")
            message = node.get("message")
            if message is None:
                # Empty graph nodes can bridge real messages on the active branch.
                messages.append(Message(node_id, "structure", "", parent))
                continue
            if not isinstance(message, dict) or not isinstance(message.get("author"), dict):
                raise SchemaChanged(f"{FINGERPRINT}: invalid message author")
            role = message["author"].get("role")
            content = message.get("content")
            if not isinstance(role, str) or not isinstance(content, dict):
                raise SchemaChanged(f"{FINGERPRINT}: invalid message content")
            parts = content.get("parts", [])
            if not isinstance(parts, list):
                raise SchemaChanged(f"{FINGERPRINT}: invalid message parts")
            text = "\n".join(part for part in parts if isinstance(part, str))
            if not text and isinstance(content.get("text"), str):
                text = content["text"]
            # Retain provider blocks so attachments and tool output survive normalization.
            messages.append(Message(node_id, role, text, parent, message.get("create_time"), (content,)))
        title = doc.get("title") or "Untitled"
        if not isinstance(title, str):
            raise SchemaChanged(f"{FINGERPRINT}: invalid conversation title")
        return Conversation(conversation_id, title, tuple(messages), active)
