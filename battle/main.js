// Browser composition root: constructs one explicit game context and its
// runtime dependencies, then wires the scenario menu and input handling.
import { SCENARIOS } from "./config.js";
import { GameContext } from "./gameContext.js";
import { EventBus } from "./core/events.js";
import { MathRandomSource } from "./core/random.js";
import { BattleOrchestrator } from "./battleOrchestrator.js";
import { wire } from "./input.js";
import { attachBattlePresenter } from "./presenter.js";
import { draw } from "./render.js";
import { updatePanels } from "./panels.js";
import { ControlMode } from "./domain/constants.js";

const game = new GameContext({ random: new MathRandomSource(), events: new EventBus() });
const presentation = { effects: [] };
const orchestrator = new BattleOrchestrator(game, {
  refresh: () => {
    draw(game, presentation);
    updatePanels(game);
  },
});

function buildMenu(state, battleOrchestrator) {
  const el = document.getElementById("scenlist");
  SCENARIOS.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "scenario";
    b.innerHTML = `<b>${i + 1}. ${s.t}</b><span>${s.n}</span>`;
    b.onclick = () => {
      state.scen = s;
      state.ctrlMode = +document.querySelector('input[name="ctrl"]:checked').value;
      state.SIZE = +document.querySelector('input[name="fsize"]:checked').value;
      state.moveMode = +document.querySelector('input[name="movemode"]:checked').value;
      state.deployMode = +document.querySelector('input[name="deploymode"]:checked').value;
      document.getElementById("menu").style.display = "none";
      document.getElementById("battle").style.display = "block";
      const spect = state.ctrlMode === ControlMode.SPECTATE;
      document.getElementById("btnStep").style.display = spect ? "" : "none";
      document.getElementById("btnAuto").style.display = spect ? "" : "none";
      battleOrchestrator.newBattle();
    };
    el.appendChild(b);
  });
}

attachBattlePresenter(game, presentation);
wire(game, orchestrator);
buildMenu(game, orchestrator);
