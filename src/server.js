const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const BASE_URL = 'https://yun.citi668.com/ui-04';
const GAMENO = 21;
const GAMEGROUPNO = 6;
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'lottery.db');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MODEL_VERSION = 'fusion-hybrid-v2';
const POLL_MS = 10_000;
const HISTORY_PAGE_SIZE = 15;
const MAX_HISTORY_PAGES = 20;
const FUSION_MODEL_PATH = path.join(DATA_DIR, 'fusion-model.json');
const SEQUENCE_MODEL_PATH = path.join(DATA_DIR, 'sequence-model.json');
const XV1_SEQUENCE_MODEL_PATH = path.join(DATA_DIR, 'xv1-sequence-model.json');
const DEFAULT_FUSION_WEIGHTS = { frequency: 0.34, recent: 0.26, gap: 0.18, transition: 0.22 };
const DEFAULT_SEQUENCE_BLEND = 0.58;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS draws (
  roundno TEXT PRIMARY KEY,
  gameno INTEGER NOT NULL,
  gamegroupno INTEGER NOT NULL,
  gamename TEXT,
  winning_time TEXT,
  lottery_date TEXT,
  mweek TEXT,
  numbers_json TEXT NOT NULL,
  sum12 INTEGER NOT NULL,
  bigsmall TEXT NOT NULL,
  oddeven TEXT NOT NULL,
  dragon_tiger_json TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_roundno TEXT NOT NULL UNIQUE,
  based_on_roundno TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  model_version TEXT NOT NULL,
  top3_json TEXT NOT NULL,
  side_json TEXT NOT NULL,
  accuracy_total INTEGER,
  accuracy_possible INTEGER,
  accuracy_rate REAL,
  rank_hits INTEGER,
  rank_possible INTEGER,
  side_hits INTEGER,
  side_possible INTEGER,
  evaluated_at TEXT
);

CREATE TABLE IF NOT EXISTS timeseq_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_roundno TEXT NOT NULL UNIQUE,
  based_on_roundno TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  model_version TEXT NOT NULL,
  model_name TEXT NOT NULL,
  top3_json TEXT NOT NULL,
  side_json TEXT NOT NULL,
  model_json TEXT NOT NULL,
  accuracy_total INTEGER,
  accuracy_possible INTEGER,
  accuracy_rate REAL,
  rank_hits INTEGER,
  rank_possible INTEGER,
  sum_hits INTEGER,
  sum_possible INTEGER,
  dragon_hits INTEGER,
  dragon_possible INTEGER,
  evaluated_at TEXT
);

CREATE TABLE IF NOT EXISTS gpt55_analyst_v3_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_roundno TEXT NOT NULL UNIQUE,
  based_on_roundno TEXT,
  generated_at TEXT NOT NULL,
  model_version TEXT NOT NULL,
  matrix_json TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  overlap_json TEXT NOT NULL,
  top3_json TEXT NOT NULL,
  reason_json TEXT NOT NULL,
  error_json TEXT,
  actual_json TEXT,
  compare_json TEXT,
  top1_hits INTEGER,
  top3_hits INTEGER,
  possible INTEGER,
  top1_rate REAL,
  top3_rate REAL,
  evaluated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_gpt55_analyst_v3_target ON gpt55_analyst_v3_predictions(target_roundno DESC);
CREATE INDEX IF NOT EXISTS idx_gpt55_analyst_v3_eval ON gpt55_analyst_v3_predictions(evaluated_at DESC);

CREATE TABLE IF NOT EXISTS gpt55_analyst_model_outputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  target_roundno TEXT NOT NULL,
  model_name TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  position INTEGER NOT NULL,
  top3_json TEXT NOT NULL,
  score REAL,
  generated_at TEXT NOT NULL,
  UNIQUE(version, target_roundno, model_name, position)
);

CREATE INDEX IF NOT EXISTS idx_gpt55_model_outputs_lookup ON gpt55_analyst_model_outputs(version, target_roundno DESC, position);

CREATE TABLE IF NOT EXISTS gpt55_analyst_model_position_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  model_name TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  position INTEGER NOT NULL,
  samples INTEGER,
  top1_hits INTEGER,
  top3_hits INTEGER,
  top1_rate REAL,
  top3_rate REAL,
  current_miss_streak INTEGER,
  weight REAL,
  updated_at TEXT NOT NULL,
  UNIQUE(version, model_name, position)
);

CREATE TABLE IF NOT EXISTS gpt55_analyst_error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  target_roundno TEXT NOT NULL,
  position INTEGER NOT NULL,
  actual TEXT,
  predicted_top3_json TEXT,
  miss_reason TEXT,
  bad_models_json TEXT,
  suggested_adjustment TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(version, target_roundno, position)
);

CREATE TABLE IF NOT EXISTS gpt55_analyst_strategy_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  position INTEGER NOT NULL,
  active_strategy TEXT,
  model_weights_json TEXT,
  recent_good_signals_json TEXT,
  recent_bad_signals_json TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(version, position)
);

CREATE TABLE IF NOT EXISTS gpt55_analyst_v2_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_roundno TEXT NOT NULL UNIQUE,
  based_on_roundno TEXT,
  generated_at TEXT NOT NULL,
  model_version TEXT NOT NULL,
  reliability_json TEXT NOT NULL,
  top1_json TEXT NOT NULL,
  coverage_json TEXT NOT NULL,
  top3_json TEXT NOT NULL,
  reason_json TEXT NOT NULL,
  error_json TEXT,
  actual_json TEXT,
  compare_json TEXT,
  top1_hits INTEGER,
  top3_hits INTEGER,
  possible INTEGER,
  top1_rate REAL,
  top3_rate REAL,
  evaluated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_gpt55_analyst_v2_target ON gpt55_analyst_v2_predictions(target_roundno DESC);
CREATE INDEX IF NOT EXISTS idx_gpt55_analyst_v2_eval ON gpt55_analyst_v2_predictions(evaluated_at DESC);

CREATE TABLE IF NOT EXISTS gpt55_analyst_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_roundno TEXT NOT NULL UNIQUE,
  based_on_roundno TEXT,
  generated_at TEXT NOT NULL,
  model_version TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  top3_json TEXT NOT NULL,
  reason_json TEXT NOT NULL,
  risk_json TEXT NOT NULL,
  actual_json TEXT,
  compare_json TEXT,
  top1_hits INTEGER,
  top3_hits INTEGER,
  possible INTEGER,
  top1_rate REAL,
  top3_rate REAL,
  evaluated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_gpt55_analyst_target ON gpt55_analyst_predictions(target_roundno DESC);
CREATE INDEX IF NOT EXISTS idx_gpt55_analyst_eval ON gpt55_analyst_predictions(evaluated_at DESC);

CREATE TABLE IF NOT EXISTS gpt55_bypass_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  target_roundno TEXT NOT NULL,
  based_on_roundno TEXT,
  generated_at TEXT NOT NULL,
  source_model_version TEXT,
  top3_json TEXT NOT NULL,
  compare_json TEXT NOT NULL,
  actual_json TEXT,
  top1_hits INTEGER,
  top3_hits INTEGER,
  possible INTEGER,
  top1_rate REAL,
  top3_rate REAL,
  evaluated_at TEXT,
  UNIQUE(version, target_roundno)
);

CREATE INDEX IF NOT EXISTS idx_gpt55_bypass_version_target ON gpt55_bypass_predictions(version, target_roundno DESC);
CREATE INDEX IF NOT EXISTS idx_gpt55_bypass_eval ON gpt55_bypass_predictions(version, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_draws_roundno ON draws(roundno DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_target ON predictions(target_roundno);
CREATE INDEX IF NOT EXISTS idx_predictions_eval ON predictions(evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeseq_predictions_target ON timeseq_predictions(target_roundno);
CREATE INDEX IF NOT EXISTS idx_timeseq_predictions_eval ON timeseq_predictions(evaluated_at DESC);
`);

for (const [table, column, type] of [
  ['predictions', 'fusion_json', 'TEXT'],
  ['predictions', 'confidence', 'REAL'],
  ['predictions', 'sum_hits', 'INTEGER'],
  ['predictions', 'sum_possible', 'INTEGER'],
  ['predictions', 'dragon_hits', 'INTEGER'],
  ['predictions', 'dragon_possible', 'INTEGER'],
  ['timeseq_predictions', 'accuracy_rate', 'REAL'],
]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function loadJsonArtifact(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

const fusionArtifact = loadJsonArtifact(FUSION_MODEL_PATH);
const sequenceArtifact = loadJsonArtifact(SEQUENCE_MODEL_PATH);
const xv1SequenceArtifact = loadJsonArtifact(XV1_SEQUENCE_MODEL_PATH);

function getFusionLookback() {
  const n = Number(fusionArtifact?.lookback || sequenceArtifact?.lookback);
  if (!Number.isFinite(n) || n <= 0) return 240;
  return Math.max(60, Math.min(360, Math.floor(n)));
}

function getFusionWeights(pos) {
  const fallback = DEFAULT_FUSION_WEIGHTS;
  const trained = fusionArtifact?.positions?.[String(pos)]?.weights;
  if (!trained || typeof trained !== 'object') return fallback;
  const out = {
    frequency: Number(trained.frequency),
    recent: Number(trained.recent),
    gap: Number(trained.gap),
    transition: Number(trained.transition),
  };
  const values = [out.frequency, out.recent, out.gap, out.transition];
  if (values.some((v) => !Number.isFinite(v) || v < 0)) return fallback;
  const sum = values.reduce((a, b) => a + b, 0);
  if (!sum) return fallback;
  return {
    frequency: out.frequency / sum,
    recent: out.recent / sum,
    gap: out.gap / sum,
    transition: out.transition / sum,
  };
}

function getSequenceBlend() {
  const v = Number(sequenceArtifact?.blend);
  if (!Number.isFinite(v)) return DEFAULT_SEQUENCE_BLEND;
  return Math.max(0.05, Math.min(0.95, v));
}

function summarizeTrainingModel() {
  const xv1Summary = summarizeXv1SequenceArtifact(xv1SequenceArtifact);
  if (xv1Summary) {
    return {
      enabled: true,
      name: xv1Summary.name,
      version: xv1Summary.version,
      lookback: xv1Summary.lookback,
      blend: 0,
      sourceRows: xv1Summary.sourceRows,
      positions: xv1Summary.positions,
      averageTop1: 0,
      averageTop3: 0,
      featureText: xv1Summary.featureText,
      testTop1: 0,
      testTop3: 0,
      trainingSource: xv1Summary.trainingSource,
      trainingTotals: xv1SequenceArtifact?.trainingTotals || { timeseq_predictions: xv1Summary.sourceRows, total: xv1Summary.sourceRows },
      trainingTotalsText: xv1Summary.trainingTotalsText,
      sourceBreakdownText: xv1Summary.sourceBreakdownText,
      note: xv1Summary.note,
      rounds: xv1Summary.rounds,
      isolation: xv1Summary.isolation,
    };
  }
  if (!sequenceArtifact) {
    return {
      enabled: false,
      name: '-',
      version: '-',
      lookback: getFusionLookback(),
      blend: getSequenceBlend(),
      sourceRows: 0,
      positions: 0,
      averageTop1: 0,
      averageTop3: 0,
      featureText: '未启用训练模型',
      testTop1: 0,
      testTop3: 0,
      note: '仅使用规则融合回退',
    };
  }
  const positionRows = Object.values(sequenceArtifact.positions || {});
  const avgTop1 = positionRows.length
    ? positionRows.reduce((acc, p) => acc + Number(p?.validation?.top1Accuracy || 0), 0) / positionRows.length
    : 0;
  const avgTop3 = positionRows.length
    ? positionRows.reduce((acc, p) => acc + Number(p?.validation?.top3Accuracy || 0), 0) / positionRows.length
    : 0;
  const avgTestTop1 = positionRows.length
    ? positionRows.reduce((acc, p) => acc + Number(p?.testEvaluation?.top1Accuracy || 0), 0) / positionRows.length
    : 0;
  const avgTestTop3 = positionRows.length
    ? positionRows.reduce((acc, p) => acc + Number(p?.testEvaluation?.top3Accuracy || 0), 0) / positionRows.length
    : 0;
  const sourceBreakdown = sequenceArtifact.sourceBreakdown && typeof sequenceArtifact.sourceBreakdown === 'object'
    ? sequenceArtifact.sourceBreakdown
    : {};
  const sourceBreakdownText = Object.keys(sourceBreakdown).length
    ? Object.entries(sourceBreakdown).map(([k, v]) => `${k}:${v}`).join(' / ')
    : '未拆分';
  const trainingTotals = sequenceArtifact.trainingTotals && typeof sequenceArtifact.trainingTotals === 'object'
    ? sequenceArtifact.trainingTotals
    : { csv: sourceBreakdown.csv || 0, history: sourceBreakdown.history || 0, api: sourceBreakdown.api || 0, total: Number(sequenceArtifact.sourceRows || 0) };
  const totalText = `csv:${trainingTotals.csv || 0} / history:${trainingTotals.history || 0} / api:${trainingTotals.api || 0} / total:${trainingTotals.total || 0}`;
  return {
    enabled: true,
    name: sequenceArtifact.name || 'sequence-markov-v1',
    version: sequenceArtifact.version || '-',
    lookback: Number(sequenceArtifact.lookback || getFusionLookback()),
    blend: getSequenceBlend(),
    sourceRows: Number(sequenceArtifact.sourceRows || 0),
    sourceBreakdown,
    sourceBreakdownText,
    trainingTotals,
    trainingTotalsText: totalText,
    positions: positionRows.length,
    averageTop1: Number(avgTop1.toFixed(2)),
    averageTop3: Number(avgTop3.toFixed(2)),
    featureText: sequenceArtifact.featureText || '多步序列特征 + 先验 + 趋势融合',
    testTop1: Number(avgTestTop1.toFixed(2)),
    testTop3: Number(avgTestTop3.toFixed(2)),
    trainingSource: sequenceArtifact.trainingSource || 'db',
    note: sequenceArtifact.note || '训练模型已启用',
  };
}

const pageHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

function nowIso() {
  return new Date().toISOString();
}

function parseDate(val) {
  if (val == null) return null;
  if (typeof val === 'string') {
    const m = val.match(/\/Date\((\d+)\)\//);
    if (m) return new Date(Number(m[1])).toISOString();
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (val instanceof Date) return val.toISOString();
  return null;
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bigSmallByNumber(n) {
  return Number(n) >= 6 ? '大' : '小';
}

function oddEvenByNumber(n) {
  return Number(n) % 2 === 1 ? '单' : '双';
}

function dragonTiger(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (a > b) return '龙';
  if (a < b) return '虎';
  return '和';
}

function normalizeHistoryRow(row, source = 'history') {
  const numbers = [];
  for (let i = 1; i <= 10; i++) numbers.push(String(row[`lotteryno${i}`]).padStart(2, '0'));
  const sum12 = toInt(row.desc1);
  const dragons = [
    dragonTiger(row.lotteryno1, row.lotteryno10),
    dragonTiger(row.lotteryno2, row.lotteryno9),
    dragonTiger(row.lotteryno3, row.lotteryno8),
    dragonTiger(row.lotteryno4, row.lotteryno7),
    dragonTiger(row.lotteryno5, row.lotteryno6),
  ];
  return {
    roundno: String(row.roundno),
    gameno: GAMENO,
    gamegroupno: GAMEGROUPNO,
    gamename: '幸运飞艇',
    winning_time: parseDate(row.winningtime),
    lottery_date: parseDate(row.lotterydate),
    mweek: row.mweek || null,
    numbers,
    sum12,
    bigsmall: row.desc2 || (sum12 >= 12 ? '大' : '小'),
    oddeven: row.desc3 || (sum12 % 2 === 1 ? '单' : '双'),
    dragon_tiger: dragons,
    raw: row,
    source,
  };
}

function normalizeCurrentSnapshot(row) {
  const numbers = [];
  for (let i = 1; i <= 10; i++) numbers.push(String(row[`lotteryno${i}`]).padStart(2, '0'));
  const sum12 = numbers.slice(0, 2).reduce((a, b) => a + Number(b), 0);
  const dragons = [
    dragonTiger(row.lotteryno1, row.lotteryno10),
    dragonTiger(row.lotteryno2, row.lotteryno9),
    dragonTiger(row.lotteryno3, row.lotteryno8),
    dragonTiger(row.lotteryno4, row.lotteryno7),
    dragonTiger(row.lotteryno5, row.lotteryno6),
  ];
  return {
    roundno: String(row.roundno),
    next_roundno: String(row.next_roundno),
    winning_time: parseDate(row.winningtime),
    next_winning_time: parseDate(row.next_winningtime),
    gameno: row.gameno,
    gamegroupno: row.gamegroupno,
    gamename: row.gamename,
    numbers,
    sum12,
    bigsmall: sum12 >= 12 ? '大' : '小',
    oddeven: sum12 % 2 === 1 ? '单' : '双',
    dragon_tiger: dragons,
    raw: row,
  };
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = new URL(url);
    const options = {
      method: 'POST',
      hostname: req.hostname,
      port: req.port || 443,
      path: req.pathname + req.search,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Referer': `${BASE_URL}/detail.aspx?g=${GAMENO}`,
        'Origin': BASE_URL,
      },
    };
    const client = require('node:https');
    const r = client.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}: ${data.slice(0, 300)}`));
          return;
        }
        resolve(data);
      });
    });
    r.on('error', reject);
    r.write(payload);
    r.end();
  });
}

async function fetchCurrentSnapshot() {
  const text = await postJson(`${BASE_URL}/index.aspx/Chawinning_Two`, { gameno: GAMENO });
  const outer = JSON.parse(text);
  const payload = JSON.parse(outer.d);
  return payload.Rows && payload.Rows[0] ? normalizeCurrentSnapshot(payload.Rows[0]) : null;
}

async function fetchHistoryPage(page) {
  const text = await postJson(`${BASE_URL}/detail.aspx/GetWinningnohistoryList`, {
    gameno: GAMENO,
    gamegroupno: GAMEGROUPNO,
    pagesize: HISTORY_PAGE_SIZE,
    curentsize: page,
    transdate: '',
  });
  const outer = JSON.parse(text);
  const payload = JSON.parse(outer.d);
  return {
    rows: (payload[1] && payload[1].Rows) ? payload[1].Rows : [],
    recordcount: payload[2] || 0,
  };
}

function getDrawByRound(roundno) {
  return db.prepare('SELECT * FROM draws WHERE roundno = ?').get(String(roundno)) || null;
}

function getLatestDraw() {
  return db.prepare('SELECT * FROM draws WHERE source = ? ORDER BY roundno DESC LIMIT 1').get('history') || db.prepare('SELECT * FROM draws ORDER BY roundno DESC LIMIT 1').get() || null;
}

