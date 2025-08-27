/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import { detectBpm } from './bpm-detector';
import './visual'; // Will be the new waveform visualizer

interface DeckState {
  fileName: string;
  audioBuffer: AudioBuffer | null;
  isPlaying: boolean;
  volume: number;
  playbackRate: number;
  pitch: number; // in cents
  originalBpm: number | null;
  currentBpm: number | null;
  isDetectingBpm: boolean;
  sourceNode: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
}

@customElement('dj-mixer-app')
export class DjMixerApp extends LitElement {
  @state() private deckA: DeckState = {
    fileName: 'Load Track...',
    audioBuffer: null,
    isPlaying: false,
    volume: 1,
    playbackRate: 1,
    pitch: 0,
    originalBpm: null,
    currentBpm: null,
    isDetectingBpm: false,
    sourceNode: null,
    gainNode: null,
  };

  @state() private deckB: DeckState = {
    fileName: 'Load Track...',
    audioBuffer: null,
    isPlaying: false,
    volume: 1,
    playbackRate: 1,
    pitch: 0,
    originalBpm: null,
    currentBpm: null,
    isDetectingBpm: false,
    sourceNode: null,
    gainNode: null,
  };

  @state() private crossfader = 0.5;
  @state() private waveformDataA: Uint8Array | null = null;
  @state() private waveformDataB: Uint8Array | null = null;

