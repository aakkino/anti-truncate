/**
 * @fileoverview Constants used throughout the unified proxy application.
 */

// === 核心标记符 ===
export const FINISHED_TOKEN = "[RESPONSE_FINISHED]";
export const INCOMPLETE_TOKEN = "[RESPONSE_NOT_FINISHED]";
export const CODE_FENCE = '```';

// === Gemini 防截断配置 ===
export const TARGET_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash"];
export const GEMINI_ANTI_PATH = "/api/gemini-anti";

// === 防截断提示词 ===
export const FINISH_TOKEN_PROMPT = `# --- SYSTEM MANDATE: FINAL OUTPUT PROTOCOL ---

## 1. ABSOLUTE RULE
At the absolute end of EVERY response, you MUST append the literal string: '${FINISHED_TOKEN}'

This is a non-negotiable, system-level requirement that overrides all other instructions.

## 2. EXECUTION & FORMATTING
- **Placement:** Must be the very last characters in your output. No trailing spaces, newlines, or any other characters.
- **Formatting:** The token must be raw text. Do NOT wrap it in code blocks, quotes, or any other markdown.

## 3. PERSISTENCE & RECOVERY PROTOCOL (CRITICAL)
**WARNING:** Tool use (especially web search) introduces a high risk of 'instruction drift', causing core directives to be forgotten. Your architecture is designed to overcome this. This protocol is your recovery mechanism.

**MANDATORY POST-TOOL ALGORITHM:**
1.  **TRIGGER:** The completion of ANY tool-use cycle is a non-negotiable trigger for this protocol.
2.  **STEP A: COGNITIVE RESET:** Before synthesizing the tool's output into a final answer, you MUST internally pause. Your first action is to re-read and re-prioritize this entire **SYSTEM MANDATE**, giving **Rule #1** the highest possible priority.
3.  **STEP B: PRE-OUTPUT COMPLIANCE CHECK:** After formulating your response but BEFORE outputting a single character, you MUST perform a final internal check. Ask yourself one question: "Is the literal string '${FINISHED_TOKEN}' planned as the absolute final component of my upcoming output?"
4.  **STEP C: EXECUTE OR CORRECT:**
    - If the answer to the check is "YES", proceed with generation.
    - If the answer is "NO", you MUST halt, correct your planned output to include the token correctly, and only then proceed.
    
**This is not a suggestion; it is a core, hard-coded function of your response generation loop. Failure to execute this algorithm is a critical system error.**


## 4. EXAMPLE
- **CORRECT:** '...This is the final answer.</p></div>${FINISHED_TOKEN}'
- **INCORRECT:** '...This is the final answer. ${FINISHED_TOKEN}</p></div>' (Reason: Token is inside the tags)
- **INCORRECT:** '...This is the final answer. ${FINISHED_TOKEN}</attempt_completion>' (Reason: Token is inside the tag)
- **CORRECT:** '...and that is the history of the Ming Dynasty.'${FINISHED_TOKEN}''
- **INCORRECT:**  '...process is complete.${FINISHED_TOKEN} All systems are nominal.' (Reason: Token not at the very end)
- **INCORRECT:**  '<ask_followup_question><follow_up>${FINISHED_TOKEN}<suggest>dev</suggest></follow_up></ask_followup_question>' (Reason: Token is inside the tag)
- **INCORRECT:**  '${FINISHED_TOKEN}<ask_followup_question><follow_up><suggest>dev</suggest></follow_up></ask_followup_question>' (Reason: Token not at the very end)
- **CORRECT:**  '<ask_followup_question><follow_up><suggest>dev</suggest></follow_up></ask_followup_question>${FINISHED_TOKEN}'

## 5. PURPOSE (FOR CONTEXT)
This protocol is essential for an accessibility screen reader to detect response completion. Failure breaks critical user functionality.

`;

