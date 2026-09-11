import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const OPENROUTER_MODEL = "qwen/qwen3.5-9b";
const VERSION = "2026-09-11-universal-layout-v1";

// Chỉ 1 request OpenRouter cho mỗi lần Edge Function được gọi.
// app.js đã có retry riêng, tránh nhân retry thành nhiều request/trang.
const OPENROUTER_ATTEMPTS = 1;
const OPENROUTER_MAX_TOKENS = 3000;

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
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
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
  let start = -1;
  let objectDepth = 0;
  let arrayDepth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (objectDepth === 0 && arrayDepth === 0) start = i;
      objectDepth += 1;
    } else if (char === "}") {
      if (objectDepth > 0) objectDepth -= 1;
    } else if (char === "[") {
      arrayDepth += 1;
    } else if (char === "]") {
      if (arrayDepth > 0) arrayDepth -= 1;
    }

    if (objectDepth === 0 && arrayDepth === 0 && start >= 0) {
      candidates.push(text.slice(start, i + 1));
      start = -1;
    }
  }

  return candidates.sort((a, b) => b.length - a.length);
}

function repairTruncatedJson(candidate: string) {
  let repaired = candidate.replace(/,\s*([}\]])/g, "$1").trim();

  let inString = false;
  let escaped = false;
  let objectDepth = 0;
  let arrayDepth = 0;

  for (let i = 0; i < repaired.length; i += 1) {
    const char = repaired[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString && char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") objectDepth += 1;
    else if (char === "}") objectDepth -= 1;
    else if (char === "[") arrayDepth += 1;
    else if (char === "]") arrayDepth -= 1;
  }

  // Không tự sửa nếu bị cắt giữa string hoặc có dấu đóng dư.
  if (inString || objectDepth < 0 || arrayDepth < 0) return "";

  while (arrayDepth > 0) {
    repaired += "]";
    arrayDepth -= 1;
  }

  while (objectDepth > 0) {
    repaired += "}";
    objectDepth -= 1;
  }

  return repaired.replace(/,\s*([}\]])/g, "$1").trim();
}

export function extractJson(text: string) {
  let value = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();

  if (!value) throw new Error("AI trả về nội dung rỗng.");

  value = value
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();

  const firstBrace = value.indexOf("{");
  if (firstBrace < 0) {
    throw new Error(`Không tìm thấy JSON object. Raw: ${value.slice(0, 1200)}`);
  }

  value = value.slice(firstBrace);
  const attempts: string[] = [];

  const addAttempt = (candidate: string) => {
    const cleaned = candidate.replace(/,\s*([}\]])/g, "$1").trim();
    if (cleaned && !attempts.includes(cleaned)) attempts.push(cleaned);
  };

  for (const candidate of getBalancedJsonCandidates(value)) addAttempt(candidate);
  addAttempt(value);

  const repaired = repairTruncatedJson(value);
  if (repaired) addAttempt(repaired);

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // thử candidate tiếp theo
    }
  }

  console.error("RAW AI RESPONSE:", text);
  console.error("JSON CANDIDATES:", attempts);

  throw new Error(
    `AI không trả JSON hợp lệ. Raw: ${String(text).slice(0, 1500)}`,
  );
}

export function normalizeQuestionsOnPage(rawQuestions: unknown) {
  if (!Array.isArray(rawQuestions)) return [];

  return rawQuestions
    .map((q: any) => ({
      questionKey: String(q?.questionKey || "").trim(),
      questionType: String(q?.questionType || "").trim(),
      number: Number(q?.number || 0),
      topic: String(q?.topic || "").replace(/\s+/g, " ").trim().slice(0, 100),
      passageId: String(q?.passageId || "").trim(),
      context: String(q?.context || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500),
      stem: String(q?.stem || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500),
    }))
    .filter((q: any) => q.questionKey);
}

