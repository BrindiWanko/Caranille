/**
 * @file Character creation page: keeps an animated preview in sync with the
 * form. Choosing a class applies its outfit (and its default look the first
 * time); the other fields change hair, skin and colours live. The server
 * re-validates everything on submit.
 */
import { HAIR_STYLES, sanitizeAppearance, type CharacterAppearance, type Outfit } from '../../shared/art/character.js';
import { CharacterPreview } from '../art/render.js';

const form = document.getElementById('create-form') as HTMLFormElement;
const canvas = document.getElementById('preview') as HTMLCanvasElement;

function selectedClass(): HTMLInputElement | null {
  return form.querySelector<HTMLInputElement>('input[name="classId"]:checked');
}

/** Reads the appearance currently described by the form. */
function readForm(): CharacterAppearance {
  const data = new FormData(form);
  const int = (name: string) => Number.parseInt(String(data.get(name) ?? ''), 10);
  const outfit = (selectedClass()?.dataset.outfit ?? 'warrior') as Outfit;
  return sanitizeAppearance(
    { body: data.get('body'), skin: int('skin'), hair: data.get('hair'), hairColor: int('hairColor'), outfit, outfitColor: int('outfitColor') },
    [outfit],
  );
}

/** Writes an appearance into the form controls. */
function writeForm(a: CharacterAppearance): void {
  const check = (name: string, value: string | number) => {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  };
  check('body', a.body);
  check('skin', a.skin);
  check('hairColor', a.hairColor);
  check('outfitColor', a.outfitColor);
  (form.elements.namedItem('hair') as HTMLSelectElement).value = a.hair;
}

const preview = new CharacterPreview(canvas, readForm(), 3);
preview.start(200);

let touched = false;
form.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.name === 'classId' && !touched) {
    // Until the player customises something, show each class with its default look.
    try {
      writeForm(sanitizeAppearance(JSON.parse(target.dataset.appearance ?? '{}')));
    } catch {
      /* keep current values */
    }
  } else if (target.name !== 'classId' && target.name !== 'name') {
    touched = true;
  }
  preview.setAppearance(readForm());
});

document.getElementById('rotate-left')?.addEventListener('click', () => preview.rotate(-1));
document.getElementById('rotate-right')?.addEventListener('click', () => preview.rotate(1));
document.getElementById('randomize')?.addEventListener('click', () => {
  const pick = (name: string) => {
    const inputs = form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`);
    return inputs.length ? Number(inputs[Math.floor(Math.random() * inputs.length)]!.value) : 0;
  };
  touched = true;
  writeForm({
    body: Math.random() < 0.5 ? 'male' : 'female',
    skin: pick('skin'),
    hair: HAIR_STYLES[Math.floor(Math.random() * HAIR_STYLES.length)]!,
    hairColor: pick('hairColor'),
    outfit: readForm().outfit,
    outfitColor: pick('outfitColor'),
  });
  preview.setAppearance(readForm());
});

// First load without posted values: start from the selected class's default look.
if (!form.querySelector('.form-error') && selectedClass()) {
  const cls = selectedClass()!;
  try {
    writeForm(sanitizeAppearance(JSON.parse(cls.dataset.appearance ?? '{}')));
    preview.setAppearance(readForm());
  } catch {
    /* ignore */
  }
}
