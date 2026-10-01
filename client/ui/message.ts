/**
 * @file Message window: the classic dialogue box at the bottom of the screen,
 * with an optional face on the left and the speaker's name above.
 *
 * Text is typed out one character per frame; pressing Action shows the rest
 * at once, then (when the whole text is shown and the pause sign blinks)
 * closes the message. Messages are queued; each `show()` resolves when the
 * player has closed that message, which lets the server's event interpreter
 * continue.
 *
 * A message may carry choices (a list shown once the text is typed out,
 * answered with the arrows and Action, or a click) or a number input (one
 * box per digit, changed with up/down, left/right to pick the digit, or the
 * small arrows with the mouse). The answer is the value `show()` resolves
 * with: the choice index (-2 when cancelled), the number, or 0.
 */
import type { MessagePayload } from '../../shared/protocol.js';
import type { UiAudio } from '../engine/audio.js';
import type { Bitmap } from '../engine/assets.js';
import type { Input } from '../engine/input.js';
import { el, icon } from './dom.js';
import { parseMessage, type Segment } from './text-codes.js';

interface Pending {
  payload: MessagePayload;
  face: Bitmap | null;
  resolve: (answer: number) => void;
}

/** The dialogue box. */
export class MessageWindow {
  readonly element: HTMLDivElement;
  private readonly nameBox: HTMLDivElement;
  private readonly faceCanvas: HTMLCanvasElement;
  private readonly textBox: HTMLDivElement;
  private readonly pauseSign: HTMLDivElement;
  private readonly windowBox: HTMLDivElement;
  /** Choice list / number input shown after the text. */
  private readonly choiceBox: HTMLDivElement;
  private choiceCursor = 0;
  private digits: number[] = [];
  private digitCursor = 0;
  /** The choices or number input are displayed and wait for an answer. */
  private asking = false;
  private readonly queue: Pending[] = [];
  private current: Pending | null = null;
  private segments: Segment[] = [];
  private segIndex = 0;
  private charIndex = 0;
  private line: HTMLSpanElement | null = null;
  private color = 0;
  private waitFrames = 0;
  private waitingInput = false;
  private finished = false;
  private typedCount = 0;

  constructor(
    layer: HTMLElement,
    private readonly audio: UiAudio,
  ) {
    this.nameBox = el('div', { className: 'skin-window message-name' });
    this.faceCanvas = el('canvas', { className: 'message-face' });
    this.textBox = el('div', { className: 'message-text', attrs: { 'aria-live': 'polite' } });
    this.pauseSign = el('div', { className: 'pause-sign' });
    this.choiceBox = el('div', { className: 'skin-window message-choices hidden', attrs: { role: 'listbox' } });
    this.windowBox = el('div', { className: 'skin-window message-window', on: { pointerdown: () => this.advance() } }, [this.faceCanvas, this.textBox, this.pauseSign]);
    this.element = el('div', { className: 'message-area hidden' }, [this.choiceBox, this.nameBox, this.windowBox]);
    layer.append(this.element);
  }

