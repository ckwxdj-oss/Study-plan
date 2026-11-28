// 밀림 계산 자동 테스트
// 실행 방법: node tests.js
// index.html 안의 <script id="logic"> 부분만 꺼내서 검사해요. (화면 코드는 쓰지 않아요)
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');

var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var m = html.match(/<script id="logic">([\s\S]*?)<\/script>/);
if (!m) { console.error('index.html에서 logic 스크립트를 찾지 못했어요'); process.exit(1); }
var ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(m[1], ctx);
var L = ctx.module.exports;

/* ---------- 테스트 도구 ---------- */
var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { failed++; console.log('  ❌ ' + name + '\n     → ' + e.message); }
}
function eq(actual, expected, msg) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((msg || '') + ' 기대값 ' + b + ' / 실제값 ' + a);
}

// 번호형 과목 만들기
function subj(id, total, daily, tasks, extra) {
  return Object.assign({ id: id, type: 'numbered', name: id, unitName: '강', total: total, daily: daily, tasks: tasks || [] }, extra || {});
}
function makePlan(subjects, start, end) {
  return { id: 'p', name: 't', start: start || '2026-12-20', end: end || '2027-02-28', restDays: [], days: {}, carry: {}, subjects: subjects };
}
var D1 = '2026-12-20', D2 = '2026-12-21', D3 = '2026-12-22', D4 = '2026-12-23', D5 = '2026-12-24';

// 그날 화면에 나오는 항목을 "강번호:세부할일번호" 로 보기 쉽게
function shownOf(plan, today, date, sid) {
  var day = L.dayOf(plan, today, date);
  return day.shown[sid].map(function (id) { var p = id.split('|'); return (+p[1] + 1) + ':' + p[2]; });
}
// 단위 번호(1부터)만
function unitsShown(plan, today, date, sid) {
  var seen = [];
  shownOf(plan, today, date, sid).forEach(function (x) { var u = +x.split(':')[0]; if (seen.indexOf(u) < 0) seen.push(u); });
  return seen;
}
function check(plan, date, sid, unit, task) { L.setCheck(plan, date, L.itemId(sid, unit - 1, task || 0), true); }
function checkAll(plan, today, date) {
  var day = L.dayOf(plan, today, date);
  day.items.forEach(function (id) { L.setCheck(plan, date, id, true); });
}

console.log('\n밀림 계산 테스트\n');

test('1. 하루 3강, 1~3강 중 2·3강 못 함 → 다음 날 2·3·4강', function () {
  var p = makePlan([subj('math', 30, 3)]);
  eq(unitsShown(p, D1, D1, 'math'), [1, 2, 3], '첫날');
  check(p, D1, 'math', 1);
  L.closeDay(p, D1, D1);
  eq(L.dayOf(p, D2, D1).status, 'missed', '첫날 상태');
  eq(unitsShown(p, D2, D2, 'math'), [2, 3, 4], '다음 날');
  // 이후 진도도 하나씩 밀림: 다음 날 다 하면 그다음 날은 5·6·7강
  checkAll(p, D2, D2); L.closeDay(p, D2, D2);
  eq(unitsShown(p, D3, D3, 'math'), [5, 6, 7], '그다음 날');
});

test('2. 2강 강의는 들었지만 복습만 못 함 → 다음 날 2강 복습만 + 이어서 다음 강', function () {
  var p = makePlan([subj('kor', 40, 2, ['강의 듣기', '복습'])]);
  eq(shownOf(p, D1, D1, 'kor'), ['1:0', '1:1', '2:0', '2:1'], '첫날');
  check(p, D1, 'kor', 1, 0); check(p, D1, 'kor', 1, 1); check(p, D1, 'kor', 2, 0); // 2강 복습만 못 함
  L.closeDay(p, D1, D1);
  eq(shownOf(p, D2, D2, 'kor'), ['2:1', '3:0', '3:1'], '다음 날 (2강 복습 → 3강)');
  // 인강을 아예 못 들었으면 복습도 같이 밀림
  check(p, D2, 'kor', 2, 1); L.closeDay(p, D2, D2); // 3강은 전부 못 함
  eq(shownOf(p, D3, D3, 'kor'), ['3:0', '3:1', '4:0', '4:1'], '3강 강의+복습 같이 밀림');
});

test('3. 영어만 못 했을 때 다른 과목 진도는 그대로', function () {
  var p = makePlan([subj('kor', 40, 2, ['강의 듣기', '복습']), subj('eng', 30, 1, ['강의 듣기', '복습']), subj('voca', 40, 1)]);
  var day = L.dayOf(p, D1, D1);
  day.items.forEach(function (id) { if (id.indexOf('eng|') !== 0) L.setCheck(p, D1, id, true); });
  L.closeDay(p, D1, D1);
  eq(unitsShown(p, D2, D2, 'kor'), [3, 4], '국어');
  eq(unitsShown(p, D2, D2, 'voca'), [2], '영단어');
  eq(unitsShown(p, D2, D2, 'eng'), [1], '영어만 밀림');
});

test('4. 3일 동안 안 열었다가 열면 → 3일이 못 한 날로 마감되고 진도가 맞게 밀림', function () {
  var p = makePlan([subj('kor', 40, 2), subj('voca', 40, 1)]);
  check(p, D1, 'kor', 1); // 첫날 1강만 체크하고 마감 안 함, 그 뒤로 앱을 안 엶
  var n = L.autoClose(p, D4); // 4일째에 앱을 엶
  eq(n, 3, '자동 마감된 날 수');
  [D1, D2, D3].forEach(function (d) {
    eq(!!p.days[d].closed, true, d + ' 마감됨');
    eq(L.dayOf(p, D4, d).status, 'missed', d + ' 빨간 X');
  });
  eq(unitsShown(p, D4, D1, 'kor'), [1, 2], '첫날 기록');
  eq(unitsShown(p, D4, D2, 'kor'), [2, 3], '둘째 날 기록');
  eq(unitsShown(p, D4, D4, 'kor'), [2, 3], '오늘 국어');
  eq(unitsShown(p, D4, D4, 'voca'), [1], '오늘 영단어');
  eq(L.dayOf(p, D4, D4).status, 'open', '오늘은 아직 진행 중');
});

test('5. 기간 중간에 하루 분량을 3에서 2로 바꾸면 이후 계획이 맞게 다시 계산됨', function () {
  var p = makePlan([subj('math', 30, 3)]);
  checkAll(p, D1, D1); L.closeDay(p, D1, D1); // 1~3강 완료
  p.subjects[0].daily = 2;                       // 둘째 날 분량 변경
  eq(unitsShown(p, D2, D1, 'math'), [1, 2, 3], '지난 날 기록은 그대로');
  eq(L.dayOf(p, D2, D1).status, 'done', '지난 날 상태 그대로');
  eq(unitsShown(p, D2, D2, 'math'), [4, 5], '오늘부터 2강씩');
  eq(unitsShown(p, D2, D4, 'math'), [8, 9], '미래 예상도 다시 계산');
});

test('6. 쉬는 날에는 할 일이 없고 진도가 멈춤', function () {
  var p = makePlan([subj('kor', 40, 2), subj('eng', 30, 1)]);
  p.restDays = [D2];
  checkAll(p, D1, D1); L.closeDay(p, D1, D1);
  eq(L.dayOf(p, D2, D2).items, [], '쉬는 날 할 일 없음');
  eq(L.dayOf(p, D2, D2).status, 'rest', '쉬는 날 상태');
  L.autoClose(p, D3);
  eq(L.dayOf(p, D3, D2).status, 'rest', '지나도 빨간 X 아님');
  eq(unitsShown(p, D3, D3, 'kor'), [3, 4], '국어 진도 멈췄다가 이어짐');
  eq(unitsShown(p, D3, D3, 'eng'), [2], '영어 진도 멈췄다가 이어짐');
});

