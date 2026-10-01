/**
 * @file Behaviour of the resource inspection page (`/dev/assets`): zoom levels,
 * background switch, tile grid overlay and animated previews of character
 * sheets (each character walks through the standard 0-1-2-1 frame cycle and
 * turns through the four directions).
 */

const body = document.body;

function setZoom(zoom: number): void {
  body.dataset.zoom = String(zoom);
  for (const img of document.querySelectorAll<HTMLImageElement>('.dev-image img')) {
    const w = Number(img.dataset.width);
    const h = Number(img.dataset.height);
    if (w && h) {
      img.style.width = `${w * zoom}px`;
      img.style.height = `${h * zoom}px`;
    }
  }
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('.char-preview')) canvas.style.zoom = String(zoom);
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-zoom-set]')) {
  button.addEventListener('click', () => setZoom(Number(button.dataset.zoomSet)));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-bg-set]')) {
  button.addEventListener('click', () => {
    body.dataset.bg = button.dataset.bgSet ?? 'dark';
  });
}
document.getElementById('grid-toggle')?.addEventListener('change', (event) => {
  body.classList.toggle('show-grid', (event.target as HTMLInputElement).checked);
});

/** Animated walking preview of every character of a sheet. */
function animateSheet(canvas: HTMLCanvasElement): void {
  const image = new Image();
  image.src = canvas.dataset.src ?? '';
  image.addEventListener('load', () => {
    const single = canvas.dataset.single === '1';
    const cols = single ? 1 : 4;
    const rows = single ? 1 : 2;
    const fw = image.width / (cols * 3);
    const fh = image.height / (rows * 4);
    canvas.width = fw * cols;
    canvas.height = fh * rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    let tick = 0;
    setInterval(() => {
      tick++;
      const frame = [0, 1, 2, 1][tick % 4]!;
      const dir = Math.floor(tick / 8) % 4;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const sx = (c * 3 + frame) * fw;
          const sy = (r * 4 + dir) * fh;
          ctx.drawImage(image, sx, sy, fw, fh, c * fw, r * fh, fw, fh);
        }
      }
    }, 180);
  });
}

document.querySelectorAll<HTMLCanvasElement>('.char-preview').forEach(animateSheet);
setZoom(1);
