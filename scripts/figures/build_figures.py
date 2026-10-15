#!/usr/bin/env python3
"""Builds public/data/figures.json: one animated movement illustration (START and END pose) per KYVO exercise.

Sources:
- pose-library.json: 136 poses drawn for the Rep & Plate / IRONFORM prototypes (made for this project, no credit needed).
- AUTHORED below: poses for exercises the library does not cover, built from joint angles so limb lengths stay exact.
- MAP below: KYVO exercises that use a library pose of the same movement (a close stand-in is marked approx).

Angles are in degrees: 0 points straight down, 90 forwards (+x, the way the figure faces), 180 straight up, -90 backwards.
Run: python3 scripts/figures/build_figures.py
"""
import json, math, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = json.load(open(os.path.join(ROOT, 'scripts/figures/pose-library.json')))
EX = json.load(open(os.path.join(ROOT, 'data/exercises.json')))

TORSO, UARM, FARM, THIGH, SHIN, NECK = 54, 26, 28, 42, 42, 16


def d(a, length):
    r = math.radians(a)
    return (math.sin(r) * length, math.cos(r) * length)


def add(p, v):
    return [p[0] + v[0], p[1] + v[1]]


def pose(T, U, F, H, S, H2=None, S2=None, toe=None, toe2=None, anchor=('a', (100, 184)), N=None):
    """Side-view pose from joint angles. anchor = (joint, (x, y)) fixes one joint in place."""
    p = [0.0, 0.0]
    s = add(p, d(T, TORSO))
    h = add(s, d(T if N is None else N, NECK))
    e = add(s, d(U, UARM))
    w = add(e, d(F, FARM))
    k = add(p, d(H, THIGH))
    a = add(k, d(S, SHIN))
    j = {'h': h, 's': s, 'e': e, 'w': w, 'p': p, 'k': k, 'a': a}
    if toe is not None:
        j['t'] = add(a, d(toe, 12))
    if H2 is not None:
        j['k2'] = add(p, d(H2, THIGH))
        j['a2'] = add(j['k2'], d(S2, SHIN))
    name, at = anchor
    dx, dy = at[0] - j[name][0], at[1] - j[name][1]
    return {k2: [round(v[0] + dx, 1), round(v[1] + dy, 1)] for k2, v in j.items()}


def fig(start, end, equip=(), scene=()):
    return {'poses': [start, end], 'equip': list(equip), 'scene': list(scene)}


BENCH = {'r': [30, 140, 110, 8]}
MAT = {'r': [10, 184, 180, 3]}
WALL = {'l': [178, -10, 178, 185]}


def walk(arm=True, kind='walk', equip=(), scene=()):
    if kind == 'run':
        A = pose(172, -50, 60, 40, -60, H2=-30, S2=-70, anchor=('a2', (88, 184)))
        B = pose(172, 45, 120, -25, -60, H2=45, S2=-20, anchor=('a', (90, 184)))
        A = {k: [v[0], v[1] - 6] for k, v in A.items()}
    elif kind == 'march':
        A = pose(180, -15, 10, 0, 0, H2=0, S2=0)
        B = pose(180, 20, 110, 90, 0, H2=0, S2=0, anchor=('a2', (100, 184)))
    else:
        A = pose(178, -20, -5 if arm else 0, 22, 5, H2=-18, S2=-10, anchor=('a', (114, 184)))
        B = pose(178, 18, 25 if arm else 0, -18, -10, H2=22, S2=5, anchor=('a2', (114, 184)))
    return fig(A, B, equip, scene)


