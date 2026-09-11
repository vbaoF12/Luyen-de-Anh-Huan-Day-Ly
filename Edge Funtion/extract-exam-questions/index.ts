import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const OPENROUTER_MODEL = "qwen/qwen3.5-9b";
const VERSION = "2026-09-11-universal-parser-v1";
const OPENROUTER_MAX_TOKENS = 6000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class EdgeHttpError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status = 502, retryable = true) {
    super(message);
    this.name = "EdgeHttpError";
    this.status = status;
    this.retryable = retryable;
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeAiText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item: any) => {
        if (typeof item === "string") return item;
        if (typeof item?.text === "string") return item.text;
        if (typeof item?.content === "string") return item.content;
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function extractMessageText(payload: any) {
  const choice = payload?.choices?.[0];
  const message = choice?.message;
  const candidates = [
    normalizeAiText(message?.content),
    normalizeAiText(choice?.text),
    normalizeAiText(message?.text),
  ].filter(Boolean);
  return candidates[0] || "";
}

function getBalancedJsonCandidates(text: string) {
  const candidates: string[] = [];
  let start = -1, objectDepth = 0, arrayDepth = 0, inString = false, escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") { if (objectDepth === 0 && arrayDepth === 0) start = i; objectDepth += 1; }
    else if (char === "}") { if (objectDepth > 0) objectDepth -= 1; }
    else if (char === "[") { arrayDepth += 1; }
    else if (char === "]") { if (arrayDepth > 0) arrayDepth -= 1; }
    if (objectDepth === 0 && arrayDepth === 0 && start >= 0) { candidates.push(text.slice(start, i + 1)); start = -1; }
  }
  return candidates.sort((a, b) => b.length - a.length);
}

function repairTruncatedJson(candidate: string) {
  let repaired = candidate.replace(/,\s*([}\]])/g, "$1").trim();
  let inString = false, escaped = false, objectDepth = 0, arrayDepth = 0;
  for (let i = 0; i < repaired.length; i += 1) {
    const char = repaired[i];
    if (escaped) { escaped = false; continue; }
    if (inString && char === "\\") { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === "{") objectDepth += 1;
    else if (char === "}") objectDepth -= 1;
    else if (char === "[") arrayDepth += 1;
    else if (char === "]") arrayDepth -= 1;
  }
  if (inString || objectDepth < 0 || arrayDepth < 0) return "";
  while (arrayDepth > 0) { repaired += "]"; arrayDepth -= 1; }
  while (objectDepth > 0) { repaired += "}"; objectDepth -= 1; }
  return repaired.replace(/,\s*([}\]])/g, "$1").trim();
}

function extractJson(text: string) {
  let value = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
  if (!value) throw new Error("AI trả về nội dung rỗng.");
  value = value
    .replace(/```json/gi, "").replace(/```/g, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/[""]/g, '"').replace(/['']/g, "'").trim();
  const firstBrace = value.indexOf("{");
  if (firstBrace < 0) throw new Error(`Không tìm thấy JSON. Raw: ${value.slice(0, 1200)}`);
  value = value.slice(firstBrace);
  const attempts: string[] = [];
  const addAttempt = (c: string) => { const cl = c.replace(/,\s*([}\]])/g, "$1").trim(); if (cl && !attempts.includes(cl)) attempts.push(cl); };
  for (const c of getBalancedJsonCandidates(value)) addAttempt(c);
  addAttempt(value);
  const rep = repairTruncatedJson(value);
  if (rep) addAttempt(rep);
  for (const c of attempts) { try { return JSON.parse(c); } catch { /* tiep tuc */ } }
  throw new Error(`AI không trả JSON hợp lệ. Raw: ${String(text).slice(0, 1500)}`);
}

// ─── PROMPTS ─────────────────────────────────────────────────────────────────

