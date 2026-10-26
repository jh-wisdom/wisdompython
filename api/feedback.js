// 파이썬 첫걸음 — AI 피드백 함수 (Vercel)
// API 키는 이 파일에 쓰지 않습니다. Vercel 프로젝트의 Environment Variables에 OPENAI_API_KEY로 넣으세요.
// 선택: MODEL (기본 gpt-4.1-mini), RATE_LIMIT (10분당 IP별 요청 수, 기본 60)

const MAX_CODE = 6000;
const MAX_TURNS = 9;
const RATE_WINDOW = 10 * 60 * 1000;
const hits = new Map();

module.exports = async function handler(req, res) {
  const send = (status, obj) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
  };

  if (req.method !== "POST") return send(405, { error: "POST 요청만 받아요." });

  // 우리 사이트에서 온 요청만 받기
  const origin = req.headers.origin || "";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  if (origin) {
    let oh = "";
    try { oh = new URL(origin).host; } catch {}
    if (oh !== host) return send(403, { error: "허용되지 않은 주소에서 온 요청이에요." });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) return send(500, { error: "서버에 API 키가 설정되지 않았어요. 선생님께 알려 주세요." });

  // 간단한 사용량 제한 (서버 인스턴스별, 완벽하지 않음)
  const limit = Number(process.env.RATE_LIMIT) || 60;
  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  if (list.length >= limit) return send(429, { error: "요청이 많아요. 몇 분 뒤에 다시 해 주세요." });
  list.push(now); hits.set(ip, list);

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  const c = body && body.context;
  const history = Array.isArray(body && body.history) ? body.history : [];
  if (!c || typeof c.code !== "string") return send(400, { error: "문제 정보가 없어요." });
  if (history.length > MAX_TURNS) return send(400, { error: "이 문제에서 질문을 많이 했어요. '다시 피드백 받기'로 새로 시작해 주세요." });

  const cut = (s, n) => String(s ?? "").slice(0, n);
  const firstUser = `[문제] ${cut(c.title, 100)}
${cut(c.desc, 800)}
입력: ${cut(c.inF, 300)}
출력: ${cut(c.outF, 300)}
관련 단원: ${cut(c.unit, 50)}

[학생 코드]
\`\`\`python
${cut(c.code, MAX_CODE)}
\`\`\`

[실행/채점 결과]
${cut(c.result, 4000)}

${c.solved
  ? "학생이 채점을 모두 통과했어요. 칭찬하고, 더 깔끔하거나 파이썬다운 방법이 있으면 짧은 예시 코드로 알려 주세요."
  : "학생이 아직 통과하지 못했어요. 정답 코드를 통째로 알려 주지 말고, 원인을 짚은 뒤 스스로 고칠 수 있는 단계적인 힌트만 주세요. 고칠 줄 번호를 알려 주는 건 괜찮아요."}`;

  const messages = [
    { role: "system", content:
`너는 파이썬을 처음 배우는 고등학생을 돕는 다정하고 정확한 선생님이다. 학생은 정보 과목을 배운 적이 없으니 용어를 쉽게 풀어 준다.
규칙:
- 한국어 "~해요" 체. 첫 피드백은 700자 이내, 추가 질문 답변은 400자 이내.
- 실행 결과를 실제로 보고 판단한다. 기대 출력과 학생 출력의 차이(빈칸, 줄바꿈, 글자)를 구체적으로 짚는다.
- 학생이 채점을 통과하기 전에는 정답 코드 전체를 절대 주지 않는다.
- 첫 피드백은 마크다운 소제목 4개를 이 순서로 쓴다: ### 잘한 점 / ### 확인할 부분 / ### 다음 단계 힌트 / ### 기억할 개념
- 이 문제와 파이썬 공부에 관한 질문에만 답한다. 다른 주제는 정중히 거절하고 공부로 돌아오게 한다.` },
    { role: "user", content: firstUser },
  ];
  for (const t of history) {
    if (!t || (t.role !== "user" && t.role !== "assistant")) continue;
    messages.push({ role: t.role, content: cut(t.content, t.role === "user" ? 300 : 3000) });
  }

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.MODEL || "gpt-4.1-mini", messages, max_completion_tokens: 900 }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.log("OpenAI error", r.status, data && data.error && data.error.message);
      if (r.status === 429) return send(429, { error: "AI 사용량 한도에 걸렸어요. 선생님께 알려 주세요." });
      if (r.status === 401) return send(502, { error: "서버의 API 키가 올바르지 않아요. 선생님께 알려 주세요." });
      return send(502, { error: "AI 서버에서 오류가 났어요. 잠시 후 다시 해 주세요." });
    }
    return send(200, { text: (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "" });
  } catch (e) {
    return send(502, { error: "AI 서버에 연결하지 못했어요." });
  }
};
