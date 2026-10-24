/**
 * ============================================================================
 *  QUIZ APP – BACKEND REST API (Google Apps Script)
 *  Frontend: GitHub Pages (index.html + js/) – gọi API qua fetch()
 *  Sheets: "Questions" (ID, Topic, Question, OptionA..D, CorrectAnswer, Explanation)
 *          "Results"   (Timestamp, UserEmail, Score, TotalQuestions, WrongQuestionIDs)
 *
 *  Nguyên tắc:
 *   - Đọc Sheet đúng 1 lần bằng getDataRange().getValues(), cache bằng CacheService.
 *   - Mọi hàm public trả về { success, data, error }.
 *   - Exam Mode: KHÔNG gửi đáp án/giải thích về client; chấm điểm hoàn toàn ở server
 *     dựa trên phiên thi (session) lưu trong CacheService.
 * ============================================================================
 */

// ----------------------------- CẤU HÌNH -------------------------------------
const CONFIG = {
  SPREADSHEET_ID: '',               // Để trống nếu script gắn với Sheet (Extensions > Apps Script)
  SHEET_QUESTIONS: 'Questions',
  SHEET_RESULTS: 'Results',
  APP_TITLE: 'Ôn thi trắc nghiệm',
  CACHE_KEY: 'QBANK_V1',
  CACHE_TTL: 600,                   // 10 phút – cache bộ đề
  CACHE_CHUNK: 25000,               // ký tự/khóa (giới hạn 100KB/khóa, tiếng Việt ~3 byte/ký tự)
  SESSION_TTL: 21600,               // 6 giờ – tối đa của CacheService
  GRACE_SECONDS: 90,                // dung sai thời gian nộp bài (độ trễ mạng)
  MAX_QUESTIONS: 200,
  SHUFFLE_OPTIONS: true,            // Trộn đáp án A-D (tự bỏ qua câu có "tất cả các đáp án trên"...)
  HISTORY_LIMIT: 20
};

const HEADERS = {
  Questions: ['ID', 'Topic', 'Question', 'OptionA', 'OptionB', 'OptionC', 'OptionD', 'CorrectAnswer', 'Explanation'],
  Results: ['Timestamp', 'UserEmail', 'Score', 'TotalQuestions', 'WrongQuestionIDs']
};
const LETTERS = ['A', 'B', 'C', 'D'];

// ----------------------------- ENTRY POINT (REST API) ------------------------
/**
 * Frontend chạy trên GitHub Pages gọi API này bằng fetch():
 *   GET  {WEB_APP_URL}?action=init                       → kiểm tra / lấy chủ đề
 *   POST {WEB_APP_URL}  body(text/plain) = JSON {action, payload}
 * Dùng Content-Type "text/plain" để trình duyệt KHÔNG gửi preflight OPTIONS
 * (Apps Script không hỗ trợ OPTIONS) → tránh lỗi CORS.
 */
const ROUTES = {
  init:    p => getInitData(),
  start:   p => startExam(p),
  submit:  p => submitExam(p.sessionId, p.answers, p.user),
  history: p => getHistory(p.user)
};

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'init';
  if (action !== 'init') return json_({ success: false, data: null, error: 'GET chỉ hỗ trợ action=init' });
  return json_(getInitData());
}

