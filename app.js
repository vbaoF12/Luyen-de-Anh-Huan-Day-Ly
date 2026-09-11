(() => {
  "use strict";

  const STORAGE_KEY = "anh_huan_physics_exam_results_v2";
  const EXAM_DRAFT_PREFIX = "anh_huan_full_exam_draft_v1";
  const TF_SCORE = { 0: 0, 1: 0.1, 2: 0.25, 3: 0.5, 4: 1 };
  const REQUIRED_COUNTS = { mcq: 18, tf: 4, short: 6 };

  const state = {
    screen: "home",
    candidate: { name: "", className: "" },
    examCatalog: [],
    selectedExamId: null,
    activeExam: null,
    items: [],
    currentIndex: 0,
    secondsLeft: 0,
    timerId: null,
    startedAt: null,
    submitted: false,
    answers: createEmptyAnswers(),
    latestResult: null,
    studentUser: null,
    studentProfile: null,
    teacherUser: null,
    dashboardResults: [],
    teacherExams: [],
    examDraft: null,
    reviewFlags: new Set(),
    questionObserver: null,
    questionScrollHandler: null,
    questionScrollFrame: null,
    questionJumpTimer: null,
    observerLockUntil: 0,
    autosaveTimer: null
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const physicsChartInstances = [];

  function destroyPhysicsCharts() {
    while (physicsChartInstances.length > 0) {
      const chart = physicsChartInstances.pop();
      try {
        chart.destroy();
      } catch (error) {
        console.warn("Không hủy được đồ thị cũ:", error);
      }
    }
  }

  function createEmptyAnswers() {
    return { mcq: {}, tf: {}, short: {} };
  }

  function createEmptyExamData() {
    return { passages: [], mcq: [], trueFalse: [], shortAnswer: [] };
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  async function initialize() {
    bindNavigation();
    bindHome();
    bindStudentAuthControls();
    bindExamControls();
    bindResultControls();
    bindDashboardControls();
    bindTeacherControls();
    bindExamManagerControls();
    bindCreateExamModalControls();
    renderDashboard([]);
    renderQuestionBuilderFields();
    bindAutoGrowTextareas();
    await restoreCurrentSession();
  }

  function bindNavigation() {
    $$('[data-screen]').forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        const target = element.dataset.screen;
        if (target === "home" && state.screen === "exam" && !state.submitted) {
          if (!window.confirm("Bài làm đang diễn ra. Bạn có chắc muốn rời khỏi đề thi?")) return;
          stopTimer();
        }
        showScreen(target);
      });
    });
  }

  function bindHome() {
    $("#start-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const selectedExam = state.examCatalog.find((exam) => exam.id === state.selectedExamId);
      const profile = state.studentProfile;

      if (!state.studentUser || !profile) {
        showToast("Vui lòng đăng nhập tài khoản học sinh trước.");
        showStudentAuthScreen();
        return;
      }
      if (!selectedExam) {
        showToast("Vui lòng chọn một đề trong kho đề luyện.");
        return;
      }

      const startButton = $("#start-exam-submit");
      startButton.disabled = true;
      startButton.textContent = "Đang mở đề...";
      try {
        startExam(profile.fullName, profile.className, selectedExam);
      } finally {
        startButton.disabled = false;
        startButton.textContent = "Bắt đầu làm bài";
      }
    });
  }

  function bindStudentAuthControls() {
    $$('[data-student-auth-tab]').forEach((button) => {
      button.addEventListener("click", () => switchStudentAuthMode(button.dataset.studentAuthTab));
    });
    $("#student-login-form")?.addEventListener("submit", handleStudentLogin);
    $("#student-register-form")?.addEventListener("submit", handleStudentRegister);
    $("#student-logout-button")?.addEventListener("click", handleStudentLogout);
    $("#student-auth-teacher-button")?.addEventListener("click", openTeacherAccess);
    $$('[data-toggle-password]').forEach((button) => {
      button.addEventListener("click", () => toggleStudentPassword(button));
    });
  }

  function bindExamControls() {
    $$('[data-submit-exam]').forEach((button) => button.addEventListener("click", openSubmitModal));
    $("#confirm-submit-button")?.addEventListener("click", () => submitExam(false));
    $$('[data-close-modal]').forEach((element) => element.addEventListener("click", closeSubmitModal));
    $("#mobile-question-map-button")?.addEventListener("click", openQuestionMap);
    $("#floating-question-map-button")?.addEventListener("click", openQuestionMap);
    $("#close-question-map-button")?.addEventListener("click", closeQuestionMap);
    $("#question-map-backdrop")?.addEventListener("click", closeQuestionMap);
    window.addEventListener("resize", () => {
      if (window.innerWidth > 1000) closeQuestionMap();
    });
  }

  function bindResultControls() {
    $("#retry-button").addEventListener("click", () => {
      if (state.activeExam) startExam(state.candidate.name, state.candidate.className, state.activeExam);
    });
    $("#view-dashboard-button").addEventListener("click", openTeacherAccess);
  }

  function bindDashboardControls() {
    $("#refresh-dashboard-button")?.addEventListener("click", async () => {
      const activePanel = $(".teacher-tab.active")?.dataset.teacherTab || "results";
      if (activePanel === "exams") await loadTeacherExams();
      else await loadTeacherDashboard(false);
    });
    $("#export-button").addEventListener("click", exportCsv);
    $("#logout-teacher-button")?.addEventListener("click", handleTeacherLogout);
    $("#search-result").addEventListener("input", renderResultsTable);
    $("#class-filter").addEventListener("change", renderResultsTable);
    $("#exam-filter").addEventListener("change", renderResultsTable);

    $$('[data-teacher-tab]').forEach((button) => {
      button.addEventListener("click", async () => {
        const panel = button.dataset.teacherTab;
        showTeacherPanel(panel);
        if (panel === "exams") await loadTeacherExams();
      });
    });
  }

  function bindTeacherControls() {
    $("#teacher-dashboard-button")?.addEventListener("click", openTeacherAccess);
    $("#teacher-login-form")?.addEventListener("submit", handleTeacherLogin);
    $("#teacher-magic-link-button")?.addEventListener("click", handleTeacherMagicLink);
    $("#close-teacher-login")?.addEventListener("click", closeTeacherLoginModal);
    $("#toggle-teacher-password")?.addEventListener("click", toggleTeacherPassword);
    $$('[data-close-teacher-login]').forEach((element) => {
      element.addEventListener("click", closeTeacherLoginModal);
    });
  }

  function bindExamManagerControls() {
    $("#new-exam-button")?.addEventListener("click", openCreateExamModal);
    $("#seed-default-exam-button")?.addEventListener("click", seedDefaultExam);
    $("#save-exam-draft-button")?.addEventListener("click", () => saveExamDraft(false));
    $("#publish-exam-button")?.addEventListener("click", handlePublishExam);
    $("#delete-exam-button")?.addEventListener("click", deleteCurrentExam);
    $("#question-type-input")?.addEventListener("change", renderQuestionBuilderFields);
    $("#add-question-button")?.addEventListener("click", addQuestionToDraft);
    $("#add-passage-button")?.addEventListener("click", addPassageToDraft);
  }

  // ============================================================
  // QUẢN LÝ MODAL TẠO ĐỀ THI TỰ ĐỘNG TỪ FILE PDF
  // ============================================================
  function openCreateExamModal() {
    if (!state.teacherUser) {
      showToast("Vui lòng đăng nhập tài khoản giáo viên.");
      openTeacherLoginModal();
      return;
    }

    state.selectedPdfFile = null;
    state.extractedExamData = null;

    // Reset giao diện dropzone & preview
    const fileInput = $("#pdf-file-input");
    if (fileInput) fileInput.value = "";
    $("#pdf-dropzone-prompt")?.removeAttribute("hidden");
    $("#pdf-file-preview")?.setAttribute("hidden", "true");
    $("#pdf-dropzone")?.classList.remove("dragover");

    // Reset giao diện tiến trình
    const progressPanel = $("#pdf-progress-panel");
    if (progressPanel) progressPanel.hidden = true;
    const progressFill = $("#pdf-progress-fill");
    if (progressFill) progressFill.style.width = "0%";
    const progressPercent = $("#pdf-progress-percent");
    if (progressPercent) progressPercent.textContent = "0%";
    const progressStatus = $("#pdf-progress-status");
    if (progressStatus) progressStatus.textContent = "Đang chuẩn bị xử lý...";
    const progressLog = $("#pdf-progress-log");
    if (progressLog) progressLog.innerHTML = "";

    // Reset AI extract panels
    const extractProgress = $("#pdf-extract-progress-panel");
    if (extractProgress) extractProgress.hidden = true;
    const extractFill = $("#pdf-extract-fill");
    if (extractFill) extractFill.style.width = "0%";
    const previewPanel = $("#pdf-preview-panel");
    if (previewPanel) previewPanel.hidden = true;

    // Gợi ý thông tin đề thi
    const nextNum = (state.teacherExams?.length || 0) + 1;
    const padNum = String(nextNum).padStart(2, "0");
    const codeInput = $("#pdf-exam-code");
    if (codeInput) codeInput.value = `VL12-DE-${padNum}`;
    const titleInput = $("#pdf-exam-title");
    if (titleInput) titleInput.value = `Đề luyện thi Vật lí THPT số ${padNum}`;
    const durationInput = $("#pdf-exam-duration");
    if (durationInput) durationInput.value = 50;
    const publishInput = $("#pdf-exam-publish");
    if (publishInput) publishInput.checked = false;

    // Reset nút extract & submit & thông báo
    const extractBtn = $("#extract-questions-button");
    if (extractBtn) {
      extractBtn.disabled = true;
      const span = extractBtn.querySelector("span");
      if (span) span.textContent = "Trích xuất câu hỏi bằng AI";
    }
    const submitBtn = $("#start-pdf-exam-button");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.remove("is-loading");
      const span = submitBtn.querySelector("span");
      if (span) span.textContent = "🚀 Lưu lên Supabase";
    }
    const cancelBtn = $("#cancel-create-exam-button");
    if (cancelBtn) cancelBtn.disabled = false;
    const msg = $("#create-exam-message");
    if (msg) msg.textContent = "";

    // Mặc định mở tab PDF
    switchCreateExamTab("pdf");

    // Mở modal
    const modal = $("#create-exam-modal");
    if (modal) {
      modal.classList.add("open", "active");
      modal.setAttribute("aria-hidden", "false");
      console.log("🚀 Đã mở Modal Tạo đề thi mới");
    }
  }

  function closeCreateExamModal() {
    const modal = $("#create-exam-modal");
    if (modal) {
      modal.classList.remove("open", "active");
      modal.setAttribute("aria-hidden", "true");
    }
    state.selectedPdfFile = null;
  }

  function switchCreateExamTab(tabName) {
    const isPdf = tabName === "pdf";
    $("#tab-btn-pdf")?.classList.toggle("active", isPdf);
    $("#tab-btn-pdf")?.setAttribute("aria-selected", isPdf ? "true" : "false");
    $("#tab-btn-manual")?.classList.toggle("active", !isPdf);
    $("#tab-btn-manual")?.setAttribute("aria-selected", !isPdf ? "true" : "false");

    const pdfPanel = $("#tab-content-pdf");
    const manualPanel = $("#tab-content-manual");
    if (pdfPanel) pdfPanel.hidden = !isPdf;
    if (manualPanel) manualPanel.hidden = isPdf;
  }

  async function handlePdfFileSelect(file) {
    if (!file) return;
    const fileNameLower = (file.name || "").toLowerCase();
    if (!fileNameLower.endsWith(".pdf") && file.type !== "application/pdf") {
      showToast("Vui lòng chọn file có định dạng PDF.");
      return;
    }

    state.selectedPdfFile = file;

    // Hiển thị thẻ thông tin file
    $("#pdf-dropzone-prompt")?.setAttribute("hidden", "true");
    $("#pdf-file-preview")?.removeAttribute("hidden");
    const filenameEl = $("#pdf-preview-filename");
    if (filenameEl) filenameEl.textContent = file.name;
    const detailsEl = $("#pdf-preview-details");
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    if (detailsEl) detailsEl.textContent = `Đang đọc số trang... (${sizeMb} MB)`;

    // Gợi ý tên đề thi từ tên file
    const cleanTitle = file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
    if (cleanTitle) {
      const titleInput = $("#pdf-exam-title");
      if (titleInput) titleInput.value = cleanTitle;
    }

    // Reset extracted data khi đổi file
    state.extractedExamData = null;
    const previewPanel = $("#pdf-preview-panel");
    if (previewPanel) previewPanel.hidden = true;
    const extractProgress = $("#pdf-extract-progress-panel");
    if (extractProgress) extractProgress.hidden = true;
    const saveBtn = $("#start-pdf-exam-button");
    if (saveBtn) saveBtn.disabled = true;

    // Đọc số trang PDF
    try {
      const pdf = await loadPhysicsPdf(file);
      if (detailsEl) detailsEl.textContent = `${pdf.numPages} trang · ${sizeMb} MB`;
      const extractBtn = $("#extract-questions-button");
      if (extractBtn) extractBtn.disabled = false;
    } catch (err) {
      console.warn("Không đọc được metadata PDF:", err);
      if (detailsEl) detailsEl.textContent = `${sizeMb} MB`;
      const extractBtn = $("#extract-questions-button");
      if (extractBtn) extractBtn.disabled = false;
    }
  }

  async function buildExamDataFromPdf(pdf, defaultTitle, durationMinutes = 50) {
    // 1. Tạo examData cơ sở với cấu trúc chuẩn
    const baseData = typeof EXAM_DATA !== "undefined"
      ? deepClone(EXAM_DATA)
      : createEmptyExamData();

    const examData = {
      title: defaultTitle || baseData.title || "Đề luyện thi Vật lí THPT",
      durationMinutes: Number(durationMinutes) || 50,
      passages: baseData.passages || [],
      mcq: deepClone(baseData.mcq || []),
      trueFalse: deepClone(baseData.trueFalse || []),
      shortAnswer: deepClone(baseData.shortAnswer || [])
    };

    // 2. Quét qua từng trang để xác định sourcePage
    const pageQuestionMap = new Map(); // questionKey -> pageNumber

    for (let p = 1; p <= pdf.numPages; p += 1) {
      try {
        const page = await pdf.getPage(p);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((it) => it.str).join(" ");

        // Regex MCQ 1..18
        const mcqMatches = [...pageText.matchAll(/(?:câu|bài)\s*([1-9]|1[0-8])\b/gi)];
        for (const m of mcqMatches) {
          const num = Number(m[1]);
          if (num >= 1 && num <= 18) {
            const key = `mcq-${num}`;
            if (!pageQuestionMap.has(key)) pageQuestionMap.set(key, p);
          }
        }

        // Regex PHẦN II: True/False 1..4
        const tfMatches = [...pageText.matchAll(/(?:phần\s*ii|đúng\s*sai)[\s\S]*?(?:câu|bài)\s*([1-4])\b/gi)];
        for (const m of tfMatches) {
          const num = Number(m[1]);
          if (num >= 1 && num <= 4) {
            const key = `tf-${num}`;
            if (!pageQuestionMap.has(key)) pageQuestionMap.set(key, p);
          }
        }

        // Regex PHẦN III: Short Answer 1..6
        const shortMatches = [...pageText.matchAll(/(?:phần\s*iii|trả\s*lời\s*ngắn)[\s\S]*?(?:câu|bài)\s*([1-6])\b/gi)];
        for (const m of shortMatches) {
          const num = Number(m[1]);
          if (num >= 1 && num <= 6) {
            const key = `short-${num}`;
            if (!pageQuestionMap.has(key)) pageQuestionMap.set(key, p);
          }
        }
      } catch (scanErr) {
        console.warn(`Không đọc được text trang ${p}:`, scanErr);
      }
    }

    // 3. Gán sourcePage chuẩn xác cho từng câu
    const totalPages = pdf.numPages;

    examData.mcq.forEach((q, idx) => {
      const num = idx + 1;
      const key = `mcq-${num}`;
      const detectedPage = pageQuestionMap.get(key);
      if (detectedPage) {
        q.sourcePage = detectedPage;
      } else {
        // Phân bổ đều các câu MCQ theo số trang (trừ trang cuối cho TF/Short)
        const maxPagesForMcq = Math.max(1, totalPages > 1 ? totalPages - 1 : 1);
        q.sourcePage = Math.min(maxPagesForMcq, Math.max(1, Math.ceil((num / 18) * maxPagesForMcq)));
      }
    });

    examData.trueFalse.forEach((q, idx) => {
      const num = idx + 1;
      const key = `tf-${num}`;
      q.sourcePage = pageQuestionMap.get(key) || totalPages;
    });

    examData.shortAnswer.forEach((q, idx) => {
      const num = idx + 1;
      const key = `short-${num}`;
      q.sourcePage = pageQuestionMap.get(key) || totalPages;
    });

    return examData;
  }

  // ============================================================
  // AI TRÍCH XUẤT CÂU HỎI TỪ PDF
  // ============================================================

  /**
   * Gọi Edge Function extract-exam-questions để AI đọc ảnh trang PDF
   * và trả về nội dung câu hỏi + đáp án.
   */
  async function callExtractExamQuestionsApi(imageDataUrl, pageNumber, totalPages, mode = "unified") {
    const { data, error } = await window.supabaseClient.functions.invoke(
      "extract-exam-questions",
      { body: { pageNumber, totalPages, imageDataUrl, mode } }
    );
    if (error) {
      let detail = "";
      try {
        if (error.context) { const payload = await error.context.json(); detail = payload?.error || JSON.stringify(payload); }
      } catch { /* bỏ qua */ }
      throw new Error(detail || error.message || `Không trích xuất được trang ${pageNumber}.`);
    }
    if (!data?.result) throw new Error(`AI trả kết quả sai schema ở trang ${pageNumber}.`);
    return data.result;
  }

  /**
   * Chuyển đổi dữ liệu AI trích xuất thành exam_data chuẩn của hệ thống.
   * Hỗ trợ trích xuất đáp án trực tiếp từng câu (inline) hoặc từ bảng đáp án (answerTable).
   */
  function mergeExtractedIntoExamData(allPageResults, answersResult, title, duration) {
    // Gom tất cả câu từ các trang
    const mcqMap = new Map();   // number → {stem, options, answer, sourcePage, explanation}
    const tfMap = new Map();    // number → {context, statements, sourcePage}
    const shortMap = new Map(); // number → {stem, answer, sourcePage}

    const mergedAnswerTable = {
      mcq: { ...(answersResult?.mcqAnswers || {}) },
      tf: { ...(answersResult?.tfAnswers || {}) },
      short: { ...(answersResult?.shortAnswers || {}) }
    };

    for (const pageResult of allPageResults) {
      const p = pageResult.page;
      for (const q of (pageResult.mcq || [])) {
        if (!mcqMap.has(q.number)) mcqMap.set(q.number, { ...q, sourcePage: p });
      }
      for (const q of (pageResult.trueFalse || [])) {
        if (!tfMap.has(q.number)) tfMap.set(q.number, { ...q, sourcePage: p });
      }
      for (const q of (pageResult.shortAnswer || [])) {
        if (!shortMap.has(q.number)) shortMap.set(q.number, { ...q, sourcePage: p });
      }
      if (pageResult.answerTable) {
        Object.assign(mergedAnswerTable.mcq, pageResult.answerTable.mcqAnswers || {});
        Object.assign(mergedAnswerTable.tf, pageResult.answerTable.tfAnswers || {});
        Object.assign(mergedAnswerTable.short, pageResult.answerTable.shortAnswers || {});
      }
    }

    // Xây dựng danh sách MCQ (linh hoạt theo cấu trúc đề)
    const mcqList = [];
    const maxMcqFound = mcqMap.size ? Math.max(...Array.from(mcqMap.keys())) : 0;
    const hasOtherParts = tfMap.size > 0 || shortMap.size > 0;
    // Nếu đề 3 phần chuẩn 2025 thì mặc định tối thiểu 18 câu; nếu đề 40 câu truyền thống thì lấy theo maxMcqFound
    const totalMcq = maxMcqFound > 18
      ? maxMcqFound
      : (hasOtherParts ? Math.max(18, maxMcqFound) : (maxMcqFound || 18));

    for (let i = 1; i <= totalMcq; i += 1) {
      const extracted = mcqMap.get(i);
      // Ưu tiên đáp án inline từ câu hỏi ("A"|"B"|"C"|"D"), sau đó tới bảng đáp án
      const rawAns = extracted?.answer || mergedAnswerTable.mcq[String(i)] || "";
      const answerIndex = ["A", "B", "C", "D"].indexOf(String(rawAns).trim().toUpperCase());

      // Làm sạch triệt để tiền tố A./B./C./D. ở từng phương án
      const cleanOptions = (extracted?.options?.length === 4 ? extracted.options : ["", "", "", ""]).map((opt, idx) =>
        cleanupOptionText(opt, idx)
      );

      mcqList.push({
        id: `mcq-${i}`,
        stem: extracted?.stem || `Câu ${i}`,
        options: cleanOptions,
        answer: answerIndex >= 0 ? answerIndex : null,
        explanation: extracted?.explanation || "",
        sourcePage: extracted?.sourcePage || Math.ceil((i / (totalMcq || 1)) * 6)
      });
    }

    // Xây dựng danh sách TF (chỉ tạo nếu đề có Phần II hoặc có câu Đúng/Sai)
    const tfList = [];
    const maxTfFound = tfMap.size ? Math.max(...Array.from(tfMap.keys())) : 0;
    const totalTf = hasOtherParts ? Math.max(4, maxTfFound) : maxTfFound;

    for (let i = 1; i <= totalTf; i += 1) {
      const extracted = tfMap.get(i);
      const tfTableAns = mergedAnswerTable.tf[String(i)] || {};

      const statements = (extracted?.statements || []).map((s) => {
        let isCorrect = s.correct;
        if (isCorrect === null || isCorrect === undefined) {
          if (tfTableAns[s.label] !== undefined) isCorrect = Boolean(tfTableAns[s.label]);
        }
        return {
          label: s.label,
          text: s.text,
          correct: isCorrect !== null && isCorrect !== undefined ? Boolean(isCorrect) : null
        };
      });

      // Điền 4 ý nếu thiếu
      const labels = ["a", "b", "c", "d"];
      while (statements.length < 4) {
        const label = labels[statements.length];
        const isCorrect = tfTableAns[label] !== undefined ? Boolean(tfTableAns[label]) : null;
        statements.push({ label, text: "", correct: isCorrect });
      }

      tfList.push({
        id: `tf-${i}`,
        context: extracted?.context || `Câu ${i} - Phần II`,
        statements,
        sourcePage: extracted?.sourcePage || Math.ceil((i / (totalTf || 1)) * 3) + 6
      });
    }

    // Xây dựng danh sách Short Answer (chỉ tạo nếu đề có phần trả lời ngắn)
    const shortList = [];
    const maxShortFound = shortMap.size ? Math.max(...Array.from(shortMap.keys())) : 0;
    const totalShort = hasOtherParts ? Math.max(6, maxShortFound) : maxShortFound;

    for (let i = 1; i <= totalShort; i += 1) {
      const extracted = shortMap.get(i);
      const ans = extracted?.answer || mergedAnswerTable.short[String(i)] || "";
      shortList.push({
        id: `short-${i}`,
        stem: extracted?.stem || `Câu ${i} - Phần III`,
        answer: String(ans || "").trim(),
        explanation: extracted?.explanation || "",
        sourcePage: extracted?.sourcePage || 8
      });
    }

    return {
      title: title || "Đề luyện thi Vật lí THPT",
      durationMinutes: Number(duration) || 50,
      passages: [],
      mcq: mcqList,
      trueFalse: tfList,
      shortAnswer: shortList
    };
  }

  /**
   * Helper format text cho Preview Panel:
   * Chạy wrapLooseLatex + escapeHtml để công thức KaTeX render mượt mà.
   */
  function formatPreviewMath(value) {
    if (!value) return "";
    const wrapped = wrapLooseLatex(String(value));
    return escapeHtml(wrapped).replace(/\r?\n/g, "<br>");
  }

  /**
   * Render Preview Panel sau khi AI trích xuất xong.
   */
  function renderPreviewPanel(examData) {
    // Thống kê
    const mcqCount = examData.mcq.length;
    const tfCount = examData.trueFalse.length;
    const shortCount = examData.shortAnswer.length;
    const countEl = $("#preview-summary-counts");
    const partsSummary = [];
    if (mcqCount > 0) partsSummary.push(`${mcqCount} MCQ`);
    if (tfCount > 0) partsSummary.push(`${tfCount} Đúng/Sai`);
    if (shortCount > 0) partsSummary.push(`${shortCount} Trả lời ngắn`);
    if (countEl) countEl.textContent = partsSummary.join(" · ") || `${mcqCount + tfCount + shortCount} câu`;

    // MCQ
    const mcqSection = $("#preview-mcq-section");
    const mcqList = $("#preview-mcq-list");
    const mcqCountEl = $("#preview-mcq-count");
    if (mcqSection && mcqList && mcqCount > 0) {
      mcqSection.hidden = false;
      if (mcqCountEl) mcqCountEl.textContent = `${mcqCount} câu`;
      const optLetters = ["A", "B", "C", "D"];
      mcqList.innerHTML = examData.mcq.map((q) => {
        const optionsHtml = (q.options || []).map((opt, idx) => {
          const isCorrect = q.answer === idx;
          const cleanOpt = cleanupOptionText(opt, idx);
          const mathOpt = formatPreviewMath(cleanOpt);
          return `<div class="preview-option${isCorrect ? " correct-answer" : ""}">
            <span class="option-letter">${optLetters[idx]}.</span>
            <span>${mathOpt || "<em style=\"color:#94a3b8\">Chưa có nội dung</em>"}</span>
            ${isCorrect ? "<span class=\"correct-badge\">✅</span>" : ""}
          </div>`;
        }).join("");
        return `<div class="preview-q-card">
          <div class="preview-q-header">
            <span class="preview-q-num">${q.id?.replace("mcq-", "") || "?"}</span>
            <span class="preview-q-stem">${formatPreviewMath(q.stem)}</span>
          </div>
          <div class="preview-options">${optionsHtml}</div>
        </div>`;
      }).join("");
    } else if (mcqSection) {
      mcqSection.hidden = true;
    }

    // True/False
    const tfSection = $("#preview-tf-section");
    const tfList = $("#preview-tf-list");
    const tfCountEl = $("#preview-tf-count");
    if (tfSection && tfList && tfCount > 0) {
      tfSection.hidden = false;
      if (tfCountEl) tfCountEl.textContent = `${tfCount} câu`;
      tfList.innerHTML = examData.trueFalse.map((q) => {
        const contextHtml = q.context
          ? `<div class="preview-tf-context">${formatPreviewMath(q.context)}</div>`
          : "";
        const stmtsHtml = (q.statements || []).map((s) => {
          const hasAnswer = s.correct !== null && s.correct !== undefined;
          const cls = s.correct === true ? "stmt-true" : s.correct === false ? "stmt-false" : "";
          const badgeClass = s.correct === true ? "true" : s.correct === false ? "false" : "unknown";
          const badgeHtml = hasAnswer
            ? `<span class="stmt-badge ${badgeClass}">${s.correct ? "Đúng" : "Sai"}</span>`
            : `<span class="stmt-badge unknown" title="Chưa tìm thấy đáp án">—</span>`;
          return `<div class="preview-statement ${cls}">
            <span class="stmt-label">${escapeHtml(s.label)}.</span>
            <span>${formatPreviewMath(s.text) || "<em style=\"color:#94a3b8\">Chưa có nội dung</em>"}</span>
            ${badgeHtml}
          </div>`;
        }).join("");
        return `<div class="preview-q-card">
          <div class="preview-q-header">
            <span class="preview-q-num tf-num">${q.id?.replace("tf-", "") || "?"}</span>
            <span class="preview-q-stem">${q.context ? "(Xem dữ kiện bên dưới)" : "Câu đúng/sai"}</span>
          </div>
          ${contextHtml}
          <div class="preview-tf-statements">${stmtsHtml}</div>
        </div>`;
      }).join("");
    } else if (tfSection) {
      tfSection.hidden = true;
    }

    // Short Answer
    const shortSection = $("#preview-short-section");
    const shortListEl = $("#preview-short-list");
    const shortCountEl = $("#preview-short-count");
    if (shortSection && shortListEl && shortCount > 0) {
      shortSection.hidden = false;
      if (shortCountEl) shortCountEl.textContent = `${shortCount} câu`;
      shortListEl.innerHTML = examData.shortAnswer.map((q) => {
        const answerHtml = q.answer
          ? `<span class="short-answer-value">${formatPreviewMath(q.answer)}</span>`
          : `<span class="short-answer-empty">Chưa có đáp án</span>`;
        return `<div class="preview-q-card">
          <div class="preview-q-header">
            <span class="preview-q-num short-num">${q.id?.replace("short-", "") || "?"}</span>
            <span class="preview-q-stem">${formatPreviewMath(q.stem)}</span>
          </div>
          <div class="preview-short-answer">
            <span class="short-answer-label">Đáp án:</span>
            ${answerHtml}
          </div>
        </div>`;
      }).join("");
    } else if (shortSection) {
      shortSection.hidden = true;
    }

    // Hiện panel và render KaTeX
    const panel = $("#pdf-preview-panel");
    if (panel) {
      panel.hidden = false;
      const triggerMath = () => {
        renderMathContent(panel);
      };
      triggerMath();
      window.requestAnimationFrame(triggerMath);
      window.setTimeout(triggerMath, 150);
    }
  }

  /**
   * Xử lý trích xuất câu hỏi bằng AI từ PDF.
   * Quét toàn bộ các trang (1..totalPages) và nhận diện cả câu hỏi lẫn đáp án.
   */
  async function handleExtractQuestionsFromPdf() {
    const file = state.selectedPdfFile;
    if (!file) { showToast("Vui lòng chọn một file PDF trước."); return; }
    if (!state.teacherUser) { showToast("Vui lòng đăng nhập tài khoản giáo viên."); openTeacherLoginModal(); return; }

    const title = $("#pdf-exam-title")?.value.trim() || "Đề luyện thi Vật lí THPT";
    const duration = Number($("#pdf-exam-duration")?.value) || 50;

    const extractBtn = $("#extract-questions-button");
    const saveBtn = $("#start-pdf-exam-button");
    const cancelBtn = $("#cancel-create-exam-button");
    const msgEl = $("#create-exam-message");

    // UI: bắt đầu loading
    if (extractBtn) { extractBtn.disabled = true; const sp = extractBtn.querySelector("span"); if (sp) sp.textContent = "Đang trích xuất..."; }
    if (saveBtn) saveBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (msgEl) msgEl.textContent = "";

    // Ẩn preview cũ, hiện progress
    const previewPanel = $("#pdf-preview-panel");
    if (previewPanel) previewPanel.hidden = true;
    const extractProgress = $("#pdf-extract-progress-panel");
    if (extractProgress) extractProgress.hidden = false;
    const extractFill = $("#pdf-extract-fill");
    const extractStatus = $("#pdf-extract-status");
    const extractPageInfo = $("#pdf-extract-page-info");

    function setExtractProgress(pct, statusMsg, pageInfo = "") {
      if (extractFill) extractFill.style.width = `${pct}%`;
      if (extractStatus) extractStatus.textContent = statusMsg;
      if (extractPageInfo) extractPageInfo.textContent = pageInfo;
    }

    try {
      setExtractProgress(5, "Đang nạp file PDF...");
      const pdf = await loadPhysicsPdf(file);
      const totalPages = pdf.numPages;

      // Quét TẤT CẢ các trang (từ 1 đến totalPages)
      const allPageResults = [];

      for (let p = 1; p <= totalPages; p += 1) {
        const pct = 5 + Math.round(((p - 1) / totalPages) * 85);
        setExtractProgress(pct, `AI đang phân tích câu hỏi & đáp án...`, `Trang ${p}/${totalPages}`);

        try {
          const canvas = await renderPhysicsPdfPage(pdf, p, 2);
          const imageDataUrl = canvasToAiImage(canvas);
          const result = await callExtractExamQuestionsApi(imageDataUrl, p, totalPages, "unified");
          if (result.mcq?.length || result.trueFalse?.length || result.shortAnswer?.length || result.answerTable) {
            allPageResults.push(result);
            console.log(`✅ Trang ${p}: ${result.mcq?.length || 0} MCQ, ${result.trueFalse?.length || 0} TF, ${result.shortAnswer?.length || 0} Short`);
          }
        } catch (pageErr) {
          console.warn(`⚠️ Không đọc được trang ${p}:`, pageErr.message);
        }
      }

      setExtractProgress(92, "Đang tổng hợp dữ liệu đề thi...");

      // Merge thành examData chuẩn
      const examData = mergeExtractedIntoExamData(allPageResults, null, title, duration);
      state.extractedExamData = examData;

      setExtractProgress(100, "Trích xuất hoàn tất!");

      // Ẩn progress, hiện preview
      if (extractProgress) extractProgress.hidden = true;
      renderPreviewPanel(examData);

      // Enable nút lưu
      if (saveBtn) saveBtn.disabled = false;

      const mcqFilled = examData.mcq.filter((q) => q.stem && q.stem !== `Câu ${q.id?.replace("mcq-", "")}`).length;
      const tfFilled = examData.trueFalse.filter((q) => q.statements?.some((s) => s.text)).length;
      const shortFilled = examData.shortAnswer.filter((q) => q.stem && !q.stem.includes("Phần III")).length;

      showToast(`AI đã trích xuất: ${mcqFilled} MCQ, ${tfFilled} Đúng/Sai, ${shortFilled} Trả lời ngắn. Kiểm tra preview rồi nhấn Lưu!`);

    } catch (err) {
      console.error("Lỗi trích xuất câu hỏi:", err);
      if (extractProgress) extractProgress.hidden = true;
      if (msgEl) msgEl.textContent = `❌ Lỗi trích xuất: ${err.message || String(err)}`;
      showToast(`Lỗi: ${err.message || "Không trích xuất được câu hỏi."}`);
    } finally {
      if (extractBtn) {
        extractBtn.disabled = false;
        const sp = extractBtn.querySelector("span");
        if (sp) sp.textContent = "Trích xuất câu hỏi bằng AI";
      }
      if (cancelBtn) cancelBtn.disabled = false;
    }
  }

  async function handleCreateExamFromPdf(event) {
    if (event) event.preventDefault();

    const file = state.selectedPdfFile;
    if (!file) {
      showToast("Vui lòng chọn một file PDF trước.");
      return;
    }

    if (!state.teacherUser) {
      showToast("Vui lòng đăng nhập tài khoản giáo viên.");
      openTeacherLoginModal();
      return;
    }

    const code = $("#pdf-exam-code").value.trim().toUpperCase().replace(/\s+/g, "-");
    const title = $("#pdf-exam-title").value.trim();
    const duration = Number($("#pdf-exam-duration").value) || 50;
    const isPublished = $("#pdf-exam-publish").checked;

    if (!code || !title) {
      showToast("Vui lòng nhập đầy đủ Mã đề và Tên đề thi.");
      return;
    }

    // Phải trích xuất câu hỏi trước
    if (!state.extractedExamData) {
      showToast("Vui lòng nhấn 'Trích xuất câu hỏi bằng AI' trước khi lưu.");
      return;
    }

    const submitBtn = $("#start-pdf-exam-button");
    const cancelBtn = $("#cancel-create-exam-button");
    const extractBtn = $("#extract-questions-button");
    submitBtn.disabled = true;
    submitBtn.classList.add("is-loading");
    cancelBtn.disabled = true;
    if (extractBtn) extractBtn.disabled = true;

    // Hiển thị panel tiến trình lưu
    const progressPanel = $("#pdf-progress-panel");
    if (progressPanel) progressPanel.hidden = false;

    const fill = $("#pdf-progress-fill");
    const percentText = $("#pdf-progress-percent");
    const statusText = $("#pdf-progress-status");
    const logBox = $("#pdf-progress-log");

    function setProgress(percent, status, logMsg = "", logType = "info") {
      if (percent !== null && fill) fill.style.width = `${percent}%`;
      if (percent !== null && percentText) percentText.textContent = `${percent}%`;
      if (status && statusText) statusText.textContent = status;
      if (logMsg && logBox) {
        const p = document.createElement("p");
        p.className = `log-${logType}`;
        p.textContent = `[${new Date().toLocaleTimeString()}] ${logMsg}`;
        logBox.appendChild(p);
        logBox.scrollTop = logBox.scrollHeight;
      }
    }

    try {
      // Dùng examData đã được AI trích xuất, cập nhật title/duration
      const examData = {
        ...state.extractedExamData,
        title,
        durationMinutes: duration
      };

      setProgress(15, "Đang tạo bản ghi đề thi trên Supabase...", `💾 Đang đăng ký đề thi ${code} vào hệ thống...`, "info");

      // Kiểm tra đề cũ nếu đã tồn tại
      const { data: existing } = await window.supabaseClient
        .from("exams")
        .select("id")
        .eq("code", code)
        .maybeSingle();

      const examPayload = {
        code,
        title,
        description: `Đề thi tạo tự động từ file PDF bằng AI: ${file.name}`,
        duration_minutes: duration,
        grade_level: "THPT",
        is_published: false,
        exam_data: examData,
        created_by: state.teacherUser.id,
        updated_at: new Date().toISOString()
      };

      let examId;
      if (existing) {
        const { data: updated, error: uErr } = await window.supabaseClient
          .from("exams")
          .update(examPayload)
          .eq("id", existing.id)
          .select()
          .single();
        if (uErr) throw uErr;
        examId = updated.id;
        setProgress(30, "Đã cập nhật đề thi", `🔄 Đã cập nhật đề thi [${code}].`, "info");
      } else {
        const { data: inserted, error: iErr } = await window.supabaseClient
          .from("exams")
          .insert(examPayload)
          .select()
          .single();
        if (iErr) throw iErr;
        examId = inserted.id;
        setProgress(30, "Đã tạo đề thi thành công", `✅ Đã tạo đề thi [${code}] trên Supabase.`, "success");
      }

      setProgress(35, "Bắt đầu AI phân tích và bóc tách hình ảnh...", `🤖 Bắt đầu bóc tách hình ảnh từ PDF...`, "info");

      // Chạy pipeline cắt ảnh tự động
      await processAllPhysicsPdfVisuals(file, code, {
        dryRun: false,
        renderScale: 2,
        minConfidence: 0.65,
        onProgress: ({ type, pageNumber, totalPages, questionKey }) => {
          if (type === "page_start") {
            const curP = 35 + Math.round(((pageNumber - 1) / totalPages) * 50);
            setProgress(curP, `Đang phân tích trang ${pageNumber}/${totalPages}...`, `📄 Trang ${pageNumber}/${totalPages}: AI đang rà soát hình ảnh...`, "info");
          } else if (type === "visual_uploaded") {
            setProgress(null, null, `📷 Đã crop & upload ảnh cho ${questionKey}`, "success");
          } else if (type === "saving_db") {
            setProgress(90, "Đang lưu trữ dữ liệu ảnh hoàn tất...", `💾 Đang cập nhật hình ảnh vào database...`, "info");
          }
        }
      });

      // Nếu người dùng chọn Xuất bản ngay
      if (isPublished) {
        setProgress(95, "Đang xuất bản đề thi cho học sinh...", `📢 Xuất bản đề thi...`, "info");
        const { error: pubErr } = await window.supabaseClient
          .from("exams")
          .update({ is_published: true })
          .eq("id", examId);
        if (pubErr) console.warn("Lỗi xuất bản:", pubErr);
        else setProgress(98, "Đã xuất bản thành công", `🎉 Đề thi đã xuất bản cho học sinh!`, "success");
      }

      setProgress(100, "🎉 Hoàn tất thành công!", `✅ Đã tạo đề và tải lên toàn bộ câu hỏi kèm hình ảnh!`, "success");

      await loadTeacherExams();
      if (isPublished) await loadPublishedExams();

      const created = state.teacherExams.find((e) => e.id === examId);
      if (created) setExamDraftFromExam(created);

      showToast(`Đã tạo thành công đề ${code}!`);

      window.setTimeout(() => {
        closeCreateExamModal();
      }, 1500);

    } catch (err) {
      console.error("Lỗi tạo đề từ PDF:", err);
      setProgress(null, "Có lỗi xảy ra", `❌ Lỗi: ${err.message || String(err)}`, "error");
      const msg = $("#create-exam-message");
      if (msg) msg.textContent = err.message || "Có lỗi xảy ra trong quá trình xử lý PDF.";
      submitBtn.disabled = false;
      submitBtn.classList.remove("is-loading");
      cancelBtn.disabled = false;
      if (extractBtn) extractBtn.disabled = false;
    }
  }

  function bindCreateExamModalControls() {
    // Chuyển tab trong modal
    $("#tab-btn-pdf")?.addEventListener("click", () => switchCreateExamTab("pdf"));
    $("#tab-btn-manual")?.addEventListener("click", () => switchCreateExamTab("manual"));

    // Nút chuyển sang soạn đề thủ công
    $("#btn-switch-to-manual")?.addEventListener("click", () => {
      closeCreateExamModal();
      startNewExamDraft();
    });

    // Các nút đóng modal
    $$('[data-close-create-exam]').forEach((btn) => {
      btn.addEventListener("click", closeCreateExamModal);
    });

    // Xử lý dropzone kéo thả file PDF
    const dropzone = $("#pdf-dropzone");
    const fileInput = $("#pdf-file-input");

    if (dropzone && fileInput) {
      dropzone.addEventListener("click", (e) => {
        if (e.target.closest("#pdf-change-file-btn")) return;
        fileInput.click();
      });

      dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
      });

      dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
      });

      dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        if (e.dataTransfer.files?.length) {
          handlePdfFileSelect(e.dataTransfer.files[0]);
        }
      });

      fileInput.addEventListener("change", () => {
        if (fileInput.files?.length) {
          handlePdfFileSelect(fileInput.files[0]);
        }
      });

      $("#pdf-change-file-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        fileInput.value = "";
        fileInput.click();
      });
    }

    // Nút trích xuất câu hỏi bằng AI
    $("#extract-questions-button")?.addEventListener("click", handleExtractQuestionsFromPdf);

    // Nút trích xuất lại
    $("#pdf-re-extract-button")?.addEventListener("click", () => {
      state.extractedExamData = null;
      const previewPanel = $("#pdf-preview-panel");
      if (previewPanel) previewPanel.hidden = true;
      const saveBtn = $("#start-pdf-exam-button");
      if (saveBtn) saveBtn.disabled = true;
      handleExtractQuestionsFromPdf();
    });

    // Submit form tạo đề từ PDF (lưu lên Supabase)
    $("#create-exam-pdf-form")?.addEventListener("submit", handleCreateExamFromPdf);
  }

  async function loadPublishedExams() {
    const status = $("#exam-catalog-status");
    status.textContent = "Đang tải danh sách đề...";

    if (!window.supabaseClient) {
      status.textContent = "Supabase chưa được kết nối.";
      renderExamCatalog();
      return;
    }

    try {
      const { data, error } = await window.supabaseClient
        .from("exams")
        .select("id, code, title, description, duration_minutes, grade_level, is_published, exam_data, created_at")
        .eq("is_published", true)
        .order("created_at", { ascending: false });
      if (error) throw error;

      state.examCatalog = (data || []).map(normalizeExamRow);
      if (!state.examCatalog.some((exam) => exam.id === state.selectedExamId)) {
        state.selectedExamId = state.examCatalog[0]?.id || null;
      }
      renderExamCatalog();
      updateSelectedExamSummary();
    } catch (error) {
      console.error("Không tải được kho đề:", error);
      status.textContent = `Không tải được kho đề: ${error.message || "Lỗi không xác định"}`;
      renderExamCatalog();
    }
  }

  function normalizeExamRow(row) {
    const examData = row.exam_data && typeof row.exam_data === "object" ? row.exam_data : createEmptyExamData();
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      description: row.description || "",
      durationMinutes: Number(row.duration_minutes || 50),
      gradeLevel: row.grade_level || "THPT",
      isPublished: Boolean(row.is_published),
      createdAt: row.created_at,
      data: {
        passages: Array.isArray(examData.passages) ? examData.passages : [],
        mcq: Array.isArray(examData.mcq) ? examData.mcq : [],
        trueFalse: Array.isArray(examData.trueFalse) ? examData.trueFalse : [],
        shortAnswer: Array.isArray(examData.shortAnswer) ? examData.shortAnswer : []
      }
    };
  }

  function renderExamCatalog() {
    const catalog = $("#exam-catalog");
    const status = $("#exam-catalog-status");
    if (!state.examCatalog.length) {
      catalog.innerHTML = "";
      status.textContent = "Chưa có đề nào được xuất bản. Giáo viên hãy đăng nhập và mở mục Quản lý đề.";
      return;
    }

    status.textContent = `${state.examCatalog.length} đề đang mở cho học sinh.`;
    catalog.innerHTML = state.examCatalog.map((exam) => {
      const counts = getExamCounts(exam.data);
      const selected = exam.id === state.selectedExamId;
      return `
        <button class="exam-catalog-card ${selected ? "selected" : ""}" type="button" data-select-exam="${exam.id}">
          <span class="catalog-card-top"><strong>${escapeHtml(exam.code)}</strong><i>${exam.durationMinutes} phút</i></span>
          <h3>${escapeHtml(exam.title)}</h3>
          <p>${escapeHtml(exam.description || "Đề luyện Vật lí THPT theo cấu trúc mới.")}</p>
          <span class="catalog-counts">
            <i>${counts.mcq} lựa chọn</i><i>${counts.tf} Đúng/Sai</i><i>${counts.short} trả lời ngắn</i>
          </span>
          <span class="catalog-select-label">${selected ? "Đã chọn đề này" : "Chọn đề"}</span>
        </button>
      `;
    }).join("");

    $$('[data-select-exam]').forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedExamId = button.dataset.selectExam;
        renderExamCatalog();
        updateSelectedExamSummary();
      });
    });
  }

  function updateSelectedExamSummary() {
    const exam = state.examCatalog.find((item) => item.id === state.selectedExamId);
    const button = $("#start-exam-submit");
    if (!exam) {
      $("#selected-exam-code").textContent = "CHỌN MỘT ĐỀ ĐỂ BẮT ĐẦU";
      $("#selected-exam-title").textContent = "Kho đề luyện Vật lí THPT";
      $("#selected-exam-duration").textContent = "--";
      $("#selected-exam-count").textContent = "--";
      button.disabled = true;
      return;
    }

    const counts = getExamCounts(exam.data);
    $("#selected-exam-code").textContent = exam.code;
    $("#selected-exam-title").textContent = exam.title;
    $("#selected-exam-duration").textContent = exam.durationMinutes;
    $("#selected-exam-count").textContent = counts.total;
    button.disabled = false;
  }

  function switchStudentAuthMode(mode) {
    const selectedMode = mode === "register" ? "register" : "login";
    $$('[data-student-auth-tab]').forEach((button) => {
      const active = button.dataset.studentAuthTab === selectedMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $$('[data-student-auth-panel]').forEach((panel) => {
      const active = panel.dataset.studentAuthPanel === selectedMode;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
    $("#student-auth-title").textContent = selectedMode === "register" ? "Tạo tài khoản học sinh" : "Đăng nhập tài khoản";
    $("#student-login-error").textContent = "";
    $("#student-register-message").textContent = "";
    $$('[data-toggle-password]').forEach((button) => {
      const input = document.getElementById(button.dataset.togglePassword);
      if (input) input.type = "password";
      button.textContent = "Hiện";
      button.setAttribute("aria-label", "Hiện mật khẩu");
    });
  }

  function toggleStudentPassword(button) {
    const input = document.getElementById(button.dataset.togglePassword);
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Ẩn" : "Hiện";
    button.setAttribute("aria-label", show ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    input.focus();
  }

  function setButtonLoading(button, loading, loadingText, normalText) {
    if (!button) return;
    button.disabled = loading;
    const textElement = button.querySelector("span");
    if (textElement) textElement.textContent = loading ? loadingText : normalText;
    else button.textContent = loading ? loadingText : normalText;
  }

  async function isCurrentUserTeacher() {
    if (!window.supabaseClient) return false;
    const { data, error } = await window.supabaseClient.rpc("is_exam_teacher");
    if (error) {
      console.error("Không kiểm tra được quyền giáo viên:", error);
      return false;
    }
    return data === true;
  }

  async function loadStudentProfile(user) {
    const { data, error } = await window.supabaseClient
      .from("student_profiles")
      .select("user_id, full_name, class_name, created_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;

    if (data) {
      return {
        userId: data.user_id,
        fullName: data.full_name,
        className: data.class_name,
        email: user.email || ""
      };
    }

    const fullName = String(user.user_metadata?.full_name || "").trim();
    const className = String(user.user_metadata?.class_name || "").trim().toUpperCase();
    if (!fullName || !className) {
      throw new Error("Tài khoản chưa có hồ sơ học sinh. Hãy tạo lại tài khoản hoặc liên hệ giáo viên.");
    }

    const { data: inserted, error: insertError } = await window.supabaseClient
      .from("student_profiles")
      .upsert({ user_id: user.id, full_name: fullName, class_name: className }, { onConflict: "user_id" })
      .select("user_id, full_name, class_name")
      .single();
    if (insertError) throw insertError;
    return {
      userId: inserted.user_id,
      fullName: inserted.full_name,
      className: inserted.class_name,
      email: user.email || ""
    };
  }

  async function activateStudentSession(user) {
    state.studentUser = user;
    state.teacherUser = null;
    state.studentProfile = await loadStudentProfile(user);
    updateStudentUi();
    updateTeacherUi();
    showScreen("home");
    await loadPublishedExams();
  }

  async function restoreCurrentSession() {
    if (!window.supabaseClient) {
      showStudentAuthScreen("Supabase chưa được kết nối.");
      return;
    }

    const { data, error } = await window.supabaseClient.auth.getUser();
    if (error || !data?.user) {
      showStudentAuthScreen();
      return;
    }

    if (await isCurrentUserTeacher()) {
      state.teacherUser = data.user;
      state.studentUser = null;
      state.studentProfile = null;
      updateStudentUi();
      updateTeacherUi();
      showTeacherPanel("results");
      await loadTeacherDashboard(true);
      return;
    }

    try {
      await activateStudentSession(data.user);
    } catch (profileError) {
      console.error("Không tải được hồ sơ học sinh:", profileError);
      await window.supabaseClient.auth.signOut();
      showStudentAuthScreen(profileError.message);
    }
  }

  function showStudentAuthScreen(message = "") {
    state.studentUser = null;
    state.studentProfile = null;
    state.teacherUser = null;
    state.examCatalog = [];
    state.selectedExamId = null;
    updateStudentUi();
    updateTeacherUi();
    state.screen = "student-auth";
    $$(".screen").forEach((screen) => screen.classList.remove("active"));
    $("#student-auth-screen")?.classList.add("active");
    if (message) $("#student-login-error").textContent = message;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateStudentUi() {
    const loggedIn = Boolean(state.studentUser && state.studentProfile);
    const profile = state.studentProfile;
    const homeButton = $("#student-home-button");
    const navAccount = $("#student-nav-account");
    const logoutButton = $("#student-logout-button");
    if (homeButton) homeButton.hidden = !loggedIn;
    if (navAccount) navAccount.hidden = !loggedIn;
    if (logoutButton) logoutButton.hidden = !loggedIn;
    if (!loggedIn) return;

    const initials = profile.fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "HS";
    $("#student-nav-avatar").textContent = initials;
    $("#student-nav-name").textContent = profile.fullName;
    $("#student-nav-class").textContent = `Lớp ${profile.className}`;
    $("#student-current-avatar").textContent = initials;
    $("#student-current-name").textContent = profile.fullName;
    $("#student-current-meta").textContent = `Lớp ${profile.className} · ${profile.email}`;
  }

  async function handleStudentLogin(event) {
    event.preventDefault();
    if (!window.supabaseClient) return;
    const email = $("#student-login-email").value.trim();
    const password = $("#student-login-password").value;
    const errorElement = $("#student-login-error");
    const button = $("#student-login-submit");
    errorElement.textContent = "";
    setButtonLoading(button, true, "Đang đăng nhập...", "Đăng nhập và chọn đề");

    try {
      const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (await isCurrentUserTeacher()) {
        await window.supabaseClient.auth.signOut();
        throw new Error("Đây là tài khoản giáo viên. Hãy dùng nút “Tôi là giáo viên”.");
      }
      await activateStudentSession(data.user);
      $("#student-login-form").reset();
      showToast("Đăng nhập học sinh thành công.");
    } catch (loginError) {
      console.error("Lỗi đăng nhập học sinh:", loginError);
      errorElement.textContent = loginError.message === "Invalid login credentials"
        ? "Email hoặc mật khẩu không chính xác."
        : (loginError.message || "Không thể đăng nhập. Vui lòng thử lại.");
    } finally {
      setButtonLoading(button, false, "Đang đăng nhập...", "Đăng nhập và chọn đề");
    }
  }

  async function handleStudentRegister(event) {
    event.preventDefault();
    if (!window.supabaseClient) return;
    const fullName = $("#student-register-name").value.trim();
    const className = $("#student-register-class").value.trim().toUpperCase();
    const email = $("#student-register-email").value.trim();
    const password = $("#student-register-password").value;
    const confirmPassword = $("#student-register-confirm-password").value;
    const messageElement = $("#student-register-message");
    const button = $("#student-register-submit");

    messageElement.className = "student-auth-message";
    messageElement.textContent = "";
    if (fullName.length < 2 || !className) {
      messageElement.classList.add("error");
      messageElement.textContent = "Vui lòng nhập đúng họ tên và lớp.";
      return;
    }
    if (password.length < 6) {
      messageElement.classList.add("error");
      messageElement.textContent = "Mật khẩu cần có ít nhất 6 ký tự.";
      return;
    }
    if (password !== confirmPassword) {
      messageElement.classList.add("error");
      messageElement.textContent = "Hai lần nhập mật khẩu chưa khớp.";
      return;
    }

    setButtonLoading(button, true, "Đang tạo tài khoản...", "Tạo tài khoản học sinh");
    try {
      const { data, error } = await window.supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, class_name: className, role: "student" },
          emailRedirectTo: window.location.origin
        }
      });
      if (error) throw error;

      if (data.session && data.user) {
        await activateStudentSession(data.user);
        $("#student-register-form").reset();
        showToast("Tạo tài khoản và đăng nhập thành công.");
      } else {
        messageElement.classList.add("success");
        messageElement.textContent = "Tài khoản đã được tạo. Hãy mở email để xác nhận, sau đó quay lại đăng nhập.";
        $("#student-register-form").reset();
        window.setTimeout(() => switchStudentAuthMode("login"), 3500);
      }
    } catch (registerError) {
      console.error("Lỗi tạo tài khoản học sinh:", registerError);
      messageElement.classList.add("error");
      messageElement.textContent = registerError.message || "Không thể tạo tài khoản. Vui lòng thử lại.";
    } finally {
      setButtonLoading(button, false, "Đang tạo tài khoản...", "Tạo tài khoản học sinh");
    }
  }

  async function handleStudentLogout() {
    if (state.screen === "exam" && !state.submitted) {
      if (!window.confirm("Bài làm đang diễn ra. Đăng xuất sẽ kết thúc bài đang làm. Bạn có chắc không?")) return;
      stopTimer();
    }
    if (window.supabaseClient) await window.supabaseClient.auth.signOut();
    showStudentAuthScreen();
    showToast("Đã đăng xuất tài khoản học sinh.");
  }

  function updateTeacherUi() {
    const teacherButton = $("#teacher-dashboard-button");
    if (teacherButton) teacherButton.textContent = state.teacherUser ? "Khu vực giáo viên" : "Giáo viên";

    const dashboardStatus = $("#dashboard-status");
    if (dashboardStatus) {
      dashboardStatus.textContent = state.teacherUser
        ? `Đang đăng nhập: ${state.teacherUser.email}. Dữ liệu được đồng bộ từ Supabase.`
        : "Dữ liệu được đồng bộ từ Supabase và chỉ tài khoản giáo viên được xem.";
    }
  }

  async function openTeacherAccess() {
    if (state.screen === "exam" && !state.submitted) {
      const shouldLeave = window.confirm("Bài làm đang diễn ra. Bạn có chắc muốn rời khỏi đề thi để mở trang giáo viên?");
      if (!shouldLeave) return;
      stopTimer();
    }

    if (state.teacherUser) {
      showTeacherPanel("results");
      await loadTeacherDashboard(true);
      return;
    }

    if (state.studentUser) {
      const shouldSwitch = window.confirm("Bạn đang đăng nhập tài khoản học sinh. Hệ thống sẽ đăng xuất học sinh để chuyển sang giáo viên. Tiếp tục?");
      if (!shouldSwitch) return;
      await window.supabaseClient.auth.signOut();
      state.studentUser = null;
      state.studentProfile = null;
      showStudentAuthScreen();
    }
    openTeacherLoginModal();
  }

  function openTeacherLoginModal() {
    const modal = $("#teacher-login-modal");
    if (!modal) return;
    setTeacherLoginMessage("");
    resetTeacherPasswordVisibility();
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    window.setTimeout(() => {
      const emailInput = $("#teacher-email");
      const passwordInput = $("#teacher-password");
      if (emailInput?.value.trim()) passwordInput?.focus();
      else emailInput?.focus();
    }, 50);
  }

  function closeTeacherLoginModal() {
    const modal = $("#teacher-login-modal");
    if (!modal) return;
    $("#teacher-password").value = "";
    setTeacherLoginMessage("");
    resetTeacherPasswordVisibility();
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  function toggleTeacherPassword() {
    const passwordInput = $("#teacher-password");
    const toggleButton = $("#toggle-teacher-password");
    if (!passwordInput || !toggleButton) return;
    const willShowPassword = passwordInput.type === "password";
    passwordInput.type = willShowPassword ? "text" : "password";
    toggleButton.classList.toggle("is-visible", willShowPassword);
    toggleButton.setAttribute("aria-pressed", String(willShowPassword));
    toggleButton.setAttribute("aria-label", willShowPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    toggleButton.setAttribute("title", willShowPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    passwordInput.focus();
  }

  function resetTeacherPasswordVisibility() {
    const passwordInput = $("#teacher-password");
    const toggleButton = $("#toggle-teacher-password");
    if (passwordInput) passwordInput.type = "password";
    if (toggleButton) {
      toggleButton.classList.remove("is-visible");
      toggleButton.setAttribute("aria-pressed", "false");
      toggleButton.setAttribute("aria-label", "Hiện mật khẩu");
      toggleButton.setAttribute("title", "Hiện mật khẩu");
    }
  }

  function setTeacherLoginMessage(message, type = "error") {
    const element = $("#teacher-login-error");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("success", type === "success");
  }

  function getTeacherLoginErrorMessage(error) {
    const message = String(error?.message || "").toLowerCase();
    if (error?.code === "not_teacher") {
      return "Tài khoản đăng nhập được nhưng chưa có quyền giáo viên.";
    }
    if (message.includes("invalid login credentials")) {
      return "Mật khẩu không đúng hoặc tài khoản chưa được đặt mật khẩu. Hãy dùng liên kết đăng nhập qua email bên dưới.";
    }
    if (message.includes("email not confirmed")) {
      return "Email chưa được xác nhận. Hãy mở email Supabase đã gửi rồi thử lại.";
    }
    if (message.includes("rate limit") || message.includes("too many requests")) {
      return "Bạn đã thử quá nhiều lần. Hãy chờ một lúc rồi thử lại.";
    }
    return error?.message || "Không thể đăng nhập. Vui lòng thử lại.";
  }

  async function handleTeacherLogin(event) {
    event.preventDefault();
    if (!window.supabaseClient) {
      setTeacherLoginMessage("Supabase chưa được khởi tạo.");
      return;
    }

    const email = $("#teacher-email").value.trim().toLowerCase();
    const password = $("#teacher-password").value;
    const submitButton = $("#teacher-login-submit");

    setTeacherLoginMessage("");
    submitButton.disabled = true;
    submitButton.classList.add("is-loading");
    submitButton.querySelector("span").textContent = "Đang đăng nhập...";

    try {
      const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!(await isCurrentUserTeacher())) {
        await window.supabaseClient.auth.signOut();
        const permissionError = new Error("Tài khoản này không có quyền giáo viên.");
        permissionError.code = "not_teacher";
        throw permissionError;
      }
      state.teacherUser = data.user;
      state.studentUser = null;
      state.studentProfile = null;
      updateStudentUi();
      updateTeacherUi();
      closeTeacherLoginModal();
      showTeacherPanel("results");
      await loadTeacherDashboard(true);
      showToast("Đăng nhập giáo viên thành công.");
    } catch (error) {
      console.error("Lỗi đăng nhập giáo viên:", error);
      setTeacherLoginMessage(getTeacherLoginErrorMessage(error));
    } finally {
      submitButton.disabled = false;
      submitButton.classList.remove("is-loading");
      submitButton.querySelector("span").textContent = "Đăng nhập";
    }
  }

  async function handleTeacherMagicLink() {
    if (!window.supabaseClient) {
      setTeacherLoginMessage("Supabase chưa được khởi tạo.");
      return;
    }

    const emailInput = $("#teacher-email");
    const email = emailInput?.value.trim().toLowerCase() || "";
    const button = $("#teacher-magic-link-button");

    if (!email) {
      setTeacherLoginMessage("Hãy nhập email giáo viên trước.");
      emailInput?.focus();
      return;
    }

    setTeacherLoginMessage("");
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "Đang gửi liên kết...";

    try {
      const redirectUrl = `${window.location.origin}${window.location.pathname}`;
      const { error } = await window.supabaseClient.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectUrl
        }
      });
      if (error) throw error;
      setTeacherLoginMessage(
        "Đã gửi liên kết đăng nhập. Mở email trên cùng thiết bị, bấm liên kết rồi website sẽ tự vào trang giáo viên.",
        "success"
      );
    } catch (error) {
      console.error("Không gửi được liên kết đăng nhập giáo viên:", error);
      const message = String(error?.message || "").toLowerCase();
      setTeacherLoginMessage(
        message.includes("rate limit") || message.includes("too many requests")
          ? "Supabase đang giới hạn gửi email. Hãy chờ một lúc rồi thử lại."
          : (error?.message || "Không gửi được liên kết đăng nhập.")
      );
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function handleTeacherLogout() {
    if (!window.supabaseClient) return;
    const { error } = await window.supabaseClient.auth.signOut();
    if (error) {
      showToast(`Không thể đăng xuất: ${error.message}`);
      return;
    }
    state.teacherUser = null;
    state.dashboardResults = [];
    state.teacherExams = [];
    state.examDraft = null;
    updateTeacherUi();
    renderDashboard([]);
    showStudentAuthScreen();
    showToast("Đã đăng xuất tài khoản giáo viên.");
  }

  function showScreen(screenName) {
    if (screenName === "dashboard" && !state.teacherUser) {
      openTeacherLoginModal();
      return;
    }
    if (["home", "exam", "result"].includes(screenName) && !state.studentUser) {
      showStudentAuthScreen();
      return;
    }
    state.screen = screenName;
    $$(".screen").forEach((screen) => screen.classList.remove("active"));
    $(`#${screenName}-screen`)?.classList.add("active");
    $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.screen === screenName));
    $("#teacher-dashboard-button")?.classList.toggle("active", screenName === "dashboard");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startExam(name, className, exam) {
    if (!state.studentUser || !state.studentProfile) {
      showStudentAuthScreen("Vui lòng đăng nhập tài khoản học sinh trước khi làm đề.");
      return;
    }

    stopTimer();
    stopQuestionObserver();
    clearAutosaveTimer();

    state.candidate = { name, className };
    state.activeExam = exam;
    state.items = buildExamItems(exam.data);
    state.currentIndex = 0;
    state.secondsLeft = exam.durationMinutes * 60;
    state.startedAt = Date.now();
    state.submitted = false;
    state.answers = createEmptyAnswers();
    state.reviewFlags = new Set();
    state.latestResult = null;

    restoreExamDraftIfAvailable(exam);

    $("#active-exam-code").textContent = exam.code;
    $("#active-exam-title").textContent = exam.title;
    $("#candidate-line").textContent = `${name} · Lớp ${className}`;
    $("#result-duration-limit").textContent = `trên ${exam.durationMinutes} phút`;

    renderFullExam();
    renderQuestionNavigation();
    updateTimerDisplay();
    updateProgress();
    showScreen("exam");
    startQuestionObserver();
    startTimer();
    scheduleAutosave();

    if (state.secondsLeft <= 0) submitExam(true);
  }

  function buildExamItems(data) {
    return [
      ...(data.mcq || []).map((question, index) => ({ type: "mcq", part: 1, number: index + 1, question })),
      ...(data.trueFalse || []).map((question, index) => ({ type: "tf", part: 2, number: index + 1, question })),
      ...(data.shortAnswer || []).map((question, index) => ({ type: "short", part: 3, number: index + 1, question }))
    ];
  }

  function startTimer() {
    stopTimer();
    state.timerId = window.setInterval(() => {
      state.secondsLeft -= 1;
      updateTimerDisplay();
      if (state.secondsLeft > 0 && state.secondsLeft % 10 === 0) saveExamDraft();
      if (state.secondsLeft <= 0) submitExam(true);
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId) window.clearInterval(state.timerId);
    state.timerId = null;
  }

  function updateTimerDisplay() {
    const minutes = Math.max(0, Math.floor(state.secondsLeft / 60));
    const seconds = Math.max(0, state.secondsLeft % 60);
    $("#timer").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    const timerCard = $("#timer-card");
    timerCard?.classList.toggle("warning", state.secondsLeft <= 600 && state.secondsLeft > 300);
    timerCard?.classList.toggle("danger", state.secondsLeft <= 300);
  }

  function normalizeVisualFingerprintValue(value) {
    return normalizeLatexEscapes(String(value ?? ""))
      .replace(/\\\(|\\\)|\\\[|\\\]/g, "")
      .replace(/\\,/g, "")
      .replace(/\s+/g, "")
      .toLowerCase()
      .trim();
  }

  function getVisualSignature(visual) {
    if (!visual || typeof visual !== "object") return "";

    const type = String(visual.type || "").trim().toLowerCase();

    if (type === "table") {
      const headers = Array.isArray(visual.headers) ? visual.headers : [];
      const rows = Array.isArray(visual.rows) ? visual.rows.filter(Array.isArray) : [];

      // Dùng tập ô đã sắp xếp thay vì vị trí hàng/cột.
      // Nhờ vậy cùng một bảng dù AI đảo hàng <-> cột vẫn được nhận ra là trùng.
      const cells = [
        ...headers,
        ...rows.flat()
      ]
        .map(normalizeVisualFingerprintValue)
        .filter(Boolean)
        .sort();

      return cells.length ? `table:${cells.length}:${cells.join("|")}` : "";
    }

    if (type === "chart") {
      return JSON.stringify({
        type: "chart",
        chartType: String(visual.chartType || "").toLowerCase(),
        labels: Array.isArray(visual.labels) ? visual.labels : [],
        datasets: Array.isArray(visual.datasets) ? visual.datasets : []
      })
        .toLowerCase()
        .replace(/\s+/g, "");
    }

    return "";
  }

  function collectPreferredVisualSignatures(items) {
    const signatures = new Set();
    const passageIds = new Set();

    const addVisuals = (visuals) => {
      if (!Array.isArray(visuals)) return;
      visuals.forEach((visual) => {
        const signature = getVisualSignature(visual);
        if (signature) signatures.add(signature);
      });
    };

    (items || []).forEach((item) => {
      addVisuals(item?.question?.visuals);
      const passageId = String(item?.question?.passageId || "").trim();
      if (passageId) passageIds.add(passageId);
    });

    (state.activeExam?.data?.passages || []).forEach((passage) => {
      if (!passageIds.has(String(passage?.id || ""))) return;
      addVisuals(passage?.visuals);
    });

    return signatures;
  }

  function renderFullExam() {
    destroyPhysicsCharts();

    const container = $("#question-content");
    if (!container) return;

    if (!state.items.length) {
      container.innerHTML = `<div class="empty-state"><strong>Đề chưa có câu hỏi</strong></div>`;
      return;
    }

    const renderedMediaSignatures = new Set();

    const groups = [
      {
        part: 1,
        title: "PHẦN I",
        subtitle: "Câu trắc nghiệm nhiều phương án lựa chọn",
        description: "Mỗi câu chỉ chọn một phương án đúng."
      },
      {
        part: 2,
        title: "PHẦN II",
        subtitle: "Câu trắc nghiệm Đúng/Sai",
        description: "Mỗi câu gồm bốn nhận định a), b), c), d)."
      },
      {
        part: 3,
        title: "PHẦN III",
        subtitle: "Câu trắc nghiệm trả lời ngắn",
        description: "Nhập kết quả cuối cùng, không nhập đơn vị vào ô trả lời."
      }
    ];

    container.innerHTML = groups.map((group) => {
      const items = state.items.filter((item) => item.part === group.part);
      if (!items.length) return "";

      return `
        <section class="exam-part-section" data-exam-part="${group.part}">
          <header class="exam-part-heading">
            <div>
              <span>${group.title}</span>
              <h2>${group.subtitle}</h2>
              <p>${group.description}</p>
            </div>
            <strong>${items.length} câu</strong>
          </header>

          <div class="exam-question-list">
            ${renderQuestionGroupWithPassages(items, renderedMediaSignatures)}
          </div>
        </section>`;
    }).join("");

    bindFullExamInputs();

    window.requestAnimationFrame(() => {
      renderPhysicsCharts();
      renderMathContent(container);
    });
  }

  function renderQuestionGroupWithPassages(items, renderedMediaSignatures = new Set()) {
    const renderedPassages = new Set();
    const renderedVisuals = new Set();

    // Những bảng/đồ thị có cấu trúc luôn được ưu tiên hơn phiên bản bảng
    // mà AI chép lại bằng dấu | trong stem/context/passage.
    const preferredVisualSignatures = collectPreferredVisualSignatures(items);

    return items.map((item) => {
      const globalIndex = state.items.indexOf(item);
      const passageId = String(item.question?.passageId || "").trim();
      let passageHtml = "";

      if (passageId && !renderedPassages.has(passageId)) {
        const passage = (state.activeExam?.data?.passages || [])
          .find((entry) => String(entry.id) === passageId);

        if (passage) {
          renderedPassages.add(passageId);
          passageHtml = renderSharedPassage(
            passage,
            renderedVisuals,
            preferredVisualSignatures
          );
        }
      }

      return `${passageHtml}${renderFullQuestion(
        item,
        globalIndex,
        renderedVisuals,
        preferredVisualSignatures,
        renderedMediaSignatures
      )}`;
    }).join("");
  }

  function renderSharedPassage(
    passage,
    renderedVisuals = new Set(),
    preferredVisualSignatures = new Set()
  ) {
    const imageUrl =
      passage?.imageUrl ||
      passage?.image_url ||
      passage?.figureUrl ||
      "";

    const ownerKey = `passage-${String(passage.id || "")}`;

    return `
      <aside id="passage-${escapeHtml(String(passage.id || ""))}" class="shared-passage-block">
        <div class="shared-passage-heading">
          <span>DỮ KIỆN DÙNG CHUNG</span>
          <strong>${escapeHtml(passage.title || "Đọc đoạn dữ kiện sau")}</strong>
        </div>

        <div class="shared-passage-content">
          ${renderRichContent(passage.content, preferredVisualSignatures)}
        </div>

        ${renderPhysicsVisuals(
      passage.visuals,
      ownerKey,
      renderedVisuals
    )}

        ${imageUrl
        ? `<figure class="question-media"><img src="${escapeHtml(String(imageUrl))}" alt="Hình minh họa cho đoạn dữ kiện" loading="lazy" /></figure>`
        : ""}
      </aside>`;
  }

  function renderQuestionContext(
    question,
    preferredVisualSignatures = new Set()
  ) {
    const context = String(question?.context || "").trim();

    return context
      ? `<div class="question-context question-own-context">${renderRichContent(
        context,
        preferredVisualSignatures
      )}</div>`
      : "";
  }

  function renderFullQuestion(
    item,
    globalIndex,
    renderedVisuals = new Set(),
    preferredVisualSignatures = new Set(),
    renderedMediaSignatures = new Set()
  ) {
    const status = getItemStatus(item);
    const marked = state.reviewFlags.has(globalIndex);
    const question = item.question || {};

    return `
      <article id="question-${globalIndex}" class="exam-question-card ${status} ${marked ? "marked" : ""}" data-question-card data-question-index="${globalIndex}">
        <div class="question-card-header">
          <div>
            <span class="question-number-badge">Câu ${item.number}</span>
            <span class="question-topic">${escapeHtml(question.topic || "Vật lí")}</span>
          </div>

          <button class="review-flag-button ${marked ? "active" : ""}" type="button" data-review-index="${globalIndex}" aria-pressed="${marked}">
            <span aria-hidden="true">${marked ? "★" : "☆"}</span>
            ${marked ? "Đã đánh dấu" : "Đánh dấu xem lại"}
          </button>
        </div>

        ${item.type === "mcq"
        ? renderFullMcq(item, globalIndex, renderedVisuals, preferredVisualSignatures, renderedMediaSignatures)
        : ""}

        ${item.type === "tf"
        ? renderFullTrueFalse(item, globalIndex, renderedVisuals, preferredVisualSignatures, renderedMediaSignatures)
        : ""}

        ${item.type === "short"
        ? renderFullShortAnswer(item, globalIndex, renderedVisuals, preferredVisualSignatures, renderedMediaSignatures)
        : ""}
      </article>`;
  }

  function renderPhysicsTable(table) {
    if (!table || typeof table !== "object") return "";

    const headers = Array.isArray(table.headers) ? table.headers.map((item) => String(item ?? "")) : [];
    const rows = Array.isArray(table.rows) ? table.rows.filter(Array.isArray) : [];
    if (headers.length < 2 || rows.length === 0) return "";

    const caption = String(table.caption || table.title || "").trim();
    const columnCount = headers.length;
    const normalizedRows = rows.map((row) => {
      const cells = row.slice(0, columnCount).map((item) => String(item ?? ""));
      while (cells.length < columnCount) cells.push("");
      return cells;
    });

    return `
      <section class="physics-table-block">
        ${caption ? `
          <div class="physics-visual-heading">
            <span>BẢNG SỐ LIỆU</span>
            <strong>${escapeHtml(caption)}</strong>
          </div>` : ""}
        <div class="physics-table-scroll" tabindex="0" aria-label="Bảng số liệu có thể cuộn ngang">
          <table class="physics-data-table">
            <thead>
              <tr>${headers.map((header) => `<th scope="col">${renderLongText(header)}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${normalizedRows.map((row) => `
                <tr>
                  ${row.map((cell, cellIndex) => cellIndex === 0
      ? `<th scope="row">${renderLongText(cell)}</th>`
      : `<td>${renderLongText(cell)}</td>`).join("")}
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function renderPhysicsChartPlaceholder(chart, ownerKey, index) {
    if (!chart || typeof chart !== "object") return "";

    const chartId = `physics-chart-${ownerKey}-${index}`.replace(/[^a-zA-Z0-9-_]/g, "-");
    let encodedConfig = "";
    try {
      encodedConfig = encodeURIComponent(JSON.stringify(chart));
    } catch (error) {
      console.error("Không mã hóa được dữ liệu đồ thị:", error);
      return "";
    }

    return `
      <section class="physics-chart-block">
        <div class="physics-visual-heading">
          <span>ĐỒ THỊ</span>
          <strong>${escapeHtml(String(chart.title || "Đồ thị Vật lí"))}</strong>
        </div>
        <div class="physics-chart-container">
          <canvas id="${chartId}" data-physics-chart="${escapeHtml(encodedConfig)}" role="img" aria-label="${escapeHtml(String(chart.title || "Đồ thị Vật lí"))}"></canvas>
        </div>
      </section>`;
  }

  function renderPhysicsVisuals(
    visuals,
    ownerKey,
    renderedVisuals = new Set()
  ) {
    if (!Array.isArray(visuals)) return "";

    return visuals.map((visual, index) => {
      const type = String(visual?.type || "").trim().toLowerCase();
      const signature = getVisualSignature(visual);

      if (signature && renderedVisuals.has(signature)) {
        return "";
      }

      if (signature) {
        renderedVisuals.add(signature);
      }

      if (type === "table") {
        return renderPhysicsTable(visual);
      }

      if (type === "chart") {
        return renderPhysicsChartPlaceholder(
          visual,
          ownerKey,
          index
        );
      }

      return "";
    }).join("");
  }

  function renderPhysicsCharts() {
    destroyPhysicsCharts();
    const canvases = $$('[data-physics-chart]');
    if (!canvases.length) return;

    if (!window.Chart) {
      console.error("Chart.js chưa được tải. Bảng vẫn hoạt động nhưng đồ thị chưa thể hiển thị.");
      return;
    }

    const palette = [
      { border: "#1d4ed8", background: "rgba(29, 78, 216, 0.14)" },
      { border: "#dc2626", background: "rgba(220, 38, 38, 0.12)" },
      { border: "#059669", background: "rgba(5, 150, 105, 0.12)" },
      { border: "#d97706", background: "rgba(217, 119, 6, 0.12)" }
    ];

    canvases.forEach((canvas) => {
      let chart;
      try {
        chart = JSON.parse(decodeURIComponent(canvas.dataset.physicsChart || ""));
      } catch (error) {
        console.error("Dữ liệu đồ thị không hợp lệ:", error);
        return;
      }

      const requestedType = String(chart.chartType || chart.type || "line").toLowerCase();
      const chartType = requestedType === "coordinate" || requestedType === "piecewise"
        ? "line"
        : (["line", "bar", "scatter"].includes(requestedType) ? requestedType : "line");
      const rawDatasets = Array.isArray(chart.datasets) ? chart.datasets : [];
      const usesPointObjects = rawDatasets.some((dataset) => {
        const source = Array.isArray(dataset?.data) ? dataset.data : (Array.isArray(dataset?.points) ? dataset.points : []);
        return source.some((point) => point && typeof point === "object" && "x" in point && "y" in point);
      });

      const datasets = rawDatasets.map((dataset, datasetIndex) => {
        const paletteItem = palette[datasetIndex % palette.length];
        const source = Array.isArray(dataset?.data) ? dataset.data : (Array.isArray(dataset?.points) ? dataset.points : []);
        const data = usesPointObjects || chartType === "scatter"
          ? source.map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
            .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
          : source.map((value) => {
            const numberValue = Number(value);
            return Number.isFinite(numberValue) ? numberValue : null;
          });

        return {
          label: String(dataset?.label || `Dữ liệu ${datasetIndex + 1}`),
          data,
          borderColor: paletteItem.border,
          backgroundColor: paletteItem.background,
          borderWidth: 2.5,
          pointRadius: chartType === "bar" ? 0 : 4,
          pointHoverRadius: 6,
          tension: requestedType === "piecewise" ? 0 : 0.2,
          fill: Boolean(dataset?.fill),
          showLine: chartType !== "scatter" || Boolean(dataset?.showLine)
        };
      });

      const instance = new window.Chart(canvas, {
        type: chartType,
        data: {
          labels: usesPointObjects || chartType === "scatter"
            ? undefined
            : (Array.isArray(chart.labels) ? chart.labels.map(String) : []),
          datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 450 },
          interaction: { intersect: false, mode: "nearest" },
          plugins: {
            legend: { display: datasets.length > 1 || datasets.some((dataset) => !dataset.label.startsWith("Dữ liệu")), position: "bottom" },
            tooltip: { enabled: true }
          },
          scales: {
            x: {
              type: usesPointObjects || chartType === "scatter" ? "linear" : "category",
              title: { display: Boolean(chart.xLabel), text: String(chart.xLabel || "") },
              grid: { color: "rgba(148, 163, 184, 0.18)" },
              ticks: { color: "#475569" }
            },
            y: {
              beginAtZero: Boolean(chart.beginAtZero),
              title: { display: Boolean(chart.yLabel), text: String(chart.yLabel || "") },
              grid: { color: "rgba(148, 163, 184, 0.22)" },
              ticks: { color: "#475569" }
            }
          }
        }
      });

      physicsChartInstances.push(instance);
    });
  }

  function physicsMediaBBoxSignature(question, bbox) {
    if (!bbox) return "";
    const page = Number(question?.sourcePage || 0);
    const quantize = (value) => Math.round((Number(value) || 0) / 20);
    return [
      page,
      quantize(bbox.x1),
      quantize(bbox.y1),
      quantize(bbox.x2),
      quantize(bbox.y2)
    ].join(":");
  }

  function getQuestionMediaEntries(question) {
    const meta = Array.isArray(question?.visualImageMeta)
      ? question.visualImageMeta
      : [];

    // Nếu có metadata từ pipeline AI, ưu tiên nó vì có bbox để loại bản crop trùng.
    if (meta.length) {
      const bySignature = new Map();

      for (const item of meta) {
        const imageUrl = String(item?.imageUrl || "").trim();
        const bbox = item?.bbox;
        if (!imageUrl || !bbox) continue;
        if (
          item?.containsAnswerText ||
          item?.cropSafe === false
        ) {
          continue;
        }

        const signature =
          physicsMediaBBoxSignature(question, bbox) ||
          `url:${imageUrl}`;

        // Giữ bản mới nhất nếu cùng bbox đã được upload qua nhiều lần REAL RUN.
        bySignature.set(signature, {
          url: imageUrl,
          signature,
          bbox
        });
      }

      if (bySignature.size) {
        return [...bySignature.values()];
      }
    }

    const urls = [];

    if (Array.isArray(question?.imageUrls)) {
      question.imageUrls.forEach((url) => {
        const value = String(url || "").trim();
        if (value && !urls.includes(value)) urls.push(value);
      });
    }

    const singleUrl =
      question?.imageUrl ||
      question?.image_url ||
      question?.figureUrl ||
      question?.mediaUrl ||
      "";

    if (singleUrl && !urls.includes(String(singleUrl))) {
      urls.unshift(String(singleUrl));
    }

    return urls.map((url) => ({
      url,
      signature: `url:${url}`,
      bbox: null
    }));
  }

  function renderQuestionMedia(
    question,
    renderedMediaSignatures = new Set()
  ) {
    const entries = getQuestionMediaEntries(question);
    if (!entries.length) return "";

    const visible = [];

    for (const entry of entries) {
      const signature = entry.signature || `url:${entry.url}`;
      if (renderedMediaSignatures.has(signature)) continue;
      renderedMediaSignatures.add(signature);
      visible.push(entry);
    }

    if (!visible.length) return "";

    return visible.map((entry, index) => `
      <figure class="question-media">
        <img src="${escapeHtml(String(entry.url))}" alt="Hình minh họa cho câu hỏi" loading="lazy" />
        ${index === 0 && question.imageCaption
        ? `<figcaption>${escapeHtml(question.imageCaption)}</figcaption>`
        : ""}
      </figure>`).join("");
  }

  function renderFullMcq(
    item,
    globalIndex,
    renderedVisuals = new Set(),
    preferredVisualSignatures = new Set(),
    renderedMediaSignatures = new Set()
  ) {
    const selected = state.answers.mcq[item.question.id];

    return `
      <div class="question-body">
        ${renderQuestionContext(
      item.question,
      preferredVisualSignatures
    )}

        <div class="question-stem">
          ${renderRichContent(
      item.question.stem,
      preferredVisualSignatures
    )}
        </div>

        ${renderPhysicsVisuals(
      item.question.visuals,
      `question-${globalIndex}`,
      renderedVisuals
    )}

        ${renderQuestionMedia(item.question, renderedMediaSignatures)}

        <div class="option-list">
          ${(item.question.options || []).map((option, index) => `
            <button
              class="option-button ${selected === index ? "selected" : ""}"
              type="button"
              data-mcq-index="${globalIndex}"
              data-mcq-option="${index}"
              aria-pressed="${selected === index}"
            >
              <span class="option-letter">${String.fromCharCode(65 + index)}</span>
              <span class="option-text">${renderLongText(cleanupOptionText(option, index))}</span>
            </button>
          `).join("")}
        </div>
      </div>`;
  }

  function renderFullTrueFalse(
    item,
    globalIndex,
    renderedVisuals = new Set(),
    preferredVisualSignatures = new Set(),
    renderedMediaSignatures = new Set()
  ) {
    const selected = state.answers.tf[item.question.id] || {};

    return `
      <div class="question-body">
        ${renderQuestionContext(
      item.question,
      preferredVisualSignatures
    )}

        ${renderPhysicsVisuals(
      item.question.visuals,
      `question-${globalIndex}`,
      renderedVisuals
    )}

        ${renderQuestionMedia(item.question, renderedMediaSignatures)}

        <div class="tf-list">
          ${(item.question.statements || []).map((statement, index) => `
            <div class="tf-row" data-tf-row="${index}">
              <span class="tf-label">${String.fromCharCode(97 + index)})</span>
              <span class="tf-text">${renderLongText(cleanupInlineDisplayText(statement.text))}</span>

              <button class="tf-choice true ${selected[index] === true ? "selected" : ""}" type="button"
                data-tf-question-index="${globalIndex}" data-tf-index="${index}" data-tf-value="true"
                aria-pressed="${selected[index] === true}">Đúng</button>

              <button class="tf-choice false ${selected[index] === false ? "selected" : ""}" type="button"
                data-tf-question-index="${globalIndex}" data-tf-index="${index}" data-tf-value="false"
                aria-pressed="${selected[index] === false}">Sai</button>
            </div>
          `).join("")}
        </div>
      </div>`;
  }

  function renderFullShortAnswer(
    item,
    globalIndex,
    renderedVisuals = new Set(),
    preferredVisualSignatures = new Set(),
    renderedMediaSignatures = new Set()
  ) {
    const value = state.answers.short[item.question.id] ?? "";

    return `
      <div class="question-body">
        ${renderQuestionContext(
      item.question,
      preferredVisualSignatures
    )}

        <div class="question-stem">
          ${renderRichContent(
      item.question.stem,
      preferredVisualSignatures
    )}
        </div>

        ${renderPhysicsVisuals(
      item.question.visuals,
      `question-${globalIndex}`,
      renderedVisuals
    )}

        ${renderQuestionMedia(item.question, renderedMediaSignatures)}

        <div class="short-answer-box">
          <label for="short-answer-${globalIndex}">Nhập kết quả cuối cùng</label>

          <div class="short-answer-row">
            <input
              id="short-answer-${globalIndex}"
              data-short-index="${globalIndex}"
              inputmode="decimal"
              autocomplete="off"
              value="${escapeHtml(String(value))}"
              placeholder="Nhập một số"
            />
            <span class="unit-badge">${escapeHtml(item.question.unit || "")}</span>
          </div>

          <p class="answer-note">
            Có thể dùng dấu phẩy hoặc dấu chấm cho phần thập phân.
            Không nhập đơn vị vào ô trả lời.
          </p>
        </div>
      </div>`;
  }

  function bindFullExamInputs() {
    $$('[data-mcq-index]').forEach((button) => {
      button.addEventListener("click", () => {
        const itemIndex = Number(button.dataset.mcqIndex);
        const item = state.items[itemIndex];
        if (!item) return;
        state.answers.mcq[item.question.id] = Number(button.dataset.mcqOption);
        const card = $(`#question-${itemIndex}`);
        card?.querySelectorAll('[data-mcq-index]').forEach((candidate) => {
          const selected = candidate === button;
          candidate.classList.toggle("selected", selected);
          candidate.setAttribute("aria-pressed", String(selected));
        });
        handleAnswerChange(itemIndex);
      });
    });

    $$('[data-tf-question-index]').forEach((button) => {
      button.addEventListener("click", () => {
        const itemIndex = Number(button.dataset.tfQuestionIndex);
        const statementIndex = Number(button.dataset.tfIndex);
        const item = state.items[itemIndex];
        if (!item) return;
        const questionAnswers = state.answers.tf[item.question.id] || {};
        questionAnswers[statementIndex] = button.dataset.tfValue === "true";
        state.answers.tf[item.question.id] = questionAnswers;
        const row = button.closest("[data-tf-row]");
        row?.querySelectorAll(".tf-choice").forEach((candidate) => {
          const selected = candidate === button;
          candidate.classList.toggle("selected", selected);
          candidate.setAttribute("aria-pressed", String(selected));
        });
        handleAnswerChange(itemIndex);
      });
    });

    $$('[data-short-index]').forEach((input) => {
      input.addEventListener("input", () => {
        const itemIndex = Number(input.dataset.shortIndex);
        const item = state.items[itemIndex];
        if (!item) return;
        state.answers.short[item.question.id] = input.value.trim();
        handleAnswerChange(itemIndex, false);
      });
      input.addEventListener("change", () => saveExamDraft());
    });

    $$('[data-review-index]').forEach((button) => {
      button.addEventListener("click", () => {
        const itemIndex = Number(button.dataset.reviewIndex);
        if (state.reviewFlags.has(itemIndex)) state.reviewFlags.delete(itemIndex);
        else state.reviewFlags.add(itemIndex);
        const marked = state.reviewFlags.has(itemIndex);
        button.classList.toggle("active", marked);
        button.setAttribute("aria-pressed", String(marked));
        button.innerHTML = `<span aria-hidden="true">${marked ? "★" : "☆"}</span>${marked ? "Đã đánh dấu" : "Đánh dấu xem lại"}`;
        $(`#question-${itemIndex}`)?.classList.toggle("marked", marked);
        updateQuestionNavigationState();
        saveExamDraft();
      });
    });
  }

  function handleAnswerChange(itemIndex, saveImmediately = true) {
    updateQuestionCardStatus(itemIndex);
    updateQuestionNavigationState();
    updateProgress();
    if (saveImmediately) saveExamDraft();
    else scheduleAutosave();
  }

  function updateQuestionCardStatus(itemIndex) {
    const item = state.items[itemIndex];
    const card = $(`#question-${itemIndex}`);
    if (!item || !card) return;
    card.classList.remove("empty", "partial", "done");
    card.classList.add(getItemStatus(item));
  }

  function getItemStatus(item) {
    if (item.type === "mcq") return Number.isInteger(state.answers.mcq[item.question.id]) ? "done" : "empty";
    if (item.type === "tf") {
      const count = Object.keys(state.answers.tf[item.question.id] || {}).length;
      return count === 4 ? "done" : count > 0 ? "partial" : "empty";
    }
    return String(state.answers.short[item.question.id] ?? "").trim() !== "" ? "done" : "empty";
  }

  function isItemAnswered(item) {
    return getItemStatus(item) === "done";
  }

  function renderQuestionNavigation() {
    const groups = [
      { part: 1, title: "Phần I", items: state.items.filter((item) => item.part === 1) },
      { part: 2, title: "Phần II", items: state.items.filter((item) => item.part === 2) },
      { part: 3, title: "Phần III", items: state.items.filter((item) => item.part === 3) }
    ];

    const navigation = $("#question-navigation");
    if (!navigation) return;

    const structureKey = state.items
      .map((item, index) => `${index}:${item.part}:${item.number}:${item.question?.id || ""}`)
      .join("|");

    if (navigation.dataset.structureKey !== structureKey) {
      navigation.innerHTML = groups.map((group) => `
        <div class="nav-part" data-nav-part="${group.part}">
          <div class="nav-part-title">
            <span>${group.title}</span>
            <span>${group.items.length} câu</span>
          </div>
          <div class="nav-buttons">
            ${group.items.map((item) => {
        const globalIndex = state.items.indexOf(item);
        return `<button class="question-nav-button empty" type="button" data-question-index="${globalIndex}" aria-label="${group.title}, câu ${item.number}">${item.number}</button>`;
      }).join("")}
          </div>
        </div>
      `).join("");
      navigation.dataset.structureKey = structureKey;
    }

    if (navigation.dataset.clickBound !== "true") {
      navigation.addEventListener("click", (event) => {
        const button = event.target.closest("[data-question-index]");
        if (!button || !navigation.contains(button)) return;
        jumpToQuestion(Number(button.dataset.questionIndex));
      });
      navigation.dataset.clickBound = "true";
    }

    updateQuestionNavigationState();
    updateProgress();
  }

  function updateQuestionNavigationState() {
    const navigation = $("#question-navigation");
    if (!navigation) return;

    navigation.querySelectorAll("[data-question-index]").forEach((button) => {
      const itemIndex = Number(button.dataset.questionIndex);
      const item = state.items[itemIndex];
      if (!item) return;

      const status = getItemStatus(item);
      const isCurrent = itemIndex === state.currentIndex;
      const isMarked = state.reviewFlags.has(itemIndex);

      button.classList.remove("empty", "partial", "done", "current", "marked");
      button.classList.add(status);
      button.classList.toggle("current", isCurrent);
      button.classList.toggle("marked", isMarked);
      button.setAttribute("aria-current", isCurrent ? "true" : "false");
    });
  }

  function setCurrentQuestion(itemIndex) {
    if (!Number.isInteger(itemIndex) || !state.items[itemIndex]) return;
    state.currentIndex = itemIndex;
    $$('[data-question-card]').forEach((card) => {
      card.classList.toggle(
        "current-view",
        Number(card.dataset.questionIndex) === itemIndex
      );
    });
    updateQuestionNavigationState();
  }

  function getQuestionScrollOffset() {
    const commandBar = $("#exam-command-bar");
    const topbar = $(".topbar");
    const commandBottom = commandBar?.getBoundingClientRect().bottom || 0;
    const topbarBottom = topbar?.getBoundingClientRect().bottom || 0;
    return Math.max(commandBottom, topbarBottom, 92) + 16;
  }

  function jumpToQuestion(itemIndex) {
    const target = $(`#question-${itemIndex}`);
    if (!target || !state.items[itemIndex]) return;

    window.clearTimeout(state.questionJumpTimer);
    state.observerLockUntil = Date.now() + 900;
    setCurrentQuestion(itemIndex);
    closeQuestionMap();

    const targetTop = Math.max(
      0,
      window.scrollY + target.getBoundingClientRect().top - getQuestionScrollOffset()
    );

    window.scrollTo({
      top: targetTop,
      behavior: "smooth"
    });

    target.classList.remove("jump-highlight");
    window.requestAnimationFrame(() => target.classList.add("jump-highlight"));
    window.setTimeout(() => target.classList.remove("jump-highlight"), 1200);

    state.questionJumpTimer = window.setTimeout(() => {
      state.observerLockUntil = 0;
      syncCurrentQuestionFromViewport();
    }, 920);
  }

  function syncCurrentQuestionFromViewport() {
    if (Date.now() < state.observerLockUntil) return;

    const cards = $$('[data-question-card]');
    if (!cards.length) return;

    const anchorY = getQuestionScrollOffset() + Math.min(130, window.innerHeight * 0.12);
    let bestCard = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= getQuestionScrollOffset() || rect.top >= window.innerHeight) return;

      if (rect.top <= anchorY && rect.bottom >= anchorY) {
        bestCard = card;
        bestDistance = -1;
        return;
      }

      if (bestDistance === -1) return;
      const distance = Math.min(
        Math.abs(rect.top - anchorY),
        Math.abs(rect.bottom - anchorY)
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCard = card;
      }
    });

    if (!bestCard) return;
    const index = Number(bestCard.dataset.questionIndex);
    if (!Number.isInteger(index) || index === state.currentIndex) return;
    setCurrentQuestion(index);
  }

  function startQuestionObserver() {
    stopQuestionObserver();

    const scheduleSync = () => {
      if (state.questionScrollFrame) return;
      state.questionScrollFrame = window.requestAnimationFrame(() => {
        state.questionScrollFrame = null;
        syncCurrentQuestionFromViewport();
      });
    };

    state.questionScrollHandler = scheduleSync;
    window.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync, { passive: true });
    scheduleSync();
  }

  function stopQuestionObserver() {
    state.questionObserver?.disconnect();
    state.questionObserver = null;

    if (state.questionScrollHandler) {
      window.removeEventListener("scroll", state.questionScrollHandler);
      window.removeEventListener("resize", state.questionScrollHandler);
      state.questionScrollHandler = null;
    }

    if (state.questionScrollFrame) {
      window.cancelAnimationFrame(state.questionScrollFrame);
      state.questionScrollFrame = null;
    }

    window.clearTimeout(state.questionJumpTimer);
    state.questionJumpTimer = null;
    state.observerLockUntil = 0;
  }

  function updateProgress() {
    const answered = state.items.filter(isItemAnswered).length;
    const total = state.items.length;
    $$('[data-progress-text]').forEach((element) => { element.textContent = `${answered}/${total}`; });
    if ($("#floating-progress-text")) $("#floating-progress-text").textContent = `${answered}/${total}`;
    if ($("#progress-bar")) $("#progress-bar").style.width = `${total ? (answered / total) * 100 : 0}%`;
  }

  function openQuestionMap() {
    const map = $("#question-map");
    const backdrop = $("#question-map-backdrop");
    map?.classList.add("mobile-open");
    map?.setAttribute("aria-hidden", "false");
    backdrop?.classList.add("open");
    backdrop?.setAttribute("aria-hidden", "false");
    $("#mobile-question-map-button")?.setAttribute("aria-expanded", "true");
    $("#floating-question-map-button")?.setAttribute("aria-expanded", "true");
    document.body.classList.add("question-map-is-open");
    window.requestAnimationFrame(() => scrollCurrentNavigationButtonIntoView());
  }

  function scrollCurrentNavigationButtonIntoView() {
    const map = $("#question-map");
    const button = $(`[data-question-index="${state.currentIndex}"]`);
    if (!map || !button) return;

    const mapRect = map.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const safeTop = mapRect.top + 84;
    const safeBottom = mapRect.bottom - 88;

    if (buttonRect.top >= safeTop && buttonRect.bottom <= safeBottom) return;

    const targetTop = map.scrollTop
      + buttonRect.top
      - mapRect.top
      - map.clientHeight / 2
      + buttonRect.height / 2;

    map.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "auto"
    });
  }

  function closeQuestionMap() {
    const map = $("#question-map");
    const backdrop = $("#question-map-backdrop");
    map?.classList.remove("mobile-open");
    backdrop?.classList.remove("open");
    backdrop?.setAttribute("aria-hidden", "true");
    $("#mobile-question-map-button")?.setAttribute("aria-expanded", "false");
    $("#floating-question-map-button")?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("question-map-is-open");
  }

  function getExamDraftKey(exam = state.activeExam) {
    const userId = state.studentUser?.id || "guest";
    const examId = exam?.id || exam?.code || "exam";
    return `${EXAM_DRAFT_PREFIX}:${userId}:${examId}`;
  }

  function restoreExamDraftIfAvailable(exam) {
    try {
      const raw = localStorage.getItem(getExamDraftKey(exam));
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft?.answers || draft.submitted) return;
      const shouldResume = window.confirm("Bạn có một bài làm chưa hoàn thành ở đề này. Nhấn OK để tiếp tục, hoặc Hủy để làm lại từ đầu.");
      if (!shouldResume) {
        localStorage.removeItem(getExamDraftKey(exam));
        return;
      }
      state.answers = {
        mcq: draft.answers.mcq || {},
        tf: draft.answers.tf || {},
        short: draft.answers.short || {}
      };
      state.reviewFlags = new Set(Array.isArray(draft.reviewFlags) ? draft.reviewFlags : []);
      const elapsedSinceSave = draft.savedAt ? Math.max(0, Math.floor((Date.now() - draft.savedAt) / 1000)) : 0;
      state.secondsLeft = Math.max(0, Number(draft.secondsLeft ?? state.secondsLeft) - elapsedSinceSave);
      state.startedAt = Number(draft.startedAt || Date.now());
      showToast("Đã khôi phục bài làm đang dở.");
    } catch (error) {
      console.error("Không thể khôi phục bài làm:", error);
      localStorage.removeItem(getExamDraftKey(exam));
    }
  }

  function saveExamDraft() {
    if (!state.activeExam || state.submitted) return;
    try {
      const draft = {
        examId: state.activeExam.id,
        examCode: state.activeExam.code,
        answers: state.answers,
        reviewFlags: [...state.reviewFlags],
        secondsLeft: state.secondsLeft,
        startedAt: state.startedAt,
        savedAt: Date.now(),
        submitted: false
      };
      localStorage.setItem(getExamDraftKey(), JSON.stringify(draft));
      const status = $("#autosave-status");
      if (status) status.textContent = `Đã lưu lúc ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    } catch (error) {
      console.error("Không thể lưu bài tạm:", error);
      if ($("#autosave-status")) $("#autosave-status").textContent = "Chưa lưu được trên thiết bị";
    }
  }

  function scheduleAutosave() {
    clearAutosaveTimer();
    state.autosaveTimer = window.setTimeout(() => {
      saveExamDraft();
      state.autosaveTimer = null;
    }, 500);
  }

  function clearAutosaveTimer() {
    if (state.autosaveTimer) window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = null;
  }

  function clearExamDraft() {
    try { localStorage.removeItem(getExamDraftKey()); } catch (error) { console.error(error); }
  }

  function openSubmitModal() {
    const unansweredIndexes = state.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !isItemAnswered(item));
    const markedIndexes = [...state.reviewFlags].sort((a, b) => a - b);
    const answered = state.items.length - unansweredIndexes.length;

    $("#modal-message").textContent = unansweredIndexes.length
      ? `Bạn đã hoàn thành ${answered}/${state.items.length} câu. Hãy kiểm tra các câu còn thiếu trước khi nộp.`
      : `Bạn đã trả lời đầy đủ ${state.items.length} câu. Hãy kiểm tra lần cuối trước khi nộp.`;

    const summary = $("#modal-question-summary");
    if (summary) {
      const buildButtons = (indexes, emptyText) => indexes.length
        ? `<div class="modal-jump-list">${indexes.map((index) => {
          const item = state.items[index];
          return `<button type="button" data-modal-jump-index="${index}">${partShortLabel(item.part)} ${item.number}</button>`;
        }).join("")}</div>`
        : `<p class="modal-empty-note">${emptyText}</p>`;
      summary.innerHTML = `
        <div class="modal-summary-group">
          <strong>Chưa hoàn thành (${unansweredIndexes.length})</strong>
          ${buildButtons(unansweredIndexes.map(({ index }) => index), "Không còn câu bỏ trống.")}
        </div>
        <div class="modal-summary-group">
          <strong>Đã đánh dấu xem lại (${markedIndexes.length})</strong>
          ${buildButtons(markedIndexes, "Không có câu nào được đánh dấu.")}
        </div>`;
      $$('[data-modal-jump-index]').forEach((button) => {
        button.addEventListener("click", () => {
          closeSubmitModal();
          jumpToQuestion(Number(button.dataset.modalJumpIndex));
        });
      });
    }

    $("#confirm-modal").classList.add("open");
    $("#confirm-modal").setAttribute("aria-hidden", "false");
  }

  function partShortLabel(part) {
    return part === 1 ? "Phần I · Câu" : part === 2 ? "Phần II · Câu" : "Phần III · Câu";
  }

  function typeLabel(type) {
    return type === "mcq" ? "Phần I · Nhiều lựa chọn" : type === "tf" ? "Phần II · Đúng/Sai" : "Phần III · Trả lời ngắn";
  }

  function closeSubmitModal() {
    $("#confirm-modal").classList.remove("open");
    $("#confirm-modal").setAttribute("aria-hidden", "true");
  }

  function submitExam(autoSubmitted) {
    if (state.submitted || !state.activeExam) return;
    state.submitted = true;
    stopTimer();
    stopQuestionObserver();
    clearAutosaveTimer();
    clearExamDraft();
    closeQuestionMap();
    closeSubmitModal();

    const scores = calculateScores();
    const examSeconds = state.activeExam.durationMinutes * 60;
    const timeUsedSeconds = examSeconds - Math.max(0, state.secondsLeft);
    const result = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      examId: state.activeExam.id,
      examCode: state.activeExam.code,
      examTitle: state.activeExam.title,
      name: state.candidate.name,
      className: state.candidate.className,
      submittedAt: new Date().toISOString(),
      autoSubmitted,
      timeUsedSeconds,
      score: round2(scores.total),
      part1: round2(scores.part1),
      part2: round2(scores.part2),
      part3: round2(scores.part3),
      mcqCorrect: scores.mcqCorrect,
      tfCorrectStatements: scores.tfCorrectStatements,
      shortCorrect: scores.shortCorrect,
      answers: deepClone(state.answers)
    };

    const results = getResults();
    results.unshift(result);
    saveResults(results);
    state.latestResult = result;
    renderResult(result);
    showScreen("result");

    void saveResultToSupabase(result)
      .then(() => showToast("Kết quả đã được lưu lên hệ thống."))
      .catch((error) => {
        console.error("Không lưu được kết quả lên Supabase:", error);
        showToast("Chưa lưu được lên máy chủ. Kết quả vẫn còn trên thiết bị này.");
      });

    if (autoSubmitted) showToast("Hết giờ. Hệ thống đã tự động nộp bài.");
  }

  async function saveResultToSupabase(result) {
    if (!window.supabaseClient) throw new Error("Supabase chưa được khởi tạo.");
    const payload = {
      client_result_id: result.id,
      exam_id: result.examId,
      exam_code: result.examCode,
      student_user_id: state.studentUser?.id || null,
      student_name: result.name,
      class_name: result.className,
      score: result.score,
      part1: result.part1,
      part2: result.part2,
      part3: result.part3,
      mcq_correct: result.mcqCorrect,
      tf_correct_statements: result.tfCorrectStatements,
      short_correct: result.shortCorrect,
      time_used_seconds: result.timeUsedSeconds,
      auto_submitted: result.autoSubmitted,
      answers: result.answers
    };
    const { error } = await window.supabaseClient.from("exam_attempts").insert(payload);
    if (error && error.code !== "23505") throw error;
  }

  function calculateScores() {
    const data = state.activeExam.data;
    let mcqCorrect = 0;
    data.mcq.forEach((question) => {
      if (state.answers.mcq[question.id] === Number(question.answer)) mcqCorrect += 1;
    });

    let part2 = 0;
    let tfCorrectStatements = 0;
    data.trueFalse.forEach((question) => {
      const selected = state.answers.tf[question.id] || {};
      let correctInQuestion = 0;
      question.statements.forEach((statement, index) => {
        if (selected[index] === Boolean(statement.answer)) correctInQuestion += 1;
      });
      tfCorrectStatements += correctInQuestion;
      part2 += TF_SCORE[correctInQuestion];
    });

    let shortCorrect = 0;
    data.shortAnswer.forEach((question) => {
      const parsed = parseNumericAnswer(state.answers.short[question.id]);
      if (Number.isFinite(parsed) && Math.abs(parsed - Number(question.answer)) <= Number(question.tolerance || 0)) shortCorrect += 1;
    });

    const part1 = mcqCorrect * 0.25;
    const part3 = shortCorrect * 0.25;
    return { part1, part2, part3, total: part1 + part2 + part3, mcqCorrect, tfCorrectStatements, shortCorrect };
  }

  function parseNumericAnswer(value) {
    if (value === undefined || value === null || String(value).trim() === "") return NaN;
    return Number(String(value).trim().replace(",", "."));
  }

  function renderResult(result) {
    $("#result-name").textContent = `${result.name} · ${result.className}`;
    $("#result-message").textContent = result.autoSubmitted
      ? `Hết thời gian, hệ thống đã tự động nộp ${result.examCode}.`
      : result.score >= 8
        ? `Kết quả tốt ở ${result.examCode}. Hãy xem lại những câu sai để giữ vững mức điểm này.`
        : result.score >= 5
          ? `Bạn đã đạt mức cơ bản ở ${result.examCode}. Tập trung cải thiện phần có điểm thấp nhất.`
          : `Bạn cần củng cố lại kiến thức nền trước khi làm lại ${result.examCode}.`;
    $("#final-score").textContent = result.score.toFixed(2);
    $("#part-one-score").textContent = result.part1.toFixed(2);
    $("#part-two-score").textContent = result.part2.toFixed(2);
    $("#part-three-score").textContent = result.part3.toFixed(2);
    $("#time-used").textContent = formatDuration(result.timeUsedSeconds);
    renderReview(result);
  }

  function renderReview(result) {
    const reviewListEl = $("#review-list");
    reviewListEl.innerHTML = state.items.map((item, globalIndex) => {
      const review = getItemReview(item, result.answers);
      return `
        <article class="review-item">
          <button class="review-summary" type="button" data-review-index="${globalIndex}">
            <span class="review-status ${review.correct ? "correct" : "wrong"}">${review.correct ? "✓" : "×"}</span>
            <strong>${typeLabel(item.type)} · Câu ${item.number}: ${truncate(item.type === "tf" ? item.question.context : item.question.stem, 120)}</strong>
            <small>${review.label}</small>
          </button>
          <div class="review-detail">${review.detail}<div class="review-answer"><strong>Lời giải:</strong> ${review.explanation}</div></div>
        </article>`;
    }).join("");
    $$('[data-review-index]').forEach((button) => button.addEventListener("click", () => button.closest(".review-item").classList.toggle("open")));
    window.requestAnimationFrame(() => renderMathContent(reviewListEl));
  }

  function getItemReview(item, answers) {
    if (item.type === "mcq") {
      const selected = answers.mcq[item.question.id];
      const answer = Number(item.question.answer);
      const correct = selected === answer;
      const selectedText = Number.isInteger(selected) ? `${String.fromCharCode(65 + selected)}. ${item.question.options[selected]}` : "Chưa trả lời";
      const correctText = `${String.fromCharCode(65 + answer)}. ${item.question.options[answer]}`;
      return { correct, label: correct ? "+0,25 điểm" : "0 điểm", detail: `<p><strong>Bạn chọn:</strong> ${selectedText}</p><p><strong>Đáp án đúng:</strong> ${correctText}</p>`, explanation: wrapLooseLatex(item.question.explanation || "") };
    }
    if (item.type === "tf") {
      const selected = answers.tf[item.question.id] || {};
      let correctCount = 0;
      const lines = item.question.statements.map((statement, index) => {
        const isCorrect = selected[index] === Boolean(statement.answer);
        if (isCorrect) correctCount += 1;
        const selectedLabel = selected[index] === undefined ? "Chưa chọn" : selected[index] ? "Đúng" : "Sai";
        const answerLabel = statement.answer ? "Đúng" : "Sai";
        return `<p><strong>${String.fromCharCode(97 + index)})</strong> ${statement.text}<br/>Bạn chọn: ${selectedLabel} · Đáp án: ${answerLabel}<br/><em>${wrapLooseLatex(statement.explanation || "")}</em></p>`;
      }).join("");
      return { correct: correctCount === 4, label: `${correctCount}/4 ý đúng · +${TF_SCORE[correctCount].toFixed(2)} điểm`, detail: lines, explanation: "Điểm của câu Đúng/Sai được tính theo tổng số ý đúng trong cùng một câu." };
    }
    const selectedValue = parseNumericAnswer(answers.short[item.question.id]);
    const answer = Number(item.question.answer);
    const correct = Number.isFinite(selectedValue) && Math.abs(selectedValue - answer) <= Number(item.question.tolerance || 0);
    return { correct, label: correct ? "+0,25 điểm" : "0 điểm", detail: `<p><strong>Bạn trả lời:</strong> ${Number.isFinite(selectedValue) ? `${selectedValue} ${item.question.unit || ""}` : "Chưa trả lời"}</p><p><strong>Đáp án:</strong> ${answer} ${item.question.unit || ""}</p>`, explanation: wrapLooseLatex(item.question.explanation || "") };
  }

  function getResults() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  }

  function saveResults(results) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  }

  async function getResultsFromSupabase() {
    if (!window.supabaseClient) throw new Error("Supabase chưa được khởi tạo.");
    const { data, error } = await window.supabaseClient
      .from("exam_attempts")
      .select("id, exam_id, exam_code, student_name, class_name, score, part1, part2, part3, mcq_correct, tf_correct_statements, short_correct, time_used_seconds, auto_submitted, submitted_at")
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  function mapSupabaseResult(row) {
    return {
      id: row.id,
      examId: row.exam_id,
      examCode: row.exam_code || "Không rõ",
      name: row.student_name,
      className: row.class_name,
      score: Number(row.score),
      part1: Number(row.part1),
      part2: Number(row.part2),
      part3: Number(row.part3),
      mcqCorrect: Number(row.mcq_correct || 0),
      tfCorrectStatements: Number(row.tf_correct_statements || 0),
      shortCorrect: Number(row.short_correct || 0),
      timeUsedSeconds: Number(row.time_used_seconds || 0),
      autoSubmitted: Boolean(row.auto_submitted),
      submittedAt: row.submitted_at
    };
  }

  async function loadTeacherDashboard(showDashboard = true) {
    if (!state.teacherUser) {
      openTeacherLoginModal();
      return;
    }
    const refreshButton = $("#refresh-dashboard-button");
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = "Đang tải...";
    }
    try {
      const rows = await getResultsFromSupabase();
      state.dashboardResults = rows.map(mapSupabaseResult);
      renderDashboard(state.dashboardResults);
      if (showDashboard) showScreen("dashboard");
    } catch (error) {
      console.error("Không tải được bảng điểm:", error);
      showToast(error.code === "42501" ? "Tài khoản này không có quyền xem bảng điểm." : `Không tải được bảng điểm: ${error.message || "Lỗi không xác định"}`);
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = "Làm mới";
      }
    }
  }

  function renderDashboard(results = state.dashboardResults) {
    const total = results.length;
    const average = total ? results.reduce((sum, result) => sum + result.score, 0) / total : 0;
    const highest = total ? Math.max(...results.map((result) => result.score)) : 0;
    const passRate = total ? (results.filter((result) => result.score >= 5).length / total) * 100 : 0;
    $("#stat-attempts").textContent = total;
    $("#stat-average").textContent = average.toFixed(2);
    $("#stat-highest").textContent = highest.toFixed(2);
    $("#stat-pass-rate").textContent = `${Math.round(passRate)}%`;
    renderDistribution(results);
    renderPartAverages(results);
    populateClassFilter(results);
    populateExamFilter(results);
    renderResultsTable();
  }

  function renderDistribution(results) {
    const buckets = [
      { label: "Dưới 5", count: results.filter((r) => r.score < 5).length },
      { label: "5 – 6,4", count: results.filter((r) => r.score >= 5 && r.score < 6.5).length },
      { label: "6,5 – 7,9", count: results.filter((r) => r.score >= 6.5 && r.score < 8).length },
      { label: "8 – 10", count: results.filter((r) => r.score >= 8).length }
    ];
    const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
    $("#distribution-chart").innerHTML = buckets.map((bucket) => `<div class="distribution-column"><div class="bar-area"><div class="bar" style="height:${(bucket.count / max) * 100}%"></div></div><strong>${bucket.count}</strong><span>${bucket.label}</span></div>`).join("");
  }

  function renderPartAverages(results) {
    const parts = [
      { label: "Phần I", max: 4.5, value: averageField(results, "part1") },
      { label: "Phần II", max: 4, value: averageField(results, "part2") },
      { label: "Phần III", max: 1.5, value: averageField(results, "part3") }
    ];
    $("#part-chart").innerHTML = parts.map((part) => `<div class="part-bar-row"><span>${part.label}</span><div class="part-bar-track"><i style="width:${part.max ? (part.value / part.max) * 100 : 0}%"></i></div><strong>${part.value.toFixed(2)}</strong></div>`).join("");
  }

  function averageField(results, field) {
    return results.length ? results.reduce((sum, result) => sum + Number(result[field] || 0), 0) / results.length : 0;
  }

  function populateClassFilter(results) {
    const current = $("#class-filter").value;
    const classes = [...new Set(results.map((result) => result.className))].sort();
    $("#class-filter").innerHTML = `<option value="">Tất cả lớp</option>${classes.map((className) => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join("")}`;
    if (classes.includes(current)) $("#class-filter").value = current;
  }

  function populateExamFilter(results) {
    const current = $("#exam-filter").value;
    const exams = [...new Set(results.map((result) => result.examCode))].sort();
    $("#exam-filter").innerHTML = `<option value="">Tất cả đề</option>${exams.map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(code)}</option>`).join("")}`;
    if (exams.includes(current)) $("#exam-filter").value = current;
  }

  function renderResultsTable() {
    const search = $("#search-result").value.trim().toLocaleLowerCase("vi");
    const classFilter = $("#class-filter").value;
    const examFilter = $("#exam-filter").value;
    const filtered = state.dashboardResults.filter((result) => {
      const matchesSearch = result.name.toLocaleLowerCase("vi").includes(search);
      const matchesClass = !classFilter || result.className === classFilter;
      const matchesExam = !examFilter || result.examCode === examFilter;
      return matchesSearch && matchesClass && matchesExam;
    });

    $("#results-table-body").innerHTML = filtered.map((result) => `
      <tr>
        <td><strong>${escapeHtml(result.name)}</strong></td><td>${escapeHtml(result.className)}</td><td><span class="exam-code-badge">${escapeHtml(result.examCode)}</span></td>
        <td>${result.part1.toFixed(2)}</td><td>${result.part2.toFixed(2)}</td><td>${result.part3.toFixed(2)}</td>
        <td><span class="score-badge ${scoreClass(result.score)}">${result.score.toFixed(2)}</span></td><td>${formatDuration(result.timeUsedSeconds)}</td><td>${formatDate(result.submittedAt)}</td>
      </tr>`).join("");
    $("#empty-results").style.display = filtered.length ? "none" : "block";
    $("#teacher-results-panel .table-wrap").style.display = filtered.length ? "block" : "none";
  }

  function scoreClass(score) {
    return score >= 8 ? "good" : score >= 5 ? "average" : "low";
  }

  function showTeacherPanel(panelName) {
    $$('[data-teacher-tab]').forEach((button) => button.classList.toggle("active", button.dataset.teacherTab === panelName));
    $$('[data-teacher-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.teacherPanel === panelName));
  }

  async function loadTeacherExams() {
    if (!state.teacherUser || !window.supabaseClient) return;
    $("#teacher-exam-list").innerHTML = `<div class="manager-loading">Đang tải danh sách đề...</div>`;
    try {
      const { data, error } = await window.supabaseClient
        .from("exams")
        .select("id, code, title, description, duration_minutes, grade_level, is_published, exam_data, created_at, updated_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      state.teacherExams = (data || []).map(normalizeExamRow);
      renderTeacherExamList();
      if (state.examDraft?.id) {
        const updated = state.teacherExams.find((exam) => exam.id === state.examDraft.id);
        if (updated) setExamDraftFromExam(updated);
      }
    } catch (error) {
      console.error("Không tải được danh sách đề:", error);
      $("#teacher-exam-list").innerHTML = `<div class="empty-state"><strong>Không tải được danh sách đề</strong><p>${escapeHtml(error.message || "")}</p></div>`;
    }
  }

  function renderTeacherExamList() {
    const list = $("#teacher-exam-list");
    if (!state.teacherExams.length) {
      list.innerHTML = `<div class="empty-state"><strong>Chưa có đề nào</strong><p>Nhấn “Tạo đề” hoặc đưa đề mẫu lên Supabase.</p></div>`;
      return;
    }
    list.innerHTML = state.teacherExams.map((exam) => {
      const counts = getExamCounts(exam.data);
      return `
        <button class="teacher-exam-card ${state.examDraft?.id === exam.id ? "active" : ""}" type="button" data-edit-exam="${exam.id}">
          <span class="teacher-exam-card-top"><strong>${escapeHtml(exam.code)}</strong><i class="publish-badge ${exam.isPublished ? "published" : "draft"}">${exam.isPublished ? "Đã xuất bản" : "Bản nháp"}</i></span>
          <h3>${escapeHtml(exam.title)}</h3>
          <p>${counts.mcq}/18 · ${counts.tf}/4 · ${counts.short}/6 câu</p>
        </button>`;
    }).join("");
    $$('[data-edit-exam]').forEach((button) => button.addEventListener("click", () => {
      const exam = state.teacherExams.find((item) => item.id === button.dataset.editExam);
      if (exam) setExamDraftFromExam(exam);
    }));
  }

  function startNewExamDraft() {
    state.examDraft = {
      id: null,
      code: `VL-THPT-${String(state.teacherExams.length + 1).padStart(2, "0")}`,
      title: "Đề luyện Vật lí THPT mới",
      description: "",
      durationMinutes: 50,
      isPublished: false,
      data: createEmptyExamData()
    };
    renderExamEditor();
    renderTeacherExamList();
  }

  function setExamDraftFromExam(exam) {
    state.examDraft = deepClone(exam);
    renderExamEditor();
    renderTeacherExamList();
  }

  function renderExamEditor() {
    const draft = state.examDraft;
    $("#exam-editor-empty").hidden = Boolean(draft);
    $("#exam-editor").hidden = !draft;
    if (!draft) return;

    $("#exam-editor-heading").textContent = draft.id ? `Chỉnh sửa ${draft.code}` : "Tạo đề mới";
    $("#exam-code-input").value = draft.code || "";
    $("#exam-duration-input").value = draft.durationMinutes || 50;
    $("#exam-title-input").value = draft.title || "";
    $("#exam-description-input").value = draft.description || "";
    $("#publish-exam-button").textContent = draft.isPublished ? "Gỡ xuất bản" : "Xuất bản";
    $("#delete-exam-button").disabled = !draft.id;
    updateDraftCounts();
    renderDraftPassageList();
    renderDraftQuestionList();
    renderQuestionBuilderFields();
    bindAutoGrowTextareas();
  }

  function readMetadataIntoDraft() {
    if (!state.examDraft) return false;
    const code = $("#exam-code-input").value.trim().toUpperCase().replace(/\s+/g, "-");
    const title = $("#exam-title-input").value.trim();
    const description = $("#exam-description-input").value.trim();
    const durationMinutes = Number($("#exam-duration-input").value);
    if (!code || !title || !Number.isFinite(durationMinutes) || durationMinutes < 10 || durationMinutes > 180) {
      showToast("Vui lòng nhập mã đề, tên đề và thời gian từ 10 đến 180 phút.");
      return false;
    }
    Object.assign(state.examDraft, { code, title, description, durationMinutes });
    return true;
  }

  function getExamCounts(data) {
    const mcq = Array.isArray(data?.mcq) ? data.mcq.length : 0;
    const tf = Array.isArray(data?.trueFalse) ? data.trueFalse.length : 0;
    const short = Array.isArray(data?.shortAnswer) ? data.shortAnswer.length : 0;
    return { mcq, tf, short, total: mcq + tf + short };
  }

  function hasRequiredStructure(data) {
    const counts = getExamCounts(data);
    return counts.mcq === REQUIRED_COUNTS.mcq && counts.tf === REQUIRED_COUNTS.tf && counts.short === REQUIRED_COUNTS.short;
  }

  function updateDraftCounts() {
    if (!state.examDraft) return;
    const counts = getExamCounts(state.examDraft.data);
    $("#draft-mcq-count").textContent = `${counts.mcq}/18`;
    $("#draft-tf-count").textContent = `${counts.tf}/4`;
    $("#draft-short-count").textContent = `${counts.short}/6`;
    $("#draft-mcq-count").classList.toggle("complete", counts.mcq === 18);
    $("#draft-tf-count").classList.toggle("complete", counts.tf === 4);
    $("#draft-short-count").classList.toggle("complete", counts.short === 6);
  }

  function getPassageOptions(selectedValue = "") {
    const passages = state.examDraft?.data?.passages || [];
    return [
      `<option value="">Không dùng đoạn dữ kiện chung</option>`,
      ...passages.map((passage) => `<option value="${escapeHtml(String(passage.id))}" ${String(passage.id) === String(selectedValue) ? "selected" : ""}>${escapeHtml(passage.title || passage.id)}</option>`)
    ].join("");
  }

  function renderQuestionBuilderFields() {
    const container = $("#question-builder-fields");
    if (!container) return;
    const type = $("#question-type-input")?.value || "mcq";
    const passageField = `<label class="builder-wide">Đoạn dữ kiện dùng chung<select id="qb-passage-id">${getPassageOptions()}</select><small class="field-hint">Chọn một đoạn đã lưu ở phía trên. Nội dung dài không phải lặp lại trong từng câu.</small></label>`;

    if (type === "mcq") {
      container.innerHTML = `
        <div class="builder-grid">
          <label>Chủ đề<input id="qb-topic" placeholder="Ví dụ: Dao động" /></label>
          ${passageField}
          <label class="builder-wide">Dữ kiện riêng của câu (tùy chọn)<textarea id="qb-context" class="long-content-textarea" rows="6" data-auto-grow placeholder="Không giới hạn ký tự"></textarea></label>
          <label class="builder-wide">Nội dung câu hỏi<textarea id="qb-stem" class="long-content-textarea" rows="6" data-auto-grow placeholder="Không giới hạn ký tự"></textarea><small class="field-hint">Không đặt maxlength. Có thể dán nguyên văn đoạn dài, công thức và xuống dòng.</small></label>
          ${["A", "B", "C", "D"].map((letter, index) => `<label>Phương án ${letter}<textarea id="qb-option-${index}" rows="3" data-auto-grow placeholder="Phương án có thể dài"></textarea></label>`).join("")}
          <label>Đáp án đúng<select id="qb-mcq-answer"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label>
          <label class="builder-wide">Lời giải<textarea id="qb-explanation" class="long-content-textarea" rows="6" data-auto-grow placeholder="Không giới hạn ký tự"></textarea></label>
        </div>`;
      bindAutoGrowTextareas();
      return;
    }
    if (type === "tf") {
      container.innerHTML = `
        <div class="builder-grid">
          <label>Chủ đề<input id="qb-topic" placeholder="Ví dụ: Khí lí tưởng" /></label>
          ${passageField}
          <label class="builder-wide">Dữ kiện riêng của câu<textarea id="qb-context" class="long-content-textarea" rows="10" data-auto-grow placeholder="Không giới hạn ký tự"></textarea><small class="field-hint">Nếu đã chọn đoạn dữ kiện chung, ô này chỉ cần ghi phần bổ sung riêng cho câu.</small></label>
        </div>
        <div class="tf-builder-list">
          ${[0, 1, 2, 3].map((index) => `
            <div class="tf-builder-row long-row">
              <strong>${String.fromCharCode(97 + index)})</strong>
              <textarea id="qb-statement-${index}" rows="3" data-auto-grow placeholder="Nhận định ${index + 1}, không giới hạn ký tự"></textarea>
              <select id="qb-tf-answer-${index}"><option value="true">Đúng</option><option value="false">Sai</option></select>
              <textarea id="qb-tf-explanation-${index}" rows="3" data-auto-grow placeholder="Giải thích, không giới hạn ký tự"></textarea>
            </div>`).join("")}
        </div>`;
      bindAutoGrowTextareas();
      return;
    }
    container.innerHTML = `
      <div class="builder-grid">
        <label>Chủ đề<input id="qb-topic" placeholder="Ví dụ: Điện năng" /></label>
        ${passageField}
        <label class="builder-wide">Dữ kiện riêng của câu (tùy chọn)<textarea id="qb-context" class="long-content-textarea" rows="6" data-auto-grow placeholder="Không giới hạn ký tự"></textarea></label>
        <label class="builder-wide">Nội dung câu hỏi<textarea id="qb-stem" class="long-content-textarea" rows="6" data-auto-grow placeholder="Không giới hạn ký tự"></textarea></label>
        <label>Đáp án số<input id="qb-short-answer" inputmode="decimal" placeholder="Ví dụ: 14.4" /></label>
        <label>Sai số cho phép<input id="qb-tolerance" inputmode="decimal" value="0.01" /></label>
        <label>Đơn vị<input id="qb-unit" placeholder="Ví dụ: kJ" /></label>
        <label class="builder-wide">Lời giải<textarea id="qb-explanation" class="long-content-textarea" rows="6" data-auto-grow placeholder="Không giới hạn ký tự"></textarea></label>
      </div>`;
    bindAutoGrowTextareas();
  }

  function addQuestionToDraft() {
    if (!state.examDraft) {
      showToast("Hãy tạo hoặc chọn một đề trước.");
      return;
    }
    const type = $("#question-type-input").value;
    const topic = $("#qb-topic")?.value.trim() || "Vật lí";
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const counts = getExamCounts(state.examDraft.data);
    const passageId = $("#qb-passage-id")?.value || "";
    const context = $("#qb-context")?.value.trim() || "";

    if (type === "mcq") {
      if (counts.mcq >= 18) return showToast("Phần I đã đủ 18 câu.");
      const stem = $("#qb-stem").value.trim();
      const options = [0, 1, 2, 3].map((index) => $(`#qb-option-${index}`).value.trim());
      if (!stem || options.some((option) => !option)) return showToast("Hãy nhập nội dung và đủ bốn phương án.");
      state.examDraft.data.mcq.push({ id, topic, passageId, context, stem, options, answer: Number($("#qb-mcq-answer").value), explanation: $("#qb-explanation").value.trim() });
    } else if (type === "tf") {
      if (counts.tf >= 4) return showToast("Phần II đã đủ 4 câu.");
      const statements = [0, 1, 2, 3].map((index) => ({
        text: $(`#qb-statement-${index}`).value.trim(),
        answer: $(`#qb-tf-answer-${index}`).value === "true",
        explanation: $(`#qb-tf-explanation-${index}`).value.trim()
      }));
      if ((!context && !passageId) || statements.some((statement) => !statement.text)) return showToast("Hãy chọn đoạn dữ kiện chung hoặc nhập dữ kiện riêng, đồng thời nhập đủ bốn nhận định.");
      state.examDraft.data.trueFalse.push({ id, topic, passageId, context, statements });
    } else {
      if (counts.short >= 6) return showToast("Phần III đã đủ 6 câu.");
      const stem = $("#qb-stem").value.trim();
      const answer = parseNumericAnswer($("#qb-short-answer").value);
      const tolerance = parseNumericAnswer($("#qb-tolerance").value);
      if (!stem || !Number.isFinite(answer) || !Number.isFinite(tolerance) || tolerance < 0) return showToast("Hãy nhập câu hỏi, đáp án số và sai số hợp lệ.");
      state.examDraft.data.shortAnswer.push({ id, topic, passageId, context, stem, answer, tolerance, unit: $("#qb-unit").value.trim(), explanation: $("#qb-explanation").value.trim() });
    }

    updateDraftCounts();
    renderDraftQuestionList();
    renderQuestionBuilderFields();
    showToast("Đã thêm câu hỏi vào bản nháp.");
  }

  function addPassageToDraft() {
    if (!state.examDraft) return showToast("Hãy tạo hoặc chọn một đề trước.");
    const title = $("#passage-title-input")?.value.trim() || "Đoạn dữ kiện dùng chung";
    const content = $("#passage-content-input")?.value.trim() || "";
    if (!content) return showToast("Hãy nhập nội dung đoạn dữ kiện.");
    const rawId = $("#passage-id-input")?.value.trim() || title;
    const id = rawId.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `passage-${Date.now()}`;
    state.examDraft.data.passages ||= [];
    if (state.examDraft.data.passages.some((passage) => String(passage.id) === id)) {
      return showToast("Mã đoạn dữ kiện đã tồn tại. Hãy dùng mã khác.");
    }
    state.examDraft.data.passages.push({ id, title, content });
    $("#passage-id-input").value = "";
    $("#passage-title-input").value = "";
    $("#passage-content-input").value = "";
    renderDraftPassageList();
    renderQuestionBuilderFields();
    showToast("Đã thêm đoạn dữ kiện dùng chung.");
  }

  function renderDraftPassageList() {
    const container = $("#draft-passage-list");
    if (!container) return;
    const passages = state.examDraft?.data?.passages || [];
    if (!passages.length) {
      container.innerHTML = `<p class="field-hint passage-empty">Chưa có đoạn dữ kiện dùng chung.</p>`;
      return;
    }
    container.innerHTML = passages.map((passage) => `
      <details class="draft-passage-item">
        <summary><strong>${escapeHtml(passage.title || passage.id)}</strong><span>${String(passage.content || "").length.toLocaleString("vi-VN")} ký tự</span></summary>
        <div class="draft-passage-full">${renderLongText(passage.content)}</div>
        <button class="danger-button compact-question-delete" type="button" data-delete-passage-id="${escapeHtml(String(passage.id))}">Xóa đoạn dữ kiện</button>
      </details>`).join("");
    $$('[data-delete-passage-id]').forEach((button) => button.addEventListener("click", () => deletePassageFromDraft(button.dataset.deletePassageId)));
  }

  function deletePassageFromDraft(passageId) {
    if (!state.examDraft) return;
    const usedCount = buildExamItems(state.examDraft.data).filter((item) => String(item.question?.passageId || "") === String(passageId)).length;
    if (usedCount && !window.confirm(`Đoạn dữ kiện đang được ${usedCount} câu sử dụng. Xóa đoạn này và bỏ liên kết khỏi các câu?`)) return;
    state.examDraft.data.passages = (state.examDraft.data.passages || []).filter((passage) => String(passage.id) !== String(passageId));
    [state.examDraft.data.mcq, state.examDraft.data.trueFalse, state.examDraft.data.shortAnswer].forEach((questions) => {
      (questions || []).forEach((question) => {
        if (String(question.passageId || "") === String(passageId)) question.passageId = "";
      });
    });
    renderDraftPassageList();
    renderQuestionBuilderFields();
    showToast("Đã xóa đoạn dữ kiện.");
  }

  function bindAutoGrowTextareas() {
    $$('textarea[data-auto-grow]').forEach((textarea) => {
      const resize = () => {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 96), 720)}px`;
      };
      if (!textarea.dataset.autoGrowBound) {
        textarea.addEventListener("input", resize);
        textarea.dataset.autoGrowBound = "true";
      }
      resize();
    });
  }

  function renderDraftQuestionList() {
    const container = $("#draft-question-list");
    if (!state.examDraft) {
      container.innerHTML = "";
      return;
    }
    const items = buildExamItems(state.examDraft.data);
    if (!items.length) {
      container.innerHTML = `<div class="empty-state"><strong>Đề chưa có câu hỏi</strong><p>Chọn loại câu hỏi và thêm từng câu ở phía trên.</p></div>`;
      return;
    }
    container.innerHTML = items.map((item) => {
      const fullText = item.type === "tf" ? item.question.context : item.question.stem;
      const passage = (state.examDraft.data.passages || []).find((entry) => String(entry.id) === String(item.question.passageId || ""));
      return `
        <article class="draft-question-item long-question-item">
          <details>
            <summary><span>${typeLabel(item.type)} · Câu ${item.number}</span><strong>${escapeHtml(truncate(fullText, 180))}</strong></summary>
            ${passage ? `<p class="draft-linked-passage">Dùng đoạn dữ kiện: <strong>${escapeHtml(passage.title || passage.id)}</strong></p>` : ""}
            <div class="draft-question-full">${renderLongText(fullText)}</div>
          </details>
          <button class="danger-button compact-question-delete" type="button" data-delete-question-type="${item.type}" data-delete-question-id="${item.question.id}">Xóa</button>
        </article>`;
    }).join("");
    $$('[data-delete-question-id]').forEach((button) => button.addEventListener("click", () => {
      deleteDraftQuestion(button.dataset.deleteQuestionType, button.dataset.deleteQuestionId);
    }));
  }

  function deleteDraftQuestion(type, questionId) {
    if (!state.examDraft) return;
    const key = type === "mcq" ? "mcq" : type === "tf" ? "trueFalse" : "shortAnswer";
    state.examDraft.data[key] = state.examDraft.data[key].filter((question) => String(question.id) !== String(questionId));
    updateDraftCounts();
    renderDraftQuestionList();
  }

  async function saveExamDraft(publish) {
    if (!state.examDraft || !readMetadataIntoDraft()) return null;
    if (publish && !hasRequiredStructure(state.examDraft.data)) {
      showToast("Muốn xuất bản, đề phải đủ 18 câu lựa chọn, 4 câu Đúng/Sai và 6 câu trả lời ngắn.");
      return null;
    }
    if (!window.supabaseClient) return null;

    const payload = {
      code: state.examDraft.code,
      title: state.examDraft.title,
      description: state.examDraft.description,
      duration_minutes: state.examDraft.durationMinutes,
      grade_level: "THPT",
      is_published: Boolean(publish),
      exam_data: state.examDraft.data,
      updated_at: new Date().toISOString()
    };

    const button = publish ? $("#publish-exam-button") : $("#save-exam-draft-button");
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Đang lưu...";

    try {
      let query;
      if (state.examDraft.id) query = window.supabaseClient.from("exams").update(payload).eq("id", state.examDraft.id).select().single();
      else query = window.supabaseClient.from("exams").insert({ ...payload, created_by: state.teacherUser.id }).select().single();
      const { data, error } = await query;
      if (error) throw error;
      state.examDraft = normalizeExamRow(data);
      await loadTeacherExams();
      await loadPublishedExams();
      showToast(publish ? "Đề đã được xuất bản cho học sinh." : "Đã lưu bản nháp. Nếu đề đang xuất bản, thao tác này sẽ chuyển về bản nháp.");
      return data;
    } catch (error) {
      console.error("Không lưu được đề:", error);
      showToast(error.code === "23505" ? "Mã đề đã tồn tại. Hãy dùng mã khác." : `Không lưu được đề: ${error.message || "Lỗi không xác định"}`);
      return null;
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function handlePublishExam() {
    if (!state.examDraft) return;
    if (state.examDraft.isPublished && state.examDraft.id) {
      const { error } = await window.supabaseClient.from("exams").update({ is_published: false, updated_at: new Date().toISOString() }).eq("id", state.examDraft.id);
      if (error) {
        showToast(`Không thể gỡ xuất bản: ${error.message}`);
        return;
      }
      state.examDraft.isPublished = false;
      await loadTeacherExams();
      await loadPublishedExams();
      showToast("Đã gỡ đề khỏi kho đề học sinh.");
      return;
    }
    await saveExamDraft(true);
  }

  async function deleteCurrentExam() {
    if (!state.examDraft?.id) return;
    if (!window.confirm(`Xóa vĩnh viễn đề ${state.examDraft.code}? Các điểm đã lưu vẫn được giữ lại.`)) return;
    const { error } = await window.supabaseClient.from("exams").delete().eq("id", state.examDraft.id);
    if (error) {
      showToast(`Không thể xóa đề: ${error.message}`);
      return;
    }
    state.examDraft = null;
    renderExamEditor();
    await loadTeacherExams();
    await loadPublishedExams();
    showToast("Đã xóa đề.");
  }

  async function seedDefaultExam() {
    if (!window.EXAM_DATA && typeof EXAM_DATA === "undefined") {
      showToast("Không tìm thấy dữ liệu đề mẫu trong data.js.");
      return;
    }
    const sample = typeof EXAM_DATA !== "undefined" ? EXAM_DATA : window.EXAM_DATA;
    const existing = state.teacherExams.find((exam) => exam.code === "VL-THPT-01");
    if (existing) {
      setExamDraftFromExam(existing);
      showToast("Đề mẫu số 01 đã có trong Supabase.");
      return;
    }

    const payload = {
      code: "VL-THPT-01",
      title: sample.title || "Đề luyện tổng hợp Vật lí THPT số 01",
      description: "Đề luyện tổng hợp theo cấu trúc mới gồm 18 câu nhiều lựa chọn, 4 câu Đúng/Sai và 6 câu trả lời ngắn.",
      duration_minutes: Number(sample.durationMinutes || 50),
      grade_level: "THPT",
      is_published: true,
      exam_data: sample,
      created_by: state.teacherUser.id,
      updated_at: new Date().toISOString()
    };

    const button = $("#seed-default-exam-button");
    button.disabled = true;
    button.textContent = "Đang đưa đề mẫu lên...";
    try {
      const { data, error } = await window.supabaseClient.from("exams").insert(payload).select().single();
      if (error) throw error;
      state.examDraft = normalizeExamRow(data);
      await loadTeacherExams();
      await loadPublishedExams();
      showToast("Đã đưa đề mẫu số 01 lên Supabase và xuất bản.");
    } catch (error) {
      console.error("Không tạo được đề mẫu:", error);
      showToast(`Không tạo được đề mẫu: ${error.message || "Lỗi không xác định"}`);
    } finally {
      button.disabled = false;
      button.textContent = "Đưa đề mẫu số 01 lên Supabase";
    }
  }

  function exportCsv() {
    const results = state.dashboardResults;
    if (!results.length) return showToast("Chưa có dữ liệu để xuất.");
    const rows = [
      ["Họ và tên", "Lớp", "Mã đề", "Phần I", "Phần II", "Phần III", "Tổng điểm", "Thời gian (giây)", "Ngày làm"],
      ...results.map((result) => [result.name, result.className, result.examCode, result.part1, result.part2, result.part3, result.score, result.timeUsedSeconds, formatDate(result.submittedAt)])
    ];
    const csv = "\uFEFF" + rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bang-diem-vat-li-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function csvEscape(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function formatDuration(totalSeconds) {
    const minutes = Math.floor(Number(totalSeconds || 0) / 60);
    const seconds = Number(totalSeconds || 0) % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function formatDate(iso) {
    const date = new Date(iso);
    return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function truncate(text, maxLength) {
    const value = String(text || "");
    return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[character]));
  }

  function normalizeLatexEscapes(value) {
    let text = String(value ?? "");

    // Một số vòng JSON/AI có thể làm backslash bị nhân đôi. Chỉ thu gọn
    // trước các lệnh LaTeX quen thuộc để không phá ký tự xuống dòng hợp lệ.
    text = text.replace(
      /\\\\(?=(?:\(|\)|\[|\]|,|;|!|quad\b|qquad\b|mathrm\b|text\b|frac\b|sqrt\b|cdot\b|times\b|circ\b|Delta\b|lambda\b|rho\b|alpha\b|beta\b|omega\b|mu\b|vec\b|left\b|right\b|pm\b|le\b|ge\b|neq\b|approx\b))/g,
      "\\"
    );

    // OCR/LLM đôi lúc tạo \^ thay vì ^.
    text = text.replace(/\\\^/g, "^");
    return text;
  }

  function protectMathSegments(text) {
    const segments = [];
    const pattern =
      /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$(?!\$)[^$\n]+?\$/g;
    const masked = String(text).replace(pattern, (match) => {
      const token = `@@PHYSICS_MATH_${segments.length}@@`;
      segments.push(match);
      return token;
    });
    return { masked, segments };
  }

  function restoreMathSegments(text, segments) {
    return String(text).replace(/@@PHYSICS_MATH_(\d+)@@/g, (_, index) => segments[Number(index)] || "");
  }

  function wrapLooseLatex(value) {
    let text = normalizeLatexEscapes(value);
    const { masked, segments } = protectMathSegments(text);
    text = masked;

    // Sửa dấu phẩy kiểu LaTeX bị lộ ra ngoài math: 4{,}2 -> 4,2.
    text = text.replace(/(\d)\{,\}(\d)/g, "$1,$2");

    // OCR/LLM đôi lúc làm mất backslash ở tên đại lượng Hy Lạp.
    text = text
      .replace(/\brho\s*=/gi, "\\rho =")
      .replace(/\blambda\s*=/gi, "\\lambda =");

    // Nhiệt độ
    text = text.replace(
      /([+-]?\d+(?:[.,]\d+)?)\s*(?:\^\{?\\circ\}?|\\circ|°)\s*(?:\\mathrm\{C\}|C\b)/g,
      (_, number) => `\\(${number}^{\\circ}\\mathrm{C}\\)`
    );

    text = text.replace(
      /(?<![A-Za-z0-9])\^\{?\\circ\}?\s*\\mathrm\{C\}/g,
      "\\(^{\\circ}\\mathrm{C}\\)"
    );

    // [PATCH] Vét các lệnh LaTeX độc lập (vd: \circ, \lambda, \mathrm{...}) chưa được wrap
    text = text.replace(/(?<![A-Za-z\\])(\\(?:circ|mathrm\{[^}]+\}|lambda|rho|alpha|beta|gamma|omega|mu|nu|pi|Delta|Phi|Psi|theta|vec(?:\{[^}]+\})?))(?![A-Za-z])/g, "\\($1\\)");

    text = text.replace(
      /((?:\\rho|\\lambda)\s*=\s*[+-]?\d+(?:[.,]\d+)?(?:\s*[A-Za-z]+(?:\/[A-Za-z]+)?(?:\^-?\d+)?)?)/g,
      (match) => `\\(${match.trim()}\\)`
    );

    text = text.replace(
      /((?:[A-Za-z][A-Za-z0-9_{}]*\s*=\s*)?[+-]?\d+(?:[.,]\d+)?(?:\\(?:cdot|times)\s*10\^\{?-?\d+\}?)?(?:\\,)?\\mathrm\{[^{}]+\})/g,
      "\\($1\\)"
    );

    text = text.replace(
      /([+-]?\d+(?:[.,]\d+)?\\(?:cdot|times)\s*10\^\{?-?\d+\}?)/g,
      "\\($1\\)"
    );

    text = text.replace(
      /((?:[A-Za-z]\w*\s*=\s*)?(?:\\frac\{[^{}\n]*\}\{[^{}\n]*\}|\\sqrt\{[^{}\n]*\}|\\vec\{[^{}\n]*\}|\\Delta\b[^;,\n]*))/g,
      (match) => `\\(${match.trim()}\\)`
    );

    return restoreMathSegments(text, segments);
  }

  function cleanupInlineDisplayText(value) {
    return wrapLooseLatex(
      String(value ?? "")
        .replace(/\r/g, "")
        .replace(/\u00a0/g, " ")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/[ \t]*\n[ \t]*/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  function cleanupOptionText(value, optionIndex = -1) {
    let raw = normalizeLatexEscapes(
      String(value ?? "")
        .replace(/\r/g, "")
        .replace(/\u00a0/g, " ")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim()
    );

    if (!raw) return "";

    const expectedLetter = optionIndex >= 0 ? String.fromCharCode(65 + optionIndex) : "";
    const stripLabel = (line) => {
      let cleaned = String(line || "").trim();
      let prev = "";
      while (cleaned && cleaned !== prev) {
        prev = cleaned;
        if (expectedLetter) {
          cleaned = cleaned.replace(new RegExp(`^\\s*${expectedLetter}\\s*[.\\):\\]\\-\\s]+`, "i"), "").trim();
        }
        cleaned = cleaned.replace(/^\s*[A-D]\s*[.\\):\\]\\-\\s]+/i, "").trim();
      }
      return cleaned;
    };

    const lines = raw.split("\n").map(stripLabel).filter(Boolean);
    if (lines.length <= 1) return wrapLooseLatex(lines[0] || raw);

    let result = "";
    for (const line of lines) {
      if (!result) {
        result = line;
        continue;
      }

      // Nối các chữ số OCR bị tách thành 7 / 4 / 0 hoặc 2 / 9 / 1.
      if (/^[+-]?\d+$/.test(result) && /^\d+$/.test(line)) {
        result += line;
        continue;
      }

      // Nối phần thập phân bị tách kiểu 24, / 5.
      if (/\d[,.]$/.test(result) && /^\d+$/.test(line)) {
        result += line;
        continue;
      }

      // Nối đơn vị bị OCR tách từng ký tự: m / l -> ml, K / . -> K.
      if (/[A-Za-z]$/.test(result) && /^[A-Za-z]$/.test(line)) {
        result += line;
        continue;
      }

      if (/^[,.;:%)\]}°]/.test(line)) {
        result += line;
        continue;
      }

      result += ` ${line}`;
    }

    result = result
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:%)\]}])/g, "$1")
      .replace(/([({\[])\s+/g, "$1")
      .replace(/(\d)\s*°\s*C\b/gi, "$1°C")
      .replace(/(\d)\s*°\s*K\b/gi, "$1°K")
      .replace(/(\d)(ml|mL|kg|g|K|J|N|Pa|W|s)\b/g, "$1 $2")
      .trim();

    return wrapLooseLatex(result);
  }

  function renderMathContent(rootElement) {
    const renderFn = window.renderMathInElement || window.katex?.renderMathInElement;
    if (!rootElement || typeof renderFn !== "function") return;
    try {
      renderFn(rootElement, {
        delimiters: [
          { left: "\\[", right: "\\]", display: true },
          { left: "$$", right: "$$", display: true },
          { left: "\\(", right: "\\)", display: false },
          { left: "$", right: "$", display: false }
        ],
        throwOnError: false,
        strict: false,
        trust: false,
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"]
      });
    } catch (error) {
      console.error("Không render được công thức KaTeX:", error);
    }
  }

  function renderLongText(value) {
    return escapeHtml(wrapLooseLatex(value)).replace(/\r?\n/g, "<br>");
  }

  function parsePipeTableRow(line) {
    const parts = String(line || "").trim().split("|").map((cell) => cell.trim());
    if (parts[0] === "") parts.shift();
    if (parts[parts.length - 1] === "") parts.pop();
    return parts;
  }

  function isMarkdownSeparatorRow(cells) {
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(String(cell).trim()));
  }

  function isPipeTableStart(lines, index) {
    if (index + 1 >= lines.length) return false;
    const first = parsePipeTableRow(lines[index]);
    const second = parsePipeTableRow(lines[index + 1]);
    const firstPipeCount = (String(lines[index]).match(/\|/g) || []).length;
    const secondPipeCount = (String(lines[index + 1]).match(/\|/g) || []).length;
    return firstPipeCount >= 2 && secondPipeCount >= 2 && first.length >= 3 && second.length === first.length;
  }

  function renderRichContent(
    value,
    preferredVisualSignatures = null
  ) {
    const text = String(value ?? "").replace(/\r/g, "").trim();
    if (!text) return "";

    const lines = text.split("\n");
    const blocks = [];
    let paragraphLines = [];

    const flushParagraph = () => {
      while (paragraphLines.length && !paragraphLines[0].trim()) {
        paragraphLines.shift();
      }

      while (
        paragraphLines.length &&
        !paragraphLines[paragraphLines.length - 1].trim()
      ) {
        paragraphLines.pop();
      }

      if (!paragraphLines.length) return;

      blocks.push(
        `<div class="rich-text-paragraph">${renderLongText(
          paragraphLines.join("\n")
        )}</div>`
      );

      paragraphLines = [];
    };

    for (let index = 0; index < lines.length;) {
      if (!isPipeTableStart(lines, index)) {
        paragraphLines.push(lines[index]);
        index += 1;
        continue;
      }

      let caption = "";
      const precedingLine = String(
        paragraphLines[paragraphLines.length - 1] || ""
      ).trim();

      if (/^bảng(?:\s+.*)?[:：]?$/i.test(precedingLine)) {
        paragraphLines.pop();
        caption = precedingLine.replace(/[:：]\s*$/, "").trim();

        if (caption.toLowerCase() === "bảng") {
          caption = "Bảng số liệu";
        }
      }

      flushParagraph();

      const header = parsePipeTableRow(lines[index]);
      const rows = [];
      index += 1;

      if (index < lines.length) {
        const possibleSeparator = parsePipeTableRow(lines[index]);

        if (
          possibleSeparator.length === header.length &&
          isMarkdownSeparatorRow(possibleSeparator)
        ) {
          index += 1;
        }
      }

      while (index < lines.length) {
        const rawLine = lines[index];
        const pipeCount = (String(rawLine).match(/\|/g) || []).length;
        const row = parsePipeTableRow(rawLine);

        if (pipeCount < 2 || row.length !== header.length) break;

        rows.push(row);
        index += 1;
      }

      if (rows.length) {
        const tableVisual = {
          type: "table",
          caption,
          headers: header,
          rows
        };

        const signature = getVisualSignature(tableVisual);

        // Nếu AI đã tạo một bảng có cấu trúc trong visuals thì không render
        // thêm bảng chép bằng dấu | trong stem/context/passage.
        const duplicatedByStructuredVisual =
          signature &&
          preferredVisualSignatures instanceof Set &&
          preferredVisualSignatures.has(signature);

        if (!duplicatedByStructuredVisual) {
          blocks.push(renderPhysicsTable(tableVisual));
        }
      } else {
        paragraphLines.push(header.join(" | "));
      }
    }

    flushParagraph();
    return blocks.join("");
  }

  let toastTimeout;
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove("show"), 3200);
  }


  async function loadPhysicsPdf(file) {
    if (!file) {
      throw new Error("Chưa chọn file PDF.");
    }

    const pdfjsLib = await window.pdfJsReady;

    if (!pdfjsLib) {
      throw new Error("PDF.js chưa sẵn sàng.");
    }

    const arrayBuffer = await file.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer)
    }).promise;

    console.log(`✅ PDF có ${pdf.numPages} trang`);
    return pdf;
  }

  async function renderPhysicsPdfPage(pdf, pageNumber, scale = 2) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const ctx = canvas.getContext("2d", { alpha: false });

    if (!ctx) {
      throw new Error("Không tạo được Canvas 2D.");
    }

    const renderParams = {
      canvasContext: ctx,
      viewport
    };

    // Loại annotation/ghi chú PDF khi có thể.
    const disableAnnotation = window.pdfjsLib?.AnnotationMode?.DISABLE;
    if (disableAnnotation !== undefined) {
      renderParams.annotationMode = disableAnnotation;
    }

    await page.render(renderParams).promise;
    return canvas;
  }

  function resizeCanvasForAi(sourceCanvas, maxWidth = 1600) {
    if (!sourceCanvas) {
      throw new Error("Canvas không hợp lệ.");
    }

    if (sourceCanvas.width <= maxWidth) {
      return sourceCanvas;
    }

    const ratio = maxWidth / sourceCanvas.width;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sourceCanvas.width * ratio);
    canvas.height = Math.round(sourceCanvas.height * ratio);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Không tạo được Canvas 2D.");
    }

    ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function canvasToAiImage(canvas) {
    const resized = resizeCanvasForAi(canvas);
    return resized.toDataURL("image/jpeg", 0.85);
  }

  async function analyzePhysicsPageWithAi(
    canvas,
    pageNumber,
    questionsOnPage = [],
    maxAttempts = 3
  ) {
    const imageDataUrl = window.canvasToAiImage(canvas);
    const allowedQuestions = Array.isArray(questionsOnPage)
      ? questionsOnPage.map((question) => ({
        questionKey: String(question?.questionKey || ""),
        questionType: String(question?.questionType || ""),
        number: Number(question?.number),
        id: String(question?.id || ""),
        stem: String(question?.stem || "").slice(0, 220)
      }))
      : [];

    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        console.log(
          `🤖 AI trang ${pageNumber}, lần ${attempt}/${maxAttempts}`,
          allowedQuestions.length
            ? `| câu hợp lệ: ${allowedQuestions.map((item) => item.questionKey).join(", ")}`
            : "| chưa có sourcePage mapping"
        );

        const { data, error } =
          await window.supabaseClient.functions.invoke(
            "analyze-physics-page",
            {
              body: {
                pageNumber,
                imageDataUrl,
                questionsOnPage: allowedQuestions
              }
            }
          );

        if (error) {
          let detail = "";

          try {
            if (error.context) {
              const payload = await error.context.json();
              detail = payload?.error || JSON.stringify(payload);
            }
          } catch {
            // bỏ qua lỗi đọc chi tiết
          }

          throw new Error(
            detail ||
            error.message ||
            `Không phân tích được trang ${pageNumber}.`
          );
        }

        if (
          !data?.result ||
          typeof data.result !== "object" ||
          !Array.isArray(data.result.questions)
        ) {
          throw new Error(
            `AI trả JSON sai schema ở trang ${pageNumber}.`
          );
        }

        console.log(`✅ AI trang ${pageNumber} thành công`);
        return data.result;
      } catch (error) {
        lastError = error;

        console.warn(
          `⚠️ AI trang ${pageNumber} thất bại lần ${attempt}:`,
          error?.message || String(error)
        );

        if (attempt < maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1500 * attempt)
          );
        }
      }
    }

    throw new Error(
      `AI thất bại ${maxAttempts} lần ở trang ${pageNumber}: ` +
      (lastError?.message || "Lỗi không xác định")
    );
  }

  function clampPhysicsValue(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function autoTrimCanvasWhitespace(canvas, margin = 8) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return canvas;
    const width = canvas.width;
    const height = canvas.height;
    if (width <= 15 || height <= 15) return canvas;

    let imgData;
    try {
      imgData = ctx.getImageData(0, 0, width, height);
    } catch {
      return canvas;
    }
    const data = imgData.data;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * width * 4;
      for (let x = 0; x < width; x += 1) {
        const idx = rowOffset + (x * 4);
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        if (a > 30) {
          const isWhite = r > 246 && g > 246 && b > 246;
          if (!isWhite) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return canvas;
    }

    const leftPad = minX;
    const rightPad = width - 1 - maxX;
    const topPad = minY;
    const bottomPad = height - 1 - maxY;

    const shouldTrim =
      leftPad > margin + 6 ||
      rightPad > margin + 6 ||
      topPad > margin + 6 ||
      bottomPad > margin + 6;

    if (!shouldTrim) {
      return canvas;
    }

    const trimX = Math.max(0, minX - margin);
    const trimY = Math.max(0, minY - margin);
    const trimRight = Math.min(width, maxX + 1 + margin);
    const trimBottom = Math.min(height, maxY + 1 + margin);

    const finalWidth = trimRight - trimX;
    const finalHeight = trimBottom - trimY;

    if (finalWidth <= 5 || finalHeight <= 5) return canvas;

    const trimmed = document.createElement("canvas");
    trimmed.width = finalWidth;
    trimmed.height = finalHeight;
    const trimCtx = trimmed.getContext("2d");
    if (!trimCtx) return canvas;

    trimCtx.fillStyle = "#ffffff";
    trimCtx.fillRect(0, 0, finalWidth, finalHeight);

    trimCtx.drawImage(
      canvas,
      trimX,
      trimY,
      finalWidth,
      finalHeight,
      0,
      0,
      finalWidth,
      finalHeight
    );

    return trimmed;
  }

  function cropPhysicsVisual(sourceCanvas, bbox, padding = 2) {
    const x1 = clampPhysicsValue(bbox?.x1, 0, 1000);
    const y1 = clampPhysicsValue(bbox?.y1, 0, 1000);
    const x2 = clampPhysicsValue(bbox?.x2, 0, 1000);
    const y2 = clampPhysicsValue(bbox?.y2, 0, 1000);

    if (x2 <= x1 || y2 <= y1) {
      throw new Error("Bounding box của AI không hợp lệ.");
    }

    let sx = Math.round(sourceCanvas.width * x1 / 1000);
    let sy = Math.round(sourceCanvas.height * y1 / 1000);
    let ex = Math.round(sourceCanvas.width * x2 / 1000);
    let ey = Math.round(sourceCanvas.height * y2 / 1000);

    sx = Math.max(0, sx - padding);
    sy = Math.max(0, sy - padding);
    ex = Math.min(sourceCanvas.width, ex + padding);
    ey = Math.min(sourceCanvas.height, ey + padding);

    const width = ex - sx;
    const height = ey - sy;

    if (width <= 1 || height <= 1) {
      throw new Error("Vùng crop quá nhỏ hoặc không hợp lệ.");
    }

    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;

    const ctx = output.getContext("2d");
    if (!ctx) {
      throw new Error("Không tạo được Canvas crop.");
    }

    ctx.drawImage(
      sourceCanvas,
      sx,
      sy,
      width,
      height,
      0,
      0,
      width,
      height
    );

    return autoTrimCanvasWhitespace(output, 8);
  }

  function physicsCanvasToWebp(canvas, quality = 0.9) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Không tạo được WebP."));
            return;
          }
          resolve(blob);
        },
        "image/webp",
        quality
      );
    });
  }

  async function uploadPhysicsVisual({
    canvas,
    examCode,
    pageNumber,
    questionType,
    questionNumber,
    visualIndex
  }) {
    const blob = await physicsCanvasToWebp(canvas);
    const safeExamCode = String(examCode).replace(/[^a-zA-Z0-9_-]/g, "-");
    const safeType = ["mcq", "tf", "short"].includes(questionType)
      ? questionType
      : "question";

    const path =
      `${safeExamCode}/` +
      `${safeType}-${questionNumber}-` +
      `page-${pageNumber}-` +
      `${visualIndex + 1}.webp`;

    const { error } = await window.supabaseClient.storage
      .from("exam-images")
      .upload(path, blob, {
        contentType: "image/webp",
        upsert: true
      });

    if (error) {
      throw new Error(`Upload ảnh thất bại: ${error.message}`);
    }

    const { data } = window.supabaseClient.storage
      .from("exam-images")
      .getPublicUrl(path);

    if (!data?.publicUrl) {
      throw new Error("Không lấy được public URL của ảnh.");
    }

    return {
      imageUrl: data.publicUrl,
      storagePath: path
    };
  }

  function normalizeDetectedQuestionType(detected) {
    const rawType = String(detected?.questionType || "")
      .trim()
      .toLowerCase();

    if (["mcq", "multiple_choice", "multiple-choice"].includes(rawType)) {
      return "mcq";
    }

    if (["tf", "truefalse", "true_false", "true-false"].includes(rawType)) {
      return "tf";
    }

    if (["short", "shortanswer", "short_answer", "short-answer"].includes(rawType)) {
      return "short";
    }

    const part = Number(detected?.part);
    if (part === 1) return "mcq";
    if (part === 2) return "tf";
    if (part === 3) return "short";

    return "";
  }


  function getQuestionsForSourcePage(examData, pageNumber) {
    const page = Number(pageNumber);
    const result = [];

    const pushQuestion = (questionType, list, index) => {
      const question = list?.[index];
      if (!question || Number(question.sourcePage) !== page) return;

      const number = index + 1;
      const stemSource =
        question.stem ||
        question.context ||
        question.topic ||
        "";

      result.push({
        questionKey: `${questionType}-${number}`,
        questionType,
        number,
        id: String(question.id || `${questionType}-${number}`),
        sourcePage: page,
        topic: String(question.topic || "").replace(/\s+/g, " ").trim().slice(0, 100),
        passageId: String(question.passageId || "").trim(),
        context: String(question.context || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 500),
        stem: String(stemSource || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 500)
      });
    };

    (examData?.mcq || []).forEach((_, index) =>
      pushQuestion("mcq", examData.mcq, index)
    );

    (examData?.trueFalse || []).forEach((_, index) =>
      pushQuestion("tf", examData.trueFalse, index)
    );

    (examData?.shortAnswer || []).forEach((_, index) =>
      pushQuestion("short", examData.shortAnswer, index)
    );

    return result;
  }

  function findPhysicsExamQuestionByKey(examData, questionKey) {
    const match = String(questionKey || "")
      .trim()
      .toLowerCase()
      .match(/^(mcq|tf|short)-(\d+)$/);

    if (!match) return null;

    const questionType = match[1];
    const number = Number(match[2]);
    const index = number - 1;

    if (!Number.isInteger(index) || index < 0) return null;

    if (questionType === "mcq") {
      return examData?.mcq?.[index] || null;
    }

    if (questionType === "tf") {
      return examData?.trueFalse?.[index] || null;
    }

    if (questionType === "short") {
      return examData?.shortAnswer?.[index] || null;
    }

    return null;
  }

  function resolveDetectedQuestionMapping(
    examData,
    detected,
    pageNumber,
    questionsOnPage
  ) {
    const allowed = Array.isArray(questionsOnPage)
      ? questionsOnPage
      : [];

    const allowedByKey = new Map(
      allowed.map((item) => [
        String(item.questionKey || "").toLowerCase(),
        item
      ])
    );

    const explicitKey = String(
      detected?.questionKey ||
      detected?.question_key ||
      ""
    )
      .trim()
      .toLowerCase();

    if (explicitKey && allowedByKey.has(explicitKey)) {
      const meta = allowedByKey.get(explicitKey);
      const question = findPhysicsExamQuestionByKey(
        examData,
        explicitKey
      );

      if (question) {
        return {
          ok: true,
          question,
          questionKey: explicitKey,
          questionType: meta.questionType,
          questionNumber: meta.number,
          source: "questionKey",
          needsReview: false
        };
      }
    }

    const detectedType = normalizeDetectedQuestionType(detected);
    const detectedNumber = Number(detected?.number);

    if (
      detectedType &&
      Number.isInteger(detectedNumber) &&
      detectedNumber > 0
    ) {
      const detectedKey = `${detectedType}-${detectedNumber}`;

      if (allowedByKey.has(detectedKey)) {
        const meta = allowedByKey.get(detectedKey);
        const question = findPhysicsExamQuestionByKey(
          examData,
          detectedKey
        );

        if (question) {
          return {
            ok: true,
            question,
            questionKey: detectedKey,
            questionType: meta.questionType,
            questionNumber: meta.number,
            source: "type+number",
            needsReview: false
          };
        }
      }
    }

    // Nếu sourcePage nói rằng trang chỉ có đúng một câu,
    // có thể map an toàn hơn dù AI đoán sai số câu/loại câu.
    // Vẫn đánh dấu needsReview để giáo viên biết đây là fallback.
    if (allowed.length === 1) {
      const meta = allowed[0];
      const key = String(meta.questionKey || "").toLowerCase();
      const question = findPhysicsExamQuestionByKey(
        examData,
        key
      );

      if (question) {
        return {
          ok: true,
          question,
          questionKey: key,
          questionType: meta.questionType,
          questionNumber: meta.number,
          source: "single-sourcePage-fallback",
          needsReview: true
        };
      }
    }

    return {
      ok: false,
      question: null,
      questionKey: "",
      questionType: detectedType,
      questionNumber: detectedNumber,
      source: "unresolved",
      needsReview: true,
      pageNumber,
      allowedQuestionKeys: allowed.map((item) => item.questionKey)
    };
  }

  function findPhysicsExamQuestion(examData, questionType, number) {
    const index = Number(number) - 1;

    if (!Number.isInteger(index) || index < 0) {
      return null;
    }

    if (questionType === "mcq") {
      return examData.mcq?.[index] || null;
    }

    if (questionType === "tf") {
      return examData.trueFalse?.[index] || null;
    }

    if (questionType === "short") {
      return examData.shortAnswer?.[index] || null;
    }

    return null;
  }

  function waitPhysicsImport(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function physicsBBoxArea(bbox) {
    return Math.max(0, Number(bbox?.x2) - Number(bbox?.x1)) *
      Math.max(0, Number(bbox?.y2) - Number(bbox?.y1));
  }

  function physicsBBoxIoU(a, b) {
    const ix1 = Math.max(Number(a?.x1), Number(b?.x1));
    const iy1 = Math.max(Number(a?.y1), Number(b?.y1));
    const ix2 = Math.min(Number(a?.x2), Number(b?.x2));
    const iy2 = Math.min(Number(a?.y2), Number(b?.y2));
    const intersection =
      Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
    if (!intersection) return 0;
    const union = physicsBBoxArea(a) + physicsBBoxArea(b) - intersection;
    return union > 0 ? intersection / union : 0;
  }

  function isPipelineExamImageUrl(url) {
    const value = String(url || "");
    return value.includes("/storage/v1/object/public/exam-images/") ||
      value.includes("/exam-images/");
  }

  function clearGeneratedPhysicsVisualFields(examData) {
    const lists = [
      examData?.mcq || [],
      examData?.trueFalse || [],
      examData?.shortAnswer || []
    ];

    for (const list of lists) {
      for (const question of list) {
        const hasAiMeta =
          Array.isArray(question?.visualImageMeta) &&
          question.visualImageMeta.length > 0;
        const urls = [
          question?.imageUrl,
          ...(Array.isArray(question?.imageUrls) ? question.imageUrls : [])
        ].filter(Boolean);
        const hasPipelineUrl = urls.some(isPipelineExamImageUrl);

        // Chỉ xóa ảnh do pipeline tạo. Ảnh thủ công/external không bị đụng tới.
        if (!hasAiMeta && !hasPipelineUrl) continue;

        delete question.imageUrl;
        delete question.imageUrls;
        delete question.imageCaption;
        delete question.visualImageMeta;
        delete question.imageRequired;
      }
    }
  }

  async function processAllPhysicsPdfVisuals(file, examCode, options = {}) {
    if (!file) {
      throw new Error("Chưa chọn file PDF.");
    }

    if (!examCode) {
      throw new Error("Thiếu mã đề.");
    }

    if (!window.supabaseClient) {
      throw new Error("Supabase chưa được khởi tạo.");
    }

    const delayMs = Math.max(0, Number(options.delayMs ?? 900));
    const renderScale = Math.max(1, Number(options.renderScale ?? 2));
    const minConfidence = Math.min(
      1,
      Math.max(0, Number(options.minConfidence ?? 0.65))
    );
    const dryRun = Boolean(options.dryRun);
    const replaceExistingVisuals =
      options.replaceExistingVisuals !== false;
    const allowReviewVisuals =
      options.allowReviewVisuals === true;
    const cropPadding = Math.max(
      0,
      Math.min(12, Number(options.cropPadding ?? 8))
    );
    const onProgress =
      typeof options.onProgress === "function" ? options.onProgress : null;

    console.log("================================");
    console.log("🚀 BẮT ĐẦU XỬ LÝ HÌNH PDF");
    console.log("Đề:", examCode);
    console.log(
      "Chế độ:",
      dryRun
        ? "DRY RUN - không upload/ghi DB"
        : "UPLOAD + CẬP NHẬT DB"
    );

    const { data: examRow, error: examError } =
      await window.supabaseClient
        .from("exams")
        .select("id, code, exam_data")
        .eq("code", examCode)
        .maybeSingle();

    if (examError) throw examError;
    if (!examRow) {
      const authUser = (await window.supabaseClient.auth.getUser())?.data?.user;
      const userEmail = authUser?.email || "chưa đăng nhập";
      throw new Error(
        `Không tìm thấy đề thi "${examCode}" trên Supabase!\n` +
        `Nguyên nhân:\n` +
        `1. Đề thi này chưa được tạo trên Supabase (hãy tạo đề hoặc nhấn "Đưa đề mẫu lên Supabase").\n` +
        `2. Nếu đề đang là 'Bản nháp', tài khoản (${userEmail}) chưa được thêm vào hàm SQL is_exam_teacher() nên RLS chặn quyền xem đề.`
      );
    }

    const examData = structuredClone(
      examRow.exam_data || createEmptyExamData()
    );

    if (!dryRun && replaceExistingVisuals) {
      clearGeneratedPhysicsVisualFields(examData);
      console.log("🧹 Đã xóa tham chiếu ảnh AI cũ trong bản clone trước REAL RUN.");
    }

    const pdf = await loadPhysicsPdf(file);

    console.log(`📄 PDF có ${pdf.numPages} trang`);

    const report = {
      pages: pdf.numPages,
      analyzedPages: 0,
      failedPages: 0,
      detectedVisuals: 0,
      mappedVisuals: 0,
      uploaded: 0,
      skipped: 0,
      unsafeSkipped: 0,
      duplicateSkipped: 0,
      review: [],
      uploads: []
    };

    const pageResults = [];

    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages;
      pageNumber += 1
    ) {
      console.log(`🔍 Trang ${pageNumber}/${pdf.numPages}`);

      const questionsOnPage = getQuestionsForSourcePage(
        examData,
        pageNumber
      );

      console.log(
        `📌 sourcePage ${pageNumber}:`,
        questionsOnPage.map((item) => item.questionKey).join(", ") ||
        "không có câu được map"
      );

      if (onProgress) {
        onProgress({
          type: "page_start",
          pageNumber,
          totalPages: pdf.numPages,
          questionsCount: questionsOnPage.length
        });
      }

      const pageCanvas = await renderPhysicsPdfPage(
        pdf,
        pageNumber,
        renderScale
      );

      let analysis;

      try {
        analysis = await analyzePhysicsPageWithAi(
          pageCanvas,
          pageNumber,
          questionsOnPage
        );
        report.analyzedPages += 1;
      } catch (error) {
        console.error(`❌ AI lỗi trang ${pageNumber}:`, error);
        report.failedPages += 1;

        const failure = {
          page: pageNumber,
          reason: error?.message || String(error)
        };

        report.review.push(failure);
        pageResults.push({
          page: pageNumber,
          questionsOnPage,
          failed: true,
          error: failure.reason,
          detections: []
        });

        if (pageNumber < pdf.numPages && delayMs > 0) {
          await waitPhysicsImport(delayMs);
        }
        continue;
      }

      const questions = Array.isArray(analysis.questions)
        ? analysis.questions
        : [];

      const pageResult = {
        page: pageNumber,
        questionsOnPage,
        failed: false,
        detections: []
      };

      const claimedPageVisuals = [];

      for (const detected of questions) {
        const visuals = Array.isArray(detected?.visuals)
          ? detected.visuals
          : [];

        const imageVisuals = visuals.filter(
          (visual) =>
            String(visual?.type || "").toLowerCase() === "image" &&
            visual?.bbox
        );

        if (!imageVisuals.length) continue;

        report.detectedVisuals += imageVisuals.length;

        const mapping = resolveDetectedQuestionMapping(
          examData,
          detected,
          pageNumber,
          questionsOnPage
        );

        const detectionLog = {
          aiQuestionKey: String(
            detected?.questionKey ||
            detected?.question_key ||
            ""
          ),
          aiType: normalizeDetectedQuestionType(detected),
          aiNumber: Number(detected?.number) || null,
          visualCount: imageVisuals.length,
          mappedQuestionKey: mapping.questionKey || "",
          mappingSource: mapping.source,
          needsReview: Boolean(mapping.needsReview)
        };

        pageResult.detections.push(detectionLog);

        if (!mapping.ok || !mapping.question) {
          console.warn(
            `⚠️ Bỏ qua visual trang ${pageNumber}: AI trả`,
            detectionLog.aiType || "?",
            detectionLog.aiNumber || "?",
            "| sourcePage chỉ cho phép:",
            mapping.allowedQuestionKeys || []
          );

          report.skipped += imageVisuals.length;
          report.review.push({
            page: pageNumber,
            aiType: detectionLog.aiType,
            aiNumber: detectionLog.aiNumber,
            allowedQuestionKeys:
              mapping.allowedQuestionKeys || [],
            reason:
              "AI map câu không khớp sourcePage. Không tự gắn ảnh để tránh sai câu."
          });
          continue;
        }

        const targetQuestion = mapping.question;
        const questionKey = mapping.questionKey;
        const questionType = mapping.questionType;
        const questionNumber = mapping.questionNumber;

        report.mappedVisuals += imageVisuals.length;

        if (mapping.needsReview) {
          targetQuestion.needsReview = true;
          report.review.push({
            page: pageNumber,
            questionKey,
            reason:
              "Đã dùng fallback sourcePage vì AI không trả đúng mã câu. Trang chỉ có một câu nên hệ thống vẫn có thể map, nhưng cần kiểm tra lại."
          });
        }

        const imageUrls = [];
        const visualMeta = [];

        for (
          let visualIndex = 0;
          visualIndex < imageVisuals.length;
          visualIndex += 1
        ) {
          const visual = imageVisuals[visualIndex];
          const confidenceRaw = Number(visual?.confidence);
          const confidence = Number.isFinite(confidenceRaw)
            ? confidenceRaw
            : 1;
          const containsAnswerText = Boolean(
            visual?.containsAnswerText
          );
          const cropSafe = visual?.cropSafe !== false;

          if (
            !cropSafe ||
            containsAnswerText
          ) {
            report.skipped += 1;
            report.unsafeSkipped += 1;
            report.review.push({
              page: pageNumber,
              questionKey,
              reason:
                containsAnswerText
                  ? "Bỏ crop vì AI phát hiện bbox dính đáp án/lựa chọn."
                  : "Bỏ crop vì AI đánh dấu crop không an toàn."
            });
            continue;
          }

          const duplicateOwner = claimedPageVisuals.find(
            (entry) =>
              entry.questionKey !== questionKey &&
              physicsBBoxIoU(entry.bbox, visual.bbox) >= 0.86
          );

          if (duplicateOwner) {
            report.skipped += 1;
            report.duplicateSkipped += 1;
            report.review.push({
              page: pageNumber,
              questionKey,
              reason:
                `Bỏ visual trùng bbox với ${duplicateOwner.questionKey}.`
            });
            continue;
          }

          if (confidence < minConfidence) {
            console.warn(
              `⚠️ Confidence thấp: trang ${pageNumber}, ${questionKey}`
            );

            report.skipped += 1;
            report.review.push({
              page: pageNumber,
              questionKey,
              confidence,
              reason:
                "AI nhận diện hình với độ tin cậy thấp."
            });
            continue;
          }

          let crop;

          try {
            crop = cropPhysicsVisual(
              pageCanvas,
              visual.bbox,
              cropPadding
            );
          } catch (error) {
            report.skipped += 1;
            report.review.push({
              page: pageNumber,
              questionKey,
              reason: error?.message || String(error)
            });
            continue;
          }

          claimedPageVisuals.push({
            questionKey,
            bbox: visual.bbox
          });

          if (dryRun) {
            visualMeta.push({
              questionKey,
              description: String(
                visual?.description || ""
              ),
              confidence,
              containsAnswerText,
              cropSafe,
              bbox: visual.bbox,
              imageUrl: ""
            });

            console.log(
              `🧪 DRY RUN: ${questionKey}, hình ${visualIndex + 1} | map=${mapping.source}`
            );
            continue;
          }

          try {
            const uploaded =
              await uploadPhysicsVisual({
                canvas: crop,
                examCode,
                pageNumber,
                questionType,
                questionNumber,
                visualIndex
              });

            imageUrls.push(uploaded.imageUrl);
            visualMeta.push({
              questionKey,
              description: String(
                visual?.description || ""
              ),
              confidence,
              containsAnswerText,
              cropSafe,
              bbox: visual.bbox,
              imageUrl: uploaded.imageUrl,
              storagePath: uploaded.storagePath
            });

            report.uploaded += 1;
            report.uploads.push({
              page: pageNumber,
              questionKey,
              type: questionType,
              number: questionNumber,
              imageUrl: uploaded.imageUrl,
              storagePath: uploaded.storagePath
            });

            console.log(
              `✅ ${questionKey}, hình ${visualIndex + 1}:`,
              uploaded.imageUrl
            );

            if (onProgress) {
              onProgress({
                type: "visual_uploaded",
                pageNumber,
                totalPages: pdf.numPages,
                questionKey,
                imageUrl: uploaded.imageUrl
              });
            }
          } catch (error) {
            report.skipped += 1;
            console.error("Upload ảnh lỗi:", error);
            report.review.push({
              page: pageNumber,
              questionKey,
              reason: error?.message || String(error)
            });
          }
        }

        if (imageUrls.length) {
          // REAL RUN mới thay thế ảnh pipeline cũ, không cộng dồn URL từ các lần chạy trước.
          targetQuestion.imageRequired = true;
          targetQuestion.imageUrl = imageUrls[0];
          targetQuestion.imageUrls = [...new Set(imageUrls)];
          targetQuestion.imageCaption = "Hình minh họa cho câu hỏi";
          targetQuestion.visualImageMeta = visualMeta;
        }

        if (
          imageVisuals.some(
            (visual) =>
              visual?.containsAnswerText ||
              visual?.cropSafe === false
          )
        ) {
          report.review.push({
            page: pageNumber,
            questionKey,
            reason:
              "AI phát hiện hình cần giáo viên kiểm tra lại."
          });
        }
      }

      pageResults.push(pageResult);

      if (
        pageNumber < pdf.numPages &&
        delayMs > 0
      ) {
        await waitPhysicsImport(delayMs);
      }
    }

    if (!dryRun && report.failedPages > 0) {
      throw new Error(
        `REAL RUN có ${report.failedPages} trang AI thất bại. ` +
        "Không ghi exam_data để tránh làm mất/ghi thiếu ảnh. Hãy sửa lỗi rồi chạy lại."
      );
    }

    if (!dryRun) {
      console.log("💾 Đang lưu exam_data...");

      if (onProgress) {
        onProgress({
          type: "saving_db",
          totalPages: pdf.numPages
        });
      }

      const { data: updated, error: updateError } =
        await window.supabaseClient
          .from("exams")
          .update({
            exam_data: examData
          })
          .eq("id", examRow.id)
          .select("id, code")
          .single();

      if (updateError) {
        if (updateError.code === "PGRST116") {
          const authUser = (await window.supabaseClient.auth.getUser())?.data?.user;
          const userEmail = authUser?.email || "chưa rõ";
          throw new Error(
            `Không thể lưu exam_data vào DB: Tài khoản hiện tại (${userEmail}) chưa được cấp quyền giáo viên ` +
            `trong hàm SQL is_exam_teacher() trên Supabase (bị RLS chặn cập nhật). ` +
            `Vui lòng chạy câu lệnh SQL thêm email này vào is_exam_teacher() trên Supabase Dashboard.`
          );
        }
        throw updateError;
      }

      console.log("✅ ĐÃ HOÀN THÀNH", updated);

      if (report.review.length) {
        console.table(report.review);
      }

      console.log("📊 BÁO CÁO:", report);

      return {
        updated,
        report,
        pageResults,
        examData
      };
    }

    console.log(
      "🧪 DRY RUN hoàn tất. Không upload ảnh và không sửa database."
    );

    if (report.review.length) {
      console.table(report.review);
    }

    console.log("📊 BÁO CÁO:", report);

    return {
      updated: null,
      report,
      pageResults,
      examData
    };
  }

  window.loadPhysicsPdf = loadPhysicsPdf;
  window.renderPhysicsPdfPage = renderPhysicsPdfPage;
  window.resizeCanvasForAi = resizeCanvasForAi;
  window.canvasToAiImage = canvasToAiImage;
  window.analyzePhysicsPageWithAi = analyzePhysicsPageWithAi;
  window.getQuestionsForSourcePage = getQuestionsForSourcePage;
  window.findPhysicsExamQuestionByKey = findPhysicsExamQuestionByKey;
  window.resolveDetectedQuestionMapping = resolveDetectedQuestionMapping;
  window.cropPhysicsVisual = cropPhysicsVisual;
  window.processAllPhysicsPdfVisuals = processAllPhysicsPdfVisuals;

  document.addEventListener("DOMContentLoaded", initialize);
})();

