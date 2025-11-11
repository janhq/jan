# PHASE 5: RAG Sistemi (Retrieval-Augmented Generation)

## 🎯 Amaç
Kullanıcıların döküman yükleyerek (PDF, TXT, MD, DOCX) AI'dan bu dökümanlar üzerinden soru sorabilmesi ve contextual yanıtlar alabilmesi.

## 📋 Özellikler
1. ✅ Document Upload (PDF, TXT, MD, DOCX, CSV)
2. ✅ Document Parsing ve Chunking
3. ✅ Vector Embedding Generation
4. ✅ Vector Database Integration (ChromaDB/FAISS)
5. ✅ Semantic Search
6. ✅ RAG-Enhanced Chat
7. ✅ Source Citation
8. ✅ Document Management UI

---

## 🏗️ Mimari Yapı

### 1. Document Types

**Dosya:** `core/src/types/rag/document.ts` (YENİ)
```typescript
export type Document = {
  id: string
  name: string
  type: 'pdf' | 'txt' | 'md' | 'docx' | 'csv' | 'json'
  path: string
  size: number
  uploadedAt: number
  processedAt?: number
  status: 'uploading' | 'processing' | 'ready' | 'error'
  metadata: {
    pageCount?: number
    wordCount?: number
    language?: string
    author?: string
  }
  chunks: DocumentChunk[]
  embedding?: {
    model: string
    dimension: number
    indexed: boolean
  }
}

export type DocumentChunk = {
  id: string
  documentId: string
  content: string
  index: number
  pageNumber?: number
  metadata: Record<string, any>
  embedding?: number[]
}

export type RAGQuery = {
  query: string
  topK: number              // Number of chunks to retrieve
  scoreThreshold: number    // Minimum similarity score
  filters?: {
    documentIds?: string[]
    dateRange?: { start: number, end: number }
    metadata?: Record<string, any>
  }
}

export type RAGResult = {
  chunks: Array<{
    chunk: DocumentChunk
    score: number
    document: Document
  }>
  query: string
  retrievalTime: number
}
```

---

### 2. RAG Extension

**Dosya:** `core/src/browser/extensions/rag.ts` (GÜNCELLENECEK - mevcut var, genişlet)
```typescript
export abstract class RAGExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.RAG
  }

  // Document Management
  abstract uploadDocument(file: File): Promise<Document>
  abstract deleteDocument(documentId: string): Promise<void>
  abstract listDocuments(): Promise<Document[]>
  abstract getDocument(documentId: string): Promise<Document>

  // Processing
  abstract processDocument(documentId: string): Promise<void>
  abstract chunkDocument(content: string, options?: ChunkingOptions): DocumentChunk[]

  // Embedding
  abstract generateEmbeddings(chunks: DocumentChunk[]): Promise<void>
  abstract indexChunks(chunks: DocumentChunk[]): Promise<void>

  // Search
  abstract search(query: RAGQuery): Promise<RAGResult>
  abstract similaritySearch(embedding: number[], topK: number): Promise<DocumentChunk[]>

  // RAG Inference
  abstract ragInference(
    message: string,
    ragResult: RAGResult,
    model: ModelInfo
  ): Promise<ThreadMessage>
}
```

---

### 3. Document Processing Pipeline

**Dosya:** `extensions/rag-extension/src/processors/` (GENIŞLET)

#### PDF Processor
```typescript
// pdf-processor.ts
export class PDFProcessor {
  async parse(file: File): Promise<{ content: string, metadata: any }> {
    // Use pdf-parse or pdfjs-dist
    // Extract text, images (OCR if needed)
    // Preserve structure (headers, paragraphs)
  }
}
```

#### Text Chunking
```typescript
// text-chunker.ts
export class TextChunker {
  chunk(
    content: string,
    options: {
      chunkSize: number         // 512 tokens default
      chunkOverlap: number      // 50 tokens default
      separators: string[]      // ['\n\n', '\n', '. ', ' ']
    }
  ): DocumentChunk[] {
    // Semantic chunking (preserve sentence/paragraph boundaries)
    // Overlapping for context continuity
    // Return chunks with metadata
  }
}
```

#### Embedding Generator
```typescript
// embedding-generator.ts
export class EmbeddingGenerator {
  async generate(text: string): Promise<number[]> {
    // Use local embedding model (e.g., all-MiniLM-L6-v2)
    // Or API-based (OpenAI embeddings, Cohere)
    // Return 384/768/1536 dimensional vector
  }

  async generateBatch(texts: string[]): Promise<number[][]> {
    // Batch processing for efficiency
  }
}
```

