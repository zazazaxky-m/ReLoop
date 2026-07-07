from __future__ import annotations

import argparse
import os
import signal
import threading
from pathlib import Path

from .api import LocalApiServer
from .config import RvmConfig
from .controller import RvmController


def main() -> None:
    parser = argparse.ArgumentParser(description="ReLoop RVM edge runtime")
    parser.add_argument("--config", default="rvm/config.local.json")
    parser.add_argument("--env", choices=["dev", "prod"], default=os.getenv("RVM_ENV", "dev"), help="Environment mode (dev/prod)")
    args = parser.parse_args()
    
    config = RvmConfig.load(args.config)

    if args.env == "prod":
        server_url = os.getenv("RVM_SERVER_URL")
        machine_secret = os.getenv("RVM_MACHINE_SECRET")
        if not server_url or not machine_secret:
            raise SystemExit(
                "RVM_SERVER_URL dan RVM_MACHINE_SECRET wajib diset sebagai environment "
                "variable saat --env prod. Jangan menaruh secret produksi di source code; "
                "isi nilai ini melalui environment atau secret manager pada mesin deploy."
            )
        config.server_url = server_url
        config.machine_secret = machine_secret

    controller = RvmController(config)
    assets = Path(__file__).resolve().parent / "web"
    api = LocalApiServer(controller, assets)

    def shutdown(*_args) -> None:
        # BaseServer.shutdown must run from a different thread than serve_forever.
        threading.Thread(target=api.stop, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    controller.start()
    print(f"ReLoop RVM {config.machine_code}: http://{config.host}:{config.port}")
    try:
        api.serve()
    finally:
        controller.stop()


if __name__ == "__main__":
    main()
