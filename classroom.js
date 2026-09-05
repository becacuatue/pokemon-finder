import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
 
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
 
let CURRENT_USER_ID = null; 
let availableExercises = [];
let currentTestSession = null;

// [THÊM MỚI] Tập hợp ID các bài tập học viên đã làm (tô xanh nhạt trong danh sách bài)
let completedExerciseIds = new Set();

// [THÊM MỚI] Bộ đếm giờ khi làm bài
let countdownIntervalId = null;

// [THÊM MỚI] Công thức điểm tổng hợp — PHẢI khớp với admin.js/profile.js
const SCORE_WEIGHTS = { test: 0.5, teacherEval: 0.3 };
function computeCompositeScore(scores = {}) {
    const test = scores?.testScoreAvg || 0;
    const teacher = scores?.teacherEvalAvg || 0;
    const bonus = scores?.bonusPoints || 0;
    const participation = scores?.participationPoints || 0;
    return Math.round(test * SCORE_WEIGHTS.test + teacher * 10 * SCORE_WEIGHTS.teacherEval + bonus + participation);
}

// [THÊM MỚI] Escape HTML để chèn dữ liệu (tên lớp, tiêu đề bài...) an toàn hơn
function escapeHtml(str = '') {
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// ============================================================
// [THÊM MỚI] "HỒ SƠ CHI TIẾT" PORT TỪ ADMIN.JS / PROFILE.JS
// Dùng để hiển thị ngay trong trang "Kết quả học tập" của lớp học,
// không phải sửa đổi công thức điểm hay logic — chỉ đọc & hiển thị.
// ============================================================
const STATS_INFO_FIELDS = [
    { key: 'dob', label: 'Ngày sinh', type: 'date' },
    { key: 'gender', label: 'Giới tính' },
    { key: 'phone', label: 'Số điện thoại' },
    { key: 'parentPhone', label: 'SĐT phụ huynh' },
    { key: 'address', label: 'Địa chỉ' },
    { key: 'email', label: 'Email' },
    { key: 'notes', label: 'Ghi chú từ giáo viên' },
];
const BONUS_BAR_MAX = 30;
const PARTICIPATION_BAR_MAX = 30;

function formatDateVN(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('vi-VN');
}
function round1(n) { return Math.round((n || 0) * 10) / 10; }
function clampPct(value, max) { if (!max) return 0; return Math.max(0, Math.min(100, ((value || 0) / max) * 100)); }

// [THÊM MỚI] Nhóm 1 danh sách theo NGÀY (dùng chung cho: bài tập trong lớp,
// lịch sử làm bài kiểm tra, nhật ký buổi học) — sắp xếp ngày gần nhất lên đầu,
// ví dụ: 23/08, 22/08, 21/08... Mục nào thiếu ngày hợp lệ sẽ gom vào cuối cùng.
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
 
// ============================================================
// [THÊM MỚI] Hằng số & tiện ích hiển thị thông tin học viên /
// lớp đang học. Phần này chỉ CHÈN THÊM giao diện, không thay
// đổi bất kỳ luồng xử lý (logic) nào ở phía dưới.
// ============================================================
const LAST_CLASS_STORAGE_KEY = 'dtedu_current_class_name';
// Bổ sung hàm lấy danh sách lớp học cho giao diện Học viên
async function loadClassesList() {
    // Trỏ đúng vào ID 'classes-grid' để không ghi đè phần đánh giá và welcome-bar
    const classContainer = document.getElementById('classes-grid');

    try {
        const querySnapshot = await getDocs(collection(db, "classes"));

        if (querySnapshot.empty) {
            classContainer.innerHTML = '<p>Chưa có lớp học nào. Vui lòng quay lại sau.</p>';
            return;
        }

        const classes = [];
        querySnapshot.forEach((docSnap) => {
            classes.push({ id: docSnap.id, ...docSnap.data() });
        });
        // Sắp xếp theo tên cho dễ tìm (không dùng orderBy phía Firestore — sẽ âm thầm
        // loại bỏ những lớp thiếu field dùng để sắp xếp mà không báo lỗi gì cả)
        classes.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));

        classContainer.innerHTML = '';
        classes.forEach((classData) => {
            const card = document.createElement('div');
            card.className = 'card class-card';
            card.innerHTML = `
                <h3>${escapeHtml(classData.name || 'Lớp chưa đặt tên')}</h3>
                <p>${escapeHtml(classData.description || classData.schedule || 'Không có mô tả')}</p>
            `;
            card.addEventListener('click', () => window.loadExercisesForClass(classData.id, classData.name || 'Lớp chưa đặt tên'));
            classContainer.appendChild(card);
        });
    } catch (error) {
        console.error("Lỗi khi tải danh sách lớp:", error);
        classContainer.innerHTML = '<p>Không thể tải danh sách lớp học. Vui lòng kiểm tra kết nối và thử lại.</p>';
    }
}

