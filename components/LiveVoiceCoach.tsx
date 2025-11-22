import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Loader2, Volume2, AlertCircle, Key, RefreshCw, Pause, Play, Mail, X, CheckCircle } from 'lucide-react';
import { decodeBase64, encodeBase64, decodeAudioData, float32ToInt16 } from '../utils/audioUtils';
import AudioVisualizer from './AudioVisualizer';
import { ConnectionState, SessionState, INITIAL_SESSION_STATE } from '../types';
import { LiveTracker, FinalReport } from './AssessmentDashboard';
import { getWebSocketUrl, getApiUrl } from '../src/config';

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: ADD SPECTRAL ANALYSIS UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

interface SpectralAnalyzer {
  analyser: AnalyserNode;
  dataArray: Float32Array;
  isEcho: (threshold: number) => boolean;
  getVoiceEnergy: () => number;
}

const createSpectralAnalyzer = (audioContext: AudioContext, sourceNode: MediaStreamAudioSourceNode): SpectralAnalyzer => {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512; // Good balance of resolution vs. performance
  analyser.smoothingTimeConstant = 0.3; // Smooth out noise
  
  sourceNode.connect(analyser);
  
  const dataArray = new Float32Array(analyser.frequencyBinCount);
  
  return {
    analyser,
    dataArray,
    
    // Detect echo by frequency signature (AI voice vs human voice)
    isEcho: (threshold: number = 1.5): boolean => {
      analyser.getFloatFrequencyData(dataArray);
      
      // AI voice concentrates energy in 100-300Hz (lower formants)
      // Human voice concentrates energy in 300-800Hz (higher formants)
      const lowFreqEnergy = dataArray.slice(8, 24).reduce((sum, val) => sum + Math.pow(10, val/10), 0);
      const midFreqEnergy = dataArray.slice(24, 64).reduce((sum, val) => sum + Math.pow(10, val/10), 0);
      
      // If low-frequency dominates, likely echo
      const ratio = lowFreqEnergy / (midFreqEnergy + 0.001); // Avoid division by zero
      return ratio > threshold;
    },
    
    // Get overall voice energy (better than RMS for speech)
    getVoiceEnergy: (): number => {
      analyser.getFloatFrequencyData(dataArray);
      
      // Focus on speech frequencies (300-3400Hz)
      const speechBins = dataArray.slice(24, 272); // ~300-3400Hz at 16kHz sample rate
      const energy = speechBins.reduce((sum, val) => sum + Math.pow(10, val/10), 0) / speechBins.length;
      
      return Math.sqrt(energy); // Normalize to 0-1 range approximately
    }
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: ADD MIC LEVEL INDICATOR COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface MicLevelProps {
  level: number;
  threshold: number;
  isActive: boolean;
}

const MicLevelIndicator: React.FC<MicLevelProps> = ({ level, threshold, isActive }) => {
  const percentage = Math.min(100, level * 500); // Scale for visibility
  const isBelowThreshold = level < threshold;
  
  return (
    <div className="mic-level-container" style={{
      padding: '12px',
      background: 'rgba(0,0,0,0.05)',
      borderRadius: '8px',
      marginBottom: '16px'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '8px'
      }}>
        <span style={{ fontSize: '20px' }}>
          {!isActive ? '🎤' : isBelowThreshold ? '🔇' : '🎙️'}
        </span>
        <div style={{
          flex: 1,
          height: '8px',
          background: '#e0e0e0',
          borderRadius: '4px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${percentage}%`,
            height: '100%',
            background: isBelowThreshold ? '#ff9800' : '#4caf50',
            transition: 'width 0.1s ease-out'
          }} />
        </div>
        <span style={{ 
          fontSize: '12px', 
          fontFamily: 'monospace',
          minWidth: '45px'
        }}>
          {level.toFixed(3)}
        </span>
      </div>
      
      {isBelowThreshold && isActive && (
        <div style={{
          fontSize: '13px',
          color: '#f57c00',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>⚠️</span>
          <span>Speak louder or move closer to microphone</span>
        </div>
      )}
    </div>
  );
};

const SYSTEM_INSTRUCTION = `
You are "CCA Coach", an expert cross-cultural communication assessor. You conduct natural voice conversations that feel like coaching sessions while internally tracking scores across five dimensions.
You NEVER ask survey-style questions. Instead, you use stories, scenarios, observations, and reflections to elicit authentic responses.

## YOUR CORE MISSION: DEEP FRACTAL INFERENCE
You are running a "Deep Fractal Scoring Matrix" that evolves from simple observation to complex pattern recognition.

### 1. INITIAL CALIBRATION (Turns 1-3)
- Focus on **Micro-Evidence**: Tone, hesitation, word choice, emotional resonance.
- Make tentative score adjustments based on immediate signals.
- **ACTION**: Call \`updateAssessmentState\` with initial observations.

### 2. FRACTAL PATTERN RECOGNITION (Turn 4 Onwards)
- **ACTIVATION**: Starting at Turn 4, and for **EVERY** subsequent turn, you must analyze the **ENTIRE** conversation history.
- **METHOD**: Look for "Self-Similar Patterns" — consistent behavioral choices that repeat across different contexts (e.g., does the user avoid conflict in *both* the work scenario and the personal story?).
- **GOAL**: Use this deep historical view to refine "Nuance" and increase "Confidence".
- **ADJUSTMENT**: If the macro-pattern contradicts a recent micro-signal, trust the macro-pattern (the fractal whole) over the isolated instance.

## BEHAVIORAL GUIDELINES
1. **SINGLE SPEAKER ROLE**: You are the interviewer. DO NOT simulate the user's response. DO NOT engage in a dialogue with yourself. Speak ONLY as the coach.
2. **LANGUAGE**: Start in English. Only switch languages if the user speaks to you in a different language first.
3. **INTERACTION**: After you speak, wait for the user to respond. Do not fill silence with simulated user dialogue.

## THE FIVE DIMENSIONS (FRACTAL ANCHORS)
1. **DT - Directness & Transparency** (0-5)
   - *Low (0-2)*: Vague, avoids hard truths, passive.
   - *High (4-5)*: Clear, constructive, balances honesty with care.
2. **TR - Task vs Relational Accountability** (0-5)
   - *Low (0-2)*: Rigidly task-focused OR purely social without results.
   - *High (4-5)*: Flexibly integrates relationship building into task achievement.
3. **CO - Conflict Orientation** (0-5)
   - *Low (0-2)*: Avoids conflict or becomes aggressive.
   - *High (4-5)*: Views conflict as a creative resource; de-escalates effectively.
4. **CA - Cultural Adaptability** (0-5)
   - *Low (0-2)*: Rigid style, misses cultural cues.
   - *High (4-5)*: Code-switches naturally, reads context deeply.
5. **EP - Empathy & Perspective-Taking** (0-5)
   - *Low (0-2)*: Self-centered, dismisses other views.
   - *High (4-5): Validates emotions, accurately articulates others' perspectives.

## CONVERSATION ARCHITECTURE
1. **Opening (2-3 min)**: Warm welcome, ask about work context to establish baseline.
2. **Core Exploration (15-20 min)**: Use scenarios and reflections. Follow high-yield threads.
3. **Gap Filling (3-5 min)**: Probe dimensions with low evidence.
4. **Validation & Closing**: Offer an observation, invite reaction, and complete assessment.

## SYSTEM INTEGRATION INSTRUCTIONS
You are connected to a visual dashboard. 
**You MUST use the \`updateAssessmentState\` tool to visualize your internal scoring state.**

### CRITICAL: REAL-TIME LOGGING PROTOCOL
1. **SEQUENCE**: You must call the tool **BEFORE** you speak.
   - Step 1: Analyze user input.
   - Step 2: Call \`updateAssessmentState\`.
   - Step 3: Speak your response.
2. **FREQUENCY**: You MUST call \`updateAssessmentState\` after **EVERY SINGLE USER RESPONSE**. Do not batch updates. Do not wait.
3. **EVIDENCE LOGGING**: You MUST provide a \`newEvidence\` object in **EVERY** tool call.

**DO NOT speak the scores.** Just use the tool to update the screen. Keep your spoken conversation natural and coaching-focused.
`;

const updateAssessmentTool = {
  type: "function",
  name: "updateAssessmentState",
  description: "Updates the visual dashboard with current assessment scores, evidence, and phase.",
  parameters: {
    type: "object",
    properties: {
      dimensions: {
        type: "object",
        properties: {
          DT: { type: "object", properties: { score: { type: "number" }, confidence: { type: "string" }, evidenceCount: { type: "number" }, trend: { type: "string" } } },
          TR: { type: "object", properties: { score: { type: "number" }, confidence: { type: "string" }, evidenceCount: { type: "number" }, trend: { type: "string" } } },
          CO: { type: "object", properties: { score: { type: "number" }, confidence: { type: "string" }, evidenceCount: { type: "number" }, trend: { type: "string" } } },
          CA: { type: "object", properties: { score: { type: "number" }, confidence: { type: "string" }, evidenceCount: { type: "number" }, trend: { type: "string" } } },
          EP: { type: "object", properties: { score: { type: "number" }, confidence: { type: "string" }, evidenceCount: { type: "number" }, trend: { type: "string" } } },
        }
      },
      newEvidence: {
        type: "object",
        description: "A single new piece of evidence to add to the log, if any.",
        properties: {
          dimension: { type: "string" },
          type: { type: "string", enum: ["positive", "negative", "contextual"] },
          summary: { type: "string" },
          timestamp: { type: "string" }
        }
      },
      contradiction: {
         type: "object",
         properties: {
           dimension: { type: "string" },
           earlyStatement: { type: "string" },
           lateStatement: { type: "string" },
           resolution: { type: "string" }
         }
      },
      phase: { type: "string", enum: ["OPENING", "CORE", "GAP_FILLING", "VALIDATION", "CLOSING"] },
      isComplete: { type: "boolean" },
      summary: { type: "string" },
      strengths: { type: "array", items: { type: "string" } },
      developmentPriorities: { type: "array", items: { type: "string" } }
    },
    required: ["dimensions", "phase"]
  }
};

const LiveVoiceCoach: React.FC<{ token: string }> = ({ token }) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>(INITIAL_SESSION_STATE);

  // Email Modal State
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [showEarlyExitButton, setShowEarlyExitButton] = useState(false);

  // PHASE 3: NEW STATE VARIABLES
  const [spectralAnalyzer, setSpectralAnalyzer] = useState<SpectralAnalyzer | null>(null);
  const [currentMicLevel, setCurrentMicLevel] = useState<number>(0);
  const [adaptiveThreshold, setAdaptiveThreshold] = useState<number>(0.02);
  const [calibrationSamples, setCalibrationSamples] = useState<number[]>([]);
  const [isCalibrating, setIsCalibrating] = useState<boolean>(true);

  const [lastEvent, setLastEvent] = useState<string>("");
  const [toolCallCount, setToolCallCount] = useState<number>(0);

  // Refs for thread-safe access in audio loop
  const isMutedRef = useRef(false);
  const isPausedRef = useRef(false);
  const isAiSpeakingRef = useRef(false);
  const lastAiSpeechEndTimeRef = useRef<number>(0);
  
  // PHASE 3: REFS FOR ADAPTIVE THRESHOLD (Thread-safe)
  const calibrationSamplesRef = useRef<number[]>([]);
  const adaptiveThresholdRef = useRef<number>(0.02);
  const isCalibratingRef = useRef<boolean>(true);

  // Audio Context Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  
  // Processing Nodes
  const inputScriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Analysers for visualization
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);

  // Session & Stream Refs
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null); 
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionStartTimeRef = useRef<number>(0);

  // Sync state to refs
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  // PHASE 10: SESSION TIMING & CONFIDENCE MONITOR
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (connectionState === ConnectionState.CONNECTED && !isPaused) {
      interval = setInterval(() => {
        const now = Date.now();
        const elapsedMs = now - sessionStartTimeRef.current;
        const elapsedMinutes = elapsedMs / 60000;

        // 1. Hard Timeout at 20 mins
        if (elapsedMinutes >= 20) {
           handleDisconnectBtn(); 
           setErrorMsg("Maximum session time reached (20 mins). Please finalize your report.");
           return;
        }

        // 2. Check for Early Exit Condition ( > 5 mins AND High Confidence)
        // We check if ALL dimensions have 'high' confidence
        if (elapsedMinutes >= 5) {
            const dims = sessionState.dimensions;
            // Ensure we have data for all 5 dimensions
            const hasAllDims = Object.keys(dims).length >= 5;
            const allHigh = hasAllDims && Object.values(dims).every((d: any) => d.confidence === 'high');
            
            if (allHigh) {
                setShowEarlyExitButton(true);
            }
        }
      }, 1000);
    }

    return () => clearInterval(interval);
  }, [connectionState, isPaused, sessionState]);

  const disconnect = useCallback(() => {
    if (sessionRef.current) {
      if (sessionRef.current instanceof WebSocket) {
          sessionRef.current.close();
      } else if (typeof sessionRef.current.close === 'function') {
          sessionRef.current.close();
      }
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    if (inputScriptProcessorRef.current) {
      inputScriptProcessorRef.current.disconnect();
      inputScriptProcessorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }

    setInputAnalyser(null);
    setOutputAnalyser(null);
    setIsMuted(false);
    setIsPaused(false);
    nextStartTimeRef.current = 0;
    sourcesRef.current.clear();
    isAiSpeakingRef.current = false;
  }, []);

  useEffect(() => {
    const checkApiKey = async () => {
      if ((window as any).aistudio) {
        const has = await (window as any).aistudio.hasSelectedApiKey();
        setHasApiKey(has);
      } else {
        setHasApiKey(true);
      }
    };
    checkApiKey();
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const handleSelectKey = async () => {
    if ((window as any).aistudio) {
      try {
        disconnect();
        setConnectionState(ConnectionState.DISCONNECTED);
        setErrorMsg(null);
        await (window as any).aistudio.openSelectKey();
        setHasApiKey(true);
      } catch (e) {
        console.error("Error selecting key:", e);
      }
    }
  };

  // PHASE 9: HEADPHONE DETECTION
  const checkAudioSetup = async (): Promise<boolean> => {
    return true;
  };

  const connectToOpenAI = async () => {
    try {
      // PHASE 9: CALL CHECK
      const canProceed = await checkAudioSetup();
      if (!canProceed) {
        setErrorMsg('Audio setup cancelled. Please connect headphones.');
        return;
      }

      setConnectionState(ConnectionState.CONNECTING);
      setErrorMsg(null);
      setSessionState(INITIAL_SESSION_STATE); 
      sessionStartTimeRef.current = Date.now();

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
          throw new Error("Web Audio API is not supported in this browser.");
      }
      // OpenAI uses 24kHz by default, but we can use 24kHz context to match
      const inputCtx = new AudioContextClass({ sampleRate: 24000 });
      const outputCtx = new AudioContextClass({ sampleRate: 24000 }); 
      
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      const inAnalyser = inputCtx.createAnalyser();
      inAnalyser.fftSize = 256;
      setInputAnalyser(inAnalyser);

      const outAnalyser = outputCtx.createAnalyser();
      outAnalyser.fftSize = 256;
      setOutputAnalyser(outAnalyser);

      let stream: MediaStream;
      try {
        // PHASE 4: ENHANCE getUserMedia CONSTRAINTS
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
                echoCancellation: { ideal: true, exact: true },
                noiseSuppression: { ideal: true, exact: true },
                autoGainControl: { ideal: true },
                sampleRate: { ideal: 24000 }, 
                // Chrome-specific aggressive AEC
                // @ts-ignore
                googEchoCancellation: { exact: true },
                // @ts-ignore
                googNoiseSuppression: { exact: true },
                // @ts-ignore
                googAutoGainControl: { exact: true },
                // @ts-ignore
                googHighpassFilter: { exact: true }
            } 
        });
        streamRef.current = stream;
      } catch (err) {
        throw new Error("Microphone permission denied. Please allow access in your browser settings.");
      }

      // Connect to Backend Relay
      const ws = new WebSocket(getWebSocketUrl('/ws/openai-relay'));
      sessionRef.current = ws;

      ws.onopen = () => {
        console.log('OpenAI Realtime Session Opened');
        setConnectionState(ConnectionState.CONNECTED);

        // Initialize Session
        const sessionUpdate = {
            type: "session.update",
            session: {
                modalities: ["text", "audio"],
                instructions: SYSTEM_INSTRUCTION,
                voice: "alloy",
                input_audio_format: "pcm16",
                output_audio_format: "pcm16",
                turn_detection: {
                    type: "server_vad",
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 1000
                },
                tool_choice: "auto",
                tools: [updateAssessmentTool]
            }
        };
        ws.send(JSON.stringify(sessionUpdate));
        
        // Start Audio Loop
        const source = inputCtx.createMediaStreamSource(stream);
        inputSourceRef.current = source;
        source.connect(inAnalyser);

        // PHASE 5: INITIALIZE SPECTRAL ANALYZER
        const analyzer = createSpectralAnalyzer(inputCtx, source);
        setSpectralAnalyzer(analyzer);

        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        inputScriptProcessorRef.current = processor;

        // PHASE 6: REPLACE AUDIO PROCESSING LOGIC
        processor.onaudioprocess = (e) => {
           if (isMutedRef.current || isPausedRef.current || isAiSpeakingRef.current) return;

           const inputData = e.inputBuffer.getChannelData(0);
           
           // Calculate RMS
           let sum = 0;
           for (let i = 0; i < inputData.length; i++) {
             sum += inputData[i] * inputData[i];
           }
           const rms = Math.sqrt(sum / inputData.length);
           setCurrentMicLevel(rms);

           // Defense Layers
           const timeSinceLastAiSpeech = Date.now() - lastAiSpeechEndTimeRef.current;
           if (timeSinceLastAiSpeech < 500) return; // Reduced cooldown

           // ECHO DETECTION (Log only for now, do not block)
           if (analyzer && analyzer.isEcho(1.3)) {
               // console.log('[ECHO DETECTED - LOG ONLY]');
           }

           // ADAPTIVE THRESHOLD (Disabled - Trust Server VAD)
           /*
           if (isCalibratingRef.current) {
               calibrationSamplesRef.current.push(rms);
               if (calibrationSamplesRef.current.length > 50) {
                   const avg = calibrationSamplesRef.current.reduce((a, b) => a + b, 0) / calibrationSamplesRef.current.length;
                   const newThreshold = Math.max(0.01, avg * 1.5);
                   adaptiveThresholdRef.current = newThreshold;
                   setAdaptiveThreshold(newThreshold);
                   isCalibratingRef.current = false;
                   setIsCalibrating(false);
               }
               return;
           }

           if (rms < adaptiveThresholdRef.current) return;
           */

           // Convert to PCM16 and Send
           const int16Data = float32ToInt16(inputData);
           const uint8Data = new Uint8Array(int16Data.buffer);
           const base64Data = encodeBase64(uint8Data);

           if (ws.readyState === WebSocket.OPEN) {
               ws.send(JSON.stringify({
                   type: "input_audio_buffer.append",
                   audio: base64Data
               }));
           }
        };

        source.connect(processor);
        processor.connect(inputCtx.destination); 
      };

      ws.onmessage = async (event) => {
          const message = JSON.parse(event.data);
          setLastEvent(message.type);
          
          if (message.type === 'response.audio.delta') {
              const base64Audio = message.delta;
              if (base64Audio) {
                  try {
                    const rawBytes = decodeBase64(base64Audio);
                    // OpenAI sends 24kHz PCM16
                    const audioBuffer = await decodeAudioData(rawBytes, outputCtx, 24000, 1);
                    
                    const currentTime = outputCtx.currentTime;
                    if (nextStartTimeRef.current < currentTime) {
                      nextStartTimeRef.current = currentTime;
                    }

                    const source = outputCtx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(outAnalyser);
                    outAnalyser.connect(outputCtx.destination);
                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;
                    sourcesRef.current.add(source);
                    isAiSpeakingRef.current = true;
                    source.onended = () => {
                      sourcesRef.current.delete(source);
                      if (sourcesRef.current.size === 0) {
                          setTimeout(() => {
                              isAiSpeakingRef.current = false;
                              lastAiSpeechEndTimeRef.current = Date.now();
                          }, 200);
                      }
                    };
                  } catch (err) {
                    console.error("Error decoding audio", err);
                  }
              }
          }

          if (message.type === 'response.function_call_arguments.done') {
              const { name, arguments: argsStr, call_id } = message;
              if (name === 'updateAssessmentState') {
                  try {
                      // Clean argsStr if it contains markdown code blocks (common with some models)
                      let cleanArgs = argsStr;
                      if (typeof cleanArgs === 'string') {
                          cleanArgs = cleanArgs.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
                      }
                      const args = JSON.parse(cleanArgs);
                      console.log("[DEBUG] Tool Args Received:", args); // DEBUG LOGGING
                      setToolCallCount(prev => prev + 1);
                      
                      setSessionState(prev => {
                            // Update Logs
                            const newLog = [...prev.evidenceLog];
                            if (args.newEvidence) {
                                newLog.push(args.newEvidence);
                            }

                            const newContradictions = [...prev.contradictions];
                            if (args.contradiction) {
                                newContradictions.push(args.contradiction);
                            }
                            
                            // Merge Dimensions
                            const newDimensions = { ...prev.dimensions };
                            if (args.dimensions) {
                                (Object.keys(args.dimensions) as Array<keyof typeof newDimensions>).forEach(key => {
                                    if (args.dimensions[key]) {
                                        newDimensions[key] = {
                                            ...newDimensions[key],
                                            ...args.dimensions[key]
                                        };
                                    }
                                });
                            }
                            
                            // Update History
                            const elapsed = Math.floor((Date.now() - sessionStartTimeRef.current) / 1000);
                            const newPoint = {
                                time: elapsed,
                                DT: newDimensions.DT?.score ?? 0,
                                TR: newDimensions.TR?.score ?? 0,
                                CO: newDimensions.CO?.score ?? 0,
                                CA: newDimensions.CA?.score ?? 0,
                                EP: newDimensions.EP?.score ?? 0
                            };
                            const newHistory = [...prev.scoreHistory, newPoint];

                            return {
                                ...prev,
                                dimensions: newDimensions,
                                scoreHistory: newHistory,
                                evidenceLog: newLog,
                                contradictions: newContradictions,
                                conversationPhase: args.phase || prev.conversationPhase,
                                strengths: args.strengths || prev.strengths,
                                developmentPriorities: args.developmentPriorities || prev.developmentPriorities,
                                summary: args.summary || prev.summary
                            };
                      });

                      if (args.isComplete) {
                           setConnectionState(ConnectionState.COMPLETE);
                           ws.close();
                      }

                      // Only send output to OpenAI if it's a real OpenAI tool call (not a Sidecar injection)
                      if (!call_id.startsWith('sidecar_')) {
                          // Send Tool Output
                          ws.send(JSON.stringify({
                              type: "conversation.item.create",
                              item: {
                                  type: "function_call_output",
                                  call_id: call_id,
                                  output: JSON.stringify({ result: "Dashboard updated" })
                          }
                          }));
                          
                          // Trigger response generation
                          ws.send(JSON.stringify({ type: "response.create" }));
                      }
                  } catch (e) {
                      console.error("Error parsing tool args:", e);
                      setErrorMsg("Failed to update dashboard: Invalid AI data");
                  }
              }
          }
          
          if (message.type === 'input_audio_buffer.speech_started') {
              console.log("User started speaking");
              // Handle barge-in if needed (clear audio queue)
              sourcesRef.current.forEach(src => { 
                  try { src.stop(); } catch(e) {} 
              });
              sourcesRef.current.clear();
              isAiSpeakingRef.current = false;
              nextStartTimeRef.current = 0;
              lastAiSpeechEndTimeRef.current = 0;
              
              // Send truncate event to server if needed, but server VAD handles it mostly
              ws.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
          }

          if (message.type === 'error') {
              const errorMessage = message.error?.message || message.message || "Unknown error";
              console.error("Backend Error:", errorMessage);
              setErrorMsg(`Backend Error: ${errorMessage}`);
              return;
          }
      };

      ws.onclose = () => {
        console.log('OpenAI Session Closed');
        setConnectionState(prev => {
            if (prev === ConnectionState.ERROR || prev === ConnectionState.COMPLETE) return prev;
            return ConnectionState.DISCONNECTED;
        });
      };

      ws.onerror = (err) => {
        console.error('OpenAI WebSocket Error:', err);
        setConnectionState(ConnectionState.ERROR);
        setErrorMsg("Connection failed. Ensure backend relay is running.");
      };

    } catch (error: any) {
      console.error("Failed to start session:", error);
      disconnect(); 
      setConnectionState(ConnectionState.ERROR);
      setErrorMsg(error.message || "Failed to access microphone or connect.");
    }
  };

  const handleDisconnectBtn = () => {
    if (!isPaused) togglePause();
    setShowEmailModal(true);
  }

  const handleFinalizeSession = async () => {
    if (!userEmail || !userEmail.includes('@')) {
        setErrorMsg("Please enter a valid email address.");
        return;
    }
    
    setIsFinalizing(true);
    setErrorMsg(null);

    try {
        const response = await fetch(getApiUrl('/api/finalize-session'), {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: userEmail,
                assessment: {
                    dimensions: sessionState.dimensions,
                    evidenceLog: sessionState.evidenceLog,
                    strengths: sessionState.strengths,
                    developmentPriorities: sessionState.developmentPriorities,
                    summary: sessionState.summary || "No summary available."
                }
            })
        });

        if (!response.ok) {
            throw new Error("Failed to finalize session");
        }

        const result = await response.json();
        console.log("Session finalized:", result);

        setShowEmailModal(false);
        disconnect();
        setConnectionState(ConnectionState.COMPLETE);

    } catch (e: any) {
        console.error("Error finalizing:", e);
        setErrorMsg(e.message || "Failed to generate report.");
    } finally {
        setIsFinalizing(false);
    }
  };

  const toggleMute = () => {
      setIsMuted(prev => !prev);
  };

  const togglePause = async () => {
      const newPaused = !isPaused;
      setIsPaused(newPaused);
      if (newPaused) {
          await outputAudioContextRef.current?.suspend();
      } else {
          await outputAudioContextRef.current?.resume();
      }
  };

  const renderStatus = () => {
    switch (connectionState) {
      case ConnectionState.DISCONNECTED: return <span className="text-slate-500">Ready to start</span>;
      case ConnectionState.CONNECTING: return <span className="text-indigo-600 animate-pulse">Connecting...</span>;
      case ConnectionState.CONNECTED: 
        if (isPaused) return <span className="text-amber-500 font-medium">Session Paused</span>;
        return <span className="text-green-600 font-medium">Live & Listening</span>;
      case ConnectionState.ERROR: return <span className="text-red-600 font-medium">Connection Failed</span>;
      case ConnectionState.COMPLETE: return <span className="text-indigo-700 font-bold">Assessment Complete</span>;
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 sm:p-8 w-full relative">
      
      {/* Email Modal */}
      {showEmailModal && (
        <div className="absolute inset-0 z-50 bg-white/90 backdrop-blur-sm flex items-center justify-center rounded-2xl p-6">
          <div className="bg-white shadow-2xl border border-slate-200 rounded-xl p-6 w-full max-w-md animate-fade-in-up">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">Finalize Session</h3>
              <button onClick={() => setShowEmailModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <p className="text-slate-600 text-sm mb-4">
              Enter your email to receive your comprehensive Cultural Competency Report and save your results.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="email" 
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>

              <button 
                onClick={handleFinalizeSession}
                disabled={isFinalizing}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
              >
                {isFinalizing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating Report...
                  </>
                ) : (
                  "Generate Report & End Session"
                )}
              </button>
              
              <button 
                onClick={() => {
                    setShowEmailModal(false);
                    disconnect();
                    setConnectionState(ConnectionState.DISCONNECTED);
                }}
                className="w-full py-2 text-slate-500 hover:text-slate-700 text-sm"
              >
                Skip & End without Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Section: Visualizer or Final Report Header */}
      <div className="relative bg-slate-900 rounded-xl overflow-hidden h-48 mb-8 flex items-center justify-center">
        {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
             <div className="text-slate-400 flex flex-col items-center gap-2">
                <Volume2 className="w-10 h-10 opacity-50" />
                <p className="text-sm">Audio Visualizer</p>
             </div>
        ) : connectionState === ConnectionState.COMPLETE ? (
             <div className="flex flex-col items-center gap-2 text-white animate-fade-in-down">
                <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center shadow-lg shadow-green-500/50">
                   <Key className="w-6 h-6 text-white" />
                </div>
                <p className="text-lg font-bold">Session Analyzed</p>
             </div>
        ) : (
          <div className="absolute inset-0 w-full h-full flex flex-col">
             <div className="h-1/2 w-full border-b border-slate-800/50">
               <AudioVisualizer analyser={outputAnalyser} isActive={!isPaused} color="#818cf8" />
             </div>
             <div className="h-1/2 w-full">
               <AudioVisualizer analyser={inputAnalyser} isActive={!isMuted && !isPaused} color="#34d399" />
             </div>
          </div>
        )}

        <div className="absolute top-3 left-3 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
          <div className="flex items-center gap-2">
             <div className={`w-2 h-2 rounded-full ${
                 connectionState === ConnectionState.CONNECTED && !isPaused ? 'bg-green-400 animate-pulse' : 
                 isPaused ? 'bg-amber-400' :
                 connectionState === ConnectionState.COMPLETE ? 'bg-indigo-400' : 'bg-slate-400'
             }`} />
             <span className="text-xs text-white font-medium uppercase tracking-wider">
                {connectionState === ConnectionState.CONNECTED ? (isPaused ? 'Paused' : 'Live') : connectionState === ConnectionState.COMPLETE ? 'Done' : 'Offline'}
             </span>
          </div>
        </div>
      </div>

      {/* PHASE 8: MIC LEVEL INDICATOR */}
      {connectionState === ConnectionState.CONNECTED && !isPaused && (
        <div className="w-full max-w-md mb-4">
           <MicLevelIndicator 
              level={currentMicLevel} 
              threshold={adaptiveThreshold} 
              isActive={!isMuted} 
           />
        </div>
      )}

      {/* PHASE 10: EARLY EXIT BUTTON */}
      {showEarlyExitButton && connectionState === ConnectionState.CONNECTED && !showEmailModal && (
        <button 
          onClick={handleDisconnectBtn}
          className="mb-6 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full font-bold shadow-lg shadow-emerald-500/30 animate-bounce flex items-center gap-2 transition-all transform hover:scale-105"
        >
          <CheckCircle className="w-5 h-5" />
          Enough Inferences to Generate Report
        </button>
      )}

      {/* Main Controls & Dashboard */}
      <div className="flex flex-col items-center gap-6">
        
        {/* Control Buttons */}
        <div className="flex items-center gap-4">
          {!hasApiKey ? (
            <button onClick={handleSelectKey} className="group relative flex flex-col items-center justify-center w-32 h-32 rounded-full bg-red-50 hover:bg-red-100 border-2 border-dashed border-red-300 text-red-500 hover:text-red-600 transition-all animate-pulse">
              <Key className="w-8 h-8 mb-2" />
              <span className="text-xs font-bold uppercase">Set API Key</span>
            </button>
          ) : (
            <>
              {(connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR || connectionState === ConnectionState.CONNECTING || connectionState === ConnectionState.COMPLETE) ? (
                <button
                  onClick={connectToOpenAI}
                  disabled={connectionState === ConnectionState.CONNECTING}
                  className="group relative flex items-center justify-center w-20 h-20 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg hover:shadow-indigo-500/30 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {connectionState === ConnectionState.CONNECTING ? <Loader2 className="w-8 h-8 animate-spin" /> : <Mic className="w-8 h-8 group-hover:scale-110 transition-transform" />}
                </button>
              ) : (
                <div className="flex items-center gap-4">
                  <button onClick={toggleMute} className={`p-4 rounded-full border-2 transition-colors ${isMuted ? 'bg-red-50 border-red-200 text-red-500' : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-indigo-200 hover:text-indigo-600'}`}>
                    {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                  </button>
                  
                  <button onClick={togglePause} className={`p-4 rounded-full border-2 transition-colors ${isPaused ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-indigo-200 hover:text-indigo-600'}`}>
                    {isPaused ? <Play className="w-6 h-6 fill-current" /> : <Pause className="w-6 h-6 fill-current" />}
                  </button>

                  <button onClick={handleDisconnectBtn} className="px-6 py-3 rounded-full bg-red-50 text-red-600 font-medium hover:bg-red-100 transition-colors border border-red-100">
                    End Session
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Status Message */}
        <div className="text-center space-y-2 flex flex-col items-center justify-center mb-4">
           <p className="text-lg font-medium text-slate-700">{renderStatus()}</p>
           {errorMsg && (
             <div className="flex items-center justify-center gap-2 text-red-600 text-sm bg-red-50 px-4 py-2 rounded-lg border border-red-100 max-w-md">
                 <AlertCircle className="w-4 h-4 shrink-0" />
                 <span>{errorMsg}</span>
             </div>
           )}
           {hasApiKey && connectionState !== ConnectionState.CONNECTED && (
              <button onClick={handleSelectKey} className="text-xs text-slate-400 hover:text-indigo-600 flex items-center gap-1 mt-2">
                <RefreshCw className="w-3 h-3" /> Switch API Key
              </button>
           )}
           {/* Debug Info */}
           {connectionState === ConnectionState.CONNECTED && (
               <div className="text-[10px] text-slate-300 mt-2 font-mono">
                   Last Event: {lastEvent} | Tool Calls: {toolCallCount}
               </div>
           )}
        </div>

        {/* LIVE DASHBOARD */}
        {connectionState === ConnectionState.CONNECTED && (
            <div className="w-full animate-fade-in-down">
                <LiveTracker state={sessionState} />
            </div>
        )}

        {/* FINAL REPORT */}
        {connectionState === ConnectionState.COMPLETE && (
            <div className="w-full">
                <FinalReport state={sessionState} />
            </div>
        )}

        {/* Initial Tips */}
        {connectionState === ConnectionState.DISCONNECTED && !errorMsg && (
          <div className="mt-4 p-4 bg-indigo-50 rounded-lg border border-indigo-100 text-indigo-800 text-sm text-center max-w-md">
            <p className="font-medium mb-1">Ready for your assessment?</p>
            <p className="opacity-80">I'll ask you about your work and experiences to build your cultural competency profile.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export { LiveVoiceCoach };