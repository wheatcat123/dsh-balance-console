/**
 * Host half of the balance console.
 *
 * Owns one durable configuration file, polls the DeepSeek Platform balance
 * endpoint on the interval the user configured, and serves the Client's
 * requests over an authenticated HTTP route under `/api`.
 *
 * @module dsh-balance-console
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** HTTP route the Client calls; the connection service authenticates it. */
const ROUTE_PATH = '/api/balance-console/state';

/** Platform balance endpoint for an API key. */
const BALANCE_URL = 'https://api.deepseek.com/user/balance';

/** Credential reference consulted when no key was saved by the console itself. */
const FALLBACK_CREDENTIAL_REF = 'DEEPSEEK_API_KEY';

/** Activity heartbeat lifetime; a Client that stops reporting stops the polling. */
const ACTIVE_TTL_MS = 15_000;

/** Polling scheduler resolution. */
const TICK_MS = 1_000;

/** One balance request may not exceed this. */
const REQUEST_TIMEOUT_MS = 12_000;

/** Largest accepted request body. */
const MAX_BODY_BYTES = 8_192;

/** Accepted custom refresh interval, in seconds. */
const MIN_INTERVAL_SECONDS = 1;
const MAX_INTERVAL_SECONDS = 3_600;

/** Default refresh interval, in seconds. */
const DEFAULT_INTERVAL_SECONDS = 5;

/** Ledger entries kept; older changes are dropped. */
const LEDGER_LIMIT = 15;

/** Most recent steps whose output size feeds the forecast's percentile. */
const STEP_SAMPLE_LIMIT = 200;

/** Half-hour slots in one billing day; the peak grid has exactly this many. */
const SLOTS_PER_DAY = 48;

/** Spendable change below this is noise, not a billed difference. */
const LEDGER_EPSILON = 0.0001;

/** Warning accent used when the user never picked one. */
const DEFAULT_WARN_COLOR = 'rgb(34, 177, 167)';

/** Accepted custom warning accent: `rgb(r, g, b)` only, so the Client can trust it. */
const WARN_COLOR_PATTERN = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/;

/** Largest accepted warning duration, in seconds. */
const MAX_WARN_SECONDS = 60;

/** Cache-hit ratio bounds for the next-conversation forecast, in percent. */
const MIN_LITERARY_HIT_RATE = 0;
const MAX_LITERARY_HIT_RATE = 100;

/**
 * @param value - spendable total (topped-up plus granted), or null.
 * @returns the amount, or null when it is not a number.
 */
function spendableOf(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * @param wallets - wallet list from one balance payload.
 * @returns topped-up plus granted across currencies, or null when unreadable.
 */
function spendableFromWallets(wallets) {
  if (!Array.isArray(wallets) || wallets.length === 0) return null;
  let total = 0;
  let seen = false;
  for (const wallet of wallets) {
    if (wallet === null || wallet === undefined) continue;
    const toppedUp = Number(wallet.toppedUp);
    const granted = Number(wallet.granted);
    if (!Number.isFinite(toppedUp) || !Number.isFinite(granted)) continue;
    total += toppedUp + granted;
    seen = true;
  }
  return seen ? total : null;
}

/**
 * Read the persisted ledger defensively.
 * @param value - candidate ledger array.
 * @returns the accepted entries, newest last.
 */
function readLedger(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value.slice(-LEDGER_LIMIT)) {
    if (entry === null || typeof entry !== 'object') continue;
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount)) continue;
    out.push({
      at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : 0,
      amount,
      currency: typeof entry.currency === 'string' ? entry.currency : '',
      after: Number.isFinite(Number(entry.after)) ? Number(entry.after) : 0,
    });
  }
  return out;
}

/**
 * @returns absolute path of the durable configuration file.
 */
function configPath() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), '.dsh');
  return join(home, 'storages', 'dsh-balance-console.json');
}

/**
 * @returns a fresh default configuration document.
 */
function defaultConfig() {
  return {
    version: 1,
    /** API key saved through the console's own login; empty means "not signed in here". */
    apiKey: '',
    /** Refresh interval in seconds while a task is running. */
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    /** Masked key preview shown in the console header. */
    keyHint: '',
    /** Expected total budget the progress bar measures against; 0 means unset. */
    budget: 0,
    /** Last successful balance payload, or null before the first success. */
    snapshot: null,
    /** Epoch milliseconds of the last successful read. */
    updatedAt: 0,
    /** Last failure message, or empty. */
    error: '',
    /** Recent balance changes, newest last. */
    ledger: [],
    /** Largest deduction that still raises no warning, in CNY. */
    warnThreshold: 0.1,
    /** `rgb(r, g, b)` accent painted on a deduction above the threshold. */
    warnColor: DEFAULT_WARN_COLOR,
    /** How long a warning lasts, in seconds. */
    warnSeconds: 0.5,
    /** Cache-hit ratio, in percent, below which the forecast also bills output. */
    literaryHitRate: 0,
    /** Whether the composer shows the next-conversation forecast. */
    predictEnabled: true,
    /** Spendable total the ledger last accounted for. */
    ledgerTotal: null,
    /** User-authored pricing rules; empty until the user creates one. */
    pricingRules: [],
    /** Rule the estimates use; empty falls back to the first configured rule. */
    activeRuleId: '',
  };
}

/**
 * Read the durable configuration, repairing anything malformed.
 * @returns the configuration document.
 */
