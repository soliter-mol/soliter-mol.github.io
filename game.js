// ============================================================
// FOIL SOLITAIRE — Klondike Solitaire dengan scoring & FX ala Balatro
// ============================================================

const SUITS = ['spades','hearts','clubs','diamonds'];
const SUIT_SYMBOL = { spades:'♠', hearts:'♥', clubs:'♣', diamonds:'♦' };
const SUIT_COLOR  = { spades:'black', hearts:'red', clubs:'black', diamonds:'red' };

// SVG suit custom (gaya "engraved", lebih tajam & premium dibanding emoji sistem)
const SUIT_SVG = {
  spades: `<svg viewBox="0 0 100 100" class="suit-svg"><path d="M50 6 C 50 6 16 38 16 62 C 16 80 32 90 46 84 C 44 92 38 96 30 98 L 70 98 C 62 96 56 92 54 84 C 68 90 84 80 84 62 C 84 38 50 6 50 6 Z"/></svg>`,
  hearts: `<svg viewBox="0 0 100 100" class="suit-svg"><path d="M50 92 C 50 92 10 64 10 36 C 10 16 28 6 42 14 C 47 17 50 23 50 23 C 50 23 53 17 58 14 C 72 6 90 16 90 36 C 90 64 50 92 50 92 Z"/></svg>`,
  clubs: `<svg viewBox="0 0 100 100" class="suit-svg"><path d="M50 12 C 38 12 28 22 28 34 C 28 39 30 44 32 47 C 22 46 14 54 14 65 C 14 76 23 84 34 84 C 40 84 46 81 49 76 C 47 84 43 92 36 98 L 64 98 C 57 92 53 84 51 76 C 54 81 60 84 66 84 C 77 84 86 76 86 65 C 86 54 78 46 68 47 C 70 44 72 39 72 34 C 72 22 62 12 50 12 Z"/></svg>`,
  diamonds: `<svg viewBox="0 0 100 100" class="suit-svg"><path d="M50 4 L 88 50 L 50 96 L 12 50 Z"/></svg>`
};
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const RANK_VALUE = {}; RANKS.forEach((r,i)=> RANK_VALUE[r]=i+1);

// base chip value per rank (Balatro-ish: face cards worth more)
function rankChipValue(rank){
  if(rank==='A') return 15;
  if(['J','Q','K'].includes(rank)) return 12;
  if(rank==='10') return 10;
  return RANK_VALUE[rank]; // 2..9
}

// ---------------- LEVEL CONFIG ----------------
// undoLimit / redealLimit: Infinity = tanpa batas. recommend: highlight kartu valid (mode mudah).
const LEVELS = {
  easy:   { label:'MUDAH',  undoLimit: Infinity, redealLimit: Infinity, recommend: true,  hintAlwaysOn: true  },
  medium: { label:'SEDANG', undoLimit: 5,        redealLimit: 2,        recommend: false, hintAlwaysOn: false },
  hard:   { label:'SULIT',  undoLimit: 1,        redealLimit: 1,        recommend: false, hintAlwaysOn: false, noHint: true },
};
let currentLevel = 'medium';
let undosUsed = 0;
let redealsUsed = 0;
let gameStarted = false;

let state = null;
let history = [];
let dragCtx = null;
let jokers = [];
let audioCtx = null;
let masterGain = null;
let musicGain = null;
let sfxGain = null;
let musicEnabled = true;
let musicStarted = false;
let musicTimers = [];

// ---------------- AUDIO ENGINE ----------------
// Synth murni (oscillator), tidak butuh file audio eksternal.
// Struktur: audioCtx -> masterGain -> {musicGain, sfxGain} -> destination
function ensureAudio(){
  if(!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(audioCtx.destination);

    musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.16;
    musicGain.connect(masterGain);

    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 1;
    sfxGain.connect(masterGain);
  }
  if(audioCtx.state === 'suspended') audioCtx.resume();
}

// Nada tunggal sederhana (dipakai untuk sfx & musik), output ke sfxGain atau musicGain
function tone(freq, dur, type, vol, destGain, slideTo, delay){
  try{
    ensureAudio();
    const startAt = audioCtx.currentTime + (delay||0);
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, startAt);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, startAt + dur);
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.exponentialRampToValueAtTime(Math.max(vol,0.0001), startAt + Math.min(0.02,dur*0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
    o.connect(g); g.connect(destGain);
    o.start(startAt); o.stop(startAt + dur + 0.02);
  }catch(e){}
}

// beep lama dipertahankan agar kompatibel, tapi sekarang lewat sfxGain
function beep(freq=440, dur=0.08, type='sine', vol=0.18, slideTo=null){
  if(!sfxGain){ ensureAudio(); }
  tone(freq, dur, type, vol, sfxGain, slideTo, 0);
}
// Chord: beberapa nada dibunyikan bersamaan untuk kesan "kaya" / harmonis
function chord(freqs, dur, type, vol, delay){
  if(!sfxGain){ ensureAudio(); }
  freqs.forEach(f=> tone(f, dur, type, vol, sfxGain, null, delay||0));
}

// ---------------- SFX (tiap aksi sekarang berupa mini-chord, bukan beep tunggal) ----------------
function sfxFlip(){ chord([392, 523], 0.09, 'triangle', 0.09); }
function sfxPlace(){ chord([220, 330], 0.09, 'square', 0.07); }
function sfxFoundation(combo){
  // arpeggio naik pendek + nada utama, makin combo makin terang nadanya
  const base = 440 + combo*18;
  chord([base, base*1.25, base*1.5], 0.16, 'sine', 0.13);
  tone(base*2, 0.12, 'triangle', 0.06, sfxGain, null, 0.05);
}
function sfxCombo(){
  // power-chord pendek yang naik, terasa "menguatkan"
  [0, 0.07, 0.14].forEach((d,i)=> tone(523*Math.pow(1.06,i*3), 0.18, 'sawtooth', 0.1, sfxGain, 880, d));
}
function sfxWin(){
  const melody = [523,659,784,1046,1318];
  melody.forEach((f,i)=> tone(f, 0.35, 'triangle', 0.16, sfxGain, null, i*0.13));
  setTimeout(()=> chord([523,659,784,1046], 0.9, 'sine', 0.08), melody.length*130);
}
function sfxInvalid(){ chord([164,138], 0.14, 'sawtooth', 0.1); }
function sfxStock(){ chord([500,375], 0.05, 'triangle', 0.07); }
function sfxPress(){ tone(180,0.03,'triangle',0.05, sfxGain); }
function sfxSelect(){ chord([380,475], 0.07, 'sine', 0.08); }
function sfxShuffle(){
  // suara "whoosh" pendek untuk new game / recycle besar
  for(let i=0;i<6;i++){ tone(180+Math.random()*300, 0.05, 'triangle', 0.05, sfxGain, null, i*0.03); }
}