function buildUnifiedExtractPrompt(pageNumber: number, totalPages: number) {
  return `
Đây là trang ${pageNumber}/${totalPages} của tài liệu/đề thi môn Vật lí (có thể là đề bài trần, hoặc đề có kèm hướng dẫn giải / đáp án chi tiết).

Nhiệm vụ: Trích xuất toàn bộ câu hỏi (kèm đáp án đúng và lời giải nếu có trên trang) hoặc bảng đáp án tổng hợp có trên trang này.

HỖ TRỢ MỌI CẤU TRÚC ĐỀ THI:
1. Đề thi 3 phần theo chuẩn mới (Bộ GD&ĐT 2025):
   - Phần I: Câu trắc nghiệm nhiều phương án (MCQ), mỗi câu có 4 phương án A, B, C, D -> đưa vào mảng "mcq".
   - Phần II: Câu trắc nghiệm Đúng/Sai, mỗi câu có đoạn dữ kiện chung và 4 ý a), b), c), d) -> đưa vào mảng "trueFalse".
   - Phần III: Câu trắc nghiệm trả lời ngắn, câu hỏi yêu cầu điền số -> đưa vào mảng "shortAnswer".
2. Đề trắc nghiệm truyền thống (40 câu hoặc bất kỳ số lượng nào từ 1 đến N):
   - Nếu đề đánh số liên tục Câu 1, Câu 2, ..., Câu 40 mà không chia phần -> Đưa TOÀN BỘ vào mảng "mcq" theo đúng số thứ tự của đề (number: 1..40).
3. Đề kiểm tra ngắn (15 phút, 1 tiết, đề thi thử):
   - Trích xuất tất cả các câu thực tế xuất hiện trên trang này, giữ nguyên số thứ tự câu.

QUY TẮC BẮT BUỘC:
1. ĐỊNH DẠNG TOÁN & VẬT LÝ (KATEX):
   - Mọi công thức, ký hiệu toán/lý, biểu thức, phân số, số mũ, chỉ số dưới, đơn vị hoặc chữ cái Hy Lạp (như E_d, \\lambda, \\Delta, \\pi, 10^5, \\frac{3}{2}, ^\\circ\\text{C}, \\Omega, \\mu...) BẮT BUỘC phải đặt trong cặp dấu $...$ (ví dụ: "$E_d = \\frac{3}{2}kT$", "$\\lambda = 3,5 \\cdot 10^5\\text{ J/kg}$", "$0^\\circ\\text{C}$").
   - KHÔNG để công thức trần trụi mà không có dấu $.

2. PHƯƠNG ÁN TRẮC NGHIỆM (MCQ OPTIONS):
   - "options": Mảng đúng 4 chuỗi tương ứng với 4 lựa chọn.
   - TUYỆT ĐỐI KHÔNG để tiền tố "A.", "B.", "C.", "D." ở đầu mỗi chuỗi options (hệ thống frontend sẽ tự động gắn chữ cái A, B, C, D).
   - Ví dụ trong đề: "A. Tăng.   B. Giảm." -> options: ["Tăng.", "Giảm.", "Không đổi.", "Bằng 0."] (KHÔNG được là ["A. Tăng.", "B. Giảm.", ...]).

3. BÓC TÁCH ĐÁP ÁN & LỜI GIẢI (RẤT QUAN TRỌNG):
   - Nếu dưới câu hỏi có phần "Hướng dẫn" / "Lời giải" / "HDG" / "Đáp án":
     * Trích xuất đáp án đúng ("A", "B", "C", "D" hoặc con số) vào trường "answer".
     * Trích xuất nội dung giải thích vào trường "explanation".
     * TUYỆT ĐỐI KHÔNG gom đoạn "Hướng dẫn / Lời giải / Chọn A" vào trường "stem" hay "context" của câu hỏi!
   - Nếu là câu Đúng/Sai (Phần II), xem phần "Hướng dẫn": nếu ghi "a) Sai", "b) Sai", "c) Đúng", "d) Đúng", hãy gán "correct": false/true tương ứng cho từng ý a, b, c, d. Nếu không có thì để null.
   - Nếu trang này có "Bảng đáp án" tổng hợp (thường ở cuối đề), hãy trích xuất thêm vào trường "answerTable".

4. PHÂN TÁCH NỘI DUNG:
   - "stem" hoặc "context" CHỈ chứa nội dung câu hỏi / dữ kiện bài toán.

Trả về duy nhất một JSON với cấu trúc:
{
  "page": ${pageNumber},
  "mcq": [
    {
      "number": 1,
      "stem": "Đồ thị nào sau đây không mô tả quá trình đẳng áp?",
      "options": ["Hình 4.", "Hình 1.", "Hình 2.", "Hình 3."],
      "answer": "D",
      "explanation": "Hình 3 là đẳng tích."
    }
  ],
  "trueFalse": [
    {
      "number": 1,
      "context": "Để kiểm chứng tính chất của lực từ...",
      "statements": [
        { "label": "a", "text": "Số chỉ của cân điện tử...", "correct": false },
        { "label": "b", "text": "Khi bật điện...", "correct": false },
        { "label": "c", "text": "Nếu điều chỉnh biến trở...", "correct": true },
        { "label": "d", "text": "Lực từ tác dụng...", "correct": true }
      ]
    }
  ],
  "shortAnswer": [
    {
      "number": 1,
      "stem": "Một tủ đông công nghiệp bay hơi amoniac...",
      "answer": "5",
      "explanation": "Áp dụng định luật 1 nhiệt động lực học..."
    }
  ],
  "answerTable": {
    "mcqAnswers": {},
    "tfAnswers": {},
    "shortAnswers": {}
  }
}
`.trim();
}

