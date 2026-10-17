// 두 기준 문서(PRD · 기능명세서)의 ID·참조·범위 일치 점검. 원본은 prd-spec 스킬 scripts/ — 프로젝트 docs/에 복사해 쓴다.
// 사용: node check-docs.mjs [PRD 경로] [명세 경로] [--also 파일 ...]   (기본: 이 파일 옆의 PRD.md · 기능명세서.md)
//       node check-docs.mjs --self-test
// 오류(종료 코드 1): 중복 정의 · 정의 없는 ID · 없는 절 · AC 없는 F · PRD가 가리키지 않는 F · U 표 빈 칸
// 경고(사람이 판단): 아무도 가리키지 않는 U · 설정값 반복 후보
// 정의 = 표의 첫 칸이 ID 하나뿐인 행(규칙 R-는 "R-XXX-01 이름"도). 범위 "R-X-01 ~ R-X-04"는 펼쳐 센다.
// 절 참조는 "{문서 이름} 7.3"(문서 이름 = 파일 이름) · "(3.5)" · "N장"만 본다.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ID_SRC = String.raw`(?<![A-Za-z0-9-])(?:(?:F|R|AC)-[A-Z]+-\d{2}|(?:S|A|U|RK|E)-\d{2}|X-\d)(?![A-Za-z0-9-])`;
const ID = new RegExp(ID_SRC, 'g');
const RANGE = new RegExp(`(${ID_SRC})\\s*~\\s*(${ID_SRC})`, 'g');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lines = (t) => t.split(/\r?\n/);
const cells = (line) => line.split('|').slice(1, -1).map((c) => c.replace(/\*\*/g, '').trim());
const blank = (c) => c === undefined || /^[-—–\s]*$/.test(c);

export function expand(a, b) {
  const [pa, na] = [a.replace(/\d+$/, ''), a.match(/\d+$/)[0]];
  const [pb, nb] = [b.replace(/\d+$/, ''), b.match(/\d+$/)[0]];
  if (pa !== pb || +nb < +na) return null;
  const out = [];
  for (let i = +na; i <= +nb; i++) out.push(pa + String(i).padStart(na.length, '0'));
  return out;
}

function idsIn(text) {
  const found = text.match(ID) ?? [];
  for (const [, a, b] of text.matchAll(RANGE)) found.push(...(expand(a, b) ?? []));
  return found;
}

