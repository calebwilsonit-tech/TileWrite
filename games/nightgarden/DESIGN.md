# Nightgarden: design and theme

**Read this before drawing a picture or making or changing a screen.** Everything visual in the game is decided
here once, so pictures and screens made weeks apart still look like one game. If something here is wrong, change this
file first, then the art or the screen. The checks (`check/theme.test.ts`) hold screens and pictures to the numbers
in this file.

## 1. What the game is

A quiet puzzle game about a night gardener. Each room is a small walled garden in the dark. Lamps make light;
moonblooms rise where it is lit and sink where it is dark, duskcaps do the opposite. A risen bloom is a wall, a lift
and a shadow. The gardener lights lamps, pushes crates and braziers, and finds the way out.

Pillars, in order. When two disagree, the earlier one wins.

1. **Readable.** A player must be able to tell from one look what is lit, what is solid and what will change.
2. **Calm.** No timers, no enemies, nothing that punishes waiting. Restart is one key and costs nothing.
3. **Warm light in cool dark.** The dark is blue and still; light is amber and alive. Colour means something.
4. **Small.** One screen per room, a handful of verbs, short words.

Verbs: walk one cell (four ways), turn on the spot, light or douse a lamp, push. Nothing else.

## 2. Rules the pictures must make obvious

| Thing | Rule | How the picture says it |
| --- | --- | --- |
| Hand lamp | E beside it lights or douses it | warm amber and gold when lit, grey iron when dark; a gold mark hovers over the one E would use |
| Wired lamp | follows a plate or moonstone | teal and aqua, never amber, so it is never mistaken for one you can light |
| Glow lamp | always lit | pale moon-white |
| Moonbloom | up while lit | blue-white flower; four stages, a skirt of leaves fills the bed when grown |
| Duskcap | up while dark | violet mushroom; four stages |
| Crate | pushed one cell | plain wood |
| Brazier | a light you push | fire on stone and iron |
| Screen | a tall crate that casts a shadow | trellis two levels tall |
| Plate | on while something stands on it | pale when up, amber centre when down |
| Moonstone / shadestone | on while lit / while dark | blue gem / violet gem, grey when off |
| Gate | open while its channel says so | iron bars between two stone posts; bars sink into the sill |
| Way out | ends the room | green ring on the ground, pulsing |
| Firefly | optional catch | small gold glow that hovers |

Colour carries the rule: **amber/gold = light you control, teal/aqua = wired, blue-white = moonbloom,
violet = duskcap and dark-loving things, green = the way out.** Never reuse one of these for decoration.

## 3. Palette

Thirty-five inks, defined once in `art/draw.ts` (`INK`). Pictures use these and nothing else.

| Group | Inks |
| --- | --- |
| Dark and stone | ink `#141826`, night `#1f2540`, slate `#343b5c`, stone `#5b6384`, pale `#8f96b3`, moon `#e6ecff` |
| Leaf | pine `#1e4d3a`, moss `#2f7a50`, leaf `#55a868`, lime `#9bd67a` |
| Earth and wood | loam `#3a2a25`, soil `#5c4336`, wood `#8a5a3c`, oak `#b9834f` |
| Light | amber `#f2a93b`, gold `#ffd76a`, glow `#fff3c4`, ember `#e2603a` |
| Wired | teal `#2d8f8f`, aqua `#5fd0c5` |
| Moonbloom | sky `#8fb8ff`, petal `#c8dcff` |
| Duskcap | plum `#4a3a7a`, violet `#7a5fc0`, lilac `#b79cf0`, pink `#f08fb8` |
| Gardener | skin `#f1c9a5`, tan `#c9946f`, red `#c44d4d`, blue `#3e5fa8` |
| Iron | iron `#6f7a8c`, steel `#454d5e` |
| Water | deep `#23507a`, water `#3a7fb5`, foam `#7fc4e8` |

Rooms are drawn under a darkness of 0.7, so unlit art is seen at about a third of its brightness. Base colours are
therefore kept a step brighter than they should look in the dark.

## 4. Drawing rules

- **Grid.** A cell is 64 x 32 pixels, a level is 16. Floors are at level 2, sunken beds at 0, terraces at 4.
- **Light comes from the top left.** Top faces lightest, left faces mid, right faces darkest. Highlights sit top-left.
- **No black outlines.** Shapes are separated by value. `ink` is for the deepest shadow and for eyes only.
- **Pixels are whole.** No anti-aliasing, no gradients, no dithering beyond a sparse speckle.
- **Footprints.** Anything that fills a cell stands on a 28-pixel-tall diamond (0.9 of a cell). Flat things
  (plates, stones, the way out) are diamonds 22 to 28 pixels tall, centred on the feet point.
