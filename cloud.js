/* Provn cloud: Firebase (provn-96604) sign-in + Firestore, and Cloudinary proof-video uploads.
   If this module fails to load (offline, blocked), the app keeps working on-device. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as fbSignOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, collection, query, where, orderBy, limit, getDocs, serverTimestamp, increment, writeBatch, addDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyD0RInNbKgLZiGDfL20KH9L6RVlYMI806g',
  authDomain: 'provn-96604.firebaseapp.com',
  projectId: 'provn-96604',
  storageBucket: 'provn-96604.firebasestorage.app',
  messagingSenderId: '160948214906',
  appId: '1:160948214906:web:67bfd2cca7bc15f25c2fc3',
  measurementId: 'G-C8FKKRP83C'
};
const CLOUDINARY = { cloud: 'y3geoabc', preset: 'provn_unsigned' };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const skillKey = s => s.replace(/[^A-Za-z0-9]+/g, '_');
const tsMs = t => (t && t.toMillis) ? t.toMillis() : Date.now();

const Cloud = {
  user: null,
  ready: false,
  async signIn() {
    try { await signInWithPopup(auth, provider); }
    catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) return signInWithRedirect(auth, provider);
      throw e;
    }
  },
  signOut: () => fbSignOut(auth),

  async loadProfile() { const s = await getDoc(doc(db, 'users', Cloud.user.uid)); return s.exists() ? s.data() : null; },
  saveProfile(p) {
    if (!Cloud.user) return Promise.resolve();
    const clean = {};
    ['name', 'sex', 'city', 'char', 'theme'].forEach(k => { if (typeof p[k] === 'string') clean[k] = p[k].slice(0, 40); });
    if (typeof p.photo === 'string' && p.photo.startsWith('https://')) clean.photo = p.photo.slice(0, 400);
    if (p.age) clean.age = Math.round(p.age);
    if (typeof p.bw === 'number' && isFinite(p.bw)) clean.bw = p.bw;
    clean.updatedAt = serverTimestamp();
    return setDoc(doc(db, 'users', Cloud.user.uid), clean, { merge: true });
  },

  /* one result; also keeps the player's best per skill for leaderboards */
  async saveResult(r) {
    const u = Cloud.user, data = { uid: u.uid, name: (r.name || 'Player').slice(0, 40), city: (r.city || '').slice(0, 40), skill: r.skill, v: r.v, pts: Math.max(0, Math.min(1400, Math.round(r.pts) || 0)),
      sex: r.sex || '', age: Math.round(r.age || 0), createdAt: serverTimestamp(), likes: 0, legit: 0, flags: 0, comments: 0 };
    if (r.video) data.video = r.video;
    const ref = await addDoc(collection(db, 'results'), data);
    const bref = doc(db, 'best', u.uid + '__' + skillKey(r.skill)), b = await getDoc(bref);
    if (!b.exists() || (b.data().pts || 0) < data.pts) {
      await setDoc(bref, { uid: u.uid, name: data.name, city: data.city, skill: r.skill, v: r.v, pts: data.pts, sex: data.sex, age: data.age, video: r.video || '', result: ref.id, updatedAt: serverTimestamp() });
    }
    return ref.id;
  },
  async myResults() {
    const s = await getDocs(query(collection(db, 'results'), where('uid', '==', Cloud.user.uid), limit(500)));
    return s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().createdAt) })).sort((a, b) => a.t - b.t);
  },
  async feed(n = 30) {
    const s = await getDocs(query(collection(db, 'results'), orderBy('createdAt', 'desc'), limit(n)));
    const list = s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().createdAt) }));
    if (Cloud.user) await Promise.all(list.map(async p => {
      const [l, g, f] = await Promise.all(['likes', 'legit', 'flags'].map(k => getDoc(doc(db, 'results', p.id, k, Cloud.user.uid))));
      p.mine = { likes: l.exists(), legit: g.exists(), flags: f.exists() };
    }));
    return list;
  },
  /* like / legit / flag: the mark and the counter change together, and the rules check they match */
  async toggle(kind, id, on) {
    const b = writeBatch(db), mark = doc(db, 'results', id, kind, Cloud.user.uid);
    if (on) b.set(mark, { at: serverTimestamp() }); else b.delete(mark);
    b.update(doc(db, 'results', id), { [kind]: increment(on ? 1 : -1) });
    return b.commit();
  },
  async comments(id) {
    const s = await getDocs(query(collection(db, 'results', id, 'comments'), orderBy('at', 'asc'), limit(100)));
    return s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().at) }));
  },
  async addComment(id, text, name) {
    const b = writeBatch(db), c = doc(collection(db, 'results', id, 'comments'));
    b.set(c, { uid: Cloud.user.uid, name: (name || 'Player').slice(0, 40), text: text.slice(0, 300), at: serverTimestamp() });
    b.update(doc(db, 'results', id), { comments: increment(1) });
    return b.commit();
  },
  async leaderboard(skill, city) {
    const cons = [where('skill', '==', skill)]; if (city) cons.push(where('city', '==', city));
    const s = await getDocs(query(collection(db, 'best'), ...cons, limit(300)));
    return s.docs.map(d => d.data()).sort((a, b) => b.pts - a.pts);
  },
  async deleteResult(id) { return deleteDoc(doc(db, 'results', id)); },

  /* proof video straight from the phone to Cloudinary (unsigned preset) */
  uploadVideo(file, onProgress) {
    return new Promise((res, rej) => {
      const fd = new FormData(); fd.append('file', file); fd.append('upload_preset', CLOUDINARY.preset); fd.append('folder', 'provn/proof');
      const x = new XMLHttpRequest(); x.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloud}/video/upload`);
      x.upload.onprogress = e => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      x.onload = () => { try { const j = JSON.parse(x.responseText); j.secure_url ? res(j.secure_url) : rej(new Error(j.error?.message || 'Upload failed')); } catch (e) { rej(e); } };
      x.onerror = () => rej(new Error('Network error'));
      x.send(fd);
    });
  },
  thumb: url => url ? url.replace('/upload/', '/upload/so_1,w_640,c_limit/').replace(/\.[a-z0-9]+$/i, '.jpg') : ''
};

getRedirectResult(auth).catch(() => {});
onAuthStateChanged(auth, u => {
  Cloud.user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' } : null;
  Cloud.ready = true;
  window.dispatchEvent(new CustomEvent('cloud-auth', { detail: Cloud.user }));
});
window.Cloud = Cloud;
window.dispatchEvent(new Event('cloud-ready'));