// ---------------- BACKGROUND MUSIC (ambient loop generatif) ----------------
// Progresi chord lembut yang looping pelan sebagai pad, ditambah arpeggio tipis sesekali.
// Semua disintesis live, tidak butuh file mp3/ogg eksternal.
const MUSIC_CHORDS = [
  [220.00, 261.63, 329.63],   // Am
  [174.61, 220.00, 261.63],   // F
  [196.00, 246.94, 293.66],   // G (sus-ish)
  [220.00, 277.18, 329.63],   // Am variant
];
let musicChordIndex = 0;

function playMusicChordPad(freqs){
  if(!musicEnabled || !musicGain) return;
  const dur = 6.5;
  freqs.forEach((f, i)=>{
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = i===0 ? 'sine' : 'triangle';
    o.frequency.value = f/2; // satu oktaf lebih rendah, kesan pad lembut
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.5, audioCtx.currentTime + 1.8);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(musicGain);
    o.start();
    o.stop(audioCtx.currentTime + dur + 0.1);
  });
}

function playMusicArpeggio(freqs){
  if(!musicEnabled || !musicGain) return;
  const pattern = [0,1,2,1];
  pattern.forEach((idx, i)=>{
    const f = freqs[idx % freqs.length] * 2; // satu oktaf lebih tinggi dari pad
    tone(f, 0.9, 'sine', 0.05, musicGain, null, i*0.55);
  });
}

function musicTick(){
  if(!musicEnabled) return;
  const chordFreqs = MUSIC_CHORDS[musicChordIndex % MUSIC_CHORDS.length];
  playMusicChordPad(chordFreqs);
  if(musicChordIndex % 2 === 1) playMusicArpeggio(chordFreqs);
  musicChordIndex++;
  const t = setTimeout(musicTick, 6500);
  musicTimers.push(t);
}

function startMusic(){
  if(musicStarted) return;
  musicStarted = true;
  ensureAudio();
  musicTick();
}

function stopMusic(){
  musicTimers.forEach(t=> clearTimeout(t));
  musicTimers = [];
  musicStarted = false;
}

function toggleMusic(){
  musicEnabled = !musicEnabled;
  if(musicEnabled){
    if(musicGain) musicGain.gain.value = 0.16;
    startMusic();
  } else {
    if(musicGain) musicGain.gain.value = 0;
  }
  return musicEnabled;
}

// ---------------- DECK ----------------
function buildDeck(){
  const deck = [];
  let id = 0;
  for(const s of SUITS){
    for(const r of RANKS){
      deck.push({ id: 'c'+(id++), suit:s, rank:r, color:SUIT_COLOR[s], faceUp:false });
    }
  }
  return deck;
}
function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}

function newGame(){
  gameStarted = true;
  const deck = shuffle(buildDeck());
  const tableau = [[],[],[],[],[],[],[]];
  let idx = 0;
  for(let col=0; col<7; col++){
    for(let row=0; row<=col; row++){
      const card = deck[idx++];
      card.faceUp = (row===col);
      tableau[col].push(card);
    }
  }
  const stock = deck.slice(idx);
  state = {
    tableau,
    stock,
    waste: [],
    foundations: { spades:[], hearts:[], clubs:[], diamonds:[] },
    score: 0,
    combo: 1,
    comboCount: 0,
    moves: 0,
    comboTimer: null,
  };
  history = [];
  undosUsed = 0;
  redealsUsed = 0;
  jokers = pickJokers();
  renderJokerBar();
  document.getElementById('winOverlay').classList.remove('show');
  document.getElementById('gameOverOverlay').classList.remove('show');
  updateLimitBadges();
  render(true);
  updateHud(true);
  if(audioCtx) sfxShuffle();
  setJokerExpression('normal');
  if(LEVELS[currentLevel].recommend) refreshRecommendations();
}

// Update tampilan label limit undo/redeal di HUD sesuai level & sisa pakai
function updateLimitBadges(){
  const cfg = LEVELS[currentLevel];
  const undoBtn = document.getElementById('undoBtn');
  const stockLabel = document.getElementById('stockLimitLabel');
  if(undoBtn){
    if(cfg.undoLimit === Infinity){
      undoBtn.textContent = 'UNDO';
    } else {
      const remaining = Math.max(0, cfg.undoLimit - undosUsed);
      undoBtn.textContent = 'UNDO ('+remaining+')';
      undoBtn.disabled = remaining<=0;
    }
  }
  if(stockLabel){
    if(cfg.redealLimit === Infinity){
      stockLabel.textContent = '';
    } else {
      const remaining = Math.max(0, cfg.redealLimit - redealsUsed);
      stockLabel.textContent = 'Kocok ulang: '+remaining+'x lagi';
    }
  }
}

function pickJokers(){
  // Pilih 2 joker pasif acak untuk sesi ini (efek scoring sederhana ala Balatro)
  const pool = [
    { name:'Si Merah', desc:'+4 chip kartu Hati/Wajik', apply:(card)=> card.color==='red' ? 4 : 0 },
    { name:'Raja Foil', desc:'+20 chip saat King masuk', apply:(card)=> card.rank==='K' ? 20 : 0 },
    { name:'As Foil', desc:'+15 chip saat As masuk', apply:(card)=> card.rank==='A' ? 15 : 0 },
    { name:'Hitam Pekat', desc:'+4 chip kartu Sekop/Keriting', apply:(card)=> card.color==='black' ? 4 : 0 },
  ];
  return shuffle(pool.slice()).slice(0,2);
}
function renderJokerBar(){
  const bar = document.getElementById('jokerBar');
  bar.innerHTML = '';
  jokers.forEach(j=>{
    const el = document.createElement('div');
    el.className = 'joker-chip';
    el.innerHTML = `<b>${j.name}</b> · ${j.desc}`;
    bar.appendChild(el);
  });
}