function buildPrompt(pageNumber: number, questionsOnPage: any[]) {
  const allowedQuestionKeys = questionsOnPage.map((q) => q.questionKey);
  const compactQuestions = questionsOnPage.map((q) => ({
    questionKey: q.questionKey,
    type: q.questionType,
    number: q.number,
    topic: q.topic || "",
    stem: q.stem,
    context: q.context || "",
    passageId: q.passageId || "",
  }));

  return `
Phân tích trang ${pageNumber} của đề thi Vật lí (có thể kèm hướng dẫn giải/đáp án) để CROP ẢNH GỐC từ PDF.
Mục tiêu: Phát hiện chính xác tọa độ bounding box (bbox) của mọi hình vẽ, đồ thị, sơ đồ mạch điện, mô hình thí nghiệm cần cho học sinh làm bài.

DANH SÁCH CÂU HỎI HỢP LỆ TRÊN TRANG:
${JSON.stringify(compactQuestions)}

questionKey hợp lệ: ${allowedQuestionKeys.join(", ")}

QUY TẮC NHẬN DIỆN BỐ CỤC KHÔNG GIAN (SPATIAL LAYOUT - CỰC KỲ QUAN TRỌNG):
Hình ảnh trong đề thi Vật lí Việt Nam có nhiều dạng vị trí khác nhau, KHÔNG PHẢI LÚC NÀO CŨNG NẰM Ở CHÍNH GIỮA TRANG. Bạn PHẢI quan sát kỹ vị trí thực tế của hình đối chiếu với cột chữ:

1. DẠNG BỐ CỤC 1: CỘT ĐÔI SONG SONG - HÌNH LỆCH PHẢI (Right-aligned Visual):
   - Cột bên trái: Chứa văn bản câu hỏi (đề bài, dữ kiện, hoặc các phương án A, B, C, D, hoặc các ý a, b, c, d).
   - Cột bên phải: Chứa hình vẽ, đồ thị hoặc sơ đồ thí nghiệm (thường chiếm khoảng 35% - 48% độ rộng trang bên phải).
   - QUY TẮC BBOX CHO HÌNH LỆCH PHẢI:
     * x1 PHẢI BẮT ĐẦU TỪ KHOẢNG TRỐNG (whitespace gutter) GIỮA CỘT CHỮ VÀ CỘT HÌNH (thường x1 nằm trong khoảng 500..650).
     * TUYỆT ĐỐI KHÔNG ĐẶT x1 từ lề trái trang (0..150), vì như vậy sẽ nuốt trọn cả cột chữ câu hỏi vào ảnh crop!
     * x2 ôm sát mép phải của hình (thường 880..960).

2. DẠNG BỐ CỤC 2: CỘT ĐÔI SONG SONG - HÌNH LỆCH TRÁI (Left-aligned Visual):
   - Cột bên trái: Chứa hình vẽ, sơ đồ mạch điện.
   - Cột bên phải: Chứa nội dung câu hỏi hoặc các câu khẳng định.
   - QUY TẮC BBOX CHO HÌNH LỆCH TRÁI:
     * x1 bắt đầu từ mép trái của hình (thường 60..120).
     * x2 PHẢI KẾT THÚC TRƯỚC KHOẢNG TRỐNG phân cách với cột chữ bên phải (thường x2 nằm trong khoảng 450..550).
     * TUYỆT ĐỐI KHÔNG để x2 kéo dài sang cột chữ bên phải!

3. DẠNG BỐ CỤC 3: DÀN NGANG TOÀN TRANG / CHÍNH GIỮA (Centered / Full-width):
   - Thường là câu có 4 hình con (Hình 1, Hình 2, Hình 3, Hình 4 hoặc Hình a, b, c, d) xếp thành một hàng ngang dưới đề bài.
   - Hoặc đồ thị lớn nằm độc lập ở giữa trang.
   - QUY TẮC BBOX:
     * x1 ôm từ hình đầu tiên bên trái (thường 80..150).
     * x2 ôm đến hết hình cuối cùng bên phải (thường 850..940).
     * Bbox phải bao trọn TẤT CẢ các hình con (Hình 1..4) của câu đó, không được crop thiếu.

4. DẠNG BỐ CỤC 4: TÀI LIỆU DÀN 2 CỘT TOÀN TRANG (Two-column document):
   - Cả trang tài liệu được chia 2 cột dọc độc lập. Câu hỏi và hình cùng nằm trọn trong Cột 1 (x: 50..500) hoặc Cột 2 (x: 500..950).
   - Bbox của hình phải nằm gọn trong cột chứa câu hỏi đó, tuyệt đối không chớm sang cột bên cạnh.

QUY TẮC XÁC ĐỊNH BIÊN ĐỘ BBOX (TỌA ĐỘ CHUẨN HÓA 0..1000):
- [y1, y2] (Trục dọc):
  * y1: Phải bắt đầu ngay dưới dòng chữ cuối cùng của đề bài (nếu hình ở dưới text), chừa khoảng 4-8 đơn vị. Nếu hình nằm song song cạnh text, y1 bắt đầu từ đỉnh cao nhất của hình.
  * y1 PHẢI ÔM TRỌN: Nhãn đại lượng đỉnh trục tọa độ (như p (10^5 Pa), V (cm^3), x (cm), u (V), i (A)), mũi tên trục chỉ lên, vector chỉ lên.
  * y2: Phải ôm trọn đáy hình, gốc O, nhãn trục nằm ngang (t (s), T (K), d (cm)...), mũi tên trục, và tên/chú thích hình ("Hình 1", "Hình 2", "Hình a", "Sơ đồ mạch...").
  * y2 PHẢI DỪNG LẠI trước dòng phương án "A. Hình...", trước dòng "Hướng dẫn giải", trước câu hỏi tiếp theo.
- [x1, x2] (Trục ngang):
  * Ôm trọn vẹn từ mép nét vẽ ngoài cùng bên trái (kể cả số âm trên trục, vạch chia độ, nhãn linh kiện) đến mép nét vẽ ngoài cùng bên phải.

QUY TẮC GÁN CÂU & LOẠI BỎ TEXT THỪA:
1. Mỗi visual chỉ gán cho MỘT questionKey duy nhất thuộc danh sách allowedQuestionKeys.
2. Tuyệt đối KHÔNG crop chữ stem đề bài ("Câu 1: ...", "Một vật dao động...").
3. Tuyệt đối KHÔNG crop chữ các phương án A, B, C, D (trừ trường hợp bản thân phương án là 1 hình con được câu hỏi tham chiếu).
4. Tuyệt đối KHÔNG crop phần chữ "Hướng dẫn giải", "Lời giải", "Chọn A/B/C/D".
5. Nếu hình không thể tách sạch hoặc dính đáp án không thể tránh, đánh dấu cropSafe=false và containsAnswerText=true.
6. Ưu tiên độ chính xác: bbox phải ôm khít hình ảnh thực sự mà học sinh cần nhìn để giải bài.

Chỉ trả JSON theo đúng response_format được yêu cầu. Không thêm văn bản bên ngoài.
`.trim();
}

