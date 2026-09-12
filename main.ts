// Val Town HTTP val — współdzielone listy zakupów, bez logowania.
// Jeśli ten import zawiedzie, podmień na:  import sqlite from "https://esm.town/v/std/sqlite/main.ts";
import { sqlite } from "https://esm.town/v/std/sqlite";

const WEEK = 7 * 24 * 3600 * 1000;
const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789"; // bez l/1/0/o

let ready: Promise<void> | null = null;
function init() {
  if (!ready) {
    ready = (async () => {
      await sqlite.execute(`CREATE TABLE IF NOT EXISTS lists (
        id TEXT PRIMARY KEY, seq INTEGER NOT NULL DEFAULT 0, last_active INTEGER NOT NULL)`);
      await sqlite.execute(`CREATE TABLE IF NOT EXISTS items (
        list_id TEXT NOT NULL, id TEXT NOT NULL,
        name TEXT, name_c INTEGER, name_d TEXT,
        ord REAL, ord_c INTEGER, ord_d TEXT,
        checked INTEGER, checked_c INTEGER, checked_d TEXT,
        deleted INTEGER, deleted_c INTEGER, deleted_d TEXT,
        seq INTEGER NOT NULL, PRIMARY KEY (list_id, id))`);
      await sqlite.execute(
        `CREATE INDEX IF NOT EXISTS items_by_seq ON items(list_id, seq)`,
      );
      // migracja: nazwa listy z własnym stemplem HLC (istniejące listy dostają NULL)
      for (const col of ["name TEXT", "name_c INTEGER", "name_d TEXT"]) {
        try {
          await sqlite.execute(`ALTER TABLE lists ADD COLUMN ${col}`);
        } catch (_) { /* kolumna już jest */ }
      }
    })();
  }
  return ready;
}

async function q(sql: string, args: any[] = []) {
  const res: any = await sqlite.execute({ sql, args });
  const cols: string[] = res.columns ?? [];
  return (res.rows ?? []).map((r: any) =>
    Object.fromEntries(cols.map((c, i) => [c, Array.isArray(r) ? r[i] : r[c]]))
  );
}

// usuwa listy nietknięte od tygodnia (razem z pozycjami)
async function sweep() {
  const cutoff = Date.now() - WEEK;
  await sqlite.execute({
    sql:
      `DELETE FROM items WHERE list_id IN (SELECT id FROM lists WHERE last_active < ?)`,
    args: [cutoff],
  });
  await sqlite.execute({
    sql: `DELETE FROM lists WHERE last_active < ?`,
    args: [cutoff],
  });
}

const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(10)))
    .map((n) => ALPHABET[n % ALPHABET.length])
    .join("");

const FIELDS = ["name", "ord", "checked", "deleted"] as const;
const wins = (ac: number, ad: string, bc: number, bd: string) =>
  ac !== bc ? ac > bc : (ad ?? "") > (bd ?? "");