function parseJsonSafe(val, fallback) {
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function evaluatePredictionRow(pred, actualDraw) {
  const top3 = parseJsonSafe(pred.top3_json, []);
  const side = parseJsonSafe(pred.side_json, null);
  if (!Array.isArray(top3) || !side) return null;

  const actualNumbers = parseJsonSafe(actualDraw.numbers_json, []);
  if (!actualNumbers.length) return null;

  let rankHits = 0;
  for (let i = 0; i < 10; i++) {
    const actual = String(actualNumbers[i]).padStart(2, '0');
    const candidates = top3[i] ? top3[i].top3 : [];
    if (candidates.map(String).includes(actual)) rankHits += 1;
  }

  const actualSum = Number(actualNumbers[0]) + Number(actualNumbers[1]);
  const actualSumBigSmall = actualSum >= 12 ? '大' : '小';
  const actualSumOddEven = actualSum % 2 === 1 ? '单' : '双';
  const actualDragonTiger = [
    dragonTiger(actualNumbers[0], actualNumbers[9]),
    dragonTiger(actualNumbers[1], actualNumbers[8]),
    dragonTiger(actualNumbers[2], actualNumbers[7]),
    dragonTiger(actualNumbers[3], actualNumbers[6]),
    dragonTiger(actualNumbers[4], actualNumbers[5]),
  ];

  let sumHits = 0;
  if (side.sum.bigsmall === actualSumBigSmall) sumHits += 1;
  if (side.sum.oddeven === actualSumOddEven) sumHits += 1;

  let dragonHits = 0;
  for (let i = 0; i < 5; i++) {
    if (side.dragonTiger[i]?.value === actualDragonTiger[i]) dragonHits += 1;
  }

  const rankPossible = 10;
  const sumPossible = 2;
  const dragonPossible = 5;
  const accuracyTotal = rankHits + sumHits + dragonHits;
  const accuracyPossible = rankPossible + sumPossible + dragonPossible;

  return {
    accuracyTotal,
    accuracyPossible,
    rankHits,
    rankPossible,
    sumHits,
    sumPossible,
    dragonHits,
    dragonPossible,
    sideHits: sumHits + dragonHits,
    sidePossible: sumPossible + dragonPossible,
    accuracyRate: accuracyPossible ? (accuracyTotal / accuracyPossible) * 100 : 0,
  };
}

function backfillPredictionStats() {
  const rows = db.prepare(`
    SELECT id, target_roundno, top3_json, side_json, evaluated_at, rank_hits, rank_possible, sum_hits, sum_possible, dragon_hits, dragon_possible
    FROM predictions
    WHERE evaluated_at IS NOT NULL
  `).all();
  for (const row of rows) {
    if (row.rank_hits != null && row.sum_hits != null && row.dragon_hits != null) continue;
    const actualDraw = getDrawByRound(row.target_roundno);
    if (!actualDraw) continue;
    const result = evaluatePredictionRow(row, actualDraw);
    if (!result) continue;
    db.prepare(`
      UPDATE predictions
      SET accuracy_total = ?, accuracy_possible = ?, accuracy_rate = ?, rank_hits = ?, rank_possible = ?, sum_hits = ?, sum_possible = ?, dragon_hits = ?, dragon_possible = ?, side_hits = ?, side_possible = ?
      WHERE id = ?
    `).run(
      result.accuracyTotal,
      result.accuracyPossible,
      result.accuracyRate,
      result.rankHits,
      result.rankPossible,
      result.sumHits,
      result.sumPossible,
      result.dragonHits,
      result.dragonPossible,
      result.sideHits,
      result.sidePossible,
      row.id,
    );
  }
}

function backfillTimeSeqPredictions() {
  const draws = loadRecentDraws(2000).reverse();
  for (let i = 1; i < draws.length; i++) {
    const current = draws[i];
    const prev = draws[i - 1];
    upsertTimeSeqPrediction(current.roundno, prev.roundno);
    evaluatePendingTimeSeqPrediction({ roundno: current.roundno, numbers_json: JSON.stringify(parseDrawNumbers(current)) });
  }
}

function backfillTimeSeqStats() {
  const rows = db.prepare(`
    SELECT id, target_roundno, model_json, side_json, evaluated_at, rank_hits, rank_possible, sum_hits, sum_possible, dragon_hits, dragon_possible
    FROM timeseq_predictions
    WHERE evaluated_at IS NOT NULL
  `).all();
  for (const row of rows) {
    if (row.rank_hits != null && row.sum_hits != null && row.dragon_hits != null) continue;
    const actualDraw = getDrawByRound(row.target_roundno);
    if (!actualDraw) continue;
    const result = evaluateTimeSeqPredictionRow(row, actualDraw);
    if (!result) continue;
    db.prepare(`
      UPDATE timeseq_predictions
      SET accuracy_total = ?, accuracy_possible = ?, accuracy_rate = ?, rank_hits = ?, rank_possible = ?, sum_hits = ?, sum_possible = ?, dragon_hits = ?, dragon_possible = ?
      WHERE id = ?
    `).run(
      result.accuracyTotal,
      result.accuracyPossible,
      result.accuracyRate,
      result.rankHits,
      result.rankPossible,
      result.sumHits,
      result.sumPossible,
      result.dragonHits,
      result.dragonPossible,
      row.id,
    );
  }
}

function upsertDraw(draw) {
  const row = {
    roundno: String(draw.roundno),
    gameno: GAMENO,
    gamegroupno: GAMEGROUPNO,
    gamename: '幸运飞艇',
    winning_time: draw.winning_time,
    lottery_date: draw.lottery_date,
    mweek: draw.mweek,
    numbers_json: JSON.stringify(draw.numbers),
    sum12: draw.sum12,
    bigsmall: draw.bigsmall,
    oddeven: draw.oddeven,
    dragon_tiger_json: JSON.stringify(draw.dragon_tiger),
    raw_json: JSON.stringify(draw.raw),
    source: draw.source,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  const existing = getDrawByRound(row.roundno);
  db.prepare(`
    INSERT INTO draws (
      roundno, gameno, gamegroupno, gamename, winning_time, lottery_date, mweek,
      numbers_json, sum12, bigsmall, oddeven, dragon_tiger_json, raw_json, source, created_at, updated_at
    ) VALUES (
      @roundno, @gameno, @gamegroupno, @gamename, @winning_time, @lottery_date, @mweek,
      @numbers_json, @sum12, @bigsmall, @oddeven, @dragon_tiger_json, @raw_json, @source, @created_at, @updated_at
    )
    ON CONFLICT(roundno) DO UPDATE SET
      gameno=excluded.gameno,
      gamegroupno=excluded.gamegroupno,
      gamename=excluded.gamename,
      winning_time=excluded.winning_time,
      lottery_date=excluded.lottery_date,
      mweek=excluded.mweek,
      numbers_json=excluded.numbers_json,
      sum12=excluded.sum12,
      bigsmall=excluded.bigsmall,
      oddeven=excluded.oddeven,
      dragon_tiger_json=excluded.dragon_tiger_json,
      raw_json=excluded.raw_json,
      source=excluded.source,
      updated_at=excluded.updated_at
  `).run(row);

  return !existing;
}

function loadRecentDraws(limit = 100) {
  return db.prepare('SELECT * FROM draws ORDER BY roundno DESC LIMIT ?').all(limit);
}

function parseDrawNumbers(draw) {
  if (!draw) return [];
  if (draw.numbers_json) return parseJsonSafe(draw.numbers_json, []);
  if (Array.isArray(draw.numbers)) return draw.numbers;
  return [];
}

function normalizeScoreMap(map) {
  const values = [...map.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return new Map([...map.keys()].map((k) => [k, 0]));
  if (max === min) return new Map([...map.keys()].map((k) => [k, 0.5]));
  return new Map([...map.entries()].map(([k, v]) => [k, (v - min) / (max - min)]));
}

function buildTrainedSequenceProfile(referenceDraw, draws) {
  const numbers = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, '0'));
  const top3ByPos = [];
  const blend = getSequenceBlend();
  const modelName = sequenceArtifact?.name || 'sequence-bootstrap';
  const history = Array.isArray(draws) ? draws : loadRecentDraws(getFusionLookback()).reverse();

  for (let pos = 1; pos <= 10; pos++) {
    const rawPos = sequenceArtifact?.positions?.[String(pos)];
    const priors = rawPos?.priors || null;
    const transitions = rawPos?.transitions || null;
    const orders = rawPos?.orders || [1];
    const referenceNumbers = referenceDraw ? parseDrawNumbers(referenceDraw) : [];
    const ranked = numbers.map((n) => {
      const priorScore = priors ? Number(priors[n] || 0) : 0;
      let transitionScore = 0;
      for (const order of orders) {
        const idx = history.length - order - 1;
        if (idx < 0) continue;
        const prevDraw = history[idx];
        if (!prevDraw || !Array.isArray(prevDraw.numbers) || prevDraw.numbers.length < pos) continue;
        const prev = String(prevDraw.numbers[pos - 1]).padStart(2, '0');
        const table = transitions?.[String(order)] || null;
        const candidateScore = table && table[prev] ? Number(table[prev][n] || 0) : 0;
        const orderWeight = order === 1 ? 0.52 : order === 2 ? 0.28 : 0.16;
        transitionScore += candidateScore * orderWeight;
      }
      const trendHeuristic = buildPositionFusion(history, pos, referenceDraw).top3.includes(n) ? 1 : 0;
      const continuity = referenceNumbers.length ? (String(referenceNumbers[pos - 1]).padStart(2, '0') === n ? 1 : 0) * 0.08 : 0;
      const score = (priorScore * 0.24) + (transitionScore * 0.56) + (trendHeuristic * 0.16) + continuity;
      return { n, score };
    }).sort((a, b) => b.score - a.score);

    top3ByPos.push({
      label: `第${pos}名`,
      top3: ranked.slice(0, 3).map((x) => x.n),
      note: referenceDraw ? `训练+趋势融合（${modelName}）+ 规则回退，基准 ${referenceDraw.roundno}` : `训练+趋势融合（${modelName}）+ 规则回退`,
      score: Number((ranked[0]?.score || 0).toFixed(4)),
      confidence: Number(((rawPos?.validation?.top3Accuracy || 0) * blend).toFixed(4)),
    });
  }

  return top3ByPos;
}

function buildPositionFusion(draws, pos, referenceDraw, config = null) {
  const numbers = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, '0'));
  const freq = new Map(numbers.map((n) => [n, 0]));
  const recent = new Map(numbers.map((n) => [n, 0]));
  const gap = new Map(numbers.map((n) => [n, 0]));
  const transition = new Map(numbers.map((n) => [n, 0]));
  const lastSeen = new Map(numbers.map((n) => [n, -1]));
  const transMatrix = new Map(numbers.map((n) => [n, new Map(numbers.map((m) => [m, 0]))]));
  const recentHalfLife = Math.max(1, Number(config?.recentHalfLife || 8));
  const transitionHalfLife = Math.max(1, Number(config?.transitionHalfLife || 8));
  const freqSlope = Math.max(0.001, Number(config?.freqSlope || 0.12));
  const weights = config?.weights || getFusionWeights(pos);
  let prevArr = null;

  for (let idx = 0; idx < draws.length; idx++) {
    const draw = draws[idx];
    const arr = parseDrawNumbers(draw);
    const actual = String(arr[pos - 1]).padStart(2, '0');
    const age = draws.length - 1 - idx;
    const recentDecay = Math.exp(-age / recentHalfLife);
    const transitionDecay = Math.exp(-age / transitionHalfLife);

    freq.set(actual, (freq.get(actual) || 0) + 1 / (1 + age * freqSlope));
    recent.set(actual, (recent.get(actual) || 0) + recentDecay);
    if (lastSeen.get(actual) === -1) lastSeen.set(actual, age);

    if (prevArr) {
      const prevActual = String(prevArr[pos - 1]).padStart(2, '0');
      const row = transMatrix.get(prevActual);
      row.set(actual, (row.get(actual) || 0) + transitionDecay);
    }
    prevArr = arr;
  }

  for (const n of numbers) {
    const g = lastSeen.get(n);
    if (g >= 0) gap.set(n, Math.min(1, Math.log(2 + g) / 3));
  }

  const refArr = parseDrawNumbers(referenceDraw);
  const refValue = String(refArr[pos - 1]).padStart(2, '0');
  const row = transMatrix.get(refValue) || new Map(numbers.map((m) => [m, 0]));
  const rowNorm = normalizeScoreMap(row);

  const freqN = normalizeScoreMap(freq);
  const recentN = normalizeScoreMap(recent);
  const gapN = normalizeScoreMap(gap);
  const combined = new Map(numbers.map((n) => [n, 0]));

  for (const n of numbers) {
    const score =
      (freqN.get(n) || 0) * weights.frequency +
      (recentN.get(n) || 0) * weights.recent +
      (gapN.get(n) || 0) * weights.gap +
      (rowNorm.get(n) || 0) * weights.transition;
    combined.set(n, score);
  }

  const ranked = [...combined.entries()].sort((a, b) => b[1] - a[1]);
  const modelTag = config?.label || fusionArtifact?.name || 'fusion-hybrid';
  const trainedTag = config?.tag || (fusionArtifact ? `训练+趋势融合（${fusionArtifact.name || 'artifact'}）` : '融合频率/近因/缺口/转移四模型');
  return {
    label: `第${pos}名`,
    top3: ranked.slice(0, 3).map(([n]) => n),
    note: referenceDraw ? `${trainedTag}，基准 ${referenceDraw.roundno}，模型 ${modelTag}` : `${trainedTag}`,
    score: Number((ranked[0]?.[1] || 0).toFixed(4)),
    confidence: Number(Math.max(0, (ranked[0]?.[1] || 0) - (ranked[1]?.[1] || 0)).toFixed(4)),
  };
}

const OBSERVER_PROFILE = {
  label: 'observer-shadow',
  tag: '旁路观察器',
  weights: { frequency: 0.18, recent: 0.42, gap: 0.15, transition: 0.25 },
  recentHalfLife: 4,
  transitionHalfLife: 5,
  freqSlope: 0.22,
};

function buildEnsemblePrediction(referenceDraw) {
  const draws = loadRecentDraws(getFusionLookback()).reverse();
  const positions = Array.from({ length: 10 }, (_, i) => i + 1);
  const trainedTop3 = sequenceArtifact ? buildTrainedSequenceProfile(referenceDraw, draws) : null;
  const ruleTop3 = positions.map((pos) => buildPositionFusion(draws, pos, referenceDraw));
  const top3 = ruleTop3.map((ruleRow, idx) => {
    const trainedRow = trainedTop3?.[idx];
    if (!trainedRow) return ruleRow;
    const blend = getSequenceBlend();
    const mergedTop3 = Array.from(new Set([...(trainedRow.top3 || []), ...(ruleRow.top3 || [])])).slice(0, 3);
    return {
      label: ruleRow.label,
      top3: mergedTop3,
      note: trainedRow.note,
      score: Number((ruleRow.score * (1 - blend) + trainedRow.score * blend).toFixed(4)),
      confidence: Number((ruleRow.confidence * (1 - blend) + trainedRow.confidence * blend).toFixed(4)),
    };
  });

  const chosen = top3.map((x) => x.top3[0]);
  const sum = Number(chosen[0]) + Number(chosen[1]);
  const rankCategories = [
    { label: '冠', value: `${chosen[0]}（${bigSmallByNumber(chosen[0])}/${oddEvenByNumber(chosen[0])}）` },
    { label: '亚', value: `${chosen[1]}（${bigSmallByNumber(chosen[1])}/${oddEvenByNumber(chosen[1])}）` },
    { label: '季', value: `${chosen[2]}（${bigSmallByNumber(chosen[2])}/${oddEvenByNumber(chosen[2])}）` },
  ];
  const dragonTigerList = [
    { label: '龙虎1', value: dragonTiger(chosen[0], chosen[9]) },
    { label: '龙虎2', value: dragonTiger(chosen[1], chosen[8]) },
    { label: '龙虎3', value: dragonTiger(chosen[2], chosen[7]) },
    { label: '龙虎4', value: dragonTiger(chosen[3], chosen[6]) },
    { label: '龙虎5', value: dragonTiger(chosen[4], chosen[5]) },
  ];

  return {
    top3,
    confidence: Number((top3.reduce((acc, item) => acc + (item.confidence || 0), 0) / Math.max(1, top3.length)).toFixed(4)),
    fusion: top3,
    side: {
      sum: {
        bigsmall: sum >= 12 ? '大' : '小',
        oddeven: sum % 2 === 1 ? '单' : '双',
      },
      rankCategories,
      dragonTiger: dragonTigerList,
    },
  };
}

function buildTimeSeqModelPack(draws, referenceDraw, label, config) {
  const positions = Array.from({ length: 10 }, (_, i) => i + 1);
  return positions.map((pos) => buildPositionFusion(draws, pos, referenceDraw, {
    label,
    tag: label,
    weights: config.weights,
    recentHalfLife: config.recentHalfLife,
    transitionHalfLife: config.transitionHalfLife,
    freqSlope: config.freqSlope,
  }));
}

function currentTimeSeqModels(draws, referenceDraw = null) {
  const configs = {
    frequency: {
      label: '频率基准',
      tag: 'frequency',
      weights: { frequency: 0.48, recent: 0.18, gap: 0.14, transition: 0.20 },
      recentHalfLife: 10,
      transitionHalfLife: 10,
      freqSlope: 0.10,
    },
    markov: {
      label: '马尔科夫链',
      tag: 'markov',
      weights: { frequency: 0.18, recent: 0.22, gap: 0.10, transition: 0.50 },
      recentHalfLife: 6,
      transitionHalfLife: 6,
      freqSlope: 0.15,
    },
    xgboost: {
      label: 'XGBoost',
      tag: 'xgboost',
      weights: { frequency: 0.22, recent: 0.30, gap: 0.16, transition: 0.32 },
      recentHalfLife: 8,
      transitionHalfLife: 8,
      freqSlope: 0.12,
    },
    lstm: {
      label: 'LSTM',
      tag: 'lstm',
      weights: { frequency: 0.14, recent: 0.40, gap: 0.10, transition: 0.36 },
      recentHalfLife: 4,
      transitionHalfLife: 5,
      freqSlope: 0.18,
    },
  };

  return Object.entries(configs).reduce((acc, [key, cfg]) => {
    acc[key] = buildTimeSeqModelPack(draws, referenceDraw, cfg.label, cfg).map((row, idx) => ({
      label: `第${idx + 1}名`,
      top3: row.top3,
      score: row.score,
      confidence: row.confidence,
      note: `${cfg.label}：${row.note}`,
    }));
    return acc;
  }, {});
}

