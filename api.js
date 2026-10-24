/**
 * Lớp gọi API tới Google Apps Script (thay cho google.script.run).
 * - Gửi POST với Content-Type text/plain → "simple request", không có preflight OPTIONS
 *   (Apps Script không xử lý OPTIONS) nên không bị lỗi CORS.
 * - Apps Script trả 302 sang script.googleusercontent.com; fetch tự follow redirect.
 * - Mọi phản hồi có dạng { success, data, error }.
 */
(function () {
  const cfg = window.APP_CONFIG || {};
  // Chấp nhận cả URL tài khoản cá nhân (…/macros/s/ID/exec)
  // và URL tài khoản Google Workspace/trường học (…/a/macros/ten-mien.edu.vn/s/ID/exec)
  const RAW_URL = String(cfg.API_URL || '').trim();
  const URL_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^\/\s]+|macros)\/s\/[\w-]+\/exec$/;

  /** Trả về '' nếu cấu hình hợp lệ, ngược lại trả về mô tả lỗi cụ thể. */
  function configError() {
    if (!window.APP_CONFIG) return 'Không đọc được js/config.js (file thiếu, sai tên/thư mục, hoặc lỗi cú pháp – kiểm tra dấu nháy và dấu phẩy).';
    if (!RAW_URL || RAW_URL.indexOf('PASTE_YOUR') >= 0) return 'API_URL vẫn là giá trị mẫu – chưa dán URL Web App (hoặc trình duyệt đang dùng bản config.js cũ: nhấn Ctrl + F5).';
    if (/\/dev(\?|$)/.test(RAW_URL)) return 'Bạn đang dùng URL kết thúc bằng /dev (bản test). Hãy dùng URL kết thúc bằng /exec trong Deploy → Manage deployments.';
    if (/\/edit|\/home\/projects|docs\.google\.com/.test(RAW_URL)) return 'Đây là link trình soạn thảo Apps Script hoặc Google Sheet, không phải URL Web App. Lấy URL trong Deploy → Manage deployments → Web app.';
    if (!URL_RE.test(RAW_URL)) return 'URL không đúng dạng https://script.google.com/macros/s/…/exec (hoặc …/a/macros/ten-mien/s/…/exec). Giá trị hiện tại: ' + RAW_URL;
    return '';
  }
  const URL_OK = configError() === '';

  async function request(method, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.REQUEST_TIMEOUT_MS || 30000);
    try {
      const url = RAW_URL + (method === 'GET' ? '?action=init&t=' + Date.now() : '');
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
    configError,
    init:    ()                         => request('GET'),
    start:   (opts)                     => post('start', opts),
    submit:  (sessionId, answers, user) => post('submit', { sessionId, answers, user }),
    history: (user)                     => post('history', { user })
  };
})();
