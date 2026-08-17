"use strict";
const DATA_OWNER = "Sooap95";
const DATA_REPO  = "z2h-tracker";
const BRANCH     = "main";
const API = `https://api.github.com/repos/${DATA_OWNER}/${DATA_REPO}/contents`;

const $ = (id) => document.getElementById(id);
const token = () => localStorage.getItem("z2h_token") || "";
let plan = null;
let rows = [];
let touched = [];

async function ghGet(path) {
  return fetch(`${API}/${path}?ref=${BRANCH}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token()}`,
               Accept: "application/vnd.github.raw+json" },
  });
}

async function loadPlan() {
  const sub = $("subtitle");
  if (!token()) { sub.textContent = "⚙️ Renseigne d'abord ton token dans les réglages en bas."; return; }
  sub.textContent = "Chargement de la prochaine séance…";
  try {
    const res = await ghGet("state/next-session.json");
    if (!res.ok) {
      const hints = {
        401: "token invalide ou expiré",
        403: "accès refusé (scope du token ?)",
        404: "introuvable — le token a-t-il bien accès au repo privé z2h-tracker ?",
      };
      sub.textContent = `Erreur ${res.status} : ${hints[res.status] ?? "réponse inattendue de GitHub"}.`;
      return;
    }
    plan = await res.json();
    render();
  } catch (e) {
    sub.textContent = `Échec réseau ou script : ${e.message}`;
  }
}

function render() {
  $("title").textContent = plan.template_name;
  $("subtitle").textContent = `Préparée d'après la séance du ${plan.based_on_last_session ?? "—"}`;
  const zone = $("exercises");
  zone.innerHTML = "";
  rows = [];

  if (plan.deload) {
    const banner = document.createElement("div");
    banner.className = "deload-banner";
    banner.textContent = "SEMAINE DE DELOAD — 1 série par exercice, mêmes charges";
    zone.appendChild(banner);
  }

  plan.exercises.forEach((exo) => {
    rows.push(exo.targets.map(t => ({ weight: t.target_weight_kg, reps: t.rep_max })));
  });
  touched = plan.exercises.map(exo => exo.targets.map(() => false));

  const groups = [];
  const groupSlot = new Map();
  plan.exercises.forEach((exo, i) => {
    if (exo.superset_group == null) { groups.push([i]); return; }
    if (groupSlot.has(exo.superset_group)) {
      groupSlot.get(exo.superset_group).push(i);
    } else {
      const slot = [i];
      groupSlot.set(exo.superset_group, slot);
      groups.push(slot);
    }
  });
  groups.forEach((indices) => {
    zone.appendChild(indices.length > 1 ? supersetCard(indices) : soloCard(indices[0]));
  });

  $("f-date").value = new Date().toISOString().slice(0, 10);
  $("meta").hidden = false;
}

function exoHeader(exo, prefix) {
  return `
      <div class="exo-name">${prefix}${exo.name}</div>
      <div class="exo-meta">${exo.set_type} · repos ${fmtRest(exo.rest_s)}
        · dernière fois : ${exo.last_done_on ?? "jamais"}</div>
      <div class="reason">${exo.reason}</div>`;
}

function soloCard(i) {
  const exo = plan.exercises[i];
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = exoHeader(exo, "");
  exo.targets.forEach((t, j) => card.appendChild(setRow(i, j)));
  card.appendChild(segStrip(i, ""));
  card.appendChild(timerBtn(exo.rest_s, ""));
  appendNote(card, exo.note);
  return card;
}

