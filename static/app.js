const synth = window.speechSynthesis;
const supportsSpeech = "speechSynthesis" in window;

const textInput = document.getElementById("textInput");
const fileInput = document.getElementById("fileInput");
const voiceSelect = document.getElementById("voiceSelect");
const playPauseBtn = document.getElementById("playPauseBtn");
const stopBtn = document.getElementById("stopBtn");
const backBtn = document.getElementById("backBtn");
const nextBtn = document.getElementById("nextBtn");
const speedSelect = document.getElementById("speedSelect");
const volumeRange = document.getElementById("volumeRange");
const volumeValue = document.getElementById("volumeValue");
const statusText = document.getElementById("statusText");

const femaleHints = [
    "female",
    "woman",
    "zira",
    "aria",
    "jenny",
    "sara",
    "anna",
    "amy",
    "emma",
    "olivia",
    "ava",
    "lucy",
    "lisa",
    "mia",
    "susan",
    "joanna",
    "kendra",
    "salli",
    "ivy",
];
const maleHints = [
    "male",
    "man",
    "david",
    "mark",
    "guy",
    "ryan",
    "brandon",
    "adam",
    "brian",
    "matt",
    "justin",
    "greg",
    "tom",
    "michael",
    "daniel",
    "anthony",
    "lee",
    "john",
    "eric",
    "kevin",
    "fred",
];
const qualityHints = [
    "microsoft",
    "google",
    "apple",
    "neural",
    "natural",
    "online",
    "enhanced",
];

let voices = [];
let voiceMap = new Map();
let sentences = [];
let currentIndex = 0;
let isSpeaking = false;
let isPaused = false;
let stopRequested = false;
let textDirty = true;

function getVoiceId(voice) {
    return voice.voiceURI || voice.name;
}

function scoreVoice(voice, gender) {
    const name = (voice.name + " " + voice.voiceURI).toLowerCase();
    const lang = (voice.lang || "").toLowerCase();
    let score = 0;

    if (lang.startsWith("en")) {
        score += 2;
    }

    if (qualityHints.some((hint) => name.includes(hint))) {
        score += 2;
    }

    if (gender === "female" && femaleHints.some((hint) => name.includes(hint))) {
        score += 3;
    }

    if (gender === "male" && maleHints.some((hint) => name.includes(hint))) {
        score += 3;
    }

    return score;
}

