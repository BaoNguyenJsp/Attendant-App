/* Sample workbook for the import of the old Google Sheet (src/lib/db/sheet-import.js reads these columns).
   Each tab: its columns with the values they accept, and example rows that import without a skipped line. */
const PRESENT = 'Hiện diện / Có mặt = có mặt · Có phép / Vắng có phép = có phép · Vắng (chữ khác) = vắng · trống = chưa điểm danh';
const WEEK = 'Ngày bất kỳ trong tuần (YYYY-MM-DD, DD/MM/YYYY hoặc ô ngày), tự đổi về Chủ Nhật của tuần';
const STUDENT = 'CCCD / mã của Thiếu nhi, phải có trong tab Students';

export const IMPORT_TEMPLATE = [
  { tab: 'Config', columns: [
    ['Key', 'Bắt buộc CurrentSchoolYear. Thường có: CurrentSchoolYear, AttendanceStartDate, DriveFolderId'],
    ['Value', 'CurrentSchoolYear: YYYY-YYYY (vd 2025-2026) · AttendanceStartDate: ngày · DriveFolderId: mã thư mục Drive gốc (có thể trống)'],
  ], rows: [
    { Key: 'CurrentSchoolYear', Value: '2025-2026' },
    { Key: 'AttendanceStartDate', Value: '2025-09-07' },
    { Key: 'DriveFolderId', Value: '' },
  ] },
  { tab: 'Classes', columns: [
    ['ClassName', 'Bắt buộc, không trùng. Thứ tự dòng là thứ tự lên lớp khi chuyển năm'],
    ['Grade', 'Khối (tùy chọn), vd Ấu, Thiếu, Nghĩa'],
  ], rows: [
    { ClassName: 'Ấu 1', Grade: 'Ấu' },
    { ClassName: 'Ấu 2', Grade: 'Ấu' },
  ] },
  { tab: 'Users', columns: [
    ['Email', 'Bắt buộc, email Google, không trùng. Phải có email của người đang nhập, trong một nhóm Quản trị'],
    ['SaintName', 'Tên Thánh (tùy chọn)'],
    ['FullName', 'Bắt buộc'],
    ['Status', 'Hoạt động = được đăng nhập · chữ khác (vd Khóa) = ngừng'],
    ['SDT', 'Số điện thoại (tùy chọn)'],
  ], rows: [
    { Email: 'admin@example.com', SaintName: 'Giuse', FullName: 'Nguyễn Văn Quản', Status: 'Hoạt động', SDT: '0912345678' },
    { Email: 'teacher@example.com', SaintName: 'Maria', FullName: 'Trần Thị Dạy', Status: 'Hoạt động', SDT: '' },
  ] },
  { tab: 'Groups', columns: [
    ['GroupName', 'Bắt buộc, không trùng'],
    ['Type', 'Lớp · Ngành · Quản trị ngành · Quản trị'],
    ['Scope', 'Lớp: tên lớp (trống = trùng tên nhóm) · Ngành: các tên lớp, cách nhau dấu phẩy · Quản trị ngành: tên một nhóm Ngành · Quản trị: trống'],
    ['Description', 'Mô tả (tùy chọn)'],
  ], rows: [
    { GroupName: 'Xứ đoàn', Type: 'Quản trị', Scope: '', Description: '' },
    { GroupName: 'Ngành Ấu', Type: 'Ngành', Scope: 'Ấu 1, Ấu 2', Description: '' },
    { GroupName: 'BQT Ấu', Type: 'Quản trị ngành', Scope: 'Ngành Ấu', Description: '' },
    { GroupName: 'Lớp Ấu 1', Type: 'Lớp', Scope: 'Ấu 1', Description: '' },
  ] },
  { tab: 'GroupMembers', columns: [
    ['GroupName', 'Tên nhóm trong tab Groups'],
    ['Email', 'Email trong tab Users'],
  ], rows: [
    { GroupName: 'Xứ đoàn', Email: 'admin@example.com' },
    { GroupName: 'Lớp Ấu 1', Email: 'teacher@example.com' },
  ] },
  { tab: 'Holidays', columns: [
    ['WeekOf', WEEK],
    ['Session', 'Lễ Chúa Nhật · Học Giáo Lý · Chầu Thánh Thể · Lễ Thứ Năm (Lễ Thứ 5) · Họp Huynh Trưởng · trống = nghỉ cả tuần'],
    ['Reason', 'Lý do (tùy chọn)'],
  ], rows: [
    { WeekOf: '2025-12-28', Session: '', Reason: 'Nghỉ Giáng Sinh' },
    { WeekOf: '2025-09-14', Session: 'Lễ Thứ Năm', Reason: 'Bão' },
  ] },
  { tab: 'Students', columns: [
    ['IdNumber', 'Bắt buộc, CCCD / mã, không trùng (số 0 đầu có thể mất, vẫn nhận đúng)'],
    ['SaintName', 'Tên Thánh (tùy chọn)'],
    ['FullName', 'Bắt buộc'],
    ['DateOfBirth', 'Ngày sinh: YYYY-MM-DD, DD/MM/YYYY hoặc ô ngày (tùy chọn)'],
    ['Gender', 'Nam · Nữ · trống'],
    ['Father', 'Tên cha (tùy chọn)'],
    ['Mother', 'Tên mẹ (tùy chọn)'],
    ['PhoneNumber', 'Một hoặc nhiều số, cách nhau dấu / hoặc dấu phẩy (tùy chọn)'],
    ['CurrentClass', 'Bắt buộc, tên lớp trong tab Classes'],
    ['EnrollYear', 'Năm vào đoàn, vd 2020 (tùy chọn)'],
  ], rows: [
    { IdNumber: '079300000001', SaintName: 'Maria', FullName: 'Nguyễn Thị An', DateOfBirth: '2015-01-01', Gender: 'Nữ', Father: 'Nguyễn Văn Cha', Mother: 'Lê Thị Mẹ', PhoneNumber: '0901000001 / 0902000002', CurrentClass: 'Ấu 1', EnrollYear: 2022 },
    { IdNumber: '079300000002', SaintName: 'Phêrô', FullName: 'Nguyễn Văn Bình', DateOfBirth: '15/06/2014', Gender: 'Nam', Father: 'Nguyễn Văn Cha', Mother: 'Lê Thị Mẹ', PhoneNumber: '', CurrentClass: 'Ấu 2', EnrollYear: 2021 },
  ] },
  { tab: 'SiblingGroups', columns: [
    ['Siblings', 'Các CCCD / mã của anh chị em trong một gia đình, cách nhau dấu phẩy (ít nhất 2)'],
  ], rows: [
    { Siblings: '079300000001, 079300000002' },
  ] },
  { tab: 'Att_Ấu 1', note: 'Điểm danh Thiếu nhi: mỗi lớp một tab tên Att_<tên lớp> (hoặc một tab Attendance)', columns: [
    ['WeekOf', WEEK],
    ['IdNumber', STUDENT],
    ['ClassName', 'Tên lớp lúc điểm danh (trống = lớp hiện tại)'],
    ['LeChuaNhat_Status', PRESENT],
    ['HocGiaoLy_Status', PRESENT],
    ['ChauThanhThe_Status', PRESENT],
    ['LeThu5_Status', PRESENT],
  ], rows: [
    { WeekOf: '2025-09-14', IdNumber: '079300000001', ClassName: 'Ấu 1', LeChuaNhat_Status: 'Hiện diện', HocGiaoLy_Status: 'Có phép', ChauThanhThe_Status: 'Vắng', LeThu5_Status: '' },
  ] },
  { tab: 'TeacherAttendance', columns: [
    ['WeekOf', WEEK],
    ['TeacherEmail', 'Email trong tab Users'],
    ['LeChuaNhat_Status', PRESENT],
    ['HocGiaoLy_Status', PRESENT],
    ['ChauThanhThe_Status', PRESENT],
    ['LeThu5_Status', PRESENT],
    ['HopHuynhTruong_Status', PRESENT],
  ], rows: [
    { WeekOf: '2025-09-14', TeacherEmail: 'teacher@example.com', LeChuaNhat_Status: 'Hiện diện', HocGiaoLy_Status: 'Hiện diện', ChauThanhThe_Status: '', LeThu5_Status: '', HopHuynhTruong_Status: 'Có phép' },
  ] },
  { tab: 'Scores', columns: [
    ['IdNumber', `${STUDENT}; một dòng cho mỗi Thiếu nhi`],
    ['ClassName', 'Tên lớp (trống = lớp hiện tại)'],
    ['Quiz15_S1', 'Điểm 15 phút HK1: 0 đến 10, dấu chấm hoặc phẩy, trống = chưa có'],
    ['Exam_S1', 'Điểm thi HK1: 0 đến 10'],
    ['Quiz15_S2', 'Điểm 15 phút HK2: 0 đến 10'],
    ['Exam_S2', 'Điểm thi HK2: 0 đến 10'],
  ], rows: [
    { IdNumber: '079300000001', ClassName: 'Ấu 1', Quiz15_S1: 8, Exam_S1: '7,5', Quiz15_S2: '', Exam_S2: '' },
  ] },
  { tab: 'AcademicYear', note: 'Học bạ các năm đã qua', columns: [
    ['SchoolYear', 'Bắt buộc, YYYY-YYYY'],
    ['IdNumber', `${STUDENT}; một dòng cho mỗi năm`],
    ['ClassName', 'Bắt buộc, tên lớp của năm đó (không cần có trong tab Classes)'],
    ['HK1Score', 'Điểm trung bình HK1 (số)'],
    ['HK2Score', 'Điểm trung bình HK2 (số)'],
    ['YearScore', 'Điểm trung bình năm (số)'],
    ['YearAttendant', 'Tỉ lệ chuyên cần, % (số nguyên)'],
    ['Status', 'Giỏi · Tiên Tiến · Trung Bình · trống'],
  ], rows: [
    { SchoolYear: '2024-2025', IdNumber: '079300000002', ClassName: 'Ấu 1', HK1Score: 8.2, HK2Score: 8.6, YearScore: 8.4, YearAttendant: 92, Status: 'Giỏi' },
  ] },
  { tab: 'Teaching', note: 'Giáo án: Url, Names, Types là danh sách cùng thứ tự', columns: [
    ['SchoolYear', 'Bắt buộc, YYYY-YYYY'],
    ['WeekOf', WEEK],
    ['ClassName', 'Bắt buộc, tên lớp trong tab Classes; một dòng cho mỗi năm, tuần, lớp'],
    ['TeacherEmail', 'Email trong tab Users (trống = UpdatedBy)'],
    ['UpdatedBy', 'Email trong tab Users (tùy chọn)'],
    ['LessonContent', 'Nội dung bài học'],
    ['LessonPlanUrl', 'Các URL giáo án, cách nhau dấu phẩy. Tệp Drive: https://drive.google.com/file/d/<mã>/view'],
    ['LessonPlanNames', 'Tên hiển thị của từng URL, mỗi tên một dòng (Alt+Enter trong ô)'],
    ['LessonPlanTypes', 'file (tệp trên Drive) hoặc link (liên kết), cách nhau dấu phẩy'],
    ['RevisedPlanUrl', 'Như LessonPlanUrl, cho giáo án đã sửa'],
    ['RevisedPlanNames', 'Như LessonPlanNames'],
    ['RevisedPlanTypes', 'Như LessonPlanTypes'],
  ], rows: [
    {
      SchoolYear: '2025-2026', WeekOf: '2025-09-14', ClassName: 'Ấu 1', TeacherEmail: 'teacher@example.com', UpdatedBy: 'teacher@example.com', LessonContent: 'Bài 1: Thiên Chúa yêu thương',
      LessonPlanUrl: 'https://drive.google.com/file/d/FILE_ID/view,https://example.com/bai-1', LessonPlanNames: 'Giáo án bài 1.docx\nTrang tham khảo', LessonPlanTypes: 'file,link',
      RevisedPlanUrl: '', RevisedPlanNames: '', RevisedPlanTypes: '',
    },
  ] },
];

// The workbook as arrays of rows for XLSX.utils.aoa_to_sheet: a guide tab first, then one tab per entry.
export function templateSheets() {
  const guide = [['Tab', 'Cột', 'Giá trị hợp lệ'],
    ['', '', 'Tệp mẫu để nhập dữ liệu mới. Thay các dòng ví dụ bằng dữ liệu thật; tab này được bỏ qua khi nhập.']];
  for (const { tab, note, columns } of IMPORT_TEMPLATE) {
    if (note) guide.push([tab, '', note]);
    for (const [column, hint] of columns) guide.push([tab, column, hint]);
  }
  return [['HuongDan', guide], ...IMPORT_TEMPLATE.map(({ tab, columns, rows }) => {
    const names = columns.map(([column]) => column);
    return [tab, [names, ...rows.map((row) => names.map((column) => row[column] ?? ''))]];
  })];
}
