/* Logic giao diện (Vue 3) – Ôn thi trắc nghiệm */
/* localStorage an toàn (có thể bị chặn ở chế độ ẩn danh) */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k)    { try { localStorage.removeItem(k); } catch (e) {} }
};
const BACKUP_KEY = 'quiz_inprogress_v1';

const { createApp } = Vue;

createApp({
  data() {
    return {
      L: ['A', 'B', 'C', 'D'],
      screen: 'boot',            // config | boot | home | exam | result
      appTitle: 'Ôn thi trắc nghiệm',
      busy: false,
      toast: null,
      // Home
      user: store.get('quiz_user', ''),
      topics: [], total: 0, maxQuestions: 200,
      selectedTopics: [],
      cfg: Object.assign({ count: 25, minutes: 30, mode: 'exam' }, store.get('quiz_cfg', {})),
      history: [], historyLoading: false,
      // Exam
      exam: { sessionId: null, mode: 'exam', questions: [], durationSec: 0 },
      idx: 0, answers: {}, flags: {},
      endAt: 0, now: Date.now(), timer: null,
      confirmSubmit: false,
      // Result
      result: null, reviewFilter: 'wrong',
      reviewFilters: [{ key: 'wrong', label: 'Câu sai' }, { key: 'all', label: 'Tất cả' }, { key: 'correct', label: 'Câu đúng' }]
    };
  },

  computed: {
    poolSize() {
      const sel = this.selectedTopics;
      const n = this.topics.filter(t => !sel.length || sel.includes(t.name)).reduce((s, t) => s + t.count, 0);
      return Math.min(n, this.maxQuestions);
    },
    canStart() { return this.user && this.poolSize > 0 && this.cfg.count >= 1 && this.cfg.minutes >= 1; },
    current() { return this.exam.questions[this.idx]; },
    answeredCount() { return Object.keys(this.answers).length; },
    unanswered() { return this.exam.questions.length - this.answeredCount; },
    remaining() { return Math.max(0, Math.round((this.endAt - this.now) / 1000)); },
    wrongIds() { return this.result ? this.result.details.filter(d => !d.isCorrect).map(d => d.id) : []; },
    wrongCount() { return this.result ? this.result.details.filter(d => !d.isCorrect && d.chosen).length : 0; },
    skippedCount() { return this.result ? this.result.details.filter(d => !d.chosen).length : 0; },
    reviewList() {
      if (!this.result) return [];
      const d = this.result.details;
      return this.reviewFilter === 'all' ? d : d.filter(x => this.reviewFilter === 'correct' ? x.isCorrect : !x.isCorrect);
    }
  },

  watch: {
    user(v) { store.set('quiz_user', v); },
    cfg: { deep: true, handler(v) { store.set('quiz_cfg', v); } },
    remaining(v) { if (this.screen === 'exam' && v === 0 && !this.busy) this.submit(true); }
  },

  methods: {
    /* ---------- tiện ích ---------- */
    notify(msg, type = 'info', ms = 3500) {
      this.toast = { msg, type };
      clearTimeout(this._t); this._t = setTimeout(() => (this.toast = null), ms);
    },
    fmtTime(s) {
      s = Math.max(0, s | 0);
      const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
      return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    },
    fmtDate(iso) { try { return new Date(iso).toLocaleString('vi-VN'); } catch (e) { return iso; } },
    scoreColor(s) { return s >= 8 ? 'text-emerald-600' : s >= 5 ? 'text-amber-600' : 'text-rose-600'; },

    /* ---------- khởi tạo ---------- */
    async init() {
      if (!API.isConfigured()) { this.screen = 'config'; return; }
      try {
        const d = await API.init();
        this.appTitle = d.appTitle; this.topics = d.topics; this.total = d.total; this.maxQuestions = d.maxQuestions;
        document.title = d.appTitle;
        this.selectedTopics = this.topics.map(t => t.name);
        if (this.restoreBackup()) return;      // tiếp tục bài đang làm dở (nếu F5)
        this.screen = 'home';
        if (this.user) this.loadHistory();
      } catch (e) {
        this.screen = 'home';
        this.notify('Lỗi tải dữ liệu: ' + e.message, 'error', 8000);
      }
    },
    toggleAllTopics() {
      this.selectedTopics = this.selectedTopics.length === this.topics.length ? [] : this.topics.map(t => t.name);
    },
    async loadHistory() {
      if (!this.user) return;
      this.historyLoading = true;
      try { this.history = await API.history(this.user); }
      catch (e) { this.notify(e.message, 'error'); }
      finally { this.historyLoading = false; }
    },

    /* ---------- bắt đầu thi ---------- */
    async start(ids) {
      if (!this.user) return this.notify('Vui lòng nhập email/họ tên.', 'error');
      this.busy = true;
      try {
        const opts = ids
          ? { ids, count: ids.length, minutes: Math.max(5, Math.ceil(ids.length * 1.2)), mode: 'practice' }
          : { topics: this.selectedTopics, count: Math.min(this.cfg.count, this.poolSize), minutes: this.cfg.minutes, mode: this.cfg.mode };
        const ex = await API.start(opts);
        this.exam = ex;
        this.idx = 0; this.answers = {}; this.flags = {}; this.result = null;
        this.endAt = Date.now() + ex.durationSec * 1000;
        this.screen = 'exam';
        this.startTimer();
        this.saveBackup();
        window.scrollTo(0, 0);
      } catch (e) { this.notify(e.message, 'error'); }
      finally { this.busy = false; }
    },
    retry(ids) { this.start(ids.slice()); },

    startTimer() {
      clearInterval(this.timer);
      this.now = Date.now();
      this.timer = setInterval(() => (this.now = Date.now()), 500); // dùng mốc thời gian thật, không bị lệch khi tab ngủ
    },

    /* ---------- làm bài ---------- */
    isLocked(q) { return this.exam.mode === 'practice' && !!this.answers[q.id]; },
    choose(letter) {
      const q = this.current;
      if (!q || this.isLocked(q)) return;
      this.answers = { ...this.answers, [q.id]: letter };
      this.saveBackup();
    },
    toggleFlag(id) { this.flags = { ...this.flags, [id]: !this.flags[id] }; },
    go(i) {
      if (i < 0 || i >= this.exam.questions.length) return;
      this.idx = i;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    optionClass(q, letter) {
      const chosen = this.answers[q.id];
      if (this.exam.mode === 'practice' && chosen) {
        if (letter === q.correct) return 'border-emerald-500 bg-emerald-50';
        if (letter === chosen) return 'border-rose-500 bg-rose-50';
        return 'border-slate-200 opacity-60';
      }
      return chosen === letter ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50';
    },
    navClass(q, i) {
      const a = this.answers[q.id];
      let c = i === this.idx ? 'ring-2 ring-offset-1 ring-indigo-400 ' : '';
      if (!a) return c + 'border-slate-300 bg-white';
      if (this.exam.mode === 'practice') return c + (a === q.correct ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-rose-500 text-white border-rose-500');
      return c + 'bg-indigo-600 text-white border-indigo-600';
    },

    /* ---------- nộp bài ---------- */
    async submit(auto) {
      if (this.busy || !this.exam.sessionId) return;
      this.busy = true;
      if (auto) this.notify('Hết giờ! Hệ thống tự động nộp bài…');
      try {
        const res = await API.submit(this.exam.sessionId, this.answers, this.user);
        clearInterval(this.timer);
        store.del(BACKUP_KEY);
        this.result = res;
        this.reviewFilter = res.correct === res.total ? 'all' : 'wrong';
        this.confirmSubmit = false;
        this.exam.sessionId = null;
        this.screen = 'result';
        window.scrollTo(0, 0);
        this.loadHistory();
      } catch (e) {
        this.notify('Nộp bài thất bại: ' + e.message + ' — thử lại.', 'error', 8000);
      } finally { this.busy = false; }
    },
    goHome() { this.screen = 'home'; this.result = null; },

    /* ---------- sao lưu bài làm dở (phòng F5/mất mạng) ---------- */
    saveBackup() {
      if (this.screen !== 'exam') return;
      store.set(BACKUP_KEY, { exam: this.exam, answers: this.answers, endAt: this.endAt, user: this.user });
    },
    restoreBackup() {
      const b = store.get(BACKUP_KEY, null);
      if (!b || !b.exam || !b.exam.sessionId || b.endAt < Date.now() - 60000) { store.del(BACKUP_KEY); return false; }
      this.exam = b.exam; this.answers = b.answers || {}; this.endAt = b.endAt; this.user = b.user || this.user;
      this.screen = 'exam'; this.startTimer();
      this.notify('Đã khôi phục bài làm đang dở.');
      return true;
    },

    /* ---------- phím tắt ---------- */
    onKey(e) {
      if (this.screen !== 'exam' || this.confirmSubmit || /input|textarea/i.test(e.target.tagName)) return;
      const k = e.key.toUpperCase();
      if (this.L.includes(k)) this.choose(k);
      else if (e.key === 'ArrowRight') this.go(this.idx + 1);
      else if (e.key === 'ArrowLeft') this.go(this.idx - 1);
    }
  },

  mounted() {
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('beforeunload', e => {
      if (this.screen === 'exam') { e.preventDefault(); e.returnValue = ''; }
    });
    this.init();
  }
}).mount('#app');
