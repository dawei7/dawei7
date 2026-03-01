#!/usr/bin/env python
"""
One-shot VPS bootstrap for dawei7.com
Runs from local machine, SSHes into VPS with password, sets everything up.
"""
import os
import secrets
import string
import base64
import sys
import subprocess
import paramiko

HOST = "srv1442027.hstgr.cloud"
USER = "root"
PASSWORD = os.environ["VPS_PASSWORD"]

# Resolve /tmp path cross-platform (Git Bash /tmp → Windows AppData\Local\Temp)


def bash_to_win(p):
    r = subprocess.run(["cygpath", "-w", p], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else p


KEYS_DIR = bash_to_win("/tmp/dawei7-deploy")

# ─── Load keys we generated ──────────────────────────────────────────────────
with open(os.path.join(KEYS_DIR, "id_ed25519.pub")) as f:
    ACTIONS_PUBKEY = f.read().strip()
with open(os.path.join(KEYS_DIR, "vps_github")) as f:
    VPS_GH_PRIVKEY = f.read()

# ─── Generate strong passwords ───────────────────────────────────────────────


def gen_pass(n=40):
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(n))


POSTGRES_PASS = gen_pass()
REDIS_PASS = gen_pass()
TRAEFIK_USER = "admin"
TRAEFIK_PASS = gen_pass(20)

print(f"\n{'='*60}")
print("  GENERATED CREDENTIALS — SAVE THESE SECURELY")
print(f"{'='*60}")
print(f"  Traefik dashboard: https://traefik.dawei7.com")
print(f"  Username : {TRAEFIK_USER}")
print(f"  Password : {TRAEFIK_PASS}")
print(f"  Postgres : {POSTGRES_PASS}")
print(f"  Redis    : {REDIS_PASS}")
print(f"{'='*60}\n")

# ─── Connect to VPS ──────────────────────────────────────────────────────────
print("[1/9] Connecting to VPS...")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD)
print("      Connected ✓")


def run(cmd, check=True):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(f"      {out.strip()}")
    if err.strip() and code != 0:
        print(f"      STDERR: {err.strip()}")
    if check and code != 0:
        raise RuntimeError(f"Command failed (exit {code}): {cmd}")
    return out, err, code


# ─── 1. Install Actions→VPS deploy key ───────────────────────────────────────
print("[2/9] Installing GitHub Actions SSH key on VPS...")
run("mkdir -p /root/.ssh && chmod 700 /root/.ssh")
run(f"grep -qF '{ACTIONS_PUBKEY}' /root/.ssh/authorized_keys 2>/dev/null || echo '{ACTIONS_PUBKEY}' >> /root/.ssh/authorized_keys")
run("chmod 600 /root/.ssh/authorized_keys")
print("      Deploy key installed ✓")

# ─── 2. Install VPS→GitHub deploy key (for git pull) ─────────────────────────
print("[3/9] Installing VPS→GitHub SSH key for git pull...")
# Escape the private key for safe shell passing
privkey_escaped = VPS_GH_PRIVKEY.replace("'", "'\\''")
run(f"cat > /root/.ssh/vps_github << 'SSHEOF'\n{VPS_GH_PRIVKEY}\nSSHEOF")
run("chmod 600 /root/.ssh/vps_github")
run("""cat >> /root/.ssh/config << 'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile /root/.ssh/vps_github
  StrictHostKeyChecking no
EOF""")
run("chmod 600 /root/.ssh/config")
print("      Git SSH key installed ✓")

# ─── 3. Ensure Docker is running ─────────────────────────────────────────────
print("[4/9] Checking Docker...")
run("systemctl start docker 2>/dev/null || true", check=False)
run("docker --version")

# ─── 4. Stop Hostinger preinstalled Traefik / port conflicts ─────────────────
print("[5/9] Clearing port 80/443 conflicts from Hostinger template...")
run("docker stop traefik 2>/dev/null || true", check=False)
run("docker rm   traefik 2>/dev/null || true", check=False)
# Back up Hostinger's own compose file so it won't restart on reboot
run("[ -f /root/docker-compose.yml  ] && mv /root/docker-compose.yml  /root/docker-compose.yml.hostinger  || true", check=False)
run("[ -f /root/docker-compose.yaml ] && mv /root/docker-compose.yaml /root/docker-compose.yaml.hostinger || true", check=False)
print("      Port conflicts cleared ✓")

# ─── 5. Create proxy docker network ──────────────────────────────────────────
print("[6/9] Creating Docker proxy network...")
out, _, code = run("docker network create proxy 2>&1", check=False)
if "already exists" in out or code == 0:
    print("      Network 'proxy' ready ✓")

# ─── 6. Clone repo ───────────────────────────────────────────────────────────
print("[7/9] Cloning dawei7/dawei7 repository...")
run("mkdir -p /opt/server")
out, _, code = run("[ -d /opt/server/.git ] && echo EXISTS || echo MISSING", check=False)
if "EXISTS" in out:
    run("cd /opt/server && git pull origin main")
    print("      Repo already cloned, pulled latest ✓")
else:
    run("git clone git@github.com:dawei7/dawei7.git /opt/server")
    print("      Repo cloned ✓")

# ─── 7. Generate htpasswd for Traefik dashboard ───────────────────────────────
print("[8/9] Generating credentials...")
run("apt-get install -y -qq apache2-utils 2>/dev/null || true", check=False)
htpasswd_out, _, _ = run(f"htpasswd -nb {TRAEFIK_USER} {TRAEFIK_PASS}")
htpasswd_val = htpasswd_out.strip().replace("$", "$$")

env_content = f"""# Generated by bootstrap — do NOT commit this file
TRAEFIK_DASHBOARD_AUTH={htpasswd_val}

POSTGRES_USER=dawei
POSTGRES_PASSWORD={POSTGRES_PASS}
POSTGRES_DB=dawei_db

REDIS_PASSWORD={REDIS_PASS}

GITHUB_REPOSITORY_OWNER=dawei7
"""
# Write .env via SFTP
sftp = client.open_sftp()
with sftp.open("/opt/server/.env", "w") as f:
    f.write(env_content)
sftp.chmod("/opt/server/.env", 0o600)

# Create acme.json with correct permissions
run("touch /opt/server/traefik/acme.json")
run("chmod 600 /opt/server/traefik/acme.json")
sftp.close()
print("      .env and acme.json created ✓")

# ─── 8. Start the stack ──────────────────────────────────────────────────────
print("[9/9] Starting Docker stack...")
run("cd /opt/server && docker compose pull 2>&1 | tail -5")
run("cd /opt/server && docker compose up -d 2>&1")
run("cd /opt/server && docker compose ps")
print("\n  Stack started ✓")

client.close()

print(f"\n{'='*60}")
print("  VPS BOOTSTRAP COMPLETE")
print(f"{'='*60}")
print(f"  Host : {HOST}")
print(f"  Repo : https://github.com/dawei7/dawei7 (private)")
print(f"  Site : https://dawei7.com  (once DNS propagates)")
print(f"  Admin: https://traefik.dawei7.com")
print(f"{'='*60}\n")
