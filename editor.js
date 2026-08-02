/* WCA Editor — a minimal browser video editor (multi-clip).
 *
 * Clips are appended into a sequence. Each clip has its own hidden <video>
 * element and its own in/out trim. Preview plays them back to back onto a
 * <canvas> with a global caption + watermark composited on top; a music
 * track can play underneath. Export drives the same sequence through fresh
 * elements routed into a WebAudio graph and records canvas + audio with
 * MediaRecorder (MP4/H.264 where the browser can, else webm).
 */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  const music = document.createElement("audio");
  music.crossOrigin = "anonymous"; music.style.display = "none";
  document.body.appendChild(music);

  const canvas = $("preview"), ctx = canvas.getContext("2d");
  const els = {
    stageHint: $("stageHint"), info: $("info"),
    play: $("playBtn"), timeLabel: $("timeLabel"), trimLabel: $("trimLabel"),
    clip: $("clip"), dimL: $("dimL"), dimR: $("dimR"),
    trimL: $("trimL"), trimR: $("trimR"), playhead: $("playhead"),
    vtrack: $("vtrack"), aEmpty: $("aEmpty"),
    clipStrip: $("clipStrip"), stripEmpty: $("stripEmpty"), selLabel: $("selLabel"),
    capText: $("capText"), capPos: $("capPos"), capSize: $("capSize"),
    capSizeVal: $("capSizeVal"), capColor: $("capColor"), capOutline: $("capOutline"),
    wmOn: $("wmOn"), musVol: $("musVol"), musVolVal: $("musVolVal"),
    vidVol: $("vidVol"), vidVolVal: $("vidVolVal"),
    exportBtn: $("exportBtn"), expOverlay: $("expOverlay"), expBar: $("expBar"), expMsg: $("expMsg"),
    audioStat: $("audioStat"),
    transType: $("transType"), transDur: $("transDur"), transDurVal: $("transDurVal"),
  };

  const transDur = () => +els.transDur.value / 10; // slider 2..15 -> 0.2..1.5s
  els.transDur.addEventListener("input", () => { els.transDurVal.textContent = transDur().toFixed(1) + "s"; });

  // ----- state -----
  /** @type {Array<{el:HTMLVideoElement,src:string,name:string,duration:number,inT:number,outT:number,thumb:HTMLCanvasElement}>} */
  let clips = [];
  let sel = -1;        // selected clip (the one being trimmed / previewed when paused)
  let playing = false;
  let playIdx = 0;     // clip currently playing during preview

  const cur = () => clips[sel];
  const trimmedDur = (c) => Math.max(0, c.outT - c.inT);
  const totalDur = () => clips.reduce((s, c) => s + trimmedDur(c), 0);

  // ---------- WCA logo (vector, no asset) ----------
  function drawLogo(c, x, y, r) {
    c.save(); c.translate(x, y);
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2);
    c.fillStyle = "rgba(11,24,38,.92)"; c.fill();
    c.lineWidth = r * 0.09; c.strokeStyle = "#f5b942"; c.stroke();
    c.fillStyle = "#f5b942";
    c.font = `700 ${r * 0.34}px -apple-system,Segoe UI,Roboto,sans-serif`;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("WCA", 0, 0); c.restore();
  }

  // ---------- add a clip ----------
  $("videoInput").addEventListener("change", (e) => {
    const files = [...e.target.files];
    e.target.value = ""; // allow re-adding the same file
    files.forEach(addVideo);
  });

  function addVideo(f) {
    if (!f) return;
    const el = document.createElement("video");
    el.playsInline = true; el.crossOrigin = "anonymous";
    el.muted = false; el.volume = +els.vidVol.value / 100;
    el.preload = "auto"; el.style.display = "none";
    el.src = URL.createObjectURL(f);
    document.body.appendChild(el);
    el.onloadedmetadata = () => {
      const clip = {
        el, src: el.src, name: f.name, duration: el.duration || 0,
        inT: 0, outT: el.duration || 0, thumb: document.createElement("canvas"),
      };
      clips.push(clip);
      makeThumb(clip);
      if (clips.length === 1) {
        canvas.width = el.videoWidth || 720;
        canvas.height = el.videoHeight || 1280;
        els.stageHint.style.display = "none";
        els.exportBtn.disabled = false;
      }
      selectClip(clips.length - 1);
      renderStrip();
    };
  }

  function makeThumb(clip) {
    const t = clip.thumb; t.width = 96; t.height = 56;
    const v = clip.el, tctx = t.getContext("2d");
    const grab = () => {
      try { tctx.drawImage(v, 0, 0, t.width, t.height); } catch (_) {}
      renderStrip();
    };
    v.currentTime = Math.min(0.1, clip.duration / 2);
    v.addEventListener("seeked", grab, { once: true });
  }

  // ---------- selection / strip ----------
  function selectClip(i) {
    sel = i;
    if (!playing && cur()) { cur().el.currentTime = cur().inT; drawFrameFrom(cur().el); }
    renderTrim(); renderStrip(); detectAudioTrack();
    els.selLabel.textContent = cur()
      ? `Klip #${sel + 1} • ${cur().name.slice(0, 28)} — geser pegangan untuk memotong`
      : "Pilih satu klip untuk memotongnya ↑";
    els.info.textContent = clips.length
      ? `${clips.length} klip • total ${totalDur().toFixed(1)}s`
      : "Belum ada video.";
  }

  function deleteClip(i) {
    const [c] = clips.splice(i, 1);
    try { c.el.pause(); c.el.remove(); URL.revokeObjectURL(c.src); } catch (_) {}
    if (!clips.length) { sel = -1; els.exportBtn.disabled = true; els.stageHint.style.display = ""; ctx.clearRect(0,0,canvas.width,canvas.height); }
    else selectClip(Math.min(i, clips.length - 1));
    renderStrip();
  }

  function moveClip(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= clips.length) return;
    [clips[i], clips[j]] = [clips[j], clips[i]];
    selectClip(j); renderStrip();
  }

  function renderStrip() {
    els.stripEmpty.style.display = clips.length ? "none" : "";
    // rebuild chips (cheap; few clips)
    [...els.clipStrip.querySelectorAll(".chip")].forEach((n) => n.remove());
    clips.forEach((c, i) => {
      const chip = document.createElement("div");
      chip.className = "chip" + (i === sel ? " sel" : "");
      chip.appendChild(c.thumb);
      const idx = document.createElement("div"); idx.className = "idx"; idx.textContent = i + 1; chip.appendChild(idx);
      const dur = document.createElement("div"); dur.className = "dur"; dur.textContent = trimmedDur(c).toFixed(1) + "s"; chip.appendChild(dur);
      const x = document.createElement("button"); x.className = "x"; x.textContent = "×";
      x.onclick = (ev) => { ev.stopPropagation(); deleteClip(i); }; chip.appendChild(x);
      const mv = document.createElement("div"); mv.className = "mv";
      const lb = document.createElement("button"); lb.textContent = "‹"; lb.onclick = (ev) => { ev.stopPropagation(); moveClip(i, -1); };
      const rb = document.createElement("button"); rb.textContent = "›"; rb.onclick = (ev) => { ev.stopPropagation(); moveClip(i, 1); };
      mv.appendChild(lb); mv.appendChild(rb); chip.appendChild(mv);
      chip.onclick = () => selectClip(i);
      els.clipStrip.appendChild(chip);
    });
  }

  // ---------- music ----------
  $("musicInput").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    music.src = URL.createObjectURL(f);
    els.aEmpty.textContent = f.name.length > 34 ? f.name.slice(0, 34) + "…" : f.name;
    els.aEmpty.style.color = "#e8eef4";
  });

  // ---------- audio indicator ----------
  let hasAudioTrack = null;
  function detectAudioTrack() {
    hasAudioTrack = null;
    const c = cur(); if (!c) return updateAudioStat();
    try {
      const cap = c.el.captureStream || c.el.mozCaptureStream;
      if (cap) hasAudioTrack = cap.call(c.el).getAudioTracks().length > 0;
    } catch (_) {}
    updateAudioStat();
  }
  function updateAudioStat() {
    const el = els.audioStat;
    if (hasAudioTrack === false) { el.textContent = "🔇 klip TANPA audio"; el.style.color = "#e5484d"; return; }
    if (!playing) { el.textContent = "🔈 siap"; el.style.color = "#8ba0b3"; return; }
    const v = clips[playIdx] && clips[playIdx].el;
    const b = v && v.webkitAudioDecodedByteCount;
    if (typeof b === "number") {
      const moving = b > (updateAudioStat._last || 0);
      updateAudioStat._last = b;
      el.textContent = moving ? "🔊 berbunyi" : "🔈 diam";
      el.style.color = moving ? "#2ecc71" : "#8ba0b3";
    } else { el.textContent = "🔊 main"; el.style.color = "#2ecc71"; }
  }

  // ---------- draw ----------
  function drawFrameFrom(v) {
    if (!v) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    drawCaption();
    if (els.wmOn.checked) {
      const r = canvas.width * 0.075;
      drawLogo(ctx, canvas.width - r - 18, canvas.height - r - 18, r);
    }
  }

  /* Paint clip [idx]'s current frame with the chosen transition, then the
   * caption + watermark ON TOP so they stay solid through a fade. getEl(i)
   * returns the media element for clip i in the current context (preview =
   * clips[i].el, export = the fresh export elements). */
  function paintFrame(idx, el, getEl) {
    const clip = clips[idx]; if (!clip) return;
    const T = transDur();
    const type = els.transType.value;
    const t = el.currentTime;
    const remaining = clip.outT - t;
    const intoClip = t - clip.inT;
    const last = clips.length - 1;

    ctx.drawImage(el, 0, 0, canvas.width, canvas.height);

    if (type === "dissolve" && idx < last && remaining < T) {
      const nx = getEl(idx + 1);
      if (nx && nx.readyState >= 2) {
        const a = Math.min(1, (T - remaining) / T);
        ctx.save(); ctx.globalAlpha = a;
        ctx.drawImage(nx, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    } else if (type === "fade" || type === "flash") {
      const rgb = type === "flash" ? "255,255,255" : "0,0,0";
      const half = T / 2;
      let a = 0;
      // dip out at end (between clips AND at the very end)
      if (remaining < half) a = Math.max(a, 1 - remaining / half);
      // dip in at start (between clips AND at the very start)
      if (intoClip < half) a = Math.max(a, 1 - intoClip / half);
      if (a > 0.001) { ctx.save(); ctx.fillStyle = `rgba(${rgb},${a})`; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); }
    }

    drawCaption();
    if (els.wmOn.checked) {
      const r = canvas.width * 0.075;
      drawLogo(ctx, canvas.width - r - 18, canvas.height - r - 18, r);
    }
  }
  function drawCaption() {
    const text = els.capText.value.trim(); if (!text) return;
    const size = +els.capSize.value * (canvas.width / 720);
    ctx.font = `700 ${size}px -apple-system,Segoe UI,Roboto,sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    const lines = wrap(text, canvas.width * 0.88);
    const lh = size * 1.25; let y;
    const pos = els.capPos.value;
    if (pos === "top") y = canvas.height * 0.12;
    else if (pos === "center") y = canvas.height * 0.5 - (lines.length - 1) * lh / 2;
    else y = canvas.height * 0.86 - (lines.length - 1) * lh;
    for (const ln of lines) {
      ctx.lineWidth = size * 0.16; ctx.strokeStyle = els.capOutline.value || "#000"; ctx.strokeText(ln, canvas.width / 2, y);
      ctx.fillStyle = els.capColor.value || "#fff"; ctx.fillText(ln, canvas.width / 2, y);
      y += lh;
    }
  }
  function wrap(text, maxW) {
    const out = [];
    for (const para of text.split("\n")) {
      const words = para.split(" "); let line = "";
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
      }
      out.push(line);
    }
    return out;
  }

  // ---------- trim (selected clip) ----------
  function renderTrim() {
    const c = cur();
    if (!c) { els.trimLabel.textContent = ""; return; }
    const lPct = c.duration ? c.inT / c.duration : 0;
    const rPct = c.duration ? c.outT / c.duration : 1;
    els.trimL.style.left = (lPct * 100) + "%";
    els.trimR.style.left = "calc(" + (rPct * 100) + "% - 12px)";
    els.dimL.style.left = "0"; els.dimL.style.width = (lPct * 100) + "%";
    els.dimR.style.left = (rPct * 100) + "%"; els.dimR.style.width = ((1 - rPct) * 100) + "%";
    els.trimLabel.textContent = `Potong: ${c.inT.toFixed(1)}s → ${c.outT.toFixed(1)}s`;
  }
  function dragTrim(which) {
    return (ev) => {
      const c = cur(); if (!c) return; ev.preventDefault();
      const move = (e) => {
        const rect = els.vtrack.getBoundingClientRect();
        const x = ((e.touches ? e.touches[0].clientX : e.clientX) - rect.left) / rect.width;
        const t = Math.max(0, Math.min(1, x)) * c.duration;
        if (which === "l") c.inT = Math.min(t, c.outT - 0.3);
        else c.outT = Math.max(t, c.inT + 0.3);
        renderTrim(); c.el.currentTime = which === "l" ? c.inT : c.outT; drawFrameFrom(c.el);
      };
      const up = () => { renderStrip(); selectClip(sel);
        ["mousemove","touchmove","mouseup","touchend"].forEach((n) => window.removeEventListener(n, n.includes("move") ? move : up)); };
      window.addEventListener("mousemove", move); window.addEventListener("touchmove", move, { passive: false });
      window.addEventListener("mouseup", up); window.addEventListener("touchend", up);
    };
  }
  els.trimL.addEventListener("mousedown", dragTrim("l"));
  els.trimL.addEventListener("touchstart", dragTrim("l"), { passive: false });
  els.trimR.addEventListener("mousedown", dragTrim("r"));
  els.trimR.addEventListener("touchstart", dragTrim("r"), { passive: false });
  els.vtrack.addEventListener("click", (e) => {
    if (e.target.classList.contains("trim")) return; const c = cur(); if (!c) return;
    const rect = els.vtrack.getBoundingClientRect();
    c.el.currentTime = Math.max(c.inT, Math.min(c.outT, ((e.clientX - rect.left) / rect.width) * c.duration));
    drawFrameFrom(c.el);
  });

  // ---------- transport (sequential preview) ----------
  function play() {
    if (!clips.length || playing) return;
    playing = true; els.play.textContent = "⏸";
    playIdx = Math.max(0, sel);
    startClip(playIdx, true);
    if (music.src) { music.currentTime = 0; music.volume = +els.musVol.value / 100; music.play().catch(()=>{}); }
    loop();
  }
  function startClip(i, resetMusicNo) {
    const c = clips[i]; if (!c) return;
    c.el.volume = +els.vidVol.value / 100; c.el.muted = +els.vidVol.value === 0;
    c.el.currentTime = c.inT; c.el.play().catch(()=>{});
  }
  function stopAllClipEls() { clips.forEach((c) => c.el.pause()); }
  function pause() {
    playing = false; els.play.textContent = "▶";
    stopAllClipEls(); music.pause();
  }
  els.play.addEventListener("click", () => (playing ? pause() : play()));

  function loop() {
    if (!playing) return;
    const c = clips[playIdx];
    if (c) {
      const dissolve = els.transType.value === "dissolve";
      const T = transDur();
      // Dissolve pre-roll: start the next clip early so both are decoding
      // during the crossfade window.
      if (dissolve && playIdx < clips.length - 1 && (c.outT - c.el.currentTime) < T) {
        const nx = clips[playIdx + 1].el;
        if (nx.paused) {
          nx.currentTime = clips[playIdx + 1].inT;
          nx.volume = +els.vidVol.value / 100; nx.muted = +els.vidVol.value === 0;
          nx.play().catch(() => {});
        }
      }
      if (c.el.currentTime >= c.outT || c.el.ended) {
        c.el.pause();
        if (playIdx < clips.length - 1) {
          playIdx++;
          // If dissolve pre-rolled the next clip, it's already playing at the
          // right spot -- don't restart it back to inT.
          if (!(dissolve && !clips[playIdx].el.paused)) startClip(playIdx);
        } else { pause(); selectClip(sel); return; }
      } else {
        paintFrame(playIdx, c.el, (i) => clips[i].el);
      }
      let elapsed = 0; for (let k = 0; k < playIdx; k++) elapsed += trimmedDur(clips[k]);
      elapsed += Math.max(0, c.el.currentTime - c.inT);
      els.timeLabel.textContent = `${elapsed.toFixed(1)} / ${totalDur().toFixed(1)}s`;
    }
    updateAudioStat();
    requestAnimationFrame(loop);
  }

  // ---------- live control updates ----------
  const redraw = () => { if (!playing && cur()) drawFrameFrom(cur().el); };
  ["input", "change"].forEach((ev) => {
    [els.capText, els.capPos, els.capColor, els.capOutline].forEach((el) => el.addEventListener(ev, redraw));
  });
  els.capSize.addEventListener("input", () => { els.capSizeVal.textContent = els.capSize.value; redraw(); });
  els.wmOn.addEventListener("change", redraw);
  els.musVol.addEventListener("input", () => { els.musVolVal.textContent = els.musVol.value + "%"; music.volume = +els.musVol.value / 100; });
  els.vidVol.addEventListener("input", () => {
    els.vidVolVal.textContent = els.vidVol.value + "%";
    clips.forEach((c) => { c.el.volume = +els.vidVol.value / 100; c.el.muted = +els.vidVol.value === 0; });
  });

  // ---------- export (record the whole sequence) ----------
  els.exportBtn.addEventListener("click", exportVideo);

  async function exportVideo() {
    if (!clips.length) return;
    pause();
    els.expOverlay.classList.add("show");
    els.expMsg.textContent = "Menyiapkan…"; els.expBar.style.width = "0%";

    const fps = 30;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const dest = ac.createMediaStreamDestination();
    const vGain = ac.createGain(); vGain.gain.value = +els.vidVol.value / 100; vGain.connect(dest);

    // Fresh elements for export so preview's native audio stays intact.
    const exEls = clips.map((c) => {
      const v = document.createElement("video");
      v.src = c.src; v.crossOrigin = "anonymous"; v.preload = "auto";
      return v;
    });
    await Promise.all(exEls.map((v) => new Promise((r) => (v.onloadedmetadata = r))));
    exEls.forEach((v) => { const s = ac.createMediaElementSource(v); s.connect(vGain); });

    let mEl = null;
    if (music.src) {
      mEl = document.createElement("audio"); mEl.src = music.src; mEl.crossOrigin = "anonymous"; mEl.loop = true;
      await new Promise((r) => (mEl.onloadedmetadata = r)).catch(()=>{});
      const mGain = ac.createGain(); mGain.gain.value = +els.musVol.value / 100;
      ac.createMediaElementSource(mEl).connect(mGain).connect(dest);
    }

    const canvasStream = canvas.captureStream(fps);
    const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = pickMime();
    const rec = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((res) => (rec.onstop = res));

    const total = totalDur(); let done = 0;
    els.expMsg.textContent = "Merekam…";
    await ac.resume(); rec.start();
    if (mEl) { mEl.currentTime = 0; mEl.play().catch(()=>{}); }

    const getExEl = (i) => exEls[i];
    const dissolve = els.transType.value === "dissolve";
    const T = transDur();
    const prerolled = new Array(clips.length).fill(false);

    // Play each clip in turn, drawing every frame; the recorder samples the canvas.
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i], v = exEls[i];
      if (!prerolled[i]) {
        v.currentTime = c.inT; await new Promise((r) => (v.onseeked = r));
        v.play().catch(()=>{});
      }
      await new Promise((resolve) => {
        const step = () => {
          if (v.currentTime >= c.outT || v.ended) { v.pause(); resolve(); return; }
          // Dissolve pre-roll of the next export element.
          if (dissolve && i < clips.length - 1 && (c.outT - v.currentTime) < T) {
            const nx = exEls[i + 1];
            if (!prerolled[i + 1] && nx.paused) {
              prerolled[i + 1] = true;
              nx.currentTime = clips[i + 1].inT;
              nx.play().catch(()=>{});
            }
          }
          paintFrame(i, v, getExEl);
          const played = done + Math.max(0, v.currentTime - c.inT);
          els.expBar.style.width = Math.min(100, (played / total) * 100) + "%";
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      done += trimmedDur(c);
    }

    rec.stop(); if (mEl) mEl.pause(); await stopped; ac.close();
    const blob = new Blob(chunks, { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ext = mime.includes("mp4") ? "mp4" : "webm";
    a.href = url; a.download = `wca-${Date.now()}.${ext}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    els.expOverlay.classList.remove("show");
    if (cur()) drawFrameFrom(cur().el);
  }

  function pickMime() {
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

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && clips.length && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "INPUT") {
      e.preventDefault(); playing ? pause() : play();
    }
  });
})();
