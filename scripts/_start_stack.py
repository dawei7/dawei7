#!/usr/bin/env python
"""Final step: log VPS into ghcr.io, start the Docker stack."""
import os
import sys
import paramiko

# Must be set in environment before running
GH_TOKEN = os.environ["GH_TOKEN"]
VPS_PASSWORD = os.environ["VPS_PASSWORD"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print("[1] Connecting to VPS...")
client.connect("srv1442027.hstgr.cloud", username="root", password=VPS_PASSWORD)
print("    Connected")


def run(cmd, check=True, timeout=120):
    _, out, err = client.exec_command(cmd, timeout=timeout)
    o = out.read().decode("utf-8", errors="replace")
    e = err.read().decode("utf-8", errors="replace")
    rc = out.channel.recv_exit_status()
    combined = (o + e).strip()
    if combined:
        for line in combined.splitlines():
            print(f"    {line}")
    if check and rc != 0:
        raise RuntimeError(f"Exit {rc}: {cmd[:100]}")
    return o


print("[2] Logging VPS into ghcr.io...")
run(f"echo '{GH_TOKEN}' | docker login ghcr.io -u dawei7 --password-stdin")

print("[3] Pulling personal-website image...")
run("docker pull ghcr.io/dawei7/personal-website:latest 2>&1")

print("[4] Starting full stack...")
run("cd /opt/server && docker compose up -d 2>&1", timeout=90)

print("[5] Container status...")
run("docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'")

print("[6] Ports 80/443...")
run("ss -tlnp | grep -E ':80|:443'")

# Persist the GH token in .env so the VPS can pull future image updates
check_cmd = "grep -q 'GHCR_TOKEN' /opt/server/.env 2>/dev/null && echo EXISTS || echo MISSING"
out, _, _ = client.exec_command(check_cmd)
result = out.read().decode().strip()
if "MISSING" in result:
    run(f"echo 'GHCR_TOKEN={GH_TOKEN}' >> /opt/server/.env")
    print("[7] GHCR_TOKEN saved to .env")

client.close()
print("\nStack is fully running!")
print("  https://dawei7.com  (live once DNS points to VPS)")
print("  https://traefik.dawei7.com  (dashboard)")
