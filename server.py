import os
import sys
import io

# Force stdout and stderr to handle UTF-8 symbols (prevents progress bar/download block character crashes)
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except AttributeError:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import tempfile
import logging

# Suppress Hugging Face Hub unauthenticated request warnings to keep terminal logs clean
logging.getLogger("huggingface_hub.utils._http").setLevel(logging.ERROR)

import json
import time
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
import easyocr
import chromadb
from chromadb.utils import embedding_functions

# Initialize Flask
app = Flask(__name__, static_folder='dashboard', static_url_path='')
CORS(app)  # Enable CORS for cross-origin testing

# Global Reader cache to avoid reloading EasyOCR for the same language
readers = {}

# Local DB path
DB_PATH = "./local_vector_db"

# Stats tracked in memory
stats_tracker = {
    "queries_run": 0,
    "last_similarity_scores": []
}

def get_easyocr_reader(languages_list):
    """Cached initialization of EasyOCR reader"""
    lang_key = tuple(sorted(languages_list))
    if lang_key not in readers:
        # Load GPU if available
        readers[lang_key] = easyocr.Reader(list(languages_list), gpu=True)
    return readers[lang_key]

def get_chroma_collection(model_name="all-MiniLM-L6-v2"):
    """Initialize persistent local ChromaDB client and collection"""
    client = chromadb.PersistentClient(path=DB_PATH)
    emb_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=model_name
    )
    collection = client.get_or_create_collection(
        name="scanned_documents",
        embedding_function=emb_fn,
        metadata={"hnsw:space": "cosine"}
    )
    return collection

def chunk_text(text, chunk_size=500, overlap=100):
    """Splits text into smaller, overlapping chunks for vector search accuracy"""
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk_words = words[i:i + chunk_size]
        chunks.append(" ".join(chunk_words))
        i += (chunk_size - overlap)
        if i + chunk_size - overlap >= len(words) and i < len(words):
            chunks.append(" ".join(words[i:]))
            break
            
    return [c for c in chunks if c.strip()]

