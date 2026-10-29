#!/usr/bin/env python3
"""
Vim-For-Docs Native Messaging Host
Bridges Chrome/Firefox extension with local Neovim (--embed) instance.
"""

import sys
import os
import struct
import json
import base64
import subprocess
import threading
import shutil
import time

LOG_FILE = "/tmp/vimfordocs-host.log"

# Chrome native messaging frames are written from the Neovim reader thread and
# from the main loop (ready/pong). Interleaved writes corrupt the stream and
# hang the extension, so every frame goes out under one lock.
_write_lock = threading.Lock()

def log(msg):
    try:
        with open(LOG_FILE, "a") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except Exception:
        pass

def find_nvim():
    # 1. Explicit override
    custom = os.environ.get("NVIM_PATH")
    if custom and os.path.isfile(custom) and os.access(custom, os.X_OK):
        return custom

    # 2. Known standard paths
    candidates = [
        os.path.expanduser("~/neovim/build/bin/nvim"),
        "/opt/local/bin/nvim",
        "/opt/homebrew/bin/nvim",
        "/usr/local/bin/nvim",
        "/usr/bin/nvim",
    ]
    for p in candidates:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p

    # 3. Path lookup
    which = shutil.which("nvim")
    if which:
        return which

    return None

def get_ghostty_theme():
    """Reads Ghostty theme configuration from ~/.config/ghostty/config or ~/.termux/colors.properties."""
    theme = {
        "name": "wons",
        "background": "#000000",
        "foreground": "#f5f5f5",
        "border": "#2f2f2f",
        "palette": {}
    }
    candidates = [
        os.path.expanduser("~/.config/ghostty/config"),
        os.path.expanduser("~/Library/Application Support/com.mitchellh.ghostty/config"),
        os.path.expanduser("~/.termux/colors.properties")
    ]
    for path in candidates:
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("# Theme:"):
                            theme["name"] = line.split(":", 1)[1].strip()
                        elif line.startswith("background"):
                            parts = line.split("=", 1)
                            if len(parts) == 2:
                                theme["background"] = parts[1].strip()
                        elif line.startswith("foreground"):
                            parts = line.split("=", 1)
                            if len(parts) == 2:
                                theme["foreground"] = parts[1].strip()
                        elif line.startswith("palette"):
                            parts = line.split("=", 1)
                            if len(parts) == 2:
                                kv = parts[1].strip().split("=", 1)
                                if len(kv) == 2:
                                    theme["palette"][kv[0].strip()] = kv[1].strip()
                if "8" in theme["palette"]:
                    theme["border"] = theme["palette"]["8"]
                elif "0" in theme["palette"]:
                    theme["border"] = theme["palette"]["0"]
                break
            except Exception as e:
                log(f"Error reading ghostty theme from {path}: {e}")
    return theme

def send_chrome_message(payload):
    """Sends a 4-byte length-prefixed JSON message to Chrome stdout."""
    raw = json.dumps(payload).encode("utf-8")
    # Chrome rejects host -> extension messages larger than 1 MB. Neovim
    # redraw batches stay far below that, but a message that is too big must
    # be dropped instead of killing the bridge.
    if len(raw) > 1024 * 1024:
        log(f"Dropping oversized message to Chrome ({len(raw)} bytes)")
        return
    header = struct.pack("<I", len(raw))
    with _write_lock:
        sys.stdout.buffer.write(header + raw)
        sys.stdout.buffer.flush()

def read_chrome_message():
    """Reads a 4-byte length-prefixed JSON message from Chrome stdin."""
    header = sys.stdin.buffer.read(4)
    if not header or len(header) < 4:
        return None
    length = struct.unpack("<I", header)[0]
    data = sys.stdin.buffer.read(length)
    if len(data) < length:
        return None
    try:
        message = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        # One malformed frame must not terminate the whole session.
        log(f"Ignoring malformed frame from extension: {e}")
        return {}
    return message if isinstance(message, dict) else {}