  private audioContext: AudioContext;
  private xFadeAGain: GainNode;
  private xFadeBGain: GainNode;
  private masterOut: GainNode;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: sans-serif;
      color: white;
      background-color: #181818;
      width: 100vw;
      height: 100vh;
      gap: 20px;
      padding: 20px;
      box-sizing: border-box;
    }

    .mixer {
      display: flex;
      justify-content: space-around;
      align-items: flex-start;
      background: #2a2a2a;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 0 20px rgba(0,0,0,0.5);
      gap: 20px;
    }

    .deck {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 15px;
      background: #333;
      padding: 15px;
      border-radius: 8px;
      width: 350px;
    }

    .deck-title {
      font-size: 1.5em;
      font-weight: bold;
      color: #ccc;
    }
    
    .file-name {
      background: #111;
      padding: 8px;
      border-radius: 4px;
      width: 100%;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-sizing: border-box;
    }

    .controls {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
    }
    
    label {
      display: flex;
      justify-content: space-between;
      width: 100%;
      align-items: center;
    }

    input[type="range"] {
      width: 100%;
    }

    .buttons {
        display: flex;
        gap: 10px;
    }

    button, .file-input-label {
      padding: 10px 15px;
      border-radius: 5px;
      border: none;
      background-color: #555;
      color: white;
      cursor: pointer;
      font-size: 1em;
      text-align: center;
      flex-grow: 1;
    }

    button:hover, .file-input-label:hover {
      background-color: #666;
    }

    input[type="file"] {
        display: none;
    }

    .crossfader-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding-top: 100px; /* Align with deck controls */
    }
    
    waveform-visualizer {
        width: 100%;
        max-width: 900px;
        height: 200px;
        background: #000;
        border-radius: 8px;
    }

    .deck-visualizer {
      width: 100%;
      height: 60px;
      background: #000;
      border-radius: 4px;
      margin-bottom: 10px;
    }

    .bpm-section {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      background: #222;
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 0.9em;
    }

    .bpm-controls button {
        padding: 2px 8px;
        font-size: 1em;
        min-width: 25px;
    }
    
    .bpm-controls {
      display: flex;
      gap: 5px;
    }

    .sync-button {
      padding: 2px 10px;
    }
  `;

  constructor() {
    super();
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterOut = this.audioContext.createGain();
    this.xFadeAGain = this.audioContext.createGain();
    this.xFadeBGain = this.audioContext.createGain();

    this.xFadeAGain.connect(this.masterOut);
    this.xFadeBGain.connect(this.masterOut);
    this.masterOut.connect(this.audioContext.destination);
    
    this.updateCrossfaderGains();
  }
  
  private updateCrossfaderGains() {
    // Equal-power crossfading
    const gainA = Math.cos(this.crossfader * 0.5 * Math.PI);
    const gainB = Math.cos((1.0 - this.crossfader) * 0.5 * Math.PI);
    this.xFadeAGain.gain.setValueAtTime(gainA, this.audioContext.currentTime);
    this.xFadeBGain.gain.setValueAtTime(gainB, this.audioContext.currentTime);
  }

  private generateWaveformData(audioBuffer: AudioBuffer, points = 256): Uint8Array {
      const rawData = audioBuffer.getChannelData(0); // get data from channel 0
      const samples = points;
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData = new Uint8Array(samples);
      for (let i = 0; i < samples; i++) {
          const blockStart = blockSize * i;
          let max = 0;
          for (let j = 0; j < blockSize; j++) {
              if (Math.abs(rawData[blockStart + j]) > max) {
                  max = Math.abs(rawData[blockStart + j]);
              }
          }
          filteredData[i] = max * 255;
      }
      return filteredData;
  }

  private async handleFileChange(deck: 'A' | 'B', event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    
    // Reset state for new file
    const resetState = {
        audioBuffer: null,
        fileName: file.name,
        originalBpm: null,
        currentBpm: null,
        isDetectingBpm: true,
        playbackRate: 1,
        pitch: 0
    };

    if (deck === 'A') {
        this.deckA = {...this.deckA, ...resetState};
        this.waveformDataA = null;
    } else {
        this.deckB = {...this.deckB, ...resetState};
        this.waveformDataB = null;
    }

    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    const waveformData = this.generateWaveformData(audioBuffer);

    if (deck === 'A') {
      this.deckA = {...this.deckA, audioBuffer};
      this.waveformDataA = waveformData;
    } else {
      this.deckB = {...this.deckB, audioBuffer};
      this.waveformDataB = waveformData;
    }

    detectBpm(audioBuffer).then(bpm => {
        if (deck === 'A') {
            this.deckA = {...this.deckA, originalBpm: bpm, currentBpm: bpm, isDetectingBpm: false};
        } else {
            this.deckB = {...this.deckB, originalBpm: bpm, currentBpm: bpm, isDetectingBpm: false};
        }
    });
  }

  private togglePlay(deck: 'A' | 'B') {
    this.audioContext.resume();
    const targetDeck = deck === 'A' ? this.deckA : this.deckB;
    if (targetDeck.isPlaying) {
      targetDeck.sourceNode?.stop();
      if (deck === 'A') {
        this.deckA = {...this.deckA, isPlaying: false, sourceNode: null};
      } else {
        this.deckB = {...this.deckB, isPlaying: false, sourceNode: null};
      }
    } else {
      if (!targetDeck.audioBuffer) return;
      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = targetDeck.audioBuffer;

      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = targetDeck.volume;

      const xFadeGain = deck === 'A' ? this.xFadeAGain : this.xFadeBGain;
      
      sourceNode.connect(gainNode).connect(xFadeGain);

      sourceNode.playbackRate.value = targetDeck.playbackRate;
      sourceNode.detune.value = targetDeck.pitch;
      sourceNode.start();
      sourceNode.onended = () => {
        if (deck === 'A') {
          if (this.deckA.sourceNode === sourceNode) {
             this.deckA = {...this.deckA, isPlaying: false, sourceNode: null};
          }
        } else {
           if (this.deckB.sourceNode === sourceNode) {
             this.deckB = {...this.deckB, isPlaying: false, sourceNode: null};
          }
        }
      }

      if (deck === 'A') {
        this.deckA = {...this.deckA, isPlaying: true, sourceNode, gainNode};
      } else {
        this.deckB = {...this.deckB, isPlaying: true, sourceNode, gainNode};
      }
    }
  }

  private handleVolumeChange(deck: 'A' | 'B', event: Event) {
    const volume = parseFloat((event.target as HTMLInputElement).value);
    if (deck === 'A') {
      this.deckA = {...this.deckA, volume};
      if (this.deckA.gainNode) this.deckA.gainNode.gain.value = volume;
    } else {
      this.deckB = {...this.deckB, volume};
      if (this.deckB.gainNode) this.deckB.gainNode.gain.value = volume;
    }
  }
  
  private handleTempoChange(deck: 'A' | 'B', event: Event) {
    const playbackRate = parseFloat((event.target as HTMLInputElement).value);
     if (deck === 'A') {
      if (this.deckA.originalBpm) {
        const currentBpm = this.deckA.originalBpm * playbackRate;
        this.deckA = {...this.deckA, playbackRate, currentBpm};
      } else {
        this.deckA = {...this.deckA, playbackRate};
      }
      if (this.deckA.sourceNode) this.deckA.sourceNode.playbackRate.value = playbackRate;
    } else {
      if (this.deckB.originalBpm) {
        const currentBpm = this.deckB.originalBpm * playbackRate;
        this.deckB = {...this.deckB, playbackRate, currentBpm};
      } else {
        this.deckB = {...this.deckB, playbackRate};
      }
      if (this.deckB.sourceNode) this.deckB.sourceNode.playbackRate.value = playbackRate;
    }
  }

  private handlePitchChange(deck: 'A' | 'B', event: Event) {
    const pitch = parseFloat((event.target as HTMLInputElement).value);
    if (deck === 'A') {
      this.deckA = {...this.deckA, pitch};
      if (this.deckA.sourceNode) this.deckA.sourceNode.detune.value = pitch;
    } else {
      this.deckB = {...this.deckB, pitch};
      if (this.deckB.sourceNode) this.deckB.sourceNode.detune.value = pitch;
    }
  }

  private handleBpmNudge(deck: 'A' | 'B', amount: number) {
      const targetDeck = deck === 'A' ? this.deckA : this.deckB;
      if (!targetDeck.currentBpm || !targetDeck.originalBpm) return;
      
      const currentBpm = targetDeck.currentBpm + amount;
      const playbackRate = currentBpm / targetDeck.originalBpm;

      if (deck === 'A') {
          this.deckA = {...this.deckA, currentBpm, playbackRate};
          if (this.deckA.sourceNode) this.deckA.sourceNode.playbackRate.value = playbackRate;
      } else {
          this.deckB = {...this.deckB, currentBpm, playbackRate};
          if (this.deckB.sourceNode) this.deckB.sourceNode.playbackRate.value = playbackRate;
      }
  }

  private handleSync(deckToSync: 'A' | 'B') {
      const sourceDeck = deckToSync === 'A' ? this.deckB : this.deckA;
      const targetDeck = deckToSync === 'A' ? this.deckA : this.deckB;

      if (!sourceDeck.currentBpm || !targetDeck.originalBpm) return;

      const currentBpm = sourceDeck.currentBpm;
      const playbackRate = currentBpm / targetDeck.originalBpm;

      if (deckToSync === 'A') {
          this.deckA = {...this.deckA, currentBpm, playbackRate};
          if (this.deckA.sourceNode) this.deckA.sourceNode.playbackRate.value = playbackRate;
      } else {
          this.deckB = {...this.deckB, currentBpm, playbackRate};
          if (this.deckB.sourceNode) this.deckB.sourceNode.playbackRate.value = playbackRate;
      }
  }
  
  private handleCrossfaderChange(event: Event) {
    this.crossfader = parseFloat((event.target as HTMLInputElement).value);
    this.updateCrossfaderGains();
  }

  renderDeck(deckType: 'A' | 'B') {
      const deck = deckType === 'A' ? this.deckA : this.deckB;
      const waveformData = deckType === 'A' ? this.waveformDataA : this.waveformDataB;
      const otherDeck = deckType === 'A' ? this.deckB : this.deckA;
      
      let bpmDisplay: string;
      if (deck.isDetectingBpm) {
        bpmDisplay = 'Detecting...';
      } else if (deck.currentBpm) {
        bpmDisplay = deck.currentBpm.toFixed(1);
      } else {
        bpmDisplay = 'N/A';
      }

      return html`
        <div class="deck">
            <div class="deck-title">Deck ${deckType}</div>
            <waveform-visualizer class="deck-visualizer" .waveformData=${waveformData}></waveform-visualizer>
            <div class="file-name" title=${deck.fileName}>${deck.fileName}</div>
            
            <div class="bpm-section">
                <span>BPM: ${bpmDisplay}</span>
                <div class="bpm-controls">
                    <button @click=${() => this.handleBpmNudge(deckType, -0.1)}>-</button>
                    <button @click=${() => this.handleBpmNudge(deckType, 0.1)}>+</button>
                    <button class="sync-button" @click=${() => this.handleSync(deckType)} ?disabled=${!otherDeck.currentBpm || !deck.originalBpm}>Sync</button>
                </div>
            </div>

            <div class="controls">
                <label>Pitch: <span>${deck.pitch} cents</span></label>
                <input type="range" min="-1200" max="1200" step="1" .value=${deck.pitch} @input=${(e: Event) => this.handlePitchChange(deckType, e)}>

                <label>Tempo: <span>${deck.playbackRate.toFixed(2)}x</span></label>
                <input type="range" min="0.5" max="2" step="0.01" .value=${deck.playbackRate} @input=${(e: Event) => this.handleTempoChange(deckType, e)}>
                
                <label>Volume: <span>${Math.round(deck.volume * 100)}%</span></label>
                <input type="range" min="0" max="1" step="0.01" .value=${deck.volume} @input=${(e: Event) => this.handleVolumeChange(deckType, e)}>
            </div>
            <div class="buttons">
              <button @click=${() => this.togglePlay(deckType)}>${deck.isPlaying ? 'Pause' : 'Play'}</button>
              <label class="file-input-label">
                  Load
                  <input type="file" accept=".mp3, .wav, .ogg" @change=${(e: Event) => this.handleFileChange(deckType, e)}>
              </label>
            </div>
        </div>
      `;
  }

  render() {
    return html`
      <waveform-visualizer .audioNode=${this.masterOut}></waveform-visualizer>
      <div class="mixer">
        ${this.renderDeck('A')}
        <div class="crossfader-section">
            <label>Crossfader</label>
            <input type="range" min="0" max="1" step="0.01" .value=${this.crossfader} @input=${this.handleCrossfaderChange}>
        </div>
        ${this.renderDeck('B')}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dj-mixer-app': DjMixerApp;
  }
}