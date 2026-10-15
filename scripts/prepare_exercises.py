"""Build data/exercises.json and data/media.json for KYVO from the IRONFORM exercise source.

Usage: python3 scripts/prepare_exercises.py <ironform src dir>
Writes data/exercises.json, data/exercise_media.json and public/media/*.webm (CC BY clips).
"""
import base64, glob, json, os, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else '/mnt/project-files/ironform/src'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

roster = json.load(open(f'{SRC}/roster.json'))
by_id = {}
for f in sorted(glob.glob(f'{SRC}/ex/batch_*.json')):
    for e in json.load(open(f)):
        by_id[e['id']] = e
order = [r['id'] for r in roster]
assert all(i in by_id for i in order), 'roster/exercise mismatch'

# Muscle keys -> the browse groups the product spec asks for.
GROUP_OF = {
    'chest': 'chest', 'lats': 'back', 'upper_back': 'back', 'lower_back': 'back', 'traps': 'back',
    'front_delts': 'shoulders', 'side_delts': 'shoulders', 'rear_delts': 'shoulders', 'rotator_cuff': 'shoulders',
    'biceps': 'biceps', 'forearms': 'biceps', 'triceps': 'triceps', 'quads': 'quadriceps', 'adductors': 'quadriceps',
    'hamstrings': 'hamstrings', 'glutes': 'glutes', 'calves': 'calves', 'abs': 'core', 'obliques': 'core',
    'hip_flexors': 'core', 'cardio': 'cardio',
}
CATEGORY_GROUP = {'core': 'core', 'cardio': 'cardio', 'mobility': 'mobility'}

# Exercises included in the Free tier: the beginner-friendly staples the free templates draw on.
FREE_EXTRA = {
    'barbell-bench-press', 'barbell-back-squat', 'romanian-deadlift', 'lat-pulldown', 'seated-cable-row',
    'dumbbell-bench-press', 'goblet-squat', 'leg-press', 'push-up', 'plank', 'dead-bug', 'glute-bridge',
    'dumbbell-single-arm-row', 'seated-dumbbell-shoulder-press', 'dumbbell-lateral-raise', 'hammer-curl',
    'rope-triceps-pushdown', 'lying-leg-curl', 'seated-leg-curl', 'standing-calf-raise', 'incline-dumbbell-press',
    'machine-chest-press', 'reverse-lunge', 'split-squat', 'bodyweight-squat', 'incline-push-up', 'inverted-row',
    'assisted-pull-up', 'face-pull', 'bird-dog', 'side-plank', 'treadmill-walk', 'incline-treadmill-walk',
    'stationary-cycling', 'rowing-machine', 'cat-cow', 'worlds-greatest-stretch', 'band-pull-apart',
    'dumbbell-romanian-deadlift', 'hip-thrust', 'alternating-dumbbell-curl', 'overhead-dumbbell-extension',
    'reverse-crunch', 'pallof-press', 'leg-extension', 'step-up', 'farmers-carry', 'shoulder-circles',
    'thoracic-rotation', 'hip-flexor-mobility', 'ankle-mobility-drill', 'dynamic-hamstring-mobility',
    'single-leg-glute-bridge', 'dumbbell-shrug', 'cable-curl', 'machine-row', 'chest-supported-row',
    'reverse-dumbbell-fly', 'elliptical', 'low-impact-intervals', 'dumbbell-kickback', 'goblet-squat',
}

media = json.load(open(f'{SRC}/media.json'))
out, media_rows = [], []
os.makedirs(f'{ROOT}/public/media', exist_ok=True)
for r in roster:
    e = by_id[r['id']]
    groups = []
    for m in e['primary']:
        g = GROUP_OF.get(m)
        if g and g not in groups:
            groups.append(g)
    cg = CATEGORY_GROUP.get(e['category'])
    if cg and cg not in groups:
        groups.insert(0, cg)
    if e['category'] == 'hamstrings_glutes' and not ({'hamstrings', 'glutes'} & set(groups)):
        groups.append('glutes')
    if set(e['equipment']) <= {'bodyweight', 'mat', 'wall', 'pullup_bar', 'dip_station', 'bench', 'box'} and 'bodyweight' in e['equipment']:
        groups.append('bodyweight')
    distinct = {GROUP_OF.get(m) for m in e['primary'] + e['secondary']} - {None, 'cardio'}
    upper, lower = {'chest', 'back', 'shoulders', 'biceps', 'triceps'}, {'quadriceps', 'hamstrings', 'glutes', 'calves'}
    if e['category'] not in ('cardio', 'mobility') and (e['mechanic'] == 'compound' and distinct & upper - {'back'} and distinct & lower or e['pattern'] in ('carry', 'locomotion')):
        groups.append('full_body')
    e = dict(e)
    e['groups'] = groups
    e['premium'] = e['id'] not in FREE_EXTRA
    out.append(e)
    if r.get('video'):
        media_rows.append({
            'exercise_id': e['id'], 'kind': 'youtube', 'ref': r['video'][0], 'title': r['video'][1],
            'source': 'Renaissance Periodization (YouTube)', 'license': 'YouTube standard licence (embedded player)',
            'attribution': 'Video by Renaissance Periodization on YouTube',
            'verified_note': 'Matched by exact title and channel during the IRONFORM build on 14 Oct 2026',
        })
for ex_id, v in media['local'].items():
    path = f'{ROOT}/public/media/{ex_id}.webm'
    open(path, 'wb').write(base64.b64decode(v['src'].split(',', 1)[1]))
    media_rows.append({
        'exercise_id': ex_id, 'kind': 'video', 'ref': f'/media/{ex_id}.webm', 'title': f'{ex_id.replace("-", " ").capitalize()} demonstration',
        'source': v['url'], 'license': v['lic'], 'attribution': f"Clip by {v['by']}, {v['lic']}, via Wikimedia Commons",
        'verified_note': 'Bundled file; licence recorded from Wikimedia Commons',
    })

json.dump(out, open(f'{ROOT}/data/exercises.json', 'w'), ensure_ascii=False, indent=0)
json.dump(media_rows, open(f'{ROOT}/data/exercise_media.json', 'w'), ensure_ascii=False, indent=1)
from collections import Counter
print('exercises', len(out), 'unique', len({e['id'] for e in out}), 'free', sum(not e['premium'] for e in out), 'media', len(media_rows))
print(Counter(g for e in out for g in e['groups']))
