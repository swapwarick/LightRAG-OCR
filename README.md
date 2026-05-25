# LightRAG-OCR

A local-first, high-performance RAG (Retrieval-Augmented Generation) pipeline that fuses scanned document OCR with semantic vector indexing. Comes with a full-featured web dashboard for drag-and-drop ingestion, real-time pipeline log streaming, vector collection management, and semantic similarity search.

---

## ⚡ Features

- **100% Local & Private** — No external APIs or cloud services. Documents never leave your machine.
- **Real-Time SSE Logging** — Backend streams raw pipeline telemetry directly into the dashboard terminal.
- **GPU Accelerated OCR** — EasyOCR runs on CUDA (falls back to CPU automatically).
- **Sliding-Window Chunking** — Configurable word-based chunker with overlap to preserve context at boundaries.
- **Semantic Search** — Cosine similarity search via ChromaDB + sentence-transformers.
- **Live Dashboard** — Light/dark theme, server health indicator, analytics, and document management.

---

## 🏛️ System Architecture

```
[Document Ingestion]
         │  (PNG, JPG, TIFF, PDF, TXT)
         ▼
 ┌───────────────────┐
 │   EasyOCR Engine  │  ◄── GPU/CUDA Accelerated Text Extraction
 └────────┬──────────┘
          │  (Raw Text)
          ▼
 ┌───────────────────┐
 │   Word Chunker    │  ◄── Configurable Size & Sliding Window Overlap
 └────────┬──────────┘
          │  (Semantic Segments)
          ▼
 ┌───────────────────┐
 │  Embedding Pipe   │  ◄── sentence-transformers (all-MiniLM-L6-v2)
 └────────┬──────────┘
          │  (384-dim Float Vectors)
          ▼
 ┌───────────────────┐
 │    ChromaDB       │  ◄── Persistent SQLite-backed Local Vector Store
 └───────────────────┘
```

---

## 🔧 Installation & Setup

### Prerequisites

- **Python 3.8+** — [Download here](https://www.python.org/downloads/)
- **Git** — [Download here](https://git-scm.com/)
- *(Optional)* NVIDIA GPU with CUDA for faster OCR

---

### Step 1 — Clone the Repository

```bash
git clone https://github.com/swapwarick/LightRAG-OCR.git
cd LightRAG-OCR
```

---

### Step 2 — Create a Python Virtual Environment

**Windows (Command Prompt / PowerShell):**
```bash
python -m venv venv
```

**macOS / Linux:**
```bash
python3 -m venv venv
```

---

### Step 3 — Activate the Virtual Environment

**Windows (PowerShell):**
```powershell
.\venv\Scripts\Activate.ps1
```

**Windows (Command Prompt):**
```cmd
venv\Scripts\activate.bat
```

**macOS / Linux:**
```bash
source venv/bin/activate
```

> You should see `(venv)` at the start of your terminal prompt once activated.

---

### Step 4 — Install Dependencies

```bash
pip install flask flask-cors easyocr chromadb sentence-transformers
```

> **First run note:** EasyOCR will automatically download its model weights (~200 MB) on the first upload. This is a one-time download cached locally.

---

### Step 5 — (Optional) Verify GPU / CUDA Support

If you have an NVIDIA GPU, confirm PyTorch can see it:

```bash
python -c "import torch; print('CUDA Available:', torch.cuda.is_available())"
```

If `False`, install the CUDA-enabled PyTorch build from [pytorch.org](https://pytorch.org/get-started/locally/) for your CUDA version, e.g.:

```bash
# CUDA 11.8 example
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# CUDA 12.1 example
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

Re-run the check after installing.

---

## 🚀 Running the Server

### Start the Flask Backend

```bash
python server.py
```

You should see:

```
==================================================
[*] OCR PIPELINE DASHBOARD IS RUNNING!
[-] Open http://127.0.0.1:5000 in your browser
==================================================
```

### Open the Dashboard

Navigate to **[http://127.0.0.1:5000](http://127.0.0.1:5000)** in your browser.

> **Tip:** The sidebar shows a live **System Online / System Offline** indicator. If the server is not running, it will turn red and prompt you to run `python server.py`.

---

## 🛑 Stopping the Server

Press `Ctrl + C` in the terminal where `server.py` is running.

---

## 🔁 Deactivating the Virtual Environment

When you are done:

```bash
deactivate
```

---

## 📁 Project Structure

```
LightRAG-OCR/
├── server.py               # Flask API server (OCR + ChromaDB + SSE)
├── document_ocr_rag.py     # Standalone CLI pipeline script
├── dashboard/
│   ├── index.html          # Dashboard UI
│   ├── style.css           # Styling (light/dark themes)
│   └── app.js              # Frontend logic & API client
├── local_vector_db/        # ChromaDB persistent storage (auto-created)
└── README.md
```

---

## 💻 Quick Command Reference

| Task | Command |
|---|---|
| Clone repo | `git clone https://github.com/swapwarick/LightRAG-OCR.git` |
| Create venv | `python -m venv venv` |
| Activate (Windows PS) | `.\venv\Scripts\Activate.ps1` |
| Activate (Windows CMD) | `venv\Scripts\activate.bat` |
| Activate (Mac/Linux) | `source venv/bin/activate` |
| Install dependencies | `pip install flask flask-cors easyocr chromadb sentence-transformers` |
| Check CUDA | `python -c "import torch; print(torch.cuda.is_available())"` |
| Start server | `python server.py` |
| Open dashboard | [http://127.0.0.1:5000](http://127.0.0.1:5000) |
| Run CLI pipeline | `python document_ocr_rag.py` |
| Deactivate venv | `deactivate` |

---

## 🔌 API Reference

| Endpoint | Method | Description |
|---|---|---|
| `GET /` | GET | Serves the dashboard |
| `POST /api/upload` | POST | Runs OCR → chunk → embed pipeline |
| `GET /api/logs-stream` | GET | SSE stream of real-time pipeline logs |
| `GET /api/documents` | GET | Lists all indexed documents and chunks |
| `DELETE /api/documents/<name>` | DELETE | Removes a document and its vectors |
| `POST /api/search` | POST | Runs semantic similarity search |
| `GET /api/stats` | GET | Returns pipeline stats (docs, chunks, queries) |

---

## 🙌 Credits

Built on top of:
- [EasyOCR](https://github.com/JaidedAI/EasyOCR) by JaidedAI — multi-language OCR with GPU support
- [ChromaDB](https://github.com/chroma-core/chroma) — local vector database
- [sentence-transformers](https://www.sbert.net/) — semantic embedding models
- [Flask](https://flask.palletsprojects.com/) — lightweight Python web framework

---

## 📜 License

Distributed under the MIT License.
