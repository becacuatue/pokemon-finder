// ============================================================
// VOCAB PRACTICE MODULE (module riêng biệt, không phụ thuộc Firebase)
// - Đọc dữ liệu từ vocab-data.json
// - Phát âm bằng Web Speech API (window.speechSynthesis) — chạy hoàn
//   toàn phía client, không cần backend / API key.
// - Chấm điểm dựa trên ĐỘ DÀI của từ + hệ số cấp độ.
// - Lặp lại từ theo kiểu "hộp Leitner" đơn giản: từ vừa trả lời sẽ
//   được chèn lại vào hàng đợi sau một khoảng cách ngẫu nhiên (không
//   lặp ngay lập tức, và tự "tốt nghiệp" sau khi trả lời đúng đủ số
//   lần hoặc xuất hiện quá nhiều lần trong phiên).
// ============================================================

const VOCAB_DATA_URL = 'vocab-data.json';
const LS_POINTS_KEY = 'dtedu_vocab_total_points';
const LS_MASTERED_KEY = 'dtedu_vocab_mastered_words';
const MAX_APPEARANCES_PER_SESSION = 3; // trần số lần 1 từ xuất hiện trong 1 phiên
const MASTER_BOX = 2;                  // đúng liên tiếp 2 lần trong phiên -> coi như thuộc
const HISTORY_LIMIT = 18;              // số chấm hiển thị trong biểu đồ lịch sử gần đây

let allLevels = [];       // toàn bộ dữ liệu levels từ JSON
let allWordsFlat = [];    // toàn bộ từ (mọi cấp độ) — dùng làm nguồn nghĩa nhiễu dự phòng

let vocabState = null;    // trạng thái phiên luyện tập hiện tại (khởi tạo khi mở 1 cấp độ)

