# Router Migration to Python: Comprehensive Architecture Analysis

**Date:** November 23, 2025  
**Status:** Conceptual Design  
**Author:** Architecture Analysis  

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Architecture Analysis](#current-architecture-analysis)
3. [Python Migration Architecture](#python-migration-architecture)
4. [Communication Protocols](#communication-protocols)
5. [Implementation Strategies](#implementation-strategies)
6. [Performance Considerations](#performance-considerations)
7. [Migration Roadmap](#migration-roadmap)
8. [Risk Analysis](#risk-analysis)
9. [Technology Stack](#technology-stack)
10. [Code Examples](#code-examples)

---

## Executive Summary

### Current State
The router system is currently implemented as a **TypeScript/JavaScript extension** running in the browser/Tauri webview context. It consists of:
- Router Extension (orchestrator)
- Multiple routing strategies (Heuristic, LLM-based)
- Integration with Jan's core extension system
- Real-time model selection and routing

### Proposed State
Migrate router logic to a **Python-based microservice** that:
- Runs as a standalone process
- Communicates via IPC (Inter-Process Communication) or HTTP
- Leverages Python's ML/AI ecosystem
- Maintains compatibility with existing Jan architecture
- Provides enhanced routing capabilities

### Key Benefits
1. **Access to Python ML ecosystem** (scikit-learn, transformers, sentence-transformers)
2. **Better LLM-based routing** (easier to run routing models)
3. **Advanced analytics** (pandas, numpy for routing decisions)
4. **Model performance profiling** (tracking and learning from usage)
5. **Independent scaling** (router can scale independently)

### Key Challenges
1. **Inter-process communication overhead**
2. **State synchronization** between TypeScript and Python
3. **Deployment complexity** (Python runtime required)
4. **Error handling across process boundaries**
5. **Backward compatibility** with existing extensions

---

## Current Architecture Analysis

### 1. Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Jan Application                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                   Web App (React)                       │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │              useChat.ts Hook                      │  │ │
│  │  │  - Routing trigger                                │  │ │
│  │  │  - Model selection                                │  │ │
│  │  │  - Thread management                              │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  Core Package                           │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │         RouterManager (Singleton)                 │  │ │
│  │  │  - Extension registration                         │  │ │
│  │  │  - Strategy delegation                            │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │    ModelRouterExtension (Abstract Base)          │  │ │
│  │  │  - route()                                        │  │ │
│  │  │  - getStrategy() / setStrategy()                 │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │            Router Extension (TypeScript)                │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │          RouterExtension                          │  │ │
│  │  │  - Strategy management                            │  │ │
│  │  │  - Model filtering (allowedModels)               │  │ │
│  │  │  - Settings integration                           │  │ │
│  │  │  - Logging/analytics                              │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │         HeuristicRouter Strategy                  │  │ │
│  │  │  - Rule-based scoring                             │  │ │
│  │  │  - Capability matching                            │  │ │
│  │  │  - Model size heuristics                          │  │ │
│  │  │  - Loaded model preference                        │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │           LLMRouter Strategy                      │  │ │
│  │  │  - LLM-based decision making                      │  │ │
│  │  │  - (Currently fallback implementation)            │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 2. Data Flow

```
User Query
    │
    ▼
┌─────────────────────┐
│  useChat.ts         │
│  - Check routing    │
│    enabled          │
│  - Build context    │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  RouterManager      │
│  - Get registered   │
│    router           │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  RouterExtension    │
│  - Filter models    │
│    (allowedModels)  │
│  - Select strategy  │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Strategy.route()   │
│  - Score models     │
│  - Return decision  │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  useChat.ts         │
│  - Update thread    │
│    model            │
│  - Load model if    │
│    needed           │
│  - Send completion  │
└─────────────────────┘
```

### 3. Key Interfaces

#### RouteContext
```typescript
{
  messages: ChatCompletionMessage[]     // Conversation history
  threadId?: string                     // Thread context
  availableModels: AvailableModel[]     // All candidate models
  activeModels: string[]                // Currently loaded models
  preferences?: RoutePreferences        // User constraints
  attachments?: {                       // Query metadata
    images: number
    documents: number
    hasCode: boolean
  }
}
```

#### RouteDecision
```typescript
{
  modelId: string           // Selected model
  providerId: string        // Provider (e.g., llamacpp)
  confidence: number        // 0-1 confidence score
  reasoning: string         // Human-readable explanation
  metadata?: object         // Additional data
}
```

#### AvailableModel
```typescript
{
  id: string
  providerId: string
  capabilities: string[]    // ['chat', 'code', 'vision']
  metadata: {
    parameterCount?: string // '7B', '70B'
    contextWindow?: number
    quantization?: string
    isLoaded?: boolean
  }
}
```

### 4. Current Strengths

✅ **Tight Integration**: Direct access to Jan's state and models  
✅ **Low Latency**: No IPC overhead, runs in same process  
✅ **Synchronous**: Easy state synchronization  
✅ **Extension System**: Follows Jan's architecture patterns  
✅ **Settings Integration**: Built-in settings UI support  

### 5. Current Limitations

❌ **Limited ML Capabilities**: No easy access to ML libraries  
❌ **LLM Routing**: Hard to run routing models in TypeScript  
❌ **Analytics**: Limited data processing capabilities  
❌ **Code Complexity**: Complex scoring logic in TypeScript  
❌ **Learning**: No easy way to improve routing over time  

---

## Python Migration Architecture

### Architecture Option 1: Python Microservice (Recommended)

```
┌──────────────────────────────────────────────────────────────┐
│                    Jan Application (Tauri)                    │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              TypeScript Router Bridge                   │  │
│  │  (Minimal TypeScript adapter)                           │  │
│  │  - Implements ModelRouterExtension interface            │  │
│  │  - Converts TS types → JSON                             │  │
│  │  - Sends to Python service via IPC/HTTP                 │  │
│  │  - Handles errors/timeouts                              │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                   │
│                           │ IPC/HTTP                          │
│                           ▼                                   │
└───────────────────────────┼───────────────────────────────────┘
                            │
                            │
┌───────────────────────────┼───────────────────────────────────┐
│                           ▼                                   │
│             Python Router Service (FastAPI)                   │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │               API Layer (FastAPI)                       │  │
│  │  POST /route                                            │  │
│  │  GET /health                                            │  │
│  │  GET /strategies                                        │  │
│  │  POST /feedback (for learning)                          │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                   │
│                           ▼                                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │            Router Service (Core Logic)                  │  │
│  │  - Strategy management                                  │  │
│  │  - Model filtering                                      │  │
│  │  - Decision caching                                     │  │
│  │  - Analytics logging                                    │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                   │
│                           ▼                                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                Strategy Layer                           │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │      HeuristicStrategy (Python)                   │  │  │
│  │  │  - Enhanced scoring with numpy                    │  │  │
│  │  │  - Statistical analysis                           │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │      EmbeddingStrategy                            │  │  │
│  │  │  - sentence-transformers                          │  │  │
│  │  │  - Semantic similarity matching                   │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │      LLMStrategy                                  │  │  │
│  │  │  - Run small routing model (Phi-3, Qwen)          │  │  │
│  │  │  - Prompt-based routing                           │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │      MLStrategy (Future)                          │  │  │
│  │  │  - Trained classifier                             │  │  │
│  │  │  - Learn from past decisions                      │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                   │
│                           ▼                                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Data Layer (Optional)                      │  │
│  │  - SQLite for routing history                          │  │
│  │  - Model performance metrics                           │  │
│  │  - User feedback                                       │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### Architecture Option 2: Python Plugin (MCP-like)

```
┌──────────────────────────────────────────────────────────────┐
│                    Jan Application (Tauri)                    │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                  MCP Server Manager                      │  │
│  │  (Existing Jan infrastructure)                          │  │
│  │  - Process lifecycle management                         │  │
│  │  - Stdio/SSE transport                                  │  │
│  │  - Auto-restart on failure                              │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                   │
│                           │ Stdio/SSE                         │
│                           ▼                                   │
└───────────────────────────┼───────────────────────────────────┘
                            │
                            │
┌───────────────────────────┼───────────────────────────────────┐
│                           ▼                                   │
│         Python Router MCP Server (Model Context Protocol)     │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              MCP Server Implementation                  │  │
│  │  - Implements MCP protocol                              │  │
│  │  - Tools: route_model, list_strategies                  │  │
│  │  - Resources: routing_history, model_metrics            │  │
│  │  - Prompts: routing_context                             │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                   │
│                           ▼                                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │            Router Logic (Same as Option 1)              │  │
│  │  - Strategies                                           │  │
│  │  - ML models                                            │  │
│  │  - Analytics                                            │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### Architecture Option 3: Hybrid (Best of Both)

```
┌──────────────────────────────────────────────────────────────┐
│                    Jan Application (Tauri)                    │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │          TypeScript Router Extension (Facade)           │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  Fast Path: Heuristic routing (TypeScript)       │  │  │
│  │  │  - No IPC overhead                                │  │  │
│  │  │  - Simple queries (<50 tokens)                    │  │  │
│  │  │  - No attachments                                 │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                         │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  Smart Path: Python service (Complex routing)    │  │  │
│  │  │  - Advanced strategies                            │  │  │
│  │  │  - Image queries                                  │  │  │
│  │  │  - Long contexts                                  │  │  │
│  │  │  - Learning-based routing                         │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                   │
│                           │ Selective IPC/HTTP                │
│                           ▼                                   │
└───────────────────────────┼───────────────────────────────────┘
                            │
┌───────────────────────────┼───────────────────────────────────┐
│                           ▼                                   │
│              Python Router Service (Enhanced)                 │
│  - Embedding-based routing                                   │
│  - LLM-based routing                                         │
│  - ML classifier                                             │
│  - Performance analytics                                     │
└───────────────────────────────────────────────────────────────┘
```

---

## Communication Protocols

### Option A: HTTP/REST API

**Pros:**
- Simple, well-understood
- Easy debugging (curl, Postman)
- Language agnostic
- Can be hosted remotely

**Cons:**
- Higher latency (TCP handshake)
- More overhead
- Requires port management

**Implementation:**
```python
# Python (FastAPI)
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class RouteRequest(BaseModel):
    messages: list
    available_models: list
    active_models: list
    preferences: dict = {}

class RouteResponse(BaseModel):
    model_id: str
    provider_id: str
    confidence: float
    reasoning: str
    metadata: dict = {}

@app.post("/route", response_model=RouteResponse)
async def route(request: RouteRequest):
    # Routing logic
    return RouteResponse(...)
```

```typescript
// TypeScript (Client)
async route(context: RouteContext): Promise<RouteDecision> {
  const response = await fetch('http://localhost:8765/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(context),
  })
  return await response.json()
}
```

### Option B: IPC (Unix Sockets / Named Pipes)

**Pros:**
- Lower latency than HTTP
- No port conflicts
- Better security (local only)
- Less overhead

**Cons:**
- Platform-specific (Windows vs Unix)
- More complex error handling
- Harder to debug

**Implementation:**
```python
# Python (Unix socket server)
import socket
import json

def start_ipc_server(socket_path='/tmp/jan-router.sock'):
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(socket_path)
    server.listen(1)
    
    while True:
        conn, _ = server.accept()
        data = conn.recv(4096)
        request = json.loads(data)
        
        # Route
        response = route_model(request)
        
        conn.send(json.dumps(response).encode())
        conn.close()
```

### Option C: gRPC (High Performance)

**Pros:**
- Very low latency
- Bi-directional streaming
- Strong typing (protobuf)
- Efficient binary protocol

**Cons:**
- More setup complexity
- Requires code generation
- Heavier dependencies

**Implementation:**
```protobuf
// router.proto
syntax = "proto3";

service Router {
  rpc Route (RouteRequest) returns (RouteResponse);
  rpc StreamRoute (RouteRequest) returns (stream RouteResponse);
}

message RouteRequest {
  repeated Message messages = 1;
  repeated Model available_models = 2;
  repeated string active_models = 3;
}

message RouteResponse {
  string model_id = 1;
  string provider_id = 2;
  double confidence = 3;
  string reasoning = 4;
}
```

### Option D: Message Queue (Redis/RabbitMQ)

**Pros:**
- Async by default
- Can handle high load
- Built-in retry logic
- Multiple consumers

**Cons:**
- Additional infrastructure
- Overkill for single-request routing
- Higher complexity

### Recommendation: HTTP for MVP, IPC for Production

**Phase 1 (MVP):** HTTP/REST
- Easy to implement
- Easy to test
- Can be replaced later

**Phase 2 (Optimization):** Unix sockets or gRPC
- Lower latency
- Better for production
- Requires more engineering

---

## Implementation Strategies

### Strategy 1: Enhanced Heuristic Router (Python)

**Current TypeScript Logic:**
```typescript
private scoreModel(model, query, attachments, activeModels): number {
  let score = 50
  
  // Keyword matching
  if (isCodeQuery(query) && hasCodeCapability(model)) score += 30
  if (hasImages(attachments) && hasVision(model)) score += 40
  
  // Size heuristics
  if (isComplex(query) && isLarge(model)) score += 20
  
  // Loaded bonus
  if (isLoaded(model)) score += 20
  
  return score
}
```

**Enhanced Python Logic:**
```python
import numpy as np
from typing import List, Dict

class EnhancedHeuristicRouter:
    def __init__(self):
        self.weights = {
            'capability_match': 0.35,
            'model_size': 0.20,
            'context_fit': 0.15,
            'loaded_bonus': 0.20,
            'historical_perf': 0.10,
        }
    
    def score_model(self, model: Dict, query: str, 
                    context: Dict, history: List = None) -> float:
        scores = []
        
        # 1. Capability matching (vectorized)
        query_features = self.extract_query_features(query, context)
        model_features = self.extract_model_features(model)
        cap_score = np.dot(query_features, model_features)
        scores.append(cap_score * self.weights['capability_match'])
        
        # 2. Model size optimization
        complexity = self.estimate_complexity(query, context)
        size_score = self.size_fitness(model['param_count'], complexity)
        scores.append(size_score * self.weights['model_size'])
        
        # 3. Context window fit
        token_count = self.estimate_tokens(query, context['messages'])
        ctx_score = self.context_fit(model['context_window'], token_count)
        scores.append(ctx_score * self.weights['context_fit'])
        
        # 4. Loaded model bonus
        loaded_score = 1.0 if model['is_loaded'] else 0.0
        scores.append(loaded_score * self.weights['loaded_bonus'])
        
        # 5. Historical performance (NEW)
        if history:
            hist_score = self.get_historical_performance(model['id'], 
                                                         query_features)
            scores.append(hist_score * self.weights['historical_perf'])
        
        return np.sum(scores)
    
    def extract_query_features(self, query: str, context: Dict) -> np.ndarray:
        """Extract feature vector from query"""
        features = np.zeros(10)
        
        # Length features
        features[0] = min(len(query) / 1000, 1.0)
        
        # Content type features
        features[1] = 1.0 if self.has_code_patterns(query) else 0.0
        features[2] = 1.0 if context.get('has_images') else 0.0
        features[3] = 1.0 if self.has_math(query) else 0.0
        
        # Complexity features
        features[4] = self.measure_technical_density(query)
        features[5] = len(context.get('messages', [])) / 20.0  # conversation depth
        
        # Question type
        features[6] = 1.0 if query.startswith(('what', 'why', 'how')) else 0.0
        features[7] = 1.0 if '?' in query else 0.0
        
        # Urgency/creativity
        features[8] = self.measure_creativity_needed(query)
        features[9] = self.measure_precision_needed(query)
        
        return features
```

### Strategy 2: Embedding-Based Routing

**Concept:** Use semantic similarity to match queries to models

```python
from sentence_transformers import SentenceTransformer
import numpy as np

class EmbeddingRouter:
    def __init__(self, model_name='all-MiniLM-L6-v2'):
        self.encoder = SentenceTransformer(model_name)
        
        # Pre-compute model "expertise" embeddings
        self.model_embeddings = {
            'Qwen3-VL': self.encoder.encode([
                "visual analysis image understanding diagram recognition",
                "charts graphs data visualization",
                "screenshot analysis UI debugging",
            ]).mean(axis=0),
            
            'DeepSeek-Coder': self.encoder.encode([
                "python javascript code implementation algorithms",
                "debugging syntax errors stack traces",
                "function implementation class design",
            ]).mean(axis=0),
            
            'Llama-3.1': self.encoder.encode([
                "general conversation creative writing essays",
                "explanations summaries comprehension",
                "reasoning logic problem solving",
            ]).mean(axis=0),
        }
    
    def route(self, query: str, available_models: List[Dict]) -> str:
        # Encode query
        query_embedding = self.encoder.encode([query])[0]
        
        # Find best match
        best_model = None
        best_similarity = -1
        
        for model in available_models:
            if model['id'] not in self.model_embeddings:
                continue
            
            similarity = np.dot(query_embedding, 
                               self.model_embeddings[model['id']])
            similarity /= (np.linalg.norm(query_embedding) * 
                          np.linalg.norm(self.model_embeddings[model['id']]))
            
            # Bonus for loaded models
            if model['is_loaded']:
                similarity *= 1.2
            
            if similarity > best_similarity:
                best_similarity = similarity
                best_model = model
        
        return best_model['id'], best_similarity
```

### Strategy 3: LLM-Based Routing (Python)

**Concept:** Use a small, fast LLM to make routing decisions

```python
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch

class LLMRouter:
    def __init__(self, model_name='microsoft/Phi-3-mini-4k-instruct'):
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=torch.float16,
            device_map='auto'
        )
    
    def route(self, query: str, available_models: List[Dict]) -> Dict:
        # Build routing prompt
        prompt = self.build_routing_prompt(query, available_models)
        
        # Generate decision
        inputs = self.tokenizer(prompt, return_tensors='pt').to(self.model.device)
        
        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=100,
                temperature=0.1,  # Low temp for consistent routing
                do_sample=False,
            )
        
        response = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
        
        # Parse response
        decision = self.parse_decision(response, available_models)
        
        return decision
    
    def build_routing_prompt(self, query: str, models: List[Dict]) -> str:
        model_list = "\n".join([
            f"{i+1}. {m['id']} - {', '.join(m['capabilities'])} "
            f"({m.get('param_count', 'unknown')} params, "
            f"{'LOADED' if m['is_loaded'] else 'not loaded'})"
            for i, m in enumerate(models)
        ])
        
        return f"""<|system|>You are a model routing expert. Select the best model for the query.<|end|>
<|user|>
Query: "{query}"

Available models:
{model_list}

Which model (by number) is best for this query? Consider:
- Model capabilities (code, vision, reasoning)
- Model size vs query complexity
- Whether model is already loaded (prefer loaded if suitable)

Respond with: <number>|<brief reason>
Example: 2|Best for code tasks and already loaded
<|end|>
<|assistant|>"""
```

### Strategy 4: ML Classifier (Learn from History)

**Concept:** Train a classifier on routing history

```python
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
import joblib

class MLRouter:
    def __init__(self):
        self.vectorizer = TfidfVectorizer(max_features=100)
        self.classifier = RandomForestClassifier(n_estimators=100)
        self.is_trained = False
    
    def train_from_history(self, routing_history_df: pd.DataFrame):
        """
        Train from historical routing decisions
        
        routing_history_df columns:
        - query: str
        - selected_model: str
        - confidence: float
        - user_feedback: int (1=good, 0=neutral, -1=bad)
        - completion_time: float
        - error_occurred: bool
        """
        # Filter successful routes
        successful = routing_history_df[
            (routing_history_df['user_feedback'] >= 0) &
            (~routing_history_df['error_occurred'])
        ]
        
        # Feature extraction
        X = self.vectorizer.fit_transform(successful['query'])
        y = successful['selected_model']
        
        # Train
        self.classifier.fit(X, y)
        self.is_trained = True
        
        # Save
        joblib.dump(self.vectorizer, 'router_vectorizer.pkl')
        joblib.dump(self.classifier, 'router_classifier.pkl')
    
    def route(self, query: str, available_models: List[str]) -> Dict:
        if not self.is_trained:
            raise RuntimeError("Router not trained. Train with historical data first.")
        
        # Vectorize query
        X = self.vectorizer.transform([query])
        
        # Predict
        probas = self.classifier.predict_proba(X)[0]
        classes = self.classifier.classes_
        
        # Get top predictions in available models
        predictions = sorted(
            [(classes[i], probas[i]) for i in range(len(classes))
             if classes[i] in available_models],
            key=lambda x: x[1],
            reverse=True
        )
        
        if not predictions:
            # Fallback
            return {'model_id': available_models[0], 'confidence': 0.5}
        
        best_model, confidence = predictions[0]
        
        return {
            'model_id': best_model,
            'confidence': float(confidence),
            'reasoning': f'ML classifier prediction (confidence: {confidence:.2f})',
            'alternatives': predictions[1:3],  # Top 2 alternatives
        }
    
    def load(self):
        """Load trained model"""
        self.vectorizer = joblib.load('router_vectorizer.pkl')
        self.classifier = joblib.load('router_classifier.pkl')
        self.is_trained = True
```

---

## Performance Considerations

### Latency Analysis

#### Current TypeScript Router
```
User Input
    ↓  0ms
Router.route() call
    ↓  <1ms (in-process)
Strategy scoring
    ↓  1-3ms (JavaScript execution)
Decision returned
    ↓  0ms (synchronous)
TOTAL: ~5ms
```

#### Python Microservice (HTTP)
```
User Input
    ↓  0ms
TypeScript bridge
    ↓  1ms (JSON serialization)
HTTP request
    ↓  2-5ms (TCP handshake, request)
Python processing
    ↓  5-50ms (depends on strategy)
HTTP response
    ↓  2-5ms (TCP)
JSON deserialization
    ↓  1ms
TOTAL: ~15-65ms
```

#### Python Microservice (Unix Socket)
```
User Input
    ↓  0ms
TypeScript bridge
    ↓  1ms
Unix socket write
    ↓  <1ms
Python processing
    ↓  5-50ms
Unix socket read
    ↓  <1ms
TOTAL: ~10-55ms
```

### Optimization Strategies

#### 1. Connection Pooling
```python
# Keep connection warm
class RouterClient:
    def __init__(self):
        self.session = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(
                limit=10,
                keepalive_timeout=30,
            )
        )
    
    async def route(self, context):
        # Reuse connection
        async with self.session.post(url, json=context) as resp:
            return await resp.json()
```

#### 2. Request Batching
```python
# Batch multiple routing requests
async def route_batch(requests: List[RouteRequest]) -> List[RouteResponse]:
    # Process multiple routes in parallel
    results = await asyncio.gather(*[
        route_single(req) for req in requests
    ])
    return results
```

#### 3. Caching
```python
from functools import lru_cache
import hashlib

class CachedRouter:
    def __init__(self):
        self.cache = {}
        self.cache_ttl = 300  # 5 minutes
    
    def route(self, query: str, models: List) -> Dict:
        # Cache key from query + available models
        cache_key = hashlib.md5(
            f"{query}:{sorted([m['id'] for m in models])}".encode()
        ).hexdigest()
        
        if cache_key in self.cache:
            cached_result, timestamp = self.cache[cache_key]
            if time.time() - timestamp < self.cache_ttl:
                return cached_result
        
        # Route
        result = self.do_route(query, models)
        
        # Cache
        self.cache[cache_key] = (result, time.time())
        
        return result
```

#### 4. Lazy Model Loading
```python
class LazyRouter:
    def __init__(self):
        self._embedding_model = None
        self._llm_model = None
    
    @property
    def embedding_model(self):
        if self._embedding_model is None:
            self._embedding_model = SentenceTransformer('...')
        return self._embedding_model
    
    # Only load models when needed
```

### Resource Usage

| Strategy | Memory | CPU | Latency | Accuracy |
|----------|--------|-----|---------|----------|
| Heuristic (TS) | ~10 MB | Low | ~5ms | Medium |
| Heuristic (Py) | ~50 MB | Low | ~15ms | Medium-High |
| Embedding | ~200 MB | Medium | ~30ms | High |
| LLM (Phi-3) | ~2 GB | High | ~100ms | Very High |
| ML Classifier | ~100 MB | Low | ~20ms | High (after training) |

---

## Migration Roadmap

### Phase 1: Foundation (Week 1-2)

**Goals:**
- Python service skeleton
- HTTP API
- Bridge TypeScript extension
- Basic heuristic strategy (parity with TS)

**Deliverables:**
```
router-service/
├── __init__.py
├── main.py                 # FastAPI app
├── models.py               # Pydantic models
├── router.py               # Router core logic
└── strategies/
    ├── __init__.py
    └── heuristic.py        # Port from TS
```

**Success Criteria:**
- Python service starts successfully
- TypeScript can communicate via HTTP
- Routing parity with current implementation
- Latency <50ms for simple queries

### Phase 2: Enhanced Strategies (Week 3-4)

**Goals:**
- Embedding-based routing
- Improved heuristics with numpy
- Analytics logging

**Deliverables:**
```
strategies/
├── embedding.py            # Semantic similarity
├── enhanced_heuristic.py   # Numpy-based scoring
└── hybrid.py               # Combine multiple strategies

analytics/
├── logger.py               # Log routing decisions
└── metrics.py              # Performance metrics
```

**Success Criteria:**
- Embedding router works for vision queries
- 20% improvement in routing accuracy
- Analytics database populated

### Phase 3: LLM Routing (Week 5-6)

**Goals:**
- Implement LLM-based routing
- Optimize inference speed
- Compare against heuristics

**Deliverables:**
```
strategies/
└── llm.py                  # Phi-3/Qwen router

models/
├── phi3-mini/              # Quantized routing model
└── model_loader.py         # Lazy loading
```

**Success Criteria:**
- LLM routing accuracy >90%
- Latency <100ms
- Graceful fallback if model unavailable

### Phase 4: Learning System (Week 7-8)

**Goals:**
- Collect routing history
- Train ML classifier
- A/B testing framework

**Deliverables:**
```
learning/
├── collector.py            # Collect routing decisions
├── trainer.py              # Train classifier
└── feedback.py             # User feedback integration

database/
├── schema.sql              # Routing history
└── migrations/             # Database migrations
```

**Success Criteria:**
- Routing history collected
- ML classifier trained with 1000+ samples
- Classifier accuracy >85%

### Phase 5: Production Ready (Week 9-10)

**Goals:**
- IPC optimization
- Error handling
- Monitoring
- Documentation

**Deliverables:**
```
- IPC socket implementation
- Healthchecks
- Prometheus metrics
- Comprehensive docs
- Docker container
```

**Success Criteria:**
- Latency <30ms (Unix socket)
- 99.9% uptime
- Full documentation
- Production deployment guide

---

## Risk Analysis

### Technical Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **High Latency** | High | Use Unix sockets, implement caching, lazy loading |
| **Process Crashes** | Medium | Auto-restart, health checks, fallback to TS |
| **Memory Leaks** | Medium | Monitoring, periodic restarts, proper cleanup |
| **Dependency Conflicts** | Low | Virtual env, Docker, pinned versions |
| **State Sync Issues** | Medium | Stateless design, idempotent operations |

### Operational Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Deployment Complexity** | High | Docker, single binary, auto-installer |
| **Python Runtime** | Medium | Bundle Python, use PyInstaller |
| **Cross-Platform** | Medium | Test on Mac/Windows/Linux, CI/CD |
| **Debugging Difficulty** | Medium | Structured logging, request tracing |

### Rollback Strategy

1. **Feature Flag**: Keep TypeScript router as fallback
```typescript
const USE_PYTHON_ROUTER = localStorage.getItem('use_python_router') === 'true'

if (USE_PYTHON_ROUTER && pythonRouterAvailable()) {
  decision = await pythonRouter.route(context)
} else {
  decision = await typescriptRouter.route(context)
}
```

2. **Gradual Rollout**: Enable for % of users
```python
def should_use_python_router(user_id: str) -> bool:
    # Hash user ID and use modulo for percentage
    hash_val = int(hashlib.md5(user_id.encode()).hexdigest(), 16)
    return (hash_val % 100) < PYTHON_ROUTER_PERCENTAGE  # Start with 10%
```

3. **A/B Testing**: Compare side-by-side
```python
async def route_with_comparison(context):
    ts_decision, py_decision = await asyncio.gather(
        typescript_router.route(context),
        python_router.route(context)
    )
    
    # Log differences
    if ts_decision['model_id'] != py_decision['model_id']:
        log_routing_divergence(context, ts_decision, py_decision)
    
    # Use Python decision
    return py_decision
```

---

## Technology Stack

### Python Service

**Core:**
- **Python 3.11+** (Latest features, performance)
- **FastAPI** (High-performance async web framework)
- **Pydantic** (Data validation, settings management)
- **uvicorn** (ASGI server)

**ML/AI:**
- **sentence-transformers** (Embedding-based routing)
- **transformers** (HuggingFace models)
- **torch** (PyTorch for LLM inference)
- **scikit-learn** (ML classifier)
- **numpy** (Numerical operations)
- **pandas** (Data analysis)

**Data Storage:**
- **SQLite** (Routing history, lightweight)
- **Redis** (Optional: caching, queuing)

**Monitoring:**
- **prometheus-client** (Metrics)
- **structlog** (Structured logging)

**Packaging:**
- **Poetry** (Dependency management)
- **Docker** (Containerization)
- **PyInstaller** (Optional: standalone binary)

### TypeScript Bridge

**Minimal TypeScript adapter:**
```typescript
// router-bridge/src/PythonRouterBridge.ts
import { ModelRouterExtension, RouteContext, RouteDecision } from '@janhq/core'

export class PythonRouterBridge extends ModelRouterExtension {
  private serviceUrl: string
  private fallbackRouter: HeuristicRouter
  
  constructor() {
    super(...)
    this.serviceUrl = 'http://localhost:8765'
    this.fallbackRouter = new HeuristicRouter()
  }
  
  async route(context: RouteContext): Promise<RouteDecision> {
    try {
      const response = await fetch(`${this.serviceUrl}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
        signal: AbortSignal.timeout(5000), // 5s timeout
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      
      return await response.json()
    } catch (error) {
      console.error('[PythonRouter] Failed, using fallback:', error)
      // Fallback to TypeScript heuristic
      return this.fallbackRouter.route(context)
    }
  }
}
```

---

## Code Examples

### Complete Python Service (MVP)

```python
# main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict
import uvicorn

app = FastAPI(title="Jan Router Service")

# Models
class Message(BaseModel):
    role: str
    content: str

class AvailableModel(BaseModel):
    id: str
    provider_id: str
    capabilities: List[str]
    metadata: Dict

class RouteRequest(BaseModel):
    messages: List[Message]
    thread_id: Optional[str] = None
    available_models: List[AvailableModel]
    active_models: List[str]
    attachments: Optional[Dict] = None
    preferences: Optional[Dict] = None

class RouteResponse(BaseModel):
    model_id: str
    provider_id: str
    confidence: float
    reasoning: str
    metadata: Dict = {}

# Router implementation
from strategies.heuristic import HeuristicRouter

router = HeuristicRouter()

@app.post("/route", response_model=RouteResponse)
async def route(request: RouteRequest):
    """Route a query to the best model"""
    try:
        decision = router.route(request)
        return decision
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {"status": "healthy", "version": "1.0.0"}

@app.get("/strategies")
async def list_strategies():
    return {
        "strategies": [
            {"name": "heuristic", "description": "Rule-based routing"},
            {"name": "embedding", "description": "Semantic similarity"},
            {"name": "llm", "description": "LLM-based routing"},
        ]
    }

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)
```

```python
# strategies/heuristic.py
import numpy as np
from typing import List, Dict

class HeuristicRouter:
    def route(self, request) -> Dict:
        query = request.messages[-1].content if request.messages else ""
        models = request.available_models
        active = request.active_models
        attachments = request.attachments or {}
        
        # Score each model
        scores = []
        for model in models:
            score = self.score_model(model, query, attachments, active)
            scores.append({
                'model': model,
                'score': score
            })
        
        # Sort by score
        scores.sort(key=lambda x: x['score'], reverse=True)
        best = scores[0]
        
        return {
            'model_id': best['model'].id,
            'provider_id': best['model'].provider_id,
            'confidence': min(best['score'] / 100, 1.0),
            'reasoning': self.explain(best['model'], query, attachments),
            'metadata': {
                'all_scores': [
                    {'id': s['model'].id, 'score': s['score']} 
                    for s in scores
                ],
                'strategy': 'heuristic'
            }
        }
    
    def score_model(self, model, query: str, attachments: Dict, 
                    active: List[str]) -> float:
        score = 50.0
        query_lower = query.lower()
        
        # Capability matching
        if self.is_code_query(query_lower) and 'code' in model.capabilities:
            score += 30
        
        if attachments.get('images', 0) > 0 and 'vision' in model.capabilities:
            score += 40
        
        if self.is_reasoning_query(query_lower) and 'reasoning' in model.capabilities:
            score += 25
        
        # Loaded bonus
        if model.metadata.get('isLoaded') or model.id in active:
            score += 20
        
        # Size heuristics
        params = self.extract_param_count(model.metadata.get('parameterCount', ''))
        if self.is_complex_query(query):
            score += min(params / 10, 20)  # Favor larger for complex
        else:
            score += max(20 - params / 5, 0)  # Favor smaller for simple
        
        return score
    
    def is_code_query(self, query: str) -> bool:
        keywords = ['code', 'function', 'class', 'debug', 'implement', 
                   'algorithm', 'def', 'return', 'import']
        return any(kw in query for kw in keywords)
    
    def is_reasoning_query(self, query: str) -> bool:
        keywords = ['why', 'explain', 'analyze', 'compare', 'evaluate']
        return any(query.startswith(kw) for kw in keywords)
    
    def is_complex_query(self, query: str) -> bool:
        return len(query) > 500 or query.count('?') > 2
    
    def extract_param_count(self, param_str: str) -> int:
        import re
        match = re.search(r'(\d+)B', param_str)
        return int(match.group(1)) if match else 0
    
    def explain(self, model, query: str, attachments: Dict) -> str:
        reasons = []
        
        if self.is_code_query(query.lower()) and 'code' in model.capabilities:
            reasons.append("query involves coding")
        
        if attachments.get('images', 0) > 0 and 'vision' in model.capabilities:
            reasons.append("query includes images")
        
        if model.metadata.get('isLoaded'):
            reasons.append("model already loaded")
        
        return f"Selected {model.id} because: {', '.join(reasons) or 'best match'}"
```

### Docker Deployment

```dockerfile
# Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Expose port
EXPOSE 8765

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import requests; requests.get('http://localhost:8765/health')"

# Run
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  router:
    build: .
    ports:
      - "8765:8765"
    environment:
      - LOG_LEVEL=info
    volumes:
      - router-data:/app/data
    restart: unless-stopped
    
volumes:
  router-data:
```

---

## Conclusion

### Recommended Approach

**Phase 1: Hybrid Architecture (Recommended)**
1. Keep TypeScript heuristic router as default (fast path)
2. Add Python service for advanced routing (smart path)
3. Use feature flags to gradually migrate users
4. Collect comparison data (TypeScript vs Python decisions)

**Why Hybrid?**
- ✅ Zero risk: TypeScript fallback always available
- ✅ Best of both: Speed when simple, intelligence when complex
- ✅ Gradual migration: Can A/B test thoroughly
- ✅ Learn from data: Collect routing decisions to improve
- ✅ Future-proof: Can add more strategies without breaking existing

### Success Metrics

1. **Performance**: Latency <50ms for 95th percentile
2. **Accuracy**: 90%+ user satisfaction with routing decisions
3. **Reliability**: 99.9% uptime, graceful degradation
4. **Adoption**: 80%+ of queries use Python router within 3 months

### Next Steps

1. **Proof of Concept** (1 week)
   - Basic Python FastAPI service
   - TypeScript bridge with fallback
   - HTTP communication
   - Deploy locally, test latency

2. **Evaluation** (1 week)
   - Compare routing decisions (TS vs Py)
   - Measure latency in real usage
   - Gather user feedback
   - Decide on full migration vs hybrid

3. **Production** (6-8 weeks)
   - Follow migration roadmap above
   - Implement all strategies
   - Add monitoring and alerts
   - Full documentation

---

**Document Status:** Draft for Review  
**Last Updated:** November 23, 2025  
**Next Review:** After POC completion
