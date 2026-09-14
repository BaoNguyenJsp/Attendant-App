const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost', port: 3000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, r => {
      let b = '';
      r.on('data', d => b += d);
      r.on('end', () => resolve({ status: r.statusCode, body: b }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  try {
    // 1. getStudents
    const st = await post('/api/getStudents', { token: 'dev-shared-token' });
    const d = JSON.parse(st.body);
    const firstStudent = d.students && d.students[0];
    console.log('=== getStudents ===');
    console.log('Total students:', (d.students || []).length);
    console.log('First student keys:', firstStudent ? Object.keys(firstStudent).join(',') : '(none)');
    console.log('Has Photo key?', firstStudent ? ('Photo' in firstStudent) : false);
    console.log('Photo value:', firstStudent ? JSON.stringify(firstStudent.Photo) : '(none)');
    console.log();

    // 2. getAttendance
    const cls = firstStudent ? firstStudent.CurrentClass : '1A';
    const at = await post('/api/getAttendance', {
      token: 'dev-shared-token',
      schoolYear: '2025-2026',
      weekOf: 1,
      session: 'Lễ Chúa Nhật',
      className: cls
    });
    const d2 = JSON.parse(at.body);
    const firstRec = d2.records && d2.records[0];
    console.log('=== getAttendance (class=' + cls + ') ===');
    console.log('Total records:', (d2.records || []).length);
    console.log('First record keys:', firstRec ? Object.keys(firstRec).join(',') : '(none)');
    console.log('Has photo key?', firstRec ? ('photo' in firstRec) : false);
    console.log('First record:', JSON.stringify(firstRec, null, 2));
    console.log();
    console.log('=== DIAGNOSIS ===');
    if (firstRec && 'photo' in firstRec) {
      console.log('✓ Apps Script IS deployed with photo field. Frontend should work.');
      console.log('  → If browser still shows no photo, clear browser cache (Ctrl+Shift+R)');
    } else {
      console.log('✗ Apps Script is running OLD code without photo field.');
      console.log('  → MUST redeploy: Deploy → Manage deployments → Edit → New version → Deploy');
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
