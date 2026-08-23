"""Punto de entrada CLI del scraper.

Comandos:
    run      ejecuta la corrida (con checkpointing / stop cooperativo / upsert incremental)
    status   muestra el estado actual de una corrida
    stop     marca stop_requested en la corrida activa
"""

import argparse
import os
import sys


def _conn_string() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        host = os.environ.get("POSTGRES_HOST", "postgres")
        port = os.environ.get("POSTGRES_PORT", "5432")
        user = os.environ.get("POSTGRES_USER", "kroser")
        password = os.environ.get("POSTGRES_PASSWORD", "kroser")
        dbname = os.environ.get("POSTGRES_DB", "kroserbot")
        return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"
    return url


def cmd_run(args) -> int:
    from .db import Database
    from .runtime import ScraperRuntime

    db = Database(_conn_string())
    runtime = ScraperRuntime(db=db, args=args)
    return runtime.execute()


def cmd_status(args) -> int:
    from .db import Database
    from .runtime import ScraperRuntime

    db = Database(_conn_string())
    runtime = ScraperRuntime(db=db, args=args)
    return runtime.status()


def cmd_stop(args) -> int:
    from .db import Database

    db = Database(_conn_string())
    db.request_stop()
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="scraper", description="Scraper de Kroker")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_run = sub.add_parser("run", help="Correr el scraper")
    p_run.add_argument("--resume", action="store_true", help="Retomar desde checkpoint si existe")
    p_run.add_argument("--fresh", action="store_true", help="Ignorar checkpoint y arrancar de cero")
    p_run.add_argument("--limit", type=int, default=0, help="Procesar solo N productos (tests/demo)")
    p_run.add_argument("--no-sleep", action="store_true", help="Sin delays (tests/demo)")
    p_run.add_argument("--verbose", action="store_true", help="Log en consola además de JSON")
    p_run.set_defaults(handler=cmd_run)

    p_status = sub.add_parser("status")
    p_status.add_argument("--json", action="store_true")
    p_status.set_defaults(handler=cmd_status)

    p_stop = sub.add_parser("stop")
    p_stop.set_defaults(handler=cmd_stop)

    args = parser.parse_args()
    sys.exit(args.handler(args))


if __name__ == "__main__":
    main()