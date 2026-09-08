"""An installed Brain engine owns shared appends without exposing text in argv."""

from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

loader = importlib.machinery.SourceFileLoader("agent_conv_append_test", str(Path(__file__).parent.parent / "bin/one-conv"))
spec = importlib.util.spec_from_loader(loader.name, loader)
ac = importlib.util.module_from_spec(spec)
sys.modules[loader.name] = ac
loader.exec_module(ac)


@pytest.fixture
def installed(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN_SUPPORT", str(tmp_path))
    (tmp_path / "runtime.json").write_text(json.dumps({"mode": "active", "runtime": "brain-runtime"}))
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args, 0, '{"path":"corpus/mac/brain/brain/brain.json"}', "")

    monkeypatch.setattr(ac.subprocess, "run", run)
    ac._append_log_turn("whatsapp", "user", "a private note")
    return calls[0]


def test_append_uses_packaged_engine(installed):
    assert installed[0] == ["brain-runtime", "append-stdin"]


def test_append_passes_text_over_stdin(installed):
    assert json.loads(installed[1]["input"])["text"] == "a private note"
