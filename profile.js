import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCCfo_YmY770dFXA13Z7RS-xk1Satm-FEY",
    authDomain: "dtedu-1ca9f.firebaseapp.com",
    projectId: "dtedu-1ca9f",
    storageBucket: "dtedu-1ca9f.firebasestorage.app",
    messagingSenderId: "809872251862",
    appId: "1:809872251862:web:6a88b5938e5bcdb6f22277"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* Công thức điểm tổng hợp GIỐNG HỆT bên admin.js — nếu chỉnh công thức bên đó
   thì nhớ chỉnh lại ở đây cho khớp (2 file độc lập, không dùng chung module). */
const SCORE_WEIGHTS = { test: 0.5, teacherEval: 0.3 };
const BONUS_BAR_MAX = 30;
const PARTICIPATION_BAR_MAX = 30;

// Các trường thông tin cá nhân hiển thị (khớp STUDENT_FIELDS bên admin.js,
// trừ linkedAuthUid vì đó là field kỹ thuật, không cần cho học viên xem)
const STUDENT_INFO_FIELDS = [
    { key: 'dob', label: 'Ngày sinh', type: 'date' },
    { key: 'gender', label: 'Giới tính' },
    { key: 'phone', label: 'Số điện thoại' },
    { key: 'parentPhone', label: 'SĐT phụ huynh' },
    { key: 'address', label: 'Địa chỉ' },
    { key: 'email', label: 'Email' },
    { key: 'notes', label: 'Ghi chú từ giáo viên' },
];

// ---------- TIỆN ÍCH (giống admin.js để đồng bộ cách hiển thị) ----------
const $ = (sel) => document.querySelector(sel);

