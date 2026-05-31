// --- Markdown Parser Component ---
/**
 * A lightweight markdown parser to render Gemini responses beautifully.
 */
function parseMarkdown(text) {
  if (!text) return '';

  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const codeBlocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `__CODE_BLOCK_PLACEHOLDER_${codeBlocks.length}__`;
    codeBlocks.push({ lang, code });
    return placeholder;
  });

  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  html = html.replace(/^&gt; (.*?)$/gm, '<blockquote>$1</blockquote>');

  html = html.replace(/^\s*[-*]\s+(.*?)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  html = html.replace(/^\s*\d+\.\s+(.*?)$/gm, '<li class="ordered-item">$1</li>');
  html = html.replace(/(<li class="ordered-item">.*<\/li>)/s, '<ol>$1</ol>');
  html = html.replace(/class="ordered-item"/g, '');

  const paragraphs = html.split(/\n\n+/);
  html = paragraphs
    .map(p => {
      if (p.trim().startsWith('<h') || 
          p.trim().startsWith('<ul') || 
          p.trim().startsWith('<ol') || 
          p.trim().startsWith('<li') || 
          p.trim().startsWith('<blockquote') || 
          p.trim().startsWith('__CODE_BLOCK_')) {
        return p;
      }
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  codeBlocks.forEach((block, index) => {
    const placeholder = `__CODE_BLOCK_PLACEHOLDER_${index}__`;
    const cleanCode = block.code.trim();
    const langLabel = block.lang ? `<div class="code-lang-label">${block.lang}</div>` : '';
    const codeHtml = `
      <div class="code-block-wrapper">
        ${langLabel}
        <pre><code class="language-${block.lang || 'text'}">${cleanCode}</code></pre>
        <button class="copy-code-btn" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent).then(() => { this.textContent = 'Copied!'; setTimeout(() => this.textContent = 'Copy', 2000); })">Copy</button>
      </div>
    `;
    html = html.replace(placeholder, codeHtml);
  });

  return html;
}

// --- Gemini API Component ---
const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Fast, Recommended)', default: true },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Analytical & Coding)' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Legacy Fast)' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Legacy Complex)' }
];

/**
 * Standard content generation (Non-streaming).
 */