function doPost(e) {
  let req;
  try {
    const body = e && e.postData ? e.postData.contents : '';
    if (!body || body.length > 50000) throw new Error('Yêu cầu không hợp lệ.');
    req = JSON.parse(body);
  } catch (err) {
    return json_({ success: false, data: null, error: 'Body phải là JSON hợp lệ.' });
  }
  const route = ROUTES[req && req.action];
  if (!route) return json_({ success: false, data: null, error: 'Action không tồn tại: ' + (req && req.action) });
  return json_(route(req.payload || {}));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------- TIỆN ÍCH -------------------------------------
/** Bọc mọi API: luôn trả về { success, data, error }. */
function respond_(fn) {
  try {
    return { success: true, data: fn(), error: null };
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return { success: false, data: null, error: String(err && err.message ? err.message : err) };
  }
}

function ss_() {
  return CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Không tìm thấy sheet "' + name + '". Hãy chạy hàm setupSheets().');
  return sh;
}

/** Fisher–Yates shuffle (không làm thay đổi mảng gốc). */
function shuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normEmail_(s) {
  return String(s || '').trim().toLowerCase().slice(0, 120);
}

/** Chuẩn hóa định danh người dùng do client gửi lên. */
function resolveUser_(clientId) {
  const email = normEmail_(clientId); // Gọi từ GitHub Pages → không có phiên Google, dùng thông tin người dùng nhập
  if (!email) throw new Error('Vui lòng nhập email/họ tên trước khi làm bài.');
  // Chống CSV/Formula injection khi ghi vào Sheet
  return email.replace(/^[=+\-@]/, "'");
}

// ----------------------------- CACHE BỘ ĐỀ ----------------------------------
/** Đọc toàn bộ ngân hàng câu hỏi (cache → sheet). Trả về mảng object đầy đủ (kể cả đáp án). */
function getQuestionBank_() {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(CONFIG.CACHE_KEY + '_n');
  if (meta) {
    const keys = [];
    for (let i = 0; i < Number(meta); i++) keys.push(CONFIG.CACHE_KEY + '_' + i);
    const parts = cache.getAll(keys);
    if (keys.every(k => parts[k] != null)) {
      return JSON.parse(keys.map(k => parts[k]).join(''));
    }
  }

  // Cache miss → đọc sheet ĐÚNG 1 LẦN
  const values = getSheet_(CONFIG.SHEET_QUESTIONS).getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0].map(h => String(h).trim());
  const idx = {};
  HEADERS.Questions.forEach(h => {
    idx[h] = head.indexOf(h);
    if (idx[h] < 0 && h !== 'Explanation') throw new Error('Sheet Questions thiếu cột "' + h + '"');
  });

  const bank = [];
  const seen = {};
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const id = String(row[idx.ID]).trim();
    const ans = String(row[idx.CorrectAnswer]).trim().toUpperCase().charAt(0);
    if (!id || seen[id] || LETTERS.indexOf(ans) < 0) continue; // bỏ dòng trống/lỗi/trùng ID
    seen[id] = true;
    bank.push({
      id: id,
      topic: String(row[idx.Topic] || 'Chung').trim(),
      q: String(row[idx.Question]),
      o: [row[idx.OptionA], row[idx.OptionB], row[idx.OptionC], row[idx.OptionD]].map(String),
      a: ans,
      e: idx.Explanation >= 0 ? String(row[idx.Explanation] || '') : ''
    });
  }

  // Ghi cache theo từng mảnh (mỗi khóa < 100KB)
  try {
    const json = JSON.stringify(bank);
    const chunks = {};
    let n = 0;
    for (let i = 0; i < json.length; i += CONFIG.CACHE_CHUNK, n++) {
      chunks[CONFIG.CACHE_KEY + '_' + n] = json.slice(i, i + CONFIG.CACHE_CHUNK);
    }
    chunks[CONFIG.CACHE_KEY + '_n'] = String(n);
    cache.putAll(chunks, CONFIG.CACHE_TTL);
  } catch (e) {
    console.warn('Không ghi được cache: ' + e);
  }
  return bank;
}

/** Xóa cache bộ đề (chạy thủ công hoặc tự động qua onEdit). */
function clearQuestionCache() {
  CacheService.getScriptCache().remove(CONFIG.CACHE_KEY + '_n');
  return 'Đã xóa cache bộ đề.';
}

/** Simple trigger: sửa sheet Questions → xóa cache để dữ liệu mới có hiệu lực ngay. */
function onEdit(e) {
  try {
    if (e && e.range && e.range.getSheet().getName() === CONFIG.SHEET_QUESTIONS) clearQuestionCache();
  } catch (err) { /* ignore */ }
}

// ----------------------------- PUBLIC API -----------------------------------

/** Thông tin khởi tạo: danh sách chủ đề + số câu. */
function getInitData() {
  return respond_(() => {
    const counts = {};
    getQuestionBank_().forEach(q => { counts[q.topic] = (counts[q.topic] || 0) + 1; });
    return {
      appTitle: CONFIG.APP_TITLE,
      maxQuestions: CONFIG.MAX_QUESTIONS,
      topics: Object.keys(counts).sort().map(t => ({ name: t, count: counts[t] })),
      total: Object.keys(counts).reduce((s, t) => s + counts[t], 0)
    };
  });
}

/**
 * Tạo đề thi ngẫu nhiên.
 * @param {Object} opts { topics: string[], count: number, minutes: number, mode: 'exam'|'practice', ids?: string[] }
 * Exam mode: không trả về đáp án/giải thích. Practice mode: trả về để chấm ngay.
 */
function startExam(opts) {
  return respond_(() => {
    opts = opts || {};
    const mode = opts.mode === 'practice' ? 'practice' : 'exam';
    const count = Math.max(1, Math.min(CONFIG.MAX_QUESTIONS, parseInt(opts.count, 10) || 20));
    const minutes = Math.max(1, Math.min(300, parseInt(opts.minutes, 10) || 30));
    const topics = Array.isArray(opts.topics) ? opts.topics : [];
    const ids = Array.isArray(opts.ids) ? opts.ids.map(String) : null; // ôn lại danh sách câu cụ thể

    const pool = getQuestionBank_().filter(q => ids
      ? ids.indexOf(q.id) >= 0
      : (!topics.length || topics.indexOf(q.topic) >= 0));
    if (!pool.length) throw new Error('Không có câu hỏi nào cho chủ đề đã chọn.');

    const picked = shuffle_(pool).slice(0, count);
    const lockRe = /(tất cả|cả (hai|ba|bốn)|các (phương án|đáp án|ý) trên|đều (đúng|sai)|không có (đáp án|phương án))/i;

    const sessionItems = [];
    const questions = picked.map((q, i) => {
      // perm[k] = vị trí gốc (0..3) của đáp án hiển thị thứ k
      let perm = [0, 1, 2, 3];
      if (CONFIG.SHUFFLE_OPTIONS && !q.o.some(o => lockRe.test(o))) perm = shuffle_(perm);
      sessionItems.push({ id: q.id, p: perm.join('') });
      const item = {
        no: i + 1,
        id: q.id,
        topic: q.topic,
        question: q.q,
        options: perm.map(k => q.o[k])
      };
      if (mode === 'practice') {
        item.correct = LETTERS[perm.indexOf(LETTERS.indexOf(q.a))];
        item.explanation = q.e;
      }
      return item;
    });

    const sessionId = Utilities.getUuid();
    const now = Date.now();
    const session = { m: mode, s: now, d: minutes * 60, it: sessionItems };
    CacheService.getScriptCache().put('EXAM_' + sessionId, JSON.stringify(session), CONFIG.SESSION_TTL);

    return { sessionId, mode, durationSec: minutes * 60, startedAt: now, questions };
  });
}