// ---------------- Tiện ích ----------------
function escapeHtml(str = '') {
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function getEl(id) { return document.getElementById(id); }

// ---------------- Lưu trữ điểm & từ đã thuộc (localStorage) ----------------
function getTotalPoints() {
    return parseInt(localStorage.getItem(LS_POINTS_KEY) || '0', 10) || 0;
}
function addTotalPoints(amount) {
    const total = getTotalPoints() + amount;
    try { localStorage.setItem(LS_POINTS_KEY, String(total)); } catch (e) { /* bỏ qua nếu bị chặn */ }
    return total;
}
function getMasteredWordIds() {
    try {
        const raw = localStorage.getItem(LS_MASTERED_KEY);
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (e) { return new Set(); }
}
function addMasteredWordId(wordId) {
    const set = getMasteredWordIds();
    set.add(wordId);
    try { localStorage.setItem(LS_MASTERED_KEY, JSON.stringify([...set])); } catch (e) { /* bỏ qua */ }
    return set.size;
}
function refreshTeaserStats() {
    const ptsEl = getEl('vocab-total-points');
    const wordsEl = getEl('vocab-total-words');
    if (ptsEl) ptsEl.textContent = getTotalPoints();
    if (wordsEl) wordsEl.textContent = getMasteredWordIds().size;
}

// ---------------- Web Speech API ----------------
function speakWord(text, lang) {
    if (!('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(text);
        msg.lang = lang || 'en-US';
        msg.rate = 0.92;
        msg.pitch = 1;

        const btn = getEl('vocab-speak-btn');
        if (btn) {
            btn.classList.add('speaking');
            msg.onend = () => btn.classList.remove('speaking');
            msg.onerror = () => btn.classList.remove('speaking');
        }
        window.speechSynthesis.speak(msg);
    } catch (e) {
        console.error('Lỗi phát âm (Web Speech API):', e);
    }
}
function currentAccent() {
    const checked = document.querySelector('input[name="vocab-accent"]:checked');
    return checked ? checked.value : 'en-US';
}

// ---------------- Tải dữ liệu từ vựng ----------------
async function loadVocabData() {
    const picker = getEl('vocab-level-picker');
    try {
        const res = await fetch(VOCAB_DATA_URL);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        allLevels = data.levels || [];
        allWordsFlat = allLevels.flatMap(lv => lv.words.map(w => ({ ...w, levelId: lv.id })));
        renderLevelPicker();
        refreshTeaserStats();
    } catch (error) {
        console.error('Lỗi khi tải vocab-data.json:', error);
        if (picker) picker.innerHTML = '<p style="font-size:13px;color:var(--text-muted);">Không thể tải dữ liệu từ vựng. Vui lòng thử lại sau.</p>';
    }
}

function renderLevelPicker() {
    const picker = getEl('vocab-level-picker');
    if (!picker) return;
    const mastered = getMasteredWordIds();
    picker.innerHTML = '';
    allLevels.forEach(lv => {
        const doneInLevel = lv.words.filter(w => mastered.has(w.id)).length;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'vocab-level-chip';
        chip.style.setProperty('--chip-color', lv.color || '#7EA88A');
        chip.innerHTML = `
            <span class="chip-label">${escapeHtml(lv.label)}</span>
            <span class="chip-desc">${escapeHtml(lv.description || '')}</span>
            <span class="chip-progress">${doneInLevel}/${lv.words.length} từ đã thuộc</span>
        `;
        chip.addEventListener('click', () => openVocabPractice(lv.id));
        picker.appendChild(chip);
    });
}

// ---------------- Mở / thoát khu vực luyện tập ----------------
function hideAllMainSections() {
    ['class-selection-section', 'dashboard-section', 'test-section', 'result-section', 'learning-stats-section']
        .forEach(id => getEl(id)?.classList.add('hidden'));
}

function openVocabPractice(levelId) {
    const levelData = allLevels.find(lv => lv.id === levelId);
    if (!levelData) return;

    hideAllMainSections();
    getEl('vocab-practice-section')?.classList.remove('hidden');
    window.scrollTo(0, 0);

    buildSession(levelData);
}

window.exitVocabPractice = function () {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    getEl('vocab-practice-section')?.classList.add('hidden');
    getEl('class-selection-section')?.classList.remove('hidden');
    renderLevelPicker();
    refreshTeaserStats();
};

window.restartVocabLevel = function () {
    if (!vocabState) return;
    buildSession(vocabState.levelData);
};

// ---------------- Khởi tạo 1 phiên luyện tập ----------------
function buildSession(levelData) {
    vocabState = {
        levelId: levelData.id,
        levelData,
        queue: shuffle(levelData.words),
        currentWord: null,
        sessionPoints: 0,
        sessionCorrect: 0,
        sessionTotal: 0,
        streak: 0,
        bestStreak: 0,
        history: [],       // mảng boolean: true = đúng, false = sai
        wordBox: {},        // wordId -> số lần đúng liên tiếp trong phiên (0..MASTER_BOX)
        appearanceCount: {},// wordId -> số lần đã xuất hiện trong phiên
        answered: false,
    };

    getEl('vocab-current-level-badge').textContent = levelData.label;
    getEl('vocab-card')?.classList.remove('hidden');
    getEl('vocab-complete')?.remove();

    updateLiveStats();
    renderPerformance();
    nextWord();
}

// ---------------- Điều hướng câu hỏi ----------------
function nextWord() {
    if (!vocabState.queue.length) {
        showSessionComplete();
        return;
    }
    const word = vocabState.queue.shift();
    vocabState.currentWord = word;
    vocabState.answered = false;
    vocabState.appearanceCount[word.id] = (vocabState.appearanceCount[word.id] || 0) + 1;

    renderWord(word);
}

function renderWord(word) {
    getEl('vocab-word').textContent = word.word;
    getEl('vocab-phonetic').innerHTML = `${escapeHtml(word.phonetic || '')} <span class="vocab-pos">${escapeHtml(word.partOfSpeech || '')}</span>`;

    const feedback = getEl('vocab-feedback');
    feedback.classList.add('hidden');
    feedback.classList.remove('is-correct', 'is-wrong');
    getEl('vocab-next-btn').classList.add('hidden');

    renderOptions(word);

    // Tự động đọc từ ngay khi hiện lên (Web Speech API)
    speakWord(word.word, currentAccent());
}

function renderOptions(word) {
    const container = getEl('vocab-options');
    container.innerHTML = '';

    // Ưu tiên lấy nghĩa nhiễu từ cùng cấp độ; nếu không đủ 3 nghĩa khác nhau thì lấy toàn bộ ngân hàng từ
    let pool = vocabState.levelData.words.filter(w => w.id !== word.id && w.meaning !== word.meaning);
    if (pool.length < 3) {
        pool = allWordsFlat.filter(w => w.id !== word.id && w.meaning !== word.meaning);
    }
    const shuffledPool = shuffle(pool);
    const distractors = [];
    for (const w of shuffledPool) {
        if (distractors.length >= 3) break;
        if (!distractors.includes(w.meaning)) distractors.push(w.meaning);
    }
    const options = shuffle([word.meaning, ...distractors]);
    const letters = ['A', 'B', 'C', 'D'];

    options.forEach((meaning, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vocab-option-btn';
        btn.innerHTML = `<span class="opt-letter">${letters[idx]}</span><span>${escapeHtml(meaning)}</span>`;
        btn.addEventListener('click', () => selectAnswer(meaning, btn));
        container.appendChild(btn);
    });
}

// ---------------- Xử lý chọn đáp án ----------------
function selectAnswer(chosenMeaning, btnEl) {
    if (vocabState.answered) return;
    vocabState.answered = true;

    const word = vocabState.currentWord;
    const isCorrect = chosenMeaning === word.meaning;

    vocabState.sessionTotal++;

    let earned = 0;
    if (isCorrect) {
        vocabState.sessionCorrect++;
        vocabState.streak++;
        vocabState.bestStreak = Math.max(vocabState.bestStreak, vocabState.streak);

        // Chấm điểm dựa trên ĐỘ DÀI của từ (từ càng dài, điểm càng cao) + hệ số cấp độ
        const basePoints = word.word.length * 10;
        const leveled = Math.round(basePoints * (vocabState.levelData.pointMultiplier || 1));
        const streakBonus = Math.min(vocabState.streak, 5) * 2; // thưởng thêm khi giữ chuỗi đúng
        earned = leveled + streakBonus;

        vocabState.sessionPoints += earned;
        addTotalPoints(earned);
    } else {
        vocabState.streak = 0;
    }

    vocabState.history.push(isCorrect);
    if (vocabState.history.length > HISTORY_LIMIT) vocabState.history.shift();

    // Cập nhật "hộp" ghi nhớ + đưa từ trở lại hàng đợi (nếu chưa thuộc)
    requeueWord(word, isCorrect);

    markOptionButtons(btnEl, word.meaning, isCorrect);
    showFeedback(isCorrect, earned, word);
    updateLiveStats();
    renderPerformance();

    getEl('vocab-next-btn').classList.remove('hidden');
}

function markOptionButtons(clickedBtn, correctMeaning, isCorrect) {
    const buttons = getEl('vocab-options').querySelectorAll('.vocab-option-btn');
    buttons.forEach(btn => {
        btn.disabled = true;
        const meaningText = btn.querySelector('span:last-child').textContent;
        if (meaningText === correctMeaning) {
            btn.classList.add('correct');
        } else if (btn === clickedBtn && !isCorrect) {
            btn.classList.add('wrong');
        } else {
            btn.classList.add('dim');
        }
    });
}

function showFeedback(isCorrect, earned, word) {
    const feedback = getEl('vocab-feedback');
    const textEl = getEl('vocab-feedback-text');
    const exampleEl = getEl('vocab-example');

    feedback.classList.remove('hidden');
    feedback.classList.toggle('is-correct', isCorrect);
    feedback.classList.toggle('is-wrong', !isCorrect);

    textEl.innerHTML = isCorrect
        ? `✅ Chính xác! "${escapeHtml(word.word)}" = ${escapeHtml(word.meaning)} <span class="vocab-points-earned">+${earned} điểm</span>`
        : `❌ Chưa đúng. "${escapeHtml(word.word)}" nghĩa là <strong>${escapeHtml(word.meaning)}</strong>`;

    exampleEl.textContent = word.example
        ? `💬 ${word.example}${word.exampleTranslation ? ' — ' + word.exampleTranslation : ''}`
        : '';
}

// ---------------- Lặp lại theo kiểu "hộp Leitner" nhẹ, ƯU TIÊN PHỦ RỘNG ----------------
// Nguyên tắc: KHÔNG cho một từ quay lại lặp cho tới khi mọi từ CHƯA từng xuất hiện
// trong phiên đã được học qua ít nhất 1 lần. Nhờ vậy người học luôn được "lướt" hết
// toàn bộ danh sách trước, sau đó mới đến các lượt ôn lại — tránh tình trạng 1-2 từ
// khó bị lặp dồn dập khiến các từ khác chưa kịp xuất hiện.
function requeueWord(word, wasCorrect) {
    const box = vocabState.wordBox[word.id] || 0;
    const newBox = wasCorrect ? Math.min(box + 1, MASTER_BOX) : 0;
    vocabState.wordBox[word.id] = newBox;

    const appearances = vocabState.appearanceCount[word.id] || 1;
    const mastered = newBox >= MASTER_BOX;

    if (mastered) {
        addMasteredWordId(word.id);
    }

    // Từ đã thuộc hoặc đã xuất hiện quá nhiều lần trong phiên -> không lặp lại nữa
    if (mastered || appearances >= MAX_APPEARANCES_PER_SESSION) return;

    // Đếm số từ CHƯA từng xuất hiện đang còn nằm trong hàng đợi — luôn chèn từ này
    // ra SAU tất cả các từ đó, để đảm bảo phủ rộng trước khi lặp lại.
    const unseenCount = vocabState.queue.filter(w => !vocabState.appearanceCount[w.id]).length;
    // Sai thì ôn lại sớm hơn (ngay sau lượt từ mới), đúng thì thong thả hơn một chút —
    // nhưng cả hai đều tối thiểu cách 1-2 câu để không lặp lại ngay lập tức.
    const extraGap = wasCorrect ? randInt(2, 5) : randInt(1, 3);
    const insertAt = Math.min(vocabState.queue.length, unseenCount + extraGap);
    vocabState.queue.splice(insertAt, 0, word);
}

// ---------------- Nút "Từ tiếp theo" ----------------
document.addEventListener('DOMContentLoaded', () => {
    getEl('vocab-next-btn')?.addEventListener('click', nextWord);
    getEl('vocab-speak-btn')?.addEventListener('click', () => {
        if (vocabState?.currentWord) speakWord(vocabState.currentWord.word, currentAccent());
    });
    document.querySelectorAll('input[name="vocab-accent"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (vocabState?.currentWord) speakWord(vocabState.currentWord.word, currentAccent());
        });
    });

    loadVocabData();
});

