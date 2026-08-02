/* WCA Editor — a minimal browser video editor.
 *
 * Pipeline (all built-in, no libraries):
 *   <video> + <audio> decode  ->  drawn onto a <canvas> every frame with
 *   the caption + watermark composited on top  ->  canvas.captureStream()
 *   mixed with a WebAudio graph  ->  MediaRecorder writes a .webm.
 *
 * It's deliberately single-clip for v1: import a video, trim it, add a
 * caption, drop music under it, stamp the WCA logo, export. Multi-clip
 * timeline and WebCodecs MP4 export are the next milestones.
 */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // ----- elements -----
  const video = document.createElement("video");
  video.playsInline = true; video.crossOrigin = "anonymous";
  // Audible during preview so editing has sound; the slider controls it.
  video.muted = false; video.volume = 1;
  const music = document.createElement("audio");
  music.crossOrigin = "anonymous";
  // A detached media element plays SILENTLY in Chrome -- the audio output is
  // only wired up once the element is in the document. Keep both hidden but
  // attached so the preview actually makes sound.
  video.style.display = "none";
  music.style.display = "none";
  document.body.appendChild(video);
  document.body.appendChild(music);

  const canvas = $("preview"), ctx = canvas.getContext("2d");
  const els = {
    stageHint: $("stageHint"), info: $("info"),
    play: $("playBtn"), timeLabel: $("timeLabel"), trimLabel: $("trimLabel"),
    clip: $("clip"), dimL: $("dimL"), dimR: $("dimR"),
    trimL: $("trimL"), trimR: $("trimR"), playhead: $("playhead"),
    vtrack: $("vtrack"), aEmpty: $("aEmpty"),
    capText: $("capText"), capPos: $("capPos"), capSize: $("capSize"),
    capSizeVal: $("capSizeVal"), capColor: $("capColor"), capOutline: $("capOutline"),
    wmOn: $("wmOn"), musVol: $("musVol"), musVolVal: $("musVolVal"),
    vidVol: $("vidVol"), vidVolVal: $("vidVolVal"),
    exportBtn: $("exportBtn"), expOverlay: $("expOverlay"), expBar: $("expBar"), expMsg: $("expMsg"),
    audioStat: $("audioStat"),
  };

  let hasAudioTrack = null; // null = unknown yet

  // ----- state -----
  let duration = 0;       // full video duration
  let inT = 0, outT = 0;  // trim in/out (seconds)
  let playing = false;
  let hasVideo = false;

  // WCA round logo, drawn as a vector so the app stays a single dependency-free bundle.
  function drawLogo(c, x, y, r) {
    c.save();
    c.translate(x, y);
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2);
    c.fillStyle = "rgba(11,24,38,.92)"; c.fill();
    c.lineWidth = r * 0.09; c.strokeStyle = "#f5b942"; c.stroke();
    c.fillStyle = "#f5b942";
    c.font = `700 ${r * 0.34}px -apple-system,Segoe UI,Roboto,sans-serif`;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("WCA", 0, 0);
    c.restore();
  }

  // ---------- load video ----------
  $("videoInput").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    video.src = URL.createObjectURL(f);
    video.onloadedmetadata = () => {
      duration = video.duration || 0;
      inT = 0; outT = duration;
      canvas.width = video.videoWidth || 720;
      canvas.height = video.videoHeight || 1280;
      hasVideo = true;
      els.stageHint.style.display = "none";
      els.exportBtn.disabled = false;
      seek(0); renderTimeline(); drawFrame();
      els.info.textContent =
        `${video.videoWidth}×${video.videoHeight} · ${duration.toFixed(1)}s · ${(f.size/1048576).toFixed(1)} MB`;
      detectAudioTrack();
    };
  });

  // ---------- load music ----------
  $("musicInput").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    music.src = URL.createObjectURL(f);
    els.aEmpty.textContent = f.name.length > 34 ? f.name.slice(0, 34) + "…" : f.name;
    els.aEmpty.style.color = "#e8eef4";
  });

  // Does the loaded clip actually contain an audio track? captureStream
  // exposes the tracks the element has. This is the fastest way to tell a
  // "player is muted" problem from a "clip has no sound" one.
  function detectAudioTrack() {
    try {
      const cap = video.captureStream || video.mozCaptureStream;
      if (cap) {
        const s = cap.call(video);
        hasAudioTrack = s.getAudioTracks().length > 0;
      } else {
        hasAudioTrack = null;
      }
    } catch (_) { hasAudioTrack = null; }
    updateAudioStat();
  }

  function updateAudioStat() {
    const el = els.audioStat;
    if (hasAudioTrack === false) {
      el.textContent = "🔇 klip TANPA audio";
      el.style.color = "#e5484d";
      return;
    }
    if (!playing) { el.textContent = "🔈 siap"; el.style.color = "#8ba0b3"; return; }
    // While playing, show whether audio is really decoding (Chrome counter).
    const b = video.webkitAudioDecodedByteCount;
    if (typeof b === "number") {
      const moving = b > (updateAudioStat._last || 0);
      updateAudioStat._last = b;
      el.textContent = moving ? "🔊 berbunyi" : "🔈 diam";
      el.style.color = moving ? "#2ecc71" : "#8ba0b3";
    } else {
      el.textContent = "🔊 main";
      el.style.color = "#2ecc71";
    }
  }

  // ---------- draw one composited frame ----------
  function drawFrame() {
    if (!hasVideo) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawCaption();
    if (els.wmOn.checked) {
      const r = canvas.width * 0.075;
      drawLogo(ctx, canvas.width - r - 18, canvas.height - r - 18, r);
    }
  }

  function drawCaption() {
    const text = els.capText.value.trim();
    if (!text) return;
    const size = +els.capSize.value * (canvas.width / 720); // scale to real res
    ctx.font = `700 ${size}px -apple-system,Segoe UI,Roboto,sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const maxW = canvas.width * 0.88;
    const lines = wrap(text, maxW);
    const lh = size * 1.25;
    let y;
    const pos = els.capPos.value;
    if (pos === "top") y = canvas.height * 0.12;
    else if (pos === "center") y = canvas.height * 0.5 - (lines.length - 1) * lh / 2;
    else y = canvas.height * 0.86 - (lines.length - 1) * lh;
    for (const ln of lines) {
      ctx.lineWidth = size * 0.16;
      ctx.strokeStyle = els.capOutline.value || "#000";
      ctx.strokeText(ln, canvas.width / 2, y);
      ctx.fillStyle = els.capColor.value || "#fff";
      ctx.fillText(ln, canvas.width / 2, y);
      y += lh;
    }
  }

  function wrap(text, maxW) {
    const out = [];
    for (const para of text.split("\n")) {
      const words = para.split(" ");
      let line = "";
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; }
        else line = test;
      }
      out.push(line);
    }
    return out;
  }

  // ---------- transport ----------
  function seek(t) {
    t = Math.max(inT, Math.min(outT, t));
    video.currentTime = t;
  }
  video.addEventListener("seeked", () => { drawFrame(); updatePlayhead(); });
  video.addEventListener("timeupdate", () => {
    if (video.currentTime >= outT) { pause(); seek(inT); }
    updatePlayhead();
  });

  function play() {
    if (!hasVideo || playing) return;
    if (video.currentTime < inT || video.currentTime >= outT) seek(inT);
    playing = true; els.play.textContent = "⏸";
    video.volume = +els.vidVol.value / 100;
    video.muted = +els.vidVol.value === 0;
    video.play();
    if (music.src) { music.currentTime = 0; music.volume = +els.musVol.value / 100; music.play(); }
    loop();
  }
  function pause() {
    playing = false; els.play.textContent = "▶";
    video.pause(); music.pause();
  }
  els.play.addEventListener("click", () => (playing ? pause() : play()));

  function loop() {
    if (!playing) return;
    drawFrame();
    updateAudioStat();
    requestAnimationFrame(loop);
  }

  function updatePlayhead() {
    const t = video.currentTime || 0;
    els.timeLabel.textContent = `${(t - inT).toFixed(1)} / ${(outT - inT).toFixed(1)}s`;
    const pct = duration ? (t / duration) : 0;
    els.playhead.style.left = (pct * 100) + "%";
  }

  // ---------- timeline / trim ----------
  function renderTimeline() {
    const lPct = duration ? (inT / duration) : 0;
    const rPct = duration ? (outT / duration) : 1;
    els.trimL.style.left = (lPct * 100) + "%";
    els.trimR.style.left = "calc(" + (rPct * 100) + "% - 12px)";
    els.dimL.style.left = "0"; els.dimL.style.width = (lPct * 100) + "%";
    els.dimR.style.left = (rPct * 100) + "%"; els.dimR.style.right = "0";
    els.dimR.style.width = ((1 - rPct) * 100) + "%";
    els.trimLabel.textContent = `Potong: ${inT.toFixed(1)}s → ${outT.toFixed(1)}s`;
  }

  function dragTrim(which) {
    return (ev) => {
      ev.preventDefault();
      const move = (e) => {
        const rect = els.vtrack.getBoundingClientRect();
        const x = ((e.touches ? e.touches[0].clientX : e.clientX) - rect.left) / rect.width;
        const t = Math.max(0, Math.min(1, x)) * duration;
        if (which === "l") inT = Math.min(t, outT - 0.3);
        else outT = Math.max(t, inT + 0.3);
        renderTimeline();
        seek(which === "l" ? inT : outT);
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("touchmove", move);
        window.removeEventListener("mouseup", up);
        window.removeEventListener("touchend", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("touchmove", move, { passive: false });
      window.addEventListener("mouseup", up);
      window.addEventListener("touchend", up);
    };
  }
  els.trimL.addEventListener("mousedown", dragTrim("l"));
  els.trimL.addEventListener("touchstart", dragTrim("l"), { passive: false });
  els.trimR.addEventListener("mousedown", dragTrim("r"));
  els.trimR.addEventListener("touchstart", dragTrim("r"), { passive: false });

  // scrub by clicking the track
  els.vtrack.addEventListener("click", (e) => {
    if (e.target.classList.contains("trim")) return;
    const rect = els.vtrack.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * duration);
  });

  // ---------- side controls live-update the preview ----------
  const redraw = () => { if (!playing) drawFrame(); };
  ["input", "change"].forEach((ev) => {
    [els.capText, els.capPos, els.capColor, els.capOutline].forEach((el) =>
      el.addEventListener(ev, redraw));
  });
  els.capSize.addEventListener("input", () => { els.capSizeVal.textContent = els.capSize.value; redraw(); });
  els.wmOn.addEventListener("change", redraw);
  els.musVol.addEventListener("input", () => {
    els.musVolVal.textContent = els.musVol.value + "%";
    music.volume = +els.musVol.value / 100;
  });
  els.vidVol.addEventListener("input", () => {
    els.vidVolVal.textContent = els.vidVol.value + "%";
    video.volume = +els.vidVol.value / 100;
    video.muted = +els.vidVol.value === 0;
  });

  // ---------- export (record the canvas + mixed audio) ----------
  els.exportBtn.addEventListener("click", exportVideo);

  async function exportVideo() {
    if (!hasVideo) return;
    pause();
    els.expOverlay.classList.add("show");
    els.expMsg.textContent = "Menyiapkan…";
    els.expBar.style.width = "0%";

    const fps = 30;
    const clipDur = outT - inT;

    // Audio graph: original video audio + music, each gain-controlled,
    // summed into one MediaStream track for the recorder.
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const dest = ac.createMediaStreamDestination();

    // We need audible sources, so use fresh media elements routed to WebAudio.
    const vEl = document.createElement("video");
    vEl.src = video.src; vEl.crossOrigin = "anonymous";
    await new Promise((r) => (vEl.onloadedmetadata = r));
    const vSrc = ac.createMediaElementSource(vEl);
    const vGain = ac.createGain(); vGain.gain.value = +els.vidVol.value / 100;
    vSrc.connect(vGain).connect(dest);

    let mEl = null;
    if (music.src) {
      mEl = document.createElement("audio");
      mEl.src = music.src; mEl.crossOrigin = "anonymous"; mEl.loop = true;
      await new Promise((r) => (mEl.onloadedmetadata = r)).catch(() => {});
      const mSrc = ac.createMediaElementSource(mEl);
      const mGain = ac.createGain(); mGain.gain.value = +els.musVol.value / 100;
      mSrc.connect(mGain).connect(dest);
    }

    const canvasStream = canvas.captureStream(fps);
    const mixed = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    const mime = pickMime();
    const rec = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const done = new Promise((resolve) => (rec.onstop = resolve));

    // Drive playback in real time; the canvas is redrawn each frame and the
    // recorder samples it. Real time keeps audio/video in sync simply.
    vEl.currentTime = inT;
    await new Promise((r) => (vEl.onseeked = r));
    if (mEl) { mEl.currentTime = 0; }
    els.expMsg.textContent = "Merekam…";
    rec.start();
    ac.resume(); vEl.play(); if (mEl) mEl.play();

    await new Promise((resolve) => {
      const started = performance.now();
      const step = () => {
        ctx.drawImage(vEl, 0, 0, canvas.width, canvas.height);
        drawCaption();
        if (els.wmOn.checked) {
          const r = canvas.width * 0.075;
          drawLogo(ctx, canvas.width - r - 18, canvas.height - r - 18, r);
        }
        const elapsed = (performance.now() - started) / 1000;
        els.expBar.style.width = Math.min(100, (elapsed / clipDur) * 100) + "%";
        if (elapsed >= clipDur) { resolve(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    rec.stop(); vEl.pause(); if (mEl) mEl.pause();
    await done;
    ac.close();

    const blob = new Blob(chunks, { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ext = mime.includes("mp4") ? "mp4" : "webm";
    a.href = url; a.download = `wca-${Date.now()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    els.expOverlay.classList.remove("show");
    drawFrame();
  }

  function pickMime() {
    // MP4/AAC first -- it plays with sound in phone galleries, WhatsApp and
    // iOS, where webm/opus often stays silent. Falls back to webm where the
    // browser's MediaRecorder can't do MP4 (older Chrome/Firefox).
    // Only accept MP4 when H.264 video + AAC audio are BOTH there -- a bare
    // "video/mp4" can accept the string but mux VP9/Opus inside, which
    // phones won't play. If real MP4 isn't available, use honest webm.
    const list = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc1.4D401E,mp4a.40.2",
      "video/mp4;codecs=h264,aac",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    for (const m of list) if (MediaRecorder.isTypeSupported(m)) return m;
    return "video/webm";
  }

  // keyboard: space = play/pause
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && hasVideo && e.target.tagName !== "TEXTAREA") {
      e.preventDefault(); playing ? pause() : play();
    }
  });
})();
