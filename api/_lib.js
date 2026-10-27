// 공통 도구 (파일 이름이 _로 시작하면 Vercel이 주소로 공개하지 않아요)
const crypto = require("crypto");

const redisUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const redisToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const hasRedis = () => !!(redisUrl() && redisToken());

async function pipeline(cmds) {
  const r = await fetch(redisUrl().replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("redis http " + r.status);
  const data = await r.json();
  return data.map(x => { if (x && x.error) throw new Error(x.error); return x ? x.result : null; });
}
const cmd = async (...args) => (await pipeline([args]))[0];

function pairsToObj(arr) {
  const o = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) {
    try { o[arr[i]] = JSON.parse(arr[i + 1]); } catch { o[arr[i]] = arr[i + 1]; }
  }
  return o;
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function sameOrigin(req) {
  const origin = req.headers.origin || "";
  if (!origin) return true;
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  try { return new URL(origin).host === host; } catch { return false; }
}

function body(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = null; } }
  return b && typeof b === "object" ? b : {};
}

const ip = req => String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();

// 학습 코드: 헷갈리는 글자(I, L, O, 0, 1) 없이 6글자, 예: K7M-29Q
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHA[crypto.randomInt(ALPHA.length)];
  return s.slice(0, 3) + "-" + s.slice(3);
}
function normCode(raw) {
  const s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{6}$/.test(s) ? s.slice(0, 3) + "-" + s.slice(3) : null;
}
const validPid = pid => typeof pid === "string" && /^p\d{1,3}$/.test(pid);

module.exports = { pipeline, cmd, pairsToObj, send, sameOrigin, body, ip, newCode, normCode, validPid, hasRedis };