AUTHORED = {
    'plank': fig(pose(97, 0, 90, -95, -95, anchor=('w', (196, 176))), pose(95, 0, 90, -97, -95, anchor=('w', (196, 176))), scene=[MAT]),
    'dead-bug': fig(pose(90, 180, 180, 180, -90, H2=178, S2=-88, anchor=('s', (130, 176))),
                    pose(90, 105, 100, -100, -98, H2=178, S2=-88, anchor=('s', (130, 176))), scene=[MAT]),
    'bird-dog': fig(pose(90, 0, 0, 0, -90, H2=0, S2=-90, anchor=('w', (150, 182))),
                    pose(90, 0, 0, -92, -90, H2=0, S2=-90, anchor=('w', (150, 182))), scene=[MAT]),
    'mountain-climber': fig(pose(105, 0, 0, 35, -40, H2=-100, S2=-100, anchor=('w', (150, 182))),
                            pose(105, 0, 0, -100, -100, H2=35, S2=-40, anchor=('w', (150, 182)))),
    'hollow-body-hold': fig(pose(98, 150, 150, -98, -98, anchor=('p', (100, 176))), pose(104, 130, 130, -104, -104, anchor=('p', (100, 176))), scene=[MAT]),
    'v-up': fig(pose(90, 150, 150, -90, -90, anchor=('p', (96, 176))), pose(135, -150, -150, -135, -135, anchor=('p', (96, 176))), scene=[MAT]),
    'kneeling-rope-crunch': fig(pose(180, 155, -150, 0, -90, anchor=('k', (80, 176))), pose(75, 60, -110, 0, -90, anchor=('k', (80, 176))),
                                equip=[{'t': 'bar', 'at': 'w'}, {'t': 'cable', 'at': 'w', 'to': [150, -20]}], scene=[MAT]),
    'cable-crunch': fig(pose(178, 155, -150, 5, -5, anchor=('a', (80, 184))), pose(95, 60, -110, 15, -10, anchor=('a', (80, 184))),
                        equip=[{'t': 'bar', 'at': 'w'}, {'t': 'cable', 'at': 'w', 'to': [150, -20]}]),
    'pallof-press': fig(pose(180, 5, 150, 10, -8, H2=-10, S2=8), pose(180, 90, 90, 10, -8, H2=-10, S2=8),
                        equip=[{'t': 'bar', 'at': 'w'}, {'t': 'cable', 'at': 'w', 'to': [4, 60]}]),
    'cable-woodchopper': fig(pose(178, 175, 175, 8, -5, H2=-8, S2=5), pose(165, 40, 40, 20, -15, H2=-8, S2=5),
                             equip=[{'t': 'bar', 'at': 'w'}, {'t': 'cable', 'at': 'w', 'to': [40, -24]}]),
    'russian-twist': fig(pose(-160, 50, 100, 70, 0, anchor=('p', (80, 172))), pose(-160, 120, 110, 70, 0, anchor=('p', (80, 172))),
                         equip=[{'t': 'plate', 'at': 'w', 'r': 11}], scene=[MAT]),
    'suitcase-carry': walk(equip=[{'t': 'db', 'at': 'w'}]),
    'farmers-carry': walk(equip=[{'t': 'db', 'at': 'w'}]),
    'treadmill-walk': walk(scene=[{'r': [30, 184, 150, 4]}, {'l': [176, 70, 176, 185]}, {'l': [150, 70, 176, 70]}]),
    'incline-treadmill-walk': walk(scene=[{'r': [30, 184, 150, 4]}, {'l': [176, 70, 176, 185]}, {'l': [150, 70, 176, 70]}]),
    'jogging': walk(kind='run'),
    'running-intervals': walk(kind='run'),
    'low-impact-intervals': walk(kind='march'),
    'elliptical': fig(pose(178, 50, 140, 20, -15, H2=-15, S2=-5, anchor=('a', (118, 170))), pose(178, 25, 115, -12, -8, H2=22, S2=-12, anchor=('a2', (118, 170))),
                      scene=[{'l': [60, 178, 150, 160]}, {'l': [150, 40, 160, 185]}]),
    'stair-climber': fig(pose(178, -10, 5, 60, -10, H2=0, S2=0, anchor=('a2', (100, 184))), pose(178, 15, 25, 0, 0, H2=-30, S2=-30, anchor=('a', (130, 160))),
                         scene=[{'r': [90, 184, 70, 4]}, {'r': [120, 160, 70, 26]}, {'r': [150, 136, 50, 50]}]),
    'skipping-rope': fig(pose(180, 10, 60, 2, -2, H2=-2, S2=2, toe=95, anchor=('a', (100, 184))), pose(180, 15, 70, 6, -6, H2=0, S2=0, toe=120, anchor=('a', (100, 172))),
                         equip=[{'t': 'bar', 'at': 'w'}]),
    'sled-push': fig(pose(130, 95, 90, 60, -40, H2=-40, S2=-50, anchor=('a2', (60, 184))), pose(130, 95, 90, -30, -50, H2=60, S2=-40, anchor=('a', (60, 184))),
                     scene=[{'r': [160, 150, 34, 34]}, {'l': [170, 60, 170, 150]}]),
    'battle-ropes': fig(pose(165, 60, 120, 35, -30, H2=40, S2=-25), pose(165, 30, 60, 35, -30, H2=40, S2=-25),
                        equip=[{'t': 'cable', 'at': 'w', 'to': [200, 184]}]),
    'stationary-cycling': None,  # filled in below (needs pedal IK)
    'outdoor-cycling': None,
    'rowing-machine': None,
    'cat-cow': fig(pose(92, 0, 0, 0, -90, N=60, anchor=('w', (150, 182))), pose(98, 0, 0, 0, -90, N=130, anchor=('w', (150, 182))), scene=[MAT]),
    'thoracic-rotation': fig(pose(90, 0, 0, 0, -90, anchor=('k', (90, 182))), pose(90, 178, 178, 0, -90, anchor=('k', (90, 182))), scene=[MAT]),
    'hip-flexor-mobility': fig(pose(180, 10, 10, 90, 0, H2=-15, S2=-90, anchor=('a', (140, 184))), pose(175, 170, 175, 80, -10, H2=-40, S2=-90, anchor=('a', (140, 184))), scene=[MAT]),
    'ankle-mobility-drill': fig(pose(180, 80, 90, 90, 0, H2=-15, S2=-90, anchor=('a', (130, 184))), pose(180, 80, 90, 80, 25, H2=-25, S2=-90, anchor=('a', (130, 184))), scene=[WALL]),
    'worlds-greatest-stretch': fig(pose(120, 0, 0, 90, 0, H2=-60, S2=-80, anchor=('a', (140, 184))), pose(120, 175, 175, 90, 0, H2=-60, S2=-80, anchor=('a', (140, 184))), scene=[MAT]),
    'dynamic-hamstring-mobility': fig(pose(180, 90, 90, -30, -30, H2=0, S2=0, anchor=('a2', (100, 184))), pose(180, 90, 90, 75, 75, H2=0, S2=0, anchor=('a2', (100, 184))), scene=[{'l': [158, 60, 158, 185]}]),
    'wall-sit': fig(pose(180, 0, 0, 90, 0, anchor=('p', (44, 142))), pose(180, 90, 90, 90, 0, anchor=('p', (44, 142))), scene=[{'l': [32, -10, 32, 185]}]),
    'step-up': fig(pose(178, 0, 0, 60, 0, H2=0, S2=0, anchor=('a2', (90, 184))), pose(180, 0, 0, 0, 0, H2=-60, S2=-10, anchor=('a', (126, 150))),
                   equip=[{'t': 'db', 'at': 'w'}], scene=[{'r': [104, 150, 70, 36]}]),
    'leg-extension': fig(pose(178, 10, 60, 90, 5, anchor=('p', (80, 132))), pose(178, 10, 60, 90, 88, anchor=('p', (80, 132))),
                         equip=[{'t': 'plate', 'at': 'a', 'r': 6}], scene=[{'r': [60, 138, 70, 8]}, {'l': [58, 70, 62, 140]}]),
    'lying-leg-curl': fig(pose(90, 0, 60, -90, -90, anchor=('p', (100, 132))), pose(90, 0, 60, -90, 165, anchor=('p', (100, 132))),
                          equip=[{'t': 'plate', 'at': 'a', 'r': 6}], scene=[{'r': [30, 140, 140, 8]}]),
    'nordic-hamstring-curl': fig(pose(180, 10, 10, 0, -90, anchor=('k', (80, 176))), pose(110, 20, 60, 70, -90, anchor=('k', (80, 176))), scene=[MAT, {'r': [30, 172, 14, 12]}]),
    'kettlebell-swing': fig(pose(115, -15, -15, 25, -10, anchor=('a', (95, 184))), pose(180, 90, 90, 0, 0, anchor=('a', (100, 184))),
                            equip=[{'t': 'plate', 'at': 'w', 'r': 9}]),
    'reverse-hyperextension': fig(pose(90, 0, 0, 0, 0, anchor=('p', (70, 130))), pose(90, 0, 0, -90, -90, anchor=('p', (70, 130))),
                                  scene=[{'r': [66, 132, 110, 10]}, {'l': [150, 140, 150, 185]}]),
    'incline-push-up': fig(pose(112, 0, 0, -68, -68, anchor=('w', (150, 140))), pose(126, -50, 30, -56, -56, anchor=('w', (150, 140))), scene=[{'r': [130, 142, 60, 8]}, {'l': [160, 146, 160, 185]}]),
    'chest-supported-row': fig(pose(130, 0, 0, 0, -15, anchor=('a', (60, 184))), pose(130, -75, 0, 0, -15, anchor=('a', (60, 184))),
                               equip=[{'t': 'db', 'at': 'w'}], scene=[{'l': [60, 120, 140, 72]}, {'l': [100, 100, 100, 185]}]),
    'seal-row': fig(pose(90, 0, 0, -90, -90, anchor=('p', (70, 112))), pose(90, -70, 0, -90, -90, anchor=('p', (70, 112))),
                    equip=[{'t': 'plate', 'at': 'w'}], scene=[{'r': [30, 120, 150, 8]}, {'l': [60, 124, 60, 185]}, {'l': [160, 124, 160, 185]}]),
    'dumbbell-single-arm-row': fig(pose(95, 0, 0, -5, 0, H2=0, S2=-90, anchor=('a', (95, 184))), pose(95, -70, 0, -5, 0, H2=0, S2=-90, anchor=('a', (95, 184))),
                                   equip=[{'t': 'db', 'at': 'w'}], scene=[{'r': [20, 146, 80, 8]}]),
    'face-pull': fig(pose(178, 95, 95, 5, -5, H2=-8, S2=5), pose(180, -95, 150, 5, -5, H2=-8, S2=5),
                     equip=[{'t': 'bar', 'at': 'w'}, {'t': 'cable', 'at': 'w', 'to': [198, 24]}]),
    'hip-thrust': fig(pose(-80, 0, 70, 70, 10, anchor=('s', (52, 138))), pose(-90, 0, 70, 90, 0, anchor=('s', (52, 138))),
                      equip=[{'t': 'plate', 'at': 'p'}], scene=[{'r': [10, 140, 46, 8]}, {'l': [30, 144, 30, 185]}]),
    'bulgarian-split-squat': fig(pose(180, 0, 0, 0, 0, H2=-30, S2=-80, anchor=('a', (120, 184))), pose(172, 0, 0, 80, 5, H2=-10, S2=-75, anchor=('a', (120, 184))),
                                 equip=[{'t': 'db', 'at': 'w'}], scene=[{'r': [20, 128, 60, 8]}, {'l': [50, 132, 50, 185]}]),
}


