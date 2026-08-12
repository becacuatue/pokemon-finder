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
    list.innerHTML = sessions.map((s) => {
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
    }).join('');
}

// ---------- ĐĂNG XUẤT ----------
document.getElementById('btn-profile-logout').addEventListener('click', () => signOut(auth));