var csvText = fs.readFileSync(path.join(__dirname, 'math_curriculum.csv'), 'utf8');

test('(CSV) math_curriculum.csv 읽기와 체크 항목 만들기', function () {
  var res = L.rowsFromCSV(csvText);
  eq(res.rows.length, 134, '일차 수');
  eq(res.errors, [], '오류 없음');
  eq(res.rows[0].title, '수학1 · 지수함수와 로그함수 · 개념때려잡기', '1일차 제목');
  eq(res.rows[0].items, ['01강 강의 듣기', '01강 1차 복습', '02강 강의 듣기', '02강 1차 복습', '03강 강의 듣기', '03강 1차 복습'], '강의 듣고 1차 복습');
  eq(res.rows[8].items, ['2차 복습 01강-05강'], '2차 복습은 1개');
  eq(res.rows[21].items, ['문제풀이 Step 1 [1/2]'], '문제풀이는 1개');
  eq(res.rows[29].items, ['취집공 3차 복습 1단원 취집공'], '취집공 3차 복습은 1개');
  eq(res.rows[37].items, ['취집공 4차 복습 1단원 취집공'], '취집공 4차 복습은 1개');
  // 따옴표, 줄바꿈(CRLF) 처리
  var r2 = L.rowsFromCSV('일차,과목,단원,교재,학습방법,진도\r\n1,수학2,"미분, 적분",기출끝,문제풀이,Step 1\r\n');
  eq(r2.rows[0].title, '수학2 · 미분, 적분 · 기출끝', '쉼표가 든 칸');
  eq(L.rowsFromCSV('a,b\n1,2').errors.length, 1, '열 이름이 틀리면 알려 줌');
});

function mathPlan(mode) {
  var rows = L.rowsFromCSV(csvText).rows;
  return makePlan([{ id: 'math', type: 'table', name: '수학', rows: rows, daily: 1, mode: mode }]);
}

test('7-A. CSV 과목, 1일차 일부를 못 함 → (기본) 남은 항목이 1일차 자리를 차지', function () {
  var p = mathPlan('A');
  eq(shownOf(p, D1, D1, 'math').length, 6, '1일차 체크 6개');
  // 01강·02강은 다 하고, 03강 강의는 듣고 03강 1차 복습만 못 함
  [0, 1, 2, 3, 4].forEach(function (k) { check(p, D1, 'math', 1, k); });
  L.closeDay(p, D1, D1);
  eq(shownOf(p, D2, D2, 'math'), ['1:5'], '다음 날은 1일차 남은 항목(03강 1차 복습)만');
  checkAll(p, D2, D2); L.closeDay(p, D2, D2);
  eq(unitsShown(p, D3, D3, 'math'), [2], '그다음 날 원래 2일차');
});

test('7-B. CSV 과목, 1일차 일부를 못 함 → 남은 항목 + 원래 다음 일차를 같이', function () {
  var p = mathPlan('B');
  [0, 1, 2, 3, 4].forEach(function (k) { check(p, D1, 'math', 1, k); });
  L.closeDay(p, D1, D1);
  eq(shownOf(p, D2, D2, 'math'), ['1:5', '2:0', '2:1', '2:2', '2:3'], '1일차 남은 항목 + 2일차(04강·05강)');
  checkAll(p, D2, D2); L.closeDay(p, D2, D2);
  eq(unitsShown(p, D3, D3, 'math'), [3], '그다음 날 원래 3일차');
});

test('8. 마감한 날의 체크를 고쳤을 때 이후 계획이 다시 계산됨', function () {
  var p = makePlan([subj('kor', 40, 2)]);
  check(p, D1, 'kor', 1); L.closeDay(p, D1, D1); // 2강을 실수로 안 체크
  eq(unitsShown(p, D2, D2, 'kor'), [2, 3], '고치기 전');
  check(p, D1, 'kor', 2);                          // 마감한 날 고치기
  eq(L.dayOf(p, D2, D1).status, 'done', '고친 날은 초록 체크');
  eq(unitsShown(p, D2, D2, 'kor'), [3, 4], '고친 뒤 오늘 계획');
  eq(unitsShown(p, D2, D3, 'kor'), [5, 6], '고친 뒤 미래 예상');
  L.setCheck(p, D1, L.itemId('kor', 0, 0), false); // 반대로 체크 해제
  eq(L.dayOf(p, D2, D1).status, 'missed', '해제하면 빨간 X');
  eq(unitsShown(p, D2, D2, 'kor'), [1, 3], '1강이 다시 맨 앞에');
});

test('(예상) 종료일까지 몇 강 예정인지, 며칠 초과되는지', function () {
  // 12/20~12/29 (10일), 30강을 하루 2강 → 종료일까지 20강, 10강 초과, 5일 더 필요
  var p = makePlan([subj('kor', 30, 2), subj('voca', 5, 1)], D1, '2026-12-29');
  var f = L.forecast(p, D1);
  eq([f[0].doneNow, f[0].byEnd, f[0].total, f[0].overUnits], [0, 20, 30, 10], '국어');
  eq(f[0].finishDate, '2027-01-03', '국어 예상 완료일');
  eq(f[0].overDays, 5, '국어 초과 일수');
  eq([f[1].byEnd, f[1].finishDate, f[1].spareDays], [5, '2026-12-24', 5], '영단어는 5일 여유');
  // 첫날을 통째로 못 하면 하루씩 밀림
  L.autoClose(p, D2);
  var g = L.forecast(p, D2);
  eq([g[0].byEnd, g[0].finishDate], [18, '2027-01-04'], '하루 밀린 뒤 국어');
  eq(g[1].finishDate, '2026-12-25', '하루 밀린 뒤 영단어');
});

function per(from, to, wk, we) { return { from: from, to: to, days: [we, wk, wk, wk, wk, wk, we] }; } // 평일 wk, 토·일 we

test('(분량) 기간별 하루 분량: 11/16~12/26 하루 1강, 12/27~ 하루 3강', function () {
  var p = makePlan([subj('kor', 40, 9, [], { periods: [per('2026-11-16', '2026-12-26', 1, 1), per('2026-12-27', '2027-02-28', 3, 3)] })], '2026-12-25', '2027-02-28');
  eq(L.quotaFor(p, p.subjects[0], '2026-12-26'), 1, '12/26');
  eq(L.quotaFor(p, p.subjects[0], '2026-12-27'), 3, '12/27');
  checkAll(p, '2026-12-25', '2026-12-25'); L.closeDay(p, '2026-12-25', '2026-12-25');
  eq(unitsShown(p, '2026-12-26', '2026-12-26', 'kor'), [2], '12/26은 1강');
  eq(unitsShown(p, '2026-12-26', '2026-12-27', 'kor'), [3, 4, 5], '12/27부터 3강 (예상)');
});

test('(분량) 요일별 분량: 평일 1강, 토·일 3강', function () {
  // 2026-12-25 금, 26 토, 27 일, 28 월
  var p = makePlan([subj('kor', 40, 9, [], { periods: [per('2026-12-01', '2027-02-28', 1, 3)] })], '2026-12-25');
  eq(unitsShown(p, '2026-12-25', '2026-12-25', 'kor'), [1], '금');
  eq(unitsShown(p, '2026-12-25', '2026-12-26', 'kor'), [2, 3, 4], '토');
  eq(unitsShown(p, '2026-12-25', '2026-12-27', 'kor'), [5, 6, 7], '일');
  eq(unitsShown(p, '2026-12-25', '2026-12-28', 'kor'), [8], '월');
});

