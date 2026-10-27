// 학생 기록: 학습 코드 확인(login), 제출 기록(submit)
// 저장하는 것: 학습 코드, 문제별 제출 횟수, 처음 통과한 시도 번호, 해결 시각. 이름·학번은 받지 않아요.
const { pipeline, cmd, pairsToObj, send, sameOrigin, body, ip, normCode, validPid, hasRedis } = require("./_lib");

const fails = new Map(); // 코드 맞히기 시도 막기 (IP별, 10분)
function tooMany(addr) {
  const now = Date.now();
  const list = (fails.get(addr) || []).filter(t => now - t < 10 * 60 * 1000);
  fails.set(addr, list);
  return list.length >= 15;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST 요청만 받아요." });
  if (!sameOrigin(req)) return send(res, 403, { error: "허용되지 않은 주소에서 온 요청이에요." });
  if (!hasRedis()) return send(res, 503, { error: "기록 저장소가 아직 연결되지 않았어요. 선생님께 알려 주세요." });

  const b = body(req);
  const code = normCode(b.code);
  const addr = ip(req);
  if (tooMany(addr)) return send(res, 429, { error: "코드를 너무 많이 틀렸어요. 10분 뒤에 다시 해 주세요." });
  if (!code) return send(res, 400, { error: "코드 형식이 맞지 않아요. 예: K7M-29Q" });

  try {
    const known = await cmd("SISMEMBER", "codes", code);
    if (!known) {
      fails.get(addr).push(Date.now());
      return send(res, 404, { error: "등록되지 않은 코드예요. 선생님께 받은 코드를 다시 확인해 주세요." });
    }

    if (b.action === "login") {
      const progress = pairsToObj(await cmd("HGETALL", "prog:" + code));
      return send(res, 200, { code, progress });
    }

    if (b.action === "submit") {
      if (!validPid(b.pid)) return send(res, 400, { error: "문제 번호가 올바르지 않아요." });
      const raw = await cmd("HGET", "prog:" + code, b.pid);
      let rec = { a: 0, s: null, f: null };
      try { if (raw) rec = Object.assign(rec, JSON.parse(raw)); } catch {}
      if (!rec.s) {                       // 이미 해결한 문제는 횟수를 더 세지 않아요
        rec.a += 1;
        if (b.passed === true) { rec.s = Date.now(); rec.f = rec.a; }
        await pipeline([
          ["HSET", "prog:" + code, b.pid, JSON.stringify(rec)],
          ["HSET", "lastseen", code, String(Date.now())],
        ]);
      }
      return send(res, 200, { pid: b.pid, rec });
    }

    return send(res, 400, { error: "알 수 없는 요청이에요." });
  } catch (e) {
    console.log("student error", e && e.message);
    return send(res, 502, { error: "기록 저장소에 연결하지 못했어요. 잠시 후 다시 해 주세요." });
  }
};
