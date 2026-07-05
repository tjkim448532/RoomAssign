import * as XLSX from 'xlsx';
import * as fs from 'fs';

const buf = fs.readFileSync('public/template.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });
const sheetName = wb.SheetNames[0];
const ws = wb.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

console.log('Sheet Name:', sheetName);
console.log('--- First 30 Rows ---');
for (let i = 0; i < Math.min(30, data.length); i++) {
  console.log(`Row ${i + 1}:`, data[i]);
}
