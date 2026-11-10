// =====================================================================
//  可愛捉迷藏 CUTE HIDE & SEEK — 共用遊戲核心
//  連線層：claude room（artifact）／ WebSocket（自架）／ 單機
//  權威模型：房主（id 最小的玩家）執行世界狀態與鬼 AI，透過 presence 廣播
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const $ = id => document.getElementById(id);
const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const NORENDER = location.search.includes('norender');
const MODE = window.HS_MODE || (window.claude?.use ? 'room' : 'ws');

// ===================== 地圖（1 格 = 1 公尺） =====================
const W_ = 40, H_ = 32;
const G = [...Array(H_)].map(() => Array(W_).fill('#'));
const rect = (x0, z0, x1, z1, c) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) G[z][x] = c; };
const ROOMS = [
  { id:'dining', name:'餐廳',   r:[1,1,11,8],   floor:'wood' },
  { id:'cell',   name:'懲戒室', r:[13,1,19,8],  floor:'stone' },
  { id:'store',  name:'儲藏室', r:[21,1,25,3],  floor:'wood' },
  { id:'conf',   name:'告解室', r:[22,5,24,8],  floor:'wood' },
  { id:'dir',    name:'院長室', r:[27,1,38,8],  floor:'wood' },
  { id:'corr',   name:'走廊',   r:[1,10,38,11], floor:'stone' },
  { id:'prayer', name:'禱告室', r:[1,13,11,20], floor:'wood' },
  { id:'hall',   name:'大廳',   r:[13,13,20,20],floor:'wood' },
  { id:'class',  name:'教室',   r:[22,13,26,20],floor:'wood' },
  { id:'dorm',   name:'宿舍',   r:[28,13,38,20],floor:'wood' },
  { id:'yard',   name:'庭院',   r:[1,22,38,30], floor:'grass' },
  { id:'shed',   name:'工具間', r:[33,27,38,30], floor:'wood' },
];
ROOMS.forEach(R => rect(...R.r, R.id === 'yard' ? ',' : '.'));
rect(32, 26, 38, 26, '#'); rect(32, 26, 32, 30, '#'); // 工具間外牆
const DOORS = [
  { id:'dn', x:6,  z:9 }, { id:'cell', x:16, z:9, cell:1 }, { id:'cf', x:23, z:9 },
  { id:'st', x:23, z:4, lock:'code', lid:'storage' }, { id:'dir', x:32, z:9, lock:'key', key:'dkey' },
  { id:'pr', x:6,  z:12 }, { id:'h1', x:19, z:12 }, { id:'h2', x:20, z:12 }, { id:'cl', x:24, z:12 }, { id:'hc', x:21, z:16 }, { id:'dm', x:33, z:12 },
  { id:'shed', x:35, z:26, lock:'pry' },
];
DOORS.forEach(d => G[d.z][d.x] = 'D');
G[21][19] = G[21][20] = '.';           // 大廳通往庭院的拱門
G[31][19] = G[31][20] = 'G';           // 正門
G[16][0] = 'P';                        // 密道
const SAFE = new Set(['1,1','2,1','38,19','38,20','13,20','1,30','2,30','38,10','1,10','11,22','26,20']);
const FURN = new Set();
const key = (x, z) => x + ',' + z;
const tileOf = v => Math.floor(v);
const inRect = (x, z, r) => x >= r[0] && x < r[2] + 1 && z >= r[1] && z < r[3] + 1;
const roomAt = (x, z) => ROOMS.find(R => inRect(x, z, R.r));
const isSafe = (x, z) => SAFE.has(key(tileOf(x), tileOf(z)));
const doorAt = (tx, tz) => DOORS.find(d => d.x === tx && d.z === tz);
const SPAWN_V = [[18.5,29.2],[20.5,29.2],[17.5,28.2],[21.5,28.2],[19.5,27.5],[16.5,29.2],[22.5,29.2],[19.5,28.5]];
const SPAWN_C = [[6.5,15.4],[8.5,15.4],[6.5,17.4],[8.5,17.4],[5.2,19.5],[9.5,19.5],[7.5,15.4],[7.5,17.4]];
const CELL_IN = [16.5, 4.5];
const PRAYER = ROOMS.find(r => r.id === 'prayer').r;
const CONF = ROOMS.find(r => r.id === 'conf').r;
const CELLR = ROOMS.find(r => r.id === 'cell').r;
const WAYPOINTS = [[32.5,4.5],[8.5,10.5],[30.5,11],[19.5,10.5],[6.5,4.5],[16.5,4.5],[23.5,7.5],[23.5,2],[6.5,19],[17,16.5],[24,16.5],[33.5,16.5],[10.5,26.5],[27.5,26.5],[19.5,24.5],[36.5,5],[35.5,28.5],[3.5,11]];

// ===================== 遊戲資料 =====================
const PHASES = [
  { n:'早上', sky:0xa9c2d8, hemi:1.15, sun:2.4, sunC:0xfff0d6, fog:0xa9c2d8, fogN:25, fogF:80 },
  { n:'中午', sky:0xb8d4ec, hemi:1.3,  sun:3.0, sunC:0xffffff, fog:0xb8d4ec, fogN:30, fogF:90 },
  { n:'傍晚', sky:0xb5532e, hemi:0.55, sun:1.3, sunC:0xff8c4a, fog:0x4a2418, fogN:12, fogF:55 },
  { n:'深夜', sky:0x04050b, hemi:0.045,sun:0.10,sunC:0x7088c8, fog:0x020306, fogN:4,  fogF:26 },
];
// 白天縮短、深夜加長（秒）
const DUR = [[90,90,90,480],[150,150,150,720],[210,210,210,900]];
const ROLES = [
  { f:'v', n:'記者',       tasks:['替三處證據拍照：大廳照片牆、懲戒室、院長室保險箱', '在院長室書櫃找到「失蹤兒童名單」'] },
  { f:'v', n:'前院童',     tasks:['找回小時候的舊玩偶，帶著它逃出去或放上祭壇', '在宿舍牆上找到自己當年的刻痕'] },
  { f:'v', n:'警探',       tasks:['找到並讀完院長日記', '用紫外線手電筒在懲戒室門內側找到指紋'] },
  { f:'v', n:'神父',       tasks:['在禱告室祭壇前為孩子們禱告（按住 E）', '依正確順序點亮祭壇的四支蠟燭'] },
  { f:'c', n:'尋親的姊姊', tasks:['在懲戒室找到妹妹留下的名牌', '在教室找到妹妹畫的那張圖'] },
  { f:'c', n:'小偷',       tasks:['親手打開院長室的保險箱', '用撬棍撬開餐廳的捐款箱'] },
  { f:'c', n:'研究員',     tasks:['在告解室留下證詞錄音', '解開儲藏室的實驗紀錄箱'] },
  { f:'c', n:'修女',       tasks:['深夜時到庭院的水井旁祈禱', '用發條鑰匙替大廳的音樂盒上發條'] },
];
const ITEMS = {
  dkey:{ n:'院長室鑰匙', ic:'🗝️', d:'一把生鏽的黃銅鑰匙，掛牌上寫著「院長室」。' },
  matches:{ n:'火柴', ic:'🔥', d:'一盒受潮的火柴，還能點幾根。可以點燃禱告室的蠟燭。' },
  uv:{ n:'紫外線手電筒', ic:'🔦', d:'拿在身上時，看得見牆上、物品上平常看不見的字。（可以交給隊友）' },
  crowbar:{ n:'撬棍', ic:'🪛', d:'沉甸甸的鐵撬棍。可以撬開釘死的木板或箱子──但聲音很大。' },
  cutter:{ n:'斷線鉗', ic:'✂️', d:'可以剪斷粗鐵鍊。' },
  cuffkey:{ n:'手銬鑰匙', ic:'🔑', d:'小小的銀色鑰匙。可以替被銬住的人解開手銬（靠近對方按 E）。' },
  gk1:{ n:'大門鑰匙（上半）', ic:'🔩', d:'一把大鑰匙的上半段。找到另一半就能拼起來。' },
  gk2:{ n:'大門鑰匙（下半）', ic:'🔩', d:'一把大鑰匙的下半段。和上半段合在一起就能用。' },
  gk:{ n:'大門鑰匙', ic:'🗝️', d:'拼好的正門鑰匙，可以打開大門上的大鎖。' },
  windkey:{ n:'發條鑰匙', ic:'🔧', d:'小小的黃銅發條鑰匙。大廳好像有個音樂盒。' },
  diary:{ n:'院長日記', ic:'📕', d:'' },
  doll:{ n:'舊玩偶', ic:'🧸', d:'縫線脫落的布偶，背後繡著「小安」。是孩子們的遺物之一。' },
  tag:{ n:'褪色的名牌', ic:'🏷️', d:'名牌上寫著「莉莎，5 歲」。背面用指甲刻著：姊姊。是孩子們的遺物之一。' },
  photo:{ n:'院童合照', ic:'🖼️', d:'照片裡每個孩子都在笑，笑得一模一樣。是孩子們的遺物之一。' },
};
const RELICS = ['doll','diary','tag','photo'];
const DIARY = [
  '「1998 年 3 月。孩子們說，喜歡我笑的樣子。所以我一直笑著。」',
  '「2005 年 11 月。他們一個一個被帶走了。我去報警，警察看著我的笑臉，說我在說謊。」',
  '「我把他們的東西收好了：小安的玩偶、莉莎的名牌、那張大家都在笑的合照。」',
  '「如果有一天，有人在月亮升起的時候，把孩子們的東西帶回祭壇──也許祂就能想起來，自己原本是誰。」',
  '最後一頁被撕掉了。',
];
const LORE = {
  well:['井口的石頭上刻著一段話：','「祂戴著微笑，因為孩子們說喜歡祂笑。」','「祂的腳上有鐐銬，走起來會響。聽見鐵鍊聲，就躲進點著蠟燭的角落──祂不會進去那裡。」'],
  conf:['告解室的木格窗後面貼著一張紙條：','「這裡很安靜，說話的聲音傳不出去。」','「如果你們要商量什麼，就在這裡說吧。」'],
  notice:['大廳的公告欄：','「熄燈後禁止在走廊奔跑。院長會聽見。」','「安全角落永遠點著蠟燭。害怕的時候，就去那裡。」','「大門的封印，只有月亮升起時才撕得下來。」'],
  poem:['禱告室牆上掛著一首詩：','床頭燭影伴孤眠','下弦月冷照庭前','第一聲鐘人未醒','三更笑語夢中連','……把每一句的第一個字連起來讀看看。'],
  candlehint:['祭壇旁的小木牌：','「點燈之前，先讓看不見的字現形。」','「由最小的開始。」'],
  menu:['牆上的配餐表：','週一 3 ｜ 週二 5 ｜ 週三 9 ｜ 週四 17','週五 □ ｜ 週六 □','下面潦草地寫著：「櫥櫃密碼＝週五和週六的數字。」'],
  board:['教室黑板上寫著一排數字：','1 · 1 · 2 · 3 · 5 · 8 · □ · □','旁邊畫了一個箭頭，寫著「儲藏室的門」。'],
  ledger:['書桌上攤開一本帳本，最後一頁寫著：','「保險箱──」','第一位：☆ ＋ ○','第二位：◇ － △','第三位：□ － ○','第四位：△ ＋ ○','……這些符號代表的數字，一定寫在哪裡。'],
  uvtable:['紫光下，牆上浮現出一張對照表：','☆＝3　◇＝8　△＝5','○＝2　□＝7'],
  nouv:['牆面上有被擦掉的痕跡。','好像寫過什麼，但肉眼看不見。'],
  cellclue:['牆上用粉筆寫著：','「排隊囉！由最小的孩子開始，只喊名字的第一個字。」','（木箱上的字輪鎖有四格）'],
  cellwall:['牆上用指甲刻滿了字：','「姊姊，救我。──莉莎」'],
  dorm:['宿舍牆上的規定：','「孩子們依床號就寢：一號床在最西邊。」','「熄燈後不准說話。」'],
  photowall:['照片牆上掛滿了合照。','每一張裡，孩子們都在笑。笑得一模一樣。','角落的位置，有一張照片沒有被釘牢。'],
  altar:['祭壇的石面上刻著：','「當月亮升起，讓祂想起孩子們。」','似乎可以把孩子們的遺物放在上面。'],
  files:['書櫃裡夾著一份名單：','「2005 年 送出名單：安娜、米哈、伊凡、莉莎……」','後面還有好多名字，每一個都被畫上了笑臉。'],
  drawings:['牆上貼滿孩子們的蠟筆畫。','每張畫裡都有一個高高的黑色人影，臉上畫著大大的笑。','角落有一張署名「莉莎」：畫裡的黑影，腳上拖著鐵鍊。'],
  piano:['你按下一個琴鍵。','走音的琴聲在屋子裡迴盪了很久……','好像有什麼東西，停下了腳步。'],
  musicbox:['桌上有個小小的音樂盒，發條已經鬆了。','底部有個小孔，需要發條鑰匙。'],
  lab:['木箱上放著一本實驗紀錄，箱子扣著兩位數的密碼鎖。','「笑容測試：5、10、20、40、□」','「箱子的密碼就是空格。」'],
  fire:['壁爐裡只剩冷掉的灰。','灰燼裡有一張燒了一半的紙：「……祂不會進去有燭光的地方……」'],
  donation:['一個上了鎖的木製捐款箱，投幣口被釘死了。','用撬棍應該撬得開。'],
  shedsign:['工具間的門被木板釘死了。','需要撬棍。'],
  sokoinfo:['工作台上有個奇怪的工具箱，箱蓋是一個滑塊機關。','把三塊鐵塊推到刻著記號的位置，箱子才會打開。'],
  gate:['大門上了三道鎖：','① 纏繞的粗鐵鍊（需要斷線鉗）','② 一把大掛鎖（需要完整的大門鑰匙）','③ 一張畫著笑臉的封印──只有深夜才撕得下來'],
  cupboard:['櫥櫃裡排滿了玻璃罐，標籤都被撕掉了。'],
  crate:['木箱裡塞滿了發霉的舊衣服。'],
  bedEmpty:['床底下只有灰塵和一隻死掉的蛾。'],
};
const BEDS = [['安娜',7],['米哈',3],['伊凡',9],['莉莎',5]];
const CANDLE_ORDER = [2, 1, 3, 0];               // 依紫外光下的算式由小到大：III(1) II(4) IV(6) I(9)
const CANDLE_EQ = ['3×3', '2+2', '10−9', '4+2'];
const LOCKUI = {
  kitchen:{ type:'pad', len:4, t:'廚房櫥櫃的密碼鎖' },
  storage:{ type:'pad', len:4, t:'儲藏室門上的密碼鎖' },
  safe:{ type:'pad', len:4, t:'院長室保險箱' },
  lab:{ type:'pad', len:2, t:'實驗紀錄箱' },
  cellbox:{ type:'wheel', n:4, chars:['安','伊','米','莉','笑','院'], t:'木箱上的字輪鎖' },
  sudoku:{ type:'sudoku', t:'講台抽屜的數獨鎖' },
  sokoban:{ type:'soko', t:'滑塊工具箱' },
};
const CODES = { kitchen:'3365', storage:'1321', safe:'5357', lab:'80', cellbox:'米莉安伊' };
const LOCK_AT = { kitchen:[5,2.4], storage:[23.5,4.5], safe:[37.4,2.6], lab:[22.3,3.3], cellbox:[17.6,4.5], sudoku:[24,16], sokoban:[35.5,28.9] };
const SUDOKU_P = [[0,0,0,4],[0,4,0,0],[0,0,3,0],[2,0,0,0]];
const SUDOKU_S = [[3,2,1,4],[1,4,2,3],[4,1,3,2],[2,3,4,1]];
const SOKO_LV = ['########','###  . #','#  $#  #','# $ @$ #','#.  #  #','### .  #','########'];

// ===================== Three.js 基本 =====================
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
function fitView() { const w = innerWidth, h = innerHeight; if (!w || !h) return; renderer.setSize(w, h); if (typeof camera !== 'undefined') { camera.aspect = w / h; camera.updateProjectionMatrix(); } }
addEventListener('resize', fitView);
try { new ResizeObserver(fitView).observe(document.documentElement); } catch {}
document.addEventListener('fullscreenchange', fitView);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 10, 60);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 120);
camera.rotation.order = 'YXZ';
scene.add(camera);
const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3026, 1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(30, 40, 45); sun.target.position.set(20, 0, 16);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left:-30, right:30, top:30, bottom:-30, near:1, far:120 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const flash = new THREE.SpotLight(0xfff2d6, 0, 16, 0.46, 0.45, 1.3);
flash.position.set(0.15, -0.15, 0); camera.add(flash); camera.add(flash.target); flash.target.position.set(0, -0.1, -3);
const moon = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), new THREE.MeshBasicMaterial({ color:0xe9ecff, fog:false }));
moon.position.set(20, 38, 70); moon.lookAt(20, 0, 16); scene.add(moon);

// ---- 程序化貼圖 ----
function ctex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  if (rep) t.repeat.set(rep[0], rep[1]); return t;
}
function speckle(g, w, h, n, cols, a = 0.5, s0 = 1, s1 = 4) {
  for (let i = 0; i < n; i++) { g.globalAlpha = a * Math.random(); g.fillStyle = cols[i % cols.length]; const s = s0 + Math.random() * (s1 - s0); g.fillRect(Math.random() * w, Math.random() * h, s, s); }
  g.globalAlpha = 1;
}
const TEX = {
  wall: ctex(256, 768, (g, w, h) => {
    g.fillStyle = '#b8a98f'; g.fillRect(0, 0, w, h); speckle(g, w, h, 3000, ['#8c7d66', '#cbbda3', '#6f6250'], .35);
    for (let i = 0; i < 6; i++) { const cx = Math.random()*w, cy = Math.random()*h*.7; const gr = g.createRadialGradient(cx, cy, 4, cx, cy, 60 + Math.random()*80); gr.addColorStop(0,'rgba(70,55,35,.35)'); gr.addColorStop(1,'rgba(70,55,35,0)'); g.fillStyle = gr; g.fillRect(0,0,w,h); }
    const y = h * .72; g.fillStyle = '#4a3324'; g.fillRect(0, y, w, h - y); g.fillStyle = '#2e1f15'; g.fillRect(0, y, w, 10);
    for (let x = 0; x < w; x += 64) { g.fillStyle = '#3a281b'; g.fillRect(x, y + 10, 3, h - y); } speckle(g, w, y > 0 ? w : 1, 0, []);
  }),
  stoneWall: ctex(256, 640, (g, w, h) => {
    g.fillStyle = '#6d665d'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 40) for (let x = (y / 40) % 2 ? -32 : 0; x < w; x += 64) { g.fillStyle = `hsl(30,6%,${30 + Math.random()*14}%)`; g.fillRect(x + 2, y + 2, 60, 36); }
    speckle(g, w, h, 2000, ['#3c3832', '#8a8276'], .4);
  }),
  wood: ctex(256, 256, (g, w, h) => {
    for (let y = 0; y < h; y += 32) { g.fillStyle = `hsl(28,38%,${24 + Math.random()*10}%)`; g.fillRect(0, y, w, 32); g.fillStyle = '#1e140c'; g.fillRect(0, y, w, 2); const o = Math.random()*w; g.fillRect(o, y, 2, 32); }
    speckle(g, w, h, 1500, ['#2b1c10', '#6b4a2e'], .35, 1, 6);
  }),
  stone: ctex(256, 256, (g, w, h) => {
    g.fillStyle = '#4a4640'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 64) for (let x = 0; x < w; x += 64) { g.fillStyle = `hsl(35,5%,${32 + Math.random()*10}%)`; g.fillRect(x + 2, y + 2, 60, 60); }
    speckle(g, w, h, 2500, ['#2c2a26', '#77716a'], .35);
  }),
  grass: ctex(256, 256, (g, w, h) => {
    g.fillStyle = '#3d4a2a'; g.fillRect(0, 0, w, h); speckle(g, w, h, 6000, ['#556b34', '#2a331c', '#6b5b3a', '#7a8a4a'], .6, 1, 3);
  }),
  ceil: ctex(128, 128, (g, w, h) => { g.fillStyle = '#5a5248'; g.fillRect(0, 0, w, h); speckle(g, w, h, 900, ['#3a342c', '#77705f'], .4); }),
};

// ===================== 模型載入 =====================
const CHARS = ['seo','daeun','nari','tae','haena','yena','chan','jiho'];
const MODEL_LIST = [...CHARS.map(c => 'char-' + c), 'ghost', 'desk-v1', 'chair-v1', 'sofa-v1', 'armchair-v1', 'round-table-v1', 'side-chair-v1', 'counter-v1', 'low-shelf-v1', 'round-rug-v1', 'coffee-table-v1', 'olive-v1', 'ficus-v1', 'stool-v1', 'woven-rug-v1', 'credenza-v1', 'mobile-board-v1', 'production-table-v1', 'bookcase-v1'];
const M = {};
const loader = new GLTFLoader();
async function loadModels(onProg) {
  let n = 0;
  await Promise.all(MODEL_LIST.map(name => new Promise((res, rej) => {
    const done = g => { M[name] = g; onProg(++n, MODEL_LIST.length); res(); };
    const b64 = window.__MODELS?.[name];
    if (b64) { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer; loader.parse(bin, '', done, rej); }
    else loader.load(`assets/${name}.glb`, done, undefined, rej);
  })));
}

// ===================== 場景建構 =====================
const interactables = [];
const doorMeshes = {};
const candleMeshes = [];
let gateL, gateR, secretBlock, altarRelics = {};
const safeLights = [];

