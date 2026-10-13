"""Run against a fresh local build; synthetic state only, no service/proxy changes."""
from pathlib import Path
import os
import socket
import subprocess
import tempfile
import time

with tempfile.TemporaryDirectory(prefix='bordr-socket-check-') as temporary:
    root = Path(temporary)
    root.chmod(0o700)
    endpoint = root / 'bordr.sock'
    endpoints = root / 'endpoints.json'
    endpoints.write_text('{"ssh":[]}')
    # Reserve an unused TCP port without listening. Opening TCP instead of the
    # configured Unix socket would fail the server startup, not pass silently.
    with socket.socket() as reserved:
        reserved.bind(('127.0.0.1', 0))
        port = reserved.getsockname()[1]
        env = {**os.environ, 'SOCKET_PATH': str(endpoint), 'HOST': '127.0.0.1',
               'PORT': str(port), 'HERDR_SOCKET': str(root / 'absent-herdr.sock'),
               'HERDR_ENDPOINTS': str(endpoints), 'BORDR_DATA_DIR': str(root / 'state'),
               'BORDR_FILE_ROOTS': f'fixture:{root}'}
        with (root / 'server.log').open('w+') as log:
            server = subprocess.Popen(['bun', '--no-env-file', 'build/index.js'], env=env,
                                      stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 20
                while not endpoint.exists():
                    if server.poll() is not None or time.monotonic() >= deadline:
                        log.seek(0)
                        raise RuntimeError('Socket startup failed: ' + log.read()[-2000:])
                    time.sleep(0.05)
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(15)
                    client.connect(str(endpoint))
                    client.sendall(b'GET /settings HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
                    response = client.recv(4096)
                    assert response.startswith(b'HTTP/1.1 200'), response.split(b'\r\n')[0]
                with socket.socket() as tcp:
                    tcp.settimeout(1)
                    assert tcp.connect_ex(('127.0.0.1', port)) != 0, 'TCP listener exposed'
                assert root.stat().st_mode & 0o077 == 0, 'Socket parent is shared'
                print('PASS: built app serves HTTP over its private Unix socket, with no TCP listener')
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)
