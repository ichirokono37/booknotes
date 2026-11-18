// 読書の種 - OneDrive同期（Microsoft Graph）
// 本1冊を1つのJSONファイル（book-<id>.json）として、config.js の dataPath に保存します。
window.Sync = (() => {
  'use strict';
  const cfg = window.BOOKNOTES_CONFIG || {};
  const SCOPES = ['Files.ReadWrite'];
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const LABELS = {
    off: '端末のみ', signedout: '未サインイン', idle: '同期済み', syncing: '同期中…',
    offline: 'オフライン', reauth: '要サインイン', error: '同期エラー',
  };

  let pca = null, account = null, status = 'off', message = '';
  let running = false, again = false, timer = null;
  const statusFns = [], changeFns = [];

  const store = () => window.Store;
  const setStatus = (s, msg = '') => { status = s; message = msg; statusFns.forEach(f => f(s, LABELS[s] || s)); };
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
  const encPath = p => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const folder = () => `/me/drive/root:/${encPath(cfg.dataPath || 'BookNotes/data')}`;

  async function init() {
    if (!cfg.clientId) { setStatus('off'); return null; }
    if (!window.msal) { setStatus('error', 'ログイン用ライブラリを読み込めませんでした'); return null; }
    let justSignedIn = false;
    try {
      pca = new msal.PublicClientApplication({
        auth: { clientId: cfg.clientId, authority: cfg.authority, redirectUri: redirectUri(), navigateToLoginRequestUrl: false },
        cache: { cacheLocation: 'localStorage' },
      });
      await pca.initialize();
      const res = await pca.handleRedirectPromise();
      if (res && res.account) { account = res.account; justSignedIn = true; }
    } catch (e) {
      console.error(e);
      setStatus('error', 'サインインに失敗しました');
    }
    if (pca) account = account || pca.getAllAccounts()[0] || null;
    if (!account) { if (status !== 'error') setStatus('signedout'); return { justSignedIn }; }
    setStatus('idle');
    run();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); });
    window.addEventListener('online', () => run());
    return { justSignedIn };
  }

  function signIn() {
    if (!pca) return;
    pca.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
  }
  async function signOut() {
    const a = account; account = null; setStatus('signedout');
    if (pca && a) await pca.logoutRedirect({ account: a, postLogoutRedirectUri: redirectUri() });
  }

  async function token() {
    try {
      const r = await pca.acquireTokenSilent({ scopes: SCOPES, account });
      return r.accessToken;
    } catch (e) {
      if (e instanceof msal.InteractionRequiredAuthError || /interaction_required|login_required|consent_required/.test(e.errorCode || '')) {
        const err = new Error('reauth'); err.reauth = true; throw err;
      }
      throw e;
    }
  }
  async function graph(url, opts = {}) {
    const t = await token();
    const res = await fetch(url.startsWith('http') ? url : GRAPH + url, {
      ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) },
    });
    if (res.status === 401) { const err = new Error('reauth'); err.reauth = true; throw err; }
    return res;
  }

  async function listRemote() {
    let res = await graph(`${folder()}:/children?$top=200`);
    if (res.status === 404) return []; // フォルダがまだ無い（最初のアップロードで作られる）
    if (!res.ok) throw new Error(`一覧の取得に失敗（${res.status}）`);
    let j = await res.json(); const items = [...j.value];
    while (j['@odata.nextLink']) {
      res = await graph(j['@odata.nextLink']);
      if (!res.ok) throw new Error(`一覧の取得に失敗（${res.status}）`);
      j = await res.json(); items.push(...j.value);
    }
    return items;
  }

  async function run(manual = false) {
    if (!account) return;
    if (running) { again = true; return; }
    if (!navigator.onLine) { setStatus('offline'); return; }
    running = true; setStatus('syncing');
    const S = store(); const st = S.state; let changed = false;
    try {
      // 1) OneDrive側で更新された本を取り込む
      const remote = await listRemote();
      for (const item of remote) {
        const m = /^book-(.+)\.json$/.exec(item.name || '');
        if (!m || !item.file) continue;
        const id = m[1];
        if (st.remoteSeen[id] === item.eTag) continue;
        const url = item['@microsoft.graph.downloadUrl'];
        if (!url) continue;
        const r = await fetch(url);
        if (!r.ok) continue;
        const rb = await r.json();
        const lb = st.books[id];
        const merged = lb ? S.merge(lb, rb) : rb;
        st.books[id] = merged;
        st.remoteSeen[id] = item.eTag;
        // 取り込んだ内容がOneDriveと同じなら「同期済み」、端末側に追加分があれば後でアップロード
        if (JSON.stringify(merged) === JSON.stringify(rb)) st.synced[id] = merged.updatedAt;
        else delete st.synced[id];
        changed = true;
      }
      S.save();
      if (changed) changeFns.forEach(f => f());

      // 2) 端末側で更新された本をアップロード
      for (const id of Object.keys(st.books)) {
        const b = st.books[id];
        if (st.synced[id] === b.updatedAt) continue;
        const stamp = b.updatedAt; const body = JSON.stringify(b, null, 1);
        const res = await graph(`${folder()}/${encodeURIComponent('book-' + id + '.json')}:/content`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body,
        });
        if (!res.ok) throw new Error(`保存に失敗（${res.status}）`);
        const it = await res.json();
        if (st.books[id].updatedAt === stamp) st.synced[id] = stamp;
        st.remoteSeen[id] = it.eTag;
        S.save();
      }
      st.lastSync = new Date().toISOString(); S.save();
      setStatus('idle');
    } catch (e) {
      console.error(e);
      if (e.reauth) setStatus('reauth', 'もう一度サインインしてください');
      else if (!navigator.onLine) setStatus('offline');
      else setStatus('error', e.message || String(e));
    } finally {
      running = false;
      if (again) { again = false; run(); }
    }
    if (manual && status === 'idle') changeFns.forEach(f => f());
  }

  function schedule() {
    if (!account) return;
    clearTimeout(timer); timer = setTimeout(() => run(), 1500);
  }

  function info() {
    return {
      configured: !!cfg.clientId && !!pca, signedIn: !!account,
      username: account ? (account.username || account.name || '') : '',
      status, label: LABELS[status] || status, message,
    };
  }

  return {
    init, signIn, signOut, run, schedule, info,
    onStatus: f => statusFns.push(f), onChange: f => changeFns.push(f),
  };
})();