async function merge(listId: string, incoming: any[]) {
  const ids = incoming.map((i) => i.id);
  const ph = ids.map(() => "?").join(",");
  const existing = ids.length
    ? await q(`SELECT * FROM items WHERE list_id = ? AND id IN (${ph})`, [
      listId,
      ...ids,
    ])
    : [];
  const byId = new Map(existing.map((r: any) => [r.id, r]));

  const row = await q(`SELECT seq FROM lists WHERE id = ?`, [listId]);
  let seq = Number(row[0]?.seq ?? 0);

  for (const inc of incoming) {
    const cur: any = byId.get(inc.id);
    const out: any = { id: inc.id };
    let changed = false;
    for (const f of FIELDS) {
      const ic = Number(inc[f + "_c"] ?? 0), id_ = String(inc[f + "_d"] ?? "");
      const cc = Number(cur?.[f + "_c"] ?? -1),
        cd = String(cur?.[f + "_d"] ?? "");
      if (!cur || wins(ic, id_, cc, cd)) {
        out[f] = inc[f];
        out[f + "_c"] = ic;
        out[f + "_d"] = id_;
        changed = true;
      } else {
        out[f] = cur[f];
        out[f + "_c"] = cc;
        out[f + "_d"] = cd;
      }
    }
    if (!changed) continue;
    seq++;
    await sqlite.execute({
      sql: `INSERT INTO items (list_id,id,name,name_c,name_d,ord,ord_c,ord_d,
            checked,checked_c,checked_d,deleted,deleted_c,deleted_d,seq)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(list_id,id) DO UPDATE SET
            name=excluded.name,name_c=excluded.name_c,name_d=excluded.name_d,
            ord=excluded.ord,ord_c=excluded.ord_c,ord_d=excluded.ord_d,
            checked=excluded.checked,checked_c=excluded.checked_c,checked_d=excluded.checked_d,
            deleted=excluded.deleted,deleted_c=excluded.deleted_c,deleted_d=excluded.deleted_d,
            seq=excluded.seq`,
      args: [
        listId,
        out.id,
        out.name,
        out.name_c,
        out.name_d,
        out.ord,
        out.ord_c,
        out.ord_d,
        out.checked ? 1 : 0,
        out.checked_c,
        out.checked_d,
        out.deleted ? 1 : 0,
        out.deleted_c,
        out.deleted_d,
        seq,
      ],
    });
  }
  return seq;
}

const json = (data: any) =>
  new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
      "referrer-policy": "no-referrer",
    },
  });

export default async function (req: Request): Promise<Response> {
  await init();
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/api/new" && req.method === "POST") {
    await sweep();
    const id = token();
    await sqlite.execute({
      sql: `INSERT INTO lists (id, seq, last_active) VALUES (?, 0, ?)`,
      args: [id, Date.now()],
    });
    return json({ id });
  }

  const api = path.match(/^\/api\/([a-z2-9]{10})$/);
  if (api) {
    const listId = api[1];
    const cur = await q(
      `SELECT seq, name, name_c, name_d FROM lists WHERE id = ?`,
      [listId],
    );
    if (!cur.length) return json({ gone: true });

    // nazwa listy jest osobnym rejestrem LWW — nie przechodzi przez merge() pozycji
    let nm: string | null = cur[0].name ?? null;
    let nmC = Number(cur[0].name_c ?? 0);
    let nmD = String(cur[0].name_d ?? "");

    let seq: number | null = null;
    if (req.method === "POST") {
      const body = await req.json();
      seq = await merge(listId, body.items ?? []);
      const L = body.list;
      if (L && wins(Number(L.name_c ?? 0), String(L.name_d ?? ""), nmC, nmD)) {
        nm = L.name ?? null;
        nmC = Number(L.name_c ?? 0);
        nmD = String(L.name_d ?? "");
      }
    }
    await sqlite.execute({
      sql: `UPDATE lists SET last_active = ?, seq = COALESCE(?, seq),
            name = ?, name_c = ?, name_d = ? WHERE id = ?`,
      args: [Date.now(), seq, nm, nmC, nmD, listId],
    });

    const since = Number(url.searchParams.get("since") ?? 0);
    const items = await q(
      `SELECT id,name,name_c,name_d,ord,ord_c,ord_d,checked,checked_c,checked_d,
       deleted,deleted_c,deleted_d,seq FROM items WHERE list_id = ? AND seq > ?`,
      [listId, since],
    );
    const head = await q(`SELECT seq FROM lists WHERE id = ?`, [listId]);
    if (Math.random() < 0.02) await sweep();
    return json({
      seq: Number(head[0]?.seq ?? 0),
      name: nm,
      name_c: nmC,
      name_d: nmD,
      items,
    });
  }

  return new Response(HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
    },
  });
}

