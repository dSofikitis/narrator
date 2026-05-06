// =============================================================================
// narrator client.
// Backend (edge-tts) returns one MP3 per sentence; we drive an <audio> element
// and pre-fetch the next sentence while the current one plays so transitions
// feel instant.
// =============================================================================

const $ = (id) => document.getElementById(id);

const textInput   = $("textInput");
const fileInput   = $("fileInput");
const fileName    = $("fileName");
const voiceSelect = $("voiceSelect");
const playPauseBtn = $("playPauseBtn");
const playLabel   = $("playLabel");
const playIcon    = $("playIcon");
const pauseIcon   = $("pauseIcon");
const stopBtn     = $("stopBtn");
const backBtn     = $("backBtn");
const nextBtn     = $("nextBtn");
const speedSelect = $("speedSelect");
const volumeRange = $("volumeRange");
const volumeValue = $("volumeValue");
const status      = $("statusText");
const statusText  = status.querySelector(".text");
const positionText = $("positionText");
const seekRange   = $("seekRange");
const audio       = $("audio");
const themeToggle = $("themeToggle");

// ---- state -----------------------------------------------------------------

let sentences = [];
let currentIndex = 0;
let isPlaying = false;
let isPaused = false;
let textDirty = true;

// Per-sentence audio URL cache. Key = sentence index, value = blob: URL.
// Lets us pre-fetch the *next* sentence so playback chains seamlessly.
//
// We render audio at rate=1.0 / volume=1.0 server-side and apply rate/volume
// client-side via audio.playbackRate / audio.volume — that way the cache is
// invariant to those controls (only voice change invalidates it).
const audioCache = new Map();
let abortNextFetch = null;  // AbortController for in-flight pre-fetch

// Monotonic token. Every playSentence() increments it; the audio "ended"
// handler only auto-chains to the next sentence if its captured token is
// still the latest. Kills stale events from a prior playSentence() call that
// got pre-empted (e.g. user changes voice mid-playback).
let playToken = 0;

// Modern browsers preserve pitch on playbackRate by default, but be explicit.
audio.preservesPitch = true;

// True while the user is dragging the seek slider — keeps refreshPosition()
// from clobbering the slider's value while they're mid-scrub.
let isSeeking = false;

// ---- localStorage persistence ----------------------------------------------
// Survive page reloads: text + (optional) filename label.
const STORAGE_TEXT = "narrator.text";
const STORAGE_FILE = "narrator.filename";

let saveTimer = null;
function persistTextSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            const value = textInput.value;
            if (value) localStorage.setItem(STORAGE_TEXT, value);
            else      localStorage.removeItem(STORAGE_TEXT);
        } catch {}
    }, 300);
}

function persistFilename(name) {
    try {
        if (name) localStorage.setItem(STORAGE_FILE, name);
        else      localStorage.removeItem(STORAGE_FILE);
    } catch {}
}

function restoreFromStorage() {
    try {
        const saved = localStorage.getItem(STORAGE_TEXT);
        if (saved) {
            textInput.value = saved;
            textDirty = true;
            const name = localStorage.getItem(STORAGE_FILE);
            if (name) {
                fileName.textContent = name;
                fileName.classList.add("has-file");
            }
        }
    } catch {}
}

// ---- theme -----------------------------------------------------------------

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("narrator-theme", theme); } catch {}
}

function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem("narrator-theme"); } catch {}
    if (saved === "dark" || saved === "light") {
        applyTheme(saved);
        return;
    }
    const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    applyTheme(prefersLight ? "light" : "dark");
}

themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
});

initTheme();

// ---- voices ----------------------------------------------------------------

async function loadVoices() {
    try {
        const res = await fetch("/voices");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        voiceSelect.innerHTML = "";

        const addGroup = (label, items) => {
            if (!items || !items.length) return;
            const group = document.createElement("optgroup");
            group.label = label;
            for (const v of items) {
                const opt = document.createElement("option");
                opt.value = v.id;
                opt.textContent = `${v.short} · ${v.locale} · ${v.gender}`;
                group.appendChild(opt);
            }
            voiceSelect.appendChild(group);
        };

        addGroup("featured", data.featured);
        addGroup("english", data.english);
        addGroup(`other (${data.other.length})`, data.other);

        // Default to Aria.
        if (data.featured && data.featured.length) {
            voiceSelect.value = data.featured[0].id;
        }
        // Push the new options into the visible custom dropdown.
        voiceCustom?.rebuild();

        setStatus("ready", "ready");
    } catch (err) {
        console.error("voices fetch failed", err);
        voiceSelect.innerHTML = "<option>error loading voices</option>";
        voiceCustom?.rebuild();
        setStatus("idle", "voice catalogue unavailable");
    }
}

