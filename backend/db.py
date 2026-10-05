import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


SCHEMA = """
CREATE TABLE IF NOT EXISTS yaw_logs (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    verdict text,
    reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    processed_at timestamptz
);

-- 峰值锁区：锁定动作把那一刻的峰值与时点写入本表，此后只读、永不再变。
CREATE TABLE IF NOT EXISTS peak_locks (
    turbine_code text PRIMARY KEY,
    peak_abs_deg double precision NOT NULL,
    peak_at timestamptz NOT NULL,
    locked_at timestamptz NOT NULL,
    locked_by text NOT NULL
);
"""


def ensure_schema(conn):
    """逐条执行建表语句，不依赖驱动对多语句单次执行的支持。"""
    for stmt in SCHEMA.split(";"):
        stmt = stmt.strip()
        if stmt:
            conn.execute(stmt)