def ik_knee(hip, ankle, forward=True):
    """Knee position for given hip and ankle with equal thigh and shin lengths (knee bends forwards)."""
    dx, dy = ankle[0] - hip[0], ankle[1] - hip[1]
    dist = min(math.hypot(dx, dy), THIGH + SHIN - 0.5)
    mid = [hip[0] + dx / 2, hip[1] + dy / 2]
    hgt = math.sqrt(max(0, THIGH ** 2 - (dist / 2) ** 2))
    nx, ny = -dy / math.hypot(dx, dy), dx / math.hypot(dx, dy)
    # Knees bend forwards and upwards.
    if nx - ny < 0:
        nx, ny = -nx, -ny
    return [round(mid[0] + nx * hgt, 1), round(mid[1] + ny * hgt, 1)]


def bike(outdoor):
    hip = [86, 104]
    crank, r = [108, 160], 16
    poses = []
    for ang in (-60, 120):
        a = [round(crank[0] + r * math.cos(math.radians(ang)), 1), round(crank[1] + r * math.sin(math.radians(ang)), 1)]
        a2 = [round(crank[0] - r * math.cos(math.radians(ang)), 1), round(crank[1] - r * math.sin(math.radians(ang)), 1)]
        up = pose(140, 60, 75, 60, 0, anchor=('p', tuple(hip)))
        up['k'], up['a'] = ik_knee(hip, a), a
        up['k2'], up['a2'] = ik_knee(hip, a2), a2
        poses.append(up)
    scene = [{'r': [72, 104, 26, 6]}, {'l': [86, 110, 108, 160]}, {'l': [108, 160, 150, 70]}, {'l': [150, 70, 160, 64]}]
    scene += [{'c': [50, 162, 22]}, {'c': [168, 162, 22]}] if outdoor else [{'l': [70, 185, 150, 185]}, {'l': [108, 160, 108, 185]}]
    return fig(poses[0], poses[1], scene=scene)


