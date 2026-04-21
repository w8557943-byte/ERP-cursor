import tcb from '@cloudbase/node-sdk';

const argv = process.argv.slice(2);
const getArg = (name, def = '') => {
  const key = name.startsWith('--') ? name : `--${name}`;
  const found = argv.find((a) => a === key || a.startsWith(`${key}=`));
  if (!found) return def;
  if (found.includes('=')) return found.split('=').slice(1).join('=');
  const idx = argv.indexOf(found);
  return (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) ? argv[idx + 1] : def;
};

const envId = getArg('env') || process.env.TCB_ENV || process.env.WX_CLOUD_ENV || '';
const secretId = getArg('secretId') || process.env.TCB_SECRET_ID || process.env.SECRET_ID || '';
const secretKey = getArg('secretKey') || process.env.TCB_SECRET_KEY || process.env.SECRET_KEY || '';
const token = getArg('token') || process.env.TCB_TOKEN || '';

if (!envId) {
  console.error('缺少环境ID：请设置 TCB_ENV 或 WX_CLOUD_ENV');
  process.exit(1);
}
if (!secretId || !secretKey) {
  console.error('缺少凭证：请设置 TCB_SECRET_ID 和 TCB_SECRET_KEY');
  process.exit(1);
}

const ACTIONS = (getArg('actions') || process.env.ACTIONS || 'getOrders,getPurchaseOrders,getProductionPlans')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const TOTAL = Math.max(1, Number(getArg('total') || process.env.TOTAL || 300) || 300);
const CONCURRENCY = Math.max(1, Number(getArg('concurrency') || process.env.CONCURRENCY || 30) || 30);
const LIMIT = Math.max(5, Math.min(100, Number(getArg('limit') || process.env.LIMIT || 50) || 50));
const PAGES = Math.max(1, Math.min(10, Number(getArg('pages') || process.env.PAGES || 3) || 3));
const DEBUG = String(getArg('debug') || process.env.DEBUG || '').toLowerCase() === 'true';
const SAMPLE_ID_COUNT = Math.max(10, Math.min(200, Number(getArg('sampleIdCount') || process.env.SAMPLE_ID_COUNT || 50) || 50));

const app = tcb.init(token
  ? { env: envId, secretId, secretKey, token }
  : { env: envId, secretId, secretKey });

const call = async (name, payload) => {
  const started = Date.now();
  let ok = false;
  let error = null;
  let result = null;
  try {
    const res = await app.callFunction({ name, data: payload });
    const out = res && res.result ? res.result : res;
    ok = out && (out.success !== false);
    result = out;
  } catch (e) {
    ok = false;
    error = e;
  }
  const ms = Date.now() - started;
  return { ok, ms, error, result };
};

const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
};

const summarize = (samples) => {
  const nums = samples.slice().sort((a, b) => a - b);
  const sum = nums.reduce((s, v) => s + v, 0);
  return {
    count: nums.length,
    min: nums[0] ?? 0,
    avg: nums.length ? Math.round(sum / nums.length) : 0,
    p50: percentile(nums, 50),
    p90: percentile(nums, 90),
    p95: percentile(nums, 95),
    p99: percentile(nums, 99),
    max: nums[nums.length - 1] ?? 0
  };
};

const prefetchIds = async () => {
  const ids = [];
  for (let page = 1; page <= Math.min(PAGES, 5) && ids.length < SAMPLE_ID_COUNT; page += 1) {
    const payload = { action: 'getOrders', params: { page, limit: LIMIT, withTotal: false, compact: true, debug: DEBUG } };
    const r = await call('erp-api', payload);
    const rows = r?.result?.data || [];
    for (const o of rows) {
      if (o && (o._id || o.id)) ids.push(o._id || o.id);
      if (ids.length >= SAMPLE_ID_COUNT) break;
    }
  }
  return ids;
};

const buildTasks = async () => {
  const tasks = [];
  const each = Math.max(1, Math.floor(TOTAL / ACTIONS.length));
  const leftover = TOTAL - each * ACTIONS.length;
  const ids = await prefetchIds().catch(() => []);

  for (let ai = 0; ai < ACTIONS.length; ai += 1) {
    const action = ACTIONS[ai];
    const count = ai === 0 ? each + leftover : each;
    for (let i = 0; i < count; i += 1) {
      if (action === 'getOrderDetail' && ids.length) {
        const id = ids[(i % ids.length)];
        tasks.push({ action, payload: { action: 'getOrderDetail', data: { id } } });
        continue;
      }
      const page = (i % PAGES) + 1;
      const params = { page, limit: LIMIT, withTotal: false, compact: true, debug: DEBUG };
      tasks.push({ action, payload: { action, params } });
    }
  }
  return tasks;
};

const run = async () => {
  const tasks = await buildTasks();
  const startedAt = Date.now();
  const samples = {};
  const errors = {};
  let cursor = 0;

  const step = async () => {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= tasks.length) return;
      const t = tasks[i];
      const r = await call('erp-api', t.payload);
      const key = t.action;
      if (!samples[key]) samples[key] = [];
      if (r.ok) {
        samples[key].push(r.ms);
      } else {
        samples[key].push(r.ms);
        const msg = String(r?.error?.message || r?.result?.message || 'unknown');
        errors[key] = (errors[key] || 0) + 1;
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.error(`[fail][${key}] ${msg}`);
        }
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => step()));
  const elapsedMs = Date.now() - startedAt;

  const report = [];
  for (const k of Object.keys(samples)) {
    const s = summarize(samples[k]);
    report.push({ action: k, ...s, failed: errors[k] || 0 });
  }
  report.sort((a, b) => (b.p95 - a.p95) || (b.avg - a.avg));

  const out = {
    envId,
    totalCalls: tasks.length,
    concurrency: CONCURRENCY,
    pages: PAGES,
    limit: LIMIT,
    elapsedMs,
    rps: Math.round((tasks.length / Math.max(1, elapsedMs)) * 1000),
    actions: ACTIONS,
    report
  };

  console.log(JSON.stringify(out, null, 2));

  // 额外输出“慢点位”前3
  const top = report.slice(0, 3);
  const lines = top.map((x, idx) => `${idx + 1}. ${x.action} p95=${x.p95}ms avg=${x.avg}ms max=${x.max}ms failed=${x.failed}`).join('\n');
  console.log(`\n慢点位TOP3：\n${lines}`);
};

run().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});