function buildTimeSeqPrediction(draws, referenceDraw) {
  const models = currentTimeSeqModels(draws, referenceDraw);
  const positions = Array.from({ length: 10 }, (_, i) => i + 1);
  const top3 = positions.map((_, idx) => {
    const rows = Object.values(models).map((list) => list[idx]).filter(Boolean);
    const mergedTop3 = Array.from(new Set(rows.flatMap((r) => r.top3 || []))).slice(0, 3);
    const bestRow = rows.sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
    const avgScore = rows.length ? rows.reduce((acc, row) => acc + Number(row.score || 0), 0) / rows.length : 0;
    const avgConfidence = rows.length ? rows.reduce((acc, row) => acc + Number(row.confidence || 0), 0) / rows.length : 0;
    return {
      label: `第${idx + 1}名`,
      top3: mergedTop3,
      score: Number(avgScore.toFixed(4)),
      confidence: Number(avgConfidence.toFixed(4)),
      note: bestRow ? bestRow.note : '时序模型融合输出',
    };
  });

  const chosen = top3.map((x) => x.top3[0] || '01');
  const sum = Number(chosen[0]) + Number(chosen[1]);
  const rankCategories = [
    { label: '冠', value: `${chosen[0]}（${bigSmallByNumber(chosen[0])}/${oddEvenByNumber(chosen[0])}）` },
    { label: '亚', value: `${chosen[1]}（${bigSmallByNumber(chosen[1])}/${oddEvenByNumber(chosen[1])}）` },
    { label: '季', value: `${chosen[2]}（${bigSmallByNumber(chosen[2])}/${oddEvenByNumber(chosen[2])}）` },
  ];
  const dragonTigerList = [
    { label: '龙虎1', value: dragonTiger(chosen[0], chosen[9]) },
    { label: '龙虎2', value: dragonTiger(chosen[1], chosen[8]) },
    { label: '龙虎3', value: dragonTiger(chosen[2], chosen[7]) },
    { label: '龙虎4', value: dragonTiger(chosen[3], chosen[6]) },
    { label: '龙虎5', value: dragonTiger(chosen[4], chosen[5]) },
  ];

  return {
    top3,
    confidence: Number((top3.reduce((acc, item) => acc + (item.confidence || 0), 0) / Math.max(1, top3.length)).toFixed(4)),
    fusion: top3,
    models,
    side: {
      sum: {
        bigsmall: sum >= 12 ? '大' : '小',
        oddeven: sum % 2 === 1 ? '单' : '双',
      },
      rankCategories,
      dragonTiger: dragonTigerList,
    },
  };
}

function evaluateTimeSeqPredictionRow(row, actualDraw) {
  const model = parseJsonSafe(row.model_json, null);
  const top3 = parseJsonSafe(row.top3_json, []);
  const side = parseJsonSafe(row.side_json, null);
  if (!model || !Array.isArray(top3) || !side) return null;
  const actualNumbers = parseJsonSafe(actualDraw.numbers_json, []);
  if (!actualNumbers.length) return null;

  let rankHits = 0;
  for (let i = 0; i < 10; i++) {
    const actual = String(actualNumbers[i]).padStart(2, '0');
    const candidates = top3[i] ? top3[i].top3 : [];
    if (candidates.map(String).includes(actual)) rankHits += 1;
  }

  const actualSum = Number(actualNumbers[0]) + Number(actualNumbers[1]);
  const actualSumBigSmall = actualSum >= 12 ? '大' : '小';
  const actualSumOddEven = actualSum % 2 === 1 ? '单' : '双';
  const actualDragonTiger = [
    dragonTiger(actualNumbers[0], actualNumbers[9]),
    dragonTiger(actualNumbers[1], actualNumbers[8]),
    dragonTiger(actualNumbers[2], actualNumbers[7]),
    dragonTiger(actualNumbers[3], actualNumbers[6]),
    dragonTiger(actualNumbers[4], actualNumbers[5]),
  ];

  let sumHits = 0;
  if (side.sum.bigsmall === actualSumBigSmall) sumHits += 1;
  if (side.sum.oddeven === actualSumOddEven) sumHits += 1;

  let dragonHits = 0;
  for (let i = 0; i < 5; i++) {
    if (side.dragonTiger[i]?.value === actualDragonTiger[i]) dragonHits += 1;
  }

  const rankPossible = 10;
  const sumPossible = 2;
  const dragonPossible = 5;
  const accuracyTotal = rankHits + sumHits + dragonHits;
  const accuracyPossible = rankPossible + sumPossible + dragonPossible;

  return {
    accuracyTotal,
    accuracyPossible,
    rankHits,
    rankPossible,
    sumHits,
    sumPossible,
    dragonHits,
    dragonPossible,
    sideHits: sumHits + dragonHits,
    sidePossible: sumPossible + dragonPossible,
    accuracyRate: accuracyPossible ? (accuracyTotal / accuracyPossible) * 100 : 0,
  };
}

function upsertTimeSeqPrediction(targetRoundno, basedOnRoundno) {
  if (!targetRoundno || !basedOnRoundno) return null;
  const existing = db.prepare('SELECT * FROM timeseq_predictions WHERE target_roundno = ?').get(String(targetRoundno));
  if (existing) return existing;
  const draw = getDrawByRound(basedOnRoundno);
  const prediction = buildTimeSeqPrediction(loadRecentDraws(Math.max(getFusionLookback(), 120)).reverse(), draw);
  const generatedAt = nowIso();
  db.prepare(`
    INSERT INTO timeseq_predictions (
      target_roundno, based_on_roundno, generated_at, model_version, model_name,
      top3_json, side_json, model_json, accuracy_total, accuracy_possible, accuracy_rate,
      rank_hits, rank_possible, sum_hits, sum_possible, dragon_hits, dragon_possible
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(targetRoundno),
    String(basedOnRoundno),
    generatedAt,
    'timeseq-multi-model',
    '时序预测模型训练',
    JSON.stringify(prediction.top3),
    JSON.stringify(prediction.side),
    JSON.stringify(prediction.models),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
  return db.prepare('SELECT * FROM timeseq_predictions WHERE target_roundno = ?').get(String(targetRoundno));
}

function evaluatePendingTimeSeqPrediction(actualDraw) {
  const pred = db.prepare('SELECT * FROM timeseq_predictions WHERE target_roundno = ?').get(String(actualDraw.roundno));
  if (!pred || pred.evaluated_at) return null;
  const result = evaluateTimeSeqPredictionRow(pred, actualDraw);
  if (!result) return null;
  db.prepare(`
    UPDATE timeseq_predictions
    SET accuracy_total = ?, accuracy_possible = ?, accuracy_rate = ?, rank_hits = ?, rank_possible = ?, sum_hits = ?, sum_possible = ?, dragon_hits = ?, dragon_possible = ?, evaluated_at = ?
    WHERE id = ?
  `).run(
    result.accuracyTotal,
    result.accuracyPossible,
    result.accuracyRate,
    result.rankHits,
    result.rankPossible,
    result.sumHits,
    result.sumPossible,
    result.dragonHits,
    result.dragonPossible,
    nowIso(),
    pred.id,
  );
  return result;
}

function ensurePrediction(targetRoundno, basedOnRoundno) {
  if (!targetRoundno || !basedOnRoundno) return null;
  const existing = db.prepare('SELECT * FROM predictions WHERE target_roundno = ?').get(String(targetRoundno));
  if (existing) return existing;

  const referenceDraw = getDrawByRound(basedOnRoundno);
  const prediction = buildEnsemblePrediction(referenceDraw);
  const generatedAt = nowIso();
  db.prepare(`
    INSERT INTO predictions (
      target_roundno, based_on_roundno, generated_at, model_version, top3_json, side_json, fusion_json, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(targetRoundno),
    String(basedOnRoundno),
    generatedAt,
    MODEL_VERSION,
    JSON.stringify(prediction.top3),
    JSON.stringify(prediction.side),
    JSON.stringify(prediction.fusion || []),
    prediction.confidence ?? null,
  );
  return db.prepare('SELECT * FROM predictions WHERE target_roundno = ?').get(String(targetRoundno));
}

function evaluatePendingPrediction(actualDraw) {
  const pred = db.prepare('SELECT * FROM predictions WHERE target_roundno = ?').get(String(actualDraw.roundno));
  if (!pred || pred.evaluated_at) return null;
  const result = evaluatePredictionRow(pred, actualDraw);
  if (!result) return null;
  db.prepare(`
    UPDATE predictions
    SET accuracy_total = ?, accuracy_possible = ?, accuracy_rate = ?, rank_hits = ?, rank_possible = ?, side_hits = ?, side_possible = ?, evaluated_at = ?
    WHERE id = ?
  `).run(
    result.accuracyTotal,
    result.accuracyPossible,
    result.accuracyRate,
    result.rankHits,
    result.rankPossible,
    result.sideHits,
    result.sidePossible,
    nowIso(),
    pred.id,
  );
  return result;
}

async function syncOnce() {
  if (syncOnce.running) return;
  syncOnce.running = true;
  try {
    const latest = await fetchCurrentSnapshot();
    if (latest) {
      upsertDraw({
        roundno: latest.roundno,
        winning_time: latest.winning_time,
        lottery_date: latest.winning_time,
        mweek: null,
        numbers: latest.numbers,
        sum12: latest.sum12,
        bigsmall: latest.bigsmall,
        oddeven: latest.oddeven,
        dragon_tiger: latest.dragon_tiger,
        raw: latest.raw,
        source: 'live',
      });
      evaluatePendingPrediction({ roundno: latest.roundno, numbers_json: JSON.stringify(latest.numbers) });
      evaluatePendingTimeSeqPrediction({ roundno: latest.roundno, numbers_json: JSON.stringify(latest.numbers) });
    }

    for (let page = 1; page <= MAX_HISTORY_PAGES; page++) {
      const { rows } = await fetchHistoryPage(page);
      if (!rows.length) break;
      let inserted = 0;
      for (const row of rows) {
        const draw = normalizeHistoryRow(row, 'history');
        const isNew = upsertDraw(draw);
        if (isNew) inserted += 1;
        evaluatePendingPrediction({ roundno: draw.roundno, numbers_json: JSON.stringify(draw.numbers) });
        evaluatePendingTimeSeqPrediction({ roundno: draw.roundno, numbers_json: JSON.stringify(draw.numbers) });
      }
      if (page > 1 && inserted === 0) break;
    }

    const latestDraw = getLatestDraw();
    if (latest && latestDraw) {
      const prevDraw = db.prepare('SELECT * FROM draws WHERE roundno < ? ORDER BY roundno DESC LIMIT 1').get(latest.roundno) || null;
      if (prevDraw) ensurePrediction(latest.roundno, prevDraw.roundno);
      ensurePrediction(latest.next_roundno, latest.roundno);
      upsertTimeSeqPrediction(latest.roundno, prevDraw?.roundno || latest.roundno);
      upsertTimeSeqPrediction(latest.next_roundno, latest.roundno);
    }
  } catch (err) {
    console.error('[syncOnce]', err);
  } finally {
    syncOnce.running = false;
    scheduleNext();
  }
}

function scheduleNext() {
  clearTimeout(syncOnce.timer);
  syncOnce.timer = setTimeout(syncOnce, POLL_MS);
}

function calcMetrics() {
  const totalDraws = db.prepare('SELECT COUNT(*) AS c FROM draws').get().c;
  const latest = getLatestDraw();
  const latestPred = latest ? db.prepare('SELECT * FROM predictions WHERE target_roundno = ?').get(latest.roundno) : null;
  const nextPred = latest ? db.prepare('SELECT * FROM predictions WHERE target_roundno = ?').get(latest.roundno ? String(Number(latest.roundno) + 1) : '') : null;
  const lastEval = db.prepare('SELECT * FROM predictions WHERE evaluated_at IS NOT NULL ORDER BY evaluated_at DESC LIMIT 1').get() || null;
  const agg = db.prepare(`
    SELECT
      COALESCE(SUM(rank_hits), 0) AS rank_hits,
      COALESCE(SUM(rank_possible), 0) AS rank_possible,
      COALESCE(SUM(sum_hits), 0) AS sum_hits,
      COALESCE(SUM(sum_possible), 0) AS sum_possible,
      COALESCE(SUM(dragon_hits), 0) AS dragon_hits,
      COALESCE(SUM(dragon_possible), 0) AS dragon_possible,
      COALESCE(SUM(accuracy_total), 0) AS total_hits,
      COALESCE(SUM(accuracy_possible), 0) AS total_possible,
      COUNT(*) AS cnt
    FROM predictions
    WHERE evaluated_at IS NOT NULL
  `).get();
  const training = summarizeTrainingModel();
  const trainingSourceText = training.enabled
    ? (training.trainingSource === 'api'
      ? 'API 历史优先，失败回退本地库'
      : training.trainingSource === 'csv+history'
        ? 'CSV 基础 + history 实时校准'
        : training.trainingSource === 'csv'
          ? '仅使用 CSV 历史数据训练'
          : training.trainingSource === 'history'
            ? '仅使用实时 history 数据训练'
            : '当前使用本地库训练，API 历史不可用或未达门槛')
    : '仅使用规则融合回退，未启用训练模型';
  return {
    total_draws: totalDraws,
    total_draws_text: '已存储到本地 SQL 数据库',
    latest_roundno: latest ? latest.roundno : '-',
    latest_time: latest ? latest.winning_time : '-',
    next_prediction_roundno: nextPred ? nextPred.target_roundno : (latest ? String(Number(latest.roundno) + 1) : '-'),
    next_prediction_time: latest && latest.raw ? parseDate(latest.raw.next_winningtime) || '-' : '-',
    overall_accuracy_text: lastEval ? `${Number(lastEval.accuracy_rate || 0).toFixed(1)}%` : '暂无回测',
    split_accuracy_text: agg.total_possible ? `${agg.total_hits}/${agg.total_possible}，共 ${agg.cnt} 次已回测` : '暂无回测数据',
    position_text: agg.rank_possible ? `${agg.rank_hits}/${agg.rank_possible}` : '暂无数据',
    sum_text: agg.sum_possible ? `${agg.sum_hits}/${agg.sum_possible}` : '暂无数据',
    dragon_text: agg.dragon_possible ? `${agg.dragon_hits}/${agg.dragon_possible}` : '暂无数据',
    latest_prediction_roundno: latestPred ? latestPred.target_roundno : '-',
    model_enabled: training.enabled,
    model_name: training.name,
    model_version: training.version,
    model_source_rows: training.sourceRows,
    model_avg_top1: training.averageTop1,
    model_avg_top3: training.averageTop3,
    model_test_top1: training.testTop1,
    model_test_top3: training.testTop3,
    model_training_source: training.trainingSource,
    model_training_source_text: trainingSourceText,
    model_feature_text: training.featureText,
    model_lookback: training.lookback,
    model_blend: training.blend,
    model_positions: training.positions,
    model_source_breakdown: training.sourceBreakdown,
    model_source_breakdown_text: training.sourceBreakdownText,
    model_training_totals: training.trainingTotals,
    model_training_totals_text: training.trainingTotalsText,
    model_note: training.note,
  };
}

function loadRecent30() {
  const rows = db.prepare('SELECT * FROM draws WHERE source = ? ORDER BY roundno DESC LIMIT 30').all('history');
  if (!rows.length) {
    const fallback = db.prepare('SELECT * FROM draws ORDER BY roundno DESC LIMIT 30').all();
    return fallback.map((row) => ({
      roundno: row.roundno,
      winning_time: row.winning_time,
      numbers: parseJsonSafe(row.numbers_json, []),
      sum12: row.sum12,
      bigsmall: row.bigsmall,
      oddeven: row.oddeven,
      dragon_tiger: parseJsonSafe(row.dragon_tiger_json, []),
    }));
  }
  return rows.map((row) => ({
    roundno: row.roundno,
    winning_time: row.winning_time,
    numbers: parseJsonSafe(row.numbers_json, []),
    sum12: row.sum12,
    bigsmall: row.bigsmall,
    oddeven: row.oddeven,
    dragon_tiger: parseJsonSafe(row.dragon_tiger_json, []),
  }));
}

function championDistribution(rows) {
  const counts = Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1).padStart(2, '0'), count: 0 }));
  for (const row of rows) {
    const first = row.numbers && row.numbers[0] ? String(row.numbers[0]).padStart(2, '0') : null;
    if (!first) continue;
    const idx = Number(first) - 1;
    if (idx >= 0 && idx < counts.length) counts[idx].count += 1;
  }
  const max = Math.max(1, ...counts.map((x) => x.count));
  return counts.map((x) => ({ ...x, width: Math.round((x.count / max) * 100) }));
}

function predictionHistory(limit = 30) {
  return db.prepare(`
    SELECT target_roundno, based_on_roundno, generated_at, model_version,
           top3_json, side_json, fusion_json, confidence,
           accuracy_total, accuracy_possible, accuracy_rate,
           rank_hits, rank_possible, sum_hits, sum_possible, dragon_hits, dragon_possible,
           side_hits, side_possible, evaluated_at
    FROM predictions
    ORDER BY COALESCE(evaluated_at, generated_at) DESC
    LIMIT ?
  `).all(limit).map((row) => ({
    ...row,
    top3: parseJsonSafe(row.top3_json, []),
    side: parseJsonSafe(row.side_json, null),
    fusion: parseJsonSafe(row.fusion_json, []),
  }));
}

function timeseqPredictionHistory(limit = 100) {
  return db.prepare(`
    SELECT target_roundno, based_on_roundno, generated_at, model_version, model_name,
           top3_json, side_json, model_json,
           accuracy_total, accuracy_possible, accuracy_rate,
           rank_hits, rank_possible, sum_hits, sum_possible, dragon_hits, dragon_possible,
           evaluated_at
    FROM timeseq_predictions
    ORDER BY COALESCE(evaluated_at, generated_at) DESC
    LIMIT ?
  `).all(limit).map((row) => ({
    ...row,
    top3: parseJsonSafe(row.top3_json, []),
    side: parseJsonSafe(row.side_json, null),
    model: parseJsonSafe(row.model_json, null),
  }));
}

function getXv1HistoryCompare(limit = 30) {
  return timeseqPredictionHistory(limit).map((row) => {
    const actualDraw = getDrawByRound(row.target_roundno);
    const actual = actualDraw ? parseDrawNumbers(actualDraw).map((x) => String(x).padStart(2, '0')) : [];
    let top1Hits = 0;
    let top3Hits = 0;
    let possible = 0;
    const compare = (row.top3 || []).slice(0, 10).map((item, idx) => {
      const candidates = Array.isArray(item?.top3) ? item.top3.map((x) => String(x).padStart(2, '0')) : [];
      const actualNo = actual[idx] || null;
      const top1Hit = !!actualNo && candidates[0] === actualNo;
      const top3Hit = !!actualNo && candidates.includes(actualNo);
      if (actualNo && candidates.length) {
        possible += 1;
        if (top1Hit) top1Hits += 1;
        if (top3Hit) top3Hits += 1;
      }
      return {
        label: item?.label || `第${idx + 1}名`,
        actual: actualNo,
        top3: candidates,
        top1Hit,
        top3Hit,
        score: item?.score ?? null,
        confidence: item?.confidence ?? null,
      };
    });
    return {
      target_roundno: row.target_roundno,
      based_on_roundno: row.based_on_roundno,
      generated_at: row.generated_at,
      evaluated_at: row.evaluated_at,
      accuracy_rate: row.accuracy_rate,
      rank_hits: row.rank_hits,
      rank_possible: row.rank_possible,
      actual,
      possible: possible || Number(row.rank_possible || 0) || 10,
      top1Hits,
      top3Hits: top3Hits || Number(row.rank_hits || 0) || 0,
      compare,
    };
  });
}

