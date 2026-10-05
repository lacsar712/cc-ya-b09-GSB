import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import SCHEMA, connect
from rules import judge

SECRET = os.environ.get("JWT_SECRET", "yaw-align-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

USERS = {
    "technician": {
        "role": "writer",
        "password_hash": pwd.hash("tech123456"),
    },
    "observer": {
        "role": "reader",
        "password_hash": pwd.hash("obs123456"),
    },
}

app = Quart(__name__)


def _run_db(fn, *args, **kwargs):
    return fn(*args, **kwargs)


async def run_db(fn, *args, **kwargs):
    return await asyncio.to_thread(_run_db, fn, *args, **kwargs)


def seed_if_empty(conn):
    conn.execute(SCHEMA)
    count = conn.execute("SELECT COUNT(*) AS n FROM yaw_logs").fetchone()["n"]
    if count > 0:
        return
    now = datetime.now(timezone.utc)
    samples = [
        ("W01", 0.4, "合格"),
        ("W07", 3.2, "偏航超差"),
    ]
    for code, err, expected_verdict in samples:
        verdict, reason = judge(err)
        assert verdict == expected_verdict
        conn.execute(
            """INSERT INTO yaw_logs
               (turbine_code, yaw_err_deg, status, verdict, reason,
                created_by, created_at, processed_at)
               VALUES (%s, %s, 'done', %s, %s, %s, %s, %s)""",
            (code, err, verdict, reason, "technician", now, now),
        )


@app.before_serving
async def startup():
    def init():
        with connect() as conn:
            seed_if_empty(conn)
            conn.commit()

    await run_db(init)


def parse_bearer():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


async def current_user():
    token = parse_bearer()
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except JWTError:
        return None
    sub = payload.get("sub")
    if sub not in USERS:
        return None
    return {"username": sub, "role": payload.get("role")}


def require_login(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        return await handler(user, *args, **kwargs)

    return wrapper


def require_writer(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        if user["role"] != "writer":
            return jsonify({"detail": "仅现场技师可提交偏航记录"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


@app.get("/api/health")
async def health():
    return jsonify({"status": "ok", "service": "yaw-align-log"})


@app.post("/api/auth/login")
async def login():
    body = await request.get_json(force=True, silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    user = USERS.get(username)
    if not user or not pwd.verify(password, user["password_hash"]):
        return jsonify({"detail": "用户名或密码错误"}), 401
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode(
        {"sub": username, "role": user["role"], "exp": exp},
        SECRET,
        algorithm="HS256",
    )
    return jsonify(
        {
            "access_token": token,
            "username": username,
            "role": user["role"],
        }
    )


@app.get("/api/logs")
@require_login
async def list_logs(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, turbine_code, yaw_err_deg, status, verdict, reason,
                          created_by, created_at, processed_at
                   FROM yaw_logs ORDER BY id DESC"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/logs")
@require_writer
async def create_log(user):
    body = await request.get_json(force=True, silent=True) or {}
    turbine_code = (body.get("turbine_code") or "").strip()
    if not turbine_code:
        return jsonify({"detail": "机组编号不能为空"}), 400
    try:
        yaw_err_deg = float(body.get("yaw_err_deg"))
    except (TypeError, ValueError):
        return jsonify({"detail": "偏航误差必须是数字"}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            row = conn.execute(
                """INSERT INTO yaw_logs
                   (turbine_code, yaw_err_deg, status, verdict, reason,
                    created_by, created_at)
                   VALUES (%s, %s, 'pending', NULL, NULL, %s, %s)
                   RETURNING id, turbine_code, yaw_err_deg, status, verdict, reason,
                             created_by, created_at, processed_at""",
                (turbine_code, yaw_err_deg, user["username"], now),
            ).fetchone()
            conn.commit()
            return row

    row = await run_db(insert)
    return jsonify(row), 201


# 仅从「办结」集合重算各机组历史峰值：前端不得自行比大小，
# 只有 pending（未办结）记录的机组不产生峰值行，由左连接补 NULL。
PEAKS_SQL = """
WITH done_peaks AS (
    SELECT DISTINCT ON (turbine_code)
           turbine_code,
           abs(yaw_err_deg) AS peak_deg,
           processed_at AS peak_at
    FROM yaw_logs
    WHERE status = 'done'
    ORDER BY turbine_code, abs(yaw_err_deg) DESC, id DESC
),
turbines AS (
    SELECT DISTINCT turbine_code FROM yaw_logs
)
SELECT t.turbine_code,
       dp.peak_deg,
       dp.peak_at,
       pl.peak_deg  AS locked_peak_deg,
       pl.peak_at    AS locked_peak_at,
       pl.locked_by,
       pl.locked_at,
       (pl.turbine_code IS NOT NULL) AS locked
FROM turbines t
LEFT JOIN done_peaks dp ON dp.turbine_code = t.turbine_code
LEFT JOIN peak_locks pl ON pl.turbine_code = t.turbine_code
ORDER BY t.turbine_code
"""


@app.get("/api/peaks")
@require_login
async def list_peaks(user):
    """峰值锁副本墙：左列机组，右列后台重算的峰值与时刻，及锁定副本。"""

    def query():
        with connect() as conn:
            return conn.execute(PEAKS_SQL).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/peaks/lock")
@require_writer
async def lock_peaks(user):
    """把「那一刻」后台重算出的峰值与时刻写入锁区。

    - 不传 turbine_code：锁定所有「有办结记录且尚未锁定」的机组；
    - 指定 turbine_code：锁定单台，无办结记录报 400，已锁定报 409。
    已锁列通过 ON CONFLICT DO NOTHING 冻结，任何新办结都不再改写。
    """
    body = await request.get_json(force=True, silent=True) or {}
    turbine_code = (body.get("turbine_code") or "").strip() or None
    now = datetime.now(timezone.utc)

    def do_lock():
        with connect() as conn:
            if turbine_code is not None:
                exists = conn.execute(
                    "SELECT 1 FROM peak_locks WHERE turbine_code = %s",
                    (turbine_code,),
                ).fetchone()
                if exists is not None:
                    return 409, {"detail": f"机组 {turbine_code} 已锁定，锁区数字不再改变"}
                row = conn.execute(
                    """INSERT INTO peak_locks
                           (turbine_code, peak_deg, peak_at, locked_by, locked_at)
                       SELECT turbine_code, peak_deg, peak_at, %s, %s
                       FROM (
                           SELECT DISTINCT ON (turbine_code)
                                  turbine_code,
                                  abs(yaw_err_deg) AS peak_deg,
                                  processed_at AS peak_at
                           FROM yaw_logs
                           WHERE status = 'done' AND turbine_code = %s
                           ORDER BY turbine_code, abs(yaw_err_deg) DESC, id DESC
                       ) dp
                       ON CONFLICT (turbine_code) DO NOTHING
                       RETURNING turbine_code""",
                    (user["username"], now, turbine_code),
                ).fetchone()
                if row is None:
                    conn.rollback()
                    return 400, {"detail": f"机组 {turbine_code} 暂无办结记录，不能锁定峰值"}
                conn.commit()
                return 200, {"locked": [row["turbine_code"]]}

            inserted = conn.execute(
                """INSERT INTO peak_locks
                       (turbine_code, peak_deg, peak_at, locked_by, locked_at)
                   SELECT DISTINCT ON (l.turbine_code)
                          l.turbine_code,
                          abs(l.yaw_err_deg),
                          l.processed_at,
                          %s, %s
                   FROM yaw_logs l
                   WHERE l.status = 'done'
                     AND NOT EXISTS (
                         SELECT 1 FROM peak_locks p WHERE p.turbine_code = l.turbine_code
                     )
                   ORDER BY l.turbine_code, abs(l.yaw_err_deg) DESC, l.id DESC
                   ON CONFLICT (turbine_code) DO NOTHING
                   RETURNING turbine_code""",
                (user["username"], now),
            ).fetchall()
            conn.commit()
            return 200, {"locked": [r["turbine_code"] for r in inserted]}

    status, payload = await run_db(do_lock)
    return jsonify(payload), status
