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
        config.server_url = "https://reloop.farhanlhsn.cloud"
        config.machine_secret = "g17051vhqVVYcp89gUafi2AsQRNDjClGCejzvWUI8mY"
        
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