// ---------------- Màn hoàn thành cấp độ ----------------
function showSessionComplete() {
    getEl('vocab-card')?.classList.add('hidden');
    const accuracy = vocabState.sessionTotal > 0
        ? Math.round((vocabState.sessionCorrect / vocabState.sessionTotal) * 100)
        : 0;

    const wrap = document.createElement('div');
    wrap.id = 'vocab-complete';
    wrap.className = 'vocab-complete';
    wrap.innerHTML = `
        <div class="vocab-complete-icon">🎉</div>
        <h3>Hoàn thành cấp độ ${escapeHtml(vocabState.levelData.label)}!</h3>
        <p>Bạn đã luyện tập toàn bộ từ vựng cấp độ này với độ chính xác ${accuracy}% và ghi được ${vocabState.sessionPoints} điểm.</p>
        <div class="vocab-complete-actions">
            <button type="button" class="btn btn-primary" id="vocab-restart-btn">Luyện lại cấp độ này</button>
            <button type="button" class="btn btn-outline" id="vocab-exit-btn">Chọn cấp độ khác</button>
        </div>
    `;
    getEl('vocab-card').insertAdjacentElement('afterend', wrap);
    getEl('vocab-restart-btn').addEventListener('click', () => window.restartVocabLevel());
    getEl('vocab-exit-btn').addEventListener('click', () => window.exitVocabPractice());
}

