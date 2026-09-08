"""ChatGPT web routes and graph parsing isolated from session acquisition and storage."""

from urllib.parse import quote
from uuid import uuid4

from .base import (AuthenticationRequired, Conversation, ConversationPage, ConversationSummary,
                   JsonTransport, Message, ProviderAccount, SchemaChanged)


FINGERPRINT = "chatgpt-web-2026-09-08-v2"
ORIGIN = "https://chatgpt.com"
LIST_PATH = "/backend-api/conversations"
SEARCH_PATH = "/backend-api/conversations/search"
GLOBAL_SEARCH_PATH = "/backend-api/global/search"


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


def _message_page(doc):
    """Validate the current-branch window before advancing its backwards cursor."""
    if not isinstance(doc, dict) or not isinstance(doc.get("messages"), list):
        raise SchemaChanged(f"{FINGERPRINT}: missing message page")
    page = doc.get("page_info")
    if not isinstance(page, dict) or any(type(page.get(key)) is not bool
                                        for key in ("has_previous_page", "has_next_page")):
        raise SchemaChanged(f"{FINGERPRINT}: invalid message pagination")
    messages = doc["messages"]
    ids = [row.get("id") if isinstance(row, dict) else None for row in messages]
    if any(not isinstance(identity, str) or not identity for identity in ids) or len(set(ids)) != len(ids):
        raise SchemaChanged(f"{FINGERPRINT}: invalid message identities")
    if messages and (page.get("start_cursor") != ids[0] or page.get("end_cursor") != ids[-1]):
        raise SchemaChanged(f"{FINGERPRINT}: message cursor differs from page bounds")
    if page["has_previous_page"] and not messages:
        raise SchemaChanged(f"{FINGERPRINT}: empty page cannot have earlier messages")
    return messages, page


def _normalize_current_message(message):
    """Preserve source order and content without inventing graph parent relationships."""
    author, content = message.get("author"), message.get("content")
    if not isinstance(author, dict) or not isinstance(author.get("role"), str) or not isinstance(content, dict):
        raise SchemaChanged(f"{FINGERPRINT}: invalid current-branch message")
    parts = content.get("parts", [])
    if not isinstance(parts, list):
        raise SchemaChanged(f"{FINGERPRINT}: invalid message parts")
    text = "\n".join(part for part in parts if isinstance(part, str))
    if not text and isinstance(content.get("text"), str):
        text = content["text"]
    return Message(message["id"], author["role"], text, timestamp=message.get("create_time"),
                   content_blocks=(content,))


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

    def global_search(self, query, limit=20):
        """Read one observed global-search page without inventing cursor request semantics."""
        if not isinstance(query, str) or not query.strip():
            raise ValueError("Search query is required")
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError("Search limit must be between 1 and 100")
        body = {"query": query, "limit": limit, "query_id": str(uuid4()), "entrypoint": "global_search",
                "source_requests": [{"type": "conversation"}, {"type": "project"},
                                    {"type": "library", "filters": {
                                        "lanes": ["image", "document", "folder"], "providers": ["native"]}}]}
        doc = self.transport.post_search(GLOBAL_SEARCH_PATH, body)
        if (not isinstance(doc, dict) or not isinstance(doc.get("items"), list)
                or type(doc.get("partial_results")) is not bool or not isinstance(doc.get("source_statuses"), list)):
            raise SchemaChanged(f"{FINGERPRINT}: invalid global search response")
        cursor = doc.get("cursor")
        if cursor is not None and not isinstance(cursor, str):
            raise SchemaChanged(f"{FINGERPRINT}: invalid global search cursor")
        hits = []
        for item in doc["items"]:
            if not isinstance(item, dict) or not isinstance(item.get("source_type"), str):
                raise SchemaChanged(f"{FINGERPRINT}: invalid global search item")
            if item["source_type"] != "conversation":
                continue
            payload = item.get("payload")
            if not isinstance(payload, dict) or not isinstance(payload.get("conversation_id"), str) or not payload["conversation_id"]:
                raise SchemaChanged(f"{FINGERPRINT}: missing global search conversation identity")
            if not isinstance(item.get("snippet"), str):
                raise SchemaChanged(f"{FINGERPRINT}: invalid global search snippet")
            hits.append({**item, "conversation_id": payload["conversation_id"],
                         "payload": {**payload, "snippet": item["snippet"]}})
        return {"items": hits, "cursor": cursor, "partial_results": doc["partial_results"],
                "source_statuses": doc["source_statuses"], "coverage": "first_page",
                "complete": not bool(cursor) and not doc["partial_results"]}

    def read_document(self, conversation_id):
        """Expose validated provider-native content for compatibility cache consumers."""
        return validate_chatgpt_document(self.transport.get(conversation_path(conversation_id)))

    def read_conversation(self, conversation_id, max_pages=100):
        if not isinstance(conversation_id, str) or not conversation_id:
            raise ValueError("Conversation ID is required")
        if not isinstance(max_pages, int) or not 1 <= max_pages <= 1000:
            raise ValueError("Page bound must be between 1 and 1000")
        path = LIST_PATH + "/" + quote(conversation_id, safe="")
        doc = self.transport.get(path, params={"include_has_versions": "true", "num_turns": 10})
        if not isinstance(doc, dict) or doc.get("conversation_id") != conversation_id:
            raise SchemaChanged(f"{FINGERPRINT}: conversation identity mismatch")
        messages, page = _message_page(doc)
        if page["has_next_page"]:
            raise SchemaChanged(f"{FINGERPRINT}: initial message window does not reach present")
        seen = {row["id"] for row in messages}
        cursors = set()
        pages = 1
        while page["has_previous_page"] and pages < max_pages:
            cursor = page["start_cursor"]
            if cursor in cursors:
                raise SchemaChanged(f"{FINGERPRINT}: message pagination did not advance")
            cursors.add(cursor)
            earlier = self.transport.get(path + "/messages", params={
                "before": cursor, "include_has_versions": "true", "num_turns": 10})
            rows, page = _message_page(earlier)
            if any(row["id"] in seen for row in rows):
                raise SchemaChanged(f"{FINGERPRINT}: overlapping message pages")
            seen.update(row["id"] for row in rows)
            messages = rows + messages
            pages += 1
        title = doc.get("title") or "Untitled"
        if not isinstance(title, str):
            raise SchemaChanged(f"{FINGERPRINT}: invalid conversation title")
        # The web route exposes the selected branch, not every regenerated alternative.
        return Conversation(conversation_id, title, tuple(_normalize_current_message(row) for row in messages),
                            coverage="current_branch", complete=not page["has_previous_page"])

    def read_legacy_conversation(self, conversation_id):
        """Normalize a full mapping from the compatibility endpoint."""
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
