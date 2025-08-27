/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {LitElement, css, html, PropertyValues} from 'lit';
import {customElement, property} from 'lit/decorators.js';

@customElement('waveform-visualizer')
export class WaveformVisualizer extends LitElement {
  private analyser?: AnalyserNode;
  private dataArray?: Uint8Array;
  private bufferLength?: number;

  private _audioNode?: AudioNode;

  @property({attribute: false})
  set audioNode(node: AudioNode | undefined) {
    if (!node) {
        this._audioNode = undefined;
        this.analyser = undefined;
        return;
    }
    this._audioNode = node;
    this.analyser = this._audioNode.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this._audioNode.connect(this.analyser);
    
    this.bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(this.bufferLength);
  }

  get audioNode() {
    return this._audioNode;
  }

  @property({ attribute: false })
  waveformData: Uint8Array | null = null;

  private canvas: HTMLCanvasElement;
  private canvasCtx: CanvasRenderingContext2D;
  private logicalWidth = 0;
  private logicalHeight = 0;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    canvas {
      width: 100%;
      height: 100%;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    if (this.audioNode) {
      requestAnimationFrame(() => this.visualize());
    }
  }

  private visualize() {
    if (this.waveformData || !this.canvasCtx || !this.analyser) {
        return;
    }
    
    this.analyser.getByteTimeDomainData(this.dataArray!);

    this.canvasCtx.fillStyle = 'rgb(0, 0, 0)';
    this.canvasCtx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);

    this.canvasCtx.lineWidth = 2;
    this.canvasCtx.strokeStyle = 'rgb(0, 255, 0)';

    this.canvasCtx.beginPath();

    const sliceWidth = this.logicalWidth * 1.0 / this.bufferLength!;
    let x = 0;

    for (let i = 0; i < this.bufferLength!; i++) {
      const v = this.dataArray![i] / 128.0;
      const y = v * this.logicalHeight / 2;

      if (i === 0) {
        this.canvasCtx.moveTo(x, y);
      } else {
        this.canvasCtx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    this.canvasCtx.lineTo(this.logicalWidth, this.logicalHeight / 2);
    this.canvasCtx.stroke();
    
    requestAnimationFrame(() => this.visualize());
  }

  private drawStaticWaveform() {
      if (!this.canvasCtx || !this.waveformData) return;

      this.canvasCtx.fillStyle = 'rgb(0, 0, 0)';
      this.canvasCtx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
      this.canvasCtx.lineWidth = 1;
      this.canvasCtx.strokeStyle = 'rgb(0, 255, 0)';

      this.canvasCtx.beginPath();

      const sliceWidth = this.logicalWidth / this.waveformData.length;
      const centerY = this.logicalHeight / 2;
      let x = 0;

      for (const value of this.waveformData) {
          const v = value / 255.0;
          const h = v * this.logicalHeight;
          this.canvasCtx.moveTo(x, centerY - h / 2);
          this.canvasCtx.lineTo(x, centerY + h / 2);
          x += sliceWidth;
      }
      this.canvasCtx.stroke();
  }

  protected updated(changedProperties: PropertyValues): void {
      if (changedProperties.has('waveformData') && this.waveformData && this.canvasCtx) {
          this.drawStaticWaveform();
      }
  }

  protected firstUpdated() {
    this.canvas = this.shadowRoot!.querySelector('canvas')!;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.logicalWidth = rect.width;
    this.logicalHeight = rect.height;

    this.canvas.width = this.logicalWidth * dpr;
    this.canvas.height = this.logicalHeight * dpr;

    this.canvasCtx = this.canvas.getContext('2d')!;
    this.canvasCtx.scale(dpr, dpr);

    if (this.waveformData) {
        this.drawStaticWaveform();
    }
  }

  protected render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'waveform-visualizer': WaveformVisualizer;
  }
}