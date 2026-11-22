/* Provn cloud: Firebase (provn-96604) sign-in + Firestore, and Cloudinary proof-video uploads.
   If this module fails to load (offline, blocked), the app keeps working on-device. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as fbSignOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, collection, query, where, orderBy, limit, getDocs, serverTimestamp, increment, writeBatch, addDoc, deleteDoc, updateDoc, getCountFromServer } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyD0RInNbKgLZiGDfL20KH9L6RVlYMI806g',
  authDomain: 'provn-96604.firebaseapp.com',
  projectId: 'provn-96604',
  storageBucket: 'provn-96604.firebasestorage.app',
  messagingSenderId: '160948214906',
  appId: '1:160948214906:web:67bfd2cca7bc15f25c2fc3',
  measurementId: 'G-C8FKKRP83C'
};
export const ADMIN_EMAIL = 'shubhamgupta1414@gmail.com';
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
    if (r.venue) { data.venue = String(r.venue).slice(0, 40); data.venueName = String(r.venueName || '').slice(0, 60); }
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
  /* every player's best for one skill (filtered into city / state / country on the phone) */
  async rankings(skill) {
    const s = await getDocs(query(collection(db, 'best'), where('skill', '==', skill), limit(1000)));
    return s.docs.map(d => d.data());
  },
  /* best per player for one skill at one Provn venue */
  async venueBoard(skill, venue) {
    const s = await getDocs(query(collection(db, 'results'), where('skill', '==', skill), where('venue', '==', venue), limit(500)));
    const by = {}; s.docs.forEach(d => { const r = d.data(); if (!by[r.uid] || by[r.uid].pts < r.pts) by[r.uid] = r; });
    return Object.values(by).sort((a, b) => b.pts - a.pts);
  },
  async deleteResult(id) { return deleteDoc(doc(db, 'results', id)); },

  /* ---------- events (created by the admin, shown in Arena) ---------- */
  async events() {
    const s = await getDocs(query(collection(db, 'events'), limit(100)));
    const today = new Date().toISOString().slice(0, 10);
    const list = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    await Promise.all(list.map(async e => {
      const [c, m] = await Promise.all([getCountFromServer(collection(db, 'events', e.id, 'going')), getDoc(doc(db, 'events', e.id, 'going', Cloud.user.uid))]);
      e.going = c.data().count; e.mine = m.exists(); e.past = (e.date || '') < today;
    }));
    return list;
  },
  setGoing(id, on, name) { const r = doc(db, 'events', id, 'going', Cloud.user.uid); return on ? setDoc(r, { at: serverTimestamp(), name: (name || 'Player').slice(0, 40) }) : deleteDoc(r); },
  async venues() { const s = await getDocs(query(collection(db, 'venues'), limit(1000))); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
  async config() { const s = await getDoc(doc(db, 'config', 'app')); return s.exists() ? s.data() : {}; },
  async banned() { return (await getDoc(doc(db, 'bans', Cloud.user.uid))).exists(); },

  /* ---------- admin only (the rules enforce this too) ---------- */
  isAdmin() { return !!(Cloud.user && Cloud.user.email === ADMIN_EMAIL && Cloud.user.verified); },
  admin: {
    async stats() {
      const c = q => getCountFromServer(q).then(r => r.data().count).catch(() => '–');
      const [users, results, flagged, events, bans] = await Promise.all([c(collection(db, 'users')), c(collection(db, 'results')),
        c(query(collection(db, 'results'), where('flags', '>', 0))), c(collection(db, 'events')), c(collection(db, 'bans'))]);
      return { users, results, flagged, events, bans };
    },
    async flagged() {
      const s = await getDocs(query(collection(db, 'results'), where('flags', '>', 0), limit(100)));
      return s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().createdAt) })).sort((a, b) => b.flags - a.flags);
    },
    async users() {
      const [u, b] = await Promise.all([getDocs(query(collection(db, 'users'), limit(500))), getDocs(collection(db, 'bans'))]);
      const banned = new Set(b.docs.map(d => d.id));
      return u.docs.map(d => ({ uid: d.id, ...d.data(), t: tsMs(d.data().updatedAt), banned: banned.has(d.id) })).sort((a, b) => b.t - a.t);
    },
    async results(uid) {
      const s = await getDocs(query(collection(db, 'results'), where('uid', '==', uid), limit(500)));
      return s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().createdAt) })).sort((a, b) => b.t - a.t);
    },
    async removeResult(r) {
      const bref = doc(db, 'best', r.uid + '__' + skillKey(r.skill)), b = await getDoc(bref);
      if (b.exists() && b.data().result === r.id) await deleteDoc(bref);
      await deleteDoc(doc(db, 'results', r.id));
    },
    async clearFlags(id) {
      const s = await getDocs(collection(db, 'results', id, 'flags')), b = writeBatch(db);
      s.docs.forEach(d => b.delete(d.ref)); b.update(doc(db, 'results', id), { flags: 0 });
      return b.commit();
    },
    async comments(id) { return Cloud.comments(id); },
    async removeComment(rid, cid) {
      const b = writeBatch(db); b.delete(doc(db, 'results', rid, 'comments', cid)); b.update(doc(db, 'results', rid), { comments: increment(-1) });
      return b.commit();
    },
    ban(uid, on) { const r = doc(db, 'bans', uid); return on ? setDoc(r, { at: serverTimestamp(), by: Cloud.user.email }) : deleteDoc(r); },
    saveEvent(e, id) {
      const data = { title: e.title, skill: e.skill || '', date: e.date, time: e.time || '', place: e.place || '', city: e.city || '', spots: e.spots || 0, info: e.info || '', updatedAt: serverTimestamp() };
      if (typeof e.lat === 'number' && typeof e.lng === 'number') { data.lat = e.lat; data.lng = e.lng; }
      return id ? setDoc(doc(db, 'events', id), data) : addDoc(collection(db, 'events'), data);
    },
    saveVenue(v, id) {
      const data = { name: v.name, kind: v.kind, acts: v.acts.slice(0, 12), addr: v.addr || '', phone: v.phone || '', web: v.web || '', info: v.info || '', lat: v.lat, lng: v.lng, city: v.city || '', updatedAt: serverTimestamp() };
      return id ? setDoc(doc(db, 'venues', id), data) : addDoc(collection(db, 'venues'), data);
    },
    deleteVenue(id) { return deleteDoc(doc(db, 'venues', id)); },
    deleteEvent(id) { return deleteDoc(doc(db, 'events', id)); },
    async going(id) { const s = await getDocs(collection(db, 'events', id, 'going')); return s.docs.map(d => ({ uid: d.id, ...d.data() })); },
    setConfig(c) {
      const d = { updatedAt: serverTimestamp() };
      if ('announce' in c) d.announce = (c.announce || '').slice(0, 280);
      if ('maptiler' in c) d.maptiler = (c.maptiler || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
      return setDoc(doc(db, 'config', 'app'), d, { merge: true });
    }
  },

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
  Cloud.user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '', verified: !!u.emailVerified } : null;
  Cloud.ready = true;
  window.dispatchEvent(new CustomEvent('cloud-auth', { detail: Cloud.user }));
});
window.Cloud = Cloud;
window.dispatchEvent(new Event('cloud-ready'));
