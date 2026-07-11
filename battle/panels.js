// Log + side-panel text rendering. Reads state/queries only -- never
// mutates game state.
import { STATE_NAME, MAX_TURNS, MP_MAX, sideName } from "./config.js";
import * as Q from "./queries.js";

const logEl = document.getElementById("log");

export function clearLog() { logEl.innerHTML = ""; }

export function log(msg, cls) {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = msg;
  logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
}

export function updateSetupPanels(state) {
  document.getElementById("controls").style.display = "none";
  document.getElementById("setupControls").style.display = "flex";
  document.getElementById("kbdHint").style.display = "none";
  const st = document.getElementById("status");
  const setup = state.setup;
  st.innerHTML = `<span class="who" style="color:${setup.side === 0 ? "var(--blue)" : "var(--red)"}">` +
    `${sideName(setup.side)} deployment</span> — ${setup.placed.length}/${state.SIZE} placed`;
  const ai = document.getElementById("actinfo");
  const sel = setup.selected;
  ai.innerHTML = sel
    ? `Selected squadron${sel === setup.flagShip ? " — <b>flagship</b>" : ""}. Turn it, set flagship, remove it, ` +
      `or click an empty zone hex to place another.`
    : (setup.placed.length < state.SIZE
        ? `Click an empty hex in your shaded zone to place your next squadron (${state.SIZE - setup.placed.length} left).`
        : `All ${state.SIZE} squadrons placed. Click one to adjust, or confirm.`);
  document.getElementById("btnSetupL").disabled = !sel;
  document.getElementById("btnSetupR").disabled = !sel;
  document.getElementById("btnSetupFlag").disabled = !sel || sel === setup.flagShip;
  document.getElementById("btnSetupRemove").disabled = !sel;
  document.getElementById("btnSetupConfirm").disabled = setup.placed.length !== state.SIZE;
}

export function updatePanels(state) {
  if (state.setup) { updateSetupPanels(state); return; }
  document.getElementById("controls").style.display = "flex";
  document.getElementById("setupControls").style.display = "none";
  document.getElementById("kbdHint").style.display = "";
  const st = document.getElementById("status");
  const G = state.G;
  if (!G) return;
  const lossStr = s => `${Q.losses(state, s)}/${state.BREAK_AT} losses`;
  const supStr = s => G.fleets[s].supply === "ok" ? "" : ` (${G.fleets[s].supply} supply)`;
  st.innerHTML = `<span class="who" style="color:var(--gold)">Turn ${G.turn}/${MAX_TURNS}</span> — ` +
    `<span style="color:var(--blue)">Blue ${G.fleets[0].name}${supStr(0)}: ${lossStr(0)}</span> · ` +
    `<span style="color:var(--red)">Red ${G.fleets[1].name}${supStr(1)}: ${lossStr(1)}</span>`;
  const ai = document.getElementById("actinfo");
  const btns = { L: document.getElementById("btnL"), F: document.getElementById("btnF"),
                 R: document.getElementById("btnR"), B: document.getElementById("btnB"),
                 Fi: document.getElementById("btnFire"), E: document.getElementById("btnEnd") };
  if (G.over) { ai.textContent = "Battle over."; for (const b of Object.values(btns)) b.disabled = true; return; }
  const act = state.act;
  if (act && act.u == null) {
    ai.innerHTML = `<b style="color:${act.side === 0 ? "var(--blue)" : "var(--red)"}">${sideName(act.side)}</b>: click one of your un-activated squadrons.`;
    for (const b of Object.values(btns)) b.disabled = true;
  } else if (act && act.u != null) {
    const u = act.u;
    ai.innerHTML = `<b>${Q.labelOf(state, u)}${Q.isFlagship(state, u) ? " ★" : ""}</b> — str ${Q.strengthOf(state, u)}, ${STATE_NAME[Q.moraleOf(state, u)]}, ` +
      `${act.cmd ? "in command (move + fire)" : "OUT of command (move OR fire)"}<br>` +
      `MP ${act.mp}/${MP_MAX}${act.fired ? " · has fired" : ""}` +
      (act.fireMode ? ` · <span style="color:var(--red)">pick a highlighted target</span>` : "") +
      (Q.canSwitchSelection(state) ? `<br><span style="color:var(--dim)">Changed your mind? Click another un-activated squadron to switch — nothing's committed yet.</span>` : "");
    btns.L.disabled = btns.R.disabled = btns.F.disabled = !Q.canMove(state);
    btns.B.disabled = !Q.canBack(state);
    btns.Fi.disabled = !Q.canFire(state);
    btns.E.disabled = false;
  } else {
    ai.textContent = "AI is acting…";
    for (const b of Object.values(btns)) b.disabled = true;
  }
}