export function buildResponseSchema(
  pageNumber: number,
  allowedQuestionKeys: string[],
) {
  return {
    type: "json_schema",
    json_schema: {
      name: "physics_visuals",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          page: {
            type: "integer",
            description: `Số trang PDF, phải là ${pageNumber}.`,
          },
          questions: {
            type: "array",
            description: "Chỉ gồm các câu có ít nhất một visual cần crop.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                questionKey: {
                  type: "string",
                  enum: allowedQuestionKeys,
                  description: "Phải khớp chính xác questionKey từ database.",
                },
                hasVisual: {
                  type: "boolean",
                  description: "Luôn là true vì chỉ trả các câu có visual.",
                },
                visuals: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      type: {
                        type: "string",
                        enum: ["image"],
                      },
                      description: {
                        type: "string",
                      },
                      bbox: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          x1: { type: "number", minimum: 0, maximum: 1000 },
                          y1: { type: "number", minimum: 0, maximum: 1000 },
                          x2: { type: "number", minimum: 0, maximum: 1000 },
                          y2: { type: "number", minimum: 0, maximum: 1000 },
                        },
                        required: ["x1", "y1", "x2", "y2"],
                      },
                      confidence: {
                        type: "number",
                        minimum: 0,
                        maximum: 1,
                      },
                      cropSafe: {
                        type: "boolean",
                        description: "true chỉ khi bbox sạch, không dính đáp án hoặc câu khác.",
                      },
                      containsAnswerText: {
                        type: "boolean",
                        description: "true nếu bbox còn chứa lựa chọn A/B/C/D, đáp án hoặc lời giải.",
                      },
                    },
                    required: [
                      "type",
                      "description",
                      "bbox",
                      "confidence",
                      "cropSafe",
                      "containsAnswerText",
                    ],
                  },
                },
              },
              required: ["questionKey", "hasVisual", "visuals"],
            },
          },
        },
        required: ["page", "questions"],
      },
    },
  };
}

