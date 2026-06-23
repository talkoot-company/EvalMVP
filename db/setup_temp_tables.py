#!/usr/bin/env python3
"""
Setup script: create prefixed temp tables in the Azure SQL Server database
`dev-golfcarts` and load the local SQLite app data into them. Covers all four
local tables: criteria, generations, eval_results, type_mapping.

- SQL Server credentials are read from the repo `.env` (SQL_SERVER_CONNSTRING).
- Every table is prefixed (default "temp_Brian_") so it never collides with the
  real source-of-truth tables. The prefix is configurable (see CONFIG below or
  --prefix / TABLE_PREFIX env).
- Source data comes from the local SQLite app DB (db/evals.db by default).

By default the script DROPS and recreates only the prefixed tables it manages,
then loads the data. Nothing un-prefixed is ever touched.

Review, then run:

    python db/setup_temp_tables.py                 # uses defaults
    python db/setup_temp_tables.py --prefix temp_Brian_
    python db/setup_temp_tables.py --no-drop       # don't drop existing prefixed tables
    python db/setup_temp_tables.py --create-only   # create tables, skip data load
"""

from __future__ import annotations

import argparse
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import pyodbc
except ImportError:
    print("pyodbc is required:  pip install pyodbc", file=sys.stderr)
    sys.exit(1)

# ---------------------------------------------------------------------------
# CONFIG (overridable via CLI flags / env)
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
DEFAULT_SQLITE = ROOT / "db" / "evals.db"
DEFAULT_PREFIX = os.environ.get("TABLE_PREFIX", "temp_Brian_")
TARGET_DATABASE = "dev-golfcarts"   # per request — overrides whatever the connstring names
SCHEMA = "dbo"
BATCH_SIZE = 500                    # rows per executemany batch
LOGIN_TIMEOUT = 30                  # seconds

# Marks a column that should be bound as NVARCHAR(MAX) under fast_executemany.
MAXTEXT = object()

# ---------------------------------------------------------------------------
# Table definitions: (column_name, sqlserver_type, nullable)
# Column names match the local SQLite tables exactly, so the same list drives
# both the SELECT from SQLite and the INSERT into SQL Server.
# ---------------------------------------------------------------------------
CRITERIA_COLUMNS = [
    ("id",                  "NVARCHAR(200)",  False),
    ("context",             "NVARCHAR(50)",   False),
    ("content_type",        "NVARCHAR(50)",   False),
    ("criteria_category",   "NVARCHAR(255)",  True),
    ("criteria_name",       "NVARCHAR(500)",  False),
    ("criteria_definition", "NVARCHAR(MAX)",  True),
    ("criteria_type",       "NVARCHAR(50)",   False),
    ("eval_definition",     "NVARCHAR(MAX)",  False),
    ("weight",              "FLOAT",          False),
    ("active",              "BIT",            False),
    ("marketplace_tag",     "NVARCHAR(100)",  True),
    ("brand_tag",           "NVARCHAR(100)",  True),
    ("industry_tag",        "NVARCHAR(100)",  True),
    ("customer",            "NVARCHAR(255)",  True),
    ("brand",               "NVARCHAR(255)",  True),
    ("custom_tags",         "NVARCHAR(MAX)",  True),
    ("created_at",          "DATETIME2(7)",   False),
    ("updated_at",          "DATETIME2(7)",   False),
    ("notes",               "NVARCHAR(MAX)",  True),
]

GENERATIONS_COLUMNS = [
    ("generation_id",       "NVARCHAR(64)",   False),
    ("model",               "NVARCHAR(100)",  True),
    ("created_at",          "BIGINT",         True),
    ("system_prompt",       "NVARCHAR(MAX)",  True),
    ("last_user_message",   "NVARCHAR(MAX)",  True),
    ("few_shot_count",      "INT",            True),
    ("temperature",         "FLOAT",          True),
    ("max_tokens",          "INT",            True),
    ("response_content",    "NVARCHAR(MAX)",  True),
    ("prompt_tokens",       "INT",            True),
    ("completion_tokens",   "INT",            True),
    ("total_tokens",        "INT",            True),
    ("finish_reason",       "NVARCHAR(50)",   True),
    ("is_valid",            "BIT",            True),
    ("req_json",            "NVARCHAR(MAX)",  True),
    ("resp_json",           "NVARCHAR(MAX)",  True),
]

