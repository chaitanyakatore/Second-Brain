import * as vscode from 'vscode';

export class BrainSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'companyBrain.chatView';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Company Brain Chat</title>
  <style>
    :root {
      --bg-color: #0f172a;
      --card-bg: #1e293b;
      --text-color: #f8fafc;
      --accent-color: #38bdf8;
      --hit-color: #22c55e;
      --miss-color: #a855f7;
      --verified-color: #eab308;
      --border-color: #334155;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg-color);
      color: var(--text-color);
      margin: 0;
      padding: 12px;
      display: flex;
      flex-direction: column;
      height: 95vh;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 12px;
    }
    .header h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--accent-color);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .chat-container {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-right: 4px;
    }
    .message {
      background: var(--card-bg);
      border-radius: 8px;
      padding: 10px 12px;
      border: 1px solid var(--border-color);
      font-size: 13px;
      line-height: 1.4;
    }
    .message.user {
      border-left: 3px solid var(--accent-color);
      align-self: flex-end;
      width: 90%;
    }
    .message.assistant {
      border-left: 3px solid var(--border-color);
      align-self: flex-start;
      width: 95%;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 12px;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge.hit {
      background: rgba(34, 197, 94, 0.15);
      color: var(--hit-color);
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .badge.miss {
      background: rgba(168, 85, 247, 0.15);
      color: var(--miss-color);
      border: 1px solid rgba(168, 85, 247, 0.3);
    }
    .badge.verified {
      background: rgba(234, 179, 8, 0.15);
      color: var(--verified-color);
      border: 1px solid rgba(234, 179, 8, 0.4);
    }
    .input-box {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    textarea {
      width: 100%;
      background: #1e293b;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-color);
      padding: 8px;
      font-family: inherit;
      font-size: 12px;
      resize: none;
      box-sizing: border-box;
      outline: none;
    }
    textarea:focus {
      border-color: var(--accent-color);
    }
    .button-group {
      display: flex;
      gap: 8px;
    }
    button {
      flex: 1;
      background: #0284c7;
      color: white;
      border: none;
      padding: 8px 12px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-size: 12px;
      transition: background 0.2s;
    }
    button.clear-btn {
      background: #334155;
      flex: 0.4;
    }
    button:hover {
      background: #0369a1;
    }
    button.clear-btn:hover {
      background: #475569;
    }
  </style>
</head>
<body>
  <div class="header">
    <h3>🧠 Company Brain</h3>
    <span style="font-size: 11px; opacity: 0.7;">v1.0 POC</span>
  </div>

  <div class="chat-container" id="chatContainer">
    <div class="message assistant">
      👋 Welcome! Ask any coding question or bug fix. Standardized solutions will be instantly served from the Enterprise Semantic Cache.
    </div>
  </div>

  <div class="input-box">
    <textarea id="promptInput" rows="3" placeholder="Ask a question or paste stack trace..."></textarea>
    <div class="button-group">
      <button id="sendBtn">Send Query</button>
      <button id="clearBtn" class="clear-btn">Clear Chat</button>
    </div>
  </div>

  <script>
    const chatContainer = document.getElementById('chatContainer');
    const promptInput = document.getElementById('promptInput');
    const sendBtn = document.getElementById('sendBtn');
    const clearBtn = document.getElementById('clearBtn');

    let conversationHistory = [];

    sendBtn.addEventListener('click', () => sendPrompt());
    clearBtn.addEventListener('click', () => {
      conversationHistory = [];
      chatContainer.innerHTML = '<div class="message assistant">👋 Chat memory cleared. Start a new topic!</div>';
    });

    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendPrompt();
      }
    });

    async function sendPrompt() {
      const text = promptInput.value.trim();
      if (!text) return;

      conversationHistory.push({ role: 'user', content: text });
      appendMessage('user', text);
      promptInput.value = '';

      const assistantDiv = appendMessage('assistant', '<span style="opacity: 0.6;">Evaluating cache & memory...</span>');
      
      try {
        const response = await fetch('http://localhost:3000/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: conversationHistory,
            repo_id: 'vscode-workspace'
          })
        });

        assistantDiv.innerHTML = '<div class="badge miss">🤖 LLM GENERATED (15ms)</div><div class="content"></div>';
        const contentDiv = assistantDiv.querySelector('.content');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let answerText = '';
        let badgeUpdated = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6).trim();
              if (dataStr === '[DONE]') continue;
              try {
                const parsed = JSON.parse(dataStr);
                
                // Update badge based on SSE stream payload metadata
                if (!badgeUpdated) {
                  const latency = parsed.latency || '15ms';
                  let badgeHtml = '';

                  if (parsed.verified || parsed.model === 'company-brain-verified') {
                    const verifier = (parsed.verified_by || 'Staff Architect').toUpperCase();
                    badgeHtml = \`<div class="badge verified">⭐ VERIFIED BY \${verifier} (\${latency})</div>\`;
                  } else if (parsed.cache_status === 'HIT' || parsed.model === 'company-brain-cache') {
                    const matchType = parsed.match_type || 'EXACT_HASH';
                    badgeHtml = \`<div class="badge hit">⚡ CACHE HIT (\${latency}, $0.00) [\${matchType}]</div>\`;
                  } else {
                    badgeHtml = \`<div class="badge miss">🤖 LLM GENERATED (\${latency})</div>\`;
                  }

                  assistantDiv.querySelector('.badge').outerHTML = badgeHtml;
                  badgeUpdated = true;
                }

                const token = parsed.choices?.[0]?.delta?.content || '';
                answerText += token;
                contentDiv.innerText = answerText;
                chatContainer.scrollTop = chatContainer.scrollHeight;
              } catch (e) {}
            }
          }
        }

        if (answerText) {
          conversationHistory.push({ role: 'assistant', content: answerText });
        }

      } catch (err) {
        assistantDiv.innerHTML = \`<div style="color: #ef4444;">Error connecting to Company Brain proxy at http://localhost:3000</div>\`;
      }
    }

    function appendMessage(role, text) {
      const msgDiv = document.createElement('div');
      msgDiv.className = \`message \${role}\`;
      msgDiv.innerHTML = text;
      chatContainer.appendChild(msgDiv);
      chatContainer.scrollTop = chatContainer.scrollHeight;
      return msgDiv;
    }
  </script>
</body>
</html>`;
  }
}