test('(분량) 기간 규칙이 없는 날은 기본 분량', function () {
  var p = makePlan([subj('kor', 40, 2, [], { periods: [per('2027-01-01', '2027-01-31', 3, 3)] })]);
  eq(L.quotaFor(p, p.subjects[0], '2026-12-31'), 2);
  eq(L.quotaFor(p, p.subjects[0], '2027-01-01'), 3);
  eq(L.quotaFor(p, p.subjects[0], '2027-02-01'), 2);
});

test('(쉬는 날) 매주 일요일 쉬기 + 날짜 지정, 진도가 멈췄다가 이어짐', function () {
  var p = makePlan([subj('kor', 40, 2)], '2026-12-25');
  p.restWeekdays = [0];          // 일요일(12/27)
  p.restDays = ['2026-12-28'];   // 월요일
  checkAll(p, '2026-12-25', '2026-12-25'); L.closeDay(p, '2026-12-25', '2026-12-25');
  eq(L.dayOf(p, '2026-12-26', '2026-12-27').status, 'rest', '일요일 쉬는 날');
  eq(L.dayOf(p, '2026-12-26', '2026-12-28').items, [], '지정한 날 할 일 없음');
  eq(unitsShown(p, '2026-12-26', '2026-12-26', 'kor'), [3, 4], '토요일');
  eq(unitsShown(p, '2026-12-26', '2026-12-29', 'kor'), [5, 6], '화요일에 이어서');
});

test('(쉬는 날) 지난 날은 나중에 쉬는 날 설정을 바꿔도 기록이 그대로', function () {
  var p = makePlan([subj('kor', 40, 2)]);
  L.autoClose(p, D2); // D1 못 함
  p.restDays = [D1];
  eq(L.dayOf(p, D2, D1).status, 'missed', '마감된 날은 그대로 빨간 X');
});

test('(분량) 기간 분량을 바꾸면 지난 날은 그대로, 오늘부터 다시 계산', function () {
  var p = makePlan([subj('math', 30, 3, [], { periods: [per(D1, '2027-02-28', 3, 3)] })]);
  checkAll(p, D1, D1); L.closeDay(p, D1, D1);
  p.subjects[0].periods[0].days = [2, 2, 2, 2, 2, 2, 2];
  eq(unitsShown(p, D2, D1, 'math'), [1, 2, 3], '지난 날');
  eq(unitsShown(p, D2, D2, 'math'), [4, 5], '오늘');
});

test('(예상) 종료일 뒤 예상은 마지막 기간 규칙을 이어서 씀', function () {
  var p = makePlan([subj('kor', 30, 9, [], { periods: [per(D1, '2026-12-29', 2, 2)] })], D1, '2026-12-29');
  var f = L.forecast(p, D1);
  eq([f[0].byEnd, f[0].finishDate], [20, '2027-01-03']);
});

test('(통계) 달성률, 연속으로 다 해낸 날, 과목별 밀린 양', function () {
  var p = makePlan([subj('kor', 40, 2), subj('eng', 30, 1)]);
  p.restDays = [D3];
  checkAll(p, D1, D1); L.closeDay(p, D1, D1);                 // D1 다 함
  checkAll(p, D2, D2); L.closeDay(p, D2, D2);                 // D2 다 함
  // D3 쉬는 날 (연속 기록을 끊지 않음)
  L.autoClose(p, D4);
  var day4 = L.dayOf(p, D4, D4);                              // D4 영어만 못 함
  day4.items.forEach(function (id) { if (id.indexOf('eng|') !== 0) L.setCheck(p, D4, id, true); });
  L.closeDay(p, D4, D4);
  var st = L.stats(p, D5);
  eq([st.days, st.perfectDays, st.items, st.doneItems], [3, 2, 9, 8], '전체');
  eq([st.streak, st.bestStreak], [0, 2], '연속 기록');
  eq([st.subjects[0].missedDays, st.subjects[0].rate], [0, 1], '국어');
  eq([st.subjects[1].missedDays, st.subjects[1].missedItems, st.subjects[1].backlog], [1, 1, 1], '영어 (오늘 밀려 있는 1개)');
  checkAll(p, D5, D5); L.closeDay(p, D5, D5);
  eq(L.stats(p, '2026-12-25').streak, 1, '다시 연속 1일');
});

test('(새 계획) 진도 이어받기 / 처음부터', function () {
  var old = makePlan([subj('kor', 40, 2, ['강의 듣기', '복습']), subj('voca', 40, 1)]);
  checkAll(old, D1, D1); L.closeDay(old, D1, D1);             // 국어 1·2강, 영단어 Day 1
  L.setCheck(old, D2, L.itemId('kor', 2, 0), true);           // 오늘 국어 3강 강의만
  var np = L.newPlanFrom(old, D2, { id: 'n', name: '봄', start: D2, end: '2027-03-31',
    subjects: [{ id: 'kor', keep: true, carry: true }, { id: 'voca', keep: true, carry: false }] });
  eq(np.subjects.length, 2);
  eq(shownOf(np, D2, D2, 'kor'), ['3:1', '4:0', '4:1'], '국어 이어받기: 3강 복습부터');
  var vid = np.subjects[1].id;
  eq(unitsShown(np, D2, D2, vid), [1], '영단어는 처음부터');
  var np2 = L.newPlanFrom(old, D2, { id: 'n2', name: 'x', start: D2, end: '2027-03-31', subjects: [{ id: 'kor', keep: false }] });
  eq(np2.subjects.length, 0, '안 가져간 과목은 빠짐');
});

test('(계획 바꾸기) 다른 계획을 쓰는 동안은 일시정지, 돌아오면 멈춘 곳부터', function () {
  var win = makePlan([subj('kor', 40, 2)]);
  var sem = makePlan([subj('eng', 30, 1)]); sem.id = 'sem';
  checkAll(win, D1, D1); L.closeDay(win, D1, D1);             // 겨울 계획 D1: 1·2강
  L.switchPlan(win, sem, D2);                                 // D2에 학기 계획으로
  checkAll(sem, D2, D2); L.closeDay(sem, D2, D2);
  L.switchPlan(sem, win, D5);                                 // D5에 다시 겨울 계획으로
  L.autoClose(win, D5);
  [D2, D3, D4].forEach(function (d) { eq(L.dayOf(win, D5, d).status, 'paused', d + ' 일시정지'); });
  eq(unitsShown(win, D5, D5, 'kor'), [3, 4], '멈춘 곳부터 이어짐');
  eq([L.stats(win, D5).days, L.stats(win, D5).streak], [1, 1], '통계에서 일시정지 날은 빠짐');
  eq(unitsShown(sem, D5, D5, 'eng') === undefined, false);
  eq(L.isPaused(sem, D5), true, '학기 계획은 이제 일시정지');
});

test('(계획 바꾸기) 같은 날 바꿨다가 돌아오면 일시정지 기록이 남지 않음', function () {
  var a = makePlan([subj('kor', 40, 2)]), b = makePlan([subj('eng', 30, 1)]);
  L.switchPlan(a, b, D2); L.switchPlan(b, a, D2);
  eq(a.pauses, [], 'a');
  eq(b.pauses.length, 1, 'b는 다시 정지 중');
});

test('(새 계획) 학기용: 평일·주말 분량을 따로 정해서 만들기', function () {
  var old = makePlan([subj('kor', 40, 2)]);
  var np = L.newPlanFrom(old, D1, { id: 'n', name: '1학기', start: D1, end: '2027-07-20',
    subjects: [{ id: 'kor', keep: true, carry: false, wk: 0, we: 3 }] });
  var sid = np.subjects[0].id;
  eq(L.quotaFor(np, np.subjects[0], '2026-12-21'), 0, '월요일 0');
  eq(L.quotaFor(np, np.subjects[0], '2026-12-26'), 3, '토요일 3');
  eq(unitsShown(np, D1, D1, sid), [1, 2, 3], '12/20(일)은 3강');
});

