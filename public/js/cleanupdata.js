// Bi-weekly machine clean-up checklists, from "Machine Clean Up Bi-Weekly.xlsx".
// Each machine lists its tasks in order (English; Spanish is in TASK_ES). Edit here to change a checklist.
export const CYCLE_DAYS = 14;      // bi-weekly
export const DUE_SOON_DAYS = 3;    // yellow warning window

const T = [
  "SAFETY: Machine off & locked out (LOTO) before cleaning",
  "Blow down machine, trim section, motors, conveyor & photo eyes",
  "Scrape all dry ink inside and out",
  "Wash ink pumps",
  "Wash ink lines",
  "Clean ink pit",
  "Clean print plate cylinder",
  "Clean all anilox rolls",
  "Sweep and mop floor with water",
  "Clean work bench",
  "Check tool inventory",
  "Clean all machine walls",
  "Check, clean or change doctor blades as needed",
  "Clean all side guards (anilox)",
  "Return all ink to rack",
  "Clean impression cylinders",
  "Clean feed section area",
  "Clean ink base pans",
  "Check, clean or change blanket as needed",
  "Clean machine tracks",
  "Clean top and bottom of machine",
  "Clean filters",
  "SAFETY: Guards back on, tools removed, area clear before restart",
  "Put away all unused die boards",
  "Clean floor with water and mop",
  "Clean table",
  "Clean top of machine",
  "Clean under the machine",
  "Remove and clean glue residue",
  "Clean rollers",
  "Sweep area"
];

export const TASK_ES = {
  "SAFETY: Machine off & locked out (LOTO) before cleaning": "SEGURIDAD: Máquina apagada y bloqueada (LOTO) antes de limpiar",
  "Blow down machine, trim section, motors, conveyor & photo eyes": "Sopletear con aire la máquina, sección de recorte, motores, transportador y fotoceldas",
  "Scrape all dry ink inside and out": "Raspar toda la tinta seca por dentro y por fuera",
  "Wash ink pumps": "Lavar las bombas de tinta",
  "Wash ink lines": "Lavar las mangueras de tinta",
  "Clean ink pit": "Limpiar la fosa de tinta",
  "Clean print plate cylinder": "Limpiar el cilindro porta-placas",
  "Clean all anilox rolls": "Limpiar todos los rodillos anilox",
  "Sweep and mop floor with water": "Barrer y trapear el piso con agua",
  "Clean work bench": "Limpiar el banco de trabajo",
  "Check tool inventory": "Revisar el inventario de herramientas",
  "Clean all machine walls": "Limpiar todas las paredes de la máquina",
  "Check, clean or change doctor blades as needed": "Revisar, limpiar o cambiar las cuchillas raspadoras según sea necesario",
  "Clean all side guards (anilox)": "Limpiar todas las guardas laterales (anilox)",
  "Return all ink to rack": "Regresar toda la tinta al estante",
  "Clean impression cylinders": "Limpiar los cilindros de impresión",
  "Clean feed section area": "Limpiar el área de la sección de alimentación",
  "Clean ink base pans": "Limpiar las charolas de tinta",
  "Check, clean or change blanket as needed": "Revisar, limpiar o cambiar la mantilla según sea necesario",
  "Clean machine tracks": "Limpiar los rieles de la máquina",
  "Clean top and bottom of machine": "Limpiar la parte superior e inferior de la máquina",
  "Clean filters": "Limpiar los filtros",
  "SAFETY: Guards back on, tools removed, area clear before restart": "SEGURIDAD: Guardas puestas, herramientas retiradas, área libre antes de arrancar",
  "Put away all unused die boards": "Guardar todos los troqueles que no se usen",
  "Clean floor with water and mop": "Limpiar el piso con agua y trapeador",
  "Clean table": "Limpiar la mesa",
  "Clean top of machine": "Limpiar la parte superior de la máquina",
  "Clean under the machine": "Limpiar debajo de la máquina",
  "Remove and clean glue residue": "Quitar y limpiar los residuos de pegamento",
  "Clean rollers": "Limpiar los rodillos",
  "Sweep area": "Barrer el área",
};