function buildAnswersPrompt(pageNumber: number, totalPages: number) {
  return `
Đây là trang ${pageNumber}/${totalPages} của tài liệu thi môn Vật lí — phần BẢNG ĐÁP ÁN.

Nhiệm vụ: Đọc bảng đáp án tổng hợp và trả về JSON chứa đáp án đúng cho từng câu.

Hỗ trợ mọi format đáp án:
- MCQ: Đánh số 1..18 hoặc 1..40 (hoặc bất kỳ số nào), đáp án là A, B, C hoặc D.
- Đúng/Sai: Câu 1..4 (hoặc nhiều hơn), mỗi câu có các ý a, b, c, d (true/false).
- Trả lời ngắn: Câu 1..6 (hoặc nhiều hơn), đáp án là con số.

QUY TẮC:
- Đọc chính xác theo bảng đáp án hoặc hướng dẫn giải, KHÔNG suy diễn.
- Nếu không thấy bảng đáp án hoặc không rõ, trả đối tượng/mảng rỗng.
- Chỉ trả JSON, không thêm văn bản.

Trả về JSON:
{
  "page": ${pageNumber},
  "mcqAnswers": { "1": "A", "2": "C", "3": "B" },
  "tfAnswers": {
    "1": { "a": true, "b": false, "c": true, "d": false },
    "2": { "a": false, "b": true, "c": false, "d": true }
  },
  "shortAnswers": { "1": "3.14", "2": "9.8", "3": "120" }
}
`.trim();
}

// ─── OPENROUTER CALL ─────────────────────────────────────────────────────────

async function callOpenRouterExtract(apiKey: string, prompt: string, imageDataUrl: string) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Anh Huan Day Ly",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0,
      max_tokens: OPENROUTER_MAX_TOKENS,
      reasoning: { effort: "none" },
      stream: false,
      provider: { require_parameters: false, allow_fallbacks: true },
      plugins: [{ id: "response-healing" }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After");
    const message = `OpenRouter ${response.status}: ${raw.slice(0, 1800)}` + (retryAfter ? ` | Retry-After: ${retryAfter}s` : "");
    throw new EdgeHttpError(message, response.status, ![400, 401, 402, 403, 429].includes(response.status));
  }

  let payload: any;
  try { payload = JSON.parse(raw); }
  catch { throw new EdgeHttpError(`OpenRouter trả response không phải JSON. Raw: ${raw.slice(0, 1500)}`, 502, true); }

  if (payload?.error) {
    const s = Number(payload?.error?.code || 502);
    throw new EdgeHttpError(`OpenRouter error: ${payload?.error?.message || JSON.stringify(payload.error)}`, Number.isFinite(s) ? s : 502, ![400, 401, 402, 403, 429].includes(s));
  }

  const choice = payload?.choices?.[0];
  if (choice?.error) {
    const s = Number(choice?.error?.code || 502);
    throw new EdgeHttpError(`Provider error: ${choice.error?.message || JSON.stringify(choice.error)}`, Number.isFinite(s) ? s : 502, ![400, 401, 402, 403, 429].includes(s));
  }

  const text = extractMessageText(payload);
  if (!text) throw new EdgeHttpError(`AI không trả nội dung. finish_reason=${choice?.finish_reason ?? "unknown"}`, 502, true);

  let result: any;
  try { result = JSON.parse(text); }
  catch { result = extractJson(text); }

  return { result, usage: payload?.usage ?? null };
}

// ─── NORMALIZE HELPERS ───────────────────────────────────────────────────────

function cleanOptionText(text: unknown, index: number): string {
  let s = String(text ?? "").trim();
  const letter = ["A", "B", "C", "D"][index];
  if (letter) {
    s = s.replace(new RegExp(`^\\s*${letter}\\s*[.):\\]\\-\\s]+`, "i"), "");
  }
  // Loại bỏ chữ cái A-D bất kỳ nếu còn sót ở đầu
  s = s.replace(/^\s*[A-D]\s*[.):\\]\\-\\s]+/i, "").trim();
  return s;
}

