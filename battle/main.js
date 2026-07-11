// Module entry point: builds the scenario menu, wires up input handling,
// and bootstraps the one shared State singleton.
import { SCENARIOS } from "./config.js";
import { State } from "./state.js";
import { newBattle } from "./turnEngine.js";
import { wire } from "./input.js";

function buildMenu(state) {
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
      const spect = state.ctrlMode === 3;
      document.getElementById("btnStep").style.display = spect ? "" : "none";
      document.getElementById("btnAuto").style.display = spect ? "" : "none";
      newBattle(state);
    };
    el.appendChild(b);
  });
}

wire(State);
buildMenu(State);
