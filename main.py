"""Open the local board, or capture it in an isolated, invisible browser."""

import argparse
import base64
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import urlopen
import webbrowser


PAGE = Path(__file__).resolve().with_name("index.html")


def find_browser():
    for name in ("msedge", "google-chrome", "chromium", "chromium-browser", "chrome"):
        if path := shutil.which(name):
            return path
    candidates = [
        Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
        Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
    ]
    for root in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA"):
        if directory := os.environ.get(root):
            candidates.extend(Path(directory) / path for path in (
                "Microsoft/Edge/Application/msedge.exe", "Google/Chrome/Application/chrome.exe"
            ))
    for path in candidates:
        if path.is_file():
            return str(path)
    raise RuntimeError("Для снимка нужен установленный Edge, Chrome или Chromium.")


class BrowserTab:
    """A small standard-library WebSocket client for a private Chromium tab."""

    def __init__(self, url):
        address = urlsplit(url)
        self.socket = socket.create_connection(("127.0.0.1", address.port), timeout=20)
        self.stream = self.socket.makefile("rb")
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {address.path} HTTP/1.1\r\nHost: {address.netloc}\r\n"
            f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.socket.sendall(request.encode("ascii"))
        if b" 101 " not in self.stream.readline():
            raise RuntimeError("Не удалось подключиться к вкладке браузера.")
        while self.stream.readline() not in (b"\r\n", b""):
            pass
        self.sequence = 0

    def send_frame(self, data, opcode=1):
        size = len(data)
        if size < 126:
            header = bytes((128 | size,))
        elif size < 65536:
            header = bytes((254,)) + struct.pack("!H", size)
        else:
            header = bytes((255,)) + struct.pack("!Q", size)
        mask = os.urandom(4)
        masked = bytes(byte ^ mask[i % 4] for i, byte in enumerate(data))
        self.socket.sendall(bytes((128 | opcode,)) + header + mask + masked)

    def receive(self):
        chunks = []
        while True:
            frame = self.stream.read(2)
            if len(frame) != 2:
                raise EOFError("Браузер закрыл вкладку.")
            flags, length = frame
            if length == 126:
                length = struct.unpack("!H", self.stream.read(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self.stream.read(8))[0]
            payload = self.stream.read(length)
            opcode = flags & 15
            if opcode == 8:
                raise EOFError("Браузер завершил соединение.")
            if opcode == 9:
                self.send_frame(payload, opcode=10)
            elif opcode in (0, 1):
                chunks.append(payload)
                if flags & 128:
                    return json.loads(b"".join(chunks))

    def call(self, method, params=None):
        self.sequence += 1
        data = {"id": self.sequence, "method": method, "params": params or {}}
        self.send_frame(json.dumps(data).encode("utf-8"))
        while True:
            message = self.receive()
            if message.get("id") == self.sequence:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result", {})

    def close(self):
        self.stream.close()
        self.socket.close()


def capture(output):
    # Windows' restricted automation host cannot nest Chromium's child processes.
    compatibility = ["--no-sandbox"] if os.name == "nt" and os.getenv("CODEX_SANDBOX_NETWORK_DISABLED") == "1" else []
    with tempfile.TemporaryDirectory(prefix="listok-capture-", dir=PAGE.parent) as profile:
        process = subprocess.Popen([
            find_browser(), "--headless", "--disable-gpu", "--no-first-run", *compatibility,
            "--disable-extensions", "--disable-background-networking",
            "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows", "--remote-debugging-port=0",
            f"--user-data-dir={profile}", "--window-size=1440,900", PAGE.as_uri()
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        tab = None
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                try:
                    port = (Path(profile) / "DevToolsActivePort").read_text().splitlines()[0]
                    with urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as response:
                        target = next(t for t in json.load(response) if t["type"] == "page" and t["url"] == PAGE.as_uri())
                    break
                except (OSError, IndexError, StopIteration):
                    if process.poll() is not None:
                        raise RuntimeError("Не удалось запустить браузер для снимка.")
                    time.sleep(.1)
            else:
                raise TimeoutError("Браузер не успел открыть доску.")
            tab = BrowserTab(target["webSocketDebuggerUrl"])
            tab.call("Emulation.setDeviceMetricsOverride", {
                "width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False
            })
            tab.call("Page.reload")
            while time.monotonic() < deadline:
                result = tab.call("Runtime.evaluate", {"expression": "document.readyState === 'complete' && !!document.querySelector('.note')"})
                if result["result"].get("value"):
                    break
                time.sleep(.05)
            else:
                raise TimeoutError("Холст не появился.")
            result = tab.call("Runtime.evaluate", {
                "expression": "new Promise(done => { let n = 0; function draw() { if (++n >= 120) done(n); else requestAnimationFrame(draw); } requestAnimationFrame(draw); })",
                "awaitPromise": True, "returnByValue": True
            })
            if result["result"].get("value") != 120:
                raise RuntimeError("Браузер не закончил отрисовку.")
            picture = tab.call("Page.captureScreenshot", {"format": "png", "fromSurface": True})
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(base64.b64decode(picture["data"]))
        finally:
            if tab:
                try:
                    tab.call("Browser.close")
                except (OSError, EOFError):
                    pass
                tab.close()
            try:
                process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Листок — локальная доска идей")
    parser.add_argument("--screenshot", type=Path, metavar="FILE.PNG")
    options = parser.parse_args()
    if options.screenshot:
        capture(options.screenshot)
    else:
        webbrowser.open(PAGE.as_uri())