function snapshot(){
  return JSON.stringify({
    tableau: state.tableau,
    stock: state.stock,
    waste: state.waste,
    foundations: state.foundations,
    score: state.score,
    combo: state.combo,
    comboCount: state.comboCount,
  });
}
function pushHistory(){
  history.push(snapshot());
  if(history.length>40) history.shift();
}
function undo(){
  if(history.length===0) return;
  const cfg = LEVELS[currentLevel];
  if(cfg.undoLimit !== Infinity && undosUsed >= cfg.undoLimit){
    sfxInvalid();
    showJokerSpeech('Tidak bisa undo lagi!', 'tense');
    return;
  }
  undosUsed++;
  const snap = JSON.parse(history.pop());
  state.tableau = snap.tableau;
  state.stock = snap.stock;
  state.waste = snap.waste;
  state.foundations = snap.foundations;
  state.score = snap.score;
  state.combo = snap.combo;
  state.comboCount = snap.comboCount;
  updateLimitBadges();
  render(true);
  updateHud(true);
  if(LEVELS[currentLevel].recommend) refreshRecommendations();
}

// ---------------- RENDER ----------------
function cardEl(card){
  const el = document.createElement('div');
  el.className = 'card ' + card.color + (card.faceUp ? '' : ' face-down') + (card.faceUp ? '' : ' flipped');
  el.dataset.id = card.id;

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  const suitSvg = SUIT_SVG[card.suit];
  const front = document.createElement('div');
  front.className = 'card-face front';
  front.innerHTML = `
    <div class="card-corner top"><div class="rank">${card.rank}</div><div class="suit">${suitSvg}</div></div>
    <div class="card-center-suit">${suitSvg}</div>
    <div class="card-corner bottom"><div class="rank">${card.rank}</div><div class="suit">${suitSvg}</div></div>
  `;
  const back = document.createElement('div');
  back.className = 'card-face back';
  back.innerHTML = `
    <div class="back-corner-dot tl"></div>
    <div class="back-corner-dot tr"></div>
    <div class="back-corner-dot bl"></div>
    <div class="back-corner-dot br"></div>
    <div class="back-monogram">FS</div>
  `;

  // urutan DOM: back dulu lalu front, supaya rotateY 180 pas faceUp menunjukkan front
  inner.appendChild(back);
  inner.appendChild(front);
  el.appendChild(inner);

  // flipped class artinya rotateY(180deg) -> front menghadap user jika faceUp true
  if(card.faceUp){ el.classList.add('flipped'); } else { el.classList.remove('flipped'); }

  return el;
}

function clearAbsoluteCards(container){
  container.querySelectorAll('.card').forEach(c=>c.remove());
}

function render(skipAnim){
  // Tableau
  const sampleCol = document.getElementById('col-0');
  const colHeight = sampleCol.clientHeight || 400;
  const cardH = 110;
  const maxPile = Math.max(...state.tableau.map(p=>p.length), 1);
  // jarak antar kartu: cukup lebar untuk lihat rank, tapi menyesuaikan agar kartu terakhir tetap pas di kolom
  const maxSpacing = 78;
  const minSpacing = 24;
  const available = colHeight - cardH;
  let spacing = maxSpacing;
  if(maxPile>1){
    spacing = Math.min(maxSpacing, Math.max(minSpacing, available / (maxPile-1)));
  }

  for(let col=0; col<7; col++){
    const colEl = document.getElementById('col-'+col);
    clearAbsoluteCards(colEl);
    const pile = state.tableau[col];
    pile.forEach((card,i)=>{
      const el = cardEl(card);
      el.style.top = (i*spacing) + 'px';
      el.style.left = '0px';
      el.style.zIndex = i+1;
      if(card.faceUp){
        el.addEventListener('mousedown', (e)=>onCardDown(e, 'tableau', col, i));
        el.addEventListener('touchstart', (e)=>onCardDown(e, 'tableau', col, i), {passive:false});
      } else if(i === pile.length-1){
        el.addEventListener('mousedown', (e)=>onFaceDownClick(e, col));
        el.addEventListener('touchstart', (e)=>onFaceDownClick(e, col), {passive:false});
      }
      colEl.appendChild(el);
    });
  }

  // Stock
  const stockSlot = document.getElementById('stockSlot');
  clearAbsoluteCards(stockSlot);
  if(state.stock.length>0){
    const top = state.stock[state.stock.length-1];
    const el = cardEl({...top, faceUp:false});
    el.style.top='0px'; el.style.left='0px';
    stockSlot.appendChild(el);
  }

  // Waste
  const wasteSlot = document.getElementById('wasteSlot');
  clearAbsoluteCards(wasteSlot);
  if(state.waste.length>0){
    const top = state.waste[state.waste.length-1];
    const el = cardEl(top);
    el.style.top='0px'; el.style.left='0px';
    el.addEventListener('mousedown', (e)=>onCardDown(e,'waste',0,state.waste.length-1));
    el.addEventListener('touchstart', (e)=>onCardDown(e,'waste',0,state.waste.length-1), {passive:false});
    wasteSlot.appendChild(el);
  }

  // Foundations
  for(const suit of SUITS){
    const slot = document.getElementById('f-'+suit);
    clearAbsoluteCards(slot);
    const pile = state.foundations[suit];
    if(pile.length>0){
      const top = pile[pile.length-1];
      const el = cardEl(top);
      el.style.position='relative';
      el.style.top='0px'; el.style.left='0px';
      slot.appendChild(el);
    }
  }

  updateHud(skipAnim);
}

function updateHud(skip){
  const scoreEl = document.getElementById('scoreVal');
  const comboEl = document.getElementById('comboVal');
  const stockEl = document.getElementById('stockVal');
  scoreEl.textContent = Math.floor(state.score);
  comboEl.textContent = 'x'+state.combo.toFixed(1).replace(/\.0$/,'');
  stockEl.textContent = state.stock.length;

  const comboBlock = document.getElementById('comboBlock');
  comboBlock.classList.remove('hot','blazing');
  if(state.combo>=3) comboBlock.classList.add('blazing');
  else if(state.combo>=1.5) comboBlock.classList.add('hot');

  if(!skip){
    scoreEl.classList.remove('pulse'); void scoreEl.offsetWidth; scoreEl.classList.add('pulse');
    comboEl.classList.remove('pulse'); void comboEl.offsetWidth; comboEl.classList.add('pulse');
  }
}

// ---------------- HELPERS ----------------
function topCardOf(col){
  const pile = state.tableau[col];
  return pile[pile.length-1];
}
function canStackTableau(movingCard, targetCard){
  if(!targetCard) return movingCard.rank==='K';
  const colorOk = movingCard.color !== targetCard.color;
  const rankOk = RANK_VALUE[movingCard.rank] === RANK_VALUE[targetCard.rank]-1;
  return colorOk && rankOk;
}
function canPlaceFoundation(card, suit){
  const pile = state.foundations[suit];
  if(card.suit!==suit) return false;
  if(pile.length===0) return card.rank==='A';
  return RANK_VALUE[card.rank] === RANK_VALUE[pile[pile.length-1].rank]+1;
}

