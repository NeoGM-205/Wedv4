import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const vendorDir = path.join(root, 'public', 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });
const require = createRequire(import.meta.url);

const qrEntry = require.resolve('qrcode/lib/browser.js');
await build({
  entryPoints: [qrEntry],
  outfile: path.join(vendorDir, 'qrcode.bundle.js'),
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'QRCode',
  target: ['es2018']
});

const pdfEntry = require.resolve('pdf-lib/dist/pdf-lib.min.js');
fs.copyFileSync(pdfEntry, path.join(vendorDir, 'pdf-lib.min.js'));
console.log('[Vendor] Đã tạo QRCode + PDFLib chạy offline trong public/vendor');