// Lấy chữ cái đầu để hiển thị avatar tròn khi chưa có ảnh đại diện
function getInitials(text) {
    if (!text) return '?';
    const clean = text.trim();
    if (clean.includes('@')) return clean.charAt(0).toUpperCase();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
 
// Cập nhật thanh chào mừng + chip trên navbar dựa theo trạng thái đăng nhập
function renderStudentInfo(user) {
    const nameEl = document.getElementById('student-name');
    const avatarEl = document.getElementById('student-avatar');
    const navChip = document.getElementById('nav-user-chip');
    const navAvatar = document.getElementById('nav-avatar-sm');
    const navName = document.getElementById('nav-user-name');
    const dropdownName = document.getElementById('dropdown-name');
    const dropdownEmail = document.getElementById('dropdown-email');
    const dropdownUid = document.getElementById('dropdown-uid');
    const dropdownAvatar = document.getElementById('dropdown-avatar');
    const displayName = user ? (user.displayName || user.email || 'Học viên') : 'Khách';
    const initials = user ? getInitials(user.displayName || user.email) : '🎓';
 
    if (nameEl) nameEl.textContent = displayName;
    if (avatarEl && user) avatarEl.textContent = initials;
 
    if (navChip && navName && navAvatar) {
        if (user) {
            navChip.classList.remove('hidden');
            navAvatar.textContent = initials;
            navName.textContent = displayName;
            if (dropdownName) dropdownName.textContent = displayName;
            if (dropdownEmail) dropdownEmail.textContent = user.email || 'Không có email';
            if (dropdownUid) dropdownUid.textContent = user.uid;
            if (dropdownAvatar) dropdownAvatar.textContent = initials;
        } else {
            navChip.classList.add('hidden');
        }
    }
}
window.toggleUserInfo = function() {
    const dropdown = document.getElementById('user-info-dropdown');
    if (dropdown) {
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    }
};
window.handleLogout = function() {
    // Xóa dữ liệu lớp học đang lưu tạm (tùy chọn)
    localStorage.removeItem('dtedu_current_class_name'); 
    
    signOut(auth).then(() => {
        // Đăng xuất thành công, tải lại trang hoặc chuyển về trang chủ
        window.location.href = 'index.html'; 
    }).catch((error) => {
        console.error("Lỗi đăng xuất:", error);
        alert("Có lỗi xảy ra khi đăng xuất. Vui lòng thử lại!");
    });
};
// Đóng khung thông tin nếu click ra ngoài vùng nav-user-chip
document.addEventListener('click', (e) => {
    const chip = document.getElementById('nav-user-chip');
    const dropdown = document.getElementById('user-info-dropdown');
    if (chip && dropdown && !chip.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});
// Ghi nhớ & hiển thị khóa học học viên đang xem/luyện tập gần nhất
function setCurrentClassDisplay(className) {
    const el = document.getElementById('student-current-class');
    if (el) el.textContent = className || 'Chưa chọn khóa học';
}
 
function rememberCurrentClass(className) {
    try {
        localStorage.setItem(LAST_CLASS_STORAGE_KEY, className);
    } catch (e) { /* bỏ qua nếu trình duyệt chặn localStorage */ }
    setCurrentClassDisplay(className);
}
 
function loadRememberedClass() {
    try {
        const saved = localStorage.getItem(LAST_CLASS_STORAGE_KEY);
        if (saved) setCurrentClassDisplay(saved);
    } catch (e) { /* bỏ qua nếu trình duyệt chặn localStorage */ }
}
// ============================================================
// [THÊM MỚI] Bài đã hoàn thành + Banner "Lớp đang học"
// ============================================================

// Tải danh sách ID bài tập học viên đã làm (dùng để tô xanh nhạt + tính tiến độ)
async function loadCompletedExerciseIds() {
    const userId = CURRENT_USER_ID || "guest_test_user";
    try {
        const q = query(collection(db, "results"), where("userId", "==", userId));
        const querySnapshot = await getDocs(q);
        completedExerciseIds = new Set();
        querySnapshot.forEach((docSnap) => {
            const exerciseId = docSnap.data().exerciseId;
            if (exerciseId) completedExerciseIds.add(exerciseId);
        });
    } catch (error) {
        console.error("Lỗi khi tải danh sách bài đã làm:", error);
    }
}

// Banner "Lớp đang học" ở đầu trang: tiến độ / điểm / hạng của học viên trong LỚP THẬT
// mà admin đã gán (students/{uid}.classId) — khác với "lớp đang xem gần nhất" ở welcome-bar.
let myClassInfo = null; // { id, name }

async function loadMyClassSummary() {
    const banner = document.getElementById('my-class-banner');
    if (!banner) return;

    if (!CURRENT_USER_ID) {
        banner.classList.add('hidden');
        return;
    }

    try {
        const studentSnap = await getDoc(doc(db, 'students', CURRENT_USER_ID));
        if (!studentSnap.exists()) {
            banner.classList.add('hidden');
            return;
        }
        const student = studentSnap.data();
        if (!student.classId) {
            banner.classList.add('hidden');
            return;
        }

        myClassInfo = { id: student.classId, name: student.className || 'Lớp của bạn' };

        // Đếm tổng số bài tập của lớp + số bài đã hoàn thành trong lớp đó
        const exSnap = await getDocs(query(collection(db, 'exercises'), where('targetClass', '==', student.classId)));
        const classExerciseIds = [];
        exSnap.forEach((d) => classExerciseIds.push(d.id));
        const totalInClass = classExerciseIds.length;
        const doneInClass = classExerciseIds.filter((id) => completedExerciseIds.has(id)).length;
        const progressPct = totalInClass > 0 ? Math.round((doneInClass / totalInClass) * 100) : 0;

        // Tính hạng trong lớp (cùng công thức & cách làm như admin.js/profile.js)
        let rankText = '--';
        try {
            const classmatesSnap = await getDocs(query(collection(db, 'students'), where('classId', '==', student.classId)));
            const list = [];
            classmatesSnap.forEach((d) => list.push({ id: d.id, scores: d.data().scores }));
            list.sort((a, b) => computeCompositeScore(b.scores) - computeCompositeScore(a.scores));
            const idx = list.findIndex((x) => x.id === CURRENT_USER_ID);
            if (idx > -1) rankText = `${idx + 1}/${list.length}`;
        } catch (rankErr) {
            console.error('Lỗi khi tính hạng:', rankErr);
        }

        // Đổ dữ liệu vào banner
        document.getElementById('my-class-name').textContent = student.className || 'Lớp của bạn';
        document.getElementById('my-class-progress-fill').style.width = `${progressPct}%`;
        document.getElementById('my-class-progress-text').textContent = `${doneInClass}/${totalInClass} bài đã làm`;
        document.getElementById('my-class-score').textContent = computeCompositeScore(student.scores);
        document.getElementById('my-class-rank').textContent = rankText;

        banner.classList.remove('hidden');
    } catch (error) {
        console.error('Lỗi khi tải thông tin lớp đang học:', error);
        banner.classList.add('hidden');
    }
}

document.getElementById('btn-goto-my-class')?.addEventListener('click', () => {
    if (myClassInfo) window.loadExercisesForClass(myClassInfo.id, myClassInfo.name);
});

// ============================================================
// [HẾT PHẦN THÊM MỚI]
// ============================================================
 
// Gộp chung khởi tạo trang và kiểm tra đăng nhập
document.addEventListener('DOMContentLoaded', () => {
    loadRememberedClass(); 
    
    // Gọi hàm tải danh sách lớp vào đúng ID 'classes-grid'
    loadClassesList();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            CURRENT_USER_ID = user.uid;
        } else {
            console.log("Đang test chế độ chưa đăng nhập...");
        }
        renderStudentInfo(user);
        await loadCompletedExerciseIds(); // [THÊM MỚI] cần có trước để tô xanh bài đã làm + tính tiến độ
        loadDashboardStats();
        loadMyClassSummary(); // [THÊM MỚI] banner "Lớp đang học": tiến độ / điểm / hạng
    });

    // Bắt sự kiện submit form để chấm điểm
    const quizForm = document.getElementById('quiz-form');
    if (quizForm) {
        quizForm.addEventListener('submit', (e) => {
            e.preventDefault(); 
            evaluateAndSaveTest();
        });
    }
});
 