function pickPreferredVoices(gender, limit) {
    const scored = voices
        .map((voice) => ({ voice, score: scoreVoice(voice, gender) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

    const picked = [];
    const used = new Set();

    for (const item of scored) {
        const id = getVoiceId(item.voice);
        if (!used.has(id)) {
            picked.push(item.voice);
            used.add(id);
        }
        if (picked.length >= limit) {
            break;
        }
    }

    if (picked.length < limit) {
        for (const voice of voices) {
            const id = getVoiceId(voice);
            if (!used.has(id)) {
                picked.push(voice);
                used.add(id);
            }
            if (picked.length >= limit) {
                break;
            }
        }
    }

    return picked;
}

function addOptGroup(label, items) {
    if (!items.length) {
        return;
    }

    const group = document.createElement("optgroup");
    group.label = label;

    items.forEach((voice) => {
        const option = document.createElement("option");
        option.value = getVoiceId(voice);
        option.textContent = `${voice.name} (${voice.lang})`;
        group.appendChild(option);
    });

    voiceSelect.appendChild(group);
}

function populateVoices() {
    if (!supportsSpeech) {
        return;
    }

    voices = synth.getVoices();
    if (!voices.length) {
        return;
    }

    voiceMap = new Map();
    voices.forEach((voice) => {
        voiceMap.set(getVoiceId(voice), voice);
    });

    const recommendedWomen = pickPreferredVoices("female", 3);
    const recommendedMen = pickPreferredVoices("male", 3);
    const recommendedIds = new Set(
        [...recommendedWomen, ...recommendedMen].map(getVoiceId)
    );
    const remaining = voices.filter((voice) => !recommendedIds.has(getVoiceId(voice)));

    voiceSelect.innerHTML = "";
    addOptGroup("Recommended - Women", recommendedWomen);
    addOptGroup("Recommended - Men", recommendedMen);
    addOptGroup("All voices", remaining);

    const defaultVoice = recommendedWomen[0] || recommendedMen[0] || voices[0];
    if (defaultVoice) {
        voiceSelect.value = getVoiceId(defaultVoice);
    }
}

function getSelectedVoice() {
    const id = voiceSelect.value;
    return voiceMap.get(id) || voices.find((voice) => getVoiceId(voice) === id);
}

function splitSentences(text) {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) {
        return [];
    }
    const parts = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
    return parts ? parts.map((part) => part.trim()) : [cleaned];
}

function updateStatus() {
    const total = sentences.length;
    const position = total ? `${currentIndex + 1}/${total}` : "0/0";

    if (isSpeaking) {
        statusText.textContent = `${isPaused ? "Paused" : "Reading"} (${position})`;
        return;
    }

    if (!textInput.value.trim()) {
        statusText.textContent = "Ready";
        return;
    }

    statusText.textContent = total ? `Ready (${position})` : "Ready";
}

function prepareSentences() {
    sentences = splitSentences(textInput.value);
    currentIndex = 0;
    textDirty = false;
    updateStatus();
}

function speakSentence(index) {
    if (!supportsSpeech) {
        return;
    }
    if (index >= sentences.length) {
        isSpeaking = false;
        isPaused = false;
        updateStatus();
        updatePlayLabel();
        return;
    }

    currentIndex = index;
    updateStatus();

    const utterance = new SpeechSynthesisUtterance(sentences[index]);
    const voice = getSelectedVoice();
    if (voice) {
        utterance.voice = voice;
    }

    utterance.rate = Number(speedSelect.value);
    utterance.volume = Number(volumeRange.value);

    utterance.onstart = () => {
        isSpeaking = true;
        updateStatus();
    };

    utterance.onend = () => {
        if (stopRequested) {
            return;
        }
        speakSentence(index + 1);
    };

    utterance.onerror = () => {
        isSpeaking = false;
        isPaused = false;
        statusText.textContent = "Speech synthesis error.";
        updatePlayLabel();
    };

    synth.speak(utterance);
}

function startNarration() {
    if (!supportsSpeech) {
        statusText.textContent = "Speech synthesis is not supported in this browser.";
        return;
    }

    if (!textInput.value.trim()) {
        statusText.textContent = "Paste text or load a file to start.";
        return;
    }

    if (textDirty || !sentences.length) {
        prepareSentences();
    }

    if (!sentences.length) {
        statusText.textContent = "No sentences detected.";
        return;
    }

    isSpeaking = true;
    isPaused = false;
    stopRequested = false;
    speakSentence(currentIndex);
    updatePlayLabel();
}

function updatePlayLabel() {
    playPauseBtn.textContent = isSpeaking && !isPaused ? "Pause" : "Play";
}

function togglePlayPause() {
    if (!supportsSpeech) {
        return;
    }

    if (isSpeaking) {
        if (isPaused) {
            synth.resume();
            isPaused = false;
        } else {
            synth.pause();
            isPaused = true;
        }
        updateStatus();
        updatePlayLabel();
        return;
    }

    startNarration();
}

function stopNarration() {
    if (!supportsSpeech) {
        return;
    }

    stopRequested = true;
    synth.cancel();
    isSpeaking = false;
    isPaused = false;
    currentIndex = 0;
    updateStatus();
    updatePlayLabel();

    setTimeout(() => {
        stopRequested = false;
    }, 0);
}

function restartCurrentSentence() {
    if (!supportsSpeech || !isSpeaking || isPaused) {
        return;
    }

    stopRequested = true;
    synth.cancel();
    setTimeout(() => {
        stopRequested = false;
        speakSentence(currentIndex);
    }, 0);
}

function skip(delta) {
    if (!supportsSpeech) {
        return;
    }

    if (textDirty || !sentences.length) {
        prepareSentences();
    }

    if (!sentences.length) {
        return;
    }

    const nextIndex = Math.min(
        sentences.length - 1,
        Math.max(0, currentIndex + delta)
    );

    if (nextIndex === currentIndex) {
        return;
    }

    currentIndex = nextIndex;
    isPaused = false;
    isSpeaking = true;
    stopRequested = true;
    synth.cancel();

    setTimeout(() => {
        stopRequested = false;
        speakSentence(currentIndex);
    }, 0);
}

if (!supportsSpeech) {
    statusText.textContent = "Speech synthesis is not supported in this browser.";
    [playPauseBtn, stopBtn, backBtn, nextBtn, voiceSelect, speedSelect, volumeRange].forEach(
        (element) => {
            element.disabled = true;
        }
    );
}

textInput.addEventListener("input", () => {
    textDirty = true;
    updateStatus();
});

fileInput.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        textInput.value = String(reader.result || "");
        textDirty = true;
        updateStatus();
    };
    reader.readAsText(file);
});

voiceSelect.addEventListener("change", () => {
    restartCurrentSentence();
});

speedSelect.addEventListener("change", () => {
    restartCurrentSentence();
});

volumeRange.addEventListener("input", () => {
    const percent = Math.round(Number(volumeRange.value) * 100);
    volumeValue.textContent = `${percent}%`;
});

playPauseBtn.addEventListener("click", togglePlayPause);
stopBtn.addEventListener("click", stopNarration);
backBtn.addEventListener("click", () => skip(-1));
nextBtn.addEventListener("click", () => skip(1));

updateStatus();

if (supportsSpeech) {
    populateVoices();
    synth.onvoiceschanged = populateVoices;
    setTimeout(populateVoices, 250);
    setTimeout(populateVoices, 1000);
}
