// All DOM event wiring: canvas clicks, buttons, keyboard shortcuts. Calls
// into turnEngine.js/deployment.js and re-renders via render.js/panels.js.
import { pixelToHex, draw } from "./render.js";
import { updatePanels } from "./panels.js";
import * as Q from "./queries.js";
import {
  doTurn, doForward, doBackward, doFireAt, endActivation,
  selectUnit, switchSelection, newBattle, proceed,
} from "./turnEngine.js";
import { handleSetupClick, setupTurn, setupToggleFlag, setupRemove, confirmSetup } from "./deployment.js";

const cv = document.getElementById("cv");

function closeOv() { document.getElementById("overlay").style.display = "none"; }
function toMenu(state) {
  closeOv();
  if (state.autoTimer) { clearInterval(state.autoTimer); state.autoTimer = null; }
  state.G = null; state.act = null; state.setup = null; state.setupQueue = [];
  document.getElementById("battle").style.display = "none";
  document.getElementById("menu").style.display = "block";
}

export function wire(state) {
  cv.addEventListener("click", ev => {
    const r = cv.getBoundingClientRect();
    const h = pixelToHex(ev.clientX - r.left, ev.clientY - r.top);
    if (!h) return;
    if (state.setup) { handleSetupClick(state, h); return; }
    if (!state.G || state.G.over || !state.act) return;
    const e = [...Q.aliveOfSide(state, 0), ...Q.aliveOfSide(state, 1)]
      .find(x => { const [c, r2] = Q.posOf(state, x); return c === h[0] && r2 === h[1]; });
    if (!e) return;
    if (state.act.u == null) { selectUnit(state, e); return; }
    if (Q.sideOf(state, e) === state.act.side && e !== state.act.u && !Q.isActivated(state, e)) { switchSelection(state, e); return; }
    if (Q.sideOf(state, e) !== state.act.side) { doFireAt(state, e); return; }
  });

  document.getElementById("btnL").onclick = () => doTurn(state, 1);   // +1 dir index = CCW = left on screen
  document.getElementById("btnR").onclick = () => doTurn(state, -1);
  document.getElementById("btnF").onclick = () => doForward(state);
  document.getElementById("btnB").onclick = () => doBackward(state);
  document.getElementById("btnFire").onclick = () => { if (Q.canFire(state)) { state.act.fireMode = true; updatePanels(state); draw(state); } };
  document.getElementById("btnEnd").onclick = () => endActivation(state);
  document.getElementById("btnMenu").onclick = () => toMenu(state);
  document.getElementById("btnRestart").onclick = () => { closeOv(); newBattle(state); };
  document.getElementById("btnStep").onclick = () => { if (state.ctrlMode === 3 && !state.G.over) proceed(state); };
  document.getElementById("btnAuto").onclick = function () {
    if (state.autoTimer) { clearInterval(state.autoTimer); state.autoTimer = null; this.textContent = "Auto ▶"; return; }
    this.textContent = "Auto ⏸";
    state.autoTimer = setInterval(() => { if (state.G.over) { clearInterval(state.autoTimer); state.autoTimer = null; } else proceed(state); }, 220);
  };

  document.addEventListener("keydown", ev => {
    if (state.setup) {
      if (ev.key === "q" || ev.key === "Q") setupTurn(state, 1);
      else if (ev.key === "e" || ev.key === "E") setupTurn(state, -1);
      return;
    }
    if (!state.act || state.act.u == null) return;
    if (ev.key === "q" || ev.key === "Q") doTurn(state, 1);
    else if (ev.key === "e" || ev.key === "E") doTurn(state, -1);
    else if (ev.key === "w" || ev.key === "W") doForward(state);
    else if (ev.key === "s" || ev.key === "S") doBackward(state);
    else if (ev.key === "f" || ev.key === "F") { if (Q.canFire(state)) { state.act.fireMode = true; updatePanels(state); draw(state); } }
    else if (ev.key === " ") { ev.preventDefault(); endActivation(state); }
  });

  document.getElementById("btnSetupL").onclick = () => setupTurn(state, 1);
  document.getElementById("btnSetupR").onclick = () => setupTurn(state, -1);
  document.getElementById("btnSetupFlag").onclick = () => setupToggleFlag(state);
  document.getElementById("btnSetupRemove").onclick = () => setupRemove(state);
  document.getElementById("btnSetupConfirm").onclick = () => confirmSetup(state);

  document.getElementById("ovAgain").onclick = () => { closeOv(); newBattle(state); };
  document.getElementById("ovMenu").onclick = () => toMenu(state);
  document.getElementById("ovCopy").onclick = () => {
    navigator.clipboard && navigator.clipboard.writeText(document.getElementById("ovResult").textContent);
  };
}
