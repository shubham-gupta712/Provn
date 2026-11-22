/* Provn Explore map: a 3D globe (MapLibre, globe projection) that zooms from space down to
   the courts, grounds, clubs and tournaments in a city. Ahmedabad first.
   Places come from OpenStreetMap (live, cached for 3 days) plus venues the admin adds in Firestore.
   Loaded lazily by index.html; uses the app's globals (store, esc, toast, buzz, SKILLS, Cloud…). */
(() => {
  const CITY = { name: 'Ahmedabad', center: [72.5714, 23.0225], bbox: [22.90, 72.45, 23.17, 72.72] }; // s,w,n,e
  const ACTS = [
    { k: 'cricket', n: 'Cricket', e: '🏏', sp: ['cricket', 'cricket_nets'], col: '#9BE15D', skill: 'Bowling speed' },
    { k: 'football', n: 'Football', e: '⚽', sp: ['soccer', 'football', 'futsal', 'american_football'], col: '#34D399', skill: 'Football juggling' },
    { k: 'badminton', n: 'Badminton', e: '🏸', sp: ['badminton'], col: '#60A5FA', skill: 'Badminton' },
    { k: 'pickleball', n: 'Pickleball', e: '', svg: 1, sp: ['pickleball'], col: '#A3E635', skill: 'Pickleball' },
    { k: 'tennis', n: 'Tennis', e: '🎾', sp: ['tennis'], col: '#FACC15', skill: 'Tennis' },
    { k: 'tt', n: 'Table tennis', e: '🏓', sp: ['table_tennis'], col: '#F472B6', skill: 'Table tennis' },
    { k: 'basketball', n: 'Basketball', e: '🏀', sp: ['basketball'], col: '#FB923C', skill: 'Basketball 3-pointers' },
    { k: 'volleyball', n: 'Volleyball', e: '🏐', sp: ['volleyball', 'beachvolleyball'], col: '#FDE68A' },
    { k: 'swimming', n: 'Swimming', e: '🏊', sp: ['swimming'], lei: ['swimming_pool'], col: '#38BDF8', skill: '50m freestyle' },
    { k: 'running', n: 'Running', e: '🏃', sp: ['athletics', 'running'], lei: ['track'], col: '#FF8A5B', skill: '5k run' },
    { k: 'gym', n: 'Gym', e: '🏋️', sp: ['fitness', 'weightlifting', 'crossfit', 'yoga', 'gymnastics', 'powerlifting'], lei: ['fitness_centre'], col: '#FFC23D', skill: 'Deadlift' },
    { k: 'racket', n: 'Squash & padel', e: '🎯', sp: ['squash', 'padel'], col: '#C084FC', skill: 'Squash' },
    { k: 'combat', n: 'Combat', e: '🥊', sp: ['boxing', 'martial_arts', 'karate', 'taekwondo', 'judo', 'kabaddi', 'wrestling', 'kickboxing'], col: '#F87171', skill: 'Boxing' },
    { k: 'chess', n: 'Chess', e: '♟️', sp: ['chess'], col: '#A78BFA', skill: 'Chess' },
    { k: 'skating', n: 'Skating', e: '🛼', sp: ['skating', 'roller_skating', 'ice_skating', 'skateboard'], lei: ['ice_rink'], col: '#2DD4BF' },
    { k: 'multi', n: 'Multi-sport', e: '🏟️', col: '#CBD5E1' }
  ];
  const A = Object.fromEntries(ACTS.map(a => [a.k, a]));
  /* pickleball has no emoji, so it gets its own drawn ball (perforated, tennis-yellow) */
  const PB_SVG = '<svg class="pb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#E7F536" stroke="#171A25" stroke-width="1.6"/><g fill="#171A25" opacity=".78"><circle cx="12" cy="6.6" r="1.25"/><circle cx="7.4" cy="9.6" r="1.25"/><circle cx="16.6" cy="9.6" r="1.25"/><circle cx="12" cy="12" r="1.25"/><circle cx="8.6" cy="15.3" r="1.25"/><circle cx="15.4" cy="15.3" r="1.25"/><circle cx="12" cy="18.1" r="1.1"/></g></svg>';
  const ico = a => a.svg ? PB_SVG : a.e;
  const TYPE = { pitch: 'Court / ground', sports_centre: 'Sports centre', stadium: 'Stadium', fitness_centre: 'Gym', swimming_pool: 'Pool', track: 'Track', sports_hall: 'Sports hall', ice_rink: 'Rink', club: 'Club', academy: 'Academy', community: 'Community' };
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  const CACHE = 'osm_' + CITY.name.toLowerCase(), CACHE_MS = 3 * 864e5;

  let osmFailed = false, MT = '', map, root, venues = [], events = [], filter = 'all', query = '', sel = null, me = null, layer = 'street', is3d = true, pickCb = null, evMarkers = [], selMarker = null, meMarker = null, ready = false;
  const $m = s => root.querySelector(s), $$m = s => [...root.querySelectorAll(s)];

  /* ---------- data ---------- */
  function classify(t) {
    const sports = (t.sport || '').split(/[;,]/).map(x => x.trim()).filter(Boolean), lei = t.leisure || (t.club === 'sport' ? 'club' : '');
    const acts = ACTS.filter(a => (a.sp && a.sp.some(x => sports.includes(x))) || (a.lei && a.lei.includes(lei))).map(a => a.k);
    if (!acts.length) acts.push('multi');
    return { acts, type: TYPE[lei] || (sports.length ? 'Court / ground' : 'Sports venue') };
  }
  function fromOsm(el) {
    const t = el.tags || {}, lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (lat == null) return null;
    const c = classify(t), a0 = A[c.acts[0]];
    const name = t.name || t['name:en'] || `${a0.k === 'multi' ? 'Sports' : a0.n} ${t.leisure === 'pitch' ? (/(tennis|badminton|basketball|volleyball|pickleball|squash|padel)/.test(t.sport || '') ? 'court' : 'ground') : 'venue'}`;
    const addr = [t['addr:housename'], t['addr:street'], t['addr:suburb'] || t['addr:neighbourhood'], t['addr:city']].filter(Boolean).join(', ');
    return { id: 'osm/' + el.type + '/' + el.id, name, named: !!t.name, lat, lng, acts: c.acts, type: c.type, addr, phone: t.phone || t['contact:phone'] || '', web: t.website || t['contact:website'] || '', hours: t.opening_hours || '', access: t.access || '', src: 'osm' };
  }
  async function loadOsm(force) {
    const c = store.get(CACHE, null);
    if (!force && c && Date.now() - c.t < CACHE_MS && c.list?.length) return c.list;
    const bb = CITY.bbox.join(',');
    const q = `[out:json][timeout:60][bbox:${bb}];(nwr["leisure"~"^(pitch|sports_centre|stadium|fitness_centre|swimming_pool|track|sports_hall|ice_rink)$"];nwr["club"="sport"];);out center tags;`;
    for (const url of OVERPASS) {
      try {
        const ac = new AbortController(), to = setTimeout(() => ac.abort(), 65000);
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ac.signal });
        clearTimeout(to);
        if (!r.ok) continue;
        const j = await r.json(), seen = new Set();
        const list = j.elements.map(fromOsm).filter(v => v && !seen.has(v.id) && seen.add(v.id))
          .filter(v => v.named || v.acts[0] !== 'multi'); // drop unnamed pitches with no sport
        if (list.length) { try { store.set(CACHE, { t: Date.now(), list }); } catch (e) { } return list; }
      } catch (e) { console.warn('overpass', url, e); }
    }
    osmFailed = !c?.list?.length;
    return c?.list || [];
  }
  async function loadGuide() {
    try {
      const j = await (await fetch('data/' + CITY.name.toLowerCase() + '.json', { cache: 'no-cache' })).json();
      const t = new Date().toISOString().slice(0, 10);
      return { venues: j.venues.map((v, i) => ({ ...v, id: 'g/' + i, src: 'guide', named: true, type: TYPE[v.kind] || 'Venue', acts: v.acts.filter(k => A[k]) })),
               events: j.events.filter(e => e.date >= t).map(e => ({ ...e, src: 'guide', live: e.date === t, going: null, mine: false })) };
    } catch (e) { console.warn('guide', e); return { venues: [], events: [] }; }
  }
  async function loadCurated() {
    if (!(window.Cloud && Cloud.user && Cloud.venues)) return [];
    try { return (await Cloud.venues()).map(v => ({ ...v, id: 'pv/' + v.id, docId: v.id, src: 'provn', named: true, type: TYPE[v.kind] || v.kind || 'Venue', acts: (v.acts || []).filter(k => A[k]).length ? v.acts.filter(k => A[k]) : ['multi'] })); }
    catch (e) { console.warn(e); return []; }
  }
  async function loadEvents() {
    if (!(window.Cloud && Cloud.user)) return [];
    try { const t = new Date().toISOString().slice(0, 10); return (await Cloud.events()).filter(e => !e.past && e.lat != null).map(e => ({ ...e, live: e.date === t })); }
    catch (e) { return []; }
  }

  let guide = { venues: [], events: [] };
  function merge(cur, gv, osm) {
    const key = v => v.name.toLowerCase().replace(/[^a-z0-9]/g, ''), seen = new Set();
    return [...cur, ...gv, ...osm].filter(v => { const k = key(v); if (v.named && seen.has(k)) return false; seen.add(k); return true; });
  }
  async function reloadOsm() { store.set(CACHE, null); $m('#mxCount').textContent = 'Finding courts and grounds…'; const osm = await loadOsm(true); venues = merge(venues.filter(v => v.src === 'provn'), guide.venues, osm); data(); refresh(); if (osmFailed) toast('Still could not reach OpenStreetMap. Try again later.'); }

  /* ---------- helpers ---------- */
  const dist = (a, b) => { const R = 6371, dLa = (b[1] - a[1]) * Math.PI / 180, dLo = (b[0] - a[0]) * Math.PI / 180, x = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  const fmtKm = d => d < 1 ? Math.round(d * 1000 / 10) * 10 + ' m' : d < 10 ? d.toFixed(1) + ' km' : Math.round(d) + ' km';
  const ref = () => me || (map ? map.getCenter().toArray() : CITY.center);
  const matches = v => (filter === 'all' || filter === 'events' ? true : v.acts.includes(filter)) && (!query || v.name.toLowerCase().includes(query) || v.acts.some(k => A[k].n.toLowerCase().includes(query)) || (v.addr || '').toLowerCase().includes(query));
  const shown = () => filter === 'events' ? [] : venues.filter(matches);
  const fdate = d => { const x = new Date(d + 'T00:00'); return isNaN(x) ? d : x.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }); };

  /* ---------- UI ---------- */
  function build() {
    root = document.createElement('div'); root.className = 'mx'; root.id = 'mx';
    root.innerHTML = `
      <div class="mx-map" id="mxMap"></div>
      <div class="mx-top">
        <button class="mx-b press" id="mxBack" aria-label="Close map"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <label class="mx-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input id="mxQ" placeholder="Search courts, grounds, sports" autocomplete="off" enterkeyhint="search"><button id="mxQx" hidden aria-label="Clear">×</button></label>
      </div>
      <div class="mx-chips" id="mxChips"></div>
      <div class="mx-cross" id="mxCross" hidden><i></i></div>
      <div class="mx-drawer" id="mxDrawer">
        <div class="mx-dh"><div><b id="mxCount">Loading places…</b><small id="mxSub">${CITY.name} · more cities soon</small></div><button class="mx-chipb" id="mxCity">${CITY.name}</button></div>
        <div class="mx-cards" id="mxCards"></div>
        <div class="mx-detail" id="mxDetail" hidden></div>
        <div class="mx-pick" id="mxPick" hidden><p>Move the map so the pin sits on the spot</p><div class="mx-row"><button class="btn ghost" id="mxPickNo"><span>Cancel</span></button><button class="btn primary" id="mxPickOk"><span>Use this spot</span></button></div></div>
      </div>
      <div class="mx-form" id="mxForm" hidden></div>
      <div class="mx-load" id="mxLoad"><div class="mx-spin"></div><b>Spinning up the globe…</b></div>`;
    $('#app').appendChild(root);
    $m('#mxChips').innerHTML = [{ k: 'all', n: 'All', e: '✨' }, { k: 'events', n: 'Tournaments', e: '🏆' }, ...ACTS.filter(a => a.k !== 'multi')]
      .map(a => `<button class="mx-chip ${a.k === filter ? 'on' : ''}" data-k="${a.k}"><span>${ico(a)}</span>${a.n}</button>`).join('');
    $$m('.mx-chip').forEach(b => b.onclick = () => { buzz(6); setFilter(b.dataset.k); });
    $m('#mxBack').onclick = () => close();
    const q = $m('#mxQ');
    let qT; q.oninput = () => { query = q.value.trim().toLowerCase(); $m('#mxQx').hidden = !q.value; deselect(); data(); refresh(); clearTimeout(qT); qT = setTimeout(() => { const m = query && shown(); if (m && m.length) fit(m.map(v => [v.lng, v.lat])); }, 700); };
    q.onkeydown = e => { if (e.key === 'Enter') { q.blur(); const l = list(); if (l[0]) select(l[0].id, true); } };
    $m('#mxQx').onclick = () => { q.value = ''; q.oninput(); };
    $m('#mxCity').onclick = () => { buzz(6); deselect(); flyCity(1800); };
    $m('#mxPickNo').onclick = () => endPick(false);
    $m('#mxPickOk').onclick = () => endPick(true);
    addEventListener('popstate', () => { if (root.classList.contains('on') && !(history.state && history.state.map)) close(true); });
  }

  function setFilter(k) {
    filter = k; $$m('.mx-chip').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    deselect(); data(); refresh();
    const s = shown();
    if (k === 'events' && events.length) { if (events.length === 1) selectEvent(events[0].id); else fit(events.map(e => [e.lng, e.lat])); }
    else if (k !== 'all' && s.length) fit(s.map(v => [v.lng, v.lat]));
  }
  function fit(pts) {
    if (!pts.length) return;
    if (pts.length === 1) { map.flyTo({ center: pts[0], zoom: 15, duration: 1400 }); return; }
    const b = new maplibregl.LngLatBounds(pts[0], pts[0]); pts.forEach(p => b.extend(p));
    map.fitBounds(b, { padding: { top: 150, bottom: 260, left: 40, right: 70 }, maxZoom: 15, duration: 1400, pitch: is3d ? 45 : 0 });
  }
  function setLayer(l) {
    layer = l; const sat = l === 'sat';
    ['sat', 'roads', 'lbl'].forEach(id => map.setLayoutProperty(id, 'visibility', sat ? 'visible' : 'none'));
    map.setLayoutProperty('street', 'visibility', sat ? 'none' : 'visible');
    $m('#mxLayer').classList.toggle('on', !sat); toast(sat ? 'Satellite view' : 'Map view');
  }
  function flyCity(d) { map.flyTo({ center: CITY.center, zoom: 11.4, pitch: is3d ? 50 : 0, bearing: is3d ? -12 : 0, duration: d, curve: 1.5, essential: true }); }

  /* list = what's in view (or search results anywhere in the city) */
  function list() {
    const r = ref(), s = shown();
    let l = query ? s : (() => { const b = map.getBounds(); return s.filter(v => b.contains([v.lng, v.lat])); })();
    const rank = v => v.src === 'provn' ? 2 : v.src === 'guide' ? 1 : 0;
    l = l.map(v => ({ ...v, d: dist(r, [v.lng, v.lat]) })).sort((a, b) => rank(b) - rank(a) || (b.named - a.named) || a.d - b.d);
    return l;
  }
  function card(v) {
    const a = A[v.acts[0]];
    return `<button class="mx-card" data-id="${esc(v.id)}"><span class="mx-ic" style="background:${a.col}">${ico(a)}</span><span class="mx-ct"><b>${esc(v.name)}${v.src === 'provn' ? ' <i class="mx-ver">✓</i>' : ''}</b><small>${esc(v.type)}${v.area ? ' · ' + esc(v.area) : ''} · ${fmtKm(v.d)}</small><span class="mx-tags">${v.acts.slice(0, 3).map(k => `<em>${ico(A[k])} ${A[k].n}</em>`).join('')}</span></span></button>`;
  }
  function evCard(e) {
    const d = dist(ref(), [e.lng, e.lat]);
    return `<button class="mx-card ev" data-ev="${esc(e.id)}"><span class="mx-ic" style="background:#FFC23D">🏆</span><span class="mx-ct"><b>${esc(e.title)}</b><small>${e.live ? '<i class="mx-live">LIVE TODAY</i>' : fdate(e.date)}${e.time ? ' · ' + esc(e.time) : ''} · ${fmtKm(d)}</small><span class="mx-tags"><em>${esc(e.place || e.city || '')}</em>${e.spots && e.going != null ? `<em>${Math.max(0, e.spots - e.going)} spots left</em>` : ''}</span></span></button>`;
  }
  function data() {
    if (!ready) return; const s = shown();
    map.getSource('v').setData({ type: 'FeatureCollection', features: s.map(v => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [v.lng, v.lat] }, properties: { id: v.id, icon: `pin-${v.acts.includes(filter) ? filter : v.acts[0]}${v.src === 'osm' ? '' : 'v'}`, rank: v.src === 'provn' ? 0 : v.src === 'guide' ? 1 : v.named ? 2 : 3 } })) });
  }
  function refresh() {
    if (!ready) return;
    evMarkers.forEach(m => m.getElement().hidden = !(filter === 'all' || filter === 'events'));
    if (sel) return;
    const evs = (filter === 'all' || filter === 'events') && !query ? events.slice().sort((a, b) => (b.live - a.live) || a.date.localeCompare(b.date)) : [];
    const l = list().slice(0, 40), total = filter === 'events' ? evs.length : list().length;
    $m('#mxCount').textContent = filter === 'events' ? `${evs.length} tournament${evs.length === 1 ? '' : 's'} coming up` : query ? `${total} match${total === 1 ? '' : 'es'} for “${$m('#mxQ').value.trim()}”` : `${total} place${total === 1 ? '' : 's'} in view`;
    $m('#mxSub2') && ($m('#mxSub2').textContent = '');
    $m('#mxSub').textContent = (filter === 'events' ? (evs.some(e => e.live) ? 'Live and upcoming · ' : 'Upcoming · ') : `${A[filter]?.n || 'All sports'} · `) + 'tap a pin for details';
    const html = total ? '' : null;
    $m('#mxCards').innerHTML = html !== null ? (osmFailed && filter !== 'events' ? '<div class="mx-empty"><button class="mx-retry" id="mxRetry">Load more places from OpenStreetMap</button></div>' : '') : `<div class="mx-empty">${filter === 'events' ? 'No tournaments on the map yet. They show up here once they are announced.' : query ? 'Nothing matches in Ahmedabad yet. Try another sport or name.' : 'Nothing here. Zoom out or move the map.'}${osmFailed && filter !== 'events' ? '<button class="mx-retry" id="mxRetry">Load more places from OpenStreetMap</button>' : ''}</div>`;
    const rt = $m('#mxRetry'); if (rt) rt.onclick = () => { buzz(8); reloadOsm(); };
    $m('#mxCards').scrollLeft = 0;
    $$m('.mx-card[data-id]').forEach(b => b.onclick = () => select(b.dataset.id, true));
    $$m('.mx-card[data-ev]').forEach(b => b.onclick = () => selectEvent(b.dataset.ev));
  }

  /* ---------- selection ---------- */
  function select(id, fly) {
    const v = venues.find(x => x.id === id); if (!v) return;
    buzz(8); sel = v; const a = A[v.acts.includes(filter) ? filter : v.acts[0]], d = dist(ref(), [v.lng, v.lat]);
    if (selMarker) selMarker.remove();
    const el = document.createElement('div'); el.className = 'mx-pin'; el.innerHTML = `<span style="background:${a.col}"><b>${ico(a)}</b></span>`;
    selMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([v.lng, v.lat]).addTo(map);
    if (fly) map.flyTo({ center: [v.lng, v.lat], zoom: Math.max(map.getZoom(), 15.5), pitch: is3d ? 55 : 0, duration: 1500, offset: [0, -90] });
    const here = events.filter(e => dist([e.lng, e.lat], [v.lng, v.lat]) < 0.4);
    const sk = v.acts.map(k => A[k].skill).filter(n => n && SKILLS[n]);
    const D = $m('#mxDetail');
    D.innerHTML = `<button class="mx-x press" id="mxDx" aria-label="Back to list">×</button>
      <div class="mx-dt"><span class="mx-ic big" style="background:${a.col}">${ico(a)}</span><div><b class="display">${esc(v.name)}</b><small>${esc(v.type)} · ${fmtKm(d)} away${v.src === 'provn' ? ' · <i class="mx-ver">✓ Verified by Provn</i>' : ''}</small></div></div>${v.approx ? `<p class="mx-approx">${v.area ? `Pin shows the ${esc(v.area)} area.` : 'Pin position is approximate.'} Directions search for the exact place.</p>` : ''}
      <div class="mx-tags big">${v.acts.map(k => `<em>${ico(A[k])} ${A[k].n}</em>`).join('')}</div>
      ${v.addr ? `<p class="mx-p">📍 ${esc(v.addr)}</p>` : ''}${v.hours ? `<p class="mx-p">🕒 ${esc(v.hours)}</p>` : ''}${v.access && v.access !== 'yes' ? `<p class="mx-p">🔒 Access: ${esc(v.access)}</p>` : ''}${v.info ? `<p class="mx-p">${esc(v.info)}</p>` : ''}
      ${here.length ? `<div class="mx-here">${here.map(e => `<div><b>🏆 ${esc(e.title)}</b><small>${e.live ? '<i class="mx-live">LIVE TODAY</i>' : fdate(e.date)}${e.time ? ' · ' + esc(e.time) : ''}</small></div>`).join('')}</div>` : ''}
      <div class="mx-row">
        <a class="btn primary" target="_blank" rel="noopener" href="${v.approx ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(v.name + ', ' + (v.addr || CITY.name)) : `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`}"><span>Directions</span></a>
        ${v.phone ? `<a class="btn ghost" href="tel:${esc(v.phone.replace(/\s/g, ''))}"><span>Call</span></a>` : ''}
        ${v.web ? `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(/^https?:/.test(v.web) ? v.web : 'https://' + v.web)}"><span>${v.src === 'guide' ? 'More info' : 'Website'}</span></a>` : ''}
      </div>
      ${sk.length ? `<button class="btn ghost mx-log" id="mxLog"><span>Log a ${esc(sk[0])} result</span></button>` : ''}
      <p class="mx-src">${v.src === 'osm' ? 'Place data © OpenStreetMap contributors' : v.src === 'guide' ? 'From public listings, checked Nov 2026. Details can change, so confirm before you go.' : 'Added by the Provn team'}</p>
      ${typeof Admin !== 'undefined' && Admin.on() && v.src === 'provn' ? `<div class="mx-row"><button class="btn ghost" id="mxEdit"><span>Edit venue</span></button><button class="btn ghost" id="mxDel"><span>Delete</span></button></div>` : ''}`;
    D.hidden = false; $m('#mxCards').hidden = true; $m('#mxDrawer').classList.add('det');
    $m('#mxCount').textContent = ''; $m('#mxSub').textContent = '';
    $m('#mxDx').onclick = () => deselect(true);
    const lg = $m('#mxLog'); if (lg) lg.onclick = () => { close(); setTimeout(() => openProve(sk[0], false), 350); };
    const ed = $m('#mxEdit'); if (ed) ed.onclick = () => venueForm(v);
    const dl = $m('#mxDel'); if (dl) dl.onclick = () => Admin.confirm(dl, async () => { try { await Cloud.admin.deleteVenue(v.docId); toast('Venue deleted'); venues = venues.filter(x => x !== v); deselect(); data(); refresh(); } catch (e) { toast('Could not delete: ' + (e.code || e.message)); } });
  }
  function selectEvent(id) {
    const e = events.find(x => x.id === id); if (!e) return;
    map.flyTo({ center: [e.lng, e.lat], zoom: 15, pitch: is3d ? 55 : 0, duration: 1500, offset: [0, -90] });
    const near = venues.filter(v => dist([e.lng, e.lat], [v.lng, v.lat]) < 0.15).sort((a, b) => dist([e.lng, e.lat], [a.lng, a.lat]) - dist([e.lng, e.lat], [b.lng, b.lat]))[0];
    if (near && e.src !== 'guide') { setTimeout(() => select(near.id, false), 50); return; }
    buzz(8); sel = { id: 'ev/' + id };
    const D = $m('#mxDetail');
    D.innerHTML = `<button class="mx-x press" id="mxDx" aria-label="Back to list">×</button>
      <div class="mx-dt"><span class="mx-ic big" style="background:#FFC23D">🏆</span><div><b class="display">${esc(e.title)}</b><small>${e.live ? '<i class="mx-live">LIVE TODAY</i>' : fdate(e.date)}${e.time ? ' · ' + esc(e.time) : ''} · ${fmtKm(dist(ref(), [e.lng, e.lat]))} away</small></div></div>
      ${e.place || e.city ? `<p class="mx-p">📍 ${esc([e.place, e.city].filter(Boolean).join(', '))}</p>` : ''}${e.info ? `<p class="mx-p">${esc(e.info)}</p>` : ''}
      ${e.going != null ? `<p class="mx-p">${e.going} going${e.spots ? ` · ${Math.max(0, e.spots - e.going)} spots left` : ''}</p>` : ''}
      <div class="mx-row"><a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}"><span>Directions</span></a>${e.src === 'guide' ? `<a class="btn primary" target="_blank" rel="noopener" href="${esc(e.web)}"><span>Official site</span></a>` : `<button class="btn primary" id="mxReg"><span>${e.mine ? 'Going ✓' : 'Register'}</span></button>`}</div>
      ${e.skill && SKILLS[e.skill] ? `<button class="btn ghost mx-log" id="mxLog2"><span>Log a ${esc(e.skill)} result</span></button>` : ''}`;
    const l2 = $m('#mxLog2'); if (l2) l2.onclick = () => { close(); setTimeout(() => openProve(e.skill, false), 350); };
    D.hidden = false; $m('#mxCards').hidden = true; $m('#mxDrawer').classList.add('det'); $m('#mxCount').textContent = ''; $m('#mxSub').textContent = '';
    $m('#mxDx').onclick = () => deselect(true);
    if ($m('#mxReg')) $m('#mxReg').onclick = async () => { try { await Cloud.setGoing(e.id, !e.mine, store.get('name', '')); e.mine = !e.mine; e.going += e.mine ? 1 : -1; toast(e.mine ? `You're going to ${e.title}!` : 'Registration cancelled'); selectEvent(id); renderEvents && renderEvents(); } catch (er) { toast('Could not register: ' + (er.code || er.message)); } };
  }
  function deselect(back) {
    if (!sel) return; sel = null; if (selMarker) { selMarker.remove(); selMarker = null; }
    $m('#mxDetail').hidden = true; $m('#mxCards').hidden = false; $m('#mxDrawer').classList.remove('det');
    if (back) refresh();
  }

  /* ---------- pins: drawn once per sport in the app's look ---------- */
  function makePins() {
    const t = document.documentElement.dataset.theme || 'dusk', dpr = 2, W = 34, H = 44;
    const look = { dusk: { ink: '#171A25', lw: 3, inner: '#fff' }, nightfall: { ink: '#0b0b14', lw: 2, inner: '#14141f', glow: true }, volt: { ink: '#0D0E12', lw: 3.5, inner: '#fff', sharp: true } }[t] || { ink: '#171A25', lw: 3, inner: '#fff' };
    ACTS.forEach(a => ['', 'v'].forEach(kind => {
      const id = `pin-${a.k}${kind}`; if (map.hasImage(id)) map.removeImage(id);
      const c = document.createElement('canvas'); c.width = W * dpr; c.height = H * dpr; const g = c.getContext('2d'); g.scale(dpr, dpr);
      const cx = W / 2, cy = 16, r = 13;
      g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(cx, H - 3, 6, 2.4, 0, 0, 7); g.fill();
      g.beginPath();
      if (look.sharp) { g.moveTo(cx - r, cy - r + 3); g.lineTo(cx + r, cy - r); g.lineTo(cx + r, cy + r - 3); g.lineTo(cx + 3, cy + r); g.lineTo(cx, H - 5); g.lineTo(cx - 3, cy + r); g.lineTo(cx - r, cy + r); g.closePath(); }
      else { g.arc(cx, cy, r, Math.PI * 0.78, Math.PI * 2.22); g.quadraticCurveTo(cx + r * 0.35, cy + r * 1.1, cx, H - 5); g.quadraticCurveTo(cx - r * 0.35, cy + r * 1.1, cx - r * Math.cos(Math.PI * 0.22), cy + r * Math.sin(Math.PI * 0.22)); g.closePath(); }
      if (look.glow) { g.shadowColor = a.col; g.shadowBlur = 8; }
      g.fillStyle = look.glow ? look.ink : a.col; g.fill(); g.shadowBlur = 0;
      g.lineWidth = look.lw; g.strokeStyle = look.glow ? a.col : look.ink; g.stroke();
      g.fillStyle = look.glow ? a.col + '33' : look.inner; g.beginPath(); g.arc(cx, cy, 8.6, 0, 7); g.fill();
      if (a.svg) { g.fillStyle = '#E7F536'; g.strokeStyle = '#171A25'; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, 7, 0, 7); g.fill(); g.stroke(); g.fillStyle = 'rgba(23,26,37,.8)'; [[0, -3.6], [-3.3, -1.4], [3.3, -1.4], [0, 0.6], [-2.4, 3.2], [2.4, 3.2]].forEach(([x, y]) => { g.beginPath(); g.arc(cx + x, cy + y, 0.95, 0, 7); g.fill(); }); }
      else { g.font = '11.5px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(a.e, cx, cy + 0.5); }
      if (kind) { g.fillStyle = '#FF6B3D'; g.strokeStyle = look.ink; g.lineWidth = 2; g.beginPath(); g.arc(cx + r - 1, cy - r + 2, 4.6, 0, 7); g.fill(); g.stroke(); }
      map.addImage(id, g.getImageData(0, 0, W * dpr, H * dpr), { pixelRatio: dpr });
    }));
    pinTheme = t;
  }
  let pinTheme = '';

  /* ---------- markers for tournaments ---------- */
  function drawEvents() {
    evMarkers.forEach(m => m.remove()); evMarkers = [];
    events.forEach(e => {
      const el = document.createElement('button'); el.className = 'mx-ev' + (e.live ? ' live' : ''); el.innerHTML = `<span>🏆</span>${e.live ? '<i>LIVE</i>' : ''}`;
      el.onclick = ev => { ev.stopPropagation(); selectEvent(e.id); };
      evMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([e.lng, e.lat]).addTo(map));
    });
  }

  /* ---------- location ---------- */
  function useLoc() {
    const l = window.provnLoc; if (!l) return;
    me = [l.lng, l.lat];
    if (!meMarker) { const el = document.createElement('div'); el.className = 'mx-me'; meMarker = new maplibregl.Marker({ element: el }).setLngLat(me).addTo(map); } else meMarker.setLngLat(me);
  }
  addEventListener('provn-loc', () => { if (map && ready) { useLoc(); refresh(); } });
  function locate() {
    buzz(8);
    if (!navigator.geolocation) { toast('Location is not available on this device'); return; }
    $m('#mxMe').classList.add('busy');
    navigator.geolocation.getCurrentPosition(p => {
      $m('#mxMe').classList.remove('busy'); me = [p.coords.longitude, p.coords.latitude];
      if (!meMarker) { const el = document.createElement('div'); el.className = 'mx-me'; meMarker = new maplibregl.Marker({ element: el }).setLngLat(me).addTo(map); } else meMarker.setLngLat(me);
      if (dist(me, CITY.center) > 60) { toast(`Provn's map covers ${CITY.name} for now. More cities soon!`); flyCity(2000); }
      else map.flyTo({ center: me, zoom: 14, pitch: is3d ? 50 : 0, duration: 1800 });
      refresh();
    }, () => { $m('#mxMe').classList.remove('busy'); toast('Allow location access to see places near you'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  /* ---------- admin: pick a spot, add/edit venues ---------- */
  function pick(cb) {
    pickCb = cb; deselect(); buzz(8);
    $m('#mxCross').hidden = false; $m('#mxPick').hidden = false; $m('#mxCards').hidden = true; root.classList.add('picking');
    if (map.getZoom() < 14) map.flyTo({ center: map.getCenter(), zoom: 15, duration: 900 });
  }
  function endPick(ok) {
    const c = map.getCenter(), cb = pickCb; pickCb = null;
    $m('#mxCross').hidden = true; $m('#mxPick').hidden = true; $m('#mxCards').hidden = false; root.classList.remove('picking');
    if (ok && cb) cb(+c.lat.toFixed(6), +c.lng.toFixed(6)); else if (pickReturn) { const r = pickReturn; pickReturn = null; close(); r(null); }
  }
  let pickReturn = null;
  function startPick() { pick((lat, lng) => { const r = pickReturn; pickReturn = null; close(); r && r({ lat, lng }); }); }
  function venueForm(v) {
    const F = $m('#mxForm'), cur = new Set(v.acts && v.acts[0] !== 'multi' ? v.acts : []);
    F.innerHTML = `<div class="mx-fi"><h3 class="display">${v.docId ? 'Edit venue' : 'New venue'}</h3><small class="mx-p">${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}</small>
      <label>Name<input id="vfN" maxlength="60" value="${esc(v.name || '')}" placeholder="e.g. Sardar Patel Pickleball Courts"></label>
      <label>Kind<select id="vfK">${['pitch', 'sports_centre', 'stadium', 'academy', 'club', 'community', 'fitness_centre', 'swimming_pool', 'track'].map(k => `<option value="${k}" ${v.kind === k ? 'selected' : ''}>${TYPE[k]}</option>`).join('')}</select></label>
      <label>Activities</label><div class="mx-fchips">${ACTS.filter(a => a.k !== 'multi').map(a => `<button data-k="${a.k}" class="${cur.has(a.k) ? 'on' : ''}">${ico(a)} ${a.n}</button>`).join('')}</div>
      <label>Address<input id="vfA" maxlength="120" value="${esc(v.addr || '')}" placeholder="Street, area"></label>
      <div class="mx-two"><label>Phone<input id="vfP" maxlength="20" value="${esc(v.phone || '')}"></label><label>Website<input id="vfW" maxlength="120" value="${esc(v.web || '')}"></label></div>
      <label>About<input id="vfI" maxlength="200" value="${esc(v.info || '')}" placeholder="Courts, timings, how to join"></label>
      <div class="mx-row"><button class="btn ghost" id="vfNo"><span>Cancel</span></button><button class="btn primary" id="vfOk"><span>Save venue</span></button></div></div>`;
    F.hidden = false;
    F.querySelectorAll('.mx-fchips button').forEach(b => b.onclick = () => { b.classList.toggle('on'); b.classList.contains('on') ? cur.add(b.dataset.k) : cur.delete(b.dataset.k); });
    F.querySelector('#vfNo').onclick = () => { F.hidden = true; };
    F.querySelector('#vfOk').onclick = async () => {
      const d = { name: F.querySelector('#vfN').value.trim(), kind: F.querySelector('#vfK').value, acts: [...cur], addr: F.querySelector('#vfA').value.trim(), phone: F.querySelector('#vfP').value.trim(), web: F.querySelector('#vfW').value.trim(), info: F.querySelector('#vfI').value.trim(), lat: v.lat, lng: v.lng, city: CITY.name };
      if (!d.name || !d.acts.length) { toast('Add a name and at least one activity'); return; }
      try { await Cloud.admin.saveVenue(d, v.docId); toast('Venue saved · everyone can see it now'); F.hidden = true; venues = [...(await loadCurated()), ...venues.filter(x => x.src !== 'provn')]; deselect(); data(); refresh(); }
      catch (e) { toast('Could not save: ' + (e.code || e.message)); }
    };
  }

  /* ---------- map ---------- */
  function initMap() {
    const sat = MT ? `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MT}` : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    const satAttr = MT ? '© MapTiler © OpenStreetMap contributors' : 'Imagery © Esri, Maxar, Earthstar Geographics';
    map = new maplibregl.Map({
      container: $m('#mxMap'), center: [CITY.center[0] - 40, 18], zoom: 1.3, pitch: 0, maxPitch: 72, attributionControl: { compact: true },
      style: {
        version: 8, projection: { type: 'globe' },
        sky: { 'sky-color': '#0b1430', 'horizon-color': '#3a5ba0', 'fog-color': '#0b1430', 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 1, 9, 0] },
        sources: {
          sat: { type: 'raster', tiles: [sat], tileSize: MT ? 512 : 256, maxzoom: 20, attribution: satAttr },
          ...(MT ? { dem: { type: 'raster-dem', url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MT}`, tileSize: 256 } } : {}),
          roads: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
          lbl: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
          street: MT ? { type: 'raster', tiles: [`https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}@2x.png?key=${MT}`], tileSize: 256, maxzoom: 20, attribution: '© MapTiler © OpenStreetMap contributors' } : { type: 'raster', tiles: ['a', 'b', 'c', 'd'].map(s => `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`), tileSize: 256, maxzoom: 20, attribution: '© OpenStreetMap contributors © CARTO' },
          v: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#0b1430' } },
          { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } },
          { id: 'roads', type: 'raster', source: 'roads', minzoom: 11, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } },
          { id: 'street', type: 'raster', source: 'street' },
          { id: 'lbl', type: 'raster', source: 'lbl', layout: { visibility: 'none' } },
          { id: 'vp', type: 'symbol', source: 'v', layout: { 'icon-image': ['get', 'icon'], 'icon-anchor': 'bottom', 'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 0.72, 14, 0.9, 17, 1.05], 'icon-allow-overlap': ['step', ['zoom'], false, 15.5, true], 'icon-padding': 1, 'symbol-sort-key': ['get', 'rank'], 'symbol-z-order': 'source' } }
        ]
      }
    });
    map.on('load', async () => {
      makePins(); ready = true;
      if (MT) { try { map.setTerrain({ source: 'dem', exaggeration: 1.3 }); } catch (e) { console.warn('terrain', e); } } $m('#mxLoad').classList.add('out');
      useLoc();
      if (pickReturn) { map.jumpTo({ center: CITY.center, zoom: 13, pitch: 0 }); startPick(); }
      /* gentle spin, then dive into the city like Google Earth */
      else map.easeTo({ center: [CITY.center[0] - 10, 20], duration: 1400, easing: t => t });
      if (!pickReturn) setTimeout(() => { if (sel || pickCb) return; if (me && dist(me, CITY.center) < 60) map.flyTo({ center: me, zoom: 13.2, pitch: 50, bearing: -12, duration: 4200, curve: 1.5, essential: true }); else flyCity(4200); }, 1450);
      $m('#mxCount').textContent = 'Finding courts and grounds…';
      const [g, cur, evs] = await Promise.all([loadGuide(), loadCurated(), loadEvents()]);
      guide = g; venues = merge(cur, g.venues, []); events = [...evs, ...g.events]; drawEvents(); data(); refresh();
      const osm = await loadOsm();
      venues = merge(cur, g.venues, osm); data(); refresh();
      if (osmFailed) toast('OpenStreetMap places did not load. Showing the Provn list.');
    });
    map.on('moveend', () => { if (!sel && !pickCb) refresh(); });
    map.on('click', 'vp', e => select(e.features[0].properties.id, true));
    map.on('contextmenu', e => { if (typeof Admin !== 'undefined' && Admin.on() && !pickCb) { buzz(20); venueForm({ lat: +e.lngLat.lat.toFixed(6), lng: +e.lngLat.lng.toFixed(6) }); } });
    ['vp'].forEach(l => { map.on('mouseenter', l, () => map.getCanvas().style.cursor = 'pointer'); map.on('mouseleave', l, () => map.getCanvas().style.cursor = ''); });
    map.on('error', e => console.warn('map', e.error?.message || e));
  }

  /* ---------- load MapLibre on first use ---------- */
  let libP;
  function lib() {
    if (window.maplibregl) return Promise.resolve();
    return libP || (libP = new Promise((res, rej) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'lib/maplibre/maplibre-gl.css'; document.head.appendChild(l);
      const s = document.createElement('script'); s.src = 'lib/maplibre/maplibre-gl.js'; s.onload = res; s.onerror = () => { libP = null; rej(new Error('Map failed to load')); }; document.head.appendChild(s);
    }));
  }

  async function open(opts = {}) {
    if (!root) build();
    root.classList.add('on'); history.pushState({ map: 1 }, '');
    if (opts.filter) { filter = opts.filter; $$m('.mx-chip').forEach(b => b.classList.toggle('on', b.dataset.k === filter)); }
    try { await lib(); } catch (e) { toast(e.message); close(); return; }
    if (opts.pick) pickReturn = opts.pick;
    if (!map) { try { if (window.Cloud && Cloud.user) MT = (await Promise.race([Cloud.config(), new Promise(r => setTimeout(() => r({}), 2500))])).maptiler || ''; } catch (e) { } initMap(); }
    else { map.resize(); if (ready && pinTheme !== (document.documentElement.dataset.theme || 'dusk')) { makePins(); data(); } if (opts.refresh) { events = await loadEvents(); drawEvents(); } refresh(); if (opts.filter) setFilter(opts.filter); }
    if (opts.pick && ready) startPick();
  }
  function close(fromPop) {
    if (!root || !root.classList.contains('on')) return;
    root.classList.remove('on'); $m('#mxForm').hidden = true;
    if (pickCb) { pickCb = null; $m('#mxCross').hidden = true; $m('#mxPick').hidden = true; $m('#mxCards').hidden = false; root.classList.remove('picking'); }
    if (pickReturn) { const r = pickReturn; pickReturn = null; r(null); }
    if (!fromPop && history.state && history.state.map) history.back();
  }
  window.ProvnMap = { ico, _map: () => map, open, close, ACTS, CITY, stats: () => ({ venues: venues.length, events: events.length }), cached: () => (store.get(CACHE, null)?.list || []).length };
})();