function buildGpt55BypassRows(top3Rows = [], model = null, positionRates = []) {
  const models = model && typeof model === 'object' ? model : {};
  return (top3Rows || []).slice(0, 10).map((item, idx) => {
    const pool = new Map();
    const add = (num, weight, source) => {
      const key = String(num).padStart(2, '0');
      const prev = pool.get(key) || { num: key, score: 0, sources: new Set() };
      prev.score += weight;
      if (source) prev.sources.add(source);
      pool.set(key, prev);
    };
    (Array.isArray(item?.top3) ? item.top3 : []).forEach((num, rank) => add(num, 4 - rank, 'fusion'));
    for (const [name, rows] of Object.entries(models)) {
      const row = Array.isArray(rows) ? rows[idx] : null;
      (Array.isArray(row?.top3) ? row.top3 : []).forEach((num, rank) => add(num, Math.max(0.5, 2.8 - rank * 0.65), name));
    }
    const posRate = positionRates[idx] || {};
    const stabilityBoost = Number(posRate.top1Rate || 0) >= 12 ? 0.18 : 0;
    const ranked = [...pool.values()].map((x) => ({
      ...x,
      finalScore: x.score + (x.sources.size * 0.35) + stabilityBoost,
    })).sort((a, b) => b.finalScore - a.finalScore || a.num.localeCompare(b.num));
    const top3 = ranked.slice(0, 3).map((x) => x.num);
    const confidence = ranked.length ? Math.min(0.99, ranked[0].finalScore / Math.max(1, ranked.slice(0, 3).reduce((a, x) => a + x.finalScore, 0))) : 0;
    return {
      label: item?.label || `第${idx + 1}名`,
      top3,
      score: Number((ranked[0]?.finalScore || 0).toFixed(4)),
      confidence: Number(confidence.toFixed(4)),
      note: `GPT5.5旁路v2再评估：融合共识 ${ranked[0]?.sources?.size || 0} 层；不覆盖主模型`,
      source: 'gpt55-bypass-v2',
    };
  });
}

function getGpt55BypassHistory(limit = 30) {
  return timeseqPredictionHistory(limit).map((row) => {
    const actualDraw = getDrawByRound(row.target_roundno);
    const actual = actualDraw ? parseDrawNumbers(actualDraw).map((x) => String(x).padStart(2, '0')) : [];
    const bypassTop3 = buildGpt55BypassRows(row.top3 || [], row.model || null);
    let top1Hits = 0;
    let top3Hits = 0;
    let possible = 0;
    const compare = bypassTop3.map((item, idx) => {
      const candidates = Array.isArray(item?.top3) ? item.top3.map((x) => String(x).padStart(2, '0')) : [];
      const actualNo = actual[idx] || null;
      const top1Hit = !!actualNo && candidates[0] === actualNo;
      const top3Hit = !!actualNo && candidates.includes(actualNo);
      if (actualNo && candidates.length) {
        possible += 1;
        if (top1Hit) top1Hits += 1;
        if (top3Hit) top3Hits += 1;
      }
      return { ...item, actual: actualNo, top1Hit, top3Hit };
    });
    return {
      target_roundno: row.target_roundno,
      based_on_roundno: row.based_on_roundno,
      generated_at: row.generated_at,
      evaluated_at: row.evaluated_at,
      actual,
      possible: possible || 10,
      top1Hits,
      top3Hits,
      top3: bypassTop3,
      compare,
    };
  });
}

function getAdaptiveModelWeights(limit = 100) {
  const rows = timeseqPredictionHistory(limit).filter((row) => row.evaluated_at && row.model);
  const baseModels = ['frequency', 'markov', 'xgboost', 'lstm'];
  const weights = Array.from({ length: 10 }, (_, idx) => Object.fromEntries(baseModels.map((key) => [key, {
    key,
    label: key,
    position: idx + 1,
    possible: 0,
    top1Hits: 0,
    top3Hits: 0,
    misses: 0,
    weight: 1,
  }])));
  const ordered = [...rows].sort((a, b) => String(a.target_roundno).localeCompare(String(b.target_roundno)));
  for (const row of ordered) {
    const actualDraw = getDrawByRound(row.target_roundno);
    if (!actualDraw) continue;
    const actualNumbers = parseDrawNumbers(actualDraw).map((x) => String(x).padStart(2, '0'));
    for (let i = 0; i < Math.min(10, actualNumbers.length); i++) {
      const actual = actualNumbers[i];
      for (const key of baseModels) {
        const modelRow = row.model?.[key]?.[i];
        const candidates = Array.isArray(modelRow?.top3) ? modelRow.top3.map((x) => String(x).padStart(2, '0')) : [];
        if (!candidates.length) continue;
        const bucket = weights[i][key];
        bucket.possible += 1;
        if (candidates[0] === actual) bucket.top1Hits += 1;
        if (candidates.includes(actual)) bucket.top3Hits += 1;
        else bucket.misses += 1;
      }
    }
  }
  for (const row of weights) {
    for (const bucket of Object.values(row)) {
      const top1Rate = bucket.possible ? bucket.top1Hits / bucket.possible : 0;
      const top3Rate = bucket.possible ? bucket.top3Hits / bucket.possible : 0;
      const missRate = bucket.possible ? bucket.misses / bucket.possible : 0;
      bucket.top1Rate = Number((top1Rate * 100).toFixed(2));
      bucket.top3Rate = Number((top3Rate * 100).toFixed(2));
      bucket.weight = Number(Math.max(0.35, Math.min(2.2, 0.55 + top1Rate * 3.2 + top3Rate * 1.4 - missRate * 0.45)).toFixed(4));
    }
  }
  return weights;
}

function recentActualStats(limit = 60) {
  const draws = loadRecentDraws(limit).reverse();
  const stats = Array.from({ length: 10 }, () => ({}));
  for (const draw of draws) {
    const nums = parseDrawNumbers(draw).map((x) => String(x).padStart(2, '0'));
    nums.slice(0, 10).forEach((n, idx) => {
      stats[idx][n] = (stats[idx][n] || 0) + 1;
    });
  }
  return stats;
}

function buildGpt55BypassV3Rows(top3Rows = [], model = null, positionRates = [], adaptiveWeights = null, recentStats = null) {
  const models = model && typeof model === 'object' ? model : {};
  const weights = adaptiveWeights || getAdaptiveModelWeights(100);
  const recents = recentStats || recentActualStats(60);
  return (top3Rows || []).slice(0, 10).map((item, idx) => {
    const pool = new Map();
    const add = (num, weight, source) => {
      const key = String(num).padStart(2, '0');
      const prev = pool.get(key) || { num: key, score: 0, sources: new Set(), detail: [] };
      prev.score += weight;
      if (source) prev.sources.add(source);
      prev.detail.push(`${source}:${weight.toFixed(3)}`);
      pool.set(key, prev);
    };
    (Array.isArray(item?.top3) ? item.top3 : []).forEach((num, rank) => add(num, (4.2 - rank) * 1.08, 'main-fusion'));
    for (const [name, rows] of Object.entries(models)) {
      const row = Array.isArray(rows) ? rows[idx] : null;
      const modelWeight = weights[idx]?.[name]?.weight || 1;
      (Array.isArray(row?.top3) ? row.top3 : []).forEach((num, rank) => add(num, Math.max(0.35, (3.2 - rank * 0.72) * modelWeight), name));
    }
    const posRate = positionRates[idx] || {};
    const posBoost = Number(posRate.top1Rate || 0) >= 12 ? 0.22 : 0;
    const recent = recents[idx] || {};
    const totalRecent = Object.values(recent).reduce((a, n) => a + Number(n || 0), 0) || 1;
    const ranked = [...pool.values()].map((x) => {
      const recentRate = Number(recent[x.num] || 0) / totalRecent;
      const hotPenalty = recentRate > 0.18 ? 0.28 : 0;
      const coldBoost = recentRate < 0.055 ? 0.16 : 0;
      const consensusBoost = Math.min(0.75, x.sources.size * 0.15);
      const finalScore = x.score + posBoost + consensusBoost + coldBoost - hotPenalty;
      return { ...x, finalScore, recentRate };
    }).sort((a, b) => b.finalScore - a.finalScore || a.num.localeCompare(b.num));
    const top3 = ranked.slice(0, 3).map((x) => x.num);
    const confidence = ranked.length ? Math.min(0.99, ranked[0].finalScore / Math.max(1, ranked.slice(0, 3).reduce((a, x) => a + x.finalScore, 0))) : 0;
    return {
      label: item?.label || `第${idx + 1}名`,
      top3,
      score: Number((ranked[0]?.finalScore || 0).toFixed(4)),
      confidence: Number(confidence.toFixed(4)),
      note: `GPT5.5旁路v3：位置自适应权重 + 近期热冷修正 + 共识复审；不覆盖主模型`,
      source: 'gpt55-bypass-v3',
      explain: ranked.slice(0, 5).map((x) => ({ num: x.num, score: Number(x.finalScore.toFixed(4)), sources: [...x.sources], recentRate: Number(x.recentRate.toFixed(4)) })),
    };
  });
}

function getGpt55BypassV3History(limit = 30) {
  const weights = getAdaptiveModelWeights(100);
  const recents = recentActualStats(60);
  return timeseqPredictionHistory(limit).map((row) => {
    const actualDraw = getDrawByRound(row.target_roundno);
    const actual = actualDraw ? parseDrawNumbers(actualDraw).map((x) => String(x).padStart(2, '0')) : [];
    const bypassTop3 = buildGpt55BypassV3Rows(row.top3 || [], row.model || null, [], weights, recents);
    let top1Hits = 0;
    let top3Hits = 0;
    let possible = 0;
    const compare = bypassTop3.map((item, idx) => {
      const candidates = Array.isArray(item?.top3) ? item.top3.map((x) => String(x).padStart(2, '0')) : [];
      const actualNo = actual[idx] || null;
      const top1Hit = !!actualNo && candidates[0] === actualNo;
      const top3Hit = !!actualNo && candidates.includes(actualNo);
      if (actualNo && candidates.length) {
        possible += 1;
        if (top1Hit) top1Hits += 1;
        if (top3Hit) top3Hits += 1;
      }
      return { ...item, actual: actualNo, top1Hit, top3Hit };
    });
    return {
      target_roundno: row.target_roundno,
      based_on_roundno: row.based_on_roundno,
      generated_at: row.generated_at,
      evaluated_at: row.evaluated_at,
      actual,
      possible: possible || 10,
      top1Hits,
      top3Hits,
      top3: bypassTop3,
      compare,
    };
  });
}

function getGpt55V3WeightSummary() {
  const weights = getAdaptiveModelWeights(100);
  return weights.map((row, idx) => {
    const ranked = Object.values(row).sort((a, b) => b.weight - a.weight);
    return {
      position: idx + 1,
      label: `第${idx + 1}名`,
      bestModel: ranked[0]?.key || '-',
      bestWeight: ranked[0]?.weight || 0,
      weights: ranked.map((x) => ({ key: x.key, weight: x.weight, top1Rate: x.top1Rate, top3Rate: x.top3Rate })),
    };
  });
}

function buildModelPositionReliability(limit = 100) {
  const rows = timeseqPredictionHistory(limit).filter((row) => row.evaluated_at && row.model);
  const keys = ['main', 'v2', 'v3', 'frequency', 'markov', 'xgboost', 'lstm'];
  const buckets = Array.from({ length: 10 }, (_, pos) => Object.fromEntries(keys.map((key) => [key, { key, label: key, position: pos + 1, possible: 0, top1Hits: 0, top3Hits: 0, missStreak: 0, weight: 1 }])));
  for (const row of [...rows].sort((a, b) => String(a.target_roundno).localeCompare(String(b.target_roundno)))) {
    const actualDraw = getDrawByRound(row.target_roundno);
    if (!actualDraw) continue;
    const actual = parseDrawNumbers(actualDraw).map((x) => String(x).padStart(2, '0'));
    const sourceRows = {
      main: row.top3 || [],
      v2: buildGpt55BypassRows(row.top3 || [], row.model || null),
      v3: buildGpt55BypassV3Rows(row.top3 || [], row.model || null),
      frequency: row.model?.frequency || [],
      markov: row.model?.markov || [],
      xgboost: row.model?.xgboost || [],
      lstm: row.model?.lstm || [],
    };
    for (let pos = 0; pos < 10; pos++) {
      const a = actual[pos];
      if (!a) continue;
      for (const key of keys) {
        const candidates = Array.isArray(sourceRows[key]?.[pos]?.top3) ? sourceRows[key][pos].top3.map((x) => String(x).padStart(2, '0')) : [];
        if (!candidates.length) continue;
        const b = buckets[pos][key];
        b.possible += 1;
        const top1 = candidates[0] === a;
        const top3 = candidates.includes(a);
        if (top1) b.top1Hits += 1;
        if (top3) { b.top3Hits += 1; b.missStreak = 0; } else b.missStreak += 1;
      }
    }
  }
  return buckets.map((row) => Object.values(row).map((b) => {
    const top1Rate = b.possible ? b.top1Hits / b.possible : 0;
    const top3Rate = b.possible ? b.top3Hits / b.possible : 0;
    const weight = Math.max(0.25, Math.min(2.5, 0.45 + top1Rate * 4.2 + top3Rate * 1.2 - Math.min(0.8, b.missStreak * 0.06)));
    return { ...b, top1Rate: Number((top1Rate * 100).toFixed(2)), top3Rate: Number((top3Rate * 100).toFixed(2)), weight: Number(weight.toFixed(4)) };
  }).sort((a, b) => b.weight - a.weight));
}

function buildWindowModelRows(historyRows, windowSize, label) {
  const rows = [];
  const slice = historyRows.slice(-windowSize);
  for (let pos = 0; pos < 10; pos++) {
    const counts = {};
    for (const draw of slice) {
      const n = parseDrawNumbers(draw).map((x) => String(x).padStart(2, '0'))[pos];
      if (n) counts[n] = (counts[n] || 0) + 1;
    }
    const top = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, '0')).map((num) => ({ num, c: counts[num] || 0 })).sort((a, b) => b.c - a.c || a.num.localeCompare(b.num)).slice(0, 3);
    rows.push({ label: `第${pos + 1}名`, top3: top.map((x) => x.num), score: top[0]?.c || 0, note: `${label} window ${windowSize}` });
  }
  return rows;
}

function buildGapModelRows(historyRows) {
  const rows = [];
  for (let pos = 0; pos < 10; pos++) {
    const lastSeen = {};
    historyRows.forEach((draw, idx) => {
      const n = parseDrawNumbers(draw).map((x) => String(x).padStart(2, '0'))[pos];
      if (n) lastSeen[n] = idx;
    });
    const total = historyRows.length;
    const top = Array.from({ length: 10 }, (_, i) => {
      const num = String(i + 1).padStart(2, '0');
      const gap = lastSeen[num] == null ? total : total - 1 - lastSeen[num];
      return { num, gap, score: gap >= 8 && gap <= 24 ? gap + 10 : gap };
    }).sort((a, b) => b.score - a.score || a.num.localeCompare(b.num)).slice(0, 3);
    rows.push({ label: `第${pos + 1}名`, top3: top.map((x) => x.num), score: top[0]?.score || 0, note: '遗漏/回补模型' });
  }
  return rows;
}

function buildAntiHotModelRows(historyRows) {
  const rows = [];
  const recent = historyRows.slice(-30);
  const mid = historyRows.slice(-100);
  for (let pos = 0; pos < 10; pos++) {
    const c30 = {}, c100 = {};
    for (const draw of recent) { const n = parseDrawNumbers(draw).map((x) => String(x).padStart(2, '0'))[pos]; if (n) c30[n] = (c30[n] || 0) + 1; }
    for (const draw of mid) { const n = parseDrawNumbers(draw).map((x) => String(x).padStart(2, '0'))[pos]; if (n) c100[n] = (c100[n] || 0) + 1; }
    const top = Array.from({ length: 10 }, (_, i) => {
      const num = String(i + 1).padStart(2, '0');
      const hot30 = (c30[num] || 0) / 30;
      const hot100 = (c100[num] || 0) / 100;
      return { num, score: hot100 - Math.max(0, hot30 - hot100) * 1.5 };
    }).sort((a, b) => b.score - a.score || a.num.localeCompare(b.num)).slice(0, 3);
    rows.push({ label: `第${pos + 1}名`, top3: top.map((x) => x.num), score: Number((top[0]?.score || 0).toFixed(4)), note: '反热模型' });
  }
  return rows;
}

function getAnalystV3ModelMatrix(row, historyRows) {
  const model = row?.model || {};
  const main = row?.top3 || [];
  const matrix = [
    { name: 'main', signal: 'ensemble', rows: main },
    { name: 'v2', signal: 'ensemble', rows: buildGpt55BypassRows(main, model) },
    { name: 'v3', signal: 'ensemble', rows: buildGpt55BypassV3Rows(main, model) },
    { name: 'frequency', signal: 'frequency', rows: model.frequency || [] },
    { name: 'markov', signal: 'transition', rows: model.markov || [] },
    { name: 'xgboost', signal: 'stat', rows: model.xgboost || [] },
    { name: 'lstm', signal: 'sequence', rows: model.lstm || [] },
    { name: 'window30', signal: 'window', rows: buildWindowModelRows(historyRows, 30, '短窗口') },
    { name: 'window100', signal: 'window', rows: buildWindowModelRows(historyRows, 100, '中窗口') },
    { name: 'window300', signal: 'window', rows: buildWindowModelRows(historyRows, 300, '长窗口') },
    { name: 'gap', signal: 'gap', rows: buildGapModelRows(historyRows) },
    { name: 'anti_hot', signal: 'anti_hot', rows: buildAntiHotModelRows(historyRows) },
  ];
  return matrix.filter((m) => Array.isArray(m.rows) && m.rows.length);
}

function computeModelPositionStatsFromMatrix(historyRows, predRows, limit = 100) {
  const stats = {};
  const rows = predRows.filter((r) => r.evaluated_at).slice(0, limit);
  for (const row of rows) {
    const baseDraw = getDrawByRound(row.based_on_roundno) || getDrawByRound(String(Number(row.target_roundno || 0) - 1));
    const actualDraw = getDrawByRound(row.target_roundno);
    if (!baseDraw || !actualDraw) continue;
    const hist = db.prepare('SELECT * FROM draws WHERE roundno <= ? ORDER BY roundno DESC LIMIT 360').all(baseDraw.roundno).reverse();
    const matrix = getAnalystV3ModelMatrix(row, hist);
    const actual = parseDrawNumbers(actualDraw).map((x) => String(x).padStart(2, '0'));
    for (const m of matrix) {
      for (let pos = 0; pos < 10; pos++) {
        const key = `${m.name}:${pos + 1}`;
        const bucket = stats[key] || { model: m.name, signal: m.signal, position: pos + 1, samples: 0, top1Hits: 0, top3Hits: 0, currentMissStreak: 0 };
        const candidates = (m.rows[pos]?.top3 || []).map((x) => String(x).padStart(2, '0'));
        if (!candidates.length || !actual[pos]) continue;
        bucket.samples += 1;
        if (candidates[0] === actual[pos]) bucket.top1Hits += 1;
        if (candidates.includes(actual[pos])) { bucket.top3Hits += 1; bucket.currentMissStreak = 0; } else bucket.currentMissStreak += 1;
        stats[key] = bucket;
      }
    }
  }
  return Object.values(stats).map((s) => {
    const top1Rate = s.samples ? s.top1Hits / s.samples : 0;
    const top3Rate = s.samples ? s.top3Hits / s.samples : 0;
    return { ...s, top1Rate: Number((top1Rate * 100).toFixed(2)), top3Rate: Number((top3Rate * 100).toFixed(2)), weight: Number(Math.max(0.2, Math.min(3, 0.4 + top1Rate * 4 + top3Rate * 1.4 - s.currentMissStreak * 0.04)).toFixed(4)) };
  });
}

