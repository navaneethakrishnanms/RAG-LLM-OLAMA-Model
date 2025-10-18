import os
import glob
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from langchain.text_splitter import RecursiveCharacterTextSplitter 
from langchain_chroma import Chroma
from langchain.chains import RetrievalQA
from langchain_community.document_loaders import PyMuPDFLoader
from langchain_ollama import OllamaLLM, OllamaEmbeddings
import hashlib

# --- Configuration ---
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'documents')
CHROMA_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'chroma_db')
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
if not os.path.exists(CHROMA_DB_PATH):
    os.makedirs(CHROMA_DB_PATH)

# --- Flask App Initialization ---
# This uses absolute paths to reliably find the frontend folder
frontend_folder = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend'))
app = Flask(__name__, 
            static_folder=frontend_folder, 
            static_url_path='',
            template_folder=frontend_folder)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
CORS(app)

# (The rest of the file is the same...)

# --- Global Variables ---
rag_chain = None
vectorstore = None
embeddings = None
llm = None

# --- Helper Functions ---
def initialize_models():
    """Initialize embeddings and LLM models once"""
    global embeddings, llm
    if embeddings is None:
        print("Initializing embeddings with GPU acceleration...")
        embeddings = OllamaEmbeddings(model="llama3", base_url="http://localhost:11434")
    if llm is None:
        print("Initializing LLM with GPU acceleration...")
        llm = OllamaLLM(model="llama3", base_url="http://localhost:11434")

