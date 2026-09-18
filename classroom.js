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

let completedExerciseIds = new Set();

let countdownIntervalId = null;
const SCORE_WEIGHTS = { test: 0.5, teacherEval: 0.3 };
function computeCompositeScore(scores = {}) {
    const test = scores?.testScoreAvg || 0;
    const teacher = scores?.teacherEvalAvg || 0;
    const bonus = scores?.bonusPoints || 0;
    const participation = scores?.participationPoints || 0;
    return Math.round(test * SCORE_WEIGHTS.test + teacher * 10 * SCORE_WEIGHTS.teacherEval + bonus + participation);
}
function escapeHtml(str = '') {
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

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
 
const LAST_CLASS_STORAGE_KEY = 'dtedu_current_class_name';

async function loadClassesList() {
    const classContainer = document.getElementById('classes-grid');
    try {
        const querySnapshot = await getDocs(collection(db, "classes"));

        if (querySnapshot.empty) {
            classContainer.innerHTML = '<p>Chưa có lớp học nào. Vui lòng quay lại sau.</p>';
            return;
        }

        let classes = [];
        querySnapshot.forEach((docSnap) => {
            classes.push({ id: docSnap.id, ...docSnap.data() });
        });

        if (!CURRENT_USER_ID) {
            classes = classes.filter((classData) => {
                const className = (classData.name || '').toLowerCase();
                
                const isTrialClass = className.includes('học thử');
                
                const isGuestVisible = classData.isGuestVisible === true; 
                
                return isTrialClass || isGuestVisible;
            });
        }else{
            classContainer.classList.add('hidden');
        }
        // ==========================================

        classes.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));

        classContainer.innerHTML = '';
        
        if (classes.length === 0) {
            classContainer.innerHTML = '<p>Hiện tại chưa có lớp học thử nào. Vui lòng đăng nhập hoặc quay lại sau.</p>';
            return;
        }

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


function getInitials(text) {
    if (!text) return '?';
    const clean = text.trim();
    if (clean.includes('@')) return clean.charAt(0).toUpperCase();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
 
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
   
    localStorage.removeItem('dtedu_current_class_name'); 
    
    signOut(auth).then(() => {
       
        window.location.href = 'index.html'; 
    }).catch((error) => {
        console.error("Lỗi đăng xuất:", error);
        alert("Có lỗi xảy ra khi đăng xuất. Vui lòng thử lại!");
    });
};
document.addEventListener('click', (e) => {
    const chip = document.getElementById('nav-user-chip');
    const dropdown = document.getElementById('user-info-dropdown');
    if (chip && dropdown && !chip.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});
function setCurrentClassDisplay(className) {
    const el = document.getElementById('student-current-class');
    if (el) el.textContent = className || 'Chưa chọn khóa học';
}
 
function rememberCurrentClass(className) {
    try {
        localStorage.setItem(LAST_CLASS_STORAGE_KEY, className);
    } catch (e) {}
    setCurrentClassDisplay(className);
}
 
function loadRememberedClass() {
    try {
        const saved = localStorage.getItem(LAST_CLASS_STORAGE_KEY);
        if (saved) setCurrentClassDisplay(saved);
    } catch (e) {  }
}

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
let myClassInfo = null; 

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

        
        const exSnap = await getDocs(query(collection(db, 'exercises'), where('targetClass', '==', student.classId)));
        const classExerciseIds = [];
        exSnap.forEach((d) => classExerciseIds.push(d.id));
        const totalInClass = classExerciseIds.length;
        const doneInClass = classExerciseIds.filter((id) => completedExerciseIds.has(id)).length;
        const progressPct = totalInClass > 0 ? Math.round((doneInClass / totalInClass) * 100) : 0;

        
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

 

document.addEventListener('DOMContentLoaded', () => {
    loadRememberedClass(); 
    
    

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            CURRENT_USER_ID = user.uid;
        } else {
            console.log("Đang test chế độ chưa đăng nhập...");
        }
        await loadClassesList();
        loadMyClassSummary();
        renderStudentInfo(user);
        await loadCompletedExerciseIds(); 
        loadDashboardStats();
        
    });

    
    const quizForm = document.getElementById('quiz-form');
    if (quizForm) {
        quizForm.addEventListener('submit', (e) => {
            e.preventDefault(); 
            evaluateAndSaveTest();
        });
    }
});
 