function getCardRect(cardElement){
  return cardElement.getBoundingClientRect();
}

// ---------------- SCORING & FX ----------------
function registerFoundationMove(card){
  state.moves++;
  state.comboCount++;
  // combo decay reset timer: kalau lanjut cepat, combo naik
  clearTimeout(state.comboTimer);
  state.combo = Math.min(1 + (state.comboCount-1)*0.5, 5);
  state.comboTimer = setTimeout(()=>{ state.comboCount=0; state.combo=1; updateHud(); }, 4000);

  let chip = rankChipValue(card.rank);
  let bonus = 0;
  jokers.forEach(j=> bonus += j.apply(card));
  const total = (chip+bonus) * state.combo;
  state.score += total;

  return { chip, bonus, total };
}

function spawnScorePopup(x, y, text, cls){
  const layer = document.getElementById('fxLayer');
  const el = document.createElement('div');
  el.className = 'score-popup ' + (cls||'');
  el.style.left = x+'px';
  el.style.top = y+'px';
  el.textContent = text;
  layer.appendChild(el);
  setTimeout(()=>el.remove(), 1250);
}

function spawnParticles(x, y, color, count){
  const layer = document.getElementById('fxLayer');
  for(let i=0;i<count;i++){
    const el = document.createElement('div');
    el.className = 'particle';
    const angle = Math.random()*Math.PI*2;
    const dist = 30 + Math.random()*70;
    const px = Math.cos(angle)*dist;
    const py = Math.sin(angle)*dist - 20;
    el.style.setProperty('--px', px+'px');
    el.style.setProperty('--py', py+'px');
    const size = 3 + Math.random()*5;
    el.style.width = size+'px';
    el.style.height = size+'px';
    el.style.left = x+'px';
    el.style.top = y+'px';
    el.style.background = color;
    el.style.boxShadow = '0 0 6px '+color;
    layer.appendChild(el);
    setTimeout(()=>el.remove(), 750);
  }
}

function spawnConfetti(x,y,count){
  const layer = document.getElementById('fxLayer');
  const colors = ['#ffd93d','#ff4d6d','#4dffa0','#a855f7','#fdf6e8'];
  for(let i=0;i<count;i++){
    const el = document.createElement('div');
    el.className = 'confetti';
    const cx = (Math.random()-0.5)*220;
    const cy = 120 + Math.random()*160;
    const cr = (Math.random()*720-360)+'deg';
    el.style.setProperty('--cx', cx+'px');
    el.style.setProperty('--cy', cy+'px');
    el.style.setProperty('--cr', cr);
    el.style.left = x+'px';
    el.style.top = y+'px';
    el.style.background = colors[Math.floor(Math.random()*colors.length)];
    el.style.animationDelay = (Math.random()*0.15)+'s';
    layer.appendChild(el);
    setTimeout(()=>el.remove(), 1300);
  }
}

function screenFlash(){
  const f = document.getElementById('screenFlash');
  f.classList.remove('flash'); void f.offsetWidth; f.classList.add('flash');
}
function screenShake(){
  document.body.classList.remove('shake-screen'); void document.body.offsetWidth;
  document.body.classList.add('shake-screen');
}

function celebrateFoundation(targetRect, card, scoreInfo){
  const cx = targetRect.left + targetRect.width/2;
  const cy = targetRect.top + targetRect.height/2;
  const color = card.color==='red' ? '#ff4d6d' : '#9d7cff';
  const comboLevel = state.combo; // 1 .. 5

  // particle count scale dengan combo: makin tinggi combo, makin meledak
  const particleCount = Math.round(12 + comboLevel*8);
  spawnParticles(cx, cy, color, particleCount);

  // ring shockwave tiap foundation move, makin besar saat combo tinggi
  spawnShockwave(cx, cy, color, comboLevel);

  // ukuran & gaya popup score menyesuaikan combo
  const sizeClass = comboLevel>=3 ? 'big' : (comboLevel>=2 ? 'medium' : '');
  spawnScorePopup(cx, cy-10, '+'+Math.round(scoreInfo.total), sizeClass);

  if(scoreInfo.bonus>0){
    setTimeout(()=> spawnScorePopup(cx, cy-34, 'BONUS +'+scoreInfo.bonus, 'mult'), 110);
  }
  if(state.combo>1){
    setTimeout(()=> spawnScorePopup(cx, cy-58, 'COMBO x'+state.combo.toFixed(1), 'combo '+sizeClass), 200);
    sfxCombo();
  }
  sfxFoundation(state.comboCount);

  // efek skala kenaikan: tiap tingkat combo nambah kekuatan visual
  if(state.combo>=1.5) screenFlash();
  if(state.combo>=2.5) screenShake();
  if(state.combo>=3.5){
    screenShakeBig();
    pulseComboRing();
  }
  if(state.combo>=4.5){
    // combo maksimal: confetti kecil ikut meledak + flash ganda
    spawnConfetti(cx, cy, 14);
    setTimeout(screenFlash, 90);
  }

  // King ke foundation = bonus confetti gede (independen dari combo)
  if(card.rank==='K'){
    spawnConfetti(cx, cy, 30);
    screenFlash();
    showJokerSpeech('King masuk! Mantap!', 'happy');
  }
  // Ace ke foundation = pembuka kolom baru, kasih pulse khusus warna foundation
  if(card.rank==='A'){
    spawnParticles(cx, cy, '#ffd93d', 10);
  }

  // reaksi wajah joker mengikuti tingkat combo
  if(state.combo>=3.5){
    showJokerSpeech('COMBO GILA! x'+state.combo.toFixed(1), 'happy');
  } else if(state.combo>=2){
    setJokerExpression('happy');
  }
}

function spawnShockwave(x, y, color, comboLevel){
  const layer = document.getElementById('fxLayer');
  const el = document.createElement('div');
  el.className = 'shockwave';
  const size = 40 + comboLevel*18;
  el.style.left = x+'px';
  el.style.top = y+'px';
  el.style.setProperty('--ring-size', size+'px');
  el.style.borderColor = color;
  layer.appendChild(el);
  setTimeout(()=>el.remove(), 500);
}

function screenShakeBig(){
  document.body.classList.remove('shake-screen-big'); void document.body.offsetWidth;
  document.body.classList.add('shake-screen-big');
}