async function generateContent({
  apiKey,
  model = 'gemini-2.5-flash',
  systemInstruction = '',
  contents = [],
  temperature = 0.7,
  responseMimeType = 'text/plain'
}) {
  if (!apiKey) {
    throw new Error('API Key is missing. Please configure it in Settings.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: contents,
    generationConfig: {
      temperature: temperature,
      maxOutputTokens: 4096
    }
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  if (responseMimeType && responseMimeType !== 'text/plain') {
    body.generationConfig.responseMimeType = responseMimeType;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || `HTTP error! Status: ${response.status}`);
    }

    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (error) {
    console.error('Gemini API call failed:', error);
    throw error;
  }
}

/**
 * Streaming content generation.
 */
async function streamContent({
  apiKey,
  model = 'gemini-2.5-flash',
  systemInstruction = '',
  contents = [],
  temperature = 0.7,
  onChunk = () => {},
  onComplete = () => {},
  onError = () => {}
}) {
  if (!apiKey) {
    onError(new Error('API Key is missing. Please configure it in Settings.'));
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  const body = {
    contents: contents,
    generationConfig: {
      temperature: temperature,
      maxOutputTokens: 4096
    }
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `HTTP error! Status: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Hold onto the last incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const dataStr = trimmed.slice(6).trim();
        if (dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr);
          const chunkText = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (chunkText) {
            fullText += chunkText;
            onChunk(chunkText, fullText);
          }
        } catch (e) {
          console.warn('Could not parse SSE JSON stream chunk:', e, trimmed);
        }
      }
    }

    if (buffer && buffer.trim().startsWith('data: ')) {
      const dataStr = buffer.trim().slice(6).trim();
      try {
        const parsed = JSON.parse(dataStr);
        const chunkText = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (chunkText) {
          fullText += chunkText;
          onChunk(chunkText, fullText);
        }
      } catch (e) {}
    }

    onComplete(fullText);
  } catch (error) {
    console.error('Gemini streaming call failed:', error);
    onError(error);
  }
}

// --- Default Subject Presets ---
const DEFAULT_SUBJECTS = [
  {
    id: 'history-preset',
    name: 'World History (Empires & Eras)',
    desc: 'Deep dive into historical epochs, focusing on the rise, expansion, structure, and decline of major civilizations, such as the Roman Empire.',
    icon: '🏛️',
    color: 'hsl(40, 85%, 50%)',
    voiceGender: 'female', // Female default
    materials: `The Roman Empire (27 BC – 476 AD) was one of the most powerful economic, cultural, political, and military forces in the world. It succeeded the Roman Republic and began under the rule of Octavian (Augustus Caesar), who established the Principate.

Key Phases:
1. Pax Romana (27 BC – 180 AD): A 200-year period of relative peace and stability across the Mediterranean, initiated by Augustus. During this era, trade flourished, roads were built, and arts, literature, and architecture reached their peaks.
2. The Crisis of the Third Century (235 – 284 AD): A period of intense civil war, economic collapse, plague, and foreign invasions. Rome was briefly divided and almost collapsed until Emperor Diocletian restored order.
3. The Division of the Empire: Diocletian split the empire into Eastern and Western administrative halves in 285 AD. Constantine the Great later moved the capital to Byzantium (renamed Constantinople) in 330 AD.
4. Fall of the Western Roman Empire: In 476 AD, the last Western Emperor, Romulus Augustulus, was deposed by the Germanic chieftain Odoacer. The Eastern Empire survived as the Byzantine Empire until 1453.

Primary Causes of Rome's Fall:
- Economic Troubles: Heavy inflation, high taxation, labor shortages, and reliance on slave labor.
- Invasions: Heavy pressures and incursions by Germanic tribes (Visigoths, Vandals) and Huns.
- Political Instability: Constant civil wars, corrupt leaders, and succession struggles.
- Military Decline: Over-expansion made borders hard to defend, and the army relied heavily on foreign mercenaries who lacked loyalty to Rome.`,
    chatHistory: [
      { role: 'model', parts: [{ text: "Hello! I am your World History tutor. I have loaded your notes on the Roman Empire. Ask me anything about its rise, key phases, or the reasons behind its ultimate fall!" }] }
    ],
    flashcards: [
      { question: "What was the Pax Romana?", answer: "A 200-year period of relative peace and stability starting under Augustus Caesar, during which trade, infrastructure, and culture flourished.", state: null },
      { question: "Who was the first Emperor of Rome?", answer: "Augustus Caesar (Octavian), who established the Principate in 27 BC.", state: null },
      { question: "When did the Western Roman Empire fall?", answer: "In 476 AD, when Romulus Augustulus was deposed by the Germanic chieftain Odoacer.", state: null }
    ],
    quizzes: []
  },
  {
    id: 'physics-preset',
    name: 'Quantum Physics (Foundations)',
    desc: 'An exploration of basic quantum mechanics, including wave-particle duality, Heisenberg uncertainty, and historical experimental foundations.',
    icon: '🔬',
    color: 'hsl(210, 90%, 60%)',
    voiceGender: 'male', // Male default
    materials: `Quantum Mechanics is a fundamental theory in physics that provides a description of the physical properties of nature at the scale of atoms and subatomic particles.

Core Foundations & Concepts:
1. Quantization of Energy: Max Planck proposed in 1900 that energy is emitted or absorbed in discrete packets called "quanta". The energy of a quantum is given by E = hf, where h is Planck's constant (6.626 x 10^-34 J·s) and f is frequency.
2. Photoelectric Effect: Albert Einstein (1905) explained that light behaves as packets of energy called "photons". When light hits a metal surface, it can eject electrons if the frequency is above a threshold, demonstrating the particle-like nature of light.
3. Wave-Particle Duality: Louis de Broglie (1924) proposed that if light waves behave like particles, then matter (like electrons) must also exhibit wave-like characteristics. The wavelength of a particle is λ = h/p, where p is momentum.
4. Heisenberg Uncertainty Principle: Formulated by Werner Heisenberg (1927), it states that it is physically impossible to simultaneously measure both the position (x) and momentum (p) of a particle with absolute accuracy. The limit is given by Δx · Δp ≥ h / 4π.
5. Schrödinger Wave Equation: Erwin Schrödinger (1925) formulated a wave equation that describes how the quantum state (represented by the wave function Ψ) of a physical system changes over time. The probability of finding a particle in a region is proportional to the square of its wave function amplitude.`,
    chatHistory: [
      { role: 'model', parts: [{ text: "Greetings! I am your Quantum Physics tutor. We have standard reference notes loaded on energy quantization, the photoelectric effect, wave-particle duality, and the uncertainty principle. How can I help you visualize these atomic properties today?" }] }
    ],
    flashcards: [
      { question: "What is Planck's constant?", answer: "A fundamental physical constant (h ≈ 6.626 × 10^-34 J·s) that describes the size of energy quanta.", state: null },
      { question: "State the Heisenberg Uncertainty Principle.", answer: "It is impossible to simultaneously measure the exact position (x) and momentum (p) of a particle. The uncertainty limit is Δx · Δp ≥ h / 4π.", state: null },
      { question: "What does wave-particle duality mean?", answer: "All particles and light exhibit both wave-like properties (e.g. interference patterns) and particle-like properties (e.g. localized collisions).", state: null }
    ],
    quizzes: []
  },
  {
    id: 'cs-preset',
    name: 'Data Structures & Algorithms',
    desc: 'Understanding algorithmic complexity (Big O notation), basic abstract data types, and fundamental sorting and searching algorithms.',
    icon: '💻',
    color: 'hsl(262, 85%, 65%)',
    voiceGender: 'male', // Male default
    materials: `Algorithms and Data Structures form the core architecture of computer software. Understanding computational complexity ensures efficient memory and runtime profiles.

Computational Complexity (Big O Notation):
Big O notation classifies algorithms according to how their run time or space requirements grow as the input size (n) grows.
- O(1) - Constant Time: Operations take the same time regardless of size (e.g., accessing an array element by index).
- O(log n) - Logarithmic Time: Input size is halved at each step (e.g., Binary Search).
- O(n) - Linear Time: Execution time grows proportionally to input size (e.g., Linear Search).
- O(n log n) - Linearithmic Time: Common in efficient sorting algorithms (e.g., Merge Sort, Quicksort).
- O(n^2) - Quadratic Time: Common in nested loops (e.g., Bubble Sort, Insertion Sort).

Fundamental Data Structures:
- Arrays: Continuous blocks of memory. Great read times (O(1)) but expensive insertions/deletions.
- Linked Lists: Nodes containing data and pointers. O(1) insertion at endpoints, but sequential access (O(n)).
- Binary Search Tree (BST): Node-based tree where left child < parent and right child > parent. Average search time is O(log n).
- Hash Tables: Key-value maps using hash functions. Average insertion, deletion, and lookup times are O(1).

Basic Searching & Sorting:
- Binary Search: Find a target value in a sorted array by repeatedly dividing the search interval in half.
- Quicksort: Divide-and-conquer algorithm that selects a 'pivot' element, partitions the array around it, and recursively sorts sub-arrays.`,
    chatHistory: [
      { role: 'model', parts: [{ text: "Hello! I am your Algorithms and Data Structures tutor. We have key references loaded on Big O notation, data structures like Trees and Linked Lists, and algorithms like Binary Search. Let me know what code logic or runtime you'd like to analyze!" }] }
    ],
    flashcards: [
      { question: "What is the average time complexity of a Hash Table lookup?", answer: "O(1) - Constant Time, because it maps keys directly to values via a hash function.", state: null },
      { question: "How does Binary Search work?", answer: "It searches a sorted array by dividing the interval in half. If the target is smaller than the middle, it cuts the right half, otherwise the left half. Run time is O(log n).", state: null },
      { question: "What is the key rule of a Binary Search Tree (BST)?", answer: "For any node, all keys in its left subtree are less than its key, and all keys in its right subtree are greater than its key.", state: null }
    ],
    quizzes: []
  },
  {
    id: 'biology-preset',
    name: 'Genetics & Molecular Biology',
    desc: 'The study of heredity, DNA helical structure, transcription, translation, Mendelian genetics, and gene replication.',
    icon: '🧬',
    color: 'hsl(145, 65%, 45%)',
    voiceGender: 'female', // Female default
    materials: `Genetics is the study of genes, genetic variation, and heredity in organisms. Molecular biology focuses on the molecular basis of biological activity.

Mendelian Genetics:
Gregor Mendel established the laws of inheritance in pea plants.
1. Law of Segregation: An individual inherits two alleles for each gene, one from each parent. These alleles segregate during gamete formation.
2. Law of Independent Assortment: Genes for different traits segregate independently during the formation of gametes.

The Structure of DNA:
DNA (Deoxyribonucleic Acid) is a double-stranded helix discovered by James Watson, Francis Crick, and Rosalind Franklin. It consists of:
- A sugar-phosphate backbone.
- Nitrogenous bases: Adenine (A), Thymine (T), Cytosine (C), and Guanine (G).
- Base-pairing rule: A bonds only with T (via two hydrogen bonds), and C bonds only with G (via three hydrogen bonds).

The Central Dogma of Molecular Biology:
It describes the two-step flow of genetic information:
1. Transcription: DNA is transcribed into messenger RNA (mRNA) in the cell nucleus by RNA polymerase. Uracil (U) replaces Thymine (T) in RNA.
2. Translation: mRNA is translated into a sequence of amino acids to form a protein. This occurs in ribosomes in the cytoplasm, where transfer RNA (tRNA) molecules match mRNA codons (triplets of bases) to specific amino acids.`,
    chatHistory: [
      { role: 'model', parts: [{ text: "Hello! I am your Molecular Biology and Genetics tutor. We have study guides ready on Mendelian laws, DNA double helix structure, transcription, and translation. Let's explore the genetic code!" }] }
    ],
    flashcards: [
      { question: "What are the base-pairing rules in DNA?", answer: "Adenine (A) pairs with Thymine (T) via two hydrogen bonds, and Guanine (G) pairs with Cytosine (C) via three hydrogen bonds.", state: null },
      { question: "Define Transcription.", answer: "The process by which the genetic information in a segment of DNA is copied into messenger RNA (mRNA) by RNA polymerase.", state: null },
      { question: "What replaces Thymine in RNA molecules?", answer: "Uracil (U) is used in place of Thymine (T).", state: null }
    ],
    quizzes: []
  }
];

// --- Global Application State ---
let state = {
  apiKey: '',
  selectedModel: 'gemini-2.5-flash',
  temperature: 0.7,
  persona: 'friendly',
  subjects: [],
  activeSubjectId: null,
  activeView: 'dashboard',
  stats: {
    quizzesCompleted: 0,
    cardsReviewed: 0
  }
};

// --- Speech Synthesis Genders ---
let maleVoices = [];
let femaleVoices = [];

function initSpeechVoices() {
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  maleVoices = [];
  femaleVoices = [];

  voices.forEach(voice => {
    const name = voice.name.toLowerCase();
    // Classify using names
    if (name.includes('david') || name.includes('mark') || name.includes('george') || name.includes('male') || name.includes('sean') || name.includes('harold') || name.includes('ravi')) {
      maleVoices.push(voice);
    } else if (name.includes('zira') || name.includes('hazel') || name.includes('susan') || name.includes('female') || name.includes('heera') || name.includes('linda') || name.includes('catherine') || name.includes('haruka')) {
      femaleVoices.push(voice);
    } else {
      // General fallbacks
      if (name.includes('google') || name.includes('microsoft')) {
        if (name.includes('female') || name.includes('zira') || name.includes('us english') || name.includes('uk english female')) {
          femaleVoices.push(voice);
        } else {
          maleVoices.push(voice);
        }
      }
    }
  });

  // Ultimate defaults if lists are empty
  if (maleVoices.length === 0 && voices.length > 0) maleVoices.push(voices[0]);
  if (femaleVoices.length === 0 && voices.length > 0) {
    femaleVoices.push(voices[Math.min(1, voices.length - 1)]);
  }
}

if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    initSpeechVoices();
    renderSubjectVoiceSettings();
  };
}

/**
 * Global text-to-speech speaker utility.
 */
function speakText({ text, gender = 'female', rate = 1.0, onStart = () => {}, onEnd = () => {} }) {
  if (!window.speechSynthesis) {
    onEnd();
    return;
  }
  
  window.speechSynthesis.cancel(); // kill existing audio
  
  const utterance = new SpeechSynthesisUtterance(text);
  initSpeechVoices();

  const voicePool = gender === 'male' ? maleVoices : femaleVoices;
  if (voicePool.length > 0) {
    utterance.voice = voicePool[0];
  } else {
    const all = window.speechSynthesis.getVoices();
    if (all.length > 0) utterance.voice = all[0];
  }

  utterance.rate = rate;
  utterance.onstart = onStart;
  utterance.onend = onEnd;
  utterance.onerror = (e) => {
    console.error("Speech Synthesis error:", e);
    onEnd();
  };

  window.speechSynthesis.speak(utterance);
}

// --- Active Session States (Memory Only) ---
let activeQuiz = null; 
let activeDeck = null; 
let currentQuizQuestionIndex = 0;
let userQuizAnswers = [];
let isGeneratingResponse = false; 

// Podcast states
let activePodcastScript = null;
let currentPodcastLineIndex = 0;
let isPodcastPlaying = false;

// Video slide states
let activeVideoSlides = null;
let currentVideoSlideIndex = 0;
let isVideoPlaying = false;

// Live Room voice state
let isLiveSessionActive = false;
let isLiveListening = false;
let liveStream = null;
let recognition = null;

// --- DOM Element Cache ---
const elements = {
  // Sidebar
  sidebarSubjectsList: document.getElementById('sidebar-subjects-list'),
  sidebarAddSubjectBtn: document.getElementById('sidebar-add-subject-btn'),
  navDashboard: document.getElementById('nav-dashboard'),
  navSettings: document.getElementById('nav-settings'),

  // Views
  viewDashboard: document.getElementById('view-dashboard'),
  viewSubjectWorkspace: document.getElementById('view-subject-workspace'),
  viewSettings: document.getElementById('view-settings'),

  // Dashboard Controls
  greetingText: document.getElementById('greeting-text'),
  subjectsContainer: document.getElementById('subjects-container'),
  dashboardAddSubjectBtn: document.getElementById('dashboard-add-subject-btn'),
  statsSubjectsCount: document.getElementById('stats-subjects-count'),
  statsQuizzesCount: document.getElementById('stats-quizzes-count'),
  statsFlashcardsCount: document.getElementById('stats-flashcards-count'),

  // Workspace Headers
  wsSubjectIcon: document.getElementById('ws-subject-icon'),
  wsSubjectTitle: document.getElementById('ws-subject-title'),
  wsSubjectDesc: document.getElementById('ws-subject-desc'),
  wsBackToDashboard: document.getElementById('ws-back-to-dashboard'),
  wsThemeTabBar: document.getElementById('ws-theme-tab-bar'),

  // Chat Tab
  chatHistory: document.getElementById('chat-history-container'),
  chatUserInput: document.getElementById('chat-user-input'),
  chatSendButton: document.getElementById('chat-send-button'),
  chatSuggestionChips: document.getElementById('chat-suggestion-chips'),

  // Live Room Tab
  liveWebcamElement: document.getElementById('live-webcam-element'),
  webcamStatusOverlay: document.getElementById('webcam-status-overlay'),
  liveAvatarContainer: document.getElementById('live-avatar-container'),
  liveTutorStatusText: document.getElementById('live-tutor-status-text'),
  liveTranscriptionLog: document.getElementById('live-transcription-log'),
  liveStartBtn: document.getElementById('live-start-btn'),
  liveStopBtn: document.getElementById('live-stop-btn'),
  liveCameraToggleBtn: document.getElementById('live-camera-toggle-btn'),

  // Materials Tab
  materialContentTextarea: document.getElementById('material-content-textarea'),
  materialFileLoader: document.getElementById('material-file-loader'),
  saveMaterialBtn: document.getElementById('save-material-btn'),
  materialStatus: document.getElementById('material-status'),
  materialStatusText: document.getElementById('material-status-text'),

  // Podcast Tab
  cassetteWrapper: document.querySelector('.spinning-cassette-wrapper'),
  hostAAvatar: document.getElementById('host-a-avatar'),
  hostBAvatar: document.getElementById('host-b-avatar'),
  podcastStyle: document.getElementById('podcast-style'),
  podcastGenerateBtn: document.getElementById('podcast-generate-btn'),
  podcastPlayBtn: document.getElementById('podcast-play-btn'),
  podcastStopBtn: document.getElementById('podcast-stop-btn'),
  podcastTranscriptContainer: document.getElementById('podcast-transcript-container'),

  // Video Tab
  videoPresentationStage: document.getElementById('video-presentation-stage'),
  videoSlideViewport: document.getElementById('video-slide-viewport'),
  videoSlideCaption: document.getElementById('video-slide-caption'),
  videoThemeSelect: document.getElementById('video-theme-select'),
  videoNarrationSpeed: document.getElementById('video-narration-speed'),
  videoGenerateBtn: document.getElementById('video-generate-btn'),
  videoPlayBtn: document.getElementById('video-play-btn'),
  videoStopBtn: document.getElementById('video-stop-btn'),

  // Quizzes Tab
  quizSetupSection: document.getElementById('quiz-setup-section'),
  quizRunnerSection: document.getElementById('quiz-runner-section'),
  quizFeedbackSection: document.getElementById('quiz-feedback-section'),
  quizQuestionCount: document.getElementById('quiz-question-count'),
  quizQuestionType: document.getElementById('quiz-question-type'),
  quizDifficulty: document.getElementById('quiz-difficulty'),
  generateQuizBtn: document.getElementById('generate-quiz-btn'),
  quizQuestionsContainer: document.getElementById('quiz-questions-container'),
  quizPrevBtn: document.getElementById('quiz-prev-btn'),
  quizNextBtn: document.getElementById('quiz-next-btn'),
  quizSubmitBtn: document.getElementById('quiz-submit-btn'),
  quizProgressFill: document.getElementById('quiz-progress-fill-element'),
  quizScoreDisplay: document.getElementById('quiz-score-display'),
  quizFeedbackHeadline: document.getElementById('quiz-feedback-headline'),
  quizFeedbackList: document.getElementById('quiz-feedback-list-element'),
  quizRestartBtn: document.getElementById('quiz-restart-btn'),

  // Flashcards Tab
  flashcardSetupSection: document.getElementById('flashcard-setup-section'),
  flashcardViewerSection: document.getElementById('flashcard-viewer-section'),
  generateFlashcardsBtn: document.getElementById('generate-flashcards-btn'),
  flashcardCounter: document.getElementById('flashcard-counter'),
  flashcardProgressDots: document.getElementById('flashcard-progress-dots'),
  flashcardWrapper: document.getElementById('flashcard-wrapper-element'),
  flashcardQuestionText: document.getElementById('flashcard-question-text'),
  flashcardAnswerText: document.getElementById('flashcard-answer-text'),
  flashcardEasyBtn: document.getElementById('flashcard-easy-btn'),
  flashcardHardBtn: document.getElementById('flashcard-hard-btn'),
  flashcardNextBtn: document.getElementById('flashcard-next-btn'),
  flashcardResetDeckBtn: document.getElementById('flashcard-reset-deck-btn'),

  // Settings
  settingsApiKey: document.getElementById('settings-api-key'),
  toggleApiVisibility: document.getElementById('toggle-api-visibility'),
  apiStatusDot: document.getElementById('api-status-dot'),
  apiStatusText: document.getElementById('api-status-text'),
  settingsModelSelect: document.getElementById('settings-model-select'),
  settingsTemperature: document.getElementById('settings-temperature'),
  tempValDisplay: document.getElementById('temp-val-display'),
  settingsPersona: document.getElementById('settings-persona'),
  settingsSaveBtn: document.getElementById('settings-save-btn'),
  settingsClearDataBtn: document.getElementById('settings-clear-data-btn'),

  // Subject Modal
  subjectModal: document.getElementById('subject-modal'),
  subjectModalTitle: document.getElementById('subject-modal-title'),
  subjectModalClose: document.getElementById('subject-modal-close'),
  subjectModalCancel: document.getElementById('subject-modal-cancel'),
  subjectModalSave: document.getElementById('subject-modal-save'),
  subjectNameInput: document.getElementById('subject-name'),
  subjectDescInput: document.getElementById('subject-desc'),
  subjectIconInput: document.getElementById('subject-icon'),
  subjectVoiceGender: document.getElementById('subject-voice-gender'),
  colorPickerGrid: document.getElementById('color-picker-grid')
};

// --- Initialization & State Load ---
function init() {
  loadState();
  populateModelSelect();
  renderGreeting();
  renderSidebarSubjects();
  renderDashboardSubjects();
  updateStatsDisplay();
  bindGlobalEvents();
  updateAPIStatus();
  initSpeechVoices();
  renderSubjectVoiceSettings();
  setupSpeechRecognition();
}

function loadState() {
  const savedState = localStorage.getItem('study_hub_state');
  if (savedState) {
    try {
      state = { ...state, ...JSON.parse(savedState) };
      // Sync presets if state loaded is empty/partial
      if (!state.subjects || state.subjects.length === 0) {
        state.subjects = JSON.parse(JSON.stringify(DEFAULT_SUBJECTS));
      }
    } catch (e) {
      console.error('Failed to parse localStorage state', e);
    }
  } else {
    state.subjects = JSON.parse(JSON.stringify(DEFAULT_SUBJECTS));
    saveState();
  }
}

function saveState() {
  localStorage.setItem('study_hub_state', JSON.stringify(state));
}

function populateModelSelect() {
  elements.settingsModelSelect.innerHTML = '';
  GEMINI_MODELS.forEach(model => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    option.selected = state.selectedModel === model.id;
    elements.settingsModelSelect.appendChild(option);
  });
}

function renderGreeting() {
  const hour = new Date().getHours();
  let greeting = 'Good morning, Kittappa!';
  if (hour >= 12 && hour < 17) greeting = 'Good afternoon, Kittappa!';
  else if (hour >= 17) greeting = 'Good evening, Kittappa!';
  elements.greetingText.textContent = greeting;
}

function updateStatsDisplay() {
  elements.statsSubjectsCount.textContent = state.subjects.length;
  elements.statsQuizzesCount.textContent = state.stats.quizzesCompleted || 0;
  elements.statsFlashcardsCount.textContent = state.stats.cardsReviewed || 0;
}

function updateAPIStatus() {
  if (state.apiKey) {
    elements.settingsApiKey.value = state.apiKey;
    elements.apiStatusDot.className = 'api-status-dot valid';
    elements.apiStatusText.textContent = 'API Key Configured';
    elements.apiStatusText.style.color = 'var(--success)';
  } else {
    elements.settingsApiKey.value = '';
    elements.apiStatusDot.className = 'api-status-dot invalid';
    elements.apiStatusText.textContent = 'No API key configured. Live Room/Quizzes/Chat will fail.';
    elements.apiStatusText.style.color = 'var(--danger)';
  }
}

// --- Dynamic Settings UI for voices ---
function renderSubjectVoiceSettings() {
  const container = document.getElementById('settings-subject-voices-container');
  if (!container) return;
  container.innerHTML = '';

  state.subjects.forEach(subj => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.padding = '8px 12px';
    row.style.backgroundColor = 'var(--bg-deep)';
    row.style.borderRadius = '8px';
    row.style.border = '1px solid var(--border-color)';

    if (!subj.voiceGender) {
      subj.voiceGender = (subj.id.includes('history') || subj.id.includes('biology')) ? 'female' : 'male';
    }

    row.innerHTML = `
      <span style="font-size:0.88rem; font-weight:500;">${subj.icon} ${subj.name}</span>
      <select class="form-control" style="width:120px; padding:4px 8px; font-size:0.8rem;" data-subj-id="${subj.id}">
        <option value="male" ${subj.voiceGender === 'male' ? 'selected' : ''}>Male Voice</option>
        <option value="female" ${subj.voiceGender === 'female' ? 'selected' : ''}>Female Voice</option>
      </select>
    `;

    row.querySelector('select').addEventListener('change', (e) => {
      subj.voiceGender = e.target.value;
      saveState();
    });

    container.appendChild(row);
  });
}

// --- Navigation Controller ---
function switchView(viewName, subjectId = null) {
  // If active, stop playback
  stopAudioEngines();

  state.activeView = viewName;
  state.activeSubjectId = subjectId;

  elements.navDashboard.classList.toggle('active', viewName === 'dashboard');
  elements.navSettings.classList.toggle('active', viewName === 'settings');

  document.querySelectorAll('#sidebar-subjects-list .menu-item').forEach(item => {
    item.classList.remove('active');
  });

  if (viewName === 'workspace' && subjectId) {
    const activeItem = document.querySelector(`#sidebar-subjects-list .menu-item[data-id="${subjectId}"]`);
    if (activeItem) activeItem.classList.add('active');
  }

  elements.viewDashboard.classList.toggle('active', viewName === 'dashboard');
  elements.viewSettings.classList.toggle('active', viewName === 'settings');
  elements.viewSubjectWorkspace.classList.toggle('active', viewName === 'workspace');

  if (viewName === 'workspace' && subjectId) {
    loadSubjectWorkspace(subjectId);
  }
}

function stopAudioEngines() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  
  // Close Live Room camera streams
  stopLiveSession();
  
  // Reset podcast animation state
  isPodcastPlaying = false;
  elements.cassetteWrapper.classList.remove('playing');
  elements.hostAAvatar.classList.remove('speaking');
  elements.hostBAvatar.classList.remove('speaking');
  
  // Reset video slide show
  isVideoPlaying = false;
}

// --- Subject UI Populators ---
function renderSidebarSubjects() {
  elements.sidebarSubjectsList.innerHTML = '';
  state.subjects.forEach(subj => {
    const item = document.createElement('div');
    item.className = `menu-item ${state.activeSubjectId === subj.id ? 'active' : ''}`;
    item.setAttribute('data-id', subj.id);
    item.innerHTML = `
      <span class="subject-icon">${subj.icon}</span>
      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${subj.name}</span>
    `;
    item.addEventListener('click', () => switchView('workspace', subj.id));
    elements.sidebarSubjectsList.appendChild(item);
  });
}

function renderDashboardSubjects() {
  elements.subjectsContainer.innerHTML = '';
  
  state.subjects.forEach(subj => {
    const card = document.createElement('div');
    card.className = 'subject-card';
    card.style.setProperty('--theme-color', subj.color);
    card.style.setProperty('--theme-color-glow', subj.color.replace(')', ', 0.25)').replace('hsl', 'hsla'));
    card.style.setProperty('--theme-bg', subj.color.replace(')', ', 0.12)').replace('hsl', 'hsla'));
    card.style.setProperty('--theme-gradient', `linear-gradient(135deg, ${subj.color}, ${adjustHSL(subj.color, 40)})`);

    const hasNotes = subj.materials && subj.materials.trim().length > 0;
    const charCount = hasNotes ? subj.materials.length : 0;
    const cardsCount = subj.flashcards ? subj.flashcards.length : 0;

    card.innerHTML = `
      <div class="subject-card-header">
        <div class="subject-card-icon-wrapper">${subj.icon}</div>
        <button class="subject-card-menu" title="Delete Subject">✕</button>
      </div>
      <div class="subject-card-body">
        <h3>${subj.name}</h3>
        <p>${subj.desc || 'No description provided.'}</p>
      </div>
      <div class="subject-card-footer">
        <div class="subject-card-materials-count">
          <span>📖 ${charCount > 0 ? (charCount + ' chars') : 'No notes'}</span>
          <span>🎴 ${cardsCount} cards</span>
          <span style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">🎙️ Voice: ${subj.voiceGender || 'Female'}</span>
        </div>
        <button class="subject-card-btn">Study</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('subject-card-menu')) {
        e.stopPropagation();
        deleteSubject(subj.id);
      } else {
        switchView('workspace', subj.id);
      }
    });

    elements.subjectsContainer.appendChild(card);
  });

  const createCard = document.createElement('div');
  createCard.className = 'subject-card create-subject-card';
  createCard.innerHTML = `
    <div class="plus-icon">+</div>
    <div>Add Subject</div>
  `;
  createCard.addEventListener('click', () => openSubjectModal());
  elements.subjectsContainer.appendChild(createCard);
}

function deleteSubject(subjectId) {
  if (confirm('Are you sure you want to delete this subject? All notes, chats, flashcards, and progress will be permanently lost.')) {
    state.subjects = state.subjects.filter(s => s.id !== subjectId);
    saveState();
    renderSidebarSubjects();
    renderDashboardSubjects();
    renderSubjectVoiceSettings();
    updateStatsDisplay();
    if (state.activeSubjectId === subjectId) {
      switchView('dashboard');
    }
  }
}

function adjustHSL(hslStr, angleShift) {
  const matches = hslStr.match(/\d+/g);
  if (matches && matches.length >= 3) {
    let h = (parseInt(matches[0]) + angleShift) % 360;
    return `hsl(${h}, ${matches[1]}%, ${matches[2]}%)`;
  }
  return hslStr;
}

// --- Workspace Activator ---
function loadSubjectWorkspace(subjectId) {
  const subj = state.subjects.find(s => s.id === subjectId);
  if (!subj) return;

  elements.wsSubjectTitle.textContent = subj.name;
  elements.wsSubjectDesc.textContent = subj.desc || '';
  elements.wsSubjectIcon.textContent = subj.icon;

  const headerElement = elements.viewSubjectWorkspace;
  headerElement.style.setProperty('--theme-color', subj.color);
  headerElement.style.setProperty('--theme-color-glow', subj.color.replace(')', ', 0.35)').replace('hsl', 'hsla'));
  headerElement.style.setProperty('--theme-gradient', `linear-gradient(90deg, ${subj.color}, ${adjustHSL(subj.color, 45)})`);

  switchWorkspaceTab('tab-chat');

  elements.materialContentTextarea.value = subj.materials || '';
  updateMaterialStatusDisplay();

  renderChatHistory();
  resetFlashcardUI();
  resetQuizUI();
  resetPodcastUI();
  resetVideoUI();
}

function switchWorkspaceTab(tabId) {
  stopAudioEngines();

  document.querySelectorAll('.workspace-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-tab') === tabId);
  });

  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === tabId);
  });

  if (tabId === 'tab-live-room') {
    elements.liveTranscriptionLog.innerHTML = `<div style="color:var(--text-muted); font-style:italic;">Click "Start Live Session" to talk directly with your tutor. Speak naturally; the tutor will listen, capture a camera frame to analyze your context, and answer you back.</div>`;
  }
}

// --- Chat Mode ---
function renderChatHistory() {
  const subj = state.subjects.find(s => s.id === state.activeSubjectId);
  if (!subj) return;

  elements.chatHistory.innerHTML = '';
  
  if (!subj.chatHistory || subj.chatHistory.length === 0) {
    subj.chatHistory = [
      { role: 'model', parts: [{ text: `Hello! I am your ${subj.name} tutor. Let me know what concepts you would like to explore today!` }] }
    ];
  }

  subj.chatHistory.forEach(msg => {
    appendMessageToDOM(msg.role, msg.parts[0].text);
  });
  scrollChatToBottom();
}

function appendMessageToDOM(role, text, isStreaming = false) {
  const isModel = role === 'model';
  let messageDiv = null;
  if (isStreaming) {
    messageDiv = elements.chatHistory.querySelector('.chat-message.model.streaming-bubble');
  }

  if (!messageDiv) {
    messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role} ${isStreaming ? 'streaming-bubble' : ''}`;
    
    const sender = document.createElement('div');
    sender.className = 'message-sender';
    sender.textContent = isModel ? 'Gemini Tutor' : 'You';
    messageDiv.appendChild(sender);

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    messageDiv.appendChild(bubble);

    elements.chatHistory.appendChild(messageDiv);
  }

  const bubble = messageDiv.querySelector('.message-bubble');
  if (isModel) {
    bubble.innerHTML = parseMarkdown(text);
  } else {
    bubble.textContent = text;
  }
  scrollChatToBottom();
}

function scrollChatToBottom() {
  elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
}

function showChatTypingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'chat-message model typing-indicator-bubble';
  indicator.innerHTML = `
    <div class="message-sender">Gemini Tutor</div>
    <div class="message-bubble" style="padding:10px 16px;">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  elements.chatHistory.appendChild(indicator);
  scrollChatToBottom();
}

function removeChatTypingIndicator() {
  const indicator = elements.chatHistory.querySelector('.typing-indicator-bubble');
  if (indicator) indicator.remove();
}

async function sendChatMessage(customText = '') {
  if (isGeneratingResponse) return;

  const subj = state.subjects.find(s => s.id === state.activeSubjectId);
  if (!subj) return;

  const text = customText ? customText.trim() : elements.chatUserInput.value.trim();
  if (!text) return;

  if (!customText) {
    elements.chatUserInput.value = '';
    elements.chatUserInput.style.height = '48px';
  }

  if (!state.apiKey) {
    alert('Please set your Gemini API key in the settings tab before starting chat.');
    switchView('settings');
    return;
  }

  subj.chatHistory.push({ role: 'user', parts: [{ text: text }] });
  saveState();
  appendMessageToDOM('user', text);

  isGeneratingResponse = true;
  showChatTypingIndicator();

  let personaInstruction = '';
  switch (state.persona) {
    case 'socratic':
      personaInstruction = 'You are a Socratic tutor. Never offer direct answers immediately. Ask guiding, thought-provoking questions, challenge assumptions, and lead the student to discover facts on their own.';
      break;
    case 'rigorous':
      personaInstruction = 'You are a highly formal and precise academic advisor. Explain concepts using exact technical vocabulary. Correct any subtle mistakes or logical flaws in the student\'s statements, and encourage deep analytical accuracy.';
      break;
    case 'analogy':
      personaInstruction = 'You are a highly visual, creative teacher. Explain hard abstract concepts using vivid, relatable real-world analogies, metaphors, and descriptions that help them visualize the topic.';
      break;
    case 'friendly':
    default:
      personaInstruction = 'You are a supportive, warm, and patient tutor. Explain ideas simply and clearly, provide encouraging statements, and break down complex steps slowly.';
      break;
  }

  const systemInstruction = `You are a expert study assistant and tutor for the subject: ${subj.name}.
Your current teaching style instruction: ${personaInstruction}.

Here are the reference study materials (notes, chapters, or syllabus text) the student has uploaded:
---
${subj.materials || 'No reference materials uploaded yet.'}
---

Your Guidelines:
1. Ground your explanations in the reference study materials whenever possible.
2. If the student asks questions not covered in the materials, provide accurate answers from general knowledge, but note that it goes beyond their study notes.
3. Keep response formatting clean, utilizing lists, bold text, headers, and code blocks via Markdown.
4. Keep explanations clear, engaging, and focused on helping them learn.`;

  const modelId = state.selectedModel || 'gemini-2.5-flash';
  const recentHistory = subj.chatHistory.slice(-12);

  try {
    await streamContent({
      apiKey: state.apiKey,
      model: modelId,
      systemInstruction: systemInstruction,
      contents: recentHistory,
      temperature: state.temperature,
      onChunk: (chunkText, fullText) => {
        removeChatTypingIndicator();
        appendMessageToDOM('model', fullText, true);
      },
      onComplete: (fullText) => {
        const streamBubble = elements.chatHistory.querySelector('.chat-message.model.streaming-bubble');
        if (streamBubble) {
          streamBubble.classList.remove('streaming-bubble');
        }
        subj.chatHistory.push({ role: 'model', parts: [{ text: fullText }] });
        saveState();
        isGeneratingResponse = false;
      },
      onError: (err) => {
        removeChatTypingIndicator();
        isGeneratingResponse = false;
        alert(`Failed to stream from Gemini API: ${err.message}`);
      }
    });
  } catch (error) {
    removeChatTypingIndicator();
    isGeneratingResponse = false;
    alert(`Error: ${error.message}`);
  }
}

// --- Live Audio & Video Room ---
function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("Browser SpeechRecognition is not supported in this browser.");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isLiveListening = true;
    elements.liveTutorStatusText.textContent = "Listening...";
    elements.liveTutorStatusText.style.color = "var(--glow-blue)";
  };

  recognition.onerror = (e) => {
    console.error("Speech Recognition error:", e);
    // Restart if active
    if (isLiveSessionActive) {
      setTimeout(() => startListeningLoop(), 500);
    }
  };

  recognition.onend = () => {
    isLiveListening = false;
    if (isLiveSessionActive && !window.speechSynthesis.speaking) {
      elements.liveTutorStatusText.textContent = "Tutor Thinking...";
      elements.liveTutorStatusText.style.color = "var(--warning)";
    }
  };

  recognition.onresult = async (event) => {
    const speechResult = event.results[0][0].transcript;
    if (!speechResult) return;

    // Display user speech bubble in log
    appendLiveLogBubble('user-speech', `You: ${speechResult}`);

    // Capture camera snapshot
    const base64Frame = captureWebcamFrame();
    
    // Process through Gemini multimodal query
    await queryLiveTutor(speechResult, base64Frame);
  };
}

function appendLiveLogBubble(type, text) {
  const bubble = document.createElement('div');
  bubble.className = `live-log-bubble ${type}`;
  bubble.textContent = text;
  elements.liveTranscriptionLog.appendChild(bubble);
  elements.liveTranscriptionLog.scrollTop = elements.liveTranscriptionLog.scrollHeight;
}

function startListeningLoop() {
  if (!isLiveSessionActive || isLiveListening) return;
  try {
    recognition.start();
  } catch (e) {
    console.warn("Recognition start failed (could already be listening)", e);
  }
}

function captureWebcamFrame() {
  const video = elements.liveWebcamElement;
  // If camera is offline, return null
  if (!video || !liveStream || video.srcObject === null) return null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    
    // Mirror horizontally
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Return base64 payload without the headers
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
  } catch (err) {
    console.error("Frame capture error:", err);
    return null;
  }
}

async function queryLiveTutor(speechInput, base64Frame) {
  const subj = state.subjects.find(s => s.id === state.activeSubjectId);
  if (!subj) return;

  const modelId = state.selectedModel || 'gemini-2.5-flash';
  
  // System instructions
  const systemInstruction = `You are a expert study assistant and tutor in Kittappa's Study Room for the subject: ${subj.name}.
We are having a dynamic Live Audio & Video session. Keep your replies concise and conversational (1-3 sentences maximum).

Guidelines:
1. Explain concepts simply so they are easy to listen to.
2. The user has shared a snapshot frame of their camera. If they hold up a notebook, object, or point to anything, reference it. If it is just a face or empty room, focus on their verbal query.
3. Reference their study notes when possible:
---
${subj.materials || 'No notes uploaded.'}
---`;

  // Build multimodal content parts
  const parts = [{ text: speechInput }];
  
  if (base64Frame) {
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: base64Frame
      }
    });
  }

  // Construct query history (only user text and model responses for simplicity in Live Room)
  const queryContents = [
    { role: 'user', parts: parts }
  ];

  try {
    const reply = await generateContent({
      apiKey: state.apiKey,
      model: modelId,
      systemInstruction: systemInstruction,
      contents: queryContents,
      temperature: 0.6
    });

    if (!isLiveSessionActive) return; // session ended mid-query

    // Print tutor speech bubble in log
    appendLiveLogBubble('tutor-speech', `Tutor: ${reply}`);

    // Read aloud using TTS
    elements.liveTutorStatusText.textContent = "Tutor Speaking...";
    elements.liveTutorStatusText.style.color = "var(--success)";
    
    speakText({
      text: reply,
      gender: subj.voiceGender || 'female',
      onStart: () => {
        elements.liveAvatarContainer.classList.add('speaking');
      },
      onEnd: () => {
        elements.liveAvatarContainer.classList.remove('speaking');
        elements.liveTutorStatusText.textContent = "Live Stream Active";
        elements.liveTutorStatusText.style.color = "var(--text-secondary)";
        
        // Loop back to speech recognition
        if (isLiveSessionActive) {
          startListeningLoop();
        }
      }
    });

  } catch (error) {
    console.error("Live Query Error:", error);
    appendLiveLogBubble('tutor-speech', `System Error: ${error.message}`);
    elements.liveTutorStatusText.textContent = "Live Stream Active";
    elements.liveTutorStatusText.style.color = "var(--text-secondary)";
    
    if (isLiveSessionActive) {
      startListeningLoop();
    }
  }
}

async function startLiveSession() {
  if (!state.apiKey) {
    alert("Please configure your Gemini API Key in Settings first.");
    switchView('settings');
    return;
  }
  
  isLiveSessionActive = true;
  elements.liveStartBtn.style.display = 'none';
  elements.liveStopBtn.style.display = 'block';
  elements.liveCameraToggleBtn.disabled = false;
  
  elements.liveTutorStatusText.textContent = "Starting Feed...";
  elements.liveTutorStatusText.style.color = "var(--warning)";

  // Request camera
  try {
    liveStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false // audio processed by SpeechRecognition separately
    });
    
    elements.liveWebcamElement.srcObject = liveStream;
    elements.liveCameraToggleBtn.textContent = "Camera: On";
    document.querySelector('.live-webcam-panel').classList.add('camera-on');
  } catch (err) {
    console.warn("Camera access denied or unavailable. Running in Audio-Only mode:", err);
    elements.liveCameraToggleBtn.textContent = "Camera: Off";
    document.querySelector('.live-webcam-panel').classList.remove('camera-on');
  }

  // Start Voice loop
  if (recognition) {
    startListeningLoop();
  } else {
    alert("Voice Speech Recognition is not supported by your browser (use Chrome/Edge). Live room will be camera-only.");
  }
}

function stopLiveSession() {
  isLiveSessionActive = false;
  isLiveListening = false;
  
  elements.liveStartBtn.style.display = 'block';
  elements.liveStopBtn.style.display = 'none';
  elements.liveCameraToggleBtn.disabled = true;
  elements.liveCameraToggleBtn.textContent = "Camera: Off";
  document.querySelector('.live-webcam-panel').classList.remove('camera-on');
  
  elements.liveTutorStatusText.textContent = "Tutor Offline";
  elements.liveTutorStatusText.style.color = "var(--text-muted)";
  elements.liveAvatarContainer.classList.remove('speaking');

  if (liveStream) {
    liveStream.getTracks().forEach(track => track.stop());
    liveStream = null;
  }
  if (elements.liveWebcamElement) {
    elements.liveWebcamElement.srcObject = null;
  }
  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {}
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

// --- Study Notes Material Importer ---
function updateMaterialStatusDisplay() {
  const content = elements.materialContentTextarea.value.trim();
  if (content.length > 0) {
    elements.materialStatus.className = 'material-status-badge status-loaded';
    elements.materialStatusText.textContent = `${content.length} characters loaded`;
  } else {
    elements.materialStatus.className = 'material-status-badge status-empty';
    elements.materialStatusText.textContent = 'Empty Workspace Notes';
  }
}

function saveStudyMaterial() {
  const subj = state.subjects.find(s => s.id === state.activeSubjectId);
  if (!subj) return;

  subj.materials = elements.materialContentTextarea.value;
  saveState();
  updateMaterialStatusDisplay();
  renderDashboardSubjects();
  
  const btn = elements.saveMaterialBtn;
  const oldText = btn.textContent;
  btn.textContent = '✓ Saved Successfully!';
  btn.style.backgroundColor = 'var(--success)';
  setTimeout(() => {
    btn.textContent = oldText;
    btn.style.backgroundColor = '';
  }, 2000);
}

function handleNotesFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  if (file.type === 'application/pdf') {
    elements.materialStatusText.textContent = 'Extracting PDF text...';
    
    // Utilize PDF.js
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

    reader.onload = async function(e) {
      try {
        const arrayBuffer = e.target.result;
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          text += pageText + '\n\n';
        }
        elements.materialContentTextarea.value = text;
        updateMaterialStatusDisplay();
      } catch (err) {
        console.error("PDF parse error:", err);
        alert(`Failed to load PDF text: ${err.message}`);
        updateMaterialStatusDisplay();
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    // Read text files normally
    reader.onload = function(e) {
      elements.materialContentTextarea.value = e.target.result;
      updateMaterialStatusDisplay();
    };
    reader.readAsText(file);
  }
}

// --- NotebookLM Podcast Studio logic ---
function resetPodcastUI() {
  activePodcastScript = null;
  currentPodcastLineIndex = 0;
  isPodcastPlaying = false;
  elements.podcastGenerateBtn.style.display = 'block';
  elements.podcastPlayBtn.style.display = 'none';
  elements.podcastStopBtn.style.display = 'none';
  elements.podcastTranscriptContainer.innerHTML = `<div class="transcript-placeholder" id="podcast-script-placeholder">No podcast generated yet. Click "Generate Podcast" to compile your notes into a dual-host audio show.</div>`;
  elements.cassetteWrapper.classList.remove('playing');
  elements.hostAAvatar.classList.remove('speaking');
  elements.hostBAvatar.classList.remove('speaking');
}

async function startPodcastGeneration() {
  if (isGeneratingResponse) return;

  const subj = state.subjects.find(s => s.id === state.activeSubjectId);
  if (!subj) return;

  const notes = subj.materials ? subj.materials.trim() : '';
  if (!notes) {
    alert('Please load study materials first. The AI hosts need material to discuss!');
    switchWorkspaceTab('tab-materials');
    return;
  }

  if (!state.apiKey) {
    alert('Please configure your Gemini API key in Settings.');
    switchView('settings');
    return;
  }

  const pStyle = elements.podcastStyle.value;

  isGeneratingResponse = true;
  elements.podcastGenerateBtn.textContent = 'Generating Podcast Episode Script... (~15s)';
  elements.podcastGenerateBtn.disabled = true;

  let styleDesc = '';
  if (pStyle === 'chatty') {
    styleDesc = 'highly informal, friendly, funny, with warm jokes, metaphors, and real-world explanations';
  } else if (pStyle === 'debate') {
    styleDesc = 'rigorous, critical, debating alternative theories, challenging each other intellectually';
  } else {
    styleDesc = 'fast-paced exam prep session, highlighting key formulas, terminology, dates, and rapid facts';
  }

  const podcastPrompt = `You are a scriptwriting team for a NotebookLM style discussion podcast. Write a structured podcast script between Host A (Male) and Host B (Female) discussing the study materials below.
  
Study Notes:
---
${notes}
---

Podcast tone details:
- Discussion style choice is: ${styleDesc}.
- Break down the notes into a cohesive conversation of 6-12 turns total.
- Host A and Host B should alternate naturally.

You MUST format the output as a valid JSON object matching this schema. Do not write markdown tags:
{
  "transcript": [
    { "host": "A", "text": "Host A statement..." },
    { "host": "B", "text": "Host B statement..." }
  ]
}
Ensure the output is pure JSON. Do NOT wrap it in markdown code blocks.`;

  try {
    const rawResult = await generateContent({
      apiKey: state.apiKey,
      model: state.selectedModel || 'gemini-2.5-flash',
      systemInstruction: 'You are a JSON writing bot. You write strict JSON data files.',
      contents: [{ role: 'user', parts: [{ text: podcastPrompt }] }],
      temperature: 0.8,
      responseMimeType: 'application/json'
    });

    let cleanJSON = rawResult.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleanJSON);

    if (!parsed.transcript || !Array.isArray(parsed.transcript)) {
      throw new Error("Missing 'transcript' list array in output JSON.");
    }

    activePodcastScript = parsed.transcript;
    renderPodcastScriptLogs();
    
    elements.podcastGenerateBtn.style.display = 'none';
    elements.podcastPlayBtn.style.display = 'block';
    elements.podcastStopBtn.style.display = 'block';

  } catch (error) {
    console.error("Podcast Generation error:", error);
    alert(`Could not generate podcast: ${error.message}`);
  } finally {
    isGeneratingResponse = false;
    elements.podcastGenerateBtn.textContent = 'Generate Podcast Episode';
    elements.podcastGenerateBtn.disabled = false;
  }
}

function renderPodcastScriptLogs() {
  elements.podcastTranscriptContainer.innerHTML = '';
  activePodcastScript.forEach((line, idx) => {
    const div = document.createElement('div');
    div.className = `transcript-line host-${line.host.toLowerCase()}`;
    div.setAttribute('data-index', idx);
    div.innerHTML = `<strong>Host ${line.host}:</strong> ${line.text}`;
    elements.podcastTranscriptContainer.appendChild(div);
  });
}

function playPodcastSession() {
  if (!activePodcastScript) return;
  
  if (isPodcastPlaying) {
    // Pause action
    isPodcastPlaying = false;
    elements.cassetteWrapper.classList.remove('playing');
    elements.hostAAvatar.classList.remove('speaking');
    elements.hostBAvatar.classList.remove('speaking');
    elements.podcastPlayBtn.textContent = 'Play';
    if (window.speechSynthesis) window.speechSynthesis.pause();
  } else {
    // Play or resume action
    isPodcastPlaying = true;
    elements.cassetteWrapper.classList.add('playing');
    elements.podcastPlayBtn.textContent = 'Pause';
    
    if (window.speechSynthesis && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    } else {
      currentPodcastLineIndex = 0;
      speakPodcastLine(0);
    }
  }
}

function speakPodcastLine(index) {
  if (!isPodcastPlaying || !activePodcastScript || index >= activePodcastScript.length) {
    // Reached the end of podcast
    resetPodcastUI();
    return;
  }

  currentPodcastLineIndex = index;
  const line = activePodcastScript[index];
  const isA = line.host === 'A';
  
  // Highlight active speech bubbles in script log
  document.querySelectorAll('.transcript-line').forEach(el => {
    el.classList.toggle('speaking', el.getAttribute('data-index') == index);
  });

  const activeLineElement = elements.podcastTranscriptContainer.querySelector(`.transcript-line[data-index="${index}"]`);
  if (activeLineElement) {
    activeLineElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Speak
  speakText({
    text: line.text,
    gender: isA ? 'male' : 'female',
    rate: 1.05,
    onStart: () => {
      elements.hostAAvatar.classList.toggle('speaking', isA);
      elements.hostBAvatar.classList.toggle('speaking', !isA);
    },
    onEnd: () => {
      if (isPodcastPlaying) {
        speakPodcastLine(index + 1);
      }
    }
  });
}

// --- Video Presentation Lecture Logic ---
function resetVideoUI() {
  activeVideoSlides = null;
  currentVideoSlideIndex = 0;
  isVideoPlaying = false;
  elements.videoGenerateBtn.style.display = 'block';
  elements.videoPlayBtn.style.display = 'none';
  elements.videoStopBtn.style.display = 'none';
  elements.videoSlideCaption.textContent = "Narrator: Offline";
  elements.videoSlideViewport.innerHTML = `
    <div class="video-slide-title">Kittappa Video Lecture Studio</div>
    <div class="video-slide-body">
      <p>Welcome! Generate a video lecture to transform your written reference notes into an interactive slide presentation narrated aloud by your subject tutor.</p>
      <ul style="margin-top:20px; text-align:left; display:inline-block;">
        <li>Auto-generated visual slides</li>
        <li>Synchronized speech narration</li>
        <li>Toggle styles: Glassmorphic Slides or Chalkboard Slate</li>
      </ul>
    </div>
  `;
}

async function startVideoLectureGeneration() {
  if (isGeneratingResponse) return;

  const subj = state.subjects.find(s => s.id === state.activeSubjectId);
  if (!subj) return;

  const notes = subj.materials ? subj.materials.trim() : '';
  if (!notes) {
    alert('Please enter or upload Study Material notes before generating a video lecture.');
    switchWorkspaceTab('tab-materials');
    return;
  }

  if (!state.apiKey) {
    alert('Please configure your Gemini API Key in Settings.');
    switchView('settings');
    return;
  }

  isGeneratingResponse = true;
  elements.videoGenerateBtn.textContent = 'Writing Video Slides... (~15s)';
  elements.videoGenerateBtn.disabled = true;

  const videoPrompt = `You are a creative lecture scriptwriter. Read the study materials notes below and convert them into a slide presentation of 3-5 slides.
  
Study Materials Notes:
---
${notes}
---

Guidelines:
- Each slide has a concise title, 2-3 short bullet points, and a narration script paragraph explaining the slide contents.

You MUST format the output as a valid JSON object matching this schema. Do not write markdown tags:
{
  "slides": [
    {
      "title": "Slide Title here",
      "bullets": ["Bullet point 1", "Bullet point 2"],
      "narration": "Narration text spoken aloud by the professor during this slide..."
    }
  ]
}
Ensure the output is pure JSON. Do NOT wrap it in markdown code blocks.`;

  try {
    const rawResult = await generateContent({
      apiKey: state.apiKey,
      model: state.selectedModel || 'gemini-2.5-flash',
      systemInstruction: 'You are a presentation JSON compiler. You structure lectures in JSON format.',
      contents: [{ role: 'user', parts: [{ text: videoPrompt }] }],
      temperature: 0.6,
      responseMimeType: 'application/json'
    });

    let cleanJSON = rawResult.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleanJSON);

    if (!parsed.slides || !Array.isArray(parsed.slides)) {
      throw new Error("Missing 'slides' list array in output JSON.");
    }

    activeVideoSlides = parsed.slides;
    
    // Prompt visual presentation loaded
    elements.videoSlideViewport.innerHTML = `
      <div class="video-slide-title">Lecture Compiled Successfully!</div>
      <div class="video-slide-body">
        <p>Your video lecture consists of <strong>${activeVideoSlides.length} slides</strong>. Click "Play Lecture" below to begin the presentation.</p>
      </div>
    `;

    elements.videoGenerateBtn.style.display = 'none';
    elements.videoPlayBtn.style.display = 'block';
    elements.videoStopBtn.style.display = 'block';

  } catch (error) {
    console.error("Video compile error:", error);
    alert(`Could not compile video lecture: ${error.message}`);
  } finally {
    isGeneratingResponse = false;
    elements.videoGenerateBtn.textContent = 'Generate Video Lecture';
    elements.videoGenerateBtn.disabled = false;
  }
}

function playVideoLecture() {
  if (!activeVideoSlides) return;

  if (isVideoPlaying) {
    // Pause
    isVideoPlaying = false;
    elements.videoPlayBtn.textContent = 'Play Lecture';
    if (window.speechSynthesis) window.speechSynthesis.pause();
  } else {
    // Play or resume
    isVideoPlaying = true;
    elements.videoPlayBtn.textContent = 'Pause Lecture';
    
    if (window.speechSynthesis && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    } else {
      currentVideoSlideIndex = 0;
      renderAndSpeakSlide(0);
    }
  }
}

function renderAndSpeakSlide(index) {
  if (!isVideoPlaying || !activeVideoSlides || index >= activeVideoSlides.length) {
    // End of presentation
    resetVideoUI();
    return;
  }

  currentVideoSlideIndex = index;
  const slide = activeVideoSlides[index];
  const subj = state.subjects.find(s => s.id === state.activeSubjectId);

  // Render slide layout
  elements.videoSlideViewport.innerHTML = `
    <div class="video-slide-title">${slide.title}</div>
    <div class="video-slide-body">
      <ul style="text-align:left; display:inline-block; max-width:90%;">
        ${slide.bullets.map(b => `<li>${b}</li>`).join('')}
      </ul>
    </div>
  `;

  // Apply Selected Aesthetic Theme classes
  const theme = elements.videoThemeSelect.value;
  elements.videoPresentationStage.className = `slide-presentation-stage ${theme}`;

  // Caption Narration
  elements.videoSlideCaption.textContent = `Narrator: "${slide.narration.substring(0, 80)}..."`;

  // Read aloud narration
  const speed = parseFloat(elements.videoNarrationSpeed.value) || 1.0;
  speakText({
    text: slide.narration,
    gender: subj.voiceGender || 'female',
    rate: speed,
    onStart: () => {},
    onEnd: () => {
      if (isVideoPlaying) {
        // Auto-advance
        renderAndSpeakSlide(index + 1);
      }
    }
  });
}

// --- Practice Quizzes Core ---
function resetQuizUI() {
  elements.quizSetupSection.style.display = 'block';
  elements.quizRunnerSection.style.display = 'none';
  elements.quizFeedbackSection.style.display = 'none';
  activeQuiz = null;
  currentQuizQuestionIndex = 0;
  userQuizAnswers = [];
}

async function startQuizGeneration() {
  if (isGeneratingResponse) return;

  const subj = state.subjects.find(s => s.id === state.activeSubjectId);
  if (!subj) return;

  const notes = subj.materials ? subj.materials.trim() : '';
  if (!notes) {
    alert('Please enter or upload Study Material notes before generating a quiz.');
    switchWorkspaceTab('tab-materials');
    return;
  }

  if (!state.apiKey) {
    alert('Please set your Gemini API key in the settings tab.');
    switchView('settings');
    return;
  }

  const numQuestions = elements.quizQuestionCount.value;
  const quizType = elements.quizQuestionType.value;
  const difficulty = elements.quizDifficulty.value;

  isGeneratingResponse = true;
  elements.generateQuizBtn.textContent = '⚡ Generating Quiz Questions... (takes ~10s)';
  elements.generateQuizBtn.disabled = true;

  const quizPrompt = `You are an expert curriculum examiner. Based ONLY on the provided study materials below, generate a practice quiz with exactly ${numQuestions} questions of difficulty "${difficulty}".
  
Study Materials:
---
${notes}
---

Question Format guidelines:
- If format is "mcq", each question must have exactly 4 logical options, and one "correctAnswer" which matches one of the option texts exactly.
- If format is "short", options is empty, and "correctAnswer" should be a brief 1-2 sentence grading guideline explaining what core elements make a correct answer.

You MUST format the output as a valid JSON object matching this schema:
{
  "questions": [
    {
      "id": 1,
      "question": "The question text here...",
      "type": "${quizType}",
      "options": ["Option A", "Option B", "Option C", "Option D"], 
      "correctAnswer": "Option A"
    }
  ]
}
Ensure the output is pure JSON. Do NOT wrap the JSON inside markdown code blocks.`;

  try {
    const rawResult = await generateContent({
      apiKey: state.apiKey,
      model: state.selectedModel || 'gemini-2.5-flash',
      systemInstruction: 'You are a JSON generator. You only output valid JSON matching the exact schema specified.',
      contents: [{ role: 'user', parts: [{ text: quizPrompt }] }],
      temperature: 0.5,
      responseMimeType: 'application/json'
    });

    let cleanJSON = rawResult.replace(/```json|```/g, '').trim();
    const parsedQuiz = JSON.parse(cleanJSON);
    if (!parsedQuiz.questions || !Array.isArray(parsedQuiz.questions)) {
      throw new Error("JSON structure did not contain 'questions' array.");
    }

    activeQuiz = parsedQuiz.questions;
    currentQuizQuestionIndex = 0;
    userQuizAnswers = new Array(activeQuiz.length).fill('');
    
    elements.quizSetupSection.style.display = 'none';
    elements.quizRunnerSection.style.display = 'block';
    
    renderQuizQuestion(0);
  } catch (error) {
    console.error('Quiz Generation Error:', error);
    alert(`Could not generate quiz: ${error.message}. Please try again.`);
  } finally {
    isGeneratingResponse = false;
    elements.generateQuizBtn.textContent = '✨ Generate Quiz with Gemini';
    elements.generateQuizBtn.disabled = false;
  }
}

function renderQuizQuestion(index) {
  if (!activeQuiz || index < 0 || index >= activeQuiz.length) return;

  const q = activeQuiz[index];
  elements.quizQuestionsContainer.innerHTML = '';
  
  const questionCard = document.createElement('div');
  questionCard.className = 'quiz-question-card active';
  
  questionCard.innerHTML = `
    <div class="quiz-question-number">Question ${index + 1} of ${activeQuiz.length}</div>
    <div class="quiz-question-text">${q.question}</div>
    <div class="quiz-options-container" id="quiz-question-options-body"></div>
  `;
  
  elements.quizQuestionsContainer.appendChild(questionCard);
  const optionsBody = document.getElementById('quiz-question-options-body');

  if (q.type === 'mcq' && q.options) {
    const list = document.createElement('div');
    list.className = 'quiz-options-list';
    
    q.options.forEach((opt) => {
      const optionLabel = document.createElement('label');
      const isSelected = userQuizAnswers[index] === opt;
      optionLabel.className = `quiz-option ${isSelected ? 'selected' : ''}`;
      
      optionLabel.innerHTML = `
        <input type="radio" name="q-${index}" value="${opt}" ${isSelected ? 'checked' : ''}>
        <span>${opt}</span>
      `;
      
      optionLabel.addEventListener('click', () => {
        list.querySelectorAll('.quiz-option').forEach(l => l.classList.remove('selected'));
        optionLabel.classList.add('selected');
        userQuizAnswers[index] = opt;
      });

      list.appendChild(optionLabel);
    });
    optionsBody.appendChild(list);
  } else {
    const textarea = document.createElement('textarea');
    textarea.className = 'quiz-sa-input';
    textarea.placeholder = 'Type your complete explanation here...';
    textarea.value = userQuizAnswers[index] || '';
    
    textarea.addEventListener('input', (e) => {
      userQuizAnswers[index] = e.target.value;
    });

    optionsBody.appendChild(textarea);
  }

  const progressPercent = ((index) / activeQuiz.length) * 100;
  elements.quizProgressFill.style.width = `${progressPercent}%`;

  elements.quizPrevBtn.style.display = index === 0 ? 'none' : 'block';
  elements.quizNextBtn.style.display = index === activeQuiz.length - 1 ? 'none' : 'block';
  elements.quizSubmitBtn.style.display = index === activeQuiz.length - 1 ? 'block' : 'none';
}

function handleQuizNext() {
  if (currentQuizQuestionIndex < activeQuiz.length - 1) {
    currentQuizQuestionIndex++;
    renderQuizQuestion(currentQuizQuestionIndex);
  }
}

function handleQuizPrev() {
  if (currentQuizQuestionIndex > 0) {
    currentQuizQuestionIndex--;
    renderQuizQuestion(currentQuizQuestionIndex);
  }
}

async function submitQuizForGrading() {
  if (isGeneratingResponse) return;

  const unansweredCount = userQuizAnswers.filter(a => !a || a.trim().length === 0).length;
  if (unansweredCount > 0) {
    if (!confirm(`You have ${unansweredCount} unanswered question(s). Are you sure you want to submit?`)) {
      return;
    }
  }

  isGeneratingResponse = true;
  elements.quizSubmitBtn.textContent = 'Grading Quiz...';
  elements.quizSubmitBtn.disabled = true;

  const subj = state.subjects.find(s => s.id === state.activeSubjectId);

  const questionsGradingInput = activeQuiz.map((q, idx) => ({
    questionId: q.id,
    questionText: q.question,
    questionType: q.type,
    options: q.options || [],
    idealAnswer: q.correctAnswer,
    studentAnswer: userQuizAnswers[idx] || '[NO RESPONSE]'
  }));

  const gradingPrompt = `You are a strict, helpful academic grader. Review the student's answers to the practice quiz and grade them based on the material details below.

Study Materials Notes:
---
${subj.materials || ''}
---

Questions and Student Responses:
${JSON.stringify(questionsGradingInput, null, 2)}

Instructions:
1. Provide a numerical score from 0 to 100 representing their overall accuracy.
2. For each question, decide if they got it right ("isCorrect" = true/false). For MCQ, check if their option matches the correct answer exactly. For short answers, check if their response matches the core themes of the idealAnswer guidelines.
3. Provide a clear, detailed explanation for each answer, highlighting why they are correct, what elements they missed, and what the correct answer is.

Return a valid JSON object matching this schema:
{
  "score": 85,
  "feedback": [
    {
      "questionId": 1,
      "isCorrect": true,
      "explanation": "Why their answer is correct/incorrect..."
    }
  ]
}
Ensure the output is pure JSON. Do NOT wrap it in markdown code blocks.`;

  try {
    const rawReport = await generateContent({
      apiKey: state.apiKey,
      model: state.selectedModel || 'gemini-2.5-flash',
      systemInstruction: 'You are a JSON grading assistant. You output valid JSON reports based on the student scoring.',
      contents: [{ role: 'user', parts: [{ text: gradingPrompt }] }],
      temperature: 0.3,
      responseMimeType: 'application/json'
    });

    let cleanJSON = rawReport.replace(/```json|```/g, '').trim();
    const parsedReport = JSON.parse(cleanJSON);

    state.stats.quizzesCompleted = (state.stats.quizzesCompleted || 0) + 1;
    saveState();
    updateStatsDisplay();

    elements.quizRunnerSection.style.display = 'none';
    elements.quizFeedbackSection.style.display = 'block';

    const score = parsedReport.score || 0;
    elements.quizScoreDisplay.textContent = `${score}%`;
    elements.quizFeedbackHeadline.textContent = score >= 80 ? 'Mastery Achieved!' : score >= 50 ? 'Good Practice!' : 'Keep Studying!';

    elements.quizFeedbackList.innerHTML = '';
    parsedReport.feedback.forEach((feed) => {
      const originalQ = activeQuiz.find(q => q.id === feed.questionId);
      if (!originalQ) return;

      const idx = activeQuiz.indexOf(originalQ);
      const studentAnsText = userQuizAnswers[idx] || '[No Answer]';
      const feedbackCard = document.createElement('div');
      feedbackCard.className = 'feedback-item';

      feedbackCard.innerHTML = `
        <div class="feedback-q">Q: ${originalQ.question}</div>
        <div class="feedback-ans-pair">
          <div class="feedback-ans ${feed.isCorrect ? 'correct' : 'incorrect'}">
            <strong>Your Answer:</strong> ${studentAnsText}
          </div>
          <div class="feedback-ans correct">
            <strong>Ideal Answer:</strong> ${originalQ.correctAnswer}
          </div>
        </div>
        <div class="feedback-explanation">
          <strong>Grade Report:</strong> ${feed.isCorrect ? '✅ Correct.' : '❌ Incorrect.'}<br>
          ${feed.explanation}
        </div>
      `;
      elements.quizFeedbackList.appendChild(feedbackCard);
    });

  } catch (error) {
    console.error('Quiz Grading Failure:', error);
    alert(`Could not grade quiz: ${error.message}. Fallback score calculated.`);
    
    let correctCount = 0;
    activeQuiz.forEach((q, idx) => {
      if (q.type === 'mcq' && q.correctAnswer === userQuizAnswers[idx]) {
        correctCount++;
      }
    });
    const fallbackScore = Math.round((correctCount / activeQuiz.length) * 100);
    
    elements.quizRunnerSection.style.display = 'none';
    elements.quizFeedbackSection.style.display = 'block';
    elements.quizScoreDisplay.textContent = `${fallbackScore}%`;
    elements.quizFeedbackList.innerHTML = `<p style="padding:16px; color:var(--text-secondary)">API Grading service was temporarily unavailable. Simple MCQ score calculated. Make sure to check the answers in your notes.</p>`;
  } finally {
    isGeneratingResponse = false;
    elements.quizSubmitBtn.textContent = 'Submit Quiz';
    elements.quizSubmitBtn.disabled = false;
  }
}

// --- Active Recall Flashcards ---
function resetFlashcardUI() {
  const subj = state.subjects.find(s => s.id === state.activeSubjectId);
  if (!subj) return;

  if (subj.flashcards && subj.flashcards.length > 0) {
    elements.flashcardSetupSection.style.display = 'none';
    elements.flashcardViewerSection.style.display = 'flex';
    activeDeck = subj.flashcards;
    renderFlashcard(0);
  } else {
    elements.flashcardSetupSection.style.display = 'block';
    elements.flashcardViewerSection.style.display = 'none';
    activeDeck = null;
  }
}

async function startFlashcardGeneration() {
  if (isGeneratingResponse) return;

  const subj = state.subjects.find(s => s.id === state.activeSubjectId);
  if (!subj) return;

  const notes = subj.materials ? subj.materials.trim() : '';
  if (!notes) {
    alert('Please enter or upload Study Material notes before generating flashcards.');
    switchWorkspaceTab('tab-materials');
    return;
  }

  if (!state.apiKey) {
    alert('Please set your Gemini API key in settings.');
    switchView('settings');
    return;
  }

  isGeneratingResponse = true;
  elements.generateFlashcardsBtn.textContent = '⚡ Designing Flashcards... (takes ~10s)';
  elements.generateFlashcardsBtn.disabled = true;

  const cardPrompt = `You are a study helper. Read the reference study notes below and extract the 5-10 most important terms, rules, formulas, dates, or concepts. Build a set of flashcards for active recall.

Study Materials Notes:
---
${notes}
---

Create clear, concise question/term definitions.
Return the output as a valid JSON object matching this schema:
{
  "flashcards": [
    {
      "question": "Term or prompt question...",
      "answer": "Concise definition or explanation on the back..."
    }
  ]
}
Ensure the output is pure JSON. Do NOT wrap it in markdown code blocks.`;

  try {
    const rawResult = await generateContent({
      apiKey: state.apiKey,
      model: state.selectedModel || 'gemini-2.5-flash',
      systemInstruction: 'You are a helpful study creator who formats everything strictly in valid JSON decks.',
      contents: [{ role: 'user', parts: [{ text: cardPrompt }] }],
      temperature: 0.6,
      responseMimeType: 'application/json'
    });

    let cleanJSON = rawResult.replace(/```json|```/g, '').trim();
    const parsedDeck = JSON.parse(cleanJSON);

    if (!parsedDeck.flashcards || !Array.isArray(parsedDeck.flashcards)) {
      throw new Error("JSON structure did not contain 'flashcards' array.");
    }

    subj.flashcards = parsedDeck.flashcards.map(c => ({ ...c, state: null }));
    saveState();
    
    renderDashboardSubjects();
    resetFlashcardUI();
  } catch (error) {
    console.error('Flashcard Generation Failure:', error);
    alert(`Could not build deck: ${error.message}`);
  } finally {
    isGeneratingResponse = false;
    elements.generateFlashcardsBtn.textContent = '✨ Generate Flashcard Deck';
    elements.generateFlashcardsBtn.disabled = false;
  }
}

let activeCardIndex = 0;
function renderFlashcard(index) {
  if (!activeDeck || index < 0 || index >= activeDeck.length) return;

  activeCardIndex = index;
  const card = activeDeck[index];

  elements.flashcardWrapper.classList.remove('flipped');
  elements.flashcardQuestionText.textContent = card.question;
  elements.flashcardAnswerText.textContent = card.answer;
  elements.flashcardCounter.textContent = `Card ${index + 1} of ${activeDeck.length}`;

  elements.flashcardProgressDots.innerHTML = '';
  activeDeck.forEach((c, idx) => {
    const dot = document.createElement('div');
    dot.className = `deck-dot ${idx === index ? 'active' : ''} ${c.state === 'easy' ? 'completed' : ''}`;
    elements.flashcardProgressDots.appendChild(dot);
  });
}

function handleFlashcardAnswer(scoreState) {
  if (!activeDeck || activeDeck.length === 0) return;

  activeDeck[activeCardIndex].state = scoreState;
  state.stats.cardsReviewed = (state.stats.cardsReviewed || 0) + 1;
  
  const subj = state.subjects.find(s => s.id === state.activeSubjectId);
  if (subj) {
    subj.flashcards = activeDeck;
    saveState();
  }
  updateStatsDisplay();

  const dots = elements.flashcardProgressDots.querySelectorAll('.deck-dot');
  if (dots[activeCardIndex]) {
    dots[activeCardIndex].className = `deck-dot ${scoreState === 'easy' ? 'completed' : ''}`;
  }

  setTimeout(() => {
    handleFlashcardNext();
  }, 300);
}

function handleFlashcardNext() {
  if (!activeDeck) return;
  
  if (activeCardIndex < activeDeck.length - 1) {
    renderFlashcard(activeCardIndex + 1);
  } else {
    const easyCount = activeDeck.filter(c => c.state === 'easy').length;
    alert(`Deck Completed! You mastered ${easyCount} of ${activeDeck.length} cards in this session.`);
    renderFlashcard(0);
  }
}

// --- Subject Editing/Creation Modal ---
let colorSelected = 'hsl(262, 85%, 65%)';

function openSubjectModal() {
  elements.subjectNameInput.value = '';
  elements.subjectDescInput.value = '';
  elements.subjectIconInput.selectedIndex = 0;
  elements.subjectVoiceGender.selectedIndex = 0;
  
  document.querySelectorAll('.color-option').forEach(opt => {
    const isDefault = opt.getAttribute('data-color') === 'hsl(262, 85%, 65%)';
    opt.classList.toggle('selected', isDefault);
  });
  colorSelected = 'hsl(262, 85%, 65%)';

  elements.subjectModal.classList.add('active');
}

function closeSubjectModal() {
  elements.subjectModal.classList.remove('active');
}

function handleSaveSubject() {
  const name = elements.subjectNameInput.value.trim();
  const desc = elements.subjectDescInput.value.trim();
  const icon = elements.subjectIconInput.value;
  const gender = elements.subjectVoiceGender.value;
  const color = colorSelected;

  if (!name) {
    alert('Please enter a subject name.');
    return;
  }

  const newSubject = {
    id: `subject-${Date.now()}`,
    name: name,
    desc: desc,
    icon: icon,
    color: color,
    voiceGender: gender,
    materials: '',
    chatHistory: [
      { role: 'model', parts: [{ text: `Hello! I am your ${name} tutor. Enter some study materials in the notes tab, then start asking questions here!` }] }
    ],
    flashcards: [],
    quizzes: []
  };

  state.subjects.push(newSubject);
  saveState();

  renderSidebarSubjects();
  renderDashboardSubjects();
  renderSubjectVoiceSettings();
  updateStatsDisplay();
  closeSubjectModal();
  
  switchView('workspace', newSubject.id);
}

// --- Global API Settings ---
function saveApiSettings() {
  const key = elements.settingsApiKey.value.trim();
  const model = elements.settingsModelSelect.value;
  const temp = parseFloat(elements.settingsTemperature.value);
  const persona = elements.settingsPersona.value;

  state.apiKey = key;
  state.selectedModel = model;
  state.temperature = temp;
  state.persona = persona;
  saveState();

  updateAPIStatus();

  const btn = elements.settingsSaveBtn;
  const oldText = btn.textContent;
  btn.textContent = '✓ Configuration Saved!';
  btn.style.backgroundColor = 'var(--success)';
  setTimeout(() => {
    btn.textContent = oldText;
    btn.style.backgroundColor = '';
  }, 2000);
}

function resetAllApplicationData() {
  if (confirm('CAUTION: This will delete ALL subjects, study notes, conversation threads, flashcards, and preferences. This action cannot be undone. Are you sure you want to reset?')) {
    localStorage.removeItem('study_hub_state');
    location.reload();
  }
}

// --- Event Bindings ---
function bindGlobalEvents() {
  elements.navDashboard.addEventListener('click', () => switchView('dashboard'));
  elements.navSettings.addEventListener('click', () => switchView('settings'));
  elements.wsBackToDashboard.addEventListener('click', () => switchView('dashboard'));

  elements.sidebarAddSubjectBtn.addEventListener('click', () => openSubjectModal());
  elements.dashboardAddSubjectBtn.addEventListener('click', () => openSubjectModal());
  elements.subjectModalClose.addEventListener('click', closeSubjectModal);
  elements.subjectModalCancel.addEventListener('click', closeSubjectModal);
  elements.subjectModalSave.addEventListener('click', handleSaveSubject);

  elements.colorPickerGrid.addEventListener('click', (e) => {
    if (e.target.classList.contains('color-option')) {
      document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
      e.target.classList.add('selected');
      colorSelected = e.target.getAttribute('data-color');
    }
  });

  elements.wsThemeTabBar.addEventListener('click', (e) => {
    if (e.target.classList.contains('workspace-tab')) {
      const tabId = e.target.getAttribute('data-tab');
      switchWorkspaceTab(tabId);
    }
  });

  // Chat
  elements.chatSendButton.addEventListener('click', () => sendChatMessage());
  elements.chatUserInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  elements.chatUserInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
  });
  elements.chatSuggestionChips.addEventListener('click', (e) => {
    if (e.target.classList.contains('suggestion-chip')) {
      sendChatMessage(e.target.getAttribute('data-prompt'));
    }
  });

  // Live Room controls
  elements.liveStartBtn.addEventListener('click', startLiveSession);
  elements.liveStopBtn.addEventListener('click', stopLiveSession);
  elements.liveCameraToggleBtn.addEventListener('click', () => {
    if (!liveStream) return;
    const videoTrack = liveStream.getVideoTracks()[0];
    if (videoTrack) {
      const isEnabled = videoTrack.enabled;
      videoTrack.enabled = !isEnabled;
      elements.liveCameraToggleBtn.textContent = `Camera: ${!isEnabled ? 'On' : 'Off'}`;
      document.querySelector('.live-webcam-panel').classList.toggle('camera-on', !isEnabled);
    }
  });

  // Notes/Materials
  elements.saveMaterialBtn.addEventListener('click', saveStudyMaterial);
  elements.materialContentTextarea.addEventListener('input', updateMaterialStatusDisplay);
  elements.materialFileLoader.addEventListener('change', handleNotesFileUpload);

  // Podcast
  elements.podcastGenerateBtn.addEventListener('click', startPodcastGeneration);
  elements.podcastPlayBtn.addEventListener('click', playPodcastSession);
  elements.podcastStopBtn.addEventListener('click', () => {
    isPodcastPlaying = false;
    resetPodcastUI();
  });

  // Video presentation
  elements.videoGenerateBtn.addEventListener('click', startVideoLectureGeneration);
  elements.videoPlayBtn.addEventListener('click', playVideoLecture);
  elements.videoStopBtn.addEventListener('click', () => {
    isVideoPlaying = false;
    resetVideoUI();
  });

  // Quizzes
  elements.generateQuizBtn.addEventListener('click', startQuizGeneration);
  elements.quizPrevBtn.addEventListener('click', handleQuizPrev);
  elements.quizNextBtn.addEventListener('click', handleQuizNext);
  elements.quizSubmitBtn.addEventListener('click', submitQuizForGrading);
  elements.quizRestartBtn.addEventListener('click', resetQuizUI);

  // Flashcards
  elements.generateFlashcardsBtn.addEventListener('click', startFlashcardGeneration);
  elements.flashcardWrapper.addEventListener('click', () => {
    elements.flashcardWrapper.classList.toggle('flipped');
  });
  elements.flashcardEasyBtn.addEventListener('click', () => handleFlashcardAnswer('easy'));
  elements.flashcardHardBtn.addEventListener('click', () => handleFlashcardAnswer('hard'));
  elements.flashcardNextBtn.addEventListener('click', handleFlashcardNext);
  elements.flashcardResetDeckBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete current deck and regenerate new flashcards?')) {
      const subj = state.subjects.find(s => s.id === state.activeSubjectId);
      if (subj) {
        subj.flashcards = [];
        saveState();
        resetFlashcardUI();
      }
    }
  });

  // Settings
  elements.settingsSaveBtn.addEventListener('click', saveApiSettings);
  elements.settingsClearDataBtn.addEventListener('click', resetAllApplicationData);
  elements.settingsTemperature.addEventListener('input', (e) => {
    elements.tempValDisplay.textContent = e.target.value;
  });
  elements.toggleApiVisibility.addEventListener('click', () => {
    const isPass = elements.settingsApiKey.type === 'password';
    elements.settingsApiKey.type = isPass ? 'text' : 'password';
    elements.toggleApiVisibility.textContent = isPass ? 'Hide' : 'Show';
  });
}

// Run
window.addEventListener('DOMContentLoaded', init);