# Route to serve front-end files
@app.route('/')
def index():
    return send_from_directory('dashboard', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('dashboard', path)

# SSE Logger for real-time console streaming during upload
class LogQueue:
    def __init__(self):
        self.listeners = []
    
    def listen(self):
        self.listeners.append([])
        return self.listeners[-1]
        
    def broadcast(self, message):
        for listener in self.listeners:
            listener.append(message)

log_queue = LogQueue()

def generate_log_events(listener):
    while True:
        if listener:
            msg = listener.pop(0)
            yield f"data: {json.dumps(msg)}\n\n"
        else:
            time.sleep(0.1)

@app.route('/api/logs-stream')
def logs_stream():
    listener = log_queue.listen()
    return Response(generate_log_events(listener), mimetype='text/event-stream')

@app.route('/api/upload', methods=['POST'])
def upload_document():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "Empty filename"}), 400

    # Read configuration
    languages = request.form.getlist('languages') or ['en']
    chunk_size = int(request.form.get('chunkSize', 500))
    chunk_overlap = int(request.form.get('chunkOverlap', 100))
    model_name = request.form.get('embeddingModel', 'all-MiniLM-L6-v2')
    doc_type = request.form.get('type', 'scan')

    log_queue.broadcast({"status": "ocr_start", "message": "[*] Initializing EasyOCR Reader..."})
    log_queue.broadcast({"status": "ocr_log", "message": f"[*] Selected languages: {languages}"})
    
    try:
        reader = get_easyocr_reader(languages)
    except Exception as e:
        log_queue.broadcast({"status": "error", "message": f"[!] Reader Init Error: {str(e)}"})
        return jsonify({"error": f"Failed to initialize EasyOCR: {str(e)}"}), 500

    # Save to a temporary file
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, file.filename)
    file.save(temp_path)

    is_pdf = file.filename.lower().endswith('.pdf')
    if is_pdf:
        doc_type = 'pdf'

    log_queue.broadcast({"status": "ocr_running", "message": f"[*] Processing document: {file.filename}..."})
    
    try:
        start_time = time.time()
        if is_pdf:
            import fitz
            with fitz.open(temp_path) as doc:
                digital_text_parts = []
                
                for i, page in enumerate(doc):
                    text = page.get_text()
                    if text.strip():
                        digital_text_parts.append(text)
                
                extracted_text = "\n".join(digital_text_parts).strip()
                
                # If digital text exists and has substantial content, use it directly!
                if len(extracted_text) > 100:
                    ocr_time = time.time() - start_time
                    log_queue.broadcast({
                        "status": "ocr_complete", 
                        "message": f"[+] PDF digital text extraction complete — {len(extracted_text)} characters extracted in {ocr_time:.2f}s (No OCR required)."
                    })
                else:
                    log_queue.broadcast({"status": "ocr_log", "message": "[*] Digital text is empty or too short. Falling back to EasyOCR page rendering..."})
                    ocr_text_parts = []
                    
                    for i, page in enumerate(doc):
                        log_queue.broadcast({"status": "ocr_running", "message": f"[*] Rendering page {i+1} of {len(doc)}..."})
                        zoom = 2.0
                        mat = fitz.Matrix(zoom, zoom)
                        pix = page.get_pixmap(matrix=mat)
                        
                        log_queue.broadcast({"status": "ocr_running", "message": f"[*] Running EasyOCR on page {i+1} of {len(doc)}..."})
                        png_data = pix.tobytes("png")
                        
                        page_results = reader.readtext(png_data)
                        page_results.sort(key=lambda x: (x[0][0][1], x[0][0][0]))
                        
                        page_text = "\n".join([text for (_, text, _) in page_results])
                        if page_text.strip():
                            ocr_text_parts.append(page_text)
                    
                    extracted_text = "\n".join(ocr_text_parts).strip()
                    ocr_time = time.time() - start_time
                    log_queue.broadcast({
                        "status": "ocr_complete", 
                        "message": f"[+] PDF OCR complete — {len(extracted_text)} characters extracted in {ocr_time:.2f}s."
                    })
        else:
            # Regular Image/Scan EasyOCR
            results = reader.readtext(temp_path)
            
            # Sort results: top-to-bottom, left-to-right
            results.sort(key=lambda x: (x[0][0][1], x[0][0][0]))
            
            full_text_list = [text for (_, text, _) in results]
            extracted_text = "\n".join(full_text_list)
            ocr_time = time.time() - start_time
            
            log_queue.broadcast({
                "status": "ocr_complete", 
                "message": f"[+] OCR complete — {len(extracted_text)} characters extracted in {ocr_time:.2f}s."
            })
            
    except Exception as e:
        log_queue.broadcast({"status": "error", "message": f"[!] Processing Error: {str(e)}"})
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return jsonify({"error": f"Document processing failed: {str(e)}"}), 500

    # Clean up temp file
    if os.path.exists(temp_path):
        os.remove(temp_path)

    # Text Chunking
    log_queue.broadcast({"status": "chunk_start", "message": "[*] Splitting text into overlapping chunks..."})
    log_queue.broadcast({"status": "chunk_log", "message": f"[*] Chunk size: {chunk_size} words, Overlap: {chunk_overlap} words"})
    
    chunks = chunk_text(extracted_text, chunk_size, chunk_overlap)
    
    log_queue.broadcast({"status": "chunk_complete", "message": f"[+] Created {len(chunks)} text chunks."})

    if not chunks:
        log_queue.broadcast({"status": "error", "message": "[!] No text extracted to index."})
        return jsonify({"error": "No text extracted from document to index"}), 400

    # ChromaDB indexing
    log_queue.broadcast({"status": "embed_start", "message": f"[*] Initializing ChromaDB using model: {model_name}..."})
    
    try:
        collection = get_chroma_collection(model_name)
    except Exception as e:
        log_queue.broadcast({"status": "error", "message": f"[!] Vector DB Error: {str(e)}"})
        return jsonify({"error": f"Failed to connect to ChromaDB: {str(e)}"}), 500

    log_queue.broadcast({"status": "embed_running", "message": f"[*] Generating vector embeddings and indexing chunks..."})

    documents = []
    ids = []
    metadatas = []
    
    # Store unique timestamp per document
    doc_timestamp = int(time.time() * 1000)
    
    for i, chunk in enumerate(chunks):
        documents.append(chunk)
        ids.append(f"{file.filename}_chunk_{i}_{doc_timestamp}")
        metadatas.append({
            "document_name": file.filename,
            "type": doc_type,
            "date": doc_timestamp,
            "chunk_index": i,
            "char_count": len(chunk),
            "model_name": model_name
        })

    try:
        collection.add(
            documents=documents,
            ids=ids,
            metadatas=metadatas
        )
        log_queue.broadcast({"status": "embed_complete", "message": "[+] All embeddings written and indexed successfully!"})
        log_queue.broadcast({"status": "done", "message": "[*] Pipeline finished successfully!"})
    except Exception as e:
        log_queue.broadcast({"status": "error", "message": f"[!] Embedding Error: {str(e)}"})
        return jsonify({"error": f"ChromaDB insert failed: {str(e)}"}), 500

    return jsonify({
        "success": True,
        "document_name": file.filename,
        "chunks_count": len(chunks),
        "char_count": len(extracted_text),
        "type": doc_type,
        "date": doc_timestamp
    })