function mat(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: .85, ...extra }); }
function box(w, h, d, m, x, y, z, parent = scene) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; }
function markFurn(obj, shrink = 0.05) {
  obj.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(obj);
  for (let z = Math.floor(b.min.z); z <= Math.floor(b.max.z); z++) for (let x = Math.floor(b.min.x); x <= Math.floor(b.max.x); x++) {
    const cx = x + .5, cz = z + .5;
    if (cx > b.min.x + shrink && cx < b.max.x - shrink && cz > b.min.z + shrink && cz < b.max.z - shrink && G[z]?.[x] && G[z][x] !== '#') FURN.add(key(x, z));
  }
}
function put(name, x, z, rot = 0, s = 1, furn = true) {
  const o = M[name].scene.clone(true); o.position.set(x, 0, z); o.rotation.y = rot; o.scale.setScalar(s);
  o.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
  scene.add(o); if (furn) markFurn(o); return o;
}
function textPlane(lines, w, h, opt = {}) {
  const px = 512, ph = Math.round(px * h / w);
  const t = ctex(px, ph, (g) => {
    g.fillStyle = opt.bg || '#e8dfc8'; g.fillRect(0, 0, px, ph);
    if (opt.border) { g.strokeStyle = opt.border; g.lineWidth = 12; g.strokeRect(6, 6, px - 12, ph - 12); }
    g.fillStyle = opt.fg || '#2a1d12'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const fs = opt.size || 44; g.font = `700 ${fs}px "Noto Serif TC", serif`;
    lines.forEach((l, i) => g.fillText(l, px / 2, ph / 2 + (i - (lines.length - 1) / 2) * fs * 1.35));
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: .9 }));
}
function onWall(mesh, x, y, z, face) { // face: 'n' 貼在北牆（朝 +z）等
  mesh.position.set(x, y, z); mesh.rotation.y = { n:0, s:Math.PI, w:Math.PI/2, e:-Math.PI/2 }[face]; scene.add(mesh); return mesh;
}
function glowSprite(color, size) {
  const t = ctex(64, 64, (g) => { const gr = g.createRadialGradient(32,32,0,32,32,32); gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0,0,64,64); });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:t, blending:THREE.AdditiveBlending, depthWrite:false, transparent:true }));
  s.scale.setScalar(size); return s;
}
function addI(o) { interactables.push(o); return o; }
const uvMeshes = [];
// ---- 小道具 ----
const PROP = {};
function woodMat(c = 0xffffff) { return mat(c, { map: TEX.wood }); }
function crate(x, z, s = .6, rot = 0, y = 0, furn = false) { const o = box(s, s, s, woodMat(0xc9a67a), x, y + s / 2, z); o.rotation.y = rot; for (const k of [-1, 1]) { const b = box(s + .01, .05, s + .01, woodMat(0x6b4a2a), 0, k * s * .35, 0, o); b.castShadow = false; } if (furn) markFurn(o); return o; }
function barrel(x, z) { const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g); const b = new THREE.Mesh(new THREE.CylinderGeometry(.3, .33, .9, 14), woodMat(0x8a5a33)); b.position.y = .45; b.castShadow = b.receiveShadow = true; g.add(b); for (const y of [.18, .72]) { const r = new THREE.Mesh(new THREE.TorusGeometry(.325, .015, 6, 18), mat(0x2a2a2a, { metalness: .6 })); r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r); } return g; }
function shelf(x, z, rot, w = 1.2, h = 1.8, jars = false) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g); const wm = woodMat(0x7a5236);
  box(w, h, .04, wm, 0, h / 2, -.18, g); for (const sx of [-w / 2, w / 2]) box(.04, h, .4, wm, sx, h / 2, 0, g);
  for (let i = 0; i < 4; i++) { const y = .08 + i * (h - .16) / 3; box(w, .035, .4, wm, 0, y, 0, g); if (i === 3) continue;
    let x0 = -w / 2 + .06;
    while (x0 < w / 2 - .12) {
      if (jars) { const j = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .17, 8), mat(new THREE.Color().setHSL(Math.random(), .35, .35), { transparent: true, opacity: .8, roughness: .2 })); j.position.set(x0 + .05, y + .1, 0); g.add(j); x0 += .13; }
      else { const bw = .035 + Math.random() * .05, bh = .17 + Math.random() * .14; const bk = box(bw, bh, .22, mat(new THREE.Color().setHSL(Math.random(), .45, .2 + Math.random() * .15)), x0 + bw / 2, y + .02 + bh / 2, 0, g); bk.castShadow = false; if (Math.random() < .08) bk.rotation.z = .25; x0 += bw + .006; }
    } }
  return g;
}
function cobweb(x, y, z, rot) {
  const t = PROP.web ??= ctex(128, 128, g => { g.strokeStyle = 'rgba(235,235,235,.5)'; for (let i = 0; i < 9; i++) { const a = i / 8 * Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 128, Math.sin(a) * 128); g.stroke(); } for (let r = 14; r < 128; r += 14) { g.beginPath(); for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2, rr = r * (1 - .08 * Math.sin(i * 1.7)); i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.stroke(); } });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true }));
  m.position.set(x, y, z); m.rotation.set(0, rot, 0); scene.add(m);
}
function painting(x, y, z, face, seed, w = .7, h = .9, creepy = false) {
  const t = ctex(140, 180, g => {
    const gr = g.createLinearGradient(0, 0, 0, 180); gr.addColorStop(0, `hsl(${20 + seed * 37 % 60},25%,22%)`); gr.addColorStop(1, '#0d0907'); g.fillStyle = gr; g.fillRect(0, 0, 140, 180);
    g.fillStyle = '#c9b49a'; g.beginPath(); g.ellipse(70, 75, 30, 38, 0, 0, 7); g.fill(); g.fillStyle = '#2a1c12'; g.fillRect(40, 112, 60, 68);
    g.fillStyle = '#111'; g.beginPath(); g.arc(58, 70, 4, 0, 7); g.arc(82, 70, 4, 0, 7); g.fill();
    g.strokeStyle = '#3a1a10'; g.lineWidth = 3; g.beginPath(); creepy ? g.arc(70, 84, 18, .1, Math.PI - .1) : g.arc(70, 88, 9, .3, Math.PI - .3); g.stroke();
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: .7 }));
  const f = new THREE.Mesh(new THREE.PlaneGeometry(w + .12, h + .12), mat(0x3a2412)); f.position.z = -.006; m.add(f);
  return onWall(m, x, y, z, face);
}
function wallClock(x, y, z, face) {
  const t = ctex(128, 128, g => { g.fillStyle = '#e6dcc4'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#2a1c12'; g.lineWidth = 6; g.stroke(); for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillStyle = '#2a1c12'; g.fillRect(64 + Math.cos(a) * 48 - 2, 64 + Math.sin(a) * 48 - 2, 4, 4); } g.lineWidth = 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 24); g.moveTo(64, 64); g.lineTo(88, 72); g.stroke(); });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return onWall(new THREE.Mesh(new THREE.CircleGeometry(.28, 28), new THREE.MeshStandardMaterial({ map: t, roughness: .6 })), x, y, z, face);
}
function schoolDesk(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g); const wm = woodMat(0xb08860), iron = mat(0x2c2c2c, { metalness: .5 });
  box(.75, .04, .5, wm, 0, .7, 0, g); for (const [sx, sz] of [[-.33, -.2], [.33, -.2], [-.33, .2], [.33, .2]]) box(.03, .7, .03, iron, sx, .35, sz, g);
  box(.4, .03, .36, wm, 0, .42, .5, g); box(.4, .35, .03, wm, 0, .62, .68, g); for (const sx of [-.17, .17]) box(.03, .42, .03, iron, sx, .21, .5, g);
  const pap = box(.2, .005, .28, mat(0xe8e2d0), (Math.random() - .5) * .3, .725, 0, g); pap.rotation.y = Math.random();
  markFurn(g, .1); return g;
}
function bear(x, y, z, c = 0x8a5a3a) {
  const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g); const m = mat(c, { roughness: 1 });
  const s = (r, px, py, pz) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), m); o.position.set(px, py, pz); o.castShadow = true; g.add(o); return o; };
  s(.11, 0, .11, 0); s(.08, 0, .26, 0); s(.03, -.06, .32, 0); s(.03, .06, .32, 0); s(.04, -.1, .05, .05); s(.04, .1, .05, .05);
  const eye = mat(0x050505); for (const ex of [-.025, .025]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.01, 6, 6), eye); e.position.set(ex, .28, .075); g.add(e); }
  return g;
}
function toyBlocks(x, z) { for (let i = 0; i < 6; i++) { const b = box(.12, .12, .12, mat(new THREE.Color().setHSL(i / 6, .55, .45)), x + (i % 3) * .14 + Math.random() * .03, .06 + (i >= 4 ? .12 : 0), z + Math.floor(i / 3) * .15); b.rotation.y = Math.random(); } }
function candleStand(x, z, h = 1.2) {
  const iron = mat(0x1a1a1a, { metalness: .6 }); const p = new THREE.Mesh(new THREE.CylinderGeometry(.025, .12, h, 8), iron); p.position.set(x, h / 2, z); p.castShadow = true; scene.add(p);
  const c = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .2, 8), mat(0xefe6d2)); c.position.set(x, h + .1, z); scene.add(c);
  const g = glowSprite('rgba(255,170,70,1)', .3); g.position.set(x, h + .26, z); scene.add(g); nightGlows.push(g);
}
const nightGlows = [];
function sconce(x, y, z) { const b = box(.12, .25, .08, mat(0x2a2014, { metalness: .4 }), x, y, z); b.castShadow = false; const g = glowSprite('rgba(255,170,80,1)', .35); g.position.set(x, y + .2, z); scene.add(g); nightGlows.push(g); }
function rockingHorse(x, z, rot = 0) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g); const wm = woodMat(0xc49a6c), red = mat(0x8a2a22);
  const rk = new THREE.Mesh(new THREE.TorusGeometry(.5, .03, 6, 20, Math.PI * .6), wm); rk.rotation.z = Math.PI * 1.2; rk.position.y = .52; for (const sz of [-.15, .15]) { const r = rk.clone(); r.position.z = sz; g.add(r); }
  box(.6, .22, .2, wm, 0, .45, 0, g); box(.14, .35, .14, wm, .28, .65, 0, g); box(.25, .14, .14, wm, .4, .8, 0, g); box(.2, .04, .22, red, -.05, .57, 0, g);
  markFurn(g, .2);
}
function piano(x, z, rot) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g); const bm = mat(0x140c08, { roughness: .35, metalness: .1 });
  box(1.5, 1.2, .55, bm, 0, .6, 0, g); box(1.5, .06, .35, bm, 0, .74, .42, g);
  const kt = ctex(256, 32, c => { c.fillStyle = '#e8e2d2'; c.fillRect(0, 0, 256, 32); c.fillStyle = '#111'; for (let i = 0; i < 36; i++) { c.fillRect(i * 7.1, 0, 1, 32); if ([1, 2, 4, 5, 6].includes(i % 7)) c.fillRect(i * 7.1 - 2, 0, 4, 19); } });
  const keys_ = new THREE.Mesh(new THREE.PlaneGeometry(1.4, .17), new THREE.MeshStandardMaterial({ map: kt, roughness: .4 })); keys_.rotation.x = -Math.PI / 2; keys_.position.set(0, .775, .5); g.add(keys_);
  for (const sx of [-.7, .7]) box(.06, .74, .06, bm, sx, .37, .55, g); candleStandOn(g, -.5, 1.2, 0);
  markFurn(g, .1); return g;
}
function candleStandOn(parent, x, y, z) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .15, 8), mat(0xefe6d2)); c.position.set(x, y + .07, z); parent.add(c); const gl = glowSprite('rgba(255,170,70,1)', .22); gl.position.set(x, y + .2, z); parent.add(gl); nightGlows.push(gl); }
function graveCross(x, z, r = 0) { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.set(0, r, (Math.random() - .5) * .2); scene.add(g); const wm = woodMat(0x5a4632); box(.07, .7, .05, wm, 0, .35, 0, g); box(.36, .06, .05, wm, 0, .52, 0, g); const mound = new THREE.Mesh(new THREE.SphereGeometry(.35, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x3a2e20)); mound.scale.set(1, .25, 1.6); mound.position.z = .45; g.add(mound); }
function swingSet(x, z) { const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g); const iron = mat(0x3a2a20, { metalness: .4 }); for (const sx of [-1, 1]) { const l1 = box(.06, 2.3, .06, iron, sx, 1.1, -.35, g); l1.rotation.x = .3; const l2 = box(.06, 2.3, .06, iron, sx, 1.1, .35, g); l2.rotation.x = -.3; } box(2.1, .06, .06, iron, 0, 2.2, 0, g); const seat = new THREE.Group(); seat.position.set(0, 2.2, 0); g.add(seat); for (const sx of [-.2, .2]) box(.015, 1.7, .015, mat(0x777777), sx, -.85, 0, seat); box(.5, .04, .2, woodMat(0x6b4a2a), 0, -1.7, 0, seat); PROP.swing = seat; markFurn(g, .3); }
function lamppost(x, z) { const p = box(.08, 2.4, .08, mat(0x1a1a1a, { metalness: .5 }), x, 1.2, z); const g = glowSprite('rgba(255,190,110,1)', .5); g.position.set(x, 2.45, z); scene.add(g); nightGlows.push(g); }
function uvText(lines, w, h, x, y, z, face) {
  const m = textPlane(lines, w, h, { bg: 'rgba(0,0,0,0)', fg: '#b7f', size: 46 }); m.material.transparent = true; m.material.emissive = new THREE.Color(0x7a3cff); m.material.emissiveIntensity = .9; m.material.emissiveMap = m.material.map; m.material.depthWrite = false;
  onWall(m, x, y, z, face); m.visible = false; uvMeshes.push(m); return m;
}

