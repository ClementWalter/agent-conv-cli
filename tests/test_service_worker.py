"""Worker cache ingestion accepts normalized conversations and rejects unknown jobs."""
import json
import pytest
from one_conv.service_worker import execute

def test_import_reads_normalized_history(tmp_path, monkeypatch):
    monkeypatch.setenv('ONE_CONV_CLOUD_CACHE', str(tmp_path))
    account = tmp_path / 'account'
    account.mkdir()
    (account / 'chat.json').write_text(json.dumps({'session': 'id', 'source': 'claude-chat', 'turns': []}))
    assert execute({'action': 'import-cache'})['documents'][0]['session'] == 'id'

def test_import_ignores_metadata(tmp_path, monkeypatch):
    monkeypatch.setenv('ONE_CONV_CLOUD_CACHE', str(tmp_path))
    account = tmp_path / 'account'
    account.mkdir()
    (account / 'report.json').write_text('{"status":"ready"}')
    assert execute({'action': 'import-cache'})['documents'] == []

def test_unknown_worker_action_fails():
    with pytest.raises(ValueError, match='Unsupported job'):
        execute({'action': 'send'})
