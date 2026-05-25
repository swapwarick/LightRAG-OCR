# LightRAG-OCR

A local-first, high-performance RAG (Retrieval-Augmented Generation) pipeline that fuses scanned document OCR with semantic vector indexing. Equipped with a custom glassmorphism web dashboard, this system facilitates drag-and-drop ingestion, real-time pipeline log streaming, vector collection management, and semantic similarity search queries.

---

## ⚡ Core Engine & Pro Features

This repository implements a lightweight, fully self-contained RAG stack designed for speed, privacy, and low-resource environments.

*   **Zero-Dependency Cloud Privacy**: Runs completely locally. No external APIs, API keys, or SaaS platforms are invoked. Your documents never leave your physical machine.
*   **SSE Logging Pipe (Sub-100ms Latency)**: Built using Server-Sent Events (SSE) `/api/logs-stream`. Instead of opaque file uploads, the backend streams raw console telemetry (weight initializations, word counts, and ChromaDB transaction batches) directly into the UI log terminal.
*   **High-Speed Model Caching**: Memory-optimized Python runtime caches loaded model reader instances. Changing configurations does not trigger cold starts; subsequent uploads leverage warm CUDA weight states.
*   **Sliding-Window Semantic Chunking**: Implements a configurable word-based chunker with sliding overlaps. This ensures contextual boundaries are preserved across paragraph breaks, preventing information loss near chunk edges.
*   **Scored Relevance Visualization**: Queries return raw vector distance scores mapped directly to intuitive percentage bars, enabling rapid verification of semantic query alignments.
*   **Unified Analytics Dashboard**: Custom Chart.js integrations map document categories, chunk frequency charts, global character weights, and average query similarity rates dynamically.

---

## 🏛️ System Architecture

The pipeline processes input through a series of decoupled stages:

```
[Document Ingestion]
         │  (PNG, JPG, TIFF, PDF)
         ▼
 ┌───────────────┐
 │  EasyOCR Engine│  ◄── GPU/CUDA Accelerated Text Extraction
 └───────┬───────┘
         │  (Raw Text Strings)
         ▼
 ┌───────────────┐
 │ Word Chunker  │  ◄── Configurable Size & Sliding Window Overlap
 └───────┬───────┘
         │  (Semantic Segments)
         ▼
 ┌───────────────┐
 │ Embedding Pipe│  ◄── Vectorization via sentence-transformers (all-MiniLM-L6-v2)
 └───────┬───────┘
         │  (384-Dimension Float Vectors)
         ▼
 ┌───────────────┐
 │  ChromaDB DB  │  ◄── Persistent SQLite-backed Local Vector Store
 └───────────────┘
```

---

## 🙌 Deep Appreciation to EasyOCR

This system relies on the incredible work done by the **JaidedAI** team on [EasyOCR](https://github.com/JaidedAI/EasyOCR). 

Extracting characters cleanly from low-quality scans, invoices, and receipts is traditionally a major bottleneck in document pipelines. EasyOCR provides outstanding localization and recognition capabilities out of the box. By leveraging PyTorch under the hood, it achieves blistering inference speeds on consumer NVIDIA cards while preserving deep multi-language coverage (Hindi, French, German, Chinese, and 80+ others) without requiring bulky commercial setups.

---

## 🔧 Installation & Setup

Ensure Python 3.8+ is installed on your workstation.

### 1. Clone the Workspace
```bash
git clone https://github.com/swapwarick/LightRAG-OCR.git
cd LightRAG-OCR
```

### 2. Install Core Dependencies
Install the required packages using pip:
```bash
pip install flask flask-cors easyocr chromadb sentence-transformers requests
```

*Note for GPU Acceleration: If you have an NVIDIA GPU, verify that your PyTorch installation is compiled with CUDA support for best OCR extraction and vector calculation performance:*
```bash
python -c "import torch; print('CUDA Available:', torch.cuda.is_available())"
```

---

## 💻 Operational Guide

The pipeline can be executed as a headless CLI script or hosted as a full interactive server.

### Option A: Launch Interactive Dashboard (Recommended)
Launch the Flask backend server:
```bash
python server.py
```
*Note: The script automatically overrides the console stdout/stderr streams to UTF-8 on startup. This prevents terminal progress bar formatting crashes on Windows command shells.*

Once the server initializes, launch the interface in your browser:
👉 **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

### Option B: Run Standalone Pipeline Script
To execute a headless evaluation on a single sample image (`invoice_sample.png`):
```bash
python document_ocr_rag.py
```

---

## 🔌 API Reference

| Endpoint | Method | Payload | Function |
| :--- | :--- | :--- | :--- |
| `GET /` | `GET` | None | Serves the glassmorphic static dashboard |
| `POST /api/upload` | `POST` | `multipart/form-data` (file, chunkSize, overlap, languages) | Runs EasyOCR, chunks raw string, inserts embeddings |
| `GET /api/logs-stream` | `GET` | EventSource Stream | Channels SSE engine execution logs in real-time |
| `GET /api/documents` | `GET` | None | Lists unique files, total characters, and distinct chunks |
| `DELETE /api/documents/<name>`| `DELETE`| None | Deletes specified document and deletes matching vector keys |
| `POST /api/search` | `POST` | `application/json` (query, k) | Runs semantic search against local database |
| `GET /api/stats` | `GET` | None | Evaluates global indexes, query lists, and average scores |

---

## 📜 License
Distributed under the MIT License. See `LICENSE` for further details.