- **Heights.** One level of height is 16 pixels of picture. A grown bloom, a gate and a screen are 32.
- **Feet point.** Where the thing meets the middle of its cell. Every picture sets one.
- **States are separate pictures** named `<thing>_<state>` (`lamp_on`, `gate_half`, `moonbloom_2`), swapped by the
  game. Animations are frames of one picture (`gardener`, `exit`, `firefly`).
- **Ground tiles** show the cell: a darker joint on the two far edges of every top face, so the grid can be counted.
- **Made in the studio.** Every picture is a list of strokes in `art/` that `npm run art` draws in the editor's
  Sprite studio and Tile studio with the mouse. Nothing is imported.

Sizes: gardener 26 x 36; lamps 24 x 48; blooms 64 x 64; crate 64 x 56; brazier 64 x 52; screen 64 x 72;
gate 64 x 76; flat things 64 x 32; firefly 16 x 16; interface icons 16 x 16 or 24 x 24; the title mark 160 x 64.

## 5. The interface

### Theme (`assets/ui.json`)

| Token | Value | Used for |
| --- | --- | --- |
| panel | `#141826` (ink) | every box |
| border | `#343b5c` (slate) | box edges, dividers |
| text | `#e6ecff` (moon) | all words |
| accent | `#ffd76a` (gold) | headings, the chosen row, numbers that matter |
| highlight | `#f2a93b` (amber) | focus and hover |
| font | `rounded` | everything |
| radius | 10 | boxes; rows and buttons 8; chips 6 |
| scale | 1 | |

Secondary colours, used as plain values where the theme has no token: dim text `#8f96b3` (pale), done green
`#55a868` (leaf), firefly `#ffd76a` (gold), locked `#5b6384` (stone).

### Type

Five sizes and no others: **40** the title of the game, **26** screen headings, **18** rows and buttons,
**15** body and the heads-up display, **12** hints. Headings are gold; nothing is bold except numbers in the
heads-up display. Sentences, not capitals: "New game", "Restart room".

### Spacing

Multiples of 4. Box padding 20, gap between rows 4, row padding 8, gap between groups 12. Menus are 480 wide
(wide ones 880) and centred. The heads-up display keeps 16 from every edge.

### Pieces (made once in `src/ui/kit.ts`, used everywhere)

- **Box**: fill panel at 0.94, border slate 2, radius 10.
- **Row** (a menu line): 18 px text, radius 8; hover and focus fill with amber at 22% and take an amber edge;
  disabled at 0.4.
- **Heading**: 26 px gold, with a 12 px pale line under it when the screen has a subtitle.
- **Hint line**: 12 px pale, last line of every menu, says the keys.
- **Chip** (heads-up display): panel at 0.8, radius 6, padding 6 x 10, an icon and 15 px text.
- **Card** (room select): 96 x 72, number in gold, a leaf tick when done, a gold dot when the firefly is caught,
  stone-grey and unusable when locked.

Every menu has: one heading, rows, one hint line. Back (Esc) always leaves it. The first row is chosen when it
opens. Nothing moves except a 150 ms fade when a screen opens.

### Screens and how they lead to each other

```
Title ──New game / Continue──▶ (the room) ◀──Resume── Pause
  │                               │  ▲                 │
  ├─ Rooms ─────choose a room─────┘  └── Esc / P ──────┤
  ├─ How to play                                       ├─ Restart room
  ├─ Settings ── Controls                              ├─ Rooms
  └─ Quit                                              ├─ How to play
                                                       ├─ Settings ── Controls
(the last room) ──▶ The end ──▶ Title                  └─ Title
```

- **Heads-up display**: top left, chapter and room ("The Potting Shed · 3 Two beds"); top right, fireflies and
  rooms tended; bottom middle, the room's one-line hint, then the keys.
- **Chapter card**: shown when a chapter is first entered; its name and one line; any key goes on.
- **The end**: rooms tended, fireflies caught, thanks.

### Words

Plain and short, second person, present tense. A hint says what to notice, never what to do
("Blooms rise in light." not "Light the left lamp."). No exclamation marks.

## 6. Sound

Soft and few: lamp on, lamp off, bloom up, bloom down, crate push, gate, firefly, room done, a bump. Names in
`assets/audio` match the names the scripts play. Until sounds are added the game is silent, never broken.

## 7. What is checked

`npm run check:nightgarden` before every commit, and the end-to-end run after every change:

1. every room parses, is solved by the rules, and both solutions are played button by button in the real game;
2. the project loads with no problems and the editor's whole-project check is clear;
3. every picture exists, has a feet point, and uses only the inks above;
4. every screen uses only the theme's colours, the five type sizes and spacing in fours; every button leads
   somewhere; every screen can be left; the flow above is walked with a player's buttons;
5. the editor opens the game, plays it, and every screen is compared with its golden picture.