function escapeHtml(str = '') {
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function getInitials(text) {
    if (!text) return '?';
    const parts = text.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    return parts[parts.length - 1].charAt(0).toUpperCase();
}

function formatDateVN(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('vi-VN');
}

function round1(n) { return Math.round((n || 0) * 10) / 10; }
function clampPct(value, max) { if (!max) return 0; return Math.max(0, Math.min(100, ((value || 0) / max) * 100)); }

// [THÊM MỚI] Nhóm 1 danh sách theo NGÀY (dùng cho lịch sử làm bài kiểm tra) —
// sắp xếp ngày gần nhất lên đầu, ví dụ: 23/08, 22/08, 21/08... (giống cách nhóm
// bên classroom.js để đồng nhất trải nghiệm giữa 2 trang).
function groupByDay(items, dateGetter) {
    const buckets = new Map();
    items.forEach((item) => {
        const d = dateGetter(item);
        let key, label;
        if (d && !isNaN(d)) {
            key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        } else {
            key = 'unknown';
            label = 'Chưa rõ ngày';
        }
        if (!buckets.has(key)) buckets.set(key, { key, label, items: [] });
        buckets.get(key).items.push(item);
    });
    return [...buckets.values()].sort((a, b) => {
        if (a.key === 'unknown') return 1;
        if (b.key === 'unknown') return -1;
        return b.key.localeCompare(a.key);
    });
}

function computeCompositeScore(scores = {}) {
    const test = scores?.testScoreAvg || 0;
    const teacher = scores?.teacherEvalAvg || 0;
    const bonus = scores?.bonusPoints || 0;
    const participation = scores?.participationPoints || 0;
    return Math.round(test * SCORE_WEIGHTS.test + teacher * 10 * SCORE_WEIGHTS.teacherEval + bonus + participation);
}

// ---------- ĐIỀU HƯỚNG GIỮA CÁC TRẠNG THÁI ----------
function showView(viewId) {
    ['profile-guest-section', 'profile-missing-section', 'profile-main-section'].forEach((id) => {
        document.getElementById(id).classList.toggle('hidden', id !== viewId);
    });
}

function renderNavUser(user) {
    const chip = $('#nav-user-chip');
    const avatar = $('#nav-avatar-sm');
    const nameEl = $('#nav-user-name');
    const logoutBtn = $('#btn-profile-logout');
    if (user) {
        const label = user.displayName || user.email || 'Học viên';
        chip.classList.remove('hidden');
        avatar.textContent = getInitials(label);
        nameEl.textContent = label;
        logoutBtn.classList.remove('hidden');
    } else {
        chip.classList.add('hidden');
        logoutBtn.classList.add('hidden');
    }
}

// ---------- TẢI & HIỂN THỊ HỒ SƠ ----------
onAuthStateChanged(auth, async (user) => {
    renderNavUser(user);
    if (!user) {
        showView('profile-guest-section');
        return;
    }
    try {
        // Hồ sơ học viên được lưu với ID document = UID tài khoản (xem classroom "students/{uid}")
        const snap = await getDoc(doc(db, 'students', user.uid));
        if (!snap.exists()) {
            showView('profile-missing-section');
            return;
        }
        const student = { id: snap.id, ...snap.data() };
        if (!student.scores) student.scores = { testScoreAvg: 0, teacherEvalAvg: 0, bonusPoints: 0, participationPoints: 0 };
        renderProfile(student);
        showView('profile-main-section');
    } catch (err) {
        console.error('Lỗi khi tải hồ sơ học viên:', err);
        showView('profile-missing-section');
    }
});

function renderProfile(student) {
    const displayName = student.fullName || 'Chưa cập nhật tên';
    $('#profile-name-inline').textContent = getInitials(displayName) === '?' ? 'bạn' : displayName.trim().split(/\s+/).pop();
    $('#profile-student-name').textContent = displayName;
    $('#profile-student-code').textContent = student.studentCode || '------';
    $('#profile-student-class').textContent = student.className || 'Chưa phân lớp';

    const img = $('#profile-avatar-img');
    const fallback = $('#profile-avatar-fallback');
    if (student.photoUrl) {
        img.src = student.photoUrl;
        img.classList.remove('hidden');
        fallback.classList.add('hidden');
    } else {
        img.classList.add('hidden');
        fallback.classList.remove('hidden');
        fallback.textContent = getInitials(displayName);
    }

    renderInfoList(student);
    renderScoreBars(student.scores);
    refreshRank(student);
    loadSessions(student.id);
    loadQuizHistory(student.id); // [THÊM MỚI] lịch sử làm bài kiểm tra chi tiết (port từ classroom.js)
}

function renderInfoList(student) {
    const list = $('#profile-info-list');
    list.innerHTML = STUDENT_INFO_FIELDS.map((f) => {
        const raw = student[f.key];
        let value;
        if (!raw) value = '<span style="color:var(--text-faint)">Chưa cập nhật</span>';
        else if (f.type === 'date') value = escapeHtml(formatDateVN(raw));
        else value = escapeHtml(String(raw));
        return `<div><dt>${f.label}</dt><dd>${value}</dd></div>`;
    }).join('');
}

function renderScoreBars(scores = {}) {
    const container = $('#profile-score-bars');
    const metrics = [
        { label: 'Điểm kiểm tra trung bình', display: `${round1(scores.testScoreAvg)}/100`, barPct: clampPct(scores.testScoreAvg, 100), cls: '' },
        { label: 'Điểm GV đánh giá TB / buổi', display: `${round1(scores.teacherEvalAvg)}/10`, barPct: clampPct((scores.teacherEvalAvg || 0) * 10, 100), cls: 'bar-blue' },
        { label: 'Điểm cộng tích lũy', display: `${scores.bonusPoints || 0} điểm`, barPct: clampPct(scores.bonusPoints, BONUS_BAR_MAX), cls: 'bar-orange' },
        { label: 'Điểm tích cực phát biểu', display: `${scores.participationPoints || 0} điểm`, barPct: clampPct(scores.participationPoints, PARTICIPATION_BAR_MAX), cls: 'bar-orange' },
    ];
    container.innerHTML = metrics.map((m) => `
        <div class="score-bar-item ${m.cls}">
            <div class="score-bar-label"><span>${m.label}</span><strong>${m.display}</strong></div>
            <div class="score-bar-track"><div class="score-bar-fill" style="width:${m.barPct}%"></div></div>
        </div>
    `).join('');
    $('#profile-composite-score').textContent = computeCompositeScore(scores);
}

async function refreshRank(student) {
    const badge = $('#profile-rank-badge');
    if (!student.classId) {
        badge.textContent = '🎯 Chưa xếp lớp';
        return;
    }
    badge.textContent = 'Đang tính hạng...';
    try {
        const snap = await getDocs(query(collection(db, 'students'), where('classId', '==', student.classId)));
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, scores: d.data().scores }));
        list.sort((a, b) => computeCompositeScore(b.scores) - computeCompositeScore(a.scores));
        const idx = list.findIndex((x) => x.id === student.id);
        const rank = idx + 1, total = list.length;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🎯';
        badge.textContent = `${medal} Hạng ${rank}/${total} trong lớp`;
    } catch (err) {
        console.error(err);
        badge.textContent = 'Không xác định được hạng';
    }
}

