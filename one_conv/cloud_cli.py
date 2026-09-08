"""Expose experimental cloud adapters without embedding credentials in arguments."""

import json
import os
from pathlib import Path
import stat

import click

from .cloud import synchronize
from .providers.base import ProviderError


PRODUCTS = ("chatgpt", "claude-chat", "codex-cloud", "cowork-cloud")


def session_provider(product, path, organization):
    """Accept a private broker-provisioned session; never inspect browser stores."""
    if product == "cowork-cloud":
        raise click.ClickException("Cowork cloud routes are not verified; no request was made.")
    if path is None:
        raise click.ClickException("No managed session is configured. The cloud login flow is not implemented yet.")
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor) as stream:
            metadata = os.fstat(stream.fileno())
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
                raise click.ClickException("Managed session must be a private regular file (mode 600).")
            if metadata.st_size > 65536:
                raise click.ClickException("Managed session exceeds its size limit.")
            config = json.load(stream)
    except (OSError, ValueError):
        raise click.ClickException("Managed session cannot be read; reconnect the account.") from None
    if not isinstance(config, dict) or config.get("provider") != ("anthropic" if product == "claude-chat" else "openai"):
        raise click.ClickException("Managed session provider does not match the requested product.")
    cookies = config.get("cookies", {})
    headers = config.get("headers", {})
    if not isinstance(cookies, dict) or not isinstance(headers, dict):
        raise click.ClickException("Invalid managed session format.")
    if not all(isinstance(k, str) and isinstance(v, str) and "\n" not in v and "\r" not in v
               for k, v in list(cookies.items()) + list(headers.items())):
        raise click.ClickException("Invalid managed session values.")
    if set(headers) - {"Authorization", "ChatGPT-Account-ID"}:
        raise click.ClickException("Managed session contains unsupported headers.")
    if any(not k or any(char in k for char in "\r\n;=") for k in cookies):
        raise click.ClickException("Managed session contains invalid cookie names.")
    from curl_cffi import requests
    session = requests.Session(impersonate="chrome")
    session.cookies.update(cookies)
    session.headers.update(headers)
    if product == "chatgpt":
        from .providers.chatgpt import ChatGPTProvider
        return ChatGPTProvider(session)
    if product == "claude-chat":
        if not organization:
            raise click.ClickException("Select a Claude organization with --organization.")
        from .providers.anthropic import AnthropicProvider
        return AnthropicProvider(session, organization)
    from .providers.codex import CodexProvider
    from .providers.chatgpt import ChatGPTProvider
    account = ChatGPTProvider(session).validate_connection()
    return CodexProvider(session, account.id, account.label)


@click.group("cloud")
def cloud_group():
    """Inspect and synchronize experimental cloud sources using managed sessions."""


@cloud_group.command("providers")
def providers():
    """Show implemented coverage, distinct from live account verification."""
    click.echo(json.dumps([
        {"product": "chatgpt", "adapter": "experimental", "coverage": "chat conversations", "live_verified_this_change": False},
        {"product": "claude-chat", "adapter": "experimental", "coverage": "organization chat conversations", "live_verified_this_change": False},
        {"product": "codex-cloud", "adapter": "experimental", "coverage": "current cloud task turns only", "live_verified_this_change": False},
        {"product": "cowork-cloud", "adapter": "unsupported", "coverage": "unverified routes", "live_verified_this_change": False},
    ]))


@cloud_group.command("sync")
@click.argument("product", type=click.Choice(PRODUCTS))
@click.option("--session-file", type=click.Path(path_type=Path), envvar="ONE_CONV_SESSION_FILE", help="Private session provisioned by an authentication broker; never a browser database.")
@click.option("--organization", help="Explicit Claude organization ID.")
@click.option("--limit", type=click.IntRange(1, 10000), default=100, show_default=True)
def sync(product, session_file, organization, limit):
    """Cache normalized cloud history. Example: one-conv cloud sync chatgpt --limit 10.

    Requires a broker-provisioned session; this command does not implement user login.
    """
    try:
        provider = session_provider(product, session_file, organization)
        report = synchronize(provider, product, limit=limit)
    except ProviderError as error:
        raise click.ClickException(str(error)) from None
    click.echo(json.dumps(report))