window.goBackToClasses = function() {
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('class-selection-section').classList.remove('hidden');
}
 
window.goBackToDashboard = function() {
    stopCountdown(); 
    if ('speechSynthesis' in window) window.speechSynthesis.cancel(); 
    document.getElementById('test-section').classList.add('hidden');
    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('lesson-vocab-warmup-section')?.classList.add('hidden'); 
    document.getElementById('dashboard-section').classList.remove('hidden');
}
 
window.loadExercisesForClass = async function(classId, className) {
    document.getElementById('class-selection-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    document.getElementById('current-class-title').textContent = `Bài tập: ${className}`;
 
    rememberCurrentClass(className);

    loadClassTeacherCard(classId); 
 
    const grid = document.getElementById('lesson-grid');
    grid.innerHTML = '<p>Đang tải dữ liệu bài tập...</p>';
 
    try {
        const q = query(collection(db, "exercises"), where("targetClass", "==", classId));
        const querySnapshot = await getDocs(q);
        
        availableExercises = [];
        querySnapshot.forEach((doc) => {
            availableExercises.push({ id: doc.id, ...doc.data() });
        });

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
        const dayGroups = groupByDay(availableExercises, (t) => (t.createdAt?.toDate ? t.createdAt.toDate() : null));

        dayGroups.forEach((group) => {
            const groupWrap = document.createElement('div');
            groupWrap.className = 'day-group';
            groupWrap.innerHTML = `<h4 class="day-group-header">📅 Ngày ${escapeHtml(group.label)}</h4>`;

            const subGrid = document.createElement('div');
            subGrid.className = 'grid day-group-grid';

            group.items.forEach((test) => {
                const card = document.createElement('div');
                const isDone = completedExerciseIds.has(test.id); // 
                card.className = 'card' + (isDone ? ' already-done' : '');
                const audioBadge = test.audioUrl ? `<span class="meta-chip meta-chip-audio">🎧 Có bài nghe</span>` : '';
                const doneBadge = isDone ? `<span class="done-badge">✓ Đã hoàn thành</span>` : ''; 
                const vocabBadge = (test.vocabWarmup && test.vocabWarmup.length) ? `<span class="meta-chip">🔤 Khởi động từ vựng</span>` : ''; 
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

async function loadClassTeacherCard(classId) {
    const nameEl = document.getElementById('class-teacher-name');
    const titleEl = document.getElementById('class-teacher-title');
    const bioEl = document.getElementById('class-teacher-bio');
    const photoEl = document.getElementById('class-teacher-photo');
    const fallbackEl = document.getElementById('class-teacher-avatar-fallback');
    if (!nameEl) return;

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
 
function stopCountdown() {
    if (countdownIntervalId) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
    }
    document.getElementById('timer-box')?.classList.remove('timer-warning');
}

function startCountdown(minutes) {
    stopCountdown(); 

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

function startTest(testId) {
    const test = availableExercises.find(t => t.id === testId);
    if (!test) return;
    currentTestSession = test;

    if (maybeStartVocabWarmup(test)) return; 
    proceedToRealTest(testId);
}

function proceedToRealTest(testId) {
    currentTestSession = availableExercises.find(t => t.id === testId) || currentTestSession;
    
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('test-section').classList.remove('hidden');
 
    document.getElementById('current-test-title').textContent = currentTestSession.title;
    startCountdown(currentTestSession.timeLimit); 
    
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
 
    const qContainer = document.getElementById('questions-container');
    qContainer.innerHTML = '';
 
    (currentTestSession.questions || []).forEach((q, index) => {
        const block = document.createElement('div');
        block.className = 'question-block';
        
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
        msg.lang = 'en-GB';
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
let isSubmittingTest = false;

async function evaluateAndSaveTest() {
    if (isSubmittingTest) return;
    isSubmittingTest = true;
    stopCountdown();
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
                ${buildExplanationBoxHtml(q.explanation)}
            </div>
        `;
    });
 
    const percent = Math.round((correctCount / currentTestSession.questions.length) * 100);
    
    const userIdToSave = CURRENT_USER_ID || "guest_test_user";
 
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
    }
 
    submitBtn.textContent = originalBtnText;
    submitBtn.disabled = false;
    isSubmittingTest = false; 

    // Hiển thị giao diện kết quả
    document.getElementById('score-display').textContent = `${percent}%`;
    document.getElementById('mistake-count').textContent = mistakes;
    document.getElementById('detailed-results').innerHTML = htmlDetails;

    renderResultReadingPassage();

    const ringEl = document.getElementById('score-ring');
    if (ringEl) ringEl.style.setProperty('--pct', percent);

    completedExerciseIds.add(currentTestSession.id);
    loadMyClassSummary();

    document.getElementById('test-section').classList.add('hidden');
    document.getElementById('result-section').classList.remove('hidden');
    document.getElementById('quiz-form').reset();
    window.scrollTo(0,0);
}


function normalizeExplanation(explanation) {
    if (!explanation) return { quote: '', explanationVi: '' };
    if (typeof explanation === 'string') return { quote: '', explanationVi: explanation };
    return {
        quote: (explanation.quote || '').trim(),
        explanationVi: (explanation.explanationVi || '').trim(),
    };
}

function buildExplanationBoxHtml(explanationRaw) {
    const { quote, explanationVi } = normalizeExplanation(explanationRaw);
    if (!quote && !explanationVi) return '';

    const quoteHtml = quote ? `<p class="explanation-quote"> "${escapeHtml(quote)}"</p>` : '';
    const textHtml = explanationVi ? `<p class="explanation-text"> <strong>Giải thích:</strong> ${escapeHtml(explanationVi)}</p>` : '';
    const hintText = quote ? 'Bấm để xem trong bài đọc & nghe đọc giải thích' : 'Bấm để nghe đọc giải thích';

    return `
        <div class="explanation-box is-clickable" data-quote="${escapeHtml(quote)}" data-explanation-vi="${escapeHtml(explanationVi)}">
            ${quoteHtml}
            ${textHtml}
            <p class="explanation-hint">${hintText}</p>
        </div>
    `;
}

function speakExplanation(quote, explanationVi) {
    if (!('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel(); 
        if (quote && quote.trim()) {
            const uQuote = new SpeechSynthesisUtterance(quote.trim());
            uQuote.lang = 'en-GB';
            uQuote.rate = 1.1;
            window.speechSynthesis.speak(uQuote);
        }
        if (explanationVi && explanationVi.trim()) {
            const uExp = new SpeechSynthesisUtterance(explanationVi.trim());
            uExp.lang = 'vi-VN';
            uExp.rate = 1.5;
            window.speechSynthesis.speak(uExp);
        }
    } catch (e) {
        console.error('Lỗi đọc giải thích (Web Speech API):', e);
    }
}
let resultPassageRawText = '';

function ensureResultPassageBox() {
    let box = document.getElementById('result-passage-box');
    if (box) return box;
    const detailed = document.getElementById('detailed-results');
    if (!detailed || !detailed.parentElement) return null;
    box = document.createElement('div');
    box.id = 'result-passage-box';
    box.className = 'result-passage-box hidden';
    detailed.parentElement.insertBefore(box, detailed);
    return box;
}

function renderResultReadingPassage() {
    const box = ensureResultPassageBox();
    if (!box) return;
    resultPassageRawText = (currentTestSession && currentTestSession.content) || '';
    if (!resultPassageRawText.trim()) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }
    box.classList.remove('hidden');
    box.innerHTML = `
        <h4 class="result-passage-title">📖 Bài đọc</h4>
        <div id="result-passage-text" class="result-passage-text" style="white-space: pre-line;">${escapeHtml(resultPassageRawText)}</div>
    `;
}

function flashElement(el) {
    el.classList.add('quote-flash');
    setTimeout(() => el.classList.remove('quote-flash'), 1600);
}

function scrollToAndHighlightQuote(quote) {
    const textEl = document.getElementById('result-passage-text');
    const cleanQuote = (quote || '').trim();
    if (!textEl || !cleanQuote) return;

    const rawText = resultPassageRawText;
    let start = rawText.toLowerCase().indexOf(cleanQuote.toLowerCase());
    let matchLen = cleanQuote.length;

    if (start === -1) {
        const collapse = (s) => s.replace(/\s+/g, ' ').toLowerCase();
        const collapsedIdx = collapse(rawText).indexOf(collapse(cleanQuote));
        if (collapsedIdx === -1) {
            textEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            flashElement(textEl);
            return;
        }
        start = collapsedIdx;
    }

    const before = rawText.slice(0, start);
    const match = rawText.slice(start, start + matchLen);
    const after = rawText.slice(start + matchLen);
    textEl.innerHTML = `${escapeHtml(before)}<mark id="active-quote-highlight" class="quote-highlight">${escapeHtml(match)}</mark>${escapeHtml(after)}`;

    document.getElementById('active-quote-highlight')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.addEventListener('click', (e) => {
    const box = e.target.closest('.explanation-box.is-clickable');
    if (!box) return;
    const quote = box.dataset.quote || '';
    const explanationVi = box.dataset.explanationVi || '';
    if (quote) scrollToAndHighlightQuote(quote); 
    speakExplanation(quote, explanationVi);
});

window.showLearningStats = async function() {
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

    loadStatsProfileDetail(userIdToQuery); 
 
    try {
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
        const uniqueExerciseIds = [...new Set(resultsRaw.map((r) => r.exerciseId).filter(Boolean))];
        const exerciseMap = {};
        await Promise.all(uniqueExerciseIds.map(async (exId) => {
            try {
                const exSnap = await getDoc(doc(db, 'exercises', exId));
                if (exSnap.exists()) exerciseMap[exId] = { id: exSnap.id, ...exSnap.data() };
            } catch (e) {}
        }));

    
        const dayGroups = groupByDay(resultsRaw, (r) => (r.timestamp?.toDate ? r.timestamp.toDate() : null));
        historyList.innerHTML = dayGroups.map((group) => `
            <div class="day-group">
                <h4 class="day-group-header"> Ngày ${escapeHtml(group.label)}</h4>
                ${group.items.map((r) => renderQuizHistoryItemHtml(r, exerciseMap[r.exerciseId])).join('')}
            </div>
        `).join('');

        
        historyList.querySelectorAll('.quiz-history-summary').forEach((btn) => {
            btn.addEventListener('click', () => btn.closest('.quiz-history-item').classList.toggle('is-open'));
        });
 
        
        const avgScore = Math.round(totalScoreSum / totalTests);
 
        
        document.getElementById('total-tests').textContent = totalTests;
        document.getElementById('avg-score').textContent = avgScore + '%';
        document.getElementById('total-correct').textContent = totalCorrect;
 
    } catch (error) {
        console.error("Lỗi khi tải thống kê học tập:", error);
        historyList.innerHTML = '<p style="color: red; text-align: center;">Không thể tải dữ liệu thống kê. Vui lòng kiểm tra lại kết nối.</p>';
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
                ${buildExplanationBoxHtml(q.explanation)}
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

async function loadStatsProfileDetail(uid) {
    const wrap = document.getElementById('stats-profile-detail');
    if (!wrap) return;

    if (!CURRENT_USER_ID) {
        wrap.classList.add('hidden'); 
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
            wrap.classList.add('hidden'); 
            return;
        }
        const student = { id: snap.id, ...snap.data() };
        if (!student.scores) student.scores = { testScoreAvg: 0, teacherEvalAvg: 0, bonusPoints: 0, participationPoints: 0 };

    
        infoList.innerHTML = STATS_INFO_FIELDS.map((f) => {
            const raw = student[f.key];
            let value;
            if (!raw) value = '<span style="color:var(--text-faint)">Chưa cập nhật</span>';
            else if (f.type === 'date') value = escapeHtml(formatDateVN(raw));
            else value = escapeHtml(String(raw));
            return `<div><dt>${f.label}</dt><dd>${value}</dd></div>`;
        }).join('');

        
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

    const groups = groupByDay(sessions, (s) => (s.date ? new Date(s.date) : null));
    list.innerHTML = groups.map((group) => `
        <div class="day-group">
            <h4 class="day-group-header"> Ngày ${escapeHtml(group.label)}</h4>
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
 
window.goBackFromStats = function() {
    document.getElementById('learning-stats-section').classList.add('hidden');
    document.getElementById('class-selection-section').classList.remove('hidden');
}
async function loadDashboardStats() {
    const userId = CURRENT_USER_ID || "guest_test_user";
    

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