/* ===== 요일별 과목 · 간격 복습 (요일이 맞는 2025년 12월 날짜 사용: 12/1 월요일) ===== */
var MON = '2025-12-01', TUE = '2025-12-02', WED = '2025-12-03', THU = '2025-12-04', FRI = '2025-12-05', SAT = '2025-12-06', SUN = '2025-12-07', MON2 = '2025-12-08';
function wk(str) { return [0, 1, 2, 3, 4, 5, 6].map(function (i) { return str.indexOf('일월화수목금토'[i]) >= 0; }); }

test('[새 1] 월요일 국어를 못 하면 수요일 국어에 그 진도가 나오고, 화요일에는 국어가 안 나옴', function () {
  var p = makePlan([subj('kor', 40, 2, ['강의 듣기', '복습'], { weekdays: wk('월수목토') })], MON, '2026-02-28');
  eq(unitsShown(p, MON, MON, 'kor'), [1, 2], '월');
  L.autoClose(p, TUE);                               // 월요일 못 함
  eq(L.dayOf(p, TUE, TUE).shown.kor, [], '화요일에는 국어 없음');
  L.autoClose(p, WED);
  eq(unitsShown(p, WED, WED, 'kor'), [1, 2], '수요일에 월요일 진도');
  checkAll(p, WED, WED); L.closeDay(p, WED, WED);
  eq(unitsShown(p, THU, THU, 'kor'), [3, 4], '목요일은 다음 진도');
});

test('[새 2] 일요일 당겨오기 후 그 과목의 다음 차례 진도가 맞게 이어짐', function () {
  var p = makePlan([subj('kor', 40, 2, [], { weekdays: wk('월수목토') }), subj('his', 30, 2, [], { weekdays: wk('일') })], MON, '2026-02-28');
  checkAll(p, MON, MON); L.closeDay(p, MON, MON);    // 월: 1·2강
  L.autoClose(p, SAT);                               // 수·목·금 못 함 → 3·4강 밀림
  checkAll(p, SAT, SAT); L.closeDay(p, SAT, SAT);    // 토: 3·4강
  var sun = L.dayOf(p, SUN, SUN);
  eq(sun.shown.kor, [], '일요일엔 원래 국어 없음');
  L.setCheck(p, SAT, L.itemId('kor', 3, 0), false);  // (토요일 4강을 사실 못 했다고 고침 → 밀린 과목)
  eq(L.dayOf(p, SUN, SUN).behind.kor, 1, '일요일 밀린 과목: 국어 1개');
  eq(L.nextDoDay(p, p.subjects[0], SUN), { date: MON2, n: 2 }, '다음 차례는 월요일 2강');
  L.pull(p, SUN, 'kor');
  eq(unitsShown(p, SUN, SUN, 'kor'), [4, 5], '당겨오기: 다음 차례(4·5강)가 오늘로');
  checkAll(p, SUN, SUN); L.closeDay(p, SUN, SUN);
  eq(unitsShown(p, MON2, MON2, 'kor'), [6, 7], '월요일은 원래 다음 진도(6·7강)부터');
  eq(unitsShown(p, MON2, SUN, 'his'), [1, 2], '한국사는 그대로');
});

test('[새 1-1] 당겨오기 취소', function () {
  var p = makePlan([subj('kor', 40, 2, [], { weekdays: wk('월') })], MON, '2026-02-28');
  L.pull(p, TUE, 'kor');
  eq(unitsShown(p, TUE, TUE, 'kor'), [1, 2]);
  L.unpull(p, TUE, 'kor');
  eq(L.dayOf(p, TUE, TUE).shown.kor, []);
});

/* ===== B단계: 간격 복습 ===== */
function revs(p, today, date) { return L.dayOf(p, today, date).reviews; }
function has(list, id) { return list.indexOf(id) >= 0; }
function korSub(extra) { return subj('kor', 40, 1, [], Object.assign({ weekdays: wk('월수목토'), spaced: [3, 7], skim: true, weekly: true }, extra || {})); }
function carryUnits(p, sid, n, tasks) { for (var u = 0; u < n; u++) for (var k = 0; k < (tasks || 1); k++) p.carry[L.itemId(sid, u, k)] = true; }

test('[새 3] 국어 5강을 12/1(월)에 완료 → 12/4, 12/8에 복습', function () {
  var p = makePlan([korSub()], MON, '2026-02-28');
  carryUnits(p, 'kor', 4);                           // 1~4강은 이미 끝낸 상태
  eq(unitsShown(p, MON, MON, 'kor'), [5]);
  checkAll(p, MON, MON); L.closeDay(p, MON, MON);
  eq(has(revs(p, WED, WED), 'R|kor|4|3'), false, '12/3엔 아직 없음');
  eq(has(revs(p, THU, THU), 'R|kor|4|3'), true, '12/4 (3일 뒤)');
  eq(has(revs(p, '2025-12-07', '2025-12-07'), 'R|kor|4|7'), false, '12/7엔 7일 복습 없음');
  eq(has(revs(p, MON2, MON2), 'R|kor|4|7'), true, '12/8 (7일 뒤)');
  eq(L.reviewInfo(L.simulate(p, MON, MON).subs, 'R|kor|4|3').title, 'kor 5강 복습 (3일 뒤)', '표시 이름');
});

function fivePlan(five) {
  var rows = L.rowsFromCSV(csvText).rows;
  return makePlan([{ id: 'math', type: 'table', name: '수학', rows: rows, daily: 1, mode: 'A', fiveStep: five }], MON, '2026-06-30');
}
test('[새 4] 5단계: 강의 일차를 12/1에 완료 → 12/15, 12/29, 1/12, 1/26에 2~5차 복습', function () {
  var p = fivePlan(true);
  checkAll(p, MON, MON); L.closeDay(p, MON, MON);
  [['2025-12-15', 2], ['2025-12-29', 3], ['2026-01-12', 4], ['2026-01-26', 5]].forEach(function (x) {
    var id = 'F|math|0|' + x[1];
    eq(has(revs(p, L.addDays(x[0], -1), L.addDays(x[0], -1)), id), false, x[1] + '차 하루 전엔 없음');
    eq(has(revs(p, x[0], x[0]), id), true, x[1] + '차 ' + x[0]);
  });
  eq(L.reviewInfo(L.simulate(p, MON, MON).subs, 'F|math|0|3').title, '수학1 지수함수와 로그함수 01강-03강 · 5단계 복습 3차', '표시 이름');
});

test('[새 5] 5단계: 2차 복습·취집공 3차/4차 복습 일차는 건너뜀 (총 95일차)', function () {
  var p = fivePlan(true);
  var units = L.unitsOf(p.subjects[0]);
  eq(L.progress(units, new Set()).totalUnits, 95, '총 95일차');
  for (var u = 0; u < 8; u++) units[u].items.forEach(function (it) { p.carry[it.id] = true; }); // 1~8일차 끝냄
  eq(unitsShown(p, MON, MON, 'math'), [10], '9일차(2차 복습)를 건너뛰고 10일차');
  var seenRows = [];
  var q = fivePlan(true); q.subjects[0].daily = 200;
  L.dayOf(q, MON, MON).shown.math.forEach(function (id) { var r = +id.split('|')[1]; if (seenRows.indexOf(r) < 0) seenRows.push(r); });
  eq(seenRows.length, 95, '한 번에 다 꺼내도 95일차');
  eq(seenRows.some(function (r) { return L.isFiveSkip(q.subjects[0].rows[r]); }), false, '건너뛸 일차는 하나도 없음');
});