/**
 * Nộp bài – chấm điểm ở server, ghi 1 dòng vào Results.
 * @param {string} sessionId
 * @param {Object} answers { [questionId]: 'A'|'B'|'C'|'D' } (theo thứ tự hiển thị)
 * @param {string} clientUser email/họ tên do người dùng nhập (dùng khi không lấy được email Google)
 */
function submitExam(sessionId, answers, clientUser) {
  return respond_(() => {
    const cache = CacheService.getScriptCache();
    const key = 'EXAM_' + String(sessionId || '');
    const raw = cache.get(key);
    if (!raw) throw new Error('Phiên thi không tồn tại, đã hết hạn hoặc đã được nộp.');
    const session = JSON.parse(raw);
    answers = answers || {};
    const user = resolveUser_(clientUser);

    const elapsed = Math.round((Date.now() - session.s) / 1000);
    const late = elapsed > session.d + CONFIG.GRACE_SECONDS;

    const bankMap = {};
    getQuestionBank_().forEach(q => { bankMap[q.id] = q; });

    let correct = 0;
    const wrongIds = [];
    const details = session.it.map((it, i) => {
      const q = bankMap[it.id];
      const perm = it.p.split('').map(Number);
      const chosen = LETTERS.indexOf(String(answers[it.id] || '').toUpperCase());
      if (!q) return null;
      const correctDisplay = LETTERS[perm.indexOf(LETTERS.indexOf(q.a))];
      const isCorrect = !late && chosen >= 0 && LETTERS[chosen] === correctDisplay;
      if (isCorrect) correct++; else wrongIds.push(q.id);
      return {
        no: i + 1,
        id: q.id,
        topic: q.topic,
        question: q.q,
        options: perm.map(k => q.o[k]),
        chosen: chosen >= 0 ? LETTERS[chosen] : null,
        correct: correctDisplay,
        isCorrect: isCorrect,
        explanation: q.e
      };
    }).filter(Boolean);

    const total = details.length;
    const timestamp = new Date();

    // Ghi kết quả: 1 lần ghi duy nhất, có khóa để tránh ghi đè khi nhiều người nộp cùng lúc
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sh = getSheet_(CONFIG.SHEET_RESULTS);
      sh.getRange(sh.getLastRow() + 1, 1, 1, 5)
        .setValues([[timestamp, user, correct, total, wrongIds.join(',')]]);
    } finally {
      lock.releaseLock();
    }
    cache.remove(key); // chống nộp lại nhiều lần

    return {
      user: user,
      mode: session.m,
      correct: correct,
      total: total,
      score10: total ? Math.round(correct / total * 1000) / 100 : 0,
      elapsedSec: Math.min(elapsed, session.d),
      late: late,
      timestamp: timestamp.toISOString(),
      details: details
    };
  });
}

/** Lịch sử làm bài của người dùng (mới nhất trước). */
function getHistory(clientUser) {
  return respond_(() => {
    const user = resolveUser_(clientUser);
    const values = getSheet_(CONFIG.SHEET_RESULTS).getDataRange().getValues(); // đọc 1 lần
    const out = [];
    for (let r = values.length - 1; r >= 1 && out.length < CONFIG.HISTORY_LIMIT; r--) {
      const row = values[r];
      if (normEmail_(row[1]) !== user.toLowerCase()) continue;
      const ts = row[0] instanceof Date ? row[0].toISOString() : String(row[0]);
      const score = Number(row[2]) || 0;
      const total = Number(row[3]) || 0;
      out.push({
        timestamp: ts, // Date không truyền được qua google.script.run → chuyển ISO
        correct: score,
        total: total,
        score10: total ? Math.round(score / total * 1000) / 100 : 0,
        wrongIds: String(row[4] || '').split(',').filter(String)
      });
    }
    return out;
  });
}

// ----------------------------- SETUP (chạy 1 lần) ---------------------------
/** Tạo 2 sheet + dòng tiêu đề nếu chưa có. Chạy thủ công trong Editor. */
function setupSheets() {
  const ss = ss_();
  Object.keys(HEADERS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  clearQuestionCache();
  return 'Đã tạo/kiểm tra sheet Questions & Results.';
}
