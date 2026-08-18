import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, where, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
 
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
    document.getElementById('test-section').classList.add('hidden');
    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
}
 
window.loadExercisesForClass = async function(classId, className) {
    document.getElementById('class-selection-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    document.getElementById('current-class-title').textContent = `Bài tập: ${className}`;
 
    rememberCurrentClass(className); // [THÊM MỚI] ghi nhớ + hiển thị khóa học đang chọn
 
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

        grid.innerHTML = ''; 
        availableExercises.forEach(test => {
            const card = document.createElement('div');
            const isDone = completedExerciseIds.has(test.id); // [THÊM MỚI]
            card.className = 'card' + (isDone ? ' already-done' : '');
            const audioBadge = test.audioUrl ? `<span class="meta-chip meta-chip-audio">🎧 Có bài nghe</span>` : '';
            const doneBadge = isDone ? `<span class="done-badge">✓ Đã hoàn thành</span>` : ''; // [THÊM MỚI]
            card.innerHTML = `
                ${doneBadge}
                <h3>${escapeHtml(test.title || '')}</h3>
                <p class="card-description">${escapeHtml(test.description || 'Không có mô tả')}</p>
                <div class="lesson-meta">
                    <span class="meta-chip">📝 ${test.questions ? test.questions.length : 0} câu</span>
                    <span class="meta-chip">⏱ ${test.timeLimit} phút</span>
                    ${audioBadge}
                </div>
                <button class="btn-primary" id="btn-start-${test.id}">${isDone ? 'Làm lại bài này' : 'Bắt đầu làm bài'}</button>
            `;
            grid.appendChild(card);
            
            // Gắn sự kiện click
            document.getElementById(`btn-start-${test.id}`).addEventListener('click', () => startTest(test.id));
        });
    } catch (error) {
        console.error("Lỗi khi tải bài tập:", error);
        grid.innerHTML = '<p>Lỗi tải dữ liệu. Vui lòng F5 lại trang.</p>';
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
function startTest(testId) {
    currentTestSession = availableExercises.find(t => t.id === testId);
    
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('test-section').classList.remove('hidden');
 
    document.getElementById('current-test-title').textContent = currentTestSession.title;
    startCountdown(currentTestSession.timeLimit); // [THÊM MỚI] đếm ngược thật, tự nộp bài khi hết giờ
    
    // Gắn dữ liệu cột trái: thanh phát audio (nếu bài có phần nghe) + bài đọc / ngữ liệu
    const audioHtml = currentTestSession.audioUrl ? `
        <div class="audio-player-box">
            <p class="audio-player-label">🎧 Bài nghe (Listening)</p>
            <audio controls preload="metadata" src="${currentTestSession.audioUrl}">
                Trình duyệt của bạn không hỗ trợ phát audio. Vui lòng cập nhật trình duyệt để làm bài.
            </audio>
        </div>
    ` : '';

    const passageHtml = currentTestSession.content || `
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
    document.getElementById('learning-stats-section').classList.remove('hidden');
 
    const userIdToQuery = CURRENT_USER_ID || "guest_test_user";
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '<p style="text-align: center; color: #666;">Đang đồng bộ dữ liệu học tập từ hệ thống...</p>';
 
    try {
        // Truy vấn tất cả kết quả của user này trong bảng results
        const q = query(collection(db, "results"), where("userId", "==", userIdToQuery));
        const querySnapshot = await getDocs(q);
 
        let totalTests = 0;
        let totalScoreSum = 0;
        let totalCorrect = 0;
        let historyHtml = '';
 
        if (querySnapshot.empty) {
            historyList.innerHTML = '<p style="text-align: center; color: #666;">Bạn chưa hoàn thành bài tập nào trên hệ thống.</p>';
            document.getElementById('total-tests').textContent = '0';
            document.getElementById('avg-score').textContent = '0%';
            document.getElementById('total-correct').textContent = '0';
            return;
        }
 
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            totalTests++;
            totalScoreSum += (data.scorePercentage || 0);
            totalCorrect += (data.correctAnswers || 0);
 
            // Format ngày tháng từ Firebase Timestamp
            let dateStr = 'Gần đây';
            if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                dateStr = data.timestamp.toDate().toLocaleString('vi-VN');
            }
 
            // Màu sắc điểm số tùy thuộc vào %
            const scoreColorClass = data.scorePercentage >= 50 ? 'text-green' : 'text-red';
 
            historyHtml += `
                <div class="result-item" style="background: #fafafa; display: flex; justify-content: space-between; align-items: center; padding: 15px 20px; border-radius: 10px; border: 1px solid var(--border-color); margin-bottom: 12px;">
                    <div>
                        <h4 style="color: var(--text-dark); margin-bottom: 5px;">Mã bài tập: <span style="font-family: monospace; color: #555;">${data.exerciseId}</span></h4>
                        <p style="font-size: 13px; color: #666;">⏱ Thời gian nộp: ${dateStr}</p>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 20px; font-weight: 700;" class="${scoreColorClass}">
                            ${data.scorePercentage}%
                        </div>
                        <p style="font-size: 13px; color: #666;">Đúng: ${data.correctAnswers} | Sai: ${data.mistakes}</p>
                    </div>
                </div>
            `;
        });
 
        // Tính điểm trung bình
        const avgScore = Math.round(totalScoreSum / totalTests);
 
        // Đẩy số liệu thống kê lên giao diện
        document.getElementById('total-tests').textContent = totalTests;
        document.getElementById('avg-score').textContent = avgScore + '%';
        document.getElementById('total-correct').textContent = totalCorrect;
        historyList.innerHTML = historyHtml;
 
    } catch (error) {
        console.error("Lỗi khi tải thống kê học tập:", error);
        historyList.innerHTML = '<p style="color: red; text-align: center;">Không thể tải dữ liệu thống kê. Vui lòng kiểm tra lại kết nối.</p>';
    }
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