test('[새 6] 5단계: 문제풀이 일차는 진도로 나오지만 5단계 복습은 없음', function () {
  var p = fivePlan(true);
  var units = L.unitsOf(p.subjects[0]);
  for (var u = 0; u < 21; u++) units[u].items.forEach(function (it) { p.carry[it.id] = true; });
  eq(unitsShown(p, MON, MON, 'math'), [22], '22일차 문제풀이');
  checkAll(p, MON, MON); L.closeDay(p, MON, MON);
  var due = L.simulate(p, MON, '2026-03-31').revDue;
  eq(Object.keys(due).filter(function (k) { return k.indexOf('F|math|21|') === 0; }), [], '문제풀이 복습 없음');
});

test('[새 7] 시간표 방식: 134일차 전부 순서대로, 5단계 복습 없음', function () {
  var p = fivePlan(false);
  eq(L.progress(L.unitsOf(p.subjects[0]), new Set()).totalUnits, 134);
  var units = L.unitsOf(p.subjects[0]);
  for (var u = 0; u < 8; u++) units[u].items.forEach(function (it) { p.carry[it.id] = true; });
  eq(unitsShown(p, MON, MON, 'math'), [9], '9일차(2차 복습)도 나옴');
  var q = fivePlan(false);
  checkAll(q, MON, MON); L.closeDay(q, MON, MON);
  eq(Object.keys(L.simulate(q, MON, '2026-03-31').revDue).filter(function (k) { return k[0] === 'F'; }), [], '5단계 복습 없음');
});

test('[새 8] 수학 강의 일차가 하루 밀려 12/2에 완료 → 5단계 복습도 12/16부터', function () {
  var p = fivePlan(true);
  L.closeDay(p, MON, MON);                           // 12/1 못 함
  checkAll(p, TUE, TUE); L.closeDay(p, TUE, TUE);    // 12/2에 1일차 완료
  eq(has(revs(p, '2025-12-15', '2025-12-15'), 'F|math|0|2'), false, '12/15엔 없음');
  eq(has(revs(p, '2025-12-16', '2025-12-16'), 'F|math|0|2'), true, '12/16 2차');
  eq(has(revs(p, '2025-12-30', '2025-12-30'), 'F|math|0|3'), true, '12/30 3차');
});

test('[새 9] 복습을 못 하면 다음 날 밀린 복습으로 남고, 그다음 복습 일정은 그대로', function () {
  var p = makePlan([korSub()], MON, '2026-02-28');
  carryUnits(p, 'kor', 4);
  checkAll(p, MON, MON); L.closeDay(p, MON, MON);    // 5강 완료
  L.autoClose(p, FRI);                               // 12/4 복습 못 함
  eq(L.dayOf(p, FRI, THU).status, 'missed', '12/4는 빨간 X');
  var fri = L.dayOf(p, FRI, FRI);
  eq([has(fri.reviews, 'R|kor|4|3'), has(fri.overdue, 'R|kor|4|3')], [true, true], '12/5에 밀린 복습');
  eq(fri.shown.kor, [], '복습은 새 진도를 밀어내지 않음 (금요일 국어 없음 그대로)');
  L.setCheck(p, FRI, 'R|kor|4|3', true); L.closeDay(p, FRI, FRI);
  eq(has(revs(p, SAT, SAT), 'R|kor|4|3'), false, '하면 사라짐');
  eq(has(revs(p, SAT, MON2), 'R|kor|4|7'), true, '7일 뒤 복습은 원래대로 12/8');
});

test('[새 11] 3일 뒤 복습과 지난번 훑어보기가 같은 날 같은 내용이면 하나로', function () {
  var p = makePlan([subj('eng', 30, 1, [], { weekdays: wk('화수금토'), spaced: [3, 7], skim: true })], SAT, '2026-02-28');
  checkAll(p, SAT, SAT); L.closeDay(p, SAT, SAT);    // 토 12/6: 1강
  var TUE2 = '2025-12-09';
  L.autoClose(p, TUE2);
  var day = L.dayOf(p, TUE2, TUE2);
  eq(day.reviews.sort(), ['R|eng|0|3', 'S|eng|2025-12-09|2025-12-06|0'].sort(), '복습 2개');
  var g = L.groupReviews(L.simulate(p, TUE2, TUE2).subs, day.reviews, TUE2);
  eq(g.length, 1, '하나로 합쳐짐');
  eq(g[0].title, '지난번(토) eng 훑어보기 + 3일 뒤 복습');
  eq(g[0].ids.length, 2, '체크하면 둘 다 완료');
});

test('[새 B-3] 같은 날 끝낸 강들의 같은 간격 복습은 한 줄로', function () {
  var p = makePlan([korSub({ daily: 2, skim: false })], MON, '2026-02-28');
  checkAll(p, MON, MON); L.closeDay(p, MON, MON);    // 1·2강
  var sim = L.simulate(p, THU, THU), day = sim.days[sim.days.length - 1];
  var g = L.groupReviews(sim.subs, day.reviews, THU, sim.revDue);
  eq(g.map(function (e) { return e.title; }), ['kor 1강·2강 복습 (3일 뒤)']);
  eq(g[0].ids, ['R|kor|0|3', 'R|kor|1|3']);
});

test('[새 12] 국어 월요일 강의의 다음 차례 훑어보기는 화요일이 아니라 수요일', function () {
  var p = makePlan([korSub()], MON, '2026-02-28');
  checkAll(p, MON, MON); L.closeDay(p, MON, MON);
  eq(revs(p, TUE, TUE).filter(function (id) { return id[0] === 'S'; }), [], '화요일엔 없음');
  eq(revs(p, WED, WED).filter(function (id) { return id[0] === 'S'; }), ['S|kor|2025-12-03|2025-12-01|0'], '수요일 맨 앞');
  eq(L.groupReviews(L.simulate(p, WED, WED).subs, revs(p, WED, WED), WED)[0].title, '지난번(월) kor 훑어보기');
  L.autoClose(p, THU);
  eq(revs(p, THU, THU).filter(function (id) { return id[0] === 'S'; }).length, 1, '훑어보기는 다음 날로 안 남음 (목요일엔 새 훑어보기 1개만)');
});

test('[새 B-1] 일요일 이번 주 복습: 월~토에 끝낸 강 목록 (수학 제외)', function () {
  var p = makePlan([korSub({ spaced: [] }), subj('math', 30, 1, [], {})], MON, '2026-02-28');
  [MON, WED, THU].forEach(function (d) { checkAll(p, d, d); L.closeDay(p, d, d); });
  L.autoClose(p, SUN);
  var w = revs(p, SUN, SUN).filter(function (id) { return id[0] === 'W'; });
  eq(w, ['W|kor|2025-12-07|0.1.2'], '국어 1·2·3강');
  eq(L.reviewInfo(L.simulate(p, SUN, SUN).subs, w[0]).detail, '1강, 2강, 3강');
});

test('[새 B-2] 쉬는 날에도 복습은 나옴 (새 진도는 멈춤)', function () {
  var p = makePlan([korSub()], MON, '2026-02-28');
  p.restDays = [THU];
  carryUnits(p, 'kor', 4);
  checkAll(p, MON, MON); L.closeDay(p, MON, MON);
  var thu = L.dayOf(p, MON, THU);
  eq([thu.shown.kor, has(thu.reviews, 'R|kor|4|3')], [[], true], '쉬는 날: 새 진도 없음, 복습 있음');
});

/* ===== C단계: 간격 복습형 (영단어) ===== */
function wordSub(extra) { return Object.assign({ id: 'voca', type: 'spaced', name: '영단어', unitName: 'Day', total: 40, daily: 1, words: 50, spaced: [1, 3, 7] }, extra || {}); }