function pulseComboRing(){
  const comboBlock = document.getElementById('comboBlock');
  comboBlock.classList.remove('combo-burst'); void comboBlock.offsetWidth;
  comboBlock.classList.add('combo-burst');
}

// ---------------- INTERACTION ----------------
let selected = null; // {from, col, index}

function clearSelection(){
  document.querySelectorAll('.card.selected').forEach(c=>c.classList.remove('selected'));
  selected = null;
}

function onFaceDownClick(e, col){
  e.preventDefault();
  const pile = state.tableau[col];
  if(pile.length===0) return;
  const card = pile[pile.length-1];
  if(card.faceUp) return; // sudah ditangani onCardDown
  pushHistory();
  card.faceUp = true;
  sfxFlip();
  render();
  if(LEVELS[currentLevel].recommend) refreshRecommendations();
}

function onStockClick(e){
  e.preventDefault();
  if(state.stock.length===0){
    // recycle waste -> stock
    if(state.waste.length===0) return;
    const cfg = LEVELS[currentLevel];
    if(cfg.redealLimit !== Infinity && redealsUsed >= cfg.redealLimit){
      sfxInvalid();
      showJokerSpeech('Kartu cadangan sudah habis!', 'tense');
      checkGameOver();
      return;
    }
    redealsUsed++;
    pushHistory();
    state.stock = state.waste.reverse().map(c=>({...c, faceUp:false}));
    state.waste = [];
    sfxStock();
    updateLimitBadges();
    render();
    if(LEVELS[currentLevel].recommend) refreshRecommendations();
    checkGameOver();
    return;
  }
  pushHistory();
  const card = state.stock.pop();
  card.faceUp = true;
  state.waste.push(card);
  sfxStock();
  render();
  if(LEVELS[currentLevel].recommend) refreshRecommendations();
}

function tryAutoFoundation(card, fromType, fromCol){
  for(const suit of SUITS){
    if(canPlaceFoundation(card, suit)){
      return suit;
    }
  }
  return null;
}

function removeCardFromSource(fromType, col, index){
  if(fromType==='waste'){
    return state.waste.pop();
  } else if(fromType==='tableau'){
    return state.tableau[col].splice(index, 1)[0];
  } else if(fromType==='foundation'){
    return state.foundations[col].pop();
  }
}
function getSourcePile(fromType, col){
  if(fromType==='waste') return state.waste;
  if(fromType==='tableau') return state.tableau[col];
  if(fromType==='foundation') return state.foundations[col];
}

let isAnimating = false;

function animateCardToTarget(cardData, fromEl, targetSlotEl, onDone){
  isAnimating = true;
  const fromRect = fromEl.getBoundingClientRect();
  const toRect = targetSlotEl.getBoundingClientRect();

  const ghost = cardEl(cardData);
  ghost.classList.add('flying');
  ghost.style.position = 'fixed';
  ghost.style.left = fromRect.left+'px';
  ghost.style.top = fromRect.top+'px';
  ghost.style.margin = '0';
  ghost.style.zIndex = 9997;
  document.body.appendChild(ghost);
  fromEl.style.visibility = 'hidden';

  // tarik sedikit ke atas & rotasi kecil dulu sebelum meluncur, biar ada rasa "ancang-ancang"
  const liftDir = (toRect.left > fromRect.left) ? 1 : -1;
  ghost.style.transform = 'translateY(-10px) scale(1.06) rotate('+(liftDir*-4)+'deg)';

  const color = cardData.color==='red' ? '#ff4d6d' : '#9d7cff';
  let trailTicks = 0;
  const trailInterval = setInterval(()=>{
    const r = ghost.getBoundingClientRect();
    spawnParticles(r.left+r.width/2, r.top+r.height/2, color, 2);
    trailTicks++;
    if(trailTicks>=6) clearInterval(trailInterval);
  }, 40);

  requestAnimationFrame(()=>{
    ghost.style.left = toRect.left+'px';
    ghost.style.top = toRect.top+'px';
    ghost.style.transform = 'translateY(0) scale(1) rotate('+(liftDir*3)+'deg)';
    setTimeout(()=>{
      ghost.style.transform = 'scale(1) rotate(0deg)';
    }, 220);
  });

  setTimeout(()=>{
    clearInterval(trailInterval);
    ghost.remove();
    isAnimating = false;
    onDone(toRect);
  }, 300);
}

function placeOnFoundation(card, suit, fromEl){
  const targetSlot = document.getElementById('f-'+suit);
  card.faceUp = true;
  animateCardToTarget(card, fromEl, targetSlot, (rect)=>{
    state.foundations[suit].push(card);
    const info = registerFoundationMove(card);
    render();
    celebrateFoundation(rect, card, info);
    checkWin();
    checkGameOver();
    if(LEVELS[currentLevel].recommend) refreshRecommendations();
  });
}

function onCardDown(e, fromType, col, index){
  e.preventDefault();
  if(isAnimating) return;
  const pile = getSourcePile(fromType, col);
  const card = pile[index];
  if(!card || !card.faceUp) return;

  // feedback instan: kartu sedikit "ditekan" begitu disentuh, sebelum tahu ini tap/drag
  const cardElement = e.currentTarget;
  cardElement.classList.add('pressed');
  sfxPress();

  // klik-untuk-pindah cepat: jika ini single top card & belum drag, tunggu sedikit untuk bedakan klik vs drag
  const startX = e.touches ? e.touches[0].clientX : e.clientX;
  const startY = e.touches ? e.touches[0].clientY : e.clientY;
  let moved = false;

  function onMove(ev){
    const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
    if(Math.abs(x-startX)>4 || Math.abs(y-startY)>4) moved = true;
  }
  function onUp(ev){
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
    cardElement.classList.remove('pressed');

    if(!moved){
      handleCardTap(fromType, col, index, cardElement);
    }
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, {passive:false});
  document.addEventListener('touchend', onUp);
}

function handleCardTap(fromType, col, index, cardElement){
  const pile = getSourcePile(fromType, col);
  const card = pile[index];

  // Jika sudah ada seleksi sebelumnya -> coba pindah ke sini
  if(selected){
    const moved = attemptMoveSelectedTo(fromType, col);
    if(moved){ clearSelection(); return; }
    clearSelection();
  }

  // single card (top of waste, atau kartu teratas tableau) -> coba auto ke foundation dulu
  const isTopOfPile = (index === pile.length-1);
  if(isTopOfPile){
    const suit = tryAutoFoundation(card, fromType, col);
    if(suit){
      pushHistory();
      removeCardFromSource(fromType, col, index);
      placeOnFoundation(card, suit, cardElement);
      return;
    }
  }

  // select untuk dipindah manual (single card atau grup dari tableau)
  selected = { fromType, col, index };
  const movingNow = pile.slice(index);
  movingNow.forEach(c=>{
    const el = document.querySelector('.card[data-id="'+c.id+'"]');
    if(el){
      el.classList.add('selected');
      el.classList.add('just-selected');
      setTimeout(()=> el.classList.remove('just-selected'), 340);
    }
  });
  sfxSelect();
}

