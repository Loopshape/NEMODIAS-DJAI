/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A simple offline BPM detector.
 * This is a simplified implementation and may not be accurate for all tracks.
 * @param audioBuffer The AudioBuffer of the track to analyze.
 * @returns A promise that resolves to the estimated BPM.
 */
export async function detectBpm(audioBuffer: AudioBuffer): Promise<number> {
  const sampleRate = audioBuffer.sampleRate;
  
  // Use an OfflineAudioContext to process the audio
  // This allows us to apply filters without playing the sound
  const offlineContext = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    sampleRate
  );

  // Create a source node with the buffer
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;

  // Create a low-pass filter to isolate bass and kick drum frequencies
  const filter = offlineContext.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(150, 0); // Isolate frequencies below 150Hz
  filter.Q.setValueAtTime(1, 0);

  source.connect(filter);
  filter.connect(offlineContext.destination);
  source.start(0);

  const filteredBuffer = await offlineContext.startRendering();

  const data = filteredBuffer.getChannelData(0);
  const peaks = getPeaks(data, sampleRate);
  const intervals = getIntervals(peaks);

  if (intervals.length === 0) {
    return 0;
  }

  const tempo = groupIntervals(intervals);
  return Math.round(tempo);
}

/**
 * Identifies peaks in the audio data.
 * A peak is a sample that is larger than its neighbors.
 */
function getPeaks(data: Float32Array, sampleRate: number): number[] {
  const peaks: number[] = [];
  const threshold = 0.3; // A simple threshold to avoid noise
  
  for (let i = 1; i < data.length - 1; i++) {
    if (data[i] > threshold && data[i] > data[i-1] && data[i] > data[i+1]) {
      peaks.push(i / sampleRate);
    }
  }
  return peaks;
}

/**
 * Calculates the time intervals between consecutive peaks.
 */
function getIntervals(peaks: number[]): number[] {
  const intervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    intervals.push(peaks[i] - peaks[i-1]);
  }
  return intervals;
}

/**
 * Groups intervals to find the most likely tempo.
 */
function groupIntervals(intervals: number[]): number {
    const intervalCounts: {interval: number, count: number}[] = [];

    intervals.forEach(interval => {
        // Find a group for the interval
        let found = false;
        intervalCounts.forEach(count => {
            if (Math.abs(count.interval - interval) < 0.01) { // 10ms tolerance
                count.interval = (count.interval * count.count + interval) / (count.count + 1);
                count.count++;
                found = true;
            }
        });
        if (!found) {
            intervalCounts.push({ interval: interval, count: 1 });
        }
    });

    // Find the group with the highest count
    const sortedCounts = intervalCounts.sort((a, b) => b.count - a.count);

    if (sortedCounts.length === 0) {
      return 0;
    }

    let bestInterval = sortedCounts[0].interval;
    let bpm = 60 / bestInterval;

    // Adjust for common octave errors (e.g. detecting 70bpm instead of 140)
    while (bpm < 80) { bpm *= 2; }
    while (bpm > 160) { bpm /= 2; }

    return bpm;
}
