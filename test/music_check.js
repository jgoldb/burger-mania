// Headless soundtrack sanity test: every pattern token must parse to a
// real pitch or drum, every voice must loop in phase with its song, and
// every world theme used by LEVELS needs a song (plus menu + continue).
// Run with: node test/music_check.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const code =
  fs.readFileSync(path.join(root, 'js/levels.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'js/music.js'), 'utf8') + '\n' + `
let fail = 0;
for (const [name, song] of Object.entries(MUSIC.songs)) {
  if (song.steps % 8) {
    console.log('FAIL %s: %s steps is not whole bars', name, song.steps);
    fail++;
  }
  song.voices.forEach((v, i) => {
    // a shorter voice loops on its own length; it must divide the song's
    // or the loop drifts out of phase with the other voices
    if (song.steps % v.at.length) {
      console.log('FAIL %s voice %s: length %s does not divide %s',
        name, i, v.at.length, song.steps);
      fail++;
    }
    v.at.forEach((ev, s) => {
      if (!ev) return;
      if (v.drums) {
        if (!'ksh'.includes(ev.kind)) {
          console.log('FAIL %s voice %s step %s: bad drum "%s"', name, i, s, ev.kind);
          fail++;
        }
      } else if (!isFinite(ev.freq) || ev.freq < 20 || ev.freq > 9000) {
        console.log('FAIL %s voice %s step %s: bad pitch %s', name, i, s, ev.freq);
        fail++;
      }
    });
  });
  console.log('SONG    %s: %s bpm, %s steps, %s voices',
    name, song.bpm, song.steps, song.voices.length);
}
for (const lv of LEVELS) {
  if (!MUSIC.songs[lv.theme]) {
    console.log('FAIL no song for theme "%s" (%s)', lv.theme, lv.name);
    fail++;
  }
}
for (const need of ['menu', 'continue']) {
  if (!MUSIC.songs[need]) {
    console.log('FAIL missing screen song "%s"', need);
    fail++;
  }
}
console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
process.exitCode = fail ? 1 : 0;
`;
eval(code);