def rower():
    foot = [150, 172]
    hipA, hipB = [96, 172], [52, 172]
    A = pose(155, 95, 92, 0, 0, anchor=('p', tuple(hipA)))
    A['k'], A['a'] = ik_knee(hipA, foot), foot
    B = pose(-165, -40, 80, 0, 0, anchor=('p', tuple(hipB)))
    B['k'], B['a'] = ik_knee(hipB, foot), foot
    return fig(A, B, equip=[{'t': 'bar', 'at': 'w'}, {'t': 'cable', 'at': 'w', 'to': [170, 160]}], scene=[{'l': [20, 182, 180, 182]}, {'r': [160, 150, 20, 34]}])


# Standing versions of the seated library poses, plus the two cardio drills (side view; the jumping jack's leg spread is sideways, so only the arms show it).
DB = [{'t': 'db', 'at': 'w'}]
AUTHORED['standing-dumbbell-shoulder-press'] = fig(pose(180, 25, 175, 0, 0, H2=0, S2=0), pose(180, 176, 178, 0, 0, H2=0, S2=0), equip=DB)
AUTHORED['standing-overhead-dumbbell-extension'] = fig(pose(180, 172, -20, 0, 0, H2=0, S2=0), pose(180, 172, 176, 0, 0, H2=0, S2=0), equip=DB)
AUTHORED['jumping-jack'] = fig(pose(180, 0, 0, 0, 0, H2=0, S2=0), pose(180, 172, 176, 4, -4, H2=-4, S2=4, anchor=('a', (100, 180))))
AUTHORED['high-knees'] = walk(kind='march')
AUTHORED['stationary-cycling'] = bike(False)
AUTHORED['outdoor-cycling'] = bike(True)
AUTHORED['rowing-machine'] = rower()