@app.route('/api/documents', methods=['GET'])
def get_documents():
    """Retrieve unique documents stored in ChromaDB"""
    try:
        collection = get_chroma_collection()
        data = collection.get(include=["metadatas", "documents"])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Group chunks by document_name
    doc_groups = {}
    if data and data.get("metadatas"):
        for i, meta in enumerate(data["metadatas"]):
            doc_name = meta.get("document_name")
            if not doc_name:
                continue
                
            chunk_content = data["documents"][i] if data.get("documents") else ""
            
            if doc_name not in doc_groups:
                date_val = meta.get("date")
                parsed_date = int(time.time() * 1000)
                if date_val is not None:
                    if isinstance(date_val, (int, float)):
                        parsed_date = int(date_val)
                    elif isinstance(date_val, str):
                        try:
                            if '-' in date_val:
                                struct = time.strptime(date_val.split(' ')[0], "%Y-%m-%d")
                                parsed_date = int(time.mktime(struct) * 1000)
                            else:
                                parsed_date = int(date_val)
                        except Exception:
                            pass

                doc_groups[doc_name] = {
                    "id": doc_name,
                    "name": doc_name,
                    "type": meta.get("type", "scan"),
                    "date": parsed_date,
                    "chunks": [],
                    "metadata": {
                        "charCount": 0,
                        "chunkCount": 0,
                        "model": meta.get("model_name", "all-MiniLM-L6-v2")
                    }
                }
            
            doc_groups[doc_name]["chunks"].append({
                "index": meta.get("chunk_index", 0),
                "text": chunk_content
            })
            doc_groups[doc_name]["metadata"]["charCount"] += len(chunk_content)

    # Sort chunks in logical order and format response
    docs_list = []
    for doc in doc_groups.values():
        doc["chunks"].sort(key=lambda x: x["index"])
        # Extract raw chunk texts
        doc["chunks"] = [chunk["text"] for chunk in doc["chunks"]]
        doc["metadata"]["chunkCount"] = len(doc["chunks"])
        docs_list.append(doc)

    # Sort documents by date descending
    docs_list.sort(key=lambda x: x["date"], reverse=True)
    return jsonify(docs_list)