function isValidSequence(cards){
  for(let i=0;i<cards.length-1;i++){
    const a = cards[i], b = cards[i+1];
    if(a.color===b.color) return false;
    if(RANK_VALUE[a.rank] !== RANK_VALUE[b.rank]+1) return false;
  }
  return true;
}

function attemptMoveSelectedTo(targetType, targetCol){
  const { fromType, col, index } = selected;
  if(targetType==='tableau'){
    const sourcePile = getSourcePile(fromType, col);
    const movingCards = sourcePile.slice(index); // bisa multi kartu dari tableau
    const firstCard = movingCards[0];
    const targetTop = topCardOf(targetCol);

    if(fromType==='tableau' && col===targetCol) return false;
    if(movingCards.length>1 && !isValidSequence(movingCards)){
      flashInvalid(targetCol);
      return false;
    }

    if(canStackTableau(firstCard, targetTop)){
      pushHistory();
      sourcePile.splice(index, movingCards.length);
      state.tableau[targetCol].push(...movingCards);
      sfxPlace();
      render();
      // efek landing: kartu terakhir yang baru pindah dapat squash-bounce + particle kecil
      const lastCard = movingCards[movingCards.length-1];
      const el = document.querySelector('.card[data-id="'+lastCard.id+'"]');
      if(el){
        el.classList.add('landing');
        setTimeout(()=> el.classList.remove('landing'), 380);
        const rect = el.getBoundingClientRect();
        spawnParticles(rect.left+rect.width/2, rect.top+rect.height/2, lastCard.color==='red' ? '#ff4d6d' : '#9d7cff', 6);
      }
      checkGameOver();
      if(LEVELS[currentLevel].recommend) refreshRecommendations();
      return true;
    } else {
      // invalid -> shake feedback
      flashInvalid(targetCol);
      return false;
    }
  }
  return false;
}

function flashInvalid(targetCol){
  sfxInvalid();
  const colEl = document.getElementById('col-'+targetCol);
  colEl.classList.add('shake');
  setTimeout(()=>colEl.classList.remove('shake'), 320);
}

// klik kolom tableau kosong/area saat ada seleksi
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('stockSlot').addEventListener('mousedown', onStockClick);
  document.getElementById('stockSlot').addEventListener('touchstart', onStockClick, {passive:false});

  for(let i=0;i<7;i++){
    const colEl = document.getElementById('col-'+i);
    colEl.addEventListener('mousedown', (e)=>{
      if(e.target===colEl && selected){
        const moved = attemptMoveSelectedTo('tableau', i);
        clearSelection();
      }
    });
  }
  for(const suit of SUITS){
    document.getElementById('f-'+suit).addEventListener('mousedown', (e)=>{
      if(!selected) return;
      const { fromType, col, index } = selected;
      const pile = getSourcePile(fromType, col);
      if(index !== pile.length-1){ clearSelection(); return; } // hanya single card ke foundation
      const card = pile[index];
      if(canPlaceFoundation(card, suit)){
        const cardElement = document.querySelector('.card[data-id="'+card.id+'"]');
        pushHistory();
        removeCardFromSource(fromType, col, index);
        placeOnFoundation(card, suit, cardElement || e.currentTarget);
      } else {
        sfxInvalid();
      }
      clearSelection();
    });
  }
});

function checkWin(){
  const total = SUITS.reduce((s,suit)=> s+state.foundations[suit].length, 0);
  if(total===52){
    gameStarted = false;
    setTimeout(()=>{
      sfxWin();
      setJokerExpression('happy');
      showJokerSpeech('Luar biasa! Kamu menang!', 'happy');
      document.getElementById('finalScoreVal').textContent = 'Skor: '+Math.floor(state.score);
      document.getElementById('winOverlay').classList.add('show');
      const layer = document.getElementById('fxLayer');
      for(let i=0;i<6;i++){
        setTimeout(()=> spawnConfetti(window.innerWidth/2 + (Math.random()-0.5)*300, window.innerHeight*0.3, 20), i*150);
      }
    }, 300);
  }
}

// ---------------- GAME OVER DETECTION ----------------
// Game over terjadi ketika: tidak ada hint/gerakan valid tersisa di tableau/waste,
// DAN stock sudah kosong dengan redeal yang sudah habis (atau waste juga kosong).
function hasAnyValidMove(){
  // 1) ada kartu foundation-able di waste/tableau?
  if(state.waste.length>0){
    const c = state.waste[state.waste.length-1];
    if(tryAutoFoundation(c)) return true;
  }
  for(let col=0; col<7; col++){
    const pile = state.tableau[col];
    if(pile.length>0){
      const top = pile[pile.length-1];
      if(top.faceUp && tryAutoFoundation(top)) return true;
    }
  }
  // 2) ada move tableau->tableau yang valid (termasuk kartu face-down yang masih bisa dibuka)?
  for(let col=0; col<7; col++){
    const pile = state.tableau[col];
    for(let i=0;i<pile.length;i++){
      if(!pile[i].faceUp){
        // kartu tertutup di ujung pile masih bisa dibuka -> masih ada potensi langkah
        if(i === pile.length-1) return true;
        continue;
      }
      const moving = pile[i];
      for(let tcol=0; tcol<7; tcol++){
        if(tcol===col) continue;
        const targetTop = topCardOf(tcol);
        if(canStackTableau(moving, targetTop)) return true;
      }
    }
  }
  // 3) waste->tableau valid?
  if(state.waste.length>0){
    const c = state.waste[state.waste.length-1];
    for(let tcol=0; tcol<7; tcol++){
      const targetTop = topCardOf(tcol);
      if(canStackTableau(c, targetTop)) return true;
    }
  }
  return false;
}

function canStillDrawOrRedeal(){
  if(state.stock.length>0) return true;
  if(state.waste.length===0) return false;
  const cfg = LEVELS[currentLevel];
  if(cfg.redealLimit === Infinity) return true;
  return redealsUsed < cfg.redealLimit;
}

