console.log("JS connected successfully");
// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';


// Convert email into username
function getUsernameFromEmail(email) {
  if (!email) return "User";

  let name = email.split("@")[0];   // rahulkapoor@gmail.com -> rahulkapoor

  // make first letter capital
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Firebase project configuration (provided by user)
const firebaseConfig = {
  apiKey: "AIzaSyC58_1JqtlImwei3ayx_prLh6JhiXDLbqs",
  authDomain: "nirnay-2dd04.firebaseapp.com",
  projectId: "nirnay-2dd04",
  storageBucket: "nirnay-2dd04.firebasestorage.app",
  messagingSenderId: "71639177217",
  appId: "1:71639177217:web:3419e2ed8350d53a678800"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// Helper to display errors in UI
function displayError(elementId, message) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message || '';
}

// Save user data to Firestore with duplicate protection
async function saveUserToFirestore(user, extra) {
  const userRef = doc(db, 'users', user.uid);
  const userSnapshot = await getDoc(userRef);

  const baseData = {
    uid: user.uid,
    email: user.email || '',
    provider: extra.provider || 'email',
    createdAt: serverTimestamp()
  };

  const combinedData = {
    ...baseData,
    firstName: extra.firstName || '',
    lastName: extra.lastName || '',
    company: extra.company || '',
    name: extra.name || ''
  };

  if (!userSnapshot.exists()) {
    await setDoc(userRef, combinedData);
  } else {
    // keep existing user details intact; update weak fields if empty
    await setDoc(userRef, {
      ...userSnapshot.data(),
      ...combinedData
    }, { merge: true });
  }
}

// Google Sign-In flow for both login and signup
async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    await saveUserToFirestore(user, {
      provider: 'google',
      name: user.displayName || '',
      email: user.email || ''
    });

    console.log("Google login successful");
    window.location.href = 'dashboard.html';
  } catch (error) {
    displayError('login-error', error.message);
    displayError('signup-error', error.message);
  }
}

// Email/password sign-in
async function signInWithEmail() {
  displayError('login-error', '');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    displayError('login-error', 'Please enter both email and password.');
    return;
  }

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // take username from email
    let username = user.email.split("@")[0];

    // make first letter capital
    username = username.charAt(0).toUpperCase() + username.slice(1);

    // save in browser
    localStorage.setItem("username", username);
    localStorage.setItem("userEmail", user.email);

    // save user in firestore
    await saveUserToFirestore(user, { provider: 'email' });

    // go to dashboard
    window.location.href = "dashboard.html";

  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      displayError('login-error', 'No user found with this email. Please sign up first.');
    } else {
      displayError('login-error', error.message);
    }
  }
}

// Email/password sign-up
async function signUpWithEmail() {
  displayError('signup-error', '');
  const firstName = document.getElementById('signup-first-name').value.trim();
  const lastName = document.getElementById('signup-last-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const company = document.getElementById('signup-company').value.trim();
  const password = document.getElementById('signup-password').value;

  if (!firstName || !lastName || !email || !company || !password) {
    displayError('signup-error', 'Please complete all fields.');
    return;
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // take username from email
    let username = user.email.split("@")[0];

    // make first letter capital
    username = username.charAt(0).toUpperCase() + username.slice(1);

    // save in browser
    localStorage.setItem("username", username);
    localStorage.setItem("userEmail", user.email);

    // save extra user details in firestore
    await saveUserToFirestore(user, {
      provider: 'email',
      firstName,
      lastName,
      company
    });

    // go to dashboard
    window.location.href = 'dashboard.html';

  } catch (error) {
    displayError('signup-error', error.message);
  }
}

// Event bindings for login and signup pages
window.addEventListener('DOMContentLoaded', () => {
  const googleLoginBtn = document.getElementById('google-login-btn');
  if (googleLoginBtn) googleLoginBtn.addEventListener('click', signInWithGoogle);

  const googleSignupBtn = document.getElementById('google-signup-btn');
  if (googleSignupBtn) googleSignupBtn.addEventListener('click', signInWithGoogle);

  const loginSubmit = document.getElementById('login-submit');
  if (loginSubmit) loginSubmit.addEventListener('click', (event) => {
    event.preventDefault();
    signInWithEmail();
  });

  const signupSubmit = document.getElementById('signup-submit');
  if (signupSubmit) signupSubmit.addEventListener('click', (event) => {
    event.preventDefault();
    signUpWithEmail();
  });
});

document.addEventListener("DOMContentLoaded", () => {

  const username = localStorage.getItem("username");
  const email = localStorage.getItem("userEmail");

  const nameBox = document.getElementById("sidebar-username");
  const emailBox = document.getElementById("sidebar-useremail");

  if (nameBox && username) nameBox.textContent = username;
  if (emailBox && email) emailBox.textContent = email;

});