def stdout_reader_loop(proc):
    """Continuously reads binary msgpack chunks from Neovim stdout and sends to Chrome."""
    try:
        fd = proc.stdout.fileno()
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            b64 = base64.b64encode(chunk).decode("ascii")
            send_chrome_message({"type": "msgpack", "data": b64})
    except Exception as e:
        log(f"Stdout reader error: {e}")
    finally:
        try:
            send_chrome_message({"type": "status", "event": "nvim_exited", "code": proc.poll()})
        except Exception:
            pass

def stderr_reader_loop(proc):
    """Logs any stderr messages from Neovim."""
    try:
        while True:
            line = proc.stderr.readline()
            if not line:
                break
            log(f"[nvim stderr] {line.decode('utf-8', errors='replace').strip()}")
    except Exception:
        pass

def main():
    log("Vim-For-Docs Native Host started")
    nvim_bin = find_nvim()
    if not nvim_bin:
        log("Error: nvim binary not found")
        send_chrome_message({"type": "error", "message": "Neovim executable not found on host"})
        sys.exit(1)

    log(f"Using Neovim binary: {nvim_bin}")

    # Prepare environment with complete user PATH
    env = os.environ.copy()
    user_home = os.path.expanduser("~")
    extra_paths = [
        f"{user_home}/.local/bin",
        f"{user_home}/.cargo/bin",
        f"{user_home}/neovim/build/bin",
        "/opt/local/bin",
        "/opt/local/sbin",
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin"
    ]
    env["PATH"] = ":".join(extra_paths) + ":" + env.get("PATH", "")
    if "TERM" not in env or not env["TERM"]:
        env["TERM"] = "xterm-256color"

    # Launch Neovim in embedded RPC mode
    try:
        proc = subprocess.Popen(
            [
                nvim_bin,
                "--embed",
                "--cmd", "set noautoread",
                "--cmd", "set belloff=all",
                "--cmd", "set noswapfile",
                "-c", "setlocal filetype=markdown",
                "-c", "silent! doautocmd FileType markdown"
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            bufsize=0
        )
    except Exception as e:
        log(f"Failed to spawn Neovim: {e}")
        send_chrome_message({"type": "error", "message": f"Failed to spawn Neovim: {e}"})
        sys.exit(1)

    # Spawn reader threads
    t_out = threading.Thread(target=stdout_reader_loop, args=(proc,), daemon=True)
    t_err = threading.Thread(target=stderr_reader_loop, args=(proc,), daemon=True)
    t_out.start()
    t_err.start()

    send_chrome_message({
        "type": "ready",
        "nvim": nvim_bin,
        "pid": proc.pid,
        "theme": get_ghostty_theme()
    })

    # Main loop: read from Chrome stdin and write to Neovim stdin
    try:
        while True:
            msg = read_chrome_message()
            if msg is None:
                log("Chrome stdin closed; terminating Neovim")
                break

            mtype = msg.get("type")
            if mtype == "msgpack":
                try:
                    raw_bytes = base64.b64decode(msg.get("data", ""), validate=True)
                except Exception as e:
                    log(f"Ignoring malformed msgpack payload: {e}")
                    continue
                try:
                    proc.stdin.write(raw_bytes)
                    proc.stdin.flush()
                except (BrokenPipeError, ValueError) as e:
                    log(f"Neovim stdin closed: {e}")
                    send_chrome_message({
                        "type": "status",
                        "event": "host_disconnected",
                        "error": "Neovim process is no longer accepting input",
                    })
                    break
            elif mtype == "ping":
                send_chrome_message({"type": "pong", "nvim": nvim_bin, "pid": proc.pid})
            elif mtype == "exit":
                log("Received exit command from extension")
                break
    except (KeyboardInterrupt, BrokenPipeError) as e:
        log(f"Host main loop exception: {e}")
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=1.0)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        log("Vim-For-Docs Native Host terminated")

if __name__ == "__main__":
    main()
