// Thin DOM adapter. It translates browser events into controller commands and
// contains no battle rules.
import { pixelToHex } from "./render.js";
import { BattleCommand, BattleController } from "./controller.js";

const cv = document.getElementById("cv");

function closeOv() { document.getElementById("overlay").style.display = "none"; }
export function wire(state, orchestrator) {
  const controller = new BattleController(state, orchestrator);
  let autoTimer = null;
  const stopAuto = () => {
    if (!autoTimer) return;
    clearInterval(autoTimer);
    autoTimer = null;
    document.getElementById("btnAuto").textContent = "Auto ▶";
  };
  const toMenu = () => {
    closeOv();
    stopAuto();
    orchestrator.enterMenu();
    document.getElementById("battle").style.display = "none";
    document.getElementById("menu").style.display = "block";
  };
  cv.addEventListener("click", ev => {
    const r = cv.getBoundingClientRect();
    const h = pixelToHex(ev.clientX - r.left, ev.clientY - r.top);
    if (h) controller.selectHex(h);
  });

  document.getElementById("btnL").onclick = () => controller.execute(BattleCommand.TURN_LEFT);
  document.getElementById("btnR").onclick = () => controller.execute(BattleCommand.TURN_RIGHT);
  document.getElementById("btnF").onclick = () => controller.execute(BattleCommand.MOVE_FORWARD);
  document.getElementById("btnB").onclick = () => controller.execute(BattleCommand.MOVE_BACKWARD);
  document.getElementById("btnFire").onclick = () => controller.execute(BattleCommand.ENTER_FIRE_MODE);
  document.getElementById("btnEnd").onclick = () => controller.execute(BattleCommand.END_ACTIVATION);
  document.getElementById("btnMenu").onclick = toMenu;
  document.getElementById("btnRestart").onclick = () => { closeOv(); controller.execute(BattleCommand.RESTART); };
  document.getElementById("btnStep").onclick = () => controller.execute(BattleCommand.STEP_AI);
  document.getElementById("btnAuto").onclick = function () {
    if (autoTimer) { stopAuto(); return; }
    this.textContent = "Auto ⏸";
    autoTimer = setInterval(() => {
      if (state.G.over) stopAuto();
      else controller.execute(BattleCommand.STEP_AI);
    }, 220);
  };

  document.addEventListener("keydown", ev => {
    if (!state.setup && (!state.act || state.act.u == null)) return;
    if (ev.key === "q" || ev.key === "Q") controller.execute(BattleCommand.TURN_LEFT);
    else if (ev.key === "e" || ev.key === "E") controller.execute(BattleCommand.TURN_RIGHT);
    else if (ev.key === "w" || ev.key === "W") controller.execute(BattleCommand.MOVE_FORWARD);
    else if (ev.key === "s" || ev.key === "S") controller.execute(BattleCommand.MOVE_BACKWARD);
    else if (ev.key === "f" || ev.key === "F") controller.execute(BattleCommand.ENTER_FIRE_MODE);
    else if (ev.key === " ") { ev.preventDefault(); controller.execute(BattleCommand.END_ACTIVATION); }
  });

  document.getElementById("btnSetupL").onclick = () => controller.execute(BattleCommand.TURN_LEFT);
  document.getElementById("btnSetupR").onclick = () => controller.execute(BattleCommand.TURN_RIGHT);
  document.getElementById("btnSetupFlag").onclick = () => controller.execute(BattleCommand.SET_FLAGSHIP);
  document.getElementById("btnSetupRemove").onclick = () => controller.execute(BattleCommand.REMOVE_DEPLOYED_UNIT);
  document.getElementById("btnSetupConfirm").onclick = () => controller.execute(BattleCommand.CONFIRM_DEPLOYMENT);

  document.getElementById("ovAgain").onclick = () => { closeOv(); controller.execute(BattleCommand.RESTART); };
  document.getElementById("ovMenu").onclick = toMenu;
  document.getElementById("ovCopy").onclick = () => {
    navigator.clipboard && navigator.clipboard.writeText(document.getElementById("ovResult").textContent);
  };
}