// Gán hàm vào window để HTML gọi được (onclick)
window.goBackToClasses = function() {
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('class-selection-section').classList.remove('hidden');
}
 
window.goBackToDashboard = function() {
    stopCountdown(); // [THÊM MỚI] dừng đếm ngược nếu thoát làm bài giữa chừng
    if ('speechSynthesis' in window) window.speechSynthesis.cancel(); // [THÊM MỚI] dừng đọc từ vựng nếu còn đang phát
    document.getElementById('test-section').classList.add('hidden');
    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('lesson-vocab-warmup-section')?.classList.add('hidden'); // [THÊM MỚI]
    document.getElementById('dashboard-section').classList.remove('hidden');
}
 
window.loadExercisesForClass = async function(classId, className) {
    document.getElementById('class-selection-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    document.getElementById('current-class-title').textContent = `Bài tập: ${className}`;
 
    rememberCurrentClass(className); // [THÊM MỚI] ghi nhớ + hiển thị khóa học đang chọn

    loadClassTeacherCard(classId); // [THÊM MỚI] thông tin giáo viên phụ trách lớp (không chặn tải bài tập)
 
    const grid = document.getElementById('lesson-grid');
    grid.innerHTML = '<p>Đang tải dữ liệu bài tập...</p>';
 
    try {
        const q = query(collection(db, "exercises"), where("targetClass", "==", classId));
        const querySnapshot = await getDocs(q);
        
        availableExercises = [];
        querySnapshot.forEach((doc) => {
            availableExercises.push({ id: doc.id, ...doc.data() });
        });

        // [THÊM MỚI] Bài mới nhất lên đầu, cũ hơn xuống dưới. Không dùng orderBy phía
        // Firestore vì sẽ âm thầm loại bỏ bài thiếu field "createdAt" khỏi kết quả.
        availableExercises.sort((a, b) => {
            const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return tb - ta;
        });

        if(availableExercises.length === 0) {
            grid.innerHTML = '<p>Chưa có bài tập nào cho khóa học này.</p>';
            return;
        }

        // [THÊM MỚI] Nhóm bài tập theo NGÀY tạo (createdAt), ví dụ: ngày 23, 22, 21...
        // Bài chưa có createdAt sẽ gom vào nhóm "Chưa rõ ngày" ở cuối cùng.
        grid.innerHTML = '';
        const dayGroups = groupByDay(availableExercises, (t) => (t.createdAt?.toDate ? t.createdAt.toDate() : null));

        dayGroups.forEach((group) => {
            const groupWrap = document.createElement('div');
            groupWrap.className = 'day-group';
            groupWrap.innerHTML = `<h4 class="day-group-header">📅 Ngày ${escapeHtml(group.label)}</h4>`;

            const subGrid = document.createElement('div');
            subGrid.className = 'grid day-group-grid';

            group.items.forEach((test) => {
                const card = document.createElement('div');
                const isDone = completedExerciseIds.has(test.id); // [THÊM MỚI]
                card.className = 'card' + (isDone ? ' already-done' : '');
                const audioBadge = test.audioUrl ? `<span class="meta-chip meta-chip-audio">🎧 Có bài nghe</span>` : '';
                const doneBadge = isDone ? `<span class="done-badge">✓ Đã hoàn thành</span>` : ''; // [THÊM MỚI]
                const vocabBadge = (test.vocabWarmup && test.vocabWarmup.length) ? `<span class="meta-chip">🔤 Khởi động từ vựng</span>` : ''; // [THÊM MỚI]
                card.innerHTML = `
                    ${doneBadge}
                    <h3>${escapeHtml(test.title || '')}</h3>
                    <p class="card-description">${escapeHtml(test.description || 'Không có mô tả')}</p>
                    <div class="lesson-meta">
                        <span class="meta-chip">📝 ${test.questions ? test.questions.length : 0} câu</span>
                        <span class="meta-chip">⏱ ${test.timeLimit} phút</span>
                        ${audioBadge}
                        ${vocabBadge}
                    </div>
                    <button class="btn-primary" id="btn-start-${test.id}">${isDone ? 'Làm lại bài này' : 'Bắt đầu làm bài'}</button>
                `;
                subGrid.appendChild(card);

                // Gắn sự kiện click
                card.querySelector(`#btn-start-${test.id}`).addEventListener('click', () => startTest(test.id));
            });

            groupWrap.appendChild(subGrid);
            grid.appendChild(groupWrap);
        });
    } catch (error) {
        console.error("Lỗi khi tải bài tập:", error);
        grid.innerHTML = '<p>Lỗi tải dữ liệu. Vui lòng F5 lại trang.</p>';
    }
}

// [THÊM MỚI] Thẻ thông tin giáo viên phụ trách lớp — đọc từ classes/{id}:
// teacherName, teacherTitle, teacherPhotoUrl, teacherBio. Các field này CHƯA
// được quản lý trong admin.js — cứ để giao diện sẵn đây, khi nào bổ sung field
// đó vào admin (CLASS_FIELDS) và điền dữ liệu thì thẻ sẽ tự hiển thị đúng,
// không cần sửa gì thêm ở đây.
async function loadClassTeacherCard(classId) {
    const nameEl = document.getElementById('class-teacher-name');
    const titleEl = document.getElementById('class-teacher-title');
    const bioEl = document.getElementById('class-teacher-bio');
    const photoEl = document.getElementById('class-teacher-photo');
    const fallbackEl = document.getElementById('class-teacher-avatar-fallback');
    if (!nameEl) return;

    // Trạng thái mặc định trong lúc tải / khi chưa có dữ liệu
    nameEl.textContent = 'Đang cập nhật...';
    titleEl.textContent = '';
    bioEl.textContent = 'Thông tin giáo viên sẽ được cập nhật sớm.';
    photoEl.classList.add('hidden');
    fallbackEl.classList.remove('hidden');
    fallbackEl.textContent = '👩‍🏫';

    try {
        const classSnap = await getDoc(doc(db, 'classes', classId));
        if (!classSnap.exists()) return;
        const c = classSnap.data();

        nameEl.textContent = c.teacherName || 'Đang cập nhật...';
        titleEl.textContent = c.teacherTitle || '';
        bioEl.textContent = c.teacherBio || 'Thông tin giáo viên sẽ được cập nhật sớm.';

        if (c.teacherPhotoUrl) {
            photoEl.src = c.teacherPhotoUrl;
            photoEl.classList.remove('hidden');
            fallbackEl.classList.add('hidden');
        } else {
            fallbackEl.textContent = getInitials(c.teacherName) === '?' ? '👩‍🏫' : getInitials(c.teacherName);
        }
    } catch (error) {
        console.error('Lỗi khi tải thông tin giáo viên:', error);
    }
}
 
// [THÊM MỚI] Đếm ngược thời gian làm bài — thay cho việc chỉ hiện số phút tĩnh trước đây
function stopCountdown() {
    if (countdownIntervalId) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
    }
    document.getElementById('timer-box')?.classList.remove('timer-warning');
}

