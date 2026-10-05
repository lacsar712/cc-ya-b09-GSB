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
  live_peak_deg: number | null;
  live_peak_at: string | null;
  locked_peak_deg: number | null;
  locked_peak_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

type View = "logs" | "peaks";

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
      margin: 0 0 0.75rem;
      font-size: 1.75rem;
      color: #38bdf8;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1.5rem;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 0.6rem 0.9rem;
      margin-bottom: 1rem;
    }
    .nav-left,
    .nav-right {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .navbtn {
      background: transparent;
      color: #cbd5e1;
      border: 1px solid #475569;
    }
    .navbtn.active {
      background: #0284c7;
      border-color: #0284c7;
      color: #fff;
    }
    .userinfo {
      color: #94a3b8;
      font-size: 0.85rem;
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
    .locked {
      background: #1e3a8a;
      color: #bfdbfe;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .okmsg {
      color: #4ade80;
      margin-top: 0.5rem;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.85rem;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .spread {
      justify-content: space-between;
    }
  `;

  @state() private session: Session | null = null;
  @state() private view: View = "logs";
  @state() private logs: LogRow[] = [];
  @state() private peaks: PeakRow[] = [];
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private lockMessage = "";
  @state() private loading = false;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.refreshCurrent();
        this._pollTimer = window.setInterval(
          () => void this.refreshCurrent(),
          2000,
        );
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

  private _pollTimer?: number;

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private refreshCurrent() {
    return this.view === "peaks" ? this.refreshPeaks() : this.refreshLogs();
  }

  private switchView(view: View) {
    if (this.view === view) return;
    this.view = view;
    this.error = "";
    this.lockMessage = "";
    void this.refreshCurrent();
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
      const data = await res.json();
      this.peaks = data.rows as PeakRow[];
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
      this.view = "logs";
      localStorage.setItem("yaw_session", JSON.stringify(this.session));
      await this.refreshCurrent();
      this._pollTimer = window.setInterval(
        () => void this.refreshCurrent(),
        2000,
      );
    } catch {
      this.error = "无法连接接口";
    } finally {
      this.loading = false;
    }
  }

  private logout() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this.session = null;
    this.view = "logs";
    this.logs = [];
    this.peaks = [];
    this.lockMessage = "";
    localStorage.removeItem("yaw_session");
  }

  private get isWriter() {
    return this.session?.role === "writer";
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
      await this.refreshLogs();
    } catch {
      this.error = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  // 锁定只发动作、不上送任何峰值数值：峰值由后台从办结集合重算后写入锁区。
  private async lockPeaks() {
    this.error = "";
    this.lockMessage = "";
    this.loading = true;
    try {
      const res = await fetch("/api/peaks/lock", {
        method: "POST",
        headers: this.authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "锁定失败";
        return;
      }
      this.peaks = data.rows as PeakRow[];
      this.lockMessage =
        data.newly_locked > 0
          ? `已把当前峰值压成只读副本：新锁定 ${data.newly_locked} 台机组`
          : "已锁副本保持不变（无新机组可锁）";
    } catch {
      this.error = "锁定时网络异常";
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

  private fmtTime(value: string | null) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? value
      : d.toLocaleString("zh-CN", { hour12: false });
  }

  private fmtPeak(value: number | null) {
    return value === null ? "—" : `${value}°`;
  }

  private renderLogs() {
    return html`
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
        <div class="row-actions spread">
          <h2 style="margin:0;font-size:1.1rem;">对中记录</h2>
          <button
            class="secondary"
            ?disabled=${this.loading}
            @click=${this.refreshLogs}
          >
            刷新列表
          </button>
        </div>
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
                      class="tag ${row.status === "pending"
                        ? "pending"
                        : "ok"}"
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
              `,
            )}
          </tbody>
        </table>
      </section>
    `;
  }

  private renderPeaks() {
    return html`
      <section>
        <div class="row-actions spread">
          <h2 style="margin:0;font-size:1.1rem;">峰值锁副本墙</h2>
          <div class="row-actions">
            <button
              class="secondary"
              ?disabled=${this.loading}
              @click=${this.refreshPeaks}
            >
              刷新
            </button>
            ${this.isWriter
              ? html`<button ?disabled=${this.loading} @click=${this.lockPeaks}>
                  锁定当前峰值
                </button>`
              : null}
          </div>
        </div>
        <p class="hint">
          峰值由后台从办结记录实时重算，本页只展示、不改数；锁定把那一刻的峰值与时点压成只读副本，
          之后的新办结只更新未锁列，已锁列永不再变。
        </p>
        ${this.lockMessage
          ? html`<p class="okmsg">${this.lockMessage}</p>`
          : null}
        ${this.error ? html`<p class="err">${this.error}</p>` : null}
        <table>
          <thead>
            <tr>
              <th>机组</th>
              <th>当前峰值（未锁）</th>
              <th>峰值时刻</th>
              <th>锁定副本峰值</th>
              <th>锁定峰值时刻</th>
              <th>锁定于 / 操作人</th>
            </tr>
          </thead>
          <tbody>
            ${this.peaks.map(
              (row) => html`
                <tr>
                  <td>${row.turbine_code}</td>
                  <td>${this.fmtPeak(row.live_peak_deg)}</td>
                  <td>${this.fmtTime(row.live_peak_at)}</td>
                  <td>
                    ${row.locked_peak_deg === null
                      ? "—"
                      : html`<span class="tag locked"
                          >${this.fmtPeak(row.locked_peak_deg)}</span
                        >`}
                  </td>
                  <td>${this.fmtTime(row.locked_peak_at)}</td>
                  <td>
                    ${row.locked_at
                      ? html`${this.fmtTime(row.locked_at)} / ${row.locked_by}`
                      : "—"}
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
        ${this.peaks.length === 0
          ? html`<p class="hint">暂无机组记录</p>`
          : null}
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
      <nav class="topbar">
        <div class="nav-left">
          <button
            class="navbtn ${this.view === "logs" ? "active" : ""}"
            @click=${() => this.switchView("logs")}
          >
            对中记录
          </button>
          <button
            class="navbtn ${this.view === "peaks" ? "active" : ""}"
            @click=${() => this.switchView("peaks")}
          >
            峰值锁副本墙
          </button>
        </div>
        <div class="nav-right">
          <span class="userinfo">
            ${this.session.username}
            (${this.isWriter ? "技师·可提交可锁定" : "观察岗·只读"})
          </span>
          <button class="secondary" @click=${this.logout}>退出</button>
        </div>
      </nav>
      ${this.view === "logs" ? this.renderLogs() : this.renderPeaks()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