// ---- custom dropdown (mirrors a native <select>) ---------------------------
// Replaces the native <select>'s look with a glassy panel-style picker while
// keeping the native element in the DOM as the source of truth. Cleanly
// supports optgroups; `data-searchable="true"` on the wrapper enables a
// filter input.
function attachCustomSelect(nativeSelect) {
    const wrapper = nativeSelect.previousElementSibling;
    if (!wrapper || !wrapper.classList.contains("custom-select")) return null;

    const trigger    = wrapper.querySelector(".custom-select-trigger");
    const valueLabel = wrapper.querySelector(".custom-select-value");
    const panel      = wrapper.querySelector(".custom-select-panel");
    const groupsHost = wrapper.querySelector(".custom-select-groups");
    const search     = wrapper.querySelector(".custom-select-search input");

    let allOptions = [];

    function rebuild() {
        groupsHost.innerHTML = "";
        allOptions = [];
        for (const child of nativeSelect.children) {
            if (child.tagName === "OPTGROUP") {
                addGroup(child.label, Array.from(child.children));
            } else if (child.tagName === "OPTION") {
                addGroup(null, [child]);
            }
        }
        syncSelected();
    }

    function addGroup(label, options) {
        if (label) {
            const lbl = document.createElement("div");
            lbl.className = "custom-select-group-label";
            lbl.textContent = label;
            groupsHost.appendChild(lbl);
        }
        for (const o of options) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "custom-select-option";
            btn.dataset.value = o.value;
            btn.textContent = o.textContent;
            btn.dataset.search = o.textContent.toLowerCase();
            btn.addEventListener("click", () => selectValue(o.value));
            groupsHost.appendChild(btn);
            allOptions.push(btn);
        }
    }

    function selectValue(value) {
        nativeSelect.value = value;
        nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        syncSelected();
        close();
    }

    function syncSelected() {
        const value = nativeSelect.value;
        for (const opt of allOptions) {
            opt.classList.toggle("selected", opt.dataset.value === value);
        }
        const selected = allOptions.find(o => o.dataset.value === value);
        if (selected) valueLabel.textContent = selected.textContent;
    }

    function open() {
        // Close any other open dropdown so only one is visible at a time.
        document.querySelectorAll(".custom-select-trigger.open").forEach(t => {
            if (t !== trigger) t.classList.remove("open");
        });
        document.querySelectorAll(".custom-select-panel.open").forEach(p => {
            if (p !== panel) p.classList.remove("open");
        });
        trigger.classList.add("open");
        panel.classList.add("open");
        if (search) {
            search.value = "";
            for (const opt of allOptions) opt.classList.remove("hidden");
            setTimeout(() => search.focus(), 0);
        }
    }

    function close() {
        trigger.classList.remove("open");
        panel.classList.remove("open");
    }

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        if (panel.classList.contains("open")) close();
        else open();
    });

    if (search) {
        search.addEventListener("input", () => {
            const q = search.value.trim().toLowerCase();
            for (const opt of allOptions) {
                opt.classList.toggle("hidden", q && !opt.dataset.search.includes(q));
            }
        });
        search.addEventListener("click", e => e.stopPropagation());
    }

    document.addEventListener("click", (e) => {
        if (!wrapper.contains(e.target)) close();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && panel.classList.contains("open")) close();
    });

    return { rebuild, syncSelected };
}

// Wire up after refs are declared. voiceCustom rebuilt by loadVoices(); speed
// has its options inline in the HTML so we rebuild immediately.
const voiceCustom = attachCustomSelect(voiceSelect);
const speedCustom = attachCustomSelect(speedSelect);
speedCustom?.rebuild();

// ---- sentence splitting ----------------------------------------------------

// Per-chunk word limit for TTS requests. edge-tts render time scales with
// input length, so smaller chunks → faster initial playback and more
// responsive seek/skip. 16 words ≈ 4–6s of speech.
const MAX_CHUNK_WORDS = 16;