function startCountdown(minutes) {
    stopCountdown(); // đảm bảo không có bộ đếm cũ nào còn chạy song song

    let remainingSeconds = Math.max(0, Math.round((parseFloat(minutes) || 0) * 60));
    const timerEl = document.getElementById('timer');
    const timerBox = document.getElementById('timer-box');

    const render = () => {
        const m = Math.floor(remainingSeconds / 60).toString().padStart(2, '0');
        const s = (remainingSeconds % 60).toString().padStart(2, '0');
        if (timerEl) timerEl.textContent = `${m}:${s}`;
        if (timerBox) timerBox.classList.toggle('timer-warning', remainingSeconds <= 60 && remainingSeconds > 0);
    };

    render();
    countdownIntervalId = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds <= 0) {
            remainingSeconds = 0;
            render();
            stopCountdown();
            alert('⏰ Đã hết giờ làm bài! Hệ thống sẽ tự động nộp bài cho bạn.');
            evaluateAndSaveTest();
            return;
        }
        render();
    }, 1000);
}

// Bắt đầu làm bài
// [THÊM MỚI] Trước khi vào bài thật, kiểm tra xem bài này có mảng "vocabWarmup"
// không — nếu có thì cho học viên khởi động từ vựng trước (xem maybeStartVocabWarmup).
function startTest(testId) {
    const test = availableExercises.find(t => t.id === testId);
    if (!test) return;
    currentTestSession = test;

    if (maybeStartVocabWarmup(test)) return; // có từ vựng khởi động -> dừng ở đây, vào bài thật sau khi xong/bỏ qua
    proceedToRealTest(testId);
}

function proceedToRealTest(testId) {
    currentTestSession = availableExercises.find(t => t.id === testId) || currentTestSession;
    
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('test-section').classList.remove('hidden');
 
    document.getElementById('current-test-title').textContent = currentTestSession.title;
    startCountdown(currentTestSession.timeLimit); // [THÊM MỚI] đếm ngược thật, tự nộp bài khi hết giờ
    
    let audioHtml = '';
    if (currentTestSession.audioParts && currentTestSession.audioParts.length > 0) {
        currentTestSession.audioParts.forEach(part => {
            if (part.audioUrl) {
                audioHtml += `
                    <div class="audio-player-box">
                        <p class="audio-player-label">🎧 ${escapeHtml(part.label || 'Bài nghe (Listening)')}</p>
                        <audio controls preload="metadata" src="${part.audioUrl}">
                            Trình duyệt của bạn không hỗ trợ phát audio. Vui lòng cập nhật trình duyệt để làm bài.
                        </audio>
                    </div>
                `;
            }
        });
    } 
    // 2. Tương thích ngược: Đọc định dạng cũ nếu bài tập chỉ có trường audioUrl đơn lẻ
    else if (currentTestSession.audioUrl) {
        audioHtml = `
            <div class="audio-player-box">
                <p class="audio-player-label">🎧 Bài nghe (Listening)</p>
                <audio controls preload="metadata" src="${currentTestSession.audioUrl}">
                    Trình duyệt của bạn không hỗ trợ phát audio. Vui lòng cập nhật trình duyệt để làm bài.
                </audio>
            </div>
        `;
    }

    const passageHtml = `<p style="white-space: pre-line;">${currentTestSession.content || 'Đọc kỹ các câu hỏi bên phải và điền đáp án chính xác.'}</p>` || `
        <h2>${currentTestSession.title}</h2>
        <p style="white-space: pre-line;">${currentTestSession.description || 'Đọc kỹ các câu hỏi bên phải và điền đáp án chính xác.'}</p>
    `;

    document.getElementById('test-content').innerHTML = audioHtml + passageHtml;
 
    // Render cột phải (Câu hỏi)
    const qContainer = document.getElementById('questions-container');
    qContainer.innerHTML = '';
 
    (currentTestSession.questions || []).forEach((q, index) => {
        const block = document.createElement('div');
        block.className = 'question-block';
        
        // Render hình ảnh nếu câu hỏi có ảnh
        const imgHtml = q.imageUrl ? `<img src="${q.imageUrl}" class="q-img" alt="Hình ảnh">` : '';
 
        let inputsHtml = '';
        if(q.type === 'radio') {
            (q.options || []).forEach(opt => {
                inputsHtml += `<label><input type="radio" name="${q.id}" value="${opt}" required> ${opt}</label>`;
            });
        } else if (q.type === 'text' || q.type === 'flashcard') {
            inputsHtml = `<input type="text" name="${q.id}" class="text-input" placeholder="Nhập câu trả lời (VD: từ vựng)..." required>`;
        }
 
        block.innerHTML = `
            <p class="question-text"><span class="q-number">${index + 1}</span> ${q.text}</p>
            ${imgHtml}
            ${inputsHtml}
        `;
        qContainer.appendChild(block);
    });
}