@app.route('/api/documents/<path:doc_name>', methods=['DELETE'])
def delete_document(doc_name):
    """Delete a document and all its chunks from ChromaDB"""
    try:
        collection = get_chroma_collection()
        # Chroma deletes chunks using a where metadata query
        collection.delete(where={"document_name": doc_name})
        return jsonify({"success": True, "message": f"Document '{doc_name}' deleted."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/search', methods=['POST'])
def search():
    """Real semantic query against ChromaDB"""
    body = request.json or {}
    query = body.get("query", "").strip()
    k = int(body.get("k", 3))
    
    if not query:
        return jsonify({"error": "Empty query"}), 400
        
    try:
        collection = get_chroma_collection()
        results = collection.query(
            query_texts=[query],
            n_results=k
        )
        
        # Format ChromaDB response
        formatted_results = []
        if results and results.get("documents") and len(results["documents"][0]) > 0:
            for i in range(len(results["documents"][0])):
                doc = results["documents"][0][i]
                meta = results["metadatas"][0][i]
                distance = results["distances"][0][i]
                
                # Convert distance (L2 or Cosine distance) to similarity percentage
                # For cosine distance, similarity = 1 - distance
                similarity_score = max(0.0, 1.0 - float(distance))
                stats_tracker["last_similarity_scores"].append(similarity_score)
                
                formatted_results.append({
                    "docName": meta.get("document_name", "Unknown"),
                    "chunkIdx": meta.get("chunk_index", 0),
                    "text": doc,
                    "score": similarity_score
                })
        
        stats_tracker["queries_run"] += 1
        return jsonify(formatted_results)
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Retrieve database & pipeline operational statistics"""
    try:
        collection = get_chroma_collection()
        data = collection.get(include=["metadatas", "documents"])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    total_chunks = len(data["ids"]) if data and data.get("ids") else 0
    total_chars = sum(len(doc) for doc in data["documents"]) if data and data.get("documents") else 0
    
    # Calculate unique docs
    unique_docs = set()
    if data and data.get("metadatas"):
        for meta in data["metadatas"]:
            if meta.get("document_name"):
                unique_docs.add(meta.get("document_name"))

    avg_sim = 0.0
    if stats_tracker["last_similarity_scores"]:
        avg_sim = sum(stats_tracker["last_similarity_scores"]) / len(stats_tracker["last_similarity_scores"])

    return jsonify({
        "totalDocs": len(unique_docs),
        "totalChunks": total_chunks,
        "totalChars": total_chars,
        "queriesRun": stats_tracker["queries_run"],
        "avgSimilarity": avg_sim
    })

if __name__ == '__main__':
    # Add dummy dataset if DB is completely empty for a premium first experience
    try:
        c = get_chroma_collection()
        existing_items = c.get(limit=1)
        if not existing_items or not existing_items.get("ids"):
            print("[*] Local Vector DB is empty. Seeding dummy invoice...")
            dummy_text = """ACME CORPORATION INVOICE
Invoice Number: INV-2026-9876
Date: May 24, 2026
Due Date: June 24, 2026

Billing To:
Hitesh Sharma
123 Main Street, Suite 400

Items Ordered:
1. High-Performance GPU Cloud Instance (100 hours) - $150.00
2. Vector Storage Enterprise SSD (500GB) - $50.00
3. Automated Agentic Coding Workspace Setup Fee - $25.00

Total Amount Due: $225.00
Tax (8%): $18.00
Grand Total: $243.00

Thank you for your business! For inquiries, contact support@acme.com."""
            
            words = dummy_text.split()
            chunks = [" ".join(words[i:i+100]) for i in range(0, len(words), 80)]
            doc_ts = int(time.time() * 1000)
            
            c.add(
                documents=chunks,
                ids=[f"invoice_sample.png_chunk_{i}_{doc_ts}" for i in range(len(chunks))],
                metadatas=[{
                    "document_name": "invoice_sample.png",
                    "type": "invoice",
                    "date": doc_ts,
                    "chunk_index": i,
                    "char_count": len(ch),
                    "model_name": "all-MiniLM-L6-v2"
                } for i, ch in enumerate(chunks)]
            )
            print("[+] Seeded dummy dataset successfully.")
    except Exception as e:
        print(f"[!] Seeding warning: {str(e)}")

    print("\n" + "="*50)
    print("[*] OCR PIPELINE DASHBOARD IS RUNNING!")
    print("[-] Open http://127.0.0.1:5000 in your browser")
    print("="*50 + "\n")
    app.run(host='127.0.0.1', port=5000, debug=True)