// ---------------- Cập nhật số liệu trực tiếp ----------------
function updateLiveStats() {
    getEl('vocab-session-points').textContent = vocabState.sessionPoints;
    getEl('vocab-streak').textContent = `${vocabState.streak} 🔥`;
    const accuracy = vocabState.sessionTotal > 0
        ? Math.round((vocabState.sessionCorrect / vocabState.sessionTotal) * 100)
        : 0;
    getEl('vocab-accuracy').textContent = `${accuracy}%`;
}

// ---------------- Biểu đồ hiệu suất (vòng tròn + cột + lịch sử) ----------------
function renderPerformance() {
    const total = vocabState.sessionTotal;
    const correct = vocabState.sessionCorrect;
    const wrong = total - correct;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    const ring = getEl('vocab-score-ring');
    if (ring) ring.style.setProperty('--pct', accuracy);
    getEl('vocab-ring-text').textContent = `${accuracy}%`;

    const maxCount = Math.max(correct, wrong, 1);
    const correctFill = getEl('vocab-bar-correct-fill');
    const wrongFill = getEl('vocab-bar-wrong-fill');
    if (correctFill) correctFill.style.width = `${(correct / maxCount) * 100}%`;
    if (wrongFill) wrongFill.style.width = `${(wrong / maxCount) * 100}%`;
    getEl('vocab-bar-correct-value').textContent = correct;
    getEl('vocab-bar-wrong-value').textContent = wrong;

    const dotsContainer = getEl('vocab-history-dots');
    if (dotsContainer) {
        dotsContainer.innerHTML = vocabState.history
            .map(isCorrect => `<span class="dot ${isCorrect ? 'correct' : 'wrong'}"></span>`)
            .join('');
    }
}
