/**
 * CẤU HÌNH FRONTEND
 * Dán URL Web App của Google Apps Script (Deploy → Web app → URL kết thúc bằng /exec).
 * URL này công khai (ai mở trang cũng thấy) – bình thường, vì đáp án và chấm điểm nằm ở server.
 */
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzzb2z_K_rrGK3HZ-gssCiKi3Pnksem1EZJOE2_HjVfyKDjk29lk0bv5wwr0kD0LMALCQ/exec',
  REQUEST_TIMEOUT_MS: 30000
};
