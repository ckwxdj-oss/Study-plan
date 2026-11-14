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
