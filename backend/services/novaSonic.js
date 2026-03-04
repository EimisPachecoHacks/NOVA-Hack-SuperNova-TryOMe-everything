/**
 * Amazon Nova Sonic — Bidirectional Streaming Voice Service
 *
 * Uses InvokeModelWithBidirectionalStream to create real-time
 * speech-to-speech conversations through Amazon Bedrock.
 *
 * Audio format:
 *   Input:  16 kHz, 16-bit, mono, LPCM (base64)
 *   Output: 24 kHz, 16-bit, mono, LPCM (base64)
 */

const {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const { NodeHttp2Handler } = require("@smithy/node-http-handler");
const { randomUUID: uuidv4 } = require("crypto");

const MODEL_ID = "amazon.nova-2-sonic-v1:0";

// HTTP/2 handler required for bidirectional streaming
const http2Handler = new NodeHttp2Handler({
  requestTimeout: 300_000,
  sessionTimeout: 300_000,
  disableConcurrentStreams: false,
  maxConcurrentStreams: 20,
});

function createBedrockClient() {
  return new BedrockRuntimeClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN && {
        sessionToken: process.env.AWS_SESSION_TOKEN,
      }),
    },
    requestHandler: http2Handler,
  });
}

// ---------------------------------------------------------------------------
// Async generator that feeds events into the Bedrock stream
// ---------------------------------------------------------------------------
class EventQueue {
  constructor() {
    this._queue = [];
    this._resolve = null;
    this._done = false;
  }

  push(event) {
    if (this._done) return;
    if (this._resolve) {
      const r = this._resolve;
      this._resolve = null;
      r({ value: event, done: false });
    } else {
      this._queue.push(event);
    }
  }

  close() {
    this._done = true;
    if (this._resolve) {
      const r = this._resolve;
      this._resolve = null;
      r({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this._queue.length > 0) {
          return Promise.resolve({ value: this._queue.shift(), done: false });
        }
        if (this._done) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          this._resolve = resolve;
        });
      },
    };
  }
}

// ---------------------------------------------------------------------------
// SonicSession — wraps one bidirectional streaming session
// ---------------------------------------------------------------------------
class SonicSession {
  constructor(systemPrompt, tools, voiceId = "tiffany") {
    this.client = createBedrockClient();
    this.promptName = uuidv4();
    this.systemPrompt = systemPrompt;
    this.tools = tools;
    this.voiceId = voiceId;
    this.eventQueue = new EventQueue();
    this.audioContentName = null;
    this.active = false;
    this.onAudioOutput = null;
    this.onTextOutput = null;
    this.onToolUse = null;
    this.onError = null;
  }

  // Start the bidirectional stream
  async start() {
    this.active = true;

    // Queue all setup events BEFORE calling client.send() so the
    // async iterator yields sessionStart as the very first event.
    this._sendSessionStart();
    this._sendPromptStart();
    this._sendSystemPrompt();
    this._startAudioInput();

    const command = new InvokeModelWithBidirectionalStreamCommand({
      modelId: MODEL_ID,
      body: this._inputStream(),
    });

    try {
      const response = await this.client.send(command);

      // Process output stream in background
      this._processOutputStream(response).catch((err) => {
        console.error("[NovaSonic] Output stream error:", err.message);
        if (this.onError) this.onError(err);
      });
    } catch (err) {
      console.error("[NovaSonic] Failed to start stream:", err.message);
      this.active = false;
      throw err;
    }
  }

  // Send a chunk of base64-encoded PCM audio
  sendAudio(base64Audio) {
    if (!this.active || !this.audioContentName) return;
    this.eventQueue.push({
      chunk: {
        bytes: Buffer.from(
          JSON.stringify({
            event: {
              audioInput: {
                promptName: this.promptName,
                contentName: this.audioContentName,
                content: base64Audio,
              },
            },
          })
        ),
      },
    });
  }

  // Send a tool result back to the model
  sendToolResult(toolUseId, resultJson) {
    const contentName = uuidv4();

    // contentStart for tool result
    this.eventQueue.push({
      chunk: {
        bytes: Buffer.from(
          JSON.stringify({
            event: {
              contentStart: {
                promptName: this.promptName,
                contentName,
                interactive: false,
                type: "TOOL",
                role: "TOOL",
                toolResultInputConfiguration: {
                  toolUseId,
                  type: "TEXT",
                  textInputConfiguration: { mediaType: "text/plain" },
                },
              },
            },
          })
        ),
      },
    });

    // toolResult content
    this.eventQueue.push({
      chunk: {
        bytes: Buffer.from(
          JSON.stringify({
            event: {
              toolResult: {
                promptName: this.promptName,
                contentName,
                content: JSON.stringify(resultJson),
              },
            },
          })
        ),
      },
    });

    // contentEnd
    this.eventQueue.push({
      chunk: {
        bytes: Buffer.from(
          JSON.stringify({
            event: {
              contentEnd: {
                promptName: this.promptName,
                contentName,
              },
            },
          })
        ),
      },
    });
  }

