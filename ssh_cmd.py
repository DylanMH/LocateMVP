#!/usr/bin/env python
"""SSH command runner for the OVH server."""
import sys
import paramiko

HOST = "15.204.247.173"
USER = "ubuntu"
PASS = "OGFakeee1!"

def run(cmd, timeout=30):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASS, timeout=15, banner_timeout=30, auth_timeout=15)
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        stdout.channel.settimeout(timeout)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        exit_code = stdout.channel.recv_exit_status()
        sys.stdout.buffer.write(out.encode("utf-8", errors="replace"))
        sys.stdout.buffer.write(b"\n")
        if err:
            sys.stderr.buffer.write(err.encode("utf-8", errors="replace"))
        sys.exit(exit_code)
    finally:
        client.close()

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "echo connected"
    run(cmd)