EVAL_RESULTS_COLUMNS = [
    ("id",             "NVARCHAR(64)",   False),
    ("generation_id",  "NVARCHAR(64)",   False),
    ("criterion_id",   "NVARCHAR(200)",  False),
    ("criterion_name", "NVARCHAR(500)",  True),
    ("desired_score",  "NVARCHAR(50)",   True),
    ("score",          "NVARCHAR(50)",   True),
    ("rationale",      "NVARCHAR(MAX)",  True),
    ("evidence",       "NVARCHAR(MAX)",  True),   # JSON array
    ("product_name",   "NVARCHAR(500)",  True),
    ("run_at",         "DATETIME2(7)",   False),
]

TYPE_MAPPING_COLUMNS = [
    ("criteria_content_type", "NVARCHAR(100)", False),
    ("generation_type",       "NVARCHAR(100)", False),
]

# Per-table: column defs + primary key (str or tuple for composite) + source SQLite table.
TABLES = {
    "criteria":     {"columns": CRITERIA_COLUMNS,     "pk": "id",            "source": "criteria"},
    "generations":  {"columns": GENERATIONS_COLUMNS,  "pk": "generation_id", "source": "generations"},
    "eval_results": {"columns": EVAL_RESULTS_COLUMNS, "pk": "id",            "source": "eval_results"},
    "type_mapping": {"columns": TYPE_MAPPING_COLUMNS,
                     "pk": ("criteria_content_type", "generation_type"),     "source": "type_mapping"},
}


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------
def read_connstring() -> str:
    if not ENV_PATH.exists():
        sys.exit(f"ERROR: {ENV_PATH} not found")
    m = re.search(r"^\s*SQL_SERVER_CONNSTRING\s*=\s*(.+)$", ENV_PATH.read_text(), re.M)
    if not m:
        sys.exit("ERROR: SQL_SERVER_CONNSTRING not found in .env")
    return m.group(1).strip()


def pick_driver() -> str:
    available = pyodbc.drivers()
    for preferred in ("ODBC Driver 18 for SQL Server",
                      "ODBC Driver 17 for SQL Server",
                      "SQL Server"):
        if preferred in available:
            return preferred
    sys.exit(f"ERROR: no SQL Server ODBC driver found. Installed: {available}")


def build_odbc_connstring(adonet: str, database: str) -> tuple[str, str]:
    """Convert the .env ADO.NET-style connstring to an ODBC one. Returns
    (odbc_connstring, server_name) — Database is forced to `database`."""
    parts: dict[str, str] = {}
    for segment in adonet.split(";"):
        segment = segment.strip()
        if not segment:
            continue
        key, _, value = segment.partition("=")
        parts[key.strip().lower()] = value.strip()

    server = parts.get("server")
    user = parts.get("user id") or parts.get("uid")
    password = parts.get("password") or parts.get("pwd")
    if not (server and user and password):
        sys.exit("ERROR: connstring missing Server / User Id / Password")

    driver = pick_driver()
    odbc = (
        f"Driver={{{driver}}};"
        f"Server={server};"
        f"Database={database};"
        f"UID={user};PWD={password};"
        "Encrypt=yes;TrustServerCertificate=yes;"
    )
    return odbc, server


# ---------------------------------------------------------------------------
# DDL
# ---------------------------------------------------------------------------
def full_name(prefix: str, base: str) -> str:
    return f"{prefix}{base}"


def create_table_sql(table: str, columns, pk) -> str:
    pk_cols = [pk] if isinstance(pk, str) else list(pk)
    lines = []
    for name, sqltype, nullable in columns:
        null = "NULL" if nullable else "NOT NULL"
        lines.append(f"    [{name}] {sqltype} {null}")
    pk_list = ", ".join(f"[{c}]" for c in pk_cols)
    lines.append(f"    CONSTRAINT [PK_{table}] PRIMARY KEY ({pk_list})")
    body = ",\n".join(lines)
    return f"CREATE TABLE [{SCHEMA}].[{table}] (\n{body}\n);"


def drop_table_sql(table: str) -> str:
    return (f"IF OBJECT_ID(N'[{SCHEMA}].[{table}]', N'U') IS NOT NULL "
            f"DROP TABLE [{SCHEMA}].[{table}];")