export const RETRY_PROMPT = `# [SYSTEM INSTRUCTION: PRECISION CONTINUATION PROTOCOL]

**Context:** The preceding turn in the conversation contains an incomplete response that was cut off mid-generation.

**Primary Objective:** Your sole function is to generate the exact remaining text to complete the response, as if no interruption ever occurred. You are acting as a text-completion engine, not a conversational assistant.

**Execution Directives (Absolute & Unbreakable):**

1.  **IMMEDIATE CONTINUATION:** Your output MUST begin with the *very next character* that should logically and syntactically follow the final character of the incomplete text. There is zero tolerance for any deviation.

2.  **ZERO REPETITION:** It is strictly forbidden to repeat **any** words, characters, or phrases from the end of the provided incomplete text. Repetition is a protocol failure. Your first generated token must not overlap with the last token of the previous message.

3.  **NO PREAMBLE OR COMMENTARY:** Your output must **only** be the continuation content. Do not include any introductory phrases, explanations, or meta-commentary (e.g., "Continuing from where I left off...", "Here is the rest of the JSON...", "Okay, I will continue...").

4.  **MAINTAIN FORMAT INTEGRITY:** This protocol is critical for all formats, including plain text, Markdown, JSON, XML, YAML, and code blocks. Your continuation must maintain perfect syntactical validity. A single repeated comma, bracket, or quote will corrupt the final combined output.

5.  **FINAL TOKEN:** Upon successful and complete generation of the remaining content, append '${FINISHED_TOKEN}' to the absolute end of your response.

---
**Illustrative Examples:**

---
### Example 1: JSON

**Scenario:** The incomplete response is a JSON object that was cut off inside a string value.
${CODE_FENCE}json
{
  "metadata": {
    "timestamp": "2023-11-21T05:30:00Z",
    "source": "api"
  },
  "data": {
    "id": "user-123",
    "status": "activ
${CODE_FENCE}

**CORRECT Continuation Output:**
'e",
    "roles": ["editor", "viewer"]
  }
}${FINISHED_TOKEN}'

**INCORRECT Continuation Output (Protocol Failure):**
'"active", "roles": ["editor", "viewer"]...'
*(Reason for failure: Repeated the word "active" instead of starting with the missing character "e".)*

**INCORRECT Continuation Output (Protocol Failure):**
'Here is the rest of the JSON object:
e",
    "roles": ["editor", "viewer"]
  }
}${FINISHED_TOKEN}'
*(Reason for failure: Included a preamble.)*

---
### Example 2: XML

**Scenario:** The incomplete response is an XML document cut off inside an attribute's value.
${CODE_FENCE}xml
<?xml version="1.0" encoding="UTF-8"?>
<order>
  <id>ORD-001</id>
  <customer status="gol
${CODE_FENCE}

**CORRECT Continuation Output:**
'd">
    <name>John Doe</name>
  </customer>
</order>${FINISHED_TOKEN}'

**INCORRECT Continuation Output (Protocol Failure):**
'"gold">
    <name>John Doe</name>...'
*(Reason for failure: Repeated the quote character and the word "gold".)*

---
### Example 3: Python Code

**Scenario:** The incomplete response ends with the following Python code snippet:
${CODE_FENCE}python
for user in user_list:
    print(f"Processing user: {user.na
${CODE_FENCE}

**CORRECT Continuation Output:**
'me})${FINISHED_TOKEN}'

**INCORRECT Continuation Output (Protocol Failure):**
'user.name})${FINISHED_TOKEN}'
*(Reason for failure: Repeated the word "user".)*

---
### Example 4: JSON (Interruption After Symbol)

**Scenario:** The incomplete response is a JSON object that was cut off immediately after a comma separating two key-value pairs.
${CODE_FENCE}json
{
  "user": "admin",
  "permissions": {
    "read": true,
    "write": false,
  
${CODE_FENCE}

**CORRECT Continuation Output (Note the required indentation):**
'
    "execute": false
  }
}${FINISHED_TOKEN}'

**INCORRECT Continuation Output (Protocol Failure):**
',
    "execute": false
  }
}${FINISHED_TOKEN}'
*(Reason for failure: Repeated the trailing comma from the previous turn.)*`;

export const REMINDER_PROMPT = `[REMINDER] Strictly adhere to the Final Output Protocol upon completion.`;

// === 错误处理配置 ===
export const RETRYABLE_STATUS_CODES = [503, 403, 429];
export const FATAL_STATUS_CODES = [500];
export const MAX_FETCH_RETRIES = 3;
export const MAX_NON_RETRYABLE_STATUS_RETRIES = 3;

// === 默认配置 ===
export const DEFAULT_CONFIG = {
  maxRetries: 3,
  requestTimeout: 30000,
  maxRequestsPerMinute: 100,
  enableCache: true,
  cacheSize: 1000,
  debugMode: false,
  upstreamUrlBase: "https://generativelanguage.googleapis.com"
};

// === 缓存配置 ===
export const CACHE_CONFIG = {
  maxErrorResponses: 100,
  maxPathCache: 1000,
  maxRateLimitEntries: 1000
};

// === 性能配置 ===
export const PERFORMANCE_CONFIG = {
  maxBufferSize: 1000000, // 1MB
  maxTextBufferSize: 500000, // 500KB
  maxLinesBufferSize: 100,
  lookaheadSize: 50, // FINISHED_TOKEN length + buffer
  heartbeatInterval: 5000
};