async function loadSessions(studentId) {
    const list = $('#profile-sessions-list');
    list.innerHTML = '<p class="empty-state">Đang tải nhận xét từ giáo viên...</p>';
    try {
        const snap = await getDocs(query(collection(db, 'students', studentId, 'sessions'), orderBy('date', 'desc')));
        const sessions = [];
        snap.forEach((d) => sessions.push({ id: d.id, ...d.data() }));
        renderSessions(sessions);
    } catch (err) {
        console.error(err);
        list.innerHTML = '<p class="empty-state">Chưa thể tải nhận xét buổi học.</p>';
    }
}

function renderSessions(sessions) {
    const list = $('#profile-sessions-list');
    if (sessions.length === 0) {
        list.innerHTML = '<p class="empty-state">Chưa có buổi học nào được giáo viên ghi nhận.</p>';
        return;
    }
    // [THÊM MỚI] Nhóm theo ngày (ngày 23, 22, 21...) — đồng nhất với cách nhóm
    // bên trang lớp học (classroom.js).
    const groups = groupByDay(sessions, (s) => (s.date ? new Date(s.date) : null));
    list.innerHTML = groups.map((group) => `
        <div class="day-group">
            <h4 class="day-group-header">📅 Ngày ${escapeHtml(group.label)}</h4>
            ${group.items.map((s) => renderSessionItemHtml(s)).join('')}
        </div>
    `).join('');
}

function renderSessionItemHtml(s) {
    const d = s.date ? new Date(s.date) : null;
    const validDate = d && !isNaN(d);
    const day = validDate ? d.getDate() : '--';
    const month = validDate ? `Th${d.getMonth() + 1}` : '';
    return `
    <div class="session-item">
        <div class="session-date-badge"><span class="day">${day}</span><span class="month">${month}</span></div>
        <div class="session-body">
            <h4>${escapeHtml(s.lessonTopic || 'Buổi học')}</h4>
            <div class="session-chips">
                <span class="session-chip chip-teacher">GV đánh giá: ${s.teacherScore ?? 0}/10</span>
                ${s.bonusPoints ? `<span class="session-chip chip-bonus">+${s.bonusPoints} điểm cộng</span>` : ''}
                ${s.participationPoints ? `<span class="session-chip chip-participation">+${s.participationPoints} phát biểu</span>` : ''}
            </div>
            ${s.comment ? `<p class="session-comment">💬 ${escapeHtml(s.comment)}</p>` : ''}
        </div>
    </div>`;
}

