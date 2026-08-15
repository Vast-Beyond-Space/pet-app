// voice.js - TTS & STT module

class VoiceManager {
    constructor() {
        this.isListening = false;
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.isSpeaking = false;
        this.callbacks = {
            onStart: null,
            onEnd: null,
            onResult: null,
            onError: null
        };
        this._initRecognition();
    }

    // Initialize speech recognition
    _initRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('[Voice] Speech recognition not supported in this browser');
            return;
        }
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'zh-CN';
        this.recognition.continuous = false;
        this.recognition.interimResults = true;

        this.recognition.onstart = () => {
            this.isListening = true;
            if (this.callbacks.onStart) this.callbacks.onStart();
        };

        this.recognition.onend = () => {
            this.isListening = false;
            if (this.callbacks.onEnd) this.callbacks.onEnd();
        };

        this.recognition.onresult = (event) => {
            let finalText = '';
            let interimText = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    finalText += event.results[i][0].transcript;
                } else {
                    interimText += event.results[i][0].transcript;
                }
            }
            if (this.callbacks.onResult) {
                this.callbacks.onResult(finalText, interimText);
            }
        };

        this.recognition.onerror = (event) => {
            this.isListening = false;
            if (this.callbacks.onError) {
                this.callbacks.onError(event.error);
            }
        };
    }

    // TTS (optimized with voice priority sorting)
    speak(text, options = {}) {
        if (!this.synthesis) return;
        if (this.isSpeaking) {
            this.synthesis.cancel();
            this.isSpeaking = false;
        }

        let cleanText = this.cleanText(text);
        if (!cleanText) return;

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = options.lang || 'zh-CN';
        utterance.rate = options.rate || 1.0;
        utterance.pitch = options.pitch || 1.0;
        utterance.volume = options.volume || 1;

        // ===== Voice priority sorting (high quality first) =====
        const voices = this.synthesis.getVoices();
        const zhVoices = voices.filter(v => v.lang && v.lang.includes('zh'));

        // High quality voice names (highest priority first)
        const highQualityNames = [
            'Microsoft Xiaoxiao',      // Windows female - best
            'Microsoft Yunxi',         // Windows male
            'Microsoft Xiaoyi',        // Windows female
            'Microsoft Yunjian',       // Windows male
            'Google 普通话（中国大陆）', // Chrome cloud female
            'Google 国语（台湾）',      // Chrome cloud
            'Ting-Ting',               // macOS female
            'Mei-Jia',                 // macOS female
            'Sin-Ji'                   // macOS female
        ];

        // Sort by priority
        const sorted = [...zhVoices].sort((a, b) => {
            const aIdx = highQualityNames.findIndex(name => a.name.includes(name));
            const bIdx = highQualityNames.findIndex(name => b.name.includes(name));
            if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
            if (aIdx !== -1) return -1;
            if (bIdx !== -1) return 1;
            return 0;
        });

        // 1. Use user-selected voice if available
        if (options.voiceName) {
            const userVoice = voices.find(v => v.name === options.voiceName);
            if (userVoice) utterance.voice = userVoice;
        }

        // 2. If no user selection or invalid, use highest priority voice
        if (!utterance.voice && sorted.length > 0) {
            utterance.voice = sorted[0];
            console.log('[Voice] Auto-selected voice:', utterance.voice.name);
        }

        // 3. Fallback to first available voice if no Chinese voice found
        if (!utterance.voice && voices.length > 0) {
            utterance.voice = voices[0];
        }

        utterance.onstart = () => {
            this.isSpeaking = true;
        };

        utterance.onend = () => {
            this.isSpeaking = false;
        };

        utterance.onerror = (event) => {
            console.error('[Voice] TTS error:', event.error);
            this.isSpeaking = false;
        };

        this.synthesis.speak(utterance);
    }

    // Clean text (remove special markers)
    cleanText(text) {
        if (!text) return '';
        let cleaned = String(text)
            .replace(/\[MEMORY:\s*[^\]]+\]/g, '')
            .replace(/\[SHORT_MEMORY:\s*[^\]]+\]/g, '')
            .replace(/<MOOD:[^>]+>/g, '')
            .replace(/<CMD:[^>]+>/g, '')
            .replace(/<EFFECT:[^>]+>/g, '')
            .replace(/<TOOL:[^>]+>/g, '')
            .replace(/\[AGENT_MODE\]/g, '')
            .replace(/[\u200B-\u200F\uFEFF\u00AD\u2060\u180E]/g, '')
            .trim();
        return cleaned || '';
    }

    // Get all voices
    getVoices() {
        if (this.synthesis) {
            return this.synthesis.getVoices();
        }
        return [];
    }

    // Get Chinese (zh) voices
    getChineseVoices() {
        return this.getVoices().filter(v => v.lang && v.lang.includes('zh'));
    }

    // Populate voice list into a select element
    populateVoiceList(selectElement, selectedVoice) {
        if (!selectElement) return;
        const voices = this.getChineseVoices();
        selectElement.innerHTML = '<option value="default">🔄 Auto select (recommended)</option>';
        voices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.name;
            const label = `${v.name} (${v.lang})`;
            opt.textContent = label;
            if (v.name === selectedVoice) opt.selected = true;
            selectElement.appendChild(opt);
        });
        // If a selected voice is not in the list, keep it selected
        if (selectedVoice && selectedVoice !== 'default' && !voices.find(v => v.name === selectedVoice)) {
            const opt = document.createElement('option');
            opt.value = selectedVoice;
            opt.textContent = `${selectedVoice} (selected, currently unavailable)`;
            opt.selected = true;
            selectElement.appendChild(opt);
        }
        return voices;
    }

    // Check if speech recognition is supported
    isSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    // Toggle listening state
    toggleListening() {
        if (!this.recognition) return false;
        if (this.isListening) {
            this.stopListening();
            return false;
        } else {
            this.startListening();
            return true;
        }
    }

    startListening() {
        if (!this.recognition || this.isListening) return;
        try {
            this.recognition.start();
        } catch (e) {
            console.warn('[Voice] Failed to start speech recognition:', e);
        }
    }

    stopListening() {
        if (!this.recognition || !this.isListening) return;
        try {
            this.recognition.stop();
        } catch (e) {
            console.warn('[Voice] Failed to stop speech recognition:', e);
        }
    }

    // Set callbacks
    setCallbacks(cbs) {
        if (cbs.onStart) this.callbacks.onStart = cbs.onStart;
        if (cbs.onEnd) this.callbacks.onEnd = cbs.onEnd;
        if (cbs.onResult) this.callbacks.onResult = cbs.onResult;
        if (cbs.onError) this.callbacks.onError = cbs.onError;
    }
}

// Expose to global scope
const voiceManager = new VoiceManager();
if (typeof window !== 'undefined') {
    window.voiceManager = voiceManager;
}