function supersetCard(indices) {
  const letter = (k) => String.fromCharCode(65 + k);
  const card = document.createElement("div");
  card.className = "card superset";
  card.innerHTML = `<div class="ss-tag">SUPERSET</div>` +
    indices.map((i, k) => exoHeader(plan.exercises[i], `${letter(k)} · `)).join("");
  const maxSets = Math.max(...indices.map(i => plan.exercises[i].targets.length));
  for (let j = 0; j < maxSets; j++) {
    indices.forEach((i, k) => {
      const exo = plan.exercises[i];
      if (j >= exo.targets.length) return;
      const label = document.createElement("div");
      label.className = "ss-label";
      label.textContent = `${letter(k)}${j + 1} · ${exo.name}`;
      card.appendChild(label);
      card.appendChild(setRow(i, j));
    });
  }
  indices.forEach((i, k) => card.appendChild(segStrip(i, letter(k))));
  indices.forEach((i, k) => {
    card.appendChild(timerBtn(plan.exercises[i].rest_s, `${letter(k)} · `));
  });
  indices.forEach((i) => appendNote(card, plan.exercises[i].note));
  return card;
}

function setRow(i, j) {
  const exo = plan.exercises[i];
  const t = exo.targets[j];
  const row = document.createElement("div");
  row.className = "set-row";
  row.innerHTML = `
    <button class="btn" data-a="w-" aria-label="moins">−</button>
    <div class="w-wrap">
      <span class="w-delta" hidden></span>
      <input class="w-input" type="number" inputmode="decimal"
             step="${exo.increment_kg}" placeholder="kg"
             value="${t.target_weight_kg ?? ""}">
      <span class="w-ghost">${t.target_weight_kg != null ? `cible ${t.target_weight_kg}` : ""}</span>
    </div>
    <button class="btn" data-a="w+" aria-label="plus">+</button>
    <div class="r-wrap">
      <span class="r-range">${t.rep_min}–${t.rep_max}</span>
      <button class="btn r-btn" data-a="r-">−</button>
      <input class="r-input" type="number" inputmode="numeric" value="${t.rep_max}">
      <button class="btn r-btn" data-a="r+">+</button>
    </div>`;

  const [wInput, rInput] = [row.querySelector(".w-input"), row.querySelector(".r-input")];
  const deltaEl = row.querySelector(".w-delta");
  const updateDelta = () => {
    const cur = wInput.value === "" ? null : parseFloat(wInput.value);
    const d = (t.target_weight_kg != null && cur != null)
      ? +(cur - t.target_weight_kg).toFixed(2) : 0;
    deltaEl.hidden = !d;
    if (d) deltaEl.textContent = (d > 0 ? "+" : "−") + Math.abs(d);
  };
  const mark = () => { touched[i][j] = true; updateSegs(i); updateDelta(); };
  row.addEventListener("click", (ev) => {
    const a = ev.target.dataset?.a;
    if (!a) return;
    if (a[0] === "w") {
      const cur = parseFloat(wInput.value) || 0;
      const next = Math.max(0, cur + (a[1] === "+" ? 1 : -1) * exo.increment_kg);
      wInput.value = +next.toFixed(2);
    } else {
      const cur = parseInt(rInput.value) || 0;
      rInput.value = Math.max(0, cur + (a[1] === "+" ? 1 : -1));
    }
    sync(i, j, wInput, rInput);
    mark();
  });
  row.addEventListener("input", () => { sync(i, j, wInput, rInput); mark(); });
  return row;
}

function segStrip(i, label) {
  const wrap = document.createElement("div");
  wrap.className = "segs-row";
  if (label) {
    const l = document.createElement("span");
    l.className = "segs-label"; l.textContent = label;
    wrap.appendChild(l);
  }
  const s = document.createElement("div");
  s.className = "segs"; s.dataset.exo = i;
  plan.exercises[i].targets.forEach(() => s.appendChild(document.createElement("span")));
  wrap.appendChild(s);
  return wrap;
}

function updateSegs(i) {
  document.querySelectorAll(`.segs[data-exo="${i}"] span`).forEach((sp, j) => {
    const s = rows[i][j];
    sp.classList.toggle("on", touched[i][j] && s.reps > 0 && s.weight !== null);
  });
}

let audioCtx = null;
function ensureAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === "suspended") audioCtx.resume();
}
function playBeep() {
  try {
    ensureAudio();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [0, 0.2, 0.4].forEach((offset) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.4, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.17);
    });
  } catch (_) {}
}