test('[새 10] 영단어 Day 10을 12/20에 외우면 12/21, 12/23, 12/27에 복습', function () {
  var D20 = '2025-12-20';
  var p = makePlan([wordSub()], D20, '2026-02-28');
  carryUnits(p, 'voca', 9);                          // Day 1~9는 이미 외움
  eq(unitsShown(p, D20, D20, 'voca'), [10], '12/20 새 Day 10');
  checkAll(p, D20, D20); L.closeDay(p, D20, D20);
  var at = function (d) { return L.dayOf(p, D20, d).reviews.filter(function (id) { return id.indexOf('R|voca|9|') === 0; }); };
  eq(at('2025-12-21'), ['R|voca|9|1'], '12/21 (1일 뒤)');
  eq(at('2025-12-22'), [], '12/22 없음');
  eq(at('2025-12-23'), ['R|voca|9|3'], '12/23 (3일 뒤)');
  eq(at('2025-12-27'), ['R|voca|9|7'], '12/27 (7일 뒤)');
  eq(L.reviewInfo(L.simulate(p, D20, D20).subs, 'R|voca|9|1').title, '영단어 Day 10 복습 (1일 뒤)');
});

test('[새 C-1] 새 Day를 못 외우면 다음 날 같은 Day가 다시 나옴', function () {
  var p = makePlan([wordSub()], MON, '2026-02-28');
  L.autoClose(p, TUE);
  eq(unitsShown(p, TUE, TUE, 'voca'), [1], '화요일에 다시 Day 1');
  eq(Object.keys(L.simulate(p, TUE, TUE).revDue), [], '외우지 않았으니 복습도 없음');
});

test('[새 C-2] 쉬는 날에도 영단어는 나오고, 다른 과목은 멈춤', function () {
  var p = makePlan([wordSub(), subj('kor', 40, 2)], MON, '2026-02-28');
  p.restDays = [MON];
  var day = L.dayOf(p, MON, MON);
  eq([day.shown.kor, day.shown.voca.length, day.status], [[], 1, 'open'], '쉬는 날: 국어 없음, 영단어 있음');
});

test('[새 C-3] 복습 간격을 바꾸면 그대로 적용', function () {
  var p = makePlan([wordSub({ spaced: [2, 5] })], MON, '2026-02-28');
  checkAll(p, MON, MON); L.closeDay(p, MON, MON);
  eq(Object.keys(L.simulate(p, MON, MON).revDue).sort(), ['R|voca|0|2', 'R|voca|0|5']);
});

/* ===== D단계: 복습 예상 시간 ===== */
test('[새 D-1] 복습 예상 시간: 기본값과 오늘 총시간', function () {
  var rows = L.rowsFromCSV(csvText).rows;
  var p = makePlan([korSub({ daily: 2 }), wordSub(), { id: 'math', type: 'table', name: '수학', rows: rows, daily: 1, mode: 'A', fiveStep: true }], MON, '2026-06-30');
  checkAll(p, MON, MON); L.closeDay(p, MON, MON);    // 국어 1·2강, 영단어 Day 1, 수학 1일차
  var strip = function (arr) { return arr.map(function (x) { return [x[0], x[1]]; }); };
  var first = function (date) { return strip(mins(date).filter(function (x) { return x[2].indexOf('F|math|0|') === 0; })); };
  var mins = function (date) {
    var sim = L.simulate(p, MON, date), day = sim.days[sim.days.length - 1];
    return L.groupReviews(sim.subs, day.reviews, date, sim.revDue).map(function (e) { return [e.kind, L.reviewMinutes(p, sim.subs, e), e.ids[0]]; });
  };
  eq(strip(mins(TUE)), [['spaced', 15]], '화: 단어 Day 1 복습 15분');
  var wed = mins(WED);
  eq(strip(wed.filter(function (x) { return x[0] === 'skim'; })), [['skim', 10]], '수: 훑어보기 10분');
  eq(strip(mins(THU).filter(function (x) { return x[0] === 'spaced'; })), [['spaced', 30], ['spaced', 15], ['spaced', 15]], '목: 국어 1·2강 3일 복습 30분 + 단어 Day1 3일 복습 15분 + (예상) 단어 Day3 1일 복습 15분');
  eq(first('2025-12-15'), [['five', 25]], '수학 5단계 2차 25분');
  eq(first('2025-12-29'), [['five', 20]], '3차 20분');
  eq(first('2026-01-12'), [['five', 15]], '4차 15분');
  eq(first('2026-01-26'), [['five', 10]], '5차 10분');
  eq(strip(mins(SUN).filter(function (x) { return x[0] === 'weekly'; })), [['weekly', 30]], '이번 주 복습 30분');
  p.revMin = { skim: 5, five: [40] };                // 설정에서 바꾸면
  eq(strip(mins(WED).filter(function (x) { return x[0] === 'skim'; })), [['skim', 5]], '훑어보기 5분으로');
  eq(first('2025-12-15'), [['five', 40]], '5단계 2차 40분으로');
  p.subjects[0].weeklyMin = 45;
  eq(strip(mins(SUN).filter(function (x) { return x[0] === 'weekly'; })), [['weekly', 45]], '과목별 주간 복습 시간');
});

test('[새 D-2] 하루 상태는 새 진도와 복습을 모두 포함', function () {
  var p = makePlan([wordSub()], MON, '2026-02-28');
  checkAll(p, MON, MON); L.closeDay(p, MON, MON);
  var tue = L.dayOf(p, TUE, TUE);
  tue.shown.voca.forEach(function (id) { L.setCheck(p, TUE, id, true); });   // 새 Day만 하고 복습은 안 함
  L.closeDay(p, TUE, TUE);
  eq(L.dayOf(p, WED, TUE).status, 'missed', '복습을 안 하면 빨간 X');
  L.setCheck(p, TUE, 'R|voca|0|1', true);
  eq(L.dayOf(p, WED, TUE).status, 'done', '복습까지 하면 초록 체크');
});

test('[새 계획] 요일·복습·5단계·간격 복습형·복습 시간 설정이 새 계획에도 그대로', function () {
  var rows = L.rowsFromCSV(csvText).rows;
  var old = makePlan([korSub({ weeklyMin: 40 }), wordSub(), { id: 'math', type: 'table', name: '수학', rows: rows, daily: 1, mode: 'A', fiveStep: true }], MON, '2026-02-28');
  old.revMin = { skim: 5 }; old.restWeekdays = [0];
  checkAll(old, MON, MON); L.closeDay(old, MON, MON);
  var np = L.newPlanFrom(old, TUE, { id: 'n', name: '1학기', start: TUE, end: '2026-07-20', subjects: [
    { id: 'kor', keep: true, carry: true, wk: 1, we: 1 }, { id: 'voca', keep: true, carry: true, wk: 1, we: 1 }, { id: 'math', keep: true, carry: false, wk: 1, we: 1 }] });
  var k = np.subjects[0], v = np.subjects[1], m = np.subjects[2];
  eq([k.weekdays, k.spaced, k.skim, k.weekly, k.weeklyMin], [wk('월수목토'), [3, 7], true, true, 40], '국어 요일·복습');
  eq([v.type, v.spaced, v.words], ['spaced', [1, 3, 7], 50], '영단어 간격 복습형');
  eq([m.fiveStep, L.progress(L.unitsOf(m), new Set()).totalUnits], [true, 95], '수학 5단계');
  eq([np.revMin, np.restWeekdays], [{ skim: 5 }, [0]], '복습 시간·매주 쉬는 요일');
  // 새 계획에서도 복습이 그대로 동작
  checkAll(np, WED, WED); L.closeDay(np, WED, WED);           // 수: 국어 2강(이어받기), 영단어 Day 2, 수학 1일차(처음부터)
  var sat = L.dayOf(np, WED, SAT).reviews;
  eq(has(sat, 'R|kor|1|3'), true, '국어 3일 복습');
  eq(L.dayOf(np, WED, THU).reviews.indexOf('R|voca|1|1') >= 0, true, '영단어 1일 복습');
  eq(has(L.dayOf(np, WED, '2025-12-17').reviews, 'F|' + m.id + '|0|2'), true, '수학 5단계 2차');
});