// ============================================================
// [THÊM MỚI] LỊCH SỬ LÀM BÀI KIỂM TRA CHI TIẾT (port từ classroom.js)
// Trước đây trang Hồ sơ chỉ hiện 1 con số "điểm kiểm tra trung bình" — giờ
// hiện luôn danh sách TỪNG LƯỢT làm bài, nhóm theo ngày, bấm vào để xem lại
// chi tiết từng câu (đúng/sai, đáp án đúng, giải thích) — y hệt cơ chế và
// giao diện đã dùng ở trang lớp học (classroom.js / .quiz-history-item).
// ============================================================
async function loadQuizHistory(studentId) {
    const container = $('#profile-quiz-history');
    if (!container) return;
    container.innerHTML = '<p class="empty-state">Đang tải lịch sử làm bài...</p>';

    try {
        const q = query(collection(db, 'results'), where('userId', '==', studentId));
        const snap = await getDocs(q);
        if (snap.empty) {
            container.innerHTML = '<p class="empty-state">Chưa có lượt làm bài kiểm tra nào trên hệ thống.</p>';
            return;
        }

        const resultsRaw = [];
        snap.forEach((d) => resultsRaw.push({ id: d.id, ...d.data() }));

        // Tra cứu tiêu đề + câu hỏi của từng bài tập để hiển thị tên thật + xem lại chi tiết
        const uniqueExerciseIds = [...new Set(resultsRaw.map((r) => r.exerciseId).filter(Boolean))];
        const exerciseMap = {};
        await Promise.all(uniqueExerciseIds.map(async (exId) => {
            try {
                const exSnap = await getDoc(doc(db, 'exercises', exId));
                if (exSnap.exists()) exerciseMap[exId] = { id: exSnap.id, ...exSnap.data() };
            } catch (e) { /* bài có thể đã bị xóa khỏi hệ thống — bỏ qua */ }
        }));

        const groups = groupByDay(resultsRaw, (r) => (r.timestamp?.toDate ? r.timestamp.toDate() : null));
        container.innerHTML = groups.map((group) => `
            <div class="day-group">
                <h4 class="day-group-header">📅 Ngày ${escapeHtml(group.label)}</h4>
                ${group.items.map((r) => renderQuizHistoryItemHtml(r, exerciseMap[r.exerciseId])).join('')}
            </div>
        `).join('');

        container.querySelectorAll('.quiz-history-summary').forEach((btn) => {
            btn.addEventListener('click', () => btn.closest('.quiz-history-item').classList.toggle('is-open'));
        });
    } catch (err) {
        console.error('Lỗi khi tải lịch sử làm bài:', err);
        container.innerHTML = '<p class="empty-state">Không thể tải lịch sử làm bài kiểm tra.</p>';
    }
}

function renderQuizHistoryItemHtml(r, exercise) {
    let dateStr = 'Gần đây';
    if (r.timestamp && typeof r.timestamp.toDate === 'function') {
        dateStr = r.timestamp.toDate().toLocaleString('vi-VN');
    }
    const scoreColorClass = (r.scorePercentage || 0) >= 50 ? 'text-green' : 'text-red';
    const title = exercise?.title || `Bài tập (mã ${r.exerciseId || '--'})`;

    let detailHtml = '<p class="empty-state">Bài tập này đã bị xóa khỏi hệ thống nên không thể xem lại chi tiết từng câu.</p>';
    if (exercise?.questions?.length) {
        detailHtml = exercise.questions.map((q, idx) => {
            const userAnswer = r.studentAnswers ? r.studentAnswers[q.id] : null;
            const correctRaw = q.correct != null ? String(q.correct) : '';
            const isCorrect = userAnswer != null && String(userAnswer).toLowerCase() === correctRaw.toLowerCase();
            return `
            <div class="result-item ${isCorrect ? 'correct' : 'incorrect'}">
                <h4>Câu ${idx + 1}: ${escapeHtml(q.text || '')}</h4>
                <p>Đáp án của bạn: <strong class="${isCorrect ? 'text-green' : 'text-red'}">${escapeHtml(userAnswer || '(Bỏ trống)')}</strong></p>
                ${!isCorrect ? `<p>Đáp án đúng: <strong class="text-green">${escapeHtml(correctRaw)}</strong></p>` : ''}
                ${q.explanation ? `<p class="explanation-box">💡 <strong>Giải thích:</strong> ${escapeHtml(q.explanation)}</p>` : ''}
            </div>`;
        }).join('');
    }

    return `
    <div class="quiz-history-item">
        <button type="button" class="quiz-history-summary">
            <div class="qh-left">
                <h4>${escapeHtml(title)}</h4>
                <p class="qh-time">⏱ ${escapeHtml(dateStr)}</p>
            </div>
            <div class="qh-right">
                <div class="qh-score ${scoreColorClass}">${r.scorePercentage ?? 0}%</div>
                <p>Đúng ${r.correctAnswers ?? 0} · Sai ${r.mistakes ?? 0}</p>
            </div>
            <span class="qh-chevron">▾</span>
        </button>
        <div class="quiz-history-detail">${detailHtml}</div>
    </div>`;
}

// ---------- ĐĂNG XUẤT ----------
document.getElementById('btn-profile-logout').addEventListener('click', () => signOut(auth));
