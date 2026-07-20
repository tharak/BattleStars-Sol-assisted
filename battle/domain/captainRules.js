import { SeededRandomSource } from "../core/random.js";

export const CAPTAIN_ABILITIES = Object.freeze([
  ["full_throttle", "Full Throttle", "+1 movement point"],
  ["master_helmsman", "Master Helmsman", "+1 steering turn"],
  ["retro_thrusters", "Retro Thrusters", "Astern costs 2 AP"],
  ["gravity_navigator", "Gravity Navigator", "−1 gravity movement cost"],
  ["course_plotter", "Course Plotter", "+1 plotted-course AP"],
  ["front_gunnery", "Front Gunnery", "+1 front-arc attack die"],
  ["flank_gunnery", "Flank Gunnery", "+1 flank-arc attack die"],
  ["rear_gunnery", "Rear Gunnery", "+1 rear-arc attack die"],
  ["supply_officer", "Supply Officer", "Ignore critical-supply fire penalty"],
  ["steadfast", "Steadfast", "+1 morale checks"],
  ["rallying_voice", "Rallying Voice", "+1 rally checks"],
  ["command_expert", "Command Expert", "+1 command radius"],
  ["formation_leader", "Formation Leader", "Command-group moves cost 1 less AP"],
  ["collision_commander", "Collision Commander", "+1 collision strength"],
  ["dockmaster", "Dockmaster", "May merge an adjacent friendly Fleet"],
  ["taskforce_architect", "Taskforce Architect", "Split detaches one extra Ship"],
  ["conquest_leader", "Conquest Leader", "Conquest commits one fewer Ship"],
  ["production_liaison", "Production Liaison", "+1 Ship produced at an adjacent planet"],
].map(([id, name, description]) => Object.freeze({ id, name, description })));

export const captainAbility = id => CAPTAIN_ABILITIES.find(ability => ability.id === id) || null;

function factionSeed(seed, faction) {
  let value = Number(seed) >>> 0;
  for (const character of String(faction)) value = Math.imul(value ^ character.charCodeAt(0), 0x45d9f3b);
  return value >>> 0;
}

export function draftCaptains(faction, seed, count = 3) {
  const random = new SeededRandomSource(factionSeed(seed, faction));
  const available = [...CAPTAIN_ABILITIES];
  return Array.from({ length: Math.min(count, available.length) }, (_, index) => {
    const chosen = available.splice(random.integer(0, available.length - 1), 1)[0];
    return Object.freeze({
      id: `${faction}-${index + 1}-${chosen.id}`,
      faction,
      slot: index,
      name: `${faction[0].toUpperCase()}${faction.slice(1)} Captain ${index + 1}`,
      abilityId: chosen.id,
    });
  });
}

export function captainHas(captain, abilityId) {
  return captain?.abilityId === abilityId;
}