---

### 4. Vector Database

**Dosya:** `extensions/rag-extension/src/vector-db/` (YENİ)

#### Vector Store Interface
```typescript
export interface VectorStore {
  // Initialize
  initialize(config: VectorStoreConfig): Promise<void>

  // Insert
  addDocuments(chunks: DocumentChunk[]): Promise<void>

  // Search
  similaritySearch(
    query: string | number[],
    topK: number,
    filter?: Record<string, any>
  ): Promise<Array<{ chunk: DocumentChunk, score: number }>>

  // Delete
  deleteDocument(documentId: string): Promise<void>

  // Stats
  getStats(): Promise<{ totalDocuments: number, totalChunks: number }>
}
```

#### ChromaDB Implementation (Önerilen)
```typescript
// chroma-store.ts
export class ChromaVectorStore implements VectorStore {
  private client: ChromaClient

  async initialize(config: VectorStoreConfig): Promise<void> {
    this.client = new ChromaClient({
      path: config.dbPath || '.leah/vector-db'
    })
  }

  // ... implementation
}
```

---

### 5. UI Components

#### Document Upload Area
**Dosya:** `web-app/src/routes/rag/upload.tsx` (YENİ)
```typescript
export function DocumentUpload() {
  return (
    <div className="upload-area">
      <DropZone
        accept=".pdf,.txt,.md,.docx,.csv"
        maxSize={50 * 1024 * 1024}  // 50MB
        onDrop={handleUpload}
      />

      <DocumentList
        documents={documents}
        onDelete={deleteDocument}
        onProcess={reprocessDocument}
      />
    </div>
  )
}
```

#### RAG Chat Interface
**Dosya:** `web-app/src/components/rag/RAGChatInput.tsx` (YENİ)
```typescript
export function RAGChatInput() {
  return (
    <div className="rag-chat-input">
      {/* Document selector */}
      <MultiSelect
        label="Select documents to query"
        options={documents}
        value={selectedDocs}
        onChange={setSelectedDocs}
      />

      {/* RAG settings */}
      <Popover>
        <PopoverTrigger>RAG Settings</PopoverTrigger>
        <PopoverContent>
          <Label>Top K Results: {topK}</Label>
          <Slider value={topK} onChange={setTopK} min={1} max={20} />

          <Label>Score Threshold: {threshold}</Label>
          <Slider value={threshold} onChange={setThreshold} min={0} max={1} step={0.05} />
        </PopoverContent>
      </Popover>

      {/* Message input */}
      <Textarea
        placeholder="Ask a question about your documents..."
        value={message}
        onChange={e => setMessage(e.target.value)}
      />

      <Button onClick={sendRAGQuery}>Send</Button>
    </div>
  )
}
```

#### Source Citation Display
**Dosya:** `web-app/src/components/rag/SourceCitation.tsx` (YENİ)
```typescript
export function SourceCitation({ sources }: { sources: RAGResult['chunks'] }) {
  return (
    <div className="source-citations">
      <h4>Sources:</h4>
      {sources.map((source, idx) => (
        <Card key={source.chunk.id} className="source-card">
          <CardHeader>
            <Badge>[{idx + 1}]</Badge>
            <span>{source.document.name}</span>
            {source.chunk.pageNumber && (
              <span>Page {source.chunk.pageNumber}</span>
            )}
            <Badge variant="secondary">
              Score: {(source.score * 100).toFixed(1)}%
            </Badge>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted">
              {source.chunk.content.substring(0, 200)}...
            </p>
          </CardContent>
          <CardFooter>
            <Button size="sm" onClick={() => viewFullChunk(source.chunk)}>
              View Full Context
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
```

#### Document Viewer
**Dosya:** `web-app/src/components/rag/DocumentViewer.tsx` (YENİ)
```typescript
export function DocumentViewer({ document }: { document: Document }) {
  // PDF: render with react-pdf
  // Text: simple text viewer with syntax highlighting
  // MD: render with react-markdown
  // Highlight relevant chunks when coming from search

  return <div className="document-viewer">...</div>
}
```

---

## 📁 Yeni/Güncellenecek Dosyalar