const HTML = `<!doctype html><html lang="pl"><head>
<meta charset="utf-8"><title>Zakupy</title>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="apple-mobile-web-app-capable" content="yes">
<style>
:root{--paper:#F5F4EF;--card:#fff;--ink:#23261F;--muted:#8B8D82;--line:#E4E2D8;--leaf:#3D6B4A;--soft:#E8F0E9;--clay:#B8452F}
*{box-sizing:border-box;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--paper);color:var(--ink);
font-family:ui-rounded,'SF Pro Rounded','Segoe UI Variable Display',system-ui,sans-serif}
#app{max-width:520px;margin:0 auto;padding:20px 16px 120px}
h1{font-size:30px;font-weight:700;letter-spacing:-.6px;margin:0;cursor:pointer}
.tedit{width:auto;max-width:62%;height:42px;font-size:26px;font-weight:700;letter-spacing:-.5px;
padding:0 10px;border:1px solid var(--leaf);border-radius:12px}
.top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:18px}
.meta{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--muted)}
.dot{width:8px;height:8px;border-radius:4px;background:var(--muted);transition:background .2s}
.add{display:flex;margin-bottom:20px}
input{flex:1;height:52px;padding:0 16px;font:inherit;font-size:17px;color:var(--ink);
background:var(--card);border:1px solid var(--line);border-radius:14px;-webkit-user-select:text;user-select:text}
.plus{display:none}
#active{position:relative}
.row{position:absolute;left:0;right:0;height:54px;display:flex;align-items:center;
padding:0 6px 0 14px;background:var(--card);border:1px solid var(--line);border-radius:14px;
transition:transform .16s ease}
.row.drag{border-color:var(--leaf);box-shadow:0 8px 20px rgba(35,38,31,.16);z-index:10;transition:none}
.tap{display:flex;align-items:center;gap:14px;flex:1;height:100%;background:0;border:0;font:inherit;
font-size:17px;color:inherit;text-align:left;overflow:hidden}
.box{width:24px;height:24px;flex:0 0 auto;border-radius:12px;border:2px solid var(--line)}
.txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.grip{width:46px;height:100%;display:flex;align-items:center;justify-content:center;touch-action:none}
.dots{display:grid;grid-template-columns:repeat(2,4px);gap:5px 5px}
.dots i{width:4px;height:4px;border-radius:2px;background:#C6C4B8;transition:background .15s}
.row.drag .dots i{background:var(--leaf)}
.edit{flex:1;min-width:0;height:38px;padding:0 10px;font:inherit;font-size:17px;color:var(--ink);
background:#fff;border:1px solid var(--leaf);border-radius:10px;-webkit-user-select:text;user-select:text}
.sep{display:flex;align-items:center;gap:12px;margin:28px 2px 12px;font-size:14px;color:var(--muted)}
.sep span{flex:1;height:1px;background:var(--line)}
.done{display:flex;align-items:center;gap:14px;width:100%;height:50px;margin-bottom:6px;padding:0 14px;
background:var(--soft);border:0;border-radius:14px;font:inherit;font-size:17px;color:var(--muted);text-align:left}
.done .box{background:var(--leaf);border-color:var(--leaf);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px}
.done .txt{text-decoration:line-through}
.clear{width:100%;height:50px;margin-top:14px;font:inherit;font-size:16px;color:var(--clay);
background:0;border:1px solid var(--line);border-radius:14px}
.empty{color:var(--muted);font-size:16px;text-align:center;padding:48px 20px;line-height:1.5}
.cta{display:block;width:100%;height:56px;font:inherit;font-size:18px;color:#fff;background:var(--leaf);border:0;border-radius:16px}
button{cursor:pointer}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><div id="app"></div><script>
var ROW=60, POLL=2000, DEV=Math.random().toString(36).slice(2,8), clock=0;
var listId=(location.pathname.match(/^\\/l\\/([a-z2-9]{10})$/)||[])[1];
var items={}, seq=0, drag=null, editing=null, status='start';
var listName='', lnC=-1, lnD='', listDirty=false, titleEditing=false;
function st(){clock=Math.max(Date.now(),clock+1);return{c:clock,d:DEV}}
function better(ac,ad,bc,bd){return ac!==bc?ac>bc:(ad||'')>(bd||'')}
var F=['name','ord','checked','deleted'];

function absorb(list){
  for(var k=0;k<list.length;k++){var r=list[k],cur=items[r.id]||{id:r.id};
    for(var j=0;j<F.length;j++){var f=F[j],rc=+r[f+'_c']||0,rd=r[f+'_d']||'';
      if(rc>clock)clock=rc;
      var cc=cur[f+'_c']===undefined?-1:cur[f+'_c'];
      if(better(rc,rd,cc,cur[f+'_d']||'')){cur[f]=r[f];cur[f+'_c']=rc;cur[f+'_d']=rd}}
    cur.checked=!!cur.checked;cur.deleted=!!cur.deleted;items[r.id]=cur}
}
var pending={};
function push(it){pending[it.id]=it}

async function sync(){
  if(!listId)return;
  var out=Object.keys(pending).map(function(k){return pending[k]});
  var payload=null;
  if(out.length||listDirty){payload={items:out};
    if(listDirty)payload.list={name:listName,name_c:lnC,name_d:lnD}}
  try{
    var res=await fetch('/api/'+listId+'?since='+seq,{method:payload?'POST':'GET',
      headers:{'content-type':'application/json'},
      body:payload?JSON.stringify(payload):undefined});
    var data=await res.json();
    if(data.gone){listId=null;document.getElementById('app').innerHTML=
      '<p class="empty">Ta lista wygasła — była nieużywana przez tydzień.<br>'+
      '<a href="/">Załóż nową</a></p>';return}
    pending={};listDirty=false;
    if(data.items&&data.items.length){absorb(data.items);}
    var rc=+data.name_c||0;
    if(rc>clock)clock=rc;
    if(better(rc,data.name_d||'',lnC,lnD)){listName=data.name||'';lnC=rc;lnD=data.name_d||''}
    paintTitle();
    seq=data.seq;set('ok');render();
  }catch(e){set('off')}
}
function set(s){status=s;var d=document.querySelector('.dot');
  if(d)d.style.background=s==='ok'?'var(--leaf)':s==='off'?'var(--clay)':'var(--muted)'}
function soon(){clearTimeout(soon.t);soon.t=setTimeout(sync,120)}

function live(){var a=[];for(var k in items){var i=items[k];if(!i.deleted)a.push(i)}return a}
function actives(){return live().filter(function(i){return !i.checked})
  .sort(function(a,b){return a.ord-b.ord})}
function dones(){return live().filter(function(i){return i.checked})
  .sort(function(a,b){return (b.checked_c||0)-(a.checked_c||0)})}

function add(name){
  name=name.trim();if(!name)return;
  var a=actives(),id=DEV+'-'+Date.now().toString(36),s=st();
  var it={id:id,name:name,ord:a.length?a[a.length-1].ord+1:0,checked:false,deleted:false};
  F.forEach(function(f){it[f+'_c']=s.c;it[f+'_d']=s.d});
  items[id]=it;push(it);render();soon();
}
function toggle(id){var i=items[id],s=st();i.checked=!i.checked;i.checked_c=s.c;i.checked_d=s.d;
  push(i);render();soon()}
function clearDone(){dones().forEach(function(i){var s=st();i.deleted=true;i.deleted_c=s.c;i.deleted_d=s.d;push(i)});
  render();soon()}
function move(id,from,to){
  if(from===to)return;
  var rest=actives().filter(function(i){return i.id!==id});
  var b=to>0?rest[to-1].ord:null, a=to<rest.length?rest[to].ord:null;
  var o = b===null&&a===null?0 : b===null?a-1 : a===null?b+1 : (a+b)/2;
  var i=items[id],s=st();i.ord=o;i.ord_c=s.c;i.ord_d=s.d;push(i);
  if(b!==null&&a!==null&&Math.abs(a-b)<1e-7){
    actives().forEach(function(x,n){var s2=st();x.ord=n;x.ord_c=s2.c;x.ord_d=s2.d;push(x)})}
  render();soon();
}

function el(t,c,txt){var e=document.createElement(t);if(c)e.className=c;if(txt!=null)e.textContent=txt;return e}

// nazwa listy: tap w nagłówek = edycja, puste pole wraca do "Zakupy"
function titleEl(){
  var h=el('h1',null,listName||'Zakupy');h.id='title';h.onclick=editTitle;return h;
}
function paintTitle(){
  if(titleEditing)return;
  var h=document.getElementById('title');
  if(h)h.textContent=listName||'Zakupy';
  document.title=listName||'Zakupy';
}
function editTitle(){
  if(titleEditing)return;
  titleEditing=true;
  var h=document.getElementById('title');
  var inp=el('input','tedit');inp.value=listName;inp.placeholder='Zakupy';
  inp.maxLength=40;inp.autocomplete='off';
  h.replaceWith(inp);inp.focus();inp.select();
  var restore=function(){titleEditing=false;inp.replaceWith(titleEl());paintTitle()};
  inp.onkeydown=function(e){
    if(e.key==='Enter'){e.preventDefault();inp.blur()}
    if(e.key==='Escape'){inp.onblur=null;restore()}
  };
  inp.onblur=function(){
    if(!titleEditing)return;
    var v=inp.value.trim();
    if(v!==listName){var s=st();listName=v;lnC=s.c;lnD=s.d;listDirty=true;soon()}
    restore();
  };
}

// szkielet budowany RAZ — input nigdy nie jest usuwany, więc focus i klawiatura zostają
function shell(){
  var app=document.getElementById('app');
  app.innerHTML='';
  var top=el('div','top');top.appendChild(titleEl());
  var m=el('div','meta');m.appendChild(el('span','dot'));
  var cnt=el('span');cnt.id='cnt';m.appendChild(cnt);
  top.appendChild(m);app.appendChild(top);

  var addRow=el('div','add');
  var inp=el('input');inp.id='inp';inp.placeholder='Co kupić?';inp.enterKeyHint='done';
  inp.autocapitalize='sentences';inp.autocomplete='off';
  inp.onkeydown=function(e){if(e.key==='Enter'){add(inp.value);inp.value=''}};
  addRow.appendChild(inp);app.appendChild(addRow);

  var box=el('div');box.id='active';app.appendChild(box);
  app.appendChild(el('div')).id='rest';
}

function sig(){var a=[];for(var k in items){var i=items[k];
  a.push(i.id+'|'+i.name+'|'+i.ord+'|'+(i.checked?1:0)+'|'+(i.deleted?1:0))}
  return a.sort().join(';')}
var painted=null;

// przytrzymanie wiersza = edycja nazwy; wyczyszczenie pola = usunięcie pozycji
function startEdit(row,it){
  editing=it.id;
  var txt=row.querySelector('.txt');
  var inp=el('input','edit');inp.value=it.name;inp.autocomplete='off';
  txt.replaceWith(inp);
  inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length);
  var close=function(save){
    if(editing!==it.id)return;
    editing=null;
    if(save){
      var v=inp.value.trim(),s=st();
      if(!v){it.deleted=true;it.deleted_c=s.c;it.deleted_d=s.d;push(it);soon()}
      else if(v!==it.name){it.name=v;it.name_c=s.c;it.name_d=s.d;push(it);soon()}
    }
    painted=null;render();
  };
  inp.onkeydown=function(e){
    if(e.key==='Enter'){e.preventDefault();inp.blur()}
    if(e.key==='Escape'){editing=null;painted=null;render()}
  };
  inp.onblur=function(){close(true)};
}

function render(){
  if(!listId||drag||editing)return;
  var s=sig();if(s===painted)return; // nic się nie zmieniło — nie ruszaj DOM-u
  painted=s;
  var A=actives(),D=dones();
  document.getElementById('cnt').textContent=A.length+' do wzięcia';
  var box=document.getElementById('active');
  var rest=document.getElementById('rest');
  box.innerHTML='';rest.innerHTML='';
  if(!A.length&&!D.length){
    rest.appendChild(el('p','empty','Pusto. Wpisz pierwszą rzecz — kto ma ten link, zobaczy ją u siebie.'));
  }
  box.style.height=(A.length*ROW)+'px';
  A.forEach(function(it,idx){
    var r=el('div','row');r.style.top=(idx*ROW)+'px';r.dataset.idx=idx;
    var t=el('div','tap');t.setAttribute('role','button');t.tabIndex=0;
    t.appendChild(el('span','box'));t.appendChild(el('span','txt',it.name));
    var tm=null,x0=0,y0=0,held=false;
    t.onpointerdown=function(e){
      if(editing)return;
      held=false;x0=e.clientX;y0=e.clientY;
      tm=setTimeout(function(){
        tm=null;held=true;
        if(navigator.vibrate)navigator.vibrate(12);
        startEdit(r,it);
      },450);
    };
    t.onpointermove=function(e){
      if(tm&&(Math.abs(e.clientX-x0)>8||Math.abs(e.clientY-y0)>8)){clearTimeout(tm);tm=null;held=true}
    };
    t.onpointerup=function(){if(tm){clearTimeout(tm);tm=null;if(!held)toggle(it.id)}};
    t.onpointercancel=function(){if(tm){clearTimeout(tm);tm=null}};
    var g=el('div','grip'),dots=el('div','dots');
    for(var n=0;n<6;n++)dots.appendChild(el('i'));
    g.appendChild(dots);
    g.onpointerdown=function(e){e.preventDefault();g.setPointerCapture(e.pointerId);
      drag={id:it.id,i:idx,t:idx,y0:e.clientY};r.classList.add('drag')};
    g.onpointermove=function(e){if(!drag)return;var dy=e.clientY-drag.y0;
      drag.t=Math.max(0,Math.min(A.length-1,drag.i+Math.round(dy/ROW)));
      r.style.transform='translateY('+dy+'px)';
      [].forEach.call(box.children,function(c,n){if(n===drag.i)return;
        var s=0;if(drag.i<drag.t&&n>drag.i&&n<=drag.t)s=-ROW;
        if(drag.i>drag.t&&n>=drag.t&&n<drag.i)s=ROW;
        c.style.transform='translateY('+s+'px)'})};
    g.onpointerup=g.onpointercancel=function(){if(!drag)return;var d=drag;drag=null;move(d.id,d.i,d.t)};
    r.appendChild(t);r.appendChild(g);box.appendChild(r);
  });

  if(D.length){
    var sep=el('div','sep');sep.innerHTML='W koszyku ('+D.length+')<span></span>';rest.appendChild(sep);
    D.forEach(function(it){var b=el('button','done');
      var bx=el('span','box');bx.textContent='✓';b.appendChild(bx);
      b.appendChild(el('span','txt',it.name));b.onclick=function(){toggle(it.id)};rest.appendChild(b)});
    var c=el('button','clear','Usuń kupione ('+D.length+')');c.onclick=clearDone;rest.appendChild(c);
  }
}

function landing(){
  var app=document.getElementById('app');
  app.innerHTML='<div class="top"><h1>Zakupy</h1></div>'+
    '<p class="empty">Wspólna lista bez zakładania konta.<br>Kto dostanie link, ten dodaje i odhacza.<br>'+
    'Lista znika po tygodniu bez użycia.</p>';
  var b=el('button','cta','Załóż nową listę');
  b.onclick=async function(){b.disabled=true;
    var r=await fetch('/api/new',{method:'POST'});var d=await r.json();location.href='/l/'+d.id};
  app.appendChild(b);
}

if(!listId){landing()}else{
  shell();render();sync();
  setInterval(function(){
    if(document.visibilityState==='visible'&&!drag&&!editing&&!titleEditing)sync()},POLL);
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')sync()});
}
</script></body></html>`;