  // Gracefully close the session
  async close() {
    if (!this.active) return;
    this.active = false;

    try {
      // End audio content
      if (this.audioContentName) {
        this.eventQueue.push({
          chunk: {
            bytes: Buffer.from(
              JSON.stringify({
                event: {
                  contentEnd: {
                    promptName: this.promptName,
                    contentName: this.audioContentName,
                  },
                },
              })
            ),
          },
        });
      }

      // End prompt
      this.eventQueue.push({
        chunk: {
          bytes: Buffer.from(
            JSON.stringify({
              event: { promptEnd: { promptName: this.promptName } },
            })
          ),
        },
      });

      // End session
      this.eventQueue.push({
        chunk: {
          bytes: Buffer.from(
            JSON.stringify({
              event: { sessionEnd: {} },
            })
          ),
        },
      });
    } catch (_) {}

    this.eventQueue.close();
  }

  // --- Internal helpers ---

  async *_inputStream() {
    for await (const event of this.eventQueue) {
      yield event;
    }
  }

  _sendSessionStart() {
    this.eventQueue.push({
      chunk: {
        bytes: Buffer.from(
          JSON.stringify({
            event: {
              sessionStart: {
                inferenceConfiguration: {
                  maxTokens: 1024,
                  topP: 0.9,
                  temperature: 0.7,
                },
              },
            },
          })
        ),
      },
    });
  }

  _sendPromptStart() {
    const toolSpecs = this.tools.map((t) => ({ toolSpec: t }));

    this.eventQueue.push({
      chunk: {
        bytes: Buffer.from(
          JSON.stringify({
            event: {
              promptStart: {
                promptName: this.promptName,
                textOutputConfiguration: { mediaType: "text/plain" },
                audioOutputConfiguration: {
                  mediaType: "audio/lpcm",
                  sampleRateHertz: 24000,
                  sampleSizeBits: 16,
                  channelCount: 1,
                  voiceId: this.voiceId,
                  encoding: "base64",
                  audioType: "SPEECH",
                },
                toolUseOutputConfiguration: {
                  mediaType: "application/json",
                },
                toolConfiguration: {
                  tools: toolSpecs,
                },
              },
            },
          })
        ),
      },
    });
  }

  _sendSystemPrompt() {
    const contentName = uuidv4();

    // contentStart
    this.eventQueue.push({
      chunk: {
        bytes: Buffer.from(
          JSON.stringify({
            event: {
              contentStart: {
                promptName: this.promptName,
                contentName,
                type: "TEXT",
                interactive: false,
                role: "SYSTEM",
                textInputConfiguration: { mediaType: "text/plain" },
              },
            },
          })
        ),
      },
    });

    // textInput
    this.eventQueue.push({
      chunk: {
        bytes: Buffer.from(
          JSON.stringify({
            event: {
              textInput: {
                promptName: this.promptName,
                contentName,
                content: this.systemPrompt,
              },
            },
          })
        ),
      },
    });

    // contentEnd
    this.eventQueue.push({
      chunk: {
        bytes: Buffer.from(
          JSON.stringify({
            event: {
              contentEnd: { promptName: this.promptName, contentName },
            },
          })
        ),
      },
    });
  }

  _startAudioInput() {
    this.audioContentName = uuidv4();

    this.eventQueue.push({
      chunk: {
        bytes: Buffer.from(
          JSON.stringify({
            event: {
              contentStart: {
                promptName: this.promptName,
                contentName: this.audioContentName,
                type: "AUDIO",
                interactive: true,
                role: "USER",
                audioInputConfiguration: {
                  audioType: "SPEECH",
                  mediaType: "audio/lpcm",
                  sampleRateHertz: 16000,
                  sampleSizeBits: 16,
                  channelCount: 1,
                  encoding: "base64",
                },
              },
            },
          })
        ),
      },
    });
  }

  async _processOutputStream(response) {
    const stream = response.body;

    for await (const event of stream) {
      if (!this.active) break;

      try {
        if (event.chunk?.bytes) {
          const parsed = JSON.parse(
            Buffer.from(event.chunk.bytes).toString("utf-8")
          );
          const evt = parsed.event;
          if (!evt) continue;

          if (evt.audioOutput && this.onAudioOutput) {
            this.onAudioOutput(evt.audioOutput.content);
          } else if (evt.textOutput && this.onTextOutput) {
            this.onTextOutput(evt.textOutput.content, evt.textOutput.role);
          } else if (evt.toolUse && this.onToolUse) {
            this.onToolUse(
              evt.toolUse.toolName,
              evt.toolUse.toolUseId,
              evt.toolUse.content
            );
          }
        }
      } catch (parseErr) {
        // Skip unparseable chunks
      }
    }
  }
}

module.exports = { SonicSession };
