# 风机偏航对中台

现场技师登记机组编号与偏航误差（度）；后台 worker 用数据库行锁认领待处理记录，按 ±1.5° 阈值写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交 |
| observer | obs123456 | 只读 |

## 启动

```bash
cd projects/20-yaw-align-log
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 峰值锁副本墙

顶栏「峰值锁副本墙」专页：左列机组，右列当前峰值（未锁列）与锁定副本（已锁列）及各自时刻，带「刷新」与「锁定当前峰值」按钮。

- 峰值一律由后台从办结集合（`status='done'`）重算：取每台机组 `|误差|` 最大的一条，峰值时刻即该记录的办结时刻；前端只展示接口结果，绝不自行比大小或手改数值。
- 没有办结记录的机组峰值列显示「—」，不虚填。
- 「锁定当前峰值」（仅技师）把那一刻各机组的峰值与时点写入锁区（`peak_locks` 表），压成只读副本；之后的新办结只更新未锁列，已锁列数字永不再变（重复锁定不会覆盖，`ON CONFLICT DO NOTHING`）。
- 观察岗可查看与刷新专页，但无锁定按钮；直接 `POST /api/peaks/lock` 返回 403。

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论。
3. observer 可查看列表，无提交表单。
4. technician 打开峰值墙：W01 当前峰值 0.4°、W07 3.2°；点「锁定当前峰值」后已锁列出现相同数字与时点。
5. 再提交 W07 误差 -4.0°，worker 办结后刷新峰值墙：未锁列变为 4.0°，已锁列仍是 3.2°。
6. 提交新机组 W12 但未办结前，峰值墙中 W12 的峰值列为「—」。
7. observer 登录可见峰值墙与刷新按钮，但无锁定按钮。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