function checkGameOver(){
  if(!gameStarted) return;
  const total = SUITS.reduce((s,suit)=> s+state.foundations[suit].length, 0);
  if(total===52) return; // sudah menang, bukan game over

  const stillHasMove = hasAnyValidMove();
  const stillCanDraw = canStillDrawOrRedeal();

  if(stillHasMove || stillCanDraw){
    // belum game over, tapi kalau stock+waste sudah kritis (hampir habis & redeal terbatas), beri sinyal tegang
    const cfg = LEVELS[currentLevel];
    if(!stillHasMove && cfg.redealLimit !== Infinity){
      const remaining = cfg.redealLimit - redealsUsed;
      if(remaining <= 1 && state.stock.length===0){
        showJokerSpeech('Hati-hati, hampir kehabisan langkah...', 'tense');
      }
    }
    return;
  }

  // benar-benar tidak ada langkah lagi -> game over
  gameStarted = false;
  setJokerExpression('shock');
  setTimeout(()=>{
    sfxInvalid();
    document.getElementById('gameOverScore').textContent = 'Skor: '+Math.floor(state.score);
    document.getElementById('gameOverOverlay').classList.add('show');
  }, 400);
}

// ---------------- KARAKTER JOKER (reaksi ekspresi & speech bubble) ----------------
let jokerSpeechTimer = null;
let currentJokerExpr = "normal";
let jokerFrame = 1;

function updateJokerImage() {

    const img = document.getElementById("jokerImage");

    if (!img) return;

    switch(currentJokerExpr){

        case "normal":
            img.src = `img/joker/joker_normal/joker-normal-${jokerFrame}.png`;
            break;

        case "happy":
            img.src = `img/joker/joker_happy/joker-happy-${jokerFrame}.png`;
            break;

        case "tense":
            img.src = `img/joker/joker_tense/joker-tense-${jokerFrame}.png`;
            break;

        case "shock":
            img.src = `img/joker/joker_shock/joker-shock-${jokerFrame}.png`;
            break;
    }
}

function setJokerExpression(expr){

    currentJokerExpr = expr;

    jokerFrame = 1;

    updateJokerImage();
}

// ===================================
// TARUH DI PALING BAWAH
// ===================================

updateJokerImage();

setInterval(() => {

    jokerFrame++;

    if (jokerFrame > 3)
        jokerFrame = 1;

    updateJokerImage();

}, 180);

function showJokerSpeech(text, expr){
  const bubble = document.getElementById('jokerSpeech');
  if(!bubble) return;
  if(expr) setJokerExpression(expr);
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(jokerSpeechTimer);
  jokerSpeechTimer = setTimeout(()=>{
    bubble.classList.remove('show');
    setTimeout(()=>{ if(!bubble.classList.contains('show')) setJokerExpression('normal'); }, 300);
  }, 2600);
}

// ---------------- REKOMENDASI KARTU (mode Mudah) ----------------
// Highlight SEMUA kartu top-of-pile yang punya minimal satu langkah valid,
// supaya pemain baru tidak pusing menentukan langkah.
function refreshRecommendations(){
  document.querySelectorAll('.card.recommended').forEach(c=>c.classList.remove('recommended'));
  if(!state) return;

  const markIfValid = (card, el)=>{
    if(!el) return;
    let valid = false;
    if(tryAutoFoundation(card)) valid = true;
    if(!valid){
      for(let tcol=0; tcol<7; tcol++){
        const targetTop = topCardOf(tcol);
        if(canStackTableau(card, targetTop)){ valid = true; break; }
      }
    }
    if(valid) el.classList.add('recommended');
  };

  if(state.waste.length>0){
    const c = state.waste[state.waste.length-1];
    markIfValid(c, document.querySelector('.card[data-id="'+c.id+'"]'));
  }
  for(let col=0; col<7; col++){
    const pile = state.tableau[col];
    if(pile.length>0){
      const top = pile[pile.length-1];
      if(top.faceUp){
        markIfValid(top, document.querySelector('.card[data-id="'+top.id+'"]'));
      }
    }
  }
}

// ---------------- HINT ----------------
function findHint(){
  // cari kartu yang bisa langsung ke foundation
  if(state.waste.length>0){
    const c = state.waste[state.waste.length-1];
    if(tryAutoFoundation(c)) return {type:'waste', col:0, index:state.waste.length-1};
  }
  for(let col=0; col<7; col++){
    const pile = state.tableau[col];
    if(pile.length>0){
      const top = pile[pile.length-1];
      if(top.faceUp && tryAutoFoundation(top)) return {type:'tableau', col, index:pile.length-1};
    }
  }
  // cari move tableau ke tableau yang valid
  for(let col=0; col<7; col++){
    const pile = state.tableau[col];
    for(let i=0;i<pile.length;i++){
      if(!pile[i].faceUp) continue;
      const moving = pile[i];
      for(let tcol=0; tcol<7; tcol++){
        if(tcol===col) continue;
        const targetTop = topCardOf(tcol);
        if(canStackTableau(moving, targetTop)) return {type:'tableau', col, index:i};
      }
    }
  }
  return null;
}

function initAmbientParticles(){
  const layer = document.getElementById('ambientLayer');
  const count = 18;
  for(let i=0;i<count;i++){
    const dot = document.createElement('div');
    dot.className = 'ambient-dot';
    dot.style.left = (Math.random()*100)+'vw';
    const duration = 14 + Math.random()*18;
    const delay = Math.random()*duration;
    const drift = (Math.random()*60-30)+'px';
    const size = 2 + Math.random()*3;
    dot.style.width = size+'px';
    dot.style.height = size+'px';
    dot.style.setProperty('--drift', drift);
    dot.style.animationDuration = duration+'s';
    dot.style.animationDelay = '-'+delay+'s';
    layer.appendChild(dot);
  }
}

// ---------------- MAIN MENU ----------------
function initMainMenu(){
  const levelBtns = document.querySelectorAll('.level-btn');
  levelBtns.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      levelBtns.forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      currentLevel = btn.dataset.level;
    });
  });

  document.getElementById('menuPlayBtn').addEventListener('click', ()=>{
    ensureAudio();
    startMusic();
    document.getElementById('mainMenuOverlay').classList.remove('show');
    gameStarted = true;
    newGame();
  });

  document.getElementById('menuTutorialBtn').addEventListener('click', ()=>{
    ensureAudio();
    document.getElementById('mainMenuOverlay').classList.remove('show');
    openTutorial(true); // true = balik ke main menu setelah selesai/skip
  });
}

