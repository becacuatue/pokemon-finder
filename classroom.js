import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, getDocs, query, where, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
 
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
        let html = '';
        
        if (querySnapshot.empty) {
            classContainer.innerHTML = '<p>Chưa có lớp học nào.</p>';
            return;
        }

        querySnapshot.forEach((doc) => {
            const classData = doc.data();
            html += `
                <div class="card class-card" onclick="window.loadExercisesForClass('${doc.id}', '${classData.name}')">
                    <h3>${classData.name}</h3>
                    <p>${classData.description || 'Không có mô tả'}</p>
                </div>
            `;
        });
        
        classContainer.innerHTML = html;
    } catch (error) {
        console.error("Lỗi khi tải danh sách lớp:", error);
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
 
    const displayName = user ? (user.displayName || user.email || 'Học viên') : 'Khách';
    const initials = user ? getInitials(user.displayName || user.email) : '🎓';
 
    if (nameEl) nameEl.textContent = displayName;
    if (avatarEl && user) avatarEl.textContent = initials;
 
    if (navChip && navName && navAvatar) {
        if (user) {
            navChip.classList.remove('hidden');
            navAvatar.textContent = initials;
            navName.textContent = displayName;
        } else {
            navChip.classList.add('hidden');
        }
    }
}
 
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
// [HẾT PHẦN THÊM MỚI]
// ============================================================
 
// Gộp chung khởi tạo trang và kiểm tra đăng nhập
document.addEventListener('DOMContentLoaded', () => {
    loadRememberedClass(); 
    
    // Gọi hàm tải danh sách lớp vào đúng ID 'classes-grid'
    loadClassesList();

    onAuthStateChanged(auth, (user) => {
        if (user) {
            CURRENT_USER_ID = user.uid;
        } else {
            console.log("Đang test chế độ chưa đăng nhập...");
        }
        renderStudentInfo(user); 
        loadDashboardStats();
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
 
        if(availableExercises.length === 0) {
            grid.innerHTML = '<p>Chưa có bài tập nào cho khóa học này.</p>';
            return;
        }
 
        grid.innerHTML = ''; 
        availableExercises.forEach(test => {
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <h3>${test.title}</h3>
                <p>${test.description || 'Không có mô tả'}</p>
                <div class="lesson-meta">
                    <span class="meta-chip">📝 ${test.questions ? test.questions.length : 0} câu</span>
                    <span class="meta-chip">⏱ ${test.timeLimit} phút</span>
                </div>
                <button class="btn-primary" id="btn-start-${test.id}">Bắt đầu làm bài</button>
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
 
// Bắt đầu làm bài
function startTest(testId) {
    currentTestSession = availableExercises.find(t => t.id === testId);
    
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('test-section').classList.remove('hidden');
 
    document.getElementById('current-test-title').textContent = currentTestSession.title;
    document.getElementById('timer').textContent = currentTestSession.timeLimit;
    
    // Gắn dữ liệu cột trái (Bài đọc) - Nếu lấy từ content hoặc description
    document.getElementById('test-content').innerHTML = currentTestSession.content || `
        <h2>${currentTestSession.title}</h2>
        <p style="white-space: pre-line;">${currentTestSession.description || 'Đọc kỹ các câu hỏi bên phải và điền đáp án chính xác.'}</p>
    `;
 
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
async function evaluateAndSaveTest() {
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
 
    // Hiển thị giao diện kết quả
    document.getElementById('score-display').textContent = `${percent}%`;
    document.getElementById('mistake-count').textContent = mistakes;
    document.getElementById('detailed-results').innerHTML = htmlDetails;
 
    // [THÊM MỚI] Cập nhật vòng tròn điểm số (score-ring) theo % đạt được
    const ringEl = document.getElementById('score-ring');
    if (ringEl) ringEl.style.setProperty('--pct', percent);
 
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