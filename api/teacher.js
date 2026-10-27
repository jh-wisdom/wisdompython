// 선생님 화면: 비밀번호 확인 후 학습 현황 조회, 코드 만들기·삭제·기록 초기화
const crypto = require("crypto");
const { pipeline, cmd, pairsToObj, send, sameOrigin, body, ip, newCode, normCode, hasRedis } = require("./_lib");

const fails = new Map();
function locked(addr) {
  const now = Date.now();
  const list = (fails.get(addr) || []).filter(t => now - t < 10 * 60 * 1000);
  fails.set(addr, list);
  return list.length >= 8;
}
function checkPw(given) {
  const real = process.env.TEACHER_PASSWORD || "";
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(real).digest();
  return real.length > 0 && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST 요청만 받아요." });
  if (!sameOrigin(req)) return send(res, 403, { error: "허용되지 않은 주소에서 온 요청이에요." });
  if (!process.env.TEACHER_PASSWORD) return send(res, 503, { error: "Vercel 환경 변수에 TEACHER_PASSWORD가 없어요." });
  if (!hasRedis()) return send(res, 503, { error: "기록 저장소(Upstash Redis)가 아직 연결되지 않았어요." });

  const addr = ip(req);
  if (locked(addr)) return send(res, 429, { error: "비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 해 주세요." });
  const b = body(req);
  if (!checkPw(b.password)) {
    fails.get(addr).push(Date.now());
    return send(res, 401, { error: "비밀번호가 맞지 않아요." });
  }

  try {
    if (b.action === "list") {
      const codes = (await cmd("SMEMBERS", "codes")) || [];
      codes.sort();
      const [meta, seen] = await pipeline([["HGETALL", "codemeta"], ["HGETALL", "lastseen"]]);
      const created = pairsToObj(meta), last = pairsToObj(seen);
      const progs = codes.length ? await pipeline(codes.map(c => ["HGETALL", "prog:" + c])) : [];
      return send(res, 200, {
        students: codes.map((c, i) => ({ code: c, created: Number(created[c]) || null, lastSeen: Number(last[c]) || null, progress: pairsToObj(progs[i]) })),
      });
    }

    if (b.action === "create") {
      const n = Math.max(1, Math.min(60, parseInt(b.count, 10) || 0));
      const existing = new Set((await cmd("SMEMBERS", "codes")) || []);
      if (existing.size + n > 500) return send(res, 400, { error: "코드는 모두 500개까지 만들 수 있어요." });
      const made = [];
      while (made.length < n) { const c = newCode(); if (!existing.has(c)) { existing.add(c); made.push(c); } }
      const now = String(Date.now());
      await pipeline([["SADD", "codes", ...made], ["HSET", "codemeta", ...made.flatMap(c => [c, now])]]);
      return send(res, 200, { created: made });
    }

    const list = (Array.isArray(b.codes) ? b.codes : []).map(normCode).filter(Boolean).slice(0, 500);
    if (!list.length) return send(res, 400, { error: "선택한 코드가 없어요." });

    if (b.action === "delete") {
      await pipeline([["SREM", "codes", ...list], ["HDEL", "codemeta", ...list], ["HDEL", "lastseen", ...list], ...list.map(c => ["DEL", "prog:" + c])]);
      return send(res, 200, { deleted: list.length });
    }
    if (b.action === "reset") {
      await pipeline([...list.map(c => ["DEL", "prog:" + c]), ["HDEL", "lastseen", ...list]]);
      return send(res, 200, { reset: list.length });
    }
    return send(res, 400, { error: "알 수 없는 요청이에요." });
  } catch (e) {
    console.log("teacher error", e && e.message);
    return send(res, 502, { error: "기록 저장소에 연결하지 못했어요. 잠시 후 다시 해 주세요." });
  }
};