function headings(text) {
  return new Set([...text.matchAll(/^#{2,3} (\d{1,2}(?:\.\d{1,2})?)[. ]/gm)].map((m) => m[1]));
}

// 설정값 표: 제목에 "설정값"(또는 settings·configuration)이 든 절 안의 표 행. 값 칸의 **굵은 글씨**를 값으로 본다.
function settingsValues(text) {
  const out = [], rows = new Set();
  let inside = false;
  lines(text).forEach((line, i) => {
    if (/^#{1,4} /.test(line)) inside = /설정값|settings|configuration/i.test(line);
    else if (inside && line.startsWith('|')) {
      rows.add(i);
      for (const [, v] of (line.split('|')[2] ?? '').matchAll(/\*\*(.+?)\*\*/g)) if (!/U-\d/.test(v)) out.push(v.trim());
    }
  });
  return { values: [...new Set(out)], rows };
}

// docs: { 이름: 텍스트 } — 첫째가 PRD, 둘째가 명세. also: { 이름: 텍스트 } — 참조만 점검.
export function check(docs, also = {}) {
  const errors = [], warnings = [];
  const names = Object.keys(docs);
  const [prdName, specName] = names;
  const defs = new Map(); // id -> [where]
  const acF = new Set();
  const resolvedU = new Set();
  const heads = Object.fromEntries(names.map((n) => [n, headings(docs[n])]));
  const CROSS = new RegExp(`(${names.map(esc).join('|')})\\s*(\\d{1,2}(?:\\.\\d{1,2})?)(?![\\d.])`, 'g');
  const SELF_CH = new RegExp(`(?<!(?:${names.map(esc).join('|')})\\s*)(?<![\\d.])(\\d{1,2})장`, 'g');

  for (const name of names) {
    lines(docs[name]).forEach((line, i) => {
      if (!line.startsWith('|')) return;
      const c = cells(line);
      const first = c[0] ?? '';
      const id = first.match(new RegExp(`^${ID_SRC}$`))?.[0] ?? first.match(/^R-[A-Z]+-\d{2}(?= )/)?.[0];
      if (!id) return;
      defs.set(id, [...(defs.get(id) ?? []), `${name}:${i + 1}`]);
      if (id.startsWith('AC-')) idsIn(line).filter((x) => x.startsWith('F-')).forEach((x) => acF.add(x));
      if (id.startsWith('U-')) {
        if (c.length < 5 || c.slice(1, 5).some(blank)) errors.push(`U 표 빈 칸 ${id} (미확정·지금 아는 것·누가 정함·바뀌는 곳): ${name}:${i + 1}`);
        if (/^확정/.test(c[2] ?? '')) resolvedU.add(id);
      }
    });
  }
  for (const [id, where] of defs) if (where.length > 1) errors.push(`중복 정의 ${id}: ${where.join(', ')}`);

  const refCount = new Map();
  const prdRefs = new Set();
  const scan = (name, text, selfCheck) => lines(text).forEach((line, i) => {
    for (const id of idsIn(line)) {
      refCount.set(id, (refCount.get(id) ?? 0) + 1);
      if (name === prdName) prdRefs.add(id);
      if (!defs.has(id)) errors.push(`정의 없는 ID ${id}: ${name}:${i + 1}`);
    }
    for (const [, doc, sec] of line.matchAll(CROSS))
      if (!heads[doc].has(sec)) errors.push(`없는 절 ${doc} ${sec}: ${name}:${i + 1}`);
    if (!selfCheck) return;
    for (const [, sec] of [...line.matchAll(/\((\d{1,2}\.\d{1,2})\)/g), ...line.matchAll(SELF_CH)])
      if (!heads[name].has(sec)) errors.push(`없는 절 ${sec}: ${name}:${i + 1}`);
  });
  for (const name of names) scan(name, docs[name], true);
  for (const [name, text] of Object.entries(also)) scan(name, text, false);

  for (const id of defs.keys()) {
    if (id.startsWith('F-') && !acF.has(id)) errors.push(`수용 기준(AC)이 없는 기능 ${id}`);
    if (id.startsWith('F-') && prdName && !prdRefs.has(id)) errors.push(`${prdName}가 가리키지 않는 기능 ${id} (범위 일치)`);
    if (id.startsWith('U-') && !resolvedU.has(id) && (refCount.get(id) ?? 0) < 2) warnings.push(`본문에서 가리키지 않는 미확정 ${id}`);
  }

  if (specName) {
    const { values, rows } = settingsValues(docs[specName]);
    for (const v of values) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(v)}(?!\\p{N})`, 'u');
      const longer = values.filter((w) => w !== v && w.includes(v)); // "3개"를 찾을 때 "3개월"은 빼고 본다
      const hits = [];
      for (const name of names) lines(docs[name]).forEach((line, i) => {
        if (name === specName && rows.has(i)) return;
        const plain = longer.reduce((s, w) => s.split(w).join(' '), line.replace(/\*\*/g, ''));
        if (re.test(plain)) hits.push(`${name}:${i + 1}`);
      });
      if (hits.length) warnings.push(`설정값 반복 후보 "${v}": ${hits.slice(0, 8).join(', ')}${hits.length > 8 ? ` 외 ${hits.length - 8}곳` : ''}`);
    }
  }
  return { errors, warnings, defs };
}

function selfTest() {
  const prd = [
    '## 1. 가',
    '| U-01 | 미정 | 모름 | 사용자 | 기능명세서 1.1 |',
    '| U-02 | 아무도 안 가리킴 | 모름 | 사용자 | 1.1 |',
    '| U-04 | 빈 칸 |  | 사용자 | 1.1 |',
    '| U-05 | 해소됨 | **확정 2026-01-01**: 값 | 사용자 | 1.1 |',
    '본문 ⚠ U-01, U-04, 기능명세서 9.9, 없는 U-03, 범위 F-AA-01 · F-AA-02, 사진 8장',
  ].join('\n');
  const spec = [
    '## 1. 나', '### 1.1 다', '### 1.2 설정값 표', '| 이름 | 값 |', '| 장수 | **8장** |', '| 개수 | **3개** |', '| 간격 | **3개월** |', '## 2. 라', '3개월 뒤',
    '| F-AA-01 | 기능 |', '| F-AA-02 | AC 없음 |', '| F-AA-02 | 중복 |', '| F-AA-03 | PRD 밖 |',
    '| AC-AA-01 | 기준 | F-AA-01 · F-AA-03 |', '| R-AA-01 규칙 | (1.1) (7.7) |',
  ].join('\r\n');
  const { errors, warnings } = check({ PRD: prd, 기능명세서: spec }, { 'app/CLAUDE.md': 'PRD 4.4 · R-AA-01 · R-AA-09' });
  const has = (s) => errors.some((e) => e.includes(s));
  const warn = (s) => warnings.some((w) => w.includes(s));
  const t = [
    ['정의 없는 ID', has('정의 없는 ID U-03')],
    ['중복 정의', has('중복 정의 F-AA-02')],
    ['F↔AC', has('수용 기준(AC)이 없는 기능 F-AA-02') && !has('수용 기준(AC)이 없는 기능 F-AA-01')],
    ['범위 일치', has('PRD가 가리키지 않는 기능 F-AA-03') && !has('PRD가 가리키지 않는 기능 F-AA-01')],
    ['교차 절', has('없는 절 기능명세서 9.9') && !has('없는 절 기능명세서 1.1')],
    ['자기 절', has('없는 절 7.7') && !has('없는 절 1.1:')],
    ['U 빈 칸', has('U 표 빈 칸 U-04') && !has('U 표 빈 칸 U-01')],
    ['고아 U', warn('미확정 U-02') && !warn('미확정 U-01') && !warn('미확정 U-05')],
    ['--also', has('없는 절 PRD 4.4: app/CLAUDE.md') && has('정의 없는 ID R-AA-09: app/CLAUDE.md')],
    ['설정값 반복', warn('설정값 반복 후보 "8장": PRD:6') && warn('"3개월": 기능명세서:9') && !warn('"3개":')],
    ['범위 펼치기', JSON.stringify(expand('R-DET-01', 'R-DET-03')) === '["R-DET-01","R-DET-02","R-DET-03"]'],
  ];
  t.forEach(([n, ok]) => console.log(`${ok ? '통과' : '실패'}  ${n}`));
  const failed = t.filter(([, ok]) => !ok).length;
  console.log(failed ? `self-test 실패 ${failed}건` : 'self-test 전부 통과');
  process.exit(failed ? 1 : 0);
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();
else {
  const at = args.indexOf('--also');
  const docArgs = (at < 0 ? args : args.slice(0, at)).filter((a) => !a.startsWith('--'));
  const alsoArgs = at < 0 ? [] : args.slice(at + 1).filter((a) => !a.startsWith('--'));
  const dir = dirname(fileURLToPath(import.meta.url));
  const paths = docArgs.length >= 2 ? docArgs.slice(0, 2) : [join(dir, 'PRD.md'), join(dir, '기능명세서.md')];
  const docs = Object.fromEntries(paths.map((p) => [basename(p, '.md'), readFileSync(p, 'utf8')]));
  const also = Object.fromEntries(alsoArgs.map((p) => [p, readFileSync(p, 'utf8')]));
  const { errors, warnings, defs } = check(docs, also);
  const count = (p) => [...defs.keys()].filter((id) => id.startsWith(p)).length;
  console.log(`정의: F ${count('F-')} · R ${count('R-')} · S ${count('S-')} · A ${count('A-')} · AC ${count('AC-')} · U ${count('U-')} · RK ${count('RK-')} · E ${count('E-')} · X ${count('X-')}`);
  warnings.forEach((w) => console.log(`경고  ${w}`));
  errors.forEach((e) => console.log(`오류  ${e}`));
  console.log(errors.length ? `오류 ${errors.length}건` : '오류 없음');
  process.exit(errors.length ? 1 : 0);
}