  /** Tells whether a message is displayed or waiting. */
  get active(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  /**
   * Queues a message.
   * @param payload - Message.
   * @param face - Face sheet image (or `null` for no face).
   * @returns A promise resolved when the player closes the message.
   */
  show(payload: MessagePayload, face: Bitmap | null): Promise<number> {
    return new Promise((resolve) => {
      this.queue.push({ payload, face, resolve });
      if (!this.current) this.next();
    });
  }

  private next(): void {
    const pending = this.queue.shift();
    this.current = pending ?? null;
    if (!pending) {
      this.element.classList.add('hidden');
      return;
    }
    const { payload, face } = pending;
    this.element.classList.remove('hidden');
    this.element.dataset.position = String(payload.position);
    this.element.dataset.background = String(payload.background);
    this.nameBox.textContent = payload.speaker;
    this.nameBox.classList.toggle('hidden', payload.speaker === '');
    this.drawFace(face, payload.faceIndex);
    this.textBox.replaceChildren();
    this.segments = parseMessage(payload.text);
    this.segIndex = 0;
    this.charIndex = 0;
    this.color = 0;
    this.line = null;
    this.waitFrames = 0;
    this.waitingInput = false;
    this.finished = false;
    this.asking = false;
    this.pauseSign.classList.remove('visible');
    this.choiceBox.classList.add('hidden');
    // Choices or a number without text: only the answer box is shown.
    const textless = payload.text === '' && payload.speaker === '' && !face && (payload.choices !== undefined || payload.numberDigits !== undefined);
    this.windowBox.classList.toggle('hidden', textless);
  }

  /** The text is fully shown: opens the choices or number input if any. */
  private openAnswer(): boolean {
    const payload = this.current?.payload;
    if (!payload || this.asking) return this.asking;
    if (payload.choices && payload.choices.length > 0) {
      this.asking = true;
      this.choiceCursor = Math.max(0, Math.min(payload.choices.length - 1, payload.choiceDefault ?? 0));
      this.choiceBox.replaceChildren(
        ...payload.choices.map((text, i) =>
          el('div', {
            className: 'message-choice',
            attrs: { role: 'option' },
            on: {
              pointerdown: (e) => {
                e.stopPropagation();
                this.choiceCursor = i;
                this.answer(i);
              },
            },
          }, parseMessage(text).flatMap((seg): Node[] => (seg.type === 'text' ? [document.createTextNode(seg.text)] : seg.type === 'icon' ? [icon(seg.index)] : []))),
        ),
      );
    } else if (payload.numberDigits) {
      this.asking = true;
      this.digits = new Array<number>(payload.numberDigits).fill(0);
      this.digitCursor = this.digits.length - 1;
      this.renderDigits();
    } else {
      return false;
    }
    this.choiceBox.classList.remove('hidden');
    this.pauseSign.classList.remove('visible');
    this.refreshChoices();
    return true;
  }

  private renderDigits(): void {
    const change = (i: number, delta: number) => (e: Event) => {
      e.stopPropagation();
      this.digitCursor = i;
      this.digits[i] = (this.digits[i]! + delta + 10) % 10;
      this.audio.play('cursor');
      this.renderDigits();
    };
    const boxes = this.digits.map((d, i) =>
      el('div', { className: `number-digit${i === this.digitCursor ? ' selected' : ''}` }, [
        el('button', { className: 'digit-arrow', text: '▲', attrs: { type: 'button', tabindex: '-1' }, on: { pointerdown: change(i, 1) } }),
        el('span', { text: String(d) }),
        el('button', { className: 'digit-arrow', text: '▼', attrs: { type: 'button', tabindex: '-1' }, on: { pointerdown: change(i, -1) } }),
      ]),
    );
    const ok = el('button', {
      className: 'button small number-ok',
      text: 'OK',
      attrs: { type: 'button' },
      on: {
        pointerdown: (e) => {
          e.stopPropagation();
          this.answer(this.numberValue());
        },
      },
    });
    this.choiceBox.replaceChildren(el('div', { className: 'number-input' }, [...boxes, ok]));
  }

  private numberValue(): number {
    return this.digits.reduce((n, d) => n * 10 + d, 0);
  }

  private refreshChoices(): void {
    this.choiceBox.querySelectorAll('.message-choice').forEach((node, i) => {
      node.classList.toggle('selected', i === this.choiceCursor);
      node.setAttribute('aria-selected', String(i === this.choiceCursor));
    });
  }

  /** Closes the current message with an answer. */
  private answer(value: number): void {
    const done = this.current;
    if (!done) return;
    this.audio.play(value === -2 ? 'cancel' : 'ok');
    this.next();
    done.resolve(value);
  }

  /** Arrow keys, Action and Cancel while choices or a number input are shown. */
  private updateAnswer(input: Input): void {
    const payload = this.current!.payload;
    if (payload.choices && payload.choices.length > 0) {
      const n = payload.choices.length;
      const move = input.consume('down') ? 1 : input.consume('up') ? -1 : 0;
      if (move) {
        this.choiceCursor = (this.choiceCursor + move + n) % n;
        this.audio.play('cursor');
        this.refreshChoices();
      }
      if (input.consume('action')) this.answer(this.choiceCursor);
      else if (input.consume('cancel')) {
        const cancel = payload.choiceCancel ?? -2;
        if (cancel === -1) this.audio.play('buzzer');
        else this.answer(cancel);
      }
      return;
    }
    const n = this.digits.length;
    if (input.consume('left')) this.digitCursor = (this.digitCursor - 1 + n) % n;
    else if (input.consume('right')) this.digitCursor = (this.digitCursor + 1) % n;
    else if (input.consume('up')) this.digits[this.digitCursor] = (this.digits[this.digitCursor]! + 1) % 10;
    else if (input.consume('down')) this.digits[this.digitCursor] = (this.digits[this.digitCursor]! + 9) % 10;
    else if (input.consume('action')) {
      this.answer(this.numberValue());
      return;
    } else {
      input.consume('cancel');
      return;
    }
    this.audio.play('cursor');
    this.renderDigits();
  }

  private drawFace(face: Bitmap | null, index: number): void {
    this.faceCanvas.classList.toggle('hidden', !face);
    if (!face) return;
    // Face sheets are 4 × 2 portraits.
    const fw = face.width / 4;
    const fh = face.height / 2;
    this.faceCanvas.width = fw;
    this.faceCanvas.height = fh;
    const ctx = this.faceCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, fw, fh);
    ctx.drawImage(face, (index % 4) * fw, Math.floor(index / 4) * fh, fw, fh, 0, 0, fw, fh);
  }

