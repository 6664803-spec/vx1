#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'lottery.db');
const OUT_PATH = path.join(ROOT, 'data', 'sequence-model.json');
const LOOKBACK = Number(process.argv[2] || 360);
const SOURCE = String(process.argv[3] || process.env.TRAIN_SOURCE || 'auto').toLowerCase();
const MIN_ROWS = 120;
const NUMBER_SET = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, '0'));
const ORDERS = [1, 2, 3, 4, 5];
const WINDOWS = [5, 10, 20];
const LAPLACE = 1;
const DEFAULT_BASE = 'https://yun.citi668.com/ui-04';
const DEFAULT_GAMENO = 21;
const DEFAULT_GAMEGROUPNO = 6;
const SOURCE_WEIGHTS = { csv: 0.78, history: 1.22, api: 1.0, db: 1.0, live: 1.2 };
const SOURCE_DECAY = { csv: 0.9996, history: 0.996, api: 0.998, db: 0.999, live: 1.0 };

function parseJsonSafe(val, fallback) { try { return JSON.parse(val); } catch { return fallback; } }
function round(n) { return Number(n.toFixed(6)); }
function clamp01(v) { return Math.max(0.0001, Math.min(1, Number(v) || 1)); }
function sampleWeight(draw, idx, total) {
  const source = String(draw?.source || 'db');
  const base = SOURCE_WEIGHTS[source] ?? 1;
  const decay = SOURCE_DECAY[source] ?? 1;
  const age = Math.max(0, total - 1 - idx);
  return base * Math.pow(decay, age);
}

function loadDrawsFromDb(sourceFilter = null, limit = null) {
  const db = new DatabaseSync(DB_PATH);
  const hasLimit = limit !== null && limit !== undefined && Number.isFinite(Number(limit));
  const limitValue = hasLimit ? Math.max(1, Math.floor(Number(limit))) : null;
  const rows = sourceFilter
    ? (hasLimit
      ? db.prepare('SELECT roundno, numbers_json, winning_time, source FROM draws WHERE source = ? ORDER BY roundno ASC LIMIT ?').all(sourceFilter, limitValue)
      : db.prepare('SELECT roundno, numbers_json, winning_time, source FROM draws WHERE source = ? ORDER BY roundno ASC').all(sourceFilter))
    : (hasLimit
      ? db.prepare('SELECT roundno, numbers_json, winning_time, source FROM draws ORDER BY roundno ASC LIMIT ?').all(limitValue)
      : db.prepare('SELECT roundno, numbers_json, winning_time, source FROM draws ORDER BY roundno ASC').all());
  return rows.map((r) => ({
    roundno: String(r.roundno),
    numbers: parseJsonSafe(r.numbers_json, []),
    winning_time: r.winning_time || null,
    source: r.source || 'db',
  }));
}

function parseDate(val) {
  try {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

async function fetchHistoryFromApi() {
  const payload = JSON.stringify({ gameno: DEFAULT_GAMENO, gamegroupno: DEFAULT_GAMEGROUPNO, pagesize: 180, curentsize: 1, transdate: '' });
  const res = await fetch(`${DEFAULT_BASE}/detail.aspx/GetWinningnohistoryList`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Content-Type': 'application/json; charset=utf-8',
      'Referer': `${DEFAULT_BASE}/detail.aspx?g=${DEFAULT_GAMENO}`,
      'Origin': DEFAULT_BASE,
    },
    body: payload,
  });
  if (!res.ok) throw new Error(`history api HTTP ${res.status}`);
  const text = await res.text();
  const outer = JSON.parse(text);
  const inner = parseJsonSafe(outer.d, null);
  if (!Array.isArray(inner) || inner.length < 3) throw new Error('invalid history payload');
  const rows = inner[1] || [];
  return rows.map((row) => ({
    roundno: String(row.roundno),
    numbers: Array.from({ length: 10 }, (_, i) => String(row[`lotteryno${i + 1}`]).padStart(2, '0')),
    winning_time: parseDate(row.winningtime),
    source: 'api',
  }));
}