/* ===== 순공시간 타이머 ===== */
function at(y, m, d, h, mi) { return new Date(y, m - 1, d, h, mi || 0).getTime(); }   // 기기 시간대 기준
test('[타이머] 시작→멈춤하면 그날 순공시간에 더해지고, 여러 번 재면 합쳐짐', function () {
  var st = { running: null, days: {} };
  L.startTimer(st, at(2025, 12, 1, 9));
  eq(L.studySeconds(st, '2025-12-01', at(2025, 12, 1, 9, 30)), 1800, '돌아가는 중에도 30분');
  L.stopTimer(st, at(2025, 12, 1, 10, 15));
  L.startTimer(st, at(2025, 12, 1, 14));
  L.stopTimer(st, at(2025, 12, 1, 15));
  eq(st.days, { '2025-12-01': 8100 }, '1시간 15분 + 1시간 = 2시간 15분');
  eq(st.running, null, '멈춘 상태');
  eq(L.studySeconds(st, '2025-12-02', at(2025, 12, 2, 8)), 0, '다음 날은 0부터');
});
test('[타이머] 밤 12시를 넘기면 날짜별로 나눠서 기록', function () {
  var st = { running: null, days: {} };
  L.startTimer(st, at(2025, 12, 1, 23));
  eq(L.studySeconds(st, '2025-12-02', at(2025, 12, 2, 0, 30)), 1800, '진행 중: 새 날짜엔 30분');
  L.stopTimer(st, at(2025, 12, 2, 1));
  eq(st.days, { '2025-12-01': 3600, '2025-12-02': 3600 });
});
test('[타이머] 화면이 꺼져 있던 시간도 정확 (시작 시각 기준)', function () {
  var st = { running: null, days: {} };
  L.startTimer(st, at(2025, 12, 1, 9));
  L.startTimer(st, at(2025, 12, 1, 9, 10));                 // 이미 돌아가면 시작 시각 그대로
  L.stopTimer(st, at(2025, 12, 1, 12));
  eq(st.days['2025-12-01'], 10800, '3시간');
});
test('[타이머] 테스트 모드: 정한 날짜에 모두 기록', function () {
  var st = { running: null, days: {} };
  L.startTimer(st, at(2025, 12, 1, 23));
  L.stopTimer(st, at(2025, 12, 2, 1), '2026-11-20');
  eq(st.days, { '2026-11-20': 7200 });
});

/* ===== 🏃 만회 ===== */
function catchUnits(p, today, date, sid) {
  var c = (L.dayOf(p, today, date).catchup || {})[sid] || [], out = [];
  c.forEach(function (id) { var u = +id.split('|')[1] + 1; if (out.indexOf(u) < 0) out.push(u); });
  return out;
}
test('[만회 1] 1강만 들은 다음 날 2·3강을 다 들으면 만회로 4강이 나옴', function () {
  var p = makePlan([subj('math', 30, 2)]);
  check(p, D1, 'math', 1); L.closeDay(p, D1, D1);              // 1일차: 1강만
  eq(unitsShown(p, D2, D2, 'math'), [2, 3], '2일차: 2·3강');
  eq(catchUnits(p, D2, D2, 'math'), [], '다 하기 전에는 만회 없음');
  check(p, D2, 'math', 2);
  eq(catchUnits(p, D2, D2, 'math'), [], '하나만 해도 아직 없음');
  check(p, D2, 'math', 3);
  eq(catchUnits(p, D2, D2, 'math'), [4], '2·3강을 다 하면 4강 만회');
  eq(L.dayOf(p, D2, D2).gap.math, 1, '원래 계획까지 1강');
});
test('[만회 2] 만회까지 하면 다음 날 원래 계획대로 / 안 하면 기존처럼', function () {
  var p = makePlan([subj('math', 30, 2)]);
  check(p, D1, 'math', 1); L.closeDay(p, D1, D1);
  check(p, D2, 'math', 2); check(p, D2, 'math', 3);
  var q = JSON.parse(JSON.stringify(p));
  check(p, D2, 'math', 4);                                      // 만회까지 함
  eq(catchUnits(p, D2, D2, 'math'), [4], '한 만회는 그대로 보임 (더 이상 새 만회는 없음)');
  eq(L.dayOf(p, D2, D2).gap.math, 0, '원래 계획 따라잡음');
  L.closeDay(p, D2, D2);
  eq(L.dayOf(p, D3, D2).status, 'done', '2일차 초록 체크');
  eq(unitsShown(p, D3, D3, 'math'), [5, 6], '3일차: 원래 계획대로 5·6강');
  L.closeDay(q, D2, D2);                                        // 만회 안 함
  eq(L.dayOf(q, D3, D2).status, 'done', '만회는 선택: 안 해도 초록 체크');
  eq(unitsShown(q, D3, D3, 'math'), [4, 5], '안 하면 기존처럼 4·5강');
});
test('[만회 3] 여러 날 밀렸으면 1강씩 차례로, 원래 위치(계획 시작부터 매일 분량)까지', function () {
  var p = makePlan([subj('math', 30, 2)]);
  check(p, D1, 'math', 1); L.closeDay(p, D1, D1);              // 1일차 1강만
  L.closeDay(p, D2, D2);                                        // 2일차 못 함
  checkAll(p, D3, D3);                                          // 3일차 2·3강
  eq(L.dayOf(p, D3, D3).gap.math, 3, '원래 6강까지 → 3강 뒤처짐');
  eq(catchUnits(p, D3, D3, 'math'), [4], '먼저 4강만');
  check(p, D3, 'math', 4); eq(catchUnits(p, D3, D3, 'math'), [4, 5], '4강 하면 5강');
  check(p, D3, 'math', 5); eq(catchUnits(p, D3, D3, 'math'), [4, 5, 6], '5강 하면 6강');
  check(p, D3, 'math', 6); eq(catchUnits(p, D3, D3, 'math'), [4, 5, 6], '원래 위치 도착 → 더 안 나옴');
  L.closeDay(p, D3, D3);
  eq(unitsShown(p, D4, D4, 'math'), [7, 8], '4일차 원래 계획대로');
});
test('[만회 4] 복습은 실제로 끝낸 날 기준 (만회로 2일차에 끝낸 4강 → 2일차+3일)', function () {
  var p = makePlan([subj('kor', 30, 2, [], { spaced: [3] })]);
  check(p, D1, 'kor', 1); L.closeDay(p, D1, D1);
  checkAll(p, D2, D2); check(p, D2, 'kor', 4); L.closeDay(p, D2, D2);
  var due = L.simulate(p, D2, D2).revDue;
  eq([due['R|kor|1|3'], due['R|kor|2|3'], due['R|kor|3|3']], [L.addDays(D2, 3), L.addDays(D2, 3), L.addDays(D2, 3)], '2·3·4강 모두 2일차+3');
  var q = makePlan([subj('kor', 30, 2, [], { spaced: [3] })]);
  check(q, D1, 'kor', 1); L.closeDay(q, D1, D1);
  checkAll(q, D2, D2); L.closeDay(q, D2, D2);                  // 4강은 3일차에
  checkAll(q, D3, D3); L.closeDay(q, D3, D3);
  eq(L.simulate(q, D3, D3).revDue['R|kor|3|3'], L.addDays(D3, 3), '4강은 3일차+3');
});
test('[만회 5] 하는 요일 기준: 국어(월수목토) 원래 위치는 하는 날 분량만 셈', function () {
  var p = makePlan([subj('kor', 40, 2, [], { weekdays: wk('월수목토') })], MON, '2026-02-28');
  check(p, MON, 'kor', 1); L.autoClose(p, WED);                // 월: 1강만, 화: 국어 없음
  checkAll(p, WED, WED);                                        // 수: 2·3강
  eq([L.dayOf(p, WED, WED).gap.kor, catchUnits(p, WED, WED, 'kor')], [1, [4]], '원래 수요일까지 4강 → 4강 만회');
});
test('[만회 6] 강의만 듣고 복습은 못 한 만회 강 → 다음 날 남은 항목이 맨 앞', function () {
  var p = makePlan([subj('kor', 30, 2, ['강의 듣기', '복습'])]);
  check(p, D1, 'kor', 1, 0); check(p, D1, 'kor', 1, 1); L.closeDay(p, D1, D1);
  checkAll(p, D2, D2);
  eq(L.dayOf(p, D2, D2).catchup.kor, ['kor|3|0', 'kor|3|1'], '4강 강의·복습 만회');
  check(p, D2, 'kor', 4, 0); L.closeDay(p, D2, D2);           // 4강 강의만
  eq(shownOf(p, D3, D3, 'kor'), ['4:1', '5:0', '5:1'], '3일차: 4강 복습 먼저');
});