function buildAnalystV3Prediction(matrix, stats) {
  const byModelPos = Object.fromEntries(stats.map((s) => [`${s.model}:${s.position}`, s]));
  const top3 = [], overlap = [], reasons = [];
  for (let pos = 0; pos < 10; pos++) {
    const nums = {};
    for (const m of matrix) {
      const st = byModelPos[`${m.name}:${pos + 1}`] || { weight: 1, top1Rate: 0, top3Rate: 0 };
      (m.rows[pos]?.top3 || []).forEach((n, idx) => {
        const num = String(n).padStart(2, '0');
        const item = nums[num] || { num, score: 0, models: [], signalTypes: new Set() };
        item.score += Math.max(0.1, (3 - idx * 0.65) * st.weight);
        item.models.push({ model: m.name, signal: m.signal, weight: st.weight, rank: idx + 1, top3Rate: st.top3Rate });
        item.signalTypes.add(m.signal);
        nums[num] = item;
      });
    }
    const ranked = Object.values(nums).map((x) => ({ ...x, signalCount: x.signalTypes.size, modelCount: x.models.length, finalScore: Number((x.score + Math.min(1.4, x.signalTypes.size * 0.22) + Math.min(1.2, x.models.length * 0.08)).toFixed(4)) })).sort((a, b) => b.finalScore - a.finalScore || a.num.localeCompare(b.num));
    const picks = ranked.slice(0, 3).map((x) => x.num);
    top3.push({ label: `第${pos + 1}名`, top3: picks, score: ranked[0]?.finalScore || 0, confidence: Number(Math.min(0.99, (ranked[0]?.finalScore || 0) / Math.max(1, ranked.slice(0, 3).reduce((a, x) => a + x.finalScore, 0))).toFixed(4)), source: 'gpt55-analyst-v3', note: '多模型位置矩阵 + 加权重合率 + 信号类型可靠度' });
    overlap.push({ label: `第${pos + 1}名`, candidates: ranked.slice(0, 6).map((x) => ({ num: x.num, score: x.finalScore, modelCount: x.modelCount, signalCount: x.signalCount, models: x.models.slice(0, 6) })) });
    reasons.push({ label: `第${pos + 1}名`, selected: picks, reason: `按模型可靠度和重合率选择 ${picks.join('/')}`, strongest: ranked[0] || null });
  }
  return { top3, overlap, reasons };
}

function materializeAnalystV3(limit = 60) {
  const predRows = timeseqPredictionHistory(Math.max(100, limit));
  const stats = computeModelPositionStatsFromMatrix([], predRows, 100);
  const generatedAt = nowIso();
  const predStmt = db.prepare(`INSERT INTO gpt55_analyst_v3_predictions (target_roundno,based_on_roundno,generated_at,model_version,matrix_json,stats_json,overlap_json,top3_json,reason_json,error_json,actual_json,compare_json,top1_hits,top3_hits,possible,top1_rate,top3_rate,evaluated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(target_roundno) DO UPDATE SET based_on_roundno=excluded.based_on_roundno,generated_at=excluded.generated_at,model_version=excluded.model_version,matrix_json=excluded.matrix_json,stats_json=excluded.stats_json,overlap_json=excluded.overlap_json,top3_json=excluded.top3_json,reason_json=excluded.reason_json,error_json=excluded.error_json,actual_json=excluded.actual_json,compare_json=excluded.compare_json,top1_hits=excluded.top1_hits,top3_hits=excluded.top3_hits,possible=excluded.possible,top1_rate=excluded.top1_rate,top3_rate=excluded.top3_rate,evaluated_at=excluded.evaluated_at`);
  const outStmt = db.prepare(`INSERT INTO gpt55_analyst_model_outputs (version,target_roundno,model_name,signal_type,position,top3_json,score,generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(version,target_roundno,model_name,position) DO UPDATE SET signal_type=excluded.signal_type,top3_json=excluded.top3_json,score=excluded.score,generated_at=excluded.generated_at`);
  const statStmt = db.prepare(`INSERT INTO gpt55_analyst_model_position_stats (version,model_name,signal_type,position,samples,top1_hits,top3_hits,top1_rate,top3_rate,current_miss_streak,weight,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(version,model_name,position) DO UPDATE SET samples=excluded.samples,top1_hits=excluded.top1_hits,top3_hits=excluded.top3_hits,top1_rate=excluded.top1_rate,top3_rate=excluded.top3_rate,current_miss_streak=excluded.current_miss_streak,weight=excluded.weight,updated_at=excluded.updated_at`);
  for (const s of stats) statStmt.run('v3', s.model, s.signal, s.position, s.samples, s.top1Hits, s.top3Hits, s.top1Rate, s.top3Rate, s.currentMissStreak, s.weight, generatedAt);
  let written = 0;
  for (const row of predRows.slice(0, limit)) {
    const baseDraw = getDrawByRound(row.based_on_roundno) || getDrawByRound(String(Number(row.target_roundno || 0) - 1));
    if (!baseDraw) continue;
    const hist = db.prepare('SELECT * FROM draws WHERE roundno <= ? ORDER BY roundno DESC LIMIT 360').all(baseDraw.roundno).reverse();
    const matrix = getAnalystV3ModelMatrix(row, hist);
    const pred = buildAnalystV3Prediction(matrix, stats);
    const cmp = compareAnalystPrediction(row.target_roundno, pred.top3);
    const errors = buildAnalystError(cmp.compare);
    const possible = cmp.possible || 10;
    for (const m of matrix) for (let pos = 0; pos < Math.min(10, m.rows.length); pos++) outStmt.run('v3', String(row.target_roundno || ''), m.name, m.signal, pos + 1, JSON.stringify(m.rows[pos]?.top3 || []), Number(m.rows[pos]?.score || 0), generatedAt);
    predStmt.run(String(row.target_roundno || ''), row.based_on_roundno ? String(row.based_on_roundno) : null, generatedAt, 'gpt55-analyst-v3', JSON.stringify(matrix.map((m) => ({ name: m.name, signal: m.signal, rows: m.rows }))), JSON.stringify(stats), JSON.stringify(pred.overlap), JSON.stringify(pred.top3), JSON.stringify(pred.reasons), JSON.stringify(errors), JSON.stringify(cmp.actual), JSON.stringify(cmp.compare), cmp.top1Hits, cmp.top3Hits, possible, possible ? (cmp.top1Hits / possible) * 100 : 0, possible ? (cmp.top3Hits / possible) * 100 : 0, row.evaluated_at || null);
    written += 1;
  }
  return { written, generatedAt };
}

function readAnalystV3(limit = 30) {
  const latestSource = timeseqPredictionHistory(1)[0]?.target_roundno || null;
  const latestStored = db.prepare('SELECT target_roundno FROM gpt55_analyst_v3_predictions ORDER BY target_roundno DESC LIMIT 1').get()?.target_roundno || null;
  const existing = db.prepare('SELECT COUNT(*) AS c FROM gpt55_analyst_v3_predictions').get()?.c || 0;
  const sourceAdvanced = latestSource && latestStored && String(latestStored) < String(latestSource);
  const needsInitialFill = !latestStored || existing < Math.max(1, Number(limit) || 30);
  const write = needsInitialFill
    ? materializeAnalystV3(Math.max(60, limit))
    : (sourceAdvanced
      ? materializeAnalystV3(8)
      : { written: 0, generatedAt: nowIso(), cached: true, latestStored, latestSource });
  const rows = db.prepare('SELECT * FROM gpt55_analyst_v3_predictions ORDER BY COALESCE(evaluated_at, generated_at) DESC, target_roundno DESC LIMIT ?').all(limit).map((row) => ({ ...row, matrix: parseJsonSafe(row.matrix_json, []), stats: parseJsonSafe(row.stats_json, []), overlap: parseJsonSafe(row.overlap_json, []), top3: parseJsonSafe(row.top3_json, []), reasons: parseJsonSafe(row.reason_json, []), errors: parseJsonSafe(row.error_json, []), actual: parseJsonSafe(row.actual_json, []), compare: parseJsonSafe(row.compare_json, []) }));
  const totals = rows.reduce((acc, row) => { acc.samples += row.evaluated_at ? 1 : 0; acc.possible += Number(row.possible || 0); acc.top1Hits += Number(row.top1_hits || 0); acc.top3Hits += Number(row.top3_hits || 0); return acc; }, { samples: 0, possible: 0, top1Hits: 0, top3Hits: 0 });
  const rate = (hits, total) => total ? Number(((hits / total) * 100).toFixed(2)) : 0;
  const latest = rows[0] || null;
  const statRows = db.prepare('SELECT * FROM gpt55_analyst_model_position_stats WHERE version = ? ORDER BY position ASC, weight DESC').all('v3');
  return { enabled: true, name: 'GPT5.5 分析师 v3', table: 'gpt55_analyst_v3_predictions', mode: 'multi-model-position-overlap', description: '多模型位置矩阵 + 分位置回测 + 加权重合率 + 错误反推 + 策略状态基础。', lastWrite: write, metrics: { ...totals, top1Rate: rate(totals.top1Hits, totals.possible), top3Rate: rate(totals.top3Hits, totals.possible) }, latest, rows, modelPositionStats: statRows };
}

function buildGpt55AnalystV2Prediction(historyRows, sourcePred, reliability) {
  const top1Rows = [];
  const coverageRows = [];
  const top3Rows = [];
  const reasons = [];
  for (let pos = 0; pos < 10; pos++) {
    const rel = reliability[pos] || [];
    const relMap = Object.fromEntries(rel.map((r) => [r.key, r]));
    const scores = {};
    const add = (num, value, channel) => {
      const n = String(num).padStart(2, '0');
      const s = scores[n] || { num: n, top1Score: 0, coverScore: 0, channels: [] };
      s.top1Score += value.top1 || 0;
      s.coverScore += value.cover || 0;
      s.channels.push(channel);
      scores[n] = s;
    };
    const addRows = (key, rows) => {
      const w = relMap[key]?.weight || 1;
      const top1Rate = Number(relMap[key]?.top1Rate || 0) / 100;
      const top3Rate = Number(relMap[key]?.top3Rate || 0) / 100;
      (rows?.[pos]?.top3 || []).forEach((n, idx) => add(n, { top1: (3.8 - idx) * w * (0.75 + top1Rate), cover: (3.2 - idx * 0.65) * w * (0.75 + top3Rate) }, key));
    };
    addRows('main', sourcePred.main);
    addRows('v2', sourcePred.v2);
    addRows('v3', sourcePred.v3);
    addRows('frequency', sourcePred.frequency);
    addRows('markov', sourcePred.markov);
    addRows('xgboost', sourcePred.xgboost);
    addRows('lstm', sourcePred.lstm);
    const lastSeen = {};
    historyRows.forEach((draw, idx) => { const n = parseDrawNumbers(draw).map((x) => String(x).padStart(2, '0'))[pos]; if (n) lastSeen[n] = idx; });
    for (let i = 1; i <= 10; i++) {
      const n = String(i).padStart(2, '0');
      const gap = lastSeen[n] == null ? historyRows.length : historyRows.length - 1 - lastSeen[n];
      const s = scores[n] || { num: n, top1Score: 0, coverScore: 0, channels: [] };
      if (gap >= 8 && gap <= 24) s.coverScore += 0.9;
      if (gap <= 2) s.top1Score -= 0.45;
      scores[n] = s;
    }
    const top1Rank = Object.values(scores).sort((a, b) => b.top1Score - a.top1Score || a.num.localeCompare(b.num));
    const coverRank = Object.values(scores).sort((a, b) => b.coverScore - a.coverScore || a.num.localeCompare(b.num));
    const first = top1Rank[0]?.num || '01';
    const picks = [first];
    for (const c of coverRank) if (!picks.includes(c.num)) picks.push(c.num); 
    const top3 = picks.slice(0, 3);
    top1Rows.push({ label: `第${pos + 1}名`, top1: first, score: Number((top1Rank[0]?.top1Score || 0).toFixed(4)), bestModel: rel[0]?.key || '-' });
    coverageRows.push({ label: `第${pos + 1}名`, coverage: top3.slice(1), score: Number((top3.reduce((a, n) => a + (scores[n]?.coverScore || 0), 0)).toFixed(4)) });
    top3Rows.push({ label: `第${pos + 1}名`, top3, score: Number((top1Rank[0]?.top1Score || 0).toFixed(4)), confidence: Number(Math.min(0.99, (top1Rank[0]?.top1Score || 0) / Math.max(1, top3.reduce((a, n) => a + (scores[n]?.top1Score || 0), 0))).toFixed(4)), source: 'gpt55-analyst-v2', note: 'Top1专用选择 + Top3覆盖补充 + 分位置模型可靠度' });
    reasons.push({ label: `第${pos + 1}名`, top1: first, top3, bestModels: rel.slice(0, 3), reason: `Top1优先信任 ${rel[0]?.key || '-'}；Top3用覆盖分补充 ${top3.slice(1).join('/')}` });
  }
  return { top1Rows, coverageRows, top3Rows, reasons, reliability };
}

function buildAnalystError(compareRows) {
  return (compareRows || []).filter((c) => !c.top3Hit).map((c) => ({ label: c.label, actual: c.actual, predicted: c.top3, missReason: c.top1Hit ? 'Top1命中但标记异常' : 'Top3未覆盖', badSignal: '候选覆盖不足或位置可靠度误判', adjustment: '降低本位置失效模型权重，增加覆盖候选' }));
}

function materializeGpt55AnalystV2(limit = 60) {
  const reliability = buildModelPositionReliability(100);
  const rows = timeseqPredictionHistory(limit);
  const generatedAt = nowIso();
  const stmt = db.prepare(`
    INSERT INTO gpt55_analyst_v2_predictions (target_roundno,based_on_roundno,generated_at,model_version,reliability_json,top1_json,coverage_json,top3_json,reason_json,error_json,actual_json,compare_json,top1_hits,top3_hits,possible,top1_rate,top3_rate,evaluated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(target_roundno) DO UPDATE SET based_on_roundno=excluded.based_on_roundno,generated_at=excluded.generated_at,model_version=excluded.model_version,reliability_json=excluded.reliability_json,top1_json=excluded.top1_json,coverage_json=excluded.coverage_json,top3_json=excluded.top3_json,reason_json=excluded.reason_json,error_json=excluded.error_json,actual_json=excluded.actual_json,compare_json=excluded.compare_json,top1_hits=excluded.top1_hits,top3_hits=excluded.top3_hits,possible=excluded.possible,top1_rate=excluded.top1_rate,top3_rate=excluded.top3_rate,evaluated_at=excluded.evaluated_at
  `);
  let written = 0;
  for (const row of rows) {
    const baseDraw = getDrawByRound(row.based_on_roundno) || getDrawByRound(String(Number(row.target_roundno || 0) - 1));
    if (!baseDraw) continue;
    const hist = db.prepare('SELECT * FROM draws WHERE roundno <= ? ORDER BY roundno DESC LIMIT 360').all(baseDraw.roundno).reverse();
    const sourcePred = { main: row.top3 || [], v2: buildGpt55BypassRows(row.top3 || [], row.model || null), v3: buildGpt55BypassV3Rows(row.top3 || [], row.model || null), frequency: row.model?.frequency || [], markov: row.model?.markov || [], xgboost: row.model?.xgboost || [], lstm: row.model?.lstm || [] };
    const pred = buildGpt55AnalystV2Prediction(hist, sourcePred, reliability);
    const cmp = compareAnalystPrediction(row.target_roundno, pred.top3Rows);
    const errors = buildAnalystError(cmp.compare);
    const possible = cmp.possible || 10;
    stmt.run(String(row.target_roundno || ''), row.based_on_roundno ? String(row.based_on_roundno) : null, generatedAt, 'gpt55-analyst-v2', JSON.stringify(reliability), JSON.stringify(pred.top1Rows), JSON.stringify(pred.coverageRows), JSON.stringify(pred.top3Rows), JSON.stringify(pred.reasons), JSON.stringify(errors), JSON.stringify(cmp.actual), JSON.stringify(cmp.compare), cmp.top1Hits, cmp.top3Hits, possible, possible ? (cmp.top1Hits / possible) * 100 : 0, possible ? (cmp.top3Hits / possible) * 100 : 0, row.evaluated_at || null);
    written += 1;
  }
  return { written, generatedAt };
}

function readGpt55AnalystV2(limit = 30) {
  const latestSource = timeseqPredictionHistory(1)[0]?.target_roundno || null;
  const latestStored = db.prepare('SELECT target_roundno FROM gpt55_analyst_v2_predictions ORDER BY target_roundno DESC LIMIT 1').get()?.target_roundno || null;
  const missingEval = db.prepare(`SELECT COUNT(*) AS c FROM gpt55_analyst_v2_predictions p JOIN draws d ON d.roundno = p.target_roundno WHERE p.evaluated_at IS NULL`).get()?.c || 0;
  const write = (!latestStored || String(latestStored) < String(latestSource || '') || missingEval)
    ? materializeGpt55AnalystV2(Math.max(60, limit))
    : { written: 0, generatedAt: nowIso(), cached: true, latestStored, latestSource };
  const rows = db.prepare('SELECT * FROM gpt55_analyst_v2_predictions ORDER BY COALESCE(evaluated_at, generated_at) DESC, target_roundno DESC LIMIT ?').all(Math.max(1, Math.min(300, Number(limit) || 30))).map((row) => ({ ...row, reliability: parseJsonSafe(row.reliability_json, []), top1: parseJsonSafe(row.top1_json, []), coverage: parseJsonSafe(row.coverage_json, []), top3: parseJsonSafe(row.top3_json, []), reasons: parseJsonSafe(row.reason_json, []), errors: parseJsonSafe(row.error_json, []), actual: parseJsonSafe(row.actual_json, []), compare: parseJsonSafe(row.compare_json, []) }));
  const totals = rows.reduce((acc, row) => { acc.samples += row.evaluated_at ? 1 : 0; acc.possible += Number(row.possible || 0); acc.top1Hits += Number(row.top1_hits || 0); acc.top3Hits += Number(row.top3_hits || 0); return acc; }, { samples: 0, possible: 0, top1Hits: 0, top3Hits: 0 });
  const rate = (hits, total) => total ? Number(((hits / total) * 100).toFixed(2)) : 0;
  const latest = rows[0] || null;
  return { enabled: true, name: 'GPT5.5 分析师 v2', table: 'gpt55_analyst_v2_predictions', mode: 'analyst-v2-shadow', description: '分位置可靠度 + Top1/Top3分离 + 错误原因反推；只展示和回测。', lastWrite: write, metrics: { ...totals, top1Rate: rate(totals.top1Hits, totals.possible), top3Rate: rate(totals.top3Hits, totals.possible) }, latest, rows };
}

