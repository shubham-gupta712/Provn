/* Provn cloud: Firebase (provn-96604) sign-in + Firestore, and Cloudinary proof-video uploads.
   If this module fails to load (offline, blocked), the app keeps working on-device. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as fbSignOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, collection, query, where, orderBy, limit, getDocs, serverTimestamp, increment, writeBatch, addDoc, deleteDoc, updateDoc, getCountFromServer, onSnapshot, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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
const adb = getFirestore(app);   // the real signed-in account (admin tools always use this)
let db = adb;                     // the identity the app is acting as (admin or a test bot)
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const bots = {};
function botApp(id) { if (!bots[id]) { const a = initializeApp(firebaseConfig, 'provn-' + id); bots[id] = { app: a, auth: getAuth(a), db: getFirestore(a) }; } return bots[id]; }
const userOf = u => u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '', verified: !!u.emailVerified } : null;
const skillKey = s => s.replace(/[^A-Za-z0-9]+/g, '_');
const cleanMedia = m => (m || []).slice(0, 4).map(x => { const o = { type: x.type === 'video' ? 'video' : 'image', url: String(x.url) }; if (x.w) o.w = Math.round(x.w); if (x.h) o.h = Math.round(x.h); return o; });
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
  signOut: () => Cloud.as !== 'admin' ? Cloud.actAs('admin') : fbSignOut(auth),

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
      x.mine = Object.fromEntries(kinds.map((k, i) => [k, got[i].exists()])); x.mine.e = got[0].exists() ? (got[0].data().e || '❤️') : '';
    }));
    return list;
  },
  async savePost(p) {
    const u = Cloud.user, data = { uid: u.uid, name: (p.name || 'Player').slice(0, 40), city: (p.city || '').slice(0, 40), photo: (p.photo || '').slice(0, 400),
      text: (p.text || '').slice(0, 1000), tags: (p.tags || []).slice(0, 20).map(t => String(t).slice(0, 40)), mentions: (p.mentions || []).slice(0, 20).map(m => ({ uid: String(m.uid).slice(0, 64), name: String(m.name).slice(0, 40) })),
      skill: (p.skill || '').slice(0, 60), media: cleanMedia(p.media), createdAt: serverTimestamp(), likes: 0, comments: 0, flags: 0 };
    if (p.repost) { const r = p.repost; data.repost = { id: String(r.id).slice(0, 64), col: r.col === 'results' ? 'results' : 'posts', uid: String(r.uid).slice(0, 64), name: String(r.name || 'Player').slice(0, 40),
      photo: String(r.photo || '').slice(0, 400), city: String(r.city || '').slice(0, 40), text: String(r.text || '').slice(0, 1000), skill: String(r.skill || '').slice(0, 60), media: cleanMedia(r.media),
      v: typeof r.v === 'number' ? r.v : 0, pts: typeof r.pts === 'number' ? Math.round(r.pts) : 0, t: Math.round(r.t || 0) }; }
    return (await addDoc(collection(db, 'posts'), data)).id;
  },
  /* ---------- follows: friends = people who follow each other ---------- */
  async follow(uid, name, on) {
    const me = Cloud.user, ref = doc(db, 'follows', me.uid + '__' + uid);
    return on ? setDoc(ref, { from: me.uid, to: uid, fromName: (me.name || 'Player').slice(0, 40), toName: (name || 'Player').slice(0, 40), at: serverTimestamp() }) : deleteDoc(ref);
  },
  async graph(uid) {
    const [a, b] = await Promise.all([getDocs(query(collection(db, 'follows'), where('to', '==', uid), limit(1000))), getDocs(query(collection(db, 'follows'), where('from', '==', uid), limit(1000)))]);
    const followers = a.docs.map(d => ({ uid: d.data().from, name: d.data().fromName })), following = b.docs.map(d => ({ uid: d.data().to, name: d.data().toName }));
    const fs = new Set(following.map(x => x.uid)), friends = followers.filter(x => fs.has(x.uid));
    return { followers, following, friends };
  },
  async userInfo(uid) {
    const [u, best, posts, res] = await Promise.all([getDoc(doc(db, 'users', uid)), getDocs(query(collection(db, 'best'), where('uid', '==', uid), limit(200))),
      getDocs(query(collection(db, 'posts'), where('uid', '==', uid), limit(40))), getDocs(query(collection(db, 'results'), where('uid', '==', uid), limit(40)))]);
    const items = [...posts.docs.map(d => ({ id: d.id, col: 'posts', ...d.data() })), ...res.docs.map(d => ({ id: d.id, col: 'results', ...d.data() }))].map(x => ({ ...x, t: tsMs(x.createdAt) })).sort((a, b) => b.t - a.t);
    return { profile: u.exists() ? { uid, ...u.data() } : { uid }, best: best.docs.map(d => d.data()).sort((a, b) => b.pts - a.pts), items };
  },
  /* ---------- notifications (likes, legit, comments, mentions, reposts, follows) ---------- */
  async notify(to, kind, n = {}) {
    const me = Cloud.user; if (!me || !to || to === me.uid) return;
    const data = { to, from: me.uid, fromName: (n.name || me.name || 'Player').slice(0, 40), fromPhoto: (me.photo || '').slice(0, 400), kind, ref: String(n.ref || '').slice(0, 64), col: String(n.col || '').slice(0, 10),
      text: String(n.text || '').slice(0, 140), at: serverTimestamp(), read: false };
    const fixed = ['like', 'legit', 'follow'].includes(kind);   // one per person per thing, removed again on unlike / unfollow
    return (fixed ? setDoc(doc(db, 'notifs', `${kind}__${me.uid}__${data.ref}`), data) : addDoc(collection(db, 'notifs'), data)).catch(e => console.warn('notify', e.code));
  },
  unnotify(kind, ref) { return deleteDoc(doc(db, 'notifs', `${kind}__${Cloud.user.uid}__${ref}`)).catch(() => {}); },
  listenNotifs(cb) {
    return onSnapshot(query(collection(db, 'notifs'), where('to', '==', Cloud.user.uid), limit(100)),
      s => cb(s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }), t: tsMs(d.data({ serverTimestamps: 'estimate' }).at) })).sort((a, b) => b.t - a.t)), e => console.warn('notifs', e.code));
  },
  markRead(ids) { if (!ids.length) return; const b = writeBatch(db); ids.slice(0, 400).forEach(id => b.update(doc(db, 'notifs', id), { read: true })); return b.commit().catch(e => console.warn('read', e.code)); },

  /* ---------- direct messages: chats/{uidA__uidB}/msgs ---------- */
  chatId: (a, b) => [a, b].sort().join('__'),
  listenChats(cb) {
    return onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', Cloud.user.uid), limit(100)),
      s => cb(s.docs.map(d => { const x = d.data({ serverTimestamps: 'estimate' }); return { id: d.id, ...x, t: tsMs(x.lastAt), seenMs: Object.fromEntries(Object.entries(x.seen || {}).map(([k, v]) => [k, tsMs(v)])) }; }).sort((a, b) => b.t - a.t)),
      e => console.warn('chats', e.code));
  },
  listenMsgs(cid, cb) {
    return onSnapshot(query(collection(db, 'chats', cid, 'msgs'), orderBy('at', 'desc'), limit(150)),
      s => cb(s.docs.map(d => { const x = d.data({ serverTimestamps: 'estimate' }); return { id: d.id, ...x, t: tsMs(x.at), pending: d.metadata.hasPendingWrites }; }).reverse()), e => cb(null, e));
  },
  async sendMsg(other, text) {
    const me = Cloud.user, cid = Cloud.chatId(me.uid, other.uid), members = [me.uid, other.uid].sort(), b = writeBatch(db);
    b.set(doc(db, 'chats', cid), { members, names: { [me.uid]: (me.name || 'Player').slice(0, 40), [other.uid]: (other.name || 'Player').slice(0, 40) },
      photos: { [me.uid]: (me.photo || '').slice(0, 400), [other.uid]: (other.photo || '').slice(0, 400) },
      last: text.slice(0, 200), lastFrom: me.uid, lastAt: serverTimestamp(), seen: { [me.uid]: serverTimestamp() } }, { merge: true });
    b.set(doc(collection(db, 'chats', cid, 'msgs')), { uid: me.uid, text: text.slice(0, 1000), at: serverTimestamp() });
    return b.commit();
  },
  seen(cid) { return updateDoc(doc(db, 'chats', cid), { ['seen.' + Cloud.user.uid]: serverTimestamp() }).catch(() => {}); },
  deleteMsg(cid, id) { return deleteDoc(doc(db, 'chats', cid, 'msgs', id)); },

  /* ---------- meetups: anyone can host; people join by adding themselves ---------- */
  async meetups() {
    const s = await getDocs(query(collection(db, 'meetups'), where('when', '>=', Date.now() - 3 * 36e5), orderBy('when', 'asc'), limit(200)));
    return s.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => !m.cancelled);
  },
  async myMeetups() { const s = await getDocs(query(collection(db, 'meetups'), where('members', 'array-contains', Cloud.user.uid), limit(300))); return s.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => !m.cancelled); },
  createMeetup(m) {
    const u = Cloud.user, name = (u.name || 'Player').slice(0, 40);
    return addDoc(collection(db, 'meetups'), { uid: u.uid, name, photo: (u.photo || '').slice(0, 400), hobby: m.hobby.slice(0, 40), title: m.title.slice(0, 80), place: m.place.slice(0, 100), city: (m.city || '').slice(0, 40),
      when: Math.round(m.when), spots: Math.max(0, Math.min(500, Math.round(m.spots) || 0)), note: (m.note || '').slice(0, 300), members: [u.uid], names: { [u.uid]: name }, cancelled: false, at: serverTimestamp() });
  },
  joinMeetup(id, on) { const u = Cloud.user; return updateDoc(doc(db, 'meetups', id), on ? { members: arrayUnion(u.uid), ['names.' + u.uid]: (u.name || 'Player').slice(0, 40) } : { members: arrayRemove(u.uid) }); },
  cancelMeetup(id) { return updateDoc(doc(db, 'meetups', id), { cancelled: true }); },

  async people() { const s = await getDocs(query(collection(db, 'users'), limit(500))); return s.docs.map(d => ({ uid: d.id, name: d.data().name || '', city: d.data().city || '', photo: d.data().photo || '', interests: d.data().interests || [] })).filter(x => x.name); },
  /* like / legit / flag: the mark and the counter change together, and the rules check they match */
  async toggle(kind, id, on, col = 'results', e = '') {
    const b = writeBatch(db), mark = doc(db, col, id, kind, Cloud.user.uid);
    if (on) b.set(mark, e && kind === 'likes' ? { at: serverTimestamp(), e } : { at: serverTimestamp() }); else b.delete(mark);
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
  /* scores now come only from Provn events: every event result for one skill */
  async eventResults(skill) {
    const s = await getDocs(query(collection(db, 'eventResults'), where('skill', '==', skill), limit(2000)));
    return s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().at) }));
  },
  /* best event result per player for one skill (filtered into city / state / country on the phone) */
  async rankings(skill) {
    const by = {}; (await Cloud.eventResults(skill)).forEach(r => { if (!by[r.uid] || by[r.uid].pts < r.pts) by[r.uid] = r; });
    return Object.values(by);
  },
  async myEventResults(uid) {
    const s = await getDocs(query(collection(db, 'eventResults'), where('uid', '==', uid || Cloud.user.uid), limit(500)));
    return s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().at) }));
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
      e.going = c.data().count; e.mine = m.exists(); e.pay = m.exists() ? (m.data().pay || '') : ''; e.past = (e.date || '') < today;
    }));
    return list;
  },
  /* paid events: the player pays by UPI and sends the reference; the admin confirms it (a payment gateway can replace this later) */
  payEvent(id, name, ref, amt) { return setDoc(doc(db, 'events', id, 'going', Cloud.user.uid), { at: serverTimestamp(), name: (name || 'Player').slice(0, 40), pay: 'pending', ref: String(ref).slice(0, 40), amt: Math.round(amt) }); },

  /* ---------- venues: owners apply, players request bookings, taps are counted as leads ---------- */
  applyVenue(a) {
    const d = { uid: Cloud.user.uid, by: (Cloud.user.name || '').slice(0, 40), name: String(a.name).slice(0, 60), contact: String(a.contact || '').slice(0, 40), phone: String(a.phone || '').slice(0, 20),
      addr: String(a.addr || '').slice(0, 120), city: String(a.city || '').slice(0, 40), acts: (a.acts || []).slice(0, 12), plan: a.plan === 'partner' ? 'partner' : 'free', info: String(a.info || '').slice(0, 300), status: 'new', at: serverTimestamp() };
    if (typeof a.lat === 'number') { d.lat = a.lat; d.lng = a.lng; }
    return addDoc(collection(db, 'venueApps'), d);
  },
  async myVenueApps() { const s = await getDocs(query(collection(db, 'venueApps'), where('uid', '==', Cloud.user.uid), limit(20))); return s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().at) })); },
  async myVenues() { const s = await getDocs(query(collection(db, 'venues'), where('owner', '==', Cloud.user.uid), limit(20))); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
  lead(v, kind) { if (!Cloud.user || !v) return; return addDoc(collection(db, 'venueLeads'), { venue: v.id, owner: v.owner || '', kind, uid: Cloud.user.uid, at: serverTimestamp() }).catch(() => {}); },
  async venueLeads(vid) { const s = await getDocs(query(collection(db, 'venueLeads'), where('venue', '==', vid), where('owner', '==', Cloud.user.uid), limit(5000))); return s.docs.map(d => ({ ...d.data(), t: tsMs(d.data().at) })); },
  requestBooking(v, b) {
    return addDoc(collection(db, 'bookings'), { venue: v.id, venueName: String(v.name).slice(0, 60), owner: v.owner || '', uid: Cloud.user.uid, name: (b.name || Cloud.user.name || 'Player').slice(0, 40), phone: String(b.phone || '').slice(0, 20),
      date: b.date, time: String(b.time || '').slice(0, 20), people: Math.max(1, Math.min(50, Math.round(b.people) || 1)), act: String(b.act || '').slice(0, 30), note: String(b.note || '').slice(0, 200), status: 'new', at: serverTimestamp() });
  },
  async myBookings() { const s = await getDocs(query(collection(db, 'bookings'), where('uid', '==', Cloud.user.uid), limit(50))); return s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().at) })).sort((a, b) => b.t - a.t); },
  async venueBookings(vid) { const s = await getDocs(query(collection(db, 'bookings'), where('venue', '==', vid), where('owner', '==', Cloud.user.uid), limit(200))); return s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().at) })).sort((a, b) => b.t - a.t); },
  setBooking(id, status) { return updateDoc(doc(db, 'bookings', id), { status }); },

  /* ---------- store: products from vendors, opened on the vendor's own site ---------- */
  async products(all) { const s = await getDocs(query(collection(db, 'products'), limit(300))); return s.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => all || p.active !== false); },
  click(p) { if (Cloud.user) addDoc(collection(db, 'productClicks'), { product: p.id, vendor: (p.vendor || '').slice(0, 60), uid: Cloud.user.uid, at: serverTimestamp() }).catch(() => {}); },

  setGoing(id, on, name) { const r = doc(db, 'events', id, 'going', Cloud.user.uid); return on ? setDoc(r, { at: serverTimestamp(), name: (name || 'Player').slice(0, 40) }) : deleteDoc(r); },
  async venues() { const s = await getDocs(query(collection(db, 'venues'), limit(1000))); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
  async records(skill) { const s = await getDocs(query(collection(db, 'records'), where('skill', '==', skill), limit(60))); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
  async config() { const s = await getDoc(doc(db, 'config', 'app')); return s.exists() ? s.data() : {}; },
  async banned() { return (await getDoc(doc(db, 'bans', Cloud.user.uid))).exists(); },

  /* ---------- admin only (the rules enforce this too) ---------- */
  isAdmin() { const u = Cloud.adminUser; return !!(u && u.email === ADMIN_EMAIL && u.verified); },

  /* ---------- test bots: two real accounts the admin can act as ---------- */
  as: 'admin', adminUser: null,
  BOTS: { bot1: { name: 'Aarav (bot)', sex: 'm', age: 27, city: 'Ahmedabad', char: 'Barbarian', interests: ['5k run', 'Pickleball', 'Push-ups'] },
          bot2: { name: 'Meera (bot)', sex: 'f', age: 24, city: 'Ahmedabad', char: 'Mage', interests: ['Chess', 'Badminton', "Rubik's cube"] } },
  async botCreds() { const s = await getDoc(doc(adb, 'private', 'bots')); return s.exists() ? s.data() : {}; },
  async setupBots() {
    if (!Cloud.isAdmin()) throw new Error('Admin only');
    const creds = await Cloud.botCreds();
    for (const id of Object.keys(Cloud.BOTS)) {
      if (creds[id]) continue;
      const B = Cloud.BOTS[id], b = botApp(id), rnd = Math.random().toString(36).slice(2, 10);
      const email = `provn.${id}.${rnd}@example.com`, pw = 'Pv!' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2, 6);
      const c = await createUserWithEmailAndPassword(b.auth, email, pw);
      await updateProfile(c.user, { displayName: B.name });
      creds[id] = { email, pw, uid: c.user.uid, name: B.name };
      await setDoc(doc(adb, 'private', 'bots'), creds);
      await setDoc(doc(b.db, 'users', c.user.uid), { name: B.name, sex: B.sex, age: B.age, city: B.city, char: B.char, theme: 'dusk', interests: B.interests, updatedAt: serverTimestamp() }, { merge: true });
    }
    return creds;
  },
  async actAs(id) {
    if (!Cloud.isAdmin()) throw new Error('Admin only');
    if (id === 'admin') { db = adb; Cloud.as = 'admin'; Cloud.user = Cloud.adminUser; }
    else {
      const creds = await Cloud.botCreds(); if (!creds[id]) throw new Error('Set up the test bots first');
      const b = botApp(id); if (!b.auth.currentUser) await signInWithEmailAndPassword(b.auth, creds[id].email, creds[id].pw);
      db = b.db; Cloud.as = id; Cloud.user = { ...userOf(b.auth.currentUser), name: creds[id].name, bot: id };
    }
    localStorage.setItem('provn_as', id);
    window.dispatchEvent(new CustomEvent('cloud-auth', { detail: Cloud.user }));
  },
  admin: {
    async stats() {
      const c = q => getCountFromServer(q).then(r => r.data().count).catch(() => '–');
      const [users, results, flagged, events, bans] = await Promise.all([c(collection(adb, 'users')), c(collection(adb, 'results')),
        c(query(collection(adb, 'results'), where('flags', '>', 0))), c(collection(adb, 'events')), c(collection(adb, 'bans'))]);
      return { users, results, flagged, events, bans };
    },
    async flagged() {
      const got = await Promise.all(['results', 'posts'].map(c => getDocs(query(collection(adb, c), where('flags', '>', 0), limit(100))).then(s => s.docs.map(d => ({ id: d.id, col: c, ...d.data(), t: tsMs(d.data().createdAt) }))).catch(() => [])));
      return got.flat().sort((a, b) => b.flags - a.flags);
    },
    async users() {
      const [u, b] = await Promise.all([getDocs(query(collection(adb, 'users'), limit(500))), getDocs(collection(adb, 'bans'))]);
      const banned = new Set(b.docs.map(d => d.id));
      return u.docs.map(d => ({ uid: d.id, ...d.data(), t: tsMs(d.data().updatedAt), banned: banned.has(d.id) })).sort((a, b) => b.t - a.t);
    },
    async results(uid) {
      const s = await getDocs(query(collection(adb, 'results'), where('uid', '==', uid), limit(500)));
      return s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().createdAt) })).sort((a, b) => b.t - a.t);
    },
    async removeResult(r) {
      if (r.col === 'posts') return deleteDoc(doc(adb, 'posts', r.id));
      const bref = doc(adb, 'best', r.uid + '__' + skillKey(r.skill)), b = await getDoc(bref);
      if (b.exists() && b.data().result === r.id) await deleteDoc(bref);
      await deleteDoc(doc(adb, 'results', r.id));
    },
    async clearFlags(id, col = 'results') {
      const s = await getDocs(collection(adb, col, id, 'flags')), b = writeBatch(adb);
      s.docs.forEach(d => b.delete(d.ref)); b.update(doc(adb, col, id), { flags: 0 });
      return b.commit();
    },
    async comments(id, col) { return Cloud.comments(id, col); },
    async removeComment(rid, cid, col = 'results') {
      const b = writeBatch(adb); b.delete(doc(adb, col, rid, 'comments', cid)); b.update(doc(adb, col, rid), { comments: increment(-1) });
      return b.commit();
    },
    ban(uid, on) { const r = doc(adb, 'bans', uid); return on ? setDoc(r, { at: serverTimestamp(), by: Cloud.user.email }) : deleteDoc(r); },
    saveEvent(e, id) {
      const data = { title: e.title, skill: e.skill || '', date: e.date, time: e.time || '', place: e.place || '', city: e.city || '', spots: e.spots || 0, fee: Math.max(0, Math.round(e.fee) || 0), info: e.info || '', updatedAt: serverTimestamp() };
      if (typeof e.lat === 'number' && typeof e.lng === 'number') { data.lat = e.lat; data.lng = e.lng; }
      return id ? setDoc(doc(adb, 'events', id), data) : addDoc(collection(adb, 'events'), data);
    },
    saveVenue(v, id) {
      const data = { name: v.name, kind: v.kind, acts: v.acts.slice(0, 12), addr: v.addr || '', phone: v.phone || '', web: v.web || '', info: v.info || '', lat: v.lat, lng: v.lng, city: v.city || '', updatedAt: serverTimestamp() };
      if (v.tier !== undefined) data.tier = v.tier; if (v.owner !== undefined) data.owner = v.owner; if (v.hours !== undefined) data.hours = v.hours;
      return id ? setDoc(doc(adb, 'venues', id), data, { merge: true }) : addDoc(collection(adb, 'venues'), data);
    },
    async allRecords() { const s = await getDocs(query(collection(adb, 'records'), limit(1000))); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
    saveRecord(r) {
      const id = [r.level, r.region, r.sex, skillKey(r.skill)].join('__').replace(/[^A-Za-z0-9_]/g, '_');
      return setDoc(doc(adb, 'records', id), { level: r.level, region: r.region, sex: r.sex, skill: r.skill, v: r.v, holder: r.holder, date: r.date || '', meet: r.meet || '', place: r.place || '', updatedAt: serverTimestamp() });
    },
    deleteRecord(id) { return deleteDoc(doc(adb, 'records', id)); },
    deleteVenue(id) { return deleteDoc(doc(adb, 'venues', id)); },
    deleteEvent(id) { return deleteDoc(doc(adb, 'events', id)); },
    /* results entered by the admin after a Provn event; points are worked out on the admin's phone */
    async eventResults(eid) { const s = await getDocs(query(collection(adb, 'eventResults'), where('event', '==', eid), limit(1000))); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
    saveEventResult(ev, p, v, pts) {
      return setDoc(doc(adb, 'eventResults', ev.id + '__' + p.uid), { event: ev.id, eventTitle: (ev.title || '').slice(0, 60), date: ev.date || '', place: (ev.place || '').slice(0, 60),
        evCity: (ev.city || '').slice(0, 40), uid: p.uid, name: (p.name || 'Player').slice(0, 40), city: (p.city || '').slice(0, 40), photo: (p.photo || '').slice(0, 400),
        sex: ['m', 'f'].includes(p.sex) ? p.sex : '', age: Math.round(p.age || 0), skill: ev.skill, v, pts: Math.max(0, Math.min(1400, Math.round(pts))), at: serverTimestamp() });
    },
    deleteEventResult(id) { return deleteDoc(doc(adb, 'eventResults', id)); },
    setPay(eid, uid, pay) { return updateDoc(doc(adb, 'events', eid, 'going', uid), { pay }); },
    async venueApps() { const s = await getDocs(query(collection(adb, 'venueApps'), limit(300))); return s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().at) })).sort((a, b) => b.t - a.t); },
    setApp(id, status) { return updateDoc(doc(adb, 'venueApps', id), { status }); },
    setVenueTier(id, d) { const u = {}; if ('tier' in d) u.tier = d.tier; if ('owner' in d) u.owner = d.owner; if ('hours' in d) u.hours = d.hours; return updateDoc(doc(adb, 'venues', id), u); },
    async leads() { const s = await getDocs(query(collection(adb, 'venueLeads'), limit(10000))); return s.docs.map(d => ({ ...d.data(), t: tsMs(d.data().at) })); },
    async bookings() { const s = await getDocs(query(collection(adb, 'bookings'), limit(500))); return s.docs.map(d => ({ id: d.id, ...d.data(), t: tsMs(d.data().at) })).sort((a, b) => b.t - a.t); },
    setBooking(id, status) { return updateDoc(doc(adb, 'bookings', id), { status }); },
    saveProduct(p, id) {
      const d = { name: p.name, price: Math.round(p.price) || 0, mrp: Math.round(p.mrp) || 0, img: p.img || '', url: p.url, vendor: p.vendor || '', skills: (p.skills || []).slice(0, 10), info: p.info || '', active: p.active !== false, updatedAt: serverTimestamp() };
      return id ? setDoc(doc(adb, 'products', id), d) : addDoc(collection(adb, 'products'), d);
    },
    deleteProduct(id) { return deleteDoc(doc(adb, 'products', id)); },
    async clicks() { const s = await getDocs(query(collection(adb, 'productClicks'), limit(10000))); return s.docs.map(d => ({ ...d.data(), t: tsMs(d.data().at) })); },
    async going(id) { const s = await getDocs(collection(adb, 'events', id, 'going')); return s.docs.map(d => ({ uid: d.id, ...d.data() })); },
    setConfig(c) {
      const d = { updatedAt: serverTimestamp() };
      if ('announce' in c) d.announce = (c.announce || '').slice(0, 280);
      if ('maptiler' in c) d.maptiler = (c.maptiler || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
      if ('upi' in c) d.upi = (c.upi || '').trim().slice(0, 60);
      if ('payee' in c) d.payee = (c.payee || '').trim().slice(0, 60);
      return setDoc(doc(adb, 'config', 'app'), d, { merge: true });
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
onAuthStateChanged(auth, async u => {
  Cloud.adminUser = userOf(u); Cloud.ready = true;
  const want = localStorage.getItem('provn_as');
  if (u && want && want !== 'admin' && Cloud.isAdmin()) { try { await Cloud.actAs(want); return; } catch (e) { console.warn('bot', e); } }
  db = adb; Cloud.as = 'admin'; Cloud.user = Cloud.adminUser; if (!u) localStorage.removeItem('provn_as');
  window.dispatchEvent(new CustomEvent('cloud-auth', { detail: Cloud.user }));
});
window.Cloud = Cloud;
window.dispatchEvent(new Event('cloud-ready'));