// ---------------- TUTORIAL ----------------
const TUTORIAL_STEPS = [
  {
    icon: '🎯',
    title: 'Tujuan Permainan',
    text: 'Pindahkan semua 52 kartu ke 4 tumpukan Foundation di kanan atas, berdasarkan jenis (♠ ♥ ♦ ♣), tersusun dari As sampai King.',
  },
  {
    icon: '🔢',
    title: 'Urutan di Foundation',
    text: 'Tiap tumpukan Foundation harus diisi berurutan: A → 2 → 3 → ... → 10 → J → Q → K. Tidak bisa lompat angka.',
  },
  {
    icon: '🃏',
    title: 'Menyusun di Tableau',
    text: 'Di area utama (Tableau), susun kartu menurun dan warna berselang-seling. Contoh benar: K♠ (hitam) → Q♥ (merah) → J♣ (hitam).',
  },
  {
    icon: '👑',
    title: 'Aturan King',
    text: 'Hanya King yang boleh diletakkan di kolom Tableau yang kosong. Kartu lain tidak bisa menempati kolom kosong.',
  },
  {
    icon: '🎴',
    title: 'Stock & Waste',
    text: 'Tidak ada langkah? Ketuk tumpukan kartu di kiri atas (Stock) untuk membuka kartu baru ke Waste. Kartu di Waste bisa dipakai ke Tableau atau Foundation.',
  },
  {
    icon: '👆',
    title: 'Cara Memindahkan',
    text: 'Ketuk kartu untuk memilihnya (akan terangkat & menyala emas), lalu ketuk tujuan untuk memindahkannya. Kartu yang valid ke Foundation akan otomatis terbang sendiri.',
  },
  {
    icon: '⚡',
    title: 'Combo & Skor',
    text: 'Pindahkan kartu ke Foundation secara beruntun dan cepat untuk menaikkan COMBO — semakin tinggi combo, semakin besar skor dan efeknya makin meledak!',
  },
];
let tutorialStep = 0;
let tutorialReturnToMenu = true;

function openTutorial(returnToMenu){
  tutorialReturnToMenu = returnToMenu;
  tutorialStep = 0;
  renderTutorialStep();
  document.getElementById('tutorialOverlay').classList.add('show');
}

function closeTutorial(){
  document.getElementById('tutorialOverlay').classList.remove('show');
  if(tutorialReturnToMenu){
    document.getElementById('mainMenuOverlay').classList.add('show');
  }
}

function renderTutorialStep(){
  const step = TUTORIAL_STEPS[tutorialStep];
  document.getElementById('tutorialVisual').textContent = step.icon;
  document.getElementById('tutorialTitle').textContent = step.title;
  document.getElementById('tutorialText').textContent = step.text;

  const indicator = document.getElementById('tutorialStepIndicator');
  indicator.innerHTML = '';
  TUTORIAL_STEPS.forEach((_, i)=>{
    const dot = document.createElement('div');
    dot.className = 'dot' + (i===tutorialStep ? ' active' : '');
    indicator.appendChild(dot);
  });

  const prevBtn = document.getElementById('tutorialPrevBtn');
  const nextBtn = document.getElementById('tutorialNextBtn');
  prevBtn.disabled = (tutorialStep===0);
  nextBtn.textContent = (tutorialStep === TUTORIAL_STEPS.length-1) ? 'Mulai Main ✓' : 'Lanjut ›';
}

function initTutorial(){
  document.getElementById('tutorialSkipBtn').addEventListener('click', closeTutorial);
  document.getElementById('tutorialPrevBtn').addEventListener('click', ()=>{
    if(tutorialStep>0){ tutorialStep--; renderTutorialStep(); }
  });
  document.getElementById('tutorialNextBtn').addEventListener('click', ()=>{
    if(tutorialStep < TUTORIAL_STEPS.length-1){
      tutorialStep++;
      renderTutorialStep();
    } else {
      closeTutorial();
    }
  });
}


function initGameOverScreen(){
  document.getElementById('gameOverRetryBtn').addEventListener('click', ()=>{
    document.getElementById('gameOverOverlay').classList.remove('show');
    gameStarted = true;
    newGame();
  });
  document.getElementById('gameOverMenuBtn').addEventListener('click', ()=>{
    document.getElementById('gameOverOverlay').classList.remove('show');
    document.getElementById('mainMenuOverlay').classList.add('show');
  });
}

document.addEventListener('DOMContentLoaded', ()=>{
  initAmbientParticles();

  // Browser butuh user-gesture pertama sebelum AudioContext bisa jalan;
  // begitu user berinteraksi apapun, musik ambient mulai diam-diam di background.
  const startOnFirstInteraction = ()=>{
    ensureAudio();
    startMusic();
    document.removeEventListener('mousedown', startOnFirstInteraction);
    document.removeEventListener('touchstart', startOnFirstInteraction);
    document.removeEventListener('keydown', startOnFirstInteraction);
  };
  document.addEventListener('mousedown', startOnFirstInteraction);
  document.addEventListener('touchstart', startOnFirstInteraction);
  document.addEventListener('keydown', startOnFirstInteraction);

  document.getElementById('newGameBtn').addEventListener('click', ()=>{ gameStarted = true; newGame(); });
  document.getElementById('muteBtn').addEventListener('click', ()=>{
    ensureAudio();
    const on = toggleMusic();
    const btn = document.getElementById('muteBtn');
    btn.textContent = on ? '🔊' : '🔇';
    btn.classList.toggle('muted', !on);
  });
  document.getElementById('undoBtn').addEventListener('click', ()=>{ undo(); });
  document.getElementById('playAgainBtn').addEventListener('click', ()=>{ gameStarted = true; newGame(); });
  document.getElementById('hintBtn').addEventListener('click', ()=>{
    if(LEVELS[currentLevel].noHint){
      showJokerSpeech('Hint dimatikan di level ini!', 'tense');
      sfxInvalid();
      return;
    }
    const hint = findHint();
    document.querySelectorAll('.card.hint-glow').forEach(c=>c.classList.remove('hint-glow'));
    if(!hint){ sfxInvalid(); return; }
    const pile = getSourcePile(hint.type, hint.col);
    const card = pile[hint.index];
    const el = document.querySelector('.card[data-id="'+card.id+'"]');
    if(el){
      el.classList.add('hint-glow');
      setTimeout(()=> el.classList.remove('hint-glow'), 2000);
    }
  });

  initMainMenu();
  initTutorial();
  initGameOverScreen();
  // newGame() TIDAK dipanggil otomatis lagi — menunggu pemain pilih level & klik MAIN di Main Menu
});