// Common abbreviations whose trailing period is NOT a sentence boundary.
// Anchored to end-of-string so we only check the trailing token of a fragment.
const ABBR_TAIL = /(?:^|[\s"'(\[])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Ave|Blvd|Rd|Vs|Etc|Cf|No|Vol|Fig|Ch|U\.S|U\.K|U\.N|Ph\.D|a\.m|p\.m|e\.g|i\.e)\.$/i;

function wordCount(s) { return s.split(/\s+/).filter(Boolean).length; }

function splitSentences(text) {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return [];

    const primary = primarySplit(cleaned);

    // Sub-split anything still over the word threshold.
    const chunks = [];
    for (const sentence of primary) {
        const s = sentence.trim();
        if (s) chunks.push(...subdivide(s));
    }
    return chunks;
}

// Primary sentence boundary detector. Splits on . ! ? but only when the
// punctuation is followed by whitespace and an uppercase letter / digit /
// opening quote/bracket. This single rule handles most abbreviations and
// decimals (because they're followed by lowercase or digits-without-space).
// A second pass merges any fragment whose tail is a known abbreviation, for
// the edge case "He works at the U.S. Treasury." where "Treasury" IS uppercase.
function primarySplit(text) {
    const parts = text.split(/(?<=[.!?]["')\]]*)\s+(?=[A-Z0-9"'(\[])/);
    if (parts.length === 1) return parts;

    const out = [];
    for (const part of parts) {
        const piece = part.trim();
        if (!piece) continue;
        const last = out[out.length - 1];
        if (last && (ABBR_TAIL.test(last) || isDecimalSplit(last, piece))) {
            out[out.length - 1] = last + " " + piece;
        } else {
            out.push(piece);
        }
    }
    return out;
}

// Was the previous "sentence" actually mid-decimal (e.g., "...$3.14...")?
// Heuristic: prior fragment ends in digit + dot, next fragment starts in digit.
function isDecimalSplit(prev, next) {
    return /\d\.$/.test(prev.replace(/["')\]]+$/, "")) && /^\d/.test(next);
}

function subdivide(text) {
    if (wordCount(text) <= MAX_CHUNK_WORDS) return [text];

    // Secondary split on clause-level punctuation. Keeps the punctuation with
    // the preceding clause so commas / semicolons read naturally.
    const subs = text.match(/[^,;:—–]+[,;:—–]+|[^,;:—–]+$/g) || [text];

    // No internal punctuation to split on → fall back to word boundaries.
    if (subs.length === 1) return wordSplit(text);

    // Coalesce adjacent short clauses up to the threshold so we don't emit a
    // pile of tiny "and," "but," fragments.
    const out = [];
    let buf = "";
    for (const sub of subs) {
        const piece = sub.trim();
        if (!piece) continue;
        const candidate = buf ? buf + " " + piece : piece;
        if (wordCount(candidate) > MAX_CHUNK_WORDS && buf) {
            out.push(buf);
            if (wordCount(piece) > MAX_CHUNK_WORDS) {
                out.push(...wordSplit(piece));
                buf = "";
            } else {
                buf = piece;
            }
        } else {
            buf = candidate;
        }
    }
    if (buf) out.push(buf);
    return out;
}

function wordSplit(text) {
    // Last resort: break on word boundaries. Used when a single clause has no
    // internal punctuation but exceeds the chunk size.
    const words = text.split(" ");
    const out = [];
    let buf = "";
    for (const w of words) {
        const c = buf ? buf + " " + w : w;
        if (wordCount(c) > MAX_CHUNK_WORDS && buf) {
            out.push(buf);
            buf = w;
        } else {
            buf = c;
        }
    }
    if (buf) out.push(buf);
    return out;
}

function prepareSentences() {
    sentences = splitSentences(textInput.value);
    currentIndex = 0;
    textDirty = false;
    clearCache();
    refreshPosition();
}

// ---- audio fetch & cache ---------------------------------------------------

function clearCache() {
    for (const url of audioCache.values()) URL.revokeObjectURL(url);
    audioCache.clear();
    if (abortNextFetch) {
        abortNextFetch.abort();
        abortNextFetch = null;
    }
}

async function fetchSentenceAudio(index, signal) {
    if (audioCache.has(index)) return audioCache.get(index);
    if (index < 0 || index >= sentences.length) return null;

    // Always request neutral rate/volume — those are applied client-side so
    // the cached blobs stay reusable across slider changes.
    const params = new URLSearchParams({
        text: sentences[index],
        voice: voiceSelect.value,
        rate: "1.0",
        volume: "1.0",
    });

    const res = await fetch(`/speak?${params}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    audioCache.set(index, url);
    return url;
}

function prefetchNext() {
    const next = currentIndex + 1;
    if (next >= sentences.length || audioCache.has(next)) return;
    abortNextFetch = new AbortController();
    fetchSentenceAudio(next, abortNextFetch.signal).catch((err) => {
        if (err.name !== "AbortError") console.warn("prefetch failed", err);
    });
}

// ---- playback --------------------------------------------------------------

async function playSentence(index) {
    if (index < 0 || index >= sentences.length) {
        finish();
        return;
    }
    const myToken = ++playToken;  // marks this invocation as "the active one"
    audio.pause();                 // cancel any ongoing playback before swapping src

    currentIndex = index;
    refreshPosition();
    setStatus("loading", `loading sentence ${index + 1}/${sentences.length}`);

    let url;
    try {
        url = await fetchSentenceAudio(index);
    } catch (err) {
        console.error("speak failed", err);
        setStatus("idle", "synthesis error");
        finish();
        return;
    }

    if (myToken !== playToken) return;  // a newer playSentence took over while we awaited

    audio.src = url;
    audio.playbackRate = Number(speedSelect.value);
    audio.preservesPitch = true;
    audio.volume = Number(volumeRange.value);

    try {
        await audio.play();
        if (myToken !== playToken) return;
        isPlaying = true;
        isPaused = false;
        updatePlayUI();
        setStatus("reading", `sentence ${index + 1}/${sentences.length}`);
        prefetchNext();
    } catch (err) {
        // If we got pre-empted, the play() promise rejects (pause was called
        // externally) — that's expected, not a real error.
        if (myToken !== playToken) return;
        console.error("audio.play failed", err);
        setStatus("idle", "click play to start");
    }
}

audio.addEventListener("ended", () => {
    // Stale "ended" from a pre-empted playback shouldn't chain forward.
    // The active playSentence has already incremented playToken; if this
    // event corresponds to an older invocation, ignore it.
    if (!isPlaying) return;
    const tokenAtChain = playToken;
    queueMicrotask(() => {
        if (tokenAtChain !== playToken) return;
        playSentence(currentIndex + 1);
    });
});

audio.addEventListener("error", (e) => {
    console.error("audio error", audio.error, e);
});

function finish() {
    isPlaying = false;
    isPaused = false;
    const reachedEnd = sentences.length && currentIndex >= sentences.length - 1;
    if (reachedEnd) {
        // Natural end of the input — rewind to the start so the next press
        // of play re-reads from sentence 1 instead of being stuck at the end.
        currentIndex = 0;
    }
    refreshPosition();
    updatePlayUI();
    setStatus("ready", reachedEnd ? "done · ready to re-read" : "ready");
}

async function start() {
    if (textDirty || !sentences.length) {
        prepareSentences();
    }
    if (!sentences.length) {
        setStatus("idle", "paste text or load a file to start");
        return;
    }
    if (currentIndex >= sentences.length) currentIndex = 0;
    await playSentence(currentIndex);
}

function togglePlayPause() {
    if (isPlaying && !isPaused) {
        audio.pause();
        isPaused = true;
        updatePlayUI();
        setStatus("paused", `paused at sentence ${currentIndex + 1}/${sentences.length}`);
        return;
    }
    if (isPlaying && isPaused) {
        audio.play().catch(() => {});
        isPaused = false;
        updatePlayUI();
        setStatus("reading", `sentence ${currentIndex + 1}/${sentences.length}`);
        return;
    }
    start();
}

function stop() {
    audio.pause();
    audio.currentTime = 0;
    isPlaying = false;
    isPaused = false;
    currentIndex = 0;
    refreshPosition();
    updatePlayUI();
    setStatus("ready", "ready");
}

function skip(delta) {
    if (textDirty || !sentences.length) prepareSentences();
    if (!sentences.length) return;
    const next = Math.min(sentences.length - 1, Math.max(0, currentIndex + delta));
    if (next === currentIndex && isPlaying && !isPaused) {
        // restart current sentence
        audio.currentTime = 0;
        return;
    }
    audio.pause();
    playSentence(next);
}

// ---- UI helpers ------------------------------------------------------------

function setStatus(state, msg) {
    status.dataset.state = state;
    statusText.textContent = msg;
}

function refreshPosition() {
    if (!sentences.length) {
        positionText.textContent = "";
        seekRange.disabled = true;
        seekRange.min = 1;
        seekRange.max = 1;
        seekRange.value = 1;
        return;
    }
    positionText.textContent = `[ ${currentIndex + 1} / ${sentences.length} ]`;
    seekRange.disabled = false;
    seekRange.min = 1;
    seekRange.max = sentences.length;
    if (!isSeeking) seekRange.value = currentIndex + 1;
}

function updatePlayUI() {
    if (isPlaying && !isPaused) {
        playIcon.style.display = "none";
        pauseIcon.style.display = "block";
        playLabel.textContent = "PAUSE";
        playPauseBtn.setAttribute("aria-label", "Pause");
    } else {
        playIcon.style.display = "block";
        pauseIcon.style.display = "none";
        playLabel.textContent = isPaused ? "RESUME" : "PLAY";
        playPauseBtn.setAttribute("aria-label", isPaused ? "Resume" : "Play");
    }
}

// ---- event wiring ----------------------------------------------------------

textInput.addEventListener("input", () => {
    textDirty = true;
    persistTextSoon();
    if (!isPlaying) {
        // soft reset of cache on edits
        clearCache();
        sentences = [];
        currentIndex = 0;
        refreshPosition();
        setStatus("ready", "ready");
    }
});

fileInput.addEventListener("change", (e) => {
    const [file] = e.target.files;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        textInput.value = String(reader.result || "");
        textDirty = true;
        fileName.textContent = file.name;
        fileName.classList.add("has-file");
        persistTextSoon();
        persistFilename(file.name);
        clearCache();
        sentences = [];
        currentIndex = 0;
        refreshPosition();
        setStatus("ready", "ready");
    };
    reader.readAsText(file);
});

voiceSelect.addEventListener("change", () => {
    // Voice change invalidates pre-rendered audio
    clearCache();
    if (isPlaying) {
        audio.pause();
        playSentence(currentIndex);
    }
});

// Speed and volume both apply client-side via the <audio> element, so they
// take effect instantly without invalidating the cache or restarting the
// current sentence.
speedSelect.addEventListener("change", () => {
    audio.playbackRate = Number(speedSelect.value);
    audio.preservesPitch = true;
});

volumeRange.addEventListener("input", () => {
    const v = Number(volumeRange.value);
    audio.volume = v;
    volumeValue.textContent = `${Math.round(v * 100)}%`;
});

playPauseBtn.addEventListener("click", togglePlayPause);
stopBtn.addEventListener("click", stop);
backBtn.addEventListener("click", () => skip(-1));
nextBtn.addEventListener("click", () => skip(1));

// Seek slider: drag previews the position, release just moves the cursor —
// playback does NOT auto-start. User has to press play to hear it.
seekRange.addEventListener("input", () => {
    if (!sentences.length) return;
    isSeeking = true;
    if (isPlaying && !isPaused) audio.pause();   // hush while scrubbing
    const target = Number(seekRange.value);
    positionText.textContent = `[ ${target} / ${sentences.length} ]`;
});
seekRange.addEventListener("change", () => {
    isSeeking = false;
    if (!sentences.length) return;
    const target = Number(seekRange.value) - 1;
    // Cursor-only seek: stop any current playback, park at the new index, wait
    // for the user to press play. Bumping playToken kills any chained "ended"
    // event from the previously-loaded audio so we don't accidentally resume.
    ++playToken;
    audio.pause();
    audio.currentTime = 0;
    currentIndex = target;
    isPlaying = false;
    isPaused = false;
    refreshPosition();
    updatePlayUI();
    setStatus("ready", `cursor at sentence ${target + 1}/${sentences.length}`);
});

// Keyboard shortcuts for power users.
document.addEventListener("keydown", (e) => {
    // Ignore when typing in the textarea
    if (e.target === textInput) return;
    if (e.code === "Space") { e.preventDefault(); togglePlayPause(); }
    else if (e.code === "ArrowLeft")  { e.preventDefault(); skip(-1); }
    else if (e.code === "ArrowRight") { e.preventDefault(); skip(1); }
    else if (e.key === "Escape") { stop(); }
});

// ---- boot ------------------------------------------------------------------

restoreFromStorage();
updatePlayUI();
refreshPosition();
loadVoices();