# KYVO exercise id -> (library pose name, approx, overrides)
MAP = {
    'low-to-high-cable-fly': ('Cable crossover', True), 'machine-chest-press': ('Incline chest press machine', True),
    'smith-machine-bench-press': ('Bench press', False), 'weighted-push-up': ('Push-up', False), 'deficit-push-up': ('Push-up', False),
    'assisted-pull-up': ('Pull-up', False), 'neutral-grip-pull-up': ('Neutral-grip chin-up', False), 'neutral-grip-lat-pulldown': ('V-bar pulldown', False),
    'single-arm-lat-pulldown': ('Lat pulldown', True), 'pendlay-row': ('Bent-over row', False), 'machine-row': ('Seated row', True),
    'rack-pull': ('Deadlift', True), 'seated-dumbbell-shoulder-press': ('Dumbbell shoulder press', False),
    'cable-lateral-raise': ('Lateral raise', True), 'leaning-lateral-raise': ('Lateral raise', True), 'machine-lateral-raise': ('Lateral raise', True),
    'reverse-dumbbell-fly': ('Lying rear lateral raise', True), 'reverse-pec-deck': ('Seated cable rear delt raise', True), 'rear-delt-cable-fly': ('Band reverse fly', True),
    'cable-external-rotation': ('Cable internal rotation', False, {'reverse': True}),
    'single-arm-dumbbell-preacher-curl': ('Preacher curl', False), 'machine-preacher-curl': ('Preacher curl', True),
    'cable-curl': ('Barbell curl', True, {'equip': [{'t': 'bar', 'at': 'w'}, {'t': 'cable', 'at': 'w', 'to': [150, 184]}]}),
    'bayesian-cable-curl': ('Barbell curl', True, {'equip': [{'t': 'bar', 'at': 'w'}, {'t': 'cable', 'at': 'w', 'to': [10, 120]}]}),
    'single-leg-calf-raise': ('Standing calf raise', True, {'equip': []}), 'smith-machine-calf-raise': ('Standing calf raise', False),
    'straight-bar-triceps-pushdown': ('Triceps pushdown', False), 'overhead-cable-extension': ('Overhead dumbbell extension', True),
    'skull-crusher': ('Skull crusher', False), 'ez-bar-lying-triceps-extension': ('Skull crusher', False), 'assisted-triceps-dip': ('Parallel bar dips', False),
    'single-arm-cable-extension': ('Triceps pushdown', True), 'cross-body-cable-extension': ('Triceps pushdown', True),
    'shoulder-circles': ('Lateral raise', True, {'equip': []}), 'band-pull-apart': ('Band reverse fly', False),
    'bodyweight-squat': ('Back squat', False, {'equip': [], 'arms': 'forward'}), 'front-squat': ('Back squat', True),
    'goblet-squat': ('Back squat', False, {'equip': [{'t': 'db', 'at': 'w'}], 'arms': 'goblet'}), 'smith-machine-squat': ('Back squat', False),
    'split-squat': ('Lunges', True), 'reverse-lunge': ('Lunges', True),
    'sumo-deadlift': ('Deadlift', True), 'dumbbell-romanian-deadlift': ('Romanian deadlift', False, {'equip': [{'t': 'db', 'at': 'w'}]}),
    'barbell-glute-bridge': ('Glute bridge', False, {'equip': [{'t': 'plate', 'at': 'p'}]}), 'single-leg-glute-bridge': ('Glute bridge', True),
    'cable-pull-through': ('Romanian deadlift', True, {'equip': [{'t': 'bar', 'at': 'w'}, {'t': 'cable', 'at': 'w', 'to': [6, 184]}]}),
    'glute-ham-raise': ('nordic-hamstring-curl', True), 'reverse-crunch': ('Bent-knee hip raise', False),
    'dumbbell-sumo-squat': ('Sumo squat', False),
    'machine-crunch': ('Seated ab crunch machine', False), 'hanging-knee-raise': ('Hanging leg raise', False), 'captains-chair-knee-raise': ('Hanging leg raise', True),
    'bicycle-crunch': ('Cross-body crunch', True), 'weighted-decline-crunch': ('Decline sit-up', False, {'equip': [{'t': 'plate', 'at': 's', 'r': 11}]}),
}


