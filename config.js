/**
 * ตั้งค่าหน้าเว็บ — แก้ที่ไฟล์นี้ที่เดียว
 * API_URL = Web app URL (/exec) ของ Apps Script ที่ deploy แบบ Execute as: Me / Who has access: Anyone
 */
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzmhxKqbN3sjiXXy3cwAZbjxptWB09ZqD3rcSCS7HYGNttGAUPIgQJnVZWwVRsHdORG/exec',
  TIMEOUT_READ_MS: 60000,   // โหลดข้อมูลทั้งหมด
  TIMEOUT_WRITE_MS: 90000   // บันทึก/นำเข้า (นำเข้าไฟล์ใหญ่ใช้เวลานาน)
};