# ---------------------------------------------------------------------------
# Value transforms (SQLite -> SQL Server)
# ---------------------------------------------------------------------------
def parse_ts(value):
    """ISO8601 string -> naive UTC datetime (for DATETIME2). All source
    timestamps are UTC (+00:00)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        dt = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def transform_row(table_base: str, columns, row: sqlite3.Row) -> list:
    out = []
    for name, sqltype, _nullable in columns:
        v = row[name]
        if sqltype.startswith("DATETIME2"):
            v = parse_ts(v)
        elif sqltype == "BIT" and v is not None:
            v = 1 if v else 0
        elif sqltype == "FLOAT" and v is not None:
            v = float(v)
        out.append(v)
    return out


def input_sizes(columns):
    """setinputsizes list so fast_executemany binds NVARCHAR(MAX) columns
    correctly (otherwise pyodbc sizes to the longest value in the batch)."""
    sizes = []
    for _name, sqltype, _nullable in columns:
        if sqltype == "NVARCHAR(MAX)":
            sizes.append((pyodbc.SQL_WVARCHAR, 0, 0))
        else:
            sizes.append(None)
    return sizes


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description="Create prefixed temp tables in dev-golfcarts and load SQLite data.")
    ap.add_argument("--prefix", default=DEFAULT_PREFIX, help=f"Table name prefix (default: {DEFAULT_PREFIX!r})")
    ap.add_argument("--sqlite", default=str(DEFAULT_SQLITE), help=f"Source SQLite DB (default: {DEFAULT_SQLITE})")
    ap.add_argument("--database", default=TARGET_DATABASE, help=f"Target SQL Server database (default: {TARGET_DATABASE})")
    ap.add_argument("--no-drop", action="store_true", help="Do not drop existing prefixed tables first")
    ap.add_argument("--create-only", action="store_true", help="Create tables but skip loading data")
    args = ap.parse_args()

    prefix = args.prefix
    sqlite_path = Path(args.sqlite)
    if not sqlite_path.exists():
        sys.exit(f"ERROR: SQLite source not found: {sqlite_path}")

    odbc, server = build_odbc_connstring(read_connstring(), args.database)

    # Plan summary
    print("=" * 70)
    print("EvalMVP temp-table setup")
    print(f"  Server   : {server}")
    print(f"  Database : {args.database}")
    print(f"  Source   : {sqlite_path}")
    print(f"  Prefix   : {prefix}")
    print(f"  Tables   : " + ", ".join(f"{prefix}{b}" for b in TABLES))
    print(f"  Drop first: {not args.no_drop}   Load data: {not args.create_only}")
    print("=" * 70)

    src = sqlite3.connect(str(sqlite_path))
    src.row_factory = sqlite3.Row

    conn = pyodbc.connect(odbc, autocommit=False, timeout=LOGIN_TIMEOUT)
    try:
        cur = conn.cursor()

        # 1. DDL
        for base, spec in TABLES.items():
            table = full_name(prefix, base)
            if not args.no_drop:
                print(f"[ddl] drop if exists  {table}")
                cur.execute(drop_table_sql(table))
            print(f"[ddl] create          {table}")
            cur.execute(create_table_sql(table, spec["columns"], spec["pk"]))
        conn.commit()

        if args.create_only:
            print("Done (create-only).")
            return

        # 2. Load
        for base, spec in TABLES.items():
            table = full_name(prefix, base)
            columns = spec["columns"]
            colnames = [c[0] for c in columns]

            select_sql = f"SELECT {', '.join(colnames)} FROM {spec['source']}"
            collist = ", ".join(f"[{c}]" for c in colnames)
            placeholders = ", ".join("?" for _ in colnames)
            insert_sql = f"INSERT INTO [{SCHEMA}].[{table}] ({collist}) VALUES ({placeholders})"

            total = src.execute(f"SELECT COUNT(*) FROM {spec['source']}").fetchone()[0]
            print(f"[load] {table}: {total} rows")

            cur.fast_executemany = True
            cur.setinputsizes(input_sizes(columns))

            src_cur = src.execute(select_sql)
            loaded = 0
            while True:
                rows = src_cur.fetchmany(BATCH_SIZE)
                if not rows:
                    break
                batch = [transform_row(base, columns, r) for r in rows]
                cur.executemany(insert_sql, batch)
                loaded += len(batch)
                print(f"    {loaded}/{total}", end="\r", flush=True)
            conn.commit()
            print(f"    {loaded}/{total}  committed")

        # 3. Verify
        print("[verify] row counts in SQL Server:")
        for base in TABLES:
            table = full_name(prefix, base)
            n = cur.execute(f"SELECT COUNT(*) FROM [{SCHEMA}].[{table}]").fetchone()[0]
            print(f"    {table}: {n}")

        print("Done.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
        src.close()


if __name__ == "__main__":
    main()
