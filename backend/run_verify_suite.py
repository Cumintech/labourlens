"""Runs every verify_*.py integration script in this directory as a single
command, against its own fresh throwaway SQLite DB, and fails fast and
loud on the first failure -- replaces having to invoke each of the 33
scripts individually with hand-set environment variables.

verify_sync_worker.py is skipped by default: it needs the separate
test-portal/ app running on 127.0.0.1:8020 (real Playwright automation
against it, not mocked), which this runner doesn't start. Pass
--include-sync-worker once that's running separately.

    python run_verify_suite.py
    python run_verify_suite.py --include-sync-worker
"""

import glob
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
SKIP_BY_DEFAULT = {"verify_sync_worker.py"}


def main() -> int:
    include_sync_worker = "--include-sync-worker" in sys.argv
    scripts = sorted(Path(p).name for p in glob.glob(str(HERE / "verify_*.py")))
    if not include_sync_worker:
        scripts = [s for s in scripts if s not in SKIP_BY_DEFAULT]

    env = os.environ.copy()
    env.setdefault("OCR_WARM_UP", "false")
    env.setdefault("ENVIRONMENT", "development")

    results: list[tuple[str, bool]] = []
    for script in scripts:
        db_path = HERE / f"scratch_runner_{script.removesuffix('.py')}.db"
        db_path.unlink(missing_ok=True)
        env["DATABASE_URL"] = f"sqlite:///{db_path}"

        print(f"--- {script} ---", flush=True)
        result = subprocess.run([sys.executable, script], cwd=HERE, env=env)
        db_path.unlink(missing_ok=True)

        passed = result.returncode == 0
        results.append((script, passed))
        if not passed:
            print(f"\nFAILED: {script} (exit {result.returncode}) -- stopping.\n")
            break

    print("\n=== Summary ===")
    for script, passed in results:
        print(f"  {'PASS' if passed else 'FAIL'}  {script}")
    ran = len(results)
    total = len(scripts)
    if ran < total:
        print(f"  (stopped after first failure -- {total - ran} script(s) not run)")

    return 0 if all(passed for _, passed in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
