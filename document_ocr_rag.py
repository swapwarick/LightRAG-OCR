import os
import sys
import logging

# Suppress Hugging Face Hub unauthenticated request warnings to keep terminal logs clean
logging.getLogger("huggingface_hub.utils._http").setLevel(logging.ERROR)

import easyocr
import chromadb
from chromadb.utils import embedding_functions

def extract_text_from_image(image_path, languages=['en']):
    """
    Extracts text from an image using EasyOCR.
    This runs completely locally and free.
    """
    print(f"[*] Initializing EasyOCR Reader for languages: {languages}...")
    # gpu=True will use CUDA if available, otherwise it falls back to CPU automatically.
    reader = easyocr.Reader(languages, gpu=True)
    
    print(f"[*] Running OCR on: {image_path}...")
    results = reader.readtext(image_path)
    
    # Sort results top-to-bottom, left-to-right to maintain logical reading order
    results.sort(key=lambda x: (x[0][0][1], x[0][0][0]))
    
    full_text = []
    for (bbox, text, prob) in results:
        full_text.append(text)
        
    return "\n".join(full_text)

def chunk_text(text, chunk_size=500, overlap=100):
    """
    Splits text into smaller, overlapping chunks for better vector search accuracy.
    """
    words = text.split()
    chunks = []
    
    # Basic word-based chunking with overlap
    i = 0
    while i < len(words):
        chunk_words = words[i:i + chunk_size]
        chunks.append(" ".join(chunk_words))
        i += (chunk_size - overlap)
        if i + chunk_size - overlap >= len(words) and i < len(words):
            # Capture the remaining words if they don't form a full chunk
            chunks.append(" ".join(words[i:]))
            break
            
    return [c for c in chunks if c.strip()]

def setup_vector_db(db_path="./local_vector_db"):
    """
    Initializes a local Chroma client.
    Chroma stores data in a local SQLite file in the db_path directory.
    """
    print(f"[*] Initializing local Vector DB at '{db_path}'...")
    # Persistent client writes data to disk
    client = chromadb.PersistentClient(path=db_path)
    
    # We use a completely free, local embedding model: sentence-transformers/all-MiniLM-L6-v2
    # Chroma downloads and runs this model locally automatically using HuggingFace's sentence-transformers library.
    # It requires ~80MB disk space, runs very fast on CPU, and uses minimal RAM (<150MB).
    emb_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name="all-MiniLM-L6-v2"
    )
    
    collection = client.get_or_create_collection(
        name="scanned_documents",
        embedding_function=emb_fn,
        metadata={"hnsw:space": "cosine"}
    )
    
    return collection

def add_document_to_db(collection, doc_id, text, metadata=None):
    """
    Chunks document text and inserts it into the local vector DB.
    """
    chunks = chunk_text(text)
    if not chunks:
        print("[!] No text extracted to add to the database.")
        return
        
    documents = []
    ids = []
    metadatas = []
    
    for i, chunk in enumerate(chunks):
        documents.append(chunk)
        ids.append(f"{doc_id}_chunk_{i}")
        chunk_metadata = metadata.copy() if metadata else {}
        chunk_metadata["chunk_index"] = i
        metadatas.append(chunk_metadata)
        
    print(f"[*] Adding {len(chunks)} chunks from document '{doc_id}' to the database...")
    collection.add(
        documents=documents,
        ids=ids,
        metadatas=metadatas
    )
    print("[+] Document added successfully!")

def search_documents(collection, query, num_results=3):
    """
    Queries the local vector DB and prints the most semantically relevant text chunks.
    """
    print(f"\n[*] Querying database for: '{query}'...")
    results = collection.query(
        query_texts=[query],
        n_results=num_results
    )
    
    print("\n--- Search Results ---")
    if not results or not results["documents"] or len(results["documents"][0]) == 0:
        print("No matching documents found.")
        return
        
    for i in range(len(results["documents"][0])):
        doc = results["documents"][0][i]
        score = results["distances"][0][i]
        meta = results["metadatas"][0][i]
        print(f"\n[Result #{i+1}] (Distance Score: {score:.4f})")
        print(f"Source Document: {meta.get('document_name', 'Unknown')}")
        print(f"Text Content:\n{doc}")
        print("-" * 30)

def main():
    # Example usage:
    # 1. Update this to the path of a scanned document image (PNG, JPG, etc.)
    sample_image = "invoice_sample.png" 
    
    if not os.path.exists(sample_image):
        print(f"[!] Please place a scanned document image at '{sample_image}' or update the script path.")
        print("[-] Running database query demonstration using dummy text instead...\n")
        
        # Fallback demonstration
        collection = setup_vector_db()
        
        dummy_invoice_text = """
        ACME CORPORATION INVOICE
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
        
        Thank you for your business! For inquiries, contact support@acme.com.
        """
        
        add_document_to_db(
            collection=collection,
            doc_id="invoice_2026",
            text=dummy_invoice_text,
            metadata={"document_name": "invoice_sample.png", "type": "invoice", "date": "2026-05-24"}
        )
        
        # Test semantic search queries
        search_documents(collection, "How much do I owe in total?")
        search_documents(collection, "Who is the invoice billed to?")
        search_documents(collection, "ACME support email address")
        return

    # 1. Extract local text via EasyOCR
    extracted_text = extract_text_from_image(sample_image)
    print("\n--- Extracted Text ---")
    print(extracted_text)
    print("----------------------\n")
    
    # 2. Setup Vector DB
    collection = setup_vector_db()
    
    # 3. Add to local Vector DB
    add_document_to_db(
        collection=collection,
        doc_id=os.path.basename(sample_image),
        text=extracted_text,
        metadata={"document_name": os.path.basename(sample_image), "type": "scan"}
    )
    
    # 4. Search local database
    search_documents(collection, "Enter your query here")

if __name__ == "__main__":
    main()