def get_file_hash(file_path):
    """Generate hash for file to check if already processed"""
    with open(file_path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()

def load_or_create_vectorstore():
    """Load existing vectorstore or create new one"""
    global vectorstore
    try:
        if os.path.exists(os.path.join(CHROMA_DB_PATH, "chroma.sqlite3")):
            print("Loading existing vectorstore...")
            vectorstore = Chroma(
                persist_directory=CHROMA_DB_PATH,
                embedding_function=embeddings
            )
        else:
            print("Creating new vectorstore...")
            vectorstore = Chroma(
                persist_directory=CHROMA_DB_PATH,
                embedding_function=embeddings
            )
        return True
    except Exception as e:
        print(f"Error loading vectorstore: {e}")
        return False

def process_document(file_path):
    global rag_chain, vectorstore
    try:
        # Initialize models if not already done
        initialize_models()
        
        # Load or create vectorstore
        if not load_or_create_vectorstore():
            return False, "Failed to initialize vectorstore"

        print(f"Processing document: {file_path}")
        
        # Check if document is already processed
        file_hash = get_file_hash(file_path)
        filename = os.path.basename(file_path)
        
        # Check if document already exists in vectorstore
        try:
            existing_docs = vectorstore.get(where={"filename": filename})
            if existing_docs and existing_docs['ids']:
                print(f"Document {filename} already processed, updating...")
                # Remove existing documents for this file
                vectorstore.delete(ids=existing_docs['ids'])
        except:
            pass  # Continue if no existing documents

        # Load and process document
        loader = PyMuPDFLoader(file_path)
        documents = loader.load()
        if not documents:
            return False, "Document is empty or could not be loaded."

        print("Splitting document into chunks...")
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        chunks = text_splitter.split_documents(documents)
        if not chunks:
            return False, "Failed to split document into chunks."

        # Add metadata to chunks
        for chunk in chunks:
            chunk.metadata.update({
                "filename": filename,
                "file_hash": file_hash,
                "source": file_path
            })

        print("Adding documents to vectorstore...")
        vectorstore.add_documents(chunks)
        vectorstore.persist()

        print("Creating QA chain...")
        rag_chain = RetrievalQA.from_chain_type(
            llm=llm,
            chain_type="stuff",
            retriever=vectorstore.as_retriever(search_kwargs={"k": 4}),
            return_source_documents=True
        )
        print("QA chain is ready.")
        return True, "Document processed successfully."

    except Exception as e:
        print(f"An error occurred during document processing: {e}")
        return False, f"An internal error occurred: {str(e)}"

# --- Routes ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/style.css')
def style_css():
    return app.send_static_file('style.css')

@app.route('/script.js')
def script_js():
    return app.send_static_file('script.js')

@app.route('/api/files', methods=['GET'])
def get_files():
    """Get list of all PDF files in the documents folder"""
    try:
        pdf_files = glob.glob(os.path.join(UPLOAD_FOLDER, "*.pdf"))
        files_info = []
        
        for file_path in pdf_files:
            filename = os.path.basename(file_path)
            file_size = os.path.getsize(file_path)
            file_info = {
                "name": filename,
                "size": file_size,
                "path": file_path,
                "uploaded_at": "Unknown"  # We don't track upload time for existing files
            }
            files_info.append(file_info)
        
        return jsonify({"files": files_info})
    except Exception as e:
        return jsonify({"error": f"Failed to get files: {str(e)}"}), 500

@app.route('/api/initialize', methods=['POST'])
def initialize_system():
    """Initialize the system with existing vectorstore"""
    global rag_chain, vectorstore
    try:
        initialize_models()
        
        if load_or_create_vectorstore():
            # Check if vectorstore has any documents
            try:
                all_docs = vectorstore.get()
                if all_docs and all_docs['ids']:
                    rag_chain = RetrievalQA.from_chain_type(
                        llm=llm,
                        chain_type="stuff",
                        retriever=vectorstore.as_retriever(search_kwargs={"k": 4}),
                        return_source_documents=True
                    )
                    return jsonify({"message": "System initialized with existing data", "has_data": True})
            except:
                pass
        
        return jsonify({"message": "System initialized", "has_data": False})
    except Exception as e:
        return jsonify({"error": f"Failed to initialize system: {str(e)}"}), 500

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part in the request"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    if file:
        try:
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
            file.save(file_path)
            success, message = process_document(file_path)
            if success:
                return jsonify({"message": f"File '{file.filename}' processed! Ready to chat."}), 200
            else:
                return jsonify({"error": message}), 500
        except Exception as e:
            return jsonify({"error": f"An error occurred during upload: {str(e)}"}), 500

@app.route('/delete', methods=['POST'])
def delete_file():
    global rag_chain, vectorstore
    try:
        data = request.get_json()
        filename = data.get('filename')
        
        if not filename:
            return jsonify({"error": "No filename provided"}), 400
        
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        if os.path.exists(file_path):
            # Remove from vectorstore if it exists
            if vectorstore:
                try:
                    existing_docs = vectorstore.get(where={"filename": filename})
                    if existing_docs and existing_docs['ids']:
                        vectorstore.delete(ids=existing_docs['ids'])
                        vectorstore.persist()
                        print(f"Removed {len(existing_docs['ids'])} chunks for {filename}")
                except Exception as e:
                    print(f"Error removing from vectorstore: {e}")
            
            # Remove physical file
            os.remove(file_path)
            
            # Check if vectorstore is now empty
            if vectorstore:
                try:
                    all_docs = vectorstore.get()
                    if not all_docs or not all_docs['ids']:
                        rag_chain = None  # Reset RAG chain if no documents left
                        print("Vectorstore is now empty, RAG chain reset")
                except:
                    pass
            
            return jsonify({"message": f"File '{filename}' deleted successfully"}), 200
        else:
            return jsonify({"error": "File not found"}), 404
            
    except Exception as e:
        print(f"Error deleting file: {e}")
        return jsonify({"error": f"An error occurred while deleting the file: {str(e)}"}), 500

@app.route('/ask', methods=['POST'])
def ask_question():
    global rag_chain
    if not rag_chain:
        return jsonify({"error": "Document not processed yet. Please upload a file first."}), 400

    data = request.get_json()
    question = data.get('question')
    if not question:
        return jsonify({"error": "No question provided"}), 400

    try:
        print(f"Received question: {question}")
        response = rag_chain.invoke({"query": question})
        answer = response.get('result', 'Sorry, I could not find an answer.')
        print(f"Generated answer: {answer}")
        return jsonify({"answer": answer})
    except Exception as e:
        print(f"Error in ask_question: {e}")
        return jsonify({"error": f"An error occurred while getting the answer: {str(e)}"}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)