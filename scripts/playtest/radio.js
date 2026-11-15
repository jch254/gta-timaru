// Sit in a car and tune through every station on the dial: for the live ones, report whether the stream
// connected, how long it took and how loud it is next to the invented stations (they should be comparable).
// Needs the network; the live stations are real streams.
//   node scripts/shot.mjs --place cathedral-square --car v8sedan --eval "$(cat scripts/playtest/radio.js)"
const audio = dev.ctx.audio;
audio.unlock();
await sleep(2500);

const mixer = audio.mixer;
const meter = mixer.ac.createAnalyser();
meter.fftSize = 2048;
mixer.music.connect(meter);
const frame = new Float32Array(meter.fftSize);
/** Root-mean-square level on the radio bus over `ms`. */
const level = async (ms) => {
  let sum = 0;
  let n = 0;
  const until = performance.now() + ms;
  while (performance.now() < until) {
    meter.getFloatTimeDomainData(frame);
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    n += frame.length;
    await sleep(50);
  }
  return +Math.sqrt(sum / Math.max(1, n)).toFixed(4);
};

const results = [];
for (const station of audio.radio.stations) {
  audio.radio.set(station.id);
  const live = station.id.startsWith('live-');
  const started = performance.now();
  let state = audio.debug().live;
  if (live) {
    while (performance.now() - started < 20000) {
      state = audio.debug().live;
      if (state === 'playing' || state === 'failed') break;
      await sleep(100);
    }
  }
  const seconds = +((performance.now() - started) / 1000).toFixed(1);
  // Let the fade-in finish (and a generated song get going) before measuring.
  await sleep(live ? 1500 : 2500);
  const rms = await level(live ? 3000 : 4000);
  results.push({ id: station.id, name: station.name, live, state: live ? state : 'generated', seconds, rms });
  console.log('[shot] ' + JSON.stringify(results[results.length - 1]));
}
audio.radio.set(null);
const liveRows = results.filter((r) => r.live);
return {
  stations: results.length,
  live: liveRows.length,
  playing: liveRows.filter((r) => r.state === 'playing').length,
  failed: liveRows.filter((r) => r.state !== 'playing').map((r) => r.name),
  silent: liveRows.filter((r) => r.state === 'playing' && r.rms < 0.005).map((r) => r.name),
  meanLive: +(liveRows.reduce((a, r) => a + r.rms, 0) / Math.max(1, liveRows.length)).toFixed(4),
  meanGenerated: +(results.filter((r) => !r.live).reduce((a, r) => a + r.rms, 0) / Math.max(1, results.length - liveRows.length)).toFixed(4),
  errors: audio.debug().errors,
};
