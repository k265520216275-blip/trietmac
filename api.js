/**
 * Lớp gọi API tới Google Apps Script (thay cho google.script.run).
 * - Gửi POST với Content-Type text/plain → "simple request", không có preflight OPTIONS
 *   (Apps Script không xử lý OPTIONS) nên không bị lỗi CORS.
 * - Apps Script trả 302 sang script.googleusercontent.com; fetch tự follow redirect.
 * - Mọi phản hồi có dạng { success, data, error }.
 */
(function () {
  const cfg = window.APP_CONFIG || {};
  const URL_OK = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(String(cfg.API_URL || '').trim());

  async function request(method, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.REQUEST_TIMEOUT_MS || 30000);
    try {
      const url = cfg.API_URL.trim() + (method === 'GET' ? '?action=init&t=' + Date.now() : '');
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: method === 'POST' ? { 'Content-Type': 'text/plain;charset=utf-8' } : undefined,
        body: method === 'POST' ? JSON.stringify(body) : undefined
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let json;
      try { json = await res.json(); }
      catch (e) { throw new Error('Máy chủ trả về dữ liệu không phải JSON — kiểm tra quyền truy cập Web App ("Anyone").'); }
      if (!json || !json.success) throw new Error((json && json.error) || 'Máy chủ không phản hồi');
      return json.data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Hết thời gian chờ máy chủ, vui lòng thử lại.');
      if (e instanceof TypeError) throw new Error('Không kết nối được API (mạng hoặc URL trong js/config.js sai).');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const post = (action, payload) => request('POST', { action, payload });

  window.API = {
    isConfigured: () => URL_OK,
    init:    ()                         => request('GET'),
    start:   (opts)                     => post('start', opts),
    submit:  (sessionId, answers, user) => post('submit', { sessionId, answers, user }),
    history: (user)                     => post('history', { user })
  };
})();