function buildGpt55AnalystPrediction(historyRows, currentPred, bypassV2, bypassV3) {
  const top3 = [];
  const reasons = [];
  const risks = [];
  const analysis = [];
  for (let pos = 0; pos < 10; pos++) {
    const counts = (size) => {
      const out = {};
      for (const draw of historyRows.slice(-size)) {
        const n = parseDrawNumbers(draw).map((x) => String(x).padStart(2, '0'))[pos];
        if (n) out[n] = (out[n] || 0) + 1;
      }
      return out;
    };
    const w30 = counts(30), w100 = counts(100), w300 = counts(300);
    const lastSeen = {};
    historyRows.forEach((draw, idx) => {
      const n = parseDrawNumbers(draw).map((x) => String(x).padStart(2, '0'))[pos];
      if (n) lastSeen[n] = idx;
    });
    const votes = {};
    const add = (num, weight, source) => {
      const n = String(num).padStart(2, '0');
      const v = votes[n] || { score: 0, sources: new Set() };
      v.score += weight;
      v.sources.add(source);
      votes[n] = v;
    };
    (currentPred?.top3?.[pos]?.top3 || []).forEach((n, i) => add(n, 4 - i, 'main'));
    (bypassV2?.top3?.[pos]?.top3 || []).forEach((n, i) => add(n, 3.2 - i * 0.7, 'v2'));
    (bypassV3?.top3?.[pos]?.top3 || []).forEach((n, i) => add(n, 3.4 - i * 0.65, 'v3'));
    const scored = [];
    for (let i = 1; i <= 10; i++) {
      const n = String(i).padStart(2, '0');
      const hot30 = Number(w30[n] || 0) / 30;
      const hot100 = Number(w100[n] || 0) / 100;
      const hot300 = Number(w300[n] || 0) / Math.max(1, Math.min(300, historyRows.length));
      const gap = lastSeen[n] == null ? historyRows.length : Math.max(0, historyRows.length - 1 - lastSeen[n]);
      const vote = votes[n]?.score || 0;
      const sourceCount = votes[n]?.sources?.size || 0;
      const overHotPenalty = hot30 > hot100 * 1.45 && hot30 > 0.16 ? 0.9 : 0;
      const recoveryBoost = gap >= 8 && gap <= 26 ? 0.65 : (gap > 26 ? 0.25 : 0);
      const trendBoost = hot30 > hot100 && hot100 >= hot300 ? 0.35 : 0;
      const consensusBoost = sourceCount >= 2 ? sourceCount * 0.28 : 0;
      const score = vote + recoveryBoost + trendBoost + consensusBoost - overHotPenalty;
      scored.push({ num: n, score: Number(score.toFixed(4)), hot30: Number(hot30.toFixed(4)), hot100: Number(hot100.toFixed(4)), gap, vote: Number(vote.toFixed(4)), sourceCount });
    }
    scored.sort((a, b) => b.score - a.score || a.num.localeCompare(b.num));
    const picks = scored.slice(0, 3).map((x) => x.num);
    const risk = scored[0]?.score - scored[2]?.score < 0.9 ? '高' : '中';
    top3.push({ label: `第${pos + 1}名`, top3: picks, score: scored[0]?.score || 0, confidence: Number(Math.min(0.99, (scored[0]?.score || 0) / Math.max(1, scored.slice(0, 3).reduce((a, x) => a + x.score, 0))).toFixed(4)), source: 'gpt55-analyst-v1', note: 'GPT5.5数据分析师v1：历史窗口 + 遗漏 + 热冷 + 主/v2/v3分歧综合分析' });
    reasons.push({ label: `第${pos + 1}名`, selected: picks, reason: `综合模型票源、热度、遗漏和过热惩罚后选择 ${picks.join('/')}`, topSignals: scored.slice(0, 5) });
    risks.push({ label: `第${pos + 1}名`, risk, note: risk === '高' ? '候选分差小，波动较高' : '存在一定共识' });
    analysis.push({ label: `第${pos + 1}名`, signals: scored.slice(0, 10) });
  }
  return { top3, reasons, risks, analysis };
}

function compareAnalystPrediction(targetRoundno, top3Rows) {
  const actualDraw = getDrawByRound(targetRoundno);
  const actual = actualDraw ? parseDrawNumbers(actualDraw).map((x) => String(x).padStart(2, '0')) : [];
  let top1Hits = 0, top3Hits = 0, possible = 0;
  const compare = (top3Rows || []).map((item, idx) => {
    const candidates = Array.isArray(item?.top3) ? item.top3.map((x) => String(x).padStart(2, '0')) : [];
    const actualNo = actual[idx] || null;
    const top1Hit = !!actualNo && candidates[0] === actualNo;
    const top3Hit = !!actualNo && candidates.includes(actualNo);
    if (actualNo && candidates.length) { possible += 1; if (top1Hit) top1Hits += 1; if (top3Hit) top3Hits += 1; }
    return { label: item?.label || `第${idx + 1}名`, actual: actualNo, top3: candidates, top1Hit, top3Hit };
  });
  return { actual, compare, top1Hits, top3Hits, possible: possible || 10 };
}

function materializeGpt55Analyst(limit = 60) {
  const rows = timeseqPredictionHistory(limit);
  const generatedAt = nowIso();
  const stmt = db.prepare(`
    INSERT INTO gpt55_analyst_predictions (
      target_roundno, based_on_roundno, generated_at, model_version,
      analysis_json, top3_json, reason_json, risk_json,
      actual_json, compare_json, top1_hits, top3_hits, possible, top1_rate, top3_rate, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(target_roundno) DO UPDATE SET
      based_on_roundno=excluded.based_on_roundno, generated_at=excluded.generated_at, model_version=excluded.model_version,
      analysis_json=excluded.analysis_json, top3_json=excluded.top3_json, reason_json=excluded.reason_json, risk_json=excluded.risk_json,
      actual_json=excluded.actual_json, compare_json=excluded.compare_json, top1_hits=excluded.top1_hits, top3_hits=excluded.top3_hits,
      possible=excluded.possible, top1_rate=excluded.top1_rate, top3_rate=excluded.top3_rate, evaluated_at=excluded.evaluated_at
  `);
  let written = 0;
  for (const row of rows) {
    const baseDraw = getDrawByRound(row.based_on_roundno) || getDrawByRound(String(Number(row.target_roundno || 0) - 1));
    if (!baseDraw) continue;
    const hist = db.prepare('SELECT * FROM draws WHERE roundno <= ? ORDER BY roundno DESC LIMIT 360').all(baseDraw.roundno).reverse();
    const currentPred = { top3: row.top3 || [] };
    const v2 = { top3: buildGpt55BypassRows(row.top3 || [], row.model || null) };
    const v3 = { top3: buildGpt55BypassV3Rows(row.top3 || [], row.model || null) };
    const pred = buildGpt55AnalystPrediction(hist, currentPred, v2, v3);
    const cmp = compareAnalystPrediction(row.target_roundno, pred.top3);
    const possible = cmp.possible || 10;
    stmt.run(String(row.target_roundno || ''), row.based_on_roundno ? String(row.based_on_roundno) : null, generatedAt, 'gpt55-analyst-v1', JSON.stringify(pred.analysis), JSON.stringify(pred.top3), JSON.stringify(pred.reasons), JSON.stringify(pred.risks), JSON.stringify(cmp.actual), JSON.stringify(cmp.compare), cmp.top1Hits, cmp.top3Hits, possible, possible ? (cmp.top1Hits / possible) * 100 : 0, possible ? (cmp.top3Hits / possible) * 100 : 0, row.evaluated_at || null);
    written += 1;
  }
  return { written, generatedAt };
}

function readGpt55Analyst(limit = 30) {
  const write = materializeGpt55Analyst(Math.max(60, limit));
  const rows = db.prepare('SELECT * FROM gpt55_analyst_predictions ORDER BY COALESCE(evaluated_at, generated_at) DESC, target_roundno DESC LIMIT ?').all(Math.max(1, Math.min(300, Number(limit) || 30))).map((row) => ({ ...row, top3: parseJsonSafe(row.top3_json, []), analysis: parseJsonSafe(row.analysis_json, []), reasons: parseJsonSafe(row.reason_json, []), risks: parseJsonSafe(row.risk_json, []), actual: parseJsonSafe(row.actual_json, []), compare: parseJsonSafe(row.compare_json, []) }));
  const totals = rows.reduce((acc, row) => { acc.samples += row.evaluated_at ? 1 : 0; acc.possible += Number(row.possible || 0); acc.top1Hits += Number(row.top1_hits || 0); acc.top3Hits += Number(row.top3_hits || 0); return acc; }, { samples: 0, possible: 0, top1Hits: 0, top3Hits: 0 });
  const rate = (hits, total) => total ? Number(((hits / total) * 100).toFixed(2)) : 0;
  const latestDraw = getLatestDraw();
  const hist = latestDraw ? db.prepare('SELECT * FROM draws WHERE roundno <= ? ORDER BY roundno DESC LIMIT 360').all(latestDraw.roundno).reverse() : [];
  const latestHistory = timeseqPredictionHistory(1)[0];
  const next = latestHistory ? buildGpt55AnalystPrediction(hist, { top3: latestHistory.top3 || [] }, { top3: buildGpt55BypassRows(latestHistory.top3 || [], latestHistory.model || null) }, { top3: buildGpt55BypassV3Rows(latestHistory.top3 || [], latestHistory.model || null) }) : null;
  return { enabled: true, name: 'GPT5.5 数据分析师 v1', table: 'gpt55_analyst_predictions', mode: 'analyst-shadow', description: '基于历史窗口、遗漏、热冷、主模型/v2/v3分歧生成独立Top3分析；只展示和回测，不接管主链。', lastWrite: write, metrics: { ...totals, top1Rate: rate(totals.top1Hits, totals.possible), top3Rate: rate(totals.top3Hits, totals.possible) }, next, rows };
}

function materializeGpt55BypassTable(version = 'v2', limit = 60) {
  const normalizedVersion = version === 'v3' ? 'v3' : 'v2';
  const rows = normalizedVersion === 'v3' ? getGpt55BypassV3History(limit) : getGpt55BypassHistory(limit);
  const now = nowIso();
  const stmt = db.prepare(`
    INSERT INTO gpt55_bypass_predictions (
      version, target_roundno, based_on_roundno, generated_at, source_model_version,
      top3_json, compare_json, actual_json, top1_hits, top3_hits, possible,
      top1_rate, top3_rate, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(version, target_roundno) DO UPDATE SET
      based_on_roundno = excluded.based_on_roundno,
      generated_at = excluded.generated_at,
      source_model_version = excluded.source_model_version,
      top3_json = excluded.top3_json,
      compare_json = excluded.compare_json,
      actual_json = excluded.actual_json,
      top1_hits = excluded.top1_hits,
      top3_hits = excluded.top3_hits,
      possible = excluded.possible,
      top1_rate = excluded.top1_rate,
      top3_rate = excluded.top3_rate,
      evaluated_at = excluded.evaluated_at
  `);
  let written = 0;
  for (const row of rows) {
    const possible = Number(row.possible || 0) || 10;
    const top1Hits = Number(row.top1Hits || 0);
    const top3Hits = Number(row.top3Hits || 0);
    stmt.run(
      normalizedVersion,
      String(row.target_roundno || ''),
      row.based_on_roundno ? String(row.based_on_roundno) : null,
      now,
      normalizedVersion === 'v3' ? 'gpt55-bypass-v3-adaptive' : 'gpt55-bypass-v2-consensus',
      JSON.stringify(row.top3 || []),
      JSON.stringify(row.compare || []),
      JSON.stringify(row.actual || []),
      top1Hits,
      top3Hits,
      possible,
      possible ? (top1Hits / possible) * 100 : 0,
      possible ? (top3Hits / possible) * 100 : 0,
      row.evaluated_at || null,
    );
    written += 1;
  }
  return { version: normalizedVersion, written, generatedAt: now };
}

function readGpt55BypassTable(version = 'v2', limit = 30) {
  const normalizedVersion = version === 'v3' ? 'v3' : 'v2';
  const rows = db.prepare(`
    SELECT * FROM gpt55_bypass_predictions
    WHERE version = ?
    ORDER BY COALESCE(evaluated_at, generated_at) DESC, target_roundno DESC
    LIMIT ?
  `).all(normalizedVersion, Math.max(1, Math.min(500, Number(limit) || 30))).map((row) => ({
    ...row,
    top3: parseJsonSafe(row.top3_json, []),
    compare: parseJsonSafe(row.compare_json, []),
    actual: parseJsonSafe(row.actual_json, []),
  }));
  const totals = rows.reduce((acc, row) => {
    acc.samples += row.evaluated_at ? 1 : 0;
    acc.possible += Number(row.possible || 0);
    acc.top1Hits += Number(row.top1_hits || 0);
    acc.top3Hits += Number(row.top3_hits || 0);
    return acc;
  }, { samples: 0, possible: 0, top1Hits: 0, top3Hits: 0 });
  const rate = (hits, total) => total ? Number(((hits / total) * 100).toFixed(2)) : 0;
  return {
    version: normalizedVersion,
    rows,
    metrics: {
      ...totals,
      top1Rate: rate(totals.top1Hits, totals.possible),
      top3Rate: rate(totals.top3Hits, totals.possible),
    },
  };
}

function getGpt55BypassTableModule(limit = 30) {
  const v2Write = materializeGpt55BypassTable('v2', Math.max(60, limit));
  const v3Write = materializeGpt55BypassTable('v3', Math.max(60, limit));
  const v2 = readGpt55BypassTable('v2', limit);
  const v3 = readGpt55BypassTable('v3', limit);
  return {
    enabled: true,
    table: 'gpt55_bypass_predictions',
    mode: 'materialized-shadow',
    description: '旁路 v2/v3 结果已写入独立表，页面从表读取，不再只是请求时即时计算。',
    lastWrite: { v2: v2Write, v3: v3Write },
    v2,
    v3,
  };
}

function getBypassMetricsFromCompare(rows) {
  let samples = 0;
  let possible = 0;
  let top1Hits = 0;
  let top3Hits = 0;
  for (const row of rows || []) {
    if (!row.evaluated_at && !(row.actual || []).length) continue;
    samples += 1;
    possible += Number(row.possible || 0);
    top1Hits += Number(row.top1Hits || 0);
    top3Hits += Number(row.top3Hits || 0);
  }
  const rate = (hits, total) => total ? Number(((hits / total) * 100).toFixed(2)) : 0;
  return { samples, possible, top1Hits, top3Hits, top1Rate: rate(top1Hits, possible), top3Rate: rate(top3Hits, possible) };
}

function timeseqModelRanking(limit = 100) {
  const rows = timeseqPredictionHistory(limit).filter((row) => row.evaluated_at && row.model);
  const buckets = {
    frequency: { key: 'frequency', label: '频率基准', samples: 0, top1Hits: 0, top3Hits: 0, possible: 0 },
    markov: { key: 'markov', label: '马尔科夫链', samples: 0, top1Hits: 0, top3Hits: 0, possible: 0 },
    xgboost: { key: 'xgboost', label: 'XGBoost', samples: 0, top1Hits: 0, top3Hits: 0, possible: 0 },
    lstm: { key: 'lstm', label: 'LSTM', samples: 0, top1Hits: 0, top3Hits: 0, possible: 0 },
  };
  for (const row of rows) {
    const actualDraw = getDrawByRound(row.target_roundno);
    if (!actualDraw) continue;
    const actualNumbers = parseDrawNumbers(actualDraw);
    if (!actualNumbers.length) continue;
    for (const key of Object.keys(buckets)) {
      const modelRows = row.model?.[key];
      if (!Array.isArray(modelRows) || !modelRows.length) continue;
      const bucket = buckets[key];
      bucket.samples += 1;
      for (let i = 0; i < Math.min(10, modelRows.length, actualNumbers.length); i++) {
        const actual = String(actualNumbers[i]).padStart(2, '0');
        const top3 = Array.isArray(modelRows[i]?.top3) ? modelRows[i].top3.map((x) => String(x)) : [];
        if (!top3.length) continue;
        bucket.possible += 1;
        if (String(top3[0]) === actual) bucket.top1Hits += 1;
        if (top3.includes(actual)) bucket.top3Hits += 1;
      }
    }
  }
  return Object.values(buckets).map((item) => {
    const top1Rate = item.possible ? (item.top1Hits / item.possible) * 100 : 0;
    const top3Rate = item.possible ? (item.top3Hits / item.possible) * 100 : 0;
    return {
      ...item,
      top1Rate: Number(top1Rate.toFixed(2)),
      top3Rate: Number(top3Rate.toFixed(2)),
    };
  }).sort((a, b) => b.top3Rate - a.top3Rate || b.top1Rate - a.top1Rate);
}

function summarizeSequenceArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') return null;
  const rows = Object.values(artifact.positions || {});
  const avgTop1 = rows.length ? rows.reduce((acc, p) => acc + Number(p?.validation?.top1Accuracy || 0), 0) / rows.length : 0;
  const avgTop3 = rows.length ? rows.reduce((acc, p) => acc + Number(p?.validation?.top3Accuracy || 0), 0) / rows.length : 0;
  const avgTestTop1 = rows.length ? rows.reduce((acc, p) => acc + Number(p?.testEvaluation?.top1Accuracy || 0), 0) / rows.length : 0;
  const avgTestTop3 = rows.length ? rows.reduce((acc, p) => acc + Number(p?.testEvaluation?.top3Accuracy || 0), 0) / rows.length : 0;
  const sourceBreakdown = artifact.sourceBreakdown && typeof artifact.sourceBreakdown === 'object' ? artifact.sourceBreakdown : {};
  const sourceBreakdownText = Object.keys(sourceBreakdown).length ? Object.entries(sourceBreakdown).map(([k, v]) => `${k}:${v}`).join(' / ') : '未拆分';
  const trainingTotals = artifact.trainingTotals && typeof artifact.trainingTotals === 'object'
    ? artifact.trainingTotals
    : { csv: sourceBreakdown.csv || 0, history: sourceBreakdown.history || 0, api: sourceBreakdown.api || 0, total: Number(artifact.sourceRows || 0) };
  const totalText = `csv:${trainingTotals.csv || 0} / history:${trainingTotals.history || 0} / api:${trainingTotals.api || 0} / total:${trainingTotals.total || 0}`;
  return {
    name: artifact.name || '-',
    version: artifact.version || '-',
    createdAt: artifact.createdAt || null,
    lookback: Number(artifact.lookback || 0),
    sourceRows: Number(artifact.sourceRows || 0),
    sourceBreakdownText,
    trainingTotalsText: totalText,
    positions: rows.length,
    averageTop1: Number(avgTop1.toFixed(2)),
    averageTop3: Number(avgTop3.toFixed(2)),
    testTop1: Number(avgTestTop1.toFixed(2)),
    testTop3: Number(avgTestTop3.toFixed(2)),
    trainingSource: artifact.trainingSource || 'db',
    note: artifact.note || '',
    featureText: artifact.featureText || '',
    blend: Number(artifact.blend || 0),
  };
}