// ============================================================
// [THÊM MỚI] KHỞI ĐỘNG TỪ VỰNG TRƯỚC KHI LÀM BÀI
// Tái sử dụng NGUYÊN VẸN css & cơ chế của module luyện từ vựng độc lập
// (xem vocab.css / vocab.js): 1 từ tiếng Anh + tự đọc phát âm bằng Web
// Speech API + chọn 1 trong 4 đáp án nghĩa tiếng Việt.
//
// CƠ CHẾ "CHỜ ĐỒNG BỘ SAU": bài tập nào có field `vocabWarmup` (mảng object
// dạng { word, phonetic, partOfSpeech, meaning, example, exampleTranslation }
// — ĐÚNG cấu trúc như trong vocab-data.json) sẽ tự động hiện bước khởi động
// từ vựng này trước khi vào bài. Bài KHÔNG có field này (mặc định với toàn
// bộ dữ liệu hiện tại) sẽ bỏ qua và vào thẳng bài làm như trước — không cần
// sửa code gì thêm khi bạn đồng bộ/nhập dữ liệu vocabWarmup sau này.
// ============================================================
let lessonVocabQueue = [];
let lessonVocabWord = null;
let lessonVocabTotal = 0;
let lessonVocabDone = 0;
let pendingTestIdAfterWarmup = null;

function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Trả về true nếu đã chuyển sang màn khởi động từ vựng (gọi nơi khác nên dừng lại).
function maybeStartVocabWarmup(test) {
    const words = Array.isArray(test.vocabWarmup) ? test.vocabWarmup.filter(w => w && w.word && w.meaning) : [];
    if (words.length === 0) return false;

    stopCountdown(); // đề phòng còn bộ đếm giờ cũ từ lượt làm bài trước đó

    pendingTestIdAfterWarmup = test.id;
    lessonVocabQueue = shuffleArray(words);
    lessonVocabTotal = lessonVocabQueue.length;
    lessonVocabDone = 0;

    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('test-section').classList.add('hidden');
    document.getElementById('lesson-vocab-warmup-section').classList.remove('hidden');
    document.getElementById('lesson-vocab-exercise-title').textContent = `Ôn nhanh từ vựng trước khi vào bài: ${test.title || ''}`;
    document.getElementById('lesson-vocab-card').classList.remove('hidden');
    document.getElementById('lesson-vocab-complete').classList.add('hidden');
    updateLessonVocabProgress();
    nextLessonVocabWord();
    window.scrollTo(0, 0);
    return true;
}

function updateLessonVocabProgress() {
    const el = document.getElementById('lesson-vocab-progress');
    if (el) el.textContent = `${lessonVocabDone}/${lessonVocabTotal}`;
}

function nextLessonVocabWord() {
    if (lessonVocabQueue.length === 0) {
        document.getElementById('lesson-vocab-card').classList.add('hidden');
        document.getElementById('lesson-vocab-complete').classList.remove('hidden');
        return;
    }
    lessonVocabWord = lessonVocabQueue.shift();
    document.getElementById('lesson-vocab-word').textContent = lessonVocabWord.word;
    document.getElementById('lesson-vocab-phonetic').innerHTML =
        `${escapeHtml(lessonVocabWord.phonetic || '')} <span class="vocab-pos">${escapeHtml(lessonVocabWord.partOfSpeech || '')}</span>`;

    const feedback = document.getElementById('lesson-vocab-feedback');
    feedback.classList.add('hidden');
    feedback.classList.remove('is-correct', 'is-wrong');
    document.getElementById('lesson-vocab-next-btn').classList.add('hidden');

    renderLessonVocabOptions();
    speakLessonVocabWord(lessonVocabWord.word);
}

