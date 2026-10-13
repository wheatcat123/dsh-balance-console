/**
 * Client half of the balance console.
 *
 * Renders console-style floating windows in the frame-wide overlay layer, so
 * they are independent of the composer, of the session panel and of any
 * selected conversation: the balance console, the settings window and every
 * consumption receipt share one window shell that moves, resizes and minimizes.
 *
 * Balance data, the budget, the bill ledger, the pricing rules and the stored
 * API key live in the Host half and arrive over its authenticated route, which
 * also classifies a failure as a refused key or a transport problem so each
 * window can explain it.
 *
 * @module dsh-balance-console/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-balance-console',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Host route owning the balance console state. */
    const ENDPOINT = '/api/balance-console/state';

    /** Frame geometry and view mode survive a reload, per window. */
    const LAYOUT_PREFIX = 'dsh-balance-console:layout:';

    /** The sidebar switch's state survives a reload. */
    const ENABLED_KEY = 'dsh-balance-console:enabled';

    /** Providers the console belongs to; any other provider hides it. */
    const DEEPSEEK_PROVIDER_PATTERN = /deepseek/i;

    /** Monospace stack; the console look must not depend on an optional theme token. */
    const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Cascadia Mono', 'Courier New', monospace";

    /** Free budget is this exact grey in both themes, as specified. */
    const FREE_GREY = 'rgb(162, 162, 162)';

    /** Granted credit reads cyan and always sits right of the topped-up share. */
    const GRANTED_CYAN = 'rgb(43, 234, 178)';

    /** The refused-key and offline accents. */
    const BLUE = 'rgb(78, 149, 255)';

    /** The console's own green for spendable balance. */
    const GREEN = 'var(--dsw-alias-state-success-primary)';

    /** Overrun past the budget reads as a white shield over the bar. */
    const OVERRUN_WHITE = 'var(--dsw-alias-label-primary)';

    const RED = 'var(--dsw-alias-state-error-primary)';

    /** Minimized chip edge, in pixels. */
    const CHIP_SIZE = 56;

    /** First-run placement: centred, just above the composer, then remembered. */
    const DEFAULT_Y_RATIO = 0.68;

    /** Cadence of the busy block's blink, in milliseconds. */
    const BLINK_MS = 480;

    /** Pointer travel under this counts as a click, not a drag. */
    const DRAG_SLOP = 4;

    /** Smallest frame that still shows one console line plus the control row. */
    const MIN_WIDTH = 230;
    const MIN_HEIGHT = 62;

    /** Half-hour slots in one billing day. */
    const SLOTS = 48;

    /** Window identities; each owns its own frame geometry. */
    const WINDOW_CONSOLE = 'console';
    const WINDOW_SETTINGS = 'settings';
    const WINDOW_RECEIPT = 'receipt';

    /** Default geometry per window, before the user moves it. */
    const DEFAULT_LAYOUTS = {
      [WINDOW_CONSOLE]: { x: null, y: null, width: 470, height: 116, minimized: false },
      [WINDOW_SETTINGS]: { x: null, y: null, width: 580, height: 360, minimized: false },
      [WINDOW_RECEIPT]: { x: null, y: null, width: 580, height: 440, minimized: false },
    };

    const CSS = `
.__dshbc_frame{position:fixed;z-index:40;display:flex;flex-direction:column;pointer-events:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1);box-shadow:0 10px 30px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);font-family:${MONO};font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow:hidden}
.__dshbc_frame[data-min='1']{width:${CHIP_SIZE}px;height:${CHIP_SIZE}px;border-radius:6px;cursor:grab}
.__dshbc_frame[data-dragging='1'],.__dshbc_frame[data-resizing='1']{user-select:none}
.__dshbc_frame[data-dragging='1']{cursor:grabbing}
.__dshbc_titlebar{display:flex;align-items:center;gap:6px;flex:none;padding:3px 6px 3px 8px;cursor:grab;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);touch-action:none}
.__dshbc_frame[data-min='1'] .__dshbc_titlebar{display:none}
.__dshbc_dot{flex:none;width:5px;height:5px;border-radius:50%;background:${GREEN}}
.__dshbc_title{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.02em}
.__dshbc_btn{flex:none;display:grid;place-items:center;width:17px;height:17px;padding:0;border:none;border-radius:3px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.__dshbc_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.__dshbc_btn:disabled{cursor:default;opacity:.45}
.__dshbc_btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.__dshbc_body{flex:1 1 auto;min-height:0;overflow:auto;padding:5px 9px;display:flex;flex-direction:column;gap:4px}
.__dshbc_frame[data-min='1'] .__dshbc_body{display:none}
.__dshbc_row{display:flex;align-items:center;gap:8px;min-width:0;flex:none}
.__dshbc_col{display:flex;flex-direction:column;gap:3px;min-width:0}
.__dshbc_prompt{flex:none;width:1ch;display:inline-flex;align-items:center;justify-content:center}
.__dshbc_token{display:inline-block;line-height:1;font-size:1.05em}
.__dshbc_indicator{display:inline-block;width:100%;height:.86em;background:currentColor}
.__dshbc_indicator[data-off='1']{background:transparent}
.__dshbc_path{flex:none;color:var(--dsw-alias-label-tertiary)}
.__dshbc_badge{flex:none;display:inline-block;border-radius:2px;padding:0 4px;line-height:1.45;font-weight:600}
.__dshbc_badge[data-color='green']{color:${GREEN}}
.__dshbc_badge[data-color='red']{color:${RED}}
.__dshbc_badge[data-color='blue']{color:${BLUE}}
.__dshbc_caret{flex:none;color:${GREEN};animation:__dshbc_blink 1.05s step-end infinite}
@keyframes __dshbc_blink{0%,100%{opacity:1}50%{opacity:0}}
.__dshbc_amount{flex:none;font-weight:600;color:${GREEN}}
.__dshbc_amount[data-color='red']{color:${RED}}
.__dshbc_amount[data-color='blue']{color:${BLUE}}
.__dshbc_bar{flex:1 1 auto;min-width:6px;height:5px;position:relative;overflow:hidden;background:${FREE_GREY}}
.__dshbc_bar[data-scan='1']{background:linear-gradient(90deg, color-mix(in srgb, ${RED} 22%, transparent), ${RED}, color-mix(in srgb, ${RED} 22%, transparent));background-size:45% 100%;background-repeat:no-repeat;animation:__dshbc_scan 1.25s linear infinite}
@keyframes __dshbc_scan{0%{background-position:-45% 0}100%{background-position:100% 0}}
.__dshbc_bar[data-flat='2']{background:${BLUE}}
.__dshbc_fill{position:absolute;left:0;top:0;bottom:0;background:${GREEN};transition:width .45s ease}
.__dshbc_fill[data-flat='2']{background:${BLUE}}
.__dshbc_grant{position:absolute;top:0;bottom:0;background:${GRANTED_CYAN};transition:width .45s ease}
.__dshbc_spill{position:absolute;right:0;top:0;bottom:0;background:${OVERRUN_WHITE};transition:width .45s ease}
.__dshbc_tail{flex:none;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.__dshbc_out{margin:0;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary)}
.__dshbc_out[data-error='1']{color:${RED}}
.__dshbc_log{display:flex;flex-direction:column;gap:1px;margin-top:2px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:3px}
.__dshbc_logrow{display:flex;align-items:baseline;gap:0;min-width:0;white-space:pre;font-variant-numeric:tabular-nums}
.__dshbc_loghash{flex:none;color:var(--dsw-alias-label-tertiary)}
.__dshbc_loghash[data-sign='up']{color:${GREEN}}
.__dshbc_loghash[data-sign='down']{color:${RED}}
.__dshbc_loghash[data-sign='error']{color:${RED}}
.__dshbc_loghash[data-sign='info']{color:${BLUE}}
.__dshbc_logmid{flex:none;color:var(--dsw-alias-label-secondary)}
.__dshbc_logamt[data-sign='up']{color:${GREEN}}
.__dshbc_logamt[data-sign='down']{color:${RED}}
.__dshbc_logfill{flex:1 1 auto;min-width:8px;overflow:hidden;color:${FREE_GREY}}
.__dshbc_lognote{flex:none;color:var(--dsw-alias-label-secondary)}
.__dshbc_lognote[data-sign='error']{color:${RED}}
.__dshbc_lognote[data-sign='info']{color:${BLUE}}
.__dshbc_logdate{flex:none;color:var(--dsw-alias-label-tertiary)}
.__dshbc_form{display:flex;align-items:center;gap:6px;min-width:0}
.__dshbc_input{min-width:0;flex:1 1 auto;border:1px solid var(--dsw-alias-border-l1);border-radius:4px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:11.5px;padding:2px 6px;outline:none}
.__dshbc_input:focus{border-color:var(--dsw-alias-state-business-primary)}
.__dshbc_input::placeholder{color:var(--dsw-alias-label-tertiary)}
.__dshbc_num{width:52px;flex:none;text-align:right}
.__dshbc_budget{width:76px;flex:none;text-align:right}
.__dshbc_price{width:78px;flex:none;text-align:right}
.__dshbc_name{width:130px;flex:none}
.__dshbc_label{flex:none;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.__dshbc_action{flex:none;border:1px solid var(--dsw-alias-border-l1);border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11.5px;padding:2px 8px;cursor:pointer}
.__dshbc_action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.__dshbc_action:disabled{cursor:default;opacity:.45}
.__dshbc_action[data-primary='1']{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary)}
.__dshbc_action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.__dshbc_chip{display:none;width:100%;height:100%;place-items:center;cursor:inherit;background:transparent;border:none;color:${GREEN};font-family:inherit;font-size:15px;font-weight:600;padding:0;overflow:hidden;pointer-events:none}
.__dshbc_frame[data-min='1'] .__dshbc_chip{display:grid}
.__dshbc_chip[data-color='red']{color:${RED}}
.__dshbc_chip[data-color='blue']{color:${BLUE}}
.__dshbc_chip[data-color='grey']{color:${FREE_GREY}}
.__dshbc_grip{position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 45%,var(--dsw-alias-border-l2) 45%,var(--dsw-alias-border-l2) 55%,transparent 55%,transparent 70%,var(--dsw-alias-border-l2) 70%,var(--dsw-alias-border-l2) 80%,transparent 80%)}
.__dshbc_frame[data-min='1'] .__dshbc_grip{display:none}
.__dshbc_switch{display:flex;align-items:center;gap:6px;width:100%;min-width:0;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font-family:Inter, var(--dsw-font-family);font-size:11px;line-height:16px;padding:4px 8px;border-radius:var(--dsw-radius-sm,8px);cursor:pointer}
.__dshbc_switch:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.__dshbc_switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.__dshbc_switch[data-narrow='1']{justify-content:center;padding:4px 0}
.__dshbc_switchDot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.__dshbc_switch[data-on='1'] .__dshbc_switchDot{background:${GREEN}}
.__dshbc_switchText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.__dshbc_section{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);border-top:1px solid var(--dsw-alias-border-l1);padding-top:4px;margin-top:2px}
.__dshbc_grid{display:flex;gap:1px;flex:none;width:100%;height:15px;touch-action:none;cursor:crosshair}
.__dshbc_cell{flex:1 1 0;min-width:0;background:var(--dsw-alias-bg-layer-2);border:none;padding:0;cursor:inherit}
.__dshbc_cell[data-peak='1']{background:${GREEN}}
.__dshbc_axis{display:flex;justify-content:space-between;color:var(--dsw-alias-label-tertiary);flex:none}
`;

    /* ------------------------------------------------------------------ *
     * Shared helpers
     * ------------------------------------------------------------------ */

    /**
     * @param props - SVG path geometry.
     * @returns a small monochrome icon.
     */
    function Glyph(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 11,
          height: 11,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: props.d }),
      );
    }

    /**
     * Send one request to the Host route.
     * @param payload - JSON request body.
     * @returns the response value.
     * @throws Error carrying the Host's refusal reason.
     */
    async function ask(payload) {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload === undefined ? {} : payload),
      });
      if (!response.ok) throw new Error(`balance console route returned HTTP ${String(response.status)}`);
      const body = await response.json();
      if (body === null || typeof body !== 'object') throw new Error('balance console route returned a non-object body');
      if (body.ok !== true) throw new Error(typeof body.error === 'string' ? body.error : 'balance console request failed');
      return body.value;
    }

    /**
     * @param windowId - which window's geometry to read.
     * @returns stored geometry, with defaults and sane bounds applied.
     */
    function loadLayout(windowId) {
      const fallback = { ...(DEFAULT_LAYOUTS[windowId] || DEFAULT_LAYOUTS[WINDOW_CONSOLE]) };
      try {
        const raw = window.localStorage.getItem(LAYOUT_PREFIX + windowId);
        if (raw === null) return fallback;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return fallback;
        const optional = (value) =>
          value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null;
        const number = (value, fallbackValue) =>
          value === null || value === undefined
            ? fallbackValue
            : Number.isFinite(Number(value))
              ? Number(value)
              : fallbackValue;
        return {
          x: optional(parsed.x),
          y: optional(parsed.y),
          width: Math.max(MIN_WIDTH, number(parsed.width, fallback.width)),
          height: Math.max(MIN_HEIGHT, number(parsed.height, fallback.height)),
          minimized: parsed.minimized === true,
        };
      } catch {
        return fallback;
      }
    }

    /**
     * @param windowId - which window's geometry to store.
     * @param layout - geometry to store.
     */
    function saveLayout(windowId, layout) {
      try {
        window.localStorage.setItem(LAYOUT_PREFIX + windowId, JSON.stringify(layout));
      } catch {
        /* A private-mode storage refusal must not break the window. */
      }
    }

    /**
     * Keep a frame on screen without changing its size.
     * @param layout - candidate geometry.
     * @returns geometry whose frame is fully inside the viewport.
     */
    function clampToViewport(layout) {
      const width = layout.minimized ? CHIP_SIZE : layout.width;
      const height = layout.minimized ? CHIP_SIZE : layout.height;
      const maxX = Math.max(4, window.innerWidth - width - 4);
      const maxY = Math.max(4, window.innerHeight - height - 4);
      const x = layout.x === null || layout.x === undefined ? null : Math.min(Math.max(4, Number(layout.x)), maxX);
      const yValue = layout.y === null || layout.y === undefined ? window.innerHeight * DEFAULT_Y_RATIO : Number(layout.y);
      const y = Math.min(Math.max(4, Number.isFinite(yValue) ? yValue : window.innerHeight * DEFAULT_Y_RATIO), maxY);
      return { ...layout, x, y };
    }

    /**
     * @returns whether the console is switched on; on unless explicitly off.
     */
    function loadEnabled() {
      try {
        return window.localStorage.getItem(ENABLED_KEY) !== 'off';
      } catch {
        return true;
      }
    }

    /**
     * @param enabled - whether the console should render.
     */
    function saveEnabled(enabled) {
      try {
        window.localStorage.setItem(ENABLED_KEY, enabled ? 'on' : 'off');
      } catch {
        /* A private-mode storage refusal must not break the console. */
      }
    }

    /** One shared switch state, so the sidebar control and the console agree. */
    const enabledState = {
      value: loadEnabled(),
      listeners: new Set(),
      /**
       * @param next - new switch state.
       */
      set(next) {
        enabledState.value = next;
        saveEnabled(next);
        for (const listener of enabledState.listeners) listener();
      },
      /**
       * @param listener - called on every switch change.
       * @returns unsubscriber.
       */
      subscribe(listener) {
        enabledState.listeners.add(listener);
        return () => {
          enabledState.listeners.delete(listener);
        };
      },
    };

    /**
     * React binding for the shared switch state.
     * @returns the current switch state.
     */
    function useEnabled() {
      const [enabled, setLocal] = React.useState(enabledState.value);
      React.useEffect(() => enabledState.subscribe(() => setLocal(enabledState.value)), []);
      return enabled;
    }

    /** Window registry: which windows are open, and which one is on top. */
    const windowStack = {
      order: [],
      listeners: new Set(),
      /**
       * @param id - window brought to the front.
       */
      focus(id) {
        windowStack.order = [...windowStack.order.filter((entry) => entry !== id), id];
        for (const listener of windowStack.listeners) listener();
      },
      /**
       * @param listener - called when the stacking order changes.
       * @returns unsubscriber.
       */
      subscribe(listener) {
        windowStack.listeners.add(listener);
        return () => {
          windowStack.listeners.delete(listener);
        };
      },
      /**
       * @param id - window to test.
       * @returns stacking index used as the frame's z-index.
       */
      depth(id) {
        const index = windowStack.order.indexOf(id);
        return 40 + (index < 0 ? 0 : index);
      },
    };

    /**
     * @param id - window whose depth should re-render on focus changes.
     * @returns the current stacking depth.
     */
    function useWindowDepth(id) {
      const [depth, setDepth] = React.useState(() => windowStack.depth(id));
      React.useEffect(() => windowStack.subscribe(() => setDepth(windowStack.depth(id))), [id]);
      return depth;
    }

    /** Receipts to show: one open receipt at a time, owned by the overlay seat. */
    const receiptState = {
      value: null,
      listeners: new Set(),
      /**
       * @param receipt - receipt payload, or null to close.
       */
      set(receipt) {
        receiptState.value = receipt;
        for (const listener of receiptState.listeners) listener();
      },
      /**
       * @param listener - called on every change.
       * @returns unsubscriber.
       */
      subscribe(listener) {
        receiptState.listeners.add(listener);
        return () => {
          receiptState.listeners.delete(listener);
        };
      },
    };

    /**
     * @returns the receipt currently shown, or null.
     */
    function useReceipt() {
      const [value, setLocal] = React.useState(receiptState.value);
      React.useEffect(() => receiptState.subscribe(() => setLocal(receiptState.value)), []);
      return value;
    }

    /** Settings window visibility, shared so any seat can open it. */
    const settingsState = {
      value: false,
      listeners: new Set(),
      /**
       * @param next - whether the settings window is open.
       */
      set(next) {
        settingsState.value = next;
        for (const listener of settingsState.listeners) listener();
      },
      /**
       * @param listener - called on every change.
       * @returns unsubscriber.
       */
      subscribe(listener) {
        settingsState.listeners.add(listener);
        return () => {
          settingsState.listeners.delete(listener);
        };
      },
    };

    /**
     * @returns whether the settings window is open.
     */
    function useSettingsOpen() {
      const [value, setLocal] = React.useState(settingsState.value);
      React.useEffect(() => settingsState.subscribe(() => setLocal(settingsState.value)), []);
      return value;
    }

    /* ------------------------------------------------------------------ *
     * Pricing helpers — the same arithmetic the Host performs
     * ------------------------------------------------------------------ */

    /**
     * @param value - candidate peak grid.
     * @returns a 48-element boolean array.
     */
    function gridToArray(value) {
      const text = typeof value === 'string' ? value.replace(/[^01]/g, '') : '';
      return Array.from({ length: SLOTS }, (_, index) => text.charAt(index) === '1');
    }

    /**
     * @param cells - 48-element boolean array.
     * @returns the stored `0`/`1` string.
     */
    function gridToString(cells) {
      return cells.map((flag) => (flag ? '1' : '0')).join('');
    }

    /**
     * @returns the caller's day type and billing slot.
     *
     * Weekends bill as holidays and every other local day bills as a workday;
     * statutory holidays are not distinguishable here, so a user who needs them
     * edits the holiday grid instead of relying on this classification.
     */
    function localAnchor() {
      const now = new Date();
      const weekday = now.getDay();
      return {
        dayType: weekday === 0 || weekday === 6 ? 'holiday' : 'workday',
        slot: Math.min(SLOTS - 1, Math.floor((now.getHours() * 60 + now.getMinutes()) / 30)),
      };
    }

    /**
     * @param tier - pricing tier, or undefined.
     * @returns its three prices as numbers.
     */
    function tierPrices(tier) {
      const source = tier !== null && tier !== undefined && typeof tier === 'object' ? tier : {};
      const pick = (value) => {
        const amount = Number(value);
        return Number.isFinite(amount) && amount >= 0 ? amount : 0;
      };
      return { hit: pick(source.hit), miss: pick(source.miss), out: pick(source.out) };
    }

    /**
     * @param usage - `tokenUsage` projection value, or null.
     * @returns the three billing buckets; cache writes bill at the miss price.
     */
    function usageBuckets(usage) {
      const source = usage !== null && usage !== undefined && typeof usage === 'object' ? usage : {};
      const count = (value) => {
        const amount = Number(value);
        return Number.isFinite(amount) && amount > 0 ? amount : 0;
      };
      return {
        hit: count(source.cacheReadTokens),
        miss: count(source.uncachedInputTokens) + count(source.cacheWriteTokens),
        out: count(source.outputTokens),
      };
    }

    /**
     * Price one usage record exactly as the Host would.
     *
     * @param usage - `tokenUsage` value carrying the raw buckets.
     * @param rules - configured pricing rules.
     * @param activeRuleId - selected rule id.
     * @param anchor - `{ dayType, slot }`, or null to use the local calendar.
     * @returns the estimate, or null when no rule is configured.
     */
    function estimateUsage(usage, rules, activeRuleId, anchor) {
      const list = Array.isArray(rules) ? rules : [];
      if (list.length === 0) return null;
      const rule = list.find((entry) => entry.id === activeRuleId) || list[0];
      if (rule === null || rule === undefined) return null;
      const at = anchor === null || anchor === undefined ? localAnchor() : anchor;
      const dayType = at.dayType === 'holiday' ? 'holiday' : 'workday';
      const slot = Math.min(SLOTS - 1, Math.max(0, Math.round(Number(at.slot))));
      const day = rule.dayTypes !== null && rule.dayTypes !== undefined ? rule.dayTypes[dayType] : undefined;
      if (day === null || day === undefined) return null;
      const cells = gridToArray(rule.grid === undefined || rule.grid === null ? '' : rule.grid[dayType]);
      const peak = cells[slot] === true;
      const prices = tierPrices(peak ? day.peak : day.valley);
      const tokens = usageBuckets(usage);
      const costs = {
        hit: (tokens.hit / 1e6) * prices.hit,
        miss: (tokens.miss / 1e6) * prices.miss,
        out: (tokens.out / 1e6) * prices.out,
      };
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        peak,
        dayType,
        slot,
        tokens,
        prices,
        costs: { ...costs, total: costs.hit + costs.miss + costs.out },
      };
    }

    /**
     * @param estimate - an estimate from {@link estimateUsage}.
     * @returns the three receipt lines, in the order the receipt prints them.
     */
    function receiptLines(estimate) {
      return [
        { key: 'hit', label: '输入（缓存命中）', tokens: estimate.tokens.hit, unit: estimate.prices.hit, cost: estimate.costs.hit },
        { key: 'miss', label: '输入（缓存未命中）', tokens: estimate.tokens.miss, unit: estimate.prices.miss, cost: estimate.costs.miss },
        { key: 'out', label: '输出', tokens: estimate.tokens.out, unit: estimate.prices.out, cost: estimate.costs.out },
      ];
    }


    /* ------------------------------------------------------------------ *
     * Shared floating window shell
     * ------------------------------------------------------------------ */

    /**
     * One console-style floating window: title bar, chip, resize grip, and the
     * frame geometry bookkeeping every window shares.
     *
     * @param props - window identity, title content, body, chip and close hook.
     * @returns the window element.
     */
    function FloatFrame(props) {
      const windowId = props.windowId;
      const [layout, setLayout] = React.useState(() => clampToViewport(loadLayout(windowId)));
      const [dragging, setDragging] = React.useState('');
      const layoutRef = React.useRef(layout);
      const dragRef = React.useRef(null);
      const depth = useWindowDepth(windowId);
      layoutRef.current = layout;

      /** Merge and persist one geometry change. */
      const applyLayout = React.useCallback(
        (patch) => {
          setLayout((current) => {
            const next = clampToViewport({ ...current, ...patch });
            saveLayout(windowId, next);
            return next;
          });
        },
        [windowId],
      );

      /** Grab the title bar (or the whole chip while minimized) to move. */
      const beginDrag = React.useCallback((event) => {
        if (event.button !== 0) return;
        const frame = event.currentTarget.closest('.__dshbc_frame');
        if (frame === null) return;
        const rect = frame.getBoundingClientRect();
        dragRef.current = {
          mode: 'move',
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          expandOnRelease: layoutRef.current.minimized,
        };
        setDragging('move');
        if (typeof event.preventDefault === 'function') event.preventDefault();
      }, []);

      /** Grab the bottom-right grip to resize. */
      const onResizeStart = React.useCallback((event) => {
        const target = event.currentTarget;
        const frame = target === null || target === undefined ? null : target.closest('.__dshbc_frame');
        if (frame === null) return;
        const rect = frame.getBoundingClientRect();
        dragRef.current = {
          mode: 'resize',
          startWidth: rect.width,
          startHeight: rect.height,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          expandOnRelease: false,
        };
        setDragging('resize');
        if (typeof event.preventDefault === 'function') event.preventDefault();
      }, []);

      // Tracking runs on the window so a fast drag never leaves the frame behind.
      React.useEffect(() => {
        const pointOf = (event) => {
          const x = Number(event.clientX);
          const y = Number(event.clientY);
          return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
        };
        const onMove = (event) => {
          const drag = dragRef.current;
          if (drag === null) return;
          const point = pointOf(event);
          if (point === null) return;
          if (!drag.moved) {
            const travel = Math.abs(point.x - drag.startX) + Math.abs(point.y - drag.startY);
            if (travel > DRAG_SLOP) drag.moved = true;
          }
          if (drag.mode === 'move') {
            applyLayout({ x: point.x - drag.offsetX, y: point.y - drag.offsetY });
            return;
          }
          applyLayout({
            width: Math.max(MIN_WIDTH, drag.startWidth + (point.x - drag.startX)),
            height: Math.max(MIN_HEIGHT, drag.startHeight + (point.y - drag.startY)),
          });
        };
        const onEnd = () => {
          const drag = dragRef.current;
          if (drag === null) return;
          dragRef.current = null;
          setDragging('');
          if (drag.expandOnRelease && !drag.moved) {
            applyLayout({ minimized: false });
            return;
          }
          saveLayout(windowId, layoutRef.current);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);
        return () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onEnd);
          window.removeEventListener('pointercancel', onEnd);
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onEnd);
        };
      }, [applyLayout, windowId]);

      // Keep the frame inside the viewport when the window is resized.
      React.useEffect(() => {
        const onResize = () => {
          setLayout((current) => clampToViewport(current));
        };
        window.addEventListener('resize', onResize);
        return () => {
          window.removeEventListener('resize', onResize);
        };
      }, []);

      // A window that mounts on top of an older one takes focus immediately, so
      // opening settings or a receipt never lands underneath.
      React.useEffect(() => {
        windowStack.focus(windowId);
      }, [windowId]);

      const onToggleMinimize = React.useCallback(() => {
        applyLayout({ minimized: !layoutRef.current.minimized });
      }, [applyLayout]);

      const barChildren = [props.titleChildren];
      barChildren.push(
        h(
          'button',
          {
            key: 'minimize',
            type: 'button',
            className: '__dshbc_btn',
            title: 'minimize to a square chip',
            'aria-label': `minimize ${props.ariaLabel}`,
            onMouseDown: (event) => {
              event.stopPropagation();
            },
            onClick: onToggleMinimize,
          },
          h(Glyph, { d: 'M3 8h10' }),
        ),
      );
      if (props.onClose !== undefined) {
        barChildren.push(
          h(
            'button',
            {
              key: 'close',
              type: 'button',
              className: '__dshbc_btn',
              title: 'close this window',
              'aria-label': `close ${props.ariaLabel}`,
              onMouseDown: (event) => {
                event.stopPropagation();
              },
              onClick: props.onClose,
            },
            h(Glyph, { d: 'M4 4l8 8M12 4l-8 8' }),
          ),
        );
      }

      return h(
        'div',
        {
          className: '__dshbc_frame',
          'data-min': layout.minimized ? '1' : '0',
          'data-dragging': dragging === 'move' ? '1' : '0',
          'data-resizing': dragging === 'resize' ? '1' : '0',
          style: {
            left: layout.x === null ? 'auto' : `${String(layout.x)}px`,
            right: layout.x === null ? '22px' : 'auto',
            top: `${String(layout.y)}px`,
            width: layout.minimized ? `${String(CHIP_SIZE)}px` : `${String(layout.width)}px`,
            height: layout.minimized ? `${String(CHIP_SIZE)}px` : `${String(layout.height)}px`,
            zIndex: depth,
          },
          role: 'group',
          'aria-label': props.ariaLabel,
          onMouseDown: layout.minimized ? beginDrag : undefined,
          onDoubleClick: layout.minimized ? onToggleMinimize : undefined,
        },
        h(
          'div',
          {
            key: 'bar',
            className: '__dshbc_titlebar',
            onMouseDown: (event) => {
              windowStack.focus(windowId);
              beginDrag(event);
            },
          },
          barChildren,
        ),
        h(
          'div',
          { key: 'chip', className: '__dshbc_chip', 'data-color': props.chipColor, title: props.chipTitle },
          props.chipText,
        ),
        h('div', { key: 'body', className: '__dshbc_body' }, props.children),
        h('div', {
          key: 'grip',
          className: '__dshbc_grip',
          title: 'drag to resize',
          onMouseDown: onResizeStart,
        }),
      );
    }

    /* ------------------------------------------------------------------ *
     * Formatting helpers
     * ------------------------------------------------------------------ */

    /**
     * @param view - Host state, or null.
     * @returns the wallet to headline, preferring CNY.
     */
    function primaryWallet(view) {
      const wallets = view !== null && view.snapshot !== null && Array.isArray(view.snapshot.wallets) ? view.snapshot.wallets : [];
      if (wallets.length === 0) return null;
      const cny = wallets.find((wallet) => wallet.currency === 'CNY');
      return cny === undefined ? wallets[0] : cny;
    }

    /**
     * @param view - Host state, or null.
     * @returns the wallet's own figures, or nulls when unreadable.
     */
    function readTotals(view) {
      const wallet = primaryWallet(view);
      if (wallet === null) return { spendable: null, toppedUp: null, granted: null };
      const toppedUp = Number(wallet.toppedUp);
      const granted = Number(wallet.granted);
      if (!Number.isFinite(toppedUp) || !Number.isFinite(granted)) return { spendable: null, toppedUp: null, granted: null };
      return { spendable: toppedUp + granted, toppedUp, granted };
    }

    /**
     * @param wallet - wallet entry, or null.
     * @returns the reading compared for change detection.
     */
    function walletReading(wallet) {
      return wallet === null ? '' : `${String(wallet.currency)}:${String(wallet.total)}`;
    }

    /**
     * @param seconds - age in seconds, or null.
     * @returns a compact age label.
     */
    function ageLabel(seconds) {
      if (seconds === null || seconds === undefined) return '--';
      if (seconds < 60) return `${String(seconds)}s`;
      if (seconds < 3600) return `${String(Math.floor(seconds / 60))}m`;
      return `${String(Math.floor(seconds / 3600))}h`;
    }

    /**
     * @param at - epoch milliseconds.
     * @returns `MM-DD HH:MM:SS` for a bill line.
     */
    function stampOf(at) {
      const date = new Date(Number(at));
      if (!Number.isFinite(date.getTime())) return '--';
      const pad = (value) => String(value).padStart(2, '0');
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    /**
     * @param amount - signed change.
     * @returns the amount text carrying its own sign.
     */
    function amountText(amount) {
      const value = Number(amount);
      if (!Number.isFinite(value)) return '?';
      const sign = value > 0 ? '+' : value < 0 ? '-' : '';
      return `${sign}${Math.abs(value).toFixed(2)}`;
    }

    /**
     * @param price - CNY amount.
     * @returns a fixed four-decimal price for a receipt.
     */
    function priceText(price) {
      const value = Number(price);
      return Number.isFinite(value) ? value.toFixed(4) : '--';
    }

    /**
     * @param tokens - token count.
     * @returns the count with thousands separators.
     */
    function tokenText(tokens) {
      const value = Number(tokens);
      if (!Number.isFinite(value)) return '0';
      return Math.round(value).toLocaleString('en-US');
    }

    /**
     * @param index - half-hour slot index in one day.
     * @returns `HH:MM` for that slot's start.
     */
    function slotLabel(index) {
      const minutes = Number(index) * 30;
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }

    /**
     * Positive-only provider probe over the shipped model selector.
     *
     * That selector renders the model's display name rather than the provider
     * route, so it can confirm the console belongs in view but never disprove
     * it: a non-match returns undefined and the Host's authoritative provider
     * answer decides.
     * @returns true when the selector names a DeepSeek model, otherwise undefined.
     */
    function readProviderFromDom() {
      const slot = document.querySelector('[data-slot="conversation.input.model"]');
      if (slot === null) return undefined;
      const label = slot.querySelector('[aria-label]');
      const text = label === null ? (slot.textContent || '').trim() : label.getAttribute('aria-label') || '';
      if (text.length === 0 || text.length > 160) return undefined;
      return DEEPSEEK_PROVIDER_PATTERN.test(text) ? true : undefined;
    }

    /**
     * One receipt/bill line, laid out like the balance row: the filler is a
     * single flex child, so it absorbs the width between the leading text and
     * the stamp.
     * @param props - row parts.
     * @returns the row element.
     */
    function LogRow(props) {
      return h(
        'div',
        { className: '__dshbc_logrow' },
        h('span', { className: '__dshbc_loghash', 'data-sign': props.sign }, '#'),
        props.leading === undefined ? null : h('span', { className: '__dshbc_logmid' }, props.leading),
        props.fill ? h('span', { className: '__dshbc_logfill', 'aria-hidden': true, key: 'lf' }, '-'.repeat(200)) : null,
        props.note === undefined ? null : h('span', { className: '__dshbc_lognote', 'data-sign': props.sign, key: 'ln' }, props.note),
        props.fillRight ? h('span', { className: '__dshbc_logfill', 'aria-hidden': true, key: 'rf' }, '-'.repeat(200)) : null,
        h('span', { className: '__dshbc_logdate', key: 'ld' }, ` ${stampOf(props.at)}`),
      );
    }

    /* ------------------------------------------------------------------ *
     * Host session shared by every window
     * ------------------------------------------------------------------ */

    /**
     * The last Host snapshot, republished for seats outside the overlay.
     *
     * The receipt button lives in a session-scoped seat and the hover line in a
     * root-scoped one, so neither can receive the overlay's props directly; they
     * read the same snapshot through this subscription instead.
     */
    const hostState = {
      view: null,
      call: null,
      listeners: new Set(),
      /**
       * @param view - newest Host snapshot.
       */
      publish(view) {
        hostState.view = view;
        for (const listener of hostState.listeners) listener();
      },
      /**
       * @param listener - called on every published snapshot.
       * @returns unsubscriber.
       */
      subscribe(listener) {
        hostState.listeners.add(listener);
        return () => {
          hostState.listeners.delete(listener);
        };
      },
    };

    /**
     * @returns the newest Host snapshot, or null before the first read.
     */
    function useHostView() {
      const [view, setLocal] = React.useState(hostState.view);
      React.useEffect(() => hostState.subscribe(() => setLocal(hostState.view)), []);
      return view;
    }

    /**
     * Owns the single Host poll and exposes it to every window, so opening the
     * settings or a receipt never adds a second polling loop.
     * @param running - whether any session currently reports running work.
     * @returns the shared Host state and its request action.
     */
    function useHostState(running) {
      const [view, setView] = React.useState(null);
      const [failure, setFailure] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const readingRef = React.useRef(null);
      const changedRef = React.useRef(false);
      const runningRef = React.useRef(false);
      runningRef.current = running;

      /** Run one Host action, folding transport faults into state. */
      const call = React.useCallback(async (payload, options) => {
        const opts = options === undefined ? {} : options;
        if (opts.busy !== false) setBusy(true);
        try {
          const value = await ask(payload);
          setFailure('');
          if (value !== null && value !== undefined && typeof value === 'object') {
            const reading = walletReading(primaryWallet(value));
            if (readingRef.current !== null && reading !== readingRef.current) changedRef.current = true;
            readingRef.current = reading;
            setView(value);
          }
          return value;
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error));
          return null;
        } finally {
          if (opts.busy !== false) setBusy(false);
        }
      }, []);

      // Every accepted snapshot is republished so the session-scoped and
      // root-scoped seats read the same numbers as the console.
      React.useEffect(() => {
        hostState.call = call;
      }, [call]);
      React.useEffect(() => {
        if (view !== null) hostState.publish(view);
      }, [view]);

      // One polling loop: this is also the heartbeat that scopes Host-side
      // polling to a window that is actually on screen.
      React.useEffect(() => {
        let disposed = false;
        let timer = 0;
        const schedule = (delay) => {
          if (disposed) return;
          timer = window.setTimeout(async () => {
            await call({ action: 'getState', running: runningRef.current });
            schedule(runningRef.current || changedRef.current ? 2000 : 6000);
          }, delay);
        };
        schedule(0);
        return () => {
          disposed = true;
          window.clearTimeout(timer);
        };
      }, [call]);

      return { view, failure, busy, call };
    }

    /**
     * @param host - shared Host state.
     * @returns the status word, accent and error the console renders.
     */
    function deriveStatus(host) {
      const view = host.view;
      const failure = host.failure;
      const code = view !== null && typeof view.state === 'string' ? view.state : 'online';
      const errored = code === 'notConfigured' || code === 'network' || code === 'invalidKey';
      return {
        code,
        errored,
        accent: code === 'invalidKey' ? 'blue' : errored ? 'red' : 'green',
        error: failure.length > 0 ? failure : view !== null && typeof view.error === 'string' ? view.error : '',
      };
    }

    /* ------------------------------------------------------------------ *
     * Balance console window
     * ------------------------------------------------------------------ */

    /**
     * @param props - shared Host state, running flag and settings opener.
     * @returns the balance console window.
     */
    function ConsoleWindow(props) {
      const { view, busy, call } = props.host;
      const [keyDraft, setKeyDraft] = React.useState('');
      const [blinkOn, setBlinkOn] = React.useState(true);
      const running = props.running;

      React.useEffect(() => {
        const timer = window.setInterval(() => {
          setBlinkOn((value) => !value);
        }, BLINK_MS);
        return () => {
          window.clearInterval(timer);
        };
      }, []);

      const status = deriveStatus(props.host);
      const code = status.code;
      const accent = status.accent;
      const totals = readTotals(view);
      const showZero = code === 'notConfigured' || code === 'network';
      const amount = showZero ? '0' : totals.spendable === null ? '--' : totals.spendable.toFixed(2);
      const tokenColor = accent === 'blue' ? BLUE : accent === 'red' ? RED : GREEN;
      const blockBlinks = code === 'network' || code === 'invalidKey';
      const blockStatic = code === 'notConfigured';
      const reading = busy || (view !== null && view.inFlight === true);

      const tokenNode = !reading && blockStatic
        ? h('span', { className: '__dshbc_token', style: { color: tokenColor } }, '■')
        : !reading && blockBlinks
          ? h('span', { className: '__dshbc_token', style: { color: tokenColor } }, blinkOn ? '■' : '\u00a0')
          : reading
            ? h('span', { className: '__dshbc_indicator', style: { color: tokenColor }, 'data-off': blinkOn ? '0' : '1' })
            : running
              ? h('span', { className: '__dshbc_caret' }, '_')
              : h('span', { className: '__dshbc_token', style: { color: tokenColor } }, '>');

      const budget = view !== null && Number.isFinite(Number(view.budget)) ? Number(view.budget) : 0;
      let fillPercent = 0;
      let grantPercent = 0;
      let spillPercent = 0;
      let spendLabel = '--';
      const flatBar = code === 'notConfigured' ? '1' : code === 'invalidKey' ? '2' : '0';
      const scanBar = code === 'network';
      if (code === 'online' && budget > 0 && totals.spendable !== null && totals.toppedUp !== null) {
        const ratio = totals.spendable / budget;
        const grantShare = totals.spendable > 0 ? totals.granted / totals.spendable : 0;
        if (ratio <= 1) {
          fillPercent = ratio * 100;
          grantPercent = grantShare * fillPercent;
        } else {
          fillPercent = 100;
          grantPercent = grantShare * 100;
          spillPercent = 100 - 100 / ratio;
        }
        spendLabel = `${String(Math.round(ratio * 100))}%`;
      }

      const ledger = view !== null && Array.isArray(view.ledger) ? view.ledger : [];
      const age = view === null ? null : view.ageSeconds;
      const keyHint = view !== null && typeof view.keyHint === 'string' ? view.keyHint : '';

      let statusWord;
      let statusLive = false;
      if (code === 'notConfigured') statusWord = 'AUTH_REQUIRED';
      else if (code === 'network') statusWord = 'NO_NETWORK';
      else if (code === 'invalidKey') statusWord = 'KEY_INVALID';
      else if (running) {
        statusWord = 'LIVE';
        statusLive = true;
      } else statusWord = 'IDLE';

      const dotColor = code === 'invalidKey' ? BLUE : status.errored ? RED : GREEN;

      const barChildren = [];
      if (flatBar === '0' && !scanBar && code === 'online') {
        barChildren.push(h('span', { key: 'fill', className: '__dshbc_fill', style: { width: `${String(fillPercent)}%` } }));
        if (grantPercent > 0) {
          barChildren.push(h('span', { key: 'grant', className: '__dshbc_grant', style: { width: `${String(grantPercent)}%`, right: '0' } }));
        }
        if (spillPercent > 0) {
          barChildren.push(h('span', { key: 'spill', className: '__dshbc_spill', style: { width: `${String(spillPercent)}%` } }));
        }
      } else if (flatBar === '2') {
        barChildren.push(h('span', { key: 'fill', className: '__dshbc_fill', 'data-flat': '2', style: { width: '100%' } }));
      }

      const bodyChildren = [
        h(
          'div',
          { key: 'header', className: '__dshbc_row' },
          h('span', { className: '__dshbc_prompt' }, tokenNode),
          h('span', { className: '__dshbc_path' }, 'balance:'),
          h('span', { className: '__dshbc_amount', 'data-color': accent }, amount),
          h('span', { className: '__dshbc_badge', 'data-color': accent }, 'CNY'),
          h(
            'span',
            {
              className: '__dshbc_bar',
              'data-scan': scanBar ? '1' : '0',
              'data-flat': flatBar,
              title: budget > 0 ? `budget ${String(budget)}` : 'no budget set',
            },
            barChildren,
          ),
          h(
            'span',
            { className: '__dshbc_tail' },
            `${spendLabel}  age ${ageLabel(age)}${code === 'online' && keyHint.length > 0 ? `  ${keyHint}` : ''}`,
          ),
        ),
      ];

      if (code === 'notConfigured') {
        bodyChildren.push(
          h(
            'div',
            { key: 'login', className: '__dshbc_row __dshbc_form' },
            h('span', { className: '__dshbc_label' }, 'api key'),
            h('input', {
              className: '__dshbc_input',
              type: 'password',
              value: keyDraft,
              placeholder: 'sk-...',
              spellCheck: false,
              autoComplete: 'off',
              'aria-label': 'DeepSeek API key',
              onChange: (event) => {
                setKeyDraft(event.target.value);
              },
              onKeyDown: (event) => {
                if (event.key !== 'Enter') return;
                const value = keyDraft.trim();
                if (value.length > 0) void call({ action: 'login', apiKey: value }).then(() => setKeyDraft(''));
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: '__dshbc_action',
                disabled: busy || keyDraft.trim().length === 0,
                onClick: () => {
                  const value = keyDraft.trim();
                  if (value.length === 0) return;
                  void call({ action: 'login', apiKey: value }).then(() => setKeyDraft(''));
                },
              },
              'sign in',
            ),
          ),
        );
      }

      if (status.error.length > 0 && code === 'online') {
        bodyChildren.push(h('div', { key: 'out', className: '__dshbc_out', 'data-error': '1' }, status.error));
      }

      if (code !== 'online') {
        bodyChildren.push(
          h(
            'div',
            { key: 'notice', className: '__dshbc_log' },
            h(LogRow, {
              sign: code === 'invalidKey' ? 'info' : 'error',
              at: Date.now(),
              fill: true,
              fillRight: true,
              note:
                code === 'notConfigured'
                  ? '请点击设置以登录apikey'
                  : code === 'network'
                    ? '请检查网络连接'
                    : 'apikey 非法，请点击设置重新登录',
            }),
          ),
        );
      }

      if (ledger.length > 0) {
        bodyChildren.push(
          h(
            'div',
            { key: 'ledger', className: '__dshbc_log' },
            ledger.map((entry, index) => {
              const up = Number(entry.amount) > 0;
              return h(LogRow, {
                key: `${String(entry.at)}-${String(index)}`,
                sign: up ? 'up' : 'down',
                at: entry.at,
                leading: ` change ${amountText(entry.amount)} ${String(entry.currency)} `,
                fill: true,
              });
            }),
          ),
        );
      }

      const titleChildren = h(React.Fragment, null, [
        h('span', { key: 'dot', className: '__dshbc_dot', style: { background: dotColor } }),
        h('span', { key: 'title', className: '__dshbc_title' }, `balance — ${statusWord}`),
        h(
          'button',
          {
            key: 'refresh',
            type: 'button',
            className: '__dshbc_btn',
            title: 'refresh balance now',
            'aria-label': 'refresh balance now',
            disabled: reading,
            onMouseDown: (event) => {
              event.stopPropagation();
            },
            onClick: () => {
              void call({ action: 'refresh', running });
            },
          },
          h(Glyph, { d: 'M13.5 8a5.5 5.5 0 1 1-1.9-4.16M13.5 1.5V4.6h-3.1' }),
        ),
        h(
          'button',
          {
            key: 'settings',
            type: 'button',
            className: '__dshbc_btn',
            title: 'balance console settings',
            'aria-label': 'balance console settings',
            onMouseDown: (event) => {
              event.stopPropagation();
            },
            onClick: props.onOpenSettings,
          },
          h(Glyph, {
            d: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6.3 1.9 6.6 1h2.8l.3.9 1 .5.9-.3 1.4 2.4-.7.7v1.1l.7.7-1.4 2.4-.9-.3-1 .5-.3.9H6.6l-.3-.9-1-.5-.9.3L3 7.5l.7-.7V5.7L3 5l1.4-2.4.9.3 1-.5Z',
          }),
        ),
      ]);

      return h(
        FloatFrame,
        {
          windowId: WINDOW_CONSOLE,
          ariaLabel: 'DeepSeek API balance console',
          titleChildren,
          chipColor: code === 'notConfigured' ? 'grey' : accent,
          chipText: code === 'notConfigured' ? '?' : amount,
          chipTitle: `balance ${amount} — drag to move, click to restore`,
        },
        bodyChildren,
      );
    }

    /* ------------------------------------------------------------------ *
     * Pricing rule editor pieces
     * ------------------------------------------------------------------ */

    /**
     * The 48-cell half-hour peak brush.
     *
     * A plain left-drag paints peak and a right-drag paints valley; the grid
     * stores only peak, so every slot a drag does not mark stays valley and the
     * two always complement each other.
     *
     * @param props - the day type, its grid, and the change callback.
     * @returns the brush element.
     */
    function PeakGrid(props) {
      const cells = gridToArray(props.grid);
      const paintRef = React.useRef(null);

      React.useEffect(() => {
        const stop = () => {
          paintRef.current = null;
        };
        window.addEventListener('mouseup', stop);
        window.addEventListener('pointerup', stop);
        return () => {
          window.removeEventListener('mouseup', stop);
          window.removeEventListener('pointerup', stop);
        };
      }, []);

      /**
       * @param index - slot to paint.
       * @param value - true for peak, false for valley.
       */
      const paint = (index, value) => {
        const next = gridToArray(props.grid);
        if (next[index] === value) return;
        next[index] = value;
        props.onChange(gridToString(next));
      };

      return h(
        'div',
        {
          className: '__dshbc_grid',
          role: 'group',
          'aria-label': `peak grid for ${props.dayType}`,
          onContextMenu: (event) => {
            event.preventDefault();
          },
          onMouseDown: (event) => {
            const value = event.button === 2 ? false : true;
            paintRef.current = value;
            const cell = event.target.closest('.__dshbc_cell');
            if (cell !== null) paint(Number(cell.dataset.index), value);
            if (typeof event.preventDefault === 'function') event.preventDefault();
          },
          onMouseOver: (event) => {
            if (paintRef.current === null) return;
            const cell = event.target.closest('.__dshbc_cell');
            if (cell !== null) paint(Number(cell.dataset.index), paintRef.current);
          },
        },
        cells.map((peak, index) =>
          h('button', {
            key: String(index),
            type: 'button',
            className: '__dshbc_cell',
            'data-peak': peak ? '1' : '0',
            'data-index': String(index),
            tabIndex: -1,
            'aria-label': `${slotLabel(index)} ${peak ? 'peak' : 'valley'}`,
            title: `${slotLabel(index)}~${slotLabel(index + 1)} ${peak ? 'peak' : 'valley'}`,
          }),
        ),
      );
    }

    /**
     * One price row inside a tier.
     * @param props - label, value and change callback.
     * @returns the row element.
     */
    function PriceRow(props) {
      return h(
        'div',
        { className: '__dshbc_row' },
        h('span', { className: '__dshbc_label', style: { minWidth: '104px' } }, props.label),
        h('input', {
          className: '__dshbc_input __dshbc_price',
          type: 'number',
          min: 0,
          step: '0.01',
          value: props.value,
          'aria-label': props.label,
          onChange: (event) => {
            props.onChange(event.target.value);
          },
        }),
        h('span', { className: '__dshbc_label' }, 'CNY / M'),
      );
    }

    /**
     * One collapsible pricing rule: a name, two day types, each with a peak
     * grid and a peak/valley price pair.
     *
     * @param props - the rule, its active flag and the mutation callbacks.
     * @returns the rule panel.
     */
    function RuleEditor(props) {
      const rule = props.rule;
      const [expanded, setExpanded] = React.useState(false);
      const [dayType, setDayType] = React.useState('workday');

      /**
       * @param patch - partial rule replacement.
       */
      const update = (patch) => {
        props.onChange({ ...rule, ...patch });
      };

      /**
       * @param key - which day type to patch.
       * @param patch - partial day-type replacement.
       */
      const updateDayType = (key, patch) => {
        const current = rule.dayTypes !== undefined && rule.dayTypes[key] !== undefined ? rule.dayTypes[key] : {};
        update({ dayTypes: { ...rule.dayTypes, [key]: { ...current, ...patch } } });
      };

      /**
       * @param key - which day type to patch.
       * @param patch - partial tier replacement ('peak' or 'valley').
       */
      const updateTier = (key, tierKey, patch) => {
        const current = rule.dayTypes !== undefined && rule.dayTypes[key] !== undefined ? rule.dayTypes[key] : {};
        const tier = current[tierKey] !== undefined ? current[tierKey] : {};
        updateDayType(key, { [tierKey]: { ...tier, ...patch } });
      };

      const day = rule.dayTypes !== undefined && rule.dayTypes[rule.dayTypes[dayType] !== undefined ? dayType : 'workday'] !== undefined
        ? rule.dayTypes[dayType]
        : { peak: {}, valley: {} };
      const grid = rule.grid !== undefined && rule.grid[dayType] !== undefined ? rule.grid[dayType] : '';
      const peakCount = gridToArray(grid).filter(Boolean).length;

      const header = h(
        'div',
        {
          className: '__dshbc_row',
          role: 'button',
          tabIndex: 0,
          style: { cursor: 'pointer' },
          onClick: () => setExpanded((value) => !value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') setExpanded((value) => !value);
          },
        },
        h('span', { className: '__dshbc_label' }, expanded ? '▾' : '▸'),
        h('input', {
          className: '__dshbc_input __dshbc_name',
          type: 'text',
          value: rule.name,
          'aria-label': 'pricing rule name',
          onClick: (event) => {
            event.stopPropagation();
          },
          onChange: (event) => {
            update({ name: event.target.value });
          },
        }),
        h(
          'button',
          {
            type: 'button',
            className: '__dshbc_action',
            'data-primary': props.active ? '1' : '0',
            onClick: (event) => {
              event.stopPropagation();
              props.onActivate();
            },
          },
          props.active ? 'active' : 'use',
        ),
        h(
          'button',
          {
            type: 'button',
            className: '__dshbc_action',
            style: { marginLeft: 'auto' },
            onClick: (event) => {
              event.stopPropagation();
              props.onRemove();
            },
          },
          'delete',
        ),
      );

      if (!expanded) return h('div', { className: '__dshbc_col' }, header);

      const dayTabs = h(
        'div',
        { className: '__dshbc_row' },
        ['workday', 'holiday'].map((key) =>
          h(
            'button',
            {
              key,
              type: 'button',
              className: '__dshbc_action',
              'data-primary': dayType === key ? '1' : '0',
              onClick: () => setDayType(key),
            },
            key,
          ),
        ),
        h('span', { className: '__dshbc_label', style: { marginLeft: 'auto' } }, `peak ${String(peakCount)}/48 · valley ${String(SLOTS - peakCount)}`),
      );

      return h(
        'div',
        { className: '__dshbc_col', style: { gap: '4px' } },
        header,
        h('div', { className: '__dshbc_col', style: { paddingLeft: '2px' } }, [
          dayTabs,
          h(PeakGrid, {
            key: `grid-${dayType}`,
            dayType,
            grid,
            onChange: (next) => update({ grid: { ...rule.grid, [dayType]: next } }),
          }),
          h('div', { className: '__dshbc_axis' }, [
            h('span', { key: 'a' }, '00:00'),
            h('span', { key: 'b' }, '12:00'),
            h('span', { key: 'c' }, '24:00'),
          ]),
          h('div', { className: '__dshbc_label' }, 'peak prices'),
          h(PriceRow, {
            label: 'in cache hit',
            value: String(tierPrices(day.peak).hit),
            onChange: (value) => updateTier(dayType, 'peak', { hit: Number(value) }),
          }),
          h(PriceRow, {
            label: 'in cache miss',
            value: String(tierPrices(day.peak).miss),
            onChange: (value) => updateTier(dayType, 'peak', { miss: Number(value) }),
          }),
          h(PriceRow, {
            label: 'output',
            value: String(tierPrices(day.peak).out),
            onChange: (value) => updateTier(dayType, 'peak', { out: Number(value) }),
          }),
          h('div', { className: '__dshbc_label' }, 'valley prices'),
          h(PriceRow, {
            label: 'in cache hit',
            value: String(tierPrices(day.valley).hit),
            onChange: (value) => updateTier(dayType, 'valley', { hit: Number(value) }),
          }),
          h(PriceRow, {
            label: 'in cache miss',
            value: String(tierPrices(day.valley).miss),
            onChange: (value) => updateTier(dayType, 'valley', { miss: Number(value) }),
          }),
          h(PriceRow, {
            label: 'output',
            value: String(tierPrices(day.valley).out),
            onChange: (value) => updateTier(dayType, 'valley', { out: Number(value) }),
          }),
        ]),
      );
    }

    /**
     * @returns a fresh pricing rule with empty prices and an all-valley grid.
     */
    function blankRule() {
      const tier = () => ({ hit: 0, miss: 0, out: 0 });
      const empty = '0'.repeat(SLOTS);
      return {
        id: `rule-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`,
        name: 'new rule',
        dayTypes: { workday: { peak: tier(), valley: tier() }, holiday: { peak: tier(), valley: tier() } },
        grid: { workday: empty, holiday: empty },
      };
    }

    /** The pricing-rule list inside the settings window. */
    function PricingRules(props) {
      const rules = Array.isArray(props.rules) ? props.rules : [];
      const save = (next, activeRuleId) => {
        props.onSave(next, activeRuleId === undefined ? props.activeRuleId : activeRuleId);
      };
      return h(
        'div',
        { className: '__dshbc_col' },
        h(
          'div',
          { className: '__dshbc_row' },
          h('span', { className: '__dshbc_label' }, 'pricing rules'),
          h(
            'button',
            {
              type: 'button',
              className: '__dshbc_action',
              onClick: () => {
                const rule = blankRule();
                save([...rules, rule], rule.id);
              },
            },
            'create pricing rule',
          ),
          h('span', { className: '__dshbc_label', style: { marginLeft: 'auto' } }, props.notice),
        ),
        rules.length === 0
          ? h('div', { className: '__dshbc_label' }, 'no rule yet — create one to enable estimates')
          : rules.map((rule) =>
              h(RuleEditor, {
                key: rule.id,
                rule,
                active: rule.id === props.activeRuleId,
                onChange: (next) => save(rules.map((entry) => (entry.id === next.id ? next : entry))),
                onActivate: () => save(rules, rule.id),
                onRemove: () => {
                  const next = rules.filter((entry) => entry.id !== rule.id);
                  save(next, next.length > 0 ? next[0].id : '');
                },
              }),
            ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Consumption receipt
     * ------------------------------------------------------------------ */

    /**
     * @param props - bars to draw, each with a label and a price.
     * @returns an inline SVG bar chart, no chart library involved.
     */
    function BarChart(props) {
      const bars = Array.isArray(props.bars) ? props.bars : [];
      const width = 520;
      const height = 120;
      const base = height - 18;
      const max = bars.reduce((peak, bar) => Math.max(peak, Number(bar.total) || 0), 0);
      const slot = bars.length === 0 ? width : width / bars.length;
      const barWidth = Math.max(6, Math.min(34, slot * 0.62));
      return h(
        'svg',
        {
          viewBox: `0 0 ${String(width)} ${String(height)}`,
          width: '100%',
          height: String(height),
          role: 'img',
          'aria-label': 'price per conversation',
          style: { display: 'block', flex: 'none' },
        },
        h('line', { x1: 0, y1: base, x2: width, y2: base, stroke: FREE_GREY, strokeWidth: 1 }),
        bars.map((bar, index) => {
          const value = Number(bar.total) || 0;
          const barHeight = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * (base - 14)) : 0;
          const x = index * slot + (slot - barWidth) / 2;
          return h(
            'g',
            { key: String(index) },
            h('rect', {
              x,
              y: base - barHeight,
              width: barWidth,
              height: barHeight,
              fill: value > 0 ? 'var(--dsw-alias-state-success-primary)' : FREE_GREY,
            }),
            h(
              'text',
              {
                x: x + barWidth / 2,
                y: base + 13,
                fill: 'var(--dsw-alias-label-tertiary)',
                fontSize: 10,
                textAnchor: 'middle',
              },
              bar.label,
            ),
          );
        }),
      );
    }

    /**
     * One consumption receipt: the three token classes with their unit prices
     * and costs, the total, and — for a whole session — a bar per conversation.
     *
     * @param props - the receipt payload and the close handler.
     * @returns the receipt window.
     */
    function ReceiptWindow(props) {
      const receipt = props.receipt;
      const estimate = receipt.estimate;
      const lines = receiptLines(estimate);
      const rows = [
        h(
          'div',
          { key: 'head', className: '__dshbc_row' },
          h('span', { className: '__dshbc_path' }, receipt.scope === 'session' ? 'session receipt' : 'conversation receipt'),
          h('span', { className: '__dshbc_label' }, estimate.ruleName),
          h('span', { className: '__dshbc_label', style: { marginLeft: 'auto' } }, estimate.peak ? 'peak' : 'valley'),
          h('span', { className: '__dshbc_label' }, `${String(estimate.dayType)} ${slotLabel(estimate.slot)}`),
        ),
      ];

      for (const line of lines) {
        rows.push(
          h(
            'div',
            { key: line.key, className: '__dshbc_row' },
            h('span', { className: '__dshbc_label', style: { minWidth: '132px' } }, line.label),
            h('span', { className: '__dshbc_path', style: { minWidth: '104px', textAlign: 'right' } }, `${tokenText(line.tokens)} tok`),
            h('span', { className: '__dshbc_label' }, `× ${priceText(line.unit)}`),
            h('span', { className: '__dshbc_amount', style: { marginLeft: 'auto' } }, `¥${priceText(line.cost)}`),
          ),
        );
      }

      rows.push(
        h(
          'div',
          { key: 'total', className: '__dshbc_row' },
          h('span', { className: '__dshbc_label', style: { minWidth: '132px' } }, 'total'),
          h('span', { className: '__dshbc_label', style: { marginLeft: 'auto' } }, 'estimated'),
          h('span', { className: '__dshbc_amount' }, `¥${priceText(estimate.costs.total)}`),
        ),
      );

      if (receipt.scope === 'session' && Array.isArray(receipt.turns) && receipt.turns.length > 0) {
        rows.push(h('div', { key: 'sep', className: '__dshbc_section' }, `conversations (${String(receipt.turns.length)})`));
        rows.push(
          h(BarChart, {
            key: 'chart',
            bars: receipt.turns.map((turn) => ({ label: turn.label, total: turn.total })),
          }),
        );
        rows.push(
          h(
            'div',
            { key: 'chartnote', className: '__dshbc_label' },
            'each bar is one conversation, labelled with its first character; the column is its estimate',
          ),
        );
      }

      const titleChildren = h(React.Fragment, null, [
        h('span', { key: 'dot', className: '__dshbc_dot' }),
        h('span', { key: 'title', className: '__dshbc_title' }, `balance — RECEIPT ¥${priceText(estimate.costs.total)}`),
      ]);

      return h(
        FloatFrame,
        {
          windowId: WINDOW_RECEIPT,
          ariaLabel: 'DeepSeek consumption receipt',
          titleChildren,
          chipColor: 'grey',
          chipText: '¥',
          chipTitle: `receipt ¥${priceText(estimate.costs.total)} — drag to move, click to restore`,
          onClose: props.onClose,
        },
        rows,
      );
    }

    /**
     * The turn-tail button: a read-only estimate of this conversation.
     *
     * It renders only when a pricing rule exists, so a user who has not built
     * one is not shown a meaningless ¥0.00.
     *
     * @param props - the turn tail's owner props plus the Host state.
     * @returns the button, or null.
     */
    /**
     * Read one Session's whole-session estimate from the Host.
     *
     * A Session priced per Turn understates the bill: one conversation spans
     * many steps and requests, each reporting its own usage. The Host folds the
     * whole durable log, so callers read the Session total instead.
     *
     * @param sessionId - Session to price.
     * @param enabled - whether the caller should fetch at all.
     * @returns the row for that Session, or null while unavailable.
     */
    function useSessionRow(sessionId, enabled) {
      const [row, setRow] = React.useState(null);
      React.useEffect(() => {
        if (!enabled || sessionId === undefined || sessionId === null || String(sessionId).length === 0) {
          setRow(null);
          return undefined;
        }
        let disposed = false;
        void ask({ action: 'sessionEstimates', anchor: localAnchor() })
          .then((value) => {
            if (disposed || value === null || value === undefined || !Array.isArray(value.rows)) return;
            setRow(value.rows.find((entry) => String(entry.sessionId) === String(sessionId)) || null);
          })
          .catch(() => {
            if (!disposed) setRow(null);
          });
        return () => {
          disposed = true;
        };
      }, [sessionId, enabled]);
      return row;
    }

    /**
     * Price one Host row with the same arithmetic the Host uses.
     * @param row - a `sessionEstimates` row.
     * @param rules - configured pricing rules.
     * @param activeRuleId - the selected rule.
     * @returns the estimate, or null.
     */
    function estimateForRow(row, rules, activeRuleId) {
      return estimateUsage(
        { cacheReadTokens: row.tokens.hit, uncachedInputTokens: row.tokens.miss, cacheWriteTokens: 0, outputTokens: row.tokens.out },
        rules,
        activeRuleId,
        null,
      );
    }

    /**
     * The turn-tail button: this Session's estimated bill so far.
     *
     * It renders only when a pricing rule exists, so a user who has not built one
     * is not shown a meaningless ¥0.0000.
     *
     * @param props - the turn tail's owner props, which include `sessionId`.
     * @returns the button, or null.
     */
    function TurnEstimate(props) {
      const view = useHostView();
      const rules = view !== null && Array.isArray(view.pricingRules) ? view.pricingRules : [];
      const activeRuleId = view !== null && typeof view.activeRuleId === 'string' ? view.activeRuleId : '';
      const row = useSessionRow(props.sessionId, rules.length > 0);
      if (row === null) return null;
      const estimate = estimateForRow(row, rules, activeRuleId);
      if (estimate === null) return null;
      return h(
        'button',
        {
          type: 'button',
          className: '__dshbc_action',
          title: `session total · ${tokenText(row.tokens.hit)} hit / ${tokenText(row.tokens.miss)} miss / ${tokenText(row.tokens.out)} out tok`,
          onClick: () => {
            receiptState.set({ scope: 'session', estimate, turns: Array.isArray(row.turns) ? row.turns : [] });
          },
        },
        `对话估价「${priceText(estimate.costs.total)}」￥`,
      );
    }

    /**
     * The Session-title button: the whole Session's receipt, bar chart included.
     *
     * It sits beside the conversation title so the aggregate report is reachable
     * from the conversation itself instead of from the sidebar.
     *
     * @param props - slot props carrying `sessionId`.
     * @returns the button, or null.
     */
    function SessionEstimateButton(props) {
      const view = useHostView();
      const rules = view !== null && Array.isArray(view.pricingRules) ? view.pricingRules : [];
      const activeRuleId = view !== null && typeof view.activeRuleId === 'string' ? view.activeRuleId : '';
      const row = useSessionRow(props.sessionId, rules.length > 0);
      if (row === null) return null;
      const estimate = estimateForRow(row, rules, activeRuleId);
      if (estimate === null) return null;
      const turns = Array.isArray(row.turns) ? row.turns : [];
      return h(
        'button',
        {
          type: 'button',
          className: '__dshbc_action',
          title: `本会话共 ${String(turns.length)} 轮对话，合计估价 ¥${priceText(estimate.costs.total)} — 点击查看回执`,
          onClick: () => {
            receiptState.set({ scope: 'session', estimate, turns });
          },
        },
        `会话估价「${priceText(estimate.costs.total)}」￥`,
      );
    }



    /**
     * The settings console: the balance console's own settings, moved out of the
     * small window, plus the pricing-rule entry point.
     *
     * @param props - shared Host state and the close handler.
     * @returns the settings window.
     */
    function SettingsWindow(props) {
      const { view, busy, call } = props.host;
      const [keyDraft, setKeyDraft] = React.useState('');
      const [intervalDraft, setIntervalDraft] = React.useState('');
      const [budgetDraft, setBudgetDraft] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const code = view !== null && typeof view.state === 'string' ? view.state : 'notConfigured';
      const interval = view !== null && Number.isFinite(Number(view.intervalSeconds)) ? Number(view.intervalSeconds) : 5;
      const budget = view !== null && Number.isFinite(Number(view.budget)) ? Number(view.budget) : 0;
      const keyHint = view !== null && typeof view.keyHint === 'string' ? view.keyHint : '';

      React.useEffect(() => {
        setIntervalDraft(String(interval));
        setBudgetDraft(budget > 0 ? String(budget) : '');
      }, [interval, budget]);

      const run = (payload) => {
        void call(payload).then((value) => {
          if (value !== null) setNotice('saved');
        });
      };

      const rows = [
        h(
          'div',
          { key: 'account', className: '__dshbc_row' },
          h('span', { className: '__dshbc_label' }, 'account'),
          h('span', { className: '__dshbc_path' }, code === 'online' ? `signed in  ${keyHint}` : 'signed out'),
          h('span', { className: '__dshbc_label', style: { marginLeft: 'auto' } }, notice),
        ),
      ];

      if (code !== 'online') {
        rows.push(
          h(
            'div',
            { key: 'login', className: '__dshbc_row' },
            h('span', { className: '__dshbc_label' }, 'api key'),
            h('input', {
              className: '__dshbc_input',
              type: 'password',
              value: keyDraft,
              placeholder: 'sk-...',
              spellCheck: false,
              autoComplete: 'off',
              'aria-label': 'DeepSeek API key',
              onChange: (event) => {
                setKeyDraft(event.target.value);
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: '__dshbc_action',
                'data-primary': '1',
                disabled: busy || keyDraft.trim().length === 0,
                onClick: () => {
                  const value = keyDraft.trim();
                  if (value.length === 0) return;
                  void call({ action: 'login', apiKey: value }).then(() => setKeyDraft(''));
                },
              },
              'sign in',
            ),
          ),
        );
      } else {
        rows.push(
          h(
            'div',
            { key: 'logout', className: '__dshbc_row' },
            h('span', { className: '__dshbc_label' }, 'session'),
            h(
              'button',
              { type: 'button', className: '__dshbc_action', disabled: busy, onClick: () => run({ action: 'logout' }) },
              'sign out',
            ),
          ),
        );
      }

      rows.push(
        h(
          'div',
          { key: 'interval', className: '__dshbc_row' },
          h('span', { className: '__dshbc_label' }, 'interval'),
          h('input', {
            className: '__dshbc_input __dshbc_num',
            type: 'number',
            min: 1,
            max: 3600,
            step: 1,
            value: intervalDraft,
            'aria-label': 'live refresh interval in seconds',
            onChange: (event) => {
              setIntervalDraft(event.target.value);
            },
          }),
          h('span', { className: '__dshbc_label' }, 's'),
          h(
            'button',
            {
              type: 'button',
              className: '__dshbc_action',
              disabled: busy,
              onClick: () => {
                const value = Number(intervalDraft);
                if (!Number.isFinite(value) || value < 1 || value > 3600) return;
                run({ action: 'setConfig', patch: { intervalSeconds: value } });
              },
            },
            'save',
          ),
        ),
        h(
          'div',
          { key: 'budget', className: '__dshbc_row' },
          h('span', { className: '__dshbc_label' }, 'budget'),
          h('input', {
            className: '__dshbc_input __dshbc_budget',
            type: 'number',
            min: 0,
            step: '0.01',
            value: budgetDraft,
            placeholder: '0',
            'aria-label': 'expected total budget',
            onChange: (event) => {
              setBudgetDraft(event.target.value);
            },
          }),
          h('span', { className: '__dshbc_label' }, 'CNY'),
          h(
            'button',
            {
              type: 'button',
              className: '__dshbc_action',
              disabled: busy,
              onClick: () => {
                const value = Number(budgetDraft);
                if (!Number.isFinite(value) || value < 0) return;
                run({ action: 'setConfig', patch: { budget: value } });
              },
            },
            'save',
          ),
        ),
        h('div', { key: 'sep', className: '__dshbc_section' }, 'pricing rules'),
        h(PricingRules, {
          key: 'rules',
          rules: view !== null && Array.isArray(view.pricingRules) ? view.pricingRules : [],
          activeRuleId: view !== null && typeof view.activeRuleId === 'string' ? view.activeRuleId : '',
          notice,
          onSave: (next, activeRuleId) => {
            void call({ action: 'setConfig', patch: { pricingRules: next, activeRuleId } }).then((value) => {
              if (value !== null) setNotice('saved');
            });
          },
        }),
      );

      const titleChildren = h(React.Fragment, null, [
        h('span', { key: 'dot', className: '__dshbc_dot' }),
        h('span', { key: 'title', className: '__dshbc_title' }, 'balance — SETTINGS'),
      ]);

      return h(
        FloatFrame,
        {
          windowId: WINDOW_SETTINGS,
          ariaLabel: 'DeepSeek balance settings',
          titleChildren,
          chipColor: 'grey',
          chipText: 'S',
          chipTitle: 'balance settings — drag to move, click to restore',
          onClose: props.onClose,
        },
        rows,
      );
    }

    /* ------------------------------------------------------------------ *
     * Seats
     * ------------------------------------------------------------------ */

    /** Sidebar-foot switch that turns the whole console on or off. */
    function BalanceSwitch(props) {
      const enabled = useEnabled();
      const wide = props.wide !== false;
      return h(
        'button',
        {
          type: 'button',
          className: '__dshbc_switch',
          'data-on': enabled ? '1' : '0',
          'data-narrow': wide ? '0' : '1',
          role: 'switch',
          'aria-checked': enabled ? 'true' : 'false',
          'aria-label': 'deepseek-balance',
          title: enabled ? 'deepseek-balance: on' : 'deepseek-balance: off',
          onClick: () => {
            enabledState.set(!enabled);
          },
        },
        h('span', { className: '__dshbc_switchDot' }),
        wide ? h('span', { className: '__dshbc_switchText' }, 'deepseek-balance') : null,
      );
    }

    /**
     * @param props - slot props carrying the session status source.
     * @returns whether any session currently reports running work.
     */
    function useSessionRunning(props) {
      const status = typeof props.useSessionStatus === 'function' ? props.useSessionStatus : () => false;
      return status((snapshot) => {
        if (snapshot === undefined || snapshot === null || typeof snapshot.get !== 'function') return false;
        let anyRunning = false;
        snapshot.forEach((value) => {
          if (value !== null && value !== undefined && value.running === true) anyRunning = true;
        });
        return anyRunning;
      });
    }

    /** Seat hosting every floating window, with the provider and switch gates. */
    function OverlaySeat(props) {
      const running = useSessionRunning(props);
      const enabled = useEnabled();
      const host = useHostState(running);
      const settingsOpen = useSettingsOpen();
      const receipt = useReceipt();
      const [domProvider, setDomProvider] = React.useState(() => readProviderFromDom());
      const [hostProvider, setHostProvider] = React.useState(undefined);
      const view = host.view;

      React.useEffect(() => {
        const timer = window.setInterval(() => {
          setDomProvider(readProviderFromDom());
        }, 1200);
        return () => {
          window.clearInterval(timer);
        };
      }, []);

      React.useEffect(() => {
        if (view === null || typeof view.provider !== 'string' || view.provider.length === 0) return;
        setHostProvider(DEEPSEEK_PROVIDER_PATTERN.test(view.provider));
      }, [view]);

      const providerIsDeepSeek = hostProvider !== false || domProvider === true;
      if (!enabled || !providerIsDeepSeek) return null;

      return h(
        React.Fragment,
        null,
        h(ConsoleWindow, { host, running, onOpenSettings: () => settingsState.set(true) }),
        settingsOpen ? h(SettingsWindow, { host, onClose: () => settingsState.set(false) }) : null,
        receipt !== null ? h(ReceiptWindow, { receipt, onClose: () => receiptState.set(null) }) : null,
      );
    }

    /**
     * Keeps a plugin defect from blanking the whole floating layer: the trace is
     * printed in place, so a broken window is visible instead of invisible.
     */
    class SeatBoundary extends React.Component {
      /**
       * @param props - the seat to host.
       */
      constructor(props) {
        super(props);
        this.state = { message: '' };
      }

      /**
       * @param error - the thrown value.
       * @returns the captured state.
       */
      static getDerivedStateFromError(error) {
        return { message: error instanceof Error ? `${error.message}` : String(error) };
      }

      /**
       * @returns the seat, or the captured trace.
       */
      render() {
        if (this.state.message.length === 0) return this.props.children;
        return h(
          'div',
          { className: '__dshbc_frame', style: { width: '520px', height: 'auto', padding: '8px' } },
          h('div', { className: '__dshbc_out', 'data-error': '1' }, `balance console failed: ${this.state.message}`),
        );
      }
    }

    /**
     * @param props - slot props for the seat.
     * @returns the seat wrapped in its error boundary.
     */
    function OverlaySeatHost(props) {
      return h(SeatBoundary, null, h(OverlaySeat, props));
    }

    /**
     * Fallback stylesheet carrier for a runtime without the `styles` builtin.
     * @param css - stylesheet text.
     * @returns disposer removing the element again.
     */
    function insertStyleElement(css) {
      const element = document.createElement('style');
      element.setAttribute('data-dsh-balance-console', '');
      element.textContent = css;
      document.head.appendChild(element);
      return () => {
        element.remove();
      };
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        /** @type {Array<() => void>} */
        const cleanups = [];
        let inserted = false;
        try {
          const styles = require('styles');
          if (styles !== undefined && styles !== null && typeof styles.insert === 'function') {
            cleanups.push(styles.insert(CSS));
            inserted = true;
          }
        } catch {
          /* The `styles` builtin is optional; fall back to a managed element. */
        }
        if (!inserted) cleanups.push(insertStyleElement(CSS));
        ctx.effect(
          () => () => {
            for (const dispose of cleanups.reverse()) {
              try {
                dispose();
              } catch {
                /* A failed cleanup must not block plugin disposal. */
              }
            }
          },
          'balance-console: stylesheet',
        );
        // `shell.overlay` is the frame-wide floating layer: independent of the
        // composer, of the session panel, and of any selected conversation.
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'balance-console', order: 20 }, OverlaySeatHost),
        );
        // The sidebar switch sits beside Settings at the sidebar foot.
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register({ name: 'sidebar.footer.action', id: 'balance-console-switch', order: 20 }, BalanceSwitch),
        );
        // The per-conversation estimate sits beside the shipped token readout at
        // the tail of a completed Turn.
        ctx.slots.inject('conversation.chat.turnTail', () =>
          ctx.slots.register({ name: 'conversation.chat.turnTail', id: 'balance-console-estimate', order: 30 }, TurnEstimate),
        );
        // The whole-Session receipt sits beside the conversation title, so the
        // aggregate report is reachable without opening the sidebar.
        ctx.slots.inject('conversation.session.header.actions', () =>
          ctx.slots.register({ name: 'conversation.session.header.actions', id: 'balance-console-session-receipt', order: 30 }, SessionEstimateButton),
        );
      },
    };
  },
});