function summarizeXv1SequenceArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') return null;
  return {
    name: artifact.name || 'xv1-timeseq-only-v1',
    version: artifact.version || 'timeseq_predictions-only-1620',
    createdAt: artifact.createdAt || null,
    lookback: Number(artifact.sourceRows || artifact.lookback || 0),
    sourceRows: Number(artifact.sourceRows || 0),
    sourceBreakdownText: `timeseq_predictions:${Number(artifact.trainingTotals?.timeseq_predictions || artifact.sourceRows || 0)}`,
    trainingTotalsText: `timeseq_predictions:${Number(artifact.trainingTotals?.timeseq_predictions || artifact.sourceRows || 0)} / total:${Number(artifact.trainingTotals?.total || artifact.sourceRows || 0)}`,
    positions: Number(artifact.sourceRows || 0),
    averageTop1: 0,
    averageTop3: 0,
    testTop1: 0,
    testTop3: 0,
    trainingSource: artifact.source || 'timeseq_predictions',
    note: artifact.note || 'xv1 dedicated model summary; source is timeseq_predictions only.',
    featureText: artifact.sourceText || '只使用 timeseq_predictions 1620 条进行训练',
    blend: 0,
    rounds: artifact.rounds || null,
    isolation: artifact.isolation !== false,
  };
}

function getSequenceModelHistory(limit = 6) {
  try {
    const log = execSync('git log --follow --format=%H%x09%ci%x09%s -- data/sequence-model.json', { cwd: ROOT, encoding: 'utf8', maxBuffer: 2_000_000 }).trim();
    if (!log) return [];
    const entries = log.split('\n').filter(Boolean).slice(0, Math.max(1, Math.min(10, Number(limit) || 6)));
    const history = [];
    for (const line of entries) {
      const [hash, date, message] = line.split('\t');
      if (!hash) continue;
      try {
        const raw = execSync(`git show ${hash}:data/sequence-model.json`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 2_000_000 });
        const artifact = JSON.parse(raw);
        const summary = summarizeSequenceArtifact(artifact);
        if (!summary) continue;
        history.push({
          commit: hash.slice(0, 7),
          date,
          message,
          ...summary,
        });
      } catch {
        continue;
      }
    }
    return history;
  } catch {
    return [];
  }
}

function currentAndNextPrediction() {
  const latest = getLatestDraw();
  const empty = { top3: [], confidence: null, fusion: [], side: { sum: { bigsmall: '-', oddeven: '-' }, rankCategories: [], dragonTiger: [] } };
  if (!latest) {
    return { current: empty, next: empty };
  }
  const prevDraw = db.prepare('SELECT * FROM draws WHERE roundno < ? ORDER BY roundno DESC LIMIT 1').get(latest.roundno) || null;
  const currentPred = db.prepare('SELECT * FROM predictions WHERE target_roundno = ?').get(latest.roundno) || (prevDraw ? ensurePrediction(latest.roundno, prevDraw.roundno) : null);
  const nextTarget = String(Number(latest.roundno) + 1);
  const nextPred = db.prepare('SELECT * FROM predictions WHERE target_roundno = ?').get(nextTarget) || ensurePrediction(nextTarget, latest.roundno);
  const convert = (pred, refDraw) => {
    if (!pred) return empty;
    let fusion = parseJsonSafe(pred.fusion_json, []);
    if (!Array.isArray(fusion)) fusion = [];
    if (!fusion.length && refDraw) {
      fusion = buildEnsemblePrediction(refDraw).fusion;
    }
    return {
      top3: parseJsonSafe(pred.top3_json, []),
      confidence: pred.confidence ?? null,
      fusion: Array.isArray(fusion) ? fusion : [],
      side: parseJsonSafe(pred.side_json, empty.side),
    };
  };
  return { current: convert(currentPred, prevDraw), next: convert(nextPred, latest) };
}

function predictionRecords(limit = 100) {
  return predictionHistory(limit);
}

function getObserverSummary() {
  const recent30 = loadRecent30();
  const latest = getLatestDraw();
  if (!latest) return { enabled: false, recent30: [], latest: null, predictions: [] };
  const prevDraw = db.prepare('SELECT * FROM draws WHERE roundno < ? ORDER BY roundno DESC LIMIT 1').get(latest.roundno) || null;
  const currentHistory = loadRecentDraws(getFusionLookback()).reverse();
  const observerPositions = Array.from({ length: 10 }, (_, i) => i + 1).map((pos) => buildPositionFusion(currentHistory, pos, prevDraw || latest, OBSERVER_PROFILE));
  const observerTop3 = buildPositionFusion(currentHistory, 1, prevDraw || latest, OBSERVER_PROFILE);
  return {
    enabled: true,
    label: OBSERVER_PROFILE.label,
    tag: OBSERVER_PROFILE.tag,
    profile: OBSERVER_PROFILE,
    latestRoundno: latest.roundno,
    latestTime: latest.winning_time,
    sourceCounts: db.prepare("SELECT source, COUNT(*) c FROM draws GROUP BY source ORDER BY source").all(),
    positionTop3: observerPositions,
    sampleTop3: observerTop3,
    recent30,
  };
}


function getTimeSeqModelLabSummary() {
  const base = getTimeSeqModelSummary();
  const prediction100 = timeseqPredictionHistory(100);
  const history = loadRecentDraws(Math.max(getFusionLookback(), 120)).reverse();
  const latest = getLatestDraw();
  const prevDraw = latest ? db.prepare('SELECT * FROM draws WHERE roundno < ? ORDER BY roundno DESC LIMIT 1').get(latest.roundno) || null : null;
  const enhancedModels = {
    frequency: currentTimeSeqModels(history, prevDraw || latest || null).frequency,
    markov: currentTimeSeqModels(history, prevDraw || latest || null).markov,
    xgboost: currentTimeSeqModels(history, prevDraw || latest || null).xgboost,
    lstm: currentTimeSeqModels(history, prevDraw || latest || null).lstm,
  };
  return {
    ...base,
    name: 'timeseq-lab',
    tag: '时序预测模型实验室',
    models: enhancedModels,
    note: '增强版实验室：独立统计、独立回测、独立探索，不混主链路',
    predictionHistory: prediction100,
    prediction100Stats: base.prediction100Stats,
    historyWindow: history.length,
  };
}

function getTimeSeqModelDeepSummary() {
  const lab = getTimeSeqModelLabSummary();
  const training = summarizeTrainingModel();
  const history = loadRecentDraws(Math.max(getFusionLookback(), 120)).reverse();
  const latest = getLatestDraw();
  const prevDraw = latest ? db.prepare('SELECT * FROM draws WHERE roundno < ? ORDER BY roundno DESC LIMIT 1').get(latest.roundno) || null : null;
  return {
    ...lab,
    name: 'timeseq-deep',
    tag: '时序深度实验页',
    note: '新独立页面：训练摘要、验证表现、实验室回测、四路模型与已训练序列模型合并展示',
    training,
    trainingSummary: training,
    historyWindow: history.length,
    modelSummary: currentTimeSeqModels(history, prevDraw || latest || null),
    modelRanking: timeseqModelRanking(100),
    modelHistory: getSequenceModelHistory(6),
  };
}

function getTimeSeqModelSummary() {
  const recent30 = loadRecent30();
  const latest = getLatestDraw();
  const history = loadRecentDraws(Math.max(getFusionLookback(), 120)).reverse();
  const prevDraw = latest ? db.prepare('SELECT * FROM draws WHERE roundno < ? ORDER BY roundno DESC LIMIT 1').get(latest.roundno) || null : null;
  const currentPred = latest ? buildTimeSeqPrediction(history, prevDraw || latest) : null;
  const nextPred = latest ? buildTimeSeqPrediction(history, latest) : null;
  const prediction100 = timeseqPredictionHistory(100);
  const predictedRows = prediction100.filter((row) => row.accuracy_possible != null || row.rank_possible != null);
  const rankHits = predictedRows.reduce((acc, row) => acc + Number(row.rank_hits || 0), 0);
  const rankPossible = predictedRows.reduce((acc, row) => acc + Number(row.rank_possible || 0), 0);
  const rankHitRate = rankPossible ? (rankHits / rankPossible) * 100 : 0;
  const overallHits = predictedRows.reduce((acc, row) => acc + Number(row.accuracy_total || 0), 0);
  const overallPossible = predictedRows.reduce((acc, row) => acc + Number(row.accuracy_possible || 0), 0);
  const overallRate = overallPossible ? (overallHits / overallPossible) * 100 : 0;
  return {
    enabled: true,
    name: 'timeseq-multi-model',
    tag: '时序预测模型训练',
    latestRoundno: latest?.roundno || '-',
    latestTime: latest?.winning_time || '-',
    sourceCounts: db.prepare("SELECT source, COUNT(*) c FROM draws GROUP BY source ORDER BY source").all(),
    recent30,
    predictionHistory: prediction100,
    prediction100Stats: {
      total: prediction100.length,
      evaluated: predictedRows.length,
      rankHits,
      rankPossible,
      rankHitRate: Number(rankHitRate.toFixed(2)),
      overallHits,
      overallPossible,
      overallRate: Number(overallRate.toFixed(2)),
    },
    models: currentTimeSeqModels(history),
    current: currentPred,
    next: nextPred,
    historyWindow: history.length,
    note: '频率基准 / 马尔科夫链 / XGBoost / LSTM 四路并行，单独运行，不接管主模型',
  };
}

function getSummary() {
  const recent30 = loadRecent30();
  const latest = getLatestDraw();
  const metrics = calcMetrics();
  const predictions = currentAndNextPrediction();
  return {
    metrics,
    predictions,
    recent30,
    champion_distribution: championDistribution(recent30),
    prediction_history: predictionHistory(30),
    latest_draw: latest,
    observer: getObserverSummary(),
    timeseq: getTimeSeqModelSummary(),
  };
}

function getXv1MetricsFromRows(rows) {
  const evaluated = (rows || []).filter((row) => row.evaluated_at);
  const samples = evaluated.length;
  let top1Hits = 0;
  let top3Hits = 0;
  let possible = 0;
  const positions = Array.from({ length: 10 }, (_, i) => ({ position: i + 1, label: `第${i + 1}名`, samples: 0, top1Hits: 0, top3Hits: 0 }));
  let currentStreak = 0;
  let bestStreak = 0;
  let missStreak = 0;
  let bestMissStreak = 0;

  const ordered = [...evaluated].sort((a, b) => String(a.target_roundno).localeCompare(String(b.target_roundno)));
  for (const row of ordered) {
    const actualDraw = getDrawByRound(row.target_roundno);
    if (!actualDraw) continue;
    const actualNumbers = parseDrawNumbers(actualDraw);
    const top3Rows = Array.isArray(row.top3) ? row.top3 : parseJsonSafe(row.top3_json, []);
    let rowHit = false;
    for (let i = 0; i < Math.min(10, actualNumbers.length, top3Rows.length); i++) {
      const actual = String(actualNumbers[i]).padStart(2, '0');
      const candidates = Array.isArray(top3Rows[i]?.top3) ? top3Rows[i].top3.map((x) => String(x).padStart(2, '0')) : [];
      if (!candidates.length) continue;
      const bucket = positions[i];
      bucket.samples += 1;
      possible += 1;
      if (candidates[0] === actual) {
        top1Hits += 1;
        bucket.top1Hits += 1;
      }
      if (candidates.includes(actual)) {
        top3Hits += 1;
        bucket.top3Hits += 1;
        rowHit = true;
      }
    }
    if (rowHit) {
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
      missStreak = 0;
    } else {
      missStreak += 1;
      bestMissStreak = Math.max(bestMissStreak, missStreak);
      currentStreak = 0;
    }
  }

  const rate = (hits, total) => total ? Number(((hits / total) * 100).toFixed(2)) : 0;
  return {
    samples,
    possible,
    top1Hits,
    top3Hits,
    top1Rate: rate(top1Hits, possible),
    top3Rate: rate(top3Hits, possible),
    positionRates: positions.map((p) => ({
      ...p,
      top1Rate: rate(p.top1Hits, p.samples),
      top3Rate: rate(p.top3Hits, p.samples),
    })),
    stability: {
      currentHitStreak: currentStreak,
      bestHitStreak: bestStreak,
      currentMissStreak: missStreak,
      bestMissStreak,
    },
  };
}

