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
  bass: number;
  mid: number;
  treble: number;
  bassFilter: BiquadFilterNode | null;
  midFilter: BiquadFilterNode | null;
  trebleFilter: BiquadFilterNode | null;
  filter: number;
  delayMix: number;
  delayTime: number;
  filterNode: BiquadFilterNode | null;
  delayNode: DelayNode | null;
  delayFeedbackNode: GainNode | null;
  delayWetGainNode: GainNode | null;
  delayDryGainNode: GainNode | null;
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
    bass: 0,
    mid: 0,
    treble: 0,
    bassFilter: null,
    midFilter: null,
    trebleFilter: null,
    filter: 0,
    delayMix: 0,
    delayTime: 0.5,
    filterNode: null,
    delayNode: null,
    delayFeedbackNode: null,
    delayWetGainNode: null,
    delayDryGainNode: null,
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
    bass: 0,
    mid: 0,
    treble: 0,
    bassFilter: null,
    midFilter: null,
    trebleFilter: null,
    filter: 0,
    delayMix: 0,
    delayTime: 0.5,
    filterNode: null,
    delayNode: null,
    delayFeedbackNode: null,
    delayWetGainNode: null,
    delayDryGainNode: null,
  };

  @state() private crossfader = 0.5;
  @state() private crossfaderCurve: 'smooth' | 'sharp' = 'smooth';
  @state() private masterVolume = 1;
  @state() private micVolume = 0;
  @state() private isMicOn = false;
  @state() private micEchoMix = 0;
  @state() private micEchoTime = 0.5;
  @state() private masterReverbAmount = 0;
  @state() private midiStatus = 'Disconnected';


  private audioCtx: AudioContext;
  private deckAGain: GainNode;
  private deckBGain: GainNode;
  private masterGain: GainNode;

  private micSourceNode?: MediaStreamAudioSourceNode;
  private micGainNode?: GainNode;
  private micOnAirGain?: GainNode;
  private micEchoWetGain?: GainNode;
  private micEchoDryGain?: GainNode;
  private micEchoDelay?: DelayNode;
  private micEchoFeedback?: GainNode;

  private masterReverbWetGain?: GainNode;
  private masterReverbDryGain?: GainNode;
  private masterReverbNode?: ConvolverNode;

  constructor() {
    super();
    this.audioCtx = new window.AudioContext();
    this.deckAGain = this.audioCtx.createGain();
    this.deckBGain = this.audioCtx.createGain();
    this.masterGain = this.audioCtx.createGain();

    this.deckAGain.connect(this.masterGain);
    this.deckBGain.connect(this.masterGain);
    this.masterGain.connect(this.audioCtx.destination);
    this.updateCrossfaderGains();
  }

  async firstUpdated() {
    this.setupMidi();
    this.setupMasterFx();
  }
  
  setupMasterFx() {
    this.masterReverbWetGain = this.audioCtx.createGain();
    this.masterReverbDryGain = this.audioCtx.createGain();
    this.masterReverbNode = this.audioCtx.createConvolver();
    
    // Generate a simple impulse response for reverb
    const sampleRate = this.audioCtx.sampleRate;
    const duration = 1.5;
    const decay = 2.0;
    const bufferSize = sampleRate * duration;
    const buffer = this.audioCtx.createBuffer(2, bufferSize, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < bufferSize; i++) {
            channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, decay);
        }
    }
    this.masterReverbNode.buffer = buffer;
    
    // Disconnect direct connections to masterGain
    this.deckAGain.disconnect(this.masterGain);
    this.deckBGain.disconnect(this.masterGain);
    
    // Route through reverb wet/dry gains
    this.deckAGain.connect(this.masterReverbWetGain);
    this.deckBGain.connect(this.masterReverbWetGain);
    
    this.deckAGain.connect(this.masterReverbDryGain);
    this.deckBGain.connect(this.masterReverbDryGain);

    this.masterReverbWetGain.connect(this.masterReverbNode);
    this.masterReverbNode.connect(this.masterGain);
    this.masterReverbDryGain.connect(this.masterGain);

    this.updateMasterReverb();
}


  private async setupMidi() {
    try {
      const midiAccess = await navigator.requestMIDIAccess();
      if (midiAccess.inputs.size > 0) {
        this.midiStatus = 'Connected';
        midiAccess.inputs.forEach(input => {
          input.onmidimessage = this.handleMidiMessage.bind(this);
        });
      } else {
        this.midiStatus = 'No MIDI devices found';
      }
    } catch (error) {
      console.error('MIDI access denied.', error);
      this.midiStatus = 'MIDI access denied';
    }
  }

  private handleMidiMessage(event: MIDIMessageEvent) {
    const [command, note, value] = event.data;
    const normalizedValue = value / 127;
  
    // CC messages
    if (command === 176) {
      switch (note) {
        case 1: this.handleVolumeChange('A', normalizedValue); break;
        case 2: this.handleVolumeChange('B', normalizedValue); break;
        case 3: this.handleMicVolumeChange(normalizedValue); break;
        case 4: this.handleMasterVolumeChange(normalizedValue); break;
        case 8: this.handleCrossfaderChange(normalizedValue); break;
        // Deck A EQ
        case 20: this.handleEqChange('A', 'bass', (normalizedValue * 2) - 1); break;
        case 21: this.handleEqChange('A', 'mid', (normalizedValue * 2) - 1); break;
        case 22: this.handleEqChange('A', 'treble', (normalizedValue * 2) - 1); break;
        // Deck B EQ
        case 23: this.handleEqChange('B', 'bass', (normalizedValue * 2) - 1); break;
        case 24: this.handleEqChange('B', 'mid', (normalizedValue * 2) - 1); break;
        case 25: this.handleEqChange('B', 'treble', (normalizedValue * 2) - 1); break;
        // FX
        case 9: this.handleFilterChange('A', (normalizedValue * 2) - 1); break;
        case 10: this.handleDelayMixChange('A', normalizedValue); break;
        case 11: this.handleDelayTimeChange('A', normalizedValue); break;
        case 12: this.handleFilterChange('B', (normalizedValue * 2) - 1); break;
        case 13: this.handleDelayMixChange('B', normalizedValue); break;
        case 14: this.handleDelayTimeChange('B', normalizedValue); break;
        case 15: this.handleMicEchoMixChange(normalizedValue); break;
        case 16: this.handleMicEchoTimeChange(normalizedValue); break;
        case 17: this.handleMasterReverbChange(normalizedValue); break;
      }
    }
  
    // Note On messages
    if (command === 144) {
      switch (note) {
        case 36: this.togglePlay('A'); break; // C2
        case 37: this.togglePlay('B'); break; // C#2
        case 38: this.toggleMic(); break; // D2
        case 39: this.handleSync('A'); break; // D#2
        case 40: this.handleSync('B'); break; // E2
      }
    }
  }

  private async setupMicrophone() {
    if (!this.micSourceNode) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.micSourceNode = this.audioCtx.createMediaStreamSource(stream);
        this.micOnAirGain = this.audioCtx.createGain();
        this.micGainNode = this.audioCtx.createGain();

        // Echo FX Chain
        this.micEchoWetGain = this.audioCtx.createGain();
        this.micEchoDryGain = this.audioCtx.createGain();
        this.micEchoDelay = this.audioCtx.createDelay(2.0);
        this.micEchoFeedback = this.audioCtx.createGain();

        this.micEchoDelay.connect(this.micEchoFeedback);
        this.micEchoFeedback.connect(this.micEchoDelay);

        this.micSourceNode.connect(this.micOnAirGain);
        
        this.micOnAirGain.connect(this.micEchoWetGain);
        this.micEchoWetGain.connect(this.micEchoDelay);
        this.micEchoDelay.connect(this.micGainNode);

        this.micOnAirGain.connect(this.micEchoDryGain);
        this.micEchoDryGain.connect(this.micGainNode);
        
        // Connect mic output to master reverb chain
        this.micGainNode.connect(this.masterReverbWetGain!);
        this.micGainNode.connect(this.masterReverbDryGain!);
        
        this.micGainNode.gain.value = this.micVolume;
        this.micOnAirGain.gain.value = this.isMicOn ? 1 : 0;
        this.updateMicEcho();

      } catch (err) {
        console.error('Error accessing microphone:', err);
        this.isMicOn = false;
      }
    }
  }

  private async loadFile(deck: 'A' | 'B', event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const deckState = deck === 'A' ? this.deckA : this.deckB;
      const updateDeck = (newState: Partial<DeckState>) => {
        if (deck === 'A') {
          this.deckA = { ...this.deckA, ...newState };
        } else {
          this.deckB = { ...this.deckB, ...newState };
        }
      };

      updateDeck({ fileName: file.name, isDetectingBpm: true });

      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);

      if (deckState.sourceNode) {
        deckState.sourceNode.disconnect();
      }

      updateDeck({ audioBuffer, isPlaying: false, playbackRate: 1, pitch: 0 });

      detectBpm(audioBuffer).then(bpm => {
        updateDeck({ originalBpm: bpm, currentBpm: bpm, isDetectingBpm: false });
      });

      this.createDeckAudioGraph(deck);
    }
  }

  private createDeckAudioGraph(deck: 'A' | 'B') {
    let d = deck === 'A' ? this.deckA : this.deckB;

    if (d.gainNode) d.gainNode.disconnect();
    if (d.bassFilter) d.bassFilter.disconnect();
    if (d.midFilter) d.midFilter.disconnect();
    if (d.trebleFilter) d.trebleFilter.disconnect();
    if (d.filterNode) d.filterNode.disconnect();

    const gainNode = this.audioCtx.createGain();
    const bassFilter = this.audioCtx.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 320;
    const midFilter = this.audioCtx.createBiquadFilter();
    midFilter.type = 'peaking';
    midFilter.frequency.value = 1000;
    midFilter.Q.value = 0.5;
    const trebleFilter = this.audioCtx.createBiquadFilter();
    trebleFilter.type = 'highshelf';
    trebleFilter.frequency.value = 3200;

    const filterNode = this.audioCtx.createBiquadFilter();
    filterNode.type = 'allpass';
    
    // Delay FX chain
    const delayWetGain = this.audioCtx.createGain();
    const delayDryGain = this.audioCtx.createGain();
    const delayNode = this.audioCtx.createDelay(2.0);
    const feedbackNode = this.audioCtx.createGain();
    
    delayNode.connect(feedbackNode);
    feedbackNode.connect(delayNode);
    
    const deckGain = deck === 'A' ? this.deckAGain : this.deckBGain;
    
    // Connect EQ
    gainNode.connect(bassFilter);
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);
    trebleFilter.connect(filterNode);

    // Connect Delay
    filterNode.connect(delayWetGain);
    delayWetGain.connect(delayNode);
    delayNode.connect(deckGain);
    
    filterNode.connect(delayDryGain);
    delayDryGain.connect(deckGain);

    if (deck === 'A') {
      this.deckA = { ...this.deckA, gainNode, bassFilter, midFilter, trebleFilter, filterNode, delayNode, delayFeedbackNode: feedbackNode, delayWetGainNode: delayWetGain, delayDryGainNode: delayDryGain };
    } else {
      this.deckB = { ...this.deckB, gainNode, bassFilter, midFilter, trebleFilter, filterNode, delayNode, delayFeedbackNode: feedbackNode, delayWetGainNode: delayWetGain, delayDryGainNode: delayDryGain };
    }
    this.updateAllDeckParams(deck);
  }

  private play(deck: 'A' | 'B') {
    let d = deck === 'A' ? this.deckA : this.deckB;
    if (!d.audioBuffer || !d.gainNode) return;

    if (d.sourceNode) {
      d.sourceNode.disconnect();
    }
    
    const source = this.audioCtx.createBufferSource();
    source.buffer = d.audioBuffer;
    source.connect(d.gainNode);
    source.playbackRate.value = d.playbackRate;
    source.start(0);

    if (deck === 'A') {
      this.deckA = { ...this.deckA, sourceNode: source, isPlaying: true };
    } else {
      this.deckB = { ...this.deckB, sourceNode: source, isPlaying: true };
    }
  }

  private stop(deck: 'A' | 'B') {
    let d = deck === 'A' ? this.deckA : this.deckB;
    if (d.sourceNode) {
      d.sourceNode.stop();
    }
    if (deck === 'A') {
      this.deckA = { ...this.deckA, sourceNode: null, isPlaying: false };
    } else {
      this.deckB = { ...this.deckB, sourceNode: null, isPlaying: false };
    }
  }

  private togglePlay(deck: 'A' | 'B') {
    const d = deck === 'A' ? this.deckA : this.deckB;
    if (d.isPlaying) {
      this.stop(deck);
    } else {
      this.play(deck);
    }
  }

  private async toggleMic() {
    await this.setupMicrophone();
    this.isMicOn = !this.isMicOn;
    if (this.micOnAirGain) {
      this.micOnAirGain.gain.setTargetAtTime(this.isMicOn ? 1 : 0, this.audioCtx.currentTime, 0.01);
    }
  }
  
  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('crossfader') || changedProperties.has('crossfaderCurve')) {
      this.updateCrossfaderGains();
    }
    if (changedProperties.has('deckA')) {
        this.updateAllDeckParams('A');
    }
    if (changedProperties.has('deckB')) {
        this.updateAllDeckParams('B');
    }
    if (changedProperties.has('masterVolume')) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.audioCtx.currentTime, 0.01);
    }
    if (changedProperties.has('micVolume') && this.micGainNode) {
      this.micGainNode.gain.setTargetAtTime(this.micVolume, this.audioCtx.currentTime, 0.01);
    }
    if (changedProperties.has('micEchoMix') || changedProperties.has('micEchoTime')) {
        this.updateMicEcho();
    }
    if (changedProperties.has('masterReverbAmount')) {
        this.updateMasterReverb();
    }
  }

  private updateAllDeckParams(deck: 'A' | 'B') {
    const d = deck === 'A' ? this.deckA : this.deckB;
    if (!d.gainNode || !d.bassFilter || !d.midFilter || !d.trebleFilter || !d.filterNode || !d.delayDryGainNode || !d.delayWetGainNode || !d.delayNode || !d.delayFeedbackNode) return;

    d.gainNode.gain.setTargetAtTime(d.volume, this.audioCtx.currentTime, 0.01);
    if (d.sourceNode) {
        d.sourceNode.playbackRate.setTargetAtTime(d.playbackRate, this.audioCtx.currentTime, 0.01);
    }
    d.bassFilter.gain.setTargetAtTime(d.bass, this.audioCtx.currentTime, 0.01);
    d.midFilter.gain.setTargetAtTime(d.mid, this.audioCtx.currentTime, 0.01);
    d.trebleFilter.gain.setTargetAtTime(d.treble, this.audioCtx.currentTime, 0.01);
    
    // Filter
    const filterValue = d.filter;
    if (filterValue === 0) {
        d.filterNode.type = 'allpass';
        d.filterNode.frequency.value = this.audioCtx.sampleRate / 2;
    } else {
        const maxFreq = this.audioCtx.sampleRate / 2;
        const minFreq = 20;
        const range = Math.log(maxFreq / minFreq);
        let freq;
        if (filterValue > 0) { // LPF
            d.filterNode.type = 'lowpass';
            freq = minFreq * Math.exp(range * (1 - filterValue));
        } else { // HPF
            d.filterNode.type = 'highpass';
            const v = filterValue + 1; // map -1..0 to 0..1
            freq = minFreq * Math.exp(range * v);
        }
        d.filterNode.frequency.setTargetAtTime(freq, this.audioCtx.currentTime, 0.01);
    }

    // Delay
    d.delayDryGainNode.gain.setTargetAtTime(1 - d.delayMix, this.audioCtx.currentTime, 0.01);
    d.delayWetGainNode.gain.setTargetAtTime(d.delayMix, this.audioCtx.currentTime, 0.01);
    d.delayNode.delayTime.setTargetAtTime(d.delayTime * 2.0, this.audioCtx.currentTime, 0.01);
    d.delayFeedbackNode.gain.setTargetAtTime(d.delayTime * 0.9, this.audioCtx.currentTime, 0.01); // Feedback tied to time
  }

  private updateMicEcho() {
    if (!this.micEchoDryGain || !this.micEchoWetGain || !this.micEchoDelay || !this.micEchoFeedback) return;
    this.micEchoDryGain.gain.setTargetAtTime(1 - this.micEchoMix, this.audioCtx.currentTime, 0.01);
    this.micEchoWetGain.gain.setTargetAtTime(this.micEchoMix, this.audioCtx.currentTime, 0.01);
    this.micEchoDelay.delayTime.setTargetAtTime(this.micEchoTime * 2.0, this.audioCtx.currentTime, 0.01);
    this.micEchoFeedback.gain.setTargetAtTime(this.micEchoTime * 0.9, this.audioCtx.currentTime, 0.01);
  }

  private updateMasterReverb() {
    if (!this.masterReverbDryGain || !this.masterReverbWetGain) return;
    this.masterReverbDryGain.gain.setTargetAtTime(1, this.audioCtx.currentTime, 0.01); // Dry is always full
    this.masterReverbWetGain.gain.setTargetAtTime(this.masterReverbAmount, this.audioCtx.currentTime, 0.01);
  }

  private updateCrossfaderGains() {
    let gainA, gainB;
    const x = this.crossfader;

    if (this.crossfaderCurve === 'smooth') {
      // Constant power curve
      gainA = Math.cos(x * 0.5 * Math.PI);
      gainB = Math.cos((1.0 - x) * 0.5 * Math.PI);
    } else {
      // Sharp (linear) curve
      gainA = 1.0 - x;
      gainB = x;
    }

    this.deckAGain.gain.setTargetAtTime(gainA, this.audioCtx.currentTime, 0.01);
    this.deckBGain.gain.setTargetAtTime(gainB, this.audioCtx.currentTime, 0.01);
  }
  
  private handleVolumeChange(deck: 'A' | 'B', value: number) {
    const volume = value;
    if (deck === 'A') {
      this.deckA = { ...this.deckA, volume };
    } else {
      this.deckB = { ...this.deckB, volume };
    }
  }

  private handlePitchChange(deck: 'A' | 'B', event: Event) {
    const target = event.target as HTMLInputElement;
    const pitch = parseFloat(target.value);
    const playbackRate = Math.pow(2, pitch / 1200);
    const d = deck === 'A' ? this.deckA : this.deckB;
    const currentBpm = d.originalBpm ? d.originalBpm * playbackRate : null;

    if (deck === 'A') {
      this.deckA = { ...this.deckA, pitch, playbackRate, currentBpm };
    } else {
      this.deckB = { ...this.deckB, pitch, playbackRate, currentBpm };
    }
  }

  private handleSync(deck: 'A' | 'B') {
    const sourceDeck = deck === 'A' ? this.deckA : this.deckB;
    const targetDeck = deck === 'A' ? this.deckB : this.deckA;

    if (!targetDeck.currentBpm || !sourceDeck.originalBpm || sourceDeck.originalBpm === 0) {
      console.warn('Cannot sync: missing BPM data.');
      return;
    }

    const newPlaybackRate = targetDeck.currentBpm / sourceDeck.originalBpm;
    const pitch = 1200 * Math.log2(newPlaybackRate);

    if (deck === 'A') {
      this.deckA = {
        ...this.deckA,
        playbackRate: newPlaybackRate,
        pitch,
        currentBpm: targetDeck.currentBpm,
      };
    } else {
      this.deckB = {
        ...this.deckB,
        playbackRate: newPlaybackRate,
        pitch,
        currentBpm: targetDeck.currentBpm,
      };
    }
  }

  private handleCrossfaderChange(value: number) {
    this.crossfader = value;
  }

  private handleMasterVolumeChange(value: number) {
    this.masterVolume = value;
  }

  private handleMicVolumeChange(value: number) {
    this.micVolume = value;
  }
  
  private handleEqChange(deck: 'A' | 'B', band: 'bass' | 'mid' | 'treble', value: number) {
    const gain = value * 6; // -6dB to +6dB, but let's do more cut
    const finalGain = value > 0 ? value * 6 : value * 24;

    if (deck === 'A') {
        this.deckA = { ...this.deckA, [band]: finalGain };
    } else {
        this.deckB = { ...this.deckB, [band]: finalGain };
    }
  }

  private handleFilterChange(deck: 'A' | 'B', value: number) {
    if (deck === 'A') {
      this.deckA = { ...this.deckA, filter: value };
    } else {
      this.deckB = { ...this.deckB, filter: value };
    }
  }

  private handleDelayMixChange(deck: 'A' | 'B', value: number) {
    if (deck === 'A') {
      this.deckA = { ...this.deckA, delayMix: value };
    } else {
      this.deckB = { ...this.deckB, delayMix: value };
    }
  }

  private handleDelayTimeChange(deck: 'A' | 'B', value: number) {
    if (deck === 'A') {
      this.deckA = { ...this.deckA, delayTime: value };
    } else {
      this.deckB = { ...this.deckB, delayTime: value };
    }
  }

  private handleMicEchoMixChange(value: number) {
    this.micEchoMix = value;
  }

  private handleMicEchoTimeChange(value: number) {
    this.micEchoTime = value;
  }

  private handleMasterReverbChange(value: number) {
    this.masterReverbAmount = value;
  }

  private resetPitch(deck: 'A' | 'B') {
    const d = deck === 'A' ? this.deckA : this.deckB;
    const currentBpm = d.originalBpm;
    if (deck === 'A') {
      this.deckA = { ...this.deckA, pitch: 0, playbackRate: 1, currentBpm };
    } else {
      this.deckB = { ...this.deckB, pitch: 0, playbackRate: 1, currentBpm };
    }
  }
  
  static styles = css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      background-color: #1a1a1a;
      color: #e0e0e0;
      font-family: 'Roboto Mono', monospace;
    }
    .mixer {
      display: grid;
      /* Mobile-first: 2 columns */
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 120px 1fr 1fr 50px auto;
      gap: 10px;
      padding: 10px;
      height: calc(100vh - 20px);
      box-sizing: border-box;
    }
    .waveform-display {
      grid-column: 1 / -1;
      grid-row: 1;
      background-color: #000;
      border-radius: 8px;
      border: 1px solid #444;
      overflow: hidden;
    }
    .channel-deck-a { grid-column: 1; grid-row: 2; }
    .channel-deck-b { grid-column: 2; grid-row: 2; }
    .channel-mic { grid-column: 1; grid-row: 3; }
    .channel-master { grid-column: 2; grid-row: 3; }
    .crossfader-section {
      grid-column: 1 / -1;
      grid-row: 4;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }
    .status-bar {
      grid-column: 1 / -1;
      grid-row: 5;
      text-align: center;
      font-size: 0.8em;
      color: #666;
    }
    
    /* Desktop Layout */
    @media (min-width: 1024px) {
      .mixer {
        grid-template-columns: repeat(4, 1fr);
        grid-template-rows: 150px 1fr 50px auto;
        padding: 20px;
        height: calc(100vh - 40px);
      }
      .waveform-display { grid-row: 1; }
      .channel-deck-a { grid-column: 1; grid-row: 2; }
      .channel-deck-b { grid-column: 2; grid-row: 2; }
      .channel-mic { grid-column: 3; grid-row: 2; }
      .channel-master { grid-column: 4; grid-row: 2; }
      .crossfader-section { grid-row: 3; }
      .status-bar { grid-row: 4; }
    }

    .channel {
      background-color: #2a2a2a;
      padding: 15px;
      border-radius: 8px;
      border: 1px solid #444;
      display: flex;
      flex-direction: column;
      gap: 15px;
    }
    .channel h3 {
      text-align: center;
      margin: 0 0 10px 0;
      color: #00bcd4;
    }
    .controls {
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: center;
    }
    .fader-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
    }
    label {
      font-size: 0.75em;
      margin-bottom: 5px;
    }
    input[type="range"] {
      -webkit-appearance: none;
      width: 80%;
      height: 10px;
      background: #444;
      border-radius: 5px;
      outline: none;
    }
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 20px;
      height: 20px;
      background: #00bcd4;
      cursor: pointer;
      border-radius: 50%;
    }
    .file-upload-label {
        cursor: pointer;
        background: #333;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 0.8em;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
        display: block;
    }
    .file-upload-label:hover {
        background: #444;
    }
    .bpm-display {
      font-size: 0.9em;
      text-align: center;
      color: #999;
      flex-grow: 1;
    }
    .button {
        width: 80%;
        padding: 10px;
        border: none;
        border-radius: 5px;
        background-color: #008c9e;
        color: white;
        cursor: pointer;
        font-family: 'Roboto Mono', monospace;
    }
    .button.playing {
        background-color: #ff4081;
    }
    .button:hover {
        opacity: 0.9;
    }
    .eq-controls, .fx-controls {
        width: 100%;
        border: 1px solid #333;
        border-radius: 4px;
        padding: 10px;
        margin-top: 5px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: center;
    }
    .eq-label, .fx-label {
        font-size: 0.8em;
        color: #888;
        text-align: center;
        width: 100%;
        margin-bottom: 5px;
        border-bottom: 1px solid #444;
        padding-bottom: 5px;
    }
    .crossfader-controls {
      display: flex;
      width: 50%;
      align-items: center;
      gap: 15px;
    }
    .curve-toggle {
        font-size: 0.8em;
        padding: 5px 10px;
        background-color: #333;
        border: 1px solid #555;
        border-radius: 4px;
        cursor: pointer;
    }
    .curve-toggle.active {
        background-color: #00bcd4;
        color: #1a1a1a;
    }
    .mic-on-air.on {
      background-color: #ff4081;
    }
    .bpm-sync-container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      gap: 10px;
    }
    .sync-button {
      padding: 5px 10px;
      border: none;
      border-radius: 4px;
      background-color: #333;
      color: #00bcd4;
      cursor: pointer;
      font-family: 'Roboto Mono', monospace;
      font-size: 0.8em;
      border: 1px solid #00bcd4;
      flex-shrink: 0;
    }
    .sync-button:hover {
      background-color: #00bcd4;
      color: #1a1a1a;
    }
  `;

  render() {
    return html`
      <div class="mixer">
        <div class="waveform-display">
          <waveform-visualizer .audioNode=${this.masterGain}></waveform-visualizer>
        </div>

        <!-- Deck A -->
        <div class="channel channel-deck-a">
          <h3>DECK A</h3>
          <label class="file-upload-label" for="deckA-file">${this.deckA.fileName}</label>
          <input id="deckA-file" type="file" @change=${(e: Event) => this.loadFile('A', e)} accept="audio/*" style="display: none;">
          <button class="button ${this.deckA.isPlaying ? 'playing' : ''}" @click=${() => this.togglePlay('A')}>
            ${this.deckA.isPlaying ? 'PAUSE' : 'PLAY'}
          </button>
          <div class="bpm-sync-container">
            <div class="bpm-display">
              BPM: ${this.deckA.isDetectingBpm ? '...' : this.deckA.currentBpm?.toFixed(1) ?? 'N/A'}
            </div>
            <button class="sync-button" @click=${() => this.handleSync('A')}>SYNC</button>
          </div>
          <div class="fader-container">
            <label>Volume</label>
            <input type="range" min="0" max="1" step="0.01" .value=${this.deckA.volume} @input=${(e: Event) => this.handleVolumeChange('A', parseFloat((e.target as HTMLInputElement).value))}>
            <label>Pitch</label>
            <input type="range" min="-1200" max="1200" step="1" .value=${this.deckA.pitch} @input=${(e: Event) => this.handlePitchChange('A', e)} @dblclick=${() => this.resetPitch('A')}>
          </div>
          <div class="eq-controls">
              <span class="eq-label">EQ</span>
              <label>Treble</label>
              <input type="range" min="-1" max="1" step="0.01" .value=${this.deckA.treble / 6} @input=${(e: Event) => this.handleEqChange('A', 'treble', parseFloat((e.target as HTMLInputElement).value))}>
              <label>Mid</label>
              <input type="range" min="-1" max="1" step="0.01" .value=${this.deckA.mid / 6} @input=${(e: Event) => this.handleEqChange('A', 'mid', parseFloat((e.target as HTMLInputElement).value))}>
              <label>Bass</label>
              <input type="range" min="-1" max="1" step="0.01" .value=${this.deckA.bass / 6} @input=${(e: Event) => this.handleEqChange('A', 'bass', parseFloat((e.target as HTMLInputElement).value))}>
          </div>
          <div class="fx-controls">
              <span class="fx-label">FX</span>
              <label>Filter (HP/LP)</label>
              <input type="range" min="-1" max="1" step="0.01" .value=${this.deckA.filter} @input=${(e: Event) => this.handleFilterChange('A', parseFloat((e.target as HTMLInputElement).value))}>
              <label>Delay Mix</label>
              <input type="range" min="0" max="1" step="0.01" .value=${this.deckA.delayMix} @input=${(e: Event) => this.handleDelayMixChange('A', parseFloat((e.target as HTMLInputElement).value))}>
              <label>Delay Time</label>
              <input type="range" min="0" max="1" step="0.01" .value=${this.deckA.delayTime} @input=${(e: Event) => this.handleDelayTimeChange('A', parseFloat((e.target as HTMLInputElement).value))}>
          </div>
        </div>

        <!-- Deck B -->
        <div class="channel channel-deck-b">
          <h3>DECK B</h3>
          <label class="file-upload-label" for="deckB-file">${this.deckB.fileName}</label>
          <input id="deckB-file" type="file" @change=${(e: Event) => this.loadFile('B', e)} accept="audio/*" style="display: none;">
          <button class="button ${this.deckB.isPlaying ? 'playing' : ''}" @click=${() => this.togglePlay('B')}>
            ${this.deckB.isPlaying ? 'PAUSE' : 'PLAY'}
          </button>
          <div class="bpm-sync-container">
            <div class="bpm-display">
              BPM: ${this.deckB.isDetectingBpm ? '...' : this.deckB.currentBpm?.toFixed(1) ?? 'N/A'}
            </div>
            <button class="sync-button" @click=${() => this.handleSync('B')}>SYNC</button>
          </div>
          <div class="fader-container">
            <label>Volume</label>
            <input type="range" min="0" max="1" step="0.01" .value=${this.deckB.volume} @input=${(e: Event) => this.handleVolumeChange('B', parseFloat((e.target as HTMLInputElement).value))}>
            <label>Pitch</label>
            <input type="range" min="-1200" max="1200" step="1" .value=${this.deckB.pitch} @input=${(e: Event) => this.handlePitchChange('B', e)} @dblclick=${() => this.resetPitch('B')}>
          </div>
           <div class="eq-controls">
              <span class="eq-label">EQ</span>
              <label>Treble</label>
              <input type="range" min="-1" max="1" step="0.01" .value=${this.deckB.treble / 6} @input=${(e: Event) => this.handleEqChange('B', 'treble', parseFloat((e.target as HTMLInputElement).value))}>
              <label>Mid</label>
              <input type="range" min="-1" max="1" step="0.01" .value=${this.deckB.mid / 6} @input=${(e: Event) => this.handleEqChange('B', 'mid', parseFloat((e.target as HTMLInputElement).value))}>
              <label>Bass</label>
              <input type="range" min="-1" max="1" step="0.01" .value=${this.deckB.bass / 6} @input=${(e: Event) => this.handleEqChange('B', 'bass', parseFloat((e.target as HTMLInputElement).value))}>
          </div>
          <div class="fx-controls">
              <span class="fx-label">FX</span>
              <label>Filter (HP/LP)</label>
              <input type="range" min="-1" max="1" step="0.01" .value=${this.deckB.filter} @input=${(e: Event) => this.handleFilterChange('B', parseFloat((e.target as HTMLInputElement).value))}>
              <label>Delay Mix</label>
              <input type="range" min="0" max="1" step="0.01" .value=${this.deckB.delayMix} @input=${(e: Event) => this.handleDelayMixChange('B', parseFloat((e.target as HTMLInputElement).value))}>
              <label>Delay Time</label>
              <input type="range" min="0" max="1" step="0.01" .value=${this.deckB.delayTime} @input=${(e: Event) => this.handleDelayTimeChange('B', parseFloat((e.target as HTMLInputElement).value))}>
          </div>
        </div>

        <!-- Mic Channel -->
        <div class="channel channel-mic">
            <h3>MIC</h3>
            <button class="button mic-on-air ${this.isMicOn ? 'on' : ''}" @click=${this.toggleMic}>
              ${this.isMicOn ? 'ON AIR' : 'OFF AIR'}
            </button>
            <div class="fader-container">
              <label>Volume</label>
              <input type="range" min="0" max="1" step="0.01" .value=${this.micVolume} @input=${(e: Event) => this.handleMicVolumeChange(parseFloat((e.target as HTMLInputElement).value))}>
            </div>
            <div class="fx-controls">
              <span class="fx-label">ECHO</span>
              <label>Mix</label>
              <input type="range" min="0" max="1" step="0.01" .value=${this.micEchoMix} @input=${(e: Event) => this.handleMicEchoMixChange(parseFloat((e.target as HTMLInputElement).value))}>
              <label>Time</label>
              <input type="range" min="0" max="1" step="0.01" .value=${this.micEchoTime} @input=${(e: Event) => this.handleMicEchoTimeChange(parseFloat((e.target as HTMLInputElement).value))}>
            </div>
        </div>

        <!-- Master Channel -->
        <div class="channel channel-master">
            <h3>MASTER</h3>
            <div class="fader-container">
              <label>Volume</label>
              <input type="range" min="0" max="1" step="0.01" .value=${this.masterVolume} @input=${(e: Event) => this.handleMasterVolumeChange(parseFloat((e.target as HTMLInputElement).value))}>
            </div>
            <div class="fx-controls">
              <span class="fx-label">REVERB</span>
              <label>Amount</label>
              <input type="range" min="0" max="1" step="0.01" .value=${this.masterReverbAmount} @input=${(e: Event) => this.handleMasterReverbChange(parseFloat((e.target as HTMLInputElement).value))}>
            </div>
        </div>

        <div class="crossfader-section">
          <div class="crossfader-controls">
            <button class="curve-toggle ${this.crossfaderCurve === 'smooth' ? 'active' : ''}" @click=${() => this.crossfaderCurve = 'smooth'}>Smooth</button>
            <input type="range" min="0" max="1" step="0.01" .value=${this.crossfader} @input=${(e: Event) => this.handleCrossfaderChange(parseFloat((e.target as HTMLInputElement).value))}>
            <button class="curve-toggle ${this.crossfaderCurve === 'sharp' ? 'active' : ''}" @click=${() => this.crossfaderCurve = 'sharp'}>Sharp</button>
          </div>
        </div>

        <div class="status-bar">
          MIDI Status: ${this.midiStatus}
        </div>
      </div>
    `;
  }
}