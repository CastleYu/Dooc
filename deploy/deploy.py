"""Deploy built Dooc artifacts to Messenger using the existing Beacon SSH helper."""
import argparse
import io
import importlib.util
import json
import shlex
import sqlite3
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path


class Deploy:
    root = Path(__file__).resolve().parent.parent
    beacon = Path(r"H:\Documents\Abyss\Beacon")

    @classmethod
    def pack(cls, bundle):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz") as tar:
            for rel in ("package.json", "package-lock.json", "packages/docs-api/package.json",
                        "packages/docs-mcp/package.json", "packages/docs-web/package.json",
                        "packages/docs-api/dist", "packages/docs-mcp/dist",
                        "packages/docs-web/doc_build", "deploy/server.mjs"):
                tar.add(cls.root / rel, arcname=rel)
            tar.add(bundle, arcname="source.bundle")
        return output.getvalue()

    @classmethod
    def main(cls):
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument("--seed-db", type=Path, help="Initial SQLite import; never overwrites a remote database")
        args = parser.parse_args()
        sys.path.insert(0, str(cls.beacon))
        spec = importlib.util.spec_from_file_location("beacon_deploy", cls.beacon / "deploy/tools.py")
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        Remote = helper.Remote
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        release = f"/opt/dooc/releases/{stamp}"
        work = cls.root / ".dooc"
        work.mkdir(exist_ok=True)
        bundle = work / f"source-{stamp}.bundle"
        subprocess.run(["git", "bundle", "create", str(bundle), "--all"], cwd=cls.root, check=True)
        archive = cls.pack(bundle)
        with Remote() as remote:
            previous = remote.run("readlink -f /opt/dooc/current || true").strip()
            remote.run(f"set -eu; mkdir -p {release} /srv/data/dooc; id dooc >/dev/null 2>&1 || useradd --system --home-dir /srv/data/dooc --shell /usr/sbin/nologin dooc")
            remote.put(archive, f"{release}/app.tar.gz")
            remote.run(f"set -eu; tar -xzf {release}/app.tar.gz -C {release}; rm {release}/app.tar.gz; if ! test -d /srv/data/dooc/repo/.git; then git clone {release}/source.bundle /srv/data/dooc/repo; fi; rm {release}/source.bundle")
            print(remote.run(f"cd {release} && npm ci --omit=dev --workspace=@dooc/docs-api --workspace=@dooc/docs-mcp --ignore-scripts --no-audit --no-fund", timeout=300))
            if args.seed_db:
                exists = remote.run("test -e /srv/data/dooc/collab.db && echo exists || true").strip()
                if exists:
                    raise RuntimeError("Remote database already exists; refusing initial import")
                backup = work / f"collab-before-migration-{stamp}.db"
                with sqlite3.connect(args.seed_db) as src, sqlite3.connect(backup) as dst:
                    src.backup(dst)
                    assert dst.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                    counts = {table: dst.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                              for table in ("comments", "tasks", "changes")}
                print("Imported database rows:", json.dumps(counts))
                remote.put(backup.read_bytes(), "/srv/data/dooc/collab.db")
            remote.put((cls.root / "deploy/dooc.service").read_bytes(), "/etc/systemd/system/dooc.service")
            remote.run(f"set -eu; chown -R dooc:dooc /srv/data/dooc; chmod 750 /srv/data/dooc; setfacl -m u:dooc:--x /srv/data; chmod -R go-w {release}; ln -sfn {release} /opt/dooc/current; systemctl daemon-reload; systemctl enable dooc.service; systemctl restart dooc.service")
            try:
                remote.run("curl --retry 10 --retry-delay 1 --retry-connrefused --fail --silent http://192.168.3.23:8788/health")
            except Exception:
                if previous and previous != "/opt/dooc/current":
                    remote.run(f"ln -sfn {shlex.quote(previous)} /opt/dooc/current; systemctl restart dooc.service")
                else:
                    remote.run("systemctl stop dooc.service")
                raise
            remote.put((cls.root / "deploy/dooc.toml").read_bytes(), "/etc/beacon/services.d/dooc.toml")
            print(f"Deployed {release}\nURL http://192.168.3.23:8788/\nPrevious {previous or 'none'}")


if __name__ == "__main__":
    Deploy.main()