test('[Pre 3주] math_pre_3weeks.csv: 21일차, 강마다 「강의 듣기」 체크, 2차 복습은 1개', function () {
  var res = L.rowsFromCSV(fs.readFileSync(path.join(__dirname, 'math_pre_3weeks.csv'), 'utf8'));
  eq([res.rows.length, res.errors], [21, []], '21일차');
  eq(res.rows[0].title, '수학 · 중학수학특강 · Pre-개념때려잡기');
  eq(res.rows[0].items, ['01강 강의 듣기', '02강 강의 듣기', '03강 강의 듣기', '04강 강의 듣기'], '1일차 1~4강');
  eq(res.rows[4].items, ['2차 복습 01강-13강'], '5일차 2차 복습');
  eq(res.rows[17].items.length, 4, '18일차 19~22강');
  var total = res.rows.reduce(function (a, r) { return a + r.items.filter(function (x) { return /강의 듣기$/.test(x); }).length; }, 0);
  eq(total, 13 + 9 + 28, '강의 수: 중학수학 13 + 도형 9 + 수능 28');
  eq(L.itemsFor('강의 듣고 1차 복습', '01강-02강').length, 4, '기존 「강의 듣고 1차 복습」은 그대로');
});

/* ===== ⏭ 이 과목이 끝나면 시작 ===== */
function prePlan() {
  return makePlan([subj('pre', 3, 1), subj('math', 30, 1, [], { after: 'pre' }), subj('kor', 40, 2)]);
}
test('[순서 1] 본 수학은 Pre가 다 끝난 다음 날부터, 다른 과목은 그대로', function () {
  var p = prePlan();
  [D1, D2, D3].forEach(function (d) {
    eq(L.dayOf(p, d, d).shown.math, [], d + ' 수학 없음');
    eq(L.dayOf(p, d, d).blocked.math, 'pre', d + ' Pre 기다리는 중');
    checkAll(p, d, d); L.closeDay(p, d, d);
  });
  eq(unitsShown(p, D4, D4, 'math'), [1], 'Pre 3일차까지 끝 → 4일째 수학 1강');
  eq(unitsShown(p, D4, D4, 'kor'), [7, 8], '국어는 매일 계속');
});
test('[순서 2] Pre가 밀리면 수학도 그만큼 늦게 시작', function () {
  var p = prePlan();
  checkAll(p, D1, D1); L.closeDay(p, D1, D1);
  L.closeDay(p, D2, D2);                                          // 하루 못 함
  checkAll(p, D3, D3); L.closeDay(p, D3, D3);
  eq(L.dayOf(p, D4, D4).shown.math, [], 'Pre 아직 1개 남음 → 수학 없음');
  checkAll(p, D4, D4); L.closeDay(p, D4, D4);
  eq(unitsShown(p, D5, D5, 'math'), [1], '5일째 수학 시작');
});
test('[순서 3] 🏃 만회로 Pre를 빨리 끝내면 수학도 빨리 / 수학 만회는 시작 전 날짜를 세지 않음', function () {
  var p = makePlan([subj('pre', 4, 2), subj('math', 30, 1, [], { after: 'pre' })]);
  check(p, D1, 'pre', 1); L.closeDay(p, D1, D1);                // 1일째 1개만
  checkAll(p, D2, D2); check(p, D2, 'pre', 4); L.closeDay(p, D2, D2);  // 2·3 + 만회 4 → Pre 끝
  eq(unitsShown(p, D3, D3, 'math'), [1], '3일째 수학 시작');
  checkAll(p, D3, D3);
  eq(L.dayOf(p, D3, D3).gap.math, 0, '수학 원래 위치는 시작한 날부터 셈 (만회 없음)');
});
test('[순서 4] 예상 완료일도 순서 반영', function () {
  var p = makePlan([subj('pre', 3, 1), subj('math', 5, 1, [], { after: 'pre' })], D1, '2026-12-31');
  var f = L.forecast(p, D1);
  eq([f[0].finishDate, f[1].finishDate, f[1].after], ['2026-12-22', '2026-12-27', 'pre'], 'Pre 12/22 끝 → 수학 12/23~27');
});
test('[순서 5] 새 계획: 「처음부터」로 id가 바뀌어도 순서 유지, 앞 과목을 빼면 순서 없앰', function () {
  var p = prePlan();
  var np = L.newPlanFrom(p, D1, { id: 'n', name: 'x', start: D1, end: '2027-01-31', subjects: [
    { id: 'pre', keep: true, carry: false }, { id: 'math', keep: true, carry: false }, { id: 'kor', keep: true, carry: true }] });
  eq(np.subjects[1].after, np.subjects[0].id, '새 Pre id를 가리킴');
  var np2 = L.newPlanFrom(p, D1, { id: 'n2', name: 'x', start: D1, end: '2027-01-31', subjects: [{ id: 'math', keep: true, carry: true }] });
  eq(np2.subjects[0].after, undefined, 'Pre를 빼면 바로 시작');
});

test('(추가) 마감 취소하면 다시 체크·재계산 가능', function () {
  var p = makePlan([subj('kor', 40, 2)]);
  L.closeDay(p, D1, D1);
  L.reopenDay(p, D1);
  eq(L.dayOf(p, D1, D1).status, 'open');
});

test('(추가) 밀림 방식 B: 일부만 한 묶음은 자리를 차지하지 않음', function () {
  var p = makePlan([subj('kor', 40, 1, ['강의 듣기', '복습'], { mode: 'B' })]);
  check(p, D1, 'kor', 1, 0); L.closeDay(p, D1, D1);
  eq(shownOf(p, D2, D2, 'kor'), ['1:1', '2:0', '2:1'], '남은 항목 + 원래 다음 묶음');
  L.closeDay(p, D2, D2); // 하나도 안 함
  eq(shownOf(p, D3, D3, 'kor'), ['1:1', '2:0', '2:1'], '통째로 못 한 묶음은 자리를 차지');
});

console.log('\n결과: ' + passed + '개 통과, ' + failed + '개 실패\n');
process.exit(failed ? 1 : 0);
