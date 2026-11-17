"""Plugin-owned watchdog (stdlib only); never imported by the existing backend.

Interface: python -u <this-file>, cwd=repository root, ST_HOST/ST_PORT inherited.
Node holds stdin open. On stdin EOF (including unexpected host death), stop the
owned `sys.executable -m backend.serve` process tree. stdout/stderr are inherited
for the manager's bounded diagnostic tail. No secret values are printed here.
"""
import os
import signal
import subprocess
import sys
import threading


def main():
    stop = threading.Event()
    child = subprocess.Popen(
        [sys.executable, "-u", "-m", "backend.serve"],
        stdin=subprocess.DEVNULL,
        start_new_session=os.name != "nt",
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )

    def on_eof():
        try:
            while sys.stdin.buffer.read(1):
                pass
        finally:
            stop.set()

    threading.Thread(target=on_eof, daemon=True).start()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stop.set())
    try:
        while child.poll() is None and not stop.wait(0.1):
            pass
    finally:
        if child.poll() is None:
            if os.name == "nt":
                try:
                    result = subprocess.run(
                        ["taskkill", "/PID", str(child.pid), "/T", "/F"],
                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL, timeout=5, check=False,
                    )
                    if result.returncode != 0 and child.poll() is None:
                        child.kill()
                except (OSError, subprocess.TimeoutExpired):
                    child.kill()
            else:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            child.wait()
    return child.returncode if child.returncode is not None else 1


if __name__ == "__main__":
    sys.exit(main())