  private newLine(): HTMLSpanElement {
    this.line = el('span', { className: 'message-line' });
    this.textBox.append(this.line);
    return this.line;
  }

  private appendText(text: string): void {
    const line = this.line ?? this.newLine();
    const last = line.lastElementChild as HTMLSpanElement | null;
    if (last && last.tagName === 'SPAN' && last.dataset.color === String(this.color)) {
      last.textContent += text;
    } else {
      const span = el('span', { text });
      span.dataset.color = String(this.color);
      span.style.color = `var(--tc-${this.color})`;
      line.append(span);
    }
  }

  /** Types characters until the next pause; with `all`, types everything up to a wait code. */
  private type(all: boolean): void {
    let typed = 0;
    while (this.segIndex < this.segments.length) {
      const seg = this.segments[this.segIndex]!;
      if (seg.type === 'text') {
        if (!all) {
          this.appendText(seg.text[this.charIndex]!);
          this.charIndex++;
          typed++;
          if (this.charIndex >= seg.text.length) {
            this.segIndex++;
            this.charIndex = 0;
          }
          if (typed >= 1) break;
          continue;
        }
        this.appendText(seg.text.slice(this.charIndex));
        this.segIndex++;
        this.charIndex = 0;
        continue;
      }
      this.segIndex++;
      if (seg.type === 'newline') this.newLine();
      else if (seg.type === 'color') this.color = seg.index;
      else if (seg.type === 'icon') (this.line ?? this.newLine()).append(icon(seg.index));
      else if (seg.type === 'pause' && !all) {
        this.waitFrames = seg.frames;
        break;
      } else if (seg.type === 'wait') {
        this.waitingInput = true;
        this.pauseSign.classList.add('visible');
        break;
      }
    }
    if (this.segIndex >= this.segments.length && !this.waitingInput) {
      this.finished = true;
      if (!this.openAnswer()) this.pauseSign.classList.add('visible');
    }
  }

  /** Action pressed (or window clicked). */
  private advance(): void {
    if (!this.current) return;
    if (this.waitingInput) {
      this.waitingInput = false;
      this.pauseSign.classList.remove('visible');
      return;
    }
    if (!this.finished) {
      this.type(true);
      return;
    }
    if (this.asking) return;
    const done = this.current;
    this.next();
    done.resolve(0);
  }

  /**
   * Advances typing and handles the Action button; called every frame.
   * @returns `true` while the message captures input.
   */
  update(input: Input): boolean {
    if (!this.current) return false;
    if (this.asking) {
      this.updateAnswer(input);
      return true;
    }
    if (input.consume('action') || input.consume('cancel')) this.advance();
    if (!this.current) return true;
    if (this.waitFrames > 0) {
      this.waitFrames--;
    } else if (!this.waitingInput && !this.finished) {
      // Holding Action fast-forwards.
      this.type(input.isHeld('action'));
      // A soft blip every few letters, like a typewriter.
      if (++this.typedCount % 4 === 0) this.audio.play('blip');
    }
    return true;
  }
}