function validateResultShape(result: any) {
  if (!result || typeof result !== "object" || !Array.isArray(result.questions)) {
    throw new Error(
      "AI trả structured output sai schema: thiếu questions array.",
    );
  }

  return result;
}

async function callOpenRouter(
  apiKey: string,
  prompt: string,
  imageDataUrl: string,
  pageNumber: number,
  allowedQuestionKeys: string[],
) {
  const responseFormat = buildResponseSchema(pageNumber, allowedQuestionKeys);

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Anh Huan Day Ly",
        "X-OpenRouter-Metadata": "enabled",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        temperature: 0,
        max_tokens: OPENROUTER_MAX_TOKENS,
        reasoning: {
          effort: "none",
        },
        stream: false,
        provider: {
          require_parameters: true,
          allow_fallbacks: true,
        },
        plugins: [
          {
            id: "response-healing",
          },
        ],
        response_format: responseFormat,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt,
              },
              {
                type: "image_url",
                image_url: {
                  url: imageDataUrl,
                },
              },
            ],
          },
        ],
      }),
    },
  );

  const raw = await response.text();

  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After");
    const message =
      `OpenRouter ${response.status}: ${raw.slice(0, 1800)}` +
      (retryAfter ? ` | Retry-After: ${retryAfter}s` : "");

    // Retry ngay thường vô ích với quota/payment/auth.
    const retryable = ![400, 401, 402, 403, 429].includes(response.status);
    throw new EdgeHttpError(message, response.status, retryable);
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new EdgeHttpError(
      `OpenRouter trả response không phải JSON. Raw: ${raw.slice(0, 1500)}`,
      502,
      true,
    );
  }

  if (payload?.error) {
    const upstreamStatus = Number(payload?.error?.code || 502);
    throw new EdgeHttpError(
      `OpenRouter error: ${payload?.error?.message || JSON.stringify(payload.error)}`,
      Number.isFinite(upstreamStatus) ? upstreamStatus : 502,
      ![400, 401, 402, 403, 429].includes(upstreamStatus),
    );
  }

  const choice = payload?.choices?.[0];

  if (choice?.error) {
    const upstreamStatus = Number(choice?.error?.code || 502);
    throw new EdgeHttpError(
      `Provider error: ${choice.error?.message || JSON.stringify(choice.error)}`,
      Number.isFinite(upstreamStatus) ? upstreamStatus : 502,
      ![400, 401, 402, 403, 429].includes(upstreamStatus),
    );
  }

  const text = extractMessageText(payload);

  if (!text) {
    throw new EdgeHttpError(
      `AI không trả structured JSON ở trang ${pageNumber}. finish_reason=${choice?.finish_reason ?? "unknown"}`,
      502,
      true,
    );
  }

  let result: any;
  try {
    // Response Healing + Structured Outputs lý tưởng đã cho JSON hợp lệ.
    result = JSON.parse(text);
  } catch {
    // Fallback cục bộ nếu provider vẫn trả JSON gần đúng.
    result = extractJson(text);
  }

  result = validateResultShape(result);

  console.log("OPENROUTER STRUCTURED RESULT:", {
    page: pageNumber,
    finishReason: choice?.finish_reason ?? null,
    contentLength: text.length,
    questionCount: result.questions.length,
    usage: payload?.usage ?? null,
  });

  return {
    result,
    attempt: OPENROUTER_ATTEMPTS,
    finishReason: choice?.finish_reason ?? null,
    contentLength: text.length,
    routerMetadata: payload?.openrouter_metadata ?? null,
    usage: payload?.usage ?? null,
  };
}

