"""Hosted ingestion reuses provider parsers without scanning server browser credentials."""

import json
import sys
import tempfile
from pathlib import Path

from .cloud import synchronize, cache_root
from .providers.base import ProviderAccount, ProviderError


def execute(job):
    if job.get("action") == "import-cache":
        documents = []
        for path in sorted(cache_root().glob("*/*.json"))[:2000]:
            if path.stat().st_size > 16 * 1024 * 1024:
                continue
            try:
                document = json.loads(path.read_text())
            except (OSError, ValueError):
                continue
            if isinstance(document, dict) and isinstance(document.get("turns"), list) and document.get("session"):
                documents.append(document)
        return {"documents": documents}
    if job.get("action") != "sync" or job.get("provider") not in ("openai", "claude"):
        raise ValueError("Unsupported job")
    from curl_cffi import requests
    session = requests.Session(impersonate="chrome")
    session.cookies.update({cookie["name"]: cookie["value"] for cookie in job["cookies"]})
    providers = []
    if job["provider"] == "openai":
        from .providers.chatgpt import ChatGPTProvider
        from .providers.codex import CodexProvider
        chatgpt = ChatGPTProvider(session)
        account = chatgpt.validate_connection()
        providers = [("chatgpt", chatgpt), ("codex-cloud", CodexProvider(session, account.id, account.label))]
    else:
        from .providers.anthropic import AnthropicProvider
        from .providers.cowork import CoworkProvider
        for organization in job["identity"]:
            if organization.get("uuid"):
                providers.extend([("claude-chat", AnthropicProvider(session, organization["uuid"])),
                                  ("cowork-cloud", CoworkProvider(session, organization["uuid"], authenticated_account=ProviderAccount(
                                      organization["uuid"], organization.get("name") or organization["uuid"], ("cowork:list", "cowork:read_events"))))])
    documents, errors, partial = [], [], False
    with tempfile.TemporaryDirectory() as directory:
        for product, provider in providers:
            try:
                report = synchronize(provider, product, root=Path(directory), limit=100)
                partial = partial or report.get("fetched", 0) >= 100 or bool(report.get("incomplete_conversations"))
            except ProviderError:
                errors.append(f"{product}: history could not be fully read; reconnect or retry.")
        for path in Path(directory).glob("*/*.json"):
            document = json.loads(path.read_text())
            if document.get("session"):
                documents.append(document)
    return {"documents": documents, "errors": errors, "partial": partial}


def main():
    # Stdout is a protocol channel; diagnostics must never include the incoming session.
    payload = sys.stdin.read(1024 * 1024 + 1)
    if len(payload) > 1024 * 1024:
        raise ValueError("Job exceeds size limit")
    sys.stdout.write(json.dumps(execute(json.loads(payload))))
