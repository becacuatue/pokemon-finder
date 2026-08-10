// Import Firebase SDK (ES Module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ==============================================
// 1. CẤU HÌNH FIREBASE (Điền config của bạn vào đây)
// ==============================================
const firebaseConfig = {
  apiKey: "AIzaSyCCfo_YmY770dFXA13Z7RS-xk1Satm-FEY",
  authDomain: "dtedu-1ca9f.firebaseapp.com",
  projectId: "dtedu-1ca9f",
  storageBucket: "dtedu-1ca9f.firebasestorage.app",
  messagingSenderId: "809872251862",
  appId: "1:809872251862:web:6a88b5938e5bcdb6f22277",
  measurementId: "G-N6RZ88L6QQ"
};

// Khởi tạo Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

document.addEventListener('DOMContentLoaded', () => {

    // ==============================================
    // 2. DOM ELEMENTS (Khớp 100% với HTML của bạn)
    // ==============================================
    const modal = document.getElementById('auth-modal');
    const btnCloseModal = document.querySelector('.close-modal');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    
    const loginError = document.getElementById('login-error');
    const regError = document.getElementById('reg-error');

    // ==============================================
    // 3. LOGIC BẬT / TẮT / CHUYỂN TAB MODAL
    // ==============================================
    
    // Hàm mở Modal (gán vào window để HTML gọi onclick="openAuthModal('login')" không bị lỗi module)
    window.openAuthModal = function(tab = 'login') {
        if (!modal) return;
        modal.classList.remove('hidden');
        switchTab(tab);
    };

    // Hàm đóng Modal
    function closeModal() {
        if (!modal) return;
        modal.classList.add('hidden');
        clearErrors();
    }

    // Hàm chuyển Tab Đăng nhập / Đăng ký
    function switchTab(tab) {
        clearErrors();
        if (tab === 'login') {
            tabLogin.classList.add('active');
            tabRegister.classList.remove('active');
            loginForm.classList.remove('hidden');
            registerForm.classList.add('hidden');
        } else {
            tabRegister.classList.add('active');
            tabLogin.classList.remove('active');
            registerForm.classList.remove('hidden');
            loginForm.classList.add('hidden');
        }
    }

    function clearErrors() {
        if (loginError) loginError.innerText = '';
        if (regError) regError.innerText = '';
    }

    // Sự kiện chuyển tab
    if (tabLogin) tabLogin.addEventListener('click', () => switchTab('login'));
    if (tabRegister) tabRegister.addEventListener('click', () => switchTab('register'));

    // Đóng modal khi bấm nút X hoặc bấm ngoài vùng Modal
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
    window.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // ==============================================
    // 4. XỬ LÝ ĐĂNG NHẬP
    // ==============================================
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearErrors();

            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;
            const submitBtn = loginForm.querySelector('button[type="submit"]');

            try {
                submitBtn.innerText = "Đang đăng nhập...";
                submitBtn.disabled = true;

                // Xử lý Auth với Firebase
                await signInWithEmailAndPassword(auth, email, password);
                
                closeModal();
                window.location.href = "classroom.html"; // Đăng nhập thành công -> Chuyển sang lớp học

            } catch (error) {
                console.error("Lỗi đăng nhập:", error);
                loginError.innerText = getErrorMessage(error.code);
            } finally {
                submitBtn.innerText = "Đăng nhập vào lớp";
                submitBtn.disabled = false;
            }
        });
    }

    // ==============================================
    // 5. XỬ LÝ ĐĂNG KÝ
    // ==============================================
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearErrors();

            const name = document.getElementById('reg-name').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const password = document.getElementById('reg-password').value;
            const submitBtn = registerForm.querySelector('button[type="submit"]');

            try {
                submitBtn.innerText = "Đang tạo tài khoản...";
                submitBtn.disabled = true;

                // 1. Tạo User Auth trên Firebase
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // 2. Tự động khởi tạo thông tin học viên trong Firestore DB để bên Admin nhìn thấy
                // Khớp cấu trúc STUDENT_FIELDS và các chỉ số điểm/thông tin quản lý
                await setDoc(doc(db, "students", user.uid), {
                    uid: user.uid,
                    linkedAuthUid: user.uid, // Tự động liên kết UID để đồng bộ điểm kiểm tra sau này
                    fullName: name,
                    email: email,
                    dob: "",
                    gender: "",
                    phone: "",
                    parentPhone: "",
                    address: "",
                    notes: "Tự động đăng ký từ hệ thống",
                    classId: "", // Chưa xếp lớp cụ thể
                    className: "Chưa phân lớp",
                    studentCode: String(Math.floor(100000 + Math.random() * 900000)), // Tạo mã học viên 6 số ngẫu nhiên
                    photoUrl: "",
                    scores: {
                        testScoreAvg: 0,
                        teacherEvalAvg: 0,
                        bonusPoints: 0,
                        participationPoints: 0
                    },
                    role: "student",
                    createdAt: new Date().toISOString()
                });

                closeModal();
                window.location.href = "classroom.html"; // Đăng ký xong tự động đăng nhập & chuyển hướng

            } catch (error) {
                console.error("Lỗi đăng ký:", error);
                regError.innerText = getErrorMessage(error.code);
            } finally {
                submitBtn.innerText = "Tạo tài khoản";
                submitBtn.disabled = false;
            }
        });
    }
    // ==============================================
    // 6. GIỮ TRẠNG THÁI ĐĂNG NHẬP
    // ==============================================
    onAuthStateChanged(auth, (user) => {
        const loginNavBtn = document.querySelector('.login-link');
        if (user && loginNavBtn) {
            loginNavBtn.innerText = "Vào lớp học";
            loginNavBtn.removeAttribute('onclick');
            loginNavBtn.href = "classroom.html";
        }
    });

    // Vietsub thông báo lỗi Firebase
    function getErrorMessage(code) {
        switch (code) {
            case 'auth/email-already-in-use':
                return 'Email này đã được đăng ký!';
            case 'auth/invalid-email':
                return 'Email không hợp lệ!';
            case 'auth/weak-password':
                return 'Mật khẩu phải từ 6 ký tự trở lên!';
            case 'auth/user-not-found':
            case 'auth/wrong-password':
            case 'auth/invalid-credential':
                return 'Sai email hoặc mật khẩu!';
            default:
                return 'Đã có lỗi xảy ra. Vui lòng thử lại!';
        }
    }
});