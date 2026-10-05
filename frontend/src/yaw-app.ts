import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

type LogRow = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  status: string;
  verdict: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  processed_at: string | null;
};

type PeakRow = {
  turbine_code: string;
  peak_deg: number | null;
  peak_at: string | null;
  locked_peak_deg: number | null;
  locked_peak_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  locked: boolean;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

type Page = "logs" | "peaks";

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 1.5rem;
      max-width: 960px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.75rem;
      color: #38bdf8;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1.5rem;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    label {
      display: block;
      font-size: 0.85rem;
      color: #cbd5e1;
      margin-bottom: 0.25rem;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
    }
    button {
      cursor: pointer;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #fff;
      font-weight: 600;
    }
    button.secondary {
      background: #475569;
    }
    button.tab {
      background: transparent;
      color: #94a3b8;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      padding: 0.6rem 1rem;
    }
    button.tab.active {
      color: #38bdf8;
      border-bottom-color: #38bdf8;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid #334155;
      vertical-align: top;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }
    .ok {
      background: #14532d;
      color: #86efac;
    }
    .bad {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .pending {
      background: #713f12;
      color: #fde68a;
    }
    .frozen {
      background: #1e3a5f;
      color: #bae6fd;
    }
    .empty {
      color: #64748b;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-bottom: 1rem;
      border-bottom: 1px solid #334155;
    }
    .tabs {
      display: flex;
      gap: 0.25rem;
    }
    .topbar-right {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      padding-bottom: 0.5rem;
      font-size: 0.85rem;
      color: #94a3b8;
    }
    .locked-col {
      background: rgba(30, 58, 95, 0.35);
    }
    .note {
      font-size: 0.8rem;
      color: #94a3b8;
      margin: 0.3rem 0 0;
    }
  `;

  @state() private session: Session | null = null;
  @state() private page: Page = "logs";
  @state() private logs: LogRow[] = [];
  @state() private peaks: PeakRow[] = [];
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private peakError = "";
  @state() private loading = false;

  private _pollTimer?: number;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.refreshAll();
        this._pollTimer = window.setInterval(() => void this.refreshAll(), 2000);
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
    }
  }

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  // 峰值墙数据只能整体来自后台接口；前端不持有任何可编辑峰值的输入框，
  // 也不在本地对记录做 max 比较。
  private async refreshAll() {
    if (!this.session) return;
    await Promise.all([this.refreshLogs(), this.refreshPeaks()]);
  }

  private async refreshLogs() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/logs", { headers: this.authHeaders() });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.logs = (await res.json()) as LogRow[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async refreshPeaks() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/peaks", { headers: this.authHeaders() });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.peaks = (await res.json()) as PeakRow[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async login() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.loginUser,
          password: this.loginPass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "登录失败";
        return;
      }
      this.session = {
        token: data.access_token,
        username: data.username,
        role: data.role,
      };
      localStorage.setItem("yaw_session", JSON.stringify(this.session));
      await this.refreshAll();
      this._pollTimer = window.setInterval(() => void this.refreshAll(), 2000);
    } catch {
      this.error = "无法连接接口";
    } finally {
      this.loading = false;
    }
  }

  private logout() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this.session = null;
    this.logs = [];
    this.peaks = [];
    this.page = "logs";
    localStorage.removeItem("yaw_session");
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private goto(page: Page) {
    this.page = page;
    this.peakError = "";
    void this.refreshAll();
  }

  private async submitLog() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          turbine_code: this.turbineCode,
          yaw_err_deg: Number(this.yawErr),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "提交失败";
        return;
      }
      this.turbineCode = "";
      this.yawErr = "";
      await this.refreshAll();
    } catch {
      this.error = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  // 锁定：把后台那一刻重算的峰值/时刻复制进锁区。已锁列由后端
  // ON CONFLICT DO NOTHING 保证永不再变；前端只发指令、不拼数字。
  private async lockPeaks(turbineCode?: string) {
    this.peakError = "";
    this.loading = true;
    try {
      const res = await fetch("/api/peaks/lock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(turbineCode ? { turbine_code: turbineCode } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        this.peakError = data.detail || "锁定失败";
        return;
      }
      await this.refreshPeaks();
    } catch {
      this.peakError = "锁定时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private verdictClass(row: LogRow) {
    if (row.status === "pending") return "pending";
    if (row.verdict === "合格") return "ok";
    if (row.verdict === "偏航超差") return "bad";
    return "";
  }

  private fmtTime(value: string | null): string {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
      d.getHours()
    )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  private renderTopbar() {
    return html`
      <div class="topbar">
        <div class="tabs">
          <button
            class="tab ${this.page === "logs" ? "active" : ""}"
            @click=${() => this.goto("logs")}
          >
            对中记录
          </button>
          <button
            class="tab ${this.page === "peaks" ? "active" : ""}"
            @click=${() => this.goto("peaks")}
          >
            峰值锁副本墙
          </button>
        </div>
        <div class="topbar-right">
          <span
            >${this.session!.username}（${this.isWriter ? "现场技师" : "观察岗 · 只读"}）</span
          >
          <button class="secondary" @click=${this.logout}>退出</button>
        </div>
      </div>
    `;
  }

  private renderPeakWall() {
    const lockable = this.peaks.some((p) => !p.locked && p.peak_deg !== null);
    return html`
      <section>
        <div class="row-actions">
          <button class="secondary" ?disabled=${this.loading} @click=${this.refreshPeaks}>
            刷新（后台重算）
          </button>
          ${this.isWriter
            ? html`
                <button
                  ?disabled=${this.loading || !lockable}
                  @click=${() => this.lockPeaks()}
                  title="把此刻各机组的峰值与时刻写入锁区；已锁列不再改变"
                >
                  锁定全部可锁机组
                </button>
              `
            : html`<span class="tag frozen">观察岗仅可查看，锁定按钮不可用</span>`}
        </div>
        <p class="note">
          峰值由后台从办结集合重算，前端只展示；尚无办结记录的机组峰值留空。锁定后右侧副本永久冻结，后续新办结只更新未锁列。
        </p>
        ${this.peakError ? html`<p class="err">${this.peakError}</p>` : null}
      </section>

      <section>
        <h2 style="margin-top:0;font-size:1.1rem;">峰值锁副本墙</h2>
        <table>
          <thead>
            <tr>
              <th>机组</th>
              <th>当前峰值（°）</th>
              <th>峰值时刻</th>
              <th class="locked-col">锁区副本峰值（°）</th>
              <th class="locked-col">副本时刻</th>
              <th class="locked-col">锁定状态</th>
              ${this.isWriter ? html`<th></th>` : null}
            </tr>
          </thead>
          <tbody>
            ${this.peaks.length === 0
              ? html`<tr>
                  <td colspan="7" class="empty">暂无任何机组记录</td>
                </tr>`
              : this.peaks.map(
                  (p) => html`
                    <tr>
                      <td>${p.turbine_code}</td>
                      <td>
                        ${p.peak_deg === null
                          ? html`<span class="empty">—（无办结记录）</span>`
                          : p.peak_deg}
                      </td>
                      <td>${p.peak_at ? this.fmtTime(p.peak_at) : html`<span class="empty">—</span>`}</td>
                      <td class="locked-col">
                        ${p.locked
                          ? html`<strong>${p.locked_peak_deg}</strong>`
                          : html`<span class="empty">未锁定</span>`}
                      </td>
                      <td class="locked-col">
                        ${p.locked
                          ? this.fmtTime(p.locked_peak_at)
                          : html`<span class="empty">—</span>`}
                      </td>
                      <td class="locked-col">
                        ${p.locked
                          ? html`<span class="tag frozen"
                              >已锁定 · ${p.locked_by} · ${this.fmtTime(p.locked_at)}</span
                            >`
                          : html`<span class="tag pending">未锁定（随新办结刷新）</span>`}
                      </td>
                      ${this.isWriter
                        ? html`<td>
                            ${!p.locked && p.peak_deg !== null
                              ? html`<button
                                  class="secondary"
                                  ?disabled=${this.loading}
                                  @click=${() => this.lockPeaks(p.turbine_code)}
                                >
                                  锁
                                </button>`
                              : null}
                          </td>`
                        : null}
                    </tr>
                  `
                )}
          </tbody>
        </table>
      </section>
    `;
  }

  render() {
    if (!this.session) {
      return html`
        <h1>风机偏航对中台</h1>
        <p class="sub">现场技师提交偏航误差，后台 worker 认领后给出合格或偏航超差结论。</p>
        <section>
          <label>用户名</label>
          <input
            .value=${this.loginUser}
            @input=${(e: Event) =>
              (this.loginUser = (e.target as HTMLInputElement).value)}
          />
          <label>密码</label>
          <input
            type="password"
            .value=${this.loginPass}
            @input=${(e: Event) =>
              (this.loginPass = (e.target as HTMLInputElement).value)}
          />
          <button ?disabled=${this.loading} @click=${this.login}>登录</button>
          ${this.error ? html`<p class="err">${this.error}</p>` : null}
        </section>
      `;
    }

    return html`
      <h1>风机偏航对中台</h1>
      ${this.renderTopbar()}

      ${this.page === "peaks"
        ? this.renderPeakWall()
        : html`
            ${this.isWriter
              ? html`
                  <section>
                    <h2 style="margin-top:0;font-size:1.1rem;">提交偏航记录</h2>
                    <label>机组编号</label>
                    <input
                      placeholder="例如 W12"
                      .value=${this.turbineCode}
                      @input=${(e: Event) =>
                        (this.turbineCode = (e.target as HTMLInputElement).value)}
                    />
                    <label>偏航误差（度，可正可负）</label>
                    <input
                      type="number"
                      step="0.1"
                      .value=${this.yawErr}
                      @input=${(e: Event) =>
                        (this.yawErr = (e.target as HTMLInputElement).value)}
                    />
                    <button ?disabled=${this.loading} @click=${this.submitLog}>
                      提交（进入待认领队列）
                    </button>
                    ${this.error ? html`<p class="err">${this.error}</p>` : null}
                  </section>
                `
              : null}

            <section>
              <div class="row-actions" style="margin-bottom:0.6rem;">
                <button class="secondary" ?disabled=${this.loading} @click=${this.refreshLogs}>
                  刷新列表
                </button>
              </div>
              <h2 style="margin-top:0;font-size:1.1rem;">对中记录</h2>
              <table>
                <thead>
                  <tr>
                    <th>编号</th>
                    <th>机组</th>
                    <th>误差°</th>
                    <th>状态</th>
                    <th>结论</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.logs.map(
                    (row) => html`
                      <tr>
                        <td>${row.id}</td>
                        <td>${row.turbine_code}</td>
                        <td>${row.yaw_err_deg}</td>
                        <td>
                          <span
                            class="tag ${row.status === "pending" ? "pending" : "ok"}"
                          >
                            ${row.status === "pending" ? "待处理" : "已完成"}
                          </span>
                        </td>
                        <td>
                          ${row.verdict
                            ? html`<span class="tag ${this.verdictClass(row)}"
                                >${row.verdict}</span
                              >`
                            : "—"}
                        </td>
                        <td>${row.reason ?? "—"}</td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            </section>
          `}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