function normalizeVisual(visual: any) {
  if (!visual || !visual.bbox) return null;

  const rawX1 = Number(visual.bbox.x1);
  const rawY1 = Number(visual.bbox.y1);
  const rawX2 = Number(visual.bbox.x2);
  const rawY2 = Number(visual.bbox.y2);

  if (
    !Number.isFinite(rawX1) ||
    !Number.isFinite(rawY1) ||
    !Number.isFinite(rawX2) ||
    !Number.isFinite(rawY2)
  ) {
    return null;
  }

  const x1 = Math.max(0, Math.min(1000, rawX1));
  const y1 = Math.max(0, Math.min(1000, rawY1));
  const x2 = Math.max(0, Math.min(1000, rawX2));
  const y2 = Math.max(0, Math.min(1000, rawY2));

  if (x2 <= x1 || y2 <= y1) return null;

  // Loại các bbox vô lý quá nhỏ. Chúng thường là ký hiệu chứ không phải hình.
  if (x2 - x1 < 18 || y2 - y1 < 18) return null;

  const confidenceRaw = Number(visual.confidence ?? 0.8);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0.8;

  const containsAnswerText = Boolean(visual.containsAnswerText);
  const cropSafe = Boolean(visual.cropSafe);

  return {
    type: "image",
    description: String(visual.description || "").trim(),
    bbox: { x1, y1, x2, y2 },
    confidence,
    cropSafe,
    containsAnswerText,
  };
}

function bboxArea(bbox: any) {
  return Math.max(0, Number(bbox?.x2) - Number(bbox?.x1)) *
    Math.max(0, Number(bbox?.y2) - Number(bbox?.y1));
}