function mergeDraws(...groups) {
  const map = new Map();
  for (const group of groups) {
    for (const draw of group || []) {
      if (!draw?.roundno) continue;
      map.set(String(draw.roundno), draw);
    }
  }
  return Array.from(map.values()).sort((a, b) => String(a.roundno).localeCompare(String(b.roundno)));
}

async function loadTrainingDraws() {
  if (SOURCE === 'db') return loadDrawsFromDb();
  if (SOURCE === 'csv') {
    const csvRows = loadDrawsFromDb('csv');
    if (csvRows.length < MIN_ROWS) throw new Error(`not enough csv rows (${csvRows.length} < ${MIN_ROWS})`);
    return csvRows;
  }
  if (SOURCE === 'history') {
    const historyRows = loadDrawsFromDb('history');
    if (historyRows.length < MIN_ROWS) throw new Error(`not enough history rows (${historyRows.length} < ${MIN_ROWS})`);
    return historyRows;
  }
  if (SOURCE === 'csv+history') {
    const csvRows = loadDrawsFromDb('csv');
    const historyRows = loadDrawsFromDb('history');
    const combined = mergeDraws(csvRows, historyRows);
    if (combined.length < MIN_ROWS) throw new Error(`not enough combined rows (${combined.length} < ${MIN_ROWS})`);
    return combined;
  }
  if (SOURCE === 'api') {
    const apiRows = await fetchHistoryFromApi();
    if (apiRows.length < MIN_ROWS) throw new Error(`not enough api rows (${apiRows.length} < ${MIN_ROWS})`);
    return apiRows;
  }

  const csvRows = loadDrawsFromDb('csv');
  const historyRows = loadDrawsFromDb('history');
  const combined = mergeDraws(csvRows, historyRows);
  if (combined.length >= MIN_ROWS) return combined;

  try {
    const apiRows = await fetchHistoryFromApi();
    const apiCombined = mergeDraws(historyRows, csvRows, apiRows);
    if (apiCombined.length >= MIN_ROWS) return apiCombined;
  } catch {
    // fallback below
  }

  const local = mergeDraws(csvRows, historyRows, loadDrawsFromDb());
  if (local.length >= MIN_ROWS) return local;
  return local;
}

function ageWeight(idx, total, decay) {
  if (!Number.isFinite(decay) || decay >= 1) return 1;
  const age = Math.max(0, total - 1 - idx);
  return Math.pow(decay, age);
}

function buildGlobalPriors(draws, pos, decay = 1) {
  const priors = Object.fromEntries(NUMBER_SET.map((n) => [n, LAPLACE]));
  for (let idx = 0; idx < draws.length; idx++) {
    const draw = draws[idx];
    const cur = String(draw.numbers[pos - 1]).padStart(2, '0');
    priors[cur] += sampleWeight(draw, idx, draws.length) * ageWeight(idx, draws.length, decay);
  }
  const total = NUMBER_SET.reduce((acc, n) => acc + priors[n], 0) || 1;
  return Object.fromEntries(NUMBER_SET.map((n) => [n, round(priors[n] / total)]));
}

function buildTransitions(draws, pos, decay = 1) {
  const transitions = {};
  for (const order of ORDERS) {
    transitions[order] = {};
    for (const prev of NUMBER_SET) {
      transitions[order][prev] = Object.fromEntries(NUMBER_SET.map((n) => [n, LAPLACE]));
    }
  }

  for (let idx = 1; idx < draws.length; idx++) {
    const cur = String(draws[idx].numbers[pos - 1]).padStart(2, '0');
    const curWeight = sampleWeight(draws[idx], idx, draws.length) * ageWeight(idx, draws.length, decay);
    for (const order of ORDERS) {
      if (idx - order < 0) continue;
      const prev = String(draws[idx - order].numbers[pos - 1]).padStart(2, '0');
      transitions[order][prev][cur] += curWeight;
    }
  }

  const normalized = {};
  for (const order of ORDERS) {
    normalized[order] = {};
    for (const prev of NUMBER_SET) {
      const row = transitions[order][prev];
      const rowSum = NUMBER_SET.reduce((acc, n) => acc + row[n], 0) || 1;
      normalized[order][prev] = {};
      for (const cur of NUMBER_SET) {
        normalized[order][prev][cur] = round(row[cur] / rowSum);
      }
    }
  }
  return normalized;
}