function loadConfig() {
  const path = configPath();
  const base = defaultConfig();
  if (!existsSync(path)) return base;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return base;
    const interval = Number(parsed.intervalSeconds);
    return {
      version: 1,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      intervalSeconds:
        Number.isFinite(interval) && interval >= MIN_INTERVAL_SECONDS && interval <= MAX_INTERVAL_SECONDS
          ? Math.round(interval)
          : DEFAULT_INTERVAL_SECONDS,
      keyHint: typeof parsed.keyHint === 'string' ? parsed.keyHint : '',
      budget: Number.isFinite(Number(parsed.budget)) && Number(parsed.budget) >= 0 ? Number(parsed.budget) : 0,
      snapshot: parsed.snapshot !== null && typeof parsed.snapshot === 'object' ? parsed.snapshot : null,
      updatedAt: Number.isFinite(Number(parsed.updatedAt)) ? Number(parsed.updatedAt) : 0,
      error: typeof parsed.error === 'string' ? parsed.error : '',
      ledger: readLedger(parsed.ledger),
      warnThreshold:
        Number.isFinite(Number(parsed.warnThreshold)) && Number(parsed.warnThreshold) >= 0
          ? Math.round(Number(parsed.warnThreshold) * 100) / 100
          : 0.1,
      warnColor:
        typeof parsed.warnColor === 'string' && WARN_COLOR_PATTERN.test(parsed.warnColor.trim())
          ? parsed.warnColor.trim()
          : DEFAULT_WARN_COLOR,
      warnSeconds:
        Number.isFinite(Number(parsed.warnSeconds)) && Number(parsed.warnSeconds) >= 0 && Number(parsed.warnSeconds) <= MAX_WARN_SECONDS
          ? Math.round(Number(parsed.warnSeconds) * 10) / 10
          : 0.5,
      literaryHitRate:
        Number.isFinite(Number(parsed.literaryHitRate)) && Number(parsed.literaryHitRate) >= MIN_LITERARY_HIT_RATE && Number(parsed.literaryHitRate) <= MAX_LITERARY_HIT_RATE
          ? Math.round(Number(parsed.literaryHitRate) * 100) / 100
          : 0,
      predictEnabled: parsed.predictEnabled !== false,
      ledgerTotal: Number.isFinite(Number(parsed.ledgerTotal)) ? Number(parsed.ledgerTotal) : null,
      pricingRules: readRules(parsed.pricingRules),
      activeRuleId: typeof parsed.activeRuleId === 'string' ? parsed.activeRuleId : '',
    };
  } catch {
    return base;
  }
}

/**
 * Persist the configuration document.
 * @param config - document to write.
 */
function saveConfig(config) {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/**
 * @param key - raw API key.
 * @returns masked preview that keeps only the key's head and tail.
 */
function maskKey(key) {
  if (typeof key !== 'string' || key.length === 0) return '';
  if (key.length <= 12) return `${key.slice(0, 3)}***`;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

/**
 * @param seconds - candidate interval.
 * @returns the accepted whole-second interval.
 * @throws RangeError when the value is not an acceptable number of seconds.
 */
function normalizeInterval(seconds) {
  const value = Math.round(Number(seconds));
  if (!Number.isFinite(value) || value < MIN_INTERVAL_SECONDS || value > MAX_INTERVAL_SECONDS) {
    throw new RangeError(`intervalSeconds must be an integer between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS}`);
  }
  return value;
}

/**
 * @param price - candidate unit price per million tokens.
 * @returns the accepted price, or 0 for anything unusable.
 */
function priceOf(price) {
  const value = Number(price);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 1e6) / 1e6 : 0;
}

/**
 * @param dayType - candidate day type.
 * @returns the accepted day type, defaulting to workday.
 */
function dayTypeOf(dayType) {
  return dayType === 'holiday' ? 'holiday' : 'workday';
}

/**
 * Decide which half-hour slot a reading bills in.
 *
 * The peak grid is authored in the user's own wall clock, so the slot must come
 * from that clock. A browser can run in a different timezone than the machine
 * the Harness runs on — this one rendered `America/New_York` while the Host and
 * the user were on `Asia/Shanghai` — and then a supplied slot silently moves the
 * whole day: 23:30 became the 11:30 peak slot. The Host's own local clock is the
 * one the settings window draws the grid against, so it decides. A caller's
 * `slot` is used only when the Host has no usable clock of its own, which is the
 * case in a Hosted deployment that reports an invalid date.
 *
 * @param _anchor - the caller's `{ dayType, slot, hour24, minute }`, kept for the
 *   fallback and for callers that already normalized their own clock.
 * @returns the accepted half-hour slot index.
 */
function anchorSlot(_anchor, at) {
  const when = Number(at);
  // A historical instant bills in the slot it happened in; only a request
  // without one follows the clock in force now.
  const clock = Number.isFinite(when) && when > 0 ? new Date(when) : new Date();
  const localMinutes = clock.getHours() * 60 + clock.getMinutes();
  if (Number.isFinite(localMinutes)) return Math.min(SLOTS_PER_DAY - 1, Math.max(0, Math.floor(localMinutes / 30)));
  const source = _anchor !== null && typeof _anchor === 'object' ? _anchor : {};
  const hour = Number(source.hour24);
  const minute = Number(source.minute);
  if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
    const minutes = hour * 60 + (Number.isFinite(minute) && minute >= 0 && minute <= 59 ? minute : 0);
    return Math.min(SLOTS_PER_DAY - 1, Math.max(0, Math.floor(minutes / 30)));
  }
  const provided = Number(source.slot);
  if (!Number.isFinite(provided)) return 0;
  return Math.min(SLOTS_PER_DAY - 1, Math.max(0, Math.round(provided)));
}

/**
 * @param at - epoch milliseconds a conversation ended at, or 0.
 * @returns `holiday` when that instant fell on a weekend in the Host's zone.
 */
function dayTypeAt(at) {
  const when = Number(at);
  const day = Number.isFinite(when) && when > 0 ? new Date(when) : new Date();
  const weekday = day.getDay();
  return weekday === 0 || weekday === 6 ? 'holiday' : 'workday';
}

/**
 * @param value - candidate peak grid: 48 bits as `0`/`1` characters, or an array.
 * @returns a 48-character grid.
 */