function timerBtn(rest_s, prefix) {
  const timer = document.createElement("button");
  timer.className = "timer-btn";
  timer.textContent = `▶ Repos ${prefix}${fmtRest(rest_s)}`;
  timer.addEventListener("click", () => startTimer(timer, rest_s, prefix));
  return timer;
}

function appendNote(card, text) {
  if (!text) return;
  const note = document.createElement("div");
  note.className = "note"; note.textContent = text;
  card.appendChild(note);
}

function sync(i, j, wInput, rInput) {
  rows[i][j] = {
    weight: wInput.value === "" ? null : parseFloat(wInput.value),
    reps: parseInt(rInput.value) || 0,
  };
}

function fmtRest(s) { return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, "0")}`;
}

function startTimer(btn, total, prefix) {
  if (btn.dataset.running) {
    clearInterval(+btn.dataset.running);
    delete btn.dataset.running;
    btn.classList.remove("running");
    btn.textContent = `▶ Repos ${prefix}${fmtRest(total)}`;
    return;
  }
  ensureAudio();
  let left = total;
  btn.classList.add("running");
  const tick = () => {
    btn.textContent = `⏱ ${prefix}${fmtRest(left)}`;
    if (left-- <= 0) {
      clearInterval(+btn.dataset.running);
      delete btn.dataset.running;
      btn.classList.remove("running");
      btn.textContent = `▶ Repos ${prefix}${fmtRest(total)}`;
      playBeep();
      if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 300]);
    }
  };
  btn.dataset.running = setInterval(tick, 1000);
  tick();
}

async function send() {
  const date = $("f-date").value;
  if (!date) { return status("Renseigne la date.", true); }
  const session = {
    date,
    template: plan.template,
    duration_min: $("f-dur").value ? +$("f-dur").value : null,
    bodyweight_kg: $("f-bw").value ? +$("f-bw").value : null,
    notes: $("f-notes").value,
    ...(plan.deload ? { deload: true } : {}),
    exercises: plan.exercises.map((exo, i) => ({
      id: exo.id,
      sets: rows[i].filter(s => s.reps > 0 && s.weight !== null)
                   .map(s => ({ weight_kg: s.weight, reps: s.reps })),
    })).filter(e => e.sets.length > 0),
  };
  if (session.exercises.length === 0) { return status("Aucune série remplie.", true); }

  const path = `data/sessions/${date}_${plan.template}.json`;
  $("send").disabled = true;
  status("Envoi…");
  try {
    let sha;
    const head = await fetch(`${API}/${path}?ref=${BRANCH}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (head.ok) sha = (await head.json()).sha;
    const res = await fetch(`${API}/${path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token()}`,
                 Accept: "application/vnd.github+json" },
      body: JSON.stringify({
        message: `Séance ${date} ${plan.template}`,
        branch: BRANCH,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(session, null, 2) + "\n"))),
        ...(sha ? { sha } : {}),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    status("✔ Séance enregistrée — le recalcul tourne, la prochaine séance sera prête dans ~1 min.", false, true);
  } catch (e) {
    status(`Échec de l'envoi (${e.message}). Les données restent à l'écran, réessaie.`, true);
    $("send").disabled = false;
  }
}

function status(msg, isErr, isOk) {
  const el = $("status");
  el.textContent = msg;
  el.className = isErr ? "err" : isOk ? "ok" : "";
}

$("save-token").addEventListener("click", () => {
  const value = $("f-token").value.trim();
  if (!value) { $("subtitle").textContent = "Le champ token est vide."; return; }
  try {
    localStorage.setItem("z2h_token", value);
  } catch (e) {
    $("subtitle").textContent = `Stockage impossible (${e.name}) — navigation privée ? Le token ne peut pas être retenu.`;
    return;
  }
  $("f-token").value = "";
  $("subtitle").textContent = "Token enregistré ✔";
  loadPlan();
});
$("send").addEventListener("click", send);
loadPlan();
