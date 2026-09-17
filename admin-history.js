import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
    query, where, orderBy, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

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
const storage = getStorage(app);
let scoreChartInstance = null;
let currentStudentData = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadStudentList();
    
    document.getElementById('btn-load-history').addEventListener('click', async () => {
        const studentId = document.getElementById('student-selector').value;
        if (!studentId) return alert("Vui lòng chọn học sinh!");
        await loadStudentHistory(studentId);
    });
});

async function loadStudentList() {
    const select = document.getElementById('student-selector');
    try {
        const snap = await getDocs(collection(db,"students"));
        snap.forEach(doc => {
            const data = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = `${data.fullName || data.email} (Lớp: ${data.className || 'Chưa xếp'})`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error("Lỗi tải DS học sinh:", error);
    }
}

// 2. Lấy lịch sử làm bài và vẽ biểu đồ
async function loadStudentHistory(studentId) {
    document.getElementById('student-dashboard').classList.remove('hidden');
    document.getElementById('detailed-report-modal').classList.add('hidden');
    
    // Lấy thông tin học sinh
    const stuSnap = await getDoc(doc(db, 'students', studentId));
    currentStudentData = stuSnap.data();

    // Lấy kết quả làm bài
    const q = query(collection(db, "results"), where("userId", "==", studentId));
    const resultsSnap = await getDocs(q);
    
    let submissions = [];
    resultsSnap.forEach(r => submissions.push({ id: r.id, ...r.data() }));
    
    // Sắp xếp thời gian (mới nhất lên trước)
    submissions.sort((a, b) => b.timestamp?.toMillis() - a.timestamp?.toMillis());

    renderSubmissionsList(submissions);
    renderChart(submissions);
}

// 3. Render biểu đồ Chart.js
function renderChart(submissions) {
    const ctx = document.getElementById('scoreChart').getContext('2d');
    if (scoreChartInstance) scoreChartInstance.destroy(); // Hủy chart cũ nếu có

    // Đảo ngược mảng để vẽ từ cũ -> mới
    const chartData = [...submissions].reverse(); 
    
    const labels = chartData.map((sub, index) => {
        if(sub.timestamp && typeof sub.timestamp.toDate === 'function') {
            const d = sub.timestamp.toDate();
            return `${d.getDate()}/${d.getMonth()+1}`;
        }
        return `Bài ${index + 1}`;
    });
    
    const scores = chartData.map(sub => sub.scorePercentage || 0);

    scoreChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Điểm số (%)',
                data: scores,
                borderColor: '#7EA88A', // Matcha primary
                backgroundColor: 'rgba(126, 168, 138, 0.2)',
                borderWidth: 2,
                fill: true,
                tension: 0.3
            }]
        },
        options: { responsive: true, scales: { y: { min: 0, max: 100 } } }
    });
}
// 4. Render danh sách bài nộp bên phải biểu đồ
function renderSubmissionsList(submissions) {
    const container = document.getElementById('submissions-list');
    if (submissions.length === 0) {
        container.innerHTML = '<p>Học sinh này chưa làm bài tập nào.</p>';
        return;
    }

    container.innerHTML = submissions.map(sub => {
        let dateStr = 'Gần đây';
        if (sub.timestamp && typeof sub.timestamp.toDate === 'function') {
            dateStr = sub.timestamp.toDate().toLocaleString('vi-VN');
        }
        const colorClass = sub.scorePercentage >= 50 ? 'text-green' : 'text-red';
        
        return `
        <div class="submission-card" onclick="openDetailedReport('${sub.id}', '${sub.exerciseId}')">
            <div style="display:flex; justify-content: space-between; align-items: center;">
                <div>
                    <h4 style="margin:0;">Mã bài: ${sub.exerciseId}</h4>
                    <p style="margin:5px 0 0; font-size:12px; color:var(--text-muted);">${dateStr}</p>
                </div>
                <strong class="${colorClass}" style="font-size: 18px;">${sub.scorePercentage}%</strong>
            </div>
            <div style="font-size: 12px; margin-top: 8px;">Đúng: ${sub.correctAnswers} | Sai: ${sub.mistakes}</div>
        </div>`;
    }).join('');
}