function gridOf(value) {
  if (Array.isArray(value)) {
    return value
      .slice(0, SLOTS_PER_DAY)
      .map((flag) => (flag === true || flag === 1 || flag === '1' ? '1' : '0'))
      .join('')
      .padEnd(SLOTS_PER_DAY, '0');
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^01]/g, '').slice(0, SLOTS_PER_DAY);
    return cleaned.padEnd(SLOTS_PER_DAY, '0');
  }
  return '0'.repeat(SLOTS_PER_DAY);
}

/**
 * @param value - candidate tier: three unit prices per million tokens.
 * @returns normalized prices for cache hit, cache miss and output.
 */
function tierOf(value) {
  const tier = value !== null && typeof value === 'object' ? value : {};
  return { hit: priceOf(tier.hit), miss: priceOf(tier.miss), out: priceOf(tier.out) };
}

/**
 * @param value - candidate rule from disk or from the Client.
 * @returns a normalized pricing rule, or null when unusable.
 */
function normalizeRule(value) {
  if (value === null || typeof value !== 'object') return null;
  const id =
    typeof value.id === 'string' && value.id.length > 0
      ? value.id
      : `rule-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;
  const dayTypes = value.dayTypes !== null && typeof value.dayTypes === 'object' ? value.dayTypes : {};
  const workday = dayTypes.workday !== null && typeof dayTypes.workday === 'object' ? dayTypes.workday : {};
  const holiday = dayTypes.holiday !== null && typeof dayTypes.holiday === 'object' ? dayTypes.holiday : {};
  const grid = value.grid !== null && typeof value.grid === 'object' ? value.grid : {};
  return {
    id,
    name: typeof value.name === 'string' && value.name.length > 0 ? value.name.slice(0, 40) : 'pricing rule',
    // Six unit prices per day type: a peak tier and a valley tier, three each.
    dayTypes: { workday: { peak: tierOf(workday.peak), valley: tierOf(workday.valley) }, holiday: { peak: tierOf(holiday.peak), valley: tierOf(holiday.valley) } },
    // One peak bitmap per day type; every slot it does not mark is valley.
    grid: { workday: gridOf(grid.workday), holiday: gridOf(grid.holiday) },
  };
}

/**
 * Fold one durable session log into billing totals.
 *
 * This mirrors the client-safe `tokenUsage` projection field for field — cache
 * reads, uncached input, cache writes and output — while also keeping the
 * per-Turn detail that projection does not expose, so a receipt can draw one
 * bar per conversation. Cache writes are carried separately because they bill
 * at the miss price.
 *
 * The same pass also keeps what the next-conversation forecast needs: the exact
 * buckets of the most recent step, and that step's output size.
 *
 * @param events - the Session's durable events, in seq order.
 * @returns whole-log totals, one entry per Turn, the last step, and every step's output.
 */
function foldSessionsLog(events) {
  const tokens = { hit: 0, write: 0, miss: 0, out: 0 };
  const turns = [];
  /** Never reset, so it is the most recent step when the log ends. */
  let last = null;
  const steps = [];
  let openTurn = null;
  const safe = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  };
  for (const event of events) {
    if (event === null || event === undefined) continue;
    if (event.type === 'turn/start') {
      openTurn = { turn: event.data.turn, seq: event.seq, label: '', hit: 0, write: 0, miss: 0, out: 0, priced: false };
      continue;
    }
    if (openTurn === null) continue;
    if (event.type === 'user/message') {
      if (openTurn.label.length === 0) {
        const seed = firstCharacterOf(event.data);
        if (seed.length > 0) openTurn.label = seed;
      }
      continue;
    }
    if (event.type === 'assistant/message') {
      const usage = event.data.usage;
      if (usage === undefined || usage === null) continue;
      const hit = safe(usage.cacheReadTokens);
      const write = safe(usage.cacheWriteTokens);
      const miss = safe(usage.inputTokens);
      const out = safe(usage.outputTokens);
      tokens.hit += hit;
      tokens.write += write;
      tokens.miss += miss;
      tokens.out += out;
      openTurn.hit += hit;
      openTurn.write += write;
      openTurn.miss += miss;
      openTurn.out += out;
      openTurn.priced = true;
      // One model call's own buckets, kept separately because the forecast starts
      // from the last step rather than from a Turn or Session aggregate.
      last = {
        turn: openTurn.turn,
        step: steps.length + 1,
        hit,
        write,
        miss,
        out,
      };
      steps.push(out);
      continue;
    }
    if (event.type === 'turn/end') {
      if (openTurn.priced || openTurn.label.length > 0) {
        turns.push({
          turn: openTurn.turn,
          seq: openTurn.seq,
          label: openTurn.label.length > 0 ? openTurn.label : '#',
          // Cache writes bill at the miss price, so they join the miss bucket
          // exactly as the Host's own estimate does.
          tokens: { hit: openTurn.hit, miss: openTurn.miss + openTurn.write, out: openTurn.out, write: openTurn.write },
          // The instant this conversation ended, which is the half-hour its
          // usage bills in: a conversation that ran across a peak boundary is
          // priced by the slot it finished in.
          at: Number.isFinite(Number(event.time)) ? Number(event.time) : 0,
        });
      }
      openTurn = null;
    }
  }
  return { tokens, turns, last, steps };
}

/**
 * @param message - a user message, or anything else.
 * @returns the first visible character of its text, or an empty string.
 */
function firstCharacterOf(message) {
  // `Array.from` splits by code point, so an astral character stays one element
  // instead of being torn into its two UTF-16 surrogates.
  const seed = (text) => (typeof text === 'string' ? Array.from(text.trim())[0] || '' : '');
  if (typeof message === 'string') return seed(message);
  if (message === null || typeof message !== 'object') return '';
  if (typeof message.text === 'string') return seed(message.text);
  const content = message.content;
  if (typeof content === 'string') return seed(content);
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
        return seed(block.text);
      }
    }
  }
  return '';
}

/**
 * @param value - candidate rule list from disk or from the Client.
 * @returns the accepted rules.
 */
function readRules(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    const rule = normalizeRule(entry);
    if (rule !== null) out.push(rule);
  }
  return out.slice(0, 20);
}

/**
 * @param grid - 48-character peak grid.
 * @param slot - half-hour slot index.
 * @returns true when that slot is peak, false when it is valley.
 */
function isPeak(grid, slot) {
  const index = Math.min(SLOTS_PER_DAY - 1, Math.max(0, Math.round(Number(slot))));
  return gridOf(grid).charAt(index) === '1';
}

/**
 * @param tokens - usage buckets, or null.
 * @returns normalized token counts; cache writes bill at the miss price.
 */
function tokensOf(tokens) {
  const source = tokens !== null && typeof tokens === 'object' ? tokens : {};
  const count = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  };
  const hit = count(source.hit);
  const miss = count(source.miss);
  const write = count(source.write);
  const out = count(source.out);
  return { hit, miss, write, out, billedMiss: miss + write };
}

/**
 * Estimate one usage record under one pricing rule.
 *
 * The peak grid decides which of the rule's two tier sets applies, so the same
 * rule prices a workday noon and a holiday noon differently.
 *
 * @param tokens - usage buckets.
 * @param rule - pricing rule, or null when none is configured.
 * @param dayType - `workday` or `holiday`, decided by the caller's calendar.
 * @param slot - half-hour slot index in the caller's local day.
 * @returns the estimate, or null when there is no rule to price with.
 */
function estimateUsage(tokens, rule, dayType, slot) {
  if (rule === null) return null;
  const counts = tokensOf(tokens);
  const type = dayTypeOf(dayType);
  const peak = isPeak(rule.grid[type], slot);
  const prices = peak ? rule.dayTypes[type].peak : rule.dayTypes[type].valley;
  const hitCost = (counts.hit / 1e6) * prices.hit;
  const missCost = (counts.billedMiss / 1e6) * prices.miss;
  const outCost = (counts.out / 1e6) * prices.out;
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    peak,
    dayType: type,
    slot: Math.min(SLOTS_PER_DAY - 1, Math.max(0, Math.round(Number(slot)))),
    tokens: { hit: counts.hit, miss: counts.billedMiss, out: counts.out },
    prices: { hit: prices.hit, miss: prices.miss, out: prices.out },
    costs: { hit: hitCost, miss: missCost, out: outCost, total: hitCost + missCost + outCost },
  };
}

/**
 * @param rules - configured rules.
 * @param activeRuleId - the selected rule id.
 * @returns the active rule, or the first configured one, or null.
 */
function activeRuleOf(rules, activeRuleId) {
  if (rules.length === 0) return null;
  const found = rules.find((rule) => rule.id === activeRuleId);
  return found === undefined ? rules[0] : found;
}

/**
 * Read one wallet entry defensively.
 * @param wallets - candidate wallet list.
 * @returns display-ready wallets.
 */
function readWallets(wallets) {
  if (!Array.isArray(wallets)) return [];
  const out = [];
  for (const wallet of wallets) {
    if (wallet === null || typeof wallet !== 'object') continue;
    const currency = typeof wallet.currency === 'string' ? wallet.currency : '';
    if (currency.length === 0) continue;
    out.push({
      currency,
      total: typeof wallet.total_balance === 'string' ? wallet.total_balance : String(wallet.total_balance ?? ''),
      granted: typeof wallet.granted_balance === 'string' ? wallet.granted_balance : String(wallet.granted_balance ?? ''),
      toppedUp: typeof wallet.topped_up_balance === 'string' ? wallet.topped_up_balance : String(wallet.topped_up_balance ?? ''),
    });
  }
  return out;
}

/**
 * One balance failure carrying the category the console renders.
 *
 * @param code - `invalid` for a refused key, `network` for anything that did not
 *   complete normally.
 * @param message - short, display-safe reason.
 * @returns the categorized error.
 */
function balanceError(code, message) {
  const error = new Error(message);
  error.balanceCode = code;
  return error;
}

/**
 * Query the Platform balance endpoint with one API key.
 * @param apiKey - bearer credential.
 * @returns the accepted balance payload.
 * @throws Error carrying a short, display-safe reason and `balanceCode`.
 */
async function requestBalance(apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(BALANCE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw balanceError('invalid', `API key rejected (HTTP ${String(response.status)})`);
    }
    if (!response.ok) throw balanceError('network', `balance endpoint returned HTTP ${String(response.status)}`);
    const body = await response.json();
    if (body === null || typeof body !== 'object') throw balanceError('network', 'balance endpoint returned a non-object body');
    const wallets = readWallets(body.balance_infos);
    if (wallets.length === 0) throw balanceError('network', 'balance endpoint returned no wallet');
    return { isAvailable: body.is_available !== false, wallets };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw balanceError('network', 'balance request timed out');
    if (error instanceof Error && typeof error.balanceCode === 'string') throw error;
    // A thrown fetch is a transport failure: the key may be fine, the network
    // is not.
    throw balanceError('network', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Balance console state: durable API key, scheduled Platform polling.
 *
 * The Client reaches it over an authenticated HTTP route rather than a Remote
 * namespace, so the only dependencies are the Web server it registers on and
 * the connection service that authenticates the request.
 */
class BalanceConsoleState {
  /**
   * @param dependencies - credential reader/writer resolved by the caller.
   */
  constructor(dependencies) {
    this.dependencies = dependencies === undefined ? {} : dependencies;
    this.config = loadConfig();
    /** Epoch milliseconds of the last Client activity heartbeat. */
    this.lastActiveAt = 0;
    /** Whether a balance request is in flight. */
    this.inFlight = false;
    /** Earliest epoch millisecond at which the next automatic poll may start. */
    this.nextPollAt = 0;
    /** Transient status label for the console's last action. */
    this.notice = '';
    /** Display-safe error from the last manual action. */
    this.failure = '';
    /** Category of the last failed read: `invalid`, `network`, or empty. */
    this.readErrorCode = '';
    /** Per-Session cache of folded log prices, keyed by Session id and revision. */
    this.sessionCache = new Map();
  }

  /**
   * @param now - epoch milliseconds.
   * @returns whether a Client reported activity recently.
   */
  isClientActive(now) {
    return now - this.lastActiveAt < ACTIVE_TTL_MS;
  }

  /**
   * @param now - epoch milliseconds.
   * @returns display-safe console state.
   */
  view(now = Date.now()) {
    const configured = this.config.apiKey.length > 0 || this.fallbackKeyPresent === true;
    // One status word the Client renders directly, so the four friendly states
    // are decided here rather than guessed from loose flags.
    const state = !configured
      ? 'notConfigured'
      : this.readErrorCode === 'invalid'
        ? 'invalidKey'
        : this.readErrorCode === 'network'
          ? 'network'
          : 'online';
    return {
      configured,
      loggedIn: configured,
      savedHere: this.config.apiKey.length > 0,
      state,
      keyHint: this.config.keyHint,
      intervalSeconds: this.config.intervalSeconds,
      budget: this.config.budget,
      ledger: this.config.ledger,
      /** Timestamp of the newest recorded change, so the Client can mark its head row. */
      newestChangeAt: this.config.ledger.reduce((newest, entry) => (Number(entry.at) > newest ? Number(entry.at) : newest), 0),
      /** Deduction size that raises a warning, and the accent it paints. */
      warnThreshold: this.config.warnThreshold,
      warnColor: this.config.warnColor,
      warnSeconds: this.config.warnSeconds,
      /** Forecast settings for the next conversation. */
      literaryHitRate: this.config.literaryHitRate,
      predictEnabled: this.config.predictEnabled,
      snapshot: this.config.snapshot,
      updatedAt: this.config.updatedAt,
      error: this.failure.length > 0 ? this.failure : this.config.error,
      notice: this.notice,
      ageSeconds: this.config.updatedAt === 0 ? null : Math.max(0, Math.round((now - this.config.updatedAt) / 1_000)),
      clientActive: this.isClientActive(now),
      inFlight: this.inFlight,
      /** Provider route in effect by default; the Client hides outside DeepSeek. */
      provider: this.readProvider(),
      /** Pricing rules and the selected one, so the Client can price usage. */
      pricingRules: this.config.pricingRules,
      activeRuleId: this.config.activeRuleId,
      /** The Host's own zone, shown for reference; billing uses the caller's. */
      hostTimezone: typeof Intl === 'object' && typeof Intl.DateTimeFormat === 'function' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '',
      /** The Host's wall clock, in 24-hour terms, which decides the billing slot. */
      hostHour24: new Date(now).getHours(),
      hostMinute: new Date(now).getMinutes(),
    };
  }

  /**
   * Estimate one usage record.
   * @param tokens - usage buckets from the Client's token projection.
   * @param anchor - `{ dayType, slot }` from the caller's local calendar.
   * @returns the estimate, or null when no pricing rule exists.
   */
  estimate(tokens, anchor) {
    const rule = activeRuleOf(this.config.pricingRules, this.config.activeRuleId);
    if (rule === null) return null;
    const source = anchor !== null && typeof anchor === 'object' ? anchor : {};
    return estimateUsage(tokens, rule, source.dayType, anchorSlot(source));
  }

  /**
   * Price every live Session's cumulative usage for the sidebar's hover card.
   *
   * The provider usage projection is a whole-log cumulative, so one Host-side
   * read per Session is enough; each Session's turn labels are folded once and
   * cached until its log grows or the billing bucket changes.
   *
   * @param anchor - `{ dayType, slot }` from the caller's local calendar.
   * @returns one row per live Session, newest figures first.
   */
  sessionEstimates(anchor) {
    return this.estimateAllSessions(anchor);
  }

  /**
   * Price every stored Session straight from its durable log.
   *
   * The live agent registry only knows Sessions that currently have an agent,
   * which excludes every idle conversation; the persistence service lists them
   * all, so the sidebar can show a figure for any Session the user hovers. Each
   * Session's fold is cached against the log revision that produced it.
   *
   * @param anchor - `{ dayType, slot }` from the caller's local calendar.
   * @returns the priced rows.
   */
  async estimateAllSessions(anchor) {
    const rule = activeRuleOf(this.config.pricingRules, this.config.activeRuleId);
    if (rule === null) return { rows: [] };
    const persistence = this.dependencies.getSessionPersistence();
    if (persistence === undefined || persistence === null || typeof persistence.list !== 'function') {
      return { rows: [] };
    }
    const source = anchor !== null && typeof anchor === 'object' ? anchor : {};
    const fallbackDayType = dayTypeOf(source.dayType);
    const fallbackSlot = anchorSlot(source);
    let snapshots;
    try {
      snapshots = await persistence.list();
    } catch (error) {
      return { rows: [] };
    }
    if (!Array.isArray(snapshots)) return { rows: [] };
    const rows = [];
    for (const snapshot of snapshots) {
      try {
        const id = snapshot.header === undefined || snapshot.header === null ? '' : String(snapshot.header.id);
        if (id.length === 0) continue;
        const revision = String(snapshot.revision);
        const cached = this.sessionCache.get(id);
        let fold = cached !== undefined && cached.revision === revision ? cached.fold : null;
        if (fold === null) {
          const handle = await persistence.open(id, 'read');
          const result = await handle.read();
          await handle.close();
          fold = foldSessionsLog(Array.isArray(result.events) ? result.events : []);
          this.sessionCache.set(id, { revision, fold });
        }
        const source = anchor !== null && typeof anchor === 'object' ? anchor : {};
        // Every conversation is priced in the slot it ended in, so the Session
        // figure is the sum of those bills rather than one price applied to the
        // whole log; the current anchor only prices a Session with no timestamps.
        const fallbackDayType = dayTypeOf(source.dayType);
        const fallbackSlot = anchorSlot(source);
        const turns = fold.turns.map((turn) => {
          const dayType = turn.at > 0 ? dayTypeAt(turn.at) : fallbackDayType;
          const slot = turn.at > 0 ? anchorSlot(null, turn.at) : fallbackSlot;
          const turnEstimate = estimateUsage({ hit: turn.tokens.hit, miss: turn.tokens.miss, out: turn.tokens.out }, rule, dayType, slot);
          return {
            turn: turn.turn,
            seq: turn.seq,
            label: turn.label,
            at: turn.at,
            tokens: turn.tokens,
            peak: turnEstimate === null ? false : turnEstimate.peak,
            total: turnEstimate === null ? 0 : turnEstimate.costs.total,
          };
        });
        rows.push({
          sessionId: id,
          title: snapshot.header !== undefined && snapshot.header !== null && typeof snapshot.header.title === 'string' ? snapshot.header.title : '',
          // The Session total is the sum of the per-conversation bills, each
          // already rounded to 分, so the aggregate equals its parts.
          total: Math.round(turns.reduce((sum, turn) => sum + turn.total, 0) * 100) / 100,
          tokens: { hit: fold.tokens.hit, miss: fold.tokens.miss, out: fold.tokens.out },
          turns,
          // The next-conversation forecast starts from the last step's own
          // buckets and needs the output distribution of every step, so both
          // travel with the row. The tail is capped because a long Session has
          // thousands of steps and a percentile does not need all of them.
          last: fold.last,
          steps: fold.steps.slice(-STEP_SAMPLE_LIMIT),
          stepCount: fold.steps.length,
        });
      } catch {
        /* One unreadable log must not fail the whole listing. */
      }
    }
    return { rows };
  }


  /**
   * Read the provider route in effect for the open work.
   *
   * The durable `modelSelection` projection of every live root Session carries
   * the provider that Session will use next, so switching a conversation away
   * from DeepSeek hides the console. A provider other than the Host default
   * wins, because the default is what remains when no Session is live yet.
   * @returns the provider id, or an empty string when it cannot be read.
   */
  readProvider() {
    const readDefault = this.dependencies.readDefaultProvider;
    let fallback = '';
    if (typeof readDefault === 'function') {
      try {
        fallback = readDefault();
      } catch {
        fallback = '';
      }
    }
    try {
      const agents = this.dependencies.getAgents();
      const projections = this.dependencies.getSessionProjections();
      if (agents === undefined || agents === null || typeof agents.roots !== 'function') return fallback;
      if (projections === undefined || projections === null || typeof projections.stateOf !== 'function') return fallback;
      const roots = agents.roots();
      if (!Array.isArray(roots)) return fallback;
      for (const agent of roots) {
        const state = projections.stateOf(agent.session, 'modelSelection');
        if (state === undefined || state === null) continue;
        const candidates = [state.pending, state.lastUsed];
        for (const candidate of candidates) {
          if (candidate === null || candidate === undefined || typeof candidate.provider !== 'string') continue;
          if (candidate.provider.length > 0 && candidate.provider !== fallback) return candidate.provider;
        }
      }
    } catch {
      /* A missing projection service must not break the console. */
    }
    return fallback;
  }

  /**
   * Resolve the API key to query with: the console's saved key first, then the
   * Harness-managed credential so an already-configured machine needs no login.
   * @returns the key, or an empty string while unconfigured.
   */
  async resolveKey() {
    if (this.config.apiKey.length > 0) {
      this.fallbackKeyPresent = false;
      return this.config.apiKey;
    }
    const read = this.dependencies.resolveCredential;
    if (typeof read !== 'function') {
      this.fallbackKeyPresent = false;
      return '';
    }
    try {
      const value = await read();
      this.fallbackKeyPresent = typeof value === 'string' && value.length > 0;
      return this.fallbackKeyPresent ? value : '';
    } catch {
      this.fallbackKeyPresent = false;
      return '';
    }
  }

  /**
   * Record one Client heartbeat so polling stays scoped to an open console.
   */
  touch() {
    this.lastActiveAt = Date.now();
  }

  /**
   * Read the balance once and fold the outcome into the durable configuration.
   * @param reason - audit label for the initiating caller.
   * @returns the state the Client should render.
   */
  async poll(reason) {
    if (this.inFlight) return this.view();
    const key = await this.resolveKey();
    if (key.length === 0) {
      this.config.error = '';
      this.readErrorCode = '';
      this.notice = 'not-signed-in';
      return this.view();
    }
    this.inFlight = true;
    try {
      const snapshot = await requestBalance(key);
      this.config.snapshot = snapshot;
      this.config.updatedAt = Date.now();
      this.config.error = '';
      this.failure = '';
      this.readErrorCode = '';
      this.notice = reason === 'manual' ? 'refreshed' : '';
      this.recordChange(snapshot.wallets);
      if (this.config.apiKey.length > 0) saveConfig(this.config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.config.error = message;
      this.failure = reason === 'manual' ? message : '';
      this.readErrorCode = error !== null && error !== undefined && typeof error.balanceCode === 'string' ? error.balanceCode : 'network';
      this.notice = '';
    } finally {
      this.inFlight = false;
      this.nextPollAt = Date.now() + this.config.intervalSeconds * 1_000;
    }
    return this.view();
  }

  /**
   * Fold one reading into the ledger: a change against the previous reading
   * becomes one entry, and the first reading only establishes the baseline so a
   * fresh install does not open with a fabricated bill.
   * @param wallets - wallet list from the accepted balance payload.
   * @returns true when an entry was appended.
   */
  recordChange(wallets) {
    const spendable = spendableFromWallets(wallets);
    if (spendable === null) return false;
    const previous = this.config.ledgerTotal;
    this.config.ledgerTotal = spendable;
    if (previous === null || !Number.isFinite(Number(previous))) return false;
    const delta = spendable - Number(previous);
    if (Math.abs(delta) < LEDGER_EPSILON) return false;
    const wallet = Array.isArray(wallets) ? wallets.find((entry) => entry !== null && entry !== undefined) : undefined;
    const entry = {
      at: Date.now(),
      amount: Math.round(delta * 100) / 100,
      currency: wallet !== undefined && typeof wallet.currency === 'string' ? wallet.currency : '',
      after: Math.round(spendable * 100) / 100,
    };
    this.config.ledger = [...this.config.ledger, entry].slice(-LEDGER_LIMIT);
    return true;
  }

  /**
   * Polling scheduler: only an active, signed-in console consumes Platform
   * requests.
   */
  tick() {
    const now = Date.now();
    if (this.inFlight) return;
    if (!this.isClientActive(now)) return;
    if (now < this.nextPollAt) return;
    this.nextPollAt = now + this.config.intervalSeconds * 1_000;
    void this.poll('auto').catch(() => undefined);
  }

  /**
   * Client entry point: heartbeat plus the current state.
   * @returns the console state.
   */
  getState() {
    this.touch();
    return this.view();
  }

  /**
   * Client entry point: force one Platform read now.
   * @returns the console state after the read.
   */
  async refresh() {
    this.touch();
    this.nextPollAt = 0;
    return await this.poll('manual');
  }

  /**
   * Persist a user-editable setting.
   * @param patch - partial settings; `intervalSeconds` and `budget` are honored.
   * @returns the console state.
   */
  setConfig(patch) {
    this.touch();
    const input = patch !== null && typeof patch === 'object' ? patch : {};
    if (input.intervalSeconds !== undefined) {
      this.config.intervalSeconds = normalizeInterval(input.intervalSeconds);
    }
    if (input.budget !== undefined) {
      const budget = Number(input.budget);
      if (!Number.isFinite(budget) || budget < 0) throw new RangeError('budget must be a non-negative number');
      this.config.budget = Math.round(budget * 100) / 100;
    }
    if (input.warnThreshold !== undefined) {
      const threshold = Number(input.warnThreshold);
      if (!Number.isFinite(threshold) || threshold < 0) throw new RangeError('warnThreshold must be a non-negative number');
      this.config.warnThreshold = Math.round(threshold * 100) / 100;
    }
    if (input.warnColor !== undefined) {
      const color = typeof input.warnColor === 'string' ? input.warnColor.trim() : '';
      if (!WARN_COLOR_PATTERN.test(color)) throw new RangeError('warnColor must be written as rgb(r, g, b)');
      this.config.warnColor = color;
    }
    if (input.warnSeconds !== undefined) {
      const seconds = Number(input.warnSeconds);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_WARN_SECONDS) {
        throw new RangeError(`warnSeconds must be a number between 0 and ${MAX_WARN_SECONDS}`);
      }
      this.config.warnSeconds = Math.round(seconds * 10) / 10;
    }
    if (input.literaryHitRate !== undefined) {
      const rate = Number(input.literaryHitRate);
      if (!Number.isFinite(rate) || rate < MIN_LITERARY_HIT_RATE || rate > MAX_LITERARY_HIT_RATE) {
        throw new RangeError(`literaryHitRate must be a percentage between ${MIN_LITERARY_HIT_RATE} and ${MAX_LITERARY_HIT_RATE}`);
      }
      this.config.literaryHitRate = Math.round(rate * 100) / 100;
    }
    if (input.predictEnabled !== undefined) {
      this.config.predictEnabled = input.predictEnabled === true;
    }
    if (Array.isArray(input.pricingRules)) {
      this.config.pricingRules = readRules(input.pricingRules);
      if (!this.config.pricingRules.some((rule) => rule.id === this.config.activeRuleId)) {
        this.config.activeRuleId = this.config.pricingRules.length > 0 ? this.config.pricingRules[0].id : '';
      }
      this.sessionCache.clear();
    }
    if (typeof input.activeRuleId === 'string') {
      this.config.activeRuleId = input.activeRuleId;
      this.sessionCache.clear();
    }
    this.failure = '';
    this.config.error = '';
    this.notice = 'saved';
    saveConfig(this.config);
    return this.view();
  }

  /**
   * Validate and store an API key, then read the balance once so the user sees
   * the outcome of this exact login.
   * @param apiKey - raw key typed by the user.
   * @returns the console state, carrying `error` when the key was refused.
   */
  async login(apiKey) {
    this.touch();
    const candidate = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (candidate.length < 8) {
      this.failure = 'API key looks too short';
      this.notice = '';
      return this.view();
    }
    try {
      const snapshot = await requestBalance(candidate);
      this.config.apiKey = candidate;
      this.config.keyHint = maskKey(candidate);
      this.config.snapshot = snapshot;
      this.config.updatedAt = Date.now();
      this.config.error = '';
      this.failure = '';
      this.notice = 'signed-in';
      // A new sign-in re-baselines the ledger: the first reading of a key is not
      // a change, so the console does not open with a fabricated bill.
      this.config.ledger = [];
      this.config.ledgerTotal = spendableFromWallets(snapshot.wallets);
      saveConfig(this.config);
      const write = this.dependencies.storeCredential;
      if (typeof write === 'function') {
        try {
          await write(candidate);
        } catch {
          /* The console keeps its own copy; a read-only credential store must not fail the login. */
        }
      }
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error);
      this.notice = '';
    }
    return this.view();
  }

  /**
   * Drop the recorded bills, keeping the current reading as the baseline.
   * @returns the console state.
   */
  clearLedger() {
    this.touch();
    this.config.ledger = [];
    this.config.ledgerTotal = spendableFromWallets(this.config.snapshot === null ? [] : this.config.snapshot.wallets);
    this.notice = 'ledger-cleared';
    saveConfig(this.config);
    return this.view();
  }

  /**
   * Forget the key stored by the console. A credential managed elsewhere stays.
   * @returns the console state.
   */
  logout() {
    this.touch();
    this.config.apiKey = '';
    this.config.keyHint = '';
    this.config.snapshot = null;
    this.config.updatedAt = 0;
    this.config.error = '';
    this.failure = '';
    this.config.ledger = [];
    this.config.ledgerTotal = null;
    this.notice = 'signed-out';
    saveConfig(this.config);
    return this.view();
  }
}

/**
 * Read and decode one JSON request body.
 * @param req - incoming request.
 * @returns the decoded body, or an empty object.
 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text.length === 0) return {};
  const parsed = JSON.parse(text);
  return parsed !== null && typeof parsed === 'object' ? parsed : {};
}

/**
 * Write one JSON response.
 * @param res - response to own.
 * @param status - HTTP status code.
 * @param payload - JSON-serializable payload.
 */
function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(body);
}

/**
 * Build the credential bridge from the optional Harness credential service.
 * @param ctx - plugin Context.
 * @returns reader and writer, either of which may be absent.
 */
function credentialBridge(ctx) {
  const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined;
  const bridge = {};
  if (credentials !== undefined && credentials !== null) {
    bridge.resolveCredential = async () => {
      const resolved = await credentials.resolve(FALLBACK_CREDENTIAL_REF);
      const value = resolved === undefined || resolved === null ? undefined : resolved.value;
      return typeof value === 'string' ? value : '';
    };
    bridge.storeCredential = async (value) => {
      await credentials.set(FALLBACK_CREDENTIAL_REF, value);
    };
  }
  bridge.readDefaultProvider = () => {
    const defaultModel = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined;
    if (defaultModel === undefined || defaultModel === null || typeof defaultModel.currentSelection !== 'function') return '';
    const selection = defaultModel.currentSelection();
    return selection !== null && selection !== undefined && typeof selection.provider === 'string' ? selection.provider : '';
  };
  bridge.getSessionProjections = () => (typeof ctx.get === 'function' ? ctx.get('sessionProjections') : undefined);
  bridge.getAgents = () => (typeof ctx.get === 'function' ? ctx.get('agents') : undefined);
  bridge.getSessionPersistence = () => (typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : undefined);
  return bridge;
}

/**
 * Hard dependency: this plugin activates only once the Web server exists, so
 * its route is registered before any browser can call it.
 */
export const inject = ['webServer'];

/**
 * Register the state route on the Web server for the lifetime of the plugin.
 * @param ctx - plugin Context owning the effect.
 * @param server - Web server service.
 * @param state - console state read and written by the route.
 */
function registerRoute(ctx, server, state) {
  ctx.effect(() => {
    const disposer = server.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (req, res) => {
        // The connection service owns browser authentication and is resolved per
        // request, because it may be provided after this route is registered. An
        // unauthenticated request is answered with its own 401 before any state
        // is disclosed.
        const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
        if (connection !== undefined && connection !== null && typeof connection.authorizeIndex === 'function') {
          if (!connection.authorizeIndex(req, res)) return;
        }
        try {
          const body = req.method === 'POST' ? await readJsonBody(req) : {};
          const action = typeof body.action === 'string' ? body.action : 'getState';
          if (body.running === true) state.touch();
          let value;
          if (action === 'refresh') value = await state.refresh();
          else if (action === 'login') value = await state.login(body.apiKey);
          else if (action === 'logout') value = state.logout();
          else if (action === 'clearLedger') value = state.clearLedger();
          else if (action === 'setConfig') value = state.setConfig(body.patch);
          else if (action === 'estimate') value = { estimate: state.estimate(body.tokens, body.anchor) };
          else if (action === 'sessionEstimates') {
            const rule = activeRuleOf(state.config.pricingRules, state.config.activeRuleId);
            const result = await state.sessionEstimates(body.anchor);
            value = { rows: result.rows, ruleName: rule === null ? '' : rule.name };
          }
          else value = state.getState();
          writeJson(res, 200, { ok: true, value });
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    });
    return () => {
      disposer();
    };
  }, 'balance-console: state route');
}

/**
 * Install the balance console Host half.
 * @param ctx - plugin Context supplied by the Loader.
 */
export function apply(ctx) {
  const state = new BalanceConsoleState(credentialBridge(ctx));

  ctx.effect(() => {
    const timer = setInterval(() => {
      state.tick();
    }, TICK_MS);
    if (typeof timer.unref === 'function') timer.unref();
    return () => {
      clearInterval(timer);
    };
  }, 'balance-console: polling scheduler');

  const readServer = () => (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined);
  let registered = false;
  const registerOnce = (server) => {
    if (registered || server === undefined || server === null || typeof server.register !== 'function') return;
    registered = true;
    registerRoute(ctx, server, state);
  };

  registerOnce(readServer());
  if (!registered) {
    // This plugin boots before the Web server exists in this composition, so wait
    // for the service. `ctx.inject` is the framework form of that wait, and the
    // bounded poll covers a registry that does not re-enter the callback.
    try {
      ctx.inject(['webServer'], (injected) => {
        registerOnce(injected === undefined || injected === null ? undefined : injected.webServer);
      });
    } catch {
      /* The bounded poll below still covers this composition. */
    }
    ctx.effect(() => {
      const deadline = Date.now() + 30_000;
      const timer = setInterval(() => {
        const server = readServer();
        if (server !== undefined && server !== null) {
          clearInterval(timer);
          registerOnce(server);
          return;
        }
        if (Date.now() > deadline) clearInterval(timer);
      }, 200);
      if (typeof timer.unref === 'function') timer.unref();
      return () => {
        clearInterval(timer);
      };
    }, 'balance-console: route wait');
  }

  return state;
}

export { BalanceConsoleState, foldSessionsLog };
export default apply;
