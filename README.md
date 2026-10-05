# 风机偏航对中台

现场技师登记机组编号与偏航误差（度）；后台 worker 用数据库行锁认领待处理记录，按 ±1.5° 阈值写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

另有顶栏「峰值锁副本墙」专页：展示各机组历史峰值及其办结时刻，并可把那一刻的峰值与时刻压成只读锁区副本。

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

登录后顶栏可切到「峰值锁副本墙」专页：左列机组，右列为后台重算的当前峰值与峰值时刻、以及锁定后的只读副本（副本峰值/副本时刻/锁定人/锁定时间），带「刷新（后台重算）」与「锁定」。

规则：

- **峰值只在后台重算**：`GET /api/peaks` 从办结集合（`yaw_logs.status = 'done'`）按 `abs(yaw_err_deg)` 取每机组最大者及其 `processed_at`；前端只展示接口返回，不本地比大小，也没有任何可手改峰值的入口。
- **无办结不虚填**：只有 pending 记录的机组出现在左列，但峰值/时刻返回 `null`，页面显示「—（无办结记录）」。
- **锁定即冻结**：技师 `POST /api/peaks/lock`（可带 `{"turbine_code":"W01"}` 锁单台，或锁全部可锁机组）把那一刻重算的峰值与时刻写入 `peak_locks` 锁区；此后新办结只更新「当前峰值」未锁列，锁区列凭 `ON CONFLICT (turbine_code) DO NOTHING` 永不再变。
- **角色**：现场技师（writer）可见锁定按钮；观察岗（reader）只能查看，锁定请求由后端 403 拒绝。单台锁定：已锁定返回 409，无办结记录返回 400。

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论。
3. observer 可查看列表与峰值墙，无提交表单、无任何锁定按钮。
4. 峰值墙：W01/W07 显示后台重算的峰值与时刻；提交一台仅有待处理记录的新机组，峰值墙显示「—（无办结记录）」，worker 办结后经刷新/轮询出现峰值。
5. technician 锁定后，锁区副本出现且数字固定；再为该机组提交更大误差并办结，当前峰值更新而锁区副本保持锁定那一刻的值；重复锁定不覆盖已锁列。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