### YENİ DOSYALAR
1. `core/src/types/rag/document.ts` - Document types
2. `extensions/rag-extension/src/processors/pdf-processor.ts`
3. `extensions/rag-extension/src/processors/text-chunker.ts`
4. `extensions/rag-extension/src/processors/embedding-generator.ts`
5. `extensions/rag-extension/src/vector-db/vector-store.ts`
6. `extensions/rag-extension/src/vector-db/chroma-store.ts`
7. `web-app/src/routes/rag/upload.tsx`
8. `web-app/src/routes/rag/documents.tsx`
9. `web-app/src/components/rag/RAGChatInput.tsx`
10. `web-app/src/components/rag/SourceCitation.tsx`
11. `web-app/src/components/rag/DocumentViewer.tsx`
12. `web-app/src/components/rag/DocumentList.tsx`
13. `web-app/src/hooks/useRAG.ts`
14. `web-app/src/services/rag/index.ts`

### GÜNCELLENECEK
1. `core/src/browser/extensions/rag.ts` - Genişlet
2. `extensions/rag-extension/src/index.ts` - Yeni metotlar ekle
3. `web-app/src/routes/thread/$threadId/index.tsx` - RAG toggle ekle

---

## 🔄 İş Akışı

### 1. Document Upload & Processing
```
User uploads PDF
→ Store file locally
→ Extract text (pdf-parse)
→ Chunk text (512 token chunks, 50 overlap)
→ Generate embeddings (all-MiniLM-L6-v2)
→ Index in vector DB (ChromaDB)
→ Mark document as "ready"
→ Show success notification
```

### 2. RAG Query Flow
```
User asks: "What are the key findings?"
→ Select relevant documents
→ Generate query embedding
→ Vector similarity search (top 5 chunks)
→ Retrieve chunks with scores > 0.7
→ Construct prompt:
   ```
   Context from documents:
   [1] {chunk1.content}
   [2] {chunk2.content}
   ...

   Question: {user_question}

   Answer based on the context above. Cite sources using [1], [2], etc.
   ```
→ Send to LLM
→ Stream response with citations
→ Display sources below response
```

---

## ⚡ Performans Optimizasyonları

1. **Chunking:** Paralel processing için worker threads
2. **Embedding:** Batch API calls (max 100 chunks per batch)
3. **Vector Search:** Index optimization, ANN algorithms
4. **Caching:** Cache frequent queries (LRU cache)
5. **Streaming:** Stream chunks as they're processed

---

## 🔗 Dependencies

### NPM Packages
```json
{
  "dependencies": {
    "pdf-parse": "^1.1.1",           // PDF parsing
    "mammoth": "^1.6.0",             // DOCX parsing
    "chromadb": "^1.7.0",            // Vector DB
    "@xenova/transformers": "^2.10.0", // Local embeddings
    "langchain": "^0.1.20",          // RAG utilities
    "papaparse": "^5.4.1",           // CSV parsing
    "react-pdf": "^7.7.0"            // PDF viewer
  }
}
```

---

## 🧪 Test Planı

### Unit Tests
- [ ] PDF parsing accuracy
- [ ] Text chunking overlap
- [ ] Embedding generation
- [ ] Vector search relevance

### Integration Tests
- [ ] End-to-end upload & query
- [ ] Multi-document search
- [ ] Source citation accuracy

---

## 📊 Başarı Kriterleri

1. ✅ PDF processing < 5s per MB
2. ✅ Chunking < 1s per 10k words
3. ✅ Embedding generation < 100ms per chunk
4. ✅ Vector search < 200ms
5. ✅ RAG query < 3s total
6. ✅ Source citation accuracy > 90%

---

## 🚀 Implementation: 12-14 gün

1. **Gün 1-2:** Document types, parsing (PDF, TXT, MD)
2. **Gün 3-4:** Text chunking ve overlap logic
3. **Gün 5-6:** Embedding generation (local model integration)
4. **Gün 7-8:** Vector DB setup (ChromaDB)
5. **Gün 9-10:** RAG inference logic
6. **Gün 11-12:** UI components (upload, chat, citations)
7. **Gün 13-14:** Testing ve optimization

---

## ⚠️ Dikkat Edilecekler

1. **Privacy:** Documents never leave local machine
2. **Storage:** Vector DB stored in .leah/vector-db
3. **Memory:** Limit concurrent processing (max 3 docs)
4. **Accuracy:** Test with various document formats
5. **Context Length:** Respect model's max tokens
6. **Source Truth:** Always show source for verification

---

## 🎯 Next Phase: Phase 6 - Prompt Templates Library
