import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import connect, ensure_schema
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
    ensure_schema(conn)
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
            return jsonify({"detail": "仅现场技师可执行此操作"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


# 峰值只允许在后台从办结集合（status='done'）重算：取每台机组 |误差| 最大
# 的一条，峰值时刻即该记录的办结时刻。前端不得自行比大小。
DONE_PEAKS_CTE = """
WITH done_peaks AS (
    SELECT DISTINCT ON (turbine_code)
        turbine_code,
        ABS(yaw_err_deg) AS peak_abs_deg,
        processed_at AS peak_at
    FROM yaw_logs
    WHERE status = 'done'
    ORDER BY turbine_code, ABS(yaw_err_deg) DESC, processed_at ASC, id ASC
)
"""

# 峰值墙：左列机组，右列未锁峰值与已锁副本。没有办结记录的机组峰值列为 NULL，
# 由前端显示「—」，不得虚填。
PEAK_WALL_SQL = (
    DONE_PEAKS_CTE
    + """
SELECT t.turbine_code,
       dp.peak_abs_deg AS live_peak_deg,
       dp.peak_at AS live_peak_at,
       pl.peak_abs_deg AS locked_peak_deg,
       pl.peak_at AS locked_peak_at,
       pl.locked_at AS locked_at,
       pl.locked_by AS locked_by
FROM (SELECT DISTINCT turbine_code FROM yaw_logs) t
LEFT JOIN done_peaks dp ON dp.turbine_code = t.turbine_code
LEFT JOIN peak_locks pl ON pl.turbine_code = t.turbine_code
ORDER BY t.turbine_code
"""
)

# 锁定：把这一刻从办结集合重算出的峰值与时点写入锁区。ON CONFLICT DO NOTHING
# 保证已锁列数字永不再变；之后的新办结只影响未锁列。
LOCK_PEAKS_SQL = (
    DONE_PEAKS_CTE
    + """
INSERT INTO peak_locks (turbine_code, peak_abs_deg, peak_at, locked_at, locked_by)
SELECT turbine_code, peak_abs_deg, peak_at, %s, %s
FROM done_peaks
ON CONFLICT (turbine_code) DO NOTHING
RETURNING turbine_code
"""
)


def fetch_peak_wall():
    with connect() as conn:
        return conn.execute(PEAK_WALL_SQL).fetchall()


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


@app.get("/api/peaks")
@require_login
async def peak_wall(user):
    rows = await run_db(fetch_peak_wall)
    return jsonify({"rows": rows})


@app.post("/api/peaks/lock")
@require_writer
async def lock_peaks(user):
    # 请求体被刻意忽略：峰值只能由后台从办结集合重算，前端不得上送数值。
    now = datetime.now(timezone.utc)

    def lock():
        with connect() as conn:
            inserted = conn.execute(
                LOCK_PEAKS_SQL, (now, user["username"])
            ).fetchall()
            conn.commit()
            return len(inserted)

    newly_locked = await run_db(lock)
    rows = await run_db(fetch_peak_wall)
    return jsonify({"newly_locked": newly_locked, "rows": rows})
