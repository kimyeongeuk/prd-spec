// 한글 PDF에서 쪽별 텍스트와 내장 그림을 꺼낸다. prd-spec 스킬 A-1(자료 읽기)용.
// 사용: node read-pdf.mjs <PDF 경로> <출력 폴더>
//   → <출력 폴더>/text.txt (쪽마다 "===== PAGE n =====")
//   → <출력 폴더>/p{쪽}_img{n}.png (내장 그림. 1비트 흑백 그림은 건너뛴다)
// 왜: Read 도구의 PDF 읽기는 poppler(pdftoppm)가 없으면 실패하고, pdftotext는 한글 CMap(UniKS-UTF16-H)이 없으면
//     한글을 빈칸으로 뽑고, pdfjs 페이지 렌더링은 큰 그림에서 죽을 수 있다. 그래서 텍스트는 CMap을 넣은 pdfjs로,
//     그림은 렌더링 대신 내장 이미지를 직접 꺼낸다. 처음 실행 때 pdfjs-dist를 임시 폴더에 설치한다(Node만 필요).
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const PDFJS_VERSION = '4.10.38';
const [pdfPath, outDir] = process.argv.slice(2);
if (!pdfPath || !outDir) {
  console.error('사용: node read-pdf.mjs <PDF 경로> <출력 폴더>');
  process.exit(2);
}

const cache = join(tmpdir(), `prd-spec-pdfjs-${PDFJS_VERSION}`);
const pkg = join(cache, 'node_modules', 'pdfjs-dist');
if (!existsSync(join(pkg, 'package.json'))) {
  mkdirSync(cache, { recursive: true });
  console.log(`pdfjs-dist@${PDFJS_VERSION} 설치: ${cache}`);
  execSync(`npm install pdfjs-dist@${PDFJS_VERSION} --prefix "${cache}" --no-save --silent --no-audit --no-fund`, { stdio: 'inherit' });
}
const pdfjs = await import(pathToFileURL(join(pkg, 'legacy', 'build', 'pdf.mjs')).href);

// 최소 PNG 인코더(zlib만 사용)
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(width, height, channels, data) {
  const row = width * channels, raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * row, row).copy(raw, y * (row + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : channels === 3 ? 2 : 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(outDir, { recursive: true });
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(resolve(pdfPath))),
  cMapUrl: join(pkg, 'cmaps') + '/',
  cMapPacked: true,
  standardFontDataUrl: join(pkg, 'standard_fonts') + '/',
  verbosity: 0,
}).promise;

let text = `PAGES: ${doc.numPages}\n`, images = 0;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);

  // 텍스트: 높이(y)가 같은 조각을 한 줄로 모으고 가로 위치(x) 순으로 잇는다.
  // 스트림 순서대로 이으면 양식 PDF에서 숫자가 줄 끝으로 밀려 나온다("사진 장과 질문 개로 … 8 4").
  const rows = [];
  for (const item of (await page.getTextContent()).items) {
    if (!item.str) continue;
    const [x, y] = [item.transform[4], item.transform[5]];
    let row = rows.find((r) => Math.abs(r.y - y) <= 3);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, s: item.str });
  }
  const out = rows.sort((a, b) => b.y - a.y).map((r) => r.parts.sort((a, b) => a.x - b.x).map((q) => q.s).join(''));
  text += `\n===== PAGE ${p} =====\n${out.filter((l) => l.trim()).join('\n')}\n`;

  // 그림: 연산자 목록의 내장 이미지를 그대로 꺼낸다(렌더링하지 않는다)
  const ops = await page.getOperatorList();
  let n = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
    const id = ops.argsArray[i][0];
    const img = await new Promise((done) => (id.startsWith('g_') ? page.commonObjs : page.objs).get(id, done));
    if (!img?.data || img.kind === 1) continue; // 1비트 흑백은 건너뜀
    const channels = img.kind === 3 ? 4 : 3;
    writeFileSync(join(outDir, `p${p}_img${++n}.png`), png(img.width, img.height, channels, img.data));
    images++;
  }
}
writeFileSync(join(outDir, 'text.txt'), text);
console.log(`쪽 ${doc.numPages} · 텍스트 ${text.length}자 → ${join(outDir, 'text.txt')} · 그림 ${images}개 → ${outDir}`);
