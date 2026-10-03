/**
 * 小二數學科練習 — multi-paper offline quiz
 */
(function () {
  "use strict";

  const STORAGE_PREFIX = "p2-quiz-v2:";

  /** @type {{ version:number, appTitle:string, papers: object[] } | null} */
  let catalog = null;
  /** @type {object | null} */
  let paper = null;
  /** @type {object[]} */
  let QUESTIONS = [];

  const state = {
    name: "",
    paperId: null,
    index: 0,
    /** @type {Record<string, any>} */
    answers: {},
    activeSlot: null,
    started: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const screenStart = $("#screen-start");
  const screenQuiz = $("#screen-quiz");
  const screenResult = $("#screen-result");
  const nameInput = $("#student-name");
  const btnStart = $("#btn-start");
  const resumeHint = $("#resume-hint");
  const paperList = $("#paper-list");
  const selectedPaperMeta = $("#selected-paper-meta");
  const sectionBadge = $("#section-badge");
  const progressText = $("#progress-text");
  const progressDots = $("#progress-dots");
  const questionArea = $("#question-area");
  const btnPrev = $("#btn-prev");
  const btnNext = $("#btn-next");
  const btnSubmit = $("#btn-submit");
  const btnHome = $("#btn-home");
  const keypad = $("#keypad");
  const btnRetry = $("#btn-retry");
  const btnBackPicker = $("#btn-back-picker");

  function storageKey(paperId) {
    return STORAGE_PREFIX + (paperId || "none");
  }

  function save() {
    if (!state.paperId) return;
    try {
      localStorage.setItem(
        storageKey(state.paperId),
        JSON.stringify({
          name: state.name,
          paperId: state.paperId,
          index: state.index,
          answers: state.answers,
          started: state.started,
          savedAt: Date.now(),
        })
      );
    } catch (_) {}
  }

  function load(paperId) {
    try {
      const raw = localStorage.getItem(storageKey(paperId));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function clearStorage(paperId) {
    try {
      localStorage.removeItem(storageKey(paperId || state.paperId));
    } catch (_) {}
  }

  function normalizeNumeric(val) {
    if (val == null) return "";
    let s = String(val).trim();
    s = s.replace(/星期|小時|分鐘|人|元|角|枝|個|組|分|份|輛|塊|盒|隻|粒|包|條|張|碟|天|朵|打|棵|排|行|cm|CM/gi, "").trim();
    s = s.replace(/,/g, "");
    return s;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isAnswered(q) {
    const a = state.answers[q.id];
    if (!a) return false;
    if (q.type === "mc") return typeof a.choice === "number";
    if (q.type === "commutative") {
      return a.blank1 != null && a.blank1 !== "" && a.blank2 != null && a.blank2 !== "";
    }
    if (q.type === "order") {
      const n = q.slots || (q.answers && q.answers.length) || 0;
      for (let i = 0; i < n; i++) {
        const v = a["s" + i];
        if (v == null || String(v).trim() === "") return false;
      }
      return true;
    }
    if (q.type === "vertical" || q.type === "fill-inline" || q.type === "word" || q.type === "calc") {
      return a.value != null && String(a.value).trim() !== "";
    }
    return false;
  }

  function gradeQuestion(q) {
    const a = state.answers[q.id];
    const canGrade = paper && paper.hasAnswers && !paper.practiceOnly;

    if (!isAnswered(q)) {
      return {
        correct: false,
        userDisplay: "（未作答）",
        correctDisplay: canGrade ? expectedDisplay(q) : "—",
        skipped: false,
      };
    }

    if (!canGrade) {
      return {
        correct: null,
        userDisplay: userDisplay(q, a),
        correctDisplay: "（練習模式，無標準答案）",
        practice: true,
      };
    }

    switch (q.type) {
      case "vertical": {
        const expected = q.answer != null ? String(q.answer) : String(computeVertical(q));
        const got = normalizeNumeric(a.value);
        return {
          correct: got === expected,
          userDisplay: got || "（未作答）",
          correctDisplay: expected,
        };
      }
      case "fill-inline":
      case "calc":
      case "word": {
        const got = normalizeNumeric(a.value);
        let ok = false;
        if (Array.isArray(q.acceptAnyOf)) {
          ok = q.acceptAnyOf.map(String).some((x) => normalizeNumeric(x) === got);
        } else {
          ok = got === normalizeNumeric(q.answer);
        }
        return {
          correct: ok,
          userDisplay: got
            ? q.unit
              ? got + q.unit
              : got
            : "（未作答）",
          correctDisplay: expectedDisplay(q),
        };
      }
      case "commutative": {
        const b1 = normalizeNumeric(a.blank1);
        const b2 = normalizeNumeric(a.blank2);
        const ok = b1 !== "" && b1 === b2;
        return {
          correct: ok,
          userDisplay: `${b1 || "?"} 與 ${b2 || "?"}`,
          correctDisplay: `兩邊相同的數（例如 ${q.preferred}）`,
        };
      }
      case "mc": {
        const ok = a.choice === q.correctIndex;
        return {
          correct: ok,
          userDisplay: q.options[a.choice] ?? "（未作答）",
          correctDisplay: q.options[q.correctIndex],
        };
      }
      case "order": {
        const n = q.slots || q.answers.length;
        const got = [];
        for (let i = 0; i < n; i++) got.push(normalizeNumeric(a["s" + i]));
        const expected = q.answers.map((x) => normalizeNumeric(x));
        let ok;
        if (q.acceptAnyOrder) {
          ok =
            got.length === expected.length &&
            [...got].sort().join(",") === [...expected].sort().join(",");
        } else {
          ok = got.join(",") === expected.join(",");
        }
        return {
          correct: ok,
          userDisplay: got.join("、") || "（未作答）",
          correctDisplay: expected.join("、"),
        };
      }
      default:
        return { correct: false, userDisplay: "?", correctDisplay: "?" };
    }
  }

  function computeVertical(q) {
    const op = q.op || "×";
    if (op === "×" || op === "*") return q.a * q.b;
    if (op === "−" || op === "-") return q.a - q.b;
    if (op === "+" || op === "＋") return q.a + q.b;
    if (op === "÷" || op === "/") return q.a / q.b;
    return q.a * q.b;
  }

  function expectedDisplay(q) {
    switch (q.type) {
      case "vertical":
        return q.answer != null ? String(q.answer) : String(computeVertical(q));
      case "fill-inline":
      case "calc":
      case "word":
        if (Array.isArray(q.acceptAnyOf)) {
          return q.acceptAnyOf.join("／") + (q.unit || "");
        }
        return String(q.answer ?? "") + (q.unit || "");
      case "commutative":
        return `兩邊相同（如 ${q.preferred}）`;
      case "mc":
        return q.options[q.correctIndex];
      case "order":
        return (q.answers || []).join("、");
      default:
        return "";
    }
  }

  function userDisplay(q, a) {
    if (q.type === "mc") return q.options[a.choice] ?? "（未作答）";
    if (q.type === "order") {
      const n = q.slots || (q.answers && q.answers.length) || 0;
      const got = [];
      for (let i = 0; i < n; i++) got.push(a["s" + i] || "?");
      return got.join("、");
    }
    if (q.type === "commutative") return `${a.blank1 || "?"} 與 ${a.blank2 || "?"}`;
    const v = a.value;
    if (v == null || String(v).trim() === "") return "（未作答）";
    return q.unit ? v + q.unit : String(v);
  }

  function computeScore() {
    let earned = 0;
    let total = 0;
    const canGrade = paper && paper.hasAnswers && !paper.practiceOnly;
    const results = QUESTIONS.map((q) => {
      total += q.weight;
      const g = gradeQuestion(q);
      if (g.correct === true) earned += q.weight;
      return { q, ...g };
    });
    const percent = total === 0 ? 0 : Math.round((earned / total) * 100);
    return { earned, total, percent, results, canGrade };
  }

  function showScreen(which) {
    screenStart.hidden = which !== "start";
    screenQuiz.hidden = which !== "quiz";
    screenResult.hidden = which !== "result";
    screenStart.classList.toggle("screen-active", which === "start");
    screenQuiz.classList.toggle("screen-active", which === "quiz");
    screenResult.classList.toggle("screen-active", which === "result");
    hideKeypad();
  }

  function renderPaperList() {
    if (!catalog) return;
    paperList.innerHTML = "";
    catalog.papers.forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const feature = p.id === "word-problems" ? " paper-card-feature" : "";
      btn.className = "paper-card" + feature + (state.paperId === p.id ? " selected" : "");
      btn.setAttribute("aria-pressed", String(state.paperId === p.id));
      btn.innerHTML = `
        <span class="paper-emoji" aria-hidden="true">${escapeHtml(p.emoji || "📄")}</span>
        <span class="paper-body">
          <span class="paper-title">${escapeHtml(p.title)}</span>
          <span class="paper-sub">${escapeHtml(p.subtitle || "")}</span>
          <span class="paper-tags">
            <span class="tag">${escapeHtml(p.topic || "")}</span>
            <span class="tag">${p.questionCount || "?"} 題</span>
            ${p.hasAnswers ? '<span class="tag tag-ok">可計分</span>' : '<span class="tag tag-practice">練習</span>'}
          </span>
        </span>`;
      btn.addEventListener("click", () => selectPaper(p.id));
      paperList.appendChild(btn);
    });
  }

  async function selectPaper(id) {
    state.paperId = id;
    renderPaperList();
    const meta = catalog.papers.find((p) => p.id === id);
    if (meta) {
      selectedPaperMeta.textContent = `${meta.emoji || ""} ${meta.title} · ${meta.topic || ""}`;
      selectedPaperMeta.classList.remove("hidden");
    }
    btnStart.disabled = false;
    updateResumeHint();

    try {
      const res = await fetch("data/" + meta.file);
      if (!res.ok) throw new Error("load failed");
      paper = await res.json();
      QUESTIONS = paper.questions || [];
    } catch (err) {
      selectedPaperMeta.textContent = "載入試卷失敗，請用本機伺服器開啟（見 README）。";
      paper = null;
      QUESTIONS = [];
      btnStart.disabled = true;
    }
  }

  function renderDots() {
    progressDots.innerHTML = "";
    QUESTIONS.forEach((q, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dot";
      btn.setAttribute("role", "listitem");
      btn.setAttribute("aria-label", `第 ${i + 1} 題`);
      if (i === state.index) btn.classList.add("current");
      if (isAnswered(q)) btn.classList.add("answered");
      btn.addEventListener("click", () => {
        state.index = i;
        save();
        renderQuestion();
      });
      progressDots.appendChild(btn);
    });
  }

  function ensureAnswer(qid) {
    if (!state.answers[qid]) state.answers[qid] = {};
    return state.answers[qid];
  }

  function renderQuestion() {
    const q = QUESTIONS[state.index];
    const n = QUESTIONS.length;
    sectionBadge.textContent = q.sectionLabel || "";
    progressText.textContent = `${state.index + 1} / ${n}`;
    renderDots();

    btnPrev.disabled = state.index === 0;
    const isLast = state.index === n - 1;
    btnNext.classList.toggle("hidden", isLast);
    btnSubmit.classList.toggle("hidden", !isLast);

    let html = "";
    switch (q.type) {
      case "vertical":
        html = renderVertical(q);
        break;
      case "fill-inline":
      case "calc":
        html = renderFillInline(q);
        break;
      case "commutative":
        html = renderCommutative(q);
        break;
      case "mc":
        html = renderMC(q);
        break;
      case "word":
        html = renderWord(q);
        break;
      case "order":
        html = renderOrder(q);
        break;
      default:
        html = `<div class="q-card"><p>未支援的題型：${escapeHtml(q.type)}</p></div>`;
    }
    questionArea.innerHTML = html;
    bindQuestionEvents(q);

    if (q.type !== "mc") {
      const slots = questionArea.querySelectorAll(".answer-slot");
      let focusTarget = null;
      slots.forEach((el) => {
        const key = el.dataset.slot;
        const ans = state.answers[q.id] || {};
        const val = key === "value" ? ans.value : ans[key];
        if (val != null && String(val) !== "") {
          el.textContent = String(val);
          el.classList.add("filled");
          el.classList.remove("empty-hint");
        } else {
          el.textContent = "";
          el.classList.add("empty-hint");
          el.classList.remove("filled");
          if (!focusTarget) focusTarget = el;
        }
      });
      if (focusTarget) activateSlot(focusTarget);
      else if (slots[0]) activateSlot(slots[0]);
    } else {
      hideKeypad();
    }
  }

  function contextBlock(q) {
    if (!q.context && !q.hint) return "";
    let out = "";
    if (q.context) {
      out += `<pre class="q-context">${escapeHtml(q.context)}</pre>`;
    }
    if (q.hint) {
      out += `<p class="q-hint">${escapeHtml(q.hint)}</p>`;
    }
    return out;
  }

  function renderVertical(q) {
    const op = q.op || "×";
    return `
      <div class="q-card">
        <div class="q-number">第 ${state.index + 1} 題</div>
        ${contextBlock(q)}
        <p class="q-prompt">計算：</p>
        <div class="vertical-mul" aria-label="${q.a} ${op} ${q.b}">
          <div class="operand">${q.a}</div>
          <div class="op-row">
            <span class="times" aria-hidden="true">${escapeHtml(op)}</span>
            <span class="operand">${q.b}</span>
          </div>
          <div class="line"></div>
          <button type="button" class="answer-slot empty-hint" data-slot="value"
            aria-label="答案輸入格"></button>
        </div>
      </div>`;
  }

  function renderFillInline(q) {
    if (q.blankPos === "middle" || q.blankPos === "start" || (q.promptHtml && q.promptHtml.includes("<slot>"))) {
      const raw = q.promptHtml || (q.blankPos === "middle" ? "3 × <slot> = 21" : "<slot>");
      const parts = raw.split("<slot>");
      const before = parts[0] || "";
      const after = parts[1] || "";
      return `
        <div class="q-card">
          <div class="q-number">第 ${state.index + 1} 題</div>
          ${contextBlock(q)}
          <p class="q-prompt">填上適當的數目：</p>
          <div class="inline-eq">
            ${before ? `<span class="num">${escapeHtml(before.trim())}</span>` : ""}
            <button type="button" class="answer-slot empty-hint" data-slot="value"
              aria-label="答案輸入格"></button>
            ${after ? `<span class="num">${escapeHtml(after.trim())}</span>` : ""}
          </div>
        </div>`;
    }
    const prompt = (q.prompt || "").replace(/\s*=\s*$/, "");
    return `
      <div class="q-card">
        <div class="q-number">第 ${state.index + 1} 題</div>
        ${contextBlock(q)}
        <p class="q-prompt">填上適當的數目：</p>
        <div class="inline-eq" aria-label="${escapeHtml(q.prompt || "")}">
          <span class="num">${escapeHtml(prompt)}</span>
          <span class="num">=</span>
          <button type="button" class="answer-slot empty-hint" data-slot="value"
            aria-label="答案輸入格"></button>
        </div>
      </div>`;
  }

  function renderCommutative(q) {
    return `
      <div class="q-card">
        <div class="q-number">第 ${state.index + 1} 題</div>
        <p class="q-prompt">填上適當的數目（兩邊相同）：</p>
        <div class="inline-eq">
          <span class="num">${q.left}</span>
          <span class="num">×</span>
          <button type="button" class="answer-slot empty-hint" data-slot="blank1"
            aria-label="第一個空白"></button>
          <span class="num">=</span>
          <button type="button" class="answer-slot empty-hint" data-slot="blank2"
            aria-label="第二個空白"></button>
          <span class="num">×</span>
          <span class="num">${q.left}</span>
        </div>
      </div>`;
  }

  function renderMC(q) {
    const ans = state.answers[q.id] || {};
    const letters = ["A", "B", "C", "D", "E", "F"];
    const opts = q.options
      .map((opt, i) => {
        const sel = ans.choice === i ? " selected" : "";
        return `
          <button type="button" class="mc-option btn${sel}" data-choice="${i}"
            aria-pressed="${ans.choice === i}" aria-label="選項 ${letters[i]}：${opt}">
            <span class="mc-letter" aria-hidden="true">${letters[i]}</span>
            <span>${escapeHtml(opt)}</span>
          </button>`;
      })
      .join("");
    return `
      <div class="q-card">
        <div class="q-number">第 ${state.index + 1} 題</div>
        ${contextBlock(q)}
        <p class="q-prompt">${escapeHtml(q.prompt)}</p>
        <div class="mc-options" role="group" aria-label="選項">${opts}</div>
      </div>`;
  }

  function renderWord(q) {
    const focus = paper && paper.id === "word-problems" ? " word-focus" : "";
    return `
      <div class="q-card${focus}">
        <div class="q-number">第 ${state.index + 1} 題</div>
        ${contextBlock(q)}
        <p class="word-problem">${escapeHtml(q.prompt)}</p>
        <div class="word-answer-row">
          <span style="font-weight:600">答案：</span>
          <button type="button" class="answer-slot empty-hint" data-slot="value"
            aria-label="答案輸入格"></button>
          ${q.unit ? `<span class="unit">${escapeHtml(q.unit)}</span>` : ""}
        </div>
      </div>`;
  }

  function renderOrder(q) {
    const n = q.slots || (q.answers && q.answers.length) || 2;
    const slots = Array.from({ length: n }, (_, i) => {
      return `<button type="button" class="answer-slot empty-hint" data-slot="s${i}"
            aria-label="第 ${i + 1} 個空白"></button>`;
    }).join('<span class="num order-sep">、</span>');
    return `
      <div class="q-card">
        <div class="q-number">第 ${state.index + 1} 題</div>
        ${contextBlock(q)}
        <p class="q-prompt">${escapeHtml(q.prompt)}</p>
        <div class="inline-eq order-slots">${slots}</div>
      </div>`;
  }

  function bindQuestionEvents(q) {
    if (q.type === "mc") {
      questionArea.querySelectorAll(".mc-option").forEach((btn) => {
        btn.addEventListener("click", () => {
          const choice = Number(btn.dataset.choice);
          const ans = ensureAnswer(q.id);
          ans.choice = choice;
          save();
          questionArea.querySelectorAll(".mc-option").forEach((b) => {
            const on = Number(b.dataset.choice) === choice;
            b.classList.toggle("selected", on);
            b.setAttribute("aria-pressed", String(on));
          });
          renderDots();
        });
      });
      return;
    }
    questionArea.querySelectorAll(".answer-slot").forEach((slot) => {
      slot.addEventListener("click", () => activateSlot(slot));
    });
  }

  function activateSlot(slotEl) {
    questionArea.querySelectorAll(".answer-slot").forEach((s) => s.classList.remove("active"));
    slotEl.classList.add("active");
    const q = QUESTIONS[state.index];
    state.activeSlot = { qid: q.id, slotKey: slotEl.dataset.slot };
    showKeypad();
  }

  function showKeypad() {
    keypad.classList.remove("hidden");
    document.body.classList.add("keypad-open");
  }

  function hideKeypad() {
    keypad.classList.add("hidden");
    document.body.classList.remove("keypad-open");
    state.activeSlot = null;
    questionArea.querySelectorAll(".answer-slot").forEach((s) => s.classList.remove("active"));
  }

  function getActiveSlotEl() {
    if (!state.activeSlot) return null;
    return questionArea.querySelector(`.answer-slot[data-slot="${state.activeSlot.slotKey}"]`);
  }

  function getSlotValue() {
    if (!state.activeSlot) return "";
    const ans = state.answers[state.activeSlot.qid] || {};
    const key = state.activeSlot.slotKey;
    if (key === "value") return ans.value != null ? String(ans.value) : "";
    return ans[key] != null ? String(ans[key]) : "";
  }

  function setSlotValue(val) {
    if (!state.activeSlot) return;
    const ans = ensureAnswer(state.activeSlot.qid);
    const key = state.activeSlot.slotKey;
    if (key === "value") ans.value = val;
    else ans[key] = val;

    const el = getActiveSlotEl();
    if (el) {
      if (val === "") {
        el.textContent = "";
        el.classList.add("empty-hint");
        el.classList.remove("filled");
      } else {
        el.textContent = val;
        el.classList.add("filled");
        el.classList.remove("empty-hint");
      }
    }
    save();
    renderDots();
  }

  function onKeypad(key) {
    if (!state.activeSlot) return;
    let val = getSlotValue();
    if (key === "clear") {
      val = "";
    } else if (key === "back") {
      val = val.slice(0, -1);
    } else {
      if (val.length >= 6) return;
      if (val === "0" && key !== "0") val = key;
      else if (val === "0" && key === "0") return;
      else val += key;
    }
    setSlotValue(val);
  }

  function showResults() {
    hideKeypad();
    const { earned, total, percent, results, canGrade } = computeScore();
    const emoji = $("#result-emoji");
    const title = $("#result-title");
    const nameEl = $("#result-name");
    const scoreDisplay = $("#score-display");
    const scoreDetail = $("#score-detail");
    const reviewList = $("#review-list");

    if (!canGrade) {
      emoji.textContent = "✏️";
      title.textContent = "練習完成！";
      scoreDisplay.textContent = "—";
      scoreDetail.textContent = "本卷為練習模式，未提供標準答案自動計分。";
    } else if (percent >= 90) {
      emoji.textContent = "🌟";
      title.textContent = "太棒了！";
      scoreDisplay.textContent = `${percent}%`;
      scoreDetail.textContent = `得分 ${earned} / ${total}${paper.scoreDetailHint ? "（" + paper.scoreDetailHint + "）" : ""}`;
    } else if (percent >= 60) {
      emoji.textContent = "👍";
      title.textContent = "做得好！";
      scoreDisplay.textContent = `${percent}%`;
      scoreDetail.textContent = `得分 ${earned} / ${total}${paper.scoreDetailHint ? "（" + paper.scoreDetailHint + "）" : ""}`;
    } else {
      emoji.textContent = "💪";
      title.textContent = "再接再厲！";
      scoreDisplay.textContent = `${percent}%`;
      scoreDetail.textContent = `得分 ${earned} / ${total}${paper.scoreDetailHint ? "（" + paper.scoreDetailHint + "）" : ""}`;
    }

    const paperTitle = paper ? `${paper.year || ""} ${paper.title}`.trim() : "";
    nameEl.textContent = state.name ? `${state.name} · ${paperTitle}` : paperTitle;

    reviewList.innerHTML = results
      .map((r, i) => {
        if (r.practice) {
          return `<div class="review-item" role="listitem">
            <span class="review-icon" aria-hidden="true">✏️</span>
            <div class="review-body">
              <strong>第 ${i + 1} 題</strong>
              <div class="ans-line">你的答案：<span class="yours">${escapeHtml(r.userDisplay)}</span></div>
            </div>
          </div>`;
        }
        const cls = r.correct ? "correct" : "wrong";
        const icon = r.correct ? "✅" : "❌";
        let body;
        if (r.correct) {
          body = `<strong>第 ${i + 1} 題 · 正確</strong>
            <div class="ans-line">答案：<em>${escapeHtml(r.correctDisplay)}</em></div>`;
        } else {
          body = `<strong>第 ${i + 1} 題 · 需改正</strong>
            <div class="ans-line">你的答案：<span class="yours">${escapeHtml(r.userDisplay)}</span></div>
            <div class="ans-line">正確答案：<em>${escapeHtml(r.correctDisplay)}</em></div>`;
        }
        return `<div class="review-item ${cls}" role="listitem">
          <span class="review-icon" aria-hidden="true">${icon}</span>
          <div class="review-body">${body}</div>
        </div>`;
      })
      .join("");

    showScreen("result");
    clearStorage(state.paperId);
    state.started = false;
  }

  function startQuiz(resume) {
    if (!paper || !QUESTIONS.length) return;
    if (!resume) {
      state.name = (nameInput.value || "").trim();
      state.index = 0;
      state.answers = {};
    } else {
      state.name = state.name || (nameInput.value || "").trim();
    }
    state.started = true;
    save();
    showScreen("quiz");
    renderQuestion();
  }

  function goPrev() {
    if (state.index > 0) {
      state.index--;
      save();
      renderQuestion();
    }
  }

  function goNext() {
    if (state.index < QUESTIONS.length - 1) {
      state.index++;
      save();
      renderQuestion();
    }
  }

  function confirmSubmit() {
    const unanswered = QUESTIONS.filter((q) => !isAnswered(q)).length;
    if (unanswered > 0) {
      const ok = window.confirm(`還有 ${unanswered} 題未作答，確定要交卷嗎？`);
      if (!ok) return;
    }
    showResults();
  }

  function retry() {
    state.index = 0;
    state.answers = {};
    state.started = false;
    clearStorage(state.paperId);
    nameInput.value = state.name || "";
    showScreen("start");
    updateResumeHint();
  }

  function backToPicker() {
    state.started = false;
    showScreen("start");
    updateResumeHint();
  }

  function updateResumeHint() {
    if (!state.paperId) {
      resumeHint.classList.add("hidden");
      return;
    }
    const saved = load(state.paperId);
    if (saved && saved.started && saved.answers && Object.keys(saved.answers).length > 0) {
      resumeHint.classList.remove("hidden");
      resumeHint.textContent = "發現此卷未完成的答題紀錄，按「開始答題」可繼續。";
      state.name = saved.name || "";
      state.index = typeof saved.index === "number" ? saved.index : 0;
      state.answers = saved.answers || {};
      state.started = true;
      if (saved.name) nameInput.value = saved.name;
    } else {
      resumeHint.classList.add("hidden");
      state.started = false;
      state.answers = {};
      state.index = 0;
    }
  }

  const btnWordProblems = $("#btn-word-problems");
  if (btnWordProblems) {
    btnWordProblems.addEventListener("click", async () => {
      if (!catalog) return;
      await selectPaper("word-problems");
      if (!paper || paper.id !== "word-problems" || !QUESTIONS.length) return;
      btnStart.click();
    });
  }

  btnStart.addEventListener("click", () => {
    if (!state.paperId || !paper) return;
    const saved = load(state.paperId);
    const canResume = saved && saved.started && Object.keys(saved.answers || {}).length > 0;
    if (canResume) {
      const newName = (nameInput.value || "").trim();
      if (newName && saved.name && newName !== saved.name) {
        startQuiz(false);
      } else {
        state.name = newName || saved.name || "";
        state.index = typeof saved.index === "number" ? saved.index : 0;
        state.answers = saved.answers || {};
        startQuiz(true);
      }
    } else {
      startQuiz(false);
    }
  });

  btnPrev.addEventListener("click", goPrev);
  btnNext.addEventListener("click", goNext);
  btnSubmit.addEventListener("click", confirmSubmit);
  btnRetry.addEventListener("click", retry);
  if (btnBackPicker) btnBackPicker.addEventListener("click", backToPicker);
  if (btnHome) btnHome.addEventListener("click", backToPicker);

  keypad.addEventListener("click", (e) => {
    const btn = e.target.closest(".key");
    if (!btn) return;
    onKeypad(btn.dataset.key);
  });

  document.addEventListener("click", (e) => {
    if (keypad.classList.contains("hidden")) return;
    if (e.target.closest("#keypad")) return;
    if (e.target.closest(".answer-slot")) return;
    if (e.target.closest(".quiz-footer")) return;
  });

  document.addEventListener("touchend", () => {}, { passive: true });

  async function init() {
    btnStart.disabled = true;
    try {
      const res = await fetch("data/index.json");
      if (!res.ok) throw new Error("index");
      catalog = await res.json();
      document.title = catalog.appTitle || "小二數學科練習";
      const h1 = $("#app-title");
      if (h1) h1.textContent = catalog.appTitle || "小二數學科練習";
      renderPaperList();
      if (catalog.papers.length) {
        await selectPaper(catalog.papers[0].id);
      }
      showScreen("start");
    } catch (err) {
      paperList.innerHTML =
        '<p class="hint">無法載入題庫。請在本機用 <code>python3 -m http.server 8080</code> 開啟（見 README），不要直接雙擊開啟（file:// 無法讀 JSON）。</p>';
      showScreen("start");
    }
  }

  init();
})();