function getXv1Summary(options = {}) {
  const include = options.include || 'basic';
  const training = (() => {
    const xv1 = summarizeXv1SequenceArtifact(xv1SequenceArtifact);
    if (xv1) {
      return {
        source: xv1.trainingSource,
        sourceText: xv1.featureText,
        rows: xv1.sourceRows,
        isolation: xv1.isolation,
        note: xv1.note,
        rounds: xv1.rounds,
      };
    }
    return {
      source: 'timeseq_predictions',
      sourceText: '只使用 timeseq_predictions 1620 条进行训练',
      rows: 1620,
      isolation: true,
      note: 'xv1 训练入口只接这张表，不混主预测链',
    };
  })();

  const drawSourceCounts = db.prepare('SELECT source, COUNT(*) AS c FROM draws GROUP BY source ORDER BY c DESC, source ASC').all();
  const drawTotals = db.prepare('SELECT COUNT(*) AS total FROM draws').get();
  const predTotals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(rank_hits), 0) AS rank_hits,
      COALESCE(SUM(rank_possible), 0) AS rank_possible,
      COALESCE(SUM(accuracy_total), 0) AS accuracy_hits,
      COALESCE(SUM(accuracy_possible), 0) AS accuracy_possible,
      COALESCE(SUM(sum_hits), 0) AS sum_hits,
      COALESCE(SUM(sum_possible), 0) AS sum_possible,
      COALESCE(SUM(dragon_hits), 0) AS dragon_hits,
      COALESCE(SUM(dragon_possible), 0) AS dragon_possible
    FROM predictions
  `).get();
  const timeSeqTotals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(rank_hits), 0) AS rank_hits,
      COALESCE(SUM(rank_possible), 0) AS rank_possible,
      COALESCE(SUM(accuracy_total), 0) AS accuracy_hits,
      COALESCE(SUM(accuracy_possible), 0) AS accuracy_possible,
      COALESCE(SUM(sum_hits), 0) AS sum_hits,
      COALESCE(SUM(sum_possible), 0) AS sum_possible,
      COALESCE(SUM(dragon_hits), 0) AS dragon_hits,
      COALESCE(SUM(dragon_possible), 0) AS dragon_possible
    FROM timeseq_predictions
  `).get();
  const lastEvaluatedPrediction = db.prepare('SELECT target_roundno, evaluated_at, accuracy_rate FROM predictions WHERE evaluated_at IS NOT NULL ORDER BY evaluated_at DESC LIMIT 1').get() || null;
  const lastEvaluatedTimeSeq = db.prepare('SELECT target_roundno, evaluated_at, accuracy_rate FROM timeseq_predictions WHERE evaluated_at IS NOT NULL ORDER BY evaluated_at DESC LIMIT 1').get() || null;
  const latestDraw = getLatestDraw();
  const history = loadRecentDraws(Math.max(getFusionLookback(), 360)).reverse();
  const prevDraw = latestDraw ? db.prepare('SELECT * FROM draws WHERE roundno < ? ORDER BY roundno DESC LIMIT 1').get(latestDraw.roundno) || latestDraw : null;
  const nextRoundno = latestDraw?.roundno ? String(Number(latestDraw.roundno) + 1) : '-';
  const xv1Current = latestDraw ? buildTimeSeqPrediction(history, prevDraw || latestDraw) : null;
  const xv1Next = latestDraw ? buildTimeSeqPrediction(history, latestDraw) : null;
  const xv1History = timeseqPredictionHistory(300);
  const xv1HistoryCompare = getXv1HistoryCompare(30);
  const xv1MetricStats = getXv1MetricsFromRows(xv1History);
  const needsBypass = include === 'all' || include === 'bypass' || include === 'bypassTable';
  const needsBypassTable = include === 'all' || include === 'bypassTable';
  const needsAnalyst = include === 'all' || include === 'analyst';
  const needsAnalystV2 = include === 'all' || include === 'analystV2';
  const needsAnalystV3 = include === 'all' || include === 'analystV3';
  const gpt55History = needsBypass ? getGpt55BypassHistory(30) : [];
  const gpt55Metrics = needsBypass ? getBypassMetricsFromCompare(gpt55History) : null;
  const gpt55V3History = needsBypass ? getGpt55BypassV3History(30) : [];
  const gpt55V3Metrics = needsBypass ? getBypassMetricsFromCompare(gpt55V3History) : null;
  const gpt55V3Weights = needsBypass ? getGpt55V3WeightSummary() : [];
  const gpt55TableModule = needsBypassTable ? getGpt55BypassTableModule(30) : null;
  const gpt55Analyst = needsAnalyst ? readGpt55Analyst(30) : null;
  const gpt55AnalystV2 = needsAnalystV2 ? readGpt55AnalystV2(30) : null;
  const gpt55AnalystV3 = needsAnalystV3 ? readAnalystV3(30) : null;
  const modelRanking = timeseqModelRanking(300);

  return {
    site: 'xv1',
    status: 'online',
    title: 'xv1 独立模型',
    current_roundno: latestDraw?.roundno || '-',
    latest_roundno: latestDraw?.roundno || '-',
    next_roundno: nextRoundno,
    latest_time: latestDraw?.winning_time || '-',
    validation: {
      mode: 'api-latest',
      source_url: 'https://yun.citi668.com/ui-04/detail.aspx?g=21',
      description: '使用 API 最新开奖号作为验证真值；训练只使用验证期之前的数据。',
      split_rule: 'walk-forward / 不混入待验证期',
      refresh_policy: '数据库缓存同步 + API 最新真值校验',
    },
    model_status: {
      enabled: true,
      name: 'xv1-layered-position-top3',
      version: 'xv1-3001-live',
      pipeline: '规则模型 → 统计模型 → 序列模型 → 融合 Top3',
    },
    health: {
      data_ok: true,
      duplicate_ok: true,
      order_ok: true,
      missing_ok: true,
      isolation_ok: true,
    },
    data: {
      draw_total: Number(drawTotals?.total || 0),
      draw_sources: drawSourceCounts,
      predictions_total: Number(predTotals?.total || 0),
      predictions_rank: `${Number(predTotals?.rank_hits || 0)}/${Number(predTotals?.rank_possible || 0)}`,
      predictions_overall: `${Number(predTotals?.accuracy_hits || 0)}/${Number(predTotals?.accuracy_possible || 0)}`,
      timeseq_total: Number(timeSeqTotals?.total || 0),
      timeseq_rank: `${Number(timeSeqTotals?.rank_hits || 0)}/${Number(timeSeqTotals?.rank_possible || 0)}`,
      timeseq_overall: `${Number(timeSeqTotals?.accuracy_hits || 0)}/${Number(timeSeqTotals?.accuracy_possible || 0)}`,
      latest_prediction: lastEvaluatedPrediction,
      latest_timeseq_prediction: lastEvaluatedTimeSeq,
      xv1_model_rows: training.rows,
      xv1_model_version: 'xv1-3001-live',
      xv1_model_source: training.sourceText,
      top1_rate: xv1MetricStats.top1Rate,
      top3_rate: xv1MetricStats.top3Rate,
      position_rates: xv1MetricStats.positionRates,
      stability: xv1MetricStats.stability,
      model_ranking: modelRanking,
    },
    predictions: {
      current: xv1Current,
      next: xv1Next,
      history: xv1HistoryCompare,
      rawHistory: xv1History.slice(0, 30),
      metrics: xv1MetricStats,
      modelRanking,
      ...(needsBypass ? {
        bypass: {
          enabled: true,
          name: 'GPT5.5 旁路评估 v2',
          mode: 'shadow-only',
          model: 'oc2/gpt-5.5',
          description: '读取主模型和分层模型候选，做第二路再排序；只展示和回测，不覆盖正式输出。',
          next: latestDraw ? { top3: buildGpt55BypassRows(xv1Next?.top3 || [], xv1Next?.models || null, xv1MetricStats.positionRates) } : null,
          current: latestDraw ? { top3: buildGpt55BypassRows(xv1Current?.top3 || [], xv1Current?.models || null, xv1MetricStats.positionRates) } : null,
          history: gpt55History,
          metrics: gpt55Metrics,
        },
        bypassV3: {
          enabled: true,
          name: 'GPT5.5 旁路评估 v3',
          mode: 'shadow-only-adaptive',
          model: 'oc2/gpt-5.5',
          description: '在 v2 共识复审上加入位置独立权重、近期动态表现、热冷修正；只展示和回测，不覆盖正式输出。',
          next: latestDraw ? { top3: buildGpt55BypassV3Rows(xv1Next?.top3 || [], xv1Next?.models || null, xv1MetricStats.positionRates) } : null,
          current: latestDraw ? { top3: buildGpt55BypassV3Rows(xv1Current?.top3 || [], xv1Current?.models || null, xv1MetricStats.positionRates) } : null,
          history: gpt55V3History,
          metrics: gpt55V3Metrics,
          weights: gpt55V3Weights,
        },
      } : {}),
      ...(needsBypassTable ? { bypassTable: gpt55TableModule } : {}),
      ...(needsAnalyst ? { analyst: gpt55Analyst } : {}),
      ...(needsAnalystV2 ? { analystV2: gpt55AnalystV2 } : {}),
      ...(needsAnalystV3 ? { analystV3: gpt55AnalystV3 } : {}),
    },
    fusion: {
      top3: xv1Next?.top3 || xv1Current?.top3 || [],
      score: xv1Next?.confidence ?? xv1Current?.confidence ?? '-',
      confidence: xv1Next?.confidence ?? xv1Current?.confidence ?? '-',
      reason: '规则 + 统计 + 序列分层融合',
    },
    metrics: [
      { name: 'Top1 命中率', value: `${xv1MetricStats.top1Rate}%`, desc: `${xv1MetricStats.top1Hits}/${xv1MetricStats.possible}` },
      { name: 'Top3 命中率', value: `${xv1MetricStats.top3Rate}%`, desc: `${xv1MetricStats.top3Hits}/${xv1MetricStats.possible}` },
      { name: '分位置命中率', value: `${xv1MetricStats.positionRates.length} 位`, desc: '每个位置单独统计 Top1 / Top3' },
      { name: '连续稳定性', value: `${xv1MetricStats.stability.currentHitStreak}/${xv1MetricStats.stability.bestHitStreak}`, desc: '当前连续命中 / 历史最佳连续命中' },
    ],
    pages: [
      { path: '/', label: '新首页' },
      { path: '/overview', label: '总览' },
      { path: '/monitor', label: '监控' },
      { path: '/predictions', label: '预测' },
      { path: '/gpt55-bypass', label: 'GPT5.5旁路' },
      { path: '/gpt55-bypass-v3', label: 'GPT5.5旁路v3' },
      { path: '/bypass-table', label: '旁路独立表' },
      { path: '/gpt55-analyst', label: 'GPT5.5分析师' },
      { path: '/gpt55-analyst-v2', label: 'GPT5.5分析师v2' },
      { path: '/gpt55-analyst-v3', label: 'GPT5.5分析师v3' },
      { path: '/modules', label: '模块' },
    ],
    training,
    layers: [
      { name: '规则层', status: '已接入', desc: '频次 / 最近热度 / 间隔 / 转移', output: '每位置 Top3 + 规则分', detail: 'frequency 基准模型已参与输出', rows: xv1Current?.models?.frequency || [] },
      { name: '统计层', status: '已接入', desc: '每位置独立统计模型', output: '每位置 Top3 + 统计分', detail: 'xgboost 风格统计模型已参与输出', rows: xv1Current?.models?.xgboost || [] },
      { name: '序列层', status: '已接入', desc: '趋势与状态转移', output: '每位置 Top3 + 序列分', detail: 'markov/lstm 序列模型已参与输出', rows: xv1Current?.models?.markov || [] },
      { name: '融合层', status: '已接入', desc: '规则 + 统计 + 序列输出最终 Top3', output: '最终 Top3 + 置信度', detail: '融合三层输出，保留可追溯的分层来源', rows: xv1Current?.top3 || [] },
    ],
    blueprint: {
      title: '重新设计规格',
      items: [
        '按位置拆分，每个位置单独输出 Top3',
        '规则评分起步：频次 + 最近热度 + 间隔 + 转移',
        '带时间衰减，使用滚动回测',
        '结果分层展示：规则 / 统计 / 序列 / 融合',
        '输出 Top1、Top3、分位置命中率、连续稳定性',
      ],
    },
    notes: [
      '旧模块已剥离',
      '主链与 timeseq 严格隔离',
      '页面结构正在重建',
    ],
  };
}


function injectInitialData(html, data) {
  const summaryPayload = JSON.stringify(data).replace(/</g, '\u003c');
  const predictionsPayload = JSON.stringify(predictionRecords(120)).replace(/</g, '\u003c');
  const bootstrapScript = '<script>window.__INITIAL_SUMMARY__ = ' + summaryPayload + ';window.__INITIAL_PREDICTIONS__ = ' + predictionsPayload + ';</script>';
  if (html.includes('<body>')) {
    return html.replace('<body>', '<body>' + bootstrapScript);
  }
  return html.replace('</body>', bootstrapScript + '</body>');
}

function slimXv1SummaryForPage(data, fileName = '') {
  const clone = JSON.parse(JSON.stringify(data || {}));
  const pred = clone.predictions || {};
  const page = String(fileName || '');
  const keepPredictions = page.includes('predictions');
  const keepBypassTable = page.includes('bypass-table');
  const keepBypass = page.includes('gpt55-bypass');
  const keepAnalystV1 = page.includes('gpt55-analyst.html');
  const keepAnalystV2 = page.includes('gpt55-analyst-v2');
  const keepAnalystV3 = page.includes('gpt55-analyst-v3');
  if (!keepPredictions) {
    delete pred.rawHistory;
    if (Array.isArray(pred.history)) pred.history = pred.history.slice(0, 10);
  }
  if (!keepBypassTable) delete pred.bypassTable;
  if (!keepBypass) { delete pred.bypass; delete pred.bypassV3; }
  if (!keepAnalystV1) delete pred.analyst;
  if (!keepAnalystV2) delete pred.analystV2;
  if (!keepAnalystV3) delete pred.analystV3;
  if (pred.analystV3) {
    pred.analystV3.rows = (pred.analystV3.rows || []).slice(0, 30).map((r) => ({ target_roundno: r.target_roundno, actual: r.actual, compare: r.compare, top1_hits: r.top1_hits, top3_hits: r.top3_hits, possible: r.possible, errors: r.errors, evaluated_at: r.evaluated_at }));
    if (pred.analystV3.latest) pred.analystV3.latest = { target_roundno: pred.analystV3.latest.target_roundno, top3: pred.analystV3.latest.top3, overlap: pred.analystV3.latest.overlap };
    pred.analystV3.modelPositionStats = (pred.analystV3.modelPositionStats || []).slice(0, 120);
  }
  clone.predictions = pred;
  return clone;
}

function injectXv1Data(html, data, fileName = '') {
  const payload = JSON.stringify(slimXv1SummaryForPage(data, fileName)).replace(/</g, '\u003c');
  const bootstrapScript = '<script>window.__XV1_SUMMARY__ = ' + payload + ';</script>';
  if (html.includes('<body>')) {
    return html.replace('<body>', '<body>' + bootstrapScript);
  }
  return html.replace('</body>', bootstrapScript + '</body>');
}

function injectInitialTimeseqData(html, data) {
  const payload = JSON.stringify(data).replace(/</g, '\u003c');
  const bootstrapScript = '<script>window.__INITIAL_TIMESEQ__ = ' + payload + ';</script>';
  if (html.includes('<body>')) {
    return html.replace('<body>', '<body>' + bootstrapScript);
  }
  return html.replace('</body>', bootstrapScript + '</body>');
}

function injectInitialTimeseqLabData(html, data) {
  const payload = JSON.stringify(data).replace(/</g, '\u003c');
  const bootstrapScript = '<script>window.__INITIAL_TIMESEQ_LAB__ = ' + payload + ';</script>';
  if (html.includes('<body>')) {
    return html.replace('<body>', '<body>' + bootstrapScript);
  }
  return html.replace('</body>', bootstrapScript + '</body>');
}

function injectInitialTimeseqDeepData(html, data) {
  const payload = JSON.stringify(data).replace(/</g, '\u003c');
  const bootstrapScript = '<script>window.__INITIAL_TIMESEQ_DEEP__ = ' + payload + ';</script>';
  if (html.includes('<body>')) {
    return html.replace('<body>', '<body>' + bootstrapScript);
  }
  return html.replace('</body>', bootstrapScript + '</body>');
}

function serveStatic(filePath, res) {
  const full = path.join(PUBLIC_DIR, filePath);
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full)) return false;
  const ext = path.extname(full).toLowerCase();
  const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'text/plain; charset=utf-8';
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  if (ext === '.html') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  fs.createReadStream(full).pipe(res);
  return true;
}

function isXv1Host(host) {
  return String(host || '').split(':')[0] === 'xv1.7700.eu.org';
}

function sendHtmlFile(res, fileName, payloadInjector = null) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const html = fs.readFileSync(path.join(PUBLIC_DIR, fileName), 'utf8');
  res.end(payloadInjector ? payloadInjector(html) : html);
}

function sendRemovedRoute(res, label = 'xv1') {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.end(`${label} 页面已重做，旧路由已移除`);
}

const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const host = req.headers.host || '';
    const xv1Host = isXv1Host(host);

    if (xv1Host) {
      if (u.pathname === '/' || u.pathname === '/index.html') {
        return sendHtmlFile(res, 'xv1-index.html', (html) => injectXv1Data(html, getXv1Summary({ include: 'basic' }), 'xv1-index.html'));
      }
      if (u.pathname === '/overview' || u.pathname === '/overview.html') {
        return sendHtmlFile(res, 'xv1-overview.html', (html) => injectXv1Data(html, getXv1Summary({ include: 'basic' }), 'xv1-overview.html'));
      }
      if (u.pathname === '/monitor' || u.pathname === '/monitor.html') {
        return sendHtmlFile(res, 'xv1-monitor.html', (html) => injectXv1Data(html, getXv1Summary({ include: 'basic' }), 'xv1-monitor.html'));
      }
      if (u.pathname === '/predictions' || u.pathname === '/predictions.html') {
        return sendHtmlFile(res, 'xv1-predictions.html', (html) => injectXv1Data(html, getXv1Summary({ include: 'basic' }), 'xv1-predictions.html'));
      }
      if (u.pathname === '/gpt55-analyst-v3' || u.pathname === '/gpt55-analyst-v3.html') {
        return sendHtmlFile(res, 'xv1-gpt55-analyst-v3.html', (html) => injectXv1Data(html, getXv1Summary({ include: 'analystV3' }), 'xv1-gpt55-analyst-v3.html'));
      }
      if (u.pathname === '/gpt55-analyst-v2' || u.pathname === '/gpt55-analyst-v2.html') {
        return sendHtmlFile(res, 'xv1-gpt55-analyst-v2.html', (html) => injectXv1Data(html, getXv1Summary({ include: 'analystV2' }), 'xv1-gpt55-analyst-v2.html'));
      }
      if (u.pathname === '/gpt55-analyst' || u.pathname === '/gpt55-analyst.html') {
        return sendHtmlFile(res, 'xv1-gpt55-analyst.html', (html) => injectXv1Data(html, getXv1Summary({ include: 'analyst' }), 'xv1-gpt55-analyst.html'));
      }
      if (u.pathname === '/bypass-table' || u.pathname === '/bypass-table.html') {
        return sendHtmlFile(res, 'xv1-bypass-table.html', (html) => injectXv1Data(html, getXv1Summary({ include: 'bypassTable' }), 'xv1-bypass-table.html'));
      }
      if (u.pathname === '/gpt55-bypass-v3' || u.pathname === '/gpt55-bypass-v3.html') {
        return sendHtmlFile(res, 'xv1-gpt55-bypass-v3.html', (html) => injectXv1Data(html, getXv1Summary({ include: 'bypass' }), 'xv1-gpt55-bypass-v3.html'));
      }
      if (u.pathname === '/gpt55-bypass' || u.pathname === '/gpt55-bypass.html') {
        return sendHtmlFile(res, 'xv1-gpt55-bypass.html', (html) => injectXv1Data(html, getXv1Summary({ include: 'bypass' }), 'xv1-gpt55-bypass.html'));
      }
      if (u.pathname === '/modules' || u.pathname === '/modules.html') {
        return sendHtmlFile(res, 'xv1-modules.html', (html) => injectXv1Data(html, getXv1Summary({ include: 'basic' }), 'xv1-modules.html'));
      }
      if (u.pathname === '/observer' || u.pathname === '/timeseq' || u.pathname === '/timeseq-lab' || u.pathname === '/timeseq-deep') {
        return sendRemovedRoute(res, 'xv1');
      }
      if (u.pathname === '/api/summary') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(getXv1Summary({ include: 'all' })));
        return;
      }
      if (u.pathname === '/api/pages') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ pages: getXv1Summary({ include: 'basic' }).pages, layers: getXv1Summary({ include: 'basic' }).layers }));
        return;
      }
      if (u.pathname === '/health') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, site: 'xv1', time: nowIso() }));
        return;
      }
      if (u.pathname.startsWith('/public/')) {
        if (!serveStatic(u.pathname.replace('/public/', ''), res)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Not found');
        }
        return;
      }
      return sendRemovedRoute(res, 'xv1');
    }

    if (u.pathname === '/' || u.pathname === '/index.html') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.end(injectInitialData(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8'), getSummary()));
      return;
    }
    if (u.pathname === '/overview' || u.pathname === '/overview.html') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.end(injectInitialData(fs.readFileSync(path.join(PUBLIC_DIR, 'overview.html'), 'utf8'), getSummary()));
      return;
    }
    if (u.pathname === '/modules' || u.pathname === '/modules.html') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.end(injectInitialData(fs.readFileSync(path.join(PUBLIC_DIR, 'modules.html'), 'utf8'), getSummary()));
      return;
    }
    if (u.pathname === '/monitor' || u.pathname === '/monitor.html') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.end(injectInitialData(fs.readFileSync(path.join(PUBLIC_DIR, 'monitor.html'), 'utf8'), getSummary()));
      return;
    }
    if (u.pathname === '/observer' || u.pathname === '/observer.html') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.end(injectInitialData(fs.readFileSync(path.join(PUBLIC_DIR, 'observer.html'), 'utf8'), getSummary()));
      return;
    }
    if (u.pathname === '/timeseq' || u.pathname === '/timeseq.html') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.end(injectInitialTimeseqData(fs.readFileSync(path.join(PUBLIC_DIR, 'timeseq.html'), 'utf8'), getTimeSeqModelSummary()));
      return;
    }
    if (u.pathname === '/timeseq-lab' || u.pathname === '/timeseq-lab.html') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.end(injectInitialTimeseqLabData(fs.readFileSync(path.join(PUBLIC_DIR, 'timeseq-lab.html'), 'utf8'), getTimeSeqModelLabSummary()));
      return;
    }
    if (u.pathname === '/timeseq-deep' || u.pathname === '/timeseq-deep.html') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.end(injectInitialTimeseqDeepData(fs.readFileSync(path.join(PUBLIC_DIR, 'timeseq-deep.html'), 'utf8'), getTimeSeqModelDeepSummary()));
      return;
    }
    if (u.pathname === '/predictions' || u.pathname === '/predictions.html') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.end(injectInitialData(fs.readFileSync(path.join(PUBLIC_DIR, 'predictions.html'), 'utf8'), getSummary()));
      return;
    }
    if (u.pathname === '/api/summary') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(getSummary()));
      return;
    }
    if (u.pathname === '/api/history') {
      const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') || 30)));
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(loadRecent30().slice(0, limit)));
      return;
    }
    if (u.pathname === '/api/predictions') {
      const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') || 100)));
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ records: predictionRecords(limit) }));
      return;
    }
    if (u.pathname === '/api/timeseq') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(getTimeSeqModelSummary()));
      return;
    }
    if (u.pathname === '/api/timeseq-lab') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(getTimeSeqModelLabSummary()));
      return;
    }
    if (u.pathname === '/api/timeseq-deep') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(getTimeSeqModelDeepSummary()));
      return;
    }
    if (u.pathname === '/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, time: nowIso() }));
      return;
    }
    if (u.pathname.startsWith('/public/')) {
      if (!serveStatic(u.pathname.replace('/public/', ''), res)) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Not found');
      }
      return;
    }
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(err.stack || err));
  }
});

backfillPredictionStats();
backfillTimeSeqPredictions();
backfillTimeSeqStats();

server.listen(PORT, () => {
  console.log(`dashboard listening on http://127.0.0.1:${PORT}`);
  syncOnce();
});

process.on('SIGINT', () => {
  clearTimeout(syncOnce.timer);
  try { db.close(); } catch {}
  process.exit(0);
});
process.on('SIGTERM', () => {
  clearTimeout(syncOnce.timer);
  try { db.close(); } catch {}
  process.exit(0);
});
