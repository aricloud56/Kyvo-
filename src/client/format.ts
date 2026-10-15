// Formatting helpers and shared labels.
import { kgToLb, lbToKg, round } from '../core/util.js';

export type Units = 'metric' | 'imperial';
let units: Units = 'metric';
export const setUnits = (u: Units) => (units = u);
export const getUnits = () => units;

export const wUnit = () => (units === 'imperial' ? 'lb' : 'kg');
/** Display a stored kg value in the user's units. */
export const wOut = (kg: number | null | undefined): string => (kg == null ? '' : String(units === 'imperial' ? round(kgToLb(kg), 1) : round(kg, 2)));
/** Convert a user-entered weight to kg for storage. */
export const wIn = (v: number | null): number | null => (v == null ? null : units === 'imperial' ? round(lbToKg(v), 2) : v);

export const kcal = (n: number) => `${Math.round(n).toLocaleString('en-AU')} kcal`;
export const grams = (n: number) => `${Math.round(n)} g`;

export const GOAL_LABEL: Record<string, string> = { muscle_gain: 'Build muscle', fat_loss: 'Lose fat', strength: 'Get stronger', general: 'General fitness' };
export const SLOT_LABEL: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
export const GROUP_LABEL: Record<string, string> = {
  chest: 'Chest', back: 'Back', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', quadriceps: 'Quadriceps', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves',
  core: 'Core and abs', full_body: 'Full body', cardio: 'Cardio and conditioning', bodyweight: 'Bodyweight', mobility: 'Mobility and warm-ups',
};
export const EQUIPMENT_LABEL: Record<string, string> = {
  barbell: 'Barbell', ez_bar: 'EZ bar', dumbbell: 'Dumbbells', kettlebell: 'Kettlebells', cable: 'Cable machine', machine: 'Weight machines', smith: 'Smith machine', bench: 'Bench',
  rack: 'Squat rack', pullup_bar: 'Pull-up bar', dip_station: 'Dip station', band: 'Resistance bands', bodyweight: 'Bodyweight', plate: 'Weight plates', box: 'Box or step', ball: 'Exercise ball',
  ab_wheel: 'Ab wheel', landmine: 'Landmine', sled: 'Sled', rope: 'Battle ropes', treadmill: 'Treadmill', bike: 'Exercise bike', rower: 'Rowing machine', elliptical: 'Cross-trainer',
  stair_climber: 'Stair climber', jump_rope: 'Skipping rope', mat: 'Mat', wall: 'Wall', ghd: 'GHD',
};
export const groupsText = (g: string[]) => g.filter((x) => GROUP_LABEL[x] && !['bodyweight', 'full_body'].includes(x)).map((x) => GROUP_LABEL[x]).join(', ');

export function longDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}
export function shortDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}
export function prescriptionText(x: { sets: number; repMin: number; repMax: number; mode: string }): string {
  if (x.mode === 'time') return `${x.sets} × ${x.repMin}–${x.repMax} s`;
  if (x.mode === 'distance_time') return x.sets === 1 ? `${x.repMin}–${x.repMax} min` : `${x.sets} × ${x.repMin}–${x.repMax} s`;
  return `${x.sets} × ${x.repMin}–${x.repMax}`;
}
export const restText = (s: number) => (s >= 120 ? `${round(s / 60, 1)} min rest` : s ? `${s} s rest` : 'no rest');