// 5. Nạp dữ liệu chi tiết bài làm để chuẩn bị xuất PDF
window.openDetailedReport = async function(resultId, exerciseId) {
    try {
        // Lấy chi tiết Result & Exercise
        const resSnap = await getDoc(doc(db, 'results', resultId));
        const exSnap = await getDoc(doc(db, 'exercises', exerciseId));
        
        if (!resSnap.exists() || !exSnap.exists()) return alert("Dữ liệu bài tập không tồn tại!");
        
        const result = resSnap.data();
        const exercise = exSnap.data();
        const studentAnswers = result.studentAnswers || {};

        // Đổ dữ liệu Header
        document.getElementById('pdf-avatar').src = currentStudentData?.photoUrl || 'https://via.placeholder.com/80';
        document.getElementById('pdf-student-name').textContent = currentStudentData?.fullName || 'Học viên';
        document.getElementById('pdf-class-name').textContent = currentStudentData?.className || '--';
        document.getElementById('pdf-exercise-title').textContent = exercise.title || 'Bài tập';
        document.getElementById('pdf-score').textContent = `${result.scorePercentage}%`;
        document.getElementById('pdf-correct').textContent = result.correctAnswers;
        document.getElementById('pdf-mistakes').textContent = result.mistakes;
        
        let dateStr = '';
        if (result.timestamp && typeof result.timestamp.toDate === 'function') {
            dateStr = result.timestamp.toDate().toLocaleString('vi-VN');
        }
        document.getElementById('pdf-date').textContent = dateStr;

        // Xử lý từng câu hỏi
        let htmlDetails = '';
        (exercise.questions || []).forEach((q, index) => {
            const studentAns = studentAnswers[q.id] || '(Bỏ trống)';
            // Logic so sánh đáp án y hệt như bên học sinh
            const isCorrect = (studentAns.toLowerCase() === q.correct.toLowerCase() || studentAns === q.correct);

            htmlDetails += `
                <div class="pdf-q-item ${isCorrect ? 'correct' : 'incorrect'}">
                    <div class="pdf-q-text">Câu ${index + 1}: ${q.text}</div>
                    ${q.imageUrl ? `<img src="${q.imageUrl}" style="max-height:100px; margin-bottom:10px; border-radius:5px;">` : ''}
                    
                    <div class="pdf-ans-row">
                        <span class="pdf-ans-label">Đáp án của em:</span>
                        <strong class="${isCorrect ? 'text-green' : 'text-red'}">${studentAns}</strong>
                    </div>
                    
                    ${!isCorrect ? `
                    <div class="pdf-ans-row">
                        <span class="pdf-ans-label">Đáp án đúng:</span>
                        <strong class="text-green">${q.correct}</strong>
                    </div>
                    ` : ''}
                    
                    ${q.explanation ? `
                    <div class="pdf-explanation">
                        💡 <strong>Giải thích:</strong> ${q.explanation}
                    </div>
                    ` : ''}
                </div>
            `;
        });

        document.getElementById('pdf-questions-container').innerHTML = htmlDetails;
        
        // Reset ô nhập nhận xét và hiện vùng xuất PDF
        document.getElementById('teacher-comment-input').value = '';
        document.getElementById('detailed-report-modal').classList.remove('hidden');
        
        // Cuộn xuống khu vực chi tiết
        document.getElementById('detailed-report-modal').scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        console.error(error);
        alert("Có lỗi khi tải chi tiết bài làm.");
    }
}

window.closeReport = function() {
    document.getElementById('detailed-report-modal').classList.add('hidden');
}

// 6. Logic Xuất PDF bằng html2pdf
window.exportToPDF = function() {
    // Lấy nội dung nhận xét giáo viên vừa gõ chuyển sang dạng text thuần để in đẹp hơn
    const inputArea = document.getElementById('teacher-comment-input');
    const displayArea = document.getElementById('teacher-comment-display');
    
    if(inputArea.value.trim() !== "") {
        displayArea.textContent = inputArea.value;
        displayArea.classList.remove('hidden');
        inputArea.classList.add('hidden');
    } else {
        displayArea.classList.add('hidden');
        inputArea.classList.add('hidden');
    }

    const element = document.getElementById('printable-area');
    const studentName = document.getElementById('pdf-student-name').textContent;
    const fileName = `Ket_Qua_${studentName.replace(/\s+/g, '_')}.pdf`;

    const opt = {
        margin:       0.3,
        filename:     fileName,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true }, // useCORS để tải được ảnh avatar external
        jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
    };

    // Tiến hành xuất
    html2pdf().set(opt).from(element).save().then(() => {
        // Phục hồi lại Textarea sau khi xuất xong để có thể sửa
        inputArea.classList.remove('hidden');
        displayArea.classList.add('hidden');
    });
}