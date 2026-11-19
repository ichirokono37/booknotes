// 読書の種 - 画面とデータ管理
(() => {
'use strict';

// ---------- ユーティリティ ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowISO = () => new Date().toISOString();
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const md = s => {
  if (!s) return '';
  if (s.length === 10) { const [, m, d] = s.split('-'); return `${+m}/${+d}`; }
  const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()}`;
};
const fullDate = s => { const [y, m, d] = s.split('-'); return `${y}/${+m}/${+d}`; };
// メモの記録日時：2026/11/18 22:14
const stamp = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const INTERVALS = [1, 7, 30];
const MAX = 140;

// ---------- データ ----------
const KEY = 'booknotes.v1';
const Store = {
  state: null,
  load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* 読めなければ空で開始 */ }
    this.state = Object.assign({ books: {}, synced: {}, remoteSeen: {}, lastSync: null }, s || {});
  },
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); }
    catch (e) { toast('端末への保存に失敗しました'); }
  },
  touch(b) {
    b.updatedAt = nowISO();
    this.state.books[b.id] = b;
    this.save();
    if (window.Sync) window.Sync.schedule();
  },
  books() { return Object.values(this.state.books).filter(b => !b.deleted); },
  get(id) { const b = this.state.books[id]; return b && !b.deleted ? b : null; },
  // 端末とOneDriveで内容が違うとき：本は新しい方を採用し、メモはIDごとに新しい方を残す
  merge(a, b) {
    const newer = (b.updatedAt || '') > (a.updatedAt || '') ? b : a;
    const out = JSON.parse(JSON.stringify(newer));
    const map = {};
    for (const n of [...(a.notes || []), ...(b.notes || [])]) {
      const p = map[n.id];
      if (!p || (n.updatedAt || n.createdAt) > (p.updatedAt || p.createdAt)) map[n.id] = n;
    }
    out.notes = Object.values(map).sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
    return out;
  },
};
window.Store = Store;

const liveNotes = b => (b.notes || []).filter(n => !n.deleted);
const noteById = (b, id) => liveNotes(b).find(n => n.id === id);
const nextReview = b => (b.reviews || []).find(r => !r.doneAt);
function dueReviews() {
  const t = today(); const out = [];
  for (const b of Store.books()) {
    if (b.status !== 'finished') continue;
    const i = (b.reviews || []).findIndex(r => !r.doneAt);
    if (i >= 0 && b.reviews[i].due <= t) out.push({ b, i, r: b.reviews[i] });
  }
  return out.sort((x, y) => (x.r.due < y.r.due ? -1 : 1));
}
function addNote(b, text, extra = {}) {
  const t = nowISO();
  const n = { id: uid(), type: 'note', text, page: '', chapter: '', createdAt: t, updatedAt: t, ...extra };
  b.notes = b.notes || [];
  b.notes.push(n);
  return n;
}

// ---------- 表示部品 ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
function field(id, label, { max = MAX, value = '', ph = '', rows = 2 } = {}) {
  return `<label class="field" for="${id}"><span class="label">${label}</span>
    <textarea id="${id}" rows="${rows}" maxlength="${max}" placeholder="${esc(ph)}">${esc(value)}</textarea>
    <span class="count" data-for="${id}" data-max="${max}">${value.length}/${max}</span></label>`;
}
function bookRow(b) {
  const n = liveNotes(b).length; const next = nextReview(b);
  let sub = `${b.author ? esc(b.author) + ' · ' : ''}メモ ${n}件`;
  if (b.status === 'finished') {
    if (b.finishedDate) sub += ` · 読了 ${fullDate(b.finishedDate)}`;
    sub += next ? ` · 次の振り返り ${md(next.due)}` : ' · 振り返り完了';
  }
  return `<a class="card row" href="#/book/${b.id}"><div><div class="title">${esc(b.title)}</div><div class="sub">${sub}</div></div><span class="chev">›</span></a>`;
}
function noteItem(n) {
  const label = { recall: '思い出し', reflect: '振り返り' }[n.type];
  const meta = [`<time class="when" datetime="${esc(n.createdAt)}">${stamp(n.createdAt)}</time>`, label ? `<span class="tag">${label}</span>` : '', n.page ? `p.${esc(n.page)}` : '', n.chapter ? esc(n.chapter) : ''].filter(Boolean).join(' · ');
  return `<li class="note ${n.type}"><p>${esc(n.text)}</p><div class="meta">${meta}<button class="link" data-act="delnote" data-id="${n.id}">削除</button></div></li>`;
}
const ACTION_LABEL = { tried: '試した', notyet: 'まだ', skip: 'やめておく' };
function summaryCard(b) {
  const s = b.summary || {};
  const top = (s.top || []).map(id => noteById(b, id)).filter(Boolean);
  const lastAct = (b.actionLog || []).slice(-1)[0];
  const revs = (b.reviews || []).map(r => `<li class="${r.doneAt ? 'done' : ''}"><span>${r.interval}日後</span><span>${r.doneAt ? '✓ ' + md(r.doneAt) : md(r.due)}</span></li>`).join('');
  return `<div class="card summary">${b.finishedDate ? `<p class="status-line finished-on">読了日：${fullDate(b.finishedDate)}</p>` : ''}<div class="kicker">この本のベスト${top.length || ''}</div>
    ${top.length ? `<ol class="best">${top.map(n => `<li>${esc(n.text)}</li>`).join('')}</ol>` : '<p class="muted">（まだ選ばれていません）</p>'}
    ${s.why ? `<div class="kv"><span>なぜ刺さった</span><p>${esc(s.why)}</p></div>` : ''}
    ${s.action ? `<div class="kv action"><span>試すこと</span><p>${esc(s.action)}</p></div>` : ''}
    ${lastAct ? `<p class="status-line">行動：${ACTION_LABEL[lastAct.status] || ''}（${md(lastAct.at)}）</p>` : ''}
    <ul class="timeline">${revs}</ul>
    <a class="link" href="#/finish/${b.id}">まとめを編集</a></div>`;
}
const notFound = () => `<a class="back" href="#/">‹ ホーム</a><p class="empty">見つかりませんでした。</p>`;

// ---------- 画面 ----------
function viewHome() {
  const books = Store.books();
  const reading = books.filter(b => b.status !== 'finished').sort((x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || ''));
  const finKey = b => b.finishedDate || (b.finishedAt || '').slice(0, 10);
  const finished = books.filter(b => b.status === 'finished').sort((x, y) => finKey(y).localeCompare(finKey(x)) || (y.finishedAt || '').localeCompare(x.finishedAt || ''));
  const due = dueReviews();
  let h = '';
  if (due.length) {
    h += `<section><h2 class="sec">今日の振り返り <span class="pill">${due.length}</span></h2>${due.map(({ b, i, r }) =>
      `<a class="card review-card" href="#/review/${b.id}/${i}"><div class="kicker">${r.interval}日後の振り返り${r.due < today() ? '（遅れてもOK）' : ''}</div><div class="title">${esc(b.title)}</div><div class="sub">メモを見ずに思い出してみる · 約2分</div></a>`).join('')}</section>`;
  }
  h += `<section><h2 class="sec">読書中</h2>${reading.length ? reading.map(bookRow).join('')
    : `<p class="empty">${books.length ? '読書中の本はありません。' : '最初の1冊を追加しましょう。<br>読みながら、刺さった一文を1行ずつ残していきます。'}</p>`}</section>`;
  if (finished.length) h += `<section><h2 class="sec">読了 <span class="pill">${finished.length}</span></h2>${finished.map(bookRow).join('')}</section>`;
  h += `<a class="fab" href="#/add">＋ 本を追加</a>`;
  return h;
}

function viewAdd() {
  return `<a class="back" href="#/">‹ 戻る</a><h1>本を追加</h1>
  <form data-form="add" class="stack">
    <label class="field"><span class="label">タイトル</span><input id="title" required maxlength="100" autocomplete="off"></label>
    <label class="field"><span class="label">著者（任意）</span><input id="author" maxlength="60" autocomplete="off"></label>
    <button class="btn primary big">読み始める</button>
  </form>`;
}

function viewBook(b) {
  const fin = b.status === 'finished';
  const notes = liveNotes(b).slice().reverse();
  let h = `<a class="back" href="#/">‹ 一覧</a><h1>${esc(b.title)}</h1>${b.author ? `<p class="author">${esc(b.author)}</p>` : ''}`;
  if (fin) h += summaryCard(b);
  h += `<form data-form="note" class="card capture">
    ${field('noteText', fin ? '学びを書き足す' : '刺さった一文・気づき', { ph: fin ? 'あとから気づいたこと、試した結果など' : '1行でOK。うまく書こうとしなくて大丈夫' })}
    <div class="inline">
      <label class="mini"><span>p.</span><input id="notePage" inputmode="numeric" maxlength="5" autocomplete="off"></label>
      <label class="mini grow"><span>章</span><input id="noteChapter" maxlength="30" value="${esc(b.lastChapter || '')}" placeholder="任意" autocomplete="off"></label>
      <button class="btn primary">残す</button>
    </div>
  </form>`;
  if (!fin) {
    h += `<div class="actions"><button class="btn" data-act="recall">章を読み終えた</button><a class="btn accent" href="#/finish/${b.id}">読了した →</a></div>
    <p class="hint">「章を読み終えた」は、本を閉じて覚えていることを1行書く練習です。読了時は、ここに残したメモから選ぶだけです。</p>`;
  }
  h += `<section><h2 class="sec">メモ <span class="pill">${notes.length}</span></h2>${notes.length ? `<ul class="notes">${notes.map(noteItem).join('')}</ul>` : '<p class="empty">まだメモはありません。</p>'}</section>
  <div class="danger-zone"><button class="link danger" data-act="delbook">この本を削除</button></div>`;
  return h;
}

let finishDraft = null; // 読了画面の入力途中の内容
function viewFinish(b) {
  const s = b.summary || {};
  if (!finishDraft || finishDraft.bookId !== b.id) {
    finishDraft = { bookId: b.id, ids: new Set((s.top || []).filter(id => noteById(b, id))), why: s.why || '', action: s.action || '', date: b.finishedDate || '' };
  }
  const notes = liveNotes(b);
  const editing = b.status === 'finished';
  return `<a class="back" href="#/book/${b.id}">‹ 戻る</a>
  <h1>${editing ? 'まとめを編集' : '読了おつかれさまでした'}</h1>
  <p class="lead">ゼロから書く必要はありません。残したメモから<b>特に大事なものを最大3つ</b>選ぶだけです。</p>
  <section><h2 class="sec">1. ベスト3を選ぶ <span class="pill" id="selCount">${finishDraft.ids.size}/3</span></h2>
    ${notes.length ? `<ul class="pick">${notes.map(n => {
      const on = finishDraft.ids.has(n.id);
      return `<li><button type="button" class="pickbtn${on ? ' on' : ''}" data-act="pick" data-id="${n.id}" aria-pressed="${on}"><span class="check"></span><span>${esc(n.text)}<small class="pick-date">${stamp(n.createdAt)}</small></span></button></li>`;
    }).join('')}</ul>` : '<p class="empty">メモがありません。思い出せることを1つ書いてみましょう。</p>'}
    <form data-form="quicknote" class="inline-form"><input id="quickNote" maxlength="${MAX}" placeholder="メモにない学びを追加" autocomplete="off"><button class="btn">追加</button></form>
  </section>
  <form data-form="finish" class="stack">
    <section><h2 class="sec">2. ひとことずつ（空欄でもOK）</h2>
    <div class="stack">
      ${field('why', 'なぜ刺さった？', { value: finishDraft.why, ph: '自分の仕事や状況とのつながり' })}
      ${field('action', '明日から試すこと1つ', { value: finishDraft.action, ph: '例：会議の最初に目的を1文で言う' })}
    </div></section>
    <section><h2 class="sec">3. 読了日（任意・あとからでもOK）</h2>
      <div class="date-row">
        <input type="date" id="finishDate" value="${esc(finishDraft.date)}" max="${today()}" aria-label="読了日">
        <button type="button" class="btn" data-act="datetoday">今日</button>
        <button type="button" class="btn ghost" data-act="dateclear">クリア</button>
      </div>
      <p class="hint">空欄のままでも保存できます。</p>
    </section>
    <button class="btn primary big">${editing ? 'まとめを更新' : '読了として保存'}</button>
    ${editing ? '' : '<p class="hint">保存すると、1日後・7日後・30日後に振り返りがホームに表示されます。</p>'}
  </form>`;
}

let reviewDraft = null; // { key, stage, recall }
function viewReview(b, i) {
  const r = (b.reviews || [])[i];
  if (!r) return notFound();
  const key = `${b.id}/${i}`;
  if (!reviewDraft || reviewDraft.key !== key) reviewDraft = { key, stage: 1, recall: '' };
  if (r.doneAt && reviewDraft.stage === 1) {
    return `<a class="back" href="#/">‹ ホーム</a><h1>${esc(b.title)}</h1><p class="empty">この振り返りは ${md(r.doneAt)} に完了しています。</p><a class="btn big" href="#/book/${b.id}">本のページへ</a>`;
  }
  const s = b.summary || {};
  if (reviewDraft.stage === 1) {
    return `<a class="back" href="#/">‹ ホーム</a><div class="kicker">${r.interval}日後の振り返り</div><h1>${esc(b.title)}</h1>
    <p class="lead">メモは見ずに、この本から学んだことを思い出して書いてみましょう。1つだけでも、うろ覚えでもOKです。思い出そうとすること自体が記憶を強くします。</p>
    <form data-form="review1" class="stack">
      ${field('recallText', '覚えていること', { max: 280, rows: 4, value: reviewDraft.recall })}
      <button class="btn primary big">答え合わせ</button>
      <button type="button" class="btn ghost" data-act="cantrecall">思い出せない…答えを見る</button>
    </form>`;
  }
  const top = (s.top || []).map(id => noteById(b, id)).filter(Boolean);
  return `<a class="back" href="#/">‹ ホーム</a><div class="kicker">答え合わせ</div><h1>${esc(b.title)}</h1>
    <div class="card"><div class="kicker">あなたが思い出したこと</div><p>${reviewDraft.recall ? esc(reviewDraft.recall) : '<span class="muted">（今回は思い出せなかった。大丈夫、次で思い出せます）</span>'}</p></div>
    <div class="card summary"><div class="kicker">読了時のベスト${top.length || ''}</div>
      ${top.length ? `<ol class="best">${top.map(n => `<li>${esc(n.text)}</li>`).join('')}</ol>` : '<p class="muted">（未選択）</p>'}
      ${s.why ? `<div class="kv"><span>なぜ刺さった</span><p>${esc(s.why)}</p></div>` : ''}
      ${s.action ? `<div class="kv action"><span>試すこと</span><p>${esc(s.action)}</p></div>` : ''}
    </div>
    <form data-form="review2" class="stack">
      ${s.action ? `<fieldset class="choice"><legend>「${esc(s.action)}」は試せましたか？</legend>${Object.entries(ACTION_LABEL).map(([v, l]) => `<label><input type="radio" name="act" value="${v}"><span>${l}</span></label>`).join('')}</fieldset>` : ''}
      ${field('result', '気づき・結果（任意）', { ph: 'やってみてどうだった？ 改めて思ったこと' })}
      <button class="btn primary big">振り返り完了</button>
    </form>`;
}

function viewSettings() {
  const info = window.Sync ? window.Sync.info() : { configured: false };
  const cfg = window.BOOKNOTES_CONFIG || {};
  let sync;
  if (!info.configured) {
    sync = `<p>OneDrive同期は未設定です。いまは<b>この端末の中だけ</b>に保存しています。</p><p class="hint">SETUP.md の手順でアプリを登録し、config.js に clientId を設定すると同期できるようになります。</p>`;
  } else if (!info.signedIn) {
    sync = `<p>Microsoftアカウントでサインインすると、OneDriveに自動で同期します。</p><button class="btn primary big" data-act="signin">Microsoftでサインイン</button>`;
  } else {
    sync = `<dl><dt>アカウント</dt><dd>${esc(info.username)}</dd><dt>状態</dt><dd>${esc(info.label)}${info.message ? '：' + esc(info.message) : ''}</dd><dt>最終同期</dt><dd>${Store.state.lastSync ? new Date(Store.state.lastSync).toLocaleString('ja-JP') : 'まだ'}</dd></dl>
    ${info.status === 'reauth' ? '<button class="btn primary big" data-act="reauth">もう一度サインイン</button>' : '<button class="btn big" data-act="syncnow">今すぐ同期</button>'}
    <button class="link danger" data-act="signout">サインアウト</button>`;
  }
  return `<a class="back" href="#/">‹ ホーム</a><h1>同期と設定</h1>
  <div class="card settings"><div class="kicker">OneDrive同期</div>${sync}</div>
  <div class="card settings"><div class="kicker">保存先</div><dl><dt>OneDrive</dt><dd>${esc(cfg.dataPath || '')}</dd><dt>本の数</dt><dd>${Store.books().length}冊</dd></dl></div>
  <div class="card settings"><div class="kicker">バックアップ</div><p class="hint">全データをJSONファイルとして書き出します。</p><button class="btn" data-act="export">JSONを書き出す</button></div>`;
}

// ---------- ルーティングと描画 ----------
function route() {
  if (!location.hash.startsWith('#/')) return [];
  return location.hash.slice(2).split('/').filter(Boolean).map(decodeURIComponent);
}
let pendingRender = false;
function render() {
  const [v = 'home', a, b] = route();
  const book = a ? Store.get(a) : null;
  let html;
  switch (v) {
    case 'add': html = viewAdd(); break;
    case 'book': html = book ? viewBook(book) : notFound(); break;
    case 'finish': html = book ? viewFinish(book) : notFound(); break;
    case 'review': html = book ? viewReview(book, Number(b)) : notFound(); break;
    case 'settings': html = viewSettings(); break;
    default: html = viewHome();
  }
  $('#app').innerHTML = html;
  pendingRender = false;
}
function isEditing() {
  const el = document.activeElement;
  return el && /^(TEXTAREA|INPUT)$/.test(el.tagName) && el.value.trim() !== '';
}
const currentBook = () => { const [, id] = route(); return id ? Store.get(id) : null; };
const val = id => (($('#' + id) || {}).value || '').trim();

// ---------- 操作 ----------
const actions = {
  recall() {
    const b = currentBook(); if (!b) return;
    $('#modal').innerHTML = `<div class="overlay" data-act="closemodal"><form class="sheet" data-form="chapterrecall">
      <h2>本を閉じて、思い出してみる</h2>
      <p class="lead">この章で覚えていることを1行で書いてみましょう。見返すのは書いたあとで。</p>
      ${field('recallNote', '覚えていること')}
      <label class="mini grow"><span>章</span><input id="recallChapter" maxlength="30" value="${esc(b.lastChapter || '')}" placeholder="任意" autocomplete="off"></label>
      <div class="actions"><button type="button" class="btn ghost" data-act="closemodal">閉じる</button><button class="btn primary">残す</button></div>
    </form></div>`;
    $('#recallNote').focus();
  },
  closemodal() { $('#modal').innerHTML = ''; },
  delnote(el) {
    const b = currentBook(); if (!b) return;
    if (!confirm('このメモを削除しますか？')) return;
    const n = (b.notes || []).find(x => x.id === el.dataset.id); if (!n) return;
    n.deleted = true; n.updatedAt = nowISO();
    if (b.summary && b.summary.top) b.summary.top = b.summary.top.filter(id => id !== n.id);
    Store.touch(b); render();
  },
  delbook() {
    const b = currentBook(); if (!b) return;
    if (!confirm(`「${b.title}」を削除しますか？ メモもすべて消えます。`)) return;
    b.deleted = true; Store.touch(b); location.hash = '#/'; toast('削除しました');
  },
  pick(el) {
    const id = el.dataset.id; const set = finishDraft.ids;
    if (set.has(id)) set.delete(id);
    else if (set.size >= 3) { toast('選べるのは3つまでです'); return; }
    else set.add(id);
    el.classList.toggle('on', set.has(id)); el.setAttribute('aria-pressed', set.has(id));
    $('#selCount').textContent = `${set.size}/3`;
  },
  datetoday() { const el = $('#finishDate'); el.value = today(); finishDraft.date = el.value; },
  dateclear() { const el = $('#finishDate'); el.value = ''; finishDraft.date = ''; },
  cantrecall() { reviewDraft.recall = ''; reviewDraft.stage = 2; render(); window.scrollTo(0, 0); },
  signin() { window.Sync.signIn(); },
  reauth() { window.Sync.signIn(); },
  signout() { if (confirm('サインアウトしますか？ 端末内のデータは残ります。')) window.Sync.signOut(); },
  syncnow() { window.Sync.run(true); },
  export() {
    const blob = new Blob([JSON.stringify(Store.books(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `booknotes-${today()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};

const forms = {
  add() {
    const title = val('title'); if (!title) return;
    const t = nowISO();
    const b = { id: uid(), title, author: val('author'), status: 'reading', createdAt: t, notes: [], reviews: [], actionLog: [], summary: null };
    Store.touch(b); location.hash = `#/book/${b.id}`;
  },
  note() {
    const b = currentBook(); if (!b) return;
    const text = val('noteText'); if (!text) { toast('1行だけでも書いてみましょう'); return; }
    const chapter = val('noteChapter');
    addNote(b, text, { page: val('notePage'), chapter });
    b.lastChapter = chapter;
    Store.touch(b); render(); toast('残しました');
    $('#noteText').focus();
  },
  chapterrecall() {
    const b = currentBook(); if (!b) return;
    const text = val('recallNote'); if (!text) { toast('うろ覚えでも大丈夫です'); return; }
    const chapter = val('recallChapter');
    addNote(b, text, { type: 'recall', chapter });
    b.lastChapter = chapter;
    Store.touch(b); actions.closemodal(); render(); toast('思い出しメモを残しました');
  },
  quicknote() {
    const b = currentBook(); if (!b) return;
    const text = val('quickNote'); if (!text) return;
    const n = addNote(b, text);
    if (finishDraft.ids.size < 3) finishDraft.ids.add(n.id);
    Store.touch(b); render();
  },
  finish() {
    const b = currentBook(); if (!b) return;
    b.summary = { top: [...finishDraft.ids].slice(0, 3), why: val('why'), action: val('action') };
    const date = val('finishDate');
    b.finishedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    const first = b.status !== 'finished';
    if (first) {
      b.status = 'finished'; b.finishedAt = nowISO();
      b.reviews = INTERVALS.map(n => ({ interval: n, due: addDays(n), doneAt: null }));
    }
    Store.touch(b); finishDraft = null;
    location.hash = `#/book/${b.id}`;
    toast(first ? '読了を記録しました。明日、振り返りましょう' : 'まとめを更新しました');
  },
  review1() { reviewDraft.recall = val('recallText'); reviewDraft.stage = 2; render(); window.scrollTo(0, 0); },
  review2(f) {
    const b = currentBook(); if (!b) return;
    const i = Number(route()[2]); const r = b.reviews[i]; if (!r) return;
    const status = (f.querySelector('input[name="act"]:checked') || {}).value || '';
    const result = val('result');
    r.doneAt = nowISO(); r.recall = reviewDraft.recall; r.actionStatus = status;
    // 遅れて振り返った場合、次以降の予定を今日から数え直す
    for (let j = i + 1; j < b.reviews.length; j++) b.reviews[j].due = addDays(b.reviews[j].interval - r.interval);
    if (status || result) (b.actionLog = b.actionLog || []).push({ at: r.doneAt, status, result });
    if (result) addNote(b, result, { type: 'reflect' });
    Store.touch(b); reviewDraft = null;
    const next = b.reviews[i + 1];
    location.hash = '#/';
    toast(next ? `おつかれさまでした。次は ${md(next.due)} です` : 'この本の振り返りはすべて完了です');
  },
};

document.addEventListener('click', e => {
  // 今いる画面へのリンク（設定画面で⚙を押したときなど）は、画面を描き直して反応を返す
  const link = e.target.closest('a[href^="#/"]');
  if (link && link.getAttribute('href') === location.hash) { e.preventDefault(); actions.closemodal(); render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.classList.contains('overlay') && e.target !== el) return; // シートの内側のクリックでは閉じない
  const fn = actions[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  e.preventDefault();
  const fn = forms[f.dataset.form]; if (fn) fn(f);
});
document.addEventListener('input', e => {
  const t = e.target;
  const c = document.querySelector(`.count[data-for="${t.id}"]`);
  if (c) c.textContent = `${t.value.length}/${c.dataset.max}`;
  if (finishDraft && (t.id === 'why' || t.id === 'action')) finishDraft[t.id] = t.value;
  if (finishDraft && t.id === 'finishDate') finishDraft.date = t.value;
  if (reviewDraft && t.id === 'recallText') reviewDraft.recall = t.value;
});
document.addEventListener('focusout', () => { if (pendingRender) setTimeout(() => { if (!isEditing()) render(); }, 0); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal').innerHTML) actions.closemodal(); });
window.addEventListener('hashchange', () => { actions.closemodal(); render(); window.scrollTo(0, 0); });

// ---------- 同期ステータス表示 ----------
function showSync(status, label) {
  const el = $('#sync'); el.dataset.state = status; $('#syncText').textContent = label;
  if (route()[0] === 'settings' && !isEditing()) render();
}

// ---------- 起動 ----------
Store.load();
render();
if (window.Sync) {
  window.Sync.onStatus(showSync);
  window.Sync.onChange(() => { if (isEditing() || $('#modal').innerHTML) pendingRender = true; else render(); });
  window.Sync.init().then(r => { if (r && r.justSignedIn) location.hash = '#/settings'; });
}
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || isLocal)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
})();
