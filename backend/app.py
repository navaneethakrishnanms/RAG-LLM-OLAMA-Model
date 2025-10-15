import os
import fitz  # PyMuPDF
# --- NEW IMPORTS ---
from flask import Flask, request, jsonify, render_template, send_from_directory
# -------------------
from flask_cors import CORS
from langchain_community.llms import Ollama
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_community.embeddings import OllamaEmbeddings
from langchain.chains import RetrievalQA

# --- Configuration ---
# This will create 'documents' inside the 'backend' folder, which is correct
UPLOAD_FOLDER = 'documents'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# --- Flask App Initialization ---
# --- MODIFIED LINE ---
# Tell Flask where to find the static files (CSS, JS) and the main HTML file
app = Flask(__name__, static_folder='../frontend', template_folder='../frontend')
# -------------------
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
CORS(app)  # Enable Cross-Origin Resource Sharing

# --- Global Variables ---
qa_chain = None
vectorstore = None

# --- Helper Functions ---
def process_document(file_path):
    """Loads a document, splits it into chunks, and creates a vector store."""
    global vectorstore
    
    text = ""
    if file_path.endswith('.pdf'):
        try:
            with fitz.open(file_path) as doc:
                for page in doc:
                    text += page.get_text()
        except Exception as e:
            print(f"Error reading PDF {file_path}: {e}")
            return False

    elif file_path.endswith('.txt'):
        with open(file_path, 'r', encoding='utf-8') as f:
            text = f.read()
    else:
        return False

    if not text.strip():
        print(f"Warning: No text extracted from {file_path}")
        return False

    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = text_splitter.split_text(text)
    
    print("Creating embeddings and vector store...")
    embeddings = OllamaEmbeddings(model="llama3")
    vectorstore = Chroma.from_texts(texts=chunks, embedding=embeddings)
    print("Vector store created successfully.")
    
    return True

# --- NEW ROUTE TO SERVE THE FRONTEND ---
@app.route('/')
def index():
    """Serves the main HTML file."""
    return render_template('index.html')

# This route is needed to serve static files like script.js and style.css
# The static_folder configuration handles this automatically, but this is a fallback
@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('../frontend', path)
# --------------------------------------

# --- API Endpoints ---
@app.route('/upload', methods=['POST'])
def upload_file():
    """Handles file upload and processing."""
    global qa_chain
    
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
        
    if file:
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
        file.save(file_path)
        
        print(f"Processing document: {file_path}")
        if process_document(file_path):
            print("Document processed. Creating QA chain...")
            llm = Ollama(model="llama3")
            qa_chain = RetrievalQA.from_chain_type(
                llm=llm,
                chain_type="stuff",
                retriever=vectorstore.as_retriever()
            )
            print("QA chain ready.")
            return jsonify({"message": f"File '{file.filename}' uploaded and processed successfully!"}), 200
        else:
            return jsonify({"error": "Unsupported file type or failed to extract text."}), 400

@app.route('/ask', methods=['POST'])
def ask_question():
    """Receives a question and returns the model's answer."""
    global qa_chain
    
    if not qa_chain:
        return jsonify({"error": "Please upload a document first."}), 400
        
    data = request.get_json()
    question = data.get('question')
    
    if not question:
        return jsonify({"error": "No question provided"}), 400
        
    try:
        print(f"Received question: {question}")
        response = qa_chain.invoke(question)
        print(f"Generated response: {response}")
        return jsonify({"answer": response['result']})
    except Exception as e:
        print(f"Error during QA invocation: {e}")
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500

# --- Main Execution ---
if __name__ == '__main__':
    app.run(debug=True, port=5000)