# Body segments drawn in the accent colour for each primary muscle (mirrors src/client/visuals/figure.ts).
SEGMENTS = {
    'chest': ['torso'], 'lats': ['torso'], 'upper_back': ['torso'], 'traps': ['torso', 'neck'], 'lower_back': ['torso'], 'abs': ['torso'], 'obliques': ['torso'],
    'front_delts': ['uarm'], 'side_delts': ['uarm'], 'rear_delts': ['uarm'], 'rotator_cuff': ['uarm'], 'biceps': ['uarm'], 'triceps': ['uarm'], 'forearms': ['farm'],
    'glutes': ['thigh'], 'quads': ['thigh'], 'hamstrings': ['thigh'], 'adductors': ['thigh'], 'hip_flexors': ['thigh'], 'calves': ['shin'],
}


def norm(s):
    s = s.lower().replace('dumbbell', 'db').replace('flys', 'flyes').replace('flies', 'flyes')
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    return ' '.join(w.rstrip('s') for w in s.split())


LIB_NORM = {norm(k): k for k in LIB}


def arms(p, how):
    s = p['s']
    if how == 'forward':
        e = add(s, d(90, UARM)); w = add(e, d(90, FARM))
    else:  # goblet: hands at chest
        e = add(s, d(12, UARM)); w = add(e, d(150, FARM))
    p = dict(p); p['e'] = [round(e[0], 1), round(e[1], 1)]; p['w'] = [round(w[0], 1), round(w[1], 1)]
    return p


def build():
    out, stats = {}, {'library': 0, 'library_approx': 0, 'authored': 0}
    for e in EX:
        eid = e['id']
        approx = False
        if AUTHORED.get(eid):
            f = json.loads(json.dumps(AUTHORED[eid]))
            stats['authored'] += 1
        else:
            m = MAP.get(eid)
            if m:
                name, approx = m[0], m[1]
                over = m[2] if len(m) > 2 else {}
            else:
                name = next((LIB_NORM[norm(n)] for n in [e['name']] + e.get('aliases', []) if norm(n) in LIB_NORM), None)
                over = {}
                if not name:
                    raise SystemExit(f'No figure for {eid}')
            src = AUTHORED.get(name) or LIB[name]
            f = json.loads(json.dumps(src))
            if 'equip' in over:
                f['equip'] = over['equip']
            if over.get('arms'):
                f['poses'] = [arms(p, over['arms']) for p in f['poses']]
            if over.get('reverse'):
                f['poses'] = f['poses'][::-1]
            stats['library_approx' if approx else 'library'] += 1
        f['hi'] = sorted({seg for m in e['primary'] for seg in SEGMENTS.get(m, [])})
        f = {k: v for k, v in f.items() if v not in ([], None, False)}
        if approx:
            f['approx'] = True
        out[eid] = f
    path = os.path.join(ROOT, 'public/data/figures.json')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    print(f'{len(out)} figures -> public/data/figures.json ({os.path.getsize(path) // 1024} KB)', stats)


if __name__ == '__main__':
    build()