// id = machine # (used in the QR link: #cleanup/<id>)
export const CLEANUP_MACHINES = [
  { id: "126", name: "86\" Rotary", type: "Flexo / Die Cutter", tasks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((i) => T[i]) },
  { id: "132", name: "Shanghai", type: "Flexo / Die Cutter", tasks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((i) => T[i]) },
  { id: "137", name: "Large Matsu", type: "Die Cutter", tasks: [0, 1, 8, 9, 10, 11, 15, 16, 20, 23, 21, 22].map((i) => T[i]) },
  { id: "138", name: "Small Matsu", type: "Die Cutter", tasks: [0, 1, 8, 9, 10, 11, 15, 16, 20, 23, 21, 22].map((i) => T[i]) },
  { id: "144", name: "McKinley", type: "Flexo / Die Cutter", tasks: [0, 1, 2, 3, 4, 5, 6, 7, 24, 25, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((i) => T[i]) },
  { id: "147", name: "EMBA", type: "Flexo / Die Cutter", tasks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 26, 27, 21, 22].map((i) => T[i]) },
  { id: "150", name: "Gluer", type: "Gluer", tasks: [0, 1, 28, 8, 9, 10, 11, 29, 16, 20, 22].map((i) => T[i]) },
  { id: "151", name: "Gluer", type: "Gluer", tasks: [0, 1, 28, 8, 9, 10, 11, 29, 16, 20, 22].map((i) => T[i]) },
  { id: "152", name: "Gluer", type: "Gluer", tasks: [0, 1, 28, 8, 9, 10, 11, 29, 16, 20, 22].map((i) => T[i]) },
  { id: "155", name: "Stitcher", type: "Stitcher", tasks: [0, 1, 28, 8, 9, 10, 11, 29, 16, 20, 22].map((i) => T[i]) },
  { id: "Baler", name: "Baler", type: "Baler", tasks: [0, 1, 30, 10, 11, 20, 22].map((i) => T[i]) },
  { id: "Strapper", name: "Strapper", type: "Strapper", tasks: [0, 1, 28, 8, 10, 11, 29, 20, 22].map((i) => T[i]) },
];

export const isSafetyTask = (t) => /^SAFETY:/.test(t);
export const machineLabel = (m) => (/^\d+$/.test(m.id) ? `${m.id} – ${m.name}` : m.name);

// ---------- status (shared by the Clean-Up board, machine pages and the home page) ----------
export const EARLY_DAYS = 7; // a clean-up done up to a week before a scheduled date counts for that date
const dn = (ymd) => Math.round(new Date(ymd + 'T12:00:00').getTime() / 86400000);
export const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const planFor = (plan, id) => (plan || []).filter((p) => p.machines === 'all' || (Array.isArray(p.machines) && p.machines.includes(id)));

// Next due: the first scheduled date not yet covered by a clean-up; without a schedule, last clean-up + 14 days.
export function machineStatus(m, entries, plan, today = todayYmd()) {
  const mine = (entries || []).filter((e) => e.machine === m.id).sort((a, b) => (b.date + b.savedAt).localeCompare(a.date + a.savedAt));
  // only clean-ups the supervisor signed off count; unsigned ones are listed as pending
  const last = mine.find((e) => e.status === 'Verified') || null;
  const pending = mine.filter((e) => e.status === 'Pending');
  const sched = planFor(plan, m.id);
  let next = null, shift = '', scheduled = false;
  const nextPlan = sched.find((p) => !last || dn(p.date) - EARLY_DAYS > dn(last.date));
  if (nextPlan) { next = nextPlan.date; shift = nextPlan.shift; scheduled = true; }
  else if (last) next = addDays(last.date, CYCLE_DAYS);
  if (!next) return { key: 'none', label: 'Not logged', cls: 'info', last, pending, next: null, shift: '', scheduled: false };
  const left = dn(next) - dn(today);
  const s = left < 0 ? { key: 'over', label: 'Overdue', cls: 'bad' } : left <= DUE_SOON_DAYS ? { key: 'soon', label: 'Due soon', cls: 'warn' } : { key: 'ok', label: last ? 'On track' : 'Scheduled', cls: last ? 'ok' : 'info' };
  return { ...s, last, pending, next, left, shift, scheduled };
}