function bboxIoU(a: any, b: any) {
  const ix1 = Math.max(Number(a?.x1), Number(b?.x1));
  const iy1 = Math.max(Number(a?.y1), Number(b?.y1));
  const ix2 = Math.min(Number(a?.x2), Number(b?.x2));
  const iy2 = Math.min(Number(a?.y2), Number(b?.y2));
  const intersection =
    Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  if (!intersection) return 0;
  const union = bboxArea(a) + bboxArea(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

export function cleanAiResult(
  result: any,
  pageNumber: number,
  allowedQuestionKeys: string[],
) {
  const allowedSet = new Set(allowedQuestionKeys);
  const candidates: Array<{ questionKey: string; visual: any }> = [];

  for (const question of result.questions || []) {
    const questionKey = String(question?.questionKey || "").trim();

    if (!allowedSet.has(questionKey)) {
      console.warn("AI trả questionKey không hợp lệ:", {
        page: pageNumber,
        questionKey,
        allowedQuestionKeys,
      });
      continue;
    }

    const rawVisuals = Array.isArray(question?.visuals)
      ? question.visuals
      : [];

    for (const rawVisual of rawVisuals) {
      const visual = normalizeVisual(rawVisual);
      if (!visual) continue;

      // Edge Function không chuyển các crop nguy hiểm xuống frontend.
      if (!visual.cropSafe || visual.containsAnswerText) {
        console.warn("Bỏ visual không an toàn:", {
          page: pageNumber,
          questionKey,
          visual,
        });
        continue;
      }

      candidates.push({ questionKey, visual });
    }
  }

  // Visual tự tin hơn được quyền claim bbox trước.
  // Nếu hai câu khác nhau claim gần như cùng bbox, chỉ giữ một câu.
  candidates.sort((a, b) =>
    Number(b.visual.confidence || 0) - Number(a.visual.confidence || 0)
  );

  const claimed: Array<{ questionKey: string; bbox: any }> = [];
  const questionMap = new Map<string, any>();

  for (const candidate of candidates) {
    const duplicateAcrossQuestions = claimed.some(
      (entry) =>
        entry.questionKey !== candidate.questionKey &&
        bboxIoU(entry.bbox, candidate.visual.bbox) >= 0.86,
    );

    if (duplicateAcrossQuestions) {
      console.warn("Bỏ visual bị gán lặp cho câu khác:", {
        page: pageNumber,
        questionKey: candidate.questionKey,
        bbox: candidate.visual.bbox,
      });
      continue;
    }

    if (!questionMap.has(candidate.questionKey)) {
      questionMap.set(candidate.questionKey, {
        questionKey: candidate.questionKey,
        hasVisual: true,
        visuals: [],
      });
    }

    const target = questionMap.get(candidate.questionKey);
    const duplicateSameQuestion = target.visuals.some(
      (item: any) => bboxIoU(item.bbox, candidate.visual.bbox) >= 0.94,
    );
    if (duplicateSameQuestion) continue;

    target.visuals.push(candidate.visual);
    claimed.push({
      questionKey: candidate.questionKey,
      bbox: candidate.visual.bbox,
    });
  }

  return {
    page: pageNumber,
    questions: [...questionMap.values()],
  };
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json();

    // Health check không cần API key.
    if (body?.action === "health") {
      return jsonResponse({
        ok: true,
        version: VERSION,
        model: OPENROUTER_MODEL,
        openRouterAttempts: OPENROUTER_ATTEMPTS,
        maxTokens: OPENROUTER_MAX_TOKENS,
        forcedToolChoice: false,
        structuredOutputs: true,
        responseHealing: true,
        providerRequireParameters: true,
        parserRepair: true,
      });
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) {
      throw new EdgeHttpError("Thiếu secret OPENROUTER_API_KEY.", 500, false);
    }

    const pageNumber = Number(body?.pageNumber || 1);
    const imageDataUrl = String(body?.imageDataUrl || "");

    if (!imageDataUrl.startsWith("data:image/")) {
      return jsonResponse(
        {
          error: "Thiếu ảnh trang PDF hợp lệ.",
          version: VERSION,
          retryable: false,
        },
        400,
      );
    }

    const questionsOnPage = normalizeQuestionsOnPage(body?.questionsOnPage);

    if (!questionsOnPage.length) {
      return jsonResponse({
        ok: true,
        version: VERSION,
        model: OPENROUTER_MODEL,
        result: {
          page: pageNumber,
          questions: [],
        },
        diagnostics: {
          openRouterAttempt: 0,
          outputSource: "no_questions",
          reason: "Không có câu hợp lệ trên sourcePage này.",
        },
      });
    }

    const allowedQuestionKeys = questionsOnPage.map(
      (q: any) => q.questionKey,
    );

    const prompt = buildPrompt(pageNumber, questionsOnPage);

    const ai = await callOpenRouter(
      apiKey,
      prompt,
      imageDataUrl,
      pageNumber,
      allowedQuestionKeys,
    );

    const cleanResult = cleanAiResult(
      ai.result,
      pageNumber,
      allowedQuestionKeys,
    );

    return jsonResponse({
      ok: true,
      version: VERSION,
      model: OPENROUTER_MODEL,
      result: cleanResult,
      diagnostics: {
        openRouterAttempt: ai.attempt,
        finishReason: ai.finishReason,
        outputSource: "structured_output",
        contentLength: ai.contentLength,
        allowedQuestionKeys,
        detectedQuestionCount: cleanResult.questions.length,
        routerMetadata: ai.routerMetadata,
        usage: ai.usage,
      },
    });
  } catch (error) {
    console.error("EDGE FUNCTION ERROR:", error);

    const status =
      error instanceof EdgeHttpError ? error.status : 502;
    const retryable =
      error instanceof EdgeHttpError ? error.retryable : true;

    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
        version: VERSION,
        retryable,
      },
      status,
    );
  }
}

serve(handler);