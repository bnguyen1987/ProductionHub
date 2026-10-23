# Plan: 3D Plant Floor tab

A new **Floor** tab in the Production Hub. It shows the Ontario plant floor in 3D, built from the Plant Floor Layout drawing. Every machine can be clicked to see its specs.

## 1. Goal

- See the whole plant at a glance, in a live 3D view that matches the layout drawing.
- Click any machine to see its specs, with no need to switch tabs.
- Keep it simple. It's one tab, works on phone and desktop, and needs no install.

## 2. Layout (from the drawing)

The drawing is scaled into the 3D world. One unit is about 0.7 m, and the building is about 104 × 62 units. Positions are measured from the drawing, so the machines sit where they are on the floor.

| Area | What gets built |
|---|---|
| North wall | Dock doors 1–12, two exits, ramp, cutting die rack along the wall |
| North-east | Lunch area, Maintenance room, Offices |
| East side | Design room, Die cutting materials |
| Floor | 20 building columns, fire extinguishers (red), exit arrows (yellow) |
| Racks | Printing plate racks (2 by the EMBA, 1 between the Jumbo and the Shanghai) |

**Machines (all clickable):**

| # | Machine | Where on the drawing |
|---|---|---|
| 147 | 42" EMBA FFG | Center top, curved conveyor on the west end |
| 144 | 66" McKinley FFG | Center, below the EMBA |
| 138 | Small Marumatsu FBDC | Between the EMBA and the McKinley |
| 126 | 86" Jumbo Press | Center, below the McKinley |
| 132 | 66" Shanghai RDC Slotter | Center bottom |
| 149 | Shanghai Juer Mini FFG | South-west |
| 137 | Large Marumatsu FBDC | South-east |
| 130 | Isowa Rotary Die Cut | South-east corner |
| 110 | Slitter | East |
| 112 | Band saw | South, near the Large Matsu |
| 113 | Eccentric | South, near the Shanghai |
| 150, 151, 152 | Gluers | South-west area |
| 155 | Stitcher | West wall |
| – | Strapper | Long conveyor line, west of the EMBA and McKinley |
| – | Baler | Next to the Small Matsu |

## 3. Look

- **Models:** low-poly, with soft rounded edges (rounded boxes and cylinders). Each machine type has its own shape: feeder, print units, conveyors, folder section and stacker.
- **Colors:** the drawing's palette. White and light gray floor and walls, dark linework gray for rollers and frames, plan blue for machine bodies and labels, red for extinguishers and safety parts, and amber/yellow for forklifts and exit arrows.
- **Light:** soft sky light plus one sun with soft shadows.
- **Labels:** each machine has a floating blue name tag, like the drawing.

## 4. Camera and controls

- Isometric-style view (orthographic camera, looking down at an angle).
- Opens with the whole building in view.
- Drag to rotate, scroll or pinch to zoom, and a **Reset view** button.

## 5. Animation (nothing sits still)

- **Machines:**
  - Rollers turn and sheets travel along the feed and delivery conveyors.
  - Print cylinders spin.
  - The die cutter platens go up and down.
  - The slitter and band saw blades spin, and the baler ram moves.
  - Status lights pulse.
- **People:** workers walk the aisles with swinging arms and legs, and operators stand at their machines.
- **Forklifts:** drive set routes between the dock doors, racks and machines. The forks lift and lower at stops.
- **Everything else:** dock door lights blink, and the exit arrows pulse.

## 6. Clicking a machine

- **Hover:** the cursor changes to a pointer and the machine lightens a little.
- **Click:** the machine glows, and a frosted-glass card opens next to it. The card follows the machine as the view turns.
- **Card contents:** machine number and name, the spec lines (sheet sizes, colors, die cut, rule, crew, speed, setup, minimum order), notes, any lines added on the Specs tab, and an **Open in Specs** link.
- **Closing:** clicking empty space closes the card. Clicking another machine switches to it.

## 7. Specs source

- One list for both tabs. The Floor tab reads the same machine list as the Specs tab.
- Lines added on the Specs tab (e.g. gluer specs) show on the Floor card too.
- Machines on the drawing but not in the order check are added to the Specs list:
  - Isowa 130 and Mini 149, using the earlier spec sheet data, marked "not used by the order check".
  - Band saw, Eccentric, Strapper and Baler, with no specs on file yet. They can be filled in on the Specs tab.

## 8. Build steps

1. Add the missing machines to the Specs list.
2. Build the scene: floor, walls, columns, rooms, racks, doors, extinguishers, arrows.
3. Build the machine models and their labels.
4. Add the camera, controls, lights and shadows.
5. Add the animation: machines, people, forklifts.
6. Add hover, click glow and the stats card.
7. Add Spanish wording.
8. Test on desktop and phone: frame rate, clicks, nothing broken on the other tabs. Then push.

## 9. Assumptions

- Positions are measured by eye from the drawing, so they're close, not surveyed.
- Forklift and walking routes are made up to look natural. They are not real traffic rules.
- The Floor tab is a picture of the plant. It does not show live machine status. That could be a later step, e.g. from the shift handoff.

## 10. Changes (Oct 22)

- Machine name tags removed from the 3D view. Room labels, door numbers and EXIT signs stay.
- The 86" Jumbo, the 66" Shanghai and the gluers now run right to left: they feed on the east side and deliver on the west.
- The office corner is rebuilt to match the drawing:
  - L-shaped offices, with the curved-wall front room and its conference table
  - restrooms off the hallway
  - the **lunch room** (with the first-aid station) between the offices and Design
- Truck yard on the north side:
  - three dropped trailers stay at doors 12, 11 and 2
  - two semi-trucks take turns at the free doors: they pull in, back up to a door, wait while loading, pull out and leave
- The opening view frames the building plus the yard. Phones frame just the building, and you can zoom out to see the trucks.
