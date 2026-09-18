
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
    setDoc ,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
const firebaseConfig = {
  apiKey: "AIzaSyCCfo_YmY770dFXA13Z7RS-xk1Satm-FEY",
  authDomain: "dtedu-1ca9f.firebaseapp.com",
  projectId: "dtedu-1ca9f",
  storageBucket: "dtedu-1ca9f.firebasestorage.app",
  messagingSenderId: "809872251862",
  appId: "1:809872251862:web:6a88b5938e5bcdb6f22277",
  measurementId: "G-N6RZ88L6QQ"
};


const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('auth-modal');
    const btnCloseModal = document.querySelector('.close-modal');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    
    const loginError = document.getElementById('login-error');
    const regError = document.getElementById('reg-error');


    window.openAuthModal = function(tab = 'login') {
        if (!modal) return;
        modal.classList.remove('hidden');
        switchTab(tab);
    };

    function closeModal() {
        if (!modal) return;
        modal.classList.add('hidden');
        clearErrors();
    }

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

    if (tabLogin) tabLogin.addEventListener('click', () => switchTab('login'));
    if (tabRegister) tabRegister.addEventListener('click', () => switchTab('register'));
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
    window.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

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

              
                await signInWithEmailAndPassword(auth, email, password);
                
                closeModal();
                window.location.href = "classroom.html"; 

            } catch (error) {
                console.error("Lỗi đăng nhập:", error);
                loginError.innerText = getErrorMessage(error.code);
            } finally {
                submitBtn.innerText = "Đăng nhập vào lớp";
                submitBtn.disabled = false;
            }
        });
    }
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

                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                await setDoc(doc(db, "students", user.uid), {
                    uid: user.uid,
                    linkedAuthUid: user.uid, 
                    fullName: name,
                    email: email,
                    dob: "",
                    gender: "",
                    phone: "",
                    parentPhone: "",
                    address: "",
                    notes: "Tự động đăng ký từ hệ thống",
                    classId: "", 
                    className: "Chưa phân lớp",
                    studentCode: String(Math.floor(100000 + Math.random() * 900000)), 
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
                window.location.href = "classroom.html"; 

            } catch (error) {
                console.error("Lỗi đăng ký:", error);
                regError.innerText = getErrorMessage(error.code);
            } finally {
                submitBtn.innerText = "Tạo tài khoản";
                submitBtn.disabled = false;
            }
        });
    }
    onAuthStateChanged(auth, (user) => {
        const loginNavBtn = document.querySelector('.login-link');
        const testButton = document.getElementById('testTrail');
        const userChip = document.getElementById('nav-user-chip');
        if (user && loginNavBtn && testButton) {
            loginNavBtn.innerText = "Vào lớp học";
            loginNavBtn.removeAttribute('onclick');
            loginNavBtn.href = "classroom.html";
            testButton.classList.add('hiddens');
            testButton.classList.remove('btn');
        }else{
            userChip.classList.remove('nav-user-chip');
            userChip.classList.add('hiddens');
            
        }
    });

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
document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, async (user) => {
        const snap = await getDoc(doc(db, 'students', user.uid));
        if (!snap.exists()) {
            showView('profile-missing-section');
            return;
        }
        const student = { id: snap.id, ...snap.data() };
        if (!student.scores) student.scores = { testScoreAvg: 0, teacherEvalAvg: 0, bonusPoints: 0, participationPoints: 0 };
        renderStudentInfo(student);
    });

});
function getInitials(text) {
    if (!text) return '?';
    const clean = text.trim();
    if (clean.includes('@')) return clean.charAt(0).toUpperCase();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
function renderStudentInfo(student) {
    const nameEl = document.getElementById('student-name');
    const avatarEl = document.getElementById('student-avatar');
    const navChip = document.getElementById('nav-user-chip');
    const navAvatar = document.getElementById('nav-avatar-sm');
    const navName = document.getElementById('nav-user-name');
    const dropdownName = document.getElementById('dropdown-name');
    const dropdownEmail = document.getElementById('dropdown-email');
    const dropdownUid = document.getElementById('dropdown-uid');
    const dropdownAvatar = document.getElementById('dropdown-avatar');
    const displayName = student ? (student.fullName || student.email || 'Học viên') : 'Khách';
    const initials = student ? getInitials(student.fullName ||student.email) : '🎓';
    console.log(student.fullName)
    if (nameEl) nameEl.textContent = displayName;
    if (avatarEl && student) avatarEl.textContent = initials;
 
    if (navChip && navName && navAvatar) {
        if (student) {
            navChip.classList.remove('hidden');
            navAvatar.textContent = initials;
            navName.textContent = displayName;
            if (dropdownName) dropdownName.textContent = displayName;
            if (dropdownEmail) dropdownEmail.textContent = student.email || 'Không có email';
            if (dropdownUid) dropdownUid.textContent = student.uid;
            if (dropdownAvatar) dropdownAvatar.textContent = initials;
        } else {
            navChip.classList.add('hidden');
        }
    }
}