function speakLessonVocabWord(text) {
    if (!('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(text);
        msg.lang = 'en-US';
        msg.rate = 0.92;
        window.speechSynthesis.speak(msg);
    } catch (e) {
        console.error('Lỗi phát âm (Web Speech API):', e);
    }
}

function renderLessonVocabOptions() {
    const container = document.getElementById('lesson-vocab-options');
    container.innerHTML = '';

    // Nghĩa nhiễu: lấy trong chính danh sách vocabWarmup của bài này.
    let pool = [...lessonVocabQueue, lessonVocabWord].filter(w => w.meaning !== lessonVocabWord.meaning);
    pool = shuffleArray(pool);
    const distractors = [];
    for (const w of pool) {
        if (distractors.length >= 3) break;
        if (!distractors.includes(w.meaning)) distractors.push(w.meaning);
    }
    // Nếu bài quá ít từ để đủ 3 nghĩa nhiễu khác nhau, độn thêm nghĩa trung tính cố định.
    const fallbackMeanings = ['một khái niệm khác', 'một hành động khác', 'một tính chất khác'];
    let fi = 0;
    while (distractors.length < 3) { distractors.push(fallbackMeanings[fi % fallbackMeanings.length]); fi++; }

    const options = shuffleArray([lessonVocabWord.meaning, ...distractors]);
    const letters = ['A', 'B', 'C', 'D'];
    options.forEach((meaning, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vocab-option-btn';
        btn.innerHTML = `<span class="opt-letter">${letters[idx]}</span><span>${escapeHtml(meaning)}</span>`;
        btn.addEventListener('click', () => selectLessonVocabAnswer(meaning, btn));
        container.appendChild(btn);
    });
}

function selectLessonVocabAnswer(chosenMeaning, btnEl) {
    const buttons = document.getElementById('lesson-vocab-options').querySelectorAll('.vocab-option-btn');
    if (buttons.length && buttons[0].disabled) return; // đã trả lời từ này rồi
    const isCorrect = chosenMeaning === lessonVocabWord.meaning;

    buttons.forEach((btn) => {
        btn.disabled = true;
        const meaningText = btn.querySelector('span:last-child').textContent;
        if (meaningText === lessonVocabWord.meaning) btn.classList.add('correct');
        else if (btn === btnEl && !isCorrect) btn.classList.add('wrong');
        else btn.classList.add('dim');
    });

    const feedback = document.getElementById('lesson-vocab-feedback');
    feedback.classList.remove('hidden');
    feedback.classList.toggle('is-correct', isCorrect);
    feedback.classList.toggle('is-wrong', !isCorrect);
    document.getElementById('lesson-vocab-feedback-text').innerHTML = isCorrect
        ? `✅ Chính xác! "${escapeHtml(lessonVocabWord.word)}" = ${escapeHtml(lessonVocabWord.meaning)}`
        : `❌ Chưa đúng. "${escapeHtml(lessonVocabWord.word)}" nghĩa là <strong>${escapeHtml(lessonVocabWord.meaning)}</strong>`;
    document.getElementById('lesson-vocab-example').textContent = lessonVocabWord.example
        ? `💬 ${lessonVocabWord.example}${lessonVocabWord.exampleTranslation ? ' — ' + lessonVocabWord.exampleTranslation : ''}`
        : '';

    lessonVocabDone++;
    updateLessonVocabProgress();
    document.getElementById('lesson-vocab-next-btn').classList.remove('hidden');
}

document.getElementById('lesson-vocab-next-btn')?.addEventListener('click', nextLessonVocabWord);
document.getElementById('lesson-vocab-speak-btn')?.addEventListener('click', () => {
    if (lessonVocabWord) speakLessonVocabWord(lessonVocabWord.word);
});
document.getElementById('btn-skip-vocab-warmup')?.addEventListener('click', () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    document.getElementById('lesson-vocab-warmup-section').classList.add('hidden');
    proceedToRealTest(pendingTestIdAfterWarmup);
});
document.getElementById('btn-continue-to-test')?.addEventListener('click', () => {
    document.getElementById('lesson-vocab-warmup-section').classList.add('hidden');
    proceedToRealTest(pendingTestIdAfterWarmup);
});
// Chấm điểm và Lưu
// [THÊM MỚI] Chống nộp bài trùng lặp (hết giờ tự nộp đúng lúc học viên bấm nộp tay)
let isSubmittingTest = false;

