document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('upload-form');
    const uploadButton = uploadForm.querySelector('button');
    const fileInput = document.getElementById('file-input');
    const uploadStatus = document.getElementById('upload-status');
    const chatContainer = document.getElementById('chat-container');
    const chatForm = document.getElementById('chat-form');
    const chatButton = chatForm.querySelector('button');
    const questionInput = document.getElementById('question-input');
    const chatBox = document.getElementById('chat-box');
    const loadingIndicator = document.getElementById('loading-indicator');

    const API_URL = 'http://127.0.0.1:5000';

    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const file = fileInput.files[0];

        if (!file) {
            updateStatus('Please select a file first.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        updateStatus('Uploading and processing file... This may take a moment.', 'loading');
        chatContainer.style.display = 'none';
        uploadButton.disabled = true;
        fileInput.disabled = true;

        try {
            const response = await fetch(`${API_URL}/upload`, {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (response.ok) {
                updateStatus(result.message, 'success');
                chatContainer.style.display = 'block'; 
                chatBox.innerHTML = ''; // Clear previous chat history
            } else {
                throw new Error(result.error || 'An unknown error occurred.');
            }
        } catch (error) {
            updateStatus(`Error: ${error.message}`, 'error');
        } finally {
            uploadButton.disabled = false;
            fileInput.disabled = false;
        }
    });

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const question = questionInput.value.trim();
        if (!question) return;

        appendMessage(question, 'user');
        questionInput.value = '';
        loadingIndicator.style.display = 'block';
        chatButton.disabled = true;

        try {
            const response = await fetch(`${API_URL}/ask`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ question: question }),
            });

            const result = await response.json();
            
            if (response.ok) {
                appendMessage(result.answer, 'bot');
            } else {
                throw new Error(result.error || 'An unknown error occurred.');
            }
        } catch (error) {
            appendMessage(`Sorry, an error occurred: ${error.message}`, 'bot');
        } finally {
            loadingIndicator.style.display = 'none';
            chatButton.disabled = false;
            questionInput.focus();
        }
    });

    function updateStatus(message, type) {
        uploadStatus.textContent = message;
        uploadStatus.className = 'status-message'; // Reset classes
        if (type === 'success') {
            uploadStatus.classList.add('success');
        } else if (type === 'error') {
            uploadStatus.classList.add('error');
        } else {
            uploadStatus.classList.add('loading');
        }
    }

    function appendMessage(text, sender) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${sender}-message`);
        // Basic sanitation to prevent HTML injection
        messageElement.textContent = text; 
        chatBox.appendChild(messageElement);
        chatBox.scrollTop = chatBox.scrollHeight; 
    }
});