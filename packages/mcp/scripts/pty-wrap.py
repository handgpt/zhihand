#!/usr/bin/env python3
"""Thin PTY wrapper — runs argv[1:] inside a pseudo-terminal so that tools
requiring isatty(stdin)==True (e.g. ``gemini -i``) work from a daemon.

Output is forwarded to this process's stdout in real time.
Exit code matches the child's exit code.

Signals (SIGTERM, SIGINT) are forwarded to the child process group so that
killing this wrapper also kills the tool underneath — no orphaned processes.

Usage:  python3 pty-wrap.py gemini --approval-mode yolo -i "prompt"
"""

import os
import pty
import select
import signal
import subprocess
import sys
import time

SHUTDOWN_GRACE_SECONDS = 3


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("usage: pty-wrap.py COMMAND [ARGS...]\n")
        return 1

    master_fd, slave_fd = pty.openpty()

    try:
        proc = subprocess.Popen(
            sys.argv[1:],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            start_new_session=True,
            close_fds=True,
        )
    except OSError as exc:
        os.close(master_fd)
        os.close(slave_fd)
        sys.stderr.write(f"pty-wrap: exec failed: {exc}\n")
        return 127

    os.close(slave_fd)
    os.set_blocking(master_fd, False)

    # Forward SIGTERM/SIGINT to the child's process group
    def _forward_signal(signum: int, _frame: object) -> None:
        try:
            os.killpg(proc.pid, signum)
        except OSError:
            pass

    signal.signal(signal.SIGTERM, _forward_signal)
    signal.signal(signal.SIGINT, _forward_signal)

    # Drain PTY master while child is alive
    while proc.poll() is None:
        try:
            ready, _, _ = select.select([master_fd], [], [], 1.0)
        except (OSError, InterruptedError):
            break
        if ready:
            try:
                data = os.read(master_fd, 8192)
                if data:
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
            except OSError:
                break

    # Final drain after child exits
    try:
        while True:
            data = os.read(master_fd, 8192)
            if not data:
                break
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
    except OSError:
        pass

    os.close(master_fd)

    # Ensure the entire process group is dead
    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except OSError:
            pass
        deadline = time.monotonic() + SHUTDOWN_GRACE_SECONDS
        while proc.poll() is None and time.monotonic() < deadline:
            time.sleep(0.1)
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                pass
            proc.wait(timeout=2)

    return proc.returncode or 0


if __name__ == "__main__":
    sys.exit(main())