function normalizeMcq(items: any[]) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((q: any) => q?.number && q?.stem)
    .map((q: any) => {
      const ansRaw = String(q.answer || "").trim().toUpperCase();
      const validAns = ["A", "B", "C", "D"].includes(ansRaw) ? ansRaw : null;
      return {
        number: Number(q.number),
        stem: String(q.stem || "").trim(),
        options: Array.isArray(q.options)
          ? q.options.slice(0, 4).map((o: any, idx: number) => cleanOptionText(o, idx))
          : ["", "", "", ""],
        answer: validAns,
        explanation: String(q.explanation || "").trim(),
      };
    });
}

function normalizeTrueFalse(items: any[]) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((q: any) => q?.number)
    .map((q: any) => ({
      number: Number(q.number),
      context: String(q.context || "").trim(),
      statements: Array.isArray(q.statements)
        ? q.statements.slice(0, 4).map((s: any) => {
          const label = String(s?.label || "").toLowerCase().replace(/[^a-d]/g, "") || "a";
          let text = String(s?.text || "").trim();
          text = text.replace(new RegExp(`^\\s*${label}\\s*[.):\\]\\-\\s]+`, "i"), "").trim();
          let correct: boolean | null = null;
          if (s?.correct === true || s?.correct === "true" || s?.correct === "Đúng" || s?.correct === "dung") {
            correct = true;
          } else if (s?.correct === false || s?.correct === "false" || s?.correct === "Sai" || s?.correct === "sai") {
            correct = false;
          }
          return { label, text, correct };
        })
        : [],
    }));
}

function normalizeShortAnswer(items: any[]) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((q: any) => q?.number && q?.stem)
    .map((q: any) => ({
      number: Number(q.number),
      stem: String(q.stem || "").trim(),
      answer: String(q.answer ?? "").trim(),
    }));
}

function normalizeAnswerTable(raw: any) {
  if (!raw || typeof raw !== "object") return { mcqAnswers: {}, tfAnswers: {}, shortAnswers: {} };
  return {
    mcqAnswers: raw.mcqAnswers || {},
    tfAnswers: raw.tfAnswers || {},
    shortAnswers: raw.shortAnswers || {},
  };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();

    if (body?.action === "health") {
      return jsonResponse({ ok: true, version: VERSION, model: OPENROUTER_MODEL });
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new EdgeHttpError("Thiếu secret OPENROUTER_API_KEY.", 500, false);

    const pageNumber = Number(body?.pageNumber || 1);
    const totalPages = Number(body?.totalPages || 1);
    const imageDataUrl = String(body?.imageDataUrl || "");
    const mode = String(body?.mode || "unified");

    if (!imageDataUrl.startsWith("data:image/")) {
      return jsonResponse({ error: "Thiếu ảnh trang PDF hợp lệ.", version: VERSION, retryable: false }, 400);
    }

    let prompt: string;
    if (mode === "answers") {
      prompt = buildAnswersPrompt(pageNumber, totalPages);
    } else {
      prompt = buildUnifiedExtractPrompt(pageNumber, totalPages);
    }

    console.log(`📄 Trang ${pageNumber}/${totalPages}, mode=${mode}`);
    const { result, usage } = await callOpenRouterExtract(apiKey, prompt, imageDataUrl);

    if (mode === "answers") {
      return jsonResponse({
        ok: true, version: VERSION, model: OPENROUTER_MODEL,
        result: {
          page: pageNumber, mode: "answers",
          mcqAnswers: result?.mcqAnswers || {},
          tfAnswers: result?.tfAnswers || {},
          shortAnswers: result?.shortAnswers || {},
        },
        usage,
      });
    }

    // mode === "unified" or default
    return jsonResponse({
      ok: true, version: VERSION, model: OPENROUTER_MODEL,
      result: {
        page: pageNumber, mode: "unified",
        mcq: normalizeMcq(result?.mcq || []),
        trueFalse: normalizeTrueFalse(result?.trueFalse || []),
        shortAnswer: normalizeShortAnswer(result?.shortAnswer || []),
        answerTable: normalizeAnswerTable(result?.answerTable),
      },
      usage,
    });
  } catch (error) {
    console.error("EDGE FUNCTION ERROR:", error);
    const status = error instanceof EdgeHttpError ? error.status : 502;
    const retryable = error instanceof EdgeHttpError ? error.retryable : true;
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error), version: VERSION, retryable },
      status,
    );
  }
}

serve(handler);