async function evaluateAndSaveTest() {
    if (isSubmittingTest) return;
    isSubmittingTest = true;
    stopCountdown(); // dừng đếm ngược ngay khi bắt đầu nộp bài (nộp tay hoặc hết giờ)
    const submitBtn = document.querySelector('.btn-submit');
    const originalBtnText = submitBtn.textContent;
    submitBtn.textContent = 'Đang chấm điểm & lưu kết quả...';
    submitBtn.disabled = true;
 
    const formData = new FormData(document.getElementById('quiz-form'));
    let correctCount = 0;
    let mistakes = 0;
    let htmlDetails = '';
    let studentAnswersRecord = {};
 
    currentTestSession.questions.forEach((q, index) => {
        let userAnswer = formData.get(q.id);
        if(q.type === 'text' || q.type === 'flashcard') {
            userAnswer = userAnswer ? userAnswer.trim().toLowerCase() : '';
        }
        
        studentAnswersRecord[q.id] = userAnswer || null;
        
        const isCorrect = (userAnswer === q.correct.toLowerCase() || userAnswer === q.correct);
 
        if (isCorrect) correctCount++;
        else mistakes++;
 
        htmlDetails += `
            <div class="result-item ${isCorrect ? 'correct' : 'incorrect'}">
                <h4>Câu ${index + 1}: ${q.text}</h4>
                <p>Đáp án của bạn: <strong class="${isCorrect ? 'text-green' : 'text-red'}">${userAnswer || '(Bỏ trống)'}</strong></p>
                ${!isCorrect ? `<p>Đáp án đúng: <strong class="text-green">${q.correct}</strong></p>` : ''}
                <p class="explanation-box">💡 <strong>Giải thích:</strong> ${q.explanation || 'Không có giải thích'}</p>
            </div>
        `;
    });
 
    const percent = Math.round((correctCount / currentTestSession.questions.length) * 100);
    
    // LẤY USER ID HOẶC DÙNG TẠM GUEST ĐỂ TEST
    const userIdToSave = CURRENT_USER_ID || "guest_test_user";
 
    // GỬI LÊN FIREBASE (Collection: results)
    try {
        const docRef = await addDoc(collection(db, "results"), {
            userId: userIdToSave,
            exerciseId: currentTestSession.id,
            scorePercentage: percent,
            correctAnswers: correctCount,
            mistakes: mistakes,
            studentAnswers: studentAnswersRecord,
            timestamp: serverTimestamp()
        });
        console.log("🎉 Đã lưu kết quả thành công với ID:", docRef.id);
    } catch (error) {
        console.error("Lỗi khi lưu kết quả lên Firebase:", error);
        alert("⚠️ Không thể lưu điểm lên hệ thống. Lỗi: " + error.message);
    }
 
    submitBtn.textContent = originalBtnText;
    submitBtn.disabled = false;
    isSubmittingTest = false; // [THÊM MỚI] reset cờ chống nộp trùng

    // Hiển thị giao diện kết quả
    document.getElementById('score-display').textContent = `${percent}%`;
    document.getElementById('mistake-count').textContent = mistakes;
    document.getElementById('detailed-results').innerHTML = htmlDetails;

    // [THÊM MỚI] Cập nhật vòng tròn điểm số (score-ring) theo % đạt được
    const ringEl = document.getElementById('score-ring');
    if (ringEl) ringEl.style.setProperty('--pct', percent);

    // [THÊM MỚI] Đánh dấu bài này là "đã hoàn thành" ngay lập tức + làm mới banner lớp đang học
    completedExerciseIds.add(currentTestSession.id);
    loadMyClassSummary();

    document.getElementById('test-section').classList.add('hidden');
    document.getElementById('result-section').classList.remove('hidden');
    document.getElementById('quiz-form').reset();
    window.scrollTo(0,0);
}
// Mở trang Thống kê kết quả tổng quan
window.showLearningStats = async function() {
    // Ẩn các section khác, hiện section thống kê
    document.getElementById('class-selection-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('test-section').classList.add('hidden');
    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('lesson-vocab-warmup-section')?.classList.add('hidden');
    document.getElementById('learning-stats-section').classList.remove('hidden');
    window.scrollTo(0, 0);
 
    const userIdToQuery = CURRENT_USER_ID || "guest_test_user";
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '<p style="text-align: center; color: #666;">Đang đồng bộ dữ liệu học tập từ hệ thống...</p>';

    loadStatsProfileDetail(userIdToQuery); // [THÊM MỚI] hồ sơ chi tiết (port từ admin/profile) — chạy song song, không chặn phần dưới
 
    try {
        // Truy vấn tất cả kết quả của user này trong bảng results
        const q = query(collection(db, "results"), where("userId", "==", userIdToQuery));
        const querySnapshot = await getDocs(q);
 
        let totalTests = 0;
        let totalScoreSum = 0;
        let totalCorrect = 0;
 
        if (querySnapshot.empty) {
            historyList.innerHTML = '<p style="text-align: center; color: #666;">Bạn chưa hoàn thành bài tập nào trên hệ thống.</p>';
            document.getElementById('total-tests').textContent = '0';
            document.getElementById('avg-score').textContent = '0%';
            document.getElementById('total-correct').textContent = '0';
            return;
        }

        const resultsRaw = [];
        querySnapshot.forEach((docSnap) => resultsRaw.push({ id: docSnap.id, ...docSnap.data() }));

        resultsRaw.forEach((data) => {
            totalTests++;
            totalScoreSum += (data.scorePercentage || 0);
            totalCorrect += (data.correctAnswers || 0);
        });

        // [THÊM MỚI] Tra cứu tiêu đề + dữ liệu câu hỏi của từng bài tập (để hiển thị tên
        // thật thay vì mã bài, và để có thể xem lại chi tiết từng câu khi bấm vào).
        const uniqueExerciseIds = [...new Set(resultsRaw.map((r) => r.exerciseId).filter(Boolean))];
        const exerciseMap = {};
        await Promise.all(uniqueExerciseIds.map(async (exId) => {
            try {
                const exSnap = await getDoc(doc(db, 'exercises', exId));
                if (exSnap.exists()) exerciseMap[exId] = { id: exSnap.id, ...exSnap.data() };
            } catch (e) { /* bài có thể đã bị xóa khỏi hệ thống — bỏ qua */ }
        }));

        // [THÊM MỚI] Nhóm lịch sử làm bài theo NGÀY nộp bài (ví dụ: ngày 23, 22, 21...)
        const dayGroups = groupByDay(resultsRaw, (r) => (r.timestamp?.toDate ? r.timestamp.toDate() : null));
        historyList.innerHTML = dayGroups.map((group) => `
            <div class="day-group">
                <h4 class="day-group-header">📅 Ngày ${escapeHtml(group.label)}</h4>
                ${group.items.map((r) => renderQuizHistoryItemHtml(r, exerciseMap[r.exerciseId])).join('')}
            </div>
        `).join('');

        // Bấm vào 1 lượt làm bài để mở/đóng xem chi tiết từng câu
        historyList.querySelectorAll('.quiz-history-summary').forEach((btn) => {
            btn.addEventListener('click', () => btn.closest('.quiz-history-item').classList.toggle('is-open'));
        });
 
        // Tính điểm trung bình
        const avgScore = Math.round(totalScoreSum / totalTests);
 
        // Đẩy số liệu thống kê lên giao diện
        document.getElementById('total-tests').textContent = totalTests;
        document.getElementById('avg-score').textContent = avgScore + '%';
        document.getElementById('total-correct').textContent = totalCorrect;
 
    } catch (error) {
        console.error("Lỗi khi tải thống kê học tập:", error);
        historyList.innerHTML = '<p style="color: red; text-align: center;">Không thể tải dữ liệu thống kê. Vui lòng kiểm tra lại kết nối.</p>';
    }
}

// [THÊM MỚI] Render 1 lượt làm bài trong lịch sử — dạng có thể bấm mở rộng để
// xem lại chi tiết TỪNG CÂU (đúng/sai, đáp án đúng, giải thích) — tái sử dụng
// đúng các class .result-item / .explanation-box / .text-green / .text-red đã
// dùng ở khu vực "Kết quả" ngay sau khi nộp bài.
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

// ============================================================
// [THÊM MỚI] HỒ SƠ CHI TIẾT (port từ "Hồ sơ chi tiết học viên" bên admin.js /
// profile.js) — thông tin cá nhân, điểm số tổng hợp, xếp hạng trong lớp, và
// nhật ký buổi học do giáo viên đánh giá, hiển thị ngay trong trang lớp học.
// ============================================================
async function loadStatsProfileDetail(uid) {
    const wrap = document.getElementById('stats-profile-detail');
    if (!wrap) return;

    if (!CURRENT_USER_ID) {
        wrap.classList.add('hidden'); // khách chưa đăng nhập -> không có hồ sơ để hiển thị
        return;
    }
    wrap.classList.remove('hidden');

    const rankBadge = document.getElementById('stats-rank-badge');
    const infoList = document.getElementById('stats-info-list');
    const scoreBars = document.getElementById('stats-score-bars');
    const compositeEl = document.getElementById('stats-composite-score');
    const sessionsList = document.getElementById('stats-sessions-list');

    rankBadge.textContent = 'Đang tính hạng...';
    infoList.innerHTML = '';
    scoreBars.innerHTML = '';
    sessionsList.innerHTML = '<p class="empty-state">Đang tải nhận xét từ giáo viên...</p>';

    try {
        const snap = await getDoc(doc(db, 'students', uid));
        if (!snap.exists()) {
            wrap.classList.add('hidden'); // chưa có hồ sơ học viên (VD: chỉ mới đăng ký tài khoản, chưa được admin khởi tạo)
            return;
        }
        const student = { id: snap.id, ...snap.data() };
        if (!student.scores) student.scores = { testScoreAvg: 0, teacherEvalAvg: 0, bonusPoints: 0, participationPoints: 0 };

        // Thông tin cá nhân
        infoList.innerHTML = STATS_INFO_FIELDS.map((f) => {
            const raw = student[f.key];
            let value;
            if (!raw) value = '<span style="color:var(--text-faint)">Chưa cập nhật</span>';
            else if (f.type === 'date') value = escapeHtml(formatDateVN(raw));
            else value = escapeHtml(String(raw));
            return `<div><dt>${f.label}</dt><dd>${value}</dd></div>`;
        }).join('');

        // Điểm số tổng hợp
        const scores = student.scores;
        const metrics = [
            { label: 'Điểm kiểm tra trung bình', display: `${round1(scores.testScoreAvg)}/100`, barPct: clampPct(scores.testScoreAvg, 100), cls: '' },
            { label: 'Điểm GV đánh giá TB / buổi', display: `${round1(scores.teacherEvalAvg)}/10`, barPct: clampPct((scores.teacherEvalAvg || 0) * 10, 100), cls: 'bar-blue' },
            { label: 'Điểm cộng tích lũy', display: `${scores.bonusPoints || 0} điểm`, barPct: clampPct(scores.bonusPoints, BONUS_BAR_MAX), cls: 'bar-orange' },
            { label: 'Điểm tích cực phát biểu', display: `${scores.participationPoints || 0} điểm`, barPct: clampPct(scores.participationPoints, PARTICIPATION_BAR_MAX), cls: 'bar-orange' },
        ];
        scoreBars.innerHTML = metrics.map((m) => `
            <div class="score-bar-item ${m.cls}">
                <div class="score-bar-label"><span>${m.label}</span><strong>${m.display}</strong></div>
                <div class="score-bar-track"><div class="score-bar-fill" style="width:${m.barPct}%"></div></div>
            </div>
        `).join('');
        compositeEl.textContent = computeCompositeScore(scores);

        // Xếp hạng trong lớp
        if (!student.classId) {
            rankBadge.textContent = '🎯 Chưa xếp lớp';
        } else {
            try {
                const classmatesSnap = await getDocs(query(collection(db, 'students'), where('classId', '==', student.classId)));
                const list = [];
                classmatesSnap.forEach((d) => list.push({ id: d.id, scores: d.data().scores }));
                list.sort((a, b) => computeCompositeScore(b.scores) - computeCompositeScore(a.scores));
                const idx = list.findIndex((x) => x.id === student.id);
                const rank = idx + 1, total = list.length;
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🎯';
                rankBadge.textContent = `${medal} Hạng ${rank}/${total} trong lớp`;
            } catch (e) {
                console.error(e);
                rankBadge.textContent = 'Không xác định được hạng';
            }
        }

        // Nhật ký buổi học do giáo viên đánh giá — nhóm theo ngày
        try {
            const sessSnap = await getDocs(query(collection(db, 'students', student.id, 'sessions'), orderBy('date', 'desc')));
            const sessions = [];
            sessSnap.forEach((d) => sessions.push({ id: d.id, ...d.data() }));
            renderStatsSessionsList(sessions);
        } catch (e) {
            console.error(e);
            sessionsList.innerHTML = '<p class="empty-state">Chưa thể tải nhận xét buổi học.</p>';
        }
    } catch (err) {
        console.error('Lỗi khi tải hồ sơ chi tiết:', err);
        wrap.classList.add('hidden');
    }
}

function renderStatsSessionsList(sessions) {
    const list = document.getElementById('stats-sessions-list');
    if (sessions.length === 0) {
        list.innerHTML = '<p class="empty-state">Chưa có buổi học nào được giáo viên ghi nhận.</p>';
        return;
    }
    // Nhóm theo ngày (ngày 23, 22, 21...) — đồng nhất với lịch sử làm bài & danh sách bài tập
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
 
// Nút quay lại từ trang thống kê
window.goBackFromStats = function() {
    document.getElementById('learning-stats-section').classList.add('hidden');
    document.getElementById('class-selection-section').classList.remove('hidden');
}
// Hàm cập nhật thống kê trên trang chủ
async function loadDashboardStats() {
    const userId = CURRENT_USER_ID || "guest_test_user";
    
    // Các phần tử HTML vừa thêm
    const totalTestsEl = document.getElementById('stat-total-tests');
    const avgScoreEl = document.getElementById('stat-avg-score');
    const totalCorrectEl = document.getElementById('stat-total-correct');
 
    try {
        const q = query(collection(db, "results"), where("userId", "==", userId));
        const querySnapshot = await getDocs(q);
 
        let totalTests = 0;
        let totalScoreSum = 0;
        let totalCorrect = 0;
 
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            totalTests++;
            totalScoreSum += (data.scorePercentage || 0);
            totalCorrect += (data.correctAnswers || 0);
        });
 
        // Cập nhật giao diện
        if (totalTests > 0) {
            totalTestsEl.textContent = totalTests;
            avgScoreEl.textContent = Math.round(totalScoreSum / totalTests) + '%';
            totalCorrectEl.textContent = totalCorrect;
        } else {
            totalTestsEl.textContent = '0';
            avgScoreEl.textContent = '0%';
            totalCorrectEl.textContent = '0';
        }
 
    } catch (error) {
        console.error("Lỗi khi load thống kê trang chủ:", error);
    }
}