function candidateFeatures(draws, refIdx, pos, candidate, priors, transitions, orderWeights, decay = 1) {
  const prior = Number(priors[candidate] || 0);
  let transition = 0;
  let ordersUsed = 0;
  for (const order of ORDERS) {
    if (refIdx - order < 0) continue;
    const prev = String(draws[refIdx - order].numbers[pos - 1]).padStart(2, '0');
    const table = transitions[order]?.[prev];
    const prob = table ? Number(table[candidate] || 0) : 0;
    transition += prob * (orderWeights[order] || 0);
    ordersUsed += 1;
  }
  if (ordersUsed) transition /= ordersUsed;

  let window = 0;
  for (const size of WINDOWS) {
    const start = Math.max(0, refIdx - size + 1);
    let count = 0;
    let totalWeight = 0;
    for (let i = start; i <= refIdx; i++) {
      const actual = String(draws[i].numbers[pos - 1]).padStart(2, '0');
      const w = sampleWeight(draws[i], i, draws.length) * ageWeight(i, draws.length, decay);
      totalWeight += w;
      if (actual === candidate) count += w;
    }
    window += (count / Math.max(1e-9, totalWeight || size)) * (size === 5 ? 0.5 : size === 10 ? 0.3 : 0.2);
  }

  let lastSeen = -1;
  for (let i = refIdx; i >= 0; i--) {
    const actual = String(draws[i].numbers[pos - 1]).padStart(2, '0');
    if (actual === candidate) {
      lastSeen = refIdx - i;
      break;
    }
  }
  const gap = lastSeen >= 0 ? Math.min(1, Math.log(2 + lastSeen) / 3) : 1;

  return { prior, transition, window, gap };
}

function scoreCandidate(features, weights) {
  return features.prior * weights.prior + features.transition * weights.transition + features.window * weights.window + features.gap * weights.gap;
}

function evalCombination(draws, pos, priors, transitions, weights, orderWeights, decay = 1, startIdx = 0, endIdx = null) {
  let top1 = 0;
  let top3 = 0;
  let samples = 0;
  const from = Math.max(Math.max(ORDERS.length, 10), Math.max(0, Math.floor(startIdx)));
  const to = endIdx === null || endIdx === undefined ? draws.length : Math.min(draws.length, Math.floor(endIdx));
  for (let idx = from; idx < to; idx++) {
    const refIdx = idx - 1;
    if (refIdx < 0) continue;
    const actual = String(draws[idx].numbers[pos - 1]).padStart(2, '0');
    const ranked = NUMBER_SET.map((candidate) => {
      const features = candidateFeatures(draws, refIdx, pos, candidate, priors, transitions, orderWeights, decay);
      return { candidate, score: scoreCandidate(features, weights) };
    }).sort((a, b) => b.score - a.score);
    const top3List = ranked.slice(0, 3).map((x) => x.candidate);
    if (ranked[0]?.candidate === actual) top1 += 1;
    if (top3List.includes(actual)) top3 += 1;
    samples += 1;
  }
  return {
    top1Accuracy: samples ? (top1 / samples) * 100 : 0,
    top3Accuracy: samples ? (top3 / samples) * 100 : 0,
    samples,
  };
}