function buildWorld() {
  // ---------------- 結構 ----------------
  const wallGeo = new THREE.BoxGeometry(1, 3.2, 1); wallGeo.translate(0, 1.6, 0);
  const yardGeo = new THREE.BoxGeometry(1, 2.6, 1); yardGeo.translate(0, 1.3, 0);
  const inW = [], outW = [];
  for (let z = 0; z < H_; z++) for (let x = 0; x < W_; x++) if (G[z][x] === '#') (z >= 22 ? outW : inW).push([x, z]);
  for (const [list, geo, tex] of [[inW, wallGeo, TEX.wall], [outW, yardGeo, TEX.stoneWall]]) {
    const im = new THREE.InstancedMesh(geo, mat(0xffffff, { map: tex }), list.length);
    const m4 = new THREE.Matrix4(); list.forEach(([x, z], i) => { m4.makeTranslation(x + .5, 0, z + .5); im.setMatrixAt(i, m4); });
    im.castShadow = im.receiveShadow = true; scene.add(im);
  }
  for (const R of ROOMS) {
    const [x0, z0, x1, z1] = R.r, w = x1 - x0 + 1, d = z1 - z0 + 1;
    const t = TEX[R.floor].clone(); t.needsUpdate = true; t.repeat.set(w / 2, d / 2);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(0xffffff, { map: t }));
    m.rotation.x = -Math.PI / 2; m.position.set(x0 + w / 2, R.id === 'shed' ? .004 : 0, z0 + d / 2); m.receiveShadow = true; scene.add(m);
  }
  const doorFloor = new THREE.PlaneGeometry(1, 1);
  for (const [x, z] of [...DOORS.map(d => [d.x, d.z]), [19, 21], [20, 21]]) { const m = new THREE.Mesh(doorFloor, mat(0xffffff, { map: TEX.stone })); m.rotation.x = -Math.PI / 2; m.position.set(x + .5, 0.006, z + .5); scene.add(m); }
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat(0x2a2e22)); outside.rotation.x = -Math.PI / 2; outside.position.set(20, -0.02, 16); scene.add(outside);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(40, 22), mat(0xffffff, { map: (() => { const t = TEX.ceil.clone(); t.needsUpdate = true; t.repeat.set(20, 11); return t; })(), side: THREE.DoubleSide, emissive: 0x4a4238, emissiveMap: TEX.ceil }));
  ceilMat = ceil.material;
  ceil.rotation.x = Math.PI / 2; ceil.position.set(20, 3.2, 11); scene.add(ceil);
  box(6.4, .1, 4.6, mat(0x3a3028), 35.6, 2.62, 28.5).castShadow = true; // 工具間屋頂
  // 門
  const doorMat = woodMat(0x8a5a3a);
  for (const d of DOORS) {
    const wallH = d.z >= 22 ? 2.6 : 3.2;
    const alongZ = G[d.z - 1][d.x] !== '#' && G[d.z + 1][d.x] !== '#';
    const pivot = new THREE.Group();
    if (alongZ) pivot.position.set(d.x, 0, d.z + .5); else { pivot.position.set(d.x + .5, 0, d.z); pivot.rotation.y = -Math.PI / 2; }
    box(0.98, 2.4, 0.07, d.lock === 'key' ? woodMat(0x5a3020) : d.cell ? mat(0x4a4a4e, { metalness: .6, roughness: .5 }) : doorMat, .5, 1.2, 0, pivot);
    if (d.cell) for (let i = 0; i < 4; i++) box(0.04, 0.5, 0.09, mat(0x111111), .2 + i * .2, 1.85, 0, pivot);
    box(0.06, 0.06, 0.16, mat(0xc9a24a, { metalness: .8, roughness: .3 }), .85, 1.1, 0, pivot);
    if (d.lock === 'code') { box(.16, .22, .12, mat(0x222222, { metalness: .6 }), .78, 1.35, 0, pivot); }
    let boards = null;
    if (d.lock === 'pry') { boards = new THREE.Group(); for (const [y, r] of [[.6, .25], [1.3, -.2], [2.0, .15]]) { const b = box(1.25, .14, .05, woodMat(0x9a7a52), .5, y, alongZ ? -.06 : .06, boards); b.rotation.z = r; } pivot.add(boards); }
    const lh = wallH - 2.4; box(1, lh, 1, mat(0xffffff, { map: d.z >= 22 ? TEX.stoneWall : TEX.wall }), d.x + .5, 2.4 + lh / 2, d.z + .5).castShadow = false;
    scene.add(pivot); doorMeshes[d.id] = { pivot, base: pivot.rotation.y, cur: 0, dir: alongZ ? (d.z <= 9 ? 1 : -1) : -1, boards };
  }
  box(2, 0.8, 1, mat(0xffffff, { map: TEX.wall }), 20, 2.8, 21.5);
  // 正門：鐵鍊、大鎖、封印
  const iron = mat(0x1b1b1d, { metalness: .7, roughness: .4 });
  gateL = new THREE.Group(); gateR = new THREE.Group(); gateL.position.set(19, 0, 31.5); gateR.position.set(21, 0, 31.5);
  for (const [g, s] of [[gateL, 1], [gateR, -1]]) { for (let i = 0; i < 7; i++) box(0.05, 2.6, 0.05, iron, s * (0.08 + i * 0.14), 1.3, 0, g); box(1, 0.08, 0.06, iron, s * .5, 2.4, 0, g); box(1, 0.08, 0.06, iron, s * .5, 0.4, 0, g); scene.add(g); }
  const chainM = mat(0x777777, { metalness: .9, roughness: .3 });
  gateParts.chain = []; for (let i = 0; i < 14; i++) { const l = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), chainM); l.position.set(.55 + i * .065, 1.1 + Math.sin(i * .7) * .12, -.05); l.rotation.y = i % 2 ? Math.PI / 2 : 0; gateL.add(l); gateParts.chain.push(l); }
  gateParts.lock = box(.16, .2, .07, mat(0xb08a3a, { metalness: .8, roughness: .3 }), .98, .95, -.08, gateL);
  gateParts.seal = textPlane(['☺', '封'], .32, .5, { bg: '#e8dcc0', fg: '#7a1010', size: 150 }); gateParts.seal.position.set(1, 1.6, -.06); gateParts.seal.rotation.y = Math.PI; gateL.add(gateParts.seal);
  secretBlock = box(1, 3.2, 1, mat(0xffffff, { map: TEX.wall }), 0.5, 1.6, 16.5);
  for (const [x, z] of [[1.3, 1.3], [11.7, 1.3], [13.3, 1.3], [19.7, 7.7], [27.3, 1.3], [38.7, 7.7], [1.3, 19.7], [25.7, 1.3], [37.7, 13.3], [26.7, 13.3]]) cobweb(x, 2.75, z, Math.PI / 4 + Math.random());

  // ---------------- 餐廳／廚房 ----------------
  put('counter-v1', 5, 1.55, 0);
  const tabs = [put('round-table-v1', 4.5, 5.5, 0, .75), put('round-table-v1', 8.5, 5.5, 0, .75)];
  for (const [x, z, r] of [[4.5,4.0,0],[4.5,7.0,Math.PI],[3.0,5.5,Math.PI/2],[8.5,4.0,0],[8.5,7.0,Math.PI],[10.0,5.5,-Math.PI/2]]) put('side-chair-v1', x, z, r, 1, false);
  const tipped = put('side-chair-v1', 6.6, 7.6, .7, 1, false); tipped.rotation.z = 1.45; tipped.position.y = .25;
  for (const t of tabs) { const top = new THREE.Box3().setFromObject(t).max.y; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + .4; const pl = new THREE.Mesh(new THREE.CylinderGeometry(.11, .09, .02, 14), mat(0xe8e2d4, { roughness: .3 })); pl.position.set(t.position.x + Math.cos(a) * .55, top + .012, t.position.z + Math.sin(a) * .55); scene.add(pl); } const cup = new THREE.Mesh(new THREE.CylinderGeometry(.04, .035, .09, 10), mat(0xd8d0c0)); cup.position.set(t.position.x, top + .045, t.position.z); scene.add(cup); }
  const fp = new THREE.Group(); fp.position.set(1.32, 0, 4.5); scene.add(fp);
  box(.6, 1.3, 1.7, mat(0xffffff, { map: TEX.stone }), 0, .65, 0, fp); box(.62, .8, .9, mat(0x060403), .02, .45, 0, fp); box(.75, .08, 1.9, woodMat(0x4a2f1c), .06, 1.32, 0, fp); markFurn(fp);
  const ember = glowSprite('rgba(255,80,30,1)', .5); ember.position.set(1.5, .2, 4.5); scene.add(ember);
  addI({ id:'fire', x:2.4, z:4.5, r:1.3, label: () => '查看壁爐', go: () => dlg('壁爐', LORE.fire) });
  onWall(textPlane(['配餐表', '一 3 ｜ 二 5 ｜ 三 9', '四 17 ｜ 五 □ ｜ 六 □'], 1.3, .9, { bg:'#1f2a22', fg:'#e6e2d0', size:46, border:'#6b4a2a' }), 9.4, 1.75, 1.02, 'n');
  addI({ id:'menu', x:9.4, z:1.9, label: () => '查看配餐表', go: () => dlg('餐廳', LORE.menu) });
  addI({ id:'kitchen', x:5, z:2.4, label: w => w.fl.kitchen ? '櫥櫃（空了）' : '廚房櫥櫃的密碼鎖', go: w => w.fl.kitchen ? dlg('櫥櫃', ['只剩下生鏽的湯匙。']) : openPuzzle('kitchen') });
  markFurn(shelf(11.6, 3.2, -Math.PI / 2, 1.3, 1.9, true));
  addI({ id:'cupboard', x:10.7, z:3.2, label: w => w.it.windkey === 'w' ? '翻找玻璃罐櫥櫃' : '查看玻璃罐', go: w => w.it.windkey === 'w' ? act('cont', 'cupboard') : dlg('櫥櫃', LORE.cupboard) });
  put('stool-v1', 10.6, 7.5, 0, 1, false); const don = box(.4, .35, .3, woodMat(0x5a3020), 10.6, .9, 7.5); box(.15, .02, .05, mat(0x111111), 10.6, 1.08, 7.5);
  addI({ id:'donation', x:10.2, z:6.9, r:1.3, noisy:true, hold: w => w.it.crowbar === myId && !w.fl.don ? 2.5 : 0, label: w => w.fl.don ? '空的捐款箱' : w.it.crowbar === myId ? '撬開捐款箱（按住 E）' : '查看捐款箱', go: w => w.fl.don ? dlg('捐款箱', ['裡面空了。']) : w.it.crowbar === myId ? act('pry', 'donation') : dlg('捐款箱', LORE.donation) });
  crate(1.6, 7.4, .6, .2, 0, true); crate(1.6, 7.4, .4, .7, .6); barrel(2.6, 7.6); wallClock(2.6, 2.4, 1.02, 'n');

  // ---------------- 懲戒室 ----------------
  for (let i = 0; i < 3; i++) for (let k = 0; k < 8; k++) { const l = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 6, 12), chainM); l.position.set(14.2 + i * 2.2, 2.2 - k * 0.11, 1.08); l.rotation.y = k % 2 ? Math.PI / 2 : 0; scene.add(l); }
  onWall(textPlane(['姊姊 救我', '──莉莎'], 1.2, .6, { bg:'#6b6156', fg:'#2a221b', size:60 }), 16.5, 1.4, 1.02, 'n');
  addI({ id:'cellwall', x:16.5, z:1.8, label: w => w.it.tag === 'w' ? '撿起牆角的名牌' : '看看牆上的刻字', go: w => { dlg('懲戒室', LORE.cellwall); if (w.it.tag === 'w') act('cont', 'tag'); } });
  onWall(textPlane(['排隊囉！', '由最小的孩子開始', '只喊名字的第一個字'], 1.5, 1, { bg:'#25282a', fg:'#e8e8e0', size:44 }), 13.02, 1.6, 4.5, 'w');
  addI({ id:'cellclue', x:13.9, z:4.5, label: () => '看看牆上的粉筆字', go: () => dlg('懲戒室', LORE.cellclue) });
  const chest = new THREE.Group(); chest.position.set(18.4, 0, 4.5); scene.add(chest);
  box(.55, .5, .9, woodMat(0x6b4426), 0, .25, 0, chest); box(.57, .12, .92, woodMat(0x4a2c18), 0, .54, 0, chest); for (const z of [-.3, .3]) box(.58, .52, .05, mat(0x2a2a2a, { metalness: .6 }), 0, .27, z, chest);
  box(.03, .12, .3, mat(0xb08a3a, { metalness: .8 }), -.29, .38, 0, chest); markFurn(chest);
  addI({ id:'cellbox', x:17.6, z:4.5, label: w => w.fl.cellbox ? '空的木箱' : '木箱上有一個四格的字輪鎖', go: w => w.fl.cellbox ? dlg('木箱', ['裡面空了。']) : openPuzzle('cellbox') });
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(.18, .14, .32, 12, 1, true), mat(0x55504a, { metalness: .5, side: THREE.DoubleSide })); bucket.position.set(14, .16, 7.6); scene.add(bucket);
  const straw = new THREE.Mesh(new THREE.PlaneGeometry(1.4, .8), mat(0x8a7444, { roughness: 1 })); straw.rotation.x = -Math.PI / 2; straw.position.set(14.6, .01, 6.2); scene.add(straw);
  const st2 = put('stool-v1', 18.2, 7.3, 0, 1, false); st2.rotation.z = 1.5; st2.position.y = .3;
  uvText(['指紋', '☝ ☝ ☝'], .8, .5, 16.5, 1.3, 8.98, 's');
  addI({ id:'prints', x:16.5, z:8.1, r:1.1, label: w => me.role === 2 && !(w.pl[myId]?.t & 2) ? (w.it.uv === myId ? '用紫外燈照門板內側' : '門板內側好像有什麼痕跡……') : null, go: w => w.it.uv === myId ? (dlg('懲戒室的門', ['紫光下，門板內側滿是小小的手印。', '還有一組大人的指紋，和院長書桌上的一模一樣。']), act('prints')) : dlg('懲戒室的門', ['肉眼看不清楚，也許需要特別的光。']) });

  // ---------------- 儲藏室 ----------------
  crate(21.5, 1.5, .7, .1, 0, true); crate(21.5, 1.5, .5, .5, .7); crate(21.45, 2.4, .5, .3);
  shelf(23.1, 1.22, 0, 1.3, 1.9, true); barrel(22.4, 2.7);
  const dollCrate = crate(25.45, 1.45, .75, 0, 0, true); dollCrate.material = woodMat(0xa07850);
  addI({ id:'crate', x:24.6, z:1.6, r:1.1, label: w => w.it.doll === 'w' ? '翻找最裡面的木箱' : '查看木箱', go: w => w.it.doll === 'w' ? act('cont', 'crate') : dlg('木箱', LORE.crate) });
  uvText(['☆＝3  ◇＝8  △＝5', '○＝2  □＝7'], 1.4, .6, 25.98, 1.8, 2.4, 'e');
  addI({ id:'uvtable', x:25.2, z:2.6, r:1.1, label: w => w.it.uv === myId ? '用紫外燈照牆面' : '牆上有擦掉的痕跡', go: w => dlg('儲藏室', w.it.uv === myId ? LORE.uvtable : LORE.nouv) });
  const labBox = box(.5, .4, .4, mat(0x3a4a3a, { metalness: .3 }), 21.55, .2, 3.5); markFurn(labBox);
  const nb = box(.3, .03, .22, mat(0xe8e2d0), 21.55, .42, 3.5); nb.rotation.y = .3;
  addI({ id:'lab', x:22.3, z:3.3, r:1.1, label: w => w.fl.lab ? '實驗紀錄箱（已打開）' : '實驗紀錄箱（兩位數密碼）', go: w => { dlg('實驗紀錄', LORE.lab, () => { if (!w.fl.lab) openPuzzle('lab'); }); } });

  // ---------------- 告解室 ----------------
  box(3, 2.2, 0.08, woodMat(0x5a3a24), 23.5, 1.1, 6.9);
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.9), mat(0x5a1414, { side: THREE.DoubleSide })); curtain.position.set(22.6, 1.15, 6.86); scene.add(curtain);
  box(0.6, 0.45, 0.4, woodMat(0x5a3a24), 22.6, .22, 7.8); box(0.6, 0.45, 0.4, woodMat(0x5a3a24), 24.4, .22, 5.6); candleStand(24.6, 7.9, 1.1);
  addI({ id:'conf', x:23.5, z:6.4, label: () => me.role === 6 ? '留下證詞錄音' : '看看木格窗', go: () => { dlg('告解室', LORE.conf); if (me.role === 6) act('record'); } });

  // ---------------- 院長室 ----------------
  put('desk-v1', 32.5, 3.2, 0); put('chair-v1', 32.5, 2.2, 0, 1, false);
  put('bookcase-v1', 28.6, 1.45, 0, .75); put('woven-rug-v1', 32.5, 5.8, 0, .8, false).traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiplyScalar(.45); o.material.color.offsetHSL(0, .2, 0); } }); put('ficus-v1', 38.3, 8.3, 0);
  put('credenza-v1', 35.6, 8.45, Math.PI); put('armchair-v1', 28.4, 5.2, Math.PI / 2); put('armchair-v1', 28.4, 6.8, Math.PI / 2);
  const ledger = box(.32, .02, .24, mat(0x6a2a1a), 32.1, .79, 3.4); ledger.rotation.y = .25;
  const safeBox = new THREE.Group(); safeBox.position.set(37.5, 0, 1.6); scene.add(safeBox);
  box(.9, 1.0, .8, mat(0x2b2d30, { metalness: .6, roughness: .45 }), 0, .5, 0, safeBox);
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .04, 20), mat(0xb9a36a, { metalness: .8, roughness: .3 })); dial.rotation.x = Math.PI / 2; dial.position.set(0, .62, .41); safeBox.add(dial); markFurn(safeBox);
  painting(32.5, 2.15, 1.02, 'n', 7, .8, 1.0, true); wallClock(38.98, 2.4, 5, 'e'); painting(38.98, 1.9, 2.8, 'e', 3);
  addI({ id:'desk', x:32.5, z:4.3, label: w => w.fl.desk ? '查看桌上的帳本' : '搜查院長的書桌', go: w => { if (!w.fl.desk) act('cont', 'desk'); dlg('院長的書桌', LORE.ledger); } });
  addI({ id:'safe', x:37.4, z:2.6, label: w => !w.fl.safe ? '轉動保險箱的密碼盤' : '空的保險箱', go: w => !w.fl.safe ? openPuzzle('safe') : dlg('保險箱', ['裡面什麼都不剩了。']) });
  addI({ id:'files', x:28.6, z:2.5, r:1.2, label: () => '翻找書櫃', go: () => { dlg('書櫃', LORE.files); act('files'); } });

  // ---------------- 走廊 ----------------
  for (const x of [3, 9, 13.5, 27, 30, 36.5]) sconce(x, 2.2, 10.06);
  painting(3.5, 1.8, 11.98, 's', 1); painting(14.5, 1.8, 11.98, 's', 2); painting(30.5, 1.8, 11.98, 's', 4, .7, .9, true); painting(36.5, 1.8, 11.98, 's', 5);

  // ---------------- 禱告室 ----------------
  const altar = box(1.0, 1.0, 2.4, mat(0x6d6257, { map: TEX.stone }), 2.3, .5, 17);
  box(1.06, 0.04, 2.5, mat(0xd8d2c4), 2.3, 1.02, 17); markFurn(altar);
  const crossG = new THREE.Group(); box(.08, 1.2, .08, woodMat(0x5a3a24), 0, 0, 0, crossG); box(.6, .08, .08, woodMat(0x5a3a24), 0, .25, 0, crossG); crossG.position.set(1.08, 2.1, 17); scene.add(crossG);
  ['I','II','III','IV'].forEach((n, i) => {
    const z = 15.95 + i * 0.7;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(.04, .045, .32, 10), mat(0xf1ead8)); c.position.set(2.5, 1.2, z); scene.add(c);
    const fl = glowSprite('rgba(255,180,80,1)', .35); fl.position.set(2.5, 1.42, z); fl.visible = false; scene.add(fl);
    const lab = textPlane([n], .22, .12, { bg:'#6d6257', fg:'#efe2c0', size:80 }); lab.position.set(2.81, .85, z); lab.rotation.y = Math.PI / 2; scene.add(lab);
    const eq = textPlane([CANDLE_EQ[i]], .3, .14, { bg:'rgba(0,0,0,0)', fg:'#c8f', size:80 }); eq.material.transparent = true; eq.material.emissive = new THREE.Color(0x7a3cff); eq.material.emissiveMap = eq.material.map; eq.position.set(2.815, .62, z); eq.rotation.y = Math.PI / 2; eq.visible = false; scene.add(eq); uvMeshes.push(eq);
    candleMeshes.push(fl);
    addI({ id:'candle' + i, x:3.25, z, r:.75, label: w => w.fl.cand ? null : w.it.matches === myId ? `點燃蠟燭 ${n}` : `蠟燭 ${n}（需要火柴）`, go: w => w.it.matches === myId ? act('candle', i) : dlg('蠟燭', ['沒有火可以點。', '廚房也許找得到火柴。']) });
  });
  for (const id of RELICS) { const s = new THREE.Group(); const ic = textPlane([ITEMS[id].ic], .3, .3, { bg:'#d8d2c4', size:220 }); ic.rotation.x = -Math.PI / 2; s.add(ic); s.visible = false; scene.add(s); altarRelics[id] = s; }
  altarRelics.doll.position.set(2.2, 1.05, 16.2); altarRelics.diary.position.set(2.2, 1.05, 16.8); altarRelics.tag.position.set(2.2, 1.05, 17.3); altarRelics.photo.position.set(2.2, 1.05, 17.85);
  addI({ id:'altar', x:3.3, z:17, r:1.3, label: w => RELICS.some(r => w.it[r] === myId) ? '把遺物放上祭壇' : '查看祭壇', go: w => { if (RELICS.some(r => w.it[r] === myId)) act('altar'); else dlg('祭壇', [...LORE.altar, `目前放著 ${RELICS.filter(r => w.it[r] === 'a').length}／4 件遺物。`]); } });
  addI({ id:'bless', x:3.5, z:18.6, r:1.0, hold: 3, label: w => me.role === 3 && !(w.pl[myId]?.t & 1) && w.pl[myId]?.s === 'f' ? '跪下為孩子們禱告（按住 E）' : null, go: () => act('bless') });
  addI({ id:'secret', x:1.4, z:16.5, r:1.1, label: w => w.fl.sp ? '密道已經打開了──往西走！' : w.fl.cand ? '祭壇後的牆有風聲……' : null, go: w => !w.fl.sp && dlg('祭壇後方', ['牆縫裡吹出冰冷的風。', '石磚好像鬆動了，但現在推不開。也許要等到深夜，月亮升起的時候。']) });
  const pewM = woodMat(0x7a5232);
  for (const z of [14.3, 16.3, 18.3]) { const pew = new THREE.Group(); box(4.6, .1, .5, pewM, 0, .45, 0, pew); box(4.6, .6, .07, pewM, 0, .8, .24, pew); for (const x of [-2.2, 0, 2.2]) box(.08, .45, .45, pewM, x, .22, 0, pew); pew.position.set(7.5, 0, z); scene.add(pew); markFurn(pew, 0); }
  onWall(textPlane(['床頭燭影伴孤眠', '下弦月冷照庭前', '第一聲鐘人未醒', '三更笑語夢中連'], 1.6, 1.25, { bg:'#2b2119', fg:'#e8d9b0', border:'#8a6a3a', size:52 }), 7.5, 1.85, 13.02, 'n');
  addI({ id:'poem', x:7.5, z:13.6, label: () => '讀牆上的詩', go: () => dlg('禱告室', LORE.poem) });
  onWall(textPlane(['點燈之前', '先讓看不見的字現形'], .9, .5, { bg:'#3a2c20', fg:'#e8d9b0', size:46 }), 3.7, 1.5, 13.02, 'n');
  addI({ id:'candlehint', x:3.7, z:13.7, label: () => '查看小木牌', go: () => dlg('禱告室', LORE.candlehint) });
  addI({ id:'pin', x:7.5, z:19.2, r:1.4, hold: w => w.pl[myId]?.pin ? 0 : 5, label: w => w.pl[myId]?.s !== 'c' ? null : w.pl[myId]?.pin ? '髮夾斷了……只能等隊友帶手銬鑰匙' : '在長椅縫隙摸索髮夾（按住 E）', go: w => w.pl[myId]?.pin ? dlg('禱告室', ['斷掉的髮夾已經沒用了。', '只能等隊友從院長室帶「手銬鑰匙」來。']) : act('pin') });
  candleStand(10.4, 13.6); candleStand(10.4, 20.4); candleStand(4.6, 13.6);
  const angel = new THREE.Group(); angel.position.set(10.4, 0, 17); scene.add(angel); const stoneM = mat(0xb8b2a6, { roughness: .9 });
  box(.5, .5, .5, mat(0x8a8478), 0, .25, 0, angel); const body = new THREE.Mesh(new THREE.ConeGeometry(.25, 1.1, 10), stoneM); body.position.y = 1.05; angel.add(body); const head = new THREE.Mesh(new THREE.SphereGeometry(.13, 12, 10), stoneM); head.position.y = 1.7; angel.add(head);
  for (const s of [-1, 1]) { const wg = box(.06, .7, .4, stoneM, s * .2, 1.3, -.15, angel); wg.rotation.z = s * .4; } markFurn(angel);

  // ---------------- 大廳 ----------------
  put('sofa-v1', 16, 19.55, Math.PI); put('armchair-v1', 14.3, 16.3, Math.PI / 2); put('armchair-v1', 18.7, 16.3, -Math.PI / 2);
  put('round-rug-v1', 16.5, 16.3, 0, .8, false); const ct = put('coffee-table-v1', 16.5, 16.3, 0, .8);
  const ctTop = new THREE.Box3().setFromObject(ct).max.y;
  const mb = new THREE.Group(); mb.position.set(16.5, ctTop, 16.3); scene.add(mb); box(.2, .12, .15, woodMat(0x8a2a22), 0, .06, 0, mb); const lid = box(.2, .02, .15, woodMat(0xa0402a), 0, .13, -.04, mb); lid.rotation.x = -.6;
  put('ficus-v1', 13.6, 13.6, 0); piano(20.45, 18.5, -Math.PI / 2); // 靠東牆，避開北側兩扇門與東側教室門
  const pw = new THREE.Group(); pw.position.set(16.6, 1.75, 13.03); scene.add(pw);
  for (let i = 0; i < 6; i++) { const f = makePhoto(i); f.scale.setScalar(.85); f.position.set(-1.35 + (i % 3) * .95, i >= 3 ? -.6 : .05, 0); pw.add(f); }
  addI({ id:'photowall', x:16.6, z:13.7, label: w => w.it.photo === 'w' ? '取下沒釘牢的照片' : '查看照片牆', go: w => { dlg('照片牆', LORE.photowall); if (w.it.photo === 'w') act('cont', 'photo'); } });
  onWall(textPlane(['公告', '熄燈後禁止奔跑', '大門封印只在深夜撕得下'], 1.2, .9, { size:40 }), 13.02, 1.6, 15.2, 'w');
  addI({ id:'notice', x:13.8, z:15.2, label: () => '查看公告欄', go: () => dlg('公告欄', LORE.notice) });
  addI({ id:'piano', x:19.5, z:18.5, r:1.2, label: () => '按下琴鍵', go: () => { dlg('鋼琴', LORE.piano); [58, 59, 64].forEach((m, i) => setTimeout(() => mbNote(20.4, 18.5, m, 1.6), i * 380)); act('piano'); } });
  addI({ id:'musicbox', x:16.5, z:17.4, r:1.3, label: w => w.it.windkey === myId ? '替音樂盒上發條' : '查看音樂盒', go: w => w.it.windkey === myId ? act('wind') : dlg('音樂盒', LORE.musicbox) });
  rockingHorse(14.4, 18.6, .5); toyBlocks(17.9, 18.4); bear(15.3, .55, 19.55); wallClock(20.98, 2.3, 18, 'e');

  // ---------------- 教室 ----------------
  const bd = put('mobile-board-v1', 25.55, 13.65, 0); const bb = new THREE.Box3().setFromObject(bd); // 避開北側教室門
  const chalk = textPlane(['1 1 2 3 5 8 □ □', '→ 儲藏室的門'], 1.6, .8, { bg:'#1e2a22', fg:'#f0f0e8', size:58 }); chalk.position.set(25.55, 1.2, bb.max.z + .012); scene.add(chalk);
  addI({ id:'board', x:25.4, z:14.8, r:1.3, label: () => '查看黑板', go: () => dlg('教室', LORE.board) });
  const tdesk = new THREE.Group(); tdesk.position.set(24, 0, 15.3); scene.add(tdesk); box(1.4, .08, .7, woodMat(0x8a5a36), 0, .76, 0, tdesk); box(1.36, .7, .05, woodMat(0x6a4226), 0, .38, .3, tdesk); box(.04, .72, .66, woodMat(0x6a4226), -.66, .36, 0, tdesk); box(.04, .72, .66, woodMat(0x6a4226), .66, .36, 0, tdesk);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(.12, 16, 12), mat(0x3a6a8a)); globe.position.set(24.45, .95, 15.2); scene.add(globe); markFurn(tdesk);
  addI({ id:'sudoku', x:24, z:16.2, r:1.2, label: w => w.fl.sudoku ? '講台抽屜（已打開）' : '講台抽屜上有個數獨鎖', go: w => w.fl.sudoku ? dlg('講台', ['抽屜空了。']) : openPuzzle('sudoku') });
  for (const [x, z] of [[22.8, 17.4], [25.1, 17.4], [22.8, 19.1], [25.1, 19.1]]) schoolDesk(x, z);
  const dr = ctex(512, 200, g => { g.fillStyle = '#d9cfb6'; g.fillRect(0, 0, 512, 200); for (let i = 0; i < 6; i++) { const x = 10 + i * 84; g.fillStyle = '#f2ecdc'; g.fillRect(x, 20, 74, 160); g.fillStyle = '#111'; g.fillRect(x + 30, 70, 14, 70); g.beginPath(); g.arc(x + 37, 60, 13, 0, 7); g.fill(); g.strokeStyle = '#d33'; g.lineWidth = 3; g.beginPath(); g.arc(x + 37, 62, 7, .2, Math.PI - .2); g.stroke(); g.fillStyle = ['#e33','#3a3','#33e','#ea3','#a3a','#3aa'][i]; g.fillRect(x + 8, 150, 20, 20); } g.fillStyle = '#555'; g.font = '16px sans-serif'; g.fillText('莉莎', 448, 192); });
  dr.wrapS = dr.wrapT = THREE.ClampToEdgeWrapping;
  onWall(new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1), new THREE.MeshStandardMaterial({ map: dr })), 24, 1.6, 20.98, 's');
  addI({ id:'drawings', x:24, z:20.3, r:1.2, label: () => '看看牆上的蠟筆畫', go: () => { dlg('教室', LORE.drawings); act('drawing'); } });
  markFurn(shelf(26.6, 15.6, -Math.PI / 2, 1.1, 1.5));

  // ---------------- 宿舍 ----------------
  const bedFrame = woodMat(0x7a5232), sheet = mat(0xcfc8b8), blanket = mat(0x6a2f2a);
  BEDS.forEach(([nm, age], i) => {
    const x = 29.5 + i * 2, b = new THREE.Group(); b.position.set(x, 0, 19.35); scene.add(b);
    box(.95, .35, 1.95, bedFrame, 0, .25, 0, b); box(.88, .14, 1.88, sheet, 0, .48, 0, b); box(.9, .1, 1.2, blanket, 0, .56, .3, b); box(.6, .1, .3, sheet, 0, .6, -.72, b); box(.95, .8, .06, bedFrame, 0, .4, -1, b);
    markFurn(b);
    const plate = textPlane([`${i + 1} 號床`, `${nm} · ${age} 歲`], .6, .3, { bg:'#e8dfc8', size:60 }); plate.position.set(x, .62, 18.33); plate.rotation.y = Math.PI; scene.add(plate);
    addI({ id:'bed' + i, x, z:17.8, r:1.0, label: () => `查看 ${i + 1} 號床的名牌`, go: () => dlg('宿舍', [`${i + 1} 號床：${nm}，${age} 歲。`]) });
    addI({ id:'under' + i, x:x - 1, z:19.4, r:.9, label: w => i === 2 && w.it.crowbar === 'w' ? `看看 ${i + 1} 號床底下` : `看看 ${i + 1} 號床底下`, go: () => act('cont', 'bed' + i) });
    if (i % 2) bear(x - .1, .62, 18.75, i === 1 ? 0x8a5a3a : 0x6a6a7a);
  });
  for (const z of [19, 20]) for (const s of [0]) { box(.06, 2.2, 1, woodMat(0x5a3a24), 38.96, 1.1, z + .5); }
  box(1, 2.2, .06, woodMat(0x5a3a24), 38.5, 1.1, 18.97); box(1, .06, 2.05, woodMat(0x5a3a24), 38.5, 2.2, 20);
  const toyChest = box(.8, .45, .5, woodMat(0x8a3a2a), 37.1, .225, 13.5); markFurn(toyChest); toyBlocks(36, 14.1);
  onWall(textPlane(['就寢規定', '一號床在最西邊', '熄燈後不准說話'], 1.2, .9, { size:40 }), 31.5, 1.6, 13.02, 'n');
  addI({ id:'dormrule', x:31.5, z:13.7, label: () => '查看牆上的規定', go: () => dlg('宿舍', LORE.dorm) });
  onWall(textPlane(['小安 ‖‖‖ 7歲', '要一直笑喔'], .6, .3, { bg:'#b8a98f', fg:'#4a3a2a', size:54 }), 34.5, .7, 13.02, 'n');
  addI({ id:'carve', x:34.5, z:13.7, r:1.1, label: () => '牆角有小小的刻痕', go: () => { dlg('宿舍', ['牆角刻著歪歪扭扭的字：「小安 ‖‖‖ 7歲　要一直笑喔」']); act('carve'); } });
  painting(28.02, 1.8, 16.5, 'w', 9, .6, .8, true);

  // ---------------- 庭院 ----------------
  for (const [x, z, s] of [[5,24,2.2],[34,23.6,2.4],[7.5,29.5,1.9],[14,23.2,1.6],[25.5,23.4,1.7]]) put('olive-v1', x, z, Math.random() * 6, s);
  const well = new THREE.Group(); well.position.set(12.5, 0, 26.5); scene.add(well);
  const wr = new THREE.Mesh(new THREE.CylinderGeometry(.75, .8, .8, 20, 1, true), mat(0x77706a, { map: TEX.stone, side: THREE.DoubleSide })); wr.position.y = .4; well.add(wr);
  const wd = new THREE.Mesh(new THREE.CircleGeometry(.72, 20), mat(0x050505)); wd.rotation.x = -Math.PI / 2; wd.position.y = .3; well.add(wd);
  for (const x of [-.7, .7]) box(.08, 1.8, .08, bedFrame, x, .9, 0, well); box(1.7, .12, .5, bedFrame, 0, 1.85, 0, well);
  markFurn(well, .2);
  addI({ id:'well', x:12.5, z:27.6, r:1.3, label: () => me.role === 7 ? '在水井旁祈禱' : '查看水井', go: w => { dlg('水井', LORE.well); if (me.role === 7) act('pray'); } });
  addI({ id:'gate', x:19.9, z:30.4, r:1.6, noisy:true,
    hold: w => (w.fl.chain && w.fl.padlock && !w.fl.seal && w.ph === 3) ? 8 : 0,
    label: w => { if (w.fl.gate) return null; if (!w.fl.chain) return w.it.cutter === myId ? '用斷線鉗剪斷鐵鍊' : '查看大門的三道鎖'; if (!w.fl.padlock) return w.it.gk === myId ? '用大門鑰匙打開大鎖' : '大鎖還鎖著（需要完整的大門鑰匙）'; return w.ph === 3 ? '撕下微笑封印（按住 E，聲音很大）' : '封印紋風不動……只有深夜才撕得下來'; },
    go: w => { if (!w.fl.chain) return w.it.cutter === myId ? act('gate', 'cut') : dlg('大門', LORE.gate); if (!w.fl.padlock) return w.it.gk === myId ? act('gate', 'unlock') : dlg('大門', LORE.gate); if (w.ph === 3) act('gate', 'seal'); else dlg('大門', ['封印上的笑臉，好像在嘲笑你。', '現在撕不下來──要等到深夜。']); } });
  const lean = new THREE.Group(); lean.position.set(2, 0, 30.5); scene.add(lean);
  for (const [x, z] of [[-1, -.5], [1, -.5]]) box(.1, 2.2, .1, bedFrame, x, 1.1, z, lean);
  box(2.2, .08, 1.3, mat(0x3a3028), 0, 2.2, 0, lean);
  for (const [x, z] of [[4, 27], [5.1, 27.2], [6.2, 26.9], [4.5, 28.6]]) graveCross(x, z, (Math.random() - .5) * .3);
  swingSet(26.5, 26.6); lamppost(17, 25); lamppost(22.5, 25); lamppost(10, 23.2);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.13, 14, 10), mat(0xb0302a)); ball.position.set(23.5, .13, 28.4); scene.add(ball);
  // ---------------- 工具間 ----------------
  put('production-table-v1', 35.6, 30.2, Math.PI, .35);
  const tb = new THREE.Group(); tb.position.set(35.6, .86 * .35 + .02, 30.1); scene.add(tb); box(.6, .22, .4, mat(0x7a1a14, { metalness: .4 }), 0, .11, 0, tb); for (let i = 0; i < 3; i++) box(.12, .03, .12, mat(0x999999, { metalness: .8 }), -.18 + i * .18, .235, 0, tb);
  addI({ id:'sokoban', x:35.6, z:29.0, r:1.3, label: w => w.fl.sokoban ? '工具箱（已打開）' : '滑塊工具箱', go: w => w.fl.sokoban ? dlg('工具箱', ['空了。']) : dlg('工具間', LORE.sokoinfo, () => openPuzzle('sokoban')) });
  shelf(38.6, 28, -Math.PI / 2, 1.2, 1.7); barrel(33.6, 27.6); barrel(34.3, 27.5); crate(33.6, 29.9, .6, .3);
  const ladder = new THREE.Group(); ladder.position.set(37.7, 0, 30.6); ladder.rotation.x = -.25; scene.add(ladder); for (const sx of [-.2, .2]) box(.05, 2.3, .05, woodMat(0x8a6a44), sx, 1.15, 0, ladder); for (let i = 0; i < 6; i++) box(.4, .04, .04, woodMat(0x8a6a44), 0, .3 + i * .35, 0, ladder);
  // ---------------- 牆上的血字（深夜） ----------------
  onWall(bloodText('一起玩吧', 3, 1.1), 10.5, 1.75, 10.01, 'n');
  onWall(bloodText('祂在看著你', 3.4, 1.1), 27, 1.75, 11.99, 's');
  onWall(bloodText('不要笑', 2.4, 1.1), 15.5, 2.1, 20.99, 's');
  onWall(bloodText('嘻嘻嘻嘻嘻', 3, 1), 36, 2.1, 20.99, 's');
  onWall(bloodText('找到你了', 2.6, 1), 3.2, 2.5, 13.01, 'n');
  onWall(bloodText('不要回頭', 2.6, 1), 38.99, 1.7, 15.5, 'e');
  // ---------------- 安全區 ----------------
  for (const k of SAFE) {
    const [x, z] = k.split(',').map(Number);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(.05, .06, .22, 8), mat(0xf1ead8)); c.position.set(x + .5, .11, z + .5); scene.add(c);
    const g = glowSprite('rgba(255,190,90,1)', .45); g.position.set(x + .5, .3, z + .5); scene.add(g);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.38, .46, 32), new THREE.MeshBasicMaterial({ color:0xe9c46a, transparent:true, opacity:.35 })); ring.rotation.x = -Math.PI / 2; ring.position.set(x + .5, .01, z + .5); scene.add(ring);
    const l = new THREE.PointLight(0xffb060, 0, 4.5, 1.6); l.position.set(x + .5, .5, z + .5); scene.add(l); safeLights.push(l);
  }
  // ---------------- 門的互動 ----------------
  for (const d of DOORS) addI({ id:'door-' + d.id, x:d.x + .5, z:d.z + .5, r:1.5, door:d, noisy:true,
    hold: w => d.lock === 'pry' && w.lk?.[d.id] && w.it.crowbar === myId ? 3 : 0,
    label: w => {
      const open = w.dr[d.id];
      if (d.cell && !open && inRect(me.x, me.z, CELLR)) return '門閂在外面……打不開';
      if (d.lock && w.lk?.[d.id] && !open) {
        if (d.lock === 'key') return w.it[d.key] === myId ? '用院長室鑰匙開門' : '院長室（上鎖）';
        if (d.lock === 'code') return '輸入門上的四位數密碼';
        if (d.lock === 'pry') return w.it.crowbar === myId ? '撬開釘死的木板（按住 E）' : '門被木板釘死了';
      }
      return open ? (d.cell ? '關上懲戒室的門' : '關門') : (d.cell ? '拉開懲戒室的門閂' : '開門');
    },
    go: w => {
      if (d.lock === 'code' && w.lk?.[d.id]) return openPuzzle(d.lid);
      if (d.lock === 'pry' && w.lk?.[d.id]) return w.it.crowbar === myId ? act('pry', d.id) : dlg('工具間', LORE.shedsign);
      act('door', d.id);
    } });
}
const gateParts = {}; let ceilMat = null;
const bloodWrites = [];
function bloodText(text, w, h) {
  const px = 512, ph = Math.round(px * h / w);
  const t = ctex(px, ph, g => {
    g.clearRect(0, 0, px, ph); g.font = `900 ${Math.round(ph * .5)}px "Noto Serif TC", serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(110,0,0,.92)'; g.fillText(text, px / 2, ph * .42);
    for (let i = 0; i < 26; i++) { const x = px * .1 + Math.random() * px * .8, y = ph * .45 + Math.random() * ph * .15, l = 10 + Math.random() * ph * .45; g.fillRect(x, y, 2 + Math.random() * 4, l); g.beginPath(); g.arc(x + 2, y + l, 3 + Math.random() * 2, 0, 7); g.fill(); }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: .5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.visible = false; bloodWrites.push(m); return m;
}
let phantom = null, phantomT = 0;
function makePhoto(i) {
  const t = ctex(160, 120, (g, w, h) => {
    g.fillStyle = '#d9cfb6'; g.fillRect(0, 0, w, h); g.fillStyle = '#b8ab8c'; g.fillRect(8, 8, w - 16, h - 16);
    const n = 3 + (i % 3);
    for (let k = 0; k < n; k++) { const x = 20 + k * ((w - 40) / (n - 1 || 1)), y = 62; g.fillStyle = '#6b5a45'; g.beginPath(); g.arc(x, y, 12, 0, 7); g.fill(); g.fillRect(x - 12, y + 12, 24, 30);
      g.strokeStyle = '#f3ead2'; g.lineWidth = 2; g.beginPath(); g.arc(x, y + 2, 6, .2, Math.PI - .2); g.stroke(); }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(.9, .62), new THREE.MeshStandardMaterial({ map: t, roughness: .8 }));
  const f = new THREE.Mesh(new THREE.PlaneGeometry(1, .72), mat(0x2b1d12)); f.position.z = -.005; m.add(f); return m;
}

// ===================== 角色 =====================
function makeAvatar(idx) {
  const g = M['char-' + CHARS[idx % CHARS.length]];
  const root = SkeletonUtils.clone(g.scene);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const mixer = new THREE.AnimationMixer(root);
  const acts = {}; for (const a of g.animations) acts[a.name] = mixer.clipAction(a);
  acts.idle?.play();
  return { root, mixer, acts, cur:'idle' };
}
function setAnim(av, name, speed = 1) {
  if (!av.acts[name]) return; av.acts[name].timeScale = speed;
  if (av.cur === name) return; av.acts[av.cur]?.fadeOut(.2); av.acts[name].reset().fadeIn(.2).play(); av.cur = name;
}
function labelSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  const draw = (t, col) => { g.clearRect(0, 0, 256, 64); g.font = '700 30px "Noto Sans TC", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(t, 128, 32); g.fillStyle = col; g.fillText(t, 128, 32); tx.needsUpdate = true; };
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: true, transparent: true })); s.scale.set(1.2, .3, 1);
  draw(text, color); s.userData.draw = draw; return s;
}
function bubbleSprite() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthTest: false })); s.scale.set(2.4, .45, 1); s.visible = false; s.renderOrder = 10;
  s.userData.set = t => { g.clearRect(0, 0, 512, 96); g.font = '500 30px "Noto Sans TC", sans-serif'; const w = Math.min(500, g.measureText(t).width + 30); g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); g.roundRect((512 - w) / 2, 10, w, 70, 16); g.fill(); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 256, 46, 480); tx.needsUpdate = true; s.visible = true; };
  return s;
}
let ghostAv = null, ghostMask = null, ghostEye = null, ghostHead = null; const ghostFeet = [], shackle = [];
function buildGhost() {
  const g = M.ghost; const root = SkeletonUtils.clone(g.scene);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.material = o.material.clone(); o.material.color?.multiplyScalar(.03); if (o.material.emissive) o.material.emissive.setHex(0); } if (o.isBone && o.name === 'Head') ghostHead = o; if (o.isBone && o.name === 'LeftFoot') ghostFeet[0] = o; if (o.isBone && o.name === 'RightFoot') ghostFeet[1] = o; });
  root.scale.setScalar(1.25);
  const mixer = new THREE.AnimationMixer(root); const acts = {}; for (const a of g.animations) acts[a.name] = mixer.clipAction(a); acts.idle?.play();
  ghostAv = { root, mixer, acts, cur:'idle' };
  const t = ctex(256, 320, (c, w, h) => {
    c.fillStyle = '#f2ede2'; c.beginPath(); c.ellipse(w/2, h/2, w/2 - 6, h/2 - 6, 0, 0, 7); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.ellipse(w/2 - 52, h/2 - 40, 22, 12, -.25, 0, 7); c.fill(); c.beginPath(); c.ellipse(w/2 + 52, h/2 - 40, 22, 12, .25, 0, 7); c.fill();
    c.strokeStyle = '#111'; c.lineWidth = 12; c.lineCap = 'round'; c.beginPath(); c.arc(w/2, h/2 + 6, 78, .25, Math.PI - .25); c.stroke();
    c.fillStyle = '#b33'; c.globalAlpha = .45; c.beginPath(); c.arc(w/2 - 80, h/2 + 20, 18, 0, 7); c.arc(w/2 + 80, h/2 + 20, 18, 0, 7); c.fill();
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  ghostMask = new THREE.Mesh(new THREE.SphereGeometry(.15, 24, 16, Math.PI * .2, Math.PI * .6, Math.PI * .15, Math.PI * .7), new THREE.MeshStandardMaterial({ map: t, roughness: .4, emissive: 0x6a6458, side: THREE.DoubleSide }));
  for (const sx of [-.052, .052]) { const e = glowSprite('rgba(255,40,30,1)', .07); e.position.set(sx, .035, .155); ghostMask.add(e); }
  const linkM = mat(0x8a8a8a, { metalness: .9, roughness: .35 });
  for (let i = 0; i < 12; i++) { const l = new THREE.Mesh(new THREE.TorusGeometry(.035, .009, 6, 10), linkM); l.castShadow = true; scene.add(l); shackle.push(l); }
  for (let i = 0; i < 2; i++) { const cuff = new THREE.Mesh(new THREE.TorusGeometry(.075, .018, 8, 16), linkM); cuff.rotation.x = Math.PI / 2; scene.add(cuff); shackle.push(cuff); }
  scene.add(ghostMask);
  ghostEye = new THREE.SpotLight(0xff3030, 0, 9, 0.62, 0.6, 1.2); scene.add(ghostEye, ghostEye.target);
  root.visible = false; ghostMask.visible = false; scene.add(root);
  // 幻影（只在單一玩家畫面中一閃而過）
  const pr = SkeletonUtils.clone(g.scene); pr.scale.setScalar(1.25);
  pr.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.material = o.material.clone(); o.material.color?.multiplyScalar(.03); } });
  const pm = new THREE.AnimationMixer(pr); const idle = g.animations.find(a => a.name === 'idle'); if (idle) pm.clipAction(idle).play(); pm.update(.01);
  pr.updateMatrixWorld(true); let hb = null; pr.traverse(o => { if (o.isBone && o.name === 'Head') hb = o; });
  const hp = hb ? hb.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 2, 0);
  const pmask = ghostMask.clone(); pmask.visible = true; pmask.position.set(hp.x, hp.y + .12, hp.z + .07); pr.add(pmask);
  pr.visible = false; scene.add(pr); phantom = { root: pr, mixer: pm };
}

// ===================== 連線層 =====================
class LocalNet {
  constructor() { this.id = 'solo'; this.mine = {}; }
  async start() {}
  set(p) { for (const k in p) p[k] === null ? delete this.mine[k] : this.mine[k] = p[k]; }
  peers() { return [{ id: this.id, me: true, p: this.mine }]; }
  signal() {}
}
class RoomNet {
  constructor() { this.id = null; this.r = null; this.err = null; this.conn = true; }
  async start(code) {
    const room = await window.claude?.use?.('room');
    if (!room) { const e = new Error('noroom'); e.why = 'noroom'; throw e; }
    this.name = ('hs-' + code).toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
    try { this.r = await room.join(this.name); } catch (e) { const er = new Error('join'); er.why = 'join:' + (e?.code || e?.message || e); throw er; }
    this.r.onPeers(ch => { const m = ch.peers.find(p => p.sameTab); if (m) this.id = 'u' + m.peer; }, e => { this.err = e?.code || 'error'; });
    this.r.onConnection?.(c => { this.conn = c; }, e => { this.err = e?.code || 'error'; });
    const t0 = performance.now(); while (!this.id && performance.now() - t0 < 8000) await new Promise(r => setTimeout(r, 100));
    if (!this.id) { const e = new Error('noid'); e.why = 'noid'; throw e; }
  }
  set(p) { this.r.presence(p).catch(e => { this.err = 'presence:' + (e?.code || e); console.warn('presence', e?.code || e); }); }
  peers() { return this.r.peers().filter(p => p.kind === 'viewer').map(p => ({ id: 'u' + p.peer, me: p.sameTab, p: p.presence || {} })); }
  signal() {}
}
class WsNet {
  constructor() { this.id = null; this.mine = {}; this.others = new Map(); this.onSignal = null; }
  start(code) {
    return new Promise((res, rej) => {
      const u = window.HS_WS_URL || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      const ws = this.ws = new WebSocket(u);
      const to = setTimeout(() => rej(new Error('timeout')), 6000);
      ws.onopen = () => ws.send(JSON.stringify({ t:'join', room: code }));
      ws.onerror = () => rej(new Error('ws error'));
      ws.onclose = () => toast('與伺服器的連線中斷了');
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.t === 'w') { this.id = m.id; for (const [id, p] of m.peers) this.others.set(id, p); clearTimeout(to); res(); }
        else if (m.t === 'j') this.others.set(m.id, {});
        else if (m.t === 'p') { const o = this.others.get(m.id) || {}; for (const k in m.d) m.d[k] === null ? delete o[k] : o[k] = m.d[k]; this.others.set(m.id, o); }
        else if (m.t === 'l') { this.others.delete(m.id); }
        else if (m.t === 's') this.onSignal?.(m.from, m.d);
        else if (m.t === 'x') { rej(new Error(m.why)); toast(m.why); }
      };
    });
  }
  set(p) { for (const k in p) p[k] === null ? delete this.mine[k] : this.mine[k] = p[k]; if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t:'p', d:p })); }
  peers() { return [{ id: this.id, me: true, p: this.mine }, ...[...this.others].map(([id, p]) => ({ id, me: false, p }))]; }
  signal(to, d) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t:'s', to, d })); }
}

// ===================== 免伺服器 P2P（PeerJS，中繼由一位玩家的瀏覽器擔任） =====================
const PEER_OPTS = () => { const q = new URLSearchParams(location.search), h = q.get('peerhost'); return h ? { host: h.split(':')[0], port: +(h.split(':')[1] || 9000), path: '/', secure: false, debug: 0 } : (window.HS_PEER || { debug: 0 }); };
const PEER_ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' }];
class PeerNet {
  constructor() { this.id = null; this.mine = {}; this.others = new Map(); this.onSignal = null; this.hub = null; this.conn = false; this.err = null; }
  mkPeer(id) { return new Promise((res, rej) => { const p = id ? new Peer(id, { ...PEER_OPTS(), config: { iceServers: PEER_ICE } }) : new Peer({ ...PEER_OPTS(), config: { iceServers: PEER_ICE } }); const t = setTimeout(() => rej(Object.assign(new Error('peer timeout'), { type: 'timeout' })), 12000); p.on('open', () => { clearTimeout(t); res(p); }); p.on('error', e => { clearTimeout(t); rej(e); }); }); }
  async start(code) {
    if (!window.Peer) throw Object.assign(new Error('nopeerjs'), { why: 'nopeerjs' });
    this.code = code; this.hubId = 'cutehs-' + code.toLowerCase();
    const rid = 'p' + Math.random().toString(36).slice(2, 10);
    try { this.me = await this.mkPeer(this.hubId + '-' + rid); } catch (e) { throw Object.assign(new Error('peer'), { why: 'peer:' + (e.type || e.message) }); }
    this.id = rid;
    this.me.on('disconnected', () => { try { this.me.reconnect(); } catch {} });
    await this.link();
    // 心跳：中繼 7 秒沒回應就視為離線，改由其他人接手
    setInterval(() => {
      if (this.c?.open) { try { this.c.send({ t:'hb' }); } catch {} }
      if (this.c && Date.now() - (this.lastHub || 0) > 7000) { const c = this.c; this.c = null; this.conn = false; try { c.close(); } catch {} setTimeout(() => this.relink(), 300 + Math.random() * 1500); }
    }, 2000);
  }
  // 嘗試成為中繼；已有人當中繼就連過去
  async link() {
    this.conn = false; this.others.clear();
    for (let tries = 0; tries < 10 && !this.conn; tries++) {
      if (!this.hub) { try { this.hub = new Hub(await this.mkPeer(this.hubId)); } catch (e) { if (e.type !== 'unavailable-id') console.warn('[p2p] hub', e.type || e); this.hub = null; } }
      await new Promise((res) => {
        const c = this.me.connect(this.hubId, { reliable: true, serialization: 'json' }); let done = false;
        const fin = ok => { if (done) return; done = true; if (!ok) try { c.close(); } catch {} res(); };
        c.on('open', () => { if (done) { try { c.close(); } catch {} return; } this.c = c; this.conn = true; this.lastHub = Date.now(); c.send({ t:'hello', id:this.id, pres:this.mine }); fin(true); });
        c.on('data', m => { if (this.c === c) { this.lastHub = Date.now(); this.onMsg(m); } });
        c.on('close', () => { if (this.c === c) { this.c = null; this.conn = false; console.warn('[p2p] hub link closed'); setTimeout(() => this.relink(), 300 + Math.random() * 1500); } });
        c.on('error', e => { console.warn('[p2p] link error', e?.type || e); fin(false); });
        setTimeout(() => fin(false), 10000);
      });
      if (!this.conn) await new Promise(r => setTimeout(r, 800));
    }
    if (!this.conn) throw Object.assign(new Error('nohub'), { why: 'nohub' });
  }
  async relink() { if (this.conn || this.relinking) return; this.relinking = true; try { await this.link(); } catch (e) { this.err = '中繼重連失敗'; } this.relinking = false; }
  onMsg(m) {
    if (m.t === 'w') { this.others.clear(); for (const [id, p] of m.peers) if (id !== this.id) this.others.set(id, p); }
    else if (m.t === 'p' && m.id !== this.id) { const o = this.others.get(m.id) || {}; for (const k in m.d) m.d[k] === null ? delete o[k] : o[k] = m.d[k]; this.others.set(m.id, o); }
    else if (m.t === 'l') this.others.delete(m.id);
    else if (m.t === 's') this.onSignal?.(m.from, m.d);
  }
  set(p) { for (const k in p) p[k] === null ? delete this.mine[k] : this.mine[k] = p[k]; if (this.c?.open) this.c.send({ t:'p', d:p }); }
  peers() { return [{ id: this.id, me: true, p: this.mine }, ...[...this.others].map(([id, p]) => ({ id, me: false, p }))]; }
  signal(to, d) { if (this.c?.open) this.c.send({ t:'s', to, d }); }
}
class Hub { // 由某位玩家的瀏覽器執行，只負責轉送
  constructor(peer) {
    this.peer = peer; this.cl = new Map();
    peer.on('connection', c => {
      let id = null;
      c.on('data', m => {
        if (id) { const v = this.cl.get(id); if (v) v.seen = Date.now(); }
        if (m.t === 'hb') { try { c.send({ t:'hb' }); } catch {} return; }
        if (m.t === 'hello') { id = m.id; this.cl.set(id, { c, pres: m.pres || {}, seen: Date.now() }); c.send({ t:'w', peers: [...this.cl].map(([i, v]) => [i, v.pres]) }); this.bc({ t:'p', id, d: m.pres || {} }, id); }
        else if (m.t === 'p' && id) { const v = this.cl.get(id); if (!v) return; for (const k in m.d) m.d[k] === null ? delete v.pres[k] : v.pres[k] = m.d[k]; this.bc({ t:'p', id, d: m.d }, id); }
        else if (m.t === 's' && id) { const v = this.cl.get(m.to); if (v?.c.open) v.c.send({ t:'s', from: id, d: m.d }); }
      });
      c.on('close', () => { if (id && this.cl.get(id)?.c === c) { this.cl.delete(id); this.bc({ t:'l', id }); } });
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
    setInterval(() => { for (const [i, v] of this.cl) if (Date.now() - v.seen > 8000) { this.cl.delete(i); try { v.c.close(); } catch {} this.bc({ t:'l', id: i }); } }, 2000);
  }
  bc(m, except) { for (const [i, v] of this.cl) if (i !== except && v.c.open) try { v.c.send(m); } catch {} }
}

// ===================== 語音（自架版：WebRTC + 距離衰減） =====================
class Voice {
  constructor(net, ice) { this.net = net; this.ice = ice; this.pcs = new Map(); this.stream = null; this.track = null; this.muted = false; this.level = 0; net.onSignal = (f, d) => this.onSignal(f, d); }
  async init() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.track = this.stream.getAudioTracks()[0]; this.track.enabled = false;
      const src = AC().createMediaStreamSource(this.stream); this.an = AC().createAnalyser(); this.an.fftSize = 512; src.connect(this.an); this.buf = new Uint8Array(this.an.fftSize);
      return true;
    } catch (e) { console.warn('mic', e); return false; }
  }
  pc(id, init) {
    let o = this.pcs.get(id); if (o) return o;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    o = { pc, gain: AC().createGain(), el: null, t0: performance.now(), init }; o.gain.gain.value = 0; o.gain.connect(AC().destination); this.pcs.set(id, o);
    if (this.track) pc.addTrack(this.track, this.stream); else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = e => e.candidate && this.net.signal(id, { c: e.candidate });
    pc.ontrack = e => {
      const st = e.streams[0] || new MediaStream([e.track]);
      o.el = new Audio(); o.el.muted = true; o.el.srcObject = st; o.el.play().catch(() => {});
      AC().createMediaStreamSource(st).connect(o.gain);
    };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.drop(id); };
    if (init) pc.onnegotiationneeded = async () => {
      if (o.making || pc.signalingState !== 'stable') return; o.making = true;
      try { const off = await pc.createOffer(); if (pc.signalingState !== 'stable') return; await pc.setLocalDescription(off); this.net.signal(id, { sdp: pc.localDescription }); } catch (e) { console.warn(e); } finally { o.making = false; }
    };
    if (init && !this.track) pc.onnegotiationneeded();
    return o;
  }
  async onSignal(from, d) {
    if (d.sdp?.type === 'offer' && this.pcs.has(from)) this.drop(from); // 每個新 offer 都重新建立
    const o = this.pc(from, false), pc = o.pc;
    try {
      if (d.sdp) { await pc.setRemoteDescription(d.sdp); if (d.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); this.net.signal(from, { sdp: pc.localDescription }); } }
      else if (d.c) await pc.addIceCandidate(d.c);
    } catch (e) { console.warn('signal', e); }
  }
  drop(id) { const o = this.pcs.get(id); if (!o) return; try { o.pc.close(); } catch {} o.gain.disconnect(); this.pcs.delete(id); }
  sync(ids) {
    for (const id of ids) if (!this.pcs.has(id) && this.net.id < id) this.pc(id, true);
    for (const [id, o] of this.pcs) if (o.init && o.pc.connectionState !== 'connected' && performance.now() - o.t0 > 10000) this.drop(id); // 卡住就重試
    for (const id of [...this.pcs.keys()]) if (!ids.includes(id)) this.drop(id);
  }
  setGain(id, g) { const o = this.pcs.get(id); if (o) o.gain.gain.setTargetAtTime(g, AC().currentTime, .1); }
  tick(canTalk) {
    if (!this.track) return false;
    this.track.enabled = canTalk && !this.muted;
    if (!this.track.enabled) return false;
    this.an.getByteTimeDomainData(this.buf); let s = 0; for (const v of this.buf) s += (v - 128) ** 2; this.level = Math.sqrt(s / this.buf.length);
    return this.level > 6;
  }
}

// ===================== 音效 =====================
let actx = null; const AC = () => (actx ??= new (window.AudioContext || window.webkitAudioContext)());
let noiseBuf = null;
function nbuf() { if (noiseBuf) return noiseBuf; const c = AC(); noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return noiseBuf; }
function panner(x, y, z) { const p = AC().createPanner(); Object.assign(p, { panningModel:'HRTF', distanceModel:'inverse', refDistance:1.5, rolloffFactor:1.6, maxDistance:30 }); p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; p.connect(AC().destination); return p; }
function clink(x, z, vol = 1) {
  try {
    const c = AC(), t = c.currentTime, out = panner(x, .2, z);
    for (const f of [2300, 3500, 5200]) { const s = c.createBufferSource(); s.buffer = nbuf(); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * (0.9 + Math.random() * .2); bp.Q.value = 25; const g = c.createGain(); g.gain.setValueAtTime(.9 * vol, t); g.gain.exponentialRampToValueAtTime(.001, t + .22); s.connect(bp); bp.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + .25); }
    const o = c.createOscillator(), g2 = c.createGain(); o.frequency.value = 60; g2.gain.setValueAtTime(.35 * vol, t); g2.gain.exponentialRampToValueAtTime(.001, t + .15); o.connect(g2); g2.connect(out); o.start(t); o.stop(t + .16);
  } catch {}
}
function beep(type) {
  try {
    const c = AC(), t = c.currentTime, o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination);
    const P = { pick:[[660,0],[990,.08]], err:[[150,0],[110,.12]], tick:[[880,0]], ok:[[523,0],[659,.1],[784,.2]], bell:[[392,0],[392,.6],[392,1.2]], heart:[[52,0],[48,.18]], toll:[[147,0],[147,1.2],[147,2.4],[147,3.6],[147,4.8],[147,6.0]], sting:[[880,0],[831,.08],[784,.16],[740,.24]], creak:[[180,0],[240,.15],[140,.3]] }[type];
    o.type = type === 'err' ? 'square' : type === 'creak' || type === 'sting' ? 'sawtooth' : 'triangle';
    P.forEach(([f, dt]) => o.frequency.setValueAtTime(f, t + dt));
    const len = type === 'bell' ? 2.2 : type === 'toll' ? 7.5 : .18 + P.length * .1, vol = type === 'heart' ? .5 : type === 'creak' ? .03 : type === 'toll' ? .22 : .1;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + len); o.start(t); o.stop(t + len + .05);
  } catch {}
}
function scream() {
  try {
    const c = AC(), t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = nbuf(); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(1400, t); bp.frequency.exponentialRampToValueAtTime(300, t + 1.4);
    const g = c.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.9, t + .05); g.gain.exponentialRampToValueAtTime(.001, t + 1.6); s.connect(bp); bp.connect(g); g.connect(c.destination); s.start(t); s.stop(t + 1.7);
    const o = c.createOscillator(), g2 = c.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(40, t + 1.5); g2.gain.setValueAtTime(.25, t); g2.gain.exponentialRampToValueAtTime(.001, t + 1.6); o.connect(g2); g2.connect(c.destination); o.start(t); o.stop(t + 1.7);
  } catch {}
}
// ---- 恐怖音效 ----
let zhVoice = null;
function pickVoice() { try { const vs = speechSynthesis.getVoices(); zhVoice = vs.find(v => /zh[-_]TW/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || vs.find(v => /cmn|yue/i.test(v.lang)) || null; } catch {} }
try { speechSynthesis.onvoiceschanged = pickVoice; pickVoice(); } catch {}
function whisper(text, { pitch = .15, rate = .7, vol = .8 } = {}) {
  try { if (!window.speechSynthesis || !zhVoice) return; const u = new SpeechSynthesisUtterance(text); u.voice = zhVoice; u.lang = zhVoice.lang; u.pitch = pitch; u.rate = rate; u.volume = vol; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {}
}
const MUSICBOX = [69,72,76,81,79,76,72,74,76,72,69,0,71,74,77,76,74,71,68,69,0,0]; // 原創小調旋律
let mbI = 0, mbT = 0;
function mbNote(x, z, m, vol = 1) {
  try { const c = AC(), t = c.currentTime, f = 440 * 2 ** ((m - 69) / 12), out = panner(x, 1.7, z);
    for (const [mul, v] of [[1, .26], [2, .07], [3.01, .035], [4.2, .015]]) { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f * mul * (1 + (Math.random() - .5) * .006); g.gain.setValueAtTime(v * vol, t); g.gain.exponentialRampToValueAtTime(.0005, t + 1.6); o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.7); } } catch {}
}
function slam(x, z, vol = 1) {
  try { const c = AC(), t = c.currentTime, out = panner(x, 1.2, z);
    const s = c.createBufferSource(); s.buffer = nbuf(); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; const g = c.createGain(); g.gain.setValueAtTime(1.6 * vol, t); g.gain.exponentialRampToValueAtTime(.001, t + .5); s.connect(lp); lp.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + .55);
    const o = c.createOscillator(), g2 = c.createGain(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(30, t + .4); g2.gain.setValueAtTime(1.2 * vol, t); g2.gain.exponentialRampToValueAtTime(.001, t + .45); o.connect(g2); g2.connect(out); o.start(t); o.stop(t + .5); } catch {}
}
function steps(x, z, n = 7) { // 孩子奔跑的腳步聲，從旁邊跑過去
  const a = Math.random() * 6.28;
  for (let i = 0; i < n; i++) setTimeout(() => { try { const c = AC(), t = c.currentTime, out = panner(x + Math.sin(a) * i * .5, .1, z + Math.cos(a) * i * .5); const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(50, t + .08); g.gain.setValueAtTime(.9, t); g.gain.exponentialRampToValueAtTime(.001, t + .1); o.connect(g); g.connect(out); o.start(t); o.stop(t + .12); } catch {} }, i * 170);
}
function breath() {
  try { const c = AC(), t = c.currentTime; const s = c.createBufferSource(); s.buffer = nbuf(); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 750; bp.Q.value = .8; const g = c.createGain();
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.12, t + .7); g.gain.linearRampToValueAtTime(.02, t + .9); g.gain.linearRampToValueAtTime(.09, t + 1.1); g.gain.linearRampToValueAtTime(.0001, t + 1.5);
    s.connect(bp); bp.connect(g); g.connect(c.destination); s.start(t, Math.random()); s.stop(t + 1.6); } catch {}
}
let chaseS = null;
function setChase(on) {
  try {
    if (on && !chaseS) { const c = AC(), o = c.createOscillator(), o2 = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain(), lp = c.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 55; o2.type = 'sawtooth'; o2.frequency.value = 58.3; lfo.frequency.value = 2.4; lg.gain.value = .07; g.gain.value = .09; lp.type = 'lowpass'; lp.frequency.value = 420;
      lfo.connect(lg); lg.connect(g.gain); o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(c.destination); o.start(); o2.start(); lfo.start(); chaseS = { o, o2, lfo, g }; }
    else if (!on && chaseS) { const k = chaseS; chaseS = null; k.g.gain.setTargetAtTime(0, AC().currentTime, .4); setTimeout(() => { try { k.o.stop(); k.o2.stop(); k.lfo.stop(); } catch {} }, 2000); }
  } catch {}
}
let drone = null;
function setDrone(on) {
  try {
    if (on && !drone) { const c = AC(), s = c.createBufferSource(); s.buffer = nbuf(); s.loop = true; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180; const g = c.createGain(); g.gain.value = .07; s.connect(lp); lp.connect(g); g.connect(c.destination); s.start(); drone = { s, g }; }
    else if (!on && drone) { drone.s.stop(); drone = null; }
  } catch {}
}

// ===================== 狀態 =====================
let net = null, voice = null, myId = null, W = null, lastW = null;
const me = { x:19.5, z:28.5, yaw:0, pitch:0, crouch:false, sprint:false, stamina:1, fl:false, role:-1, fac:'v', spawned:false, st:'f', name:'', char:0 };
let mySeq = 0, myQ = [], chatI = 0, nzI = 0, pend = {}, myMsgI = 0, globMsgI = 0, inLobby = true, gameKey = '';
const remotes = new Map();
let hostState = null; // 只有房主使用
const keys = {};

function pres(p) { Object.assign(pend, p); }
setInterval(() => { if (!net) return; if (Object.keys(pend).length) { net.set(pend); pend = {}; } }, 70);
function act(t, a = 0) { mySeq++; myQ.push([mySeq, t, a]); myQ = myQ.slice(-6); pres({ q: myQ }); }
let hostMode = false, joinedAt = 0;
function hostId() {
  if (!net || performance.now() - joinedAt < 1500) return null;
  const ps = net.peers().filter(p => p.p.j || p.me);
  const pubs = ps.filter(p => (p.me ? hostMode : !!p.p.w)).map(p => p.id).sort();
  if (pubs.length) return pubs[0];
  return ps.map(p => p.id).filter(Boolean).sort()[0] ?? null;
}
function amHost() { return !!myId && hostId() === myId; }

// ===================== 房主：世界狀態 =====================
function newWorld(prev) {
  return { st:'lobby', g0: Math.random().toString(36).slice(2, 7), ph:0, pt:0, du: prev?.du ?? 1, vm: prev?.vm ?? 'room', pl:{}, it:{}, dr:{}, lk:{}, fl:{}, g:{ mo:'n' }, sq: prev?.sq ?? {}, msg:{ i:0, t:'' }, res:null };
}
function startGame() {
  const peers = net.peers().filter(p => p.p.j || p.me);
  const w = W; w.st = 'play'; w.g0 = Math.random().toString(36).slice(2, 7); w.ph = 0; w.pt = DUR[w.du][0];
  w.it = { dkey:'w', matches:'w', uv:'w', crowbar:'w', cutter:'w', cuffkey:'w', gk1:'w', gk2:'w', gk:'x', windkey:'w', diary:'w', doll:'w', tag:'w', photo:'w' };
  w.dr = { dn:1, cell:1, cf:0, st:0, dir:0, pr:0, h1:1, h2:0, cl:0, hc:1, dm:1, shed:0 };
  w.lk = { st:1, dir:1, shed:1 };
  w.fl = { cand:0, cd:0, sp:0, safe:0, gate:0, rit:0, desk:0, chain:0, padlock:0, seal:0, kitchen:0, sudoku:0, sokoban:0, cellbox:0, lab:0, don:0, mb:0 };
  w.g = { mo:'n' }; w.res = null; w.pl = {};
  const pref = peers.map(p => ({ id:p.id, f:p.p.fa || 'v', n:(p.p.n || '玩家').slice(0, 10), c:p.p.c || 0 }));
  const rnd = pref.filter(p => p.f === 'r').sort(() => Math.random() - .5);
  for (const p of rnd) { const nv = pref.filter(q => q.f === 'v').length, nc = pref.filter(q => q.f === 'c').length; p.f = nc < nv ? 'c' : 'v'; }
  const pools = { v:[0,1,2,3].sort(() => Math.random() - .5), c:[4,5,6,7].sort(() => Math.random() - .5) };
  const used = { v:0, c:0 };
  for (const p of pref) { const r = pools[p.f][used[p.f]++ % 4]; w.pl[p.id] = { n:p.n, f:p.f, r, s: p.f === 'c' ? 'c' : 'f', t:0, k:0, e:'', sp: used[p.f] - 1, mg:{ i:0, t:'' } }; }
  hostState = freshHost();
  annc('早上。陽光從破窗照進斯邁爾孤兒院。天黑之前，盡量把線索找齊。');
}
function freshHost() { const g0 = W?.g?.mo && W.g.mo !== 'n' ? W.g : null; return { gh:{ x:g0?.x ?? 32.5, z:g0?.z ?? 4.5, y:g0?.y ?? 0, mo:g0 ? 'p' : 'n', path:[], wait:0, tgt:null, lostT:0, last:null, inv:null, invT:0, doorWait:0, repath:0, lastDoor:null, cool:0 }, nz:{}, noises:[], ritT:0, acc:0 }; }
function annc(t) { W.msg = { i:(W.msg?.i || 0) + 1, t }; }
function tell(id, t) { const P = W.pl[id]; if (P) P.mg = { i:(P.mg?.i || 0) + 1, t }; }
function peerPos(id) {
  const p = net.peers().find(q => q.id === id); if (!p || !p.p.p) return null;
  return { x:p.p.p[0], z:p.p.p[1], fl:!!p.p.fl, cr:!!p.p.cr, nz:p.p.nz || 0 };
}
function near(id, x, z, r) { const p = peerPos(id); return p && Math.hypot(p.x - x, p.z - z) <= r; }
function giveTo(id, items) { for (const it of items) if (W.it[it] === 'w') W.it[it] = id; combineKey(id); }
function combineKey(id) { if (W.it.gk1 === id && W.it.gk2 === id) { W.it.gk1 = W.it.gk2 = 'u'; W.it.gk = id; annc(`${W.pl[id]?.n || '有人'} 把兩段鑰匙拼成了完整的「大門鑰匙」！`); } }
function noise(x, z, r) { hostState.noises.push({ x, z, r }); }
function lockDone(L) { return L === 'storage' ? !W.lk.st : !!W.fl[L]; }
function lockOk(id, P, L) {
  switch (L) {
    case 'kitchen': W.fl.kitchen = 1; giveTo(id, ['dkey', 'matches']); tell(id, '櫥櫃喀一聲打開了：裡面有「院長室鑰匙」和一盒「火柴」。'); break;
    case 'storage': W.lk.st = 0; W.dr.st = 1; tell(id, '喀嚓──儲藏室的門鎖彈開了。'); break;
    case 'safe': W.fl.safe = 1; giveTo(id, ['gk2', 'diary']); if (P.r === 5) P.t |= 1; tell(id, '保險箱開了！裡面有半截「大門鑰匙」和「院長日記」。'); break;
    case 'lab': W.fl.lab = 1; if (P.r === 6) P.t |= 2; tell(id, '紀錄箱打開了。裡面是一疊「笑容檢查表」，每個孩子都被打了滿分。'); break;
    case 'cellbox': W.fl.cellbox = 1; giveTo(id, ['gk1']); tell(id, '字輪對齊，木箱打開了：半截「大門鑰匙」！'); break;
    case 'sudoku': W.fl.sudoku = 1; giveTo(id, ['uv']); tell(id, '講台抽屜彈開：一支「紫外線手電筒」。'); break;
    case 'sokoban': W.fl.sokoban = 1; giveTo(id, ['cutter']); tell(id, '最後一塊鐵塊歸位，箱蓋彈開：「斷線鉗」！'); break;
  }
}
const BED_AT = [28.5, 30.5, 32.5, 34.5];

function hostAction(id, t, a) {
  const P = W.pl[id]; if (!P || W.st !== 'play') return;
  const pos = peerPos(id); if (!pos) return;
  if (P.s === 'e' || P.s === 'x' || P.s === 'd') return;
  if (P.s === 'c' && t !== 'pin') return tell(id, '你的雙手被銬在長椅上，什麼也做不了。');
  const has = it => W.it[it] === id;
  switch (t) {
    case 'code': {
      const [L, v] = Array.isArray(a) ? a : []; const at = LOCK_AT[L]; if (!at || !CODES[L] || lockDone(L) || !near(id, at[0], at[1], 2.8)) break;
      if (String(v) === CODES[L]) lockOk(id, P, L); else { tell(id, '……不對。鎖紋風不動。'); noise(at[0], at[1], 8); }
      break;
    }
    case 'solve': { const at = LOCK_AT[a]; if (at && (a === 'sudoku' || a === 'sokoban') && !lockDone(a) && near(id, at[0], at[1], 2.8)) lockOk(id, P, a); break; }
    case 'cont': {
      if (a === 'desk' && near(id, 32.5, 4.3, 2.5) && !W.fl.desk) { W.fl.desk = 1; giveTo(id, ['cuffkey']); tell(id, '書桌抽屜裡有一把「手銬鑰匙」。'); }
      if (a === 'cupboard' && near(id, 10.7, 3.2, 2.5)) { giveTo(id, ['windkey']); tell(id, '玻璃罐後面藏著一把「發條鑰匙」。'); }
      if (a === 'crate' && near(id, 24.6, 1.6, 2.2)) { giveTo(id, ['doll']); tell(id, '木箱最底下壓著一個「舊玩偶」。'); }
      if (a === 'tag' && near(id, 16.5, 1.8, 2.5)) { giveTo(id, ['tag']); tell(id, '撿起了「褪色的名牌」。'); if (P.r === 4) P.t |= 1; }
      if (a === 'photo' && near(id, 16.6, 13.7, 2.5)) { giveTo(id, ['photo']); tell(id, '取下了一張「院童合照」。'); }
      if (/^bed[0-3]$/.test(a)) { const i = +a[3]; if (!near(id, BED_AT[i], 19.4, 2)) break;
        if (i === 2 && W.it.crowbar === 'w') { giveTo(id, ['crowbar']); tell(id, '床板底下用麻繩綁著一根「撬棍」！'); }
        else { tell(id, '床底下只有灰塵……（你撞到了床腳）'); noise(BED_AT[i], 19.4, 7); } }
      break;
    }
    case 'drop': if (W.it[a] === id) W.it[a] = [r2(pos.x), r2(pos.z)]; break;
    case 'pick': { const v = W.it[a]; if (Array.isArray(v) && Math.hypot(v[0] - pos.x, v[1] - pos.z) < 2.2) { W.it[a] = id; combineKey(id); } break; }
    case 'door': {
      const d = DOORS.find(q => q.id === a); if (!d || Math.hypot(d.x + .5 - pos.x, d.z + .5 - pos.z) > 2.4) break;
      const open = W.dr[d.id];
      if (d.cell && !open && inRect(pos.x, pos.z, CELLR)) { tell(id, '門閂在外面，從裡面打不開。'); break; }
      if (d.lock && W.lk[d.id] && !open) {
        if (d.lock === 'key' && has(d.key)) { W.lk[d.id] = 0; tell(id, '喀嚓──院長室的門鎖打開了。'); }
        else { tell(id, d.lock === 'pry' ? '門被木板釘死了，需要撬棍。' : d.lock === 'code' ? '門上有一個四位數的密碼鎖。' : '門鎖著。'); break; }
      }
      W.dr[d.id] = open ? 0 : 1;
      if (d.cell && !open) { let n = 0; for (const [pid, Q] of Object.entries(W.pl)) if (Q.s === 'j') { Q.s = 'f'; n++; tell(pid, '有人拉開了門閂，你自由了！'); } if (n) tell(id, `你救出了 ${n} 個人。`); }
      noise(d.x + .5, d.z + .5, 6);
      break;
    }
    case 'pry': {
      if (!has('crowbar')) break;
      if (a === 'shed' && W.lk.shed && near(id, 35.5, 26.5, 2.6)) { W.lk.shed = 0; W.dr.shed = 1; tell(id, '木板被撬開了！（好大的聲音……）'); noise(35.5, 26.5, 15); }
      if (a === 'donation' && !W.fl.don && near(id, 10.4, 7.2, 2.5)) { W.fl.don = 1; if (P.r === 5) P.t |= 2; tell(id, '捐款箱裡只有幾枚生鏽的硬幣，和一張紙條：「微笑是最好的捐款。」'); noise(10.4, 7.2, 10); }
      break;
    }
    case 'uncuff': { const T = W.pl[a]; const tp = peerPos(a); if (T && T.s === 'c' && has('cuffkey') && tp && Math.hypot(tp.x - pos.x, tp.z - pos.z) < 2.2) { T.s = 'f'; tell(a, `${P.n} 替你解開了手銬！`); tell(id, `你替 ${T.n} 解開了手銬。`); } break; }
    case 'pin': if (P.s === 'c' && inRect(pos.x, pos.z, PRAYER)) { if (P.pin) tell(id, '髮夾已經斷了……只能等隊友帶手銬鑰匙來。'); else { P.s = 'f'; P.pin = 1; tell(id, '你用髮夾撬開了手銬！（髮夾也斷了，下次就沒辦法了）'); } } break;
    case 'candle': {
      if (W.fl.cand || !near(id, 3.2, 17, 2.5)) break;
      if (!has('matches')) { tell(id, '需要火柴才能點蠟燭。'); break; }
      if (a === CANDLE_ORDER[W.fl.cd]) { W.fl.cd++; if (W.fl.cd >= 4) { W.fl.cand = 1; annc('禱告室的四支蠟燭全部點亮了。祭壇後方傳來低沉的風聲……'); if (W.ph === 3) openSecret(); } }
      else { W.fl.cd = 0; tell(id, '火焰「噗」地一聲全部熄滅了。順序不對。'); noise(3, 17, 10); }
      break;
    }
    case 'altar': if (near(id, 3.3, 17, 2.5)) { let n = 0; for (const r of RELICS) if (W.it[r] === id) { W.it[r] = 'a'; n++; } if (n) tell(id, `你把 ${n} 件遺物放上了祭壇。（${RELICS.filter(r => W.it[r] === 'a').length}／4）`); checkRitual(); } break;
    case 'bless': if (P.r === 3 && near(id, 3.3, 17.5, 2.5)) { P.t |= 1; tell(id, '你低聲為孩子們禱告。燭火輕輕晃了一下。'); } break;
    case 'snap': { const bit = { wall:1, cell:2, safe:4 }[a]; if (P.r === 0 && bit) { P.k |= bit; tell(id, '喀擦。證據已拍下。'); } break; }
    case 'files': if (P.r === 0 && near(id, 28.6, 2.5, 2.5)) { P.t |= 2; tell(id, '你把名單拍了下來。'); } break;
    case 'read': if (has('diary') && P.r === 2) P.t |= 1; break;
    case 'prints': if (P.r === 2 && has('uv') && near(id, 16.5, 8.1, 2)) { P.t |= 2; tell(id, '指紋已比對：和院長書桌上的一樣。'); } break;
    case 'carve': if (P.r === 1 && near(id, 34.5, 13.7, 2)) { P.t |= 2; tell(id, '……是你小時候刻的。你一直都記得要笑。'); } break;
    case 'drawing': if (P.r === 4 && near(id, 24, 20.3, 2)) { P.t |= 2; tell(id, '你認出了妹妹的筆跡。'); } break;
    case 'record': if (P.r === 6 && inRect(pos.x, pos.z, CONF)) { P.t |= 1; tell(id, '你對著錄音機說出了你知道的一切。'); } break;
    case 'wind': if (has('windkey') && near(id, 16.5, 16.3, 2.5)) { W.fl.mb = (W.fl.mb || 0) + 1; if (P.r === 7) P.t |= 2; tell(id, '音樂盒緩緩轉動起來……那是祂常哼的旋律。'); noise(16.5, 16.3, 9); } break;
    case 'pray': if (P.r === 7 && near(id, 12.5, 26.5, 2.5)) { if (W.ph === 3) { P.t |= 1; tell(id, '你在月光下為孩子們祈禱。'); } else tell(id, '……現在還不是時候。（要在深夜）'); } break;
    case 'piano': noise(20.4, 18.5, 14); break;
    case 'gate': {
      if (!near(id, 19.9, 30.5, 2.6)) break;
      if (a === 'cut' && has('cutter') && !W.fl.chain) { W.fl.chain = 1; annc(`${P.n} 剪斷了大門的鐵鍊。（還剩大鎖與封印）`); noise(19.9, 30.5, 10); }
      if (a === 'unlock' && has('gk') && W.fl.chain && !W.fl.padlock) { W.fl.padlock = 1; annc(`${P.n} 打開了大門的大鎖。只剩下封印了──等深夜。`); }
      if (a === 'seal' && W.fl.chain && W.fl.padlock && !W.fl.seal) { if (W.ph !== 3) { tell(id, '封印撕不下來。要等到深夜。'); break; } W.fl.seal = 1; noise(19.9, 30.5, 18); }
      if (W.fl.chain && W.fl.padlock && W.fl.seal && !W.fl.gate) { W.fl.gate = 1; annc('封印被撕下了──孤兒院的大門打開了！快逃！'); }
      break;
    }
  }
}
function openSecret() { if (!W.fl.sp) { W.fl.sp = 1; annc('月光照進禱告室，祭壇後的石牆緩緩移開──密道打開了。'); } }
function checkRitual() {
  if (W.fl.rit || W.ph !== 3) return;
  if (RELICS.every(r => W.it[r] === 'a')) { for (const P of Object.values(W.pl)) if (P.s === 'd' || P.s === 'c') P.s = 'f'; W.fl.rit = 1; hostState.ritT = 14; annc('孩子們的遺物回到了祭壇。遠處傳來一聲很輕的哭聲……鐵鍊聲停了。'); W.fl.gate = 1; }
}
function hostTick(dt) {
  const H = hostState ??= freshHost();
  const peers = net.peers();
  for (const p of peers) { const q = p.p.q; if (!q) continue; const last = W.sq[p.id] || 0; for (const [s, t, a] of q) if (s > last) { hostAction(p.id, t, a); W.sq[p.id] = s; } }
  if (W.st !== 'play') return;
  for (const p of peers) if (p.p.j && !W.pl[p.id]) W.pl[p.id] = { n:(p.p.n || '玩家').slice(0, 10), f:'v', r:[0,1,2,3][Math.floor(Math.random() * 4)], s:'f', t:0, k:0, e:'', sp:Object.keys(W.pl).length, mg:{ i:0, t:'' } };
  W.pt -= dt;
  if (W.pt <= 0) {
    if (W.ph < 3) { W.ph++; W.pt = DUR[W.du][W.ph]; annc(['', '中午。灰塵在光裡飄著。', '傍晚。影子越拉越長……天黑之前做好準備。', '深夜。走廊的盡頭，響起了鐵鍊拖地的聲音。大門的封印，現在撕得下來了。'][W.ph]); if (W.ph === 3) { if (W.fl.cand) openSecret(); checkRitual(); } }
    else return endGame('dawn');
  }
  if (W.fl.rit) { H.ritT -= dt; if (H.ritT <= 0) return endGame('ritual'); }
  for (const p of peers) { const P = W.pl[p.id]; if (!P || P.s !== 'f' || !p.p.p) continue; if (p.p.nz && p.p.nz !== H.nz[p.id]) { if (H.nz[p.id] !== undefined && !isSafe(p.p.p[0], p.p.p[1])) noise(p.p.p[0], p.p.p[1], 9); H.nz[p.id] = p.p.nz; } }
  for (const p of peers) {
    const P = W.pl[p.id]; if (!P || P.s !== 'f' || !p.p.p) continue; const [x, z] = p.p.p;
    if (W.fl.gate && z >= 31.2) escape(p.id, 'gate');
    else if (W.fl.sp && x < 0.6 && z > 16 && z < 17) escape(p.id, 'secret');
  }
  ghostTick(dt, peers);
  const active = Object.entries(W.pl).filter(([id]) => peers.some(p => p.id === id));
  if (active.length && active.every(([, P]) => P.s === 'e')) return endGame('all');
  // 深夜全滅：還在院內的人全被抓（或被銬著）就出局
  const inside = active.filter(([, P]) => P.s !== 'e');
  if (W.ph === 3 && !W.fl.rit && inside.length && inside.every(([, P]) => P.s === 'c' || P.s === 'j')) {
    H.wipeT = (H.wipeT || 0) + dt; if (H.wipeT > 2.5) return endGame('wipe');
  } else H.wipeT = 0;
}
function escape(id, how) { const P = W.pl[id]; P.s = 'e'; P.e = how; annc(`${P.n} ${how === 'gate' ? '從正門' : '經由密道'}逃出了孤兒院！`); }
function endGame(why) {
  const ids = Object.keys(W.pl);
  for (const id of ids) { const P = W.pl[id]; if (P.s === 'e') continue; P.e = why === 'ritual' ? 'ritual' : (P.s === 'j' || P.s === 'd' || (P.s === 'c' && (P.cap || why === 'wipe'))) ? 'caught' : P.s === 'c' ? 'cuffed' : 'dawn'; if (why === 'ritual') P.s = 'e'; }
  for (const id of ids) { const P = W.pl[id];
    if (P.r === 0 && (P.k & 7) === 7) P.t |= 1;
    if (P.r === 1 && (W.it.doll === 'a' || (W.it.doll === id && P.s === 'e'))) P.t |= 1;
    if (P.r === 3 && W.fl.cand) P.t |= 2;
    if (P.r === 4 && (W.it.tag === 'a' || W.it.tag === id)) P.t |= 1;
  }
  W.res = { why, rit: W.fl.rit }; W.st = 'end'; W.g = { mo:'n' };
}


// ---------- 鬼 AI ----------
function solidForGhost(x, z) { const c = G[z]?.[x]; if (!c || c === '#' || c === 'G' || c === 'P') return true; if (c === 'D') { const d = doorAt(x, z); if (d?.lock && d.lock !== 'key' && W?.lk?.[d.id]) return true; } return FURN.has(key(x, z)) || SAFE.has(key(x, z)); }
function findPath(sx, sz, gx, gz) {
  const s = [tileOf(sx), tileOf(sz)]; let g = [tileOf(gx), tileOf(gz)];
  if (solidForGhost(...g)) { let best = null, bd = 9; for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const t = [g[0] + dx, g[1] + dz]; if (!solidForGhost(...t) && Math.abs(dx) + Math.abs(dz) < bd) { bd = Math.abs(dx) + Math.abs(dz); best = t; } } if (!best) return []; g = best; }
  const prev = new Map(), q = [s], sk = key(...s); prev.set(sk, null);
  while (q.length) {
    const [x, z] = q.shift(); if (x === g[0] && z === g[1]) break;
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx, nz = z + dz, k = key(nx, nz); if (prev.has(k) || solidForGhost(nx, nz)) continue; prev.set(k, [x, z]); q.push([nx, nz]); }
  }
  const gk = key(...g); if (!prev.has(gk)) return [];
  const path = []; let cur = g; while (cur && key(...cur) !== sk) { path.unshift(cur); cur = prev.get(key(...cur)); }
  return path;
}
function los(x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.2);
  for (let i = 1; i < n; i++) { const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n, tx = tileOf(x), tz = tileOf(z), c = G[tz]?.[tx];
    if (!c || c === '#' || c === 'P') return false; if (c === 'D') { const dd = doorAt(tx, tz); if (dd && !W.dr[dd.id]) return false; } }
  return true;
}
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
function ghostTick(dt, peers) {
  const H = hostState, g = H.gh;
  if (W.ph !== 3 || W.fl.rit) { g.mo = 'n'; W.g = { mo:'n' }; H.noises.length = 0; return; }
  if (g.mo === 'n') Object.assign(g, { x:32.5, z:4.5, y:Math.PI, mo:'p', path:[], wait:2.5 });
  g.path ??= [];
  g.cool = Math.max(0, g.cool - dt);
  H.huntT = (H.huntT ?? 45) - dt;
  if (H.huntT <= 0 && g.mo === 'p') {
    H.huntT = 35 + Math.random() * 30;
    const cands = peers.filter(p => W.pl[p.id]?.s === 'f' && p.p.p && !isSafe(p.p.p[0], p.p.p[1]));
    if (cands.length) { const t = cands[Math.floor(Math.random() * cands.length)]; g.mo = 'i'; g.inv = { x:t.p.p[0], z:t.p.p[1] }; g.path = findPath(g.x, g.z, g.inv.x, g.inv.z); g.invT = 0; tell(t.id, '……鐵鍊聲停了一下，然後朝你這邊過來了。'); }
  }
  H.whT = (H.whT ?? 12) - dt; if (H.whT <= 0 && g.mo === 'p') { H.whT = 16 + Math.random() * 16; H.wh = (H.wh || 0) + 1; H.wi = 1 + Math.floor(Math.random() * 3); }
  // 視覺
  let seen = null, bd = 1e9;
  for (const p of peers) {
    const P = W.pl[p.id]; if (!P || P.s !== 'f' || !p.p.p) continue;
    const [x, z] = p.p.p; if (isSafe(x, z)) continue;
    const dx = x - g.x, dz = z - g.z, d = Math.hypot(dx, dz);
    let range = 8.5; if (p.p.fl) range += 5; if (p.p.cr) range -= 3.5;
    if (d > range) continue;
    const ang = Math.abs(angDiff(Math.atan2(dx, dz), g.y));
    if (d > 1.6 && ang > 0.95) continue;
    if (!los(g.x, g.z, x, z)) continue;
    if (d < bd) { bd = d; seen = p.id; }
  }
  // 聽覺
  let heard = null;
  for (const n of H.noises) if (Math.hypot(n.x - g.x, n.z - g.z) <= n.r) heard = n;
  H.noises.length = 0;
  // 狀態機
  if (g.mo === 'd') { // 拖人回禱告室
    const P = W.pl[g.vic];
    if (!P || P.s !== 'd' || !peerPos(g.vic)) { if (P && P.s === 'd') P.s = 'f'; g.mo = 'p'; g.path = []; g.wait = 1; g.vic = null; }
    else if (!g.path.length && g.doorWait <= 0) {
      P.s = 'c'; P.cap = (P.cap || 0) + 1;
      annc(`${P.n} 被銬回了禱告室的長椅上……`); tell(g.vic, '冰冷的手銬再次扣上。祂摸了摸你的頭，笑著離開了。');
      g.mo = 'p'; g.wait = 2.5; g.cool = 6; g.vic = null; g.y += Math.PI;
    }
  }
  else if (g.mo === 'l') { g.wait -= dt; if (!g.turned && g.wait < 2.2) { g.turned = true; g.y += Math.PI * .8; } if (g.wait <= 0) { g.mo = 'p'; g.path = []; g.wait = .5; } }
  else if (seen && g.cool <= 0) { if (g.mo !== 'c') { g.path = []; g.repath = 0; } g.mo = 'c'; g.tgt = seen; g.lostT = 0; }
  if (g.mo === 'c') {
    const P = W.pl[g.tgt], pp = peerPos(g.tgt);
    if (!P || !pp || P.s !== 'f') { g.mo = 'p'; g.path = []; }
    else if (isSafe(pp.x, pp.z)) { g.mo = 'l'; g.wait = 4.8; g.turned = false; g.path = []; g.y = Math.atan2(pp.x - g.x, pp.z - g.z); H.wh = (H.wh || 0) + 1; H.wi = 0; } // 先盯著看、低語，再當作沒看到
    else {
      if (seen === g.tgt) { g.last = { x:pp.x, z:pp.z }; g.lostT = 0; } else g.lostT += dt;
      if (g.lostT > 4) { g.mo = 'i'; g.inv = g.last; g.path = findPath(g.x, g.z, g.inv.x, g.inv.z); g.invT = 0; }
      else { g.repath -= dt; if (g.repath <= 0) { g.path = findPath(g.x, g.z, g.last.x, g.last.z); g.repath = .35; } }
    }
  } else if (heard && g.mo !== 'l' && g.mo !== 'd') { g.mo = 'i'; g.inv = { x:heard.x, z:heard.z }; g.path = findPath(g.x, g.z, heard.x, heard.z); g.invT = 0; }
  if (g.mo === 'i' && !g.path.length && !g.doorWait) { g.invT += dt; g.y += dt * 1.6; if (g.invT > 3.5) { g.mo = 'p'; g.wait = 1; } }
  if (g.mo === 'p' && !g.path.length && !g.doorWait) {
    g.wait -= dt; g.y += Math.sin(performance.now() / 700) * dt * .9;
    if (g.wait <= 0) { const cur = roomAt(g.x, g.z); const opts = WAYPOINTS.filter(w => roomAt(...w) !== cur); const wp = opts[Math.floor(Math.random() * opts.length)]; g.path = findPath(g.x, g.z, wp[0], wp[1]); g.wait = 1 + Math.random() * 2.5; }
  }
  // 移動（細分步長，低幀率時也正確）
  let moving = false;
  for (let rem = dt; rem > 1e-4; rem -= .05) moving = ghostStep(g, Math.min(.05, rem)) || moving;
  ghostAfterMove(g, peers, moving);
}
function ghostStep(g, dt) {
  let moving = false;
  if (g.doorWait > 0) g.doorWait -= dt;
  else if (g.path.length && g.mo !== 'l') {
    const [tx, tz] = g.path[0], d = doorAt(tx, tz);
    if (d && !W.dr[d.id]) { W.dr[d.id] = 1; g.doorWait = .7; g.lastDoor = { id:d.id, x:d.x + .5, z:d.z + .5, done:false }; }
    else {
      const cx = tx + .5, cz = tz + .5, dx = cx - g.x, dz = cz - g.z, dist = Math.hypot(dx, dz);
      const sp = ({ p:1.3, i:1.8, c:3.0, d:2.5 }[g.mo] || 1.3) * (g.mo === 'd' ? 1 : 1 + .25 * clamp(1 - W.pt / DUR[W.du][3], 0, 1));
      if (dist < .06) g.path.shift();
      else { const st = Math.min(dist, sp * dt); g.x += dx / dist * st; g.z += dz / dist * st; moving = true; g.y += angDiff(Math.atan2(dx, dz), g.y) * Math.min(1, dt * 8); }
      if (d) g.lastDoor = { id:d.id, x:d.x + .5, z:d.z + .5, done:false };
    }
  }
  return moving;
}
function ghostAfterMove(g, peers, moving) {
  // 隨手關門
  if (g.lastDoor && !g.lastDoor.done && Math.hypot(g.lastDoor.x - g.x, g.lastDoor.z - g.z) > 1.7) {
    g.lastDoor.done = true;
    const blocked = peers.some(p => p.p.p && Math.hypot(p.p.p[0] - g.lastDoor.x, p.p.p[1] - g.lastDoor.z) < 1);
    if (!blocked && Math.random() < .4 && g.lastDoor.id !== 'dir') W.dr[g.lastDoor.id] = 0;
  }
  // 抓人
  for (const p of peers) {
    const P = W.pl[p.id]; if (!P || P.s !== 'f' || !p.p.p) continue;
    const [x, z] = p.p.p; if (isSafe(x, z)) continue;
    if (g.mo !== 'd' && Math.hypot(x - g.x, z - g.z) < .85) {
      P.s = 'd'; for (const [k, v] of Object.entries(W.it)) if (v === p.id) W.it[k] = [r2(x), r2(z)];
      const H = hostState; H.dropI = ((H.dropI || 0) + 1) % SPAWN_C.length; P.dp = SPAWN_C[H.dropI];
      g.mo = 'd'; g.vic = p.id; g.tgt = null; g.path = findPath(g.x, g.z, P.dp[0], P.dp[1]).slice(0, -1); g.doorWait = 1.9; // 先停下來「看著你」
      g.y = Math.atan2(x - g.x, z - g.z);
      annc(`${P.n} 被「祂」抓住了！正被拖往禱告室……`);
      break;
    }
  }
  W.g = { x:r2(g.x), z:r2(g.z), y:r2(g.y), mo:g.mo, mv:moving ? 1 : 0, v:g.mo === 'd' ? g.vic : 0, t:g.mo === 'c' ? g.tgt : 0, w:hostState.wh || 0, wi:hostState.wi || 0 };
}

// ===================== 客戶端 =====================
const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
const joy = { on:false, x:0, y:0, id:null, cx:0, cy:0 };
let lookId = null, touchRun = false;
let locked = false, usedLock = false, dragging = false, dragMoved = 0, lx = 0, ly = 0;
let dlgState = null, current = null, holdT = 0, toastTimer = 0, bannerTimer = 0;

function flashScreen(o = .85) { const f = $('flashFx'); if (!f) return; f.style.transition = 'none'; f.style.opacity = o; requestAnimationFrame(() => { f.style.transition = 'opacity 1.4s'; f.style.opacity = 0; }); }
function toast(t, ms = 2600) { const e = $('toast'); e.innerHTML = t; e.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => e.style.opacity = 0, ms); }
function banner(t, sub = '') { const e = $('banner'); e.innerHTML = t + (sub ? `<small>${sub}</small>` : ''); e.style.opacity = 1; clearTimeout(bannerTimer); bannerTimer = setTimeout(() => e.style.opacity = 0, 3500); }
function dlg(who, lines, done) { dlgState = { lines, i:0, done }; $('dialog').style.display = 'block'; $('dialog').querySelector('.who').textContent = who; $('dialog').querySelector('.txt').textContent = lines[0]; }
function advance() { if (!dlgState) return; dlgState.i++; if (dlgState.i >= dlgState.lines.length) { const d = dlgState.done; dlgState = null; $('dialog').style.display = 'none'; d?.(); } else $('dialog').querySelector('.txt').textContent = dlgState.lines[dlgState.i]; }
$('dialog').addEventListener('click', advance);
function chatLine(html) { const d = document.createElement('div'); d.className = 'ln'; d.innerHTML = html; $('chat').appendChild(d); while ($('chat').children.length > 7) $('chat').firstChild.remove(); }
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
function modal() { return !!dlgState || ['keypad','wheel','sudoku','soko','help','lobby','room','ending'].some(id => $(id).style.display !== 'none') || document.activeElement === $('chatIn'); }

// ===================== 謎題介面 =====================
function openPuzzle(L) {
  const U = LOCKUI[L]; if (!U) return; document.exitPointerLock?.();
  if (U.type === 'pad') openKeypad(L); else if (U.type === 'wheel') openWheel(L); else if (U.type === 'sudoku') openSudoku(); else if (U.type === 'soko') openSoko();
}
function closePuzzles() { for (const id of ['keypad', 'wheel', 'sudoku', 'soko']) $(id).style.display = 'none'; setTimeout(tryLock, 50); }
// ---- 數字鍵盤 ----
let kp = '', kpLock = null, kpLen = 4;
['1','2','3','4','5','6','7','8','9','清除','0','確認'].forEach(k => { const b = document.createElement('button'); b.textContent = k; b.onclick = () => kpPress(k); $('kpGrid').appendChild(b); });
function kpPress(k) {
  if (k === '清除') kp = ''; else if (k === '確認') { if (kp.length === kpLen) { act('code', [kpLock, kp]); closePuzzles(); } return; } else if (kp.length < kpLen) { kp += k; beep('tick'); }
  $('kpScreen').textContent = kp.padEnd(kpLen, '·');
}
function openKeypad(L) { kpLock = L; kpLen = LOCKUI[L].len; kp = ''; $('kpTitle').textContent = LOCKUI[L].t; $('kpScreen').textContent = '·'.repeat(kpLen); $('keypad').style.display = 'grid'; }
function closeKeypad() { closePuzzles(); }
$('kpClose').onclick = closePuzzles;
// ---- 字輪鎖 ----
let wh = [], whLock = null;
function openWheel(L) { whLock = L; const U = LOCKUI[L]; wh = Array(U.n).fill(0); $('whTitle').textContent = U.t; renderWheel(); $('wheel').style.display = 'grid'; }
function renderWheel() {
  const U = LOCKUI[whLock];
  $('whGrid').innerHTML = wh.map((v, i) => `<div class="wcol"><button data-i="${i}" data-d="-1">▲</button><div class="wch">${U.chars[v]}</div><button data-i="${i}" data-d="1">▼</button></div>`).join('');
  $('whGrid').querySelectorAll('button').forEach(b => b.onclick = () => { const i = +b.dataset.i; wh[i] = (wh[i] + +b.dataset.d + U.chars.length) % U.chars.length; beep('tick'); renderWheel(); });
}
$('whOk').onclick = () => { const U = LOCKUI[whLock]; act('code', [whLock, wh.map(i => U.chars[i]).join('')]); closePuzzles(); };
$('whClose').onclick = closePuzzles;
// ---- 數獨（4×4） ----
let sdk = [];
function openSudoku() { sdk = SUDOKU_P.map(r => r.slice()); renderSudoku(); $('sudoku').style.display = 'grid'; $('sdMsg').textContent = '每一列、每一行、每個 2×2 方格都要剛好有 1～4。點格子切換數字。'; }
function sdConflict(r, c) { const v = sdk[r][c]; if (!v) return false; for (let i = 0; i < 4; i++) { if (i !== c && sdk[r][i] === v) return true; if (i !== r && sdk[i][c] === v) return true; } const br = r - r % 2, bc = c - c % 2; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) if ((br + i !== r || bc + j !== c) && sdk[br + i][bc + j] === v) return true; return false; }
function renderSudoku() {
  $('sdGrid').innerHTML = sdk.map((row, r) => row.map((v, c) => `<button class="sd ${SUDOKU_P[r][c] ? 'given' : ''} ${sdConflict(r, c) ? 'bad' : ''} ${c === 1 ? 'br' : ''} ${r === 1 ? 'bb' : ''}" data-r="${r}" data-c="${c}">${v || ''}</button>`).join('')).join('');
  $('sdGrid').querySelectorAll('button').forEach(b => b.onclick = () => { const r = +b.dataset.r, c = +b.dataset.c; if (SUDOKU_P[r][c]) return; sdk[r][c] = (sdk[r][c] + 1) % 5; beep('tick'); renderSudoku(); checkSudoku(); });
}
function checkSudoku() { if (sdk.every((row, r) => row.every((v, c) => v === SUDOKU_S[r][c]))) { $('sdMsg').textContent = '喀──抽屜的鎖鬆開了！'; beep('ok'); setTimeout(() => { act('solve', 'sudoku'); closePuzzles(); }, 700); } }
$('sdClose').onclick = closePuzzles;
// ---- 推箱子 ----
let sk = null;
function openSoko() { skReset(); $('soko').style.display = 'grid'; }
function skReset() {
  sk = { walls:new Set(), goals:new Set(), boxes:new Set(), p:[0, 0], moves:0 };
  SOKO_LV.forEach((row, y) => [...row].forEach((ch, x) => { const k = x + ',' + y; if (ch === '#') sk.walls.add(k); if ('.*+'.includes(ch)) sk.goals.add(k); if ('$*'.includes(ch)) sk.boxes.add(k); if ('@+'.includes(ch)) sk.p = [x, y]; }));
  renderSoko();
}
function skMove(dx, dy) {
  if (!sk || sk.done) return;
  const [x, y] = sk.p, n = (x + dx) + ',' + (y + dy), n2 = (x + 2 * dx) + ',' + (y + 2 * dy);
  if (sk.walls.has(n)) return;
  if (sk.boxes.has(n)) { if (sk.walls.has(n2) || sk.boxes.has(n2)) return; sk.boxes.delete(n); sk.boxes.add(n2); beep('tick'); }
  sk.p = [x + dx, y + dy]; sk.moves++; renderSoko();
  if ([...sk.boxes].every(b => sk.goals.has(b))) { sk.done = true; $('skMsg').textContent = '三塊鐵塊都歸位了！'; beep('ok'); setTimeout(() => { act('solve', 'sokoban'); closePuzzles(); }, 700); }
}
function renderSoko() {
  let h = '';
  SOKO_LV.forEach((row, y) => { [...row].forEach((_, x) => { const k = x + ',' + y; const cls = sk.walls.has(k) ? 'w' : 'f'; let in_ = ''; if (sk.goals.has(k)) in_ = '<i class="goal"></i>'; if (sk.boxes.has(k)) in_ = `<i class="bx ${sk.goals.has(k) ? 'on' : ''}"></i>`; if (sk.p[0] === x && sk.p[1] === y) in_ = '<i class="pl"></i>'; h += `<div class="sc ${cls}">${in_}</div>`; }); });
  $('skGrid').innerHTML = h; $('skGrid').style.gridTemplateColumns = `repeat(${SOKO_LV[0].length}, 40px)`;
  $('skMsg').textContent = sk.done ? $('skMsg').textContent : `步數 ${sk.moves}　方向鍵／WASD 移動，R 重來`;
}
document.querySelectorAll('#soko [data-mv]').forEach(b => b.onclick = () => { const [dx, dy] = b.dataset.mv.split(',').map(Number); skMove(dx, dy); });
$('skReset').onclick = skReset; $('skClose').onclick = closePuzzles;
$('helpClose').onclick = () => { $('help').style.display = 'none'; tryLock(); };


// 輸入
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (document.activeElement === $('chatIn')) {
    if (k === 'enter') { const t = $('chatIn').value.trim(); if (t) { chatI++; pres({ cm:{ i:chatI, t } }); chatLine(`<b>你</b>：${esc(t)}`); myBubble(t); } $('chatIn').value = ''; $('chatIn').blur(); $('chatIn').style.display = 'none'; tryLock(); }
    else if (k === 'escape') { $('chatIn').blur(); $('chatIn').style.display = 'none'; }
    return;
  }
  if ($('keypad').style.display === 'grid') { if (/^[0-9]$/.test(k)) kpPress(k); else if (k === 'enter') kpPress('確認'); else if (k === 'backspace') kpPress('清除'); else if (k === 'escape') closePuzzles(); return; }
  if ($('soko').style.display === 'grid') { e.preventDefault(); const mv = { arrowup:[0,-1], w:[0,-1], arrowdown:[0,1], s:[0,1], arrowleft:[-1,0], a:[-1,0], arrowright:[1,0], d:[1,0] }[k]; if (mv) skMove(...mv); else if (k === 'r') skReset(); else if (k === 'escape') closePuzzles(); return; }
  if ($('wheel').style.display === 'grid' || $('sudoku').style.display === 'grid') { if (k === 'escape') closePuzzles(); return; }
  if (dlgState && (k === 'e' || k === ' ' || k === 'enter')) { e.preventDefault(); advance(); return; }
  if (k === 'tab') { e.preventDefault(); if (!inLobby) { const h = $('help'); h.style.display = h.style.display === 'none' ? 'grid' : 'none'; if (h.style.display === 'grid') document.exitPointerLock?.(); } return; }
  if (modal()) return;
  keys[k] = true;
  if (k === 'enter') { e.preventDefault(); document.exitPointerLock?.(); $('chatIn').style.display = 'block'; $('chatIn').focus(); }
  if (k === 'e' && !e.repeat) interact();
  if (k === 'q') dropLast();
  if (k === 'f') { me.fl = !me.fl; beep('tick'); }
  if (k === 'c') me.crouch = !me.crouch;
  if (k === 'v' && voice) { voice.muted = !voice.muted; toast(voice.muted ? '麥克風已靜音' : '麥克風已開啟'); }
  if (k === 'm') $('bigmap').style.display = 'grid';
  if (/^[1-9]$/.test(k)) inspect(+k - 1);
});
addEventListener('keyup', e => { const k = e.key.toLowerCase(); keys[k] = false; if (k === 'm') $('bigmap').style.display = 'none'; if (k === 'e') holdT = 0; });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; $('paused').style.display = (!locked && usedLock && !modal() && W?.st === 'play' && !isTouch && W.pl[myId]?.s !== 'd') ? 'grid' : 'none'; });
function tryLock() { if (isTouch) return; try { const p = canvas.requestPointerLock(); usedLock = true; p?.catch?.(() => { usedLock = false; }); } catch { usedLock = false; } }
$('paused').onclick = () => { $('paused').style.display = 'none'; tryLock(); };
addEventListener('mousemove', e => { if (locked) { me.yaw -= e.movementX * .0022; me.pitch = clamp(me.pitch - e.movementY * .0022, -1.4, 1.4); } });
canvas.addEventListener('pointerdown', e => { if (modal()) return; if (lookId !== null && e.pointerType === 'touch') return; lookId = e.pointerId; dragging = true; dragMoved = 0; lx = e.clientX; ly = e.clientY; });
addEventListener('pointermove', e => { if (!dragging || locked || e.pointerId !== lookId) return; const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; dragMoved += Math.abs(dx) + Math.abs(dy); const k = e.pointerType === 'touch' ? .0065 : .005; me.yaw -= dx * k; me.pitch = clamp(me.pitch - dy * k, -1.4, 1.4); });
addEventListener('pointercancel', e => { if (e.pointerId === lookId) { dragging = false; lookId = null; } });
addEventListener('pointerup', e => { if (!dragging || e.pointerId !== lookId) return; dragging = false; lookId = null; if (modal()) return; if (locked) interact(); else if (dragMoved < 6) { if (current) interact(); else tryLock(); } });
// ---- 手機：虛擬搖桿＋動作按鈕 ----
function setupTouch() {
  document.body.classList.add('touch');
  const jz = $('joyZone'), jb = $('joy'), knob = jb.firstChild, R = 56;
  const setKnob = () => { knob.style.transform = `translate(${joy.x * R}px, ${joy.y * R}px)`; };
  jz.addEventListener('pointerdown', e => {
    if (joy.id !== null) return; e.preventDefault(); joy.id = e.pointerId; jz.setPointerCapture?.(e.pointerId);
    const r = jz.getBoundingClientRect(); joy.cx = e.clientX; joy.cy = e.clientY; jb.style.left = (e.clientX - r.left) + 'px'; jb.style.top = (e.clientY - r.top) + 'px'; jb.classList.remove('idle'); joy.on = true; joy.x = joy.y = 0; setKnob();
  });
  jz.addEventListener('pointermove', e => {
    if (e.pointerId !== joy.id) return; let dx = (e.clientX - joy.cx) / R, dy = (e.clientY - joy.cy) / R; const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; } joy.x = dx; joy.y = dy; setKnob();
  });
  const end = e => { if (e.pointerId !== joy.id) return; joy.id = null; joy.on = false; joy.x = joy.y = 0; setKnob(); jb.classList.add('idle'); jb.style.left = '90px'; jb.style.top = 'calc(100% - 100px)'; };
  jz.addEventListener('pointerup', end); jz.addEventListener('pointercancel', end);
  const hold = (id, down, up) => { const b = $(id); b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); b.setPointerCapture?.(e.pointerId); down(b); }); const u = e => { e.preventDefault?.(); up?.(b); }; b.addEventListener('pointerup', u); b.addEventListener('pointercancel', u); b.addEventListener('contextmenu', e => e.preventDefault()); };
  hold('mAct', () => { AC().resume?.(); if (dlgState) return advance(); keys.e = true; interact(); }, () => { keys.e = false; holdT = 0; });
  hold('mRun', b => { touchRun = true; b.classList.add('on'); }, b => { touchRun = false; b.classList.remove('on'); });
  hold('mCrouch', b => { me.crouch = !me.crouch; b.classList.toggle('on', me.crouch); });
  hold('mFlash', b => { me.fl = !me.fl; beep('tick'); });
  hold('mDrop', () => dropLast());
  $('mChat').onclick = () => { $('chatIn').style.display = 'block'; $('chatIn').focus(); };
  $('mMap').addEventListener('pointerdown', () => $('bigmap').style.display = 'grid'); $('mMap').addEventListener('pointerup', () => $('bigmap').style.display = 'none'); $('mMap').addEventListener('pointercancel', () => $('bigmap').style.display = 'none');
  $('mHelp').onclick = () => $('help').style.display = 'grid';
  $('mFull').onclick = () => { try { (document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }) || Promise.resolve()).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => toast('這個環境不支援全螢幕')); } catch { toast('這個環境不支援全螢幕'); } };
  $('role').addEventListener('click', () => $('role').classList.toggle('open'));
  $('inv').addEventListener('click', e => { const sl = e.target.closest('.slot'); if (sl) inspect([...$('inv').children].indexOf(sl)); });
  $('chatIn').addEventListener('blur', () => setTimeout(() => { $('chatIn').style.display = 'none'; }, 100));
  $('rotateOk').onclick = () => { $('rotateHint').style.display = 'none'; rotateDismissed = true; };
}
let rotateDismissed = false;
function touchHUD() {
  const playing = W?.st === 'play' && !inLobby;
  for (const id of ['joyZone']) $(id).style.display = playing && !modal() ? 'block' : 'none';
  $('mBtns').style.display = playing ? 'block' : 'none'; $('mTop').style.display = playing ? 'flex' : 'none';
  $('mAct').classList.toggle('hot', !!current); $('mAct').textContent = dlgState ? '繼續' : current?.hold ? '按住' : '互動';
  $('mFlash').classList.toggle('on', me.fl); $('mCrouch').classList.toggle('on', me.crouch);
  $('rotateHint').style.display = playing && !rotateDismissed && innerHeight > innerWidth ? 'grid' : 'none';
}
if (isTouch) setupTouch();
addEventListener('touchstart', () => { if (!document.body.classList.contains('touch')) { setupTouch(); } }, { once: true, passive: true });

function myItems() { return W ? Object.entries(W.it).filter(([, v]) => v === myId).map(([k]) => k) : []; }
function dropLast() { const its = myItems(); if (!its.length) return; act('drop', its[its.length - 1]); toast(`丟下了「${ITEMS[its[its.length - 1]].n}」`); }
function inspect(i) {
  const id = myItems()[i]; if (!id) return;
  if (id === 'diary') { dlg('院長日記', DIARY); act('read'); } else dlg(ITEMS[id].n, [ITEMS[id].d]);
}
function interact() {
  if (!current || modal() || !W || W.st !== 'play') return;
  if (current.hold) { return; } // 由 holdT 處理
  current.go(W); beep('tick');
}

// 動態互動：地上的道具、解手銬、拍照
function dynamicInteractables() {
  const out = [];
  for (const [id, v] of Object.entries(W.it)) if (Array.isArray(v)) out.push({ id:'g-' + id, x:v[0], z:v[1], r:1.4, label: () => `撿起「${ITEMS[id].n}」`, go: () => act('pick', id) });
  if (W.it.cuffkey === myId) for (const p of net.peers()) { const P = W.pl[p.id]; if (!p.me && P?.s === 'c' && p.p.p) out.push({ id:'u-' + p.id, x:p.p.p[0], z:p.p.p[1], r:1.6, label: () => `替 ${P.n} 解開手銬`, go: () => act('uncuff', p.id) }); }
  if (me.role === 0) { const P = W.pl[myId]; for (const [k, bit, x, z] of [['wall', 1, 16.6, 14.3], ['cell', 2, 16.5, 5.2], ['safe', 4, 36.8, 3.1]]) if (P && !(P.k & bit)) out.push({ id:'s-' + k, x, z, r:1.3, label: () => '📷 拍照存證', go: () => act('snap', k) }); }
  return out;
}
function pickInteract() {
  let best = null, bs = 1e9; const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
  for (const it of [...interactables, ...dynamicInteractables()]) {
    const dx = it.x - me.x, dz = it.z - me.z, d = Math.hypot(dx, dz); if (d > (it.r || 1.6)) continue;
    const dot = d < .5 ? 1 : (dx * fx + dz * fz) / d; if (dot < .55) continue;
    const label = it.label(W); if (!label) continue;
    const s = d - dot; if (s < bs) { bs = s; best = { ...it, text: label, hold: typeof it.hold === 'function' ? it.hold(W) : it.hold }; }
  }
  return best;
}

// 碰撞
function solidForMe(tx, tz) {
  if (tz >= 32) return !(W.fl.gate);
  if (tx < 0) return true;
  const c = G[tz]?.[tx]; if (!c) return true;
  if (c === '#') return true;
  if (c === 'G') return !W.fl.gate;
  if (c === 'P') return !W.fl.sp;
  if (c === 'D') { const d = doorAt(tx, tz); return d && !W.dr[d.id]; }
  return FURN.has(key(tx, tz));
}
function blocked(x, z) {
  const r = .26, ct = [tileOf(me.x), tileOf(me.z)];
  for (const [ox, oz] of [[-r,-r],[r,-r],[-r,r],[r,r]]) { const tx = tileOf(x + ox), tz = tileOf(z + oz); if (tx === ct[0] && tz === ct[1]) continue; if (solidForMe(tx, tz)) return true; }
  if (W.pl[myId]?.s === 'c' && !inRect(x, z, [PRAYER[0], PRAYER[1], PRAYER[2], PRAYER[3]])) return true;
  return false;
}
function moveMe(dt) {
  if (modal() || W.pl[myId]?.s === 'd') { me.moving = false; return; }
  let f = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0), s = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0), mag = 1;
  if (joy.on && Math.hypot(joy.x, joy.y) > .15) { f = -joy.y; s = joy.x; mag = Math.min(1, (Math.hypot(f, s) - .15) / .7); }
  const want = Math.hypot(f, s) > .01;
  me.sprint = want && (keys.shift || touchRun) && !me.crouch && me.stamina > 0;
  me.stamina = clamp(me.stamina + (me.sprint ? -dt / 5 : dt / 7), 0, 1);
  if (me.sprint && Math.random() < dt * 3) { nzI++; pres({ nz:nzI }); }
  me.moving = want;
  if (!want) return;
  const sp = (me.crouch ? 1.1 : me.sprint ? 4.0 : 2.3) * dt * Math.max(.25, mag) / Math.hypot(f, s);
  const dx = (-Math.sin(me.yaw) * f + Math.cos(me.yaw) * s) * sp, dz = (-Math.cos(me.yaw) * f - Math.sin(me.yaw) * s) * sp;
  if (!blocked(me.x + dx, me.z)) me.x += dx;
  if (!blocked(me.x, me.z + dz)) me.z += dz;
  me.x = clamp(me.x, -1, 40); me.z = clamp(me.z, 0.3, 34);
}

// 遠端玩家
const FAC_COL = { v:'#7cc4ff', c:'#ff9f6b' };
function syncRemotes(dt) {
  const seen = new Set();
  for (const p of net.peers()) {
    if (p.me || !p.p.j || !p.p.p) continue;
    const P = W?.pl[p.id];
    if (W?.st === 'play' && P && (P.s === 'e')) continue;
    seen.add(p.id);
    let r = remotes.get(p.id);
    if (!r) {
      r = { av: makeAvatar(p.p.c ?? hash(p.id)), x:p.p.p[0], z:p.p.p[1], y:0, chat:0, tk:false };
      r.name = labelSprite(p.p.n || '玩家', '#fff'); r.name.position.y = 2.05; r.av.root.add(r.name);
      r.bub = bubbleSprite(); r.bub.position.y = 2.45; r.av.root.add(r.bub);
      r.cone = new THREE.Mesh(new THREE.ConeGeometry(.9, 5, 16, 1, true), new THREE.MeshBasicMaterial({ color:0xfff2c0, transparent:true, opacity:.06, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending }));
      r.cone.rotation.x = -Math.PI / 2; r.cone.position.set(0, 1.4, 2.6); r.av.root.add(r.cone);
      scene.add(r.av.root); remotes.set(p.id, r);
    }
    const [tx, tz, ty] = p.p.p; const k = Math.min(1, dt * 10);
    const moved = Math.hypot(tx - r.x, tz - r.z);
    r.x += (tx - r.x) * k; r.z += (tz - r.z) * k; r.y += angDiff(ty + Math.PI, r.y) * k;
    r.av.root.position.set(r.x, 0, r.z); r.av.root.rotation.y = r.y;
    r.av.root.scale.y = p.p.cr ? .72 : 1;
    const dragged = P?.s === 'd'; r.av.root.rotation.order = 'YXZ'; r.av.root.rotation.x = dragged ? -1.35 : 0; r.av.root.position.y = dragged ? .18 : 0; if (dragged) { r.y = gy; r.av.root.rotation.y = gy; }
    setAnim(r.av, p.p.m && P?.s !== 'd' ? 'walk' : 'idle', p.p.sp ? 1.6 : 1);
    r.av.mixer.update(dt);
    r.cone.visible = !!p.p.fl;
    const col = P ? FAC_COL[P.f] : '#ddd';
    const lab = (p.p.n || '玩家') + (P?.s === 'c' ? ' ⛓' : P?.s === 'j' ? ' 🔒' : '') + (p.p.tk ? ' 🔊' : '');
    if (lab !== r.lab || col !== r.col) { r.name.userData.draw(lab, col); r.lab = lab; r.col = col; }
    if (p.p.cm && p.p.cm.i !== r.chat) {
      r.chat = p.p.cm.i;
      const d = Math.hypot(r.x - me.x, r.z - me.z);
      if (d < 8 || (inRect(r.x, r.z, CONF) && inRect(me.x, me.z, CONF))) { r.bub.userData.set(p.p.cm.t); r.bubT = 6; chatLine(`<b style="color:${col}">${esc(p.p.n || '玩家')}</b>：${esc(p.p.cm.t)}`); }
    }
    if (r.bubT > 0) { r.bubT -= dt; if (r.bubT <= 0) r.bub.visible = false; }
  }
  for (const [id, r] of remotes) if (!seen.has(id)) { scene.remove(r.av.root); remotes.delete(id); }
}
function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
let myBub = null; function myBubble() {}
let myAv = null; const dragCam = { x:0, z:0 };
function myAvatar() { if (!myAv) { myAv = makeAvatar(me.char); myAv.root.rotation.order = 'YXZ'; scene.add(myAv.root); } return myAv; }

// 鬼（所有人顯示）
let gx = 32.5, gz = 4.5, gy = 0, clinkT = 0, heartT = 0, lastWh = -1;
const PHRASES = ['……你在哪裡呀？', '一起玩捉迷藏吧……', '我看到你了喔……', '不要怕……我只是想笑……'];
function updateGhostView(dt) {
  const g = W?.g; const on = W?.st === 'play' && g && g.mo !== 'n';
  ghostAv.root.visible = ghostMask.visible = !!on; ghostEye.intensity = on ? 6 : 0; for (const l of shackle) l.visible = !!on;
  setDrone(W?.st === 'play' && W.ph === 3 && !W.fl.rit);
  if (!on) { gx = 32.5; gz = 4.5; $('vign').style.opacity = '0'; return; }
  const k = Math.min(1, dt * 8);
  if (Math.hypot(g.x - gx, g.z - gz) > 3) { gx = g.x; gz = g.z; }
  gx += (g.x - gx) * k; gz += (g.z - gz) * k; gy += angDiff(g.y, gy) * k;
  ghostAv.root.position.set(gx, 0, gz); ghostAv.root.rotation.y = gy;
  setAnim(ghostAv, g.mv ? 'walk' : 'idle', g.mo === 'c' ? 1.7 : .8);
  ghostAv.mixer.update(dt);
  if (ghostHead) { ghostAv.root.updateMatrixWorld(true); const hp = ghostHead.getWorldPosition(new THREE.Vector3()); ghostMask.position.set(hp.x + Math.sin(gy) * .07, hp.y + .12, hp.z + Math.cos(gy) * .07); ghostMask.rotation.set(0, gy, 0); }
  if (ghostFeet[0] && ghostFeet[1]) { // 腳鐐：兩腳之間下垂的鐵鍊
    const a = ghostFeet[0].getWorldPosition(new THREE.Vector3()), b = ghostFeet[1].getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 12; i++) { const t = (i + .5) / 12, l = shackle[i]; l.position.lerpVectors(a, b, t); l.position.y = Math.max(.03, l.position.y - .05 - Math.sin(t * Math.PI) * .12); l.rotation.set(i % 2 ? Math.PI / 2 : 0, Math.atan2(b.x - a.x, b.z - a.z), 0); }
    shackle[12].position.set(a.x, a.y + .02, a.z); shackle[13].position.set(b.x, b.y + .02, b.z);
  }
  ghostEye.position.set(gx + Math.sin(gy) * .2, 1.7, gz + Math.cos(gy) * .2); ghostEye.target.position.set(gx + Math.sin(gy) * 6, .4, gz + Math.cos(gy) * 6);
  // 鐵鍊聲
  mbT -= dt;
  if (mbT <= 0 && g.mo !== 'c' && g.mo !== 'd') { mbT = .5 + Math.random() * .12; const n = MUSICBOX[mbI++ % MUSICBOX.length]; if (n) mbNote(gx, gz, n, g.mo === 'l' ? 1.4 : 1); }
  if (g.w && g.w !== lastWh) { const fresh = lastWh !== -1; lastWh = g.w; const dd = Math.hypot(gx - me.x, gz - me.z); if (fresh && dd < 13 && ['f', 'c'].includes(W.pl[myId]?.s)) whisper(PHRASES[g.wi] || PHRASES[1], { vol: clamp(1.2 - dd / 13, .2, 1) }); }
  clinkT -= dt;
  if (g.mv && clinkT <= 0) { clinkT = g.mo === 'c' ? .3 : .55; clink(gx, gz, 1); }
  const d = Math.hypot(gx - me.x, gz - me.z);
  heartT -= dt;
  if (d < 10 && heartT <= 0 && W.pl[myId]?.s === 'f') { heartT = .35 + d * .08; beep('heart'); }
  if (W.pl[myId]?.s !== 'd') $('vign').style.opacity = d < 9 && W.pl[myId]?.s === 'f' ? String(clamp(1 - d / 9, 0, .85)) : '0';
}

// 光線
let phaseShown = -1;
function applyPhase() {
  const ph = W?.st === 'play' ? W.ph : 0, P = PHASES[ph];
  scene.background = new THREE.Color(P.sky); scene.fog.color.set(P.fog); scene.fog.near = P.fogN; scene.fog.far = P.fogF;
  hemi.intensity = P.hemi; sun.intensity = P.sun; sun.color.set(P.sunC); moon.visible = ph === 3;
  for (const l of safeLights) l.intensity = ph >= 2 ? (ph === 3 ? 1.6 : .6) : 0;
  for (const b of bloodWrites) b.visible = ph === 3;
  if (ceilMat) ceilMat.emissiveIntensity = [.55, .65, .25, .02][ph];
}

// 每幀：門、蠟燭、遺物、正門
function updateWorldView(dt) {
  for (const d of DOORS) { const dm = doorMeshes[d.id]; const tgt = W.dr?.[d.id] ? 1.6 * dm.dir : 0; if (Math.abs(dm.cur - tgt) > .01 && Math.sign(tgt - dm.cur) !== 0 && dm.lastT !== tgt) { if (Math.hypot(d.x - me.x, d.z - me.z) < 14) { if (!tgt && W.ph === 3) slam(d.x + .5, d.z + .5); else beep('creak'); } dm.lastT = tgt; } dm.cur += (tgt - dm.cur) * Math.min(1, dt * 6); dm.pivot.rotation.y = dm.base + dm.cur; }
  const lit = W.fl?.cand ? 4 : (W.fl?.cd || 0);
  candleMeshes.forEach((c, i) => { c.visible = W.fl?.cand ? true : CANDLE_ORDER.slice(0, lit).includes(i); if (c.visible) c.scale.setScalar(.33 + Math.sin(performance.now() / 90 + i) * .03); });
  for (const r of RELICS) altarRelics[r].visible = W.it?.[r] === 'a';
  const go = W.fl?.gate ? 1 : 0; gateL.rotation.y += ((go ? 1.5 : 0) - gateL.rotation.y) * Math.min(1, dt * 2); gateR.rotation.y += ((go ? -1.5 : 0) - gateR.rotation.y) * Math.min(1, dt * 2);
  for (const l of gateParts.chain) l.visible = !W.fl?.chain; gateParts.lock.visible = !W.fl?.padlock; gateParts.seal.visible = !W.fl?.seal;
  const hasUV = W.it?.uv === myId; for (const m of uvMeshes) m.visible = hasUV;
  for (const d of DOORS) { const b = doorMeshes[d.id].boards; if (b) b.visible = !!W.lk?.[d.id]; }
  if (W.fl?.mb !== lastMb) { if (lastMb !== undefined && W.fl?.mb) MUSICBOX.slice(0, 14).forEach((n, i) => n && setTimeout(() => mbNote(16.5, 16.3, n, 1.2), i * 450)); lastMb = W.fl?.mb; }
  secretBlock.visible = !W.fl?.sp;
  // 地上的道具
  for (const [id, v] of Object.entries(W.it || {})) {
    let m = groundItems[id];
    if (Array.isArray(v)) { if (!m) { m = groundItems[id] = glowSprite('rgba(255,230,140,1)', .5); const l = labelSprite(ITEMS[id].ic + ' ' + ITEMS[id].n, '#ffe9a8'); l.scale.set(1.6, .4, 1); l.position.y = .45; m.add(l); scene.add(m); } m.visible = true; m.position.set(v[0], .25 + Math.sin(performance.now() / 300) * .04, v[1]); }
    else if (m) m.visible = false;
  }
}
const groundItems = {}; let lastMb;

// HUD
const ROUTE = { gate:'從正門逃脫', secret:'經由密道逃脫', ritual:'與孩子們一起離開', dawn:'撐到了天亮', caught:'被祂抓回禱告室', cuffed:'始終沒能掙脫手銬' };
function updateHUD() {
  const P = W.pl[myId];
  const ph = PHASES[W.ph];
  const t = Math.max(0, Math.ceil(W.pt)); $('phase').innerHTML = `${['☀️','🌤','🌇','🌑'][W.ph]} ${ph.n}<span class="t">${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</span>`;
  if (P) {
    const R = ROLES[P.r];
    const tk = R.tasks.map((t, i) => `${P.t & (1 << i) ? '✅' : '▫️'} ${t}${i === 0 && P.r === 0 ? `（${[1,2,4].filter(b => P.k & b).length}/3）` : ''}`).join('<br>');
    const gate = `🚪 大門：${W.fl.chain ? '✅' : '⛓'}鐵鍊 ${W.fl.padlock ? '✅' : '🔒'}大鎖 ${W.fl.seal ? '✅' : '☺'}封印`;
    $('role').innerHTML = `<span style="color:${FAC_COL[P.f]}">${P.f === 'v' ? '拜訪者' : '被囚者'}</span>・<b>${R.n}</b><br>${tk}<br><span style="color:var(--dim)">${gate}</span>`;
    const sc = $('statusChip'); const S = { c: P.cap ? '⛓ 你被祂抓回來、重新銬上了。等隊友帶手銬鑰匙來救你！' : P.pin ? '⛓ 你被銬在長椅上，髮夾已經斷了。等隊友帶手銬鑰匙來！' : '⛓ 你被銬在禱告室的長椅上。找找長椅縫隙，或等人帶手銬鑰匙來。', j:'🔒 你被關進了懲戒室。等隊友從外面拉開門閂！', d:'😱 祂抓住了你，正把你拖回禱告室……', e:'🌅 你已經逃出孤兒院了。可以繼續四處看看，等待其他人。' }[P.s];
    const chased = W.g?.t === myId && P.s === 'f';
    if (chased && !updateHUD.chased) { beep('sting'); toast('👁 祂看見你了！快跑，躲進點著蠟燭的金色角落！', 3000); }
    updateHUD.chased = chased;
    const S2 = chased ? '👁 祂正在追你！躲進安全區（金色格）祂就會離開。' : S;
    sc.style.display = S2 ? 'block' : 'none'; sc.textContent = S2 || ''; sc.className = 'chip' + (P.s === 'j' || P.s === 'c' || P.s === 'd' || chased ? ' bad' : '');
    if (P.mg?.i > myMsgI) { myMsgI = P.mg.i; toast(P.mg.t); beep(P.mg.t.includes('錯') || P.mg.t.includes('鎖') ? 'err' : 'pick'); }
  }
  if (W.msg?.i > globMsgI) { if (globMsgI) chatLine(`<span style="color:var(--accent)">✦ ${esc(W.msg.t)}</span>`); globMsgI = W.msg.i; }
  // 道具欄
  const its = myItems(); const sig = its.join(',');
  if (sig !== updateHUD.sig) { updateHUD.sig = sig; $('inv').innerHTML = its.map((id, i) => `<div class="slot"><span class="ic">${ITEMS[id].ic}</span>${ITEMS[id].n}<span class="k">[${i + 1}]</span></div>`).join(''); }
  // 語音提示
  if (voice?.track) { const vc = $('voiceChip'); vc.style.display = 'block'; const can = canTalk(); vc.textContent = voice.muted ? '🎙 已靜音（V）' : can ? (me.talking ? '🎙 說話中…' : '🎙 語音可用') : W.vm === 'room' ? '🎙 到告解室才能說話' : '🎙 麥克風待命'; }
}
function canTalk() { return W.vm === 'near' ? true : inRect(me.x, me.z, CONF); }
let ambT = 25, breathT = 0;
function atmosphere(dt) {
  const night = W.ph === 3 && !W.fl.rit, P = W.pl[myId], gOn = W.g && W.g.mo !== 'n';
  const gd = gOn ? Math.hypot(gx - me.x, gz - me.z) : 99;
  // 鬼靠近時手電筒接觸不良
  if (night && gd < 10 && Math.random() < (gd < 5 ? .35 : .12)) flash.intensity *= Math.random() * .25;
  // 燭火搖曳；鬼靠近時燭火幾乎熄滅
  for (const l of safeLights) l.intensity = (W.ph >= 2 ? (night ? 1.6 : .6) : 0) * (.8 + Math.random() * .35) * (night && gd < 6 ? .35 : 1);
  setChase(!!updateHUD.chased && night);
  if (PROP.swing) PROP.swing.rotation.x = night ? Math.sin(performance.now() / 900) * .35 : 0;
  // 躲在安全區、祂就在附近 → 聽得見自己的喘息
  if (night && P?.s === 'f' && isSafe(me.x, me.z) && gd < 7) { breathT -= dt; if (breathT <= 0) { breathT = 1.55; breath(); } $('vign').style.background = 'radial-gradient(ellipse at center,transparent 30%,rgba(0,0,0,.85))'; $('vign').style.opacity = '1'; }
  else $('vign').style.background = '';
  // 隨機恐怖事件（傍晚開始，每個人各自觸發）
  if (W.ph >= 2 && ['f', 'c'].includes(P?.s)) {
    ambT -= dt;
    if (ambT <= 0) {
      ambT = (night ? 18 : 30) + Math.random() * 25;
      const a = Math.random() * 6.28, d = 7 + Math.random() * 8, x = me.x + Math.sin(a) * d, z = me.z + Math.cos(a) * d, r = Math.random();
      if (r < .22) slam(x, z, .8);
      else if (r < .44) steps(x, z);
      else if (r < .6) { const n0 = Math.floor(Math.random() * 8); for (let i = 0; i < 4; i++) setTimeout(() => mbNote(x, z, MUSICBOX[(n0 + i) % MUSICBOX.length] || 69, .7), i * 520); }
      else if (r < .75) whisper('嘻嘻嘻……', { pitch: 2, rate: 1.5, vol: .35 });
      else if (!tryPhantom()) steps(x, z);
    }
  }
  if (phantom?.root.visible) { phantomT -= dt; phantom.root.children.at(-1).rotation.y = 0; if (Math.random() < .2) phantom.root.visible = phantomT > .25 || Math.random() < .5; if (phantomT <= 0) phantom.root.visible = false; }
}
function tryPhantom(dur = .9) { // 在視線前方的走廊盡頭一閃而過
  if (!phantom || updateHUD.chased) return false;
  if (W.g?.mo && W.g.mo !== 'n' && Math.hypot(gx - me.x, gz - me.z) < 14) return false;
  const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
  for (let d = 10; d >= 6; d -= 1) {
    const x = me.x + fx * d, z = me.z + fz * d, tx = tileOf(x), tz = tileOf(z), c = G[tz]?.[tx];
    if (!c || c === '#' || FURN.has(key(tx, tz)) || !los(me.x, me.z, x, z)) continue;
    phantom.root.position.set(x, 0, z); phantom.root.rotation.y = Math.atan2(me.x - x, me.z - z); phantom.root.visible = true; phantomT = dur;
    setTimeout(() => beep('sting'), 120); return true;
  }
  return false;
}
function updateVoice() {
  if (!voice) return;
  const peers = net.peers().filter(p => !p.me && p.p.j);
  voice.sync(peers.map(p => p.id));
  for (const p of peers) {
    if (!p.p.p) { voice.setGain(p.id, 0); continue; }
    const d = Math.hypot(p.p.p[0] - me.x, p.p.p[1] - me.z);
    let g = 0;
    if (W.vm === 'room') g = inRect(me.x, me.z, CONF) && inRect(p.p.p[0], p.p.p[1], CONF) ? clamp(1.2 - d / 5, 0, 1) : 0;
    else g = clamp(1 - d / 8, 0, 1);
    voice.setGain(p.id, g);
  }
  me.talking = voice.tick(canTalk());
}

// 小地圖
function drawMap(cv, s, big) {
  const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
  for (let z = 0; z < H_; z++) for (let x = 0; x < W_; x++) {
    const c = G[z][x]; let col = c === '#' ? '#1a1714' : c === ',' ? '#26301c' : '#4b4338';
    if (c === 'D') { const d = doorAt(x, z); col = W?.dr?.[d.id] ? '#8a6a3a' : '#c0392b'; }
    if (c === 'G') col = W?.fl?.gate ? '#3fae5a' : '#7a2020'; if (c === 'P') col = W?.fl?.sp ? '#3fae5a' : '#1a1714';
    if (SAFE.has(key(x, z))) col = '#e9c46a'; if (FURN.has(key(x, z))) col = '#3a332b';
    g.fillStyle = col; g.fillRect(x * s, z * s, s, s);
  }
  if (big) { g.font = '700 16px "Noto Sans TC"'; g.fillStyle = '#fff'; g.textAlign = 'center'; for (const R of ROOMS) g.fillText(R.name, (R.r[0] + R.r[2] + 1) / 2 * s, (R.r[1] + R.r[3] + 1) / 2 * s); }
  if (W?.st === 'play') for (const p of net.peers()) { if (p.me || !p.p.p) continue; const P = W.pl[p.id]; if (!P || P.s === 'e') continue; g.fillStyle = FAC_COL[P.f]; g.beginPath(); g.arc(p.p.p[0] * s, p.p.p[1] * s, s * .45, 0, 7); g.fill(); }
  g.save(); g.translate(me.x * s, me.z * s); g.rotate(-me.yaw); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -s * .9); g.lineTo(s * .55, s * .55); g.lineTo(-s * .55, s * .55); g.fill(); g.restore();
}

// ===================== 主流程 =====================
function spawnMe() {
  const P = W.pl[myId]; if (!P) return;
  me.role = P.r; me.fac = P.f;
  const sp = (P.f === 'c' ? SPAWN_C : SPAWN_V)[P.sp % 8];
  me.x = sp[0]; me.z = sp[1]; me.yaw = P.f === 'c' ? Math.PI / 2 : 0; me.pitch = 0;
  me.spawned = true; me.st = P.s; myMsgI = P.mg?.i || 0;
  banner('早上', P.f === 'c' ? `你是被囚者「${ROLES[P.r].n}」。雙手被銬著……` : `你是拜訪者「${ROLES[P.r].n}」。孤兒院就在眼前。`);
  dlg(ROLES[P.r].n, P.f === 'c'
    ? ['頭好痛。你醒來時，雙手被銬在禱告室的長椅上。', '旁邊好像還有別人。', `個人任務：${ROLES[P.r].tasks.join('；')}`, '先想辦法掙脫手銬吧──長椅縫隙裡也許有什麼，或者等外面的人帶鑰匙來。']
    : ['你推開鏽蝕的鐵門走進庭院。身後的門「碰」地關上，被鐵鍊纏住了。', '建築深處傳來微弱的呼救聲。', `個人任務：${ROLES[P.r].tasks.join('；')}`, '大門有三道鎖：鐵鍊、大鎖、和只能在深夜撕下的封印。白天很短──盡量把線索找齊。'], () => tryLock());
}
let netInfo = { ok: true, why: '' };
function netReason(w) {
  if (w === 'noroom') return MODE === 'room' ? '這個畫面沒辦法使用 Claude 的即時房間。最常見的原因：用「公開連結」開啟、沒有登入 claude.ai，或你不是被分享到這個 artifact 的成員。' : '找不到連線功能。';
  if (w.startsWith('join:')) return `加入房間被拒絕（${esc(w.slice(5))}）。可能是這個帳號沒有使用多人房間的權限。`;
  if (w === 'nopeerjs') return '連線元件載入失敗（PeerJS）。請檢查網路後重新整理。';
  if (w.startsWith('peer:')) return `連不上配對服務（${esc(w.slice(5))}）。可能是網路擋住了，換個網路或稍後再試。`;
  if (w === 'nohub') return '找不到房間的中繼玩家，也無法自己擔任中繼。請重新整理再試一次。';
  if (w === 'noid') return '連上了，但一直沒有收到房間的回應。網路可能不穩，請重新整理再試。';
  if (w.includes('ws') || w.includes('timeout')) return '連不到遊戲伺服器。自架版需要先執行伺服器（npm start），並用伺服器的網址開啟，不能直接開 html 檔或只放在 GitHub Pages。';
  return esc(w);
}
function netStatusHTML() {
  if (netInfo.solo) return '<div class="netbar">🎮 單人模式</div>';
  if (!netInfo.ok) return `<div class="netbar bad">⚠ <b>沒有連上多人房間，現在是單人模式</b>（其他人看不到你）<br>${netReason(netInfo.why)}<br><button class="btn ghost" onclick="location.reload()" style="margin-top:8px;padding:6px 14px">重新整理再試一次</button></div>`;
  const n = net.peers().filter(p => p.p.j || p.me).length, err = net.err ? `　<span style="color:#ffb3ab">（同步錯誤：${esc(net.err)}）</span>` : '', off = net.conn === false && MODE !== 'ws' ? '　<span style="color:#ffb3ab">（連線中斷，重新連線中…）</span>' : '';
  return `<div class="netbar ok">✅ 已連上${MODE === 'room' ? ' Claude 即時房間' : MODE === 'p2p' ? (net.hub ? '（你的瀏覽器正在擔任房間中繼）' : '房間中繼') : '遊戲伺服器'}・房號 <b>${esc(netInfo.code)}</b>・目前房內 <b>${n}</b> 人${err}${off}<br><span class="note">朋友要輸入<b>完全相同的房號</b>；如果他那邊顯示「沒有連上」，請看他畫面上的原因。</span></div>`;
}
function showLobbyRoom() {
  $('room').style.display = 'grid'; $('ending').style.display = 'none'; inLobby = true;
  $('netStatus').innerHTML = netStatusHTML();
  const host = amHost();
  $('hostNote').textContent = host ? '你是房主：等大家到齊後按「開始遊戲」。房主離開時，會由下一位玩家接手。' : '等待房主開始遊戲……';
  $('hostSet').style.display = host ? 'grid' : 'none'; $('startBtn').style.display = host ? 'inline-block' : 'none';
  const ps = net.peers().filter(p => p.p.j);
  $('plist').innerHTML = ps.map(p => { const f = p.p.fa || 'v'; return `<div class="pl">${esc(p.p.n || '玩家')}${p.me ? '（你）' : ''}<span class="tag ${f === 'v' ? 'tv' : f === 'c' ? 'tc' : 'tr'}">${{ v:'拜訪者', c:'被囚者', r:'隨機' }[f]}</span>${p.id === hostId() ? ' 👑' : ''}</div>`; }).join('');
  if (!(net instanceof WsNet || net instanceof PeerNet)) { $('vmSel').parentElement.style.display = 'none'; }
}
$('startBtn').onclick = () => { if (!amHost()) return; W.du = +$('durSel').value; W.vm = $('vmSel').value; startGame(); };
$('againBtn').onclick = () => { if (amHost()) { W = newWorld(W); hostState = null; } };

function showEnding() {
  inLobby = true; document.exitPointerLock?.();
  $('ending').style.display = 'grid';
  const res = W.res || {}; const any = Object.values(W.pl).some(P => P.s === 'e');
  $('endTitle').textContent = res.rit ? '真結局・微笑安息' : res.why === 'wipe' ? (any ? '其他人都被抓了' : '全員被抓') : any ? '逃出生天' : '微笑永遠都在';
  $('endText').innerHTML = res.why === 'wipe' && !any ? '<p>最後一個人也被拖回了禱告室。</p><p>長椅上坐滿了人，每個人的手腕都銬著。祂站在門口，笑得很開心：「明天也一起玩吧。」</p>' : res.rit ? '<p>孩子們的遺物回到了祭壇。戴著微笑面具的「祂」停下腳步，面具落在地上──底下那張臉，正在哭。</p><p>天亮時，你們一起走出了斯邁爾孤兒院。</p>'
    : any ? '<p>有人逃出去了。但回頭看時，二樓的窗邊，有一張笑臉正看著你們離開。</p>' : '<p>天亮了。懲戒室的門閂一直沒有被拉開。</p><p>「歡迎回家。」祂笑著說。</p>';
  const rows = Object.entries(W.pl).map(([id, P]) => `<tr><td>${esc(P.n)}${id === myId ? '（你）' : ''}</td><td style="color:${FAC_COL[P.f]}">${P.f === 'v' ? '拜訪者' : '被囚者'}・${ROLES[P.r].n}</td><td>${ROUTE[P.e] || '—'}</td><td>個人任務 ${(P.t & 1 ? 1 : 0) + (P.t & 2 ? 1 : 0)}／2</td></tr>`).join('');
  $('endTable').innerHTML = `<tr><th>玩家</th><th>身分</th><th>結果</th><th>個人任務</th></tr>${rows}`;
  $('againBtn').style.display = amHost() ? 'inline-block' : 'none'; $('againNote').textContent = amHost() ? '' : '等待房主回到等待室……';
}

let lastPhase = -1, lastSt = '', lastPub = 0, lobbyT = 0;
const clock = new THREE.Clock();
let sizeChk = 0;
function loop() {
  requestAnimationFrame(loop);
  if (performance.now() - sizeChk > 1000) { sizeChk = performance.now(); const c = renderer.domElement; if (Math.abs(c.clientWidth - innerWidth) > 1 || Math.abs(c.clientHeight - innerHeight) > 1) fitView(); }
  const rawDt = Math.min(clock.getDelta(), .5), dt = Math.min(rawDt, .1);
  if (!net) { renderer.render(scene, camera); return; }
  // 世界狀態來源
  const hid = hostId();
  if (hid && hid === myId) {
    if (!hostMode) { hostMode = true; W = lastW ? structuredClone(lastW) : newWorld(); hostState = null; }
    hostTick(rawDt);
    if (performance.now() - lastPub > 100) { lastPub = performance.now(); pres({ w: W }); }
  } else {
    if (hostMode) { hostMode = false; pres({ w: null }); }
    const hp = net.peers().find(p => p.id === hid);
    if (hp?.p.w) { W = hp.p.w; lastW = W; hostState = null; }
  }
  if (W) lastW = W;
  if (!W) { if (performance.now() - lobbyT > 500) { lobbyT = performance.now(); showLobbyRoom(); } renderer.render(scene, camera); return; }
  // 狀態轉換
  const gk = W.st + ':' + W.g0;
  if (gk !== gameKey) {
    gameKey = gk;
    if (W.st === 'lobby') { me.spawned = false; showLobbyRoom(); }
    if (W.st === 'play') { $('room').style.display = 'none'; $('ending').style.display = 'none'; inLobby = false; me.spawned = false; globMsgI = W.msg?.i || 0; lastPhase = -1; updateHUD.sig = null; }
    if (W.st === 'end') showEnding();
  }
  if (W.st === 'lobby' && performance.now() - lobbyT > 500) { lobbyT = performance.now(); showLobbyRoom(); }
  if (W.st === 'play') {
    if (!me.spawned && W.pl[myId]) spawnMe();
    const P = W.pl[myId];
    if (P && P.s !== me.st) {
      if (P.s === 'j') { me.x = CELL_IN[0]; me.z = CELL_IN[1]; banner('被抓住了', '你被丟進了懲戒室。'); beep('err'); }
      if (P.s === 'd') { me.capT = 0; me.crouch = false; document.exitPointerLock?.(); scream(); flashScreen(); setTimeout(() => whisper('找到你了。', { pitch: .05, rate: .55, vol: 1 }), 500); setTimeout(() => banner('被抓住了', '祂抓著你的腳踝，把你拖向禱告室……'), 1700); }
      if (P.s === 'c' && me.st === 'd') { const dp = P.dp || SPAWN_C[0]; me.x = dp[0]; me.z = dp[1]; me.yaw = Math.PI / 2; me.pitch = 0; banner('又被銬上了', '等隊友帶「手銬鑰匙」來救你'); beep('err'); setTimeout(tryLock, 300); }
      if (P.s === 'e') banner('逃出去了', ROUTE[P.e] || '');
      me.st = P.s;
    }
    if (W.ph !== lastPhase) { lastPhase = W.ph; if (W.ph > 0) { banner(PHASES[W.ph].n, ['', '時間不多了', '天就要黑了', '祂醒了。聽見鐵鍊聲就快躲起來。'][W.ph]); beep(W.ph === 3 ? 'toll' : 'bell'); if (W.ph === 3) setTimeout(() => whisper('……天黑了，該玩捉迷藏了。', { vol: .6 }), 7000); } applyPhase(); if (W.ph === 3 && !me.fl) { me.fl = true; toast('深夜了，你打開了手電筒（F 可關閉，但開著更容易被發現）', 4500); } }
    moveMe(dt);
    // 互動
    current = modal() ? null : pickInteract();
    $('crosshair').classList.toggle('hot', !!current);
    $('prompt').style.display = current ? 'block' : 'none';
    if (current) $('prompt').textContent = (document.body.classList.contains('touch') ? '👆 ' : '[E] ') + current.text;
    if (current?.hold && (keys.e || keys._act)) { holdT += dt; if (current.noisy && Math.random() < dt * 2.5) { nzI++; pres({ nz:nzI }); } $('hold').style.display = 'block'; $('hold').firstChild.style.width = Math.min(100, holdT / current.hold * 100) + '%'; if (holdT >= current.hold) { holdT = 0; current.go(W); } } else { $('hold').style.display = 'none'; if (!keys.e) holdT = 0; }
    updateHUD(); updateVoice(); updateWorldView(dt);
  } else if (lastPhase !== -2) { lastPhase = -2; applyPhase(); }
  if (W.st === 'end' && $('ending').style.display === 'none') showEnding();
  // 自己的 presence
  pres({ p:[r2(me.x), r2(me.z), r2(me.yaw)], m: me.moving ? 1 : 0, sp: me.sprint ? 1 : 0, cr: me.crouch ? 1 : 0, fl: me.fl ? 1 : 0, tk: me.talking ? 1 : 0 });
  syncRemotes(dt); updateGhostView(dt);
  flash.intensity = me.fl && W.st === 'play' ? 28 : 0;
  if (W.st === 'play') atmosphere(rawDt);
  let eye = me.crouch ? 1.0 : 1.6, bob = me.moving ? Math.sin(performance.now() / (me.sprint ? 80 : 130)) * .03 : 0, roll = 0;
  if (W?.st === 'play' && W.pl[myId]?.s === 'd') { // 被抓演出：先被盯著看，再被拖走
    me.capT = (me.capT || 0) + dt;
    if (me.capT < 1.9) { // 近距離：祂低頭看著你
      me.x = gx + Math.sin(gy) * .95; me.z = gz + Math.cos(gy) * .95; me.yaw = gy; eye = 1.55;
      me.pitch = Math.atan2((ghostMask.position.y || 2.1) - eye, .95); bob = (Math.random() - .5) * .03 * (1.9 - me.capT); $('vign').style.opacity = String(.35 + Math.random() * .3);
      camera.position.set(me.x, eye + bob, me.z); camera.rotation.set(me.pitch, me.yaw, 0);
    } else { // 第三人稱：看著自己被拖走
      const bx = -Math.sin(gy), bz = -Math.cos(gy);
      me.x = gx + bx * .75; me.z = gz + bz * .75;
      dragCam.x += ((gx + bx * 3.3) - dragCam.x) * Math.min(1, dt * 3); dragCam.z += ((gz + bz * 3.3) - dragCam.z) * Math.min(1, dt * 3);
      camera.position.set(dragCam.x, 2.55, dragCam.z); camera.lookAt(gx + bx * .9, .55, gz + bz * .9); $('vign').style.opacity = '.55';
      const av = myAvatar(); av.root.visible = true; av.root.position.set(me.x, .18, me.z); av.root.rotation.set(-1.35, gy, 0); av.mixer.update(dt);
    }
  } else {
    if (myAv) myAv.root.visible = false;
    dragCam.x = me.x; dragCam.z = me.z;
    camera.position.set(me.x, eye + bob, me.z); camera.rotation.set(me.pitch, me.yaw, roll);
  }
  if (actx) { const L = actx.listener, f = new THREE.Vector3(-Math.sin(me.yaw), 0, -Math.cos(me.yaw)); if (L.positionX) { L.positionX.value = me.x; L.positionY.value = eye; L.positionZ.value = me.z; L.forwardX.value = f.x; L.forwardY.value = 0; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; } else { L.setPosition(me.x, eye, me.z); L.setOrientation(f.x, 0, f.z, 0, 1, 0); } }
  if (document.body.classList.contains('touch')) touchHUD();
  if (NORENDER) return;
  drawMap($('mini'), 5, false); if ($('bigmap').style.display === 'grid') drawMap($('bigc'), 20, true);
  renderer.render(scene, camera);
}

// ===================== 啟動 =====================
const nameIn = $('nameIn'), roomIn = $('roomIn');
try { nameIn.value = localStorage.getItem('hs-name') || ''; } catch {}
roomIn.value = (location.hash.slice(1) || Math.random().toString(36).slice(2, 6)).toUpperCase();
if (MODE === 'room') $('micRow').style.display = 'none';
$('netNote').textContent = MODE === 'room' ? '連線：Claude 即時房間（文字聊天）' : MODE === 'p2p' ? '連線：玩家直連（免伺服器，支援語音）' : '連線：自架伺服器（支援語音）';

async function join(solo) {
  const name = (nameIn.value.trim() || '玩家' + Math.floor(Math.random() * 90 + 10)).slice(0, 10);
  try { localStorage.setItem('hs-name', name); } catch {}
  const fa = document.querySelector('input[name=fac]:checked').value;
  const code = roomIn.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'MAIN';
  roomIn.value = code;
  $('joinBtn').disabled = $('soloBtn').disabled = true; $('netNote').textContent = '連線中…';
  AC().resume?.();
  netInfo = { code, solo, ok: true, why: '' };
  try {
    if (solo) net = new LocalNet();
    else if (MODE === 'room') net = new RoomNet();
    else if (MODE === 'p2p') net = new PeerNet();
    else net = new WsNet();
    await net.start(code);
  } catch (e) {
    console.warn(e); netInfo.ok = false; netInfo.why = e?.why || e?.message || String(e);
    net = new LocalNet(); await net.start();
  }
  myId = net.id;
  me.name = name; me.char = hash(myId + name) % CHARS.length;
  pres({ j:1, n:name, fa, c:me.char });
  try { if (location.hash.slice(1) !== code && !solo) history.replaceState(null, '', '#' + code); } catch {}
  if ((net instanceof WsNet || net instanceof PeerNet) && $('micIn').checked) {
    let ice = net instanceof PeerNet ? PEER_ICE : [{ urls:'stun:stun.l.google.com:19302' }];
    if (net instanceof WsNet) try { const base = window.HS_WS_URL ? window.HS_WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '/') : ''; const c = await (await fetch(base + 'config.json')).json(); if (c.iceServers) ice = c.iceServers; } catch {}
    voice = new Voice(net, ice); if (!(await voice.init())) toast('沒有取得麥克風權限，仍可聽見別人、用文字聊天');
  }
  $('lobby').style.display = 'none'; $('roomCode').textContent = solo ? '（單人）' : netInfo.ok ? code : code + '（未連線）';
  joinedAt = performance.now() - (solo ? 1500 : 0);
  showLobbyRoom();
}
$('joinBtn').onclick = () => join(false);
$('soloBtn').onclick = () => join(true);

applyPhase();
camera.position.set(19.5, 1.6, 28.5);
loop();
loadModels((n, t) => { $('joinBtn').textContent = `載入素材 ${n}/${t}`; }).then(() => {
  buildWorld(); buildGhost();
  $('joinBtn').textContent = '加入房間'; $('joinBtn').disabled = false; $('soloBtn').disabled = false;
}).catch(e => { console.error(e); $('joinBtn').textContent = '素材載入失敗'; });
window.__hs = { interactables, openPuzzle: L => openPuzzle(L), skMove: (x, y) => skMove(x, y), sdSet: (r, c, v) => { sdk[r][c] = v; renderSudoku(); checkSudoku(); }, tryPhantom: d => tryPhantom(d), dbg() { const c = []; ghostAv.root.traverse(o => { if (o.isMesh) c.push([o.name, o.material.type, o.material.color?.getHexString(), !!o.material.map, o.material.vertexColors]); }); return { c, mask: ghostMask && [ghostMask.visible, ghostMask.position.toArray().map(v => +v.toFixed(2))], head: !!ghostHead, root: ghostAv.root.position.toArray() }; }, get W() { return W; }, get hs() { return hostState; }, get voice() { return voice; }, setW(f) { f(W); }, me, act, get net() { return net; }, get current() { return current; }, kpPress, advance, findPath, G, FURN };
