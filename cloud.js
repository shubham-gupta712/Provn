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
    if (typeof p.sexAt === 'number') clean.sexAt = Math.round(p.sexAt);
    if (Array.isArray(p.interests)) clean.interests = p.interests.slice(0, 20).map(x => String(x).slice(0, 60));
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
  /* Pulse: scored results and general posts, newest first */
  async feed(n = 30) {
    const [r, p] = await Promise.all(['results', 'posts'].map(c => getDocs(query(collection(db, c), orderBy('createdAt', 'desc'), limit(n))).catch(() => ({ docs: [] }))));
    const list = [...r.docs.map(d => ({ id: d.id, col: 'results', ...d.data() })), ...p.docs.map(d => ({ id: d.id, col: 'posts', ...d.data() }))]
      .map(x => ({ ...x, t: tsMs(x.createdAt) })).sort((a, b) => b.t - a.t).slice(0, n);
    if (Cloud.user) await Promise.all(list.map(async x => {
      const kinds = x.col === 'results' ? ['likes', 'legit', 'flags'] : ['likes', 'flags'];
      const got = await Promise.all(kinds.map(k => getDoc(doc(db, x.col, x.id, k, Cloud.user.uid))));
      x.mine = Object.fromEntries(kinds.map((k, i) => [k, got[i].exists()]));
    }));
    return list;
  },
  async savePost(p) {
    const u = Cloud.user, data = { uid: u.uid, name: (p.name || 'Player').slice(0, 40), city: (p.city || '').slice(0, 40), photo: (p.photo || '').slice(0, 400),
      text: (p.text || '').slice(0, 1000), tags: (p.tags || []).slice(0, 20).map(t => String(t).slice(0, 40)), mentions: (p.mentions || []).slice(0, 20).map(m => ({ uid: String(m.uid).slice(0, 64), name: String(m.name).slice(0, 40) })),
      skill: (p.skill || '').slice(0, 60), media: (p.media || []).slice(0, 4), createdAt: serverTimestamp(), likes: 0, comments: 0, flags: 0 };
    return (await addDoc(collection(db, 'posts'), data)).id;
  },
  async people() { const s = await getDocs(query(collection(db, 'users'), limit(500))); return s.docs.map(d => ({ uid: d.id, name: d.data().name || '', city: d.data().city || '', photo: d.data().photo || '' })).filter(x => x.name); },
  /* like / legit / flag: the mark and the counter change together, and the rules check they match */
  async toggle(kind, id, on, col = 'results') {
    const b = writeBatch(db), mark = doc(db, col, id, kind, Cloud.user.uid);
    if (on) b.set(mark, { at: serverTimestamp() }); else b.delete(mark);
    b.update(doc(db, col, id), { [kind]: increment(on ? 1 : -1) });
    return b.commit();
  },
  async comments(id, col = 'results') {
    const s = await getDocs(query(collection(db, col, id, 'comments'), orderBy('at', 'asc'), limit(100)));
    return s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().at) }));
  },
  async addComment(id, text, name, col = 'results') {
    const b = writeBatch(db), c = doc(collection(db, col, id, 'comments'));
    b.set(c, { uid: Cloud.user.uid, name: (name || 'Player').slice(0, 40), text: text.slice(0, 300), at: serverTimestamp() });
    b.update(doc(db, col, id), { comments: increment(1) });
    return b.commit();
  },
  async deletePost(id) { return deleteDoc(doc(db, 'posts', id)); },
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
  /* delete one of my results; its ranking entry goes too (the next-best result is re-ranked on the next sync) */
  async deleteResult(id) {
    const r = await getDoc(doc(db, 'results', id)); if (!r.exists()) return;
    const d = r.data(), bref = doc(db, 'best', d.uid + '__' + skillKey(d.skill)), b = await getDoc(bref);
    if (b.exists() && b.data().result === id) await deleteDoc(bref);
    await deleteDoc(doc(db, 'results', id));
  },

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
  async records(skill) { const s = await getDocs(query(collection(db, 'records'), where('skill', '==', skill), limit(60))); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
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
      const got = await Promise.all(['results', 'posts'].map(c => getDocs(query(collection(db, c), where('flags', '>', 0), limit(100))).then(s => s.docs.map(d => ({ id: d.id, col: c, ...d.data(), t: tsMs(d.data().createdAt) }))).catch(() => [])));
      return got.flat().sort((a, b) => b.flags - a.flags);
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
      if (r.col === 'posts') return deleteDoc(doc(db, 'posts', r.id));
      const bref = doc(db, 'best', r.uid + '__' + skillKey(r.skill)), b = await getDoc(bref);
      if (b.exists() && b.data().result === r.id) await deleteDoc(bref);
      await deleteDoc(doc(db, 'results', r.id));
    },
    async clearFlags(id, col = 'results') {
      const s = await getDocs(collection(db, col, id, 'flags')), b = writeBatch(db);
      s.docs.forEach(d => b.delete(d.ref)); b.update(doc(db, col, id), { flags: 0 });
      return b.commit();
    },
    async comments(id, col) { return Cloud.comments(id, col); },
    async removeComment(rid, cid, col = 'results') {
      const b = writeBatch(db); b.delete(doc(db, col, rid, 'comments', cid)); b.update(doc(db, col, rid), { comments: increment(-1) });
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
    async allRecords() { const s = await getDocs(query(collection(db, 'records'), limit(1000))); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
    saveRecord(r) {
      const id = [r.level, r.region, r.sex, skillKey(r.skill)].join('__').replace(/[^A-Za-z0-9_]/g, '_');
      return setDoc(doc(db, 'records', id), { level: r.level, region: r.region, sex: r.sex, skill: r.skill, v: r.v, holder: r.holder, date: r.date || '', meet: r.meet || '', place: r.place || '', updatedAt: serverTimestamp() });
    },
    deleteRecord(id) { return deleteDoc(doc(db, 'records', id)); },
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
  /* photo or video for a post: Cloudinary picks the type */
  uploadMedia(file, onProgress) {
    return new Promise((res, rej) => {
      const fd = new FormData(); fd.append('file', file); fd.append('upload_preset', CLOUDINARY.preset); fd.append('folder', 'provn/posts');
      const x = new XMLHttpRequest(); x.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloud}/auto/upload`);
      x.upload.onprogress = e => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      x.onload = () => { try { const j = JSON.parse(x.responseText); j.secure_url ? res({ url: j.secure_url, type: j.resource_type === 'video' ? 'video' : 'image', w: j.width || 0, h: j.height || 0 }) : rej(new Error(j.error?.message || 'Upload failed')); } catch (e) { rej(e); } };
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