function trainPosition(draws, pos, options = {}) {
  const decay = Number.isFinite(Number(options.decay)) ? clamp01(Number(options.decay)) : 1;
  const priors = buildGlobalPriors(draws, pos, decay);
  const transitions = buildTransitions(draws, pos, decay);
  const trainEnd = Math.max(30, Math.floor(draws.length * 0.6));
  const validEnd = Math.max(trainEnd + 1, Math.floor(draws.length * 0.8));
  const validStart = Math.max(trainEnd, 30);
  const testStart = Math.max(validEnd, validStart + 1);

  const weightGrid = [];
  for (const prior of [0.15, 0.20, 0.25, 0.30]) {
    for (const transition of [0.35, 0.45, 0.55]) {
      for (const window of [0.10, 0.15, 0.20, 0.25]) {
        for (const gap of [0.05, 0.10, 0.15]) {
          const sum = prior + transition + window + gap;
          if (Math.abs(sum - 1) > 1e-9) continue;
          weightGrid.push({ prior, transition, window, gap });
        }
      }
    }
  }
  if (!weightGrid.length) weightGrid.push({ prior: 0.2, transition: 0.5, window: 0.2, gap: 0.1 });

  const orderWeights = { 1: 0.42, 2: 0.24, 3: 0.16, 4: 0.10, 5: 0.08 };
  let best = null;
  for (const weights of weightGrid) {
    const validation = evalCombination(draws, pos, priors, transitions, weights, orderWeights, decay, validStart, validEnd);
    const candidate = { weights, validation };
    if (!best || candidate.validation.top3Accuracy > best.validation.top3Accuracy || (candidate.validation.top3Accuracy === best.validation.top3Accuracy && candidate.validation.top1Accuracy > best.validation.top1Accuracy)) {
      best = candidate;
    }
  }

  const testEvaluation = evalCombination(draws, pos, priors, transitions, best.weights, orderWeights, decay, testStart, draws.length);
  return {
    priors,
    transitions,
    orders: ORDERS,
    windowSizes: WINDOWS,
    orderWeights,
    weights: best.weights,
    validation: best.validation,
    testEvaluation,
  };
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`DB not found: ${DB_PATH}`);
    process.exit(1);
  }

  const draws = await loadTrainingDraws();
  if (draws.length < MIN_ROWS) {
    console.error(`Not enough draws to train (${draws.length} < ${MIN_ROWS}).`);
    process.exit(1);
  }

  const sourceBreakdown = draws.reduce((acc, d) => {
    const key = String(d.source || 'db');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const csvCount = sourceBreakdown.csv || 0;
  const historyCount = sourceBreakdown.history || 0;
  const apiCount = sourceBreakdown.api || 0;
  const artifact = {
    name: 'sequence-markov-v4',
    version: 'api-history-rolling-multifeature',
    createdAt: new Date().toISOString(),
    lookback: draws.length,
    sourceRows: draws.length,
    sourceBreakdown,
    blend: 0.68,
    featureText: '1~5阶转移 + 5/10/20窗口热度 + 缺口 + 先验 + 历史CSV + 实时history',
    note: 'Per-position 1/2/3/4/5-order transitions with rolling windows and priors; trained from CSV base plus live history rows, blended with live trend heuristics in server.',
    trainingSource: sourceBreakdown.csv && sourceBreakdown.history ? 'csv+history' : (sourceBreakdown.api ? 'api' : (sourceBreakdown.csv ? 'csv' : 'history')),
    trainingTotals: { csv: csvCount, history: historyCount, api: apiCount, total: draws.length },
    positions: {},
  };

  for (let pos = 1; pos <= 10; pos++) {
    artifact.positions[String(pos)] = trainPosition(draws, pos);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(artifact, null, 2));
  console.log(`wrote ${OUT_PATH}`);
  console.log(JSON.stringify({
    name: artifact.name,
    trainingSource: artifact.trainingSource,
    trainingTotals: artifact.trainingTotals,
    featureText: artifact.featureText,
    pos1: artifact.positions['1'],
    pos10: artifact.positions['10'],
  }, null, 2));
}

main().catch((err) => {
  console.error(String(err.stack || err));
  process.exit(1);
});
